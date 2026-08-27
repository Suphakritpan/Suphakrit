-- ============================================================================
-- 0012 — จำกัดสิทธิ์พนักงานให้อยู่แค่สาขาตัวเอง
-- ----------------------------------------------------------------------------
-- ปัญหาที่แก้: policy ใน 0009 เปิดสิทธิ์ด้วย is_staff() ล้วน ซึ่งเช็คแค่ว่า
-- "มีแถวใน profiles และ is_active" ไม่ได้เทียบสาขาเลย ผลคือพนักงานสาขาใดก็
-- อ่าน (และในหลาย policy คือ "แก้") ข้อมูลของทุกสาขาได้
--
-- current_staff_branch() มีมาตั้งแต่ 0008 แต่ไม่เคยถูกใช้ใน policy ไหนเลย
--
-- วันนี้มีสาขาเดียว ทุกโปรไฟล์จึงมี branch_id ตรงกับสาขานั้นอยู่แล้ว
-- การล็อกนี้ไม่กระทบใครตอนนี้ แต่ปิดช่องโหว่ถาวรก่อนเปิดสาขาที่สอง
--
-- แยกวิธีตามโครงสร้างจริง:
--   tables · queue_tickets · visits → มี branch_id ในตัว เทียบตรง ๆ
--   orders · payments               → ไม่มี branch_id ผูกผ่าน visit_id เท่านั้น
--                                     จึงกรองผ่าน subquery บน visits
--
-- ส่วนเงื่อนไขฝั่งลูกค้า (current_visit_id()) ไม่แตะ — ลูกค้ายังเข้าโต๊ะตัวเอง
-- ได้เหมือนเดิม และ visit ของลูกค้าอยู่ในสาขาเดียวกับโต๊ะอยู่แล้วโดยธรรมชาติ
-- ============================================================================

-- ── tables ──────────────────────────────────────────────────────────────────
drop policy if exists read_tables on tables;
create policy read_tables on tables
  for select to authenticated using (
    (is_staff() and branch_id = current_staff_branch())
    or id = (select table_id from visits where id = current_visit_id())
  );

drop policy if exists staff_update_table_status on tables;
create policy staff_update_table_status on tables
  for update to authenticated
  using      (is_staff() and branch_id = current_staff_branch())
  with check (is_staff() and branch_id = current_staff_branch());

-- ── queue_tickets ───────────────────────────────────────────────────────────
drop policy if exists staff_read_queue on queue_tickets;
create policy staff_read_queue on queue_tickets
  for select to authenticated
  using (is_staff() and branch_id = current_staff_branch());

drop policy if exists staff_write_queue on queue_tickets;
create policy staff_write_queue on queue_tickets
  for all to authenticated
  using      (is_staff() and branch_id = current_staff_branch())
  with check (is_staff() and branch_id = current_staff_branch());

-- ── visits ──────────────────────────────────────────────────────────────────
drop policy if exists read_own_visit on visits;
create policy read_own_visit on visits
  for select to authenticated using (
    (is_staff() and branch_id = current_staff_branch())
    or id = current_visit_id()
  );

drop policy if exists staff_write_visits on visits;
create policy staff_write_visits on visits
  for all to authenticated
  using      (is_staff() and branch_id = current_staff_branch())
  with check (is_staff() and branch_id = current_staff_branch());

-- ── orders — ไม่มี branch_id ผูกผ่าน visit ──────────────────────────────────
drop policy if exists read_own_orders on orders;
create policy read_own_orders on orders
  for select to authenticated using (
    (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()))
    or visit_id = current_visit_id()
  );

drop policy if exists staff_write_orders on orders;
create policy staff_write_orders on orders
  for all to authenticated
  using      (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()))
  with check (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()));

-- ── payments — ไม่มี branch_id ผูกผ่าน visit ────────────────────────────────
drop policy if exists read_own_payments on payments;
create policy read_own_payments on payments
  for select to authenticated using (
    (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()))
    or visit_id = current_visit_id()
  );

drop policy if exists staff_write_payments on payments;
create policy staff_write_payments on payments
  for all to authenticated
  using      (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()))
  with check (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()));
