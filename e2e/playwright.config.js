import { defineConfig, devices } from '@playwright/test'

/**
 * E2E ของ Shabu Mood — ยิงผ่านหน้าจอจริง
 * ----------------------------------------------------------------------------
 * ทำไมต้องมีทั้งที่ชุด PGlite ผ่าน 116 เช็คแล้ว:
 * บั๊กคิดเงินเด็กเป็นผู้ใหญ่รอดจากเทสต์ฐานข้อมูลทั้งหมด เพราะเทสต์เรียก
 * open_visit() ด้วยค่าที่ถูกอยู่แล้ว ส่วนหน้าจอส่ง party_size เป็นผู้ใหญ่ล้วน
 * ชั้นที่ขาดคือ "หน้าจอส่งอะไรเข้า RPC" ซึ่งต้องกดผ่าน UI จริงเท่านั้นถึงเห็น
 *
 * ⚠️ ชุดนี้ยิงเข้า Supabase จริงตาม frontend/.env.local — ไม่มีฐานทดสอบแยก
 *    จึงตั้งให้ opt-in: ไม่มี E2E_STAFF_PASSWORD = ข้ามทั้งชุด
 *    เหมือน concurrency.test.mjs เพื่อไม่ให้ CI ที่ยังไม่พร้อมพัง
 *    ทุก spec เก็บกวาดข้อมูลที่ตัวเองสร้าง
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,        // แชร์ฐานข้อมูลเดียวกัน รันขนานแล้วชนกัน
  workers: 1,
  retries: 0,
  // ทุก context ใหม่ = สมัคร anonymous ใหม่หนึ่งคน
  // เปิดใหม่ทุกเทสต์จะชน rate limit ของ Supabase แล้วแอปเปิดไม่ขึ้น
  // จึงใช้ context เดียวทั้งไฟล์ แล้วเคลียร์ storage เองเมื่อเทสต์ไหนต้องการเริ่มสด
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],

  // สตาร์ท dev server ให้เอง ถ้ายังไม่ได้เปิดค้างไว้
  webServer: {
    command: 'npm run dev',
    cwd: '../frontend',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
