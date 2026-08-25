import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, supabaseAnonKey, isConfigured, readKeyRole } from './config'

// service_role key ข้าม RLS ได้ทั้งหมด และจะถูก bundle ลงไปใน JS ที่ลูกค้าเปิดอ่านได้
// อันนี้ต้องหยุดทันที ไม่ใช่แค่เตือน
if (isConfigured && readKeyRole() === 'service_role') {
  throw new Error(
    'อันตราย: กำลังใช้ service_role key ในฝั่ง frontend\n' +
      'key นี้ข้าม RLS ได้ทั้งหมด และจะถูก bundle ลงไปใน JS ที่ลูกค้าทุกคนเปิดอ่านได้\n' +
      'เปลี่ยนเป็น anon public key จาก Project Settings → Data API',
  )
}

// ตั้งค่าไม่ครบไม่ throw — ปล่อยให้แอปเปิดได้แล้วไปใช้ข้อมูลจำลองแทน
// เพราะหน้าเดโมต้องดูได้ก่อนที่จะมีฐานข้อมูลจริง
if (!isConfigured && import.meta.env.DEV) {
  console.warn(
    '[shabu-mood] ยังไม่ได้ตั้งค่า Supabase — ใช้ข้อมูลจำลองแทน\n' +
      'สร้าง frontend/.env.local แล้วใส่ VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY',
  )
}

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // พนักงาน/ผู้จัดการล็อกอินค้างไว้ได้
        // ลูกค้าที่สแกน QR ใช้ anonymous sign-in ซึ่งเก็บ session เหมือนกัน
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'shabu-mood.auth',
      },
      realtime: {
        // ครัวกับหน้าเสิร์ฟ subscribe พร้อมกันหลายเครื่อง จำกัด rate กันสแปม
        params: { eventsPerSecond: 10 },
      },
      global: { headers: { 'x-application-name': 'shabu-mood' } },
    })
  : null

export { isConfigured }
export default supabase
