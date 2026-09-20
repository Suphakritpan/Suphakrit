# Shabu Mood — เอกสารสรุปเตรียมนำเสนอ

> **เขียนให้ใคร:** ตัวผู้นำเสนอเอง ใช้ทำสไลด์ ซ้อมพูด และเตรียมตอบคำถาม
> **วิชา:** 31900-1002 การจัดการฐานข้อมูลขนาดใหญ่
> **รูปแบบ:** นำเสนอคนเดียว 5 นาที
> **วันที่ตรวจสอบโปรเจกต์:** 2026-09-20 (ตรวจซ้ำรอบที่สองหลังมี 10 commit ใหม่) — ตัวเลขทุกตัวในเอกสารนี้วัดสดจาก source code และจากการรันเทสต์ในวันนั้น

---

## 1. ตัวเลขที่วัดได้จริง (ใช้อ้างอิงบนสไลด์ได้)

### ฐานข้อมูล

วัดจากการรัน `node supabase/tests/migrate.test.mjs` ซึ่ง migrate ทุกไฟล์ลง PGlite แล้วนับของจริงที่เหลืออยู่ท้ายสุด

| สิ่งที่วัด | จำนวน | หมายเหตุ |
|---|---|---|
| ไฟล์ migration | 22 (`0001`–`0022`) + `seed.sql` | ผ่านเรียงลำดับครบ |
| ตาราง | **28** | |
| ฟังก์ชัน / stored procedure | **42** | |
| RLS policy | **54** | บน schema `public` ไฟล์ทั้งหมดมีคำสั่ง `CREATE POLICY` 71 ครั้ง แต่บางตัวถูกเขียนทับภายหลัง และอีก 4 ตัวอยู่บน `storage.objects` ซึ่งไม่ถูกนับรวม |
| ENUM type | 17 | |
| Index | 37 | รวม unique index 4 ตัว และ partial index |
| Trigger | 26 | |
| `CHECK` constraint | 92 จุด | |
| Foreign key | 57 จุด | |

> ⚠️ **เอกสารเก่าตัวเลขไม่ตรง** — `docs/product-plan.md` บรรทัด 5 เขียนว่า "RLS 54 policy และ 32 ฟังก์ชัน" จำนวนฟังก์ชันของจริงคือ **42** ห้ามลอกตัวเลข 32 ไปใส่สไลด์

### ข้อมูล seed

เมนู 64 รายการ · เมนูที่ล็อกเฉพาะแพ็กเกจพรีเมียม 5 รายการ · โต๊ะ 12 โต๊ะ

แพ็กเกจ: มาตรฐาน 299 บาท/90 นาที · พรีเมียม 399 บาท/120 นาที

Add-on: น้ำรีฟิลไม่อั้น 39 บาท (คิดต่อหัว)

### เทสต์ — รันสดวันที่ตรวจ ผ่านหมด ไม่มีเคสล้ม

| ชุด | ผ่าน | ไม่ผ่าน |
|---|---|---|
| `rules.test.mjs` | 68 | 0 |
| `queue.test.mjs` | 37 | 0 |
| `scenarios.test.mjs` | 29 | 0 |
| `migrate.test.mjs` | ผ่านครบ 23 ไฟล์ | 0 |
| **รวม** | **134** | **0** |

**ยังไม่ได้ตรวจรอบนี้ — ห้ามอ้างว่าผ่าน**

- `concurrency.test.mjs` ต้องมี `DATABASE_URL` ชี้ Postgres จริง
- E2E Playwright 9 สเปก ต้องมี `E2E_STAFF_PASSWORD` และยิงเข้า Supabase จริง

### โค้ดและ Git

- หน้าจอทั้งหมด **27 หน้า** — สาธารณะ/ร่วม 6 · ลูกค้า 4 · พนักงาน 5 · ผู้จัดการ 12 (ใน `App.jsx` มี `<Route>` 31 ตัว หักออก layout 3 ตัว redirect 1 ตัว catch-all 1 ตัว เหลือ 26 หน้าที่มี path แล้วบวกหน้า Login ที่ `ConsoleLayout` เรียกเองโดยไม่มี path)
- Git: 35 commit, branch ปัจจุบัน `feat/queue-ticket-and-qr-ordering`
- ทุกอย่าง commit และ merge เข้า `main` เรียบร้อยแล้ว

