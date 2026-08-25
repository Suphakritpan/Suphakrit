# Shabu Mood — Database

## วิธีติดตั้ง

เปิด Supabase Dashboard → **SQL Editor** → รันทีละไฟล์ **ตามลำดับ** (ห้ามสลับ เพราะไฟล์หลังอ้างอิงของที่ไฟล์ก่อนสร้างไว้)

| ลำดับ | ไฟล์ | เนื้อหา |
|---|---|---|
| 1 | `migrations/0001_schema.sql` | 15 ENUM + 22 ตาราง + Index |
| 2 | `migrations/0002_functions.sql` | Function, Trigger, Realtime |
| 3 | `migrations/0003_rls.sql` | RLS Policy ทุกตาราง |
| 4 | `migrations/0004_rpc.sql` | RPC ของลูกค้าและพนักงาน + สิทธิ์ |
| 5 | `migrations/0005_seed.sql` | สาขา แพ็กเกจ โต๊ะ เมนูตั้งต้น |

จากนั้นสร้างบัญชี ADMIN คนแรกตามคำอธิบายท้ายไฟล์ `0005_seed.sql`

## หลักการออกแบบที่ต้องรู้ก่อนแก้โค้ด

**1. ราคาไม่ได้อยู่ที่ `order_items`**

ร้านนี้เป็นบุฟเฟต์คิดต่อคน ยอดเงินมาจาก `visit_guests` (แพ็กเกจของแต่ละคน) บวก `visit_addons`
`order_items` ทำหน้าที่เดียวคือบอกว่า "ลูกค้าสั่งอะไรมา" ให้ครัวเห็น

โต๊ะ 4 คน สั่งกุ้ง 10 จาน ก็ยังจ่ายเท่าเดิม

**2. ทุกราคาเป็น snapshot**

`visit_guests.unit_price` และ `visit_addons.unit_price` คัดลอกค่ามาตอนเปิดโต๊ะ
ร้านขึ้นราคา 299 → 319 พรุ่งนี้ บิลของเมื่อวานยังแสดง 299 เหมือนเดิม

**3. ยอดเงินคำนวณในฐานข้อมูลเท่านั้น**

`recalc_visit_totals()` เป็นตัวเขียน `visits.total_amount`
Frontend ห้ามส่งยอดมาให้ระบบเชื่อ ไม่งั้นแก้ค่าใน DevTools แล้วจ่าย 1 บาทได้

**4. ลูกค้าเข้าถึงข้อมูลผ่าน RPC เท่านั้น**

ลูกค้าสแกน QR โดยไม่ล็อกอิน จึงไม่มี `auth.uid()` ให้ผูกสิทธิ์
ตาราง `visits` / `orders` จึง **ไม่มี policy ให้ `anon` เลย** — ยิง REST ตรงไม่ได้

ทางเข้าเดียวคือ 4 ฟังก์ชันนี้ ซึ่งรับ `access_token` จาก QR แล้วตรวจเอง

```
get_visit_by_token(token)              ดูว่าอยู่โต๊ะไหน ยอดเท่าไหร่
get_visit_orders(token)                ติดตามสถานะอาหาร
place_order(token, items, note)        ส่งออเดอร์
call_staff(token, reason, note)        เรียกพนักงาน
```

`place_order` บังคับว่า visit ต้อง `OPEN` เท่านั้น — ปิดบิลแล้ว QR เดิมสั่งอาหารไม่ได้
และ client ส่ง `table_id` / `visit_id` มาเองไม่ได้ ต้องมี token ที่ถูกต้องเท่านั้น

## ตัวอย่างการใช้งานจาก Frontend

```js
import { supabase } from '@/api/supabaseClient'

// ลูกค้าสแกน QR มาที่ /order/:token
const { data, error } = await supabase.rpc('get_visit_by_token', { p_token: token })

// ส่งออเดอร์
await supabase.rpc('place_order', {
  p_token: token,
  p_items: [{ menu_item_id: id, quantity: 2, note: 'ไม่ใส่ผักชี' }],
})

// พนักงานเปิดโต๊ะ (ต้องล็อกอินก่อน)
await supabase.rpc('open_visit', {
  p_table_id: tableId,
  p_guests: [{ buffet_package_id: standardId, count: 3 },
             { buffet_package_id: premiumId,  count: 1 }],
  p_addons: [{ addon_id: refillId, quantity: 4 }],
})
// → คืน access_token เอาไปสร้าง QR
```

## ตารางที่เปิด Realtime

`orders`, `order_items`, `staff_calls`, `dining_tables`, `queue_tickets`, `visits`

ลูกค้าเห็นสถานะอาหารเปลี่ยนทันที ครัวเห็นออเดอร์ใหม่ทันที
