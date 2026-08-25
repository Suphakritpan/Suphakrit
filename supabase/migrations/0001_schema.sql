-- ═══════════════════════════════════════════════════════════════════════════
-- SHABU MOOD — Production Database v1
-- 0001: Extensions, Enums, Tables, Indexes
--
-- หลักการออกแบบ 3 ข้อที่ทุกตารางยึดตาม
--   1. บุฟเฟต์คิดเงิน "ต่อคน" → ราคามาจาก visit_guests ไม่ใช่ order_items
--   2. Snapshot ราคา ณ เวลาเปิดโต๊ะ → ร้านขึ้นราคาแล้วบิลเก่าไม่เพี้ยน
--   3. เผื่อหลายสาขาไว้ตั้งแต่ต้น → ทุกตารางหลักมี branch_id
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─── ENUMS ─────────────────────────────────────────────────────────────────

create type table_status      as enum ('AVAILABLE', 'OCCUPIED', 'CLEANING', 'RESERVED', 'INACTIVE');
create type visit_status      as enum ('OPEN', 'BILLING', 'COMPLETED', 'CANCELLED');
create type queue_status      as enum ('WAITING', 'CALLED', 'SEATED', 'NO_SHOW', 'CANCELLED');
create type order_status      as enum ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVING', 'SERVED', 'CANCELLED');
create type order_item_status as enum ('PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');
create type payment_method    as enum ('CASH', 'TRANSFER', 'CARD', 'QR_PROMPTPAY');
create type payment_status    as enum ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'VOIDED');
create type staff_role        as enum ('ADMIN', 'MANAGER', 'STAFF', 'KITCHEN', 'CASHIER');
create type addon_unit        as enum ('PER_PERSON', 'PER_VISIT');
create type discount_type     as enum ('PERCENT', 'AMOUNT');
create type point_txn_type    as enum ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST');
create type call_reason       as enum ('SERVICE', 'BILL', 'REFILL', 'OTHER');
create type call_status       as enum ('PENDING', 'ACKNOWLEDGED', 'DONE', 'CANCELLED');
create type order_placed_by   as enum ('CUSTOMER', 'STAFF');
create type payment_line_type as enum ('BUFFET', 'ADDON', 'EXTRA_ITEM', 'DISCOUNT', 'SERVICE_CHARGE', 'VAT');

-- ─── 1. BRANCHES ───────────────────────────────────────────────────────────
-- ตอนนี้มีสาขาเดียว แต่ใส่ไว้ตั้งแต่ต้นเพราะเพิ่มทีหลังต้องรื้อ FK ทั้งระบบ

create table branches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  address     text,
  -- ค่าธรรมเนียม/ภาษี เก็บระดับสาขา เพราะแต่ละสาขาอาจตั้งไม่เท่ากัน
  service_charge_rate numeric(5,4) not null default 0 check (service_charge_rate between 0 and 1),
  vat_rate            numeric(5,4) not null default 0 check (vat_rate between 0 and 1),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── 2. STAFF ──────────────────────────────────────────────────────────────
-- ผูกกับ auth.users ของ Supabase — พนักงานล็อกอินด้วย email/password

create table staff (
  id            uuid primary key references auth.users(id) on delete cascade,
  branch_id     uuid not null references branches(id) on delete restrict,
  employee_code text not null,
  full_name     text not null,
  role          staff_role not null default 'STAFF',
  phone         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (branch_id, employee_code)
);

create index staff_branch_idx on staff (branch_id) where is_active;

-- ─── 3. CUSTOMERS ──────────────────────────────────────────────────────────
-- เฉพาะลูกค้าที่สมัครสมาชิก ลูกค้าทั่วไปสั่งอาหารได้โดยไม่ต้องมีแถวในตารางนี้

create table customers (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text unique,
  email       text,
  birth_date  date,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ─── 4. DINING TABLES ──────────────────────────────────────────────────────
-- ตั้งชื่อ dining_tables แทน tables เพราะ "tables" ชนกับศัพท์ระบบใน SQL
-- อ่านโค้ดแล้วสับสนง่ายมากเวลา join

create table dining_tables (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branches(id) on delete restrict,
  table_code text not null,
  zone       text,
  seats      smallint not null default 4 check (seats > 0),
  status     table_status not null default 'AVAILABLE',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, table_code)
);

