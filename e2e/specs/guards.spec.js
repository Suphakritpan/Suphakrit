import { test, expect } from '@playwright/test'
import { configured } from '../support/db.js'

test.skip(!configured, 'ตั้ง E2E_STAFF_PASSWORD ก่อน (ชุดนี้ยิงเข้า Supabase จริง)')

test.describe.configure({ mode: 'serial' })

// ด่านพวกนี้มีผลเฉพาะโหมด live — โหมดสำรองเปิดคอนโซลได้โดยไม่ต้องล็อกอินตามดีไซน์
//
// เช็คจาก "สิ่งที่หน้าจอเป็นจริง ๆ" ไม่ใช่ทายจาก pre-flight
// การยิงทดสอบ signup ล่วงหน้ากินโควตาเองหนึ่งใบ แล้วยังแข่งกับแอปที่กำลังสมัครอยู่พอดี

/**
 * ล้าง session พนักงานครั้งเดียวต่อไฟล์ ไม่ใช่ทุกเทสต์
 *
 * supabase-js เก็บ session ใน localStorage (storageKey 'shabu-mood.auth')
 * clearCookies() จึงไม่ทำให้ล็อกเอาต์ ต้องล้าง localStorage
 *
 * แต่ล้างทุกเทสต์ = แอปสมัคร anonymous ใหม่ทุกครั้ง แล้วชน rate limit ของ Supabase
 * เทสต์พวกนี้ต้องการแค่ "ไม่ใช่พนักงาน" ไม่ใช่ "ผู้เยี่ยมชมคนใหม่เอี่ยม"
 * จึงล้างครั้งเดียวแล้วใช้ session ผู้เยี่ยมชมเดิมร่วมกันทั้งไฟล์
 */
let mode = null   // 'live' | 'demo' — ตรวจครั้งเดียวแล้วจำไว้ทั้งไฟล์

/**
 * เตรียมเบราว์เซอร์ให้เป็น "คนที่ไม่ใช่พนักงาน" แล้วเปิดหน้าที่ต้องการ
 *
 * ตรวจโหมดที่หน้าแรกเท่านั้น เพราะป้ายสถานะการเชื่อมต่ออยู่บนหน้าแรกกับคอนโซล
 * หน้าลูกค้าไม่มีป้ายนี้ ถ้าไปตรวจตรงนั้นจะนับได้ 0 เสมอแล้วเข้าใจผิดว่าเป็น live
 */
async function asStranger(page, url) {
  if (mode === null) {
    await page.goto('/')
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await page.reload()
    await expect(page.getByText('เชื่อม Supabase').or(page.getByText('ข้อมูลจำลอง')).first())
      .toBeVisible({ timeout: 30_000 })
    mode = (await page.getByText('ข้อมูลจำลอง').count()) > 0 ? 'demo' : 'live'
  }

  // โหมดสำรองเปิดคอนโซลได้โดยไม่ต้องล็อกอินตามดีไซน์ ด่านของโหมด live จึงทดสอบไม่ได้
  test.skip(mode === 'demo', 'แอปอยู่โหมดสำรอง (ต่อ Supabase ไม่ได้) — ด่านของโหมด live ทดสอบไม่ได้')

  await page.goto(url)
  await expect(page.getByText('กำลังเชื่อมต่อฐานข้อมูล')).toHaveCount(0, { timeout: 30_000 })
}

/**
 * ด่านที่ต้องไม่หลุด และหน้าที่ต้องไม่พังเป็นจอขาว
 * ทั้งสามเคสนี้เคยพังจริงมาแล้วทั้งหมด จึงล็อกไว้กันย้อนกลับ
 */
test.describe('ด่านกั้นและหน้าที่ไม่มีข้อมูล', () => {
  test('คอนโซลพนักงานต้องขอล็อกอินก่อน ไม่ใช่เปิดเข้าได้เลย', async ({ page }) => {
    await asStranger(page, '/staff')
    // ลูกค้าที่สแกน QR ก็มี session — ตัวชี้ขาดคือแถวใน profiles ไม่ใช่แค่มี session
    await expect(page.getByRole('heading', { name: /เข้าสู่ระบบพนักงาน/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'ผังโต๊ะ' })).toHaveCount(0)
  })

  test('หน้าผู้จัดการก็ต้องขอล็อกอินเหมือนกัน', async ({ page }) => {
    await asStranger(page, '/admin')
    await expect(page.getByRole('heading', { name: /เข้าสู่ระบบผู้จัดการ/ })).toBeVisible()
  })

  test('เปิด /order ตรง ๆ โดยไม่ได้สแกน QR ต้องบอกให้สแกน ไม่ใช่จอขาว', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    await asStranger(page, '/order')
    await expect(page.getByText('ยังไม่ได้เข้าโต๊ะ')).toBeVisible()
    await expect(page.getByText('สแกน QR บนสลิป', { exact: false })).toBeVisible()
    expect(errors, 'ต้องไม่มี exception หลุดออกมาจนหน้าขาว').toEqual([])
  })

  test('token โต๊ะที่ตายแล้วต้องบอกเหตุผล ไม่ใช่จอขาว', async ({ page }) => {
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))

    await asStranger(page, '/v/00000000-0000-0000-0000-000000000000')

    // ปลายทางมีได้สองแบบตามสถานะการเชื่อมต่อ:
    //   ต่อฐานข้อมูลได้ → ขึ้นเหตุผลว่า QR ใช้ไม่ได้
    //   ต่อไม่ได้/ตกโหมดสำรอง → เด้งไปหน้าลูกค้าที่บอกให้สแกน QR
    // สิ่งที่ต้องจริงเสมอคือ "ลูกค้าได้คำอธิบาย ไม่ใช่จอเปล่า"
    await expect(page.locator('body')).toContainText(/พนักงาน|สแกน QR/)
    expect(errors, 'ต้องไม่มี exception หลุดจนหน้าขาว').toEqual([])
  })
})
