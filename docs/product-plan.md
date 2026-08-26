# แผนผลิตภัณฑ์ Shabu Mood (เอกสารตั้งต้น)

> **สถานะ: ทำไปแล้วเกือบหมด — เก็บไว้เพื่ออ่าน "ทำไมถึงออกแบบแบบนี้" ไม่ใช่รายการงานที่ต้องทำ**
>
> - **ฐานข้อมูล — เสร็จและเกินแผน** แผนขอ 17 ตาราง สร้างจริง 28 พร้อม RLS 54 policy และ 32 ฟังก์ชัน
>   ครบทั้ง 5 ข้อ "สิ่งที่ทำให้เป็น Product จริง": Realtime, Role 5 ระดับ, กันออเดอร์ผิดโต๊ะ, `audit_logs`, `branches`
> - **จุดที่ตั้งใจไม่ทำตามแผน — `visit_guests`** แผนอยากให้แต่ละคนในโต๊ะเลือกแพ็กเกจต่างกันได้
>   v1 ตัดสินใจให้ทั้งโต๊ะใช้แพ็กเกจเดียว เหตุผลและทางอัปเกรดอยู่ใน `supabase/migrations/0005_visits.sql` บรรทัด 42-43
> - **order status** แผนขอ 7 ค่า สร้างจริง 5 (ตัด `CONFIRMED` และ `SERVING` ที่ไม่มีใครใช้)
> - **หน้าจอ** แผนลิสต์ไว้ 44 หน้า ทำจริง ~14 เพราะหลายหน้ายุบรวมกันได้
>   (เช่น Menu + Category + Food Detail + Cart + Confirm Order 5 หน้าในแผน = `customer/Menu.jsx` หน้าเดียว)
>   **อย่าไล่สร้างให้ครบ 44 ตามลิสต์** — ที่ยังขาดจริงคือ Promotions UI และ Reports ที่อ่านจาก `daily_counters`

---

โอเค แบบนี้ภาพของ **Shabu Mood** ชัดแล้ว และผมแนะนำให้เปลี่ยนแนวคิดจาก “ระบบฐานข้อมูลร้านชาบู” เป็น **ระบบบริหารร้านชาบูครบวงจร + QR Self-Ordering** ได้เลย โดย Supabase เป็น Backend หลัก และเว็บเดียว Responsive ใช้ได้ทั้งมือถือ ลูกค้า แท็บเล็ตพนักงาน และคอมผู้จัดการ

จุดสำคัญที่สุดคือ **ฐานข้อมูลเดิมต้องปรับเล็กน้อย** เพราะร้านนี้คิดเงินแบบบุฟเฟต์ “ต่อคน” ดังนั้น `order_items` ไม่ควรเป็นตัวกำหนดราคาอาหารเหมือนร้าน A La Carte แต่ทำหน้าที่เป็น “รายการอาหารที่ลูกค้าสั่ง” ส่วนราคาที่ต้องจ่ายจริงจะมาจาก **แพ็กเกจบุฟเฟต์ + จำนวนคน + Add-on** เช่น น้ำรีฟิล +39 บาท

### ภาพผลิตภัณฑ์จริง

ผมจะวางระบบเป็น 3 ส่วนใน Product เดียว

**Customer Web**

ลูกค้ามาถึงร้าน → พนักงานจัดคิว → ได้โต๊ะ → พนักงานให้ใบเสร็จ/บัตรโต๊ะที่มี QR → ลูกค้าสแกน → ระบบรู้ว่าอยู่โต๊ะไหนและอยู่ใน Visit ไหน → เลือกอาหาร → ส่งออเดอร์ → ดูสถานะ → เรียกพนักงาน → ดูเวลาการใช้บริการ → ดูยอดเงิน → ชำระเงิน → จบการใช้บริการ

ลูกค้าไม่จำเป็นต้องสมัครสมาชิกเพื่อสั่งอาหารก็ได้ แต่ถ้าต้องการสะสมแต้ม/ดูประวัติการใช้บริการ ค่อย Login เป็นสมาชิก

**Staff Web**

พนักงานจะมี Dashboard เช่น

`คิวรอ 5 | โต๊ะว่าง 4 | กำลังกิน 12 | รอเสิร์ฟ 3 | เรียกพนักงาน 2`

จากนั้นมีหน้าหลักสำหรับจัดการคิวและโต๊ะ พนักงานสามารถกด **เรียกคิว → เลือกโต๊ะ → เปิด Visit → พิมพ์/แสดง QR ให้ลูกค้า**

