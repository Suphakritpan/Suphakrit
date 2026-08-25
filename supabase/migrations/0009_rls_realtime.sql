-- ============================================================================
-- 0009 — Row Level Security, สิทธิ์การเรียก RPC และ Realtime
-- ----------------------------------------------------------------------------
-- ผู้ใช้ที่ล็อกอินมีสองชนิด แยกด้วย helper จาก 0008
--   พนักงาน      → มีแถวใน profiles          → is_staff() / is_manager()
--   เครื่องลูกค้า → anonymous auth ที่ผูก visit → current_visit_id()
--
-- หลักการ: ลูกค้าเขียนข้อมูลตรง ๆ ไม่ได้เลย ต้องผ่าน RPC ที่ตรวจกฎครบก่อนเสมอ
-- ============================================================================

alter table branches              enable row level security;
alter table restaurant_settings   enable row level security;
alter table profiles              enable row level security;
alter table kitchen_stations      enable row level security;
alter table daily_counters        enable row level security;
alter table audit_logs            enable row level security;
alter table buffet_packages       enable row level security;
alter table add_ons               enable row level security;
alter table menu_categories       enable row level security;
alter table menu_items            enable row level security;
alter table menu_item_packages    enable row level security;
alter table zones                 enable row level security;
alter table tables                enable row level security;
alter table queue_tickets         enable row level security;
alter table customers             enable row level security;
alter table visits                enable row level security;
alter table visit_addons          enable row level security;
alter table visit_devices         enable row level security;
alter table visit_access_attempts enable row level security;
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table order_status_history  enable row level security;
alter table service_requests      enable row level security;
alter table promotions            enable row level security;
alter table visit_promotions      enable row level security;
alter table bill_lines            enable row level security;
alter table payments              enable row level security;
alter table loyalty_transactions  enable row level security;

-- ════════════════════════════════════════════════════════════════════════════
-- ข้อมูลอ้างอิงที่ลูกค้าต้องเห็นเพื่อสั่งอาหาร (อ่านอย่างเดียว)
-- ════════════════════════════════════════════════════════════════════════════

create policy read_menu_categories on menu_categories
  for select to authenticated using (true);
create policy manage_menu_categories on menu_categories
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_menu_items on menu_items
  for select to authenticated using (true);
create policy manage_menu_items on menu_items
  for all to authenticated using (is_manager()) with check (is_manager());
-- พนักงานครัวกดปุ่ม "ของหมด" ได้ แต่แก้ราคาไม่ได้
-- หมายเหตุ: RLS จำกัดเป็นราย "แถว" ไม่ใช่ราย "คอลัมน์" — ถ้าให้ policy UPDATE กับ
-- พนักงานตรง ๆ เขาจะแก้ราคาได้ด้วย จึงต้องบังคับผ่าน RPC set_menu_item_availability()
-- ที่แก้ได้เฉพาะคอลัมน์ is_available เท่านั้น

create policy read_menu_item_packages on menu_item_packages
  for select to authenticated using (true);
create policy manage_menu_item_packages on menu_item_packages
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_buffet_packages on buffet_packages
  for select to authenticated using (true);
create policy manage_buffet_packages on buffet_packages
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_add_ons on add_ons
  for select to authenticated using (true);
create policy manage_add_ons on add_ons
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_kitchen_stations on kitchen_stations
  for select to authenticated using (true);
create policy manage_kitchen_stations on kitchen_stations
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_zones on zones for select to authenticated using (is_staff());
create policy manage_zones on zones for all to authenticated
  using (is_manager()) with check (is_manager());

-- ลูกค้าเห็นข้อมูลโต๊ะได้เฉพาะโต๊ะที่ตัวเองนั่งอยู่
create policy read_tables on tables
  for select to authenticated using (
    is_staff()
    or id = (select table_id from visits where id = current_visit_id())
  );
create policy manage_tables on tables
  for all to authenticated using (is_manager()) with check (is_manager());
create policy staff_update_table_status on tables
  for update to authenticated using (is_staff()) with check (is_staff());

