-- ═══════════════════════════════════════════════════════════════════════════
-- SHABU MOOD — Production Database v1
-- 0003: Row Level Security
--
-- โมเดลความปลอดภัยของระบบนี้
--
--   anon (ลูกค้าที่สแกน QR ไม่ได้ล็อกอิน)
--     อ่านได้เฉพาะ "เมนู/แพ็กเกจ/แอดออน" ที่เปิดใช้งานอยู่
--     เข้าถึง visit/order ของตัวเอง "ผ่าน RPC เท่านั้น" (ไฟล์ 0004)
--     → ตารางพวกนั้นจึงไม่มี policy ให้ anon เลย = ยิง REST ตรงไม่ได้
--     นี่คือคำตอบของข้อ "ป้องกันออเดอร์ผิดโต๊ะ" ในเอกสาร
--     เพราะ client ส่ง table_id / visit_id อะไรมาเองไม่ได้ ต้องมี token ที่ถูกต้อง
--
--   authenticated + มีแถวใน staff
--     ทำงานได้ตามบทบาท และเห็นเฉพาะสาขาตัวเอง
--
--   authenticated + เป็นสมาชิก
--     เห็นเฉพาะข้อมูลตัวเอง (โปรไฟล์ ประวัติการมาใช้บริการ แต้ม)
-- ═══════════════════════════════════════════════════════════════════════════

alter table branches             enable row level security;
alter table staff                enable row level security;
alter table customers            enable row level security;
alter table dining_tables        enable row level security;
alter table buffet_packages      enable row level security;
alter table addons               enable row level security;
alter table queue_tickets        enable row level security;
alter table visits               enable row level security;
alter table visit_guests         enable row level security;
alter table visit_addons         enable row level security;
alter table menu_categories      enable row level security;
alter table menu_items           enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table order_status_history enable row level security;
alter table staff_calls          enable row level security;
alter table promotions           enable row level security;
alter table payments             enable row level security;
alter table payment_items        enable row level security;
alter table customer_points      enable row level security;
alter table point_transactions   enable row level security;
alter table audit_logs           enable row level security;

-- ─── เมนู: อ่านได้สาธารณะ ──────────────────────────────────────────────────
-- ลูกค้าต้องดูเมนูได้ก่อนสแกน QR ด้วยซ้ำ

create policy menu_categories_public_read on menu_categories
  for select to anon, authenticated using (is_active);

create policy menu_items_public_read on menu_items
  for select to anon, authenticated using (
    is_available
    and exists (select 1 from menu_categories c where c.id = category_id and c.is_active)
  );

create policy buffet_packages_public_read on buffet_packages
  for select to anon, authenticated using (is_active);

create policy addons_public_read on addons
  for select to anon, authenticated using (is_active);

create policy branches_public_read on branches
  for select to anon, authenticated using (is_active);

-- ─── เมนู: แก้ไขได้เฉพาะ Admin / Manager ───────────────────────────────────

create policy menu_categories_manage on menu_categories
  for all to authenticated
  using (has_role('ADMIN','MANAGER') and branch_id = current_branch_id())
  with check (has_role('ADMIN','MANAGER') and branch_id = current_branch_id());

create policy menu_items_manage on menu_items
  for all to authenticated
  using (
    has_role('ADMIN','MANAGER')
    and exists (select 1 from menu_categories c
                where c.id = category_id and c.branch_id = current_branch_id())
  )
  with check (
    has_role('ADMIN','MANAGER')
    and exists (select 1 from menu_categories c
                where c.id = category_id and c.branch_id = current_branch_id())
  );

create policy buffet_packages_manage on buffet_packages
  for all to authenticated
  using (has_role('ADMIN','MANAGER') and branch_id = current_branch_id())
  with check (has_role('ADMIN','MANAGER') and branch_id = current_branch_id());

create policy addons_manage on addons
  for all to authenticated
  using (has_role('ADMIN','MANAGER') and branch_id = current_branch_id())
  with check (has_role('ADMIN','MANAGER') and branch_id = current_branch_id());

create policy branches_manage on branches
  for all to authenticated
  using (has_role('ADMIN') )
  with check (has_role('ADMIN'));

