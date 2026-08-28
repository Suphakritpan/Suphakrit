import { supabase } from './supabaseClient'
import { startOfTodayISO } from './queries'

// ---------------------------------------------------------------------------
// ชั้นข้อมูลของหน้าผู้จัดการ
//
// เขียนตรงเข้าตารางได้ ไม่ต้องผ่าน RPC เพราะ RLS ชุด manage_* ใน 0009
// เปิดสิทธิ์ให้เฉพาะ is_manager() อยู่แล้ว — กฎอยู่ที่ฐานข้อมูลเหมือนเดิม
// ส่วนที่แตะเงินหรือสถานะ (ยกเลิกบิล ปิดรอบ ชำระเงิน) ยังต้องผ่าน RPC เท่านั้น
//
// ทุกฟังก์ชันอ่านคืน array เปล่าเมื่อ RLS ไม่ให้เห็น ไม่โยน error
// เพราะหน้าผู้จัดการมีหลายบล็อกในหน้าเดียว บล็อกหนึ่งพังไม่ควรทำทั้งหน้าดับ
// ---------------------------------------------------------------------------

function rows({ data, error }) {
  if (error) throw new Error(error.message)
  return data ?? []
}

/** อัปเดตแถวเดิม (มี id/branch_id) หรือสร้างใหม่เมื่อไม่มีคีย์ */
export async function saveRow(table, row, key = 'id') {
  const { [key]: id, ...patch } = row
  const q = id
    ? supabase.from(table).update(patch).eq(key, id)
    : supabase.from(table).insert(patch)
  const { data, error } = await q.select().maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteRow(table, id, key = 'id') {
  const { error } = await supabase.from(table).delete().eq(key, id)
  if (error) throw new Error(error.message)
}

/**
 * แถวจริงของ restaurant_settings — ไม่ใช่ view public_settings ที่หน้าจอทั่วไปใช้
 * view ตัดคอลัมน์อ่อนไหว (promptpay_id, tax_id, legal_name) ออกโดยตั้งใจ
 * แต่หน้าตั้งค่าของผู้จัดการต้องแก้ค่าพวกนั้นได้ด้วย
 */
export async function loadSettings() {
  const { data, error } = await supabase.from('restaurant_settings').select('*').maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// ── คิว ─────────────────────────────────────────────────────────────────────
/** บัตรคิววันนี้ทุกสถานะ — หน้าพนักงานเห็นเฉพาะ waiting/called ผู้จัดการต้องเห็นครบ */
export async function listQueueToday(tz) {
  return rows(await supabase.from('queue_tickets').select('*')
    .gte('created_at', startOfTodayISO(tz)).order('ticket_number'))
}

// ── รอบการใช้บริการ ─────────────────────────────────────────────────────────
export async function listVisitsToday(tz) {
  return rows(await supabase.from('visits').select('*')
    .gte('check_in_at', startOfTodayISO(tz)).order('check_in_at', { ascending: false }))
}

/** รายละเอียดของรอบเดียว — ใช้ตอน drill-down จากตารางภาพรวม */
export async function visitDetail(visitId) {
  const [orders, items, lines, payments, promos, addons] = await Promise.all([
    supabase.from('orders').select('*').eq('visit_id', visitId).order('order_number'),
    supabase.from('order_items').select('*').order('created_at'),
    supabase.from('bill_lines').select('*').eq('visit_id', visitId).order('sort_order'),
    supabase.from('payments').select('*').eq('visit_id', visitId).order('created_at'),
    supabase.from('visit_promotions').select('*').eq('visit_id', visitId),
    supabase.from('visit_addons').select('*').eq('visit_id', visitId),
  ])
  const orderIds = new Set((orders.data ?? []).map((o) => o.id))
  return {
    orders: (orders.data ?? []).map((o) => ({
      ...o, items: (items.data ?? []).filter((i) => i.order_id === o.id),
    })),
    // order_items ของ visit อื่นถูกกรองทิ้งตรงนี้ (กรองด้วย in() ไม่ได้เมื่อไม่มีออเดอร์)
    itemCount: (items.data ?? []).filter((i) => orderIds.has(i.order_id)).length,
    billLines: lines.data ?? [],
    payments: payments.data ?? [],
    promotions: promos.data ?? [],
    addons: addons.data ?? [],
  }
}

// ── เงิน ────────────────────────────────────────────────────────────────────
export async function listPaymentsToday(tz) {
  return rows(await supabase.from('payments').select('*')
    .gte('created_at', startOfTodayISO(tz)).order('created_at', { ascending: false }))
}

// ── ตรวจสอบย้อนหลัง ─────────────────────────────────────────────────────────
export async function listAudit(limit = 200) {
  return rows(await supabase.from('audit_logs').select('*')
    .order('created_at', { ascending: false }).limit(limit))
}

// ── โปรโมชั่น / สมาชิก / พนักงาน ────────────────────────────────────────────
export async function listPromotions() {
  return rows(await supabase.from('promotions').select('*').order('code'))
}

export async function listCustomers() {
  return rows(await supabase.from('customers').select('*')
    .order('last_visit_at', { ascending: false, nullsFirst: false }).limit(100))
}

export async function listLoyalty(limit = 100) {
  return rows(await supabase.from('loyalty_transactions').select('*')
    .order('created_at', { ascending: false }).limit(limit))
}

export async function listStaff() {
  return rows(await supabase.from('profiles').select('*').order('full_name'))
}

/** ล็อกแพ็กเกจของเมนู — ตารางเชื่อมไม่มี id ของตัวเอง จึงลบทิ้งแล้วใส่ใหม่ทั้งชุด */
export async function setMenuPackages(menuItemId, packageIds) {
  const del = await supabase.from('menu_item_packages').delete().eq('menu_item_id', menuItemId)
  if (del.error) throw new Error(del.error.message)
  if (!packageIds.length) return
  const ins = await supabase.from('menu_item_packages')
    .insert(packageIds.map((package_id) => ({ menu_item_id: menuItemId, package_id })))
  if (ins.error) throw new Error(ins.error.message)
}
