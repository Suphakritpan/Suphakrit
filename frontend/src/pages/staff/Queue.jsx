import { useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Empty, Note, Kv, useTick } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { baht } from '../../utils/money'
import { minutesSince } from '../../utils/time'

export default function StaffQueue() {
  useTick(20000)
  const store = useStore()
  const [seating, setSeating] = useState(null)

  const waiting = store.queueTickets.filter((q) => q.status === 'waiting' || q.status === 'called')
  const free = store.tables.filter((t) => t.status === 'available')

  return (
    <>
      <TopBar title="คิวหน้าร้าน" sub="เรียงตามลำดับที่มาถึง">
        <Chip tone="warn">รอ {waiting.length} คิว</Chip>
        <Chip tone="ok">โต๊ะว่าง {free.length}</Chip>
      </TopBar>

      <div className="body">
        {free.length === 0 && waiting.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Note tone="warn" icon="alert">
              ยังไม่มีโต๊ะว่าง — ต้องรอโต๊ะที่อยู่ระหว่างทำความสะอาดก่อน
              ดูได้ที่หน้าผังโต๊ะ
            </Note>
          </div>
        )}

        {waiting.length === 0 && (
          <Empty icon="ticket" title="ไม่มีคิวรออยู่" hint="ลูกค้าเดินเข้าได้เลย" />
        )}

        <div className="kds">
          {waiting.map((q) => {
            const fits = free.filter((t) => t.capacity >= q.party_size)
            const waited = minutesSince(q.created_at)

            return (
              <div key={q.id} className="card pad">
                <div className="between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <p className="t-label">หมายเลขคิว</p>
                    <p className="t-display num" style={{ fontSize: 30, lineHeight: 1.1 }}>{q.ticket_number}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Chip tone={q.status === 'called' ? 'info' : 'warn'}>
                      {q.status === 'called' ? 'เรียกแล้ว' : 'รออยู่'}
                    </Chip>
                    <p className="t-xs muted num" style={{ marginTop: 6 }}>
                      รอ {waited} นาที
                    </p>
                  </div>
                </div>

                <div className="stack g8" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--n100)' }}>
                  <Kv label="ชื่อ" value={q.customer_name} mono={false} />
                  <Kv label="เบอร์โทร" value={q.phone} />
                  <Kv label="จำนวน" value={`${q.party_size} ท่าน`} />
                  <Kv
                    label="โต๊ะที่รองรับได้"
                    value={fits.length ? fits.map((t) => t.table_number).join(', ') : 'ยังไม่มี'}
                  />
                </div>

                <div className="row g8" style={{ marginTop: 14 }}>
                  <button className="btn btn--default btn--sm grow">
                    <Icon name="bell" size={15} /> เรียกคิว
                  </button>
                  <button className="btn btn--primary btn--sm grow" disabled={!fits.length}
                          onClick={() => setSeating({ ticket: q, tables: fits })}>
                    <Icon name="users" size={15} /> จัดโต๊ะ
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {seating && <SeatFromQueue {...seating} store={store} onClose={() => setSeating(null)} />}
    </>
  )
}


function SeatFromQueue({ ticket, tables, store, onClose }) {
  const [tableId, setTableId] = useState(tables[0].id)
  const [pkgId, setPkg] = useState(store.packages[0].id)
  const [refill, setRefill] = useState(true)

  const pkg = store.packages.find((p) => p.id === pkgId)
  const addon = store.addOns[0]
  const total = ticket.party_size * pkg.price_per_adult_satang
    + (refill ? addon.price_satang * ticket.party_size : 0)

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd">
          <h3 className="t-title">จัดโต๊ะให้คิว {ticket.ticket_number}</h3>
          <p className="t-xs muted" style={{ marginTop: 3 }}>
            {ticket.customer_name} · {ticket.party_size} ท่าน
          </p>
        </div>

        <div className="sheet__bd">
          <label className="field">
            <span>เลือกโต๊ะ</span>
            <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  โต๊ะ {t.table_number} · {t.capacity} ที่นั่ง · โซน {t.zone}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>แพ็กเกจบุฟเฟต์ (ทั้งโต๊ะใช้แพ็กเกจเดียวกัน)</span>
            <select value={pkgId} onChange={(e) => setPkg(e.target.value)}>
              {store.packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {baht(p.price_per_adult_satang)}/ท่าน · {p.dining_minutes} นาที
                </option>
              ))}
            </select>
          </label>

          <button className={`pay ${refill ? 'pay--on' : ''}`} onClick={() => setRefill(!refill)}>
            <span className="pay__ico"><Icon name="refresh" size={17} /></span>
            <span className="grow">
              <span className="bold t-sm">{addon.name}</span>
              <span className="t-xs muted" style={{ display: 'block' }}>
                {baht(addon.price_satang)} × {ticket.party_size} ท่าน
              </span>
            </span>
            {refill && <span className="pay__check"><Icon name="check" size={17} strokeWidth={2} /></span>}
          </button>

          <div className="between" style={{ marginTop: 16, paddingTop: 13, borderTop: '1px solid var(--n200)' }}>
            <span className="t-head">ยอดบุฟเฟต์เริ่มต้น</span>
            <span className="t-title num">{baht(total)}</span>
          </div>
        </div>

        <div className="sheet__ft">
          <button className="btn btn--default" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn--primary grow"
                  onClick={() => {
                    store.dispatch({
                      type: 'SEAT_TABLE', tableId, packageId: pkgId,
                      adults: ticket.party_size, children: 0, refill, queueId: ticket.id,
                    })
                    onClose()
                  }}>
            <Icon name="printer" size={16} /> เปิดโต๊ะ & พิมพ์สลิป QR
          </button>
        </div>
      </div>
    </div>
  )
}
