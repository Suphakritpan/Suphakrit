import { useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Empty, Note, Kv, QR, TableSlip, useTick } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { baht } from '../../utils/money'
import { minutesSince } from '../../utils/time'

export default function StaffQueue() {
  useTick(20000)
  const store = useStore()
  const [seating, setSeating] = useState(null)
  const [issuing, setIssuing] = useState(false)
  const [slip, setSlip] = useState(null)      // บัตรคิวที่เพิ่งออก
  const [tableSlip, setTableSlip] = useState(null)  // ใบรับประทานหลังจัดโต๊ะ

  const waiting = store.queueTickets.filter((q) => q.status === 'waiting' || q.status === 'called')
  const free = store.tables.filter((t) => t.status === 'available')

  return (
    <>
      <TopBar title="คิวหน้าร้าน" sub="เรียงตามลำดับที่มาถึง">
        <Chip tone="warn">รอ {waiting.length} คิว</Chip>
        <Chip tone="ok">โต๊ะว่าง {free.length}</Chip>
        <button className="btn btn--primary btn--sm no-print" onClick={() => setIssuing(true)}>
          <Icon name="ticket" size={15} /> ออกบัตรคิว
        </button>
      </TopBar>

      <div className="body">
        <QueueBoard waiting={waiting} store={store} />

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
                  <button className="btn btn--default btn--sm grow"
                          disabled={q.status === 'called'}
                          onClick={() => store.dispatch({ type: 'CALL_QUEUE', id: q.id })}>
                    <Icon name="bell" size={15} /> {q.status === 'called' ? 'เรียกแล้ว' : 'เรียกคิว'}
                  </button>
                  <button className="btn btn--primary btn--sm grow" disabled={!fits.length}
                          onClick={() => setSeating({ ticket: q, tables: fits })}>
                    <Icon name="users" size={15} /> จัดโต๊ะ
                  </button>
                </div>

                <div className="row g8" style={{ marginTop: 8 }}>
                  <button className="btn btn--quiet btn--sm grow" onClick={() => setSlip(q)}>
                    <Icon name="printer" size={15} /> พิมพ์บัตรซ้ำ
                  </button>
                  <button className="btn btn--quiet btn--sm grow"
                          onClick={() => store.dispatch({ type: 'CANCEL_QUEUE', id: q.id })}>
                    <Icon name="close" size={15} /> ยกเลิก
                  </button>
                  {q.status === 'called' && (
                    <button className="btn btn--quiet btn--sm grow"
                            onClick={() => store.dispatch({ type: 'CANCEL_QUEUE', id: q.id, noShow: true })}>
                      <Icon name="alert" size={15} /> ไม่มาตามเรียก
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {seating && (
        <SeatFromQueue
          {...seating} store={store}
          onClose={() => setSeating(null)}
          onSeated={(visit, table) => { setSeating(null); setTableSlip({ visit, table }) }}
        />
      )}
      {tableSlip && (
        <TableSlip visit={tableSlip.visit} tableNumber={tableSlip.table.table_number}
                   onClose={() => setTableSlip(null)} />
      )}
      {issuing && (
        <IssueSheet
          store={store}
          onClose={() => setIssuing(false)}
          onIssued={(t) => { setIssuing(false); setSlip(t) }}
        />
      )}
      {slip && <QueueSlip ticket={slip} onClose={() => setSlip(null)} />}
    </>
  )
}

// ── Queue Dashboard ──────────────────────────────────────────────────────────
// หัวใจของหน้าคิว: พนักงานเห็นสถานะทั้งหมดในจอเดียว ไม่ต้องสลับหน้า
// NOW SERVING / คิวถัดไป / โต๊ะที่รองรับได้ / สรุปสถานะโต๊ะ
function QueueBoard({ waiting, store }) {
  const called = waiting.filter((q) => q.status === 'called')
  const nowServing = called.length
    ? Math.max(...called.map((q) => q.ticket_number))
    : null
  const next = waiting.find((q) => q.status === 'waiting')

  const byStatus = store.tables.reduce((a, t) => ({ ...a, [t.status]: (a[t.status] ?? 0) + 1 }), {})
  const free = store.tables.filter((t) => t.status === 'available')
  const suggestion = next
    ? free.filter((t) => t.capacity >= next.party_size)
          .sort((a, b) => a.capacity - b.capacity)[0]
    : null

  return (
    <div className="stats" style={{ marginBottom: 18 }}>
      <div className="stat">
        <p className="t-label">กำลังเรียก</p>
        <p className="stat__v">{nowServing ?? '—'}</p>
        <p className="t-xs muted">{called.length ? `${called.length} คิวที่เรียกแล้ว` : 'ยังไม่ได้เรียกคิวไหน'}</p>
      </div>

      <div className="stat">
        <p className="t-label">คิวถัดไป</p>
        <p className="stat__v">{next ? next.ticket_number : '—'}</p>
        <p className="t-xs muted">
          {next ? `${next.party_size} ท่าน · รออยู่ ${waiting.filter((q) => q.status === 'waiting').length} คิว` : 'ไม่มีคิวรอ'}
        </p>
      </div>

      <div className="stat">
        <p className="t-label">โต๊ะที่แนะนำ</p>
        <p className="stat__v">{suggestion ? suggestion.table_number : '—'}</p>
        <p className="t-xs muted">
          {suggestion
            ? `จุ ${suggestion.capacity} ที่นั่ง · พอดีกับคิว ${next.ticket_number}`
            : next ? 'ยังไม่มีโต๊ะว่างที่จุพอ' : 'รอคิวถัดไป'}
        </p>
      </div>

      <div className="stat">
        <p className="t-label">สถานะโต๊ะ</p>
        <p className="stat__v">{byStatus.available ?? 0}<span className="t-sm muted"> / {store.tables.length}</span></p>
        <p className="t-xs muted">
          ว่าง {byStatus.available ?? 0} · รอเก็บ {byStatus.cleaning ?? 0} · ใช้งาน {byStatus.occupied ?? 0}
        </p>
      </div>
    </div>
  )
}

// ── ออกบัตรคิว ───────────────────────────────────────────────────────────────
function IssueSheet({ store, onClose, onIssued }) {
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const party = adults + children

  async function submit() {
    setBusy(true); setError(null)
    try {
      const ticket = await store.issueQueue({ adults, children, customerName: name, phone })
      onIssued(ticket)
    } catch (e) {
      setError(e.message); setBusy(false)
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd">
          <h3 className="t-title">ออกบัตรคิว</h3>
          <p className="t-xs muted" style={{ marginTop: 3 }}>
            เลขคิวรันรายวัน ฐานข้อมูลออกให้อัตโนมัติ
          </p>
        </div>

        <div className="sheet__bd">
          <div className="row g12">
            <label className="field grow">
              <span>ผู้ใหญ่</span>
              <input type="number" min="0" max="50" value={adults}
                     onChange={(e) => setAdults(Math.max(0, +e.target.value || 0))} />
            </label>
            <label className="field grow">
              <span>เด็ก</span>
              <input type="number" min="0" max="50" value={children}
                     onChange={(e) => setChildren(Math.max(0, +e.target.value || 0))} />
            </label>
          </div>
          <p className="t-sm muted" style={{ marginTop: -6, marginBottom: 14 }}>
            รวม {party} ท่าน — ใช้หาโต๊ะที่จุพอตอนเรียกคิว
          </p>
          <label className="field">
            <span>ชื่อ (ไม่บังคับ)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="เรียกตอนถึงคิว" />
          </label>
          <label className="field">
            <span>เบอร์โทร (ไม่บังคับ)</span>
            <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                   placeholder="08X-XXX-XXXX" />
          </label>
          {error && <Note tone="warn" icon="alert">{error}</Note>}
        </div>

        <div className="sheet__ft">
          <button className="btn btn--default" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn--primary grow" disabled={busy || party < 1} onClick={submit}>
            <Icon name="printer" size={16} /> {busy ? 'กำลังออกบัตร…' : 'ออกบัตร & พิมพ์'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── สลิปบัตรคิว ──────────────────────────────────────────────────────────────
// ลูกค้าถือใบนี้ไปยืนรอ สแกน QR เช็คคิวตัวเองได้ตลอดโดยไม่ต้องมายืนถามพนักงาน
function QueueSlip({ ticket, onClose }) {
  const url = `${window.location.origin}/q/${ticket.public_token}`

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd between no-print">
          <h3 className="t-title">บัตรคิว {ticket.ticket_number}</h3>
          <button className="btn btn--quiet btn--icon btn--sm" onClick={onClose}>
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="sheet__bd">
          <div className="slip" style={{ textAlign: 'center' }}>
            <p className="bold">SHABU MOOD</p>
            <p className="t-xs" style={{ marginTop: 2 }}>บัตรคิว</p>

            <p className="num" style={{ fontSize: 60, lineHeight: 1.15, margin: '10px 0 2px' }}>
              {ticket.ticket_number}
            </p>
            <p className="t-sm">
              {ticket.adult_count > 0 && `ผู้ใหญ่ ${ticket.adult_count}`}
              {ticket.child_count > 0 && ` · เด็ก ${ticket.child_count}`}
              {ticket.customer_name ? ` · ${ticket.customer_name}` : ''}
            </p>

            <div className="slip__r" />

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <QR value={url} size={172} />
            </div>
            <p className="t-xs" style={{ marginTop: 8, lineHeight: 1.7 }}>
              สแกนเพื่อดูว่าเหลืออีกกี่คิว<br />
              ไม่ต้องยืนรอหน้าร้าน
            </p>
          </div>
        </div>

        <div className="sheet__ft no-print">
          <button className="btn btn--default" onClick={onClose}>ปิด</button>
          <button className="btn btn--primary grow" onClick={() => window.print()}>
            <Icon name="printer" size={16} /> พิมพ์บัตร
          </button>
        </div>
      </div>
    </div>
  )
}


function SeatFromQueue({ ticket, tables, store, onClose, onSeated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tableId, setTableId] = useState(tables[0].id)
  const [pkgId, setPkg] = useState(store.packages[0].id)
  const [refill, setRefill] = useState(true)

  const pkg = store.packages.find((p) => p.id === pkgId)
  const addon = store.addOns[0]
  const adults = ticket.adult_count ?? ticket.party_size
  const children = ticket.child_count ?? 0
  const guests = adults + children
  const total = adults * pkg.price_per_adult_satang
    + children * pkg.price_per_child_satang
    + (refill ? addon.price_satang * guests : 0)

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd">
          <h3 className="t-title">จัดโต๊ะให้คิว {ticket.ticket_number}</h3>
          <p className="t-xs muted" style={{ marginTop: 3 }}>
            {ticket.customer_name} · ผู้ใหญ่ {adults}{children > 0 ? ` · เด็ก ${children}` : ''}
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
                {baht(addon.price_satang)} × {guests} ท่าน
              </span>
            </span>
            {refill && <span className="pay__check"><Icon name="check" size={17} strokeWidth={2} /></span>}
          </button>

          {error && <div style={{ marginTop: 12 }}><Note tone="warn" icon="alert">{error}</Note></div>}

          <div className="between" style={{ marginTop: 16, paddingTop: 13, borderTop: '1px solid var(--n200)' }}>
            <span className="t-head">ยอดบุฟเฟต์เริ่มต้น</span>
            <span className="t-title num">{baht(total)}</span>
          </div>
        </div>

        <div className="sheet__ft">
          <button className="btn btn--default" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn--primary grow" disabled={busy}
                  onClick={async () => {
                    setBusy(true); setError(null)
                    try {
                      const visit = await store.seatTable({
                        tableId, packageId: pkgId,
                        // ใช้การแยกผู้ใหญ่/เด็กจากบัตรคิว ไม่ใช่ party_size รวม
                        // ไม่งั้นเด็กจะถูกคิดเป็นผู้ใหญ่ = บิลเกินจริง
                        adults: ticket.adult_count ?? ticket.party_size,
                        children: ticket.child_count ?? 0,
                        refill, queueId: ticket.id,
                      })
                      onSeated(visit, tables.find((t) => t.id === tableId))
                    } catch (e) { setError(e.message); setBusy(false) }
                  }}>
            <Icon name="printer" size={16} /> {busy ? 'กำลังเปิดโต๊ะ…' : 'เปิดโต๊ะ & พิมพ์ใบรับประทาน'}
          </button>
        </div>
      </div>
    </div>
  )
}
