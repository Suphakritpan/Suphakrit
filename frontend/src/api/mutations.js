import { supabase } from './supabaseClient'

// ---------------------------------------------------------------------------
// ชั้นเขียนข้อมูล — เรียก RPC ทั้งหมด ไม่ INSERT/UPDATE ตรงเข้าตาราง
//
// เหตุผล: กฎทางธุรกิจอยู่ในฟังก์ชันฝั่งฐานข้อมูล (migrations/0008)
// ถ้าเขียนตรงเข้าตาราง จะข้ามการตรวจเวลา เพดานการสั่ง การล็อกแพ็กเกจ
// และการกันจ่ายเกินไปทั้งหมด
// ---------------------------------------------------------------------------

/** แกะข้อความ error จาก Postgres ให้อ่านรู้เรื่องบนหน้าจอ */
function unwrap({ data, error }) {
  if (error) {
    // ข้อความจาก RAISE EXCEPTION เป็นภาษาไทยอยู่แล้ว ส่งต่อได้เลย
    throw new Error(error.message ?? 'เกิดข้อผิดพลาดที่ไม่รู้จัก')
  }
  return data
}

// ── ตัวตน ───────────────────────────────────────────────────────────────────

/** ลูกค้าที่สแกน QR — ไม่ต้องสมัคร แต่ต้องมี session เพื่อให้ RLS และ Realtime ทำงาน */
export async function signInAnonymously() {
  const { data: existing } = await supabase.auth.getSession()
  if (existing?.session) return existing.session

  const { data, error } = await supabase.auth.signInAnonymously()
  if (error) {
    throw new Error(
      error.message.includes('disabled') || error.status === 422
        ? 'ยังไม่ได้เปิด Anonymous sign-ins ใน Supabase (Authentication → Providers)'
        : error.message,
    )
  }
  return data.session
}

export async function signInStaff(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  return data.session
}

export async function signOut() {
  await supabase.auth.signOut()
}

/** แจ้งเมื่อ session เปลี่ยน — ล็อกอิน ออก หรือ token หมดอายุระหว่างใช้งาน */
export function onAuthChange(fn) {
  if (!supabase) return () => {}
  const { data } = supabase.auth.onAuthStateChange((_event, session) => fn(session))
  return () => data.subscription.unsubscribe()
}

export async function currentSession() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session ?? null
}

/** โปรไฟล์พนักงานของ session ปัจจุบัน — null ถ้าเป็นลูกค้า */
export async function currentProfile() {
  const { data: s } = await supabase.auth.getUser()
  if (!s?.user) return null
  const { data } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle()
  return data ?? null
}

// ── คิวหน้าร้าน ─────────────────────────────────────────────────────────────

/** ออกบัตรคิวใบใหม่ — เลขคิวรันรายวัน ฐานข้อมูลเป็นคนออกให้ ไม่ใช่หน้าจอ */
export async function issueQueueTicket({ partySize, adults, children, customerName, phone, notes }) {
  return unwrap(await supabase.rpc('issue_queue_ticket', {
    p_party_size: partySize ?? (adults ?? 0) + (children ?? 0),
    p_customer_name: customerName ?? null,
    p_phone: phone ?? null,
    p_notes: notes ?? null,
    p_adult_count: adults ?? null,
    p_child_count: children ?? 0,
  }))
}

/** แก้จำนวนคนหลังเปิดโต๊ะ — เพื่อนมาเพิ่ม หรือเปิดผิดตั้งแต่แรก */
export async function adjustVisitGuests(visitId, adults, children = 0) {
  return unwrap(await supabase.rpc('adjust_visit_guests', {
    p_visit_id: visitId, p_adults: adults, p_children: children,
  }))
}

export async function callQueueTicket(id) {
  return unwrap(await supabase.rpc('call_queue_ticket', { p_id: id }))
}

export async function cancelQueueTicket(id, noShow = false) {
  return unwrap(await supabase.rpc('cancel_queue_ticket', { p_id: id, p_no_show: noShow }))
}

// ── ฝั่งลูกค้า ──────────────────────────────────────────────────────────────

