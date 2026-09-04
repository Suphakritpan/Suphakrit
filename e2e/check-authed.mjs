/**
 * ตรวจ 19 หน้าที่มีด่านล็อกอิน โดยล็อกอินจริงก่อนแล้วอ่านสิ่งที่ขึ้นบนจอ
 *
 * รับรหัสผ่านทาง environment variable ไม่ฝังในไฟล์
 *   E2E_EMAIL=... E2E_PASSWORD=... node check-authed.mjs
 *
 * ล็อกอินครั้งเดียวแล้วใช้ context เดิมทุกหน้า — ทั้งเร็วกว่าและไม่สร้าง session ทิ้ง
 */
import { chromium } from '@playwright/test'

const BASE = 'https://frontend-gamma-nine-22.vercel.app'
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
if (!EMAIL || !PASSWORD) { console.error('ต้องตั้ง E2E_EMAIL และ E2E_PASSWORD'); process.exit(1) }

const GATED = [
  ['จอหน้าร้าน', '/display'],
  ['พนักงาน', '/staff'],
  ['พนักงาน', '/staff/queue'],
  ['พนักงาน', '/staff/kds'],
  ['พนักงาน', '/staff/kitchen'],
  ['พนักงาน', '/staff/serve'],
  ['พนักงาน', '/staff/checkout'],
  ['ผู้จัดการ', '/admin'],
  ['ผู้จัดการ', '/admin/queue'],
  ['ผู้จัดการ', '/admin/visits'],
  ['ผู้จัดการ', '/admin/bills'],
  ['ผู้จัดการ', '/admin/promotions'],
  ['ผู้จัดการ', '/admin/customers'],
  ['ผู้จัดการ', '/admin/staff'],
  ['ผู้จัดการ', '/admin/audit'],
  ['ผู้จัดการ', '/admin/menu'],
  ['ผู้จัดการ', '/admin/packages'],
  ['ผู้จัดการ', '/admin/tables'],
  ['ผู้จัดการ', '/admin/settings'],
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
let errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
page.on('pageerror', (e) => errs.push('UNCAUGHT ' + e.message))

// ── ล็อกอิน ────────────────────────────────────────────────────────────────
await page.goto(BASE + '/staff', { waitUntil: 'domcontentloaded' })
await page.getByRole('textbox', { name: 'อีเมล' }).waitFor({ timeout: 30000 })
await page.getByRole('textbox', { name: 'อีเมล' }).fill(EMAIL)
await page.getByRole('textbox', { name: 'รหัสผ่าน' }).fill(PASSWORD)
await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
await page.waitForTimeout(6000)

const afterLogin = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim()
if (/เข้าสู่ระบบพนักงาน/.test(afterLogin)) {
  console.error('ล็อกอินไม่ผ่าน:', afterLogin.slice(0, 200))
  await browser.close(); process.exit(1)
}
console.log('ล็อกอินสำเร็จ —', afterLogin.slice(0, 90))
console.log('')

// ── เดินทุกหน้า ────────────────────────────────────────────────────────────
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n)
console.log(pad('ที่อยู่', 22) + pad('หัวเรื่องที่ขึ้นจริง', 30) + pad('อักษร', 7) + pad('err', 5) + 'ผล')
console.log('─'.repeat(96))

const rows = []
for (const [group, path] of GATED) {
  errs = []
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2600)
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim()
  let head = await page.locator('h1, h2, .t-title, .t-display').first().innerText().catch(() => '')
  head = head.replace(/\s+/g, ' ').trim()

  let verdict = 'เห็นเนื้อหา'
  if (text.length < 15) verdict = 'จอเปล่า'
  else if (/เข้าสู่ระบบพนักงาน|เข้าสู่ระบบผู้จัดการ/.test(text)) verdict = 'ยังติดล็อกอิน'
  else if (/สำหรับผู้จัดการเท่านั้น/.test(text)) verdict = 'สิทธิ์ไม่พอ'
  else if (/กำลังเชื่อมต่อ|กำลังตรวจสอบสิทธิ์/.test(text)) verdict = 'ค้างหน้าโหลด'
  if (errs.some((e) => e.startsWith('UNCAUGHT'))) verdict = 'JS พัง'

  rows.push({ group, path, head, len: text.length, errs: [...errs], verdict })
  console.log(pad(path, 22) + pad(head, 30) + pad(text.length, 7) + pad(errs.length, 5) + verdict)
}

console.log('─'.repeat(96))
const by = (v) => rows.filter((r) => r.verdict === v).length
console.log(`ตรวจ ${rows.length} หน้า · เห็นเนื้อหา ${by('เห็นเนื้อหา')} · สิทธิ์ไม่พอ ${by('สิทธิ์ไม่พอ')} · มีปัญหา ${rows.length - by('เห็นเนื้อหา') - by('สิทธิ์ไม่พอ')}`)

const withErr = rows.filter((r) => r.errs.length)
if (withErr.length) {
  console.log('\nข้อความ error ที่เจอ:')
  for (const r of withErr) for (const e of r.errs) console.log(`  ${r.path} → ${e}`)
}
await browser.close()