เมื่อมีออเดอร์เข้ามา พนักงานเสิร์ฟจะเห็นประมาณ

`โต๊ะ A12 → Order #1024 → รอจัดอาหาร`

แล้วเปลี่ยนเป็น

`กำลังเตรียม → พร้อมเสิร์ฟ → เสิร์ฟแล้ว`

ส่วนพนักงานหน้าร้านสามารถดูได้ว่าโต๊ะไหนกำลังใช้งาน โต๊ะไหนกำลังรอทำความสะอาด และโต๊ะไหนพร้อมรับลูกค้าคนใหม่

**Admin / Manager**

ส่วนนี้จะเป็นหลังบ้าน ใช้จัดการ

เมนู → หมวดหมู่ → รูปอาหาร → เปิด/ปิดเมนู → แพ็กเกจบุฟเฟต์ → ราคา → Add-on → โต๊ะ → พนักงาน → โปรโมชั่น → สมาชิก → แต้ม → ออเดอร์ → การชำระเงิน → รายงานยอดขาย

และมี Dashboard เช่น

`ยอดขายวันนี้ 24,580 บาท`

`ลูกค้าวันนี้ 86 คน`

`โต๊ะกำลังใช้งาน 14/20`

`เมนูขายดี กุ้งสด`

`ช่วงลูกค้าเยอะ 18:00–20:00`

---

## ฐานข้อมูลควรเปลี่ยนจาก 7 ตารางเป็นแบบนี้

ของเดิม 7 ตารางยังเก็บไว้เป็นแกนได้ แต่สำหรับ Production ผมแนะนำประมาณ **17 ตาราง**

```text
customers
    ↓
visits
    ↓
visit_guests
    ↓
buffet_packages
    ↓
visit_addons

tables
    ↓
visits

menu_categories
    ↓
menu_items
    ↓
order_items
    ↑
orders
    ↓
order_status_history

queue_tickets
    ↓
visits

payments
payment_items

staff
staff_roles

promotions
customer_points
point_transactions
```

ตัวที่สำคัญมากคือ `visit_guests`

เพราะร้านคิดเงิน **ต่อคน**

สมมติโต๊ะ A12 มี 4 คน

```text
คนที่ 1 → Buffet 299
คนที่ 2 → Buffet 299
คนที่ 3 → Buffet 399
คนที่ 4 → Buffet 299
น้ำรีฟิล → 4 × 39
```

ระบบจะคำนวณยอดได้

```text
299 + 299 + 399 + 299
+ 39 + 39 + 39 + 39
----------------------
= 1,452 บาท
```

แบบนี้ดีกว่าการเก็บแค่ `total_price` ใน `visits` เพราะสามารถรู้ได้ว่า **แต่ละคนเลือกแพ็กเกจอะไร**

และถ้าในอนาคตร้านเปลี่ยนราคา 299 → 319 ออเดอร์/ใบเสร็จเก่าก็ยังไม่เสีย เพราะตอนเปิด Visit ระบบจะบันทึก **ราคาที่ใช้จริง ณ เวลานั้น**

---

# Workflow ของระบบจริง

ผมจะปรับ Workflow จากภาพแรกของคุณเป็นแบบนี้

```text
ลูกค้าเดินเข้าร้าน
        ↓
พนักงานสร้าง Queue
        ↓
เรียกคิว
        ↓
เลือกโต๊ะ
        ↓
สร้าง Visit
        ↓
เลือกจำนวนคน
        ↓
เลือก Buffet Package
        ↓
เลือก Add-on
        ↓
ระบบสร้าง QR ประจำโต๊ะ/Visit
        ↓
ลูกค้าสแกน QR
        ↓
เข้าสู่หน้า Shabu Mood
        ↓
เลือกหมวดอาหาร
        ↓
เลือกอาหาร
        ↓
ใส่ตะกร้า
        ↓
ยืนยันออเดอร์
        ↓
Kitchen Queue
        ↓
พนักงานเตรียมอาหาร
        ↓
พร้อมเสิร์ฟ
        ↓
พนักงานนำอาหารไปโต๊ะ
        ↓
เสิร์ฟแล้ว
        ↓
ลูกค้ากิน / สั่งเพิ่ม
        ↓
กดเรียกพนักงานเมื่อเช็กบิล
        ↓
พนักงานปิด Visit
        ↓
ระบบคำนวณยอด
        ↓
Mock Payment Gateway
        ↓
เงินสด / โอน / บัตร
        ↓
ชำระสำเร็จ
        ↓
สร้าง Receipt
        ↓
Visit = COMPLETED
        ↓
โต๊ะ = CLEANING
        ↓
ทำความสะอาดเสร็จ
        ↓
โต๊ะ = AVAILABLE
```

