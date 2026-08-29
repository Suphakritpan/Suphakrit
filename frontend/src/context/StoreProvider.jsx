import { createContext, useContext, useMemo, useReducer, useCallback, useEffect, useRef, useState } from 'react'
import * as demo from '../data/demo'
import { probeSchema, loadReference, loadFloorState, loadDashboard } from '../api/queries'
import { subscribeFloor } from '../api/realtime'
import * as api from '../api/mutations'

// ---------------------------------------------------------------------------
// State กลางของทั้งสามฝั่ง
//
// ทำงานได้สองโหมด โดย component ไม่ต้องรู้ว่าอยู่โหมดไหน:
//
//   live — ฐานข้อมูล Supabase พร้อมแล้ว
//          อ่านผ่าน api/queries · เขียนผ่าน RPC ใน api/mutations
//          Realtime ทำให้ทั้งสามฝั่งเห็นตรงกันข้ามเครื่อง
//
//   demo — ยังไม่ได้ push schema ขึ้น Supabase
//          ใช้ข้อมูลจำลองใน data/demo.js เพื่อให้เปิดดูหน้าจอได้ก่อน
//          ทั้งสามฝั่งยังเชื่อมกันได้เพราะใช้ state ก้อนเดียวกัน แต่เฉพาะในแท็บเดียว
// ---------------------------------------------------------------------------

const StoreCtx = createContext(null)

/** เพดานเวลาต่อหนึ่งขั้นตอนตอนเปิดแอป — เกินแล้วถือว่าต่อไม่ติด ดีกว่าค้างเงียบ */
const BOOT_TIMEOUT_MS = 12000

