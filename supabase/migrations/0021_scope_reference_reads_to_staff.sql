-- ════════════════════════════════════════════════════════════════════════════
-- 0021 — เลิกให้ read_branches / read_kitchen_stations เปิดกว้างเกินจำเป็น
--
-- ทั้งสอง policy ตั้งไว้ตั้งแต่ 0009 เป็น `to authenticated using (true)` เพราะตอนนั้น
-- คิดว่าลูกค้าอาจต้องอ่าน — grep frontend/src ทั้งก้อนแล้วไม่พบที่ไหนอ่าน `branches` เลย
-- และ `kitchen_stations` มีแต่หน้า /admin กับ /staff/kds ที่ใช้ ฝั่งลูกค้าไม่แตะเลย
--
-- ปัญหา: "authenticated" ใน Supabase ไม่ได้แปลว่า "พนักงาน" — ลูกค้าที่ signInAnonymously()
-- ก็ได้ role authenticated เหมือนกัน (แค่ is_anonymous = true) แปลว่าใครก็ตามที่ยิง
-- signInAnonymously() เอง (ไม่ต้องผ่านหน้าเว็บ) แล้วอ่าน branches ตรง ๆ จะได้ข้อมูลสาขากลับไป
-- ทั้งที่ไม่มีหน้าจอไหนต้องการ — เป็นช่องที่ปิดได้ฟรีโดยไม่กระทบใคร
--
-- ไม่แตะ manage_branches / manage_kitchen_stations — ยังเป็น is_manager() เหมือนเดิม
-- ════════════════════════════════════════════════════════════════════════════

drop policy read_branches on branches;
create policy read_branches on branches for select to authenticated using (is_staff());

drop policy read_kitchen_stations on kitchen_stations;
create policy read_kitchen_stations on kitchen_stations for select to authenticated using (is_staff());
