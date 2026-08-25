-- ═══════════════════════════════════════════════════════════════════════════
-- SHABU MOOD — Production Database v1
-- 0004: RPC — ทางเข้าเดียวของลูกค้าที่สแกน QR
--
-- ทำไมต้องใช้ RPC แทนการเปิด RLS ให้ anon
--   ลูกค้าไม่ได้ล็อกอิน ไม่มี auth.uid() ให้ผูกสิทธิ์
--   ถ้าเปิดตาราง visits ให้ anon อ่านโดยกรองด้วย token ที่ client ส่งมา
--   คนที่รู้ REST endpoint ก็ยิง ?select=* ดูทุก visit ทั้งร้านได้
--
--   RPC แบบ SECURITY DEFINER ปิดช่องนี้ทั้งหมด
--   ฟังก์ชันรับ token → ตรวจเอง → คืนเฉพาะข้อมูลของ visit นั้น
--   และบังคับว่า visit ต้อง OPEN อยู่ ไม่งั้นสั่งอาหารไม่ได้
--   (ตรงกับข้อกำหนด "Visit จบแล้ว QR เดิมต้องสั่งอาหารไม่ได้")
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Helper: แปลง token เป็น visit ที่ยังใช้งานได้ ─────────────────────────

create or replace function resolve_visit_token(p_token text, p_require_open boolean default true)
returns visits
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_visit visits%rowtype;
begin
  if p_token is null or length(p_token) < 16 then
    raise exception 'QR ไม่ถูกต้อง' using errcode = '22023';
  end if;

  select * into v_visit from visits where access_token = p_token;

  if not found then
    raise exception 'ไม่พบข้อมูลโต๊ะจาก QR นี้' using errcode = 'P0002';
  end if;

  if p_require_open and v_visit.status <> 'OPEN' then
    raise exception 'รอบการใช้บริการนี้ปิดแล้ว กรุณาติดต่อพนักงาน' using errcode = 'P0001';
  end if;

  if v_visit.status in ('COMPLETED', 'CANCELLED') and not p_require_open then
    -- ยังให้ดูใบเสร็จย้อนหลังได้ แต่สั่งอาหารไม่ได้
    null;
  end if;

  return v_visit;
end;
$$;

-- ─── ลูกค้า: เปิด QR แล้วดูว่าตัวเองอยู่โต๊ะไหน ────────────────────────────

create or replace function get_visit_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visit visits%rowtype;
  v_result jsonb;
begin
  v_visit := resolve_visit_token(p_token, false);

  select jsonb_build_object(
    'visit_id',    v_visit.id,
    'visit_code',  v_visit.visit_code,
    'status',      v_visit.status,
    'party_size',  v_visit.party_size,
    'opened_at',   v_visit.opened_at,
    'table_code',  t.table_code,
    'branch_name', b.name,
    'can_order',   v_visit.status = 'OPEN',
    'guests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'guest_no', g.guest_no, 'package', g.package_name, 'price', g.unit_price)
        order by g.guest_no)
      from visit_guests g where g.visit_id = v_visit.id), '[]'::jsonb),
    'addons', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', a.addon_name, 'price', a.unit_price, 'quantity', a.quantity))
      from visit_addons a where a.visit_id = v_visit.id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'subtotal',       v_visit.subtotal,
      'discount',       v_visit.discount_amount,
      'service_charge', v_visit.service_charge,
      'vat',            v_visit.vat_amount,
      'total',          v_visit.total_amount)
  )
  into v_result
  from dining_tables t
  join branches b on b.id = v_visit.branch_id
  where t.id = v_visit.table_id;

  return v_result;
end;
$$;

-- ─── ลูกค้า: ส่งออเดอร์ ────────────────────────────────────────────────────
-- p_items รูปแบบ: [{"menu_item_id":"uuid","quantity":2,"note":"ไม่ใส่ผัก"}, ...]

