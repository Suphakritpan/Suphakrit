import { supabase } from './supabaseClient'

// ---------------------------------------------------------------------------
// Realtime — ตัวที่ทำให้ทั้งสามฝั่งเห็นตรงกันโดยไม่ต้องกดรีเฟรช
//
//   ลูกค้ากดสั่ง        → order_items เพิ่ม  → จอครัวเด้งทันที
//   ครัวกดพร้อมเสิร์ฟ   → order_items เปลี่ยน → ลูกค้าเห็นสถานะเปลี่ยน + หน้าเสิร์ฟขึ้นรายการ
//   พนักงานเปิด/ปิดโต๊ะ → visits, tables      → ผังโต๊ะและหน้าผู้จัดการอัปเดต
//
// ⚠️ Postgres Changes ส่ง event DELETE โดยไม่กรองด้วย RLS (payload มีแค่ PK)
//    schema นี้จึงใช้เปลี่ยน status แทนการลบแถวเสมอ
// ---------------------------------------------------------------------------

const WATCHED = [
  'visits',
  'orders',
  'order_items',
  'service_requests',
  'tables',
  'queue_tickets',
  'payments',
]

/**
 * เปิดการติดตามการเปลี่ยนแปลง แล้วเรียก onChange เมื่อมีอะไรขยับ
 *
 * onChange ถูกหน่วงรวมกันเล็กน้อย เพราะการสั่งหนึ่งรอบทำให้เกิด event
 * หลายตัวติด ๆ กัน (orders 1 + order_items หลายแถว) ไม่ควรโหลดใหม่ทุก event
 *
 * @param {(info: {table: string, event: string}) => void} onChange
 * @param {(status: string) => void} [onStatus]
 * @returns {() => void} ฟังก์ชันสำหรับยกเลิกการติดตาม
 */
export function subscribeFloor(onChange, onStatus) {
  if (!supabase) return () => {}

  let timer = null
  let last = null

  const bump = (table, event) => {
    last = { table, event }
    clearTimeout(timer)
    timer = setTimeout(() => onChange(last), 180)
  }

  const channel = supabase.channel('shabu-floor')

  for (const table of WATCHED) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
      bump(table, payload.eventType)
    })
  }

  channel.subscribe((status) => {
    onStatus?.(status)
    // กลับมาเชื่อมต่อได้ใหม่หลังเน็ตหลุด — ต้องโหลดทั้งชุด
    // เพราะ event ที่เกิดระหว่างหลุดจะหายไปเลย ไม่มีการส่งย้อนหลัง
    if (status === 'SUBSCRIBED') bump('*', 'resync')
  })

  return () => {
    clearTimeout(timer)
    supabase.removeChannel(channel)
  }
}

/**
 * ติดตามเฉพาะโต๊ะเดียว — ใช้ฝั่งลูกค้าเพื่อลดปริมาณ event ที่ต้องรับ
 * Postgres Changes กรองได้ทีละเงื่อนไข จึงกรอง orders ด้วย visit_id
 * ส่วน order_items ไม่มี visit_id ตรง ๆ ต้องรับทั้งหมดแล้วค่อยกรองฝั่ง client
 */
export function subscribeVisit(visitId, onChange, onStatus) {
  if (!supabase || !visitId) return () => {}

  let timer = null
  const bump = () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, 180)
  }

  const channel = supabase
    .channel(`shabu-visit-${visitId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'visits', filter: `id=eq.${visitId}` }, bump)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `visit_id=eq.${visitId}` }, bump)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' }, bump)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'service_requests', filter: `visit_id=eq.${visitId}` }, bump)
    .subscribe((status) => {
      onStatus?.(status)
      if (status === 'SUBSCRIBED') bump()
    })

  return () => {
    clearTimeout(timer)
    supabase.removeChannel(channel)
  }
}
