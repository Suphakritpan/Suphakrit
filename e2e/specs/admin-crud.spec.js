import { test, expect } from '@playwright/test'
import {
  configured, hasWaiter, select, insert, remove, attempt, tag,
  staffToken, waiterToken,
  STAFF_EMAIL, STAFF_PASSWORD, WAITER_EMAIL, WAITER_PASSWORD,
} from '../support/db.js'

test.skip(!configured, 'ตั้ง E2E_STAFF_PASSWORD ก่อน (ชุดนี้ยิงเข้า Supabase จริง)')

test.describe.configure({ mode: 'serial' })

/**
 * งานผู้จัดการที่ยังไม่เคยพิสูจน์ผ่านหน้าจอจริง
 * ----------------------------------------------------------------------------
 *   ① เพิ่ม / แก้ / ลบเมนู — รวมการแปลงบาทเป็นสตางค์ตรงขอบฟอร์ม
 *   ② เพิ่ม / แก้ / ลบโต๊ะและโซน
 *   ③ RLS: พนักงานที่ไม่ใช่ผู้จัดการต้องแก้ไม่ได้ แม้หน้าจอจะเปิดให้กด
 *
 * ทุกแถวที่สร้างขึ้นตั้งชื่อขึ้นต้นด้วย E2E- เสมอ — global teardown กวาดซ้ำอีกชั้น
 * เผื่อเทสต์ล้มกลางทางแล้วไม่ได้เก็บของตัวเอง (ชุดนี้เขียนลงฐานข้อมูลของร้านจริง)
 */

const MENU_NAME = tag('หมูสไลซ์ทดสอบ')
const MENU_RENAMED = tag('หมูสไลซ์ทดสอบแก้แล้ว')
const VICTIM_NAME = tag('เมนูห้ามแก้')
const ZONE_CODE = 'E2E-Z'
const TABLE_NUMBER = tag('T1')

async function login(page, to, email, password) {
  await page.goto(to)
  const form = page.getByRole('heading', { name: /เข้าสู่ระบบ/ })
  const shell = page.locator('.shell')
  await expect(form.or(shell).first()).toBeVisible({ timeout: 30_000 })

  if (await form.isVisible()) {
    await page.getByLabel('อีเมล').fill(email)
    await page.getByLabel('รหัสผ่าน').fill(password)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(shell).toBeVisible({ timeout: 30_000 })
  }
}

const asManager = (page, to) => login(page, to, STAFF_EMAIL, STAFF_PASSWORD)

/** แถวในตารางผู้จัดการไม่มี id ให้เกาะ — เกาะที่ค่าในช่องกรอกของแถวนั้นแทน */
const rowWith = (page, value) =>
  page.locator('.data tbody tr').filter({ has: page.locator(`input[value="${value}"]`) }).first()

const one = async (table, query) => (await select(table, query))[0]

test.afterAll(async () => {
  // เผื่อเทสต์ล้มก่อนถึงขั้นลบ — ลำดับสำคัญ โต๊ะอ้างถึงโซน
  await remove('tables', `table_number=like.E2E-*`).catch(() => {})
  await remove('zones', `code=eq.${ZONE_CODE}`).catch(() => {})
  await remove('menu_items', `name_th=like.E2E-*`).catch(() => {})
})

