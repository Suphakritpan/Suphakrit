-- ###########################################################################
-- SHABU MOOD — ติดตั้งฐานข้อมูลทั้งหมดในไฟล์เดียว
--
-- ⚠️ สคริปต์นี้ "ล้างทุกอย่างใน schema public ทิ้ง" แล้วสร้างใหม่จากศูนย์
--    ใช้เมื่อต้องการเปลี่ยนจากดีไซน์เดิมมาเป็นชุดนี้เท่านั้น
--    ห้ามรันกับฐานข้อมูลที่มีข้อมูลจริงเด็ดขาด
--
-- วิธีใช้: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
--
-- หลังรันเสร็จ ต้องทำอีก 2 อย่าง
--   1) Authentication → Providers → เปิด "Anonymous sign-ins"
--      (ลูกค้าที่สแกน QR ต้องใช้ เพื่อให้ได้ Realtime และ RLS)
--   2) สร้างผู้ใช้พนักงานคนแรก แล้วรัน seed_dev_staff.sql เพื่อผูก role
-- ###########################################################################

-- ── ล้าง schema public ทั้งหมด แล้วคืนสิทธิ์มาตรฐานของ Supabase ────────────
drop schema if exists public cascade;
create schema public;

grant usage  on schema public to postgres, anon, authenticated, service_role;
grant all    on schema public to postgres, service_role;

alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

comment on schema public is 'standard public schema';

-- ###########################################################################
-- >>> migrations\0001_extensions_enums.sql
-- ###########################################################################

-- ============================================================================
-- 0001 — Extensions และ ENUM ทั้งหมด
-- ระบบร้านชาบูบุฟเฟต์ Shabu Mood
-- ----------------------------------------------------------------------------
-- หลักการที่ยึดทั้งฐานข้อมูล:
--   1. เงินเก็บเป็น "สตางค์" (integer) เสมอ คอลัมน์ลงท้าย _satang — ห้ามใช้ float
--   2. ราคาและอัตราทุกตัวมาจากตารางตั้งค่า ไม่ hardcode ในโค้ด
--   3. กฎทางธุรกิจบังคับที่ชั้น DB (constraint + trigger + RPC) ไม่ใช่แค่ใน UI
--   4. เวลาใช้ timestamptz เสมอ แสดงผลตาม timezone ใน restaurant_settings
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid(), digest()
create extension if not exists citext;     -- อีเมล/รหัสที่ไม่สนตัวพิมพ์เล็กใหญ่

-- ── บทบาทพนักงาน ────────────────────────────────────────────────────────────
create type staff_role as enum ('owner', 'manager', 'staff', 'kitchen', 'cashier');

-- ── สถานะโต๊ะ ───────────────────────────────────────────────────────────────
-- ข้อ ④: วงจรของโต๊ะต้องแยกจากวงจรของ visit ให้ชัด
--   available → occupied → cleaning → available
create type table_status as enum ('available', 'occupied', 'cleaning', 'reserved', 'disabled');

-- ── สถานะการใช้บริการ (visit) ───────────────────────────────────────────────
-- ข้อ ④: PAID กับ CLOSED ต้องเป็นคนละสถานะ
--   open             = กำลังนั่งกิน สั่งอาหารได้
--   awaiting_payment = กดเช็คบิลแล้ว ล็อกยอด หยุดสั่งเพิ่ม
--   paid             = ชำระครบแล้ว แต่ลูกค้าอาจยังนั่งอยู่ที่โต๊ะ
--   closed           = ปิดรอบเรียบร้อย ออกใบเสร็จแล้ว ลูกค้าลุกจากโต๊ะ → โต๊ะไป cleaning
--   void             = ยกเลิกบิล (ต้องมีเหตุผลและถูกบันทึกลง audit_logs)
create type visit_status as enum ('open', 'awaiting_payment', 'paid', 'closed', 'void');

-- ── สถานะออเดอร์ ────────────────────────────────────────────────────────────
-- ตรงกับที่ออกแบบไว้: รอรับออเดอร์ → กำลังทำ → พร้อมเสิร์ฟ → เสิร์ฟแล้ว
-- สถานะจริงอยู่ที่ "รายจาน" (order_items) เพราะครัวคนละสถานีเสร็จไม่พร้อมกัน
-- ส่วน orders.status เป็นค่า rollup ที่ trigger คำนวณให้
create type order_status as enum ('pending', 'preparing', 'ready', 'served', 'cancelled');

-- ── คิวหน้าร้าน ─────────────────────────────────────────────────────────────
create type queue_status as enum ('waiting', 'called', 'seated', 'cancelled', 'no_show');

-- ── การเรียกพนักงาน ─────────────────────────────────────────────────────────
create type service_request_type as enum
  ('call_staff', 'request_bill', 'refill_water', 'clean_table', 'other');
create type service_request_status as enum ('open', 'acknowledged', 'done', 'cancelled');

-- ── การชำระเงิน ─────────────────────────────────────────────────────────────
-- แยก transfer (โอนแล้วส่งสลิปให้พนักงานตรวจ) ออกจาก qr_promptpay
-- (สแกน QR ที่ระบบสร้างให้ ยอดถูกฝังใน QR อยู่แล้ว) เพราะเป็นคนละขั้นตอนหน้างาน
create type payment_method as enum ('cash', 'transfer', 'card', 'qr_promptpay');
create type payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled', 'refunded');
-- provider แยกจาก method เพื่อให้สลับไป gateway จริงได้โดยไม่ต้องแก้ข้อมูลเก่า
create type payment_provider as enum ('mock_cash', 'mock_promptpay', 'mock_card');
create type payment_mode as enum ('mock', 'live');

-- ── บิล ─────────────────────────────────────────────────────────────────────
create type bill_line_kind as enum
  ('buffet_adult', 'buffet_child', 'add_on', 'a_la_carte', 'discount', 'service_charge', 'vat');

-- ── Add-on ──────────────────────────────────────────────────────────────────
-- ข้อ ①: น้ำรีฟิล 39 บาท เป็น "ข้อมูล" ไม่ใช่ค่าคงที่ในโค้ด
--   per_person = คิดตามจำนวนคนที่เลือก (เช่น น้ำรีฟิล)
--   per_visit  = คิดครั้งเดียวทั้งโต๊ะ
create type addon_charge_basis as enum ('per_person', 'per_visit');

-- ── โปรโมชั่นและแต้ม ────────────────────────────────────────────────────────
create type promotion_type as enum ('percent', 'fixed', 'free_addon');
create type promotion_scope as enum ('bill', 'buffet', 'a_la_carte');
create type loyalty_txn_type as enum ('earn', 'redeem', 'adjust', 'expire');
create type customer_tier as enum ('bronze', 'silver', 'gold');

-- ###########################################################################
-- >>> migrations\0002_core_config.sql
-- ###########################################################################

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

-- ###########################################################################
-- >>> migrations\0003_menu_packages.sql
-- ###########################################################################

-- ============================================================================
-- 0003 — แพ็กเกจบุฟเฟต์, Add-on, เมนู และการล็อกเมนูตามแพ็กเกจ
-- ============================================================================

-- ── แพ็กเกจบุฟเฟต์ ──────────────────────────────────────────────────────────
-- ข้อ ①: 299 / 399 เป็นข้อมูลในตาราง ไม่ใช่ค่าคงที่ในโค้ด
-- เจ้าของร้านขึ้นราคาหรือเพิ่มแพ็กเกจใหม่ได้เองจากหน้าผู้จัดการ โดยไม่ต้อง deploy
create table buffet_packages (
  id                      uuid primary key default gen_random_uuid(),
  branch_id               uuid not null references branches(id) on delete cascade,
  code                    text not null,
  name                    text not null,
  description             text,

  price_per_adult_satang  integer not null check (price_per_adult_satang >= 0),
  price_per_child_satang  integer not null default 0 check (price_per_child_satang >= 0),
  child_max_age           integer check (child_max_age between 0 and 25),

  -- เวลานั่งของแพ็กเกจนี้ (null = ใช้ค่า default ของร้าน)
  dining_minutes          integer check (dining_minutes between 15 and 480),

  color                   text,      -- ใช้แยกสีบนผังโต๊ะ
  sort_order              integer not null default 0,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (branch_id, code)
);
create index idx_buffet_packages_active on buffet_packages(branch_id, sort_order) where is_active;
create trigger trg_buffet_packages_updated_at before update on buffet_packages
  for each row execute function set_updated_at();

-- ── Add-on ──────────────────────────────────────────────────────────────────
-- ข้อ ①: "น้ำรีฟิล +39" อยู่ตรงนี้ที่เดียว การคิดเงินต้องอ่านราคาจากตารางนี้เสมอ
-- โครงสร้างเผื่อ add-on อื่นในอนาคตได้ทันที เช่น ชีส +49 / ไอศกรีม +29
create table add_ons (
  id                      uuid primary key default gen_random_uuid(),
  branch_id               uuid not null references branches(id) on delete cascade,
  code                    text not null,
  name                    text not null,
  description             text,
  price_satang            integer not null check (price_satang >= 0),
  charge_basis            addon_charge_basis not null default 'per_person',
  sort_order              integer not null default 0,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (branch_id, code)
);
create trigger trg_add_ons_updated_at before update on add_ons
  for each row execute function set_updated_at();

-- ── หมวดเมนู ────────────────────────────────────────────────────────────────
create table menu_categories (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  code        text not null,
  name_th     text not null,
  name_en     text,
  icon        text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (branch_id, code)
);
create trigger trg_menu_categories_updated_at before update on menu_categories
  for each row execute function set_updated_at();

-- ── เมนูอาหาร ───────────────────────────────────────────────────────────────
-- แยกให้ชัด: menu_items คือ "รายการที่สั่งได้" ไม่ใช่ "ตัวกำหนดราคา"
-- ของที่รวมในบุฟเฟต์ราคาเป็น 0 — ราคาจริงมาจากแพ็กเกจ × จำนวนคน
create table menu_items (
  id                      uuid primary key default gen_random_uuid(),
  branch_id               uuid not null references branches(id) on delete cascade,
  category_id             uuid not null references menu_categories(id) on delete restrict,
  station_id              uuid references kitchen_stations(id) on delete set null,

  name_th                 text not null,
  name_en                 text,
  description             text,
  image_url               text,

  -- true  = รวมในบุฟเฟต์ ไม่คิดเงินเพิ่ม (a_la_carte_price_satang ต้องเป็น null)
  -- false = สั่งพิเศษ คิดเงินเพิ่ม     (a_la_carte_price_satang ต้องมีค่า)
  is_included_in_buffet   boolean not null default true,
  a_la_carte_price_satang integer check (a_la_carte_price_satang >= 0),

  is_available            boolean not null default true,   -- ปุ่ม "ของหมด" หน้าครัว
  prep_minutes            integer not null default 5 check (prep_minutes >= 0),
  sort_order              integer not null default 0,
  tags                    text[] not null default '{}',    -- เผ็ด / ซีฟู้ด / มังสวิรัติ
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- บังคับให้ราคาสอดคล้องกับประเภทเมนู กันข้อมูลขัดแย้งตั้งแต่ระดับ DB
  constraint chk_menu_item_pricing check (
    (is_included_in_buffet and a_la_carte_price_satang is null)
    or (not is_included_in_buffet and a_la_carte_price_satang is not null)
  )
);
create index idx_menu_items_category  on menu_items(branch_id, category_id, sort_order);
create index idx_menu_items_available on menu_items(branch_id) where is_available;
create index idx_menu_items_station   on menu_items(station_id);
create trigger trg_menu_items_updated_at before update on menu_items
  for each row execute function set_updated_at();