/** เข้าโต๊ะด้วย QR จากสลิป หรือ QR ติดโต๊ะ + รหัส 6 หลัก */
export async function joinVisit({ sessionToken, tableQrToken, accessCode, nickname }) {
  await signInAnonymously()
  return unwrap(await supabase.rpc('join_visit', {
    p_session_token: sessionToken ?? null,
    p_table_qr_token: tableQrToken ?? null,
    p_access_code: accessCode ?? null,
    p_nickname: nickname ?? null,
    p_user_agent: navigator.userAgent.slice(0, 200),
  }))
}

/** ส่งออเดอร์ — ฐานข้อมูลจะตรวจเวลา เพดาน และการล็อกแพ็กเกจให้เอง */
export async function placeOrder(visitId, items, note = null) {
  return unwrap(await supabase.rpc('place_order', {
    p_visit_id: visitId,
    p_items: items.map((i) => ({
      menu_item_id: i.menu_item_id,
      quantity: i.quantity,
      note: i.note ?? null,
    })),
    p_note: note,
  }))
}

export async function callStaff(visitId, tableId, type, message = null) {
  const { data, error } = await supabase.from('service_requests')
    .insert({ visit_id: visitId, table_id: tableId, type, message })
    .select().maybeSingle()

  // unique index กันเปิดคำร้องประเภทเดียวกันซ้ำ — ถือว่าสำเร็จ ไม่ต้องขึ้น error
  if (error && error.code === '23505') return null
  if (error) throw new Error(error.message)
  return data
}

export async function requestBill(visitId) {
  return unwrap(await supabase.rpc('request_visit_bill', { p_visit_id: visitId }))
}

// ── ฝั่งพนักงาน ─────────────────────────────────────────────────────────────

export async function openVisit({ tableId, packageId, adults, children, addons = [], queueTicketId, phone }) {
  return unwrap(await supabase.rpc('open_visit', {
    p_table_id: tableId,
    p_package_id: packageId,
    p_adult_count: adults,
    p_child_count: children,
    p_addons: addons,
    p_queue_ticket_id: queueTicketId ?? null,
    p_customer_phone: phone ?? null,
  }))
}

export async function advanceOrderItem(itemId, next) {
  return unwrap(await supabase.rpc('advance_order_item', { p_item_id: itemId, p_next: next }))
}

export async function resolveRequest(id) {
  const { error } = await supabase.from('service_requests')
    .update({ status: 'done', resolved_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setMenuAvailability(menuItemId, available) {
  return unwrap(await supabase.rpc('set_menu_item_availability', {
    p_menu_item_id: menuItemId, p_available: available,
  }))
}

// ── การเงิน ─────────────────────────────────────────────────────────────────

export async function createPayment({ visitId, method, amountSatang, tenderedSatang, providerRef, payload }) {
  return unwrap(await supabase.rpc('create_payment', {
    p_visit_id: visitId,
    p_method: method,
    p_amount_satang: amountSatang,
    p_tendered_satang: tenderedSatang ?? null,
    p_provider_ref: providerRef ?? null,
    p_payload: payload ?? null,
  }))
}

export async function confirmPayment(paymentId, providerRef = null, payload = null) {
  return unwrap(await supabase.rpc('confirm_payment', {
    p_payment_id: paymentId, p_provider_ref: providerRef, p_payload: payload,
  }))
}

export async function cancelPayment(paymentId, reason = null) {
  return unwrap(await supabase.rpc('cancel_payment', { p_payment_id: paymentId, p_reason: reason }))
}

export async function amountDue(visitId) {
  return unwrap(await supabase.rpc('visit_amount_due', { p_visit_id: visitId }))
}

export async function closeVisit(visitId) {
  return unwrap(await supabase.rpc('close_visit', { p_visit_id: visitId }))
}

export async function markTableClean(tableId) {
  return unwrap(await supabase.rpc('mark_table_clean', { p_table_id: tableId }))
}

export async function voidVisit(visitId, reason) {
  return unwrap(await supabase.rpc('void_visit', { p_visit_id: visitId, p_reason: reason }))
}
