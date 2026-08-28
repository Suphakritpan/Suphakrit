import { test, expect } from '@playwright/test'
import { configured, select, rpc, cleanup, STAFF_EMAIL, STAFF_PASSWORD } from '../support/db.js'

test.skip(!configured, 'ตั้ง E2E_STAFF_PASSWORD ก่อน (ชุดนี้ยิงเข้า Supabase จริง)')

test.describe.configure({ mode: 'serial' })

// ชุดนี้ตรวจเส้นทางของโหมด live ล้วน — ถ้าแอปตกโหมดสำรองจะเห็นข้อมูลจำลอง
// แล้วผลที่ได้ไม่ได้บอกอะไรเกี่ยวกับโค้ดจริง จึงข้ามแทนที่จะรายงานว่าพัง

const created = { ticketIds: [], visitIds: [] }
test.afterAll(() => cleanup(created))

/**
 * ล็อกอินพนักงานผ่านหน้าจอจริง ไม่ยัด token เข้า storage
 *
 * ต้องรอให้ขั้นตอนเปิดแอปจบก่อนถึงจะรู้ว่าต้องล็อกอินไหม
 * ถ้าเช็คทันทีหลัง goto จะไปเจอ spinner แล้วสรุปว่า "ไม่มีฟอร์ม" ทั้งที่มันยังไม่วาด
 */
async function loginAsStaff(page) {
  await page.goto('/staff/queue')

  const loginForm = page.getByRole('heading', { name: /เข้าสู่ระบบพนักงาน/ })
  const queuePage = page.getByRole('heading', { name: 'คิวหน้าร้าน' })
  await expect(loginForm.or(queuePage).first()).toBeVisible({ timeout: 30_000 })

  if (await loginForm.isVisible()) {
    await page.getByLabel('อีเมล').fill(STAFF_EMAIL)
    await page.getByLabel('รหัสผ่าน').fill(STAFF_PASSWORD)
    await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  }
  await expect(queuePage).toBeVisible({ timeout: 30_000 })

  const demo = await page.getByText('ข้อมูลจำลอง').count()
  test.skip(demo > 0, 'แอปอยู่โหมดสำรอง (ต่อ Supabase ไม่ได้) — เส้นทางโหมด live ทดสอบไม่ได้')
}

