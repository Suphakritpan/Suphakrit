import { useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Empty, useTick } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { ORDER_STATUS } from '../../data/constants'
import { minutesSince, clockTH } from '../../utils/time'

// เหตุผลสำเร็จรูป — ยกเลิกอาหารเป็นรายการที่กระทบบิล จึงต้องมีเหตุผลติดไปด้วยเสมอ
// (เก็บลง order_items.cancelled_reason และ audit_logs โดย advance_order_item)
const CANCEL_REASONS = ['ของหมด', 'ลูกค้ายกเลิก', 'ทำผิดรายการ', 'ปิดรอบ/ลูกค้ากลับแล้ว']

export default function StaffKitchen() {
  useTick(10000)
  const store = useStore()
  const [station, setStation] = useState('all')
  const [cancelling, setCancelling] = useState(null)

  const all = store.kitchenTickets()
  const tickets = all
    .map((t) => ({ ...t, items: station === 'all' ? t.items : t.items.filter((i) => i.station_id === station) }))
    .filter((t) => t.items.length > 0)

  const countFor = (id) =>
    all.reduce((n, t) => n + t.items.filter((i) => id === 'all' || i.station_id === id).length, 0)

  const late = tickets.filter((t) => minutesSince(t.created_at) >= 12).length

  return (
    <>
      <TopBar title="จอครัว" sub="เรียงตามเวลาที่สั่ง ใบเก่าที่สุดอยู่ซ้ายบน">
        <Chip tone="neutral">{tickets.length} ใบ</Chip>
        <Chip tone="brand">{countFor(station)} จาน</Chip>
        {late > 0 && <Chip tone="warn" icon="alert">ช้า {late} ใบ</Chip>}
      </TopBar>

      <div className="body">
        <div className="row g8 wrap scroll-x" style={{ marginBottom: 16 }}>
          <button className={`tab ${station === 'all' ? 'tab--on' : ''}`} onClick={() => setStation('all')}>
            ทุกสถานี · {countFor('all')}
          </button>
          {store.stations.map((s) => (
            <button key={s.id} className={`tab ${station === s.id ? 'tab--on' : ''}`} onClick={() => setStation(s.id)}>
              {s.name} · {countFor(s.id)}
            </button>
          ))}
        </div>

        {tickets.length === 0 && (
          <Empty icon="check" title="ไม่มีออเดอร์ค้าง" hint="ทำครบทุกจานแล้ว" />
        )}

        <div className="kds">
          {tickets.map((t) => {
            const age = minutesSince(t.created_at)
            const tone = age >= 12 ? 'late' : age >= 6 ? 'aging' : ''
            const pend = t.items.filter((i) => i.status === 'pending')
            const prep = t.items.filter((i) => i.status === 'preparing')

            return (
              <div key={t.id} className="tkt">
                <div className={`tkt__hd ${tone ? `tkt__hd--${tone}` : ''}`}>
                  <div className="between">
                    <span className="t-head">โต๊ะ {t.table?.table_number}</span>
                    <span className="row g4 num bold t-sm">
                      <Icon name="clock" size={14} /> {age} น.
                    </span>
                  </div>
                  <p className="t-xs" style={{ opacity: .78, marginTop: 1 }}>
                    รอบที่ {t.order_number} · {clockTH(t.created_at)} · {t.visit?.package_name_snapshot}
                  </p>
                </div>

                {t.items.map((it) => (
                  <div key={it.id} className="tkt__row">
                    <span className="tkt__q">{it.quantity}</span>
                    <span className="grow">
                      <span className="bold t-sm">{it.name_snapshot}</span>
                      {it.note && (
                        <span className="t-xs" style={{ display: 'block', color: 'var(--brand)' }}>
                          {it.note}
                        </span>
                      )}
                    </span>
                    <button className="btn btn--sm btn--quiet" title="ยกเลิกรายการนี้"
                            onClick={() => setCancelling({ item: it, table: t.table })}>
                      <Icon name="close" size={14} />
                    </button>
                    {ORDER_STATUS[it.status].next && (
                      <button className="btn btn--sm btn--default"
                              onClick={() => store.dispatch({
                                type: 'ADVANCE_ITEM', itemId: it.id, next: ORDER_STATUS[it.status].next,
                              })}>
                        {ORDER_STATUS[ORDER_STATUS[it.status].next].label}
                      </button>
                    )}
                  </div>
                ))}

                {(pend.length > 0 || prep.length > 0) && (
                  <div className="tkt__ft">
                    {pend.length > 0 && (
                      <button className="btn btn--default btn--sm grow"
                              onClick={() => store.dispatch({ type: 'BUMP_ORDER', orderId: t.id, from: 'pending', to: 'preparing' })}>
                        เริ่มทำทั้งใบ · {pend.length}
                      </button>
                    )}
                    {prep.length > 0 && (
                      <button className="btn btn--primary btn--sm grow"
                              onClick={() => store.dispatch({ type: 'BUMP_ORDER', orderId: t.id, from: 'preparing', to: 'ready' })}>
                        พร้อมเสิร์ฟทั้งใบ · {prep.length}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {cancelling && (
        <CancelSheet {...cancelling} store={store} onClose={() => setCancelling(null)} />
      )}
    </>
  )
}

function CancelSheet({ item, table, store, onClose }) {
  const [busy, setBusy] = useState(false)

  async function cancel(reason) {
    setBusy(true)
    await store.dispatch({ type: 'ADVANCE_ITEM', itemId: item.id, next: 'cancelled', reason })
    onClose()
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd">
          <h3 className="t-title">ยกเลิก {item.name_snapshot} × {item.quantity}</h3>
          <p className="t-xs muted" style={{ marginTop: 3 }}>
            โต๊ะ {table?.table_number ?? '—'} · เลือกเหตุผลเพื่อบันทึกลงบิลและ audit
          </p>
        </div>
        <div className="sheet__bd">
          <div className="stack g8">
            {CANCEL_REASONS.map((r) => (
              <button key={r} className="btn btn--default btn--block" disabled={busy}
                      onClick={() => cancel(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="sheet__ft">
          <button className="btn btn--quiet grow" onClick={onClose}>ไม่ยกเลิก</button>
        </div>
      </div>
    </div>
  )
}
