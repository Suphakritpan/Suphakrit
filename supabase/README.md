# Shabu Mood — ฐานข้อมูล

Postgres บน Supabase · 28 ตาราง · 32 ฟังก์ชัน · 54 RLS policy

## ติดตั้ง

### วิธีที่ 1 — ไฟล์เดียวจบ (แนะนำสำหรับติดตั้งครั้งแรก)

ต่อไฟล์ทั้งหมดเข้าด้วยกันก่อน แล้ววางผลลัพธ์ลง SQL Editor ทีเดียว

```bash
cat supabase/migrations/*.sql supabase/seed.sql > /tmp/shabu-install.sql
```

Supabase Dashboard → **SQL Editor** → วางไฟล์ที่ได้ทั้งไฟล์ → Run

> ⚠️ ใช้กับ project เปล่าเท่านั้น
> `migrations/0001` สร้าง extension และ ENUM ทับของเดิม
> ถ้าฐานข้อมูลมีข้อมูลจริงอยู่แล้ว ให้ข้ามไปวิธีที่ 2 แล้วรันเฉพาะไฟล์ที่ยังไม่ได้รัน

> เมื่อก่อนมีไฟล์ `APPLY_ALL.sql` ที่รวมทุกอย่างไว้ให้แล้ว — เอาออกเพราะเป็น schema ก๊อปที่สอง
> ที่ต้องซิงก์ด้วยมือทุกครั้งที่แก้ migration ถ้าลืมซิงก์จะเพี้ยนแบบเงียบ ๆ (ไม่มี test จับ)
> `cat` ข้างบนให้ผลเหมือนกันโดยไม่ต้องมีก๊อปที่สอง

### วิธีที่ 2 — ทีละไฟล์

รันตามลำดับ ห้ามสลับ เพราะไฟล์หลังอ้างอิงของที่ไฟล์ก่อนสร้างไว้

| ลำดับ | ไฟล์ | เนื้อหา |
|---|---|---|
| 1 | `migrations/0001_extensions_enums.sql` | extension + ENUM 17 ตัว |
| 2 | `migrations/0002_core_config.sql` | สาขา, ตั้งค่าร้าน, พนักงาน, สถานีครัว, ตัวนับ, audit |
| 3 | `migrations/0003_menu_packages.sql` | แพ็กเกจบุฟเฟต์, add-on, เมนู, การล็อกเมนูตามแพ็กเกจ |
| 4 | `migrations/0004_floor_queue.sql` | โซน, โต๊ะ, คิวหน้าร้าน |
| 5 | `migrations/0005_visits.sql` | ลูกค้า, visit, add-on ที่เลือก, อุปกรณ์ที่สแกน QR |
| 6 | `migrations/0006_orders.sql` | ออเดอร์, รายการอาหาร, ประวัติสถานะ, เรียกพนักงาน |
| 7 | `migrations/0007_billing_payments.sql` | โปรโมชั่น, บิล, การชำระเงิน, แต้มสะสม |
| 8 | `migrations/0008_functions_rpc.sql` | helper, state machine, RPC ทั้งหมด |
| 9 | `migrations/0009_rls_realtime.sql` | RLS policy, สิทธิ์, view, realtime |
| 10 | `migrations/0010_token_fallback.sql` | ทางเข้าสำรองด้วย token ล้วน |
| 11 | `seed.sql` | สาขา, 2 แพ็กเกจ, add-on, 10 หมวด, 64 เมนู, 3 โซน 12 โต๊ะ |

### หลังรันเสร็จ ต้องทำอีก 2 อย่าง

1. **Authentication → Providers → เปิด "Anonymous sign-ins"**
   ลูกค้าที่สแกน QR ต้องใช้ ไม่งั้นจะไม่ได้ Realtime และ RLS จะกันหมด
   (ถ้าเปิดไม่ได้ ให้ใช้ทางสำรองใน `0010_token_fallback.sql` แทน — แลกกับการไม่มี realtime)
2. **สร้างบัญชีพนักงานคนแรก** แล้วรัน `seed_dev_staff.sql` เพื่อผูก role

## ทดสอบ

รัน migration ทั้งชุดกับ Postgres จริง (PGlite — Postgres แบบ WASM ไม่ต้องลง Docker)
แล้วทดสอบกฎทางธุรกิจแบบ end-to-end

```bash
cd supabase/tests
npm install
npm test
```

