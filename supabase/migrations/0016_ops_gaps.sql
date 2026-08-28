-- ════════════════════════════════════════════════════════════════════════════
-- 0016 — ปิดช่องโหว่ที่เจอตอนไล่ lifecycle เต็มรอบกับหน้าจอจริง
--
--   ① ปิดรอบไม่ได้ถ้าอาหารยังค้างครัว   — ของเดิมปิดได้ แล้วออเดอร์ค้างจอครัวถาวร
--   ② ครัวยกเลิกรายการได้ พร้อมเหตุผล   — cancelled_reason เคยเป็น dead column
--   ③ ใส่โปรโมชั่นด้วยโค้ดได้จริง        — visit_promotions เคยว่างเปล่าตลอด
--   ④ ยกเลิกคิว / ตัด no-show ถูก audit
--   ⑤ กด 86 แล้ว push ถึงมือถือลูกค้า    — menu_items ไม่เคยอยู่ใน publication
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① ปิดรอบ: ต้องเคลียร์ครัวก่อน ───────────────────────────────────────────
-- ร้านจริงเก็บเงินแล้วลูกค้ากลับบ้าน แต่ครัวยังทำอาหารให้โต๊ะที่ไม่มีคนอยู่
-- และตั๋วนั้นล้างไม่ได้เลยเพราะโต๊ะถูกปล่อยคืนไปแล้ว จึงต้องกันที่ประตูทางออก
create or replace function close_visit(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_settings restaurant_settings;
  v_points   integer;
  v_pending  integer;
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

  select count(*) into v_pending
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.visit_id = p_visit_id
    and oi.status in ('pending', 'preparing', 'ready');

  if v_pending > 0 then
    raise exception 'ปิดรอบไม่ได้: ยังมีอาหารค้างที่ครัว % รายการ — ให้ครัวกดเสิร์ฟหรือยกเลิกก่อน', v_pending
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

-- ── ② ครัวยกเลิกรายการ พร้อมเหตุผล ──────────────────────────────────────────
-- เพิ่มพารามิเตอร์ที่สามแบบมี default ไม่ได้ตรง ๆ เพราะจะกลายเป็น overload
-- แล้ว PostgREST เลือกไม่ถูกเมื่อเรียกด้วยสองอาร์กิวเมนต์ — ต้องทิ้งตัวเก่าก่อน
drop function if exists advance_order_item(uuid, order_status);

create or replace function advance_order_item(
  p_item_id uuid,
  p_next    order_status,
  p_reason  text default null
)
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
    or (v_item.status = 'ready'     and p_next in ('served', 'preparing', 'cancelled'))
    or (v_item.status = 'served'    and p_next in ('ready'))
  ) then
    raise exception 'เปลี่ยนสถานะจาก % ไป % ไม่ได้', v_item.status, p_next
      using errcode = 'check_violation';
  end if;

  update order_items
     set status     = p_next,
         started_at = case when p_next = 'preparing' then coalesce(started_at, now()) else started_at end,
         ready_at   = case when p_next = 'ready'     then now() else ready_at end,
         served_at  = case when p_next = 'served'    then now() else served_at end,
         cancelled_reason = case when p_next = 'cancelled'
                                 then coalesce(nullif(trim(p_reason), ''), 'ยกเลิกโดยพนักงาน')
                                 else cancelled_reason end
   where id = p_item_id
  returning * into v_item;

  -- ยกเลิกอาหารคือรายการที่กระทบบิล ต้องย้อนดูได้ว่าใครยกเลิกเพราะอะไร
  if p_next = 'cancelled' then
    perform log_audit('order_item.cancel', 'order_items', p_item_id::text,
                      null, to_jsonb(v_item), v_item.cancelled_reason);

    -- ของสั่งพิเศษที่ยกเลิกต้องหลุดออกจากบิลด้วย แต่แตะยอดได้เฉพาะบิลที่ยังไม่จ่าย
    -- ถ้าจ่ายไปแล้วยอดจะต่ำกว่าเงินที่รับมา = ต้องคืนเงิน ซึ่งเป็นคนละเรื่อง
    perform recalculate_visit_totals(v.id)
    from visits v
    join orders o on o.visit_id = v.id
    where o.id = v_item.order_id and v.status in ('open', 'awaiting_payment');
  end if;

  return v_item;
end;
$$;

