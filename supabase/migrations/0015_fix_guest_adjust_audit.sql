-- ════════════════════════════════════════════════════════════════════════════
-- 0015 — แก้ audit log ของ adjust_visit_guests ให้บันทึกค่า "ก่อนแก้" จริง
--
-- 0014 เขียนว่า `update ... returning * into v_visit` ก่อนเรียก log_audit
-- ตัวแปร v_visit จึงกลายเป็นค่าใหม่ไปแล้ว ค่าที่ส่งเป็น before คือค่าใหม่ทั้งคู่
-- audit log อ่านได้แค่ new→new ตามรอยไม่ได้ว่าเดิมโต๊ะนี้กี่คน
-- ซึ่งเป็นเหตุผลเดียวที่บันทึกไว้ตั้งแต่แรก (พนักงานแก้จำนวนคนแล้วยอดเปลี่ยน)
--
-- แก้โดยเก็บค่าเดิมใส่ v_before ก่อน update
-- ════════════════════════════════════════════════════════════════════════════

create or replace function adjust_visit_guests(
  p_visit_id uuid,
  p_adults   integer,
  p_children integer default 0
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit  visits;
  v_before jsonb;
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

  v_before := jsonb_build_object('adult_count', v_visit.adult_count,
                                 'child_count', v_visit.child_count);

  v_guests := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if v_guests < 1 then
    raise exception 'จำนวนคนต้องอย่างน้อย 1 ท่าน' using errcode = 'check_violation';
  end if;

  select * into v_table from public.tables where id = v_visit.table_id;
  if v_guests > v_table.capacity then
    raise exception 'จำนวน % ท่าน เกินความจุโต๊ะ % (% ที่นั่ง)',
      v_guests, v_table.table_number, v_table.capacity using errcode = 'check_violation';
  end if;

  -- ตั้งใจไม่ขยับ dining_deadline_at: นาฬิกาเริ่มนับตอนเปิดโต๊ะ
  -- เพื่อนที่มาสมทบกลางมื้อจึงหมดเวลาพร้อมโต๊ะ ไม่ใช่ต่อเวลาให้ทั้งโต๊ะ
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
                    v_before,
                    jsonb_build_object('adult_count', v_visit.adult_count,
                                       'child_count', v_visit.child_count), null);
  return v_visit;
end;
$$;