-- ─── STAFF ─────────────────────────────────────────────────────────────────

create policy staff_read_self on staff
  for select to authenticated using (id = auth.uid());

create policy staff_read_branch on staff
  for select to authenticated
  using (has_role('ADMIN','MANAGER') and branch_id = current_branch_id());

create policy staff_manage on staff
  for all to authenticated
  using (has_role('ADMIN','MANAGER') and branch_id = current_branch_id())
  with check (has_role('ADMIN','MANAGER') and branch_id = current_branch_id());

-- ─── CUSTOMERS ─────────────────────────────────────────────────────────────

create policy customers_self on customers
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy customers_staff_read on customers
  for select to authenticated using (is_staff());

-- ─── DINING TABLES ─────────────────────────────────────────────────────────

create policy dining_tables_staff_read on dining_tables
  for select to authenticated
  using (is_staff() and branch_id = current_branch_id());

create policy dining_tables_staff_update on dining_tables
  for update to authenticated
  using (is_staff() and branch_id = current_branch_id())
  with check (is_staff() and branch_id = current_branch_id());

create policy dining_tables_manage on dining_tables
  for all to authenticated
  using (has_role('ADMIN','MANAGER') and branch_id = current_branch_id())
  with check (has_role('ADMIN','MANAGER') and branch_id = current_branch_id());

-- ─── QUEUE ─────────────────────────────────────────────────────────────────

create policy queue_staff_all on queue_tickets
  for all to authenticated
  using (is_staff() and branch_id = current_branch_id())
  with check (is_staff() and branch_id = current_branch_id());

-- ─── VISITS ────────────────────────────────────────────────────────────────
-- ไม่มี policy ให้ anon โดยเจตนา — ลูกค้าเข้าถึงผ่าน RPC ที่ตรวจ token เท่านั้น

create policy visits_staff_all on visits
  for all to authenticated
  using (is_staff() and branch_id = current_branch_id())
  with check (is_staff() and branch_id = current_branch_id());

create policy visits_member_read on visits
  for select to authenticated
  using (customer_id = auth.uid());

create policy visit_guests_staff_all on visit_guests
  for all to authenticated
  using (is_staff() and exists (select 1 from visits v
         where v.id = visit_id and v.branch_id = current_branch_id()))
  with check (is_staff() and exists (select 1 from visits v
         where v.id = visit_id and v.branch_id = current_branch_id()));

create policy visit_guests_member_read on visit_guests
  for select to authenticated
  using (exists (select 1 from visits v where v.id = visit_id and v.customer_id = auth.uid()));

create policy visit_addons_staff_all on visit_addons
  for all to authenticated
  using (is_staff() and exists (select 1 from visits v
         where v.id = visit_id and v.branch_id = current_branch_id()))
  with check (is_staff() and exists (select 1 from visits v
         where v.id = visit_id and v.branch_id = current_branch_id()));

create policy visit_addons_member_read on visit_addons
  for select to authenticated
  using (exists (select 1 from visits v where v.id = visit_id and v.customer_id = auth.uid()));

-- ─── ORDERS ────────────────────────────────────────────────────────────────
-- ครัวต้องเห็นออเดอร์ทุกโต๊ะในสาขา แต่ไม่ควรยุ่งกับเงิน

create policy orders_staff_read on orders
  for select to authenticated
  using (is_staff() and exists (select 1 from visits v
         where v.id = visit_id and v.branch_id = current_branch_id()));

create policy orders_staff_write on orders
  for all to authenticated
  using (has_role('ADMIN','MANAGER','STAFF','KITCHEN')
         and exists (select 1 from visits v
                     where v.id = visit_id and v.branch_id = current_branch_id()))
  with check (has_role('ADMIN','MANAGER','STAFF','KITCHEN')
         and exists (select 1 from visits v
                     where v.id = visit_id and v.branch_id = current_branch_id()));

create policy orders_member_read on orders
  for select to authenticated
  using (exists (select 1 from visits v where v.id = visit_id and v.customer_id = auth.uid()));

create policy order_items_staff_read on order_items
  for select to authenticated
  using (is_staff() and exists (
    select 1 from orders o join visits v on v.id = o.visit_id
    where o.id = order_id and v.branch_id = current_branch_id()));