-- ── ล็อกเมนูตามแพ็กเกจ ──────────────────────────────────────────────────────
-- เมนูพรีเมียม (เนื้อวากิว ซีฟู้ด) สั่งได้เฉพาะแพ็กเกจ 399
-- ใช้ตารางเชื่อมแทน min_package_id เพราะแพ็กเกจไม่จำเป็นต้องเรียงลำดับราคาเสมอ
-- กติกา: เมนูที่ "ไม่มีแถวเลย" ในตารางนี้ = สั่งได้ทุกแพ็กเกจ
create table menu_item_packages (
  menu_item_id  uuid not null references menu_items(id) on delete cascade,
  package_id    uuid not null references buffet_packages(id) on delete cascade,
  primary key (menu_item_id, package_id)
);
create index idx_menu_item_packages_package on menu_item_packages(package_id);

comment on table menu_item_packages is
  'เมนูที่ไม่มีแถวในตารางนี้ = สั่งได้ทุกแพ็กเกจ; ถ้ามีแถว = สั่งได้เฉพาะแพ็กเกจที่ระบุ';

-- ###########################################################################
-- >>> migrations\0004_floor_queue.sql
-- ###########################################################################

-- ============================================================================
-- 0004 — โซน, โต๊ะ และคิวหน้าร้าน
-- ============================================================================

-- ── โซน ─────────────────────────────────────────────────────────────────────
create table zones (
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
create trigger trg_zones_updated_at before update on zones
  for each row execute function set_updated_at();

-- ── โต๊ะ ────────────────────────────────────────────────────────────────────
create table tables (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  zone_id       uuid references zones(id) on delete set null,
  table_number  text not null,
  capacity      integer not null check (capacity between 1 and 50),

  -- ข้อ ④: วงจรโต๊ะ available → occupied → cleaning → available
  -- บังคับลำดับด้วย trigger enforce_table_status_transition() ใน 0008
  status        table_status not null default 'available',

  -- QR สติกเกอร์ติดโต๊ะ (ถาวร) — ใช้เป็นทางเข้าสำรองคู่กับรหัส 6 หลักบนสลิป
  qr_token      uuid not null default gen_random_uuid(),

  position_x    numeric(6,2),   -- ตำแหน่งบนผังโต๊ะ
  position_y    numeric(6,2),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (branch_id, table_number)
);
create unique index idx_tables_qr_token on tables(qr_token);
create index idx_tables_status on tables(branch_id, status) where is_active;
create trigger trg_tables_updated_at before update on tables
  for each row execute function set_updated_at();

-- ── คิวหน้าร้าน ─────────────────────────────────────────────────────────────
create table queue_tickets (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branches(id) on delete cascade,
  ticket_number   integer not null,          -- รันรายวันผ่าน next_counter()
  ticket_date     date not null default (now() at time zone 'Asia/Bangkok')::date,

  party_size      integer not null check (party_size between 1 and 50),
  customer_name   text,
  phone           text,
  status          queue_status not null default 'waiting',
  notes           text,

  visit_id        uuid,                      -- เติมตอนจัดโต๊ะ (FK ผูกใน 0005)
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  called_at       timestamptz,
  seated_at       timestamptz,
  updated_at      timestamptz not null default now(),

  unique (branch_id, ticket_date, ticket_number)
);
create index idx_queue_tickets_waiting on queue_tickets(branch_id, ticket_date, ticket_number)
  where status in ('waiting', 'called');
create trigger trg_queue_tickets_updated_at before update on queue_tickets
  for each row execute function set_updated_at();

-- ###########################################################################
-- >>> migrations\0005_visits.sql
-- ###########################################################################

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

-- ###########################################################################
-- >>> migrations\0006_orders.sql
-- ###########################################################################

-- ============================================================================
-- 0006 — ออเดอร์, รายการอาหาร, ประวัติสถานะ และการเรียกพนักงาน
-- ============================================================================

-- ── ออเดอร์ (หนึ่ง "รอบ" ที่ลูกค้ากดยืนยัน) ─────────────────────────────────
create table orders (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits(id) on delete cascade,
  order_number      integer not null,                -- รอบที่ N ของ visit นี้

  -- ออเดอร์ต้องผูกกับ visit เสมอ และ visit ผูกกับโต๊ะ
  -- ลูกค้าจึงส่ง table_id เองไม่ได้ → กันการสั่งเข้าโต๊ะคนอื่นตั้งแต่โครงสร้าง
  placed_by_device_id uuid references visit_devices(id) on delete set null,
  placed_by_staff_id  uuid references profiles(id) on delete set null,

  status            order_status not null default 'pending',   -- rollup จาก order_items
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (visit_id, order_number)
);
create index idx_orders_visit  on orders(visit_id, order_number);
create index idx_orders_active on orders(status, created_at) where status <> 'served' and status <> 'cancelled';
create trigger trg_orders_updated_at before update on orders
  for each row execute function set_updated_at();

-- ── รายการอาหารในออเดอร์ ────────────────────────────────────────────────────
-- สถานะอยู่ที่ระดับ "รายจาน" เพราะครัวคนละสถานีทำเสร็จไม่พร้อมกัน
create table order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  menu_item_id      uuid not null references menu_items(id) on delete restrict,

  name_snapshot     text not null,                   -- ชื่อ ณ เวลาสั่ง (เมนูอาจถูกเปลี่ยนชื่อทีหลัง)
  station_id        uuid references kitchen_stations(id) on delete set null,

  -- ข้อ ⑤: เพดานจริงอ่านจาก restaurant_settings.max_qty_per_item ใน place_order()
  -- CHECK ตรงนี้เป็นแค่กันค่าเพี้ยนสุดโต่ง ไม่ใช่กฎทางธุรกิจ
  quantity          integer not null check (quantity between 1 and 999),

  -- ของที่รวมในบุฟเฟต์ = 0 สตางค์; ของสั่งพิเศษเก็บราคา snapshot ไว้
  is_buffet_included boolean not null default true,
  unit_price_satang  integer not null default 0 check (unit_price_satang >= 0),
  line_total_satang  integer not null default 0 check (line_total_satang >= 0),

  status            order_status not null default 'pending',
  note              text,
  cancelled_reason  text,

  started_at        timestamptz,
  ready_at          timestamptz,
  served_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint chk_order_item_buffet_price check (
    (is_buffet_included and unit_price_satang = 0 and line_total_satang = 0)
    or (not is_buffet_included and line_total_satang = unit_price_satang * quantity)
  )
);
create index idx_order_items_order   on order_items(order_id);
create index idx_order_items_station on order_items(station_id, status, created_at)
  where status in ('pending', 'preparing');
create index idx_order_items_menu    on order_items(menu_item_id);
create trigger trg_order_items_updated_at before update on order_items
  for each row execute function set_updated_at();

-- ── ประวัติการเปลี่ยนสถานะ ──────────────────────────────────────────────────
-- ตอบได้ว่าใครกดเปลี่ยนสถานะจานไหน เมื่อไหร่ ใช้ทั้งตรวจสอบและวัดเวลาทำอาหาร
create table order_status_history (
  id            bigserial primary key,
  order_item_id uuid not null references order_items(id) on delete cascade,
  from_status   order_status,
  to_status     order_status not null,
  changed_by    uuid references profiles(id) on delete set null,
  changed_at    timestamptz not null default now()
);
create index idx_order_status_history_item on order_status_history(order_item_id, changed_at);

-- ── การเรียกพนักงาน ─────────────────────────────────────────────────────────
create table service_requests (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null references visits(id) on delete cascade,
  table_id        uuid not null references tables(id) on delete cascade,
  type            service_request_type not null default 'call_staff',
  message         text,
  status          service_request_status not null default 'open',

  created_by_device_id uuid references visit_devices(id) on delete set null,
  acknowledged_by uuid references profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_service_requests_open on service_requests(table_id, created_at)
  where status in ('open', 'acknowledged');
create index idx_service_requests_visit on service_requests(visit_id, created_at desc);
create trigger trg_service_requests_updated_at before update on service_requests
  for each row execute function set_updated_at();

-- ข้อ ⑤: หนึ่ง visit เปิดคำร้องประเภทเดียวกันค้างไว้ได้แค่ใบเดียว
-- กันลูกค้ากดปุ่ม "เรียกพนักงาน" รัว ๆ จนท่วมหน้าจอพนักงาน
create unique index idx_service_requests_one_open_per_type
  on service_requests(visit_id, type) where status = 'open';

-- ###########################################################################
-- >>> migrations\0007_billing_payments.sql
-- ###########################################################################

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
  -- เลขใบเสร็จรันรายวัน ออกตอนชำระสำเร็จ — จ่ายแยกกันคนละใบก็ได้เลขคนละใบ
  receipt_number    integer,
  receipt_date      date,
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

-- ###########################################################################
-- >>> migrations\0008_functions_rpc.sql
-- ###########################################################################

-- ============================================================================
-- 0008 — Helper, State machine และ RPC ทั้งหมด
-- ----------------------------------------------------------------------------
-- ที่นี่คือที่ที่กฎทางธุรกิจถูก "บังคับ" จริง ๆ
-- endpoint ฝั่งลูกค้าถูกยิงตรงได้เสมอ กฎที่อยู่แค่ใน UI จึงข้ามได้หมด
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 1 — Helper สำหรับ RLS
-- ════════════════════════════════════════════════════════════════════════════

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active and role in ('owner', 'manager')
  );
$$;

create or replace function current_staff_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from profiles where id = auth.uid() and is_active;
$$;

-- visit ที่เครื่องนี้ถูกผูกไว้ (null ถ้าไม่ใช่เครื่องลูกค้า หรือถูกเพิกถอนแล้ว)
create or replace function current_visit_id()
returns uuid language sql stable security definer set search_path = public as $$
  select d.visit_id
  from visit_devices d
  join visits v on v.id = d.visit_id
  where d.auth_user_id = auth.uid()
    and d.revoked_at is null
    and v.status in ('open', 'awaiting_payment', 'paid')
  order by d.last_seen_at desc
  limit 1;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 2 — ตัวนับรายวัน
-- ════════════════════════════════════════════════════════════════════════════

create or replace function next_counter(p_branch_id uuid, p_key text, p_date date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_date  date;
  v_value integer;
begin
  v_date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);

  insert into daily_counters (branch_id, counter_key, counter_date, current_value)
  values (p_branch_id, p_key, v_date, 1)
  on conflict (branch_id, counter_key, counter_date)
  do update set current_value = daily_counters.current_value + 1
  returning current_value into v_value;

  return v_value;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 3 — ข้อ ④ State machine ของโต๊ะและ visit
-- ════════════════════════════════════════════════════════════════════════════

-- วงจรโต๊ะ: available → occupied → cleaning → available
create or replace function enforce_table_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'available' and new.status in ('occupied', 'reserved', 'cleaning', 'disabled'))
    or (old.status = 'occupied'  and new.status in ('cleaning', 'available'))
    or (old.status = 'cleaning'  and new.status in ('available', 'disabled'))
    or (old.status = 'reserved'  and new.status in ('occupied', 'available', 'disabled'))
    or (old.status = 'disabled'  and new.status in ('available'))
  ) then
    raise exception 'เปลี่ยนสถานะโต๊ะจาก % ไป % ไม่ได้', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_tables_status_transition
  before update of status on tables
  for each row execute function enforce_table_status_transition();

-- วงจร visit: open → awaiting_payment → paid → closed
-- แยก paid (จ่ายครบแล้ว ลูกค้าอาจยังนั่งอยู่) ออกจาก closed (ปิดรอบ ลุกจากโต๊ะแล้ว)
create or replace function enforce_visit_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'open'             and new.status in ('awaiting_payment', 'void'))
    or (old.status = 'awaiting_payment' and new.status in ('open', 'paid', 'void'))
    or (old.status = 'paid'             and new.status in ('closed', 'void'))
  ) then
    raise exception 'เปลี่ยนสถานะ visit จาก % ไป % ไม่ได้', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'void' and coalesce(new.void_reason, '') = '' then
    raise exception 'ยกเลิกบิลต้องระบุเหตุผล (void_reason)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_visits_status_transition
  before update of status on visits
  for each row execute function enforce_visit_status_transition();

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 4 — Rollup สถานะออเดอร์ + ประวัติการเปลี่ยนสถานะ
-- ════════════════════════════════════════════════════════════════════════════

