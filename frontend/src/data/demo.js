// ---------------------------------------------------------------------------
// ข้อมูลเดโม — สะท้อน supabase/seed.sql ให้ตรงกัน
//
// ใช้ตอนที่ยังไม่ได้ push schema ขึ้น Supabase เพื่อให้เปิดดูหน้าเว็บได้ทันที
// เมื่อฐานข้อมูลพร้อมแล้ว ชั้น src/api/* จะดึงของจริงมาแทนโดยที่ component ไม่ต้องแก้
// รูปทรงของข้อมูลตรงกับตารางจริงทุกฟิลด์ที่หน้าจอใช้
// ---------------------------------------------------------------------------

const now = Date.now()
const iso = (msFromNow) => new Date(now + msFromNow).toISOString()

// ── การตั้งค่าร้าน (restaurant_settings) ────────────────────────────────────
export const settings = {
  display_name: 'Shabu Mood',
  timezone: 'Asia/Bangkok',
  vat_enabled: false,
  vat_rate_bp: 700,
  vat_inclusive: true,
  service_charge_enabled: false,
  service_charge_rate_bp: 1000,
  default_dining_minutes: 90,
  last_order_minutes_before_end: 15,
  max_qty_per_item: 10,
  max_items_per_order: 30,
  max_units_per_order: 60,
  min_seconds_between_orders: 30,
  max_unserved_orders_per_visit: 5,
  points_enabled: true,
  points_baht_per_point: 100,
  payment_mode: 'mock',
}

// ── แพ็กเกจบุฟเฟต์ (buffet_packages) — ราคาอยู่ในข้อมูล ไม่ใช่ในโค้ด ───────
export const packages = [
  {
    id: 'pkg-std', code: 'standard', name: 'มาตรฐาน',
    price_per_adult_satang: 29900, price_per_child_satang: 14900,
    child_max_age: 10, dining_minutes: 90, color: '#C62828',
    description: 'เนื้อหมู ซีฟู้ดพื้นฐาน ผัก เห็ด ลูกชิ้น ของทอด ของหวาน',
  },
  {
    id: 'pkg-prm', code: 'premium', name: 'พรีเมียม',
    price_per_adult_satang: 39900, price_per_child_satang: 19900,
    child_max_age: 10, dining_minutes: 120, color: '#AD8B00',
    description: 'ทุกอย่างในมาตรฐาน + เนื้อวากิว แซลมอน หอยเชลล์ กุ้งแม่น้ำ',
  },
]

// ── Add-on (add_ons) — ข้อ ① น้ำรีฟิล 39 อยู่ตรงนี้ที่เดียว ────────────────
export const addOns = [
  {
    id: 'add-drink', code: 'drink_refill', name: 'น้ำรีฟิลไม่อั้น',
    price_satang: 3900, charge_basis: 'per_person',
    description: 'น้ำอัดลม น้ำหวาน ชา รีฟิลได้ไม่จำกัดตลอดมื้อ',
  },
]

// ── สถานีครัว (kitchen_stations) ────────────────────────────────────────────
export const stations = [
  { id: 'st-meat', code: 'meat', name: 'ครัวเนื้อ/หมู' },
  { id: 'st-veg',  code: 'veg',  name: 'ครัวผัก/ของสด' },
  { id: 'st-fry',  code: 'fry',  name: 'ครัวทอด' },
  { id: 'st-bar',  code: 'bar',  name: 'บาร์น้ำ/ของหวาน' },
]

// ── หมวดเมนู (menu_categories) ──────────────────────────────────────────────
// image ตรงกับคอลัมน์ image_url ในตารางจริง — ที่นี่ชี้ไปที่ public/img/
export const categories = [
  { id: 'c-beef',  code: 'beef',      name_th: 'เนื้อ',        image: '/img/cat-beef.jpg' },
  { id: 'c-pork',  code: 'pork',      name_th: 'หมู',          image: '/img/cat-pork.jpg' },
  { id: 'c-sea',   code: 'seafood',   name_th: 'ซีฟู้ด',       image: '/img/cat-seafood.jpg' },
  { id: 'c-veg',   code: 'vegetable', name_th: 'ผัก',          image: '/img/cat-vegetable.jpg' },
  { id: 'c-mush',  code: 'mushroom',  name_th: 'เห็ด',         image: '/img/cat-mushroom.jpg' },
  { id: 'c-ball',  code: 'meatball',  name_th: 'ลูกชิ้น',      image: '/img/cat-meatball.jpg' },
  { id: 'c-fry',   code: 'fried',     name_th: 'ของทอด',       image: '/img/cat-fried.jpg' },
  { id: 'c-noodle',code: 'noodle',    name_th: 'เส้นและอื่นๆ',  image: '/img/cat-noodle.jpg' },
  { id: 'c-drink', code: 'drink',     name_th: 'เครื่องดื่ม',   image: '/img/cat-drink.jpg' },
  { id: 'c-dsrt',  code: 'dessert',   name_th: 'ของหวาน',      image: '/img/cat-dessert.jpg' },
]

