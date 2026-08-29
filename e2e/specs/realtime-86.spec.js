import { test, expect } from '@playwright/test'
import {
  configured, select, insert, remove, patch, rpc, attempt, cleanup, tag,
  staffToken, STAFF_EMAIL, STAFF_PASSWORD,
} from '../support/db.js'
import { STATE_FILE, stateHasSession } from '../support/global-setup.js'

test.skip(!configured, 'ตั้ง E2E_STAFF_PASSWORD ก่อน (ชุดนี้ยิงเข้า Supabase จริง)')

test.describe.configure({ mode: 'serial' })

/**
 * สองเครื่องพร้อมกันจริง — เรื่องที่เทสต์แท็บเดียวพิสูจน์แทนไม่ได้
 * ----------------------------------------------------------------------------
 *   ① พนักงานกด 86 แล้วมือถือลูกค้าที่เปิดค้างต้องรู้ทันที ไม่ต้องรีเฟรช
 *      และถ้าลูกค้าดันยิงคำสั่งซื้อต่อ ฐานข้อมูลต้องปฏิเสธ ไม่ใช่รับไว้เงียบ ๆ
 *   ② เน็ตหลุดแล้วกลับมา ต้องตามสถานะล่าสุดทัน (event ตอนหลุดไม่มีส่งย้อนหลัง)
 *   ③ สองเครื่องที่โต๊ะเดียวกันกดสั่งพร้อมกัน ต้องไม่ชนกันจนออเดอร์เพี้ยน
 *   ④ พนักงานสองเครื่องกดรับชำระใบเดียวกันพร้อมกัน ต้องตัดเงินครั้งเดียว
 *
 * เทสต์กลุ่มนี้ใช้เวลารอ websocket จริง จึงยืดเวลาต่อเคสมากกว่าชุดอื่น
 */
test.setTimeout(150_000)

const created = { visitIds: [] }
const menuIds = []

test.afterAll(async () => {
  for (const id of menuIds) await remove('menu_items', `id=eq.${id}`).catch(() => {})
  await cleanup(created)
})

/** เมนูของเทสต์เอง — ห้าม 86 เมนูจริงของร้านทิ้งไว้ถ้าเทสต์ล้มกลางทาง */
async function ownMenuItem(name) {
  const [cat] = await select('menu_categories', 'select=id,branch_id,name_th&limit=1')
  const [item] = await insert('menu_items', {
    branch_id: cat.branch_id, category_id: cat.id,
    name_th: tag(name), is_included_in_buffet: true, is_available: true,
  })
  menuIds.push(item.id)
  return { item, cat }
}

async function seat() {
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

/** มือถือลูกค้าอีกเครื่องหนึ่ง — คนละ context = คนละเบราว์เซอร์ในทางปฏิบัติ */
async function customerDevice(browser, baseURL, table, visit, categoryName) {
  const ctx = await browser.newContext({
    baseURL, storageState: STATE_FILE, locale: 'th-TH', timezoneId: 'Asia/Bangkok',
  })
  const page = await ctx.newPage()

  // ล้างโต๊ะที่เครื่องนี้เคยจำไว้ก่อน ไม่งั้นอาจเด้งเข้าโต๊ะของรอบก่อน
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('shabu.visit'))

  // ต้องรอให้เข้าโต๊ะสำเร็จก่อนค่อยไปหน้าเมนู — เปลี่ยนหน้าเร็วกว่านั้น
  // แอปยังไม่รู้ว่าอยู่โต๊ะไหน แล้วหน้าเมนูจะว่างเปล่าโดยไม่มีแถบหมวด
  //
  // ยอมให้ลองซ้ำหนึ่งครั้ง เพราะทุก context ในชุดนี้ใช้ session ผู้เยี่ยมชมใบเดียวกัน
  // (ตั้งใจ เพื่อไม่ให้ชนเพดานการสมัคร anonymous ของ Supabase)
  // แต่ Supabase หมุน refresh token ทุกครั้งที่ต่ออายุ เครื่องที่หยิบใบเก่าไปพอดี
  // จะเข้าโต๊ะไม่ผ่านรอบแรก ซึ่งเป็นข้อจำกัดของวิธีแชร์ session ไม่ใช่บั๊กของร้าน
  const seated = page.getByText(`โต๊ะ ${table.table_number}`).first()
  await page.goto(`/v/${visit.session_token}`)
  try {
    await expect(seated).toBeVisible({ timeout: 30_000 })
  } catch {
    await page.goto(`/v/${visit.session_token}`)
    await expect(seated).toBeVisible({ timeout: 30_000 })
  }

  await page.goto('/order/menu')
  await expect(page.locator('.tabbar')).toBeVisible({ timeout: 30_000 })
  await page.locator('.tabbar button').filter({ hasText: categoryName }).first().click()
  return { ctx, page }
}

