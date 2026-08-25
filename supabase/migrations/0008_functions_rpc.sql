-- ============================================================================
-- 0008 — Helper, State machine และ RPC ทั้งหมด
-- ----------------------------------------------------------------------------
-- ที่นี่คือที่ที่กฎทางธุรกิจถูก "บังคับ" จริง ๆ
-- endpoint ฝั่งลูกค้าถูกยิงตรงได้เสมอ กฎที่อยู่แค่ใน UI จึงข้ามได้หมด
-- ============================================================================

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 1 — Helper สำหรับ RLS
-- ════════════════════════════════════════════════════════════════════════════

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active and role in ('owner', 'manager')
  );
$$;

create or replace function current_staff_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from profiles where id = auth.uid() and is_active;
$$;

-- visit ที่เครื่องนี้ถูกผูกไว้ (null ถ้าไม่ใช่เครื่องลูกค้า หรือถูกเพิกถอนแล้ว)
create or replace function current_visit_id()
returns uuid language sql stable security definer set search_path = public as $$
  select d.visit_id
  from visit_devices d
  join visits v on v.id = d.visit_id
  where d.auth_user_id = auth.uid()
    and d.revoked_at is null
    and v.status in ('open', 'awaiting_payment', 'paid')
  order by d.last_seen_at desc
  limit 1;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 2 — ตัวนับรายวัน
-- ════════════════════════════════════════════════════════════════════════════

create or replace function next_counter(p_branch_id uuid, p_key text, p_date date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_date  date;
  v_value integer;
begin
  v_date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);

  insert into daily_counters (branch_id, counter_key, counter_date, current_value)
  values (p_branch_id, p_key, v_date, 1)
  on conflict (branch_id, counter_key, counter_date)
  do update set current_value = daily_counters.current_value + 1
  returning current_value into v_value;

  return v_value;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 3 — ข้อ ④ State machine ของโต๊ะและ visit
-- ════════════════════════════════════════════════════════════════════════════

-- วงจรโต๊ะ: available → occupied → cleaning → available
create or replace function enforce_table_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'available' and new.status in ('occupied', 'reserved', 'cleaning', 'disabled'))
    or (old.status = 'occupied'  and new.status in ('cleaning', 'available'))
    or (old.status = 'cleaning'  and new.status in ('available', 'disabled'))
    or (old.status = 'reserved'  and new.status in ('occupied', 'available', 'disabled'))
    or (old.status = 'disabled'  and new.status in ('available'))
  ) then
    raise exception 'เปลี่ยนสถานะโต๊ะจาก % ไป % ไม่ได้', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_tables_status_transition
  before update of status on tables
  for each row execute function enforce_table_status_transition();

-- วงจร visit: open → awaiting_payment → paid → closed
-- แยก paid (จ่ายครบแล้ว ลูกค้าอาจยังนั่งอยู่) ออกจาก closed (ปิดรอบ ลุกจากโต๊ะแล้ว)
create or replace function enforce_visit_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'open'             and new.status in ('awaiting_payment', 'void'))
    or (old.status = 'awaiting_payment' and new.status in ('open', 'paid', 'void'))
    or (old.status = 'paid'             and new.status in ('closed', 'void'))
  ) then
    raise exception 'เปลี่ยนสถานะ visit จาก % ไป % ไม่ได้', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'void' and coalesce(new.void_reason, '') = '' then
    raise exception 'ยกเลิกบิลต้องระบุเหตุผล (void_reason)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_visits_status_transition
  before update of status on visits
  for each row execute function enforce_visit_status_transition();

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 4 — Rollup สถานะออเดอร์ + ประวัติการเปลี่ยนสถานะ
-- ════════════════════════════════════════════════════════════════════════════

-- orders.status = ความคืบหน้าที่ "ช้าที่สุด" ในบรรดาจานที่ยังไม่ถูกยกเลิก
create or replace function rollup_order_status()
returns trigger language plpgsql as $$
declare
  v_order_id uuid;
  v_new      order_status;
begin
  v_order_id := coalesce(new.order_id, old.order_id);

  select case
           when count(*) filter (where status <> 'cancelled') = 0 then 'cancelled'
           when count(*) filter (where status = 'pending')    > 0 then 'pending'
           when count(*) filter (where status = 'preparing')  > 0 then 'preparing'
           when count(*) filter (where status = 'ready')      > 0 then 'ready'
           else 'served'
         end::order_status
    into v_new
  from order_items where order_id = v_order_id;

  update orders set status = v_new where id = v_order_id and status <> v_new;
  return null;
end;
$$;

create trigger trg_order_items_rollup
  after insert or update of status or delete on order_items
  for each row execute function rollup_order_status();

create or replace function record_order_item_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  insert into order_status_history (order_item_id, from_status, to_status, changed_by)
  values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid());

  return new;
end;
$$;

