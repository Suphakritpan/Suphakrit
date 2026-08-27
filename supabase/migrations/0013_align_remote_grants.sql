-- ============================================================================
-- 0013 — ปิดสิทธิ์เรียกฟังก์ชันภายใน ให้ตรงกับ production
-- ----------------------------------------------------------------------------
-- ไล่หลัง drift ที่แก้ไปบน production แล้วแต่ยังไม่มีในไฟล์ migration
--
-- end-state ที่ต้องการ: 5 ฟังก์ชันนี้เหลือเฉพาะ postgres / service_role
-- ที่เรียกได้ ทั้งหมดเป็นฟังก์ชันที่ถูกเรียก "จากภายใน RPC อื่น" เท่านั้น
-- ไม่ใช่ปลายทางที่ client ควรยิงตรง
--
--   next_counter             ออกเลขรันรายวัน — ยิงตรงได้ = เลขบิล/เลขคิวเพี้ยน
--   log_audit                เขียน audit log — ยิงตรงได้ = ปลอมประวัติได้
--   bootstrap_staff_profile  ผูกบัญชีเป็นพนักงาน — ยิงตรงได้ = ยกระดับตัวเองเป็นเจ้าของร้าน
--   resolve_visit_token      แปลง token เป็น visit — ยิงตรงได้ = ไล่เดา token
--   recalculate_visit_totals คิดยอดบิลใหม่ — ยิงตรงได้ = ยัดยอดผิดก่อนจ่าย
--
-- ⚠️ ต้อง revoke จาก public ด้วย ไม่ใช่แค่ anon/authenticated
--    Postgres ให้ EXECUTE กับ PUBLIC เป็นค่าเริ่มต้นตอน create function
--    การ revoke เฉพาะ anon/authenticated จึงไม่พอ สิทธิ์ยังตกทอดผ่าน PUBLIC
--
-- รันซ้ำได้ — revoke สิทธิ์ที่ไม่มีอยู่แล้วเป็น no-op
-- ============================================================================

revoke execute on function next_counter(uuid, text, date)
  from public, anon, authenticated;

revoke execute on function log_audit(text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;

revoke execute on function resolve_visit_token(text, boolean)
  from public, anon, authenticated;

revoke execute on function recalculate_visit_totals(uuid)
  from public, anon, authenticated;

-- bootstrap_staff_profile อยู่ใน seed_dev_staff.sql ไม่ใช่ migration
-- จึงอาจไม่มีบน environment ที่ไม่ได้รัน seed ตัวนั้น — ห่อ block ไว้กัน error
do $$
begin
  execute 'revoke execute on function bootstrap_staff_profile(text, text, staff_role, text)
             from public, anon, authenticated';
exception
  when undefined_function then
    raise notice 'ข้าม bootstrap_staff_profile — ยังไม่ได้รัน seed_dev_staff.sql';
end;
$$;

-- ── public_settings ─────────────────────────────────────────────────────────
-- end-state: authenticated มีแค่ SELECT · anon ไม่มีสิทธิ์ใด ๆ
-- (0009 ให้ select กับ authenticated ไว้แล้ว ที่นี่แค่ปิดทางอื่นให้แน่ใจ)
revoke all on public_settings from public, anon;
grant select on public_settings to authenticated;
