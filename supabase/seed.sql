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