async function staffDevice(browser, baseURL, to) {
  const ctx = await browser.newContext({ baseURL, locale: 'th-TH', timezoneId: 'Asia/Bangkok' })
  const page = await ctx.newPage()
  await page.goto(to)
  const form = page.getByRole('heading', { name: /เข้าสู่ระบบ/ })
  await expect(form.or(page.locator('.shell')).first()).toBeVisible({ timeout: 30_000 })
  if (await form.isVisible()) {
    await page.getByLabel('อีเมล').fill(STAFF_EMAIL)
    await page.getByLabel('รหัสผ่าน').fill(STAFF_PASSWORD)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
    await expect(page.locator('.shell')).toBeVisible({ timeout: 30_000 })
  }
  return { ctx, page }
}

// ════════════════════════════════════════════════════════════════════════════
test('พนักงานกด 86 จากอีกเครื่อง มือถือลูกค้าต้องเห็นทันทีและสั่งต่อไม่ได้', async ({ browser, baseURL }) => {
  test.skip(!stateHasSession(), 'ไม่มี session ผู้เยี่ยมชม (anonymous sign-in ใช้ไม่ได้) — ทางเข้าลูกค้าทดสอบไม่ได้')

  const { item, cat } = await ownMenuItem('เนื้อทดสอบเรียลไทม์')
  const { table, visit } = await seat()

  const guest = await customerDevice(browser, baseURL, table, visit, cat.name_th)
  const staff = await staffDevice(browser, baseURL, '/admin/menu')

  try {
    // ── ก่อน 86: ลูกค้าเห็นเมนูและกดเพิ่มลงตะกร้าได้ ─────────────────────────
    const row = guest.page.locator('.mrow').filter({ hasText: item.name_th }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).not.toHaveClass(/mrow--off/)
    await row.getByLabel('เพิ่มจำนวน').click()
    await expect(row.locator('.step .v')).toHaveText('1')

    // ── พนักงานกด 86 ที่เครื่องของตัวเอง ────────────────────────────────────
    const adminRow = staff.page.locator('.data tbody tr')
      .filter({ has: staff.page.locator(`input[value="${item.name_th}"]`) }).first()
    await expect(adminRow).toBeVisible({ timeout: 30_000 })
    await adminRow.getByRole('button', { name: '86', exact: true }).click()
    await expect
      .poll(async () => (await select('menu_items', `select=is_available&id=eq.${item.id}`))[0]?.is_available,
        { timeout: 20_000 })
      .toBe(false)

    // ── มือถือลูกค้าต้องขยับเอง ไม่มีการ reload ในเทสต์นี้เลย ────────────────
    await expect(row).toContainText('ของหมด', { timeout: 45_000 })
    await expect(row).toHaveClass(/mrow--off/)
    await expect(row.getByLabel('เพิ่มจำนวน')).toBeDisabled()

    // ── ต่อให้ฝั่งหน้าจอถูกข้าม ฐานข้อมูลก็ต้องปฏิเสธอยู่ดี ──────────────────
    // ด่านจริงอยู่ที่ place_order() ไม่ใช่ปุ่มที่ถูก disable บนจอ
    const rejected = await attempt('/rest/v1/rpc/place_order', {
      token: await staffToken(), method: 'POST',
      body: { p_visit_id: visit.id, p_items: [{ menu_item_id: item.id, quantity: 1 }], p_note: null },
    })
    expect(rejected.ok, `เมนูที่ 86 แล้วต้องสั่งไม่ได้ แต่ได้ ${rejected.status}`).toBe(false)
    expect((await select('orders', `select=id&visit_id=eq.${visit.id}`)).length).toBe(0)
  } finally {
    await guest.ctx.close()
    await staff.ctx.close()
  }
})

