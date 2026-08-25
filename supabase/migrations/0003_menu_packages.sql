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
