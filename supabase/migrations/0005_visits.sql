-- ============================================================================
-- 0005 — การใช้บริการ (visits), Add-on ที่เลือก, อุปกรณ์ที่สแกน QR
-- ============================================================================

-- ── ลูกค้า (สมาชิกด้วยเบอร์โทรอย่างเดียว ไม่ต้องล็อกอิน) ────────────────────
create table customers (
  id                  uuid primary key default gen_random_uuid(),
  branch_id           uuid not null references branches(id) on delete cascade,
  phone               text not null,
  first_name          text,
  last_name           text,
  birthdate           date,
  tier                customer_tier not null default 'bronze',

  -- ยอดสรุปแบบ denormalized — trigger เป็นคนอัปเดต ห้ามแก้มือ
  points_balance      integer not null default 0 check (points_balance >= 0),
  total_visits        integer not null default 0 check (total_visits >= 0),
  total_spend_satang  bigint  not null default 0 check (total_spend_satang >= 0),

  marketing_consent   boolean not null default false,
  notes               text,
  first_visit_at      timestamptz,
  last_visit_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (branch_id, phone)
);
create trigger trg_customers_updated_at before update on customers
  for each row execute function set_updated_at();

-- ── การใช้บริการ ────────────────────────────────────────────────────────────
create table visits (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  visit_code    text not null,                      -- เช่น A12-0825-03 (อ่านออกด้วยตา)
  table_id      uuid not null references tables(id) on delete restrict,
  customer_id   uuid references customers(id) on delete set null,

  -- ══ ข้อ ②: 1 Visit = 1 Buffet Package ═════════════════════════════════════
  -- ทั้งโต๊ะใช้แพ็กเกจเดียวกัน บังคับด้วย NOT NULL คอลัมน์เดียว
  -- v1 จงใจ "ไม่มี" ตาราง visit_guests เพื่อไม่ให้เกิดทางเลือกที่ขัดกันเอง
  -- ถ้าอนาคตต้องแยกรายคน ค่อยเพิ่ม visit_guests แล้วย้ายคอลัมน์ชุดนี้ไปเป็น default
  package_id    uuid not null references buffet_packages(id) on delete restrict,

  -- ข้อ ①: snapshot ราคา ณ เวลาที่เปิดโต๊ะ
  -- ถ้าร้านขึ้นราคา 299 → 319 พรุ่งนี้ บิลเก่ายังคำนวณด้วยราคาเดิมได้ถูกต้อง
  package_name_snapshot           text    not null,
  package_price_adult_satang      integer not null check (package_price_adult_satang >= 0),
  package_price_child_satang      integer not null check (package_price_child_satang >= 0),

  adult_count   integer not null default 1 check (adult_count  >= 0),
  child_count   integer not null default 0 check (child_count  >= 0),

  status        visit_status not null default 'open',

  opened_by     uuid references profiles(id) on delete set null,
  closed_by     uuid references profiles(id) on delete set null,
  check_in_at   timestamptz not null default now(),
  dining_deadline_at timestamptz not null,          -- ข้อจำกัดเวลา 90/120 นาที
  billed_at     timestamptz,
  paid_at       timestamptz,
  check_out_at  timestamptz,

  -- ทางเข้าของลูกค้า — ทั้งคู่ถูกล้างทิ้งตอนปิดบิล ทำให้ QR เดิมใช้ไม่ได้ทันที
  session_token uuid default gen_random_uuid(),
  access_code   text,                               -- 6 หลัก พิมพ์บนสลิป
  access_locked_until timestamptz,                  -- ข้อ ⑤ ล็อกเมื่อลองรหัสผิดเกินเพดาน

  -- ยอดสรุป ล็อกค่าตอนกดเช็คบิล (คำนวณโดย recalculate_visit_totals())
  subtotal_satang       integer not null default 0 check (subtotal_satang       >= 0),
  discount_satang       integer not null default 0 check (discount_satang       >= 0),
  service_charge_satang integer not null default 0 check (service_charge_satang >= 0),
  vat_satang            integer not null default 0 check (vat_satang            >= 0),
  total_satang          integer not null default 0 check (total_satang          >= 0),

  notes         text,
  void_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint chk_visit_has_guests check (adult_count + child_count >= 1),
  unique (branch_id, visit_code)
);

-- โต๊ะหนึ่งโต๊ะมี visit ที่ยังไม่ปิดได้แค่ใบเดียว — กันการเปิดซ้อนจากสองเครื่องพร้อมกัน
create unique index idx_visits_one_active_per_table
  on visits(table_id) where status in ('open', 'awaiting_payment', 'paid');

create unique index idx_visits_session_token on visits(session_token) where session_token is not null;
create index idx_visits_active   on visits(branch_id, status) where status in ('open', 'awaiting_payment');
create index idx_visits_customer on visits(customer_id, check_in_at desc);
create index idx_visits_checkin  on visits(branch_id, check_in_at desc);
create trigger trg_visits_updated_at before update on visits
  for each row execute function set_updated_at();

-- ผูก FK ที่ค้างไว้จาก 0004
alter table queue_tickets
  add constraint fk_queue_tickets_visit foreign key (visit_id) references visits(id) on delete set null;

-- ── Add-on ที่โต๊ะนี้เลือก ───────────────────────────────────────────────────
-- ══ ข้อ ①: น้ำรีฟิล 39 บาท มาจากตรงนี้ ไม่ใช่ค่าคงที่ในโค้ดคิดเงิน ═══════════
-- unit_price_satang เป็น snapshot ณ เวลาที่เลือก → ขึ้นราคาแล้วบิลเก่าไม่เพี้ยน
create table visit_addons (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits(id) on delete cascade,
  add_on_id         uuid not null references add_ons(id) on delete restrict,

  name_snapshot     text not null,
  unit_price_satang integer not null check (unit_price_satang >= 0),
  charge_basis      addon_charge_basis not null,
  quantity          integer not null check (quantity > 0),   -- per_person = จำนวนคนที่เอา

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (visit_id, add_on_id)
);
create index idx_visit_addons_visit on visit_addons(visit_id);
create trigger trg_visit_addons_updated_at before update on visit_addons
  for each row execute function set_updated_at();

-- ── อุปกรณ์ที่สแกน QR เข้ามา ────────────────────────────────────────────────
-- สะพานเชื่อม RLS: ผูก anonymous auth user เข้ากับ visit หนึ่งใบ
-- ทำให้ policy เขียนได้ว่า "เห็นเฉพาะ visit ที่เครื่องนี้ถูกผูกไว้"
create table visit_devices (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null references visits(id) on delete cascade,
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  nickname      text,
  user_agent    text,
  revoked_at    timestamptz,                       -- ตั้งค่าตอนปิดบิล
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (visit_id, auth_user_id)
);
create index idx_visit_devices_user on visit_devices(auth_user_id) where revoked_at is null;
create index idx_visit_devices_visit on visit_devices(visit_id);

-- ── ข้อ ⑤: บันทึกการพยายามเข้าโต๊ะ (กัน brute-force รหัส 6 หลัก) ────────────
create table visit_access_attempts (
  id           bigserial primary key,
  visit_id     uuid references visits(id) on delete cascade,
  table_id     uuid references tables(id) on delete cascade,
  auth_user_id uuid,
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);
create index idx_visit_access_attempts_recent
  on visit_access_attempts(visit_id, attempted_at desc) where not succeeded;
create index idx_visit_access_attempts_table
  on visit_access_attempts(table_id, attempted_at desc) where not succeeded;