-- การตั้งค่าร้าน: ตารางจริงเปิดให้เฉพาะพนักงาน เพราะมีข้อมูลอ่อนไหว
-- (promptpay_id, tax_id, legal_name) ที่ไม่ควรหลุดไปอยู่ใน bundle ฝั่งลูกค้า
create policy staff_read_settings on restaurant_settings
  for select to authenticated using (is_staff());
create policy manage_settings on restaurant_settings
  for all to authenticated using (is_manager()) with check (is_manager());

-- ลูกค้าอ่านได้เฉพาะคอลัมน์ที่จำเป็นต่อการสั่งอาหาร ผ่าน view นี้เท่านั้น
-- view ไม่ได้ตั้ง security_invoker จึงรันด้วยสิทธิ์เจ้าของ = ข้าม RLS ของตารางต้นทาง
-- ทำให้เลือก "เปิดเฉพาะคอลัมน์ที่ปลอดภัย" ได้จริง โดยตารางจริงยังปิดสนิทอยู่
create view public_settings as
  select branch_id,
         display_name,
         logo_url,
         timezone,
         default_dining_minutes,
         last_order_minutes_before_end,
         max_qty_per_item,
         max_items_per_order,
         max_units_per_order,
         min_seconds_between_orders,
         max_unserved_orders_per_visit,
         vat_enabled,
         vat_rate_bp,
         vat_inclusive,
         service_charge_enabled,
         service_charge_rate_bp,
         points_enabled,
         points_baht_per_point,
         payment_mode
  from restaurant_settings;

grant select on public_settings to authenticated;

create policy read_branches on branches for select to authenticated using (true);
create policy manage_branches on branches for all to authenticated
  using (is_manager()) with check (is_manager());

-- ════════════════════════════════════════════════════════════════════════════
-- พนักงาน
-- ════════════════════════════════════════════════════════════════════════════

create policy read_own_profile on profiles
  for select to authenticated using (id = auth.uid() or is_staff());
create policy manage_profiles on profiles
  for all to authenticated using (is_manager()) with check (is_manager());

create policy staff_read_queue on queue_tickets
  for select to authenticated using (is_staff());
create policy staff_write_queue on queue_tickets
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_customers on customers
  for select to authenticated using (is_staff());
create policy staff_write_customers on customers
  for all to authenticated using (is_staff()) with check (is_staff());

create policy manager_read_audit on audit_logs
  for select to authenticated using (is_manager());

create policy staff_read_counters on daily_counters
  for select to authenticated using (is_staff());

create policy manage_promotions on promotions
  for all to authenticated using (is_manager()) with check (is_manager());
create policy staff_read_promotions on promotions
  for select to authenticated using (is_staff());

-- ════════════════════════════════════════════════════════════════════════════
-- visits — ลูกค้าเห็นได้เฉพาะรอบของตัวเอง และแก้ไขอะไรไม่ได้เลย
-- ════════════════════════════════════════════════════════════════════════════

create policy read_own_visit on visits
  for select to authenticated using (is_staff() or id = current_visit_id());
create policy staff_write_visits on visits
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_visit_addons on visit_addons
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_visit_addons on visit_addons
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_devices on visit_devices
  for select to authenticated using (
    is_staff() or auth_user_id = auth.uid() or visit_id = current_visit_id()
  );
create policy staff_write_devices on visit_devices
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_access_attempts on visit_access_attempts
  for select to authenticated using (is_staff());

-- ════════════════════════════════════════════════════════════════════════════
-- ออเดอร์ — ลูกค้า "อ่านได้" แต่ "เขียนตรงไม่ได้"
-- ต้องผ่าน place_order() ที่ตรวจเวลา เพดาน และกฎแพ็กเกจครบก่อนเท่านั้น
-- ════════════════════════════════════════════════════════════════════════════

create policy read_own_orders on orders
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_orders on orders
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_order_items on order_items
  for select to authenticated using (
    is_staff()
    or order_id in (select id from orders where visit_id = current_visit_id())
  );
create policy staff_write_order_items on order_items
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_order_history on order_status_history
  for select to authenticated using (is_staff());

-- ── เรียกพนักงาน: ลูกค้าสร้างได้เฉพาะของโต๊ะตัวเอง ──────────────────────────
create policy read_own_service_requests on service_requests
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy create_own_service_request on service_requests
  for insert to authenticated with check (
    visit_id = current_visit_id()
    and table_id = (select table_id from visits where id = current_visit_id())
  );
