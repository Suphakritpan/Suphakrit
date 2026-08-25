// ป้าย สี และไอคอนของสถานะต่าง ๆ — ให้ตรงกับ ENUM ในฐานข้อมูล (migrations/0001)
// tone ใช้กับ <Chip tone="..."> · icon อ้างชื่อจาก components/ui/Icon.jsx

export const ORDER_STATUS = {
  pending:   { label: 'รอรับออเดอร์', tone: 'neutral', next: 'preparing' },
  preparing: { label: 'กำลังทำ',      tone: 'warn',    next: 'ready' },
  ready:     { label: 'พร้อมเสิร์ฟ',   tone: 'info',    next: 'served' },
  served:    { label: 'เสิร์ฟแล้ว',    tone: 'ok',      next: null },
  cancelled: { label: 'ยกเลิก',        tone: 'brand',   next: null },
}

export const ORDER_FLOW = ['pending', 'preparing', 'ready', 'served']

export const TABLE_STATUS = {
  available: { label: 'ว่าง',          tone: 'ok',      cls: 'tcard--available' },
  occupied:  { label: 'กำลังใช้งาน',   tone: 'brand',   cls: 'tcard--occupied' },
  cleaning:  { label: 'รอทำความสะอาด', tone: 'warn',    cls: 'tcard--cleaning' },
  reserved:  { label: 'จองไว้',        tone: 'info',    cls: 'tcard--reserved' },
  disabled:  { label: 'ปิดใช้งาน',     tone: 'neutral', cls: 'tcard--disabled' },
}

// ข้อ ④ — paid กับ closed เป็นคนละสถานะโดยเจตนา
export const VISIT_STATUS = {
  open:             { label: 'กำลังใช้บริการ', tone: 'ok' },
  awaiting_payment: { label: 'รอชำระเงิน',     tone: 'warn' },
  paid:             { label: 'ชำระแล้ว',       tone: 'info' },
  closed:           { label: 'ปิดรอบแล้ว',      tone: 'neutral' },
  void:             { label: 'ยกเลิกบิล',       tone: 'brand' },
}

export const SERVICE_TYPES = {
  call_staff:   { label: 'เรียกพนักงาน', icon: 'bell' },
  request_bill: { label: 'เช็คบิล',       icon: 'receipt' },
  refill_water: { label: 'ขอน้ำ / น้ำจิ้ม', icon: 'refresh' },
  clean_table:  { label: 'เก็บจาน',       icon: 'tray' },
  other:        { label: 'อื่น ๆ',        icon: 'chevronRight' },
}

export const PAYMENT_METHODS = [
  { id: 'cash',         label: 'เงินสด',     icon: 'cash',  hint: 'รับเงินแล้วทอน' },
  { id: 'qr_promptpay', label: 'สแกน QR',    icon: 'qr',    hint: 'พร้อมเพย์ ยอดฝังใน QR' },
  { id: 'transfer',     label: 'โอนเงิน',     icon: 'bank',  hint: 'ลูกค้าโอนแล้วส่งสลิป' },
  { id: 'card',         label: 'บัตรเครดิต', icon: 'card',  hint: 'รูดผ่านเครื่อง EDC' },
]

// บัตรทดสอบของ mock gateway — เลขบัตรกำหนดผลลัพธ์
export const TEST_CARDS = [
  { number: '4242 4242 4242 4242', result: 'approved', label: 'อนุมัติ' },
  { number: '4000 0000 0000 0002', result: 'declined', label: 'ปฏิเสธ' },
  { number: '4000 0000 0000 0119', result: 'error',    label: 'ระบบขัดข้อง' },
]