// ════════════════════════════════════════════════════════════════════════════
test('เน็ตหลุดระหว่างมื้อแล้วกลับมา ลูกค้าต้องตามสถานะล่าสุดทันโดยไม่ต้องรีเฟรช', async ({ browser, baseURL }) => {
  test.skip(!stateHasSession(), 'ไม่มี session ผู้เยี่ยมชม (anonymous sign-in ใช้ไม่ได้) — ทางเข้าลูกค้าทดสอบไม่ได้')

  const { item, cat } = await ownMenuItem('ผักทดสอบรีคอนเนกต์')
  const { table, visit } = await seat()

  const guest = await customerDevice(browser, baseURL, table, visit, cat.name_th)

  try {
    const row = guest.page.locator('.mrow').filter({ hasText: item.name_th }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).not.toHaveClass(/mrow--off/)

    // ── เน็ตหลุด แล้วของหมดระหว่างที่หลุดอยู่ ────────────────────────────────
    // event ที่เกิดตอนหลุดจะไม่มีส่งย้อนหลัง ตอนต่อกลับได้จึงต้องตามให้ทันเอง
    //
    // ตั้งใจไม่ยืนยันว่า "ระหว่างหลุดจอต้องยังไม่รู้" เพราะ setOffline ของเบราว์เซอร์
    // ไม่ได้ตัด websocket ที่เปิดค้างอยู่เสมอไป บางรอบ event จึงเล็ดลอดเข้ามาได้
    // นั่นคือพฤติกรรมของตัวจำลองเน็ต ไม่ใช่กติกาของร้าน เอามาตัดสินถูกผิดไม่ได้
    // สิ่งที่ร้านต้องการจริงมีข้อเดียว: พอเน็ตกลับมา จอต้องตรงกับฐานข้อมูล
    await guest.ctx.setOffline(true)
    await patch('menu_items', `id=eq.${item.id}`, { is_available: false })
    await guest.page.waitForTimeout(3_000)

    // ── ต่อเน็ตกลับ ต้องตามทันเอง ไม่มี reload ในเทสต์นี้เลย ─────────────────
    await guest.ctx.setOffline(false)
    await expect(row).toContainText('ของหมด', { timeout: 60_000 })
    await expect(row.getByLabel('เพิ่มจำนวน')).toBeDisabled()
  } finally {
    await guest.ctx.close()
  }
})

