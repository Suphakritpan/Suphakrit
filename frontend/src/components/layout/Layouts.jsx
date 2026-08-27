import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useStore } from '../../context/StoreProvider'
import { Toaster, ConnectionBadge, Empty, Loading } from '../shared/Bits'
import Icon from '../ui/Icon'
import Login from '../../pages/Login'

// ── ฝั่งลูกค้า ───────────────────────────────────────────────────────────────
// มือถือ: แถบนำทางติดขอบล่าง · จอกว้าง: กลายเป็นแท็บแนวนอนใต้หัวเรื่อง
export function CustomerLayout() {
  const store = useStore()

  // ทุกหน้าฝั่งลูกค้าอ่าน store.visitOf(customerVisitId) ทันทีโดยไม่เช็ค null
  // ถ้าไม่มีรอบที่เปิดอยู่ (พิมพ์ /order ตรง ๆ, ปิดบิลแล้วแท็บยังค้าง, token ตาย)
  // จะพังเป็นจอขาวทั้งหน้า — กันที่นี่ที่เดียวครอบทั้ง 4 หน้า
  if (store.mode === 'probing') return <div className="cx"><Loading /></div>

  const cxVisit = store.visitOf(store.customerVisitId)
  if (store.mode === 'live' && !(cxVisit && store.tableOf(cxVisit.table_id))) {
    return (
      <div className="cx">
        <CustomerBar title="Shabu Mood" />
        <div className="cx__wrap" style={{ maxWidth: 420, margin: '0 auto', paddingTop: 48 }}>
          <Empty
            icon="tray"
            title="ยังไม่ได้เข้าโต๊ะ"
            hint="สแกน QR บนสลิปที่พนักงานให้ไว้ที่โต๊ะ เพื่อเริ่มสั่งอาหาร"
          />
        </div>
        <Toaster />
      </div>
    )
  }

  return (
    <div className="cx">
      <Outlet />
      <CustomerNav />
      <Toaster />
    </div>
  )
}

export function CustomerBar({ title, back, right }) {
  const nav = useNavigate()
  return (
    <header className="cx__bar">
      {back ? (
        <button className="btn btn--quiet btn--icon btn--sm" onClick={() => nav(back)} aria-label="ย้อนกลับ">
          <Icon name="arrowLeft" size={18} />
        </button>
      ) : (
        <span className="row g8" style={{ color: 'var(--brand)' }}>
          <Icon name="flame" size={19} strokeWidth={1.7} />
        </span>
      )}
      <h1 className="grow trunc">{title}</h1>
      {right}
    </header>
  )
}

function CustomerNav() {
  const store = useStore()
  const pending = store
    .ordersOf(store.customerVisitId)
    .flatMap((o) => o.items)
    .filter((i) => i.status !== 'served' && i.status !== 'cancelled').length

  const tabs = [
    { to: '/order',        icon: 'home',     label: 'หน้าแรก', end: true },
    { to: '/order/menu',   icon: 'menuBook', label: 'เมนู' },
    { to: '/order/status', icon: 'receipt',  label: 'ออเดอร์', badge: pending },
    { to: '/order/bill',   icon: 'wallet',   label: 'ยอดเงิน' },
  ]

  return (
    <nav className="cx__nav">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'on' : '')}>
          <Icon name={t.icon} size={19} />
          <span>{t.label}</span>
          {t.badge > 0 && <span className="badge">{t.badge}</span>}
        </NavLink>
      ))}
    </nav>
  )
}

// ── คอนโซลพนักงาน / ผู้จัดการ ───────────────────────────────────────────────
const STAFF_NAV = [
  { to: '/staff',          icon: 'grid',     label: 'ผังโต๊ะ', end: true },
  { to: '/staff/queue',    icon: 'ticket',   label: 'คิวหน้าร้าน', count: 'queue' },
  { to: '/staff/kds',      icon: 'chefHat',  label: 'จอครัว', count: 'kitchen' },
  { to: '/staff/serve',    icon: 'tray',     label: 'รอเสิร์ฟ', count: 'serve' },
  { to: '/staff/checkout', icon: 'wallet',   label: 'เช็คบิล' },
]

const ADMIN_NAV = [
  { to: '/admin',          icon: 'chart',    label: 'ภาพรวม', end: true },
  { to: '/admin/menu',     icon: 'menuBook', label: 'จัดการเมนู' },
  { to: '/admin/packages', icon: 'tag',      label: 'แพ็กเกจ & Add-on' },
  { to: '/admin/tables',   icon: 'qr',       label: 'โต๊ะ & QR' },
  { to: '/admin/settings', icon: 'settings', label: 'ตั้งค่าร้าน' },
]

export function ConsoleLayout({ kind }) {
  const store = useStore()
  const items = kind === 'admin' ? ADMIN_NAV : STAFF_NAV

  // โหมด demo ยังไม่มีฐานข้อมูลให้ล็อกอิน ปล่อยเข้าดูจอได้
  //
  // ห้ามเช็คแค่ "มี session" — ลูกค้าที่สแกน QR ก็มี session (anonymous sign-in)
  // ตัวชี้ขาดคือแถวใน profiles ซึ่งมีเฉพาะพนักงาน ตรงกับ is_staff() ที่ RLS ใช้
  if (store.mode === 'probing') return <Loading />

  if (store.mode === 'live') {
    if (store.profile === undefined) return <Loading label="กำลังตรวจสอบสิทธิ์…" />
    if (store.profile === null) return <Login kind={kind} />
  }

  const counts = {
    queue: store.queueTickets.filter((q) => q.status === 'waiting' || q.status === 'called').length,
    kitchen: store.kitchenTickets().reduce((n, t) => n + t.items.length, 0),
    serve: store.readyToServe().length,
  }

  return (
    <div className="shell">
      <aside className="side">
        <div className="side__brand">
          <span style={{ color: 'var(--brand)' }}><Icon name="flame" size={21} strokeWidth={1.7} /></span>
          <span>
            <b>Shabu Mood</b>
            <small>{kind === 'admin' ? 'ผู้จัดการร้าน' : 'พนักงานหน้าร้าน'}</small>
          </span>
        </div>
        <div className="side__sep" />

        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'on' : '')}>
            <Icon name={it.icon} size={18} />
            <span>{it.label}</span>
            {it.count && counts[it.count] > 0 && (
              <span className="side__count">{counts[it.count]}</span>
            )}
          </NavLink>
        ))}

        <div className="side__foot">
          <div className="side__sep" />
          {store.session ? (
            <a href="/" onClick={(e) => { e.preventDefault(); store.signOut() }}>
              <Icon name="logout" size={18} />
              <span>ออกจากระบบ{store.profile?.full_name ? ` · ${store.profile.full_name}` : ''}</span>
            </a>
          ) : (
            <NavLink to="/">
              <Icon name="logout" size={18} />
              <span>ออกจากคอนโซล</span>
            </NavLink>
          )}
        </div>
      </aside>

      <div className="main">
        <Outlet />
      </div>
      <Toaster />
    </div>
  )
}

export function TopBar({ title, sub, children }) {
  return (
    <div className="top">
      <div>
        <h2>{title}</h2>
        {sub && <p className="t-xs" style={{ marginTop: 1 }}>{sub}</p>}
      </div>
      <div className="row g8 wrap">
        {children}
        <ConnectionBadge onDark />
      </div>
    </div>
  )
}