-- orders.status = ความคืบหน้าที่ "ช้าที่สุด" ในบรรดาจานที่ยังไม่ถูกยกเลิก
create or replace function rollup_order_status()
returns trigger language plpgsql as $$
declare
  v_order_id uuid;
  v_new      order_status;
begin
  v_order_id := coalesce(new.order_id, old.order_id);

  select case
           when count(*) filter (where status <> 'cancelled') = 0 then 'cancelled'
           when count(*) filter (where status = 'pending')    > 0 then 'pending'
           when count(*) filter (where status = 'preparing')  > 0 then 'preparing'
           when count(*) filter (where status = 'ready')      > 0 then 'ready'
           else 'served'
         end::order_status
    into v_new
  from order_items where order_id = v_order_id;

  update orders set status = v_new where id = v_order_id and status <> v_new;
  return null;
end;
$$;

create trigger trg_order_items_rollup
  after insert or update of status or delete on order_items
  for each row execute function rollup_order_status();

create or replace function record_order_item_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  -- changed_by มี FK ไป profiles ซึ่งมีเฉพาะพนักงาน
  -- ลูกค้าที่สแกน QR เป็น anonymous user ที่ไม่มีแถวใน profiles
  -- ถ้าใส่ auth.uid() ตรง ๆ ออเดอร์ที่ "ลูกค้าสั่งเอง" จะติด FK แล้วพังทุกครั้ง
  -- จึงบันทึกเฉพาะเมื่อผู้กระทำเป็นพนักงานจริง ส่วนลูกค้าสั่งเองให้เป็น null
  insert into order_status_history (order_item_id, from_status, to_status, changed_by)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    (select p.id from profiles p where p.id = auth.uid())
  );

  return new;
end;
$$;

