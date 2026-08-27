import { supabase, isConfigured } from './supabaseClient'

// ---------------------------------------------------------------------------
// ชั้นอ่านข้อมูลจาก Supabase
//
// ทุกฟังก์ชันคืนรูปทรงเดียวกับข้อมูลจำลองใน data/demo.js
// เพื่อให้ component ไม่ต้องรู้เลยว่าข้อมูลมาจากไหน
// ---------------------------------------------------------------------------

/**
 * ตรวจว่าฐานข้อมูลถูก migrate มาเป็น schema ชุดนี้แล้วหรือยัง
 *
 * ต้องเช็คตารางที่ "มีเฉพาะ schema นี้" เท่านั้น — จะใช้ buffet_packages ไม่ได้
 * เพราะดีไซน์ชุดเก่าที่เคย deploy ไว้ก็มีตารางชื่อเดียวกัน ตรวจแล้วจะผ่านทั้งที่ยังไม่ใช่
 * menu_item_packages เป็นตารางที่ใช้ล็อกเมนูตามแพ็กเกจ ซึ่งมีแค่ใน schema นี้
 */
const SIGNATURE_TABLE = 'menu_item_packages'

export async function probeSchema() {
  if (!isConfigured) {
    return { ready: false, reason: 'ยังไม่ได้ตั้งค่า Supabase ใน frontend/.env.local' }
  }

  const { error } = await supabase.from(SIGNATURE_TABLE).select('menu_item_id').limit(1)
  if (!error) return { ready: true }

  // 42P01 = undefined_table · PGRST205 = ไม่พบตารางใน schema cache
  const missing = error.code === '42P01' || error.code === 'PGRST205'
    || /does not exist|find the table/i.test(error.message ?? '')

  if (missing) {
    return {
      ready: false,
      reason: 'เชื่อม Supabase ได้ แต่ยังไม่ได้ติดตั้ง schema — ดูวิธีติดตั้งใน supabase/README.md',
    }
  }

  // อ่านไม่ได้เพราะ RLS แปลว่าตารางมีอยู่ แต่ยังไม่ได้ล็อกอิน
  if (error.code === '42501' || /permission|policy/i.test(error.message ?? '')) {
    return { ready: true }
  }

  return { ready: false, reason: `เชื่อมฐานข้อมูลไม่สำเร็จ: ${error.message}` }
}

/** ข้อมูลอ้างอิงทั้งหมดที่ทุกฝั่งใช้ร่วมกัน โหลดครั้งเดียวตอนเปิดแอป */
export async function loadReference() {
  const [settings, packages, addOns, stations, categories, items, itemPkgs, zones, tables] =
    await Promise.all([
      supabase.from('public_settings').select('*').maybeSingle(),
      supabase.from('buffet_packages').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('add_ons').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('kitchen_stations').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('menu_categories').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('menu_items').select('*').order('sort_order'),
      supabase.from('menu_item_packages').select('*'),
      supabase.from('zones').select('*').order('sort_order'),
      supabase.from('tables').select('*').eq('is_active', true).order('table_number'),
    ])

  const err = [settings, packages, addOns, stations, categories, items, itemPkgs, zones, tables]
    .find((r) => r.error)?.error
  if (err) throw new Error(err.message)

  // รวมรายการล็อกแพ็กเกจเข้าไปในเมนูแต่ละตัว ให้รูปทรงตรงกับ demo.js
  const lockMap = new Map()
  for (const row of itemPkgs.data ?? []) {
    if (!lockMap.has(row.menu_item_id)) lockMap.set(row.menu_item_id, [])
    lockMap.get(row.menu_item_id).push(row.package_id)
  }

  return {
    settings: settings.data ?? null,
    packages: packages.data ?? [],
    addOns: addOns.data ?? [],
    stations: stations.data ?? [],
    categories: (categories.data ?? []).map((c) => ({ ...c, image: c.image_url })),
    menuItems: (items.data ?? []).map((m) => ({
      ...m,
      allowed_package_ids: lockMap.get(m.id) ?? [],
    })),
    zones: zones.data ?? [],
    tables: tables.data ?? [],
  }
}