`rules.test.mjs` ทดสอบ 28 เคส ครอบคลุม: การล็อกเมนูตามแพ็กเกจ, ทางเข้า QR และ rate limit,
เพดานการสั่ง, กฎ last order, ความถูกต้องของยอดบิล, การกันจ่ายเกิน, การจ่ายแยก,
ลำดับสถานะ paid → closed → cleaning → available และ audit log

## หลักการออกแบบที่ต้องรู้ก่อนแก้โค้ด

**1. เงินเป็นสตางค์ (integer) เสมอ**

ทุกคอลัมน์ลงท้าย `_satang` — `29900` คือ 299 บาท
ห้ามใช้ทศนิยมลอยตัวกับเงิน เพราะ `0.1 + 0.2 !== 0.3`

**2. ราคาไม่ได้อยู่ที่ `order_items`**

ร้านนี้เป็นบุฟเฟต์คิดต่อคน ยอดเงินมาจาก `visits` (แพ็กเกจ × จำนวนคน) บวก `visit_addons`
`order_items` ทำหน้าที่เดียวคือบอกว่า "ลูกค้าสั่งอะไรมา" ให้ครัวเห็น

โต๊ะ 4 คน สั่งกุ้ง 10 จาน ก็ยังจ่ายเท่าเดิม

**3. หนึ่ง visit มีแพ็กเกจเดียว**

`visits.package_id` เป็น NOT NULL และ **ไม่มีตาราง `visit_guests`** โดยเจตนา
ทั้งโต๊ะต้องใช้แพ็กเกจเดียวกัน ถ้าอนาคตต้องแยกรายคนค่อยเพิ่มตารางใหม่

**4. ไม่มีตัวเลขราคาฝังในโค้ด**

299 / 399 อยู่ใน `buffet_packages` · 39 อยู่ใน `add_ons` · VAT และเพดานการสั่งอยู่ใน `restaurant_settings`
เจ้าของร้านแก้เองได้จากหน้าผู้จัดการโดยไม่ต้อง deploy

**5. ทุกราคาเป็น snapshot**

`visits.package_price_adult_satang` และ `visit_addons.unit_price_satang` คัดลอกค่ามาตอนเปิดโต๊ะ
ร้านขึ้นราคา 299 → 319 พรุ่งนี้ บิลของเมื่อวานยังคิดที่ 299 เหมือนเดิม

**6. ยอดเงินคำนวณในฐานข้อมูลเท่านั้น**

`recalculate_visit_totals()` เป็นตัวเขียน `visits.total_satang` และ `bill_lines`
Frontend คำนวณได้แต่ใช้ "แสดงผล" เท่านั้น — ถ้าปล่อยให้ frontend ส่งยอดมาให้ระบบเชื่อ
ลูกค้าแก้ค่าใน DevTools แล้วจ่าย 1 บาทได้

**7. กฎทางธุรกิจบังคับที่ฐานข้อมูล ไม่ใช่ที่ UI**

endpoint ฝั่งลูกค้าถูกยิงตรงได้เสมอ กฎที่อยู่แค่ในหน้าจอจึงข้ามได้ทั้งหมด
`place_order()` จึงตรวจเองทั้งหมด: visit ยังเปิดอยู่ไหม, เลยเวลา last order หรือยัง,
เมนูของหมดไหม, เมนูอยู่ในแพ็กเกจของโต๊ะนี้ไหม, เกินเพดานต่อเมนู/ต่อรอบไหม,
สั่งถี่เกินไปไหม, มีออเดอร์ค้างเกินกำหนดไหม

**8. สถานะเดินตามลำดับเท่านั้น**

```
visit:  open → awaiting_payment → paid → closed
โต๊ะ:   available → occupied → cleaning → available
```

trigger จะ raise ถ้าข้ามขั้น — `paid` (จ่ายครบ ลูกค้าอาจยังนั่งอยู่) กับ `closed` (ปิดรอบ ลุกจากโต๊ะแล้ว)
เป็นคนละสถานะโดยเจตนา

## RPC

### ลูกค้าเรียกได้

| ฟังก์ชัน | หน้าที่ |
|---|---|
| `join_visit(session_token, table_qr_token, access_code, nickname, ua)` | ผูกเครื่องเข้ากับโต๊ะ (มี rate limit) |
| `place_order(visit_id, items, note)` | ส่งออเดอร์ — ตรวจกฎครบทุกข้อ |
| `request_visit_bill(visit_id)` | กดเช็คบิล ล็อกยอด |

