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
          m.id === action.menuId ? { ...m, is_available: !m.is_available } : m),
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
  const [dash, setDash] = useState(demo.dashboard)
  const refreshing = useRef(false)

  // ── ตรวจว่าฐานข้อมูลพร้อมไหม แล้วเลือกโหมด ────────────────────────────────
  useEffect(() => {
    let alive = true
    ;(async () => {
      const probe = await probeSchema()
      if (!alive) return

      if (!probe.ready) {
        setMode('demo')
        setConn({ status: 'demo', reason: probe.reason })
        return
      }

      try {
        const ref = await loadReference()
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

  // ── โหลดสถานะหน้าร้าน + ติดตาม realtime ───────────────────────────────────
  const refresh = useCallback(async () => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const floor = await loadFloorState()
      rawDispatch({ type: 'HYDRATE', data: floor })
    } catch (e) {
      setConn({ status: 'error', reason: e.message })
    } finally {
      refreshing.current = false
    }
  }, [])

  useEffect(() => {
    if (mode !== 'live') return
    refresh()
    loadDashboard(reference?.settings?.timezone).then(setDash).catch(() => {})

    const stop = subscribeFloor(
      () => refresh(),
      (status) => {
        if (status === 'SUBSCRIBED') setConn({ status: 'live', reason: null })
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConn({ status: 'error', reason: 'การเชื่อมต่อ realtime หลุด กำลังลองใหม่' })
        }
      },
    )
    return stop
  }, [mode, refresh, reference])

  // ── dispatch เดียวใช้ได้ทั้งสองโหมด ───────────────────────────────────────
  // หน้าจอเรียก dispatch เหมือนเดิมทุกที่ ไม่ต้องรู้ว่าอยู่โหมดไหน
  const dispatch = useCallback(async (action) => {
    if (mode !== 'live') return rawDispatch(action)

    const fail = (e) =>
      rawDispatch({ type: 'TOAST', toast: { kind: 'info', text: e.message } })

    try {
      switch (action.type) {
        case 'PLACE_ORDER':
          await api.placeOrder(action.visitId, action.items)
          rawDispatch({ type: 'TOAST', toast: { kind: 'ok', text: 'ส่งออเดอร์เข้าครัวแล้ว' } })
          break

        case 'ADVANCE_ITEM':
          await api.advanceOrderItem(action.itemId, action.next)
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
          const p = await api.createPayment({
            visitId: action.visitId, method: action.method,
            amountSatang: action.amount, tenderedSatang: action.tendered,
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
          const m = state.menuItems.find((x) => x.id === action.menuId)
          await api.setMenuAvailability(action.menuId, !m.is_available)
          setReference((r) => ({
            ...r,
            menuItems: r.menuItems.map((x) =>
              x.id === action.menuId ? { ...x, is_available: !x.is_available } : x),
          }))
          break
        }

        case 'TOAST':
          rawDispatch(action)
          return

        default:
          rawDispatch(action)
          return
      }
      refresh()
    } catch (e) {
      fail(e)
    }
  }, [mode, state.orders, state.visits, state.menuItems, reference, refresh])

  // ── รวมข้อมูลให้หน้าจอใช้ — รูปทรงเดียวกันทั้งสองโหมด ─────────────────────
  const api_ = useMemo(() => {
    const live = mode === 'live' && reference

    const tables = live ? reference.tables.map((t) => ({ ...t, zone: zoneCodeOf(t, reference) })) : state.tables
    const menuItems = live ? reference.menuItems : state.menuItems
    const settings = live && reference.settings ? reference.settings : demo.settings
    const packages = live ? reference.packages : demo.packages
    const addOns = live ? reference.addOns : demo.addOns
    const categories = live ? reference.categories : demo.categories
    const stations = live ? reference.stations : demo.stations

    const ordersOf = (visitId) => state.orders.filter((o) => o.visit_id === visitId)
    const visitOf = (visitId) => state.visits.find((v) => v.id === visitId)
    const tableOf = (tableId) => tables.find((t) => t.id === tableId)

    const kitchenTickets = () =>
      state.orders
        .map((o) => {
          const visit = visitOf(o.visit_id)
          const table = visit && tableOf(visit.table_id)
          const liveItems = o.items.filter((i) => i.status !== 'served' && i.status !== 'cancelled')
          return liveItems.length ? { ...o, items: liveItems, table, visit } : null
        })
        .filter(Boolean)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

    const readyToServe = () =>
      state.orders.flatMap((o) => {
        const visit = visitOf(o.visit_id)
        const table = visit && tableOf(visit.table_id)
        return o.items.filter((i) => i.status === 'ready').map((i) => ({ ...i, order: o, table, visit }))
      })

    const openRequests = () =>
      state.serviceRequests.filter((r) => r.status === 'open')
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

    // ฝั่งลูกค้า: ของจริงมาจาก /v/:token — ในเดโมหยิบโต๊ะที่เปิดอยู่ใบแรกมาแสดง
    const customerVisitId = live
      ? (state.visits.find((v) => v.status === 'open')?.id ?? null)
      : demo.CUSTOMER_VISIT_ID

    return {
      ...state,
      mode, conn,
      tables, menuItems, settings, packages, addOns, categories, stations,
      dashboard: live ? dash : demo.dashboard,
      customerVisitId,
      ordersOf, visitOf, tableOf,
      kitchenTickets, readyToServe, openRequests, extraItemsOf,
      refresh, dispatch,
    }
  }, [state, mode, conn, reference, dash, refresh, dispatch])

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
