/**
 * ตัวช่วยคุยกับ Supabase ตรง ๆ สำหรับ arrange และ verify
 * ----------------------------------------------------------------------------
 * เทสต์กดผ่านหน้าจอ (act) แต่ต้องยืนยันผลที่ "ฐานข้อมูล" ไม่ใช่แค่ที่หน้าจอ
 * ไม่งั้นจะจับบั๊กแบบเดิมไม่ได้ — หน้าจอขึ้นถูกแต่ค่าที่ส่งเข้า RPC ผิด
 *
 * อ่าน env จาก frontend/.env.local ไฟล์เดียวกับที่แอปใช้
 * จะได้ไม่มีโอกาสชี้คนละ project กับที่เบราว์เซอร์กำลังเปิดอยู่
 */
import fs from 'fs'
import path from 'path'

const ENV = path.resolve(import.meta.dirname, '../../frontend/.env.local')

function readEnv(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const [k, v] = t.split(/=(.*)/s)
    out[k.trim()] = v.trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * รหัสของเทสต์อ่านจาก e2e/.env ได้ด้วย (ไฟล์นี้อยู่ใน .gitignore)
 * ไม่งั้นต้องตั้ง env var ใหม่ทุกครั้งที่เปิดเทอร์มินัล แล้วรหัสไปค้างใน shell history
 * ตัวแปรที่ตั้งไว้ในเชลล์ยังชนะไฟล์เสมอ — CI จึงไม่ต้องมีไฟล์นี้
 */
const env = readEnv(ENV)
const secrets = readEnv(path.resolve(import.meta.dirname, '../.env'))
const secret = (k) => process.env[k] ?? secrets[k]
export const SUPABASE_URL = env.VITE_SUPABASE_URL
export const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
export const STAFF_EMAIL = secret('E2E_STAFF_EMAIL') ?? 'owner@shabumood.local'
export const STAFF_PASSWORD = secret('E2E_STAFF_PASSWORD')

/**
 * บัญชีพนักงานที่ "ไม่ใช่ผู้จัดการ" — มีไว้พิสูจน์ว่า RLS ปฏิเสธจริง
 * ไม่มีบัญชีนี้ = พิสูจน์ไม่ได้ว่ากฎกันอยู่ ต้องข้ามเทสต์ ไม่ใช่รายงานว่าผ่าน
 */
export const WAITER_EMAIL = secret('E2E_WAITER_EMAIL')
export const WAITER_PASSWORD = secret('E2E_WAITER_PASSWORD')

/** ชุดนี้ต้องมีรหัสพนักงาน ไม่งั้นข้าม — ไม่เก็บรหัสไว้ใน repo */
export const configured = Boolean(SUPABASE_URL && ANON_KEY && STAFF_PASSWORD)
export const hasWaiter = Boolean(configured && WAITER_EMAIL && WAITER_PASSWORD)

/**
 * คำนำหน้าของทุกแถวที่เทสต์สร้างขึ้นเอง
 * ----------------------------------------------------------------------------
 * ชุดนี้ยิงเข้าฐานข้อมูลจริง ไม่มีฐานทดสอบแยก การเก็บกวาดรายเทสต์จึงไม่พอ:
 * เทสต์ที่ล้มกลางทางทิ้งแถวค้างไว้ และบางแถว (เมนูที่เคยถูกสั่ง) ถูก FK กันไม่ให้ลบ
 * global teardown จึงกวาดด้วยคำนำหน้านี้อีกชั้น แล้วรายงานสิ่งที่ลบไม่ออก
 * เพื่อให้ตอนส่งมอบตรวจได้ว่า "ไม่มีข้อมูลเทสต์ค้างในฐานข้อมูลจริง"
 */
export const E2E_PREFIX = 'E2E-'
export const tag = (s) => `${E2E_PREFIX}${s}`

let cached = new Map()

async function rest(pathname, { token, method = 'GET', body } = {}) {
  const res = await fetch(SUPABASE_URL + pathname, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token ?? ANON_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Prefer: 'return=representation',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

async function tokenFor(email, password) {
  if (cached.has(email)) return cached.get(email)
  const data = await rest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  })
  cached.set(email, data.access_token)
  return data.access_token
}

export const staffToken = () => tokenFor(STAFF_EMAIL, STAFF_PASSWORD)
export const waiterToken = () => tokenFor(WAITER_EMAIL, WAITER_PASSWORD)

export const select = async (table, query = '') =>
  rest(`/rest/v1/${table}?${query}`, { token: await staffToken() })

export const rpc = async (fn, args = {}) =>
  rest(`/rest/v1/rpc/${fn}`, { token: await staffToken(), method: 'POST', body: args })

/** เขียนตรงเข้าตารางในฐานะพนักงาน — ใช้ arrange ของที่ไม่มี RPC ให้ (โปรโมชั่น, ตั้งค่า) */
export const insert = async (table, row) =>
  rest(`/rest/v1/${table}`, { token: await staffToken(), method: 'POST', body: row })

export const patch = async (table, query, row) =>
  rest(`/rest/v1/${table}?${query}`, { token: await staffToken(), method: 'PATCH', body: row })

/**
 * ลบแถว — ต้องมีเงื่อนไขเสมอ
 * PostgREST ที่ไม่มีเงื่อนไขจะลบทั้งตาราง และชุดนี้ยิงเข้าฐานข้อมูลของร้านจริง
 * พลาดตรงนี้ครั้งเดียว = เมนูทั้งร้านหาย จึงกันไว้ที่ตัวช่วย ไม่ใช่ที่วินัยคนเขียน
 */
export const remove = async (table, query) => {
  if (!query || !query.trim()) throw new Error(`remove(${table}) ต้องมีเงื่อนไข — ไม่งั้นลบทั้งตาราง`)
  return rest(`/rest/v1/${table}?${query}`, { token: await staffToken(), method: 'DELETE' })
}

/**
 * ยิงแล้วคืนสถานะ ไม่โยน error — ใช้ตอนที่ "ถูกปฏิเสธ" คือผลที่ต้องการ
 * (RLS กันพนักงานที่ไม่ใช่ผู้จัดการ, place_order ปฏิเสธเมนูที่เพิ่ง 86)
 */
export async function attempt(pathname, { token, method = 'GET', body } = {}) {
  const res = await fetch(SUPABASE_URL + pathname, {
    method,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token ?? ANON_KEY}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Prefer: 'return=representation',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, ok: res.ok, body: await res.text() }
}

/** ยกเลิกบัตรคิวและปิด visit ที่เทสต์สร้างไว้ ให้ฐานข้อมูลกลับไปใกล้เดิม */
export async function cleanup({ ticketIds = [], visitIds = [] }) {
  for (const id of visitIds) {
    // เก็บ table_id ไว้ก่อน — void_visit ไม่ได้คืนโต๊ะให้ว่าง แค่ส่งไปรอทำความสะอาด
    let tableId = null
    try {
      const [v] = await select('visits', `select=table_id&id=eq.${id}`)
      tableId = v?.table_id ?? null
    } catch { /* อ่านไม่ได้ก็ข้าม */ }

    try { await rpc('void_visit', { p_visit_id: id, p_reason: 'เก็บกวาดหลัง E2E' }) } catch { /* ปิดไปแล้ว */ }

    // ไม่คืนโต๊ะให้ว่าง = รันชุดนี้ซ้ำอีกครั้งจะไม่มีโต๊ะว่างให้จัดคิว แล้วเทสต์พังทั้งที่โค้ดถูก
    if (tableId) {
      try { await rpc('mark_table_clean', { p_table_id: tableId }) } catch { /* ไม่ได้อยู่สถานะรอเก็บ */ }
    }
  }
  for (const id of ticketIds) {
    try { await rpc('cancel_queue_ticket', { p_id: id, p_no_show: false }) } catch { /* จัดโต๊ะไปแล้ว */ }
  }
}

/**
 * กวาดทุกแถวที่ขึ้นต้นด้วย E2E_PREFIX — เรียกจาก global teardown
 *
 * ลำดับสำคัญ: โต๊ะอ้างถึงโซน จึงต้องลบโต๊ะก่อนโซน
 * คืน array ของสิ่งที่ลบไม่ออก (ติด FK) เพื่อให้เห็นตอนตรวจก่อนส่งมอบ
 */
export async function reap() {
  const stuck = []
  const like = `like.${E2E_PREFIX}*`

  const sweep = async (table, column) => {
    let rows = []
    try { rows = await select(table, `select=id,${column}&${column}=${like}`) } catch { return }
    for (const r of rows) {
      try { await remove(table, `id=eq.${r.id}`) } catch { stuck.push(`${table}: ${r[column]}`) }
    }
  }

  await sweep('tables', 'table_number')
  await sweep('zones', 'code')
  await sweep('menu_items', 'name_th')
  return stuck
}