// ════════════════════════════════════════════════════════════════════════════
test('ผู้จัดการเพิ่ม แก้ ลบเมนูผ่านหน้าจอ แล้วฐานข้อมูลต้องขยับตามทุกขั้น', async ({ page }) => {
  await asManager(page, '/admin/menu')

  // ── เพิ่ม ────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /เพิ่มเมนู/ }).first().click()
  const sheet = page.locator('.sheet__box')
  await expect(sheet).toBeVisible({ timeout: 20_000 })

  await sheet.getByLabel('ชื่อเมนู').fill(MENU_NAME)
  // สั่งพิเศษ + ราคา 120 บาท — ตรงนี้คือจุดที่ฟอร์มต้องแปลงเป็นสตางค์ให้ถูก
  // บั๊ก "หน้าจอส่งค่าผิดเข้า RPC" เคยรอดเทสต์ฐานข้อมูลมาแล้วครั้งหนึ่ง
  await sheet.getByLabel('ประเภท').selectOption('alacarte')
  await sheet.getByLabel('ราคา (บาท)').fill('120')
  await sheet.getByRole('button', { name: 'เพิ่มเมนู' }).click()

  const q = `name_th=eq.${encodeURIComponent(MENU_NAME)}` +
            '&select=id,a_la_carte_price_satang,is_included_in_buffet,is_available'
  await expect.poll(async () => (await select('menu_items', q)).length, { timeout: 20_000 }).toBe(1)

  const created = await one('menu_items', q)
  expect(created.a_la_carte_price_satang).toBe(12_000)   // 120 บาท ไม่ใช่ 120 สตางค์
  expect(created.is_included_in_buffet).toBe(false)
  expect(created.is_available).toBe(true)

  // ── แก้ ──────────────────────────────────────────────────────────────────
  const row = rowWith(page, MENU_NAME)
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.locator('input[type="text"], input:not([type])').first().fill(MENU_RENAMED)
  await row.getByRole('button', { name: 'บันทึก' }).click()

  await expect
    .poll(async () => (await one('menu_items', `select=name_th&id=eq.${created.id}`))?.name_th,
      { timeout: 20_000 })
    .toBe(MENU_RENAMED)

  // ── 86 แล้วคืน — ปุ่มเดียวกับที่ครัวใช้จริง ────────────────────────────────
  const renamed = rowWith(page, MENU_RENAMED)
  await renamed.getByRole('button', { name: '86', exact: true }).click()
  await expect
    .poll(async () => (await one('menu_items', `select=is_available&id=eq.${created.id}`))?.is_available,
      { timeout: 20_000 })
    .toBe(false)

  await renamed.getByRole('button', { name: 'คืน', exact: true }).click()
  await expect
    .poll(async () => (await one('menu_items', `select=is_available&id=eq.${created.id}`))?.is_available,
      { timeout: 20_000 })
    .toBe(true)

  // ── ลบ ───────────────────────────────────────────────────────────────────
  await renamed.locator('button[title^="ลบเมนู"]').click()
  await expect
    .poll(async () => (await select('menu_items', `select=id&id=eq.${created.id}`)).length, { timeout: 20_000 })
    .toBe(0)
})

// ════════════════════════════════════════════════════════════════════════════
test('ผู้จัดการเพิ่มโซนและโต๊ะ แก้ที่นั่ง แล้วลบ โดยฐานข้อมูลขยับตามทุกขั้น', async ({ page }) => {
  await asManager(page, '/admin/tables')

  // ── โซน ──────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /เพิ่มโซน/ }).click()
  await page.getByPlaceholder('รหัส (A)').fill(ZONE_CODE)
  await page.getByPlaceholder('ชื่อโซน').fill('โซนทดสอบ')
  await page.getByRole('button', { name: 'เพิ่ม', exact: true }).click()

  await expect
    .poll(async () => (await select('zones', `select=id&code=eq.${ZONE_CODE}`)).length, { timeout: 20_000 })
    .toBe(1)
  const zone = await one('zones', `select=id,name&code=eq.${ZONE_CODE}`)
  expect(zone.name).toBe('โซนทดสอบ')

  // ── โต๊ะ ─────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: /เพิ่มโต๊ะ/ }).first().click()
  const sheet = page.locator('.sheet__box')
  await expect(sheet).toBeVisible({ timeout: 20_000 })

  await sheet.getByLabel('หมายเลขโต๊ะ').fill(TABLE_NUMBER)
  await sheet.getByLabel('ที่นั่ง').fill('4')
  await sheet.getByLabel('โซน').selectOption(zone.id)
  await sheet.getByRole('button', { name: 'เพิ่มโต๊ะ' }).click()

  const tq = `table_number=eq.${encodeURIComponent(TABLE_NUMBER)}` +
             '&select=id,capacity,zone_id,status,qr_token,is_active'
  await expect.poll(async () => (await select('tables', tq)).length, { timeout: 20_000 }).toBe(1)

  const table = await one('tables', tq)
  expect(table.capacity).toBe(4)
  expect(table.zone_id).toBe(zone.id)
  expect(table.status).toBe('available')
  expect(table.is_active).toBe(true)
  expect(table.qr_token).toBeTruthy()     // ฐานข้อมูลต้องออก QR ให้เองตอนสร้าง

  // ── แก้ที่นั่ง ────────────────────────────────────────────────────────────
  const row = rowWith(page, TABLE_NUMBER)
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.locator('input[type="number"]').fill('6')
  await row.getByRole('button', { name: 'บันทึก' }).click()

  await expect
    .poll(async () => (await one('tables', `select=capacity&id=eq.${table.id}`))?.capacity, { timeout: 20_000 })
    .toBe(6)

  // ── ลบ — ปุ่มลบโผล่เฉพาะโต๊ะว่างที่ไม่มีรอบเปิดค้าง ──────────────────────
  await row.locator('button.btn--quiet').click()
  await expect
    .poll(async () => (await select('tables', `select=id&id=eq.${table.id}`)).length, { timeout: 20_000 })
    .toBe(0)

  // หน้าจอไม่มีปุ่มลบโซนโดยตั้งใจ (โซนที่ยังมีโต๊ะอยู่ไม่ควรหายไปทั้งก้อน)
  // จึงเก็บกวาดผ่าน REST — เทสต์ต้องไม่ทิ้งโซนปลอมไว้ในผังร้านจริง
  await remove('zones', `id=eq.${zone.id}`)
})