create or replace function place_order(p_token text, p_items jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit    visits%rowtype;
  v_order_id uuid;
  v_number   integer;
  v_item     jsonb;
  v_menu     menu_items%rowtype;
  v_qty      smallint;
  v_count    integer := 0;
begin
  v_visit := resolve_visit_token(p_token, true);

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ไม่มีรายการอาหารในออเดอร์' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'สั่งได้สูงสุด 50 รายการต่อครั้ง' using errcode = '22023';
  end if;

  v_number := next_order_number(v_visit.id);

  insert into orders (visit_id, order_number, status, placed_by, note)
  values (v_visit.id, v_number, 'PENDING', 'CUSTOMER', p_note)
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    -- ตรวจว่าเมนูมีจริง เปิดขายอยู่ และอยู่สาขาเดียวกับโต๊ะ
    select mi.* into v_menu
    from menu_items mi
    join menu_categories mc on mc.id = mi.category_id
    where mi.id = (v_item->>'menu_item_id')::uuid
      and mi.is_available
      and mc.is_active
      and mc.branch_id = v_visit.branch_id;

    if not found then
      raise exception 'เมนูนี้ไม่พร้อมให้บริการ (%)', v_item->>'menu_item_id' using errcode = 'P0002';
    end if;

    v_qty := greatest(coalesce((v_item->>'quantity')::smallint, 1), 1);

    if v_menu.max_per_order is not null and v_qty > v_menu.max_per_order then
      raise exception '% สั่งได้สูงสุด % ต่อครั้ง', v_menu.name, v_menu.max_per_order
        using errcode = '22023';
    end if;

    insert into order_items (order_id, menu_item_id, item_name, quantity, note, extra_price)
    values (v_order_id, v_menu.id, v_menu.name, v_qty, nullif(v_item->>'note',''), v_menu.extra_price);

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id, 'order_number', v_number, 'item_count', v_count, 'status', 'PENDING');
end;
$$;

-- ─── ลูกค้า: ติดตามสถานะอาหาร ──────────────────────────────────────────────

create or replace function get_visit_orders(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_visit visits%rowtype;
begin
  v_visit := resolve_visit_token(p_token, false);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'order_id',     o.id,
      'order_number', o.order_number,
      'status',       o.status,
      'created_at',   o.created_at,
      'items', (
        select jsonb_agg(jsonb_build_object(
          'name', oi.item_name, 'quantity', oi.quantity,
          'note', oi.note, 'status', oi.status))
        from order_items oi where oi.order_id = o.id)
    ) order by o.order_number desc)
    from orders o where o.visit_id = v_visit.id
  ), '[]'::jsonb);
end;
$$;

-- ─── ลูกค้า: เรียกพนักงาน ──────────────────────────────────────────────────

