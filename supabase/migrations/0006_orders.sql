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