create trigger trg_order_items_history
  after insert or update of status on order_items
  for each row execute function record_order_item_history();

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 5 — เปิดโต๊ะ (ข้อ ① snapshot ราคา / ข้อ ② หนึ่ง visit หนึ่งแพ็กเกจ)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function open_visit(
  p_table_id         uuid,
  p_package_id       uuid,
  p_adult_count      integer,
  p_child_count      integer default 0,
  p_addons           jsonb   default '[]'::jsonb,   -- [{"add_on_id":"...","quantity":4}]
  p_queue_ticket_id  uuid    default null,
  p_customer_phone   text    default null
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_branch    uuid;
  v_table     public.tables;
  v_package   buffet_packages;
  v_settings  restaurant_settings;
  v_visit     visits;
  v_minutes   integer;
  v_seq       integer;
  v_code      text;
  v_customer  uuid;
  v_addon     jsonb;
  v_addon_row add_ons;
  v_qty       integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่เปิดโต๊ะได้' using errcode = '42501';
  end if;

  v_branch := current_staff_branch();

  select * into v_table from tables where id = p_table_id for update;
  if not found then
    raise exception 'ไม่พบโต๊ะที่ระบุ' using errcode = 'no_data_found';
  end if;
  if v_table.branch_id <> v_branch then
    raise exception 'โต๊ะนี้ไม่ได้อยู่ในสาขาของคุณ' using errcode = '42501';
  end if;
  if v_table.status <> 'available' then
    raise exception 'โต๊ะ % ยังไม่ว่าง (สถานะ %)', v_table.table_number, v_table.status
      using errcode = 'check_violation';
  end if;

  -- ข้อ ②: ต้องระบุแพ็กเกจเดียวเสมอ และต้องเป็นแพ็กเกจที่เปิดใช้อยู่
  select * into v_package from buffet_packages
   where id = p_package_id and branch_id = v_branch and is_active;
  if not found then
    raise exception 'ไม่พบแพ็กเกจบุฟเฟต์ที่เลือก หรือแพ็กเกจถูกปิดใช้งานแล้ว'
      using errcode = 'no_data_found';
  end if;

  if coalesce(p_adult_count, 0) + coalesce(p_child_count, 0) < 1 then
    raise exception 'ต้องมีลูกค้าอย่างน้อย 1 คน' using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_branch;

  -- ข้อ ①: เวลานั่งมาจากแพ็กเกจ ถ้าไม่ตั้งไว้ค่อยใช้ค่า default ของร้าน
  v_minutes := coalesce(v_package.dining_minutes, v_settings.default_dining_minutes);

  if p_customer_phone is not null and length(trim(p_customer_phone)) > 0 then
    insert into customers (branch_id, phone, first_visit_at, last_visit_at)
    values (v_branch, trim(p_customer_phone), now(), now())
    on conflict (branch_id, phone)
      do update set last_visit_at = now()
    returning id into v_customer;
  end if;

  v_seq  := next_counter(v_branch, 'visit_code');
  v_code := v_table.table_number || '-'
         || to_char(now() at time zone v_settings.timezone, 'MMDD') || '-'
         || lpad(v_seq::text, 3, '0');

  insert into visits (
    branch_id, visit_code, table_id, customer_id, package_id,
    package_name_snapshot, package_price_adult_satang, package_price_child_satang,
    adult_count, child_count, opened_by, dining_deadline_at, access_code
  ) values (
    v_branch, v_code, p_table_id, v_customer, p_package_id,
    v_package.name, v_package.price_per_adult_satang, v_package.price_per_child_satang,
    coalesce(p_adult_count, 0), coalesce(p_child_count, 0), auth.uid(),
    now() + make_interval(mins => v_minutes),
    lpad((floor(random() * 1000000))::int::text, 6, '0')
  ) returning * into v_visit;

  -- ข้อ ①: ราคา add-on มาจากตาราง add_ons ไม่ใช่ค่าคงที่ในโค้ด
  for v_addon in select * from jsonb_array_elements(coalesce(p_addons, '[]'::jsonb))
  loop
    select * into v_addon_row from add_ons
     where id = (v_addon->>'add_on_id')::uuid and branch_id = v_branch and is_active;
    if not found then
      raise exception 'ไม่พบ add-on ที่เลือก หรือถูกปิดใช้งานแล้ว' using errcode = 'no_data_found';
    end if;

    v_qty := coalesce((v_addon->>'quantity')::integer,
                      case when v_addon_row.charge_basis = 'per_person'
                           then v_visit.adult_count + v_visit.child_count else 1 end);

    if v_qty <= 0 then
      continue;
    end if;
    if v_addon_row.charge_basis = 'per_person'
       and v_qty > v_visit.adult_count + v_visit.child_count then
      raise exception 'จำนวน add-on "%" (%) มากกว่าจำนวนคนในโต๊ะ (%)',
        v_addon_row.name, v_qty, v_visit.adult_count + v_visit.child_count
        using errcode = 'check_violation';
    end if;

    insert into visit_addons (visit_id, add_on_id, name_snapshot, unit_price_satang, charge_basis, quantity)
    values (v_visit.id, v_addon_row.id, v_addon_row.name, v_addon_row.price_satang,
            v_addon_row.charge_basis, v_qty);
  end loop;

  update tables set status = 'occupied' where id = p_table_id;

  if p_queue_ticket_id is not null then
    update queue_tickets
       set status = 'seated', seated_at = now(), visit_id = v_visit.id
     where id = p_queue_ticket_id and status in ('waiting', 'called');
  end if;

  perform log_audit('visit.open', 'visits', v_visit.id::text, null, to_jsonb(v_visit));

  return v_visit;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 6 — ข้อ ⑤ เข้าโต๊ะผ่าน QR พร้อม rate limit
-- ════════════════════════════════════════════════════════════════════════════

create or replace function join_visit(
  p_session_token   uuid default null,
  p_table_qr_token  uuid default null,
  p_access_code     text default null,
  p_nickname        text default null,
  p_user_agent      text default null
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit     visits;
  v_table     public.tables;
  v_settings  restaurant_settings;
  v_fails     integer;
  v_devices   integer;
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบแบบไม่ระบุตัวตนก่อนสแกน QR' using errcode = '42501';
  end if;

  -- ทางเข้าที่ 1: QR บนสลิป (session token ต่อการมาใช้บริการหนึ่งครั้ง)
  if p_session_token is not null then
    select * into v_visit from visits where session_token = p_session_token;

  -- ทางเข้าที่ 2: QR สติกเกอร์ติดโต๊ะ + รหัส 6 หลักบนสลิป
  elsif p_table_qr_token is not null then
    select * into v_table from tables where qr_token = p_table_qr_token;
    if not found then
      raise exception 'QR ไม่ถูกต้อง' using errcode = 'no_data_found';
    end if;

    select * into v_visit from visits
     where table_id = v_table.id and status in ('open', 'awaiting_payment')
     order by check_in_at desc limit 1;

    if not found then
      insert into visit_access_attempts (table_id, auth_user_id, succeeded)
      values (v_table.id, auth.uid(), false);
      raise exception 'โต๊ะนี้ยังไม่ได้เปิดใช้บริการ กรุณาติดต่อพนักงาน'
        using errcode = 'no_data_found';
    end if;

    select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

    -- ล็อกอยู่หรือยัง
    if v_visit.access_locked_until is not null and v_visit.access_locked_until > now() then
      raise exception 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน'
        using errcode = '42501';
    end if;

    -- นับครั้งที่ผิดในช่วงเวลาที่กำหนด
    select count(*) into v_fails
    from visit_access_attempts
    where visit_id = v_visit.id
      and not succeeded
      and attempted_at > now() - make_interval(mins => v_settings.qr_attempt_window_minutes);

    if v_fails >= v_settings.qr_max_failed_attempts then
      update visits
         set access_locked_until = now() + make_interval(mins => v_settings.qr_attempt_window_minutes)
       where id = v_visit.id;
      raise exception 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน' using errcode = '42501';
    end if;

    if p_access_code is null or v_visit.access_code is distinct from trim(p_access_code) then
      insert into visit_access_attempts (visit_id, table_id, auth_user_id, succeeded)
      values (v_visit.id, v_table.id, auth.uid(), false);
      raise exception 'รหัสเข้าโต๊ะไม่ถูกต้อง' using errcode = '42501';
    end if;
  else
    raise exception 'ต้องระบุ session_token หรือ table_qr_token' using errcode = 'invalid_parameter_value';
  end if;

  if v_visit.id is null then
    raise exception 'QR นี้ใช้ไม่ได้แล้ว' using errcode = 'no_data_found';
  end if;

  -- QR ต้องตายทันทีที่ปิดบิล — ไม่งั้นลูกค้าโต๊ะเก่าสั่งเข้าบิลใหม่ได้
  if v_visit.status <> 'open' then
    raise exception 'รอบการใช้บริการนี้ปิดแล้ว ไม่สามารถสั่งอาหารได้'
      using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  -- ข้อ ⑤: จำกัดจำนวนเครื่องต่อหนึ่งโต๊ะ กัน token รั่วไปถูกใช้เป็นวงกว้าง
  select count(*) into v_devices
  from visit_devices where visit_id = v_visit.id and revoked_at is null;

  if v_devices >= v_settings.qr_max_devices_per_visit
     and not exists (select 1 from visit_devices
                      where visit_id = v_visit.id and auth_user_id = auth.uid()) then
    raise exception 'โต๊ะนี้มีอุปกรณ์เชื่อมต่อครบจำนวนแล้ว กรุณาติดต่อพนักงาน'
      using errcode = 'check_violation';
  end if;

  insert into visit_devices (visit_id, auth_user_id, nickname, user_agent)
  values (v_visit.id, auth.uid(), p_nickname, p_user_agent)
  on conflict (visit_id, auth_user_id)
    do update set last_seen_at = now(), revoked_at = null,
                  nickname = coalesce(excluded.nickname, visit_devices.nickname);

  insert into visit_access_attempts (visit_id, table_id, auth_user_id, succeeded)
  values (v_visit.id, v_visit.table_id, auth.uid(), true);

  return v_visit;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 7 — ข้อ ⑤ สั่งอาหาร พร้อมเพดานและกฎแพ็กเกจ
-- ════════════════════════════════════════════════════════════════════════════

create or replace function place_order(
  p_visit_id uuid,
  p_items    jsonb,          -- [{"menu_item_id":"...","quantity":2,"note":"ไม่ใส่ผัก"}]
  p_note     text default null
)
returns orders
language plpgsql security definer set search_path = public as $$
declare
  v_visit      visits;
  v_settings   restaurant_settings;
  v_order      orders;
  v_device     uuid;
  v_is_staff   boolean;
  v_item       jsonb;
  v_menu       menu_items;
  v_qty        integer;
  v_units      integer := 0;
  v_lines      integer := 0;
  v_seq        integer;
  v_last       timestamptz;
  v_unserved   integer;
  v_deadline   timestamptz;
begin
  v_is_staff := is_staff();

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  -- สิทธิ์: ต้องเป็นเครื่องที่ผูกกับ visit นี้ หรือเป็นพนักงาน
  if not v_is_staff then
    select id into v_device from visit_devices
     where visit_id = p_visit_id and auth_user_id = auth.uid() and revoked_at is null;
    if v_device is null then
      raise exception 'ไม่มีสิทธิ์สั่งอาหารเข้าโต๊ะนี้' using errcode = '42501';
    end if;
  end if;

  if v_visit.status <> 'open' then
    raise exception 'สั่งอาหารไม่ได้: รอบการใช้บริการอยู่ในสถานะ %', v_visit.status
      using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  -- จำกัดเวลา: หยุดรับออเดอร์ก่อนหมดเวลาตามกฎ last order
  v_deadline := v_visit.dining_deadline_at
                - make_interval(mins => v_settings.last_order_minutes_before_end);
  if now() > v_deadline and not v_is_staff then
    raise exception 'หมดเวลาสั่งอาหารแล้ว (สั่งได้ถึง %) กรุณาติดต่อพนักงาน',
      to_char(v_deadline at time zone v_settings.timezone, 'HH24:MI')
      using errcode = 'check_violation';
  end if;

  -- ข้อ ⑤: หน่วงเวลาระหว่างรอบ กันกดยืนยันรัว ๆ
  if not v_is_staff and v_settings.min_seconds_between_orders > 0 then
    select max(created_at) into v_last from orders where visit_id = p_visit_id;
    if v_last is not null
       and now() < v_last + make_interval(secs => v_settings.min_seconds_between_orders) then
      raise exception 'สั่งถี่เกินไป กรุณารอ % วินาทีแล้วลองใหม่',
        ceil(extract(epoch from (v_last + make_interval(secs => v_settings.min_seconds_between_orders)) - now()))
        using errcode = 'check_violation';
    end if;
  end if;

  -- ข้อ ⑤: กันสั่งค้างท่วมครัว
  if not v_is_staff then
    select count(*) into v_unserved from orders
     where visit_id = p_visit_id and status in ('pending', 'preparing', 'ready');
    if v_unserved >= v_settings.max_unserved_orders_per_visit then
      raise exception 'มีออเดอร์ที่ยังไม่ได้เสิร์ฟครบ % รอบแล้ว กรุณารออาหารชุดก่อนหน้า',
        v_settings.max_unserved_orders_per_visit
        using errcode = 'check_violation';
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'ยังไม่ได้เลือกรายการอาหาร' using errcode = 'invalid_parameter_value';
  end if;

  v_seq := coalesce((select max(order_number) from orders where visit_id = p_visit_id), 0) + 1;

  insert into orders (visit_id, order_number, placed_by_device_id, placed_by_staff_id, note)
  values (p_visit_id, v_seq, v_device, case when v_is_staff then auth.uid() end, p_note)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty   := coalesce((v_item->>'quantity')::integer, 0);
    v_lines := v_lines + 1;
    v_units := v_units + v_qty;

    if v_qty <= 0 then
      raise exception 'จำนวนต้องมากกว่า 0' using errcode = 'check_violation';
    end if;

    -- ข้อ ⑤: เพดานต่อเมนู อ่านจากการตั้งค่า ไม่ hardcode
    if v_qty > v_settings.max_qty_per_item then
      raise exception 'สั่งได้สูงสุด % ที่ต่อเมนูต่อรอบ', v_settings.max_qty_per_item
        using errcode = 'check_violation';
    end if;

    select * into v_menu from menu_items
     where id = (v_item->>'menu_item_id')::uuid and branch_id = v_visit.branch_id;
    if not found then
      raise exception 'ไม่พบเมนูที่เลือก' using errcode = 'no_data_found';
    end if;
    if not v_menu.is_available then
      raise exception 'เมนู "%" หมดแล้ว', v_menu.name_th using errcode = 'check_violation';
    end if;

    -- ข้อ ②: ล็อกเมนูตามแพ็กเกจของโต๊ะนี้
    -- เมนูที่ไม่มีแถวใน menu_item_packages เลย = สั่งได้ทุกแพ็กเกจ
    if exists (select 1 from menu_item_packages where menu_item_id = v_menu.id)
       and not exists (
         select 1 from menu_item_packages
         where menu_item_id = v_menu.id and package_id = v_visit.package_id
       ) then
      raise exception 'เมนู "%" สั่งได้เฉพาะแพ็กเกจอื่น ไม่รวมอยู่ในแพ็กเกจ "%"',
        v_menu.name_th, v_visit.package_name_snapshot
        using errcode = 'check_violation';
    end if;

    insert into order_items (
      order_id, menu_item_id, name_snapshot, station_id, quantity,
      is_buffet_included, unit_price_satang, line_total_satang, note
    ) values (
      v_order.id, v_menu.id, v_menu.name_th, v_menu.station_id, v_qty,
      v_menu.is_included_in_buffet,
      case when v_menu.is_included_in_buffet then 0 else v_menu.a_la_carte_price_satang end,
      case when v_menu.is_included_in_buffet then 0 else v_menu.a_la_carte_price_satang * v_qty end,
      nullif(trim(coalesce(v_item->>'note', '')), '')
    );
  end loop;

  -- ข้อ ⑤: เพดานรวมต่อหนึ่งรอบ
  if v_lines > v_settings.max_items_per_order then
    raise exception 'หนึ่งรอบสั่งได้ไม่เกิน % รายการ', v_settings.max_items_per_order
      using errcode = 'check_violation';
  end if;
  if v_units > v_settings.max_units_per_order then
    raise exception 'หนึ่งรอบสั่งได้ไม่เกิน % ที่รวมทุกเมนู', v_settings.max_units_per_order
      using errcode = 'check_violation';
  end if;

  return v_order;
end;
$$;

-- ── เดินสถานะรายจาน ─────────────────────────────────────────────────────────
create or replace function advance_order_item(p_item_id uuid, p_next order_status)
returns order_items
language plpgsql security definer set search_path = public as $$
declare
  v_item order_items;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_item from order_items where id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบรายการอาหาร' using errcode = 'no_data_found';
  end if;

  if not (
       (v_item.status = 'pending'   and p_next in ('preparing', 'cancelled'))
    or (v_item.status = 'preparing' and p_next in ('ready', 'cancelled'))
    or (v_item.status = 'ready'     and p_next in ('served', 'preparing'))
    or (v_item.status = 'served'    and p_next in ('ready'))
  ) then
    raise exception 'เปลี่ยนสถานะจาก % ไป % ไม่ได้', v_item.status, p_next
      using errcode = 'check_violation';
  end if;

  update order_items
     set status     = p_next,
         started_at = case when p_next = 'preparing' then coalesce(started_at, now()) else started_at end,
         ready_at   = case when p_next = 'ready'     then now() else ready_at end,
         served_at  = case when p_next = 'served'    then now() else served_at end
   where id = p_item_id
  returning * into v_item;

  return v_item;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 8 — ข้อ ① คำนวณบิลจากข้อมูลในฐานข้อมูลล้วน ๆ
-- ----------------------------------------------------------------------------
-- ฐานข้อมูลเป็นเจ้าของยอดที่ถูกต้อง (visits.total_satang) เพราะเป็นค่าที่
-- trigger กันจ่ายเกินใช้อ้างอิง ฝั่ง frontend คำนวณได้แต่ใช้เพื่อ "แสดงผล" เท่านั้น
-- ไม่มีตัวเลข 299 / 399 / 39 ปรากฏในฟังก์ชันนี้เลย — ทุกค่ามาจาก snapshot และตาราง
-- ════════════════════════════════════════════════════════════════════════════

create or replace function recalculate_visit_totals(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit     visits;
  v_settings  restaurant_settings;
  v_buffet    integer := 0;
  v_addons    integer := 0;
  v_alacarte  integer := 0;
  v_subtotal  integer := 0;
  v_discount  integer := 0;
  v_base      integer := 0;
  v_service   integer := 0;
  v_vat       integer := 0;
  v_total     integer := 0;
  v_sort      integer := 0;
  r           record;
begin
  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  delete from bill_lines where visit_id = p_visit_id;

  -- 1) ค่าบุฟเฟต์จาก snapshot ที่บันทึกตอนเปิดโต๊ะ
  v_buffet := v_visit.adult_count * v_visit.package_price_adult_satang
            + v_visit.child_count * v_visit.package_price_child_satang;

  if v_visit.adult_count > 0 then
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'buffet_adult',
            v_visit.package_name_snapshot || ' (ผู้ใหญ่)',
            v_visit.adult_count, v_visit.package_price_adult_satang,
            v_visit.adult_count * v_visit.package_price_adult_satang, v_sort);
  end if;

  if v_visit.child_count > 0 then
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'buffet_child',
            v_visit.package_name_snapshot || ' (เด็ก)',
            v_visit.child_count, v_visit.package_price_child_satang,
            v_visit.child_count * v_visit.package_price_child_satang, v_sort);
  end if;

  -- 2) Add-on — ราคามาจาก visit_addons ที่ snapshot จากตาราง add_ons
  for r in select * from visit_addons where visit_id = p_visit_id order by created_at
  loop
    v_addons := v_addons + r.unit_price_satang * r.quantity;
    v_sort   := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'add_on', r.name_snapshot, r.quantity, r.unit_price_satang,
            r.unit_price_satang * r.quantity, v_sort);
  end loop;

  -- 3) อาหารสั่งพิเศษที่ไม่รวมในบุฟเฟต์
  for r in
    select oi.name_snapshot, sum(oi.quantity) as qty, max(oi.unit_price_satang) as price,
           sum(oi.line_total_satang) as total
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.visit_id = p_visit_id
      and not oi.is_buffet_included
      and oi.status <> 'cancelled'
    group by oi.name_snapshot
  loop
    v_alacarte := v_alacarte + r.total;
    v_sort     := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'a_la_carte', r.name_snapshot, r.qty, r.price, r.total, v_sort);
  end loop;

  v_subtotal := v_buffet + v_addons + v_alacarte;

  -- 4) ส่วนลด
  select coalesce(sum(discount_satang), 0) into v_discount
  from visit_promotions where visit_id = p_visit_id;
  v_discount := least(v_discount, v_subtotal);

  for r in select * from visit_promotions where visit_id = p_visit_id
  loop
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'discount', r.name_snapshot, 1, -r.discount_satang, -r.discount_satang, v_sort);
  end loop;

  v_base := v_subtotal - v_discount;

  -- 5) Service charge
  if v_settings.service_charge_enabled and v_settings.service_charge_rate_bp > 0 then
    v_service := round(v_base::numeric * v_settings.service_charge_rate_bp / 10000)::integer;
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'service_charge',
            'Service Charge ' || (v_settings.service_charge_rate_bp / 100.0) || '%',
            1, v_service, v_service, v_sort);
  end if;

  -- 6) VAT — แยกกรณีราคารวมภาษีแล้ว กับกรณีบวกเพิ่ม
  if v_settings.vat_enabled and v_settings.vat_rate_bp > 0 then
    if v_settings.vat_inclusive then
      v_total := v_base + v_service;
      v_vat   := round((v_total::numeric * v_settings.vat_rate_bp)
                       / (10000 + v_settings.vat_rate_bp))::integer;
    else
      v_vat   := round((v_base + v_service)::numeric * v_settings.vat_rate_bp / 10000)::integer;
      v_total := v_base + v_service + v_vat;
    end if;

    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'vat',
            'VAT ' || (v_settings.vat_rate_bp / 100.0) || '%'
              || case when v_settings.vat_inclusive then ' (รวมในราคาแล้ว)' else '' end,
            1, v_vat, case when v_settings.vat_inclusive then 0 else v_vat end, v_sort);
  else
    v_total := v_base + v_service;
  end if;

  update visits
     set subtotal_satang       = v_subtotal,
         discount_satang       = v_discount,
         service_charge_satang = v_service,
         vat_satang            = v_vat,
         total_satang          = v_total
   where id = p_visit_id
  returning * into v_visit;

  return v_visit;
