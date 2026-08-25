import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'

const BASE = path.resolve(import.meta.dirname, '..')
const FILES = [
  '0001_extensions_enums', '0002_core_config', '0003_menu_packages', '0004_floor_queue',
  '0005_visits', '0006_orders', '0007_billing_payments', '0008_functions_rpc',
  '0009_rls_realtime', '0010_token_fallback',
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

console.log(`\n${'─'.repeat(60)}\nผ่าน ${pass} · ไม่ผ่าน ${fail}`)
process.exit(fail ? 1 : 0)