---

## 2. ตัวโปรเจกต์

**Shabu Mood** — ระบบ POS + QR Self-Ordering สำหรับร้านชาบู/หมูกระทะบุฟเฟต์

- **โจทย์:** ร้านสมมติ อ้างอิงรูปแบบธุรกิจจากสุกี้ตี๋น้อย
- **แรงจูงใจตั้งต้น:** อยากสร้างระบบจัดคิวหน้าร้าน
- **จุดที่ทำให้ฐานข้อมูลต่างจากร้านทั่วไป:** บุฟเฟต์คิดเงิน **ต่อหัว × แพ็กเกจ** ไม่ใช่ต่อจาน ทำให้ `order_items` ไม่ถือราคา และยอดบิลต้องคำนวณจาก `visits` + `buffet_packages` + `visit_addons` แทน
- **ทีม:** คนเดียว ทำทุกส่วนเอง ตั้งแต่ออกแบบ schema, เขียน migration + RPC, frontend ทั้งสามฝั่ง, เทสต์, เอกสาร — ตรงกับ git ที่มี author คนเดียว
- **สภาพปัจจุบัน:** รันบนเครื่อง local ยังไม่ deploy ขึ้น public · ข้อมูลเป็น seed ล้วน ยังไม่เคยมีผู้ใช้จริง · ใช้ Supabase project เดียว ยังไม่มีแผนสำรองตอน demo

---

## 3. สถาปัตยกรรม

**ไม่มี backend server แยก** เบราว์เซอร์คุยกับ Supabase ตรง

```
React 19 (Vite 6)
   |
   |-- อ่านข้อมูล   --> PostgREST (select ธรรมดา)
   |-- เขียนข้อมูล  --> RPC 21 ตัว (stored procedure)
   |-- ข้อมูลสด     --> Supabase Realtime
   |
PostgreSQL (Supabase) : ตรรกะธุรกิจทั้งหมดอยู่ที่นี่
   42 function | 26 trigger | 54 RLS policy | 92 CHECK
```

**เทคโนโลยี**

- Frontend: React 19, Vite 6, react-router-dom 7, Redux Toolkit 2, `@supabase/supabase-js` 2, `qrcode`
- Backend/DB: Supabase — PostgreSQL + PostgREST + Auth + Realtime
- เทสต์: PGlite (PostgreSQL ในหน่วยความจำ) สำหรับเทสต์ฐานข้อมูล, Playwright สำหรับ E2E
- ไม่ใช้ ORM ไม่ใช้ Express/Nest

**RPC ที่ frontend เรียกจริง 21 ตัว**

`issue_queue_ticket` `call_queue_ticket` `cancel_queue_ticket` `get_queue_status` `open_visit` `join_visit` `join_visit_with_code` `adjust_visit_guests` `place_order` `advance_order_item` `set_menu_item_availability` `apply_promotion_code` `remove_visit_promotion` `request_visit_bill` `visit_amount_due` `create_payment` `confirm_payment` `cancel_payment` `close_visit` `mark_table_clean` `void_visit`

---

## 4. ผู้ใช้งานและสิทธิ์

**ENUM `staff_role` มี 5 ค่า:** `owner` `manager` `staff` `kitchen` `cashier`

**แต่โค้ดบังคับจริงแค่ 2 ชั้น — ต้องพูดตามจริง**

| helper | ใคร | ทำอะไรได้ |
|---|---|---|
| `is_staff()` | พนักงานที่ยัง active ทุกคน | เปิดโต๊ะ, สั่งแทน, เดินสถานะครัว, เก็บเงิน, ปิดโต๊ะ, จัดคิว |
| `is_manager()` | `owner` + `manager` | แก้ `restaurant_settings` ได้กลุ่มเดียว |

`kitchen` และ `cashier` มีใน ENUM แต่ยังไม่ถูกแยกสิทธิ์จริงในโค้ด — ถ้าถูกถามให้ตอบว่า v1 บังคับ 2 ระดับ ออกแบบ ENUM รองรับไว้แล้ว เพิ่มทีหลังแก้ที่ helper จุดเดียว

**ลูกค้าไม่ต้องสมัครสมาชิก** ระบบรู้ว่าใครนั่งโต๊ะไหนด้วย token 2 ชั้น

