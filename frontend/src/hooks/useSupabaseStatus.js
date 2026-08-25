import { useEffect, useState } from 'react'
import { pingSupabase } from '@/api/health'

/**
 * เช็คสถานะการเชื่อมต่อ Supabase ครั้งเดียวตอน mount
 * ใช้ในหน้า diagnostic ตอนตั้งค่าโปรเจกต์ ไม่ได้ตั้งใจให้ใช้ในหน้า production
 */
export function useSupabaseStatus() {
  const [result, setResult] = useState({ ok: false, status: 'checking', detail: 'กำลังตรวจสอบ…' })

  useEffect(() => {
    let cancelled = false

    pingSupabase().then((r) => {
      if (!cancelled) setResult(r)
    })

    return () => {
      cancelled = true
    }
  }, [])

  return result
}

export default useSupabaseStatus