end;
$$;

-- ── กดเช็คบิล: ล็อกยอด หยุดรับออเดอร์ ───────────────────────────────────────
create or replace function request_visit_bill(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
begin
  select * into v_visit from visits where id = p_visit_id;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if not is_staff() and current_visit_id() is distinct from p_visit_id then
    raise exception 'ไม่มีสิทธิ์เช็คบิลโต๊ะนี้' using errcode = '42501';
  end if;

  if v_visit.status = 'open' then
    update visits set status = 'awaiting_payment', billed_at = now() where id = p_visit_id;
  end if;

  return recalculate_visit_totals(p_visit_id);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 9 — ข้อ ③ RPC การชำระเงิน (สร้าง / ยืนยัน / ยกเลิก)
-- ════════════════════════════════════════════════════════════════════════════

-- ยอดคงเหลือที่ยังต้องจ่าย
create or replace function visit_amount_due(p_visit_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select v.total_satang - coalesce(
    (select sum(p.amount_satang) from payments p
      where p.visit_id = v.id and p.status = 'succeeded'), 0)
  from visits v where v.id = p_visit_id;
$$;

create or replace function create_payment(
  p_visit_id  uuid,
  p_method    payment_method,
  p_amount_satang integer,
  p_tendered_satang integer default null,
  p_provider_ref text default null,
  p_payload   jsonb default null
)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_settings restaurant_settings;
  v_due      integer;
  v_provider payment_provider;
  v_payment  payments;
  v_change   integer := 0;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่รับชำระเงินได้' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if v_visit.status not in ('awaiting_payment', 'paid') then
    raise exception 'รับชำระเงินไม่ได้: ต้องกดเช็คบิลก่อน (สถานะปัจจุบัน %)', v_visit.status
      using errcode = 'check_violation';
  end if;

  if p_amount_satang <= 0 then
    raise exception 'ยอดชำระต้องมากกว่า 0' using errcode = 'check_violation';
  end if;

  -- ข้อ ③: กันจ่ายเกินตั้งแต่ตอนสร้างรายการ (trigger จะกันซ้ำอีกชั้นตอนยืนยัน)
  v_due := visit_amount_due(p_visit_id);
  if p_amount_satang > v_due then
    raise exception 'ยอดชำระ % สตางค์ เกินยอดคงเหลือ % สตางค์', p_amount_satang, v_due
      using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  v_provider := case p_method
                  when 'cash'         then 'mock_cash'
                  when 'transfer'     then 'mock_promptpay'
                  when 'qr_promptpay' then 'mock_promptpay'
                  when 'card'         then 'mock_card'
                end::payment_provider;

  -- เงินสดเท่านั้นที่ยื่นเกินได้ ส่วนที่เกินคือเงินทอน
  if p_method = 'cash' and p_tendered_satang is not null then
    if p_tendered_satang < p_amount_satang then
      raise exception 'เงินที่รับมา (%) น้อยกว่ายอดที่ต้องชำระ (%)', p_tendered_satang, p_amount_satang
        using errcode = 'check_violation';
    end if;
    v_change := p_tendered_satang - p_amount_satang;
  end if;

  insert into payments (
    visit_id, method, provider, amount_satang, tendered_satang, change_satang,
    status, provider_ref, provider_payload, processed_by
  ) values (
    p_visit_id, p_method, v_provider, p_amount_satang,
    case when p_method = 'cash' then p_tendered_satang end, v_change,
    'pending', p_provider_ref, p_payload, auth.uid()
  ) returning * into v_payment;

  perform log_audit('payment.create', 'payments', v_payment.id::text, null, to_jsonb(v_payment));

  return v_payment;
end;
$$;

create or replace function confirm_payment(
  p_payment_id   uuid,
  p_provider_ref text default null,
  p_payload      jsonb default null
)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
  v_before  jsonb;
  v_due     integer;
  v_branch  uuid;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบรายการชำระเงิน' using errcode = 'no_data_found';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'รายการนี้ถูกดำเนินการไปแล้ว (สถานะ %)', v_payment.status
      using errcode = 'check_violation';
  end if;

  v_before := to_jsonb(v_payment);

  select branch_id into v_branch from visits where id = v_payment.visit_id;

  -- trigger trg_payments_no_overpay จะตรวจยอดรวมอีกชั้นพร้อมล็อกแถว visit
  update payments
     set status = 'succeeded',
         provider_ref = coalesce(p_provider_ref, provider_ref),
         provider_payload = coalesce(p_payload, provider_payload),
         receipt_number = next_counter(v_branch, 'receipt'),
         receipt_date = (now() at time zone 'Asia/Bangkok')::date,
         completed_at = now()
   where id = p_payment_id
  returning * into v_payment;

  -- จ่ายครบแล้วจึงเลื่อน visit เป็น paid (ข้อ ④ — ยังไม่ใช่ closed)
  v_due := visit_amount_due(v_payment.visit_id);
  if v_due <= 0 then
    update visits set status = 'paid', paid_at = now()
     where id = v_payment.visit_id and status = 'awaiting_payment';
  end if;

  perform log_audit('payment.confirm', 'payments', v_payment.id::text, v_before, to_jsonb(v_payment));

  return v_payment;
end;
$$;

create or replace function cancel_payment(p_payment_id uuid, p_reason text default null)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
  v_before  jsonb;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบรายการชำระเงิน' using errcode = 'no_data_found';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'ยกเลิกได้เฉพาะรายการที่ยังรอดำเนินการ' using errcode = 'check_violation';
  end if;

  v_before := to_jsonb(v_payment);

  update payments
     set status = 'cancelled', failure_reason = p_reason, completed_at = now()
   where id = p_payment_id
  returning * into v_payment;

  perform log_audit('payment.cancel', 'payments', v_payment.id::text, v_before, to_jsonb(v_payment), p_reason);

  return v_payment;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 10 — ข้อ ④ ปิดรอบ และคืนโต๊ะให้ว่าง
-- ════════════════════════════════════════════════════════════════════════════

-- paid → closed, โต๊ะ occupied → cleaning, QR ตายทันที, ให้แต้มลูกค้า
create or replace function close_visit(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_settings restaurant_settings;
  v_points   integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if v_visit.status <> 'paid' then
    raise exception 'ปิดรอบไม่ได้: ต้องชำระเงินครบก่อน (สถานะปัจจุบัน %, คงเหลือ % สตางค์)',
      v_visit.status, visit_amount_due(p_visit_id)
      using errcode = 'check_violation';
  end if;

  update visits
     set status = 'closed',
         check_out_at = now(),
         closed_by = auth.uid(),
         session_token = null,        -- QR เดิมใช้ไม่ได้อีก
         access_code = null
   where id = p_visit_id
  returning * into v_visit;

  -- เพิกถอนอุปกรณ์ทุกเครื่องที่ผูกกับโต๊ะนี้
  update visit_devices set revoked_at = now()
   where visit_id = p_visit_id and revoked_at is null;

  -- ข้อ ④: โต๊ะไป cleaning ก่อน ยังไม่ว่างทันที
  update tables set status = 'cleaning' where id = v_visit.table_id;

  -- ปิดคำร้องที่ค้างอยู่
  update service_requests set status = 'done', resolved_at = now()
   where visit_id = p_visit_id and status in ('open', 'acknowledged');

  -- สะสมแต้มให้ลูกค้า (ถ้าผูกเบอร์ไว้)
  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;
  if v_settings.points_enabled and v_visit.customer_id is not null then
    v_points := floor((v_visit.total_satang / 100.0) / v_settings.points_baht_per_point)::integer;
    if v_points > 0 then
      insert into loyalty_transactions (customer_id, visit_id, type, points, note, created_by)
      values (v_visit.customer_id, p_visit_id, 'earn', v_points,
              'สะสมจากบิล ' || v_visit.visit_code, auth.uid());
    end if;

    update customers
       set total_visits = total_visits + 1,
           total_spend_satang = total_spend_satang + v_visit.total_satang,
           last_visit_at = now(),
           first_visit_at = coalesce(first_visit_at, now())
     where id = v_visit.customer_id;
  end if;

  perform log_audit('visit.close', 'visits', p_visit_id::text, null, to_jsonb(v_visit));

  return v_visit;
end;
$$;

-- ข้อ ④: cleaning → available (พนักงานกดเมื่อเก็บโต๊ะเสร็จ)
create or replace function mark_table_clean(p_table_id uuid)
returns public.tables
language plpgsql security definer set search_path = public as $$
declare
  v_table public.tables;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  update tables set status = 'available'
   where id = p_table_id and status = 'cleaning'
  returning * into v_table;

  if not found then
    raise exception 'โต๊ะนี้ไม่ได้อยู่ในสถานะรอทำความสะอาด' using errcode = 'check_violation';
  end if;

  perform log_audit('table.clean', 'tables', p_table_id::text, null, to_jsonb(v_table));
  return v_table;
end;
$$;

-- ── ปุ่ม "ของหมด" สำหรับพนักงานครัว ─────────────────────────────────────────
-- RLS จำกัดได้แค่ระดับแถว ไม่ใช่ระดับคอลัมน์ ถ้าให้ policy UPDATE กับพนักงานตรง ๆ
-- เขาจะแก้ราคาเมนูได้ด้วย จึงเปิดทางนี้ทางเดียวที่แตะได้เฉพาะ is_available
create or replace function set_menu_item_availability(p_menu_item_id uuid, p_available boolean)
returns menu_items
language plpgsql security definer set search_path = public as $$
declare
  v_item menu_items;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  update menu_items set is_available = p_available
   where id = p_menu_item_id and branch_id = current_staff_branch()
  returning * into v_item;

  if not found then
    raise exception 'ไม่พบเมนูที่ระบุ' using errcode = 'no_data_found';
  end if;

  perform log_audit(
    case when p_available then 'menu_item.restock' else 'menu_item.86' end,
    'menu_items', p_menu_item_id::text, null, jsonb_build_object('is_available', p_available));

  return v_item;
end;
$$;

-- ── ยกเลิกบิล (ต้องมีเหตุผล บันทึก audit เสมอ) ──────────────────────────────
create or replace function void_visit(p_visit_id uuid, p_reason text)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_before jsonb;
begin
  if not is_manager() then
    raise exception 'เฉพาะผู้จัดการเท่านั้นที่ยกเลิกบิลได้' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'ต้องระบุเหตุผลในการยกเลิกบิล' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  v_before := to_jsonb(v_visit);

  update visits
     set status = 'void', void_reason = p_reason, closed_by = auth.uid(),
         check_out_at = now(), session_token = null, access_code = null
   where id = p_visit_id
  returning * into v_visit;

  update visit_devices set revoked_at = now() where visit_id = p_visit_id and revoked_at is null;
  update tables set status = 'cleaning' where id = v_visit.table_id and status = 'occupied';

  perform log_audit('visit.void', 'visits', p_visit_id::text, v_before, to_jsonb(v_visit), p_reason);
  return v_visit;
end;
$$;

-- ###########################################################################
-- >>> migrations\0009_rls_realtime.sql
-- ###########################################################################

-- ============================================================================
-- 0009 — Row Level Security, สิทธิ์การเรียก RPC และ Realtime
-- ----------------------------------------------------------------------------
-- ผู้ใช้ที่ล็อกอินมีสองชนิด แยกด้วย helper จาก 0008
--   พนักงาน      → มีแถวใน profiles          → is_staff() / is_manager()
--   เครื่องลูกค้า → anonymous auth ที่ผูก visit → current_visit_id()
--
-- หลักการ: ลูกค้าเขียนข้อมูลตรง ๆ ไม่ได้เลย ต้องผ่าน RPC ที่ตรวจกฎครบก่อนเสมอ
-- ============================================================================

alter table branches              enable row level security;
alter table restaurant_settings   enable row level security;
alter table profiles              enable row level security;
alter table kitchen_stations      enable row level security;
alter table daily_counters        enable row level security;
alter table audit_logs            enable row level security;
alter table buffet_packages       enable row level security;
alter table add_ons               enable row level security;
alter table menu_categories       enable row level security;
alter table menu_items            enable row level security;
alter table menu_item_packages    enable row level security;
alter table zones                 enable row level security;
alter table tables                enable row level security;
alter table queue_tickets         enable row level security;
alter table customers             enable row level security;
alter table visits                enable row level security;
alter table visit_addons          enable row level security;
alter table visit_devices         enable row level security;
alter table visit_access_attempts enable row level security;
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table order_status_history  enable row level security;
alter table service_requests      enable row level security;
alter table promotions            enable row level security;
alter table visit_promotions      enable row level security;
alter table bill_lines            enable row level security;
alter table payments              enable row level security;
alter table loyalty_transactions  enable row level security;

-- ════════════════════════════════════════════════════════════════════════════
-- ข้อมูลอ้างอิงที่ลูกค้าต้องเห็นเพื่อสั่งอาหาร (อ่านอย่างเดียว)
-- ════════════════════════════════════════════════════════════════════════════

create policy read_menu_categories on menu_categories
  for select to authenticated using (true);
create policy manage_menu_categories on menu_categories
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_menu_items on menu_items
  for select to authenticated using (true);
create policy manage_menu_items on menu_items
  for all to authenticated using (is_manager()) with check (is_manager());
-- พนักงานครัวกดปุ่ม "ของหมด" ได้ แต่แก้ราคาไม่ได้
-- หมายเหตุ: RLS จำกัดเป็นราย "แถว" ไม่ใช่ราย "คอลัมน์" — ถ้าให้ policy UPDATE กับ
-- พนักงานตรง ๆ เขาจะแก้ราคาได้ด้วย จึงต้องบังคับผ่าน RPC set_menu_item_availability()
-- ที่แก้ได้เฉพาะคอลัมน์ is_available เท่านั้น

create policy read_menu_item_packages on menu_item_packages
  for select to authenticated using (true);
create policy manage_menu_item_packages on menu_item_packages
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_buffet_packages on buffet_packages
  for select to authenticated using (true);
create policy manage_buffet_packages on buffet_packages
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_add_ons on add_ons
  for select to authenticated using (true);
create policy manage_add_ons on add_ons
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_kitchen_stations on kitchen_stations
  for select to authenticated using (true);
create policy manage_kitchen_stations on kitchen_stations
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_zones on zones for select to authenticated using (is_staff());
create policy manage_zones on zones for all to authenticated
  using (is_manager()) with check (is_manager());

-- ลูกค้าเห็นข้อมูลโต๊ะได้เฉพาะโต๊ะที่ตัวเองนั่งอยู่
create policy read_tables on tables
  for select to authenticated using (
    is_staff()
    or id = (select table_id from visits where id = current_visit_id())
  );
create policy manage_tables on tables
  for all to authenticated using (is_manager()) with check (is_manager());
create policy staff_update_table_status on tables
  for update to authenticated using (is_staff()) with check (is_staff());

-- การตั้งค่าร้าน: ตารางจริงเปิดให้เฉพาะพนักงาน เพราะมีข้อมูลอ่อนไหว
-- (promptpay_id, tax_id, legal_name) ที่ไม่ควรหลุดไปอยู่ใน bundle ฝั่งลูกค้า
create policy staff_read_settings on restaurant_settings
  for select to authenticated using (is_staff());
create policy manage_settings on restaurant_settings
  for all to authenticated using (is_manager()) with check (is_manager());

-- ลูกค้าอ่านได้เฉพาะคอลัมน์ที่จำเป็นต่อการสั่งอาหาร ผ่าน view นี้เท่านั้น
-- view ไม่ได้ตั้ง security_invoker จึงรันด้วยสิทธิ์เจ้าของ = ข้าม RLS ของตารางต้นทาง
-- ทำให้เลือก "เปิดเฉพาะคอลัมน์ที่ปลอดภัย" ได้จริง โดยตารางจริงยังปิดสนิทอยู่
create view public_settings as
  select branch_id,
         display_name,
         logo_url,
         timezone,
         default_dining_minutes,
         last_order_minutes_before_end,
         max_qty_per_item,
         max_items_per_order,
         max_units_per_order,
         min_seconds_between_orders,
         max_unserved_orders_per_visit,
         vat_enabled,
         vat_rate_bp,
         vat_inclusive,
         service_charge_enabled,
         service_charge_rate_bp,
         points_enabled,
         points_baht_per_point,
         payment_mode
  from restaurant_settings;

grant select on public_settings to authenticated;

create policy read_branches on branches for select to authenticated using (true);
create policy manage_branches on branches for all to authenticated
  using (is_manager()) with check (is_manager());

-- ════════════════════════════════════════════════════════════════════════════
-- พนักงาน
-- ════════════════════════════════════════════════════════════════════════════

create policy read_own_profile on profiles
  for select to authenticated using (id = auth.uid() or is_staff());
create policy manage_profiles on profiles
  for all to authenticated using (is_manager()) with check (is_manager());

create policy staff_read_queue on queue_tickets
  for select to authenticated using (is_staff());
create policy staff_write_queue on queue_tickets
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_customers on customers
  for select to authenticated using (is_staff());
create policy staff_write_customers on customers
  for all to authenticated using (is_staff()) with check (is_staff());

create policy manager_read_audit on audit_logs
  for select to authenticated using (is_manager());

create policy staff_read_counters on daily_counters
  for select to authenticated using (is_staff());

create policy manage_promotions on promotions
  for all to authenticated using (is_manager()) with check (is_manager());
create policy staff_read_promotions on promotions
  for select to authenticated using (is_staff());

-- ════════════════════════════════════════════════════════════════════════════
-- visits — ลูกค้าเห็นได้เฉพาะรอบของตัวเอง และแก้ไขอะไรไม่ได้เลย
-- ════════════════════════════════════════════════════════════════════════════

create policy read_own_visit on visits
  for select to authenticated using (is_staff() or id = current_visit_id());
create policy staff_write_visits on visits
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_visit_addons on visit_addons
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_visit_addons on visit_addons
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_devices on visit_devices
  for select to authenticated using (
    is_staff() or auth_user_id = auth.uid() or visit_id = current_visit_id()
  );
create policy staff_write_devices on visit_devices
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_access_attempts on visit_access_attempts
  for select to authenticated using (is_staff());

-- ════════════════════════════════════════════════════════════════════════════
-- ออเดอร์ — ลูกค้า "อ่านได้" แต่ "เขียนตรงไม่ได้"
-- ต้องผ่าน place_order() ที่ตรวจเวลา เพดาน และกฎแพ็กเกจครบก่อนเท่านั้น
-- ════════════════════════════════════════════════════════════════════════════

create policy read_own_orders on orders
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_orders on orders
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_order_items on order_items
  for select to authenticated using (
    is_staff()
    or order_id in (select id from orders where visit_id = current_visit_id())
  );
create policy staff_write_order_items on order_items
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_order_history on order_status_history
  for select to authenticated using (is_staff());

-- ── เรียกพนักงาน: ลูกค้าสร้างได้เฉพาะของโต๊ะตัวเอง ──────────────────────────
create policy read_own_service_requests on service_requests
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy create_own_service_request on service_requests
  for insert to authenticated with check (
    visit_id = current_visit_id()
    and table_id = (select table_id from visits where id = current_visit_id())
  );
create policy staff_write_service_requests on service_requests
  for all to authenticated using (is_staff()) with check (is_staff());

-- ════════════════════════════════════════════════════════════════════════════
-- เงิน — ลูกค้าอ่านบิลของตัวเองได้ แต่แตะ payments ไม่ได้เลย
-- ════════════════════════════════════════════════════════════════════════════

create policy read_own_bill_lines on bill_lines
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_bill_lines on bill_lines
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_visit_promotions on visit_promotions
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_visit_promotions on visit_promotions
  for all to authenticated using (is_staff()) with check (is_staff());

-- ลูกค้าเห็นได้แค่ว่าจ่ายไปเท่าไหร่แล้ว แต่สร้าง/แก้ไม่ได้ (ข้อ ③ ผ่าน RPC เท่านั้น)
create policy read_own_payments on payments
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_payments on payments
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_loyalty on loyalty_transactions
  for select to authenticated using (is_staff());
create policy staff_write_loyalty on loyalty_transactions
  for all to authenticated using (is_staff()) with check (is_staff());

-- ════════════════════════════════════════════════════════════════════════════
-- สิทธิ์เรียก RPC
-- ════════════════════════════════════════════════════════════════════════════

-- ลูกค้าเรียกได้: เข้าโต๊ะ / สั่งอาหาร / ขอเช็คบิล
grant execute on function join_visit(uuid, uuid, text, text, text)  to authenticated;
grant execute on function place_order(uuid, jsonb, text)            to authenticated;
grant execute on function request_visit_bill(uuid)                  to authenticated;
grant execute on function current_visit_id()                        to authenticated;
grant execute on function visit_amount_due(uuid)                    to authenticated;

-- เฉพาะพนักงาน (ฟังก์ชันตรวจ is_staff() ในตัวอยู่แล้ว)
grant execute on function open_visit(uuid, uuid, integer, integer, jsonb, uuid, text) to authenticated;
grant execute on function advance_order_item(uuid, order_status)    to authenticated;
grant execute on function recalculate_visit_totals(uuid)            to authenticated;
grant execute on function create_payment(uuid, payment_method, integer, integer, text, jsonb) to authenticated;
grant execute on function confirm_payment(uuid, text, jsonb)        to authenticated;
grant execute on function cancel_payment(uuid, text)                to authenticated;
grant execute on function close_visit(uuid)                         to authenticated;
grant execute on function mark_table_clean(uuid)                    to authenticated;
grant execute on function void_visit(uuid, text)                    to authenticated;
grant execute on function set_menu_item_availability(uuid, boolean) to authenticated;
grant execute on function is_staff()                                to authenticated;
grant execute on function is_manager()                              to authenticated;

-- next_counter/log_audit ถูกเรียกจากภายใน RPC อื่นเท่านั้น ไม่เปิดให้ client
revoke execute on function next_counter(uuid, text, date) from authenticated, anon;
revoke execute on function log_audit(text, text, text, jsonb, jsonb, text) from authenticated, anon;

-- ปิดประตู anon ทั้งหมด — ลูกค้าต้อง anonymous sign-in ให้เป็น authenticated ก่อน
revoke all on all tables in schema public from anon;

-- ════════════════════════════════════════════════════════════════════════════
-- Realtime
-- ----------------------------------------------------------------------------
-- ⚠️ Realtime ส่ง event DELETE โดยไม่กรองด้วย RLS (payload มีแค่ primary key)
--    ตารางกลุ่มนี้จึงต้องใช้การเปลี่ยน status แทนการลบแถวเสมอ
-- ════════════════════════════════════════════════════════════════════════════

alter publication supabase_realtime add table visits;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table service_requests;
alter publication supabase_realtime add table tables;
alter publication supabase_realtime add table queue_tickets;
alter publication supabase_realtime add table payments;

-- ส่งค่าเดิมมาด้วยเวลามี UPDATE เพื่อให้ฝั่ง client เทียบสถานะก่อน/หลังได้
alter table visits           replica identity full;
alter table orders           replica identity full;
alter table order_items      replica identity full;
alter table service_requests replica identity full;
alter table tables           replica identity full;
alter table queue_tickets    replica identity full;

-- ###########################################################################
-- >>> migrations\0010_token_fallback.sql
-- ###########################################################################

-- ============================================================================
-- 0010 — ทางเข้าสำรองด้วย token ล้วน (ไม่ต้องเปิด Anonymous sign-in)
-- ----------------------------------------------------------------------------
-- แนวคิดนี้หยิบมาจากดีไซน์อีกชุดที่เขียนคู่ขนานกัน (เก็บไว้ที่ supabase/_archive_alt_design/)
--
-- ทางเข้าหลักของระบบยังเป็น anonymous sign-in + visit_devices + RLS ตามเดิม
-- เพราะเป็นทางเดียวที่ลูกค้าจะใช้ Supabase Realtime ได้จริง
--
-- แต่ถ้าโปรเจกต์เปิด Anonymous sign-in ไม่ได้ (นโยบายองค์กร หรือกลัว user งอก)
-- ยังมีทางนี้ให้ใช้: ลูกค้าเป็น anon ล้วน ส่ง access_token เข้ามาใน RPC
-- ฟังก์ชันตรวจ token เองทั้งหมด และตาราง visits/orders ไม่มี policy ให้ anon เลย
-- → ยิง REST ตรงไม่ได้ ต้องผ่าน 4 ฟังก์ชันนี้เท่านั้น
--
-- ⚠️ ข้อแลกเปลี่ยนที่ต้องรู้: ทางนี้ลูกค้า "ไม่ได้ realtime"
--    Realtime postgres_changes ตรวจ RLS ตาม role ที่เชื่อมเข้ามา
--    anon ที่ไม่มี policy บน orders/order_items จะไม่ได้รับ event ใด ๆ
--    หน้าติดตามออเดอร์จึงต้อง poll ด้วย get_visit_orders() ทุก ๆ 5–10 วินาทีแทน
-- ============================================================================

-- ── ตรวจ token แล้วคืน visit ────────────────────────────────────────────────
create or replace function resolve_visit_token(p_token text, p_require_open boolean default true)
returns visits
language plpgsql stable security definer set search_path = public as $$
declare
  v_visit visits;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'ไม่มี token' using errcode = '42501';
  end if;

  begin
    select * into v_visit from visits where session_token = trim(p_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'token ไม่ถูกต้อง' using errcode = '42501';
  end;

  if v_visit.id is null then
    raise exception 'QR นี้ใช้ไม่ได้แล้ว' using errcode = '42501';
  end if;

  -- ปิดบิลแล้ว token ถูกล้างเป็น null อยู่แล้ว แต่กันไว้อีกชั้น
  if p_require_open and v_visit.status <> 'open' then
    raise exception 'รอบการใช้บริการนี้ปิดแล้ว' using errcode = 'check_violation';
  end if;

  return v_visit;
end;
$$;

-- ── ดูข้อมูลโต๊ะและยอดเงิน ──────────────────────────────────────────────────
create or replace function get_visit_by_token(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_visit visits;
  v_table public.tables;
begin
  v_visit := resolve_visit_token(p_token, false);
  select * into v_table from public.tables where id = v_visit.table_id;

  return jsonb_build_object(
    'visit_id',        v_visit.id,
    'visit_code',      v_visit.visit_code,
    'table_number',    v_table.table_number,
    'status',          v_visit.status,
    'package_name',    v_visit.package_name_snapshot,
    'package_id',      v_visit.package_id,
    'adult_count',     v_visit.adult_count,
    'child_count',     v_visit.child_count,
    'check_in_at',     v_visit.check_in_at,
    'deadline_at',     v_visit.dining_deadline_at,
    'subtotal_satang', v_visit.subtotal_satang,
    'total_satang',    v_visit.total_satang
  );
end;
$$;

-- ── ติดตามสถานะอาหาร (ใช้ poll แทน realtime) ────────────────────────────────
create or replace function get_visit_orders(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_visit visits;
begin
  v_visit := resolve_visit_token(p_token, false);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'order_id',     o.id,
             'order_number', o.order_number,
             'status',       o.status,
             'created_at',   o.created_at,
             'items', (
               select jsonb_agg(jsonb_build_object(
                        'name',     oi.name_snapshot,
                        'quantity', oi.quantity,
                        'status',   oi.status,
                        'note',     oi.note
                      ) order by oi.created_at)
               from order_items oi where oi.order_id = o.id
             )
           ) order by o.order_number)
    from orders o where o.visit_id = v_visit.id
  ), '[]'::jsonb);
end;
$$;

-- ── สั่งอาหารด้วย token ─────────────────────────────────────────────────────
-- ใช้ place_order() ตัวเดิมเป็นแกน จึงได้กฎครบทุกข้อโดยไม่ต้องเขียนซ้ำ:
-- จำกัดเวลา, last order, เพดานต่อเมนู/ต่อรอบ, หน่วงเวลา, ออเดอร์ค้าง, ล็อกแพ็กเกจ
create or replace function place_order_by_token(p_token text, p_items jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_order orders;
begin
  v_visit := resolve_visit_token(p_token, true);
  v_order := place_order(v_visit.id, p_items, p_note);

  return jsonb_build_object(
    'order_id',     v_order.id,
    'order_number', v_order.order_number,
    'status',       v_order.status
  );
end;
$$;

-- ── เรียกพนักงานด้วย token ──────────────────────────────────────────────────
create or replace function call_staff_by_token(
  p_token   text,
  p_type    service_request_type default 'call_staff',
  p_message text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_req   service_requests;
begin
  v_visit := resolve_visit_token(p_token, false);

  -- unique index idx_service_requests_one_open_per_type กันกดรัวอยู่แล้ว
  -- ถ้ามีใบเปิดค้างประเภทเดียวกัน ให้คืนใบเดิมแทนที่จะ error ใส่หน้าลูกค้า
  select * into v_req from service_requests
   where visit_id = v_visit.id and type = p_type and status = 'open';

  if not found then
    insert into service_requests (visit_id, table_id, type, message)
    values (v_visit.id, v_visit.table_id, p_type, p_message)
    returning * into v_req;
  end if;

  return jsonb_build_object('request_id', v_req.id, 'status', v_req.status, 'type', v_req.type);
end;
$$;

-- ── สิทธิ์ ──────────────────────────────────────────────────────────────────
-- เปิดให้ anon เฉพาะ 4 ฟังก์ชันนี้ ตัว resolve_visit_token ไม่เปิด (เป็น internal)
revoke execute on function resolve_visit_token(text, boolean) from public, anon, authenticated;

grant execute on function get_visit_by_token(text)                                to anon, authenticated;
grant execute on function get_visit_orders(text)                                  to anon, authenticated;
grant execute on function place_order_by_token(text, jsonb, text)                 to anon, authenticated;
grant execute on function call_staff_by_token(text, service_request_type, text)   to anon, authenticated;

comment on function place_order_by_token(text, jsonb, text) is
  'ทางเข้าสำรองเมื่อเปิด Anonymous sign-in ไม่ได้ — ไม่มี realtime ต้อง poll get_visit_orders()';

-- ###########################################################################
-- >>> seed.sql
-- ###########################################################################

-- ============================================================================
-- seed.sql — ข้อมูลตั้งต้นของร้าน Shabu Mood
-- ----------------------------------------------------------------------------
-- ปลอดภัยที่จะรันซ้ำ (idempotent) — ใช้ on conflict do nothing ทุกจุด
-- ไฟล์นี้มีแต่ข้อมูลอ้างอิง ไม่มีบัญชีพนักงาน
-- บัญชีพนักงานสำหรับ dev อยู่ใน seed_dev_staff.sql แยกต่างหาก
-- ============================================================================

-- ── สาขา ────────────────────────────────────────────────────────────────────
insert into branches (code, name, address, phone)
values ('main', 'Shabu Mood สาขาหลัก', '—', '—')
on conflict (code) do nothing;

-- ── การตั้งค่าร้าน ──────────────────────────────────────────────────────────
-- หมายเหตุ: ร้านเล็กหลายร้านไม่ได้จด VAT จึงตั้ง vat_enabled = false ไว้ก่อน
-- เจ้าของร้านเปิดเองได้จากหน้าผู้จัดการเมื่อจดทะเบียนแล้ว
insert into restaurant_settings (
  branch_id, display_name, receipt_footer,
  vat_enabled, service_charge_enabled,
  default_dining_minutes, last_order_minutes_before_end,
  points_enabled, points_baht_per_point, payment_mode
)
select id, 'Shabu Mood', 'ขอบคุณที่ใช้บริการ อิ่มอร่อยกับชาบูมู้ดนะคะ',
       false, false, 90, 15, true, 100, 'mock'
from branches where code = 'main'
on conflict (branch_id) do nothing;

-- ── สถานีครัว ───────────────────────────────────────────────────────────────
insert into kitchen_stations (branch_id, code, name, sort_order)
select b.id, s.code, s.name, s.sort_order
from branches b
cross join (values
  ('meat', 'ครัวเนื้อ/หมู',     1),
  ('veg',  'ครัวผัก/ของสด',     2),
  ('fry',  'ครัวทอด',           3),
  ('bar',  'บาร์น้ำ/ของหวาน',   4)
) as s(code, name, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

-- ── แพ็กเกจบุฟเฟต์ ──────────────────────────────────────────────────────────
-- ข้อ ①: ราคาอยู่ตรงนี้ที่เดียว โค้ดคิดเงินอ่านจากที่นี่เสมอ
insert into buffet_packages (
  branch_id, code, name, description,
  price_per_adult_satang, price_per_child_satang, child_max_age,
  dining_minutes, color, sort_order
)
select b.id, p.code, p.name, p.description,
       p.adult, p.child, p.child_age, p.minutes, p.color, p.sort_order
from branches b
cross join (values
  ('standard', 'มาตรฐาน', 'เนื้อหมู ซีฟู้ดพื้นฐาน ผัก เห็ด ลูกชิ้น ของทอด ของหวาน',
   29900, 14900, 10, 90,  '#C62828', 1),
  ('premium',  'พรีเมียม', 'ทุกอย่างในแพ็กเกจมาตรฐาน + เนื้อวากิว แซลมอน หอยเชลล์ กุ้งแม่น้ำ',
   39900, 19900, 10, 120, '#AD8B00', 2)
) as p(code, name, description, adult, child, child_age, minutes, color, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

-- ── Add-on ──────────────────────────────────────────────────────────────────
-- ข้อ ①: "น้ำรีฟิล +39" อยู่ตรงนี้ ไม่ใช่ค่าคงที่ในโค้ด
insert into add_ons (branch_id, code, name, description, price_satang, charge_basis, sort_order)
select b.id, a.code, a.name, a.description, a.price, a.basis::addon_charge_basis, a.sort_order
from branches b
cross join (values
  ('drink_refill', 'น้ำรีฟิลไม่อั้น', 'น้ำอัดลม น้ำหวาน ชา รีฟิลได้ไม่จำกัดตลอดมื้อ',
   3900, 'per_person', 1)
) as a(code, name, description, price, basis, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

-- ── หมวดเมนู ────────────────────────────────────────────────────────────────
insert into menu_categories (branch_id, code, name_th, name_en, icon, sort_order)
select b.id, c.code, c.th, c.en, c.icon, c.sort_order
from branches b
cross join (values
  ('beef',      'เนื้อ',       'Beef',      '🥩', 1),
  ('pork',      'หมู',         'Pork',      '🐷', 2),
  ('seafood',   'ซีฟู้ด',      'Seafood',   '🦐', 3),
  ('vegetable', 'ผัก',         'Vegetable', '🥬', 4),
  ('mushroom',  'เห็ด',        'Mushroom',  '🍄', 5),
  ('meatball',  'ลูกชิ้น',     'Meatball',  '🍡', 6),
  ('fried',     'ของทอด',      'Fried',     '🍤', 7),
  ('noodle',    'เส้นและอื่นๆ', 'Noodle',    '🍜', 8),
  ('drink',     'เครื่องดื่ม',  'Drink',     '🥤', 9),
  ('dessert',   'ของหวาน',     'Dessert',   '🍨', 10)
) as c(code, th, en, icon, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

-- ── เมนูอาหาร ───────────────────────────────────────────────────────────────
-- is_premium = true → จะถูกล็อกให้สั่งได้เฉพาะแพ็กเกจพรีเมียมในขั้นถัดไป
-- price = null    → รวมในบุฟเฟต์ (is_included_in_buffet = true)
-- price มีค่า      → สั่งพิเศษ คิดเงินเพิ่มนอกเหนือบุฟเฟต์
with data(cat, station, name_th, name_en, sort_order, is_premium, price) as (values
  -- เนื้อ
  ('beef','meat','เนื้อสไลด์',        'Sliced Beef',        1, false, null::integer),
  ('beef','meat','เนื้อสันคอ',        'Beef Chuck',         2, false, null),
  ('beef','meat','เนื้อใบพาย',        'Beef Blade',         3, false, null),
  ('beef','meat','เนื้อสามชั้น',      'Beef Brisket',       4, false, null),
  ('beef','meat','เนื้อริบอาย',       'Ribeye',             5, true,  null),
  ('beef','meat','เนื้อวากิว A5',     'Wagyu A5',           6, true,  null),
  -- หมู
  ('pork','meat','หมูสไลด์',          'Sliced Pork',        1, false, null),
  ('pork','meat','หมูสามชั้น',        'Pork Belly',         2, false, null),
  ('pork','meat','หมูสันคอ',          'Pork Collar',        3, false, null),
  ('pork','meat','หมูนุ่ม',           'Tender Pork',        4, false, null),
  ('pork','meat','หมูเด้ง',           'Bouncy Pork',        5, false, null),
  ('pork','meat','เบคอน',             'Bacon',              6, false, null),
  -- ซีฟู้ด
  ('seafood','meat','กุ้งขาว',        'White Shrimp',       1, false, null),
  ('seafood','meat','ปลาหมึก',        'Squid',              2, false, null),
  ('seafood','meat','หอยแมลงภู่',     'Mussel',             3, false, null),
  ('seafood','meat','ปลาดอรี่',       'Dory Fish',          4, false, null),
  ('seafood','meat','ปูอัด',          'Crab Stick',         5, false, null),
  ('seafood','meat','ปลาแซลมอน',      'Salmon',             6, true,  null),
  ('seafood','meat','หอยเชลล์',       'Scallop',            7, true,  null),
  ('seafood','meat','กุ้งแม่น้ำ',     'River Prawn',        8, true,  null),
  -- ผัก
  ('vegetable','veg','ผักกาดขาว',     'Chinese Cabbage',    1, false, null),
  ('vegetable','veg','ผักบุ้ง',       'Morning Glory',      2, false, null),
  ('vegetable','veg','คะน้า',         'Kale',               3, false, null),
  ('vegetable','veg','ข้าวโพดอ่อน',   'Baby Corn',          4, false, null),
  ('vegetable','veg','แครอท',         'Carrot',             5, false, null),
  ('vegetable','veg','ฟักทอง',        'Pumpkin',            6, false, null),
  ('vegetable','veg','ผักกาดแก้ว',    'Iceberg Lettuce',    7, false, null),
  ('vegetable','veg','ต้นหอม',        'Spring Onion',       8, false, null),
  -- เห็ด
  ('mushroom','veg','เห็ดเข็มทอง',    'Enoki Mushroom',     1, false, null),
  ('mushroom','veg','เห็ดหอม',        'Shiitake',           2, false, null),
  ('mushroom','veg','เห็ดออรินจิ',    'King Oyster',        3, false, null),
  ('mushroom','veg','เห็ดนางฟ้า',     'Oyster Mushroom',    4, false, null),
  ('mushroom','veg','เห็ดฟาง',        'Straw Mushroom',     5, false, null),
  -- ลูกชิ้น
  ('meatball','veg','ลูกชิ้นหมู',     'Pork Ball',          1, false, null),
  ('meatball','veg','ลูกชิ้นเนื้อ',   'Beef Ball',          2, false, null),
  ('meatball','veg','ลูกชิ้นปลา',     'Fish Ball',          3, false, null),
  ('meatball','veg','ลูกชิ้นกุ้ง',    'Shrimp Ball',        4, false, null),
  ('meatball','veg','เต้าหู้ปลา',     'Fish Tofu',          5, false, null),
  ('meatball','veg','ไส้กรอก',        'Sausage',            6, false, null),
  ('meatball','veg','เกี๊ยวกุ้ง',     'Shrimp Wonton',      7, false, null),
  -- ของทอด
  ('fried','fry','เกี๊ยวทอด',         'Fried Wonton',       1, false, null),
  ('fried','fry','ปอเปี๊ยะทอด',       'Spring Roll',        2, false, null),
  ('fried','fry','ไก่ป๊อป',           'Popcorn Chicken',    3, false, null),
  ('fried','fry','เฟรนช์ฟรายส์',      'French Fries',       4, false, null),
  -- เส้นและอื่นๆ
  ('noodle','veg','วุ้นเส้น',         'Glass Noodle',       1, false, null),
  ('noodle','veg','บะหมี่',           'Egg Noodle',         2, false, null),
  ('noodle','veg','อูด้ง',            'Udon',               3, false, null),
  ('noodle','veg','เส้นราเมง',        'Ramen',              4, false, null),
  ('noodle','veg','เต้าหู้ไข่',       'Egg Tofu',           5, false, null),
  ('noodle','veg','ไข่ไก่',           'Egg',                6, false, null),
  ('noodle','veg','ข้าวสวย',          'Steamed Rice',       7, false, null),
  -- เครื่องดื่ม (รวมในบุฟเฟต์เฉพาะคนที่ซื้อ add-on น้ำรีฟิล)
  ('drink','bar','น้ำเปล่า',          'Water',              1, false, null),
  ('drink','bar','น้ำแดง',            'Red Soda',           2, false, null),
  ('drink','bar','น้ำเขียว',          'Green Soda',         3, false, null),
  ('drink','bar','โค้ก',              'Coke',               4, false, null),
  ('drink','bar','สไปรท์',            'Sprite',             5, false, null),
  ('drink','bar','ชาเขียว',           'Green Tea',          6, false, null),
  -- ตัวอย่างเมนูสั่งพิเศษ: คิดเงินเพิ่มนอกบุฟเฟต์ (พิสูจน์เส้นทาง a_la_carte)
  ('drink','bar','เบียร์สิงห์',       'Singha Beer',        7, false, 12000),
  ('drink','bar','โซดา',              'Soda',               8, false, 3000),
  -- ของหวาน
  ('dessert','bar','ไอศกรีมวานิลลา',  'Vanilla Ice Cream',  1, false, null),
  ('dessert','bar','ไอศกรีมช็อกโกแลต','Chocolate Ice Cream',2, false, null),
  ('dessert','bar','ไอศกรีมชาเขียว',  'Green Tea Ice Cream',3, false, null),
  ('dessert','bar','บัวลอย',          'Bua Loy',            4, false, null),
  ('dessert','bar','วุ้นกะทิ',        'Coconut Jelly',      5, false, null)
)
insert into menu_items (
  branch_id, category_id, station_id, name_th, name_en,
  is_included_in_buffet, a_la_carte_price_satang, sort_order, tags
)
select b.id, mc.id, ks.id, d.name_th, d.name_en,
       d.price is null,
       d.price,
       d.sort_order,
       case when d.is_premium then array['premium'] else '{}'::text[] end
from data d
join branches b on b.code = 'main'
join menu_categories  mc on mc.branch_id = b.id and mc.code = d.cat
join kitchen_stations ks on ks.branch_id = b.id and ks.code = d.station
where not exists (
  select 1 from menu_items mi
  where mi.branch_id = b.id and mi.category_id = mc.id and mi.name_th = d.name_th
);

-- ── ข้อ ②: ล็อกเมนูพรีเมียมให้สั่งได้เฉพาะแพ็กเกจ 399 ───────────────────────
-- กติกา: เมนูที่ไม่มีแถวในตารางนี้ = สั่งได้ทุกแพ็กเกจ
-- จึงผูกเฉพาะเมนูที่ติด tag 'premium' เข้ากับแพ็กเกจ premium เท่านั้น
insert into menu_item_packages (menu_item_id, package_id)
select mi.id, bp.id
from menu_items mi
join branches b        on b.id = mi.branch_id and b.code = 'main'
join buffet_packages bp on bp.branch_id = b.id and bp.code = 'premium'
where 'premium' = any(mi.tags)
on conflict do nothing;

-- ── โซนและโต๊ะ ──────────────────────────────────────────────────────────────
insert into zones (branch_id, code, name, sort_order)
select b.id, z.code, z.name, z.sort_order
from branches b
cross join (values
  ('A', 'โซน A (ริมหน้าต่าง)', 1),
  ('B', 'โซน B (กลางร้าน)',    2),
  ('C', 'โซน C (ห้องแอร์)',    3)
) as z(code, name, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

-- 12 โต๊ะ: A1–A4 (4 ที่นั่ง), B1–B4 (4 ที่นั่ง), C1–C4 (6 ที่นั่ง)
insert into tables (branch_id, zone_id, table_number, capacity, position_x, position_y)
select b.id, z.id, t.number, t.capacity, t.x, t.y
from branches b
join zones z on z.branch_id = b.id
cross join lateral (values
  (z.code || '1', case when z.code = 'C' then 6 else 4 end, 1.0, 1.0),
  (z.code || '2', case when z.code = 'C' then 6 else 4 end, 2.0, 1.0),
  (z.code || '3', case when z.code = 'C' then 6 else 4 end, 1.0, 2.0),
  (z.code || '4', case when z.code = 'C' then 6 else 4 end, 2.0, 2.0)
) as t(number, capacity, x, y)
where b.code = 'main'
on conflict (branch_id, table_number) do nothing;

-- ── โปรโมชั่นตัวอย่าง ───────────────────────────────────────────────────────
insert into promotions (
  branch_id, code, name, description, type, scope,
  value_bp, min_spend_satang, days_of_week, time_start, time_end
)
select b.id, 'LUNCH10', 'ลดมื้อกลางวัน 10%',
       'ลด 10% สำหรับลูกค้าที่เข้าร้านวันจันทร์–ศุกร์ ก่อน 16:00 น.',
       'percent'::promotion_type, 'bill'::promotion_scope,
       1000, 0, array[1,2,3,4,5]::smallint[], '11:00'::time, '16:00'::time
from branches b where b.code = 'main'
on conflict (branch_id, code) do nothing;

-- ============================================================================
-- ตรวจผลลัพธ์
-- ============================================================================
do $$
declare
  v_menu    integer;
  v_premium integer;
  v_tables  integer;
begin
  select count(*) into v_menu    from menu_items;
  select count(*) into v_premium from menu_item_packages;
  select count(*) into v_tables  from tables;

  raise notice 'seed เสร็จแล้ว: เมนู % รายการ / ล็อกพรีเมียม % รายการ / โต๊ะ % โต๊ะ',
    v_menu, v_premium, v_tables;
end $$;

