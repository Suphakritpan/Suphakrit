import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
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

/**
 * QR ที่สแกนได้จริง — เข้ารหัสเป็น SVG แล้ววาดลง data URI
 *
 * ระดับแก้ความผิดพลาด M: ทนรอยเปื้อน/รอยพับบนสลิปกระดาษได้ราว 15%
 * ซึ่งเป็นเรื่องปกติของบัตรคิวที่ลูกค้าถือเดินไปมา
 */
export function QR({ value, size = 168, className = '', style }) {
  const [svg, setSvg] = useState(null)

  useEffect(() => {
    let alive = true
    QRCode.toString(String(value ?? ''), {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((out) => { if (alive) setSvg(out) })
      .catch(() => { if (alive) setSvg(null) })
    return () => { alive = false }
  }, [value])

  const box = {
    width: size, height: size, padding: 8, background: '#fff',
    borderRadius: 'var(--r-sm)', display: 'block', ...style,
  }
  if (!svg) return <div className={className} style={box} aria-hidden="true" />
  return (
    <img
      className={className}
      style={box}
      alt="QR สำหรับสแกน"
      src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`}
    />
  )
}

/**
 * สลิปเปิดโต๊ะ — ลูกค้าสแกน QR บนใบนี้แล้วสั่งอาหารจากมือถือตัวเองได้เลย
 *
 * QR ผูกกับ session_token ของรอบนี้ ซึ่งถูกล้างเป็น null ตอนปิดบิล
 * สลิปของรอบเก่าจึงสั่งอาหารเข้าบิลใหม่ไม่ได้
 * รหัส 6 หลักพิมพ์ไว้ด้วย เผื่อกล้องมือถือลูกค้าสแกนไม่ติด
 */
export function TableSlip({ visit, tableNumber, onClose }) {
  const url = `${window.location.origin}/v/${visit.session_token}`

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd between no-print">
          <h3 className="t-title">เปิดโต๊ะ {tableNumber} แล้ว</h3>
          <button className="btn btn--quiet btn--icon btn--sm" onClick={onClose}>
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="sheet__bd">
          <div className="slip" style={{ textAlign: 'center' }}>
            <p className="bold">SHABU MOOD</p>
            <p className="t-xs" style={{ marginTop: 2 }}>ใบรับประทาน</p>

            <p className="num" style={{ fontSize: 44, lineHeight: 1.2, margin: '8px 0 0' }}>
              {tableNumber}
            </p>
            <p className="t-sm">
              {visit.package_name_snapshot} · {visit.adult_count + visit.child_count} ท่าน
            </p>

            <div className="slip__r" />

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <QR value={url} size={182} />
            </div>
            <p className="t-xs" style={{ marginTop: 8, lineHeight: 1.7 }}>
              สแกนเพื่อสั่งอาหารจากมือถือของคุณ
            </p>

            <div className="slip__r" />
            <div className="between">
              <span className="t-sm">รหัสเข้าโต๊ะ</span>
              <span className="num bold" style={{ fontSize: 20, letterSpacing: '.14em' }}>
                {visit.access_code ?? '—'}
              </span>
            </div>
            <p className="t-xs" style={{ marginTop: 6 }}>ใช้เมื่อสแกน QR ไม่ติด</p>
          </div>
        </div>

        <div className="sheet__ft no-print">
          <button className="btn btn--default" onClick={onClose}>ปิด</button>
          <button className="btn btn--primary grow" onClick={() => window.print()}>
            <Icon name="printer" size={16} /> พิมพ์ใบรับประทาน
          </button>
        </div>
      </div>
    </div>
  )
}

/** จอรอระหว่าง probeSchema() + loadReference() — กันไม่ให้ดูเหมือน "ไม่มีข้อมูล" */
export function Loading({ label = 'กำลังเชื่อมต่อฐานข้อมูล…' }) {
  return (
    <div className="empty" style={{ paddingTop: 90 }}>
      <div className="empty__ico" style={{ animation: 'spin 1.1s linear infinite' }}>
        <Icon name="refresh" size={22} />
      </div>
      <p className="t-sm muted">{label}</p>
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
    return <div className={className} style={{ background: 'var(--s3)', ...style }} aria-hidden="true" />
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
