-- ============================================================================
-- 0011 — ระบบบัตรคิว: ออกบัตร เรียกคิว และหน้าเช็คคิวของลูกค้า
-- ----------------------------------------------------------------------------
-- ตาราง queue_tickets มีมาตั้งแต่ 0004 แต่ไม่เคยมี RPC ให้ใช้งานจริง
-- ไฟล์นี้เติมส่วนที่ขาด:
--
--   พนักงาน → issue_queue_ticket() ออกบัตร · call_queue_ticket() เรียกคิว
--              cancel_queue_ticket() ยกเลิก/ไม่มาตามนัด
--   ลูกค้า  → get_queue_status() ดูคิวตัวเองผ่าน QR บนบัตร โดยไม่ต้องล็อกอิน
--
-- ทำไมลูกค้าต้องไม่ล็อกอิน: คนยืนรอหน้าร้านยังไม่ได้เป็นลูกค้าของโต๊ะไหน
-- จะให้ anonymous sign-in ก่อนก็เกินจำเป็น ใช้แนวเดียวกับ 0010 คือ
-- anon ล้วน + token ในมือ + ฟังก์ชันตรวจ token เอง ตารางยังปิดสนิทอยู่
-- ============================================================================

-- ── token สำหรับ QR บนบัตรคิว ───────────────────────────────────────────────
-- แยกจาก ticket_number เพราะเลขคิวเดาได้ (A15 ก็ลองยิง A16 ต่อ)
-- ส่วน token เป็น uuid สุ่ม ใครไม่มีบัตรในมือก็เปิดดูคิวคนอื่นไม่ได้
alter table queue_tickets
  add column if not exists public_token uuid not null default gen_random_uuid();

create unique index if not exists queue_tickets_public_token_idx
  on queue_tickets (public_token);

-- ════════════════════════════════════════════════════════════════════════════
-- พนักงาน
-- ════════════════════════════════════════════════════════════════════════════

/**
 * ออกบัตรคิวใบใหม่ — เลขคิวรันรายวันต่อสาขา รีเซ็ตเองทุกเที่ยงคืนตามเวลาไทย
 */
create or replace function issue_queue_ticket(
  p_party_size    integer,
  p_customer_name text default null,
  p_phone         text default null,
  p_notes         text default null
)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid;
  v_number integer;
  v_row    queue_tickets;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่ออกบัตรคิวได้' using errcode = '42501';
  end if;

  if p_party_size is null or p_party_size < 1 then
    raise exception 'จำนวนคนต้องอย่างน้อย 1 ท่าน' using errcode = 'check_violation';
  end if;

  v_branch := current_staff_branch();
  if v_branch is null then
    raise exception 'ไม่พบสาขาของพนักงานคนนี้' using errcode = 'no_data_found';
  end if;

  v_number := next_counter(v_branch, 'queue');

  insert into queue_tickets (
    branch_id, ticket_number, party_size, customer_name, phone, notes, created_by
  ) values (
    v_branch, v_number, p_party_size,
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

/** เรียกคิว — waiting → called */
create or replace function call_queue_ticket(p_id uuid)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare v_row queue_tickets;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  update queue_tickets
     set status = 'called', called_at = now(), updated_at = now()
   where id = p_id and status = 'waiting'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'เรียกคิวนี้ไม่ได้ (อาจถูกเรียก จัดโต๊ะ หรือยกเลิกไปแล้ว)'
      using errcode = 'check_violation';
  end if;
  return v_row;
end;
$$;

/**
 * ยกเลิกคิว — ลูกค้าเปลี่ยนใจ (cancelled) หรือเรียกแล้วไม่มา (no_show)
 * ไม่ลบแถวทิ้ง เพราะ Realtime ส่ง event DELETE โดยไม่กรอง RLS (เหตุผลเดียวกับ 0009)
 */
create or replace function cancel_queue_ticket(p_id uuid, p_no_show boolean default false)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare v_row queue_tickets;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
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

-- ════════════════════════════════════════════════════════════════════════════
-- ลูกค้า — สแกน QR บนบัตรคิว ไม่ต้องล็อกอิน
-- ════════════════════════════════════════════════════════════════════════════

/**
 * เช็คคิวของตัวเองด้วย token จาก QR บนบัตร
 *
 * คืนเฉพาะข้อมูลที่ลูกค้าเจ้าของบัตรควรเห็น — ไม่คืนชื่อหรือเบอร์โทร
 * เพราะ token อาจถูกถ่ายรูปส่งต่อ และคิวใบเดียวไม่ควรเปิดเผย PII ซ้ำ
 *
 * ahead = จำนวนคิวที่ยังไม่ได้ที่นั่ง และมาถึงก่อนใบนี้ (วันเดียวกัน สาขาเดียวกัน)
 */
create or replace function get_queue_status(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row     queue_tickets;
  v_ahead   integer;
  v_serving integer;
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

  -- เลขที่ประกาศเรียกอยู่ตอนนี้ — ลูกค้าเทียบกับเลขบนบัตรตัวเองได้ทันที
  -- เหมือนจอเรียกคิวหน้าร้าน แต่อยู่ในมือถือตัวเอง
  select max(q.ticket_number) into v_serving
    from queue_tickets q
   where q.branch_id   = v_row.branch_id
     and q.ticket_date = v_row.ticket_date
     and q.status      = 'called';

  return jsonb_build_object(
    'now_serving',   v_serving,
    'ticket_number', v_row.ticket_number,
    'party_size',    v_row.party_size,
    'status',        v_row.status,
    'ahead',         coalesce(v_ahead, 0),
    'created_at',    v_row.created_at,
    'called_at',     v_row.called_at,
    'seated_at',     v_row.seated_at
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- สิทธิ์
-- ════════════════════════════════════════════════════════════════════════════

grant execute on function issue_queue_ticket(integer, text, text, text) to authenticated;
grant execute on function call_queue_ticket(uuid)                       to authenticated;
grant execute on function cancel_queue_ticket(uuid, boolean)            to authenticated;

-- หน้าเช็คคิวต้องเปิดให้ anon ล้วน — คนยืนรอหน้าร้านยังไม่มี session ใด ๆ
grant execute on function get_queue_status(text) to anon, authenticated;