create index dining_tables_status_idx on dining_tables (branch_id, status) where is_active;

-- ─── 5. BUFFET PACKAGES ────────────────────────────────────────────────────
-- ห้ามฝัง 299 / 399 ลงใน code — Admin ต้องแก้ราคาเองได้

create table buffet_packages (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete restrict,
  name        text not null,
  price       numeric(10,2) not null check (price >= 0),
  description text,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (branch_id, name)
);

-- ─── 6. ADDONS ─────────────────────────────────────────────────────────────
-- น้ำรีฟิล 39 คิดต่อคน / ของบางอย่างคิดต่อโต๊ะ → แยกด้วย unit

create table addons (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branches(id) on delete restrict,
  name       text not null,
  price      numeric(10,2) not null check (price >= 0),
  unit       addon_unit not null default 'PER_PERSON',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name)
);

-- ─── 7. QUEUE TICKETS ──────────────────────────────────────────────────────

create table queue_tickets (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete restrict,
  queue_number  integer not null,
  queue_date    date not null default current_date,
  party_size    smallint not null check (party_size > 0),
  customer_name text,
  phone         text,
  status        queue_status not null default 'WAITING',
  called_at     timestamptz,
  seated_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- เลขคิวรีเซ็ตทุกวัน ไม่ใช่ running number ตลอดกาล
  unique (branch_id, queue_date, queue_number)
);

create index queue_waiting_idx on queue_tickets (branch_id, queue_date, status);

-- ─── 8. VISITS ─────────────────────────────────────────────────────────────
-- หัวใจของระบบ — 1 visit = ลูกค้า 1 กลุ่ม นั่ง 1 โต๊ะ 1 รอบ
-- access_token คือสิ่งที่ฝังใน QR ลูกค้าไม่ต้องล็อกอินก็สั่งอาหารได้

create table visits (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branches(id) on delete restrict,
  table_id        uuid not null references dining_tables(id) on delete restrict,
  queue_ticket_id uuid references queue_tickets(id) on delete set null,
  customer_id     uuid references customers(id) on delete set null,  -- null = ลูกค้าไม่ได้เป็นสมาชิก

  visit_code   text not null,
  access_token text not null default encode(gen_random_bytes(16), 'hex'),

  status     visit_status not null default 'OPEN',
  party_size smallint not null check (party_size > 0),

  -- ยอดเงินคำนวณจาก visit_guests + visit_addons โดย trigger ไม่ใช่ให้ client ส่งมา
  subtotal        numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  service_charge  numeric(10,2) not null default 0,
  vat_amount      numeric(10,2) not null default 0,
  total_amount    numeric(10,2) not null default 0,

  promotion_id uuid,
  note         text,

  opened_by uuid references staff(id) on delete set null,
  closed_by uuid references staff(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (branch_id, visit_code),
  unique (access_token)
);

-- 1 โต๊ะเปิด visit ที่ยัง OPEN ได้ครั้งละ 1 เท่านั้น — กันเปิดบิลซ้อนโต๊ะเดียวกัน
create unique index visits_one_open_per_table_idx
  on visits (table_id) where status in ('OPEN', 'BILLING');

create index visits_active_idx  on visits (branch_id, status);
create index visits_customer_idx on visits (customer_id) where customer_id is not null;

-- ─── 9. VISIT GUESTS ───────────────────────────────────────────────────────
-- ตารางที่สำคัญที่สุดของระบบนี้
-- โต๊ะ 4 คนอาจเลือกแพ็กเกจไม่เหมือนกัน (299 / 299 / 399 / 299)
-- เก็บ snapshot ราคาไว้ ถ้าร้านขึ้นราคาเป็น 319 บิลเก่ายังถูกต้อง

create table visit_guests (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits(id) on delete cascade,
  guest_no          smallint not null check (guest_no > 0),
  buffet_package_id uuid not null references buffet_packages(id) on delete restrict,

  package_name  text not null,           -- snapshot
  unit_price    numeric(10,2) not null check (unit_price >= 0),  -- snapshot

  created_at timestamptz not null default now(),
  unique (visit_id, guest_no)
);

create index visit_guests_visit_idx on visit_guests (visit_id);

-- ─── 10. VISIT ADDONS ──────────────────────────────────────────────────────

create table visit_addons (
  id         uuid primary key default gen_random_uuid(),
  visit_id   uuid not null references visits(id) on delete cascade,
  addon_id   uuid not null references addons(id) on delete restrict,
  addon_name text not null,                                        -- snapshot
  unit_price numeric(10,2) not null check (unit_price >= 0),        -- snapshot
  -- สำหรับ addon แบบ PER_PERSON ให้ใส่ quantity = จำนวนคนที่สั่ง (น้ำรีฟิล 4 คน → 4)
  -- ยอดคิดเป็น unit_price * quantity เสมอ ไม่คูณ party_size ซ้ำอีกชั้น
  quantity   smallint not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (visit_id, addon_id)
);

create index visit_addons_visit_idx on visit_addons (visit_id);

-- ─── 11. MENU CATEGORIES ───────────────────────────────────────────────────

create table menu_categories (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branches(id) on delete restrict,
  name       text not null,
  image_url  text,
  sort_order smallint not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name)
);

