import { test, expect } from '@playwright/test'
import { configured, select, rpc, cleanup, STAFF_EMAIL, STAFF_PASSWORD } from '../support/db.js'
import { stateHasSession } from '../support/global-setup.js'

test.skip(!configured, 'ตั้ง E2E_STAFF_PASSWORD ก่อน (ชุดนี้ยิงเข้า Supabase จริง)')

test.describe.configure({ mode: 'serial' })

/**
 * ช่องโหว่ที่เจอตอนไล่ lifecycle เต็มรอบด้วยมือ — ทุกข้อเป็นเรื่องที่
 * เทสต์ฐานข้อมูลจับไม่ได้ เพราะมันอยู่ที่ "หน้าจอทำอะไรกับ session และปุ่มไหนกดได้"
 *
 *   ① รีเฟรชแล้วลูกค้าหลุดไปโต๊ะคนอื่น
 *   ② QR สติกเกอร์ติดโต๊ะ + รหัส 6 หลัก ใช้ไม่ได้จริง
 *   ③ ปิดรอบได้ทั้งที่อาหารยังค้างครัว จนตั๋วค้างจอครัวถาวร
 */

const created = { visitIds: [] }
test.afterAll(() => cleanup(created))

async function loginAsStaff(page, to = '/staff') {
  await page.goto(to)
  const loginForm = page.getByRole('heading', { name: /เข้าสู่ระบบพนักงาน/ })
  const console_ = page.locator('.shell')
  await expect(loginForm.or(console_).first()).toBeVisible({ timeout: 30_000 })

  if (await loginForm.isVisible()) {
    await page.getByLabel('อีเมล').fill(STAFF_EMAIL)
    await page.getByLabel('รหัสผ่าน').fill(STAFF_PASSWORD)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(console_).toBeVisible({ timeout: 30_000 })
  }
}

/** เปิดโต๊ะผ่าน RPC — เทสต์กลุ่มนี้สนใจสิ่งที่เกิดหลังจากนั้น ไม่ใช่ตัวการเปิดโต๊ะ */
async function openTable() {
  const [table] = await select('tables', 'select=id,table_number,qr_token&status=eq.available&limit=1')
  test.skip(!table, 'ไม่มีโต๊ะว่างในฐานข้อมูลตอนนี้')

  const [pkg] = await select('buffet_packages', 'select=id&is_active=eq.true&limit=1')
  const visit = await rpc('open_visit', {
    p_table_id: table.id, p_package_id: pkg.id,
    p_adult_count: 2, p_child_count: 0, p_addons: [],
  })
  created.visitIds.push(visit.id)
  return { table, visit }
}

/** ลูกค้าเปิดหน้าใหม่ — ล้างเฉพาะโต๊ะที่จำไว้ ไม่แตะ session ของ supabase (กัน rate limit) */
async function asFreshCustomer(page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('shabu.visit'))
}

test('รีเฟรชกลางมื้อแล้วลูกค้าต้องยังอยู่โต๊ะเดิม', async ({ page }) => {
  // มี session ผู้เยี่ยมชมที่ global-setup เตรียมไว้ไหม — ไม่ต้องสมัครใหม่ทุกเทสต์อีกแล้ว
  test.skip(!stateHasSession(), 'ไม่มี session ผู้เยี่ยมชม (anonymous sign-in ใช้ไม่ได้) — ทางเข้าลูกค้าทดสอบไม่ได้')
  const { table, visit } = await openTable()

  await asFreshCustomer(page)
  await page.goto(`/v/${visit.session_token}`)
  await expect(page.getByText(`โต๊ะ ${table.table_number}`).first()).toBeVisible({ timeout: 30_000 })

  // จุดที่เคยพัง: joinedVisitId อยู่ใน state ล้วน รีเฟรชแล้วเด้งไปโต๊ะที่เปิดอยู่ใบแรก
  await page.reload()
  await expect(page.getByText(`โต๊ะ ${table.table_number}`).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('ยังไม่ได้เข้าโต๊ะ')).toHaveCount(0)

  // ยืนยันที่ฐานข้อมูลว่าเป็นเครื่องเดิมของ visit เดิม ไม่ใช่ join ใหม่เข้าโต๊ะอื่น
  const devices = await select('visit_devices', `select=visit_id&visit_id=eq.${visit.id}`)
  expect(devices.length).toBeGreaterThan(0)
})

