import { test, expect } from '@playwright/test'
import {
  configured, select, rpc, insert, patch, remove, cleanup, STAFF_EMAIL, STAFF_PASSWORD,
} from '../support/db.js'

test.skip(!configured, 'ตั้ง E2E_STAFF_PASSWORD ก่อน (ชุดนี้ยิงเข้า Supabase จริง)')

test.describe.configure({ mode: 'serial' })

/**
 * ของใหม่ที่เทสต์ฐานข้อมูลยืนยันแทนไม่ได้ เพราะต้องกดผ่านหน้าจอจริง
 *
 *   ① ใส่โค้ดโปรโมชั่นที่หน้าเช็คบิล — เส้นทางที่กระทบเงินโดยตรง
 *   ② แก้ตั้งค่าร้านจากหน้าผู้จัดการ — ค่าที่ RPC ฝั่งฐานข้อมูลอ่านไปบังคับใช้จริง
 *   ③ ผังโต๊ะขยับเองเมื่อมีคนเปิดโต๊ะจากอีกเครื่อง — ไม่ต้องรีเฟรช
 */

const created = { visitIds: [] }
const PROMO_CODE = 'E2E10'

test.afterAll(async () => {
  await cleanup(created)
  // ลบโปรตรง ๆ ไม่ได้ถ้ายังมีบิลอ้างถึงอยู่ (FK on delete restrict) — เก็บใบที่อ้างก่อน
  const [promo] = await select('promotions', `select=id&code=eq.${PROMO_CODE}`).catch(() => [])
  if (!promo) return
  await remove('visit_promotions', `promotion_id=eq.${promo.id}`).catch(() => {})
  await remove('promotions', `id=eq.${promo.id}`).catch(() => {})
})

async function loginAsStaff(page, to) {
  await page.goto(to)
  const loginForm = page.getByRole('heading', { name: /เข้าสู่ระบบ/ })
  const shell = page.locator('.shell')
  await expect(loginForm.or(shell).first()).toBeVisible({ timeout: 30_000 })

  if (await loginForm.isVisible()) {
    await page.getByLabel('อีเมล').fill(STAFF_EMAIL)
    await page.getByLabel('รหัสผ่าน').fill(STAFF_PASSWORD)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(shell).toBeVisible({ timeout: 30_000 })
  }
}

async function openTable() {
  const [table] = await select('tables', 'select=id,table_number&status=eq.available&limit=1')
  test.skip(!table, 'ไม่มีโต๊ะว่างในฐานข้อมูลตอนนี้')

  const [pkg] = await select('buffet_packages', 'select=id&is_active=eq.true&limit=1')
  const visit = await rpc('open_visit', {
    p_table_id: table.id, p_package_id: pkg.id,
    p_adult_count: 2, p_child_count: 0, p_addons: [],
  })
  created.visitIds.push(visit.id)
  return { table, visit }
}