-- ─── 12. MENU ITEMS ────────────────────────────────────────────────────────
-- ไม่มีคอลัมน์ price เพราะเป็นบุฟเฟต์ — อาหารรวมอยู่ในแพ็กเกจแล้ว
-- extra_price ไว้เผื่อของที่คิดเพิ่มจริง ๆ (เครื่องดื่มแอลกอฮอล์ ฯลฯ) ปกติ = 0

create table menu_items (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid not null references menu_categories(id) on delete restrict,
  name        text not null,
  description text,
  image_url   text,
  extra_price numeric(10,2) not null default 0 check (extra_price >= 0),
  max_per_order smallint check (max_per_order is null or max_per_order > 0),
  is_recommended boolean not null default false,
  is_available   boolean not null default true,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index menu_items_category_idx on menu_items (category_id) where is_available;

-- ─── 13. ORDERS ────────────────────────────────────────────────────────────

create table orders (
  id           uuid primary key default gen_random_uuid(),
  visit_id     uuid not null references visits(id) on delete cascade,
  order_number integer not null,                 -- เลขรอบที่สั่ง นับใหม่ทุก visit
  status       order_status not null default 'PENDING',
  placed_by    order_placed_by not null default 'CUSTOMER',
  placed_by_staff uuid references staff(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (visit_id, order_number)
);

create index orders_visit_idx  on orders (visit_id);
create index orders_kitchen_idx on orders (status, created_at)
  where status in ('CONFIRMED', 'PREPARING', 'READY');

-- ─── 14. ORDER ITEMS ───────────────────────────────────────────────────────
-- ไม่มี price / total เด็ดขาด — ตารางนี้บอกแค่ "ลูกค้าสั่งอะไรมา"
-- ราคาที่ต้องจ่ายมาจาก visit_guests + visit_addons เท่านั้น

create table order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete restrict,
  item_name    text not null,                    -- snapshot กันเมนูถูกลบ/เปลี่ยนชื่อ
  quantity     smallint not null default 1 check (quantity > 0),
  -- ปกติ = 0 เพราะอาหารรวมในบุฟเฟต์อยู่แล้ว
  -- ไม่ใช่ราคาอาหาร แต่เป็น snapshot ของ menu_items.extra_price สำหรับของที่คิดเพิ่มจริง ๆ
  extra_price  numeric(10,2) not null default 0 check (extra_price >= 0),
  note         text,
  status       order_item_status not null default 'PENDING',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index order_items_order_idx on order_items (order_id);

-- ─── 15. ORDER STATUS HISTORY ──────────────────────────────────────────────

create table order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  changed_by  uuid references staff(id) on delete set null,
  changed_at  timestamptz not null default now()
);

create index order_status_history_order_idx on order_status_history (order_id, changed_at);

-- ─── 16. STAFF CALLS ───────────────────────────────────────────────────────
-- ปุ่ม "เรียกพนักงาน" บนหน้าลูกค้า + ตัวเลข "เรียกพนักงาน 2" บน Staff Dashboard

create table staff_calls (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references visits(id) on delete cascade,
  table_id    uuid not null references dining_tables(id) on delete restrict,
  reason      call_reason not null default 'SERVICE',
  note        text,
  status      call_status not null default 'PENDING',
  resolved_by uuid references staff(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

create index staff_calls_pending_idx on staff_calls (status, created_at) where status = 'PENDING';

-- ─── 17. PROMOTIONS ────────────────────────────────────────────────────────

create table promotions (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references branches(id) on delete restrict,
  code           text not null,
  name           text not null,
  discount_type  discount_type not null,
  discount_value numeric(10,2) not null check (discount_value >= 0),
  min_amount     numeric(10,2) not null default 0,
  max_discount   numeric(10,2),
  starts_at      timestamptz,
  ends_at        timestamptz,
  usage_limit    integer,
  used_count     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (branch_id, code),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

alter table visits
  add constraint visits_promotion_fk
  foreign key (promotion_id) references promotions(id) on delete set null;

-- ─── 18. PAYMENTS ──────────────────────────────────────────────────────────
-- ตอนนี้เป็น Mock Gateway แต่โครงสร้างเหมือนของจริง เปลี่ยนไปต่อ Omise/GB Prime ได้เลย

create table payments (
  id             uuid primary key default gen_random_uuid(),
  visit_id       uuid not null references visits(id) on delete restrict,
  payment_number text not null unique,
  method         payment_method not null,
  status         payment_status not null default 'PENDING',

  amount          numeric(10,2) not null check (amount >= 0),
  received_amount numeric(10,2),
  change_amount   numeric(10,2),

  -- ของจริงต้องมี ไม่ใช่แค่ method + amount ไม่งั้นตรวจสอบย้อนหลังไม่ได้
  transaction_reference text,
  gateway_response      jsonb,
  card_last4            text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),

  cashier_id uuid references staff(id) on delete set null,
  paid_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_visit_idx on payments (visit_id);
create index payments_paid_idx  on payments (paid_at) where status = 'PAID';

-- ─── 19. PAYMENT ITEMS ─────────────────────────────────────────────────────
-- บรรทัดในใบเสร็จ — freeze ไว้ตอนจ่ายเงิน ต่อให้ข้อมูลต้นทางเปลี่ยนทีหลัง

create table payment_items (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references payments(id) on delete cascade,
  line_type   payment_line_type not null,
  description text not null,
  quantity    numeric(10,2) not null default 1,
  unit_price  numeric(10,2) not null default 0,
  amount      numeric(10,2) not null,
  sort_order  smallint not null default 0
);

create index payment_items_payment_idx on payment_items (payment_id, sort_order);

-- ─── 20. CUSTOMER POINTS ───────────────────────────────────────────────────
-- ยอดคงเหลือ ปรับโดย trigger จาก point_transactions เท่านั้น ห้ามเขียนตรง

create table customer_points (
  customer_id     uuid primary key references customers(id) on delete cascade,
  balance         integer not null default 0 check (balance >= 0),
  lifetime_earned integer not null default 0,
  updated_at      timestamptz not null default now()
);

-- ─── 21. POINT TRANSACTIONS ────────────────────────────────────────────────
-- Ledger — เป็น source of truth ของแต้ม

create table point_transactions (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete cascade,
  visit_id      uuid references visits(id) on delete set null,
  type          point_txn_type not null,
  points        integer not null,          -- EARN บวก / REDEEM ลบ
  balance_after integer not null,
  note          text,
  created_by    uuid references staff(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index point_txn_customer_idx on point_transactions (customer_id, created_at desc);

-- ─── 22. AUDIT LOGS ────────────────────────────────────────────────────────
-- ใครยกเลิก order / เปลี่ยนราคา / คืนเงิน / ปิดบิล

create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid references branches(id) on delete set null,
  actor_id    uuid references staff(id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz not null default now()
);

create index audit_logs_entity_idx on audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx  on audit_logs (actor_id, created_at desc);
