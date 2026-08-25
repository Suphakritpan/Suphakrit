-- ============================================================================
-- 0010 — ทางเข้าสำรองด้วย token ล้วน (ไม่ต้องเปิด Anonymous sign-in)
-- ----------------------------------------------------------------------------
-- แนวคิดนี้หยิบมาจากดีไซน์อีกชุดที่เขียนคู่ขนานกัน (เก็บไว้ที่ supabase/_archive_alt_design/)
--
-- ทางเข้าหลักของระบบยังเป็น anonymous sign-in + visit_devices + RLS ตามเดิม
-- เพราะเป็นทางเดียวที่ลูกค้าจะใช้ Supabase Realtime ได้จริง
--
-- แต่ถ้าโปรเจกต์เปิด Anonymous sign-in ไม่ได้ (นโยบายองค์กร หรือกลัว user งอก)
-- ยังมีทางนี้ให้ใช้: ลูกค้าเป็น anon ล้วน ส่ง access_token เข้ามาใน RPC
-- ฟังก์ชันตรวจ token เองทั้งหมด และตาราง visits/orders ไม่มี policy ให้ anon เลย
-- → ยิง REST ตรงไม่ได้ ต้องผ่าน 4 ฟังก์ชันนี้เท่านั้น
--
-- ⚠️ ข้อแลกเปลี่ยนที่ต้องรู้: ทางนี้ลูกค้า "ไม่ได้ realtime"
--    Realtime postgres_changes ตรวจ RLS ตาม role ที่เชื่อมเข้ามา
--    anon ที่ไม่มี policy บน orders/order_items จะไม่ได้รับ event ใด ๆ
--    หน้าติดตามออเดอร์จึงต้อง poll ด้วย get_visit_orders() ทุก ๆ 5–10 วินาทีแทน
-- ============================================================================

-- ── ตรวจ token แล้วคืน visit ────────────────────────────────────────────────
create or replace function resolve_visit_token(p_token text, p_require_open boolean default true)
returns visits
language plpgsql stable security definer set search_path = public as $$
declare
  v_visit visits;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'ไม่มี token' using errcode = '42501';
  end if;

  begin
    select * into v_visit from visits where session_token = trim(p_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'token ไม่ถูกต้อง' using errcode = '42501';
  end;

  if v_visit.id is null then
    raise exception 'QR นี้ใช้ไม่ได้แล้ว' using errcode = '42501';
  end if;

  -- ปิดบิลแล้ว token ถูกล้างเป็น null อยู่แล้ว แต่กันไว้อีกชั้น
  if p_require_open and v_visit.status <> 'open' then
    raise exception 'รอบการใช้บริการนี้ปิดแล้ว' using errcode = 'check_violation';
  end if;

  return v_visit;
end;
$$;

-- ── ดูข้อมูลโต๊ะและยอดเงิน ──────────────────────────────────────────────────
create or replace function get_visit_by_token(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_visit visits;
  v_table public.tables;
begin
  v_visit := resolve_visit_token(p_token, false);
  select * into v_table from public.tables where id = v_visit.table_id;

  return jsonb_build_object(
    'visit_id',        v_visit.id,
    'visit_code',      v_visit.visit_code,
    'table_number',    v_table.table_number,
    'status',          v_visit.status,
    'package_name',    v_visit.package_name_snapshot,
    'package_id',      v_visit.package_id,
    'adult_count',     v_visit.adult_count,
    'child_count',     v_visit.child_count,
    'check_in_at',     v_visit.check_in_at,
    'deadline_at',     v_visit.dining_deadline_at,
    'subtotal_satang', v_visit.subtotal_satang,
    'total_satang',    v_visit.total_satang
  );
end;
$$;

-- ── ติดตามสถานะอาหาร (ใช้ poll แทน realtime) ────────────────────────────────
create or replace function get_visit_orders(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_visit visits;
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
                        'name',     oi.name_snapshot,
                        'quantity', oi.quantity,
                        'status',   oi.status,
                        'note',     oi.note
                      ) order by oi.created_at)
               from order_items oi where oi.order_id = o.id
             )
           ) order by o.order_number)
    from orders o where o.visit_id = v_visit.id
  ), '[]'::jsonb);
end;
$$;

-- ── สั่งอาหารด้วย token ─────────────────────────────────────────────────────
-- ใช้ place_order() ตัวเดิมเป็นแกน จึงได้กฎครบทุกข้อโดยไม่ต้องเขียนซ้ำ:
-- จำกัดเวลา, last order, เพดานต่อเมนู/ต่อรอบ, หน่วงเวลา, ออเดอร์ค้าง, ล็อกแพ็กเกจ
create or replace function place_order_by_token(p_token text, p_items jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_order orders;
begin
  v_visit := resolve_visit_token(p_token, true);
  v_order := place_order(v_visit.id, p_items, p_note);

  return jsonb_build_object(
    'order_id',     v_order.id,
    'order_number', v_order.order_number,
    'status',       v_order.status
  );
end;
$$;

-- ── เรียกพนักงานด้วย token ──────────────────────────────────────────────────
create or replace function call_staff_by_token(
  p_token   text,
  p_type    service_request_type default 'call_staff',
  p_message text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_req   service_requests;
begin
  v_visit := resolve_visit_token(p_token, false);

  -- unique index idx_service_requests_one_open_per_type กันกดรัวอยู่แล้ว
  -- ถ้ามีใบเปิดค้างประเภทเดียวกัน ให้คืนใบเดิมแทนที่จะ error ใส่หน้าลูกค้า
  select * into v_req from service_requests
   where visit_id = v_visit.id and type = p_type and status = 'open';

  if not found then
    insert into service_requests (visit_id, table_id, type, message)
    values (v_visit.id, v_visit.table_id, p_type, p_message)
    returning * into v_req;
  end if;

  return jsonb_build_object('request_id', v_req.id, 'status', v_req.status, 'type', v_req.type);
end;
$$;

-- ── สิทธิ์ ──────────────────────────────────────────────────────────────────
-- เปิดให้ anon เฉพาะ 4 ฟังก์ชันนี้ ตัว resolve_visit_token ไม่เปิด (เป็น internal)
revoke execute on function resolve_visit_token(text, boolean) from public, anon, authenticated;

grant execute on function get_visit_by_token(text)                                to anon, authenticated;
grant execute on function get_visit_orders(text)                                  to anon, authenticated;
grant execute on function place_order_by_token(text, jsonb, text)                 to anon, authenticated;
grant execute on function call_staff_by_token(text, service_request_type, text)   to anon, authenticated;

comment on function place_order_by_token(text, jsonb, text) is
  'ทางเข้าสำรองเมื่อเปิด Anonymous sign-in ไม่ได้ — ไม่มี realtime ต้อง poll get_visit_orders()';