1. โต๊ะมี `tables.qr_token` (unique index) ติดถาวร
2. สแกนแล้วเรียก `join_visit` ระบบออก `visits.session_token` แล้วลงทะเบียนเครื่องใน `visit_devices`
3. ตอนสั่ง `place_order` ตรวจว่าเครื่องนี้ผูกกับ visit นี้จริง ไม่ผูกจะถูกปฏิเสธด้วยข้อความ `ไม่มีสิทธิ์สั่งอาหารเข้าโต๊ะนี้`
4. ปิดโต๊ะ ระบบสั่ง `update visit_devices set revoked_at = now()` ลูกค้ารอบเก่าสั่งต่อไม่ได้แม้เก็บ QR ไว้
5. ตาราง `visit_access_attempts` + migration `0017_qr_code_attempts` กันเดารหัสเข้าโต๊ะ

---

## 5. ตาราง 28 ตาราง จัดกลุ่ม

| กลุ่ม | ตาราง |
|---|---|
| ตั้งค่าร้าน | `branches` `restaurant_settings` `profiles` `kitchen_stations` `daily_counters` `audit_logs` |
| เมนูและราคา | `buffet_packages` `add_ons` `menu_categories` `menu_items` `menu_item_packages` |
| พื้นที่และคิว | `zones` `tables` `queue_tickets` |
| รอบการใช้บริการ | `customers` `visits` `visit_addons` `visit_devices` `visit_access_attempts` |
| ออเดอร์ | `orders` `order_items` `order_status_history` `service_requests` |
| เงิน | `promotions` `visit_promotions` `bill_lines` `payments` `loyalty_transactions` |

**แกนกลางที่ต้องอธิบายให้ได้**

```
queue_tickets ──┐
tables ─────────┤
buffet_packages ┴──> visits ──> orders ──> order_items
                       │
                       ├──> visit_addons
                       ├──> visit_promotions
                       ├──> bill_lines
                       └──> payments
```

---

## 6. การไหลของข้อมูล ตั้งแต่ลูกค้าเข้าร้านจนปิดโต๊ะ

| ขั้นตอน | RPC | สิ่งที่เกิดในฐานข้อมูล |
|---|---|---|
| ออกบัตรคิว | `issue_queue_ticket` | `next_counter()` แจกเลขคิวแบบ atomic ด้วย `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` เลขไม่ซ้ำแม้กดพร้อมกัน รีเซ็ตรายวันด้วย `counter_date` |
| เรียกคิว | `call_queue_ticket` | `UPDATE ... WHERE status='waiting'` พนักงาน 2 คนกดพร้อมกันสำเร็จได้คนเดียว อีกคนได้ error |
| ลูกค้าไม่มา | `no_show` | ต้องรอครบเวลาผ่อนผัน 5 นาทีนับจากที่เรียก ถึงจะตัดคิวได้ บังคับที่ฐานข้อมูล |
| จัดโต๊ะ + เปิดรอบ | `open_visit` | ล็อกแถวโต๊ะด้วย `FOR UPDATE` ตรวจว่า `available` แล้ว **copy ราคาแพ็กเกจลง `visits` เป็น snapshot** โต๊ะเป็น `occupied` บัตรคิวเป็น `seated` |
| สแกน QR | `join_visit` | ออก session token ลงทะเบียนเครื่องใน `visit_devices` |
| สั่งอาหาร | `place_order` | ล็อก visit ตรวจสิทธิ์เครื่อง ตรวจหมดเวลาบุฟเฟต์ กันสั่งถี่ กันออเดอร์ค้างเกินเพดาน กันสั่งเกินจำนวนสูงสุดต่อเมนู |
| ครัวทำ / เสิร์ฟ | `advance_order_item` | สถานะอยู่ที่ **รายจาน** ไม่ใช่ทั้งใบ เพราะครัวคนละสถานีเสร็จไม่พร้อมกัน trigger `rollup_order_status` คำนวณสถานะใบแม่ให้เอง trigger `record_order_item_history` บันทึกลง `order_status_history` |
| เรียกเช็คบิล | `request_visit_bill` | visit เป็น `awaiting_payment` ล็อกยอด หยุดสั่งเพิ่ม แล้วเรียก `recalculate_visit_totals` |
| ชำระเงิน | `create_payment` → `confirm_payment` | ล็อกแถว payment ด้วย `FOR UPDATE` trigger `enforce_payment_not_exceeding_total` กันจ่ายเกิน `trg_payment_reserve_guard` กันสร้างใบค้างซ้อน ครบยอดแล้ว visit เป็น `paid` |
| ปิดรอบ | `close_visit` | แก้ 5 ตารางใน transaction เดียว โต๊ะไป `cleaning` ไม่ใช่ `available` |
| เก็บโต๊ะเสร็จ | `mark_table_clean` | `cleaning` → `available` |

