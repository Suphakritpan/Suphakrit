import { test, expect } from '@playwright/test'
import { configured, select, rpc, cleanup, STAFF_EMAIL, STAFF_PASSWORD } from '../support/db.js'
// ตัวจัดรูปแบบเงินตัวเดียวกับที่หน้าจอใช้ — เทียบข้อความบนจอกับฐานข้อมูลได้ตรง ๆ
// โดยไม่ต้องเขียนสูตรแปลงสตางค์ซ้ำในเทสต์ (เขียนซ้ำแล้วผิดพร้อมกันทั้งคู่ก็จับไม่ได้)
import { baht } from '../../frontend/src/utils/money.js'

test.skip(!configured, 'ตั้ง E2E_STAFF_PASSWORD ก่อน (ชุดนี้ยิงเข้า Supabase จริง)')

test.describe.configure({ mode: 'serial' })

/**
 * หน้าผู้จัดการต้อง "เจาะลงไปดูของจริง" ได้ ไม่ใช่แค่โชว์ตัวเลขรวม
 * ----------------------------------------------------------------------------
 *   ① /admin/visits → รอบหนึ่ง → ออเดอร์ → บิล → การชำระเงิน
 *   ② /admin/bills  → รายการชำระที่เพิ่งรับผ่านหน้าจอพนักงาน
 *   ③ /admin/audit  → กด "ดูค่า" แล้ว before/after ต้องตรงกับฐานข้อมูลทุกตัวอักษร
 *
 * ทุกข้อเทียบสิ่งที่ "แสดงบนจอ" กับ "แถวในฐานข้อมูล" โดยตรง
 * เพราะหน้าผู้จัดการคือที่ที่คนใช้ตัดสินใจเรื่องเงิน แสดงผิดแปลว่าตัดสินใจผิด
 */

const created = { visitIds: [] }
const paymentIds = []

test.afterAll(async () => {
  // ยกเลิกการชำระก่อน ไม่งั้นยอดขายวันนี้ของร้านจริงมีเงินของเทสต์ปนอยู่
  for (const id of paymentIds) {
    await rpc('cancel_payment', { p_payment_id: id, p_reason: 'เก็บกวาดหลัง E2E' }).catch(() => {})
  }
  await cleanup(created)
})

async function loginAsStaff(page, to) {
  await page.goto(to)
  const form = page.getByRole('heading', { name: /เข้าสู่ระบบ/ })
  const shell = page.locator('.shell')
  await expect(form.or(shell).first()).toBeVisible({ timeout: 30_000 })

  if (await form.isVisible()) {
    await page.getByLabel('อีเมล').fill(STAFF_EMAIL)
    await page.getByLabel('รหัสผ่าน').fill(STAFF_PASSWORD)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(shell).toBeVisible({ timeout: 30_000 })
  }
}

/** เปิดโต๊ะพร้อมออเดอร์หนึ่งรอบ — arrange ผ่าน RPC ส่วนที่ทดสอบคือหน้าจอผู้จัดการ */
async function seatWithOrder(itemCount = 2) {
  const [table] = await select('tables', 'select=id,table_number&status=eq.available&limit=1')
  test.skip(!table, 'ไม่มีโต๊ะว่างในฐานข้อมูลตอนนี้')

  const [pkg] = await select('buffet_packages', 'select=id&is_active=eq.true&limit=1')
  const visit = await rpc('open_visit', {
    p_table_id: table.id, p_package_id: pkg.id,
    p_adult_count: 2, p_child_count: 1, p_addons: [],
  })
  created.visitIds.push(visit.id)

  const menu = await select('menu_items',
    `select=id,name_th&is_available=eq.true&is_included_in_buffet=eq.true&limit=${itemCount}`)
  await rpc('place_order', {
    p_visit_id: visit.id,
    p_items: menu.map((m, i) => ({ menu_item_id: m.id, quantity: i + 1 })),
    p_note: null,
  })

  return { table, visit, menu }
}

// ════════════════════════════════════════════════════════════════════════════
test('ผู้จัดการเจาะจากรอบการใช้บริการลงไปถึงออเดอร์และบิล แล้วต้องตรงกับฐานข้อมูล', async ({ page }) => {
  const { table, visit } = await seatWithOrder(2)
  await rpc('request_visit_bill', { p_visit_id: visit.id })

  await loginAsStaff(page, '/admin/visits')

  const row = page.locator('.data tbody tr').filter({ hasText: visit.visit_code }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row).toContainText(table.table_number)
  await row.click()

  const sheet = page.locator('.sheet__box')
  await expect(sheet).toBeVisible({ timeout: 20_000 })
  await expect(sheet.getByRole('heading')).toContainText(visit.visit_code)
  await expect(sheet.getByRole('heading')).toContainText(table.table_number)
  await expect(sheet).toContainText('3 ท่าน')          // 2 ผู้ใหญ่ + 1 เด็ก

  // ── ออเดอร์: จำนวนรอบและทุกบรรทัดต้องตรงกับ order_items จริง ──────────────
  const orders = await select('orders', `select=id,order_number&visit_id=eq.${visit.id}&order=order_number`)
  await expect(sheet).toContainText(`ออเดอร์ ${orders.length} รอบ`)

  for (const o of orders) {
    const items = await select('order_items',
      `select=quantity,name_snapshot&order_id=eq.${o.id}&order=created_at`)
    expect(items.length).toBeGreaterThan(0)
    for (const i of items) {
      await expect(sheet).toContainText(`${i.quantity} × ${i.name_snapshot}`)
    }
  }

  // ── บิล: ทุกบรรทัดและยอดสุทธิต้องตรงกับ bill_lines จริง ───────────────────
  const lines = await select('bill_lines',
    `select=description,quantity,amount_satang&visit_id=eq.${visit.id}&order=sort_order`)
  expect(lines.length).toBeGreaterThan(0)
  for (const l of lines) {
    const slip = sheet.locator('.slip__l').filter({ hasText: l.description }).first()
    await expect(slip).toContainText(baht(l.amount_satang))
  }

  const [row2] = await select('visits', `select=total_satang&id=eq.${visit.id}`)
  await expect(sheet.locator('.slip__total')).toContainText(baht(row2.total_satang))

  // ── ยังไม่จ่าย = ต้องบอกว่ายังไม่มีรายการชำระ ไม่ใช่ปล่อยว่าง ──────────────
  await expect(sheet).toContainText('ยังไม่มีรายการชำระ')
})

