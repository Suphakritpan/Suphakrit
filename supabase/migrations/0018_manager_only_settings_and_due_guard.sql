-- ════════════════════════════════════════════════════════════════════════════
-- 0018 — ปิดช่องอ่านข้อมูลที่ RLS ยังเปิดกว้างเกินหน้าที่
--
-- สองเรื่องที่เจอตอนรีวิวทั้งโปรเจ็ค ทั้งคู่เป็นเรื่อง "อ่าน" ไม่ใช่ "เขียน"
-- (การเขียนถูกกันครบแล้วตั้งแต่ 0009 — เทสต์ E2E ยืนยันว่า waiter แก้อะไรไม่ได้เลย)
--
--   ① restaurant_settings ตัวดิบเปิดให้พนักงานทุกคนอ่าน ซึ่งมี promptpay_id กับ tax_id
--     ทั้งที่มี view public_settings ที่ตัดคอลัมน์พวกนี้ออกไว้ให้อยู่แล้ว
--
--   ② visit_amount_due() ไม่มีด่านในตัวเลย ใครถือ UUID ของรอบไหนก็อ่านยอดค้างของรอบนั้นได้
--     ต่อให้ไม่ได้นั่งโต๊ะนั้นและไม่ใช่พนักงาน
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① ตั้งค่าร้านตัวดิบ = เฉพาะผู้จัดการ ────────────────────────────────────
--
-- ตรวจแล้วว่าไม่มีหน้าจอไหนพัง: ตารางดิบถูกอ่านที่เดียวคือ admin.loadSettings()
-- ซึ่งเป็นหน้าตั้งค่าของผู้จัดการ ส่วนหน้าจออื่น (ลูกค้า ครัว หน้าร้าน)
-- อ่านผ่าน view public_settings ที่ไม่มีคอลัมน์อ่อนไหวอยู่แล้ว
drop policy if exists staff_read_settings on restaurant_settings;

create policy manager_read_settings on restaurant_settings
  for select using (is_manager());

-- ── ② ยอดค้างของรอบ — ต้องเป็นพนักงาน หรือเป็นเจ้าของโต๊ะนั้นเอง ─────────────
-- ⚠️ สูตรคิดยอดต้องเหมือนเดิมทุกตัวอักษร แก้เฉพาะการเพิ่มด่านข้างหน้าเท่านั้น
--    ห้ามตัดค่าติดลบทิ้ง (จ่ายเกินต้องเห็นเป็นติดลบเหมือนเดิม)
--    และไม่พบรอบต้องคืน null เหมือนเดิม ไม่ใช่โยน error — create_payment() พึ่งพฤติกรรมนี้อยู่
create or replace function visit_amount_due(p_visit_id uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_due integer;
begin
  -- ลูกค้ารู้ UUID ของรอบตัวเองอยู่แล้ว (หน้าจอใช้เรียกดูยอดของโต๊ะตัวเอง)
  -- แต่ต้องไม่ให้เอา UUID ของโต๊ะอื่นมาถามได้
  if not (is_staff() or p_visit_id = current_visit_id()) then
    raise exception 'ไม่มีสิทธิ์ดูยอดของรอบนี้' using errcode = '42501';
  end if;

  select v.total_satang - coalesce(
    (select sum(p.amount_satang) from payments p
      where p.visit_id = v.id and p.status = 'succeeded'), 0)
    into v_due
  from visits v where v.id = p_visit_id;

  return v_due;
end;
$$;

-- ผู้เรียกภายใน (create_payment, confirm_payment, close_visit) บังคับ is_staff() อยู่ก่อนแล้ว
-- ส่วนฝั่งลูกค้าเข้าผ่าน token ซึ่ง current_visit_id() คืนรอบของตัวเอง จึงผ่านด่านนี้ตามปกติ
revoke execute on function visit_amount_due(uuid) from anon;
grant  execute on function visit_amount_due(uuid) to authenticated;
