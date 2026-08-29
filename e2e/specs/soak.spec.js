import { test, expect } from '@playwright/test'
import {
  configured, select, insert, remove, rpc, cleanup, tag,
  SUPABASE_URL, ANON_KEY, staffToken,
  STAFF_EMAIL, STAFF_PASSWORD,
} from '../support/db.js'

test.skip(!configured, 'ตั้ง E2E_STAFF_PASSWORD ก่อน (ชุดนี้ยิงเข้า Supabase จริง)')

/**
 * Soak test — ปริมาณงานใกล้เคียงร้านจริง
 * ----------------------------------------------------------------------------
 * ตอบคำถามเดียว: 15 โต๊ะเปิดพร้อมกัน สั่งกันหลายรอบ แอปยังไหวไหม
 *
 * ไม่ใช่เทสต์ถูก/ผิดแบบเคสอื่น — เป็นการ "วัด" แล้วพิมพ์ตัวเลขออกมาให้อ่าน
 * มีเกณฑ์ตกเฉพาะข้อที่ชัดว่าใช้งานจริงไม่ได้ (เช่นโหลดนานเกินสิบวินาที)
 * ที่เหลือรายงานเป็นตัวเลขให้คนตัดสิน ไม่ตั้งเกณฑ์เดาเอาเอง
 *
 * ไม่รวมอยู่ในชุด regression ปกติ — รันเองด้วย
 *   npx playwright test specs/soak.spec.js
 */
test.skip(!process.env.E2E_SOAK, 'ตั้ง E2E_SOAK=1 ก่อน (ชุดนี้กินเวลาและสร้างข้อมูลเยอะ)')

const TABLES_WANTED = 15
const ROUNDS_PER_TABLE = 5      // สั่งกี่รอบต่อโต๊ะ
const ITEMS_PER_ROUND = 4

const created = { visitIds: [] }
const madeTableIds = []

test.afterAll(async () => {
  await cleanup(created)

  // โต๊ะที่เคยมีรอบมาลง ลบตรง ๆ ไม่ได้ — visits อ้างถึงอยู่ (FK)
  // ต้องเก็บ visit ของโต๊ะนั้นก่อน ทั้งหมดเป็นของที่เทสต์นี้สร้างเองล้วน
  for (const id of madeTableIds) {
    for (const v of await select('visits', `select=id&table_id=eq.${id}`).catch(() => [])) {
      await remove('visits', `id=eq.${v.id}`).catch(() => {})
    }
    await remove('tables', `id=eq.${id}`).catch(() => {})
  }
})

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]
}

/** ยิงชุดคำขอแบบเดียวกับที่ loadFloorState() ทำจริง แล้วจับเวลา */
async function measureFloorLoad(token) {
  const t0 = Date.now()
  let bytes = 0

  const get = async (path) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    })
    const text = await res.text()
    bytes += text.length
    return JSON.parse(text)
  }

  // จังหวะที่ 1 — รอบที่ยังไม่ปิด และของที่ไม่ผูกกับรอบ
  const [visits] = await Promise.all([
    get('visits?select=*&status=in.(open,awaiting_payment,paid)&order=check_in_at'),
    get('service_requests?select=*&status=eq.open'),
    get('queue_tickets?select=*&status=in.(waiting,called)'),
    get('tables?select=*&is_active=eq.true'),
  ])

  const ids = visits.map((v) => v.id).join(',')
  let orders = []
  if (visits.length) {
    // จังหวะที่ 2 — ของที่ผูกกับรอบ
    const r = await Promise.all([
      get(`visit_addons?select=*&visit_id=in.(${ids})`),
      get(`visit_promotions?select=*&visit_id=in.(${ids})`),
      get(`orders?select=*&visit_id=in.(${ids})&order=order_number`),
      get(`payments?select=*&status=eq.succeeded&visit_id=in.(${ids})`),
    ])
    orders = r[2]
  }

  // จังหวะที่ 3 — รายการอาหารของออเดอร์เหล่านั้น
  let items = []
  if (orders.length) {
    items = await get(`order_items?select=*&order_id=in.(${orders.map((o) => o.id).join(',')})&order=created_at`)
  }

  return { ms: Date.now() - t0, bytes, visits: visits.length, orders: orders.length, items: items.length }
}