create trigger trg_order_items_history
  after insert or update of status on order_items
  for each row execute function record_order_item_history();

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 5 — เปิดโต๊ะ (ข้อ ① snapshot ราคา / ข้อ ② หนึ่ง visit หนึ่งแพ็กเกจ)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function open_visit(
  p_table_id         uuid,
  p_package_id       uuid,
  p_adult_count      integer,
  p_child_count      integer default 0,
  p_addons           jsonb   default '[]'::jsonb,   -- [{"add_on_id":"...","quantity":4}]
  p_queue_ticket_id  uuid    default null,
  p_customer_phone   text    default null
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_branch    uuid;
  v_table     public.tables;
  v_package   buffet_packages;
  v_settings  restaurant_settings;
  v_visit     visits;
  v_minutes   integer;
  v_seq       integer;
  v_code      text;
  v_customer  uuid;
  v_addon     jsonb;
  v_addon_row add_ons;
  v_qty       integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่เปิดโต๊ะได้' using errcode = '42501';
  end if;

  v_branch := current_staff_branch();

  select * into v_table from tables where id = p_table_id for update;
  if not found then
    raise exception 'ไม่พบโต๊ะที่ระบุ' using errcode = 'no_data_found';
  end if;
  if v_table.branch_id <> v_branch then
    raise exception 'โต๊ะนี้ไม่ได้อยู่ในสาขาของคุณ' using errcode = '42501';
  end if;
  if v_table.status <> 'available' then
    raise exception 'โต๊ะ % ยังไม่ว่าง (สถานะ %)', v_table.table_number, v_table.status
      using errcode = 'check_violation';
  end if;

  -- ข้อ ②: ต้องระบุแพ็กเกจเดียวเสมอ และต้องเป็นแพ็กเกจที่เปิดใช้อยู่
  select * into v_package from buffet_packages
   where id = p_package_id and branch_id = v_branch and is_active;
  if not found then
    raise exception 'ไม่พบแพ็กเกจบุฟเฟต์ที่เลือก หรือแพ็กเกจถูกปิดใช้งานแล้ว'
      using errcode = 'no_data_found';
  end if;

  if coalesce(p_adult_count, 0) + coalesce(p_child_count, 0) < 1 then
    raise exception 'ต้องมีลูกค้าอย่างน้อย 1 คน' using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_branch;

  -- ข้อ ①: เวลานั่งมาจากแพ็กเกจ ถ้าไม่ตั้งไว้ค่อยใช้ค่า default ของร้าน
  v_minutes := coalesce(v_package.dining_minutes, v_settings.default_dining_minutes);

  if p_customer_phone is not null and length(trim(p_customer_phone)) > 0 then
    insert into customers (branch_id, phone, first_visit_at, last_visit_at)
    values (v_branch, trim(p_customer_phone), now(), now())
    on conflict (branch_id, phone)
      do update set last_visit_at = now()
    returning id into v_customer;
  end if;

  v_seq  := next_counter(v_branch, 'visit_code');
  v_code := v_table.table_number || '-'
         || to_char(now() at time zone v_settings.timezone, 'MMDD') || '-'
         || lpad(v_seq::text, 3, '0');

  insert into visits (
    branch_id, visit_code, table_id, customer_id, package_id,
    package_name_snapshot, package_price_adult_satang, package_price_child_satang,
    adult_count, child_count, opened_by, dining_deadline_at, access_code
  ) values (
    v_branch, v_code, p_table_id, v_customer, p_package_id,
    v_package.name, v_package.price_per_adult_satang, v_package.price_per_child_satang,
    coalesce(p_adult_count, 0), coalesce(p_child_count, 0), auth.uid(),
    now() + make_interval(mins => v_minutes),
    lpad((floor(random() * 1000000))::int::text, 6, '0')
  ) returning * into v_visit;

  -- ข้อ ①: ราคา add-on มาจากตาราง add_ons ไม่ใช่ค่าคงที่ในโค้ด
  for v_addon in select * from jsonb_array_elements(coalesce(p_addons, '[]'::jsonb))
  loop
    select * into v_addon_row from add_ons
     where id = (v_addon->>'add_on_id')::uuid and branch_id = v_branch and is_active;
    if not found then
      raise exception 'ไม่พบ add-on ที่เลือก หรือถูกปิดใช้งานแล้ว' using errcode = 'no_data_found';
    end if;

    v_qty := coalesce((v_addon->>'quantity')::integer,
                      case when v_addon_row.charge_basis = 'per_person'
                           then v_visit.adult_count + v_visit.child_count else 1 end);

    if v_qty <= 0 then
      continue;
    end if;
    if v_addon_row.charge_basis = 'per_person'
       and v_qty > v_visit.adult_count + v_visit.child_count then
      raise exception 'จำนวน add-on "%" (%) มากกว่าจำนวนคนในโต๊ะ (%)',
        v_addon_row.name, v_qty, v_visit.adult_count + v_visit.child_count
        using errcode = 'check_violation';
    end if;

    insert into visit_addons (visit_id, add_on_id, name_snapshot, unit_price_satang, charge_basis, quantity)
    values (v_visit.id, v_addon_row.id, v_addon_row.name, v_addon_row.price_satang,
            v_addon_row.charge_basis, v_qty);
  end loop;

  update tables set status = 'occupied' where id = p_table_id;

  if p_queue_ticket_id is not null then
    update queue_tickets
       set status = 'seated', seated_at = now(), visit_id = v_visit.id
     where id = p_queue_ticket_id and status in ('waiting', 'called');
  end if;

  perform log_audit('visit.open', 'visits', v_visit.id::text, null, to_jsonb(v_visit));

  return v_visit;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 6 — ข้อ ⑤ เข้าโต๊ะผ่าน QR พร้อม rate limit
-- ════════════════════════════════════════════════════════════════════════════

create or replace function join_visit(
  p_session_token   uuid default null,
  p_table_qr_token  uuid default null,
  p_access_code     text default null,
  p_nickname        text default null,
  p_user_agent      text default null
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit     visits;
  v_table     public.tables;
  v_settings  restaurant_settings;
  v_fails     integer;
  v_devices   integer;
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบแบบไม่ระบุตัวตนก่อนสแกน QR' using errcode = '42501';
  end if;

  -- ทางเข้าที่ 1: QR บนสลิป (session token ต่อการมาใช้บริการหนึ่งครั้ง)
  if p_session_token is not null then
    select * into v_visit from visits where session_token = p_session_token;

  -- ทางเข้าที่ 2: QR สติกเกอร์ติดโต๊ะ + รหัส 6 หลักบนสลิป
  elsif p_table_qr_token is not null then
    select * into v_table from tables where qr_token = p_table_qr_token;
    if not found then
      raise exception 'QR ไม่ถูกต้อง' using errcode = 'no_data_found';
    end if;

    select * into v_visit from visits
     where table_id = v_table.id and status in ('open', 'awaiting_payment')
     order by check_in_at desc limit 1;

    if not found then
      insert into visit_access_attempts (table_id, auth_user_id, succeeded)
      values (v_table.id, auth.uid(), false);
      raise exception 'โต๊ะนี้ยังไม่ได้เปิดใช้บริการ กรุณาติดต่อพนักงาน'
        using errcode = 'no_data_found';
    end if;

    select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

    -- ล็อกอยู่หรือยัง
    if v_visit.access_locked_until is not null and v_visit.access_locked_until > now() then
      raise exception 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน'
        using errcode = '42501';
    end if;

    -- นับครั้งที่ผิดในช่วงเวลาที่กำหนด
    select count(*) into v_fails
    from visit_access_attempts
    where visit_id = v_visit.id
      and not succeeded
      and attempted_at > now() - make_interval(mins => v_settings.qr_attempt_window_minutes);

    if v_fails >= v_settings.qr_max_failed_attempts then
      update visits
         set access_locked_until = now() + make_interval(mins => v_settings.qr_attempt_window_minutes)
       where id = v_visit.id;
      raise exception 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน' using errcode = '42501';
    end if;

    if p_access_code is null or v_visit.access_code is distinct from trim(p_access_code) then
      insert into visit_access_attempts (visit_id, table_id, auth_user_id, succeeded)
      values (v_visit.id, v_table.id, auth.uid(), false);
      raise exception 'รหัสเข้าโต๊ะไม่ถูกต้อง' using errcode = '42501';
    end if;
  else
    raise exception 'ต้องระบุ session_token หรือ table_qr_token' using errcode = 'invalid_parameter_value';
  end if;

  if v_visit.id is null then
    raise exception 'QR นี้ใช้ไม่ได้แล้ว' using errcode = 'no_data_found';
  end if;

  -- QR ต้องตายทันทีที่ปิดบิล — ไม่งั้นลูกค้าโต๊ะเก่าสั่งเข้าบิลใหม่ได้
  if v_visit.status <> 'open' then
    raise exception 'รอบการใช้บริการนี้ปิดแล้ว ไม่สามารถสั่งอาหารได้'
      using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  -- ข้อ ⑤: จำกัดจำนวนเครื่องต่อหนึ่งโต๊ะ กัน token รั่วไปถูกใช้เป็นวงกว้าง
  select count(*) into v_devices
  from visit_devices where visit_id = v_visit.id and revoked_at is null;

  if v_devices >= v_settings.qr_max_devices_per_visit
     and not exists (select 1 from visit_devices
                      where visit_id = v_visit.id and auth_user_id = auth.uid()) then
    raise exception 'โต๊ะนี้มีอุปกรณ์เชื่อมต่อครบจำนวนแล้ว กรุณาติดต่อพนักงาน'
      using errcode = 'check_violation';
  end if;

  insert into visit_devices (visit_id, auth_user_id, nickname, user_agent)
  values (v_visit.id, auth.uid(), p_nickname, p_user_agent)
  on conflict (visit_id, auth_user_id)
    do update set last_seen_at = now(), revoked_at = null,
                  nickname = coalesce(excluded.nickname, visit_devices.nickname);

  insert into visit_access_attempts (visit_id, table_id, auth_user_id, succeeded)
  values (v_visit.id, v_visit.table_id, auth.uid(), true);

  return v_visit;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 7 — ข้อ ⑤ สั่งอาหาร พร้อมเพดานและกฎแพ็กเกจ
-- ════════════════════════════════════════════════════════════════════════════

create or replace function place_order(
  p_visit_id uuid,
  p_items    jsonb,          -- [{"menu_item_id":"...","quantity":2,"note":"ไม่ใส่ผัก"}]
  p_note     text default null
)
returns orders
language plpgsql security definer set search_path = public as $$
declare
  v_visit      visits;
  v_settings   restaurant_settings;
  v_order      orders;
  v_device     uuid;
  v_is_staff   boolean;
  v_item       jsonb;
  v_menu       menu_items;
  v_qty        integer;
  v_units      integer := 0;
  v_lines      integer := 0;
  v_seq        integer;
  v_last       timestamptz;
  v_unserved   integer;
  v_deadline   timestamptz;
begin
  v_is_staff := is_staff();

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  -- สิทธิ์: ต้องเป็นเครื่องที่ผูกกับ visit นี้ หรือเป็นพนักงาน
  if not v_is_staff then
    select id into v_device from visit_devices
     where visit_id = p_visit_id and auth_user_id = auth.uid() and revoked_at is null;
    if v_device is null then
      raise exception 'ไม่มีสิทธิ์สั่งอาหารเข้าโต๊ะนี้' using errcode = '42501';
    end if;
  end if;

  if v_visit.status <> 'open' then
    raise exception 'สั่งอาหารไม่ได้: รอบการใช้บริการอยู่ในสถานะ %', v_visit.status
      using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  -- จำกัดเวลา: หยุดรับออเดอร์ก่อนหมดเวลาตามกฎ last order
  v_deadline := v_visit.dining_deadline_at
                - make_interval(mins => v_settings.last_order_minutes_before_end);
  if now() > v_deadline and not v_is_staff then
    raise exception 'หมดเวลาสั่งอาหารแล้ว (สั่งได้ถึง %) กรุณาติดต่อพนักงาน',
      to_char(v_deadline at time zone v_settings.timezone, 'HH24:MI')
      using errcode = 'check_violation';
  end if;

  -- ข้อ ⑤: หน่วงเวลาระหว่างรอบ กันกดยืนยันรัว ๆ
  if not v_is_staff and v_settings.min_seconds_between_orders > 0 then
    select max(created_at) into v_last from orders where visit_id = p_visit_id;
    if v_last is not null
       and now() < v_last + make_interval(secs => v_settings.min_seconds_between_orders) then
      raise exception 'สั่งถี่เกินไป กรุณารอ % วินาทีแล้วลองใหม่',
        ceil(extract(epoch from (v_last + make_interval(secs => v_settings.min_seconds_between_orders)) - now()))
        using errcode = 'check_violation';
    end if;
  end if;

  -- ข้อ ⑤: กันสั่งค้างท่วมครัว
  if not v_is_staff then
    select count(*) into v_unserved from orders
     where visit_id = p_visit_id and status in ('pending', 'preparing', 'ready');
    if v_unserved >= v_settings.max_unserved_orders_per_visit then
      raise exception 'มีออเดอร์ที่ยังไม่ได้เสิร์ฟครบ % รอบแล้ว กรุณารออาหารชุดก่อนหน้า',
        v_settings.max_unserved_orders_per_visit
        using errcode = 'check_violation';
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'ยังไม่ได้เลือกรายการอาหาร' using errcode = 'invalid_parameter_value';
  end if;

  v_seq := coalesce((select max(order_number) from orders where visit_id = p_visit_id), 0) + 1;

  insert into orders (visit_id, order_number, placed_by_device_id, placed_by_staff_id, note)
  values (p_visit_id, v_seq, v_device, case when v_is_staff then auth.uid() end, p_note)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty   := coalesce((v_item->>'quantity')::integer, 0);
    v_lines := v_lines + 1;
    v_units := v_units + v_qty;

    if v_qty <= 0 then
      raise exception 'จำนวนต้องมากกว่า 0' using errcode = 'check_violation';
    end if;

    -- ข้อ ⑤: เพดานต่อเมนู อ่านจากการตั้งค่า ไม่ hardcode
    if v_qty > v_settings.max_qty_per_item then
      raise exception 'สั่งได้สูงสุด % ที่ต่อเมนูต่อรอบ', v_settings.max_qty_per_item
        using errcode = 'check_violation';
    end if;

    select * into v_menu from menu_items
     where id = (v_item->>'menu_item_id')::uuid and branch_id = v_visit.branch_id;
    if not found then
      raise exception 'ไม่พบเมนูที่เลือก' using errcode = 'no_data_found';
    end if;
    if not v_menu.is_available then
      raise exception 'เมนู "%" หมดแล้ว', v_menu.name_th using errcode = 'check_violation';
    end if;

    -- ข้อ ②: ล็อกเมนูตามแพ็กเกจของโต๊ะนี้
    -- เมนูที่ไม่มีแถวใน menu_item_packages เลย = สั่งได้ทุกแพ็กเกจ
    if exists (select 1 from menu_item_packages where menu_item_id = v_menu.id)
       and not exists (
         select 1 from menu_item_packages
         where menu_item_id = v_menu.id and package_id = v_visit.package_id
       ) then
      raise exception 'เมนู "%" สั่งได้เฉพาะแพ็กเกจอื่น ไม่รวมอยู่ในแพ็กเกจ "%"',
        v_menu.name_th, v_visit.package_name_snapshot
        using errcode = 'check_violation';
    end if;

    insert into order_items (
      order_id, menu_item_id, name_snapshot, station_id, quantity,
      is_buffet_included, unit_price_satang, line_total_satang, note
    ) values (
      v_order.id, v_menu.id, v_menu.name_th, v_menu.station_id, v_qty,
      v_menu.is_included_in_buffet,
      case when v_menu.is_included_in_buffet then 0 else v_menu.a_la_carte_price_satang end,
      case when v_menu.is_included_in_buffet then 0 else v_menu.a_la_carte_price_satang * v_qty end,
      nullif(trim(coalesce(v_item->>'note', '')), '')
    );
  end loop;

  -- ข้อ ⑤: เพดานรวมต่อหนึ่งรอบ
  if v_lines > v_settings.max_items_per_order then
    raise exception 'หนึ่งรอบสั่งได้ไม่เกิน % รายการ', v_settings.max_items_per_order
      using errcode = 'check_violation';
  end if;
  if v_units > v_settings.max_units_per_order then
    raise exception 'หนึ่งรอบสั่งได้ไม่เกิน % ที่รวมทุกเมนู', v_settings.max_units_per_order
      using errcode = 'check_violation';
  end if;

  return v_order;
end;
$$;

-- ── เดินสถานะรายจาน ─────────────────────────────────────────────────────────
create or replace function advance_order_item(p_item_id uuid, p_next order_status)
returns order_items
language plpgsql security definer set search_path = public as $$
declare
  v_item order_items;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_item from order_items where id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบรายการอาหาร' using errcode = 'no_data_found';
  end if;

  if not (
       (v_item.status = 'pending'   and p_next in ('preparing', 'cancelled'))
    or (v_item.status = 'preparing' and p_next in ('ready', 'cancelled'))
    or (v_item.status = 'ready'     and p_next in ('served', 'preparing'))
    or (v_item.status = 'served'    and p_next in ('ready'))
  ) then
    raise exception 'เปลี่ยนสถานะจาก % ไป % ไม่ได้', v_item.status, p_next
      using errcode = 'check_violation';
  end if;

  update order_items
     set status     = p_next,
         started_at = case when p_next = 'preparing' then coalesce(started_at, now()) else started_at end,
         ready_at   = case when p_next = 'ready'     then now() else ready_at end,
         served_at  = case when p_next = 'served'    then now() else served_at end
   where id = p_item_id
  returning * into v_item;

  return v_item;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 8 — ข้อ ① คำนวณบิลจากข้อมูลในฐานข้อมูลล้วน ๆ
-- ----------------------------------------------------------------------------
-- ฐานข้อมูลเป็นเจ้าของยอดที่ถูกต้อง (visits.total_satang) เพราะเป็นค่าที่
-- trigger กันจ่ายเกินใช้อ้างอิง ฝั่ง frontend คำนวณได้แต่ใช้เพื่อ "แสดงผล" เท่านั้น
-- ไม่มีตัวเลข 299 / 399 / 39 ปรากฏในฟังก์ชันนี้เลย — ทุกค่ามาจาก snapshot และตาราง
-- ════════════════════════════════════════════════════════════════════════════

create or replace function recalculate_visit_totals(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit     visits;
  v_settings  restaurant_settings;
  v_buffet    integer := 0;
  v_addons    integer := 0;
  v_alacarte  integer := 0;
  v_subtotal  integer := 0;
  v_discount  integer := 0;
  v_base      integer := 0;
  v_service   integer := 0;
  v_vat       integer := 0;
  v_total     integer := 0;
  v_sort      integer := 0;
  r           record;
begin
  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  delete from bill_lines where visit_id = p_visit_id;

  -- 1) ค่าบุฟเฟต์จาก snapshot ที่บันทึกตอนเปิดโต๊ะ
  v_buffet := v_visit.adult_count * v_visit.package_price_adult_satang
            + v_visit.child_count * v_visit.package_price_child_satang;

  if v_visit.adult_count > 0 then
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'buffet_adult',
            v_visit.package_name_snapshot || ' (ผู้ใหญ่)',
            v_visit.adult_count, v_visit.package_price_adult_satang,
            v_visit.adult_count * v_visit.package_price_adult_satang, v_sort);
  end if;

  if v_visit.child_count > 0 then
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'buffet_child',
            v_visit.package_name_snapshot || ' (เด็ก)',
            v_visit.child_count, v_visit.package_price_child_satang,
            v_visit.child_count * v_visit.package_price_child_satang, v_sort);
  end if;

  -- 2) Add-on — ราคามาจาก visit_addons ที่ snapshot จากตาราง add_ons
  for r in select * from visit_addons where visit_id = p_visit_id order by created_at
  loop
    v_addons := v_addons + r.unit_price_satang * r.quantity;
    v_sort   := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'add_on', r.name_snapshot, r.quantity, r.unit_price_satang,
            r.unit_price_satang * r.quantity, v_sort);
  end loop;

  -- 3) อาหารสั่งพิเศษที่ไม่รวมในบุฟเฟต์
  for r in
    select oi.name_snapshot, sum(oi.quantity) as qty, max(oi.unit_price_satang) as price,
           sum(oi.line_total_satang) as total
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.visit_id = p_visit_id
      and not oi.is_buffet_included
      and oi.status <> 'cancelled'
    group by oi.name_snapshot
  loop
    v_alacarte := v_alacarte + r.total;
    v_sort     := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'a_la_carte', r.name_snapshot, r.qty, r.price, r.total, v_sort);
  end loop;

  v_subtotal := v_buffet + v_addons + v_alacarte;

  -- 4) ส่วนลด
  select coalesce(sum(discount_satang), 0) into v_discount
  from visit_promotions where visit_id = p_visit_id;
  v_discount := least(v_discount, v_subtotal);

  for r in select * from visit_promotions where visit_id = p_visit_id
  loop
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'discount', r.name_snapshot, 1, -r.discount_satang, -r.discount_satang, v_sort);
  end loop;

  v_base := v_subtotal - v_discount;

  -- 5) Service charge
  if v_settings.service_charge_enabled and v_settings.service_charge_rate_bp > 0 then
    v_service := round(v_base::numeric * v_settings.service_charge_rate_bp / 10000)::integer;
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'service_charge',
            'Service Charge ' || (v_settings.service_charge_rate_bp / 100.0) || '%',
            1, v_service, v_service, v_sort);
  end if;

  -- 6) VAT — แยกกรณีราคารวมภาษีแล้ว กับกรณีบวกเพิ่ม
  if v_settings.vat_enabled and v_settings.vat_rate_bp > 0 then
    if v_settings.vat_inclusive then
      v_total := v_base + v_service;
      v_vat   := round((v_total::numeric * v_settings.vat_rate_bp)
                       / (10000 + v_settings.vat_rate_bp))::integer;
    else
      v_vat   := round((v_base + v_service)::numeric * v_settings.vat_rate_bp / 10000)::integer;
      v_total := v_base + v_service + v_vat;
    end if;

    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'vat',
            'VAT ' || (v_settings.vat_rate_bp / 100.0) || '%'
              || case when v_settings.vat_inclusive then ' (รวมในราคาแล้ว)' else '' end,
            1, v_vat, case when v_settings.vat_inclusive then 0 else v_vat end, v_sort);
  else
    v_total := v_base + v_service;
  end if;

  update visits
     set subtotal_satang       = v_subtotal,
         discount_satang       = v_discount,
         service_charge_satang = v_service,
         vat_satang            = v_vat,
         total_satang          = v_total
   where id = p_visit_id
  returning * into v_visit;

  return v_visit;
