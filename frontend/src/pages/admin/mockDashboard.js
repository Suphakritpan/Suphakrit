/**
 * ข้อมูลจำลองสำหรับดูหน้าตาแดชบอร์ดตอนร้านมีข้อมูลเยอะ
 * ---------------------------------------------------------------------------
 * เปิดด้วย /admin?mock=1 · ที่อยู่ปกติยังอ่านของจริงจากฐานเหมือนเดิมทุกอย่าง
 * ตัวเลขรวมยืมจาก data/demo.js ที่มีอยู่แล้ว ไม่ได้แต่งชุดใหม่ซ้อน
 *
 * ลบทั้งไฟล์ได้เมื่อไม่ต้องใช้ — มี Dashboard.jsx ที่เดียวที่ import
 */
import { dashboard } from '../../data/demo'

export const mockAggregates = dashboard

export const mockQueueTally = {
  waiting: 6, called: 2, seated: 19, no_show: 2, cancelled: 1,
}

/** งานค้างครัว — ผูกกับสถานีจริงในฐาน จะได้เห็นชื่อสถานีของร้านเอง */
export function mockWorkload(stations) {
  const load = [[5, 3, 2], [2, 4, 1], [1, 1, 3], [3, 2, 0]]
  return stations.map((station, i) => {
    const [pending, preparing, ready] = load[i % load.length]
    return { station, pending, preparing, ready }
  })
}

/**
 * รายได้ต่อโต๊ะ — ใช้โต๊ะจริงในฐาน เปิดจริง 7 จาก 12 ใบ
 * ค่าคงที่ตามลำดับโต๊ะ ไม่สุ่ม ตัวเลขจึงไม่กระพริบตอนหน้าจอวาดใหม่
 */
export function mockLive(tables) {
  const seat = [
    { guests: 4, total: 159600, pkg: 'มาตรฐาน 299' },
    { guests: 2, total: 79800,  pkg: 'มาตรฐาน 299' },
    { guests: 6, total: 279300, pkg: 'พรีเมียม 399' },
    null,
    { guests: 3, total: 119700, pkg: 'มาตรฐาน 299' },
    null,
    { guests: 5, total: 219500, pkg: 'พรีเมียม 399' },
    { guests: 2, total: 87400,  pkg: 'มาตรฐาน 299', status: 'awaiting_payment' },
    null,
    { guests: 4, total: 169600, pkg: 'พรีเมียม 399' },
    null,
    null,
  ]
  return tables.map((table, i) => {
    const s = seat[i % seat.length]
    if (!s) return { table, total: 0, guests: 0, visit: null }
    return {
      table,
      total: s.total,
      guests: s.guests,
      visit: { status: s.status ?? 'open', package_name_snapshot: s.pkg },
    }
  })
}
