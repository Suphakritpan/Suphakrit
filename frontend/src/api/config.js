/**
 * อ่านและทำความสะอาดค่า Supabase จาก env
 * แยกออกมาเป็นไฟล์ต่างหากเพื่อให้ health.js ใช้ได้โดยไม่ต้อง import client
 * (client จะ throw ทันทีถ้า env ว่าง ทำให้หน้า diagnostic แสดงผลไม่ได้)
 */

/**
 * ตัด path ส่วนเกินออกจาก Project URL
 * คนมักคัดลอกมาทั้ง https://xxx.supabase.co/rest/v1/ ซึ่งผิด
 * เพราะ supabase-js เติม /rest/v1 /auth/v1 /realtime/v1 ให้เองตาม service ที่เรียก
 */
function normalizeUrl(raw) {
  if (!raw) return ''
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(rest|auth|realtime|storage)\/v1$/, '')
}

export const supabaseUrl = normalizeUrl(import.meta.env.VITE_SUPABASE_URL)
export const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const isConfigured = Boolean(supabaseUrl && supabaseAnonKey)

/**
 * อ่าน role ออกจาก JWT payload โดยไม่ตรวจ signature
 * ใช้เพื่อกันอุบัติเหตุเอา service_role มาใส่ฝั่ง frontend เท่านั้น
 * ไม่ใช่การตรวจสอบความปลอดภัย — ของจริงต้องพึ่ง RLS
 */
export function readKeyRole(key = supabaseAnonKey) {
  try {
    const payload = key.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json).role ?? null
  } catch {
    return null
  }
}
