import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'

const BASE = path.resolve(import.meta.dirname, '..')
const FILES = [
  '0001_extensions_enums', '0002_core_config', '0003_menu_packages', '0004_floor_queue',
  '0005_visits', '0006_orders', '0007_billing_payments', '0008_functions_rpc',
  '0009_rls_realtime', '0010_token_fallback', '0011_queue_tickets',
  '0012_scope_staff_rls_by_branch', '0013_align_remote_grants',
  '0014_queue_dashboard_and_guest_adjust', '0015_fix_guest_adjust_audit', '0016_ops_gaps', '0017_qr_code_attempts',
].map(f => `migrations/${f}.sql`).concat('seed.sql')

const sanitize = (s) => s
  .replace(/^create extension.*$/gmi, '--')
  .replace(/^\s*(grant|revoke)\b[^;]*;/gmi, '--')
  .replace(/^\s*alter default privileges[^;]*;/gmi, '--')

const db = new PGlite()

// auth.uid() ที่สลับตัวตนได้ เพื่อทดสอบสิทธิ์พนักงาน/ลูกค้า
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
const be = async (uid) => db.exec(`set test.uid = '${uid ?? ''}'`)

let pass = 0, fail = 0
const ok = (name, extra = '') => { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
const bad = (name, why) => { fail++; console.log(`  ❌ ${name}\n       ${why}`) }

/** คาดว่าต้องสำเร็จ */
async function shouldPass(name, fn) {
  try { const r = await fn(); ok(name); return r }
  catch (e) { bad(name, 'ควรผ่านแต่ error: ' + e.message.split('\n')[0]) }
}
/** คาดว่าต้องถูกปฏิเสธ และข้อความต้องมีคำนี้ */
async function shouldFail(name, needle, fn) {
  try { await fn(); bad(name, 'ควรถูกปฏิเสธ แต่กลับสำเร็จ') }
  catch (e) {
    const msg = e.message.split('\n')[0]
    if (!needle || msg.includes(needle)) ok(name, `"${msg.slice(0, 62)}"`)
    else bad(name, `ถูกปฏิเสธแต่ข้อความไม่ตรงที่คาด: ${msg}`)
  }
}

// ── เตรียมพนักงาน ──────────────────────────────────────────────────────────
const [{ id: branch }] = await q(`select id from branches limit 1`)
const [{ id: staffUid }] = await q(`insert into auth.users(email) values ('staff@x.local') returning id`)
await q(`insert into profiles(id, branch_id, full_name, role) values ($1,$2,'พนักงานทดสอบ','manager')`, [staffUid, branch])
await be(staffUid)

const [stdPkg] = await q(`select * from buffet_packages where code='standard'`)
const [prmPkg] = await q(`select * from buffet_packages where code='premium'`)
const [{ id: refill }] = await q(`select id from add_ons where code='drink_refill'`)
const [freeTable] = await q(`select * from tables where status='available' order by table_number limit 1`)
const [wagyu] = await q(`select * from menu_items where name_th like '%วากิว%'`)
const [pork]  = await q(`select * from menu_items where name_th='หมูสามชั้น'`)
const [beer]  = await q(`select * from menu_items where name_th='เบียร์สิงห์'`)

console.log('\n── ① ราคาต้องมาจากฐานข้อมูล ไม่ใช่ค่าคงที่ ──')
ok('แพ็กเกจอ่านจากตาราง', `${stdPkg.name} ${stdPkg.price_per_adult_satang / 100}฿ / ${prmPkg.name} ${prmPkg.price_per_adult_satang / 100}฿`)

// ── เปิดโต๊ะ ────────────────────────────────────────────────────────────────
console.log('\n── ② 1 Visit = 1 Buffet Package ──')
const visit = await shouldPass('เปิดโต๊ะด้วยแพ็กเกจมาตรฐาน 3 ผู้ใหญ่ + น้ำรีฟิล', async () => {
  const r = await q(
    `select * from open_visit($1,$2,3,0,$3::jsonb)`,
    [freeTable.id, stdPkg.id, JSON.stringify([{ add_on_id: refill, quantity: 3 }])],
  )
  return r[0]
})

const noGuests = await q(`select count(*)::int n from information_schema.tables where table_name='visit_guests'`)
if (noGuests[0].n === 0) ok('ไม่มีตาราง visit_guests — บังคับหนึ่งโต๊ะหนึ่งแพ็กเกจโดยโครงสร้าง')
else bad('visit_guests', 'ยังมีตารางแยกรายคนอยู่')

// ── ลูกค้าเข้าโต๊ะผ่าน QR ───────────────────────────────────────────────────
console.log('\n── ⑤ ทางเข้า QR + rate limit ──')
const [{ id: custUid }] = await q(`insert into auth.users(email) values ('cust@x.local') returning id`)
await be(custUid)
await shouldPass('ลูกค้า join ด้วย session_token จากสลิป', () =>
  q(`select * from join_visit($1::uuid, null, null, 'มือถือโต๊ะ A', null)`, [visit.session_token]))

await be(null)
await shouldFail('join โดยไม่ได้ล็อกอิน', 'ไม่ระบุตัวตน', () =>
  q(`select * from join_visit($1::uuid)`, [visit.session_token]))

await be(custUid)
await shouldFail('ใส่รหัสเข้าโต๊ะผิด', 'รหัสเข้าโต๊ะไม่ถูกต้อง', () =>
  q(`select * from join_visit(null, $1::uuid, '000000')`, [freeTable.qr_token]))

// ── สั่งอาหาร ───────────────────────────────────────────────────────────────
console.log('\n── ② ล็อกเมนูตามแพ็กเกจ ──')
await shouldFail('โต๊ะแพ็กเกจมาตรฐานสั่งเนื้อวากิว', 'สั่งได้เฉพาะแพ็กเกจอื่น', () =>
  q(`select * from place_order($1, $2::jsonb)`, [visit.id, JSON.stringify([{ menu_item_id: wagyu.id, quantity: 1 }])]))

await shouldPass('สั่งหมูสามชั้น 2 ที่ (เมนูไม่ล็อก)', () =>
  q(`select * from place_order($1, $2::jsonb)`, [visit.id, JSON.stringify([{ menu_item_id: pork.id, quantity: 2 }])]))

console.log('\n── ⑤ เพดานและการหน่วงเวลา ──')
await shouldFail('สั่งซ้ำทันที (หน่วง 30 วินาที)', 'สั่งถี่เกินไป', () =>
  q(`select * from place_order($1, $2::jsonb)`, [visit.id, JSON.stringify([{ menu_item_id: pork.id, quantity: 1 }])]))

await q(`update restaurant_settings set min_seconds_between_orders = 0 where branch_id = $1`, [branch])
await shouldFail('สั่งเมนูเดียว 99 ที่ (เพดาน 10)', 'สั่งได้สูงสุด', () =>
  q(`select * from place_order($1, $2::jsonb)`, [visit.id, JSON.stringify([{ menu_item_id: pork.id, quantity: 99 }])]))

await shouldPass('สั่งเบียร์ 2 ขวด (อาหารสั่งพิเศษ คิดเงินเพิ่ม)', () =>
  q(`select * from place_order($1, $2::jsonb)`, [visit.id, JSON.stringify([{ menu_item_id: beer.id, quantity: 2 }])]))

// หมดเวลาแล้วสั่งไม่ได้
await q(`update visits set dining_deadline_at = now() - interval '1 minute' where id = $1`, [visit.id])
await be(custUid)
await shouldFail('สั่งอาหารหลังหมดเวลา', 'หมดเวลาสั่งอาหาร', () =>
  q(`select * from place_order($1, $2::jsonb)`, [visit.id, JSON.stringify([{ menu_item_id: pork.id, quantity: 1 }])]))
await q(`update visits set dining_deadline_at = now() + interval '30 minutes' where id = $1`, [visit.id])

// ── คิดบิล ──────────────────────────────────────────────────────────────────
console.log('\n── ① คิดเงินจากข้อมูลในฐานข้อมูลล้วน ──')
await be(staffUid)
const [billed] = await q(`select * from request_visit_bill($1)`, [visit.id])
const expected = 3 * stdPkg.price_per_adult_satang + 3 * 3900 + 2 * beer.a_la_carte_price_satang
if (billed.total_satang === expected)
  ok('ยอดบิลถูกต้อง', `${billed.total_satang / 100}฿ = บุฟเฟต์ ${3 * stdPkg.price_per_adult_satang / 100} + น้ำ ${3 * 39} + เบียร์ ${2 * beer.a_la_carte_price_satang / 100}`)
else bad('ยอดบิล', `ได้ ${billed.total_satang} คาด ${expected}`)

const lines = await q(`select kind, description, amount_satang from bill_lines where visit_id=$1 order by sort_order`, [visit.id])
ok('bill_lines snapshot', `${lines.length} บรรทัด: ${lines.map(l => l.kind).join(', ')}`)

// ── ชำระเงิน ────────────────────────────────────────────────────────────────
console.log('\n── ③ RPC ชำระเงิน + กันจ่ายเกิน ──')
await shouldFail('จ่ายเกินยอดบิล', 'เกินยอดคงเหลือ', () =>
  q(`select * from create_payment($1,'cash',$2)`, [visit.id, billed.total_satang + 100]))

const half = Math.floor(billed.total_satang / 2)
const [p1] = await q(`select * from create_payment($1,'cash',$2,$3)`, [visit.id, half, half + 10000])
await shouldPass('จ่ายเงินสดครึ่งแรก (จ่ายแยกได้)', () => q(`select * from confirm_payment($1)`, [p1.id]))

const [{ due }] = await q(`select visit_amount_due($1) as due`, [visit.id])
ok('ยอดคงเหลือถูกต้อง', `${due / 100}฿`)

await shouldFail('จ่ายส่วนที่เหลือเกินไป 1 บาท', 'เกินยอดคงเหลือ', () =>
  q(`select * from create_payment($1,'qr_promptpay',$2)`, [visit.id, due + 100]))

const [p2] = await q(`select * from create_payment($1,'qr_promptpay',$2)`, [visit.id, due])
await shouldPass('จ่ายส่วนที่เหลือด้วย QR พร้อมเพย์', () => q(`select * from confirm_payment($1)`, [p2.id]))

const [afterPay] = await q(`select status, paid_at from visits where id=$1`, [visit.id])
if (afterPay.status === 'paid') ok('④ จ่ายครบ → สถานะ paid (ยังไม่ใช่ closed)')
else bad('สถานะหลังจ่ายครบ', `ได้ ${afterPay.status}`)

const receipts = await q(`select receipt_number, method from payments where visit_id=$1 and status='succeeded' order by receipt_number`, [visit.id])
ok('เลขใบเสร็จรันแยกใบ', receipts.map(r => `#${r.receipt_number} ${r.method}`).join(', '))

// ── ปิดรอบ ──────────────────────────────────────────────────────────────────
console.log('\n── ④ PAID → CLOSED → CLEANING → AVAILABLE ──')
await shouldFail('ข้ามขั้นจาก paid ไป open', 'เปลี่ยนสถานะ visit', () =>
  q(`update visits set status='open' where id=$1`, [visit.id]))

// อาหารที่ยังไม่ถึงมือลูกค้าต้องถูกเคลียร์ก่อน ไม่งั้นตั๋วจะค้างจอครัวถาวร
// หลังปิดรอบโต๊ะถูกปล่อยคืน ตั๋วนั้นจะไม่มีชื่อโต๊ะและไม่มีใครกดปิดได้อีก
await shouldFail('ปิดรอบทั้งที่อาหารยังค้างครัว', 'ยังมีอาหารค้างที่ครัว', () =>
  q(`select * from close_visit($1)`, [visit.id]))

const stuck = await q(
  `select i.id, i.status from order_items i join orders o on o.id = i.order_id
    where o.visit_id = $1 and i.status in ('pending','preparing','ready') order by i.created_at`, [visit.id])

await shouldPass('ครัวยกเลิกรายการพร้อมเหตุผล', () =>
  q(`select * from advance_order_item($1,'cancelled','ของหมด')`, [stuck[0].id]))

const [cancelled] = await q(`select status, cancelled_reason from order_items where id=$1`, [stuck[0].id])
if (cancelled.status === 'cancelled' && cancelled.cancelled_reason === 'ของหมด')
  ok('เหตุผลการยกเลิกถูกบันทึก', cancelled.cancelled_reason)
else bad('cancelled_reason', JSON.stringify(cancelled))

const NEXT = { pending: 'preparing', preparing: 'ready', ready: 'served' }
for (const it of stuck.slice(1)) {
  let s = it.status
  while (NEXT[s]) {
    await q(`select * from advance_order_item($1,$2::order_status)`, [it.id, NEXT[s]])
    s = NEXT[s]
  }
}

await shouldPass('ปิดรอบ (paid → closed)', () => q(`select * from close_visit($1)`, [visit.id]))

const [afterClose] = await q(
  `select v.status vs, v.session_token, t.status ts from visits v join tables t on t.id=v.table_id where v.id=$1`, [visit.id])
if (afterClose.vs === 'closed' && afterClose.ts === 'cleaning' && afterClose.session_token === null)
  ok('ปิดรอบแล้ว: visit=closed, โต๊ะ=cleaning, QR ถูกล้าง')
else bad('ผลหลังปิดรอบ', JSON.stringify(afterClose))

await be(custUid)
await shouldFail('QR เดิมสั่งอาหารหลังปิดบิล', '', () =>
  q(`select * from place_order($1, $2::jsonb)`, [visit.id, JSON.stringify([{ menu_item_id: pork.id, quantity: 1 }])]))

await be(staffUid)
await shouldFail('ข้ามขั้น cleaning → occupied', 'เปลี่ยนสถานะโต๊ะ', () =>
  q(`update tables set status='occupied' where id=$1`, [freeTable.id]))

await shouldPass('เก็บโต๊ะเสร็จ (cleaning → available)', () => q(`select * from mark_table_clean($1)`, [freeTable.id]))

// ── audit ───────────────────────────────────────────────────────────────────
console.log('\n── Audit log ──')
const audits = await q(`select action from audit_logs order by id`)
ok('บันทึก audit ครบ', audits.map(a => a.action).join(', '))


// ════════════════════════════════════════════════════════════════════════════
// P0 — กลุ่มที่พังแล้วไม่ใช่แค่ UI ผิด แต่ออเดอร์ซ้ำ เงินผิด บิลผิด ข้ามสาขา
// ════════════════════════════════════════════════════════════════════════════

/** เปิดโต๊ะใหม่บนโต๊ะว่างใบถัดไป — แต่ละเทสต์ต้องมี visit ของตัวเอง ไม่ใช้ร่วมกัน */
async function freshVisit(pkg = stdPkg, adults = 2) {
  await be(staffUid)
  const [t] = await q(`select * from tables where status='available' order by table_number limit 1`)
  const [v] = await q(`select * from open_visit($1,$2,$3,0)`, [t.id, pkg.id, adults])
  return { visit: v, table: t }
}

console.log('\n── P0-1 QR / session isolation ──')
{
  const a = await freshVisit()
  const b = await freshVisit()

  const [{ id: uidA }] = await q(`insert into auth.users(email) values ('a@x.local') returning id`)
  await be(uidA)
  await q(`select * from join_visit($1::uuid, null, null, 'device A', null)`, [a.visit.session_token])

  await shouldFail('ลูกค้าโต๊ะ A สั่งอาหารเข้าบิลโต๊ะ B', '', () =>
    q(`select * from place_order($1, $2::jsonb)`, [b.visit.id, JSON.stringify([{ menu_item_id: pork.id, quantity: 1 }])]))

  await shouldFail('ลูกค้าโต๊ะ A ขอเช็คบิลให้โต๊ะ B', '', () =>
    q(`select * from request_visit_bill($1)`, [b.visit.id]))

  const seen = await q(`select current_visit_id() as v`)
  if (seen[0].v === a.visit.id) ok('current_visit_id() ผูกกับโต๊ะตัวเองเท่านั้น')
  else bad('current_visit_id()', `ได้ ${seen[0].v} คาด ${a.visit.id}`)

  const [{ id: uidA2 }] = await q(`insert into auth.users(email) values ('a2@x.local') returning id`)
  await be(uidA2)
  await shouldPass('เครื่องที่สองของโต๊ะเดียวกัน join ได้', () =>
    q(`select * from join_visit($1::uuid, null, null, 'device A2', null)`, [a.visit.session_token]))
}

console.log('\n── P0-2 boundary เวลา last order ──')
{
  const { visit: v } = await freshVisit()
  const [cfg] = await q(
    `select last_order_minutes_before_end lo, default_dining_minutes dm from restaurant_settings where branch_id=$1`,
    [branch])
  ok('ค่าตั้งต้นเวลา', `นั่ง ${cfg.dm} นาที · ปิดรับออเดอร์ก่อนหมด ${cfg.lo} นาที`)

  const [{ id: cust }] = await q(`insert into auth.users(email) values ('b1@x.local') returning id`)
  await be(cust)
  await q(`select * from join_visit($1::uuid)`, [v.session_token])
  await be(staffUid)
  await q(`update restaurant_settings set min_seconds_between_orders = 0 where branch_id=$1`, [branch])
  await be(cust)

  // ตั้งให้เลยเส้นไป 1 วินาที ไม่ใช่ "ตรงเส้นพอดี"
  // เพราะตรงเส้นพอดีผลขึ้นกับเศษวินาทีระหว่างที่ตั้งค่ากับที่ place_order อ่าน now()
  // เทสต์ที่แกว่งตามนาฬิกาเชื่อถือไม่ได้ ต้องทดสอบให้ขาดทั้งสองฝั่ง
  await q(
    `update visits set dining_deadline_at = now() + make_interval(mins => $2) - interval '1 second'
      where id=$1`, [v.id, cfg.lo])
  await shouldFail(`เลยเส้นปิดรับออเดอร์ไป 1 วินาที`, 'หมดเวลาสั่งอาหาร', () =>
    q(`select * from place_order($1,$2::jsonb)`, [v.id, JSON.stringify([{ menu_item_id: pork.id, quantity: 1 }])]))

  await q(`update visits set dining_deadline_at = now() + make_interval(mins => $2) where id=$1`, [v.id, cfg.lo + 1])
  await shouldPass(`ก่อนเส้นปิดรับออเดอร์ 1 นาที`, () =>
    q(`select * from place_order($1,$2::jsonb)`, [v.id, JSON.stringify([{ menu_item_id: pork.id, quantity: 1 }])]))
}

console.log('\n── P0-3 สั่งซ้ำจาก retry ──')
{
  const { visit: v } = await freshVisit()
  const [{ id: cust }] = await q(`insert into auth.users(email) values ('c1@x.local') returning id`)
  await be(cust)
  await q(`select * from join_visit($1::uuid)`, [v.session_token])
  await be(staffUid)
  await q(`update restaurant_settings set min_seconds_between_orders = 30 where branch_id=$1`, [branch])
  await be(cust)

  const payload = JSON.stringify([{ menu_item_id: pork.id, quantity: 2 }])
  await shouldPass('ส่งออเดอร์ครั้งแรก', () => q(`select * from place_order($1,$2::jsonb)`, [v.id, payload]))
  await shouldFail('ยิงซ้ำทันทีเพราะ network retry', 'สั่งถี่เกินไป', () =>
    q(`select * from place_order($1,$2::jsonb)`, [v.id, payload]))

  const [{ n }] = await q(`select count(*)::int n from orders where visit_id=$1`, [v.id])
  if (n === 1) ok('มีออเดอร์ใบเดียว ไม่ซ้ำ')
  else bad('กันออเดอร์ซ้ำ', `มี ${n} ใบ`)
  ok('ข้อจำกัดที่ต้องรู้', 'กันด้วย min_seconds_between_orders ไม่ใช่ idempotency key — retry หลัง 30 วิ ยังซ้ำได้')
}

console.log('\n── P0-4 payment overpay / จ่ายผิดสถานะ ──')
{
  const { visit: v } = await freshVisit()
  await be(staffUid)
  await shouldFail('จ่ายเงินตั้งแต่ยังไม่เช็คบิล', 'ต้องกดเช็คบิลก่อน', () =>
    q(`select * from create_payment($1,'cash',10000)`, [v.id]))

  const [b] = await q(`select * from request_visit_bill($1)`, [v.id])
  await shouldFail('จ่ายเกินยอดบิล 1 สตางค์', 'เกินยอดคงเหลือ', () =>
    q(`select * from create_payment($1,'cash',$2)`, [v.id, b.total_satang + 1]))
  await shouldFail('จ่ายยอดติดลบ', '', () =>
    q(`select * from create_payment($1,'cash',-100)`, [v.id]))
}

console.log('\n── P0-5 ยกเลิกการชำระเงิน ก่อน/หลัง confirm ──')
{
  const { visit: v } = await freshVisit()
  await be(staffUid)
  const [b] = await q(`select * from request_visit_bill($1)`, [v.id])

  const [pA] = await q(`select * from create_payment($1,'card',$2)`, [v.id, b.total_satang])
  await shouldPass('ยกเลิกก่อน confirm ได้', () => q(`select * from cancel_payment($1,'ลูกค้าเปลี่ยนใจ')`, [pA.id]))
  const [{ due: dueAfterCancel }] = await q(`select visit_amount_due($1) as due`, [v.id])
  if (dueAfterCancel === b.total_satang) ok('ยกเลิกแล้วยอดคงเหลือกลับมาเต็ม', `${dueAfterCancel / 100}฿`)
  else bad('ยอดหลังยกเลิก', `ได้ ${dueAfterCancel} คาด ${b.total_satang}`)

  const [pB] = await q(`select * from create_payment($1,'cash',$2)`, [v.id, b.total_satang])
  await q(`select * from confirm_payment($1)`, [pB.id])
  await shouldFail('ยกเลิกหลัง confirm แล้ว', '', () => q(`select * from cancel_payment($1,'กดผิด')`, [pB.id]))
}

console.log('\n── P0-6 snapshot ราคาแพ็กเกจ ──')
{
  const { visit: v } = await freshVisit(stdPkg, 2)
  const priceAtOpen = v.package_price_adult_satang

  await be(staffUid)
  await q(`update buffet_packages set price_per_adult_satang = price_per_adult_satang + 5000 where id=$1`, [stdPkg.id])
  await q(`select * from request_visit_bill($1)`, [v.id])
  const expectBuffet = 2 * priceAtOpen

  const [line] = await q(`select amount_satang from bill_lines where visit_id=$1 and kind='buffet_adult'`, [v.id])
  if (line && line.amount_satang === expectBuffet)
    ok('ขึ้นราคาแล้วบิลเก่ายังใช้ราคาตอนเปิดโต๊ะ', `${expectBuffet / 100}฿ · ราคาใหม่ ${(priceAtOpen + 5000) / 100}฿ ไม่กระทบ`)
  else bad('snapshot ราคา', `bill_line=${line ? line.amount_satang : 'ไม่มี'} คาด ${expectBuffet}`)
  await q(`update buffet_packages set price_per_adult_satang = $2 where id=$1`, [stdPkg.id, priceAtOpen])
}

console.log('\n── boundary: เวลานั่งตามแพ็กเกจ ──')
{
  const a = await freshVisit(stdPkg, 2)
  const b = await freshVisit(prmPkg, 2)
  const mins = (v) => Math.round((new Date(v.dining_deadline_at) - new Date(v.check_in_at)) / 60000)
  const gotA = mins(a.visit), gotB = mins(b.visit)
  if (gotA === stdPkg.dining_minutes && gotB === prmPkg.dining_minutes)
    ok('เวลานั่งมาจากแพ็กเกจ ไม่ใช่ค่าคงที่', `${stdPkg.name} ${gotA} นาที · ${prmPkg.name} ${gotB} นาที`)
  else bad('เวลานั่งตามแพ็กเกจ', `ได้ ${gotA}/${gotB} คาด ${stdPkg.dining_minutes}/${prmPkg.dining_minutes}`)
}

console.log('\n── boundary: ส่วนลดต้องไม่ทำให้ยอดติดลบ ──')
{
  const { visit: v } = await freshVisit()
  await be(staffUid)
  const [{ id: promo }] = await q(`select id from promotions where code='LUNCH10'`)
  const [b0] = await q(`select * from request_visit_bill($1)`, [v.id])

  await q(
    `insert into visit_promotions (visit_id, promotion_id, name_snapshot, discount_satang)
     values ($1,$2,'ทดสอบส่วนลดเกินยอด',$3)`,
    [v.id, promo, b0.subtotal_satang + 999999])
  const [b1] = await q(`select * from request_visit_bill($1)`, [v.id])
  if (b1.total_satang >= 0) ok('ส่วนลดเกินยอด → ยอดสุทธิไม่ติดลบ', `${b1.total_satang / 100}฿`)
  else bad('ยอดติดลบ', `${b1.total_satang}`)
}

console.log('\n── P0-7 แยกข้อมูลข้ามสาขา ──')
{
  // PGlite รันเป็น superuser → RLS ไม่ถูกบังคับ การนับแถวจึงไม่ใช่หลักฐาน
  // ตรวจที่ "ตัว policy" แทน ว่ามีเงื่อนไขสาขาอยู่ในนิพจน์หรือไม่ ซึ่งอ่านได้ตรง ๆ
  // และเป็นความจริงเดียวกันไม่ว่าจะรันด้วยสิทธิ์ใด
  const BRANCH_SCOPED = ['visits', 'orders', 'queue_tickets', 'payments', 'tables']
  const pols = await q(
    `select tablename, policyname, coalesce(qual, '') qual
       from pg_policies
      where schemaname='public' and tablename = any($1)`, [BRANCH_SCOPED])

  const leaky = pols.filter((p) =>
    p.qual.includes('is_staff()') && !/branch/i.test(p.qual))

  if (leaky.length === 0) {
    ok('policy ของตารางข้ามสาขามีเงื่อนไขสาขาครบ')
  } else {
    bad('แยกข้อมูลข้ามสาขา',
        `${leaky.length} policy ให้สิทธิ์ด้วย is_staff() ล้วนโดยไม่เช็คสาขา — ` +
        `พนักงานสาขาใดก็อ่านข้อมูลทุกสาขาได้: ` +
        leaky.map((p) => `${p.tablename}.${p.policyname}`).join(', ') +
        ` · current_staff_branch() มีอยู่แล้วแต่ไม่ถูกใช้ใน policy เลย`)
  }

  // ยืนยันซ้ำที่ระดับฟังก์ชัน: is_staff() ไม่รับ/ไม่เทียบสาขา
  const [{ src }] = await q(
    `select prosrc src from pg_proc where proname='is_staff'`)
  if (/branch/i.test(src)) ok('is_staff() พิจารณาสาขา')
  else ok('ยืนยันสาเหตุ', 'is_staff() เช็คแค่ว่ามีแถวใน profiles และ is_active — ไม่มีสาขาในเงื่อนไข')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── โปรโมชั่นด้วยโค้ด (0016) ──')
// เงื่อนไขของโปรตัดสินที่ฐานข้อมูล หน้าจอส่งมาแค่โค้ด จึงต้องพิสูจน์ที่ชั้นนี้
{
  const { visit } = await freshVisit(stdPkg, 2)
  await be(staffUid)

  // ทำให้ผลลัพธ์ไม่ขึ้นกับเวลาที่รันเทสต์ — LUNCH10 ของจริงจำกัด จ–ศ 11:00–16:00
  await q(`update promotions set days_of_week='{}', time_start=null, time_end=null where code='LUNCH10'`)

  const [billed] = await q(`select * from request_visit_bill($1)`, [visit.id])
  const expect = billed.subtotal_satang - Math.round(billed.subtotal_satang * 0.1)

  await shouldFail('โค้ดที่ไม่มีอยู่จริง', 'ไม่พบโค้ดโปรโมชั่นนี้', () =>
    q(`select * from apply_promotion_code($1,'NOPE')`, [visit.id]))

  const [afterPromo] = await q(`select * from apply_promotion_code($1,'lunch10')`, [visit.id])
  if (afterPromo.total_satang === expect)
    ok('ใส่โค้ดแล้วยอดลด 10%', `${billed.total_satang / 100}฿ → ${afterPromo.total_satang / 100}฿`)
  else bad('ส่วนลดจากโค้ด', `ได้ ${afterPromo.total_satang} คาด ${expect}`)

  await shouldFail('ใส่โค้ดเดิมซ้ำ', 'ไปแล้ว', () =>
    q(`select * from apply_promotion_code($1,'LUNCH10')`, [visit.id]))

  const [{ n: used }] = await q(`select uses_count n from promotions where code='LUNCH10'`)
  if (used === 1) ok('นับจำนวนครั้งที่ใช้', `${used} ครั้ง`)
  else bad('uses_count', `ได้ ${used}`)

  // นอกวันที่กำหนด — เลือกวันที่ไม่ใช่วันนี้เสมอ ไม่ว่าจะรันวันไหน
  const { visit: v2 } = await freshVisit(stdPkg, 2)
  await be(staffUid)
  await q(`update promotions
              set days_of_week = array[((extract(dow from now() at time zone 'Asia/Bangkok')::int + 3) % 7)]::smallint[]
            where code='LUNCH10'`)
  await shouldFail('ใช้โค้ดนอกวันที่กำหนด', 'ใช้ไม่ได้ในวันนี้', () =>
    q(`select * from apply_promotion_code($1,'LUNCH10')`, [v2.id]))
  await q(`update promotions set days_of_week='{}' where code='LUNCH10'`)

  // ถอดโปรออกแล้วยอดต้องกลับเป็นเต็ม
  const [{ id: promoId }] = await q(`select id from promotions where code='LUNCH10'`)
  const [removed] = await q(`select * from remove_visit_promotion($1,$2)`, [visit.id, promoId])
  if (removed.total_satang === billed.total_satang && removed.discount_satang === 0)
    ok('ถอดโปรแล้วยอดกลับเป็นเต็ม', `${removed.total_satang / 100}฿`)
  else bad('ถอดโปร', `ได้ ${removed.total_satang} คาด ${billed.total_satang}`)

  // รับเงินไปแล้วบางส่วนแล้วมาใส่โปรทีหลัง = ยอดบิลต่ำกว่าเงินที่รับมา ต้องบล็อก
  const [{ due: due3 }] = await q(`select visit_amount_due($1) due`, [visit.id])
  const [pay] = await q(`select * from create_payment($1,'cash',$2)`, [visit.id, Math.floor(due3 / 2)])
  await q(`select * from confirm_payment($1)`, [pay.id])
  await shouldFail('ใส่โปรหลังรับเงินไปแล้วบางส่วน', 'รับชำระเงินไปแล้ว', () =>
    q(`select * from apply_promotion_code($1,'LUNCH10')`, [visit.id]))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── QR ติดโต๊ะ: นับรหัสผิดและล็อกได้จริง (0017) ──')
// ของเดิม insert แถว "ผิด" แล้ว raise ในฟังก์ชันเดียวกัน = rollback ทิ้งทุกครั้ง
// ตัวนับจึงได้ 0 ตลอด เดารหัส 6 หลักได้ไม่จำกัด
{
  // เทสต์ก่อนหน้าจองโต๊ะว่างไปหมดแล้ว — ใช้โต๊ะที่ยังเปิดอยู่ใบใดใบหนึ่งแทน
  await be(staffUid)
  const [visit] = await q(`select * from visits where status='open' order by check_in_at desc limit 1`)
  const [table] = await q(`select * from tables where id=$1`, [visit.table_id])
  const [{ id: guest }] = await q(`insert into auth.users(email) values ('qr-guest@x.local') returning id`)
  await be(guest)

  const [{ join_visit_with_code: wrong }] = await q(
    `select join_visit_with_code($1::uuid,'000000')`, [table.qr_token])
  if (wrong.ok === false && wrong.error.includes('รหัสเข้าโต๊ะไม่ถูกต้อง')) ok('รหัสผิดถูกปฏิเสธ', wrong.error)
  else bad('รหัสผิด', JSON.stringify(wrong))

  const [{ n: logged }] = await q(
    `select count(*)::int n from visit_access_attempts where visit_id=$1 and not succeeded`, [visit.id])
  if (logged === 1) ok('ความพยายามที่ผิดถูกบันทึกไว้จริง', `${logged} ครั้ง`)
  else bad('บันทึกรหัสผิด', `มี ${logged} แถว — transaction ถูก rollback อีกแล้ว`)

  // ยิงจนครบเพดานแล้วต้องโดนล็อก แม้จะใส่รหัสถูกในครั้งถัดไป
  const [{ max }] = await q(
    `select qr_max_failed_attempts max from restaurant_settings limit 1`)
  for (let i = logged; i < max; i++) {
    await q(`select join_visit_with_code($1::uuid,'000001')`, [table.qr_token])
  }
  const [{ join_visit_with_code: locked }] = await q(
    `select join_visit_with_code($1::uuid,$2)`, [table.qr_token, visit.access_code])
  if (locked.ok === false && locked.error.includes('หลายครั้งเกินไป')) ok('ครบเพดานแล้วล็อกโต๊ะไว้', locked.error)
  else bad('ล็อกหลังเดารหัสหลายครั้ง', JSON.stringify(locked))

  // ปลดล็อกแล้วรหัสที่ถูกต้องต้องเข้าได้
  await q(`update visits set access_locked_until = null where id=$1`, [visit.id])
  await q(`delete from visit_access_attempts where visit_id=$1 and not succeeded`, [visit.id])
  const [{ join_visit_with_code: good }] = await q(
    `select join_visit_with_code($1::uuid,$2)`, [table.qr_token, visit.access_code])
  if (good.ok === true && good.visit.id === visit.id) ok('รหัสถูกต้องเข้าโต๊ะได้')
  else bad('เข้าด้วยรหัสที่ถูกต้อง', JSON.stringify(good))
}

console.log(`\n${'─'.repeat(60)}\nผ่าน ${pass} · ไม่ผ่าน ${fail}`)
process.exit(fail ? 1 : 0)
