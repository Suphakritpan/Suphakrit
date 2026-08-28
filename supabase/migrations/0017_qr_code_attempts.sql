-- ════════════════════════════════════════════════════════════════════════════
-- 0017 — ทำให้การนับรหัสผิดของ QR ติดโต๊ะทำงานจริง
--
-- ปัญหา: join_visit() insert แถวลง visit_access_attempts แล้ว raise exception
--        ทันทีในฟังก์ชันเดียวกัน — Postgres ไม่มี autonomous transaction
--        การ raise จึง rollback แถวที่เพิ่ง insert ไปด้วยเสมอ
--        ผลคือตาราง visit_access_attempts มีแต่แถว succeeded = true
--        ตัวนับ v_fails จึงได้ 0 ทุกครั้ง และ qr_max_failed_attempts
--        กับ access_locked_until เป็น dead code — เดารหัส 6 หลักได้ไม่จำกัดครั้ง
--
-- แก้: ทางเข้าด้วย QR ติดโต๊ะ + รหัส ใช้ฟังก์ชันใหม่ที่ "ไม่ raise" เมื่อรหัสผิด
--      แต่คืน jsonb {ok:false, error:...} เพื่อให้ transaction commit
--      แถวที่บันทึกความพยายามจึงอยู่รอด แล้วการล็อกก็ทำงานตามที่ออกแบบไว้
--      กรณีรหัสถูกยังส่งต่อให้ join_visit() ตัวเดิม กฎเพดานอุปกรณ์จึงอยู่ที่เดียว
-- ════════════════════════════════════════════════════════════════════════════

create or replace function join_visit_with_code(
  p_table_qr_token uuid,
  p_access_code    text,
  p_nickname       text default null,
  p_user_agent     text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table    public.tables;
  v_visit    visits;
  v_settings restaurant_settings;
  v_fails    integer;
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบแบบไม่ระบุตัวตนก่อนสแกน QR' using errcode = '42501';
  end if;

  select * into v_table from tables where qr_token = p_table_qr_token;
  if not found then
    -- ไม่มีโต๊ะให้ผูกความพยายามนี้ และไม่มีอะไรให้เดาต่อ — ตอบตรง ๆ ได้
    raise exception 'QR ไม่ถูกต้อง' using errcode = 'no_data_found';
  end if;

  select * into v_visit from visits
   where table_id = v_table.id and status in ('open', 'awaiting_payment')
   order by check_in_at desc limit 1;

  if not found then
    insert into visit_access_attempts (table_id, auth_user_id, succeeded)
    values (v_table.id, auth.uid(), false);
    return jsonb_build_object('ok', false,
      'error', 'โต๊ะนี้ยังไม่ได้เปิดใช้บริการ กรุณาติดต่อพนักงาน');
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  if v_visit.access_locked_until is not null and v_visit.access_locked_until > now() then
    return jsonb_build_object('ok', false,
      'error', 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน');
  end if;

  select count(*) into v_fails
  from visit_access_attempts
  where visit_id = v_visit.id
    and not succeeded
    and attempted_at > now() - make_interval(mins => v_settings.qr_attempt_window_minutes);

  if v_fails >= v_settings.qr_max_failed_attempts then
    update visits
       set access_locked_until = now() + make_interval(mins => v_settings.qr_attempt_window_minutes)
     where id = v_visit.id;
    return jsonb_build_object('ok', false,
      'error', 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน');
  end if;

  if p_access_code is null or v_visit.access_code is distinct from trim(p_access_code) then
    insert into visit_access_attempts (visit_id, table_id, auth_user_id, succeeded)
    values (v_visit.id, v_table.id, auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'รหัสเข้าโต๊ะไม่ถูกต้อง');
  end if;

  -- รหัสถูก — ส่งต่อให้ทางเข้าปกติ เพดานจำนวนเครื่องกับการผูกอุปกรณ์อยู่ที่นั่นที่เดียว
  return jsonb_build_object('ok', true, 'visit',
    to_jsonb(join_visit(v_visit.session_token, null, null, p_nickname, p_user_agent)));
end;
$$;

revoke execute on function join_visit_with_code(uuid, text, text, text) from public, anon;
grant  execute on function join_visit_with_code(uuid, text, text, text) to authenticated;
