-- ============================================================================
-- 0007 — บิล, การชำระเงิน, โปรโมชั่น และแต้มสะสม
-- ============================================================================

-- ── โปรโมชั่น ───────────────────────────────────────────────────────────────
create table promotions (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid not null references branches(id) on delete cascade,
  code              text not null,
  name              text not null,
  description       text,

  type              promotion_type not null,
  scope             promotion_scope not null default 'bill',
  value_bp          integer check (value_bp between 0 and 10000),   -- ใช้เมื่อ type = percent
  value_satang      integer check (value_satang >= 0),              -- ใช้เมื่อ type = fixed
  free_add_on_id    uuid references add_ons(id) on delete set null, -- ใช้เมื่อ type = free_addon

  min_spend_satang  integer not null default 0 check (min_spend_satang >= 0),
  starts_at         timestamptz,
  ends_at           timestamptz,
  days_of_week      smallint[] not null default '{}',   -- 0=อาทิตย์ .. 6=เสาร์ ({} = ทุกวัน)
  time_start        time,
  time_end          time,
  max_uses          integer check (max_uses > 0),
  uses_count        integer not null default 0 check (uses_count >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (branch_id, code),
  constraint chk_promotion_value check (
    (type = 'percent'     and value_bp     is not null)
    or (type = 'fixed'    and value_satang is not null)
    or (type = 'free_addon' and free_add_on_id is not null)
  ),
  constraint chk_promotion_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create trigger trg_promotions_updated_at before update on promotions
  for each row execute function set_updated_at();

create table visit_promotions (
  visit_id        uuid not null references visits(id) on delete cascade,
  promotion_id    uuid not null references promotions(id) on delete restrict,
  name_snapshot   text not null,
  discount_satang integer not null check (discount_satang >= 0),
  applied_by      uuid references profiles(id) on delete set null,
  applied_at      timestamptz not null default now(),
  primary key (visit_id, promotion_id)
);

-- ── บรรทัดบิล (snapshot ตอนเช็คบิล) ─────────────────────────────────────────
-- เก็บแยกจาก visits เพื่อให้พิมพ์ใบเสร็จซ้ำได้เหมือนเดิมทุกบรรทัด
-- แม้ราคาเมนู แพ็กเกจ หรืออัตรา VAT จะถูกแก้ไปแล้วก็ตาม
create table bill_lines (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits(id) on delete cascade,
  kind              bill_line_kind not null,
  description       text not null,
  quantity          numeric(10,2) not null default 1,
  unit_price_satang integer not null default 0,
  amount_satang     integer not null,          -- ส่วนลดเก็บเป็นค่าติดลบ
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now()
);
create index idx_bill_lines_visit on bill_lines(visit_id, sort_order);

-- ── การชำระเงิน ─────────────────────────────────────────────────────────────
-- หลายแถวต่อหนึ่ง visit = รองรับจ่ายแยก / จ่ายผสม (เงินสดบางส่วน + โอนบางส่วน)
create table payments (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits(id) on delete cascade,
  method            payment_method not null,
  provider          payment_provider not null,

  -- amount_satang = ยอดที่ตัดเข้าบิล (ห้ามรวมกันเกิน visits.total_satang)
  -- tendered_satang = เงินที่ลูกค้ายื่นให้จริง (เงินสดเกินได้ เพราะต้องทอน)
  amount_satang     integer not null check (amount_satang > 0),
  tendered_satang   integer check (tendered_satang >= 0),
  change_satang     integer not null default 0 check (change_satang >= 0),

  status            payment_status not null default 'pending',
  provider_ref      text,                       -- transaction id จาก gateway
  provider_payload  jsonb,                      -- payload ดิบไว้ตรวจสอบย้อนหลัง
  failure_reason    text,

  processed_by      uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  updated_at        timestamptz not null default now(),

  -- เงินสดเท่านั้นที่ยื่นเกินยอดแล้วรับเงินทอนได้
  constraint chk_payment_cash_tender check (
    method = 'cash'
    or tendered_satang is null
    or tendered_satang = amount_satang
  ),
  constraint chk_payment_change check (
    change_satang = 0
    or (tendered_satang is not null and change_satang = tendered_satang - amount_satang)
  )
);
create index idx_payments_visit on payments(visit_id, created_at);
create index idx_payments_status on payments(status, created_at desc);
create unique index idx_payments_provider_ref on payments(provider, provider_ref)
  where provider_ref is not null;
create trigger trg_payments_updated_at before update on payments
  for each row execute function set_updated_at();

-- ══ ข้อ ③: กันจ่ายเกินที่ชั้นฐานข้อมูล ═══════════════════════════════════════
-- CHECK constraint ข้ามแถวไม่ได้ จึงต้องใช้ trigger ที่ล็อกแถว visit ก่อนรวมยอด
-- ล็อกด้วย FOR UPDATE ทำให้แคชเชียร์สองเครื่องกดพร้อมกันแล้วยอดไม่เกิน
create or replace function enforce_payment_not_exceeding_total()
returns trigger
language plpgsql
as $$
declare
  v_total     integer;
  v_status    visit_status;
  v_paid      integer;
begin
  -- สนใจเฉพาะแถวที่นับเป็นเงินเข้าจริง
  if new.status <> 'succeeded' then
    return new;
  end if;

  select total_satang, status into v_total, v_status
  from visits where id = new.visit_id
  for update;                                  -- serialize ผู้ชำระพร้อมกัน

  if v_status in ('closed', 'void') then
    raise exception 'ชำระเงินไม่ได้: visit นี้ปิดหรือถูกยกเลิกไปแล้ว (status=%)', v_status
      using errcode = 'check_violation';
  end if;

  if v_total <= 0 then
    raise exception 'ชำระเงินไม่ได้: ยังไม่ได้คำนวณยอดบิล ต้องกดเช็คบิลก่อน'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount_satang), 0) into v_paid
  from payments
  where visit_id = new.visit_id
    and status = 'succeeded'
    and id <> new.id;                          -- ไม่นับแถวตัวเอง (กรณี UPDATE)

  if v_paid + new.amount_satang > v_total then
    raise exception
      'ชำระเกินยอดบิล: จ่ายแล้ว % สตางค์ + ครั้งนี้ % สตางค์ เกินยอด % สตางค์ (คงเหลือ %)',
      v_paid, new.amount_satang, v_total, v_total - v_paid
      using errcode = 'check_violation';
  end if;

  if new.completed_at is null then
    new.completed_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_payments_no_overpay
  before insert or update on payments
  for each row execute function enforce_payment_not_exceeding_total();

