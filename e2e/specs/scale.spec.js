import { test, expect } from '@playwright/test'
import {
  configured, select, insert, remove, rpc, cleanup, tag,
  SUPABASE_URL, ANON_KEY, staffToken,
  STAFF_EMAIL, STAFF_PASSWORD,
} from '../support/db.js'

test.skip(!configured, 'ตั้ง E2E_STAFF_PASSWORD ก่อน (ชุดนี้ยิงเข้า Supabase จริง)')

test.describe.configure({ mode: 'serial' })

/**
 * เพดาน 1000 แถวของ PostgREST — บั๊กที่เทสต์ชุดเดิมจับไม่ได้เพราะข้อมูลยังน้อย
 * ----------------------------------------------------------------------------
 * PostgREST ตัดผลลัพธ์ที่ 1000 แถวโดยไม่แจ้ง error ไม่มีสัญญาณอะไรบอกว่าข้อมูลถูกตัด
 * โค้ดเดิมดึง order_items ทั้งตารางแล้วมากรองฝั่งเบราว์เซอร์ ทั้งจอครัวและหน้าตรวจบิล
 * พอร้านสั่งครบหนึ่งพันรายการ ตั๋วของลูกค้าที่เพิ่งสั่งจะหลุดออกจากผลลัพธ์เงียบ ๆ
 *
 * เทสต์นี้ถมข้อมูลให้ทะลุเพดานก่อน แล้วค่อยเปิดโต๊ะจริงสั่งอาหารหนึ่งรอบ
 * ของที่เพิ่งสั่งต้องขึ้นทั้งบนจอครัวและในหน้าเจาะดูของผู้จัดการ
 *
 * ⚠️ เคสนี้ต้อง "ล้มกับโค้ดเก่า" ด้วย ไม่งั้นแปลว่าไม่ได้วัดอะไรเลย
 */

// ต้องถมให้ทะลุ 1000 แถวพอสมควร (ของจริงในฐานตอนนี้มีอยู่ราวร้อยต้น ๆ)
//
// กระจายลงหลายออเดอร์แทนที่จะยัดใส่ใบเดียว เพราะ order_items มีทริกเกอร์ AFTER INSERT
// สองตัวที่ทำงานทีละแถว ตัวหนึ่งไปอัปเดตออเดอร์แม่ ยัด 400 แถวใส่ใบเดียว
// = อัปเดตแถวเดิมซ้ำ 400 ครั้งติดกัน แล้วชน statement timeout ของฐานข้อมูล
const NOISE_ORDERS = 40
const ITEMS_PER_ORDER = 30   // รวม 1,200 แถว

const created = { visitIds: [] }
const noiseOrderIds = []

