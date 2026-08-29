-- ════════════════════════════════════════════════════════════════════════════
-- 0019 — แก้ด่านของ visit_amount_due() ที่ไม่ทำงานเลยเพราะตรรกะสามค่าของ SQL
--
-- 0018 เขียนด่านไว้ว่า
--     if not (is_staff() or p_visit_id = current_visit_id()) then raise ...
--
-- ผู้เรียกที่ไม่ได้ล็อกอิน (role anon) จะได้
--     is_staff()                        = false
--     current_visit_id()                = null
--     p_visit_id = null                 = null   ← ไม่ใช่ false
--     false or null                     = null
--     not null                          = null
--     if null then                      = ไม่เข้าเงื่อนไข
--
-- ผลคือด่านไม่เคยยิงเลยสำหรับคนที่ควรถูกกันมากที่สุด ทดสอบแล้วยังได้ 200 ตามเดิม
-- แก้ด้วย coalesce ให้ null กลายเป็น false ก่อนเข้า not
-- ════════════════════════════════════════════════════════════════════════════

create or replace function visit_amount_due(p_visit_id uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_due integer;
begin
  -- coalesce ต้องครอบทั้งก้อน — current_visit_id() เป็น null เมื่อผู้เรียกไม่ได้นั่งโต๊ะไหน
  -- ซึ่งทำให้การเปรียบเทียบได้ null แล้ว not null ก็ยังเป็น null ไม่ใช่ true
  if not coalesce(is_staff() or p_visit_id = current_visit_id(), false) then
    raise exception 'ไม่มีสิทธิ์ดูยอดของรอบนี้' using errcode = '42501';
  end if;

  -- สูตรเดิมจาก 0008 ห้ามแก้ — ไม่ตัดค่าติดลบ และคืน null เมื่อไม่พบรอบ
  select v.total_satang - coalesce(
    (select sum(p.amount_satang) from payments p
      where p.visit_id = v.id and p.status = 'succeeded'), 0)
    into v_due
  from visits v where v.id = p_visit_id;

  return v_due;
end;
$$;

-- 0018 revoke จาก anon อย่างเดียวไม่พอ สิทธิ์ execute ติดมาจาก PUBLIC ตั้งแต่ตอน create
-- ต้องถอนจาก PUBLIC ด้วยถึงจะหมดจริง แล้วค่อยคืนให้เฉพาะผู้ใช้ที่ล็อกอิน
--
-- ลูกค้าที่สแกน QR นับเป็น authenticated (anonymous sign-in ออก JWT role นี้ให้)
-- จึงยังเรียกได้ตามปกติ และถูกจำกัดด้วยด่านข้างบนให้ดูได้เฉพาะรอบของตัวเอง
revoke execute on function visit_amount_due(uuid) from public;
revoke execute on function visit_amount_due(uuid) from anon;
grant  execute on function visit_amount_due(uuid) to authenticated;