// ════════════════════════════════════════════════════════════════════════════
test('รับชำระผ่านหน้าจอพนักงานแล้วหน้าบิลของผู้จัดการต้องขึ้นตรงกับฐานข้อมูล', async ({ page }) => {
  const { table, visit } = await seatWithOrder(1)

  await loginAsStaff(page, '/staff/checkout')
  await page.locator('.tcard').filter({ hasText: table.table_number }).first().click()

  // เลือกช่องทางแรก (เงินสด) แล้วกดรับชำระ — เส้นทางเงินจริงของพนักงาน
  await page.locator('.pay').first().click()
  await page.getByRole('button', { name: /ยืนยันรับชำระ/ }).click()

  // ── ยอดที่เชื่อได้คือของฐานข้อมูล ────────────────────────────────────────
  await expect
    .poll(async () => (await select('payments',
      `select=id&visit_id=eq.${visit.id}&status=eq.succeeded`)).length, { timeout: 30_000 })
    .toBe(1)

  const [payment] = await select('payments',
    `select=id,receipt_number,method,amount_satang,tendered_satang,change_satang,status` +
    `&visit_id=eq.${visit.id}`)
  paymentIds.push(payment.id)
  expect(payment.receipt_number).toBeTruthy()
  expect(payment.amount_satang).toBeGreaterThan(0)

  // ── /admin/bills ต้องขึ้นรายการเดียวกัน ตัวเลขตรงกันทุกช่อง ───────────────
  await page.goto('/admin/bills')
  const bill = page.locator('.data tbody tr').filter({ hasText: payment.receipt_number }).first()
  await expect(bill).toBeVisible({ timeout: 30_000 })
  await expect(bill).toContainText(payment.method)
  await expect(bill).toContainText(baht(payment.amount_satang))
  await expect(bill).toContainText(payment.status)

  // ── เจาะต่อจากรอบการใช้บริการ: บิลใบนี้ต้องโผล่ในกล่องการชำระเงินของ visit ─
  await page.goto('/admin/visits')
  await page.locator('.data tbody tr').filter({ hasText: visit.visit_code }).first().click()
  const sheet = page.locator('.sheet__box')
  await expect(sheet).toBeVisible({ timeout: 20_000 })
  const line = sheet.locator('.between').filter({ hasText: payment.method }).first()
  await expect(line).toContainText(baht(payment.amount_satang))
  await expect(line).toContainText('succeeded')
})

// ════════════════════════════════════════════════════════════════════════════
test('บันทึกตรวจสอบต้องเปิดดูค่าก่อน/หลังได้ และตรงกับที่ฐานข้อมูลเก็บไว้จริง', async ({ page }) => {
  const { visit } = await seatWithOrder(1)

  // แก้จำนวนคนกลางมื้อ — เป็นการกระทำที่กระทบยอดเงิน จึงต้องย้อนดูได้ว่าเดิมกี่คน
  await rpc('adjust_visit_guests', { p_visit_id: visit.id, p_adults: 3, p_children: 1 })

  const [log] = await select('audit_logs',
    `select=id,action,entity,entity_id,before,after&entity_id=eq.${visit.id}` +
    '&action=eq.adjust_visit_guests&order=created_at.desc&limit=1')
  expect(log, 'adjust_visit_guests ต้องเขียน audit log').toBeTruthy()

  // ค่าก่อนแก้ต้องเป็นของเดิมจริง ไม่ใช่ค่าใหม่ทั้งคู่ (บั๊กที่ 0015 แก้ไป)
  expect(log.before).toEqual({ adult_count: 2, child_count: 1 })
  expect(log.after).toEqual({ adult_count: 3, child_count: 1 })

  await loginAsStaff(page, '/admin/audit')

  const row = page.locator('.data tbody tr').filter({ hasText: 'adjust_visit_guests' }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.getByRole('button', { name: 'ดูค่า' }).click()

  const sheet = page.locator('.sheet__box')
  await expect(sheet).toBeVisible({ timeout: 20_000 })
  await expect(sheet).toContainText(log.entity_id)      // เจาะถูกใบ ไม่ใช่ใบข้างเคียง
  await expect(sheet).toContainText(log.entity)

  // เทียบ JSON ที่แสดงกับที่ฐานข้อมูลเก็บ — ต้องตรงกันทั้งก้อน ไม่ใช่แค่มีคำว่า adult
  const shown = await sheet.locator('pre').allInnerTexts()
  expect(JSON.parse(shown[0])).toEqual(log.before)
  expect(JSON.parse(shown[1])).toEqual(log.after)
})