---

## 7. จุดออกแบบที่เป็นคำตอบของ "ทำไมออกแบบแบบนี้"

ทั้งสามข้อมาจาก use case จริงที่ทำให้ schema ต้องเปลี่ยน ใช้แทนคำตอบลอย ๆ ว่า "ออกแบบตาม use case"

1. **โต๊ะว่างทันทีไม่ได้** จึงต้องมีสถานะ `cleaning` คั่นใน `table_status` ไม่งั้นคิวถัดไปถูกจัดลงโต๊ะที่ยังไม่ได้เก็บ
2. **จ่ายเงินแล้วยังไม่จบ** `paid` กับ `closed` จึงเป็นคนละสถานะใน `visit_status` ลูกค้าจ่ายแล้วยังนั่งต่อได้
3. **ราคาขึ้นทีหลังห้ามย้อนกระทบบิลเก่า** จึง snapshot ราคาแพ็กเกจลง `visits` ตอนเปิดโต๊ะ ไม่ JOIN ราคาสดตอนคิดเงิน

**หลักที่ยึดทั้งฐานข้อมูล** เขียนไว้หัวไฟล์ `supabase/migrations/0001_extensions_enums.sql` บรรทัด 5–10

1. เงินเก็บเป็นสตางค์ integer เสมอ คอลัมน์ลงท้าย `_satang` ห้ามใช้ float
2. ราคาและอัตราทุกตัวมาจากตารางตั้งค่า ไม่ hardcode ในโค้ด
3. กฎธุรกิจบังคับที่ชั้นฐานข้อมูลด้วย constraint + trigger + RPC ไม่ใช่แค่ใน UI
4. เวลาใช้ `timestamptz` เสมอ แสดงผลตาม timezone ใน `restaurant_settings`

---

## 8. Query ที่ซับซ้อนที่สุด — ใช้เป็นสไลด์หลัก

อยู่ในฟังก์ชัน `recalculate_visit_totals` ไฟล์ `supabase/migrations/0008_functions_rpc.sql`

รวบรายการ a la carte ของรอบนั้นให้เป็นบรรทัดบิล มีทั้ง JOIN, GROUP BY และ aggregate สองแบบ

```sql
select oi.name_snapshot,
       sum(oi.quantity)            as qty,
       max(oi.unit_price_satang)   as price,
       sum(oi.line_total_satang)   as total
from order_items oi
join orders o on o.id = oi.order_id
where o.visit_id = p_visit_id
  and not oi.is_buffet_included
  and oi.status <> 'cancelled'
group by oi.name_snapshot
```

**ลำดับการคิดเงินทั้งหมดในฟังก์ชันเดียว**

1. ล็อกแถว visit ด้วย `FOR UPDATE`
2. ลบ `bill_lines` เดิมทิ้ง แล้วสร้างใหม่ทั้งชุด
3. ค่าบุฟเฟต์ = `adult_count × package_price_adult_satang + child_count × package_price_child_satang` โดยราคามาจาก snapshot ไม่ใช่ราคาสด
4. บวก add-on จาก `visit_addons`
5. บวก a la carte จาก query ข้างบน
6. ลบส่วนลดจาก `visit_promotions` โดยจำกัดไม่ให้ลดเกินยอดรวมด้วย `least(v_discount, v_subtotal)`
7. บวก service charge และ VAT ตามอัตราใน `restaurant_settings` คำนวณด้วย basis point แล้ว `round()` กลับเป็น integer

---

## 9. Concurrency และ Data Integrity

