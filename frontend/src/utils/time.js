// เวลาทั้งระบบเก็บเป็น timestamptz แล้วแสดงผลตามเวลาไทย

const TZ = 'Asia/Bangkok'

export function clockTH(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('th-TH', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit',
  })
}

export function dateTH(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('th-TH', {
    timeZone: TZ, day: 'numeric', month: 'short', year: '2-digit',
  })
}

/** นาทีที่ผ่านไปตั้งแต่ iso จนถึงตอนนี้ */
export function minutesSince(iso, now = Date.now()) {
  return Math.floor((now - new Date(iso).getTime()) / 60000)
}

/**
 * เวลาที่เหลือจนถึง deadline
 * ใช้กับกฎจำกัดเวลา 90/120 นาที และกฎ last order
 */
export function remaining(deadlineIso, now = Date.now()) {
  const ms = new Date(deadlineIso).getTime() - now
  const over = ms < 0
  const abs = Math.abs(ms)
  const totalMin = Math.floor(abs / 60000)

  return {
    over,
    totalMinutes: over ? -totalMin : totalMin,
    hours: Math.floor(totalMin / 60),
    minutes: totalMin % 60,
    seconds: Math.floor((abs % 60000) / 1000),
    text: `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}:${String(Math.floor((abs % 60000) / 1000)).padStart(2, '0')}`,
    /** เหลือน้อยกว่า 15 นาที = เตือน */
    warning: !over && totalMin < 15,
  }
}

/** สัดส่วนเวลาที่ใช้ไปแล้ว 0..1 — ใช้วาดแถบเวลาบนผังโต๊ะ */
export function elapsedRatio(startIso, deadlineIso, now = Date.now()) {
  const start = new Date(startIso).getTime()
  const end = new Date(deadlineIso).getTime()
  if (end <= start) return 1
  return Math.min(1, Math.max(0, (now - start) / (end - start)))
}