-- ── ③ โปรโมชั่น: ใส่ด้วยโค้ดที่หน้าเช็คบิล ──────────────────────────────────
/**
 * เงื่อนไขทั้งหมดตรวจที่นี่ที่เดียว หน้าจอมีหน้าที่ส่งโค้ดกับแสดงข้อความกลับเท่านั้น
 *
 * ห้ามใส่โปรหลังมีการชำระเงินสำเร็จแล้ว เพราะยอดบิลจะลดลงต่ำกว่าเงินที่รับมา
 * แล้ว trg_payment_reserve_guard กับ enforce_payment_not_exceeding_total จะขัดกันเอง
 */
create or replace function apply_promotion_code(p_visit_id uuid, p_code text)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_promo    promotions;
  v_settings restaurant_settings;
  v_local    timestamptz := now();
  v_dow      smallint;
  v_time     time;
  v_paid     integer;
  v_discount integer := 0;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่ใส่โปรโมชั่นได้' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if v_visit.status not in ('open', 'awaiting_payment') then
    raise exception 'ใส่โปรโมชั่นไม่ได้: รอบนี้อยู่ในสถานะ %', v_visit.status
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount_satang), 0) into v_paid
    from payments where visit_id = p_visit_id and status = 'succeeded';
  if v_paid > 0 then
    raise exception 'ใส่โปรโมชั่นไม่ได้: รับชำระเงินไปแล้ว % สตางค์ — ยกเลิกรายการชำระก่อน', v_paid
      using errcode = 'check_violation';
  end if;

  select * into v_promo from promotions
   where branch_id = v_visit.branch_id
     and upper(code) = upper(trim(coalesce(p_code, '')));
  if not found then
    raise exception 'ไม่พบโค้ดโปรโมชั่นนี้' using errcode = 'no_data_found';
  end if;

  if not v_promo.is_active then
    raise exception 'โปรโมชั่น % ถูกปิดใช้งานอยู่', v_promo.code using errcode = 'check_violation';
  end if;

  if exists (select 1 from visit_promotions
              where visit_id = p_visit_id and promotion_id = v_promo.id) then
    raise exception 'ใส่โปรโมชั่น % ไปแล้ว', v_promo.code using errcode = 'check_violation';
  end if;

  if v_promo.starts_at is not null and v_promo.starts_at > now() then
    raise exception 'โปรโมชั่น % ยังไม่เริ่ม', v_promo.code using errcode = 'check_violation';
  end if;
  if v_promo.ends_at is not null and v_promo.ends_at <= now() then
    raise exception 'โปรโมชั่น % หมดอายุแล้ว', v_promo.code using errcode = 'check_violation';
  end if;

  -- วันและเวลาต้องเทียบด้วยเวลาของร้าน ไม่ใช่ UTC ของเซิร์ฟเวอร์
  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;
  v_dow  := extract(dow  from v_local at time zone coalesce(v_settings.timezone, 'Asia/Bangkok'))::smallint;
  v_time := (v_local at time zone coalesce(v_settings.timezone, 'Asia/Bangkok'))::time;

  if array_length(v_promo.days_of_week, 1) is not null
     and not (v_dow = any (v_promo.days_of_week)) then
    raise exception 'โปรโมชั่น % ใช้ไม่ได้ในวันนี้', v_promo.code using errcode = 'check_violation';
  end if;

  if (v_promo.time_start is not null and v_time < v_promo.time_start)
     or (v_promo.time_end is not null and v_time > v_promo.time_end) then
    raise exception 'โปรโมชั่น % ใช้ได้ช่วง %–% เท่านั้น',
      v_promo.code, v_promo.time_start, v_promo.time_end using errcode = 'check_violation';
  end if;

  if v_promo.max_uses is not null and v_promo.uses_count >= v_promo.max_uses then
    raise exception 'โปรโมชั่น % ถูกใช้ครบจำนวนแล้ว', v_promo.code using errcode = 'check_violation';
  end if;

  -- ยอดที่ใช้เทียบเงื่อนไขต้องเป็นยอดล่าสุด ไม่ใช่ค่าที่ค้างอยู่ในแถว
  v_visit := recalculate_visit_totals(p_visit_id);

  if v_visit.subtotal_satang < v_promo.min_spend_satang then
    raise exception 'โปรโมชั่น % ต้องมียอดขั้นต่ำ % สตางค์ (ยอดปัจจุบัน %)',
      v_promo.code, v_promo.min_spend_satang, v_visit.subtotal_satang
      using errcode = 'check_violation';
  end if;

  v_discount := case v_promo.type
    when 'percent' then round(v_visit.subtotal_satang::numeric * v_promo.value_bp / 10000)::integer
    when 'fixed'   then least(v_promo.value_satang, v_visit.subtotal_satang)
    when 'free_addon' then coalesce(
      (select sum(unit_price_satang * quantity) from visit_addons
        where visit_id = p_visit_id and add_on_id = v_promo.free_add_on_id), 0)
  end;

  insert into visit_promotions (visit_id, promotion_id, name_snapshot, discount_satang, applied_by)
  values (p_visit_id, v_promo.id, v_promo.name, greatest(v_discount, 0), auth.uid());

  update promotions set uses_count = uses_count + 1 where id = v_promo.id;

  perform log_audit('promotion.apply', 'visits', p_visit_id::text, null,
                    jsonb_build_object('code', v_promo.code, 'discount_satang', v_discount),
                    v_promo.name);

  return recalculate_visit_totals(p_visit_id);