**การล็อกแถว** ใช้ `SELECT ... FOR UPDATE` 17 จุด ล็อกแถว `visits` `tables` `payments` `order_items` ก่อนแก้ทุกครั้ง

**Trigger บังคับกฎ**

- `enforce_visit_status_transition` กันเปลี่ยนสถานะรอบข้ามขั้น
- `enforce_table_status_transition` กันเปลี่ยนสถานะโต๊ะข้ามขั้น
- `enforce_payment_not_exceeding_total` กันเก็บเงินเกินยอดบิล
- `trg_payment_reserve_guard` กันสร้างใบรอชำระซ้อนกัน
- `rollup_order_status` คำนวณสถานะออเดอร์ใบแม่จากรายจาน
- `record_order_item_history` บันทึกทุกการเปลี่ยนสถานะลง `order_status_history`

**เลขที่ไม่มีทางซ้ำ** `next_counter()` ใช้ `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` แถวเดียวจบ ใช้ทั้งเลขคิวและรหัส visit

**Transaction** `close_visit` แก้ 5 ตารางในครั้งเดียว — เปลี่ยนสถานะ visit, ส่งโต๊ะไป cleaning, ยกเลิก token ลูกค้า, ปิด service request ที่ค้าง, บวกแต้มสมาชิก ถ้าพังกลางทางจะไม่เกิดอะไรขึ้นเลย

**Audit** ทุก RPC สำคัญเรียก `log_audit()` เขียนลง `audit_logs` เก็บค่าก่อนและหลังเป็น `jsonb`

---

## 10. การรองรับข้อมูลจำนวนมาก

**Index 37 ตัว** ออกแบบตาม query ที่ใช้จริง ไม่ได้ใส่มั่ว เช่น

- `idx_order_items_station on order_items(station_id, status, created_at)` สำหรับจอครัวที่กรองตามสถานีและสถานะ
- `idx_queue_tickets_waiting on queue_tickets(branch_id, ticket_date, ticket_number)` สำหรับเรียงคิวรายวัน
- `idx_tables_status on tables(branch_id, status)` สำหรับหาโต๊ะว่าง
- `idx_profiles_branch_active on profiles(branch_id) where is_active` — partial index เก็บเฉพาะพนักงานที่ยังทำงาน
- unique index 4 ตัว: `tables(qr_token)`, `visits(session_token)`, `payments(provider, provider_ref)` และบน `daily_counters`

**บั๊กจริงที่เจอเพราะข้อมูลเยอะ — ใช้เป็นคำตอบของ "ขนาดใหญ่ตรงไหน"**

PostgREST ตัดผลลัพธ์ที่ 1,000 แถวโดยไม่แจ้ง error โค้ดเดิมดึง `order_items` ทั้งตารางแล้วมากรองฝั่งเบราว์เซอร์ ทั้งจอครัวและหน้าตรวจบิล พอร้านสั่งครบหนึ่งพันรายการ ออเดอร์ที่เพิ่งสั่งจะหายจากจอเงียบ ๆ

เทสต์ `e2e/specs/scale.spec.js` ถมข้อมูล 1,200 แถว (40 ออเดอร์ × 30 รายการ) ให้ทะลุเพดานก่อน แล้วเปิดโต๊ะจริงสั่งหนึ่งรอบ ของที่เพิ่งสั่งต้องขึ้นทั้งบนจอครัวและในหน้าผู้จัดการ เทสต์นี้ต้องล้มกับโค้ดเก่าด้วย ไม่งั้นแปลว่าไม่ได้วัดอะไรเลย วิธีแก้คือย้ายการกรองลงไปทำที่ฐานข้อมูลแทนที่จะดึงมากรองในเบราว์เซอร์

ระหว่างเขียนเทสต์ยังเจออีกเรื่อง — `order_items` มี trigger AFTER INSERT สองตัวที่ทำงานทีละแถว ถ้ายัด 400 แถวใส่ออเดอร์ใบเดียวจะกลายเป็นอัปเดตแถวแม่ซ้ำ 400 ครั้งติดกันแล้วชน statement timeout จึงต้องกระจายลงหลายออเดอร์

---

## 11. โครงพูด 5 นาที

