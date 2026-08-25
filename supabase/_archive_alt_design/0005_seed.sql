-- ═══════════════════════════════════════════════════════════════════════════
-- SHABU MOOD — Production Database v1
-- 0005: Seed — ข้อมูลตั้งต้นสำหรับเริ่มใช้งานและทดสอบ
--
-- ราคาทั้งหมดในไฟล์นี้เป็นแค่ค่าเริ่มต้น Admin แก้ผ่านหน้าเว็บได้
-- ไม่มีตัวเลขไหนถูกฝังใน code
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  v_branch uuid;
  v_cat_meat uuid; v_cat_seafood uuid; v_cat_veg uuid;
  v_cat_noodle uuid; v_cat_sauce uuid; v_cat_drink uuid; v_cat_dessert uuid;
  v_zone text;
  v_i int;
begin
  -- ─── สาขา ────────────────────────────────────────────────────────────────
  insert into branches (name, phone, address, service_charge_rate, vat_rate)
  values ('Shabu Mood', '02-000-0000', 'สาขาแรก', 0, 0)
  returning id into v_branch;

  -- service_charge_rate / vat_rate ตั้งเป็น 0 ไว้ก่อน
  -- ถ้าร้านจด VAT ค่อยเปลี่ยนเป็น 0.07 ระบบจะคิดให้เองทั้งระบบ

  -- ─── แพ็กเกจบุฟเฟต์ ──────────────────────────────────────────────────────
  insert into buffet_packages (branch_id, name, price, description, sort_order) values
    (v_branch, 'Standard', 299, 'หมู ไก่ ผัก เส้น น้ำซุป 2 อย่าง', 1),
    (v_branch, 'Premium',  399, 'เพิ่มเนื้อวัว กุ้งสด หอยแมลงภู่', 2);

  -- ─── Add-on ──────────────────────────────────────────────────────────────
  insert into addons (branch_id, name, price, unit) values
    (v_branch, 'น้ำอัดลมรีฟิล', 39, 'PER_PERSON'),
    (v_branch, 'ชีสยืด',        49, 'PER_PERSON'),
    (v_branch, 'ไอศกรีม',       29, 'PER_PERSON');

  -- ─── โต๊ะ A1-A10 (4 ที่นั่ง) และ B1-B6 (6 ที่นั่ง) ───────────────────────
  foreach v_zone in array array['A','B'] loop
    for v_i in 1 .. (case v_zone when 'A' then 10 else 6 end) loop
      insert into dining_tables (branch_id, table_code, zone, seats)
      values (v_branch, v_zone || v_i::text, v_zone,
              case v_zone when 'A' then 4 else 6 end);
    end loop;
  end loop;

  -- ─── หมวดหมู่เมนู ────────────────────────────────────────────────────────
  insert into menu_categories (branch_id, name, sort_order) values (v_branch, 'เนื้อสัตว์', 1) returning id into v_cat_meat;
  insert into menu_categories (branch_id, name, sort_order) values (v_branch, 'ทะเล',      2) returning id into v_cat_seafood;
  insert into menu_categories (branch_id, name, sort_order) values (v_branch, 'ผัก',       3) returning id into v_cat_veg;
  insert into menu_categories (branch_id, name, sort_order) values (v_branch, 'เส้นและแป้ง', 4) returning id into v_cat_noodle;
  insert into menu_categories (branch_id, name, sort_order) values (v_branch, 'น้ำจิ้มและน้ำซุป', 5) returning id into v_cat_sauce;
  insert into menu_categories (branch_id, name, sort_order) values (v_branch, 'เครื่องดื่ม', 6) returning id into v_cat_drink;
  insert into menu_categories (branch_id, name, sort_order) values (v_branch, 'ของหวาน',    7) returning id into v_cat_dessert;

  -- ─── เมนู ────────────────────────────────────────────────────────────────
  -- ไม่มีราคา เพราะรวมอยู่ในแพ็กเกจบุฟเฟต์แล้ว
  insert into menu_items (category_id, name, is_recommended, sort_order) values
    (v_cat_meat, 'หมูสามชั้น',      true,  1),
    (v_cat_meat, 'หมูสไลซ์',        false, 2),
    (v_cat_meat, 'สันคอหมู',        false, 3),
    (v_cat_meat, 'เนื้อวัวสไลซ์',    true,  4),
    (v_cat_meat, 'อกไก่',           false, 5),
    (v_cat_meat, 'เบคอน',           false, 6),

    (v_cat_seafood, 'กุ้งสด',        true,  1),
    (v_cat_seafood, 'ปลาหมึก',      false, 2),
    (v_cat_seafood, 'หอยแมลงภู่',    false, 3),
    (v_cat_seafood, 'ปูอัด',         false, 4),
    (v_cat_seafood, 'ลูกชิ้นปลา',    false, 5),

    (v_cat_veg, 'ผักกาดขาว',        false, 1),
    (v_cat_veg, 'เห็ดเข็มทอง',       true,  2),
    (v_cat_veg, 'เห็ดออรินจิ',       false, 3),
    (v_cat_veg, 'ข้าวโพดอ่อน',       false, 4),
    (v_cat_veg, 'ฟักทอง',           false, 5),
    (v_cat_veg, 'เต้าหู้ไข่',         false, 6),

    (v_cat_noodle, 'บะหมี่',         false, 1),
    (v_cat_noodle, 'วุ้นเส้น',        false, 2),
    (v_cat_noodle, 'อุด้ง',          false, 3),
    (v_cat_noodle, 'ข้าวสวย',        false, 4),

    (v_cat_sauce, 'น้ำจิ้มสุกี้',     false, 1),
    (v_cat_sauce, 'น้ำจิ้มงา',       false, 2),
    (v_cat_sauce, 'ซุปกระดูกหมู',    false, 3),
    (v_cat_sauce, 'ซุปต้มยำ',        true,  4),
    (v_cat_sauce, 'ซุปมิโสะ',        false, 5),

    (v_cat_drink, 'น้ำเปล่า',        false, 1),
    (v_cat_drink, 'ชาเขียว',         false, 2),

    (v_cat_dessert, 'บัวลอย',        false, 1),
    (v_cat_dessert, 'วุ้นกะทิ',       false, 2);

  raise notice 'Seed เสร็จแล้ว — branch_id = %', v_branch;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- สร้างบัญชีพนักงานคนแรก
--
-- ทำใน SQL ตรง ๆ ไม่ได้ ต้องสร้าง user ใน Supabase Auth ก่อน
--   1. Dashboard → Authentication → Users → Add user
--      ใส่ email + password แล้วติ๊ก Auto Confirm User
--   2. คัดลอก UID ที่ได้ มารันคำสั่งข้างล่างนี้
--
-- insert into staff (id, branch_id, employee_code, full_name, role)
-- select
--   'วาง-UID-ที่คัดลอกมา-ตรงนี้'::uuid,
--   b.id, 'EMP001', 'ผู้ดูแลระบบ', 'ADMIN'
-- from branches b where b.name = 'Shabu Mood';
-- ═══════════════════════════════════════════════════════════════════════════