end;
$$;

-- ── กดเช็คบิล: ล็อกยอด หยุดรับออเดอร์ ───────────────────────────────────────
create or replace function request_visit_bill(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
begin
  select * into v_visit from visits where id = p_visit_id;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if not is_staff() and current_visit_id() is distinct from p_visit_id then
    raise exception 'ไม่มีสิทธิ์เช็คบิลโต๊ะนี้' using errcode = '42501';
  end if;

  if v_visit.status = 'open' then
    update visits set status = 'awaiting_payment', billed_at = now() where id = p_visit_id;
  end if;

  return recalculate_visit_totals(p_visit_id);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 9 — ข้อ ③ RPC การชำระเงิน (สร้าง / ยืนยัน / ยกเลิก)
-- ════════════════════════════════════════════════════════════════════════════

-- ยอดคงเหลือที่ยังต้องจ่าย
create or replace function visit_amount_due(p_visit_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select v.total_satang - coalesce(
    (select sum(p.amount_satang) from payments p
      where p.visit_id = v.id and p.status = 'succeeded'), 0)
  from visits v where v.id = p_visit_id;
$$;

create or replace function create_payment(
  p_visit_id  uuid,
  p_method    payment_method,
  p_amount_satang integer,
  p_tendered_satang integer default null,
  p_provider_ref text default null,
  p_payload   jsonb default null
)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_settings restaurant_settings;
  v_due      integer;
  v_provider payment_provider;
  v_payment  payments;
  v_change   integer := 0;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่รับชำระเงินได้' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if v_visit.status not in ('awaiting_payment', 'paid') then
    raise exception 'รับชำระเงินไม่ได้: ต้องกดเช็คบิลก่อน (สถานะปัจจุบัน %)', v_visit.status
      using errcode = 'check_violation';
  end if;

  if p_amount_satang <= 0 then
    raise exception 'ยอดชำระต้องมากกว่า 0' using errcode = 'check_violation';
  end if;

  -- ข้อ ③: กันจ่ายเกินตั้งแต่ตอนสร้างรายการ (trigger จะกันซ้ำอีกชั้นตอนยืนยัน)
  v_due := visit_amount_due(p_visit_id);
  if p_amount_satang > v_due then
    raise exception 'ยอดชำระ % สตางค์ เกินยอดคงเหลือ % สตางค์', p_amount_satang, v_due
      using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  v_provider := case p_method
                  when 'cash'     then 'mock_cash'
                  when 'transfer' then 'mock_promptpay'
                  when 'card'     then 'mock_card'
                end::payment_provider;

  -- เงินสดเท่านั้นที่ยื่นเกินได้ ส่วนที่เกินคือเงินทอน
  if p_method = 'cash' and p_tendered_satang is not null then
    if p_tendered_satang < p_amount_satang then
      raise exception 'เงินที่รับมา (%) น้อยกว่ายอดที่ต้องชำระ (%)', p_tendered_satang, p_amount_satang
        using errcode = 'check_violation';
    end if;
    v_change := p_tendered_satang - p_amount_satang;
  end if;

  insert into payments (
    visit_id, method, provider, amount_satang, tendered_satang, change_satang,
    status, provider_ref, provider_payload, processed_by
  ) values (
    p_visit_id, p_method, v_provider, p_amount_satang,
    case when p_method = 'cash' then p_tendered_satang end, v_change,
    'pending', p_provider_ref, p_payload, auth.uid()
  ) returning * into v_payment;

  perform log_audit('payment.create', 'payments', v_payment.id::text, null, to_jsonb(v_payment));

  return v_payment;
end;
$$;

create or replace function confirm_payment(
  p_payment_id   uuid,
  p_provider_ref text default null,
  p_payload      jsonb default null
)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
  v_before  jsonb;
  v_due     integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบรายการชำระเงิน' using errcode = 'no_data_found';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'รายการนี้ถูกดำเนินการไปแล้ว (สถานะ %)', v_payment.status
      using errcode = 'check_violation';
  end if;

  v_before := to_jsonb(v_payment);

  -- trigger trg_payments_no_overpay จะตรวจยอดรวมอีกชั้นพร้อมล็อกแถว visit
  update payments
     set status = 'succeeded',
         provider_ref = coalesce(p_provider_ref, provider_ref),
         provider_payload = coalesce(p_payload, provider_payload),
         completed_at = now()
   where id = p_payment_id
  returning * into v_payment;

  -- จ่ายครบแล้วจึงเลื่อน visit เป็น paid (ข้อ ④ — ยังไม่ใช่ closed)
  v_due := visit_amount_due(v_payment.visit_id);
  if v_due <= 0 then
    update visits set status = 'paid', paid_at = now()
     where id = v_payment.visit_id and status = 'awaiting_payment';
  end if;

  perform log_audit('payment.confirm', 'payments', v_payment.id::text, v_before, to_jsonb(v_payment));

  return v_payment;
end;
$$;

create or replace function cancel_payment(p_payment_id uuid, p_reason text default null)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
  v_before  jsonb;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบรายการชำระเงิน' using errcode = 'no_data_found';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'ยกเลิกได้เฉพาะรายการที่ยังรอดำเนินการ' using errcode = 'check_violation';
  end if;

  v_before := to_jsonb(v_payment);

  update payments
     set status = 'cancelled', failure_reason = p_reason, completed_at = now()
   where id = p_payment_id
  returning * into v_payment;

  perform log_audit('payment.cancel', 'payments', v_payment.id::text, v_before, to_jsonb(v_payment), p_reason);

  return v_payment;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ส่วนที่ 10 — ข้อ ④ ปิดรอบ และคืนโต๊ะให้ว่าง
-- ════════════════════════════════════════════════════════════════════════════

-- paid → closed, โต๊ะ occupied → cleaning, QR ตายทันที, ให้แต้มลูกค้า
create or replace function close_visit(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_settings restaurant_settings;
  v_points   integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if v_visit.status <> 'paid' then
    raise exception 'ปิดรอบไม่ได้: ต้องชำระเงินครบก่อน (สถานะปัจจุบัน %, คงเหลือ % สตางค์)',
      v_visit.status, visit_amount_due(p_visit_id)
      using errcode = 'check_violation';
  end if;

  update visits
     set status = 'closed',
         check_out_at = now(),
         closed_by = auth.uid(),
         session_token = null,        -- QR เดิมใช้ไม่ได้อีก
         access_code = null
   where id = p_visit_id
  returning * into v_visit;

  -- เพิกถอนอุปกรณ์ทุกเครื่องที่ผูกกับโต๊ะนี้
  update visit_devices set revoked_at = now()
   where visit_id = p_visit_id and revoked_at is null;

  -- ข้อ ④: โต๊ะไป cleaning ก่อน ยังไม่ว่างทันที
  update tables set status = 'cleaning' where id = v_visit.table_id;

  -- ปิดคำร้องที่ค้างอยู่
  update service_requests set status = 'done', resolved_at = now()
   where visit_id = p_visit_id and status in ('open', 'acknowledged');

  -- สะสมแต้มให้ลูกค้า (ถ้าผูกเบอร์ไว้)
  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;
  if v_settings.points_enabled and v_visit.customer_id is not null then
    v_points := floor((v_visit.total_satang / 100.0) / v_settings.points_baht_per_point)::integer;
    if v_points > 0 then
      insert into loyalty_transactions (customer_id, visit_id, type, points, note, created_by)
      values (v_visit.customer_id, p_visit_id, 'earn', v_points,
              'สะสมจากบิล ' || v_visit.visit_code, auth.uid());
    end if;

    update customers
       set total_visits = total_visits + 1,
           total_spend_satang = total_spend_satang + v_visit.total_satang,
           last_visit_at = now(),
           first_visit_at = coalesce(first_visit_at, now())
     where id = v_visit.customer_id;
  end if;

  perform log_audit('visit.close', 'visits', p_visit_id::text, null, to_jsonb(v_visit));

  return v_visit;
end;
$$;

-- ข้อ ④: cleaning → available (พนักงานกดเมื่อเก็บโต๊ะเสร็จ)
create or replace function mark_table_clean(p_table_id uuid)
returns public.tables
language plpgsql security definer set search_path = public as $$
declare
  v_table public.tables;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  update tables set status = 'available'
   where id = p_table_id and status = 'cleaning'
  returning * into v_table;

  if not found then
    raise exception 'โต๊ะนี้ไม่ได้อยู่ในสถานะรอทำความสะอาด' using errcode = 'check_violation';
  end if;

  perform log_audit('table.clean', 'tables', p_table_id::text, null, to_jsonb(v_table));
  return v_table;
end;
$$;

-- ── ปุ่ม "ของหมด" สำหรับพนักงานครัว ─────────────────────────────────────────
-- RLS จำกัดได้แค่ระดับแถว ไม่ใช่ระดับคอลัมน์ ถ้าให้ policy UPDATE กับพนักงานตรง ๆ
-- เขาจะแก้ราคาเมนูได้ด้วย จึงเปิดทางนี้ทางเดียวที่แตะได้เฉพาะ is_available
create or replace function set_menu_item_availability(p_menu_item_id uuid, p_available boolean)
returns menu_items
language plpgsql security definer set search_path = public as $$
declare
  v_item menu_items;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  update menu_items set is_available = p_available
   where id = p_menu_item_id and branch_id = current_staff_branch()
  returning * into v_item;

  if not found then
    raise exception 'ไม่พบเมนูที่ระบุ' using errcode = 'no_data_found';
  end if;

  perform log_audit(
    case when p_available then 'menu_item.restock' else 'menu_item.86' end,
    'menu_items', p_menu_item_id::text, null, jsonb_build_object('is_available', p_available));

  return v_item;
end;
$$;

-- ── ยกเลิกบิล (ต้องมีเหตุผล บันทึก audit เสมอ) ──────────────────────────────
create or replace function void_visit(p_visit_id uuid, p_reason text)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_before jsonb;
begin
  if not is_manager() then
    raise exception 'เฉพาะผู้จัดการเท่านั้นที่ยกเลิกบิลได้' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'ต้องระบุเหตุผลในการยกเลิกบิล' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  v_before := to_jsonb(v_visit);

  update visits
     set status = 'void', void_reason = p_reason, closed_by = auth.uid(),
         check_out_at = now(), session_token = null, access_code = null
   where id = p_visit_id
  returning * into v_visit;

  update visit_devices set revoked_at = now() where visit_id = p_visit_id and revoked_at is null;
  update tables set status = 'cleaning' where id = v_visit.table_id and status = 'occupied';

  perform log_audit('visit.void', 'visits', p_visit_id::text, v_before, to_jsonb(v_visit), p_reason);
  return v_visit;
end;
$$;
