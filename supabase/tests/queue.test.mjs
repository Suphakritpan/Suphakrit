/**
 * E2E สายคิว: บัตรคิว → เรียก → จัดโต๊ะ → visit → แก้จำนวนคน → ปิด → คิวถัดไป
 * ----------------------------------------------------------------------------
 * ยึดตามสายงานจริงในสเปก ไม่ใช่ตาม role
 *   ลูกค้ามาถึง → รับบัตรคิว → สแกนดูคิว → เรียก → รายงานตัว →
 *   เปิด visit + จัดโต๊ะ → ออก QR โต๊ะ → ... → ปิดโต๊ะ → คิวถัดไป
 *
 * "บัตรคิว" กับ "บิล/QR โต๊ะ" เป็นคนละสิ่ง แม้ใช้ QR เหมือนกัน
 * ไฟล์นี้ตรวจว่าสองสิ่งนี้ไม่ปนกันจริงในระดับข้อมูล
 */
import { boot } from './harness.mjs'

const h = await boot()
const { q, be, ok, bad, shouldPass, shouldFail, staffUid, stdPkg, prmPkg } = h

const issue = (party, opts = {}) =>
  q(`select * from issue_queue_ticket($1,$2,$3,$4,$5,$6)`,
    [party, opts.name ?? null, opts.phone ?? null, opts.notes ?? null,
     opts.adults ?? null, opts.children ?? 0])
