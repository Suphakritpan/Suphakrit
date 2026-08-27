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

function readEnv() {
  if (!fs.existsSync(ENV)) return {}
  const out = {}
  for (const line of fs.readFileSync(ENV, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const [k, v] = t.split(/=(.*)/s)
    out[k.trim()] = v.trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = readEnv()
export const SUPABASE_URL = env.VITE_SUPABASE_URL
export const ANON_KEY = env.VITE_SUPABASE_ANON_KEY
export const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL ?? 'owner@shabumood.local'
export const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD

/** ชุดนี้ต้องมีรหัสพนักงาน ไม่งั้นข้าม — ไม่เก็บรหัสไว้ใน repo */
export const configured = Boolean(SUPABASE_URL && ANON_KEY && STAFF_PASSWORD)

let cachedToken = null

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

export async function staffToken() {
  if (cachedToken) return cachedToken
  const data = await rest('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
  })
  cachedToken = data.access_token
  return cachedToken
}

export const select = async (table, query = '') =>
  rest(`/rest/v1/${table}?${query}`, { token: await staffToken() })

export const rpc = async (fn, args = {}) =>
  rest(`/rest/v1/rpc/${fn}`, { token: await staffToken(), method: 'POST', body: args })

/** ยกเลิกบัตรคิวและปิด visit ที่เทสต์สร้างไว้ ให้ฐานข้อมูลกลับไปใกล้เดิม */
export async function cleanup({ ticketIds = [], visitIds = [] }) {
  for (const id of visitIds) {
    try { await rpc('void_visit', { p_visit_id: id, p_reason: 'เก็บกวาดหลัง E2E' }) } catch { /* ปิดไปแล้ว */ }
  }
  for (const id of ticketIds) {
    try { await rpc('cancel_queue_ticket', { p_id: id, p_no_show: false }) } catch { /* จัดโต๊ะไปแล้ว */ }
  }
}

/**
 * anonymous sign-in ยังใช้ได้ไหมตอนนี้
 *
 * Supabase จำกัดจำนวนการสมัคร anonymous ต่อ IP ต่อชั่วโมง
 * ทุก context ใหม่ของเบราว์เซอร์ = สมัครใหม่หนึ่งคน รันชุดเทสต์ซ้ำ ๆ จึงชนเพดานได้
 * เมื่อชนแล้วแอปจะตกไปโหมดสำรอง ซึ่งเปิดคอนโซลได้โดยไม่ต้องล็อกอินตามดีไซน์
 * เทสต์ที่ตรวจด่านของโหมด live จึงต้องข้าม ไม่ใช่รายงานว่าพัง
 */
export async function anonSignInWorks() {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    return res.ok
  } catch {
    return false
  }
}
