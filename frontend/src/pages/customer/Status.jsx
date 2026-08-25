import { useStore } from '../../context/StoreProvider'
import { CustomerBar } from '../../components/layout/Layouts'
import { Chip, Empty, useTick } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { ORDER_STATUS, ORDER_FLOW } from '../../data/constants'
import { clockTH, minutesSince } from '../../utils/time'

export default function CustomerStatus() {
  useTick(20000)
  const store = useStore()
  const visit = store.visitOf(store.customerVisitId)
  const table = store.tableOf(visit.table_id)
  const orders = store.ordersOf(visit.id).slice().reverse()

  const all = orders.flatMap((o) => o.items)
  const waiting = all.filter((i) => i.status !== 'served' && i.status !== 'cancelled').length

  return (
    <>
      <CustomerBar title="ติดตามออเดอร์" back="/order" />

      <div className="cx__wrap">
        <div className="card pad" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-around', textAlign: 'center' }}>
            <Metric label="โต๊ะ" value={table.table_number} />
            <Metric label="สั่งแล้ว" value={`${orders.length} รอบ`} />
            <Metric label="รออยู่" value={`${waiting} จาน`} />
            <Metric label="เข้าร้าน" value={clockTH(visit.check_in_at)} />
          </div>
        </div>

        {orders.length === 0 && (
          <Empty icon="menuBook" title="ยังไม่มีออเดอร์" hint="เลือกอาหารจากหน้าเมนูได้เลยค่ะ" />
        )}

        <div className="cx__cols" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>
          {orders.map((o) => {
            const done = o.items.every((i) => i.status === 'served' || i.status === 'cancelled')
            const mins = minutesSince(o.created_at)

            return (
              <div key={o.id} className="card">
                <div className="between pad-s" style={{ borderBottom: '1px solid var(--n100)' }}>
                  <div>
                    <p className="bold t-sm">รอบที่ {o.order_number}</p>
                    <p className="t-xs muted">
                      {clockTH(o.created_at)} · {mins < 1 ? 'เมื่อสักครู่' : `${mins} นาทีที่แล้ว`}
                    </p>
                  </div>
                  <Chip tone={done ? 'ok' : 'warn'} icon={done ? 'check' : 'clock'}>
                    {done ? 'เสิร์ฟครบ' : 'กำลังดำเนินการ'}
                  </Chip>
                </div>

                <div className="pad-s">
                  {o.items.map((it) => {
                    const at = ORDER_FLOW.indexOf(it.status)
                    return (
                      <div key={it.id} style={{ padding: '8px 0' }}>
                        <div className="between" style={{ marginBottom: 6 }}>
                          <span className="t-sm">
                            <span className="bold">{it.name_snapshot}</span>
                            <span className="muted num"> × {it.quantity}</span>
                          </span>
                          <Chip tone={ORDER_STATUS[it.status].tone}>
                            {ORDER_STATUS[it.status].label}
                          </Chip>
                        </div>
                        {it.status !== 'cancelled' && (
                          <div className="steps">
                            {ORDER_FLOW.map((st, i) => (
                              <i key={st} className={i <= at ? 'on' : ''} title={ORDER_STATUS[st].label} />
                            ))}
                          </div>
                        )}
                        {it.note && (
                          <p className="t-xs" style={{ color: 'var(--brand)', marginTop: 5 }}>
                            หมายเหตุ: {it.note}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <p className="t-xs dim center" style={{ marginTop: 20, textAlign: 'center', lineHeight: 1.8 }}>
          สถานะอัปเดตอัตโนมัติเมื่อครัวกดเปลี่ยน<br />
          ของจริงใช้ Supabase Realtime — ในเดโมลองเปิดจอครัวอีกแท็บแล้วกดเปลี่ยนสถานะดูได้
        </p>
      </div>
    </>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="t-xs muted">{label}</p>
      <p className="t-title num" style={{ marginTop: 2 }}>{value}</p>
    </div>
  )
}