// ════════════════════════════════════════════════════════════════════════════
test('สองเครื่องที่โต๊ะเดียวกันกดสั่งพร้อมกัน ต้องเข้ารอบของโต๊ะเดิมและไม่ชนกัน', async ({ browser, baseURL }) => {
  test.skip(!stateHasSession(), 'ไม่มี session ผู้เยี่ยมชม (anonymous sign-in ใช้ไม่ได้) — ทางเข้าลูกค้าทดสอบไม่ได้')

  const { table, visit } = await seat()
  const [cat] = await select('menu_categories', 'select=id,name_th&limit=1')
  const menu = await select('menu_items',
    `select=id,name_th&category_id=eq.${cat.id}&is_available=eq.true&is_included_in_buffet=eq.true&limit=2`)
  test.skip(menu.length < 2, 'หมวดนี้มีเมนูที่สั่งได้ไม่ถึงสองรายการ')

  const a = await customerDevice(browser, baseURL, table, visit, cat.name_th)
  const b = await customerDevice(browser, baseURL, table, visit, cat.name_th)

  try {
    const pick = async (dev, name) => {
      const row = dev.page.locator('.mrow').filter({ hasText: name }).first()
      await expect(row).toBeVisible({ timeout: 30_000 })
      await row.getByLabel('เพิ่มจำนวน').click()
      await dev.page.getByRole('button', { name: 'ตรวจสอบและยืนยัน' }).click()
      await expect(dev.page.getByRole('button', { name: /ยืนยันการสั่ง/ })).toBeVisible({ timeout: 20_000 })
    }
    await pick(a, menu[0].name_th)
    await pick(b, menu[1].name_th)

    // กดพร้อมกันจริง ๆ ไม่ใช่ไล่กดทีละเครื่อง
    await Promise.all([
      a.page.getByRole('button', { name: /ยืนยันการสั่ง/ }).click(),
      b.page.getByRole('button', { name: /ยืนยันการสั่ง/ }).click(),
    ])

    await expect
      .poll(async () => (await select('orders', `select=id&visit_id=eq.${visit.id}`)).length, { timeout: 30_000 })
      .toBeGreaterThan(0)
    await a.page.waitForTimeout(3_000)   // เผื่อใบที่สองเพิ่งลงทีหลัง

    const orders = await select('orders', `select=id,order_number,visit_id&visit_id=eq.${visit.id}`)
    // สองเครื่อง = ได้หนึ่งหรือสองรอบ (กติกาเว้นระยะเวลาอาจปัดใบที่สองทิ้ง)
    // แต่สิ่งที่ห้ามเกิดคือเลขรอบซ้ำ หรือออเดอร์หลุดไปโต๊ะอื่น
    expect(orders.length).toBeGreaterThanOrEqual(1)
    expect(new Set(orders.map((o) => o.order_number)).size).toBe(orders.length)
    expect(orders.every((o) => o.visit_id === visit.id)).toBe(true)

    const ids = orders.map((o) => o.id)
    const items = await select('order_items', `select=order_id&order_id=in.(${ids.join(',')})`)
    expect(items.length).toBeGreaterThanOrEqual(1)

    // เครื่องที่ถูกปฏิเสธต้องยังอยู่หน้าเดิมพร้อมตะกร้าเดิม ไม่ใช่จอขาว
    for (const dev of [a, b]) {
      await expect(dev.page.locator('.tabbar')).toBeVisible()
    }
  } finally {
    await a.ctx.close()
    await b.ctx.close()
  }
})

// ════════════════════════════════════════════════════════════════════════════
test('พนักงานสองเครื่องกดรับชำระใบเดียวกันพร้อมกัน ต้องตัดเงินครั้งเดียว', async ({ browser, baseURL }) => {
  const { table, visit } = await seat()

  const a = await staffDevice(browser, baseURL, '/staff/checkout')
  const b = await staffDevice(browser, baseURL, '/staff/checkout')

  try {
    const arm = async (dev) => {
      await dev.page.locator('.tcard').filter({ hasText: table.table_number }).first().click()
      await dev.page.locator('.pay').first().click()
      const btn = dev.page.getByRole('button', { name: /ยืนยันรับชำระ/ })
      await expect(btn).toBeEnabled({ timeout: 30_000 })
      return btn
    }
    const btnA = await arm(a)
    const btnB = await arm(b)

    await Promise.all([btnA.click(), btnB.click()])
    await a.page.waitForTimeout(5_000)

    // ── เงินต้องถูกตัดใบเดียว ไม่ว่าหน้าจอจะขึ้นอะไร ─────────────────────────
    const paid = await select('payments',
      `select=id,amount_satang,status&visit_id=eq.${visit.id}&status=eq.succeeded`)
    expect(paid.length, `ต้องมีรายการชำระที่สำเร็จใบเดียว แต่มี ${paid.length}`).toBe(1)

    const due = await rpc('visit_amount_due', { p_visit_id: visit.id })
    expect(paid[0].amount_satang + due).toBeGreaterThan(0)
    expect(due).toBe(0)     // จ่ายครบพอดี ไม่ใช่จ่ายเกินสองเท่า

    for (const id of paid.map((p) => p.id)) {
      await rpc('cancel_payment', { p_payment_id: id, p_reason: 'เก็บกวาดหลัง E2E' }).catch(() => {})
    }
  } finally {
    await a.ctx.close()
    await b.ctx.close()
  }
})
