-- ============================================================================
-- 0014 — เติมช่องว่างของสายงานจริง: คิว → โต๊ะ → visit → บิล
-- ----------------------------------------------------------------------------
-- ตรวจของเดิมก่อนแล้ว สิ่งที่ "มีอยู่แล้วและไม่แตะ":
--   · place_order() เช็ค is_available อยู่แล้ว (เมนู 86 ระหว่างสั่ง)
--   · advance_order_item() รองรับ pending/preparing → cancelled อยู่แล้ว
--   · cancel_queue_ticket(id, no_show) มีอยู่แล้ว
--
-- ไฟล์นี้เติมเฉพาะที่ขาดจริง 4 เรื่อง:
--   1. บัตรคิวแยกผู้ใหญ่/เด็ก — พนักงานถามตอนออกบัตร ไม่ใช่มาถามซ้ำตอนจัดโต๊ะ
--   2. ระยะผ่อนผันก่อนตัดเป็น no-show — เรียกแล้วยังไม่มา ไม่ควรตัดทิ้งทันที
--   3. get_queue_status() บอกสถานะโต๊ะ + สัญญาณ "ใกล้ถึงคิว"
--   4. แก้จำนวนคนหลังเปิดโต๊ะ โดยไม่ทำลายออเดอร์เดิม
--   5. create_payment() นับใบ pending เข้ายอดที่จองไว้ (กันใบค้าง)
-- ============================================================================

-- ── 1. บัตรคิวแยกผู้ใหญ่/เด็ก ───────────────────────────────────────────────
-- party_size ยังอยู่เป็นยอดรวม เพื่อไม่ให้โค้ดเดิมที่อ่านคอลัมน์นี้พัง
alter table queue_tickets
  add column if not exists adult_count integer not null default 0 check (adult_count >= 0),
  add column if not exists child_count integer not null default 0 check (child_count >= 0);

-- ระยะผ่อนผันหลังเรียกคิว ก่อนที่พนักงานจะตัดเป็น no-show ได้
alter table restaurant_settings
  add column if not exists queue_grace_minutes integer not null default 5
    check (queue_grace_minutes between 0 and 60);

-- ⚠️ เปลี่ยนจำนวนพารามิเตอร์ = create or replace จะสร้าง overload ตัวใหม่
-- ไม่ได้ทับของเดิม ต้อง drop ตัวเก่าทิ้งก่อน ไม่งั้นจะมีสองตัวและเรียกกำกวม
drop function if exists issue_queue_ticket(integer, text, text, text);