// ════════════════════════════════════════════════════════════════════════════
test('15 โต๊ะเปิดพร้อมกัน สั่งกันหลายรอบ แล้ววัดว่าโหลดสถานะหน้าร้านไหวไหม', async ({ page }) => {
  test.setTimeout(900_000)
  const token = await staffToken()

  // ── เตรียมโต๊ะให้ครบ 15 ตัว ───────────────────────────────────────────────
  const [branch] = await select('branches', 'select=id&limit=1')
  let free = await select('tables', 'select=id,table_number&status=eq.available')
  for (let i = free.length; i < TABLES_WANTED; i++) {
    const [t] = await insert('tables', {
      branch_id: branch.id, table_number: tag(`S${i}`), capacity: 6,
    })
    madeTableIds.push(t.id)
  }
  free = await select('tables', 'select=id,table_number&status=eq.available')
  const use = free.slice(0, TABLES_WANTED)
  console.log(`\n── เตรียมโต๊ะ ${use.length} ตัว ──`)

  const [pkg] = await select('buffet_packages', 'select=id&is_active=eq.true&limit=1')

  // ต้องเลี่ยงเมนูที่ล็อกแพ็กเกจ ไม่งั้น place_order ปฏิเสธถูกต้องตามกฎ
  // แล้วเราจะวัดอะไรไม่ได้เลยเพราะไม่มีออเดอร์เกิดขึ้นสักใบ
  const locked = new Set((await select('menu_item_packages', 'select=menu_item_id'))
    .map((r) => r.menu_item_id))
  const menu = (await select('menu_items',
    'select=id&is_available=eq.true&is_included_in_buffet=eq.true'))
    .filter((m) => !locked.has(m.id))
    .slice(0, ITEMS_PER_ROUND)
  expect(menu.length, 'ต้องมีเมนูที่สั่งได้ทุกแพ็กเกจอย่างน้อยหนึ่งรายการ').toBeGreaterThan(0)

  // ── วัดตอนร้านยังว่าง เอาไว้เทียบ ─────────────────────────────────────────
  const before = await measureFloorLoad(token)
  console.log(`ก่อนเปิดโต๊ะ: ${before.ms} ms · ${(before.bytes / 1024).toFixed(0)} KB · ` +
              `${before.visits} รอบ · ${before.orders} ออเดอร์ · ${before.items} รายการ`)

  // ── เปิดทุกโต๊ะ ───────────────────────────────────────────────────────────
  const visits = []
  for (const t of use) {
    const v = await rpc('open_visit', {
      p_table_id: t.id, p_package_id: pkg.id,
      p_adult_count: 3, p_child_count: 1, p_addons: [],
    })
    created.visitIds.push(v.id)
    visits.push(v)
  }
  console.log(`เปิดโต๊ะครบ ${visits.length} รอบ`)

  // ── สั่งอาหารวนหลายรอบ พร้อมวัดเวลาโหลดหลังแต่ละรอบ ───────────────────────
  const samples = []
  let placed = 0
  const refused = new Map()
  for (let round = 1; round <= ROUNDS_PER_TABLE; round++) {
    for (const v of visits) {
      try {
        await rpc('place_order', {
          p_visit_id: v.id,
          p_items: menu.map((m) => ({ menu_item_id: m.id, quantity: 1 })),
          p_note: null,
        })
        placed++
      } catch (e) {
        // ชนกติกาของร้าน (เว้นระยะเวลา, เพดานออเดอร์ค้าง) ถือว่าปกติ
        // แต่ต้องนับและพิมพ์ออกมา ห้ามกลืนเงียบ ไม่งั้นวัดศูนย์ออเดอร์แล้วไม่รู้ตัว
        const why = (e.message.match(/message":"([^"]{0,80})/) ?? [, e.message.slice(0, 80)])[1]
        refused.set(why, (refused.get(why) ?? 0) + 1)
      }
    }
    const s = await measureFloorLoad(token)
    samples.push(s)
    console.log(`รอบที่ ${round}: ${s.ms} ms · ${(s.bytes / 1024).toFixed(0)} KB · ` +
                `${s.orders} ออเดอร์ · ${s.items} รายการ`)
  }

  const times = samples.map((s) => s.ms)
  const last = samples[samples.length - 1]
  console.log(`\n── สรุปการโหลดสถานะหน้าร้าน ──`)
  console.log(`สั่งสำเร็จ ${placed} ครั้ง จาก ${ROUNDS_PER_TABLE * visits.length} ครั้งที่ลอง`)
  for (const [why, n] of refused) console.log(`  ถูกปฏิเสธ ${n} ครั้ง: ${why}`)
  expect(placed, 'ต้องมีออเดอร์เกิดขึ้นจริง ไม่งั้นไม่ได้วัดอะไรเลย').toBeGreaterThan(0)
  console.log(`p50 ${pct(times, 0.5)} ms · p95 ${pct(times, 0.95)} ms · สูงสุด ${Math.max(...times)} ms`)
  console.log(`ปริมาณสุดท้าย ${last.orders} ออเดอร์ · ${last.items} รายการ · ${(last.bytes / 1024).toFixed(0)} KB ต่อการโหลดหนึ่งครั้ง`)

  // ── จอครัวต้องยังใช้งานได้จริงที่ปริมาณนี้ ────────────────────────────────
  await page.goto('/staff/kds')
  const form = page.getByRole('heading', { name: /เข้าสู่ระบบ/ })
  await expect(form.or(page.locator('.shell')).first()).toBeVisible({ timeout: 30_000 })
  if (await form.isVisible()) {
    await page.getByLabel('อีเมล').fill(STAFF_EMAIL)
    await page.getByLabel('รหัสผ่าน').fill(STAFF_PASSWORD)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  }

  const opened = Date.now()
  await expect(page.locator('.tkt').first()).toBeVisible({ timeout: 60_000 })
  const tickets = await page.locator('.tkt').count()
  console.log(`จอครัวเปิดขึ้นใน ${Date.now() - opened} ms · มีตั๋ว ${tickets} ใบ`)

  // ── หน่วงจาก "สั่งจากอีกเครื่อง" ถึง "จอครัวขยับ" ที่ปริมาณเต็ม ───────────
  const fresh = visits[0]
  const marker = await select('menu_items',
    'select=id,name_th&is_available=eq.true&is_included_in_buffet=eq.true&order=name_th.desc&limit=1')
  const sent = Date.now()
  await rpc('place_order', {
    p_visit_id: fresh.id, p_items: [{ menu_item_id: marker[0].id, quantity: 7 }], p_note: null,
  })
  // ทุกออเดอร์ก่อนหน้าสั่งอย่างละ 1 ใบนี้สั่ง 7 เลข 7 บนจอครัวจึงมีได้ใบเดียว
  await expect(page.locator('.tkt__q').filter({ hasText: /^7$/ }).first())
    .toBeVisible({ timeout: 60_000 })
  const latency = Date.now() - sent
  console.log(`หน่วง realtime ที่ปริมาณเต็ม: ${latency} ms\n`)

  // ── เกณฑ์ตก: เฉพาะที่ชัดว่าใช้งานจริงไม่ได้ ───────────────────────────────
  expect(pct(times, 0.95), 'โหลดสถานะหน้าร้านช้าเกินจะใช้งานจริง').toBeLessThan(10_000)
  expect(latency, 'ออเดอร์ใหม่ใช้เวลานานเกินไปกว่าจะขึ้นจอครัว').toBeLessThan(30_000)
  expect(tickets, 'จอครัวต้องเห็นตั๋วจากหลายโต๊ะ').toBeGreaterThan(5)
})