// [category, station, ชื่อ, พรีเมียม?, ราคาสั่งพิเศษ(สตางค์) | null]
const RAW = [
  ['c-beef', 'st-meat', 'เนื้อสไลด์',   false, null],
  ['c-beef', 'st-meat', 'เนื้อสันคอ',   false, null],
  ['c-beef', 'st-meat', 'เนื้อใบพาย',   false, null],
  ['c-beef', 'st-meat', 'เนื้อสามชั้น', false, null],
  ['c-beef', 'st-meat', 'เนื้อริบอาย',  true,  null],
  ['c-beef', 'st-meat', 'เนื้อวากิว A5',true,  null],

  ['c-pork', 'st-meat', 'หมูสไลด์',     false, null],
  ['c-pork', 'st-meat', 'หมูสามชั้น',   false, null],
  ['c-pork', 'st-meat', 'หมูสันคอ',     false, null],
  ['c-pork', 'st-meat', 'หมูนุ่ม',      false, null],
  ['c-pork', 'st-meat', 'หมูเด้ง',      false, null],
  ['c-pork', 'st-meat', 'เบคอน',        false, null],

  ['c-sea', 'st-meat', 'กุ้งขาว',       false, null],
  ['c-sea', 'st-meat', 'ปลาหมึก',       false, null],
  ['c-sea', 'st-meat', 'หอยแมลงภู่',    false, null],
  ['c-sea', 'st-meat', 'ปลาดอรี่',      false, null],
  ['c-sea', 'st-meat', 'ปูอัด',         false, null],
  ['c-sea', 'st-meat', 'ปลาแซลมอน',     true,  null],
  ['c-sea', 'st-meat', 'หอยเชลล์',      true,  null],
  ['c-sea', 'st-meat', 'กุ้งแม่น้ำ',    true,  null],

  ['c-veg', 'st-veg', 'ผักกาดขาว',      false, null],
  ['c-veg', 'st-veg', 'ผักบุ้ง',        false, null],
  ['c-veg', 'st-veg', 'คะน้า',          false, null],
  ['c-veg', 'st-veg', 'ข้าวโพดอ่อน',    false, null],
  ['c-veg', 'st-veg', 'ฟักทอง',         false, null],
  ['c-veg', 'st-veg', 'เต้าหู้ไข่',      false, null],

  ['c-mush', 'st-veg', 'เห็ดเข็มทอง',   false, null],
  ['c-mush', 'st-veg', 'เห็ดหอม',       false, null],
  ['c-mush', 'st-veg', 'เห็ดออรินจิ',   false, null],
  ['c-mush', 'st-veg', 'เห็ดนางฟ้า',    false, null],

  ['c-ball', 'st-veg', 'ลูกชิ้นหมู',    false, null],
  ['c-ball', 'st-veg', 'ลูกชิ้นเนื้อ',  false, null],
  ['c-ball', 'st-veg', 'ลูกชิ้นปลา',    false, null],
  ['c-ball', 'st-veg', 'ลูกชิ้นกุ้ง',   false, null],
  ['c-ball', 'st-veg', 'เกี๊ยวกุ้ง',    false, null],

  ['c-fry', 'st-fry', 'เกี๊ยวทอด',      false, null],
  ['c-fry', 'st-fry', 'ปอเปี๊ยะทอด',    false, null],
  ['c-fry', 'st-fry', 'ไก่ป๊อป',        false, null],
  ['c-fry', 'st-fry', 'เฟรนช์ฟรายส์',   false, null],

  ['c-noodle', 'st-veg', 'วุ้นเส้น',    false, null],
  ['c-noodle', 'st-veg', 'บะหมี่',      false, null],
  ['c-noodle', 'st-veg', 'อูด้ง',       false, null],
  ['c-noodle', 'st-veg', 'ข้าวสวย',     false, null],

  ['c-drink', 'st-bar', 'น้ำเปล่า',     false, null],
  ['c-drink', 'st-bar', 'โค้ก',         false, null],
  ['c-drink', 'st-bar', 'ชาเขียว',      false, null],
  ['c-drink', 'st-bar', 'เบียร์สิงห์',  false, 12000], // สั่งพิเศษ คิดเงินเพิ่ม

  ['c-dsrt', 'st-bar', 'ไอศกรีมวานิลลา',false, null],
  ['c-dsrt', 'st-bar', 'ไอศกรีมชาเขียว',false, null],
  ['c-dsrt', 'st-bar', 'บัวลอย',        false, null],
  ['c-dsrt', 'st-bar', 'วุ้นกะทิ',      false, null],
]

