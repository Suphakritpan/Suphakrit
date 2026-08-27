/**
 * โครงร่วมสำหรับเทสต์ที่รันบน PGlite
 * ----------------------------------------------------------------------------
 * แยกออกมาเพื่อไม่ต้องก๊อป setup 40 บรรทัดทุกไฟล์
 * rules.test.mjs ยังมี setup ของตัวเองอยู่ (ไม่แตะ เพราะผ่านอยู่แล้ว)
 */
import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'

const BASE = path.resolve(import.meta.dirname, '..')

const FILES = [
  '0001_extensions_enums', '0002_core_config', '0003_menu_packages', '0004_floor_queue',
  '0005_visits', '0006_orders', '0007_billing_payments', '0008_functions_rpc',
  '0009_rls_realtime', '0010_token_fallback', '0011_queue_tickets',
  '0012_scope_staff_rls_by_branch', '0013_align_remote_grants',
  '0014_queue_dashboard_and_guest_adjust',
].map((f) => `migrations/${f}.sql`).concat('seed.sql')

const sanitize = (s) => s
  .replace(/^create extension.*$/gmi, '--')
  .replace(/^\s*(grant|revoke)\b[^;]*;/gmi, '--')
  .replace(/^\s*alter default privileges[^;]*;/gmi, '--')

export async function boot() {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema if not exists auth;
    create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique);
    create or replace function auth.uid() returns uuid language sql stable
      as $fn$ select nullif(current_setting('test.uid', true), '')::uuid $fn$;
    create publication supabase_realtime;
  `)
  for (const f of FILES) await db.exec(sanitize(fs.readFileSync(path.join(BASE, f), 'utf8')))

  const q = async (sql, p) => (await db.query(sql, p)).rows
  /** สวมบทเป็นผู้ใช้คนนี้ (null = ไม่ล็อกอิน) */
  const be = async (uid) => db.exec(`set test.uid = '${uid ?? ''}'`)

  const state = { pass: 0, fail: 0 }
  const ok = (name, extra = '') => {
    state.pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`)
  }
  const bad = (name, why) => { state.fail++; console.log(`  ❌ ${name}\n       ${why}`) }

  async function shouldPass(name, fn) {
    try { const r = await fn(); ok(name); return r }
    catch (e) { bad(name, 'ควรผ่านแต่ error: ' + e.message.split('\n')[0]) }
  }
  async function shouldFail(name, needle, fn) {
    try { await fn(); bad(name, 'ควรถูกปฏิเสธ แต่กลับสำเร็จ') }
    catch (e) {
      const msg = e.message.split('\n')[0]
      if (!needle || msg.includes(needle)) ok(name, `"${msg.slice(0, 62)}"`)
      else bad(name, `ถูกปฏิเสธแต่ข้อความไม่ตรงที่คาด: ${msg}`)
    }
  }

  // ── ข้อมูลอ้างอิงที่ทุกเทสต์ใช้ ────────────────────────────────────────────
  const [{ id: branch }] = await q(`select id from branches limit 1`)
  const [{ id: staffUid }] = await q(`insert into auth.users(email) values ('staff@t.local') returning id`)
  await q(`insert into profiles(id, branch_id, full_name, role) values ($1,$2,'พนักงานทดสอบ','manager')`,
          [staffUid, branch])
  await be(staffUid)

  const [stdPkg] = await q(`select * from buffet_packages where code='standard'`)
  const [prmPkg] = await q(`select * from buffet_packages where code='premium'`)
  const [{ id: refill }] = await q(`select id from add_ons where code='drink_refill'`)

  /** ผู้ใช้ใหม่หนึ่งคน คืน uuid */
  const newUser = async (tag) =>
    (await q(`insert into auth.users(email) values ($1) returning id`, [`${tag}-${Date.now()}-${Math.random()}@t.local`]))[0].id

  /** เปิดโต๊ะว่างใบถัดไป */
  async function openTable(pkg = stdPkg, adults = 2, children = 0) {
    await be(staffUid)
    const [t] = await q(`select * from tables where status='available' order by table_number limit 1`)
    const [v] = await q(`select * from open_visit($1,$2,$3,$4)`, [t.id, pkg.id, adults, children])
    return { visit: v, table: t }
  }

  /** ลูกค้าเครื่องใหม่ join เข้าโต๊ะด้วย token จากสลิป */
  async function joinAs(visit, tag = 'cust') {
    const uid = await newUser(tag)
    await be(uid)
    await q(`select * from join_visit($1::uuid, null, null, $2, null)`, [visit.session_token, tag])
    return uid
  }

  const summary = () => {
    console.log(`\n${'─'.repeat(60)}\nผ่าน ${state.pass} · ไม่ผ่าน ${state.fail}`)
    process.exit(state.fail ? 1 : 0)
  }

  return {
    db, q, be, ok, bad, shouldPass, shouldFail, summary,
    branch, staffUid, stdPkg, prmPkg, refill,
    newUser, openTable, joinAs,
  }
}
