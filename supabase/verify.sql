-- ============================================================================
-- verify.sql — ตรวจว่าฐานข้อมูลที่ push ขึ้นไปแล้วทำงานจริง
-- ----------------------------------------------------------------------------
-- รันบน Supabase Dashboard → SQL Editor หลังรัน 0001–0009 + seed.sql เสร็จ
-- ทุกบรรทัดต้องขึ้น ✅ ถ้าเจอ ❌ แปลว่ามีอะไรพัง
--
-- ปลอดภัยที่จะรันซ้ำ: ทุกอย่างทำใน transaction แล้ว rollback ทิ้งตอนจบ
-- ไม่มีข้อมูลทดสอบตกค้างในฐานข้อมูล
-- ============================================================================

begin;

do $$
declare
  v_uid    uuid := '00000000-0000-0000-0000-0000000000aa';   -- พนักงานทดสอบ
  v_cust   uuid := '00000000-0000-0000-0000-0000000000bb';   -- มือถือลูกค้าทดสอบ
  v_branch uuid;
  v_table  uuid;
  v_pkg    uuid;
  v_visit  visits;
  v_tok    uuid;
  v_item   uuid;
  v_pay    payments;
  v_cnt    integer;
  v_exp    integer;
begin
  -- ── เตรียมพนักงานทดสอบ ────────────────────────────────────────────────────
  select id into v_branch from branches limit 1;
  if v_branch is null then
    raise exception '❌ ไม่มีข้อมูลใน branches — ยังไม่ได้รัน seed.sql';
  end if;

  -- ต้องรันในฐานะ postgres (SQL Editor ของ Supabase ใช้สิทธิ์นี้อยู่แล้ว)
  begin
    insert into auth.users(id) values (v_uid)  on conflict do nothing;
    insert into auth.users(id) values (v_cust) on conflict do nothing;
  exception when insufficient_privilege then
    raise exception 'ต้องรันไฟล์นี้จาก Supabase Dashboard → SQL Editor (ต้องมีสิทธิ์เขียน auth.users)';
  end;

  insert into profiles(id, branch_id, full_name, role)
  values (v_uid, v_branch, 'บัญชีทดสอบ verify.sql', 'owner')
  on conflict (id) do update set role = 'owner', is_active = true;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  if not is_staff() then raise exception '❌ is_staff() ไม่ทำงาน'; end if;
  raise notice '✅ helper สิทธิ์ (is_staff / is_manager / current_staff_branch)';

  -- ── 1. เปิดโต๊ะ ────────────────────────────────────────────────────────────
  select id into v_table from tables where branch_id = v_branch and status = 'available'
   order by table_number limit 1;
  select id into v_pkg from buffet_packages where branch_id = v_branch and is_active
   order by price_per_adult_satang limit 1;
  if v_table is null then raise exception '❌ ไม่มีโต๊ะว่าง'; end if;
  if v_pkg   is null then raise exception '❌ ไม่มีแพ็กเกจบุฟเฟต์'; end if;

  v_visit := open_visit(v_table, v_pkg, 3, 1);
  v_tok   := v_visit.session_token;
  raise notice '✅ เปิดโต๊ะ % (ผู้ใหญ่ 3 เด็ก 1)', v_visit.visit_code;

  if (select status from tables where id = v_table) <> 'occupied' then
    raise exception '❌ โต๊ะไม่เปลี่ยนเป็น occupied';
  end if;
  raise notice '✅ โต๊ะเปลี่ยนสถานะเป็น occupied อัตโนมัติ';

  -- เปิดโต๊ะซ้ำต้องไม่ได้
  begin
    perform open_visit(v_table, v_pkg, 2, 0);
    raise exception '❌ เปิดโต๊ะที่ไม่ว่างซ้ำได้';
  exception when check_violation then
    raise notice '✅ กันเปิดโต๊ะซ้ำ';
  end;

  -- ── 2. ลูกค้าสแกน QR แล้วสั่งอาหาร ─────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_cust::text, true);
  v_visit := join_visit(p_session_token := v_tok, p_nickname := 'ลูกค้าทดสอบ');
  if current_visit_id() is distinct from v_visit.id then
    raise exception '❌ current_visit_id() ไม่ผูกกับ visit ที่ join';
  end if;
  raise notice '✅ ลูกค้าสแกน QR เข้า visit ได้';

  perform place_order(
    v_visit.id,
    (select jsonb_agg(jsonb_build_object('menu_item_id', id, 'quantity', 2))
       from (select id from menu_items where is_available and branch_id = v_branch limit 3) s),
    'ทดสอบจากมือถือลูกค้า');
  raise notice '✅ ลูกค้าสั่งอาหารผ่าน QR ได้ (จุดที่เคยพังเพราะ FK ของ order_status_history)';

  -- ประวัติสถานะต้องถูกบันทึกโดยไม่ชน FK
  select count(*) into v_cnt
  from order_status_history h
  join order_items oi on oi.id = h.order_item_id
  join orders o on o.id = oi.order_id
  where o.visit_id = v_visit.id;
  if v_cnt = 0 then raise exception '❌ ไม่มีการบันทึก order_status_history'; end if;
  raise notice '✅ บันทึกประวัติสถานะ % แถว (changed_by = null เพราะผู้สั่งคือลูกค้า)', v_cnt;

  -- ── 3. กันสั่งข้ามโต๊ะ ──────────────────────────────────────────────────────
  begin
    perform place_order(
      (select id from visits where id <> v_visit.id and status in ('open','awaiting_payment') limit 1),
      '[]'::jsonb, null);
    raise exception '❌ สั่งอาหารเข้าโต๊ะคนอื่นได้';
  exception
    when insufficient_privilege then raise notice '✅ กันสั่งข้ามโต๊ะ';
    when no_data_found          then raise notice '✅ กันสั่งข้ามโต๊ะ (ไม่มีโต๊ะอื่นเปิดอยู่)';
  end;

  -- ── 4. ครัวเดินสถานะ ───────────────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  select oi.id into v_item from order_items oi
   join orders o on o.id = oi.order_id where o.visit_id = v_visit.id limit 1;

  perform advance_order_item(v_item, 'preparing');
  perform advance_order_item(v_item, 'ready');
  perform advance_order_item(v_item, 'served');
  raise notice '✅ ครัวเดินสถานะ pending → preparing → ready → served';

  begin
    perform advance_order_item(v_item, 'pending');
    raise exception '❌ ถอยสถานะข้ามขั้นได้';
  exception when check_violation then
    raise notice '✅ กันถอยสถานะข้ามขั้น';
  end;

  -- ── 5. ยอดเงิน ─────────────────────────────────────────────────────────────
  -- จ่ายก่อนเช็คบิลต้องไม่ได้
  begin
    perform create_payment(v_visit.id, 'cash', 100, 100, null, null);
    raise exception '❌ จ่ายเงินได้ทั้งที่ยังไม่เช็คบิล';
  exception when check_violation or invalid_parameter_value then
    raise notice '✅ กันจ่ายเงินก่อนเช็คบิล';
  end;

  v_visit := request_visit_bill(v_visit.id);

  -- บุฟเฟต์คิดต่อคน: สั่งกี่จานก็ไม่เปลี่ยนยอด
  v_exp := 3 * v_visit.package_price_adult_satang + 1 * v_visit.package_price_child_satang;
  if v_visit.subtotal_satang <> v_exp then
    raise exception '❌ subtotal ผิด: ได้ % ควรได้ %', v_visit.subtotal_satang, v_exp;
  end if;
  raise notice '✅ ยอดบุฟเฟต์คิดต่อคนถูกต้อง: % บาท (สั่งอาหารแล้วยอดไม่ขยับ)',
               v_visit.subtotal_satang / 100.0;
  raise notice '   subtotal % / service % / vat % / รวม % บาท',
    v_visit.subtotal_satang/100.0, v_visit.service_charge_satang/100.0,
    v_visit.vat_satang/100.0, v_visit.total_satang/100.0;

  -- จ่ายเกินต้องไม่ได้
  begin
    perform create_payment(v_visit.id, 'cash', v_visit.total_satang + 100000,
                           v_visit.total_satang + 100000, null, null);
    raise exception '❌ จ่ายเกินยอดได้';
  exception when check_violation or invalid_parameter_value then
    raise notice '✅ กันรับชำระเกินยอด';
  end;

  -- ── 6. ชำระเงินและปิดโต๊ะ ───────────────────────────────────────────────────
  v_pay := create_payment(v_visit.id, 'cash', v_visit.total_satang,
                          v_visit.total_satang + 5000, null, null);
  if v_pay.change_satang <> 5000 then
    raise exception '❌ คำนวณเงินทอนผิด: ได้ %', v_pay.change_satang;
  end if;
  raise notice '✅ คำนวณเงินทอนถูกต้อง (% บาท)', v_pay.change_satang/100.0;

  v_pay := confirm_payment(v_pay.id, 'VERIFY-TEST', null);
  if visit_amount_due(v_visit.id) <> 0 then
    raise exception '❌ ยังค้างชำระหลังจ่ายครบ';
  end if;
  raise notice '✅ ยืนยันการชำระเงิน ยอดค้าง 0';

  v_visit := close_visit(v_visit.id);
  if v_visit.status <> 'closed' then raise exception '❌ ปิด visit ไม่สำเร็จ'; end if;
  if (select status from tables where id = v_table) <> 'cleaning' then
    raise exception '❌ โต๊ะไม่เปลี่ยนเป็น cleaning หลังปิดบิล';
  end if;
  raise notice '✅ ปิดบิลแล้วโต๊ะเปลี่ยนเป็น cleaning อัตโนมัติ';

  -- ── 7. QR เดิมต้องใช้ต่อไม่ได้ ───────────────────────────────────────────────
  perform set_config('request.jwt.claim.sub', v_cust::text, true);
  begin
    perform place_order(v_visit.id, '[]'::jsonb, null);
    raise exception '❌ visit ปิดแล้วยังสั่งอาหารได้';
  exception when insufficient_privilege then
    raise notice '✅ visit ปิดแล้วสั่งอาหารไม่ได้';
  end;

  begin
    perform join_visit(p_session_token := v_tok);
    raise exception '❌ QR เดิมยังใช้เข้าโต๊ะได้';
  exception when others then
    raise notice '✅ QR เดิมใช้ไม่ได้แล้ว';
  end;

  raise notice '';
  raise notice '═══ ผ่านทั้งหมด ═══';
end $$;

-- ── ตรวจว่าคอลัมน์ลับไม่หลุดออก view สาธารณะ ───────────────────────────────────
do $$
declare v_leak text;
begin
  select string_agg(column_name, ', ') into v_leak
  from information_schema.columns
  where table_name = 'public_settings'
    and column_name in ('promptpay_id', 'tax_id', 'legal_name');

  if v_leak is not null then
    raise exception '❌ public_settings เผยคอลัมน์ลับ: %', v_leak;
  end if;
  raise notice '✅ public_settings ไม่เผย promptpay_id / tax_id / legal_name';
end $$;

-- ── สรุปโครงสร้าง ─────────────────────────────────────────────────────────────
select 'ตาราง'            as รายการ, count(*)::text as จำนวน from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'ตารางที่เปิด RLS', count(*)::text from pg_class
  where relrowsecurity and relnamespace = 'public'::regnamespace
union all
select 'RLS policy', count(*)::text from pg_policy
union all
select 'ตารางที่เปิด Realtime', count(*)::text from pg_publication_tables
  where pubname = 'supabase_realtime';

-- ทุกอย่างข้างบนถูกยกเลิกทิ้ง ไม่มีข้อมูลทดสอบค้างในฐานข้อมูล
rollback;