| เวลา | หัวข้อ | สาระ |
|---|---|---|
| 0:00–0:30 | เปิด | ระบบ POS + QR ordering ร้านชาบูบุฟเฟต์ ทำคนเดียว ครอบทุกหัวข้อในวิชา — schema, API, connect DB, frontend |
| 0:30–1:15 | โจทย์ที่ทำให้ฐานข้อมูลต่าง | บุฟเฟต์คิดต่อหัว ไม่ใช่ต่อจาน `order_items` จึงไม่ถือราคา ยอดบิลต้องประกอบจาก 3 ตาราง |
| 1:15–2:15 | โครงฐานข้อมูล | ER ภาพรวม 1 แผ่น แล้วซูมแกน `queue_tickets → visits → orders → order_items → bill_lines → payments` อีก 1 แผ่น |
| 2:15–3:15 | Query และความถูกต้อง | โชว์ query JOIN + GROUP BY ของ `recalculate_visit_totals` แล้วต่อด้วย snapshot ราคา, `FOR UPDATE`, trigger กันจ่ายเกิน, transaction ตอนปิดโต๊ะ |
| 3:15–4:30 | Demo | ออกคิว → เรียกคิว → เปิดโต๊ะ → สแกนสั่ง → เช็คบิล รวดเดียว ไม่แตะหน้าแอดมิน |
| 4:30–5:00 | ปิด | 28 ตาราง 42 ฟังก์ชัน 54 policy เทสต์ 134 เคสผ่านหมด แล้วบอกข้อจำกัดตามจริง |

**กฎเหล็ก** 5 นาทีไล่ตารางทีละตัวไม่ได้ จะหมดเวลาที่ตารางที่ 9 เลือกเล่าแกนเดียวแล้วใช้ตารางอื่นเป็นฉากหลัง

---

## 12. คำตอบที่เตรียมไว้แล้ว

### "ทำไมเลือก PostgreSQL / Supabase"

ระบบร้านอาหารมีข้อมูลที่ห้ามผิดเด็ดขาดคือเรื่องเงิน จึงต้องการฐานข้อมูลที่บังคับความถูกต้องได้ที่ตัวมันเอง ไม่ฝากไว้กับโค้ดหน้าเว็บ

เทียบกับที่เรียนมา — MongoDB ไม่มี schema บังคับและไม่มี foreign key อาจมีออเดอร์ที่ชี้ไปโต๊ะที่ไม่มีอยู่จริง · SQLite เขียนพร้อมกันหลายคนไม่ได้เพราะล็อกทั้งไฟล์ ซึ่งร้านชาบูมีพนักงานกดพร้อมกันตลอด · MySQL ใช้ได้ แต่ PostgreSQL ให้สามอย่างที่ใช้จริงและ MySQL ทำได้ไม่ดีเท่า คือ ENUM แบบ type จริง, `jsonb` สำหรับ audit log และ Row Level Security

ส่วน Supabase เลือกเพราะเป็น PostgreSQL ตัวจริง ไม่ใช่ของเลียนแบบ แล้วแถม REST API, ระบบล็อกอิน และ Realtime มาให้ ทำให้ทำคนเดียวได้ทันเวลา

### "ทำไมไม่เขียน backend เอง"

จุดที่ข้อมูลจะพังคือจุดที่มีทางเข้าหลายทาง ระบบนี้มีคนเข้าถึงข้อมูลเดียวกัน 4 ทาง — ลูกค้าสแกน QR, พนักงานหน้าร้าน, จอครัว, หน้าผู้จัดการ ถ้าเขียนกฎ "ห้ามเก็บเงินเกินยอดบิล" ไว้ที่ backend ต้องเขียนซ้ำทุกทางเข้า ลืมทางใดทางหนึ่งเงินก็ผิด

พอย้ายกฎลงไปอยู่ในฐานข้อมูล กฎมีที่เดียว ทุกทางเข้าถูกบังคับเหมือนกันหมดโดยอัตโนมัติ ต่อไปมีแอปมือถือเพิ่มก็ไม่ต้องเขียนกฎใหม่

และได้ของแถมสำคัญคือ transaction ตอนปิดโต๊ะต้องแก้ 5 ตารางพร้อมกัน ถ้าแยกเป็น API 5 ตัวแล้วพังกลางทาง ข้อมูลจะค้างครึ่ง ๆ กลาง ๆ แต่พออยู่ในฟังก์ชันเดียว PostgreSQL รับประกันว่าสำเร็จทั้งหมดหรือไม่เกิดอะไรขึ้นเลย

