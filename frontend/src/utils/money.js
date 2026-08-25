// เงินในระบบนี้เป็น "สตางค์" (integer) ทุกที่ ตรงกับคอลัมน์ *_satang ในฐานข้อมูล
// ห้ามเก็บเงินเป็นทศนิยมลอยตัว เพราะ 0.1 + 0.2 !== 0.3

/** 29900 → "299" | 29950 → "299.50" */
export function satangToText(satang) {
  const n = Math.round(satang ?? 0)
  const baht = Math.trunc(Math.abs(n) / 100)
  const cents = Math.abs(n) % 100
  const sign = n < 0 ? '-' : ''
  const whole = baht.toLocaleString('th-TH')
  return cents === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(cents).padStart(2, '0')}`
}

/** 29900 → "฿299" */
export function baht(satang) {
  return `฿${satangToText(satang)}`
}

/** 299 → 29900 — ใช้ตอนรับค่าจากช่องกรอกของพนักงาน */
export function bahtToSatang(input) {
  const n = Number(String(input).replace(/[, ฿]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/**
 * คิดบิลฝั่งหน้าบ้าน — ใช้ "แสดงผล" เท่านั้น
 *
 * ยอดที่เชื่อถือได้คือ visits.total_satang ที่มาจาก recalculate_visit_totals() ในฐานข้อมูล
 * ถ้าปล่อยให้หน้าบ้านส่งยอดไปให้ระบบเชื่อ ลูกค้าแก้ค่าใน DevTools แล้วจ่าย 1 บาทได้
 * ฟังก์ชันนี้จึงมีไว้ให้ลูกค้าเห็นยอดคร่าว ๆ ระหว่างกินเท่านั้น
 *
 * ไม่มีตัวเลข 299 / 399 / 39 ฝังอยู่ในนี้ — ทุกค่ามาจากพารามิเตอร์ที่อ่านมาจาก DB
 */
export function previewBill({ visit, addons = [], extraItems = [], settings = {} }) {
  const buffet =
    visit.adult_count * visit.package_price_adult_satang +
    visit.child_count * visit.package_price_child_satang

  const addonTotal = addons.reduce((s, a) => s + a.unit_price_satang * a.quantity, 0)
  const extraTotal = extraItems.reduce((s, i) => s + i.unit_price_satang * i.quantity, 0)

  const subtotal = buffet + addonTotal + extraTotal
  const discount = Math.min(visit.discount_satang ?? 0, subtotal)
  const base = subtotal - discount

  const service = settings.service_charge_enabled
    ? Math.round((base * (settings.service_charge_rate_bp ?? 0)) / 10000)
    : 0

  let vat = 0
  let total = base + service

  if (settings.vat_enabled && settings.vat_rate_bp > 0) {
    if (settings.vat_inclusive) {
      // ราคารวมภาษีแล้ว → แยก VAT ออกมาเป็นข้อมูลบนใบเสร็จ ไม่บวกเพิ่ม
      vat = Math.round((total * settings.vat_rate_bp) / (10000 + settings.vat_rate_bp))
    } else {
      vat = Math.round(((base + service) * settings.vat_rate_bp) / 10000)
      total = base + service + vat
    }
  }

  return { buffet, addonTotal, extraTotal, subtotal, discount, service, vat, total }
}
