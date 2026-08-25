import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Empty, useTick } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { SERVICE_TYPES } from '../../data/constants'
import { minutesSince } from '../../utils/time'

export default function StaffServe() {
  useTick(10000)
  const store = useStore()
  const ready = store.readyToServe()
  const requests = store.openRequests()

  // จัดกลุ่มตามโต๊ะ เพื่อเดินไปเสิร์ฟรอบเดียวจบ
  const byTable = ready.reduce((acc, it) => {
    const key = it.table?.id ?? 'unknown'
    ;(acc[key] ??= { table: it.table, items: [] }).items.push(it)
    return acc
  }, {})

  return (
    <>
      <TopBar title="รอเสิร์ฟ" sub="จัดกลุ่มตามโต๊ะ เดินรอบเดียวเสิร์ฟได้ครบ">
        <Chip tone="info">{ready.length} จาน</Chip>
        {requests.length > 0 && <Chip tone="gold" icon="bell">{requests.length}</Chip>}
      </TopBar>

      <div className="body">
        {requests.length > 0 && (
          <>
            <p className="t-label" style={{ marginBottom: 10 }}>ลูกค้าเรียก</p>
            <div className="row g8 wrap" style={{ marginBottom: 24 }}>
              {requests.map((r) => (
                <div key={r.id} className="card pad-s row g12" style={{ minWidth: 232 }}>
                  <span style={{ color: 'var(--gold)' }}>
                    <Icon name={SERVICE_TYPES[r.type].icon} size={19} />
                  </span>
                  <span className="grow">
                    <span className="bold t-sm">โต๊ะ {r.table?.table_number}</span>
                    <span className="t-xs muted" style={{ display: 'block' }}>
                      {SERVICE_TYPES[r.type].label} · {minutesSince(r.created_at)} น.
                    </span>
                  </span>
                  <button className="btn btn--default btn--sm"
                          onClick={() => store.dispatch({ type: 'RESOLVE_REQUEST', id: r.id })}>
                    <Icon name="check" size={14} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="t-label" style={{ marginBottom: 10 }}>อาหารพร้อมเสิร์ฟ</p>

        {ready.length === 0 && (
          <Empty icon="tray" title="ยังไม่มีอาหารพร้อมเสิร์ฟ" hint="รอครัวกดพร้อมเสิร์ฟก่อน" />
        )}

        <div className="kds">
          {Object.values(byTable).map((g) => (
            <div key={g.table?.id} className="tkt">
              <div className="tkt__hd">
                <div className="between">
                  <span className="t-head">โต๊ะ {g.table?.table_number}</span>
                  <Chip tone="info">{g.items.length} จาน</Chip>
                </div>
              </div>

              {g.items.map((it) => (
                <div key={it.id} className="tkt__row">
                  <span className="tkt__q">{it.quantity}</span>
                  <span className="grow">
                    <span className="bold t-sm">{it.name_snapshot}</span>
                    <span className="t-xs muted" style={{ display: 'block' }}>
                      รอบที่ {it.order.order_number}
                    </span>
                  </span>
                  <button className="btn btn--sm btn--default"
                          onClick={() => store.dispatch({ type: 'ADVANCE_ITEM', itemId: it.id, next: 'served' })}>
                    เสิร์ฟแล้ว
                  </button>
                </div>
              ))}

              <div className="tkt__ft">
                <button className="btn btn--primary btn--sm btn--block"
                        onClick={() => g.items.forEach((it) =>
                          store.dispatch({ type: 'ADVANCE_ITEM', itemId: it.id, next: 'served' }))}>
                  <Icon name="check" size={15} strokeWidth={2} /> เสิร์ฟครบทั้งโต๊ะ
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