test('QR สติกเกอร์ติดโต๊ะต้องขอรหัส 6 หลัก แล้วเข้าโต๊ะได้', async ({ page }) => {
  // มี session ผู้เยี่ยมชมที่ global-setup เตรียมไว้ไหม — ไม่ต้องสมัครใหม่ทุกเทสต์อีกแล้ว
  test.skip(!stateHasSession(), 'ไม่มี session ผู้เยี่ยมชม (anonymous sign-in ใช้ไม่ได้) — ทางเข้าลูกค้าทดสอบไม่ได้')
  const { table, visit } = await openTable()

  await asFreshCustomer(page)
  await page.goto(`/v/${table.qr_token}`)

  const code = page.getByLabel('รหัส 6 หลัก')
  await expect(code).toBeVisible({ timeout: 30_000 })

  await code.fill('000000')
  await page.getByRole('button', { name: 'เข้าโต๊ะ' }).click()
  await expect(page.getByText('รหัสเข้าโต๊ะไม่ถูกต้อง')).toBeVisible({ timeout: 20_000 })

  await code.fill(visit.access_code)
  await page.getByRole('button', { name: 'เข้าโต๊ะ' }).click()
  await expect(page.getByText(`โต๊ะ ${table.table_number}`).first()).toBeVisible({ timeout: 30_000 })

  // ครั้งที่ผิดต้องถูกบันทึกไว้ ไม่ใช่ปล่อยลองได้ไม่จำกัด
  const fails = await select('visit_access_attempts',
    `select=succeeded&visit_id=eq.${visit.id}&succeeded=eq.false`)
  expect(fails.length).toBeGreaterThan(0)
})

test('อาหารค้างครัวต้องปิดรอบไม่ได้ จนกว่าครัวจะเคลียร์', async ({ page }) => {
  const { table, visit } = await openTable()

  const [item] = await select('menu_items', 'select=id&is_available=eq.true&limit=1')
  await rpc('place_order', {
    p_visit_id: visit.id,
    p_items: [{ menu_item_id: item.id, quantity: 1 }],
    p_note: null,
  })

  await rpc('request_visit_bill', { p_visit_id: visit.id })
  const due = await rpc('visit_amount_due', { p_visit_id: visit.id })
  const payment = await rpc('create_payment', {
    p_visit_id: visit.id, p_method: 'cash', p_amount_satang: due,
    p_tendered_satang: due, p_provider_ref: null, p_payload: null,
  })
  await rpc('confirm_payment', { p_payment_id: payment.id, p_provider_ref: null, p_payload: null })

  // ── หน้าเช็คบิลต้องเตือน และปิดปุ่มปิดรอบไว้ ──
  await loginAsStaff(page, '/staff/checkout')
  await page.locator('.tcard').filter({ hasText: table.table_number }).first().click()
  await expect(page.getByText(/ยังมีอาหารค้างที่ครัว/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /รอครัวเคลียร์อีก/ })).toBeDisabled()

  // ── ครัวยกเลิกรายการพร้อมเหตุผล ──
  await page.goto('/staff/kds')
  const ticket = page.locator('.tkt').filter({ hasText: `โต๊ะ ${table.table_number}` }).first()
  await expect(ticket).toBeVisible({ timeout: 20_000 })
  await ticket.locator('.tkt__row button[title="ยกเลิกรายการนี้"]').first().click()
  await page.locator('.sheet__box').getByRole('button', { name: 'ของหมด' }).click()

  const [order] = await select('orders', `select=id&visit_id=eq.${visit.id}`)
  await expect
    .poll(async () => (await select('order_items',
      `select=status,cancelled_reason&order_id=eq.${order.id}`))[0]?.cancelled_reason,
    { timeout: 20_000 })
    .toBe('ของหมด')

  // ── เคลียร์แล้วปิดรอบได้ โต๊ะไปรอทำความสะอาด ──
  await page.goto('/staff/checkout')
  await page.locator('.tcard').filter({ hasText: table.table_number }).first().click()
  await page.getByRole('button', { name: /ปิดรอบ/ }).click()

  await expect
    .poll(async () => (await select('visits', `select=status&id=eq.${visit.id}`))[0]?.status,
      { timeout: 20_000 })
    .toBe('closed')

  const [after] = await select('tables', `select=status&id=eq.${table.id}`)
  expect(after.status).toBe('cleaning')

  // คืนโต๊ะให้ร้านใช้งานต่อ — เทสต์เก็บกวาดของที่ตัวเองสร้างเสมอ
  await rpc('mark_table_clean', { p_table_id: table.id })
})