test.afterAll(async () => {
  // ลบทีเดียวทั้งชุด ไม่ใช่ไล่ทีละออเดอร์ — 40 ออเดอร์ = 80 คำขอเรียงกัน ชน timeout ของ hook
  // ลบ order_items ก่อน แล้วค่อยลบ orders — items อ้างถึง order
  if (noiseOrderIds.length) {
    const ids = noiseOrderIds.join(',')
    await remove('order_items', `order_id=in.(${ids})`).catch(() => {})
    await remove('orders', `id=in.(${ids})`).catch(() => {})
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

/**
 * ถมรายการอาหารเก่าให้ทะลุเพดาน
 *
 * ผูกกับรอบที่ปิดไปแล้วเสมอ — ถ้าไปผูกกับรอบที่ยังเปิดอยู่ ของปลอมจะโผล่บนจอครัวจริง
 * และทำให้เทสต์อื่นในชุดเดียวกันพัง
 */
async function seedNoise() {
  const [dead] = await select('visits', 'select=id&status=eq.void&order=check_in_at.desc&limit=1')
  test.skip(!dead, 'ไม่มีรอบที่ปิดไปแล้วให้ผูกข้อมูลถม')

  const [menu] = await select('menu_items', 'select=id,name_th&limit=1')

  for (let n = 0; n < NOISE_ORDERS; n++) {
    // เลขรอบต้องไม่ชนของเดิมใน visit นั้น — ใช้เลขสูง ๆ ที่ของจริงไม่มีทางถึง
    const [order] = await insert('orders', {
      visit_id: dead.id, order_number: 9_001 + n, status: 'served',
    })
    noiseOrderIds.push(order.id)

    await insert('order_items', Array.from({ length: ITEMS_PER_ORDER }, (_, k) => ({
      order_id: order.id,
      menu_item_id: menu.id,
      name_snapshot: tag(`ถมข้อมูล ${n}-${k}`),
      quantity: 1,
      is_buffet_included: true,
      status: 'served',
    })))
  }
}

// ════════════════════════════════════════════════════════════════════════════
test('ข้อมูลทะลุเพดาน 1000 แถวแล้ว ออเดอร์ที่เพิ่งสั่งต้องยังขึ้นจอครัวและหน้าตรวจบิล', async ({ page }) => {
  test.setTimeout(180_000)

  await seedNoise()

  // ── ยืนยันว่าเพดานมีอยู่จริง ไม่ใช่ข้อสันนิษฐาน ───────────────────────────
  const res = await fetch(`${SUPABASE_URL}/rest/v1/order_items?select=id`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${await staffToken()}` },
  })
  const capped = await res.json()
  expect(capped.length, 'PostgREST ต้องตัดผลลัพธ์ที่ 1000 แถว').toBe(1000)

  // ── ลูกค้าสั่งอาหารจริงหนึ่งรอบ หลังจากข้อมูลทะลุเพดานไปแล้ว ───────────────
  const [table] = await select('tables', 'select=id,table_number&status=eq.available&limit=1')
  test.skip(!table, 'ไม่มีโต๊ะว่างในฐานข้อมูลตอนนี้')

  const [pkg] = await select('buffet_packages', 'select=id&is_active=eq.true&limit=1')
  const visit = await rpc('open_visit', {
    p_table_id: table.id, p_package_id: pkg.id,
    p_adult_count: 2, p_child_count: 0, p_addons: [],
  })
  created.visitIds.push(visit.id)

  const [dish] = await select('menu_items',
    'select=id,name_th&is_available=eq.true&is_included_in_buffet=eq.true&limit=1')
  await rpc('place_order', {
    p_visit_id: visit.id,
    p_items: [{ menu_item_id: dish.id, quantity: 2 }],
    p_note: null,
  })

  const [order] = await select('orders', `select=id&visit_id=eq.${visit.id}`)
  const mine = await select('order_items', `select=id,name_snapshot&order_id=eq.${order.id}`)
  expect(mine.length).toBe(1)

  // ── หัวใจของเทสต์: ของที่เพิ่งสั่งต้องไม่อยู่ใน 1000 แถวแรกที่ REST คืนมา ──
  // ถ้ามันบังเอิญอยู่ใน 1000 แถวแรก แปลว่าข้อมูลถมยังน้อยไป เทสต์จะไม่ได้วัดอะไร
  const firstPage = new Set(capped.map((r) => r.id))
  expect(firstPage.has(mine[0].id),
    'ของที่เพิ่งสั่งต้องหลุดออกจากผลลัพธ์ที่ถูกตัด ไม่งั้นเทสต์นี้ไม่ได้พิสูจน์อะไร').toBe(false)

  // ── จอครัวต้องเห็นตั๋วนี้ ─────────────────────────────────────────────────
  await loginAsStaff(page, '/staff/kds')
  const ticket = page.locator('.tkt').filter({ hasText: `โต๊ะ ${table.table_number}` }).first()
  await expect(ticket, 'จอครัวต้องขึ้นตั๋วของโต๊ะที่เพิ่งสั่ง').toBeVisible({ timeout: 30_000 })
  await expect(ticket).toContainText(dish.name_th)

  // ── หน้าเจาะดูของผู้จัดการต้องเห็นรายการครบ ───────────────────────────────
  await page.goto('/admin/visits')
  const row = page.locator('.data tbody tr').filter({ hasText: visit.visit_code }).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()

  const sheet = page.locator('.sheet__box')
  await expect(sheet).toBeVisible({ timeout: 20_000 })
  await expect(sheet, 'หน้าตรวจบิลต้องแสดงรายการอาหารของรอบนี้ครบ')
    .toContainText(`2 × ${dish.name_th}`)

  // และต้องไม่มีของถมหลุดเข้ามาปนในรอบนี้
  await expect(sheet).not.toContainText('ถมข้อมูล')
})
