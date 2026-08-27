import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { queueStatusByToken } from '../api/queries'
import { Note, Chip, useTick } from '../components/shared/Bits'
import Icon from '../components/ui/Icon'
import { minutesSince } from '../utils/time'

/**
 * ปลายทางของ QR บนบัตรคิว — /q/:token
 *
 * คนยืนรอหน้าร้านเปิดหน้านี้ค้างไว้ได้ ไม่ต้องล็อกอินและไม่ต้องติดตั้งอะไร
 * ดึงซ้ำทุก 15 วินาที — Realtime ใช้ไม่ได้เพราะ anon ไม่มี policy บน queue_tickets
 * (เหตุผลเดียวกับที่ 0010 เลือก poll แทน subscribe)
 */
const POLL_MS = 15000

const LABEL = {
  waiting:   { text: 'กำลังรอเรียก', tone: 'warn' },
  called:    { text: 'ถึงคิวคุณแล้ว', tone: 'ok' },
  seated:    { text: 'เข้าโต๊ะแล้ว',  tone: 'ok' },
  cancelled: { text: 'ยกเลิกแล้ว',   tone: 'neutral' },
  no_show:   { text: 'เลยคิวไปแล้ว', tone: 'neutral' },
}

export default function QueueStatus() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const notified = useRef(false)
  useTick(1000)

  // แจ้งเตือนตอนถึงคิว — ลูกค้าอาจสลับไปแอปอื่นระหว่างรอ
  // ต้องขอสิทธิ์จากท่าทางของผู้ใช้ ขอเงียบ ๆ ตอนเปิดหน้าไม่ได้ (เบราว์เซอร์บล็อก)
  useEffect(() => {
    if (!data || data.status !== 'called' || notified.current) return
    notified.current = true
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('ถึงคิวคุณแล้ว', {
          body: `คิวหมายเลข ${data.ticket_number} — กรุณาติดต่อพนักงานหน้าร้าน`,
          tag: 'shabu-queue',
        })
      }
    } catch { /* เบราว์เซอร์ไม่รองรับก็ข้ามไป หน้าจอยังเปลี่ยนสีบอกอยู่ */ }
    try { navigator.vibrate?.([200, 100, 200, 100, 400]) } catch { /* ไม่รองรับ */ }
  }, [data])

  useEffect(() => {
    let alive = true
    const load = () =>
      queueStatusByToken(token)
        .then((d) => { if (alive) { setData(d); setError(null) } })
        .catch((e) => { if (alive) setError(e.message) })

    load()
    const timer = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [token])

  if (error) {
    return (
      <Shell>
        <Note tone="warn" icon="alert">{error}</Note>
        <p className="t-sm muted" style={{ marginTop: 14, lineHeight: 1.8 }}>
          ลองสแกน QR บนบัตรคิวอีกครั้ง หรือแจ้งพนักงานหน้าร้าน
        </p>
      </Shell>
    )
  }

  if (!data) {
    return (
      <Shell>
        <div className="row g12" style={{ justifyContent: 'center', color: 'var(--n300)' }}>
          <Icon name="refresh" size={19} />
          <span className="t-sm">กำลังตรวจสอบคิว…</span>
        </div>
      </Shell>
    )
  }

  const meta = LABEL[data.status] ?? LABEL.waiting
  const done = data.status === 'seated' || data.status === 'cancelled' || data.status === 'no_show'
  const waited = minutesSince(data.created_at)

  return (
    <Shell>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="panel__hd" style={{ justifyContent: 'center' }}>
          <span className="row g8"><Icon name="ticket" size={17} /> บัตรคิวของคุณ</span>
        </div>

        <div className="pad-l" style={{ textAlign: 'center' }}>
          <p className="t-label">หมายเลขคิว</p>
          <p className="t-display num" style={{ fontSize: 68, lineHeight: 1.15 }}>
            {data.ticket_number}
          </p>
          <div style={{ marginTop: 6 }}>
            <Chip tone={meta.tone}>{meta.text}</Chip>
          </div>
        </div>

        {typeof data.now_serving === 'number' && (
          <div className="between pad" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="t-sm muted">กำลังเรียกคิวที่</span>
            <span className="num bold" style={{ fontSize: 22 }}>{data.now_serving}</span>
          </div>
        )}

        {!done && (
          <div className="pad-l" style={{ borderTop: '1px solid var(--line)', textAlign: 'center' }}>
            {data.status === 'called' ? (
              <Note tone="ok" icon="bell">
                ถึงคิวของคุณแล้ว กรุณาติดต่อพนักงานหน้าร้านภายใน 5 นาที
              </Note>
            ) : (
              <>
                <p className="t-label">เหลืออีก</p>
                <p className="t-display num" style={{ fontSize: 46, lineHeight: 1.2 }}>
                  {data.ahead}
                </p>
                <p className="t-sm muted">คิวก่อนหน้าคุณ</p>
                {data.ahead === 0 ? (
                  <div style={{ marginTop: 14 }}>
                    <Note tone="warn" icon="clock">คุณเป็นคิวถัดไป เตรียมตัวได้เลย</Note>
                  </div>
                ) : data.near_turn ? (
                  <div style={{ marginTop: 14 }}>
                    <Note tone="warn" icon="bell">
                      ใกล้ถึงคิวแล้ว กรุณากลับมาที่ร้าน — เรียกแล้วไม่มาภายใน
                      {' '}{data.grace_minutes ?? 5} นาที คิวจะถูกข้าม
                    </Note>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        <div className="pad" style={{ borderTop: '1px solid var(--line)' }}>
          <Row
            label="จำนวน"
            value={data.child_count > 0
              ? `ผู้ใหญ่ ${data.adult_count} · เด็ก ${data.child_count}`
              : `${data.party_size} ท่าน`}
          />
          <Row label="รับบัตรเมื่อ" value={waited < 1 ? 'เมื่อสักครู่' : `${waited} นาทีที่แล้ว`} />
          {!done && (
            <Row
              label="โต๊ะตอนนี้"
              value={`ว่าง ${data.tables_available ?? 0} · กำลังเก็บ ${data.tables_cleaning ?? 0}`}
            />
          )}
        </div>
      </div>

      {!done && <NotifyOptIn />}

      <p className="t-xs dim center" style={{ marginTop: 18, lineHeight: 1.8 }}>
        หน้านี้อัปเดตเองทุก 15 วินาที เปิดค้างไว้ได้เลย<br />
        กรุณาอย่าปิดบัตรคิวจนกว่าจะได้ที่นั่ง
      </p>
    </Shell>
  )
}

/** ปุ่มขอสิทธิ์แจ้งเตือน — ต้องเกิดจากการกดของผู้ใช้ ขอเองตอนโหลดหน้าเบราว์เซอร์จะปฏิเสธ */
function NotifyOptIn() {
  const [state, setState] = useState(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

  if (state !== 'default') return null
  return (
    <button
      className="btn btn--default btn--block"
      style={{ marginTop: 16 }}
      onClick={() => Notification.requestPermission().then(setState)}
    >
      <Icon name="bell" size={16} /> เตือนฉันเมื่อถึงคิว
    </button>
  )
}

function Shell({ children }) {
  return (
    <div className="cx">
      <header className="cx__bar">
        <span className="row g8" style={{ color: 'var(--brand)' }}>
          <Icon name="flame" size={19} strokeWidth={1.7} />
        </span>
        <h1 className="grow trunc">Shabu Mood</h1>
      </header>
      <div className="cx__wrap" style={{ maxWidth: 400, margin: '0 auto', paddingTop: 26 }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="between t-sm" style={{ padding: '5px 0' }}>
      <span className="muted">{label}</span>
      <span className="bold num">{value}</span>
    </div>
  )
}