export const menuItems = RAW.map(([cat, st, name, premium, price], i) => ({
  id: `m-${i + 1}`,
  category_id: cat,
  station_id: st,
  name_th: name,
  is_included_in_buffet: price === null,
  a_la_carte_price_satang: price,
  is_available: true,
  // ข้อ ② — เมนูที่มีรายการนี้ = สั่งได้เฉพาะแพ็กเกจที่ระบุ; ว่าง = ทุกแพ็กเกจ
  allowed_package_ids: premium ? ['pkg-prm'] : [],
}))

// ── โต๊ะ (tables) ───────────────────────────────────────────────────────────
const TABLE_SETUP = [
  ['A1', 4, 'occupied'],  ['A2', 4, 'available'], ['A3', 4, 'occupied'],
  ['A4', 4, 'cleaning'],  ['B1', 4, 'occupied'],  ['B2', 4, 'available'],
  ['B3', 4, 'occupied'],  ['B4', 4, 'reserved'],  ['C1', 6, 'occupied'],
  ['C2', 6, 'available'], ['C3', 6, 'available'], ['C4', 6, 'occupied'],
]

export const tables = TABLE_SETUP.map(([no, seats, status], i) => ({
  id: `t-${i + 1}`,
  table_number: no,
  zone: no[0],
  capacity: seats,
  status,
}))

// ── การใช้บริการที่กำลังเปิดอยู่ (visits) ───────────────────────────────────
// ข้อ ② — หนึ่ง visit มีแพ็กเกจเดียว เก็บที่ package_id ตรง ๆ
function makeVisit(id, tableId, code, pkgId, adults, children, startedMinAgo, refill) {
  const pkg = packages.find((p) => p.id === pkgId)
  return {
    id,
    visit_code: code,
    table_id: tableId,
    package_id: pkgId,
    package_name_snapshot: pkg.name,
    package_price_adult_satang: pkg.price_per_adult_satang,
    package_price_child_satang: pkg.price_per_child_satang,
    adult_count: adults,
    child_count: children,
    status: 'open',
    check_in_at: iso(-startedMinAgo * 60000),
    dining_deadline_at: iso((pkg.dining_minutes - startedMinAgo) * 60000),
    access_code: String(100000 + Math.floor((id.length * 7919) % 899999)),
    session_token: `tok-${id}`,
    discount_satang: 0,
    addons: refill
      ? [{
          add_on_id: 'add-drink',
          name_snapshot: 'น้ำรีฟิลไม่อั้น',
          unit_price_satang: 3900,
          charge_basis: 'per_person',
          quantity: adults + children,
        }]
      : [],
  }
}

export const visits = [
  makeVisit('v-1', 't-1',  'A1-0825-01', 'pkg-prm', 4, 0, 38, true),
  makeVisit('v-2', 't-3',  'A3-0825-02', 'pkg-std', 2, 1, 66, false),
  makeVisit('v-3', 't-5',  'B1-0825-03', 'pkg-std', 3, 0, 12, true),
  makeVisit('v-4', 't-7',  'B3-0825-04', 'pkg-prm', 2, 0, 81, true),
  makeVisit('v-5', 't-9',  'C1-0825-05', 'pkg-std', 6, 0, 25, false),
  makeVisit('v-6', 't-12', 'C4-0825-06', 'pkg-std', 4, 2, 52, true),
]

/** visit ที่หน้าลูกค้าใช้แสดง (จำลองว่าสแกน QR ของโต๊ะ A1 มา) */
export const CUSTOMER_VISIT_ID = 'v-1'

// ── ออเดอร์ตั้งต้น (orders + order_items) ───────────────────────────────────
let oid = 0
const mk = (visitId, num, minAgo, items) => ({
  id: `o-${++oid}`,
  visit_id: visitId,
  order_number: num,
  created_at: iso(-minAgo * 60000),
  items: items.map(([menuId, qty, status], k) => {
    const m = menuItems.find((x) => x.id === menuId)
    return {
      id: `oi-${oid}-${k}`,
      menu_item_id: menuId,
      name_snapshot: m.name_th,
      station_id: m.station_id,
      quantity: qty,
      status,
      is_buffet_included: m.is_included_in_buffet,
      unit_price_satang: m.a_la_carte_price_satang ?? 0,
      note: null,
    }
  }),
})