### "RLS คืออะไร"

เป็นการเขียนกฎสิทธิ์ติดไว้กับตาราง ต่อให้มีคนแอบยิง API ตรงโดยไม่ผ่านหน้าเว็บ ฐานข้อมูลก็ยังกรองแถวให้อยู่ดี ระบบนี้มี 54 policy

---

## 13. ข้อจำกัดที่ต้องพูดตามจริง

พูดเองก่อนถูกถาม ได้ความน่าเชื่อถือมากกว่าถูกจับได้

- ยังไม่ deploy ขึ้น public รันบนเครื่อง local
- ข้อมูลเป็น seed ล้วน ยังไม่เคยมีผู้ใช้จริง
- `staff_role` มี 5 ค่า แต่บังคับสิทธิ์จริงแค่ 2 ชั้น `kitchen` และ `cashier` ยังไม่ถูกแยก
- ไม่มีตาราง `visit_guests` — v1 บังคับทั้งโต๊ะใช้แพ็กเกจเดียว คนในโต๊ะเลือกคนละแพ็กเกจไม่ได้ เหตุผลและทางอัปเกรดอยู่ใน `0005_visits.sql` บรรทัด 42–43
- `request_visit_bill` อ่านแถว visit โดยไม่ได้ `FOR UPDATE` ต่างจาก RPC ตัวอื่นที่ล็อกก่อนแก้ ผลกระทบน้อยเพราะการอัปเดตมีเงื่อนไขกำกับ แต่ไม่สม่ำเสมอกับตัวอื่น
- Promotions UI และหน้ารายงานที่อ่านจาก `daily_counters` ยังไม่ได้ทำ
- ยังไม่มีแผนสำรองตอน demo ใช้ Supabase project เดียวทั้ง dev และ demo
- `concurrency.test.mjs` และ E2E ทั้ง 9 สเปก ยังไม่ได้รันในรอบตรวจล่าสุด
- เทสต์ฐานข้อมูลรันบน PGlite ซึ่งไม่มี Supabase Storage จึงต้อง stub schema `storage` เอาเอง (`STORAGE_STUB` ใน `harness.mjs`) สอง stub นี้ทำให้ migration `0022` รันผ่าน แต่ไม่ได้ทดสอบพฤติกรรมจริงของ Storage และ policy บน `storage.objects` ทั้ง 4 ตัวยังไม่เคยถูกทดสอบ

---

## 14. งานที่ยังค้าง เรียงตามความเร่งด่วน

1. **ER Diagram — ยังไม่มี** ตรวจแล้วไม่พบทั้งในโฟลเดอร์โปรเจกต์และใน `.docx` ทั้ง 4 ไฟล์ (`03-เอกสารประกอบระบบ` ไม่มีรูปฝังเลย อีกสองไฟล์มีแต่ภาพหน้าจอ) วิชาฐานข้อมูลไม่มี ER คือเสียคะแนนฟรี
2. **แก้ตัวเลขใน `docs/product-plan.md`** ที่เขียนว่า 32 ฟังก์ชัน ของจริง 42
3. **อัดวิดีโอ demo สำรอง** กันเน็ตห้องเรียนล่มหรือ Supabase หลับ
4. รัน `concurrency.test.mjs` และ E2E ให้ครบ จะได้มีตัวเลขจริงไปพูด
5. ตัดสินใจว่าจะสร้างข้อมูลจำลองจำนวนมาก เช่น visit 5,000 รอบ เพื่อโชว์ว่ารับข้อมูลเยอะได้จริงหรือไม่

---

## 15. ข้อมูลที่ยังไม่ได้ตอบ

- ชื่ออาจารย์ผู้สอน
- มี demo สดหรือไม่ และห้องเรียนมีเน็ตแน่นอนหรือไม่
- เกณฑ์ให้คะแนนของอาจารย์
- จำนวนแถวจริงในฐานข้อมูล Supabase ตอนนี้
- คำตอบเรื่อง Normal Form และเหตุผลที่ `visits` เก็บ snapshot ราคาซ้ำกับ `buffet_packages` ซึ่งดูเหมือนผิด 3NF