นี่จะกลายเป็น Product จริงมากกว่าระบบ Demo ธรรมดา

---

# QR ต้องออกแบบใหม่ด้วย

QR ในระบบนี้ไม่ควรเป็นแค่ QR ที่เปิดหน้าเมนูธรรมดา

ควรเป็น **Dynamic Visit QR**

เช่นแนวคิด

```text
Shabu Mood
โต๊ะ A12

QR
↓
https://shabumood.app/order/8F3K...
```

เมื่อเปิด QR ระบบจะตรวจสอบว่า

```text
QR นี้
→ เป็นของ Table A12
→ Visit #5821
→ สถานะ ACTIVE
```

ลูกค้าจึงสั่งอาหารเข้า Visit เดียวกันได้

และถ้า Visit จบแล้ว QR เดิมจะ **สั่งอาหารไม่ได้**

นี่เป็นจุดที่สำคัญมากสำหรับระบบจริง เพราะไม่อย่างนั้นลูกค้าโต๊ะเก่าสามารถเปิด QR แล้วสั่งอาหารเข้าบิลใหม่ได้

---

# หน้าจอ Product จริงที่ผมแนะนำ

จาก Mockup 5 หน้าของคุณ ผมจะขยายเป็นประมาณนี้

### Customer

```text
01 Home / Welcome
02 Menu
03 Category
04 Food Detail
05 Cart
06 Confirm Order
07 Order Tracking
08 Call Staff
09 My Visit
10 Bill
11 Payment
12 Payment Success
13 Receipt
14 Member / Profile
15 Points
```

### Staff

```text
01 Staff Login
02 Dashboard
03 Queue
04 Tables
05 Table Detail
06 Open Visit
07 QR Management
08 Orders
09 Kitchen Queue
10 Serving Queue
11 Customer Calls
12 Payment / Checkout
13 Receipt
14 Daily Summary
```

### Admin

```text
01 Admin Login
02 Dashboard
03 Menu Management
04 Category Management
05 Buffet Packages
06 Add-ons
07 Tables
08 Staff
09 Customers
10 Promotions
11 Orders
12 Payments
13 Reports
14 Point System
15 System Settings
```

ดังนั้นจากภาพที่คุณทำไว้ **Screen 1–5 ไม่ได้ทิ้งนะ** มันจะกลายเป็น Customer Module ตัวแรกของ Product จริง

---

## เรื่อง Buffet Package ผมแนะนำให้ทำเป็น Configurable

อย่าฝัง `299` และ `399` ลงใน Code

ฐานข้อมูลควรมีประมาณนี้

```text
buffet_packages

id
name
price
description
is_active
created_at
updated_at
```

เช่น

```text
1 | Standard | 299
2 | Premium  | 399
```

ถ้าวันหนึ่งร้านเปลี่ยนเป็น

```text
Standard 319
Premium 429
Super Premium 499
```

Admin แค่เปลี่ยนในระบบ ไม่ต้องแก้ Code

ส่วน

```text
Add-ons

น้ำรีฟิล +39
ชีส +49
ไอศกรีม +29
```

ก็เป็นข้อมูลใน Database เช่นเดียวกัน

---

# ระบบ Order ก็ต้องแยกจากระบบคิดเงิน

นี่เป็นอีกจุดที่ผมอยากแก้จาก DB เดิม

ลูกค้าสั่ง

```text
กุ้งสด × 2
หมูสามชั้น × 2
เห็ดเข็มทอง × 1
```

ไม่ได้หมายความว่า

```text
159 + 159 + 99...
```

เพราะเป็นบุฟเฟต์

ดังนั้น `order_items` ควรประมาณ

```text
order_item_id
order_id
menu_item_id
quantity
note
status
created_at
```

ส่วน `orders`

```text
order_id
visit_id
order_number
status
created_at
updated_at
```

และสถานะอาจเป็น

```text
PENDING
CONFIRMED
PREPARING
READY
SERVING
SERVED
CANCELLED
```

ทำให้ระบบครัวสามารถทำงานจริงได้

---

# Payment Mockup ก็ควรทำเหมือน Gateway จริง

แม้ตอนนี้ยังไม่ต่อเงินจริง แต่โครงสร้างควรออกแบบให้เปลี่ยนเป็นของจริงได้ภายหลัง

