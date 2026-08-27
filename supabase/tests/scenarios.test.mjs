/**
 * E2E scenarios — เหตุการณ์ที่เกิดจริงในร้าน ไม่ใช่การไล่ชน schema
 * ----------------------------------------------------------------------------
 * 8 ข้อที่จัดว่าเสี่ยงสูงสุดจาก 20 scenario: ครอบตั้งแต่ลูกค้ากดสั่ง →
 * ระบบรับคำสั่ง → ครัว → เงิน → reset โต๊ะ
 *
 * เรียงตาม lifecycle จริง ไม่ได้เรียงตาม role เพื่อให้เห็นจุดที่ flow เชื่อมกัน
 *
 * ข้อจำกัดที่ต้องรู้: PGlite ต่อได้ทีละ connection
 * scenario ที่ต้องมีสอง transaction ชนกันจริง อยู่ใน concurrency.test.mjs
 */
import { boot } from './harness.mjs'

const h = await boot()
const { q, be, ok, bad, shouldPass, shouldFail, staffUid, openTable, joinAs } = h

const [pork]   = await q(`select * from menu_items where name_th='หมูสามชั้น'`)
const [beer]   = await q(`select * from menu_items where name_th='เบียร์สิงห์'`)
const [wagyu]  = await q(`select * from menu_items where name_th like '%วากิว%'`)
const order1 = (id, qty = 1) => JSON.stringify([{ menu_item_id: id, quantity: qty }])
const noThrottle = () => q(`update restaurant_settings set min_seconds_between_orders = 0`)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── S2 กดสั่งแล้วหน้าจอค้าง ลูกค้ากดซ้ำ ──')
// request แรกถึง server แล้ว แต่ response ไม่กลับถึงมือถือ ลูกค้ากดใหม่
// ที่ถูกคือได้ออเดอร์ใบเดียว
{
  const { visit } = await openTable()
  await joinAs(visit, 's2')
  await be(staffUid); await q(`update restaurant_settings set min_seconds_between_orders = 30`)
  await be((await q(`select auth.uid() u`))[0].u ?? staffUid)

  const cust = await joinAs(visit, 's2b')
  await shouldPass('ยิงครั้งแรก', () => q(`select * from place_order($1,$2::jsonb)`, [visit.id, order1(pork.id, 2)]))
  await shouldFail('กดซ้ำทันที (response แรกไม่กลับ)', 'สั่งถี่เกินไป',
    () => q(`select * from place_order($1,$2::jsonb)`, [visit.id, order1(pork.id, 2)]))

  const [{ n }] = await q(`select count(*)::int n from orders where visit_id=$1`, [visit.id])
  if (n === 1) ok('ได้ออเดอร์ใบเดียว')
  else bad('กันกดซ้ำ', `ได้ ${n} ใบ`)

  // ช่องโหว่ที่เหลือ: พ้น 30 วินาทีแล้วยิง payload เดิมซ้ำ ระบบรับเป็นใบใหม่
  await be(staffUid)
  await q(`update orders set created_at = created_at - interval '2 minutes' where visit_id=$1`, [visit.id])
  await be(cust)
  await q(`select * from place_order($1,$2::jsonb)`, [visit.id, order1(pork.id, 2)])
  const [{ n: n2 }] = await q(`select count(*)::int n from orders where visit_id=$1`, [visit.id])
  if (n2 === 2)
    ok('ข้อจำกัดที่ยังเปิดอยู่', 'พ้นหน่วงเวลาแล้ว payload เดิมสร้างใบใหม่ได้ — ไม่มี idempotency key')
  else bad('พฤติกรรมหลังพ้นหน่วงเวลา', `คาด 2 ใบ ได้ ${n2}`)
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── S3 สองคนในโต๊ะเดียวกันสั่งพร้อมกัน ──')
// คนหนึ่งสั่งหมู อีกคนสั่งเบียร์ ทั้งคู่ต้องเข้า visit เดียวกัน ไม่ทับกัน
{
  const { visit } = await openTable()
  const a = await joinAs(visit, 's3a')
  const b = await joinAs(visit, 's3b')
  await be(staffUid); await noThrottle()

  await be(a)
  await shouldPass('เครื่อง A สั่งหมู', () => q(`select * from place_order($1,$2::jsonb)`, [visit.id, order1(pork.id, 2)]))
  await be(b)
  await shouldPass('เครื่อง B สั่งเบียร์', () => q(`select * from place_order($1,$2::jsonb)`, [visit.id, order1(beer.id, 1)]))

  const rows = await q(
    `select o.order_number, i.name_snapshot from orders o
       join order_items i on i.order_id=o.id where o.visit_id=$1 order by o.order_number`, [visit.id])
  const nums = [...new Set(rows.map((r) => r.order_number))]
  if (rows.length === 2 && nums.length === 2 && nums[0] === 1 && nums[1] === 2)
    ok('เข้า visit เดียวกัน เลขรอบไม่ชนกัน', rows.map((r) => `#${r.order_number} ${r.name_snapshot}`).join(' · '))
  else bad('สองเครื่องสั่งพร้อมกัน', JSON.stringify(rows))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── S5 QR ถูกถ่ายรูปไว้ คนนอกเปิดทีหลัง ──')
{
  const { visit, table } = await openTable()
  const stolenToken = visit.session_token          // คนนอกถ่ายรูป QR เก็บไว้
  const insider = await joinAs(visit, 's5')

  await be(staffUid); await noThrottle()
  await q(`select * from request_visit_bill($1)`, [visit.id])
  const [{ due }] = await q(`select visit_amount_due($1) due`, [visit.id])
  const [p] = await q(`select * from create_payment($1,'cash',$2)`, [visit.id, due])
  await q(`select * from confirm_payment($1)`, [p.id])
  await q(`select * from close_visit($1)`, [visit.id])

  const outsider = await h.newUser('s5-outsider')
  await be(outsider)
  await shouldFail('คนนอกใช้ QR เก่าเข้าโต๊ะ', '', () =>
    q(`select * from join_visit($1::uuid)`, [stolenToken]))

  await be(insider)
  await shouldFail('เครื่องเดิมที่เคย join สั่งอาหารต่อหลังปิดบิล', '', () =>
    q(`select * from place_order($1,$2::jsonb)`, [visit.id, order1(pork.id, 1)]))

  const [after] = await q(`select session_token, access_code from visits where id=$1`, [visit.id])
  if (after.session_token === null && after.access_code === null)
    ok('ปิดบิลแล้ว token และรหัสเข้าโต๊ะถูกล้าง')
  else bad('ล้าง token หลังปิดบิล', JSON.stringify(after))

  await be(staffUid)
  await q(`select * from mark_table_clean($1)`, [table.id])
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── S9 ออเดอร์เดียวมีของหลายสถานีครัว ──')
{
  const { visit } = await openTable(h.prmPkg, 2)   // พรีเมียมเพื่อสั่งวากิวได้
  const cust = await joinAs(visit, 's9')
  await be(staffUid); await noThrottle()
  await be(cust)

  const mixed = JSON.stringify([
    { menu_item_id: pork.id, quantity: 1 },
    { menu_item_id: beer.id, quantity: 2 },
    { menu_item_id: wagyu.id, quantity: 1 },
  ])
  await shouldPass('สั่งรวม 3 รายการข้ามสถานี', () =>
    q(`select * from place_order($1,$2::jsonb)`, [visit.id, mixed]))

  const rows = await q(
    `select i.name_snapshot, s.name station
       from order_items i
       join orders o on o.id = i.order_id
       left join kitchen_stations s on s.id = i.station_id
      where o.visit_id=$1 order by i.name_snapshot`, [visit.id])

  const missing = rows.filter((r) => !r.station)
  if (rows.length === 3 && missing.length === 0)
    ok('ทุกรายการมีสถานีปลายทาง', rows.map((r) => `${r.name_snapshot}→${r.station}`).join(' · '))
  else bad('routing เข้าครัว', `${rows.length} รายการ · ไม่มีสถานี ${missing.length} รายการ`)

  const stations = [...new Set(rows.map((r) => r.station))]
  if (stations.length >= 2) ok('แยกไปคนละสถานีจริง', `${stations.length} สถานี`)
  else bad('แยกสถานี', `ทุกรายการไปสถานีเดียวกัน (${stations.join(',')})`)
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── S10 จอครัวหลุดแล้วต่อกลับ ──')
// อ่านซ้ำต้องได้ ticket ชุดเดิม ไม่ใช่ของใหม่ และประวัติสถานะต้องไม่ซ้ำ
{
  const { visit } = await openTable()
  const cust = await joinAs(visit, 's10')
  await be(staffUid); await noThrottle()
  await be(cust)
  await q(`select * from place_order($1,$2::jsonb)`, [visit.id, order1(pork.id, 2)])

  await be(staffUid)
  const read1 = await q(
    `select i.id, i.status from order_items i join orders o on o.id=i.order_id where o.visit_id=$1`, [visit.id])
  await q(`select * from advance_order_item($1,'preparing')`, [read1[0].id])

  // จอหลุด → ต่อกลับ → อ่านใหม่
  const read2 = await q(
    `select i.id, i.status from order_items i join orders o on o.id=i.order_id where o.visit_id=$1`, [visit.id])

  if (read1.length === read2.length && read2[0].status === 'preparing')
    ok('ต่อกลับแล้วเห็นชุดเดิม สถานะล่าสุดถูกต้อง', `${read2.length} รายการ · ${read2[0].status}`)
  else bad('reconnect ครัว', `ก่อน ${read1.length} หลัง ${read2.length}`)

  const [{ n: hist }] = await q(
    `select count(*)::int n from order_status_history where order_item_id=$1 and to_status='preparing'`,
    [read1[0].id])
  if (hist === 1) ok('ประวัติสถานะไม่ซ้ำหลัง reconnect')
  else bad('ประวัติสถานะ', `มี ${hist} แถวสำหรับ transition เดียว`)

  await shouldFail('ถอยสถานะกลับ preparing ซ้ำ', '', () =>
    q(`select * from advance_order_item($1,'preparing')`, [read1[0].id]))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── S15 กดรับชำระแล้วระบบตอบช้า พนักงานกดใหม่ ──')
{
  const { visit } = await openTable()
  await be(staffUid)
  await q(`select * from request_visit_bill($1)`, [visit.id])
  const [{ due }] = await q(`select visit_amount_due($1) due`, [visit.id])

  const [p1] = await q(`select * from create_payment($1,'cash',$2)`, [visit.id, due])
  ok('สร้าง payment ใบแรก', `สถานะ ${p1.status}`)

  // กดซ้ำก่อน confirm ใบแรก
  // create_payment นับเฉพาะใบที่ succeeded ไม่นับใบที่ยัง pending
  // จึงยอมให้สร้างใบที่สองเต็มยอดได้ทั้งที่ใบแรกยังจองยอดอยู่
  let secondPending = null
  try {
    const [p2] = await q(`select * from create_payment($1,'cash',$2)`, [visit.id, due])
    secondPending = p2
  } catch { /* ถ้าวันหนึ่งถูกปิดช่องนี้ ก็เข้าทางที่ถูกต้อง */ }

  await q(`select * from confirm_payment($1)`, [p1.id])

  // เพดานสำคัญที่สุด: เงินต้องไม่ถูกเก็บเกินไม่ว่าจะกดกี่ครั้ง
  if (secondPending) {
    await shouldFail('confirm ใบที่สองต้องถูกปฏิเสธ (กันเก็บเงินเกิน)', 'ชำระเกินยอดบิล', () =>
      q(`select * from confirm_payment($1)`, [secondPending.id]))
  }

  await shouldFail('confirm ใบเดิมซ้ำอีกครั้ง', '', () =>
    q(`select * from confirm_payment($1)`, [p1.id]))

  const [{ total }] = await q(
    `select coalesce(sum(amount_satang),0)::int total from payments
      where visit_id=$1 and status='succeeded'`, [visit.id])
  const [v] = await q(`select status from visits where id=$1`, [visit.id])
  if (total === due && v.status === 'paid') ok('ยอดที่เก็บได้เท่ากับบิลพอดี', `${total / 100}฿ · visit=${v.status}`)
  else bad('ยอดที่เก็บได้', `เก็บ ${total} จากบิล ${due} · visit=${v.status}`)

  // ข้อบกพร่องที่ยังเหลือ: ใบ pending ที่ค้างอยู่ confirm ไม่ได้ตลอดกาล
  const [{ n: stuck }] = await q(
    `select count(*)::int n from payments where visit_id=$1 and status='pending'`, [visit.id])
  if (stuck === 0) ok('ไม่มีใบ pending ค้าง')
  else bad('ใบ pending ค้างจากการกดซ้ำ',
      `เหลือ ${stuck} ใบที่ confirm ไม่ได้ตลอดกาล — create_payment นับเฉพาะ succeeded ` +
      `ไม่นับ pending ที่จองยอดอยู่ · เงินไม่หาย แต่รายการค้างกวนการกระทบยอด`)
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── S17 เน็ตร้านล่มกลางคัน — ต้องไม่เหลือข้อมูลครึ่ง ๆ ──')
// จำลองด้วย transaction ที่ล้มกลางทาง: ออเดอร์มีรายการที่สั่งไม่ได้ปนอยู่
// ทั้งใบต้องไม่ถูกบันทึก ไม่ใช่บันทึกเฉพาะรายการที่ผ่าน
{
  const { visit } = await openTable(h.stdPkg, 2)   // มาตรฐาน = สั่งวากิวไม่ได้
  const cust = await joinAs(visit, 's17')
  await be(staffUid); await noThrottle()
  await be(cust)

  const [{ n: before }] = await q(
    `select count(*)::int n from order_items i join orders o on o.id=i.order_id where o.visit_id=$1`, [visit.id])

  const halfBad = JSON.stringify([
    { menu_item_id: pork.id,  quantity: 1 },   // สั่งได้
    { menu_item_id: wagyu.id, quantity: 1 },   // ล็อกพรีเมียม สั่งไม่ได้
  ])
  await shouldFail('ออเดอร์ที่มีรายการต้องห้ามปนอยู่', '', () =>
    q(`select * from place_order($1,$2::jsonb)`, [visit.id, halfBad]))

  const [{ n: after }] = await q(
    `select count(*)::int n from order_items i join orders o on o.id=i.order_id where o.visit_id=$1`, [visit.id])
  if (after === before) ok('ล้มแล้วไม่เหลือรายการค้าง (atomic ทั้งใบ)', `${after} รายการเท่าเดิม`)
  else bad('ความเป็น atomic ของออเดอร์', `ก่อน ${before} หลัง ${after} — มีรายการหลุดเข้าไปบางส่วน`)

  await shouldPass('ยิงใหม่เฉพาะรายการที่สั่งได้', () =>
    q(`select * from place_order($1,$2::jsonb)`, [visit.id, order1(pork.id, 1)]))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── S20 จ่ายแล้วแต่ปิดโต๊ะไม่สำเร็จ ──')
// payment ผ่าน → หน้า staff ค้าง → visit ยัง paid ไม่ closed
// ลูกค้าคนถัดไปต้องเปิดโต๊ะเดิมไม่ได้ จนกว่าจะปิดรอบและเก็บโต๊ะ
{
  const { visit, table } = await openTable()
  await be(staffUid)
  await q(`select * from request_visit_bill($1)`, [visit.id])
  const [{ due }] = await q(`select visit_amount_due($1) due`, [visit.id])
  const [p] = await q(`select * from create_payment($1,'cash',$2)`, [visit.id, due])
  await q(`select * from confirm_payment($1)`, [p.id])

  const [mid] = await q(
    `select v.status vs, t.status ts from visits v join tables t on t.id=v.table_id where v.id=$1`, [visit.id])
  ok('สถานะระหว่างค้าง', `visit=${mid.vs} · โต๊ะ=${mid.ts}`)

  await shouldFail('เปิดรอบใหม่ทับโต๊ะที่ยังไม่ปิด', '', () =>
    q(`select * from open_visit($1,$2,2,0)`, [table.id, h.stdPkg.id]))

  const [{ n: dup }] = await q(
    `select count(*)::int n from visits where table_id=$1 and status in ('open','awaiting_payment','paid')`,
    [table.id])
  if (dup === 1) ok('มีรอบที่ยังไม่ปิดของโต๊ะนี้ใบเดียว ไม่ปะปน')
  else bad('บิลเก่าปะปนรอบใหม่', `โต๊ะนี้มี ${dup} รอบที่ยังไม่ปิด`)

  // เส้นทางกู้คืนของพนักงาน
  await shouldPass('พนักงานปิดรอบย้อนหลังได้', () => q(`select * from close_visit($1)`, [visit.id]))
  await shouldPass('เก็บโต๊ะแล้วกลับมาว่าง', () => q(`select * from mark_table_clean($1)`, [table.id]))
  await shouldPass('เปิดรอบใหม่ได้หลังเก็บโต๊ะ', () =>
    q(`select * from open_visit($1,$2,2,0)`, [table.id, h.stdPkg.id]))
}

h.summary()
