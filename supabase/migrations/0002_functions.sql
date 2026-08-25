-- ═══════════════════════════════════════════════════════════════════════════
-- SHABU MOOD — Production Database v1
-- 0002: Functions & Triggers
--
-- กฎเหล็ก: ยอดเงินคำนวณในฐานข้อมูลเท่านั้น ห้าม client ส่ง total มาให้เชื่อ
-- ไม่งั้นแก้ค่าใน DevTools แล้วจ่าย 1 บาทได้
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── updated_at อัตโนมัติ ──────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'branches','staff','customers','dining_tables','buffet_packages','addons',
    'queue_tickets','visits','menu_categories','menu_items','orders','order_items',
    'promotions','payments'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
       for each row execute function set_updated_at()', t, t);
  end loop;
end;
$$;

-- ─── RLS Helpers ───────────────────────────────────────────────────────────
-- ต้องเป็น SECURITY DEFINER เพื่ออ่านตาราง staff โดยไม่ติด RLS ของตัวเอง
-- ถ้าไม่ใส่จะเกิด infinite recursion ตอน policy เรียกใช้

create or replace function current_staff_role()
returns staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from staff where id = auth.uid() and is_active;
$$;

create or replace function current_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from staff where id = auth.uid() and is_active;
$$;

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from staff where id = auth.uid() and is_active);
$$;

-- รับเป็น text[] ไม่ใช่ staff_role[] โดยตั้งใจ
-- เพราะเรียกแบบ has_role('ADMIN','MANAGER') แล้ว Postgres จะ resolve
-- string literal เป็น unknown → text ได้ตรง ๆ ถ้าประกาศเป็น enum[]
-- จะเจอ "function has_role(unknown, unknown) does not exist" ตอนสร้าง policy
create or replace function has_role(variadic roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from staff
    where id = auth.uid() and is_active and role::text = any(roles)
  );
$$;

-- ─── คำนวณยอดเงินของ Visit ─────────────────────────────────────────────────
-- subtotal = ผลรวมแพ็กเกจของทุกคน + add-on + ของที่คิดเพิ่ม
-- แล้วหักส่วนลด บวก service charge บวก VAT ตามลำดับ