### พนักงานเท่านั้น

| ฟังก์ชัน | หน้าที่ |
|---|---|
| `open_visit(table, package, adults, children, addons, queue?, phone?)` | เปิดโต๊ะ + snapshot ราคา + ออก QR |
| `advance_order_item(item_id, next)` | เดินสถานะรายจาน |
| `create_payment` / `confirm_payment` / `cancel_payment` | ชำระเงิน — กันจ่ายเกินด้วย `FOR UPDATE` |
| `close_visit(visit_id)` | paid → closed, โต๊ะไป cleaning, ล้าง QR, ให้แต้ม |
| `mark_table_clean(table_id)` | cleaning → available |
| `set_menu_item_availability(id, bool)` | ปุ่ม "ของหมด" (แก้ได้เฉพาะคอลัมน์นี้) |
| `void_visit(visit_id, reason)` | ยกเลิกบิล — ผู้จัดการเท่านั้น ต้องมีเหตุผล |

## ตัวอย่างการใช้จาก Frontend

```js
import { supabase } from '@/api/supabaseClient'

// ลูกค้าสแกน QR จากสลิป → /v/:token
await supabase.auth.signInAnonymously()
const { data: visit } = await supabase.rpc('join_visit', {
  p_session_token: token,
  p_nickname: 'มือถือโต๊ะ A1',
})

// ส่งออเดอร์
await supabase.rpc('place_order', {
  p_visit_id: visit.id,
  p_items: [{ menu_item_id: id, quantity: 2, note: 'ไม่ใส่ผักชี' }],
})

// พนักงานเปิดโต๊ะ (ต้องล็อกอินก่อน)
const { data: v } = await supabase.rpc('open_visit', {
  p_table_id: tableId,
  p_package_id: standardId,
  p_adult_count: 3,
  p_child_count: 0,
  p_addons: [{ add_on_id: refillId, quantity: 3 }],
})
// → v.session_token เอาไปสร้าง QR, v.access_code พิมพ์บนสลิป
```

## ตารางที่เปิด Realtime

`visits` · `orders` · `order_items` · `service_requests` · `tables` · `queue_tickets` · `payments`

> ⚠️ Realtime ส่ง event DELETE โดยไม่กรองด้วย RLS (payload มีแค่ primary key)
> ตารางกลุ่มนี้จึงต้องใช้การเปลี่ยน status แทนการลบแถวเสมอ

## โฟลเดอร์ `_archive_alt_design/`

> 🚫 **ห้ามรันไฟล์ในโฟลเดอร์นี้กับ Supabase เด็ดขาด**
>
> เคยเกิดขึ้นมาแล้ว: ดีไซน์ชุดนี้ถูก apply ขึ้น project จริงแทน `migrations/`
> ผลคือ frontend ใช้งานไม่ได้เลย เพราะ RPC ที่ `api/mutations.js` เรียก
> (`join_visit`, `close_visit`, `create_payment`, `confirm_payment`, `advance_order_item`)
> ไม่มีอยู่ในชุดนี้ และชื่อตารางก็คนละชุด (`dining_tables` ไม่ใช่ `tables`,
> `addons` ไม่ใช่ `add_ons`, `staff_calls` ไม่ใช่ `service_requests`,
> `staff` ไม่ใช่ `profiles`) — `probeSchema()` จะ fail แล้วแอปค้างอยู่โหมด demo ตลอด
>
> ของจริงที่ต้องรันคือ `migrations/` เท่านั้น ดูหัวข้อ "ติดตั้ง" ด้านบน

ดีไซน์อีกชุดที่เคยเขียนคู่ขนานกัน (22 ตาราง, `dining_tables`/`staff`/`addons`, เงินเป็น numeric,
`staff_role` เป็นตัวใหญ่ `ADMIN`/`MANAGER`/… ไม่มี `owner`, `branches` ไม่มีคอลัมน์ `code`,
ลูกค้าเข้าผ่าน token ล้วนโดยไม่ล็อกอิน) เก็บไว้อ้างอิงเท่านั้น **ไม่ได้ถูกใช้แล้ว**
แนวคิดที่ดีจากชุดนั้นถูกยกมาใส่ชุดนี้แล้ว: `order_status_history`, `qr_promptpay` เป็น
payment method แยก, เลขใบเสร็จรันรายวัน และ RPC แบบ token ล้วนใน `0010_token_fallback.sql`
