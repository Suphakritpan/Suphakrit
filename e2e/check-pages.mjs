/**
 * ตรวจว่าทั้ง 25 หน้าเรนเดอร์จริงบนโดเมน production ไม่ใช่แค่ตอบ 200
 *
 * สถานะ 200 พิสูจน์อะไรไม่ได้เลยกับ SPA เพราะ vercel.json ตั้ง rewrite ให้ทุก path
 * คืน index.html ที่อยู่มั่วก็ได้ 200 การตรวจจริงคือดูว่ามีอะไรขึ้นบนจอ
 *
 * ใช้ context เดียวตลอดทั้งชุด ห้ามเปิดใหม่ทีละหน้า
 * เพราะ context ใหม่ = สมัคร anonymous ใหม่หนึ่งคน 25 หน้าก็ 25 คน
 */
import { chromium } from '@playwright/test'

const BASE = 'https://frontend-gamma-nine-22.vercel.app'
const QUEUE_TOKEN = '7c83b9b2-1d23-445a-af81-df03575cdaf5'
const TABLE_TOKEN = 'cb54304b-9df7-4d8a-ba76-6d43c8b0b9e1'

const PAGES = [
  ['เปิดได้เลย', '/'],
  ['เปิดได้เลย', `/q/${QUEUE_TOKEN}`],
  ['เปิดได้เลย', `/v/${TABLE_TOKEN}`],
  ['จอหน้าร้าน', '/display'],
  ['ลูกค้า', '/order'],
  ['ลูกค้า', '/order/menu'],
  ['ลูกค้า', '/order/status'],
  ['ลูกค้า', '/order/bill'],
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
  ['ตัวดัก', '/ที่อยู่มั่ว-ไม่มีจริง'],
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

let errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`UNCAUGHT ${e.message}`))

const rows = []
for (const [group, path] of PAGES) {
  errors = []
  let landed = '', head = '', text = '', verdict = 'ok'
  try {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // หน้าจอรอ probe schema + anonymous sign-in + โหลดข้อมูลอ้างอิงก่อนถึงจะวาดของจริง
    await page.waitForTimeout(2500)
    landed = new URL(page.url()).pathname
    text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim()
    head = (await page.locator('h1, h2, .t-title, .t-display').first().innerText().catch(() => '')) || ''
    head = head.replace(/\s+/g, ' ').trim()
    if (text.length < 15) verdict = 'จอเปล่า'
    else if (/กำลังเชื่อมต่อ|กำลังตรวจสอบสิทธิ์/.test(text) ) verdict = 'ค้างที่หน้าโหลด'
  } catch (e) {
    verdict = 'พัง'
    head = e.message.slice(0, 60)
  }
  const uncaught = errors.filter((e) => e.startsWith('UNCAUGHT'))
  if (uncaught.length) verdict = 'JS พัง'
  rows.push({ group, path, landed, head, len: text.length, verdict, errs: errors.length, uncaught: uncaught.length })
}

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n)
console.log('')
console.log(pad('กลุ่ม', 12) + pad('ที่อยู่', 30) + pad('เด้งไป', 14) + pad('หัวเรื่องที่ขึ้นจริง', 34) + pad('อักษร', 7) + pad('err', 5) + 'ผล')
console.log('─'.repeat(118))
for (const r of rows) {
  console.log(
    pad(r.group, 12) + pad(r.path, 30) +
    pad(r.landed === r.path ? '—' : r.landed, 14) +
    pad(r.head, 34) + pad(r.len, 7) + pad(r.errs, 5) + r.verdict,
  )
}
const bad = rows.filter((r) => r.verdict !== 'ok')
console.log('─'.repeat(118))
console.log(`ตรวจ ${rows.length} หน้า · ผ่าน ${rows.length - bad.length} · มีปัญหา ${bad.length}`)
if (bad.length) for (const b of bad) console.log(`   ${b.path} → ${b.verdict}`)

await browser.close()