/** สถานะหน้าร้านที่เปลี่ยนตลอดเวลา — โหลดใหม่ทุกครั้งที่ realtime แจ้ง */
export async function loadFloorState() {
  const [visits, addons, orders, items, requests, queue, payments] = await Promise.all([
    supabase.from('visits').select('*')
      .in('status', ['open', 'awaiting_payment', 'paid']).order('check_in_at'),
    supabase.from('visit_addons').select('*'),
    supabase.from('orders').select('*').order('order_number'),
    supabase.from('order_items').select('*').order('created_at'),
    supabase.from('service_requests').select('*').eq('status', 'open').order('created_at'),
    supabase.from('queue_tickets').select('*')
      .in('status', ['waiting', 'called']).order('ticket_number'),
    supabase.from('payments').select('*').eq('status', 'succeeded'),
  ])

  const err = [visits, addons, orders, items, requests, queue, payments]
    .find((r) => r.error)?.error
  if (err) throw new Error(err.message)

  // ผูก add-on เข้ากับ visit และผูก order_items เข้ากับ order
  const addonsBy = groupBy(addons.data ?? [], 'visit_id')
  const itemsBy = groupBy(items.data ?? [], 'order_id')

  return {
    visits: (visits.data ?? []).map((v) => ({ ...v, addons: addonsBy.get(v.id) ?? [] })),
    orders: (orders.data ?? []).map((o) => ({ ...o, items: itemsBy.get(o.id) ?? [] })),
    serviceRequests: requests.data ?? [],
    queueTickets: queue.data ?? [],
    payments: payments.data ?? [],
  }
}

/** ตัวเลขสำหรับหน้าผู้จัดการ — คำนวณจากบิลที่ปิดแล้ววันนี้ */
export async function loadDashboard(tz = 'Asia/Bangkok') {
  const start = startOfTodayISO(tz)

  const [closed, soldItems] = await Promise.all([
    supabase.from('visits')
      .select('id, total_satang, adult_count, child_count, package_id, package_name_snapshot, check_in_at')
      .eq('status', 'closed').gte('check_in_at', start),
    supabase.from('order_items')
      .select('name_snapshot, quantity, created_at')
      .gte('created_at', start).neq('status', 'cancelled'),
  ])

  if (closed.error) throw new Error(closed.error.message)
  if (soldItems.error) throw new Error(soldItems.error.message)

  const bills = closed.data ?? []
  const sales = bills.reduce((n, b) => n + b.total_satang, 0)
  const guests = bills.reduce((n, b) => n + b.adult_count + b.child_count, 0)

  // เมนูขายดี
  const tally = new Map()
  for (const it of soldItems.data ?? []) {
    tally.set(it.name_snapshot, (tally.get(it.name_snapshot) ?? 0) + it.quantity)
  }
  const topItems = [...tally.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty).slice(0, 6)

  // ช่วงเวลาที่ลูกค้าเยอะ — นับ visit ตามชั่วโมงที่เช็คอิน
  const byHour = new Map()
  for (const b of bills) {
    const h = new Date(b.check_in_at).toLocaleString('en-GB', { timeZone: tz, hour: '2-digit', hour12: false })
    byHour.set(h, (byHour.get(h) ?? 0) + 1)
  }
  const hourly = Array.from({ length: 12 }, (_, i) => {
    const h = String(11 + i).padStart(2, '0')
    return { h, v: byHour.get(h) ?? 0 }
  })

  // สัดส่วนแพ็กเกจ
  const pkgTally = new Map()
  for (const b of bills) pkgTally.set(b.package_name_snapshot, (pkgTally.get(b.package_name_snapshot) ?? 0) + 1)
  const packageMix = [...pkgTally.entries()].map(([name, n]) => ({
    name, pct: bills.length ? Math.round((n / bills.length) * 100) : 0,
  }))

  return {
    salesTodaySatang: sales,
    guestsToday: guests,
    billsToday: bills.length,
    avgPerHeadSatang: guests ? Math.round(sales / guests) : 0,
    hourly,
    topItems,
    packageMix,
    paymentMix: [],
  }
}

// ── helper ──────────────────────────────────────────────────────────────────
function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    if (!m.has(r[key])) m.set(r[key], [])
    m.get(r[key]).push(r)
  }
  return m
}

function startOfTodayISO(tz) {
  const now = new Date()
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }))
  local.setHours(0, 0, 0, 0)
  // ชดเชยส่วนต่างระหว่างเวลาเครื่องกับเวลาร้าน
  const offset = now.getTime() - new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime()
  return new Date(local.getTime() + offset).toISOString()
}

/**
 * เช็คคิวด้วย token จาก QR บนบัตร — ไม่ต้องมี session
 *
 * คนยืนรอหน้าร้านยังไม่ได้เป็นลูกค้าของโต๊ะไหน จึงไม่ควรบังคับให้ล็อกอิน
 * get_queue_status() เป็น security definer ที่ตรวจ token เอง (0011)
 */
export async function queueStatusByToken(token) {
  if (!isConfigured) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  const { data, error } = await supabase.rpc('get_queue_status', { p_token: token })
  if (error) throw new Error(error.message)
  return data
}