// ════════════════════════════════════════════════════════════════════════════
test('พนักงานที่ไม่ใช่ผู้จัดการแก้เมนูและโต๊ะไม่ได้ แม้หน้าจอจะเปิดให้กด', async ({ page }) => {
  test.skip(!hasWaiter, 'ตั้ง E2E_WAITER_EMAIL / E2E_WAITER_PASSWORD ก่อน — ไม่มีบัญชีที่ควรถูกปฏิเสธ')

  const cat = await one('menu_categories', 'select=id,branch_id&limit=1')
  const [victim] = await insert('menu_items', {
    branch_id: cat.branch_id, category_id: cat.id,
    name_th: VICTIM_NAME, is_included_in_buffet: true,
  })

  // ── ผ่านหน้าจอ: กดบันทึกได้ แต่ค่าต้องไม่ลงฐานข้อมูล ──────────────────────
  // /admin ไม่มีด่านกั้นตาม role โดยตั้งใจ — กฎอยู่ที่ RLS ฝั่งฐานข้อมูล
  // เทสต์นี้จึงพิสูจน์ว่าด่านจริงกันอยู่ ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ
  await login(page, '/admin/menu', WAITER_EMAIL, WAITER_PASSWORD)
  const row = rowWith(page, VICTIM_NAME)
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.locator('input[type="text"], input:not([type])').first().fill('แก้ได้แปลว่าพัง')
  await row.getByRole('button', { name: 'บันทึก' }).click()

  // ให้เวลาคำขอเดินทางไป-กลับก่อนอ่านฐานข้อมูล แล้วค่าต้องยังเป็นของเดิม
  await expect(row.getByRole('button', { name: 'บันทึก' })).toBeEnabled({ timeout: 20_000 })
  expect((await one('menu_items', `select=name_th&id=eq.${victim.id}`)).name_th).toBe(VICTIM_NAME)

  // ── ผ่าน REST ตรง ๆ: insert ต้องถูกปฏิเสธด้วยรหัส 4xx ────────────────────
  const wt = await waiterToken()
  const badMenu = await attempt('/rest/v1/menu_items', {
    token: wt, method: 'POST',
    body: { branch_id: cat.branch_id, category_id: cat.id, name_th: tag('ห้ามเกิด'), is_included_in_buffet: true },
  })
  expect(badMenu.ok, `RLS ต้องปฏิเสธ insert เมนู แต่ได้ ${badMenu.status}`).toBe(false)
  expect([401, 403]).toContain(badMenu.status)

  const badTable = await attempt('/rest/v1/tables', {
    token: wt, method: 'POST',
    body: { branch_id: cat.branch_id, table_number: tag('T9'), capacity: 4 },
  })
  expect(badTable.ok, `RLS ต้องปฏิเสธ insert โต๊ะ แต่ได้ ${badTable.status}`).toBe(false)
  expect([401, 403]).toContain(badTable.status)

  const badZone = await attempt('/rest/v1/zones', {
    token: wt, method: 'POST',
    body: { branch_id: cat.branch_id, code: 'E2E-X', name: 'ห้ามเกิด' },
  })
  expect(badZone.ok, `RLS ต้องปฏิเสธ insert โซน แต่ได้ ${badZone.status}`).toBe(false)

  // พนักงานยังต้อง "อ่าน" เมนูได้ตามปกติ — ไม่งั้นแปลว่าปิดกว้างเกินไป
  const canRead = await attempt('/rest/v1/menu_items?select=id&limit=1', { token: wt })
  expect(canRead.ok, `พนักงานต้องอ่านเมนูได้ แต่ได้ ${canRead.status}`).toBe(true)

  // และผู้จัดการต้องแก้ได้อยู่ — ไม่งั้นเทสต์ข้างบนผ่านเพราะ RLS พังทั้งระบบ
  const okMenu = await attempt(`/rest/v1/menu_items?id=eq.${victim.id}`, {
    token: await staffToken(), method: 'PATCH', body: { name_th: tag('เมนูห้ามแก้ 2') },
  })
  expect(okMenu.ok, `ผู้จัดการต้องแก้ได้ แต่ได้ ${okMenu.status}`).toBe(true)

  await remove('menu_items', `id=eq.${victim.id}`)
})