end;
$$;

create or replace function remove_visit_promotion(p_visit_id uuid, p_promotion_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_row   visit_promotions;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;
  if v_visit.status not in ('open', 'awaiting_payment') then
    raise exception 'ถอดโปรโมชั่นไม่ได้: รอบนี้อยู่ในสถานะ %', v_visit.status
      using errcode = 'check_violation';
  end if;

  delete from visit_promotions
   where visit_id = p_visit_id and promotion_id = p_promotion_id
  returning * into v_row;

  if v_row.visit_id is null then
    raise exception 'ไม่พบโปรโมชั่นนี้ในบิล' using errcode = 'no_data_found';
  end if;

  update promotions set uses_count = greatest(uses_count - 1, 0) where id = p_promotion_id;

  perform log_audit('promotion.remove', 'visits', p_visit_id::text, to_jsonb(v_row), null);

  return recalculate_visit_totals(p_visit_id);
end;
$$;

-- ── ④ ยกเลิกคิว / no-show ต้องมี audit ──────────────────────────────────────
create or replace function cancel_queue_ticket(p_id uuid, p_no_show boolean default false)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_row    queue_tickets;
  v_before jsonb;
  v_grace  integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_row from queue_tickets where id = p_id;
  if v_row.id is null then
    raise exception 'ไม่พบบัตรคิวนี้' using errcode = 'no_data_found';
  end if;
  v_before := to_jsonb(v_row);

  -- ตัด no-show ได้เฉพาะคิวที่เรียกไปแล้ว และรอครบเวลาผ่อนผันแล้ว
  -- กันพนักงานเผลอกดตัดคิวที่เพิ่งเรียกไปเมื่อสิบวินาทีก่อน
  if p_no_show then
    if v_row.status <> 'called' then
      raise exception 'ตัดเป็นไม่มาตามเรียกได้เฉพาะคิวที่เรียกแล้ว (สถานะปัจจุบัน %)', v_row.status
        using errcode = 'check_violation';
    end if;
    select queue_grace_minutes into v_grace
      from restaurant_settings where branch_id = v_row.branch_id;
    if v_row.called_at + make_interval(mins => coalesce(v_grace, 5)) > now() then
      raise exception 'ยังไม่ครบเวลารอ % นาทีนับจากที่เรียกคิว', coalesce(v_grace, 5)
        using errcode = 'check_violation';
    end if;
  end if;

  update queue_tickets
     set status = case when p_no_show then 'no_show' else 'cancelled' end::queue_status,
         updated_at = now()
   where id = p_id and status in ('waiting', 'called')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'ยกเลิกคิวนี้ไม่ได้ (จัดโต๊ะไปแล้วหรือยกเลิกไปแล้ว)'
      using errcode = 'check_violation';
  end if;

  perform log_audit(case when p_no_show then 'queue.no_show' else 'queue.cancel' end,
                    'queue_tickets', p_id::text, v_before, to_jsonb(v_row));
  return v_row;
end;
$$;

-- ── ⑤ กด 86 แล้วมือถือลูกค้าที่เปิดค้างต้องรู้ทันที ─────────────────────────
do $$
begin
  alter publication supabase_realtime add table menu_items;
exception when duplicate_object then null;
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────
revoke execute on function advance_order_item(uuid, order_status, text)  from public, anon;
revoke execute on function apply_promotion_code(uuid, text)              from public, anon;
revoke execute on function remove_visit_promotion(uuid, uuid)            from public, anon;
grant  execute on function advance_order_item(uuid, order_status, text)  to authenticated;
grant  execute on function apply_promotion_code(uuid, text)              to authenticated;
grant  execute on function remove_visit_promotion(uuid, uuid)            to authenticated;
