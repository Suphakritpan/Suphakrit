/**
 * เทสต์ที่ต้องมี "สอง connection ชนกันจริง" — PGlite ทำแทนไม่ได้
 * ----------------------------------------------------------------------------
 * PGlite เป็น Postgres ตัวเดียวในหน่วยความจำ ต่อได้ทีละ connection
 * race condition ที่เกิดจากสอง transaction ชนกันจึงจำลองไม่ได้เลย
 * ไฟล์นี้จึงยิงเข้า Postgres จริง แยก CI step ออกจาก rules.test.mjs
 *
 * รัน:
 *   DATABASE_URL='postgresql://postgres:<pass>@db.<ref>.supabase.co:5432/postgres' \
 *     node concurrency.test.mjs
 *
 * ⚠️ ไฟล์นี้เขียนข้อมูลจริง — ชี้ไป project ทดสอบเท่านั้น ห้ามชี้ production
 *    ทุกเทสต์เก็บกวาดของตัวเองท้ายไฟล์ (เปิดโต๊ะไหนก็ปิดโต๊ะนั้น)
 */
import pg from 'pg'

const URL = process.env.DATABASE_URL
if (!URL) {
  console.log('⏭  ข้าม concurrency tests — ไม่ได้ตั้ง DATABASE_URL')
  console.log('   (ตั้งใจให้ข้ามได้ เพื่อไม่ให้ CI ที่ยังไม่มีฐานจริงพัง)')
  process.exit(0)
}

let pass = 0, fail = 0
const ok = (n, extra = '') => { pass++; console.log(`  ✅ ${n}${extra ? ' — ' + extra : ''}`) }
const bad = (n, why) => { fail++; console.log(`  ❌ ${n}\n       ${why}`) }

const conn = async () => {
  const c = new pg.Client({ connectionString: URL })
  await c.connect()
  return c
}
/** สวมบทเป็นพนักงานคนหนึ่งบน connection นี้ */
const asStaff = async (c, uid) => {
  await c.query(`select set_config('request.jwt.claims', $1, false)`,
                [JSON.stringify({ sub: uid, role: 'authenticated' })])
}

const admin = await conn()
const [{ id: branch }] = (await admin.query(`select id from branches limit 1`)).rows
const staff = (await admin.query(`select id from profiles where is_active limit 1`)).rows[0]
if (!staff) {
  console.log('❌ ไม่มีแถวใน profiles — รัน seed_dev_staff.sql ก่อน')
  process.exit(1)
}
const [pkg] = (await admin.query(`select * from buffet_packages where is_active order by sort_order limit 1`)).rows
const [menu] = (await admin.query(
  `select * from menu_items where is_available and is_included_in_buffet limit 1`)).rows

