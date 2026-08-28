import fs from 'fs'
import path from 'path'
import { chromium } from '@playwright/test'

/**
 * เตรียม session ผู้เยี่ยมชม (anonymous) ไว้ให้ทุกเทสต์ใช้ร่วมกัน
 * ----------------------------------------------------------------------------
 * ทำไมต้องมี: ทุก context ใหม่ของเบราว์เซอร์ = สมัคร anonymous ใหม่หนึ่งคน
 * ชุดเทสต์ 11 เคสจึงกินโควตา 11 คนต่อการรันหนึ่งครั้ง พอรันซ้ำไม่กี่รอบก็ชน
 * เพดานต่อชั่วโมงของ Supabase แล้วแอปตกไปโหมดสำรองกลางคัน
 * ผลคือเทสต์ล้มแบบสุ่ม โดยที่โค้ดไม่ได้ผิดอะไรเลย
 *
 * เก็บ storage state ไว้ในไฟล์แล้วให้ทุก context โหลดไปใช้ จึงสมัครแค่ครั้งเดียว
 * และใช้ข้ามการรันได้ด้วย (supabase-js ต่ออายุ token ให้เองจาก refresh token)
 */
export const STATE_FILE = path.resolve(import.meta.dirname, 'anon-state.json')

const AUTH_KEY_HINT = 'auth'   // supabase-js เก็บ session ไว้ใต้คีย์ที่มีคำว่า auth

export function stateHasSession() {
  if (!fs.existsSync(STATE_FILE)) return false
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    return (state.origins ?? []).some((o) =>
      (o.localStorage ?? []).some((kv) => kv.name.includes(AUTH_KEY_HINT) && kv.value.includes('refresh_token')))
  } catch {
    return false
  }
}

export default async function globalSetup(config) {
  if (stateHasSession()) return

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173'
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
    // รอให้ขั้นตอนเปิดแอปสมัคร anonymous ให้เสร็จ — ไม่มี session = ไม่มีอะไรให้เก็บ
    await page.waitForFunction(
      () => Object.keys(localStorage).some((k) => k.includes('auth') && (localStorage.getItem(k) ?? '').includes('refresh_token')),
      undefined,
      { timeout: 60_000 },
    )
    await context.storageState({ path: STATE_FILE })
  } catch {
    // สมัครไม่ได้ (เพดานต่อชั่วโมง / ปิด anonymous sign-in)
    // ต้องเขียนไฟล์เปล่าไว้ ไม่งั้น use.storageState ชี้ไปยังไฟล์ที่ไม่มีแล้วทั้งชุดพังตั้งแต่ยังไม่เริ่ม
    if (!fs.existsSync(STATE_FILE)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify({ cookies: [], origins: [] }))
    }
  } finally {
    await browser.close()
  }
}
