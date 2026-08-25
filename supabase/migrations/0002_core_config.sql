-- ============================================================================
-- 0002 — สาขา, การตั้งค่าร้าน, พนักงาน, สถานีครัว, ตัวนับ, audit log
-- ============================================================================

-- ── ฟังก์ชันร่วม: อัปเดต updated_at อัตโนมัติ ───────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── สาขา ────────────────────────────────────────────────────────────────────
-- v1 มีสาขาเดียว แต่ใส่ตารางนี้ไว้ตั้งแต่ต้นเพราะการเติม branch_id ทีหลัง
-- ต้องรื้อทั้ง FK, index และ RLS policy ทุกตาราง — ตอนนี้แทบไม่มีต้นทุน
create table branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  address     text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_branches_updated_at before update on branches
  for each row execute function set_updated_at();

-- ── การตั้งค่าร้าน (หนึ่งแถวต่อหนึ่งสาขา) ───────────────────────────────────
-- ข้อ ① + ⑤: อัตรา ราคา และเพดานทุกตัวอยู่ที่นี่ ไม่ใช่ในโค้ด
create table restaurant_settings (
  branch_id                     uuid primary key references branches(id) on delete cascade,

  -- ข้อมูลร้านสำหรับใบเสร็จ
  display_name                  text not null,
  legal_name                    text,
  tax_id                        text,
  address                       text,
  phone                         text,
  logo_url                      text,
  receipt_footer                text,

  -- ภาษีและค่าบริการ (basis point: 700 = 7.00%) — ร้านเล็กหลายร้านไม่จด VAT
  vat_enabled                   boolean not null default false,
  vat_rate_bp                   integer not null default 700  check (vat_rate_bp between 0 and 10000),
  vat_inclusive                 boolean not null default true,
  service_charge_enabled        boolean not null default false,
  service_charge_rate_bp        integer not null default 1000 check (service_charge_rate_bp between 0 and 10000),

  -- เวลานั่ง (ค่า default ระดับร้าน — แพ็กเกจแต่ละตัว override ได้)
  default_dining_minutes        integer not null default 90  check (default_dining_minutes between 15 and 480),
  last_order_minutes_before_end integer not null default 15  check (last_order_minutes_before_end >= 0),

  -- ข้อ ⑤: เพดานการสั่ง ปรับได้จากหน้าผู้จัดการ ไม่ต้อง deploy ใหม่
  max_qty_per_item              integer not null default 10 check (max_qty_per_item between 1 and 999),
  max_items_per_order           integer not null default 30 check (max_items_per_order between 1 and 999),
  max_units_per_order           integer not null default 60 check (max_units_per_order between 1 and 9999),
  min_seconds_between_orders    integer not null default 30 check (min_seconds_between_orders >= 0),
  max_unserved_orders_per_visit integer not null default 5  check (max_unserved_orders_per_visit between 1 and 99),

  -- ข้อ ⑤: เพดานการลองรหัสเข้าโต๊ะ (กัน brute-force รหัส 6 หลัก)
  qr_max_failed_attempts        integer not null default 5  check (qr_max_failed_attempts between 1 and 99),
  qr_attempt_window_minutes     integer not null default 15 check (qr_attempt_window_minutes between 1 and 1440),
  qr_max_devices_per_visit      integer not null default 12 check (qr_max_devices_per_visit between 1 and 99),

  -- แต้มสะสม: ใช้เงินกี่บาทได้ 1 แต้ม
  points_baht_per_point         integer not null default 100 check (points_baht_per_point > 0),
  points_enabled                boolean not null default true,

  -- ชำระเงิน
  payment_mode                  payment_mode not null default 'mock',
  promptpay_id                  text,

  timezone                      text not null default 'Asia/Bangkok',
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger trg_restaurant_settings_updated_at before update on restaurant_settings
  for each row execute function set_updated_at();

-- ── พนักงาน ─────────────────────────────────────────────────────────────────
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  branch_id   uuid not null references branches(id),
  full_name   text not null,
  role        staff_role not null default 'staff',
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_profiles_branch_active on profiles(branch_id) where is_active;
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- ── สถานีครัว ───────────────────────────────────────────────────────────────
-- ใช้ route ออเดอร์ไปจอครัวที่ถูกจุด (ครัวเนื้อ / ครัวผัก / ครัวทอด / บาร์น้ำ)
create table kitchen_stations (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  code        text not null,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (branch_id, code)
);
create trigger trg_kitchen_stations_updated_at before update on kitchen_stations
  for each row execute function set_updated_at();

-- ── ตัวนับรายวัน (เลขคิว / เลขใบเสร็จ) ──────────────────────────────────────
-- ใช้ RPC next_counter() ที่ล็อกแถวเพื่อกันเลขชนกันเมื่อมีหลายเครื่องพร้อมกัน
create table daily_counters (
  branch_id     uuid not null references branches(id) on delete cascade,
  counter_key   text not null,           -- 'queue_ticket' | 'receipt' | 'visit_code'
  counter_date  date not null,
  current_value integer not null default 0 check (current_value >= 0),
  primary key (branch_id, counter_key, counter_date)
);

-- ── Audit log ───────────────────────────────────────────────────────────────
-- ร้านจริงต้องตอบได้ว่า ใครยกเลิกออเดอร์ ใครแก้ราคา ใครคืนเงิน ใครปิดบิล
create table audit_logs (
  id          bigserial primary key,
  branch_id   uuid references branches(id) on delete set null,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_role  staff_role,
  action      text not null,             -- 'visit.void' | 'menu_item.price_change' | ...
  entity      text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);
create index idx_audit_logs_entity  on audit_logs(entity, entity_id, created_at desc);
create index idx_audit_logs_created on audit_logs(branch_id, created_at desc);

-- ── helper: บันทึก audit จากภายใน RPC ───────────────────────────────────────
create or replace function log_audit(
  p_action  text,
  p_entity  text,
  p_entity_id text,
  p_before  jsonb default null,
  p_after   jsonb default null,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_role   staff_role;
begin
  select branch_id, role into v_branch, v_role from profiles where id = auth.uid();

  insert into audit_logs (branch_id, actor_id, actor_role, action, entity, entity_id, before, after, reason)
  values (v_branch, auth.uid(), v_role, p_action, p_entity, p_entity_id, p_before, p_after, p_reason);
end;
$$;
