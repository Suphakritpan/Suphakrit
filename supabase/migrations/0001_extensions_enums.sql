-- ============================================================================
-- 0001 — Extensions และ ENUM ทั้งหมด
-- ระบบร้านชาบูบุฟเฟต์ Shabu Mood
-- ----------------------------------------------------------------------------
-- หลักการที่ยึดทั้งฐานข้อมูล:
--   1. เงินเก็บเป็น "สตางค์" (integer) เสมอ คอลัมน์ลงท้าย _satang — ห้ามใช้ float
--   2. ราคาและอัตราทุกตัวมาจากตารางตั้งค่า ไม่ hardcode ในโค้ด
--   3. กฎทางธุรกิจบังคับที่ชั้น DB (constraint + trigger + RPC) ไม่ใช่แค่ใน UI
--   4. เวลาใช้ timestamptz เสมอ แสดงผลตาม timezone ใน restaurant_settings
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid(), digest()
create extension if not exists citext;     -- อีเมล/รหัสที่ไม่สนตัวพิมพ์เล็กใหญ่

-- ── บทบาทพนักงาน ────────────────────────────────────────────────────────────
create type staff_role as enum ('owner', 'manager', 'staff', 'kitchen', 'cashier');

-- ── สถานะโต๊ะ ───────────────────────────────────────────────────────────────
-- ข้อ ④: วงจรของโต๊ะต้องแยกจากวงจรของ visit ให้ชัด
--   available → occupied → cleaning → available
create type table_status as enum ('available', 'occupied', 'cleaning', 'reserved', 'disabled');

-- ── สถานะการใช้บริการ (visit) ───────────────────────────────────────────────
-- ข้อ ④: PAID กับ CLOSED ต้องเป็นคนละสถานะ
--   open             = กำลังนั่งกิน สั่งอาหารได้
--   awaiting_payment = กดเช็คบิลแล้ว ล็อกยอด หยุดสั่งเพิ่ม
--   paid             = ชำระครบแล้ว แต่ลูกค้าอาจยังนั่งอยู่ที่โต๊ะ
--   closed           = ปิดรอบเรียบร้อย ออกใบเสร็จแล้ว ลูกค้าลุกจากโต๊ะ → โต๊ะไป cleaning
--   void             = ยกเลิกบิล (ต้องมีเหตุผลและถูกบันทึกลง audit_logs)
create type visit_status as enum ('open', 'awaiting_payment', 'paid', 'closed', 'void');

-- ── สถานะออเดอร์ ────────────────────────────────────────────────────────────
-- ตรงกับที่ออกแบบไว้: รอรับออเดอร์ → กำลังทำ → พร้อมเสิร์ฟ → เสิร์ฟแล้ว
-- สถานะจริงอยู่ที่ "รายจาน" (order_items) เพราะครัวคนละสถานีเสร็จไม่พร้อมกัน
-- ส่วน orders.status เป็นค่า rollup ที่ trigger คำนวณให้
create type order_status as enum ('pending', 'preparing', 'ready', 'served', 'cancelled');

-- ── คิวหน้าร้าน ─────────────────────────────────────────────────────────────
create type queue_status as enum ('waiting', 'called', 'seated', 'cancelled', 'no_show');

-- ── การเรียกพนักงาน ─────────────────────────────────────────────────────────
create type service_request_type as enum
  ('call_staff', 'request_bill', 'refill_water', 'clean_table', 'other');
create type service_request_status as enum ('open', 'acknowledged', 'done', 'cancelled');

-- ── การชำระเงิน ─────────────────────────────────────────────────────────────
create type payment_method as enum ('cash', 'transfer', 'card');
create type payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled', 'refunded');
-- provider แยกจาก method เพื่อให้สลับไป gateway จริงได้โดยไม่ต้องแก้ข้อมูลเก่า
create type payment_provider as enum ('mock_cash', 'mock_promptpay', 'mock_card');
create type payment_mode as enum ('mock', 'live');

-- ── บิล ─────────────────────────────────────────────────────────────────────
create type bill_line_kind as enum
  ('buffet_adult', 'buffet_child', 'add_on', 'a_la_carte', 'discount', 'service_charge', 'vat');

-- ── Add-on ──────────────────────────────────────────────────────────────────
-- ข้อ ①: น้ำรีฟิล 39 บาท เป็น "ข้อมูล" ไม่ใช่ค่าคงที่ในโค้ด
--   per_person = คิดตามจำนวนคนที่เลือก (เช่น น้ำรีฟิล)
--   per_visit  = คิดครั้งเดียวทั้งโต๊ะ
create type addon_charge_basis as enum ('per_person', 'per_visit');

-- ── โปรโมชั่นและแต้ม ────────────────────────────────────────────────────────
create type promotion_type as enum ('percent', 'fixed', 'free_addon');
create type promotion_scope as enum ('bill', 'buffet', 'a_la_carte');
create type loyalty_txn_type as enum ('earn', 'redeem', 'adjust', 'expire');
create type customer_tier as enum ('bronze', 'silver', 'gold');