test.describe('คิว → โต๊ะ → บิล', () => {
  test('ออกบัตรคิวแยกผู้ใหญ่/เด็ก แล้วค่าที่บันทึกต้องตรงกับที่กรอก', async ({ page }) => {
    await loginAsStaff(page)

    await page.getByRole('button', { name: 'ออกบัตรคิว' }).click()
    const sheet = page.locator('.sheet__box')
    await sheet.getByLabel('ผู้ใหญ่').fill('2')
    await sheet.getByLabel('เด็ก').fill('2')
    await sheet.getByLabel('ชื่อ (ไม่บังคับ)').fill('E2E ครอบครัว')
    await expect(sheet.getByText('รวม 4 ท่าน')).toBeVisible()
    await sheet.getByRole('button', { name: /ออกบัตร/ }).click()

    // สลิปต้องขึ้นพร้อม QR ที่สแกนได้จริง ไม่ใช่ลายปลอม
    // ต้องเจาะจงหัวสลิป ไม่ใช่ getByText('บัตรคิว') ที่ไปแมตช์ปุ่ม "ออกบัตรคิว" ด้วย
    await expect(page.getByText('สแกนเพื่อดูว่าเหลืออีกกี่คิว')).toBeVisible()
    const qr = page.locator('.sheet__box img[alt="QR สำหรับสแกน"]')
    await expect(qr).toBeVisible()
    expect(await qr.getAttribute('src')).toContain('image/svg+xml')

    // ยืนยันที่ฐานข้อมูล — หน้าจอขึ้นถูกไม่พอ ต้องบันทึกถูกด้วย
    const [ticket] = await select('queue_tickets',
      'select=id,ticket_number,party_size,adult_count,child_count' +
      '&customer_name=eq.E2E ครอบครัว&order=ticket_number.desc&limit=1')
    created.ticketIds.push(ticket.id)

    expect(ticket.adult_count).toBe(2)
    expect(ticket.child_count).toBe(2)
    expect(ticket.party_size).toBe(4)
  })

  test('จัดโต๊ะจากคิวแล้วเด็กต้องไม่ถูกคิดราคาผู้ใหญ่', async ({ page }) => {
    // เคสนี้คือบั๊กที่เคยหลุดจากเทสต์ฐานข้อมูลทั้ง 116 เช็ค
    // เพราะเทสต์เรียก open_visit() ด้วยค่าที่ถูกอยู่แล้ว
    // ส่วนหน้าจอส่ง party_size เป็นผู้ใหญ่ล้วน = เก็บเกิน 300 บาทต่อโต๊ะ
    const ticket = await rpc('issue_queue_ticket', {
      p_party_size: 4, p_adult_count: 2, p_child_count: 2,
      p_customer_name: 'E2E จัดโต๊ะ',
    })
    created.ticketIds.push(ticket.id)

    await loginAsStaff(page)
    const card = page.locator('.kds > div').filter({ hasText: 'E2E จัดโต๊ะ' })
    await card.getByRole('button', { name: 'จัดโต๊ะ' }).click()

    const sheet = page.locator('.sheet__box')
    await expect(sheet.getByText(/ผู้ใหญ่ 2/)).toBeVisible()
    await expect(sheet.getByText(/เด็ก 2/)).toBeVisible()
    await sheet.getByRole('button', { name: /เปิดโต๊ะ/ }).click()

    await expect(page.getByText('ใบรับประทาน', { exact: true })).toBeVisible()
    await expect(page.locator('.sheet__box img[alt="QR สำหรับสแกน"]')).toBeVisible()

    // ต้องหยิบใบที่เทสต์นี้เปิดเองผ่าน queue_tickets.visit_id
    // ฐานนี้แชร์กับหน้าจอที่เปิดค้างอยู่ — "ใบใหม่สุดของทั้งฐาน" อาจเป็นของคนอื่น
    const [linked] = await select('queue_tickets', `select=status,visit_id&id=eq.${ticket.id}`)
    expect(linked.status).toBe('seated')
    expect(linked.visit_id).toBeTruthy()

    const [visit] = await select('visits',
      'select=id,adult_count,child_count,package_price_adult_satang,package_price_child_satang' +
      `&id=eq.${linked.visit_id}`)
    created.visitIds.push(visit.id)

    expect(visit.adult_count).toBe(2)
    expect(visit.child_count).toBe(2)
    expect(visit.package_price_child_satang).toBeLessThan(visit.package_price_adult_satang)
  })

  test('ลูกค้าสแกน QR บัตรคิวได้โดยไม่ต้องล็อกอิน และไม่เห็นข้อมูลส่วนตัว', async ({ page }) => {
    const ticket = await rpc('issue_queue_ticket', {
      p_party_size: 2, p_adult_count: 2, p_child_count: 0,
      p_customer_name: 'E2E ลูกค้า', p_phone: '0812345678',
    })
    created.ticketIds.push(ticket.id)

    // ไม่ล้าง storage — หน้านี้ไม่ได้ใช้ session อยู่แล้ว (get_queue_status เปิดให้ anon)
    // ล้างทุกครั้งจะทำให้แอปสมัคร anonymous ใหม่จนชน rate limit
    await page.goto(`/q/${ticket.public_token}`)

    await expect(page.getByText('บัตรคิวของคุณ')).toBeVisible()
    await expect(page.getByText(String(ticket.ticket_number), { exact: true }).first()).toBeVisible()
    await expect(page.getByText('เหลืออีก')).toBeVisible()

    // บัตรคิวถูกถ่ายรูปส่งต่อได้ ชื่อกับเบอร์จึงต้องไม่โผล่บนหน้านี้
    await expect(page.getByText('E2E ลูกค้า')).toHaveCount(0)
    await expect(page.getByText('0812345678')).toHaveCount(0)
  })

  test('token บัตรคิวมั่วต้องขึ้นข้อความบอก ไม่ใช่จอขาว', async ({ page }) => {
    await page.goto('/q/00000000-0000-0000-0000-000000000000')
    await expect(page.getByText('ไม่พบบัตรคิวนี้')).toBeVisible()
    await expect(page.locator('body')).toContainText('แจ้งพนักงาน')
  })
})