create or replace function issue_queue_ticket(
  p_party_size    integer,
  p_customer_name text default null,
  p_phone         text default null,
  p_notes         text default null,
  p_adult_count   integer default null,
  p_child_count   integer default 0
)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_branch  uuid;
  v_number  integer;
  v_adults  integer;
  v_children integer;
  v_row     queue_tickets;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่ออกบัตรคิวได้' using errcode = '42501';
  end if;

  -- ไม่ส่งผู้ใหญ่/เด็กมา = ถือว่าเป็นผู้ใหญ่ทั้งหมด (พฤติกรรมเดิมของ 0011)
  v_children := greatest(coalesce(p_child_count, 0), 0);
  v_adults   := coalesce(p_adult_count, greatest(coalesce(p_party_size, 0) - v_children, 0));

  if v_adults + v_children < 1 then
    raise exception 'จำนวนคนต้องอย่างน้อย 1 ท่าน' using errcode = 'check_violation';
  end if;

  v_branch := current_staff_branch();
  if v_branch is null then
    raise exception 'ไม่พบสาขาของพนักงานคนนี้' using errcode = 'no_data_found';
  end if;

  v_number := next_counter(v_branch, 'queue');

  insert into queue_tickets (
    branch_id, ticket_number, party_size, adult_count, child_count,
    customer_name, phone, notes, created_by
  ) values (
    v_branch, v_number, v_adults + v_children, v_adults, v_children,
    nullif(trim(coalesce(p_customer_name, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning * into v_row;

  perform log_audit('issue_queue_ticket', 'queue_tickets', v_row.id::text,
                    null, to_jsonb(v_row), null);
  return v_row;
end;
$$;

-- ── 2. ตัดเป็น no-show ได้ต่อเมื่อพ้นระยะผ่อนผัน ────────────────────────────
create or replace function cancel_queue_ticket(p_id uuid, p_no_show boolean default false)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_row   queue_tickets;
  v_grace integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_row from queue_tickets where id = p_id;
  if v_row.id is null then
    raise exception 'ไม่พบบัตรคิวนี้' using errcode = 'no_data_found';
  end if;

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
  return v_row;
end;
$$;

-- ── 3. หน้าเช็คคิวของลูกค้า: บอกสถานะโต๊ะ + สัญญาณใกล้ถึงคิว ────────────────
create or replace function get_queue_status(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row       queue_tickets;
  v_ahead     integer;
  v_serving   integer;
  v_available integer;
  v_cleaning  integer;
  v_grace     integer;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'ไม่มี token' using errcode = '42501';
  end if;

  begin
    select * into v_row from queue_tickets where public_token = trim(p_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'บัตรคิวนี้ใช้ไม่ได้' using errcode = '42501';
  end;

  if v_row.id is null then
    raise exception 'ไม่พบบัตรคิวนี้' using errcode = '42501';
  end if;

  select count(*) into v_ahead
    from queue_tickets q
   where q.branch_id    = v_row.branch_id
     and q.ticket_date  = v_row.ticket_date
     and q.status in ('waiting', 'called')
     and q.ticket_number < v_row.ticket_number;

  select max(q.ticket_number) into v_serving
    from queue_tickets q
   where q.branch_id   = v_row.branch_id
     and q.ticket_date = v_row.ticket_date
     and q.status      = 'called';

  -- ลูกค้าที่ยืนรอเห็นภาพว่าโต๊ะกำลังทยอยว่างจริง ไม่ใช่รอลอย ๆ
  select count(*) filter (where status = 'available'),
         count(*) filter (where status = 'cleaning')
    into v_available, v_cleaning
    from public.tables
   where branch_id = v_row.branch_id and is_active;

  select queue_grace_minutes into v_grace
    from restaurant_settings where branch_id = v_row.branch_id;

  return jsonb_build_object(
    'now_serving',     v_serving,
    'ticket_number',   v_row.ticket_number,
    'party_size',      v_row.party_size,
    'adult_count',     v_row.adult_count,
    'child_count',     v_row.child_count,
    'status',          v_row.status,
    'ahead',           coalesce(v_ahead, 0),
    'near_turn',       coalesce(v_ahead, 0) <= 3 and v_row.status = 'waiting',
    'tables_available', coalesce(v_available, 0),
    'tables_cleaning',  coalesce(v_cleaning, 0),
    'grace_minutes',   coalesce(v_grace, 5),
    'created_at',      v_row.created_at,
    'called_at',       v_row.called_at,
    'seated_at',       v_row.seated_at
  );
end;
$$;

-- ── 4. แก้จำนวนคนหลังเปิดโต๊ะ ───────────────────────────────────────────────
/**
 * เพื่อนมาเพิ่มระหว่างมื้อ หรือพนักงานเปิดจำนวนคนผิดแล้วเพิ่งรู้ตอนคิดเงิน
 *
 * ต้องไม่ทำลายออเดอร์เดิม: แตะเฉพาะจำนวนคนกับ add-on ที่คิดตามหัว
 * ราคาแพ็กเกจใช้ราคาที่ snapshot ไว้ตอนเปิดโต๊ะเสมอ ไม่ใช่ราคาปัจจุบัน
 * (ลูกค้าที่นั่งอยู่ก่อนขึ้นราคา ต้องไม่โดนราคาใหม่)
 */
create or replace function adjust_visit_guests(
  p_visit_id uuid,
  p_adults   integer,
  p_children integer default 0
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit  visits;
  v_table  public.tables;
  v_guests integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่แก้จำนวนคนได้' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id;
  if v_visit.id is null then
    raise exception 'ไม่พบรอบการใช้บริการนี้' using errcode = 'no_data_found';
  end if;

  -- แก้ได้เฉพาะตอนยังกินอยู่ ปิดบิลแล้วห้ามแตะ ไม่งั้นยอดที่เก็บไปแล้วจะไม่ตรงบิล
  if v_visit.status <> 'open' then
    raise exception 'แก้จำนวนคนได้เฉพาะรอบที่ยังเปิดอยู่ (สถานะปัจจุบัน %)', v_visit.status
      using errcode = 'check_violation';
  end if;

  v_guests := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if v_guests < 1 then
    raise exception 'จำนวนคนต้องอย่างน้อย 1 ท่าน' using errcode = 'check_violation';
  end if;

  select * into v_table from public.tables where id = v_visit.table_id;
  if v_guests > v_table.capacity then
    raise exception 'จำนวน % ท่าน เกินความจุโต๊ะ % (% ที่นั่ง)',
      v_guests, v_table.table_number, v_table.capacity using errcode = 'check_violation';
  end if;

  update visits
     set adult_count = p_adults,
         child_count = coalesce(p_children, 0),
         updated_at  = now()
   where id = p_visit_id
  returning * into v_visit;

  -- add-on ที่คิดตามหัวต้องขยับตามจำนวนคนใหม่ ส่วนที่คิดครั้งเดียวทั้งโต๊ะไม่ต้องแตะ
  update visit_addons
     set quantity = v_guests
   where visit_id = p_visit_id and charge_basis = 'per_person';

  perform log_audit('adjust_visit_guests', 'visits', p_visit_id::text,
                    jsonb_build_object('adult_count', v_visit.adult_count,
                                       'child_count', v_visit.child_count),
                    jsonb_build_object('adult_count', p_adults,
                                       'child_count', coalesce(p_children, 0)), null);
  return v_visit;
end;
$$;

-- ── 5. กันใบ pending ค้างจากการกดรับชำระซ้ำ ─────────────────────────────────
-- create_payment() คิดยอดคงเหลือจาก visit_amount_due() ซึ่งนับเฉพาะใบ succeeded
-- พนักงานกดซ้ำตอนระบบตอบช้าจึงสร้างใบที่สองเต็มยอดได้ แล้วใบนั้น confirm ไม่ได้ตลอดกาล
-- เงินไม่เคยถูกเก็บเกิน (confirm_payment ตรวจซ้ำอีกชั้น) แต่ใบค้างกวนการกระทบยอด
--
-- แก้ด้วย trigger ตอน INSERT แทนการเขียน create_payment ใหม่ทั้งก้อน
-- เหตุผล: create_payment ยาวเกินร้อยบรรทัดและมีตรรกะเงินทอน/provider ปนอยู่
-- ก๊อปมาแก้ทั้งก้อนเสี่ยงพิมพ์ตกหล่นมากกว่าที่จะได้ประโยชน์
-- trigger นี้เป็นชั้นเดียวกับที่ 0007 ใช้กันจ่ายเกินตอน confirm อยู่แล้ว

/** ยอดที่ "จองไว้แล้ว" = ที่จ่ายสำเร็จ + ที่ยังค้างรอยืนยัน */
create or replace function visit_amount_reserved(p_visit_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_satang), 0)::integer
    from payments
   where visit_id = p_visit_id and status in ('pending', 'succeeded');
$$;

create or replace function trg_payment_reserve_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total    integer;
  v_reserved integer;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select total_satang into v_total from visits where id = new.visit_id;
  v_reserved := visit_amount_reserved(new.visit_id);

  if v_reserved + new.amount_satang > coalesce(v_total, 0) then
    raise exception
      'มีรายการชำระค้างอยู่แล้ว % สตางค์ จากยอดบิล % สตางค์ — ยกเลิกรายการค้างก่อนสร้างใหม่',
      v_reserved, coalesce(v_total, 0)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_reserve_guard on payments;
create trigger payment_reserve_guard
  before insert on payments
  for each row execute function trg_payment_reserve_guard();

revoke execute on function visit_amount_reserved(uuid) from public, anon;
revoke execute on function trg_payment_reserve_guard() from public, anon, authenticated;
grant  execute on function visit_amount_reserved(uuid) to authenticated;
