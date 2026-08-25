import { supabaseUrl, supabaseAnonKey, isConfigured, readKeyRole } from './config'

// ชื่อตารางที่ไม่มีวันมีจริง ใช้เป็นเป้ายิงตอนฐานข้อมูลยังว่าง
const PROBE_TABLE = '__shabu_mood_connection_probe__'

/**
 * ตรวจว่า URL + anon key ใช้งานได้จริง
 *
 * ห้ามยิงไปที่ /rest/v1/ (OpenAPI root) เพราะ Supabase ปิดไว้เป็นค่าเริ่มต้น
 * แล้วตอบ 401 ทั้งที่ key ถูกต้อง — จะแยกไม่ออกจาก key ผิดจริง
 *
 * ยิงไปที่ตารางที่ไม่มีอยู่แทน แล้วอ่านรหัส error:
 *   404 + PGRST205  → ผ่าน auth เข้าถึง PostgREST แล้ว = เชื่อมติด
 *   401 / 403       → key ผิดหรือถูก revoke
 *
 * @returns {Promise<{ ok: boolean, status: string, detail: string }>}
 */
export async function pingSupabase() {
  if (!isConfigured) {
    return { ok: false, status: 'not-configured', detail: 'ยังไม่ได้ใส่ค่าใน .env.local' }
  }

  if (readKeyRole() === 'service_role') {
    return {
      ok: false,
      status: 'unsafe-key',
      detail: 'นี่คือ service_role key ห้ามใช้ฝั่ง frontend — เปลี่ยนเป็น anon public',
    }
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${PROBE_TABLE}?select=*&limit=1`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    })

    const host = new URL(supabaseUrl).hostname

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: 'bad-key', detail: 'anon key ไม่ถูกต้อง ถูก revoke หรือคัดลอกมาไม่ครบ' }
    }

    const body = await response.json().catch(() => null)

    // PGRST205 = ตารางไม่มีในฐานข้อมูล ซึ่งคาดไว้แล้วตอน schema ยังว่าง
    // การที่ PostgREST ตอบรหัสนี้ได้ แปลว่า auth ผ่านและคุยกับ Postgres ได้แล้ว
    if (response.status === 404 && body?.code === 'PGRST205') {
      return { ok: true, status: 'connected', detail: `เชื่อมต่อสำเร็จ — ${host} (ยังไม่มี schema)` }
    }

    if (response.ok) {
      return { ok: true, status: 'connected', detail: `เชื่อมต่อสำเร็จ — ${host}` }
    }

    return {
      ok: false,
      status: 'error',
      detail: `HTTP ${response.status}${body?.message ? ` — ${body.message}` : ''}`,
    }
  } catch (error) {
    return {
      ok: false,
      status: 'unreachable',
      detail: `ต่อไม่ติด — เช็ค VITE_SUPABASE_URL หรืออินเทอร์เน็ต (${error.message})`,
    }
  }
}