export const orders = [
  mk('v-1', 1, 34, [['m-6', 2, 'served'], ['m-1', 2, 'served'], ['m-21', 1, 'served']]),
  mk('v-1', 2, 11, [['m-18', 2, 'ready'], ['m-13', 3, 'preparing'], ['m-27', 2, 'preparing']]),
  mk('v-1', 3,  2, [['m-8', 2, 'pending'], ['m-38', 1, 'pending']]),
  mk('v-2', 1, 55, [['m-7', 3, 'served'], ['m-22', 2, 'served']]),
  mk('v-2', 2,  6, [['m-31', 4, 'preparing'], ['m-44', 2, 'pending']]),
  mk('v-3', 1,  8, [['m-9', 2, 'preparing'], ['m-23', 2, 'pending'], ['m-40', 1, 'pending']]),
  mk('v-4', 1, 70, [['m-19', 2, 'served'], ['m-20', 1, 'served']]),
  mk('v-4', 2,  4, [['m-48', 2, 'pending']]),
  mk('v-5', 1, 20, [['m-11', 4, 'ready'], ['m-24', 3, 'served'], ['m-36', 2, 'preparing']]),
  mk('v-6', 1, 45, [['m-10', 3, 'served'], ['m-28', 2, 'served'], ['m-49', 2, 'ready']]),
]

// ── การเรียกพนักงาน (service_requests) ──────────────────────────────────────
export const serviceRequests = [
  { id: 'sr-1', visit_id: 'v-2', table_id: 't-3', type: 'request_bill', status: 'open', created_at: iso(-3 * 60000) },
  { id: 'sr-2', visit_id: 'v-5', table_id: 't-9', type: 'refill_water', status: 'open', created_at: iso(-1 * 60000) },
]

// ── คิวหน้าร้าน (queue_tickets) ─────────────────────────────────────────────
export const queueTickets = [
  { id: 'q-1', ticket_number: 12, party_size: 2, customer_name: 'คุณแพร',  phone: '081-234-5678', status: 'waiting', created_at: iso(-14 * 60000) },
  { id: 'q-2', ticket_number: 13, party_size: 4, customer_name: 'คุณต้น',  phone: '089-111-2222', status: 'waiting', created_at: iso(-9 * 60000) },
  { id: 'q-3', ticket_number: 14, party_size: 6, customer_name: 'คุณหนึ่ง', phone: '086-555-7777', status: 'called',  created_at: iso(-5 * 60000) },
  { id: 'q-4', ticket_number: 15, party_size: 3, customer_name: 'คุณมิ้น',  phone: '092-888-9999', status: 'waiting', created_at: iso(-2 * 60000) },
]

// ── ตัวเลขสำหรับ Dashboard ผู้จัดการ ────────────────────────────────────────
export const dashboard = {
  salesTodaySatang: 2458000,
  guestsToday: 86,
  billsToday: 24,
  avgPerHeadSatang: 28581,
  hourly: [
    { h: '11', v: 4 }, { h: '12', v: 9 }, { h: '13', v: 7 }, { h: '14', v: 3 },
    { h: '15', v: 2 }, { h: '16', v: 4 }, { h: '17', v: 8 }, { h: '18', v: 14 },
    { h: '19', v: 17 }, { h: '20', v: 12 }, { h: '21', v: 5 }, { h: '22', v: 1 },
  ],
  topItems: [
    { name: 'หมูสามชั้น',   qty: 128 },
    { name: 'กุ้งขาว',      qty: 96 },
    { name: 'เห็ดเข็มทอง',  qty: 88 },
    { name: 'เนื้อสไลด์',   qty: 74 },
    { name: 'ลูกชิ้นปลา',   qty: 61 },
    { name: 'วุ้นเส้น',     qty: 55 },
  ],
  packageMix: [
    { name: 'มาตรฐาน 299', pct: 62 },
    { name: 'พรีเมียม 399', pct: 38 },
  ],
  paymentMix: [
    { name: 'เงินสด', pct: 41 },
    { name: 'สแกน QR', pct: 38 },
    { name: 'บัตร', pct: 15 },
    { name: 'โอน', pct: 6 },
  ],
}