test('พนักงานพิมพ์โค้ดโปรที่หน้าเช็คบิลแล้วยอดต้องลดจริง', async ({ page }) => {
  const [branch] = await select('branches', 'select=id&limit=1')

  // โปรของจริง (LUNCH10) จำกัด จ–ศ 11:00–16:00 — เทสต์ที่รันตอนกลางคืนจะล้มโดยไม่ใช่ความผิดของโค้ด
  // จึงใช้โค้ดของเทสต์เองที่ไม่ผูกวันเวลา และเขียนแบบ idempotent เผื่อรอบก่อนล้มกลางทาง
  const fields = {
    name: 'E2E ลดสิบเปอร์เซ็นต์', type: 'percent', scope: 'bill',
    value_bp: 1000, min_spend_satang: 0, days_of_week: [],
    time_start: null, time_end: null, max_uses: null, is_active: true,
  }
  const [existing] = await select('promotions', `select=id&code=eq.${PROMO_CODE}`)
  if (existing) await patch('promotions', `code=eq.${PROMO_CODE}`, fields)
  else await insert('promotions', { branch_id: branch.id, code: PROMO_CODE, ...fields })

  const { table, visit } = await openTable()

  await loginAsStaff(page, '/staff/checkout')
  await page.locator('.tcard').filter({ hasText: table.table_number }).first().click()

  await page.getByPlaceholder('โค้ดโปรโมชั่น').fill(PROMO_CODE)
  await page.getByRole('button', { name: 'ใส่โค้ด' }).click()

  // ชื่อโปรโผล่สองที่: ป้ายในกล่องรับชำระ กับบรรทัดส่วนลดบนใบเสร็จ — เจาะที่ป้าย
  await expect(page.locator('.chip').filter({ hasText: 'E2E ลดสิบเปอร์เซ็นต์' }))
    .toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('ส่วนลด · E2E ลดสิบเปอร์เซ็นต์')).toBeVisible()

  // ยอดที่เชื่อได้คือของฐานข้อมูล ไม่ใช่ตัวเลขบนจอ
  await expect
    .poll(async () => (await select('visit_promotions', `select=discount_satang&visit_id=eq.${visit.id}`))[0]?.discount_satang,
      { timeout: 20_000 })
    .toBeGreaterThan(0)

  const [after] = await select('visits',
    `select=subtotal_satang,discount_satang,total_satang&id=eq.${visit.id}`)
  expect(after.discount_satang).toBe(Math.round(after.subtotal_satang * 0.1))
  expect(after.total_satang).toBeLessThan(after.subtotal_satang)

  // ถอดออกแล้วยอดต้องกลับมาเต็ม
  await page.getByRole('button', { name: 'ถอด' }).click()
  await expect
    .poll(async () => (await select('visits', `select=discount_satang&id=eq.${visit.id}`))[0]?.discount_satang,
      { timeout: 20_000 })
    .toBe(0)
})

test('ผู้จัดการแก้เพดานการสั่งแล้วค่าต้องลงฐานข้อมูลจริง', async ({ page }) => {
  const [before] = await select('restaurant_settings', 'select=branch_id,max_qty_per_item&limit=1')
  const target = before.max_qty_per_item === 7 ? 8 : 7

  await loginAsStaff(page, '/admin/settings')

  const field = page.getByLabel('สูงสุดต่อเมนูต่อรอบ')
  await expect(field).toBeVisible({ timeout: 30_000 })
  await field.fill(String(target))
  await page.getByRole('button', { name: /บันทึกทั้งหมด/ }).click()

  await expect
    .poll(async () => (await select('restaurant_settings',
      `select=max_qty_per_item&branch_id=eq.${before.branch_id}`))[0]?.max_qty_per_item,
      { timeout: 20_000 })
    .toBe(target)

  // คืนค่าเดิม — ค่านี้เป็นกฎที่ place_order() ใช้จริง ห้ามทิ้งค่าของเทสต์ไว้
  await patch('restaurant_settings', `branch_id=eq.${before.branch_id}`,
    { max_qty_per_item: before.max_qty_per_item })
})

test('เปิดโต๊ะจากอีกเครื่องแล้วผังโต๊ะต้องขยับเอง ไม่ต้องรีเฟรช', async ({ page }) => {
  await loginAsStaff(page, '/staff')

  const [free] = await select('tables', 'select=id,table_number&status=eq.available&limit=1')
  test.skip(!free, 'ไม่มีโต๊ะว่างในฐานข้อมูลตอนนี้')

  const card = page.locator('.tcard').filter({ hasText: free.table_number }).first()
  await expect(card).toContainText('ว่าง', { timeout: 30_000 })

  // เปิดโต๊ะผ่าน RPC = จำลองพนักงานอีกคนที่เครื่องอื่น
  const [pkg] = await select('buffet_packages', 'select=id&is_active=eq.true&limit=1')
  const visit = await rpc('open_visit', {
    p_table_id: free.id, p_package_id: pkg.id,
    p_adult_count: 2, p_child_count: 0, p_addons: [],
  })
  created.visitIds.push(visit.id)

  // สถานะโต๊ะเคยอยู่ใน reference ที่โหลดครั้งเดียวตอนเปิดแอป การ์ดจึงค้างจนกว่าจะ reload
  await expect(card).toContainText('กำลังใช้งาน', { timeout: 30_000 })
})
