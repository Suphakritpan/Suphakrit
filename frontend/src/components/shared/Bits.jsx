import { useEffect, useState } from 'react'
import { remaining, elapsedRatio } from '../../utils/time'
import { useStore } from '../../context/StoreProvider'
import Icon from '../ui/Icon'

/** นาฬิกาที่เดินจริง อัปเดตตามรอบที่กำหนด */
export function useTick(ms = 1000) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** นับถอยหลังเวลาบุฟเฟต์ — ข้อจำกัดเวลา 90/120 นาที */
export function Countdown({ deadline, size = 'inherit' }) {
  useTick()
  const r = remaining(deadline)
  const color = r.over ? 'var(--danger)' : r.warning ? 'var(--warn)' : 'inherit'

  return (
    <span className="num" style={{ fontSize: size, fontWeight: 700, color, letterSpacing: '-.4px' }}>
      {r.over ? 'หมดเวลา' : r.text}
    </span>
  )
}

/** แถบเวลาที่ใช้ไปแล้วบนการ์ดโต๊ะ */
export function TimeMeter({ start, deadline }) {
  useTick(15000)
  const ratio = elapsedRatio(start, deadline)
  const cls = ratio >= 1 ? 'over' : ratio > 0.83 ? 'warn' : ''
  return (
    <div className="meter">
      <i className={cls} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
  )
}

export function Chip({ tone = 'neutral', icon, children }) {
  return (
    <span className={`chip chip--${tone}`}>
      {icon && <Icon name={icon} size={12} strokeWidth={1.8} />}
      {children}
    </span>
  )
}

export function Step({ value, onAdd, onSub, max }) {
  return (
    <div className={`step ${value ? 'step--on' : ''}`}>
      <button onClick={onSub} disabled={!value} aria-label="ลดจำนวน">
        <Icon name="minus" size={15} strokeWidth={2} />
      </button>
      <span className="v">{value || 0}</span>
      <button onClick={onAdd} disabled={value >= max} aria-label="เพิ่มจำนวน">
        <Icon name="plus" size={15} strokeWidth={2} />
      </button>
    </div>
  )
}

export function Empty({ icon = 'tray', title, hint }) {
  return (
    <div className="empty">
      <div className="empty__ico"><Icon name={icon} size={22} /></div>
      <p className="bold" style={{ color: 'var(--n700)' }}>{title}</p>
      {hint && <p className="t-sm" style={{ marginTop: 4 }}>{hint}</p>}
    </div>
  )
}

export function Note({ tone = 'info', icon = 'alert', children }) {
  return (
    <div className={`note note--${tone}`}>
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </div>
  )
}

/** รูปที่มีพื้นสำรองตอนโหลดไม่ขึ้น — กันกล่องรูปแตกบนหน้าจอลูกค้า */
/** แถวป้ายกำกับ–ค่า ที่ใช้ซ้ำทั่วทั้งแผ่นข้อมูลและการ์ด */
export function Kv({ label, value, mono = true }) {
  return (
    <div className="between t-sm">
      <span className="muted">{label}</span>
      <span className={`bold ${mono ? 'num' : ''}`}>{value}</span>
    </div>
  )
}

export function Photo({ src, alt = '', className = '', style }) {
  const [failed, setFailed] = useState(false)
  if (failed || !src) {
    return <div className={className} style={{ background: 'var(--n200)', ...style }} aria-hidden="true" />
  }
  return (
    <img src={src} alt={alt} loading="lazy" decoding="async"
         className={className} style={style} onError={() => setFailed(true)} />
  )
}

/** แถบแจ้งเตือนมุมจอ */
export function Toaster() {
  const { toast, dispatch } = useStore()

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => dispatch({ type: 'TOAST', toast: null }), 2800)
    return () => clearTimeout(id)
  }, [toast, dispatch])

  if (!toast) return null

  return (
    <div className="toast" role="status">
      <Icon name={toast.kind === 'ok' ? 'check' : 'bell'} size={16} strokeWidth={2} />
      <span>{toast.text}</span>
    </div>
  )
}

/**
 * บอกว่าข้อมูลบนหน้าจอมาจากไหน
 *   live — ต่อ Supabase อยู่ ทุกฝั่งเห็นตรงกันข้ามเครื่อง
 *   demo — ยังไม่ได้ push schema ใช้ข้อมูลจำลอง เชื่อมกันเฉพาะในแท็บนี้
 */
export function ConnectionBadge({ onDark = false }) {
  const { conn, mode } = useStore()

  const map = {
    live:       { tone: 'ok',      icon: 'check',   label: 'เชื่อม Supabase' },
    connecting: { tone: 'info',    icon: 'refresh', label: 'กำลังเชื่อมต่อ' },
    demo:       { tone: 'warn',    icon: 'alert',   label: 'ข้อมูลจำลอง' },
    error:      { tone: 'warn',    icon: 'alert',   label: 'เชื่อมต่อมีปัญหา' },
    idle:       { tone: 'neutral', icon: 'refresh', label: 'กำลังตรวจสอบ' },
  }
  const m = map[conn.status] ?? map.idle

  const style = onDark
    ? { background: 'rgba(255,255,255,.16)', color: '#fff', borderColor: 'rgba(255,255,255,.3)' }
    : undefined

  return (
    <span className={`chip chip--${m.tone}`} style={style} title={conn.reason ?? m.label}>
      <Icon name={m.icon} size={12} strokeWidth={2} />
      {m.label}
      {mode === 'probing' ? '…' : ''}
    </span>
  )
}

/** อธิบายเหตุผลเต็ม ๆ ว่าทำไมยังไม่ต่อฐานข้อมูลจริง */
export function ConnectionNote() {
  const { conn } = useStore()
  if (conn.status === 'live' || conn.status === 'connecting' || !conn.reason) return null

  return (
    <Note tone={conn.status === 'error' ? 'warn' : 'info'} icon="alert">
      <b>{conn.status === 'demo' ? 'กำลังใช้ข้อมูลจำลอง' : 'การเชื่อมต่อมีปัญหา'}</b> — {conn.reason}
    </Note>
  )
}

/** เตือนว่าอยู่โหมดทดสอบ — กันใบเสร็จจำลองหลุดไปใช้จริง */
export function MockBanner() {
  const { settings } = useStore()
  if (settings.payment_mode !== 'mock') return null
  return (
    <Note tone="warn" icon="alert">
      <b>โหมดทดสอบ</b> — การชำระเงินทั้งหมดเป็นการจำลอง ยังไม่มีการตัดเงินจริง
      ใบเสร็จที่พิมพ์จะระบุว่าไม่ใช่เอกสารทางภาษี
    </Note>
  )
}