create or replace function call_staff(
  p_token  text,
  p_reason call_reason default 'SERVICE',
  p_note   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit visits%rowtype;
  v_id    uuid;
begin
  v_visit := resolve_visit_token(p_token, true);

  -- กันกดรัว ๆ — ถ้ายังมีคำขอค้างอยู่ให้คืนอันเดิม
  select id into v_id from staff_calls
  where visit_id = v_visit.id and reason = p_reason and status = 'PENDING'
  limit 1;

  if found then
    return jsonb_build_object('call_id', v_id, 'status', 'PENDING', 'duplicate', true);
  end if;

  insert into staff_calls (visit_id, table_id, reason, note)
  values (v_visit.id, v_visit.table_id, p_reason, p_note)
  returning id into v_id;

  return jsonb_build_object('call_id', v_id, 'status', 'PENDING', 'duplicate', false);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RPC ฝั่งพนักงาน — ต้องล็อกอินและมีสิทธิ์
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── เปิดโต๊ะ: สร้าง visit + ผู้เข้าใช้บริการรายคน + add-on ในทีเดียว ───────
-- ทำเป็นฟังก์ชันเดียวเพราะถ้าแยกเป็น 3 insert แล้วพังกลางทาง
-- จะได้ visit ที่ไม่มีคน = บิลศูนย์บาท

create or replace function open_visit(
  p_table_id        uuid,
  p_guests          jsonb,              -- [{"buffet_package_id":"uuid","count":3}, ...]
  p_addons          jsonb default '[]', -- [{"addon_id":"uuid","quantity":4}, ...]
  p_queue_ticket_id uuid default null,
  p_customer_id     uuid default null,
  p_note            text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_visit_id  uuid;
  v_token     text;
  v_code      text;
  v_entry     jsonb;
  v_pkg       buffet_packages%rowtype;
  v_addon     addons%rowtype;
  v_guest_no  smallint := 0;
  v_i         integer;
  v_visit     visits%rowtype;
begin
  if not has_role('ADMIN','MANAGER','STAFF','CASHIER') then
    raise exception 'ไม่มีสิทธิ์เปิดโต๊ะ' using errcode = '42501';
  end if;

  select branch_id into v_branch_id from dining_tables
  where id = p_table_id and branch_id = current_branch_id() and is_active;

  if not found then
    raise exception 'ไม่พบโต๊ะนี้ในสาขาของคุณ' using errcode = 'P0002';
  end if;

  if jsonb_array_length(coalesce(p_guests,'[]'::jsonb)) = 0 then
    raise exception 'ต้องระบุจำนวนคนและแพ็กเกจอย่างน้อย 1 รายการ' using errcode = '22023';
  end if;

  -- lock ระดับสาขา+วัน กันพนักงานสองคนเปิดโต๊ะพร้อมกันแล้วได้ visit_code ชนกัน
  perform pg_advisory_xact_lock(hashtext('visit_code' || v_branch_id::text || current_date::text));

  v_code := to_char(now(), 'YYMMDD') || '-' || lpad(
    (coalesce((select count(*) from visits
               where branch_id = v_branch_id and opened_at::date = current_date), 0) + 1)::text, 4, '0');

  insert into visits (branch_id, table_id, queue_ticket_id, customer_id,
                      visit_code, party_size, opened_by, note)
  values (v_branch_id, p_table_id, p_queue_ticket_id, p_customer_id,
          v_code, 1, auth.uid(), p_note)
  returning id, access_token into v_visit_id, v_token;

  -- แตกแพ็กเกจออกเป็นรายคน เพราะร้านคิดเงินต่อคน
  for v_entry in select * from jsonb_array_elements(p_guests) loop
    select * into v_pkg from buffet_packages
    where id = (v_entry->>'buffet_package_id')::uuid
      and branch_id = v_branch_id and is_active;

    if not found then
      raise exception 'ไม่พบแพ็กเกจบุฟเฟต์ที่เลือก' using errcode = 'P0002';
    end if;

    for v_i in 1 .. greatest(coalesce((v_entry->>'count')::int, 1), 1) loop
      v_guest_no := v_guest_no + 1;
      -- snapshot ชื่อกับราคา ณ วินาทีนี้ ขึ้นราคาทีหลังบิลนี้ไม่เปลี่ยน
      insert into visit_guests (visit_id, guest_no, buffet_package_id, package_name, unit_price)
      values (v_visit_id, v_guest_no, v_pkg.id, v_pkg.name, v_pkg.price);
    end loop;
  end loop;

  for v_entry in select * from jsonb_array_elements(coalesce(p_addons,'[]'::jsonb)) loop
    select * into v_addon from addons
    where id = (v_entry->>'addon_id')::uuid and branch_id = v_branch_id and is_active;

    if found then
      insert into visit_addons (visit_id, addon_id, addon_name, unit_price, quantity)
      values (v_visit_id, v_addon.id, v_addon.name, v_addon.price,
              greatest(coalesce((v_entry->>'quantity')::smallint, v_guest_no), 1));
    end if;
  end loop;

  update visits set party_size = v_guest_no where id = v_visit_id;
  perform recalc_visit_totals(v_visit_id);

  if p_queue_ticket_id is not null then
    update queue_tickets set status = 'SEATED', seated_at = now()
    where id = p_queue_ticket_id;
  end if;

  select * into v_visit from visits where id = v_visit_id;

  return jsonb_build_object(
    'visit_id',     v_visit_id,
    'visit_code',   v_code,
    'access_token', v_token,          -- เอาไปทำ QR: /order/{access_token}
    'party_size',   v_guest_no,
    'total_amount', v_visit.total_amount);
end;
$$;

-- ─── ปิดบิล + จำลอง Payment Gateway ────────────────────────────────────────

create or replace function process_payment(
  p_visit_id     uuid,
  p_method       payment_method,
  p_received     numeric default null,
  p_card_last4   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit   visits%rowtype;
  v_pay_id  uuid;
  v_pay_no  text;
  v_ref     text;
  v_sort    smallint := 0;
  v_row     record;
begin
  if not has_role('ADMIN','MANAGER','CASHIER') then
    raise exception 'ไม่มีสิทธิ์รับชำระเงิน' using errcode = '42501';
  end if;

  select * into v_visit from visits
  where id = p_visit_id and branch_id = current_branch_id();

  if not found then
    raise exception 'ไม่พบรอบการใช้บริการนี้' using errcode = 'P0002';
  end if;

  if v_visit.status = 'COMPLETED' then
    raise exception 'บิลนี้ชำระเงินไปแล้ว' using errcode = 'P0001';
  end if;

  perform recalc_visit_totals(p_visit_id);
  select * into v_visit from visits where id = p_visit_id;

  if p_method = 'CASH' and coalesce(p_received, 0) < v_visit.total_amount then
    raise exception 'เงินที่รับมาไม่พอ (รับ % ต้องชำระ %)', p_received, v_visit.total_amount
      using errcode = '22023';
  end if;

  v_pay_no := 'PAY' || to_char(now(), 'YYMMDDHH24MISS') || lpad((random()*99)::int::text, 2, '0');
  v_ref    := 'MOCK-' || upper(encode(gen_random_bytes(6), 'hex'));

  insert into payments (visit_id, payment_number, method, status, amount,
                        received_amount, change_amount, transaction_reference,
                        card_last4, cashier_id, paid_at,
                        gateway_response)
  values (p_visit_id, v_pay_no, p_method, 'PAID', v_visit.total_amount,
          p_received,
          case when p_method = 'CASH' then p_received - v_visit.total_amount end,
          v_ref, p_card_last4, auth.uid(), now(),
          jsonb_build_object('gateway','mock','result','approved','ref',v_ref))
  returning id into v_pay_id;

  -- freeze รายการในใบเสร็จ ต่อให้ราคาต้นทางเปลี่ยนทีหลังใบเสร็จนี้ไม่เปลี่ยน
  for v_row in
    select package_name as description, count(*)::numeric as qty, unit_price
    from visit_guests where visit_id = p_visit_id
    group by package_name, unit_price
  loop
    v_sort := v_sort + 1;
    insert into payment_items (payment_id, line_type, description, quantity, unit_price, amount, sort_order)
    values (v_pay_id, 'BUFFET', v_row.description, v_row.qty, v_row.unit_price,
            v_row.qty * v_row.unit_price, v_sort);
  end loop;

  for v_row in
    select addon_name as description, quantity::numeric as qty, unit_price
    from visit_addons where visit_id = p_visit_id
  loop
    v_sort := v_sort + 1;
    insert into payment_items (payment_id, line_type, description, quantity, unit_price, amount, sort_order)
    values (v_pay_id, 'ADDON', v_row.description, v_row.qty, v_row.unit_price,
            v_row.qty * v_row.unit_price, v_sort);
  end loop;

  if v_visit.discount_amount > 0 then
    v_sort := v_sort + 1;
    insert into payment_items (payment_id, line_type, description, quantity, unit_price, amount, sort_order)
    values (v_pay_id, 'DISCOUNT', 'ส่วนลด', 1, -v_visit.discount_amount, -v_visit.discount_amount, v_sort);
  end if;

  if v_visit.service_charge > 0 then
    v_sort := v_sort + 1;
    insert into payment_items (payment_id, line_type, description, quantity, unit_price, amount, sort_order)
    values (v_pay_id, 'SERVICE_CHARGE', 'Service Charge', 1, v_visit.service_charge, v_visit.service_charge, v_sort);
  end if;

  if v_visit.vat_amount > 0 then
    v_sort := v_sort + 1;
    insert into payment_items (payment_id, line_type, description, quantity, unit_price, amount, sort_order)
    values (v_pay_id, 'VAT', 'VAT', 1, v_visit.vat_amount, v_visit.vat_amount, v_sort);
  end if;

  update visits set status = 'COMPLETED', closed_at = now(), closed_by = auth.uid()
  where id = p_visit_id;

  -- สมาชิกได้แต้ม 1 แต้มต่อ 100 บาท (บิลต่ำกว่า 100 ไม่ต้องบันทึกรายการ 0 แต้ม)
  if v_visit.customer_id is not null and floor(v_visit.total_amount / 100) >= 1 then
    insert into point_transactions (customer_id, visit_id, type, points, balance_after, note, created_by)
    values (v_visit.customer_id, p_visit_id, 'EARN',
            floor(v_visit.total_amount / 100)::int, 0,
            'ได้รับจากบิล ' || v_pay_no, auth.uid());
  end if;

  return jsonb_build_object(
    'payment_id',     v_pay_id,
    'payment_number', v_pay_no,
    'reference',      v_ref,
    'amount',         v_visit.total_amount,
    'change',         case when p_method = 'CASH' then p_received - v_visit.total_amount else 0 end,
    'status',         'PAID');
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- สิทธิ์การเรียกฟังก์ชัน
-- ปิดทั้งหมดก่อน แล้วเปิดทีละตัว — ปลอดภัยกว่าไล่ปิดทีหลัง
-- ═══════════════════════════════════════════════════════════════════════════

-- ต้อง revoke จาก PUBLIC ด้วย ไม่ใช่แค่ anon/authenticated
-- Postgres ให้ EXECUTE แก่ PUBLIC กับทุกฟังก์ชันใหม่โดยอัตโนมัติ
-- ถ้า revoke แค่สอง role นั้น สิทธิ์จาก PUBLIC ยังอยู่ = ยิง RPC ได้ทุกตัวอยู่ดี
revoke execute on all functions in schema public from public, anon, authenticated;

-- ฟังก์ชันที่สร้างเพิ่มในอนาคตก็ต้องปิดโดยปริยายเช่นกัน
alter default privileges in schema public revoke execute on functions from public;

-- ลูกค้าที่สแกน QR (ไม่ได้ล็อกอิน) เรียกได้แค่ 4 ตัวนี้
grant execute on function get_visit_by_token(text)                        to anon, authenticated;
grant execute on function get_visit_orders(text)                          to anon, authenticated;
grant execute on function place_order(text, jsonb, text)                  to anon, authenticated;
grant execute on function call_staff(text, call_reason, text)             to anon, authenticated;

-- พนักงานที่ล็อกอินแล้ว
grant execute on function open_visit(uuid, jsonb, jsonb, uuid, uuid, text) to authenticated;
grant execute on function process_payment(uuid, payment_method, numeric, text) to authenticated;
grant execute on function recalc_visit_totals(uuid)                        to authenticated;
grant execute on function next_queue_number(uuid)                          to authenticated;
grant execute on function current_staff_role()                             to authenticated;
grant execute on function current_branch_id()                              to authenticated;
grant execute on function is_staff()                                       to authenticated;

-- resolve_visit_token ไม่ grant ให้ใคร — เป็น helper ภายในเท่านั้น
-- ถ้าเปิดให้เรียกตรง จะได้ข้อมูล visit ดิบทั้งแถวรวม access_token ของโต๊ะอื่น
