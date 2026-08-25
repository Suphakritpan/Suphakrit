-- ============================================================================
-- seed_dev_staff.sql — ผูกบัญชีพนักงานเข้ากับ profiles
-- ----------------------------------------------------------------------------
-- แยกจาก seed.sql เพราะไฟล์นี้แตะข้อมูลผู้ใช้ ไม่ควรถูกรันอัตโนมัติทุกครั้ง
--
-- ทำไมไม่ insert เข้า auth.users ตรง ๆ:
--   โครงสร้างตาราง auth.users เป็นของ Supabase และเปลี่ยนได้ตามเวอร์ชัน
--   การเขียนตรงมักพังเงียบ ๆ ตอนอัปเกรด และเสี่ยงมากถ้าเผลอรันกับ production
--   วิธีที่ปลอดภัยคือสร้างผู้ใช้ผ่าน Auth ก่อน แล้วค่อยผูก profile ด้วยสคริปต์นี้
--
-- ขั้นตอน:
--   1) สร้างผู้ใช้ก่อน — เลือกทางใดทางหนึ่ง
--        Supabase Dashboard → Authentication → Users → Add user
--        หรือ  npx supabase auth admin create-user --email owner@shabumood.local --password 'devpassword'
--   2) รันไฟล์นี้:  npx supabase db execute --file supabase/seed_dev_staff.sql
--      (หรือวางใน SQL Editor บน Dashboard)
-- ============================================================================

-- ผูกผู้ใช้ที่มีอยู่แล้วเข้ากับ profile ตามบทบาท
create or replace function bootstrap_staff_profile(
  p_email     text,
  p_full_name text,
  p_role      staff_role,
  p_branch_code text default 'main'
)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_branch  uuid;
  v_profile profiles;
begin
  select id into v_user_id from auth.users where email = lower(trim(p_email));
  if v_user_id is null then
    raise exception
      'ยังไม่มีผู้ใช้อีเมล % ใน auth.users — สร้างผู้ใช้ก่อนแล้วค่อยรันสคริปต์นี้', p_email
      using errcode = 'no_data_found';
  end if;

  select id into v_branch from branches where code = p_branch_code;
  if v_branch is null then
    raise exception 'ไม่พบสาขารหัส % — รัน seed.sql ก่อน', p_branch_code
      using errcode = 'no_data_found';
  end if;

  insert into profiles (id, branch_id, full_name, role)
  values (v_user_id, v_branch, p_full_name, p_role)
  on conflict (id) do update
    set full_name = excluded.full_name,
        role      = excluded.role,
        branch_id = excluded.branch_id,
        is_active = true
  returning * into v_profile;

  raise notice 'ผูกบัญชี % เป็น % เรียบร้อย', p_email, p_role;
  return v_profile;
end;
$$;

revoke execute on function bootstrap_staff_profile(text, text, staff_role, text)
  from authenticated, anon;

-- ── ผูกบัญชีสำหรับ dev ──────────────────────────────────────────────────────
-- แก้อีเมลให้ตรงกับที่สร้างไว้จริง แล้วเอาคอมเมนต์ออก
--
-- select bootstrap_staff_profile('owner@shabumood.local',   'เจ้าของร้าน',   'owner');
-- select bootstrap_staff_profile('manager@shabumood.local', 'ผู้จัดการร้าน', 'manager');
-- select bootstrap_staff_profile('staff@shabumood.local',   'พนักงานเสิร์ฟ', 'staff');
-- select bootstrap_staff_profile('kitchen@shabumood.local', 'พนักงานครัว',   'kitchen');
-- select bootstrap_staff_profile('cashier@shabumood.local', 'แคชเชียร์',     'cashier');