create policy order_items_staff_write on order_items
  for all to authenticated
  using (has_role('ADMIN','MANAGER','STAFF','KITCHEN') and exists (
    select 1 from orders o join visits v on v.id = o.visit_id
    where o.id = order_id and v.branch_id = current_branch_id()))
  with check (has_role('ADMIN','MANAGER','STAFF','KITCHEN') and exists (
    select 1 from orders o join visits v on v.id = o.visit_id
    where o.id = order_id and v.branch_id = current_branch_id()));

create policy order_items_member_read on order_items
  for select to authenticated
  using (exists (
    select 1 from orders o join visits v on v.id = o.visit_id
    where o.id = order_id and v.customer_id = auth.uid()));

create policy order_status_history_staff_read on order_status_history
  for select to authenticated
  using (is_staff() and exists (
    select 1 from orders o join visits v on v.id = o.visit_id
    where o.id = order_id and v.branch_id = current_branch_id()));

-- ─── STAFF CALLS ───────────────────────────────────────────────────────────

create policy staff_calls_staff_all on staff_calls
  for all to authenticated
  using (is_staff() and exists (select 1 from visits v
         where v.id = visit_id and v.branch_id = current_branch_id()))
  with check (is_staff() and exists (select 1 from visits v
         where v.id = visit_id and v.branch_id = current_branch_id()));

-- ─── PROMOTIONS ────────────────────────────────────────────────────────────

create policy promotions_read on promotions
  for select to anon, authenticated
  using (
    is_active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
  );

create policy promotions_manage on promotions
  for all to authenticated
  using (has_role('ADMIN','MANAGER') and branch_id = current_branch_id())
  with check (has_role('ADMIN','MANAGER') and branch_id = current_branch_id());

-- ─── PAYMENTS ──────────────────────────────────────────────────────────────
-- KITCHEN ไม่ควรแตะเงิน จึงไม่อยู่ในรายชื่อ

create policy payments_staff_read on payments
  for select to authenticated
  using (is_staff() and exists (select 1 from visits v
         where v.id = visit_id and v.branch_id = current_branch_id()));

create policy payments_cashier_write on payments
  for all to authenticated
  using (has_role('ADMIN','MANAGER','CASHIER')
         and exists (select 1 from visits v
                     where v.id = visit_id and v.branch_id = current_branch_id()))
  with check (has_role('ADMIN','MANAGER','CASHIER')
         and exists (select 1 from visits v
                     where v.id = visit_id and v.branch_id = current_branch_id()));

create policy payments_member_read on payments
  for select to authenticated
  using (exists (select 1 from visits v where v.id = visit_id and v.customer_id = auth.uid()));

create policy payment_items_read on payment_items
  for select to authenticated
  using (exists (
    select 1 from payments p join visits v on v.id = p.visit_id
    where p.id = payment_id
      and (v.branch_id = current_branch_id() and is_staff() or v.customer_id = auth.uid())));

create policy payment_items_write on payment_items
  for all to authenticated
  using (has_role('ADMIN','MANAGER','CASHIER'))
  with check (has_role('ADMIN','MANAGER','CASHIER'));

-- ─── POINTS ────────────────────────────────────────────────────────────────
-- ยอดแต้มแก้มือไม่ได้ ต้องผ่าน point_transactions เท่านั้น (ไม่มี policy insert/update)

create policy customer_points_self_read on customer_points
  for select to authenticated
  using (customer_id = auth.uid() or is_staff());

create policy point_txn_self_read on point_transactions
  for select to authenticated
  using (customer_id = auth.uid() or is_staff());

create policy point_txn_staff_insert on point_transactions
  for insert to authenticated
  with check (has_role('ADMIN','MANAGER','CASHIER'));

-- ─── AUDIT LOGS ────────────────────────────────────────────────────────────
-- อ่านได้เฉพาะผู้บริหาร และ "ไม่มีใครแก้หรือลบได้" แม้แต่ ADMIN
-- ไม่งั้น audit log ก็ไม่มีความหมาย

create policy audit_logs_read on audit_logs
  for select to authenticated
  using (has_role('ADMIN','MANAGER') and branch_id = current_branch_id());