create or replace function recalc_visit_totals(p_visit_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit    visits%rowtype;
  v_branch   branches%rowtype;
  v_promo    promotions%rowtype;
  v_guests   numeric(10,2);
  v_addons   numeric(10,2);
  v_extras   numeric(10,2);
  v_subtotal numeric(10,2);
  v_discount numeric(10,2) := 0;
  v_service  numeric(10,2);
  v_vat      numeric(10,2);
  v_net      numeric(10,2);
begin
  select * into v_visit from visits where id = p_visit_id;
  if not found then return; end if;

  select * into v_branch from branches where id = v_visit.branch_id;

  -- 1. บุฟเฟต์ต่อคน — หัวใจของการคิดเงินร้านนี้
  select coalesce(sum(unit_price), 0) into v_guests
  from visit_guests where visit_id = p_visit_id;

  -- 2. Add-on (น้ำรีฟิล ชีส ไอศกรีม)
  select coalesce(sum(unit_price * quantity), 0) into v_addons
  from visit_addons where visit_id = p_visit_id;

  -- 3. เมนูที่คิดเงินเพิ่มนอกบุฟเฟต์ ปกติเป็น 0
  select coalesce(sum(oi.extra_price * oi.quantity), 0) into v_extras
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.visit_id = p_visit_id
    and o.status <> 'CANCELLED'
    and oi.status <> 'CANCELLED';

  v_subtotal := v_guests + v_addons + v_extras;

  -- 4. ส่วนลดจากโปรโมชั่น
  if v_visit.promotion_id is not null then
    select * into v_promo from promotions where id = v_visit.promotion_id;
    if found and v_promo.is_active and v_subtotal >= v_promo.min_amount then
      if v_promo.discount_type = 'PERCENT' then
        v_discount := round(v_subtotal * v_promo.discount_value / 100, 2);
        if v_promo.max_discount is not null then
          v_discount := least(v_discount, v_promo.max_discount);
        end if;
      else
        v_discount := v_promo.discount_value;
      end if;
      v_discount := least(v_discount, v_subtotal);   -- ห้ามลดจนติดลบ
    end if;
  end if;

  v_net     := v_subtotal - v_discount;
  v_service := round(v_net * coalesce(v_branch.service_charge_rate, 0), 2);
  v_vat     := round((v_net + v_service) * coalesce(v_branch.vat_rate, 0), 2);

  update visits set
    subtotal        = v_subtotal,
    discount_amount = v_discount,
    service_charge  = v_service,
    vat_amount      = v_vat,
    total_amount    = v_net + v_service + v_vat
  where id = p_visit_id;
end;
$$;

-- Trigger ทุกจุดที่กระทบยอดเงิน
-- แยก TG_OP ชัด ๆ แทนการใช้ coalesce(new.x, old.x)
-- เพราะบน DELETE ตัวแปร NEW ไม่ถูก assign การอ้าง NEW.visit_id เสี่ยงพังตอน runtime
create or replace function trg_recalc_visit()
returns trigger
language plpgsql
as $$
declare v_visit_id uuid;
begin
  if tg_op = 'DELETE' then
    v_visit_id := old.visit_id;
  else
    v_visit_id := new.visit_id;
  end if;

  perform recalc_visit_totals(v_visit_id);

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger visit_guests_recalc
  after insert or update or delete on visit_guests
  for each row execute function trg_recalc_visit();

create trigger visit_addons_recalc
  after insert or update or delete on visit_addons
  for each row execute function trg_recalc_visit();

-- order_items ไม่มี visit_id ตรง ๆ ต้อง join ผ่าน orders
create or replace function trg_recalc_visit_from_order_item()
returns trigger
language plpgsql
as $$
declare
  v_order_id uuid;
  v_visit_id uuid;
begin
  if tg_op = 'DELETE' then
    v_order_id := old.order_id;
  else
    v_order_id := new.order_id;
  end if;

  select visit_id into v_visit_id from orders where id = v_order_id;
  if v_visit_id is not null then
    perform recalc_visit_totals(v_visit_id);
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger order_items_recalc
  after insert or update or delete on order_items
  for each row execute function trg_recalc_visit_from_order_item();

-- เปลี่ยนโปรโมชั่นบน visit ก็ต้องคิดใหม่
create or replace function trg_recalc_on_promo_change()
returns trigger
language plpgsql
as $$
begin
  if new.promotion_id is distinct from old.promotion_id then
    perform recalc_visit_totals(new.id);
  end if;
  return new;
end;
$$;

create trigger visits_promo_recalc
  after update of promotion_id on visits
  for each row execute function trg_recalc_on_promo_change();

-- ─── Running numbers ───────────────────────────────────────────────────────

create or replace function next_queue_number(p_branch_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_next integer;
begin
  -- lock ระดับ branch+วัน กันสองเครื่องกดพร้อมกันแล้วได้เลขคิวชนกัน
  perform pg_advisory_xact_lock(hashtext(p_branch_id::text || current_date::text));
  select coalesce(max(queue_number), 0) + 1 into v_next
  from queue_tickets
  where branch_id = p_branch_id and queue_date = current_date;
  return v_next;
end;
$$;

create or replace function next_order_number(p_visit_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_visit_id::text));
  select coalesce(max(order_number), 0) + 1 into v_next
  from orders where visit_id = p_visit_id;
  return v_next;
end;
$$;

-- ─── บันทึกประวัติการเปลี่ยนสถานะ Order ────────────────────────────────────

create or replace function trg_log_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into order_status_history (order_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into order_status_history (order_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger orders_log_status
  after insert or update of status on orders
  for each row execute function trg_log_order_status();

-- ─── สถานะโต๊ะเปลี่ยนตาม Visit อัตโนมัติ ───────────────────────────────────
-- กันพนักงานลืมกด แล้วโต๊ะค้างสถานะผิด

create or replace function trg_sync_table_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update dining_tables set status = 'OCCUPIED' where id = new.table_id;

  elsif new.status is distinct from old.status then
    if new.status = 'COMPLETED' then
      -- ปิดบิลแล้วโต๊ะยังใช้ไม่ได้ ต้องเก็บกวาดก่อน
      update dining_tables set status = 'CLEANING' where id = new.table_id;
    elsif new.status = 'CANCELLED' then
      update dining_tables set status = 'AVAILABLE' where id = new.table_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger visits_sync_table
  after insert or update of status on visits
  for each row execute function trg_sync_table_status();

-- ─── แต้มสมาชิก ────────────────────────────────────────────────────────────
-- point_transactions คือ ledger ที่เป็นความจริง
-- customer_points เป็นแค่ยอดสรุปที่ trigger เขียนให้ ห้ามแก้มือ

create or replace function trg_apply_point_txn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current integer;
  v_balance integer;
begin
  insert into customer_points (customer_id, balance, lifetime_earned)
  values (new.customer_id, 0, 0)
  on conflict (customer_id) do nothing;

  select balance into v_current from customer_points
  where customer_id = new.customer_id for update;

  -- ต้องเช็คก่อน update ไม่ใช่หลัง
  -- ถ้าปล่อยให้ update แล้วชน check (balance >= 0) ลูกค้าจะเห็น error ดิบของ Postgres
  if v_current + new.points < 0 then
    raise exception 'แต้มไม่พอ: มี % แต้ม ต้องใช้ % แต้ม', v_current, abs(new.points)
      using errcode = 'P0001';
  end if;

  update customer_points
  set balance         = balance + new.points,
      lifetime_earned = lifetime_earned + greatest(new.points, 0),
      updated_at      = now()
  where customer_id = new.customer_id
  returning balance into v_balance;

  new.balance_after := v_balance;
  return new;
end;
$$;

-- BEFORE เพื่อให้เขียน balance_after ลงแถวได้เลย
create trigger point_txn_apply
  before insert on point_transactions
  for each row execute function trg_apply_point_txn();

-- ─── Audit log สำหรับรายการที่ละเอียดอ่อน ──────────────────────────────────

create or replace function trg_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_branch uuid;
begin
  v_branch := current_branch_id();

  insert into audit_logs (branch_id, actor_id, action, entity_type, entity_id, before_data, after_data)
  values (
    v_branch,
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(new.id, old.id),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger payments_audit
  after insert or update or delete on payments
  for each row execute function trg_audit();

create trigger visits_audit
  after update or delete on visits
  for each row execute function trg_audit();

create trigger buffet_packages_audit
  after update or delete on buffet_packages
  for each row execute function trg_audit();

-- ─── Realtime ──────────────────────────────────────────────────────────────
-- ลูกค้าเห็นสถานะอาหารเปลี่ยนทันที / ครัวเห็นออเดอร์ใหม่ทันที

alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table staff_calls;
alter publication supabase_realtime add table dining_tables;
alter publication supabase_realtime add table queue_tickets;
alter publication supabase_realtime add table visits;