const status = (token) => q(`select get_queue_status($1) s`, [token]).then((r) => r[0].s)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Q1 ลูกค้ามาถึง ไม่มีโต๊ะว่าง → ออกบัตรคิว ──')
let t1
{
  await be(staffUid)
  const [row] = await issue(3, { adults: 2, children: 1, name: 'คุณเอ' })
  t1 = row
  if (row.ticket_number > 0 && row.party_size === 3 && row.adult_count === 2 && row.child_count === 1)
    ok('ออกบัตรแยกผู้ใหญ่/เด็ก', `คิว ${row.ticket_number} · ผู้ใหญ่ 2 เด็ก 1`)
  else bad('ออกบัตรคิว', JSON.stringify(row))

  if (row.public_token && row.public_token !== row.id)
    ok('บัตรคิวมี token แยกจาก id', 'เดาเลขคิวข้างเคียงแล้วเปิดของคนอื่นไม่ได้')
  else bad('token บัตรคิว', 'ไม่มี public_token หรือใช้ค่าเดียวกับ id')

  const [row2] = await issue(2)   // ไม่ระบุผู้ใหญ่/เด็ก = ผู้ใหญ่ทั้งหมด
  if (row2.adult_count === 2 && row2.child_count === 0)
    ok('ไม่ระบุผู้ใหญ่/เด็ก ถือเป็นผู้ใหญ่ทั้งหมด (เข้ากันได้กับของเดิม)')
  else bad('ค่าเริ่มต้นผู้ใหญ่/เด็ก', JSON.stringify(row2))

  if (row2.ticket_number === row.ticket_number + 1) ok('เลขคิวรันต่อเนื่อง', `${row.ticket_number} → ${row2.ticket_number}`)
  else bad('เลขคิว', `${row.ticket_number} แล้ว ${row2.ticket_number}`)

  await shouldFail('ออกบัตร 0 คน', 'อย่างน้อย 1 ท่าน', () => issue(0, { adults: 0, children: 0 }))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Q2 ลูกค้าสแกน QR บัตรคิว (ไม่ล็อกอิน) ──')
{
  await be(null)   // คนยืนรอหน้าร้าน ไม่มี session ใด ๆ
  const s = await status(t1.public_token)
  if (s.ticket_number === t1.ticket_number && typeof s.ahead === 'number')
    ok('เปิดดูได้โดยไม่ต้องล็อกอิน', `คิว ${s.ticket_number} · เหลืออีก ${s.ahead} คิว`)
  else bad('สแกนบัตรคิว', JSON.stringify(s))

  if (typeof s.tables_available === 'number' && typeof s.tables_cleaning === 'number')
    ok('เห็นสถานะโต๊ะระหว่างรอ', `ว่าง ${s.tables_available} · รอเก็บ ${s.tables_cleaning}`)
  else bad('สถานะโต๊ะบนหน้าคิว', JSON.stringify(s))

  if (!('customer_name' in s) && !('phone' in s))
    ok('ไม่คืนชื่อ/เบอร์โทร', 'บัตรคิวถูกถ่ายรูปส่งต่อได้ ไม่ควรเปิด PII ซ้ำ')
  else bad('PII บนหน้าคิว', 'คืนชื่อหรือเบอร์โทรออกมาด้วย')

  await shouldFail('token มั่ว', '', () => status('00000000-0000-0000-0000-000000000000'))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Q3 คิวใกล้ถึง → เรียกคิว ──')
{
  await be(null)
  const before = await status(t1.public_token)
  if (before.near_turn === true) ok('เหลือ ≤3 คิว ขึ้นสัญญาณใกล้ถึงคิว', `เหลือ ${before.ahead}`)
  else bad('สัญญาณใกล้ถึงคิว', `ahead=${before.ahead} near_turn=${before.near_turn}`)

  await be(staffUid)
  await shouldPass('พนักงานเรียกคิว', () => q(`select * from call_queue_ticket($1)`, [t1.id]))

  await be(null)
  const after = await status(t1.public_token)
  if (after.status === 'called' && after.now_serving === t1.ticket_number)
    ok('ลูกค้าเห็นว่าถึงคิวตัวเองแล้ว', `กำลังเรียก ${after.now_serving}`)
  else bad('สถานะหลังเรียกคิว', JSON.stringify(after))

  await be(staffUid)
  await shouldFail('เรียกคิวเดิมซ้ำ', '', () => q(`select * from call_queue_ticket($1)`, [t1.id]))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Q4 เรียกแล้วลูกค้าไม่มา → ต้องรอครบเวลาผ่อนผันก่อนตัดคิว ──')
{
  await be(staffUid)
  const [nx] = await issue(2)
  await q(`select * from call_queue_ticket($1)`, [nx.id])

  await shouldFail('กดตัดไม่มาตามเรียกทันที', 'ยังไม่ครบเวลารอ', () =>
    q(`select * from cancel_queue_ticket($1, true)`, [nx.id]))

  // รอครบเวลาผ่อนผัน (เลื่อน called_at ย้อนหลังแทนการรอจริง)
  await q(`update queue_tickets set called_at = called_at - interval '10 minutes' where id=$1`, [nx.id])
  await shouldPass('พ้นเวลาผ่อนผันแล้วตัดได้', () =>
    q(`select * from cancel_queue_ticket($1, true)`, [nx.id]))

  const [row] = await q(`select status from queue_tickets where id=$1`, [nx.id])
  if (row.status === 'no_show') ok('สถานะเป็น no_show ไม่ใช่ลบทิ้ง', 'Realtime ส่ง DELETE โดยไม่กรอง RLS')
  else bad('สถานะหลังตัดคิว', row.status)

  const [q2] = await issue(2)
  await shouldFail('ตัด no-show คิวที่ยังไม่ได้เรียก', 'เฉพาะคิวที่เรียกแล้ว', () =>
    q(`select * from cancel_queue_ticket($1, true)`, [q2.id]))
  await shouldPass('ยกเลิกคิวที่ยังไม่ได้เรียก (ลูกค้าเปลี่ยนใจ)', () =>
    q(`select * from cancel_queue_ticket($1, false)`, [q2.id]))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Q5 โต๊ะยัง cleaning ห้าม assign ──')
{
  await be(staffUid)
  const [t] = await q(`select * from tables where status='available' order by table_number limit 1`)
  await q(`update tables set status='cleaning' where id=$1`, [t.id])

  await shouldFail('เปิดโต๊ะที่ยังทำความสะอาดไม่เสร็จ', 'ยังไม่ว่าง', () =>
    q(`select * from open_visit($1,$2,2,0)`, [t.id, stdPkg.id]))

  await shouldPass('เก็บโต๊ะเสร็จแล้วเปิดได้', async () => {
    await q(`select * from mark_table_clean($1)`, [t.id])
    return q(`select * from open_visit($1,$2,2,0)`, [t.id, stdPkg.id])
  })
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Q6 จัดโต๊ะให้คิว → ผูก queue + visit + table เข้าด้วยกัน ──')
let seated
let grown
{
  await be(staffUid)
  const [tk] = await issue(4, { adults: 3, children: 1, name: 'คุณบี' })
  await q(`select * from call_queue_ticket($1)`, [tk.id])

  const [tbl] = await q(
    `select * from tables where status='available' and capacity >= $1 order by capacity, table_number limit 1`,
    [tk.party_size])
  if (tbl) ok('เลือกโต๊ะที่รองรับจำนวนคนได้', `คิว ${tk.ticket_number} ${tk.party_size} คน → โต๊ะ ${tbl.table_number} (${tbl.capacity} ที่นั่ง)`)
  else bad('หาโต๊ะที่เหมาะสม', 'ไม่มีโต๊ะที่จุพอ')

  const [v] = await q(`select * from open_visit($1,$2,$3,$4,'[]'::jsonb,$5)`,
    [tbl.id, prmPkg.id, tk.adult_count, tk.child_count, tk.id])
  seated = { ticket: tk, visit: v, table: tbl }

  const [after] = await q(`select status, visit_id from queue_tickets where id=$1`, [tk.id])
  if (after.status === 'seated' && after.visit_id === v.id)
    ok('บัตรคิวถูกผูกกับ visit และปิดสถานะเอง', `queue=${after.status}`)
  else bad('ผูกคิวกับ visit', JSON.stringify(after))

  if (v.adult_count === 3 && v.child_count === 1)
    ok('จำนวนผู้ใหญ่/เด็กไหลจากบัตรคิวเข้า visit', 'ไม่ต้องถามลูกค้าซ้ำ')
  else bad('จำนวนคนใน visit', `${v.adult_count}/${v.child_count}`)

  if (v.session_token && v.session_token !== seated.ticket.public_token)
    ok('QR โต๊ะเป็นคนละ token กับ QR บัตรคิว', 'บัตรคิวกับบิลเป็นคนละสิ่งจริง')
  else bad('แยก token', 'QR โต๊ะกับบัตรคิวใช้ token เดียวกัน')

  await be(null)
  const s = await status(tk.public_token)
  if (s.status === 'seated') ok('หน้าคิวของลูกค้าขึ้นว่าเข้าโต๊ะแล้ว')
  else bad('หน้าคิวหลังจัดโต๊ะ', s.status)
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Q7 เพื่อนมาเพิ่มระหว่างมื้อ → แก้จำนวนคนโดยไม่ทำลายออเดอร์ ──')
// ใช้โต๊ะใหญ่ของตัวเอง ไม่ยืมโต๊ะของ Q6 (4 ที่นั่ง จุ 4 คนพอดี เพิ่มคนไม่ได้)
{
  await be(staffUid)
  const [bigTable] = await q(
    `select * from tables where status='available' and capacity >= 6 order by table_number limit 1`)
  const [bigVisit] = await q(`select * from open_visit($1,$2,3,1)`, [bigTable.id, prmPkg.id])
  const visit = bigVisit, table = bigTable
  grown = { visit, table }
  await q(`update restaurant_settings set min_seconds_between_orders = 0`)

  const [refillRow] = await q(`select * from add_ons where code='drink_refill'`)
  await q(`insert into visit_addons (visit_id, add_on_id, name_snapshot, unit_price_satang, charge_basis, quantity)
           values ($1,$2,$3,$4,'per_person',$5)`,
          [visit.id, refillRow.id, refillRow.name, refillRow.price_satang, 4])

  const [pork] = await q(`select * from menu_items where name_th='หมูสามชั้น'`)
  await q(`select * from place_order($1,$2::jsonb)`,
          [visit.id, JSON.stringify([{ menu_item_id: pork.id, quantity: 2 }])])
  const [{ n: ordersBefore }] = await q(`select count(*)::int n from orders where visit_id=$1`, [visit.id])

  const [adjusted] = await q(`select * from adjust_visit_guests($1,$2,$3)`, [visit.id, 4, 1])
  if (adjusted.adult_count === 4 && adjusted.child_count === 1)
    ok('แก้จำนวนคนได้', `ผู้ใหญ่ 3→4 · เด็ก 1 · รวม 5 ท่าน`)
  else bad('แก้จำนวนคน', JSON.stringify(adjusted))

  const [addon] = await q(`select quantity from visit_addons where visit_id=$1 and charge_basis='per_person'`, [visit.id])
  if (addon.quantity === 5) ok('add-on คิดตามหัวขยับตามจำนวนคนใหม่', `4 → ${addon.quantity}`)
  else bad('add-on ต่อหัว', `ได้ ${addon.quantity} คาด 5`)

  const [{ n: ordersAfter }] = await q(`select count(*)::int n from orders where visit_id=$1`, [visit.id])
  if (ordersAfter === ordersBefore) ok('ออเดอร์เดิมไม่ถูกแตะ', `${ordersAfter} ใบเท่าเดิม`)
  else bad('ออเดอร์หลังแก้จำนวนคน', `ก่อน ${ordersBefore} หลัง ${ordersAfter}`)

  // เช็คเพดานความจุก่อนขอบิล — ต้องยังเป็น open อยู่ถึงจะทดสอบกฎนี้ได้
  await shouldFail('เพิ่มคนเกินความจุโต๊ะ', 'เกินความจุโต๊ะ', () =>
    q(`select * from adjust_visit_guests($1,$2,0)`, [visit.id, table.capacity + 5]))

  const [b] = await q(`select * from request_visit_bill($1)`, [visit.id])
  const expectBuffet = 4 * visit.package_price_adult_satang + 1 * visit.package_price_child_satang
  const [line] = await q(
    `select coalesce(sum(amount_satang),0)::int amt from bill_lines
      where visit_id=$1 and kind in ('buffet_adult','buffet_child')`, [visit.id])
  if (line.amt === expectBuffet)
    ok('บิลคิดตามจำนวนคนใหม่ ราคายังเป็น snapshot ตอนเปิดโต๊ะ', `${expectBuffet / 100}฿`)
  else bad('ยอดบุฟเฟต์หลังแก้จำนวนคน', `ได้ ${line.amt} คาด ${expectBuffet}`)

  // ขอบิลแล้วห้ามแก้จำนวนคนอีก ไม่งั้นยอดที่พิมพ์ให้ลูกค้าดูจะไม่ตรงกับที่เก็บจริง
  await shouldFail('แก้จำนวนคนหลังขอบิลแล้ว', 'เฉพาะรอบที่ยังเปิดอยู่', () =>
    q(`select * from adjust_visit_guests($1,3,1)`, [visit.id]))

  void b
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n── Q8 กดรับชำระซ้ำ ต้องไม่เหลือใบ pending ค้าง ──')
{
  const { visit, table } = grown
  await be(staffUid)
  const [{ due }] = await q(`select visit_amount_due($1) due`, [visit.id])

  const [p1] = await q(`select * from create_payment($1,'cash',$2)`, [visit.id, due])
  await shouldFail('กดสร้างรายการชำระซ้ำเต็มยอด', 'มีรายการชำระค้างอยู่แล้ว', () =>
    q(`select * from create_payment($1,'cash',$2)`, [visit.id, due]))

  const [{ n: stuck }] = await q(
    `select count(*)::int n from payments where visit_id=$1 and status='pending'`, [visit.id])
  if (stuck === 1) ok('มีใบรอยืนยันใบเดียว ไม่มีใบค้างซ้อน')
  else bad('ใบ pending', `มี ${stuck} ใบ`)

  await shouldPass('ยกเลิกใบค้างแล้วสร้างใหม่ได้', async () => {
    await q(`select * from cancel_payment($1,'พนักงานกดผิด')`, [p1.id])
    return q(`select * from create_payment($1,'cash',$2)`, [visit.id, due])
  })

  const [p2] = await q(
    `select * from payments where visit_id=$1 and status='pending' order by created_at desc limit 1`, [visit.id])
  await q(`select * from confirm_payment($1)`, [p2.id])

  const [{ total }] = await q(
    `select coalesce(sum(amount_satang),0)::int total from payments where visit_id=$1 and status='succeeded'`,
    [visit.id])
  if (total === due) ok('เก็บเงินได้เท่ากับบิลพอดี', `${total / 100}฿`)
  else bad('ยอดที่เก็บได้', `${total} จากบิล ${due}`)

  await shouldPass('ปิดรอบ', () => q(`select * from close_visit($1)`, [visit.id]))
  const [t] = await q(`select status from tables where id=$1`, [table.id])
  if (t.status === 'cleaning') ok('โต๊ะเข้าคิวทำความสะอาด ไม่ว่างทันที', 'กันคิวถัดไปถูก assign โต๊ะที่ยังไม่ได้เก็บ')
  else bad('สถานะโต๊ะหลังปิดรอบ', t.status)
}

h.summary()