ลูกค้าเลือก

```text
ชำระเงิน

○ เงินสด
○ โอนเงิน
○ บัตร
```

ถ้าเลือก Mock Card

```text
Card Number
**** **** **** 1234

Amount
฿1,452

[ Pay Now ]
```

ระบบจำลอง

```text
Payment Processing
        ↓
Payment Success
        ↓
สร้าง Transaction ID
        ↓
สร้าง Receipt
```

Database จึงไม่ควรเก็บแค่ `payment_method` กับ `amount` แบบเดิม แต่ควรมี `payment_status`, `transaction_reference` และข้อมูลที่จำเป็นต่อการตรวจสอบรายการด้วย

---

# สิ่งที่ทำให้มันกลายเป็น Product จริง

ผมจะให้ความสำคัญกับ 5 เรื่องนี้มากกว่าการทำ UI สวย

**หนึ่ง — Real-time**

ลูกค้าสั่งอาหาร → Staff เห็นทันที

Staff เปลี่ยน `PREPARING` → ลูกค้าเห็นสถานะทันที

Staff เสิร์ฟแล้ว → ลูกค้าเห็นทันที

Supabase เหมาะกับตรงนี้มาก

**สอง — Role & Permission**

ไม่ใช่ทุกคนเข้าหลังบ้านได้หมด

```text
ADMIN
MANAGER
STAFF
KITCHEN
CASHIER
```

แต่ละ Role เห็นและแก้ข้อมูลไม่เหมือนกัน

**สาม — ป้องกันออเดอร์ผิดโต๊ะ**

ทุก Order ต้องผูก

```text
Order
 ↓
Visit
 ↓
Table
```

ไม่ให้ Client ส่ง `table_id` อะไรก็ได้แล้วสร้างออเดอร์เข้าต๊ะอื่น

**สี่ — Audit Log**

ระบบจริงควรรู้ว่า

```text
ใครยกเลิก Order
ใครเปลี่ยนราคา
ใครคืนเงิน
ใครเปลี่ยนสถานะโต๊ะ
ใครปิดบิล
```

**ห้า — รองรับร้านหลายสาขาในอนาคต**

ถึงตอนแรกจะมีร้านเดียว ผมแนะนำให้โครงสร้าง Database เผื่อ

```text
branches
   ↓
tables
staff
menu
visits
orders
payments
```

ไว้ตั้งแต่ต้น เพราะถ้าทำจนใช้งานจริงแล้วค่อยเพิ่ม Multi-branch ทีหลังจะรื้อค่อนข้างหนัก

---

## ดังนั้น Product Architecture จะเป็นแบบนี้

```text
                    SHABU MOOD
                 ┌───────────────┐
                 │   Web App     │
                 │ Responsive    │
                 └───────┬───────┘
                         │
          ┌──────────────┼──────────────┐
          ↓              ↓              ↓
     CUSTOMER          STAFF          ADMIN
          │              │              │
          └──────────────┼──────────────┘
                         ↓
                  Supabase Backend
              ┌──────────┼──────────┐
              ↓          ↓          ↓
          PostgreSQL   Realtime    Storage
              │
              ↓
       Business Logic / API
              │
       ┌──────┼───────┐
       ↓      ↓       ↓
     Order  Payment  Queue
       │      │       │
       └──────┼───────┘
              ↓
         Receipt / Report
```

และ **7 ตารางในภาพแรกของคุณจะกลายเป็น Core ของระบบ ไม่ใช่ฐานข้อมูลทั้งหมด** ซึ่งเป็นแนวทางที่เหมาะกว่าการพยายามยัดทุกอย่างลง 7 ตาราง

ผมคิดว่า Step ต่อไปควรเป็น **ล็อก Production Database ก่อน** แล้วค่อยสร้าง UI เพราะตอนนี้เราได้ Requirement สำคัญครบแล้ว: Web App + Supabase + QR Ordering + Buffet ต่อคน + Add-on + Mock Payment + Staff Workflow + เป้าหมาย Production

ถ้าทำต่อ ผมแนะนำให้ผมจัด **Database Production v1 ให้ครบทั้งตาราง, PK/FK, ENUM/Status, RLS, Index, Trigger, Function และความสัมพันธ์ ER Diagram** แล้วเอาไปสร้างบน Supabase ได้จริง จากนั้นค่อยแตกเป็นหน้าเว็บและ API ตามฐานข้อมูลนี้ จะลดปัญหาต้องรื้อระบบทีหลังได้เยอะมาก.