function withTimeout(promise, label, ms = BOOT_TIMEOUT_MS) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}นานเกิน ${ms / 1000} วินาที — เช็คอินเทอร์เน็ตหรือสถานะ Supabase`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** สถานะของรอบที่ยังไม่ปิด — ตรงกับที่ queries.js กรอง และที่ RLS ยอมให้เห็น */
const ACTIVE_VISIT = ['open', 'awaiting_payment', 'paid']

/**
 * ทางเข้าโต๊ะของเครื่องนี้ เก็บไว้ข้ามการรีเฟรช
 *
 * เดิม joinedVisitId อยู่ใน state ล้วน พอลูกค้ากด F5 หรือสลับแอปแล้วเครื่อง reload
 * ค่านี้หายไป แล้วหน้าลูกค้าตกไปใช้ "visit ที่เปิดอยู่ใบแรก" = โต๊ะของคนอื่น
 * ซึ่งบนมือถือจริงเกิดตลอด (pull-to-refresh, กลับมาจากแอปอื่น)
 */
const VISIT_KEY = 'shabu.visit'

function readVisitKey() {
  try { return JSON.parse(localStorage.getItem(VISIT_KEY) ?? 'null') } catch { return null }
}
function writeVisitKey(v) {
  try { v ? localStorage.setItem(VISIT_KEY, JSON.stringify(v)) : localStorage.removeItem(VISIT_KEY) } catch { /* โหมดส่วนตัวบางเบราว์เซอร์เขียนไม่ได้ */ }
}

const initial = {
  tables: demo.tables,
  visits: demo.visits,
  orders: demo.orders,
  serviceRequests: demo.serviceRequests,
  queueTickets: demo.queueTickets,
  menuItems: demo.menuItems,
  payments: [],
  toast: null,
}

let seq = 1000

function reducer(state, action) {
  switch (action.type) {
    case 'HYDRATE':
      return { ...state, ...action.data }

    case 'PLACE_ORDER': {
      const { visitId, items } = action
      const nextNumber = state.orders.filter((o) => o.visit_id === visitId).length + 1
      const order = {
        id: `o-new-${++seq}`,
        visit_id: visitId,
        order_number: nextNumber,
        created_at: new Date().toISOString(),
        items: items.map((it, k) => {
          const m = state.menuItems.find((x) => x.id === it.menu_item_id)
          return {
            id: `oi-new-${seq}-${k}`,
            menu_item_id: it.menu_item_id,
            name_snapshot: m.name_th,
            station_id: m.station_id,
            quantity: it.quantity,
            status: 'pending',
            is_buffet_included: m.is_included_in_buffet,
            unit_price_satang: m.a_la_carte_price_satang ?? 0,
            note: it.note ?? null,
          }
        }),
      }
      return {
        ...state,
        orders: [...state.orders, order],
        toast: { kind: 'ok', text: `ส่งออเดอร์รอบที่ ${nextNumber} เข้าครัวแล้ว` },
      }
    }

    case 'ADVANCE_ITEM': {
      const stamp = new Date().toISOString()
      return {
        ...state,
        orders: state.orders.map((o) => ({
          ...o,
          items: o.items.map((it) =>
            it.id === action.itemId ? { ...it, status: action.next, [`${action.next}_at`]: stamp } : it),
        })),
      }
    }

    case 'BUMP_ORDER':
      return {
        ...state,
        orders: state.orders.map((o) =>
          o.id !== action.orderId ? o : {
            ...o,
            items: o.items.map((it) => (it.status === action.from ? { ...it, status: action.to } : it)),
          }),
      }

    case 'CALL_STAFF': {
      const dup = state.serviceRequests.find(
        (r) => r.visit_id === action.visitId && r.type === action.reqType && r.status === 'open')
      if (dup) return { ...state, toast: { kind: 'info', text: 'แจ้งพนักงานไปแล้ว กำลังมาครับ' } }

      const visit = state.visits.find((v) => v.id === action.visitId)
      return {
        ...state,
        serviceRequests: [...state.serviceRequests, {
          id: `sr-${++seq}`, visit_id: action.visitId, table_id: visit.table_id,
          type: action.reqType, status: 'open', created_at: new Date().toISOString(),
        }],
        toast: { kind: 'ok', text: 'เรียกพนักงานแล้ว รอสักครู่นะคะ' },
      }
    }

    case 'RESOLVE_REQUEST':
      return {
        ...state,
        serviceRequests: state.serviceRequests.map((r) =>
          r.id === action.id ? { ...r, status: 'done', resolved_at: new Date().toISOString() } : r),
      }

    case 'SEAT_TABLE': {
      const pkg = demo.packages.find((p) => p.id === action.packageId)
      const table = state.tables.find((t) => t.id === action.tableId)
      const guests = action.adults + action.children
      const visit = {
        id: `v-${++seq}`,
        visit_code: `${table.table_number}-${new Date().getDate()}-${seq % 100}`,
        table_id: action.tableId,
        package_id: action.packageId,
        package_name_snapshot: pkg.name,
        package_price_adult_satang: pkg.price_per_adult_satang,
        package_price_child_satang: pkg.price_per_child_satang,
        adult_count: action.adults,
        child_count: action.children,
        status: 'open',
        check_in_at: new Date().toISOString(),
        dining_deadline_at: new Date(Date.now() + pkg.dining_minutes * 60000).toISOString(),
        access_code: String(100000 + Math.floor(Math.random() * 899999)),
        session_token: `tok-${seq}`,
        discount_satang: 0,
        addons: action.refill ? [{
          add_on_id: 'add-drink', name_snapshot: demo.addOns[0].name,
          unit_price_satang: demo.addOns[0].price_satang,
          charge_basis: 'per_person', quantity: guests,
        }] : [],
      }
      return {
        ...state,
        visits: [...state.visits, visit],
        tables: state.tables.map((t) => (t.id === action.tableId ? { ...t, status: 'occupied' } : t)),
        queueTickets: state.queueTickets.map((q) =>
          q.id === action.queueId ? { ...q, status: 'seated' } : q),
        toast: { kind: 'ok', text: `เปิดโต๊ะ ${table.table_number} แล้ว — พิมพ์สลิป QR ให้ลูกค้า` },
      }
    }

    case 'PAY_VISIT':
      return {
        ...state,
        visits: state.visits.map((v) =>
          v.id === action.visitId ? { ...v, status: 'paid', paid_at: new Date().toISOString() } : v),
        payments: [...state.payments, {
          id: `p-${++seq}`, visit_id: action.visitId, method: action.method,
          amount_satang: action.amount, status: 'succeeded',
          receipt_number: seq % 1000, completed_at: new Date().toISOString(),
        }],
        toast: { kind: 'ok', text: 'ชำระเงินสำเร็จ — ออกใบเสร็จแล้ว' },
      }

    case 'CLOSE_VISIT': {
      const visit = state.visits.find((v) => v.id === action.visitId)
      return {
        ...state,
        visits: state.visits.map((v) =>
          v.id === action.visitId ? { ...v, status: 'closed', session_token: null, access_code: null } : v),
        tables: state.tables.map((t) => (t.id === visit.table_id ? { ...t, status: 'cleaning' } : t)),
        toast: { kind: 'ok', text: 'ปิดรอบแล้ว — โต๊ะรอทำความสะอาด' },
      }
    }

    case 'CLEAN_TABLE':
      return {
        ...state,
        tables: state.tables.map((t) =>
          t.id === action.tableId && t.status === 'cleaning' ? { ...t, status: 'available' } : t),
        toast: { kind: 'ok', text: 'โต๊ะพร้อมรับลูกค้าใหม่แล้ว' },
      }

    case 'TOGGLE_MENU':
      return {
        ...state,
        menuItems: state.menuItems.map((m) =>
          m.id === action.menuId ? { ...m, is_available: action.next ?? !m.is_available } : m),
      }

    case 'TOAST':
      return { ...state, toast: action.toast }

    default:
      return state
  }
}

export function StoreProvider({ children }) {
  const [state, rawDispatch] = useReducer(reducer, initial)

  // live | demo | probing
  const [mode, setMode] = useState('probing')
  const [conn, setConn] = useState({ status: 'idle', reason: null })
  const [reference, setReference] = useState(null)

  // สำเนาล่าสุดของ reference ที่อ่านได้จากใน callback โดยไม่ติดค่าเก่า
  //
  // dispatch กับปุ่มบนหน้าจอถูกสร้างขึ้นในรอบ render หนึ่ง ๆ แล้วจำค่า ณ ตอนนั้นไว้
  // พอกด 86 แล้วกดคืนติด ๆ กัน ปุ่มที่กดครั้งที่สองอาจยังถือค่าจากก่อนกดครั้งแรก
  // แล้วคำนวณสถานะปลายทางผิด กลายเป็นสั่ง "ให้หมด" ซ้ำแทนที่จะคืนของ
  const referenceRef = useRef(null)
  useEffect(() => { referenceRef.current = reference }, [reference])

  /**
   * ตัวนับการเขียนข้อมูลอ้างอิงจากเครื่องนี้ — ใช้ทิ้งผลโหลดที่ล้าสมัย
   *
   * โหลดชุดอ้างอิงที่ยิงออกไปก่อนที่การอัปเดตจะ commit จะกลับมาพร้อมค่าเก่า
   * ถ้าปล่อยให้เขียนทับ ปุ่ม 86/คืน จะสลับป้ายกลับไปมาเอง แล้วคนกดครั้งถัดไป
   * โดนปุ่มที่ความหมายเปลี่ยนไปแล้ว (เห็นจริงใน audit log: ส่ง 86 ซ้ำสองครั้ง)
   */
  const refWrite = useRef(0)

  /** โหลดชุดอ้างอิงใหม่ แล้วเขียนลง state เฉพาะเมื่อไม่มีการเขียนแทรกระหว่างรอ */
  const refreshReference = useCallback(async () => {
    const seq = refWrite.current
    try {
      const next = await loadReference()
      if (refWrite.current === seq) setReference(next)
    } catch { /* โหลดไม่ได้ก็ใช้ของเดิมต่อ ไม่ต้องทำทั้งหน้าดับ */ }
  }, [])
  const [dash, setDash] = useState(demo.dashboard)
  const refreshing = useRef(false)
  const pendingRefresh = useRef(false)

  // ── ตัวตน ─────────────────────────────────────────────────────────────────
  // session = ทั้งพนักงานที่ล็อกอิน และลูกค้าที่ได้ anonymous session จากการสแกน QR
  const [session, setSession] = useState(null)
  // undefined = ยังไม่รู้ · null = มี session แต่ไม่ใช่พนักงาน (ลูกค้า anonymous)
  // แยกสองค่านี้ให้ขาด ไม่งั้นหน้าคอนโซลจะกระพริบเป็นหน้าล็อกอินทุกครั้งที่รีเฟรช
  const [profile, setProfile] = useState(undefined)
  const [joinedVisitId, setJoinedVisitId] = useState(null)
  // initial state ถูก seed ด้วย demo.* ไว้ให้โหมด demo ใช้
  // พอสลับเป็น live ข้อมูลชุดนั้นยังค้างอยู่จนกว่า HYDRATE รอบแรกจะมาถึง
  // ระหว่างนั้น visit เป็นของ demo แต่ packages/menu เป็นของจริง = จับคู่กันไม่ได้ แล้วพัง
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    api.currentSession().then(setSession)
    return api.onAuthChange(setSession)
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    let alive = true
    setProfile(undefined)
    api.currentProfile()
      .then((p) => { if (alive) setProfile(p ?? null) })
      .catch(() => { if (alive) setProfile(null) })
    return () => { alive = false }
  }, [session])

  // ── ตรวจว่าฐานข้อมูลพร้อมไหม แล้วเลือกโหมด ────────────────────────────────
  //
  // ทุกขั้นตอนต้องมีเพดานเวลา ไม่งั้นถ้า Supabase ตอบช้าหรือติด rate limit
  // หน้าจอจะค้างที่ "กำลังเชื่อมต่อ" ตลอดกาล — ลูกค้าในร้านจ้องจอเปล่าโดยไม่รู้ว่าเกิดอะไร
  // เจอจริงตอนรัน E2E ที่เปิด context ใหม่ทุกเทสต์จนชน rate limit ของ anonymous sign-in
  useEffect(() => {
    let alive = true
    ;(async () => {
      let probe
      try {
        probe = await withTimeout(probeSchema(), 'ตรวจสอบฐานข้อมูล')
      } catch (e) {
        if (!alive) return
        setMode('demo')
        setConn({ status: 'demo', reason: e.message })
        return
      }
      if (!alive) return

      if (!probe.ready) {
        setMode('demo')
        setConn({ status: 'demo', reason: probe.reason })
        return
      }

      // 0009 สั่ง `revoke all on all tables from anon` — ไม่มี session = อ่านอะไรไม่ได้เลย
      // ต้องมี session ก่อนโหลดข้อมูลอ้างอิง ไม่ใช่รอตอนลูกค้าสแกน QR
      // พนักงานที่ล็อกอินอยู่แล้วไม่กระทบ signInAnonymously คืน session เดิมให้
      try {
        await withTimeout(api.signInAnonymously(), 'เข้าสู่ระบบผู้เยี่ยมชม')
      } catch (e) {
        if (!alive) return
        setMode('demo')
        setConn({ status: 'demo', reason: e.message })
        return
      }
      if (!alive) return

      try {
        const ref = await withTimeout(loadReference(), 'โหลดข้อมูลอ้างอิง')
        if (!alive) return
        setReference(ref)
        setMode('live')
        setConn({ status: 'connecting', reason: null })
      } catch (e) {
        if (!alive) return
        setMode('demo')
        setConn({ status: 'demo', reason: `อ่านข้อมูลอ้างอิงไม่สำเร็จ: ${e.message}` })
      }
    })()
    return () => { alive = false }
  }, [])

  // ── ตัวตนเปลี่ยน = สิทธิ์เปลี่ยน ต้องโหลดข้อมูลอ้างอิงใหม่ ────────────────
  //
  // loadReference() รอบแรกวิ่งตอนยังเป็นลูกค้า anonymous ซึ่ง RLS ให้เห็น
  // 0 โต๊ะ 0 โซน และอ่าน restaurant_settings ไม่ได้ (policy read_tables /
  // read_zones / staff_read_settings ต้องการ is_staff())
  // ถ้าไม่โหลดซ้ำหลังพนักงานล็อกอิน คอนโซลจะขึ้น "0 โต๊ะ" ทั้งที่ร้านมี 12 โต๊ะ
  // ลูกค้าก็เจอแบบเดียวกัน: policy read_tables ให้เห็นเฉพาะโต๊ะของ visit ตัวเอง
  // ตอน loadReference() รอบแรกยังไม่ได้ join จึงได้ 0 โต๊ะ แล้วหน้า /order พัง
  const staffId = profile?.id ?? null
  useEffect(() => {
    if (mode !== 'live' || (!staffId && !joinedVisitId)) return
    let alive = true
    loadReference()
      .then((ref) => { if (alive) setReference(ref) })
      // เงียบไม่ได้ — พลาดตรงนี้คือคอนโซลกลับไปเป็น "0 โต๊ะ" โดยไม่มีอะไรบอก
      .catch((e) => { if (alive) setConn({ status: 'error', reason: `โหลดข้อมูลอ้างอิงใหม่ไม่สำเร็จ: ${e.message}` }) })
    return () => { alive = false }
  }, [mode, staffId, joinedVisitId])

  // ── โหลดสถานะหน้าร้าน + ติดตาม realtime ───────────────────────────────────
  // ตัวเลขแดชบอร์ดต้องโหลดคู่กันเสมอ ไม่งั้นเก็บเงินแล้วยอดขายยังเป็นของเก่าจนกว่าจะรีเฟรชหน้า
  const tz = reference?.settings?.timezone ?? 'Asia/Bangkok'
  const refresh = useCallback(async () => {
    // มีรอบที่กำลังโหลดอยู่แล้ว — จดไว้ว่ามีคนขอเพิ่ม แล้วโหลดต่ออีกรอบเมื่อรอบนี้จบ
    //
    // ของเดิมทิ้งคำขอนั้นไปเลย ผลคือ event ที่มาถึงระหว่างกำลังโหลดอยู่จะหายไป
    // เช่นเปิดโต๊ะจากอีกเครื่องพอดีกับที่จอนี้กำลังโหลดชุดก่อนหน้า
    // ผังโต๊ะจะค้างเป็น "ว่าง" ทั้งที่ฐานข้อมูลเปลี่ยนแล้ว จนกว่าจะมี event ถัดไป
    if (refreshing.current) { pendingRefresh.current = true; return }
    refreshing.current = true
    try {
      do {
        pendingRefresh.current = false
        const floor = await loadFloorState()
        rawDispatch({ type: 'HYDRATE', data: floor })
        setHydrated(true)
        loadDashboard(tz).then(setDash).catch(() => {})
      } while (pendingRefresh.current)
    } catch (e) {
      setConn({ status: 'error', reason: e.message })
    } finally {
      refreshing.current = false
    }
  }, [tz])

  useEffect(() => {
    if (mode !== 'live') return
    refresh()

    const stop = subscribeFloor(
      (info) => {
        // เมนูอยู่ใน reference ไม่ใช่ floor state — กด 86 แล้วต้องโหลดชุดอ้างอิงใหม่
        // ไม่งั้นมือถือลูกค้าที่เปิดค้างยังเห็นเมนูที่หมดไปแล้วจนกว่าจะ reload
        //
        // ห้ามโหลด reference ตอน resync: resync เกิดทุกครั้งที่ต่อ channel ใหม่
        // และการโหลด reference ใหม่ก็ทำให้ต่อ channel ใหม่อีก กลายเป็นวนไม่จบ
        // กรณีเน็ตหลุดแล้วเมนูเปลี่ยนระหว่างนั้น ใช้ตัวดักเหตุการณ์ online ข้างล่างแทน
        if (info?.table === 'menu_items') refreshReference()
        refresh()
      },
      (status) => {
        if (status === 'SUBSCRIBED') setConn({ status: 'live', reason: null })
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConn({ status: 'error', reason: 'การเชื่อมต่อ realtime หลุด กำลังลองใหม่' })
        }
      },
    )
    return stop
    // reference อยู่ใน deps ทั้งที่ effect ไม่ได้ใช้ตรง ๆ — ตั้งใจให้เป็นแบบนี้
    // เพราะการโหลด reference เสร็จคือจังหวะที่ต้อง refresh() ซ้ำอีกรอบ
    // (รอบแรกยิงตั้งแต่ยังไม่มีข้อมูลอ้างอิง ถ้าพลาดแล้วไม่มีใครลองใหม่ให้)
    // การวนซ้ำจากการ resync กันไว้ที่ subscribeFloor แล้ว — ดู realtime.js
  }, [mode, refresh, reference, refreshReference])

  // ── ตาข่ายรับ: เน็ตสะดุดสั้น ๆ แล้วกลับมา ────────────────────────────────
  //
  // Postgres Changes ไม่ส่ง event ย้อนหลัง ของที่เปลี่ยนตอนเน็ตหลุดจึงหายไปเลย
  // ปกติจะกู้คืนตอน websocket ต่อกลับได้ (resync) แต่ถ้าเน็ตสะดุดสั้นจนซ็อกเก็ต
  // ไม่ทันรู้ตัว จะไม่มี resync ให้เลย แล้วมือถือค้างอยู่กับข้อมูลเก่าตลอดไป
  // ซึ่งเกิดตลอดเวลาบนมือถือจริง (เดินสลับ wifi กับ 4G, ล็อกจอแล้วกลับมาเปิด)
  //
  // จึงอาศัยสัญญาณของเบราว์เซอร์เองเป็นตัวกระตุ้นให้โหลดใหม่ ไม่ต้องพึ่ง realtime
  useEffect(() => {
    if (mode !== 'live') return

    // ดักเฉพาะ online: เป็นสัญญาณที่ตรงกับเรื่องนี้ที่สุด และเกิดไม่บ่อย
    // เคยดัก visibilitychange ด้วย แต่มันยิงบ่อยจนโหลดข้อมูลอ้างอิงใหม่ถี่เกินไป
    // แล้วการโหลดใหม่แต่ละครั้งทำให้ต่อ channel ใหม่ event ช่วงนั้นเลยหายไปแทน
    const catchUp = () => {
      refresh()
      refreshReference()
    }

    window.addEventListener('online', catchUp)
    return () => window.removeEventListener('online', catchUp)
  }, [mode, refresh, refreshReference])

  // ── dispatch เดียวใช้ได้ทั้งสองโหมด ───────────────────────────────────────
  // หน้าจอเรียก dispatch เหมือนเดิมทุกที่ ไม่ต้องรู้ว่าอยู่โหมดไหน
  const dispatch = useCallback(async (action) => {
    if (mode !== 'live') { rawDispatch(action); return true }

    const fail = (e) =>
      rawDispatch({ type: 'TOAST', toast: { kind: 'info', text: e.message } })

    try {
      switch (action.type) {
        case 'PLACE_ORDER':
          await api.placeOrder(action.visitId, action.items)
          rawDispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'ส่งออเดอร์เข้าครัวแล้ว' } })
          break

        case 'ADVANCE_ITEM':
          await api.advanceOrderItem(action.itemId, action.next, action.reason ?? null)
          break

        case 'BUMP_ORDER': {
          const order = state.orders.find((o) => o.id === action.orderId)
          const targets = (order?.items ?? []).filter((i) => i.status === action.from)
          await Promise.all(targets.map((i) => api.advanceOrderItem(i.id, action.to)))
          break
        }

        case 'CALL_STAFF': {
          const visit = state.visits.find((v) => v.id === action.visitId)
          await api.callStaff(action.visitId, visit.table_id, action.reqType)
          rawDispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'เรียกพนักงานแล้ว รอสักครู่นะคะ' } })
          break
        }

        case 'RESOLVE_REQUEST':
          await api.resolveRequest(action.id)
          break

        case 'CALL_QUEUE':
          await api.callQueueTicket(action.id)
          rawDispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'เรียกคิวแล้ว' } })
          break

        case 'CANCEL_QUEUE':
          await api.cancelQueueTicket(action.id, action.noShow ?? false)
          rawDispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'ยกเลิกคิวแล้ว' } })
          break

        case 'SEAT_TABLE': {
          const addon = (reference?.addOns ?? [])[0]
          const guests = action.adults + action.children
          const visit = await api.openVisit({
            tableId: action.tableId, packageId: action.packageId,
            adults: action.adults, children: action.children,
            addons: action.refill && addon ? [{ add_on_id: addon.id, quantity: guests }] : [],
            queueTicketId: action.queueId,
          })
          rawDispatch({
            type: 'TOAST',
            toast: { kind: 'ok', text: `เปิดโต๊ะแล้ว · รหัสเข้าโต๊ะ ${visit.access_code}` },
          })
          break
        }

        case 'PAY_VISIT': {
          // ฐานข้อมูลบังคับลำดับ: open -> awaiting_payment -> paid
          // create_payment() ปฏิเสธถ้ายังเป็น open ("ต้องกดเช็คบิลก่อน")
          // หน้าจอเดิมข้ามขั้นนี้ จ่ายเงินจึงล้มเหลวทุกครั้งแบบเงียบ ๆ
          const v = state.visits.find((x) => x.id === action.visitId)
          if (v && v.status === 'open') await api.requestBill(action.visitId)

          // ยอดที่เชื่อได้คือของฐานข้อมูล ไม่ใช่ previewBill ฝั่งหน้าจอ
          // (previewBill มีไว้ "แสดง" ระหว่างกินเท่านั้น ตามที่ money.js เขียนไว้)
          const due = await api.amountDue(action.visitId)
          // จ่ายแยกได้: หน้าจอส่งยอดมาเท่าไหร่ก็เก็บเท่านั้น แต่ห้ามเกินยอดคงเหลือ
          const amount = Math.min(action.amount ?? due, due)
          const p = await api.createPayment({
            visitId: action.visitId, method: action.method,
            amountSatang: amount, tenderedSatang: action.tendered,
          })
          await api.confirmPayment(p.id)
          rawDispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'ชำระเงินสำเร็จ — ออกใบเสร็จแล้ว' } })
          break
        }

        case 'CLOSE_VISIT':
          await api.closeVisit(action.visitId)
          rawDispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'ปิดรอบแล้ว — โต๊ะรอทำความสะอาด' } })
          break

        case 'CLEAN_TABLE':
          await api.markTableClean(action.tableId)
          break

        case 'TOGGLE_MENU': {
          // โหมด live เมนูอยู่ใน reference ไม่ใช่ state — หยิบผิดที่แล้ว m เป็น undefined
          //
          // ต้องอ่านผ่าน referenceRef ไม่ใช่ตัวแปร reference ที่ฟังก์ชันนี้จับไว้ตอนถูกสร้าง
          // ไม่งั้นกด 86 แล้วกดคืนติด ๆ กัน ค่าที่อ่านได้ยังเป็นค่าก่อนกดครั้งแรก
          // แล้วคำนวณสถานะปลายทางผิด กลายเป็นสั่ง "ให้หมด" ซ้ำ เมนูไม่กลับมาสักที
          const src = referenceRef.current?.menuItems ?? reference?.menuItems ?? state.menuItems
          const m = src.find((x) => x.id === action.menuId)
          if (!m && action.next == null) break

          const next = action.next ?? !m.is_available

          // นับการเขียนไว้ก่อนยิง เพื่อให้ผลโหลดชุดอ้างอิงที่ค้างอยู่ก่อนหน้าถูกทิ้ง
          // ไม่งั้นมันจะกลับมาเขียนทับด้วยค่าก่อนกด แล้วปุ่มสลับป้ายกลับเอง
          refWrite.current++
          const saved = await api.setMenuAvailability(action.menuId, next)
          refWrite.current++

          // ใช้ค่าที่ฐานข้อมูลคืนกลับมา ไม่ใช่ค่าที่เราเดาไว้ — RPC คืนแถวที่อัปเดตแล้ว
          const confirmed = saved?.is_available ?? next
          // r เป็น null ได้ถ้ากดก่อนชุดอ้างอิงโหลดเสร็จ — ไม่มีอะไรให้แก้ ปล่อยผ่าน
          setReference((r) => (r ? {
            ...r,
            menuItems: r.menuItems.map((x) =>
              x.id === action.menuId ? { ...x, is_available: confirmed } : x),
          } : r))
          break
        }

        case 'TOAST':
          rawDispatch(action)
          return true

        default:
          rawDispatch(action)
          return true
      }
      refresh()
      return true
    } catch (e) {
      fail(e)
      return false
    }
  }, [mode, state.orders, state.visits, state.menuItems, reference, refresh])

  // ── ลูกค้าสแกน QR จากสลิป → /v/:token ───────────────────────────────────
  // join_visit ผูก anonymous session เข้ากับ visit ที่ token ชี้ไว้
  // ถ้า token ตาย (ปิดบิลแล้ว) ฟังก์ชันฝั่งฐานข้อมูลจะโยน error ภาษาไทยกลับมาเอง
  // เปิดโต๊ะแล้วต้องได้ session_token กลับมาทำ QR บนสลิป
  // dispatch คืนแค่ true/false จึงใช้ไม่ได้กับงานที่ต้องการข้อมูลกลับ
  const seatTable = useCallback(async ({ tableId, packageId, adults, children, refill, queueId }) => {
    const addon = (reference?.addOns ?? [])[0]
    const guests = adults + children
    const visit = await api.openVisit({
      tableId, packageId, adults, children,
      addons: refill && addon ? [{ add_on_id: addon.id, quantity: guests }] : [],
      queueTicketId: queueId,
    })
    await refresh()
    return visit
  }, [reference, refresh])

  const adjustGuests = useCallback(async (visitId, adults, children) => {
    const v = await api.adjustVisitGuests(visitId, adults, children)
    await refresh()
    return v
  }, [refresh])

  // โปรโมชั่นต้องคืน error ของฐานข้อมูลให้หน้าจอแสดงตรง ๆ (โค้ดผิด / นอกช่วงเวลา / ยอดไม่ถึง)
  // dispatch คืนแค่ true/false จึงใช้ไม่ได้
  const applyPromo = useCallback(async (visitId, code) => {
    const v = await api.applyPromotionCode(visitId, code)
    await refresh()
    return v
  }, [refresh])

  const removePromo = useCallback(async (visitId, promotionId) => {
    const v = await api.removePromotion(visitId, promotionId)
    await refresh()
    return v
  }, [refresh])

  // หน้าผู้จัดการแก้ราคา/เมนู/โต๊ะแล้วต้องเห็นผลทันทีทุกจอ โดยไม่ต้องรีเฟรชหน้า
  const reloadReference = useCallback(async () => {
    // ตัวนี้ผู้ใช้สั่งโหลดเองหลังบันทึกข้อมูล จึงถือว่าเป็นค่าล่าสุดเสมอ
    // แต่ต้องนับเป็นการเขียนด้วย ไม่งั้นผลโหลดที่ค้างอยู่ก่อนหน้าจะมาเขียนทับทีหลัง
    refWrite.current++
    const ref = await loadReference()
    setReference(ref)
    return ref
  }, [])

  const issueQueue = useCallback(async (input) => {
    const ticket = await api.issueQueueTicket(input)
    await refresh()
    return ticket
  }, [refresh])

  // code = รหัส 6 หลักบนสลิป ใช้คู่กับ QR สติกเกอร์ติดโต๊ะ (tables.qr_token)
  // ไม่มี code = QR บนสลิปซึ่งเป็น visits.session_token ใบเดียวต่อหนึ่งรอบ
  const joinByToken = useCallback(async (token, code = null) => {
    const visit = await api.joinVisit(
      code ? { tableQrToken: token, accessCode: code } : { sessionToken: token })
    setJoinedVisitId(visit.id)
    writeVisitKey({ token, code })
    await refresh()
    return visit
  }, [refresh])

  // กลับเข้าโต๊ะเดิมหลังรีเฟรช — join_visit เป็น idempotent (visit_devices ใช้ on conflict)
  // ล้มเหลวเมื่อไหร่ (ปิดบิลไปแล้ว / รหัสถูกล้าง) ทิ้ง key ไปเลย ไม่ต้องพยายามอีก
  const rejoining = useRef(false)
  useEffect(() => {
    if (mode !== 'live' || joinedVisitId || rejoining.current) return
    const saved = readVisitKey()
    if (!saved?.token) return
    rejoining.current = true
    joinByToken(saved.token, saved.code ?? null)
      .catch(() => writeVisitKey(null))
      .finally(() => { rejoining.current = false })
  }, [mode, joinedVisitId, joinByToken])

  // ── รวมข้อมูลให้หน้าจอใช้ — รูปทรงเดียวกันทั้งสองโหมด ─────────────────────
  const api_ = useMemo(() => {
    const live = mode === 'live' && reference

    // โต๊ะของจริงมาจาก loadFloorState() ที่โหลดใหม่ทุกครั้งที่ realtime แจ้ง
    // reference.tables เป็นค่าตั้งต้นระหว่างรอ HYDRATE รอบแรกเท่านั้น
    const liveTables = live
      ? (state.floorTables?.length ? state.floorTables : reference.tables)
      : null
    const tables = live ? liveTables.map((t) => ({ ...t, zone: zoneCodeOf(t, reference) })) : state.tables
    const menuItems = live ? reference.menuItems : state.menuItems
    const settings = live && reference.settings ? reference.settings : demo.settings
    const packages = live ? reference.packages : demo.packages
    const addOns = live ? reference.addOns : demo.addOns
    const categories = live ? reference.categories : demo.categories
    const stations = live ? reference.stations : demo.stations

    const pending = live && !hydrated
    const visits          = pending ? [] : state.visits
    const orders          = pending ? [] : state.orders
    const serviceRequests = pending ? [] : state.serviceRequests
    const queueTickets    = pending ? [] : state.queueTickets

    const ordersOf = (visitId) => orders.filter((o) => o.visit_id === visitId)
    const visitOf = (visitId) => visits.find((v) => v.id === visitId)
    const tableOf = (tableId) => tables.find((t) => t.id === tableId)

    // รอบที่ยังไม่ปิด — กฎเดียวกับ RLS และ RPC ฝั่งฐานข้อมูล อยู่ที่นี่ที่เดียว
    const activeVisits = () => visits.filter((v) => ACTIVE_VISIT.includes(v.status))
    const activeVisitOf = (tableId) =>
      visits.find((v) => v.table_id === tableId && ACTIVE_VISIT.includes(v.status))

    // ตั๋วของ visit ที่ปิดไปแล้วต้องไม่โผล่ที่จอครัวหรือหน้ารอเสิร์ฟ
    // (เคยขึ้นเป็นตั๋วชื่อโต๊ะว่าง ๆ ที่ไม่มีใครเคลียร์ได้ เพราะโต๊ะถูกปล่อยคืนแล้ว)
    const kitchenTickets = () =>
      orders
        .map((o) => {
          const visit = visitOf(o.visit_id)
          if (!visit) return null
          const table = tableOf(visit.table_id)
          const liveItems = o.items.filter((i) => i.status !== 'served' && i.status !== 'cancelled')
          return liveItems.length ? { ...o, items: liveItems, table, visit } : null
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

    const readyToServe = () =>
      orders.flatMap((o) => {
        const visit = visitOf(o.visit_id)
        if (!visit) return []
        const table = tableOf(visit.table_id)
        return o.items.filter((i) => i.status === 'ready').map((i) => ({ ...i, order: o, table, visit }))
      })

    const openRequests = () =>
      serviceRequests.filter((r) => r.status === 'open')
        .map((r) => ({ ...r, table: tableOf(r.table_id) }))

    const extraItemsOf = (visitId) => {
      const map = new Map()
      ordersOf(visitId).forEach((o) => o.items.forEach((i) => {
        if (i.is_buffet_included || i.status === 'cancelled') return
        const prev = map.get(i.name_snapshot)
        if (prev) prev.quantity += i.quantity
        else map.set(i.name_snapshot, { ...i })
      }))
      return [...map.values()]
    }

    // ฝั่งลูกค้า: ของจริงต้องมาจาก /v/:token เท่านั้น
    // ห้าม fallback ไปโต๊ะที่เปิดอยู่ใบแรก — เครื่องที่ยังไม่ได้ join จะไปโผล่โต๊ะคนอื่น
    const customerVisitId = joinedVisitId ?? (live ? null : demo.CUSTOMER_VISIT_ID)

    return {
      ...state,
      visits, orders, serviceRequests, queueTickets,
      mode, conn,
      tables, menuItems, settings, packages, addOns, categories, stations,
      dashboard: live ? dash : demo.dashboard,
      customerVisitId,
      session, profile,
      ordersOf, visitOf, tableOf, activeVisits, activeVisitOf,
      kitchenTickets, readyToServe, openRequests, extraItemsOf,
      refresh, dispatch,
      signInStaff: api.signInStaff,
      signOut: api.signOut,
      joinByToken, issueQueue, seatTable, adjustGuests, applyPromo, removePromo, reloadReference,
      branchId: reference?.settings?.branch_id ?? null,
      zones: live ? reference.zones : [],
    }
  }, [state, mode, conn, reference, dash, refresh, dispatch, session, profile, joinedVisitId, joinByToken, issueQueue, seatTable, adjustGuests, applyPromo, removePromo, reloadReference, hydrated])

  return <StoreCtx.Provider value={api_}>{children}</StoreCtx.Provider>
}

function zoneCodeOf(table, reference) {
  const z = reference.zones.find((x) => x.id === table.zone_id)
  return z?.code ?? table.table_number?.[0] ?? '-'
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore ต้องอยู่ภายใต้ <StoreProvider>')
  return ctx
}

/** ตะกร้าอยู่ที่เครื่องใครเครื่องมัน แต่ออเดอร์ที่ส่งแล้วแชร์ทั้งโต๊ะ */
export function useCart() {
  const [cart, setCart] = useReducer((s, a) => {
    switch (a.type) {
      case 'ADD': return { ...s, [a.menuId]: Math.min((s[a.menuId] ?? 0) + 1, a.max ?? 10) }
      case 'SUB': {
        const cur = s[a.menuId] ?? 0
        if (cur <= 1) { const { [a.menuId]: _drop, ...rest } = s; return rest }
        return { ...s, [a.menuId]: cur - 1 }
      }
      case 'REMOVE': { const { [a.menuId]: _drop, ...rest } = s; return rest }
      case 'CLEAR': return {}
      default: return s
    }
  }, {})

  const { settings } = useStore()
  const max = settings?.max_qty_per_item ?? 10

  const add = useCallback((menuId) => setCart({ type: 'ADD', menuId, max }), [max])
  const sub = useCallback((menuId) => setCart({ type: 'SUB', menuId }), [])
  const remove = useCallback((menuId) => setCart({ type: 'REMOVE', menuId }), [])
  const clear = useCallback(() => setCart({ type: 'CLEAR' }), [])

  const lines = Object.entries(cart)
  const totalUnits = lines.reduce((s, [, q]) => s + q, 0)

  return { cart, lines, totalUnits, add, sub, remove, clear }
}
