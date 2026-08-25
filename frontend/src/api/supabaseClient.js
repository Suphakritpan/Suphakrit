import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, supabaseAnonKey, isConfigured, readKeyRole } from './config'

if (!isConfigured) {
  throw new Error(
    'ยังไม่ได้ตั้งค่า Supabase\n' +
      'สร้างไฟล์ frontend/.env.local แล้วใส่ VITE_SUPABASE_URL และ VITE_SUPABASE_ANON_KEY\n' +
      '(ดูตัวอย่างใน .env.example — แก้แล้วต้องรีสตาร์ท npm run dev)',
  )
}

if (readKeyRole() === 'service_role') {
  throw new Error(
    'อันตราย: กำลังใช้ service_role key ในฝั่ง frontend\n' +
      'key นี้ข้าม RLS ได้ทั้งหมด และจะถูก bundle ลงไปใน JS ที่ลูกค้าทุกคนเปิดอ่านได้\n' +
      'เปลี่ยนเป็น anon public key จาก Project Settings → Data API',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Staff/Admin ล็อกอินค้างไว้ได้ ส่วนลูกค้าที่สแกน QR ไม่มี session อยู่แล้ว
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'shabu-mood.auth',
  },
  realtime: {
    // ครัวกับหน้าเสิร์ฟ subscribe order พร้อมกันหลายเครื่อง จำกัด rate ไว้กันสแปม
    params: { eventsPerSecond: 10 },
  },
  global: {
    headers: { 'x-application-name': 'shabu-mood' },
  },
})

export default supabase
