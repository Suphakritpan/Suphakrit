-- ════════════════════════════════════════════════════════════════════════════
-- 0022 — ที่เก็บรูปเมนูใน Supabase Storage
--
-- หน้า /admin/menu อัปโหลดรูปขึ้น bucket ชื่อ menu-images แล้วเก็บ URL สาธารณะ
-- ลงคอลัมน์ menu_items.image_url ซึ่งมีมาตั้งแต่ 0003 แต่ไม่เคยมีที่เก็บไฟล์จริง
-- (ก่อนไฟล์นี้ ทั้งโปรเจกต์ไม่มี bucket สักอัน และเมนูทั้ง 64 รายการไม่มีรูปเลย)
--
-- ⚠️ bucket เป็น public โดยตั้งใจ — หน้าเมนูฝั่งลูกค้าเปิดจากเครื่องที่ไม่ได้ล็อกอิน
--    เป็นพนักงาน ถ้าตั้งเป็น private ต้องออก signed URL ทีละรูปทุกครั้งที่โหลดหน้า
--    รูปอาหารไม่ใช่ข้อมูลที่ต้องกัน แต่ "ใครอัปโหลดได้" ต้องกัน จึงคุมที่ฝั่งเขียน
--
-- สิทธิ์เขียนให้เฉพาะ is_manager() ไม่ใช่ is_staff() — ให้ตรงกับหน้า /admin/menu
-- ที่เป็นของผู้จัดการอยู่แล้ว พนักงานครัวกดได้แค่ "ของหมด" ผ่าน RPC ไม่ได้แก้เมนู
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do update set public = true;

-- ── สิทธิ์บนไฟล์ใน bucket นี้ ────────────────────────────────────────────────
-- storage.objects เปิด RLS มาจากโรงงานอยู่แล้ว จึงต้องเขียน policy เองทุกฝั่ง
-- ตั้งชื่อ policy ให้ขึ้นต้นด้วย menu_images_ เพื่อไม่ชนกับ bucket อื่นในอนาคต

drop policy if exists menu_images_read   on storage.objects;
drop policy if exists menu_images_insert on storage.objects;
drop policy if exists menu_images_update on storage.objects;
drop policy if exists menu_images_delete on storage.objects;

-- อ่าน: เปิดให้ทุกคนรวมถึงคนที่ไม่ได้ล็อกอิน เพราะ bucket เป็น public อยู่แล้ว
-- policy นี้ทำให้การเรียกผ่าน API ปกติได้ผลเหมือนกับการเปิด URL สาธารณะตรง ๆ
create policy menu_images_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'menu-images');

create policy menu_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and is_manager());

create policy menu_images_update on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and is_manager())
  with check (bucket_id = 'menu-images' and is_manager());

create policy menu_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images' and is_manager());