-- ── แต้มสะสม (ledger) ───────────────────────────────────────────────────────
-- ห้ามแก้ customers.points_balance ตรง ๆ — ต้องผ่าน ledger นี้เท่านั้น
-- เพื่อให้ตรวจย้อนหลังได้เสมอว่าแต้มมาจากไหนและถูกใช้ไปกับบิลใบไหน
create table loyalty_transactions (
  id             bigserial primary key,
  customer_id    uuid not null references customers(id) on delete cascade,
  visit_id       uuid references visits(id) on delete set null,
  type           loyalty_txn_type not null,
  points         integer not null,             -- earn/adjust เป็นบวก, redeem/expire เป็นลบ
  balance_after  integer not null check (balance_after >= 0),
  note           text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint chk_loyalty_sign check (
    (type in ('earn') and points > 0)
    or (type in ('redeem', 'expire') and points < 0)
    or (type = 'adjust' and points <> 0)
  )
);
create index idx_loyalty_customer on loyalty_transactions(customer_id, created_at desc);
create index idx_loyalty_visit    on loyalty_transactions(visit_id);

-- คำนวณ balance_after และอัปเดตยอดคงเหลือของลูกค้าให้อัตโนมัติ
create or replace function apply_loyalty_transaction()
returns trigger
language plpgsql
as $$
declare
  v_balance integer;
begin
  select points_balance into v_balance
  from customers where id = new.customer_id
  for update;

  if v_balance + new.points < 0 then
    raise exception 'แต้มไม่พอ: คงเหลือ % แต้ม ต้องการใช้ % แต้ม', v_balance, abs(new.points)
      using errcode = 'check_violation';
  end if;

  new.balance_after := v_balance + new.points;

  update customers
     set points_balance = new.balance_after
   where id = new.customer_id;

  return new;
end;
$$;

create trigger trg_loyalty_apply
  before insert on loyalty_transactions
  for each row execute function apply_loyalty_transaction();