/** เปิดโต๊ะใหม่ คืน visit — ใช้ connection admin */
async function openFresh() {
  await asStaff(admin, staff.id)
  const [t] = (await admin.query(
    `select * from tables where status='available' order by table_number limit 1`)).rows
  const [v] = (await admin.query(
    `select * from open_visit($1,$2,2,0)`, [t.id, pkg.id])).rows
  return { visit: v, table: t }
}
async function cleanup(visit, table) {
  try { await admin.query(`select void_visit($1,'เก็บกวาดหลังเทสต์')`, [visit.id]) } catch { /* อาจปิดไปแล้ว */ }
  try { await admin.query(`update tables set status='available' where id=$1`, [table.id]) } catch { /* ไม่เป็นไร */ }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── C-1 staff สองคน advance รายการเดียวกันพร้อมกัน ──')
// ครัวสองเครื่องกดปุ่ม "พร้อมเสิร์ฟ" ใบเดียวกันพร้อมกัน
// ที่ถูกคือมีคนเดียวที่เปลี่ยนสถานะสำเร็จ อีกคนต้องโดนปฏิเสธ
// ถ้าผ่านทั้งคู่ = order_status_history มีสองแถวสำหรับ transition เดียว
{
  const { visit, table } = await openFresh()
  const [order] = (await admin.query(
    `select * from place_order($1,$2::jsonb)`,
    [visit.id, JSON.stringify([{ menu_item_id: menu.id, quantity: 1 }])])).rows
  const [item] = (await admin.query(
    `select * from order_items where order_id=$1 limit 1`, [order.id])).rows

  const a = await conn(), b = await conn()
  await asStaff(a, staff.id); await asStaff(b, staff.id)

  // เริ่ม transaction ทั้งคู่ก่อน แล้วค่อยยิงพร้อมกัน ให้ชนกันจริงที่ระดับ row lock
  await a.query('begin'); await b.query('begin')
  const results = await Promise.allSettled([
    a.query(`select * from advance_order_item($1,'preparing')`, [item.id]),
    b.query(`select * from advance_order_item($1,'preparing')`, [item.id]),
  ])
  await Promise.allSettled([a.query('commit'), b.query('commit')])

  const okCount = results.filter((r) => r.status === 'fulfilled').length
  const [{ n: hist }] = (await admin.query(
    `select count(*)::int n from order_status_history where order_item_id=$1 and to_status='preparing'`,
    [item.id])).rows

  if (okCount === 1 && hist === 1) {
    ok('มีคนเดียวที่เปลี่ยนสถานะสำเร็จ', `history ${hist} แถว`)
  } else if (okCount === 2 && hist === 1) {
    ok('ทั้งคู่ไม่ error แต่ history ไม่ซ้ำ', 'ยอมรับได้ — ผลลัพธ์สุดท้ายถูก')
  } else {
    bad('advance พร้อมกัน',
        `สำเร็จ ${okCount} ครั้ง · order_status_history มี ${hist} แถวสำหรับ transition เดียว ` +
        `(คาด 1) — เสี่ยงนับสถิติครัวซ้ำและ audit เพี้ยน`)
  }

  await a.end(); await b.end()
  await cleanup(visit, table)
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── C-2 ปิดรอบพร้อมกันสองเครื่อง ──')
// พนักงานสองคนกด "ปิดรอบ" โต๊ะเดียวกันพร้อมกัน
// ที่ถูกคือปิดสำเร็จครั้งเดียว โต๊ะไป cleaning ครั้งเดียว ไม่ใช่สองครั้งซ้อน
{
  const { visit, table } = await openFresh()
  await admin.query(`select request_visit_bill($1)`, [visit.id])
  const [{ due }] = (await admin.query(`select visit_amount_due($1) due`, [visit.id])).rows
  const [p] = (await admin.query(
    `select * from create_payment($1,'cash',$2)`, [visit.id, due])).rows
  await admin.query(`select confirm_payment($1)`, [p.id])

  const a = await conn(), b = await conn()
  await asStaff(a, staff.id); await asStaff(b, staff.id)

  const results = await Promise.allSettled([
    a.query(`select * from close_visit($1)`, [visit.id]),
    b.query(`select * from close_visit($1)`, [visit.id]),
  ])
  const okCount = results.filter((r) => r.status === 'fulfilled').length

  const [row] = (await admin.query(
    `select v.status vs, t.status ts from visits v join tables t on t.id=v.table_id where v.id=$1`,
    [visit.id])).rows
  const [{ n: closes }] = (await admin.query(
    `select count(*)::int n from audit_logs where action='close_visit' and record_id=$1`,
    [visit.id])).rows

  if (okCount === 1 && row.vs === 'closed' && row.ts === 'cleaning' && closes === 1)
    ok('ปิดรอบสำเร็จครั้งเดียว', `visit=${row.vs} โต๊ะ=${row.ts} audit ${closes} แถว`)
  else
    bad('ปิดรอบพร้อมกัน',
        `สำเร็จ ${okCount} ครั้ง · visit=${row.vs} โต๊ะ=${row.ts} · audit close_visit ${closes} แถว (คาด 1)`)

  await a.end(); await b.end()
  await admin.query(`update tables set status='available' where id=$1`, [table.id])
}

await admin.end()
console.log(`\n${'─'.repeat(60)}\nผ่าน ${pass} · ไม่ผ่าน ${fail}`)
process.exit(fail ? 1 : 0)
