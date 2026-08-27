import { useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, TimeMeter, Countdown, Note, Kv, TableSlip, useTick } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { TABLE_STATUS, SERVICE_TYPES, VISIT_STATUS } from '../../data/constants'
import { baht, previewBill } from '../../utils/money'
import { clockTH, remaining } from '../../utils/time'

export default function StaffFloor() {
  useTick(10000)
  const store = useStore()
  const [openId, setOpenId] = useState(null)
  const [seatFor, setSeatFor] = useState(null)
  const [slip, setSlip] = useState(null)   // ใบรับประทานที่เพิ่งออก
  const [zone, setZone] = useState('all')

  const activeVisit = store.activeVisitOf

  const counts = store.tables.reduce((a, t) => ({ ...a, [t.status]: (a[t.status] ?? 0) + 1 }), {})
  const zones = [...new Set(store.tables.map((t) => t.zone))]
  const shown = zone === 'all' ? store.tables : store.tables.filter((t) => t.zone === zone)

  const requests = store.openRequests()
  const drawerTable = store.tables.find((t) => t.id === openId)
  const drawerVisit = drawerTable && activeVisit(drawerTable.id)

  return (
    <>
      <TopBar title="ผังโต๊ะ" sub={`${store.tables.length} โต๊ะ · อัปเดตอัตโนมัติ`}>
        <Chip tone="ok">ว่าง {counts.available ?? 0}</Chip>
        <Chip tone="brand">ใช้งาน {counts.occupied ?? 0}</Chip>
        <Chip tone="warn">รอเก็บ {counts.cleaning ?? 0}</Chip>
      </TopBar>

      <div className="body">
        {requests.length > 0 && (
          <div className="card pad" style={{ marginBottom: 16, borderColor: 'var(--gold-line)', background: 'var(--gold-soft)' }}>
            <div className="row g8" style={{ marginBottom: 10, color: 'var(--gold)' }}>
              <Icon name="bell" size={17} />
              <span className="bold t-sm">ลูกค้าเรียก {requests.length} รายการ</span>
            </div>
            <div className="row g8 wrap">
              {requests.map((r) => (
                <button key={r.id} className="btn btn--default btn--sm"
                        onClick={() => store.dispatch({ type: 'RESOLVE_REQUEST', id: r.id })}>
                  <Icon name={SERVICE_TYPES[r.type].icon} size={15} />
                  โต๊ะ {r.table?.table_number} · {SERVICE_TYPES[r.type].label}
                  <Icon name="check" size={14} strokeWidth={2} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="row g8 wrap" style={{ marginBottom: 14 }}>
          <button className={`tab ${zone === 'all' ? 'tab--on' : ''}`} onClick={() => setZone('all')}>
            ทุกโซน
          </button>
          {zones.map((z) => (
            <button key={z} className={`tab ${zone === z ? 'tab--on' : ''}`} onClick={() => setZone(z)}>
              โซน {z}
            </button>
          ))}
        </div>

        <div className="floor">
          {shown.map((t) => {
            const v = activeVisit(t.id)
            const meta = TABLE_STATUS[t.status]
            const r = v ? remaining(v.dining_deadline_at) : null
            const fresh = v
              ? store.ordersOf(v.id).flatMap((o) => o.items).filter((i) => i.status === 'pending').length
              : 0
            const called = requests.some((x) => x.table_id === t.id)

            return (
              <button key={t.id} className={`tcard ${meta.cls}`} onClick={() => setOpenId(t.id)}>
                <div className="tcard__flags">
                  {fresh > 0 && <Chip tone="brand">{fresh} ใหม่</Chip>}
                  {called && <Chip tone="gold" icon="bell" />}
                </div>

                <p className="tcard__no">{t.table_number}</p>
                <p className="t-xs muted">{t.capacity} ที่นั่ง</p>

                <div style={{ marginTop: 9 }}>
                  <Chip tone={meta.tone}>{meta.label}</Chip>
                </div>

                {v && (
                  <div style={{ marginTop: 11 }}>
                    <div className="between t-xs" style={{ marginBottom: 5 }}>
                      <span className="trunc muted">
                        {v.package_name_snapshot} · {v.adult_count + v.child_count} ท่าน
                      </span>
                      <span className="num bold" style={{ color: r.over ? 'var(--danger)' : 'var(--n200)' }}>
                        {r.over ? 'หมดเวลา' : `${r.totalMinutes} น.`}
                      </span>
                    </div>
                    <TimeMeter start={v.check_in_at} deadline={v.dining_deadline_at} />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {drawerTable && (
        <div className="sheet" onClick={() => setOpenId(null)}>
          <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__hd between">
              <div>
                <h3 className="t-title">โต๊ะ {drawerTable.table_number}</h3>
                <p className="t-xs muted">{drawerTable.capacity} ที่นั่ง · โซน {drawerTable.zone}</p>
              </div>
              <Chip tone={TABLE_STATUS[drawerTable.status].tone}>
                {TABLE_STATUS[drawerTable.status].label}
              </Chip>
            </div>

            <div className="sheet__bd">
              {drawerVisit ? (
                <VisitPanel visit={drawerVisit} store={store} onDone={() => setOpenId(null)} />
              ) : drawerTable.status === 'cleaning' ? (
                <Note tone="warn" icon="refresh">
                  โต๊ะนี้รอทำความสะอาด กดปุ่มด้านล่างเมื่อเก็บโต๊ะเสร็จเพื่อคืนสถานะเป็นว่าง
                </Note>
              ) : (
                <Note tone="ok" icon="check">
                  โต๊ะว่าง พร้อมรับลูกค้า กดเปิดโต๊ะเพื่อเลือกแพ็กเกจและออก QR ให้ลูกค้า
                </Note>
              )}
            </div>

            <div className="sheet__ft">
              <button className="btn btn--default" onClick={() => setOpenId(null)}>ปิด</button>
              {!drawerVisit && drawerTable.status === 'available' && (
                <button className="btn btn--primary grow"
                        onClick={() => { setSeatFor(drawerTable); setOpenId(null) }}>
                  <Icon name="users" size={16} /> เปิดโต๊ะ
                </button>
              )}
              {drawerTable.status === 'cleaning' && (
                <button className="btn btn--primary grow"
                        onClick={() => { store.dispatch({ type: 'CLEAN_TABLE', tableId: drawerTable.id }); setOpenId(null) }}>
                  <Icon name="check" size={16} strokeWidth={2} /> เก็บโต๊ะเสร็จแล้ว
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {seatFor && (
        <SeatSheet
          table={seatFor} store={store}
          onClose={() => setSeatFor(null)}
          onSeated={(visit, table) => { setSeatFor(null); setSlip({ visit, table }) }}
        />
      )}
      {slip && (
        <TableSlip visit={slip.visit} tableNumber={slip.table.table_number} onClose={() => setSlip(null)} />
      )}
    </>
  )
}

function VisitPanel({ visit, store, onDone }) {
  const [editing, setEditing] = useState(false)
  const extras = store.extraItemsOf(visit.id)
  const bill = previewBill({ visit, addons: visit.addons, extraItems: extras, settings: store.settings })
  const orders = store.ordersOf(visit.id)

  return (
    <>
      <div className="between" style={{ marginBottom: 12 }}>
        <span className="t-sm muted num">{visit.visit_code}</span>
        <Chip tone={VISIT_STATUS[visit.status].tone}>{VISIT_STATUS[visit.status].label}</Chip>
      </div>

      <div className="stats" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        <div className="stat">
          <p className="t-label">เวลาที่เหลือ</p>
          <p className="stat__v" style={{ fontSize: 19 }}>
            <Countdown deadline={visit.dining_deadline_at} />
          </p>
          <p className="t-xs muted">เข้าร้าน {clockTH(visit.check_in_at)}</p>
        </div>
        <div className="stat">
          <p className="t-label">ยอดปัจจุบัน</p>
          <p className="stat__v" style={{ fontSize: 19 }}>{baht(bill.total)}</p>
          <p className="t-xs muted">{orders.length} รอบ · {visit.adult_count + visit.child_count} ท่าน</p>
        </div>
      </div>

      <div className="stack g8">
        <Kv label="แพ็กเกจ" value={visit.package_name_snapshot} mono={false} />
        <div className="between t-sm">
          <span className="muted">ผู้ใหญ่ / เด็ก</span>
          <span className="row g8">
            <span className="bold num">{visit.adult_count} / {visit.child_count}</span>
            {visit.status === 'open' && (
              <button className="btn btn--quiet btn--sm" onClick={() => setEditing(true)}>
                <Icon name="users" size={14} /> แก้
              </button>
            )}
          </span>
        </div>
        {visit.addons.map((a) => (
          <Kv key={a.add_on_id} label={a.name_snapshot} value={`${a.quantity} ท่าน`} />
        ))}
        <Kv label="รหัสเข้าโต๊ะ" value={visit.access_code ?? '—'} />
      </div>

      {editing && <GuestSheet visit={visit} store={store} onClose={() => setEditing(false)} />}

      {visit.status === 'paid' && (
        <button className="btn btn--primary btn--block" style={{ marginTop: 16 }}
                onClick={() => { store.dispatch({ type: 'CLOSE_VISIT', visitId: visit.id }); onDone() }}>
          ปิดรอบ · ส่งโต๊ะไปทำความสะอาด
        </button>
      )}
    </>
  )
}


// เพื่อนมาเพิ่มระหว่างมื้อ หรือเปิดจำนวนคนผิดตั้งแต่แรก
// แก้ได้เฉพาะตอนยังเป็น open — ขอบิลแล้วฐานข้อมูลจะปฏิเสธเอง
function GuestSheet({ visit, store, onClose }) {
  const [adults, setAdults] = useState(visit.adult_count)
  const [children, setChildren] = useState(visit.child_count)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function save() {
    setBusy(true); setError(null)
    try {
      await store.adjustGuests(visit.id, adults, children)
      onClose()
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd">
          <h3 className="t-title">แก้จำนวนคน</h3>
          <p className="t-xs muted" style={{ marginTop: 3 }}>
            ออเดอร์ที่สั่งไปแล้วไม่ถูกแตะ · ราคายังเป็นราคาตอนเปิดโต๊ะ
          </p>
        </div>
        <div className="sheet__bd">
          <div className="row g12">
            <label className="field grow">
              <span>ผู้ใหญ่</span>
              <input type="number" min="0" value={adults}
                     onChange={(e) => setAdults(Math.max(0, +e.target.value || 0))} />
            </label>
            <label className="field grow">
              <span>เด็ก</span>
              <input type="number" min="0" value={children}
                     onChange={(e) => setChildren(Math.max(0, +e.target.value || 0))} />
            </label>
          </div>
          <p className="t-sm muted">รวม {adults + children} ท่าน</p>
          {error && <div style={{ marginTop: 12 }}><Note tone="warn" icon="alert">{error}</Note></div>}
        </div>
        <div className="sheet__ft">
          <button className="btn btn--default" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn--primary grow" disabled={busy || adults + children < 1} onClick={save}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SeatSheet({ table, store, onClose, onSeated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [pkgId, setPkg] = useState(store.packages[0].id)
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [refill, setRefill] = useState(true)

  const pkg = store.packages.find((p) => p.id === pkgId)
  const addon = store.addOns[0]
  const guests = adults + children
  const total = adults * pkg.price_per_adult_satang
    + children * pkg.price_per_child_satang
    + (refill ? addon.price_satang * guests : 0)

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd">
          <h3 className="t-title">เปิดโต๊ะ {table.table_number}</h3>
          <p className="t-xs muted" style={{ marginTop: 3 }}>
            ทั้งโต๊ะใช้แพ็กเกจเดียวกัน ระบบจะออก QR และรหัส 6 หลักบนสลิปให้ลูกค้า
          </p>
        </div>

        <div className="sheet__bd">
          <label className="field">
            <span>แพ็กเกจบุฟเฟต์</span>
            <select value={pkgId} onChange={(e) => setPkg(e.target.value)}>
              {store.packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {baht(p.price_per_adult_satang)}/ผู้ใหญ่ · {p.dining_minutes} นาที
                </option>
              ))}
            </select>
          </label>

          <div className="row g12">
            <label className="field grow">
              <span>ผู้ใหญ่</span>
              <input type="number" min="0" value={adults}
                     onChange={(e) => setAdults(Math.max(0, +e.target.value))} />
            </label>
            <label className="field grow">
              <span>เด็ก (ไม่เกิน {pkg.child_max_age} ปี)</span>
              <input type="number" min="0" value={children}
                     onChange={(e) => setChildren(Math.max(0, +e.target.value))} />
            </label>
          </div>

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

          {guests > table.capacity && (
            <div style={{ marginTop: 12 }}>
              <Note tone="warn">จำนวน {guests} ท่าน เกินความจุโต๊ะ ({table.capacity} ที่นั่ง)</Note>
            </div>
          )}

          <div className="between" style={{ marginTop: 16, paddingTop: 13, borderTop: '1px solid var(--n200)' }}>
            <span className="t-head">ยอดบุฟเฟต์เริ่มต้น</span>
            <span className="t-title num">{baht(total)}</span>
          </div>
        </div>

        <div className="sheet__ft">
          <button className="btn btn--default" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn--primary grow" disabled={guests < 1 || busy}
                  onClick={async () => {
                    setBusy(true); setError(null)
                    try {
                      const visit = await store.seatTable({
                        tableId: table.id, packageId: pkgId, adults, children, refill,
                      })
                      onSeated(visit, table)
                    } catch (e) { setError(e.message); setBusy(false) }
                  }}>
            <Icon name="printer" size={16} /> {busy ? 'กำลังเปิดโต๊ะ…' : 'เปิดโต๊ะ & พิมพ์ใบรับประทาน'}
          </button>
        </div>
      </div>
    </div>
  )
}