create policy staff_write_service_requests on service_requests
  for all to authenticated using (is_staff()) with check (is_staff());

-- ════════════════════════════════════════════════════════════════════════════
-- เงิน — ลูกค้าอ่านบิลของตัวเองได้ แต่แตะ payments ไม่ได้เลย
-- ════════════════════════════════════════════════════════════════════════════

create policy read_own_bill_lines on bill_lines
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_bill_lines on bill_lines
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_visit_promotions on visit_promotions
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_visit_promotions on visit_promotions
  for all to authenticated using (is_staff()) with check (is_staff());

-- ลูกค้าเห็นได้แค่ว่าจ่ายไปเท่าไหร่แล้ว แต่สร้าง/แก้ไม่ได้ (ข้อ ③ ผ่าน RPC เท่านั้น)
create policy read_own_payments on payments
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_payments on payments
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_loyalty on loyalty_transactions
  for select to authenticated using (is_staff());
create policy staff_write_loyalty on loyalty_transactions
  for all to authenticated using (is_staff()) with check (is_staff());

-- ════════════════════════════════════════════════════════════════════════════
-- สิทธิ์เรียก RPC
-- ════════════════════════════════════════════════════════════════════════════

-- ลูกค้าเรียกได้: เข้าโต๊ะ / สั่งอาหาร / ขอเช็คบิล
grant execute on function join_visit(uuid, uuid, text, text, text)  to authenticated;
grant execute on function place_order(uuid, jsonb, text)            to authenticated;
grant execute on function request_visit_bill(uuid)                  to authenticated;
grant execute on function current_visit_id()                        to authenticated;
grant execute on function visit_amount_due(uuid)                    to authenticated;

-- เฉพาะพนักงาน (ฟังก์ชันตรวจ is_staff() ในตัวอยู่แล้ว)
grant execute on function open_visit(uuid, uuid, integer, integer, jsonb, uuid, text) to authenticated;
grant execute on function advance_order_item(uuid, order_status)    to authenticated;
grant execute on function recalculate_visit_totals(uuid)            to authenticated;
grant execute on function create_payment(uuid, payment_method, integer, integer, text, jsonb) to authenticated;
grant execute on function confirm_payment(uuid, text, jsonb)        to authenticated;
grant execute on function cancel_payment(uuid, text)                to authenticated;
grant execute on function close_visit(uuid)                         to authenticated;
grant execute on function mark_table_clean(uuid)                    to authenticated;
grant execute on function void_visit(uuid, text)                    to authenticated;
grant execute on function set_menu_item_availability(uuid, boolean) to authenticated;
grant execute on function is_staff()                                to authenticated;
grant execute on function is_manager()                              to authenticated;

-- next_counter/log_audit ถูกเรียกจากภายใน RPC อื่นเท่านั้น ไม่เปิดให้ client
revoke execute on function next_counter(uuid, text, date) from authenticated, anon;
revoke execute on function log_audit(text, text, text, jsonb, jsonb, text) from authenticated, anon;

-- ปิดประตู anon ทั้งหมด — ลูกค้าต้อง anonymous sign-in ให้เป็น authenticated ก่อน
revoke all on all tables in schema public from anon;

-- ════════════════════════════════════════════════════════════════════════════
-- Realtime
-- ----------------------------------------------------------------------------
-- ⚠️ Realtime ส่ง event DELETE โดยไม่กรองด้วย RLS (payload มีแค่ primary key)
--    ตารางกลุ่มนี้จึงต้องใช้การเปลี่ยน status แทนการลบแถวเสมอ
-- ════════════════════════════════════════════════════════════════════════════

alter publication supabase_realtime add table visits;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table service_requests;
alter publication supabase_realtime add table tables;
alter publication supabase_realtime add table queue_tickets;
alter publication supabase_realtime add table payments;

-- ส่งค่าเดิมมาด้วยเวลามี UPDATE เพื่อให้ฝั่ง client เทียบสถานะก่อน/หลังได้
alter table visits           replica identity full;
alter table orders           replica identity full;
alter table order_items      replica identity full;
alter table service_requests replica identity full;
alter table tables           replica identity full;
alter table queue_tickets    replica identity full;
