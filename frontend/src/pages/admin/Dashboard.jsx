import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { baht, previewBill } from '../../utils/money'

export default function AdminDashboard() {
  const store = useStore()
  const d = store.dashboard

  const occupied = store.tables.filter((t) => t.status === 'occupied').length
  const free = store.tables.filter((t) => t.status === 'available').length
  const peak = Math.max(...d.hourly.map((h) => h.v))

  const live = store.tables.map((t) => {
    const v = store.activeVisitOf(t.id)
    if (!v) return { table: t, total: 0, guests: 0, visit: null }
    const bill = previewBill({
      visit: v, addons: v.addons,
      extraItems: store.extraItemsOf(v.id), settings: store.settings,
    })
    return { table: t, total: bill.total, guests: v.adult_count + v.child_count, visit: v }
  })
  const liveTotal = live.reduce((n, r) => n + r.total, 0)

  const today = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <>
      <TopBar title="ภาพรวมร้าน" sub={today}>
        <Chip tone="neutral" icon="refresh">อัปเดตอัตโนมัติ</Chip>
      </TopBar>

      <div className="body">
        <div className="stats">
          <Stat label="ยอดขายวันนี้" value={baht(d.salesTodaySatang)} hint={`${d.billsToday} บิล`} />
          <Stat label="ลูกค้าวันนี้" value={`${d.guestsToday} คน`} hint={`เฉลี่ย ${baht(d.avgPerHeadSatang)} ต่อท่าน`} />
          <Stat label="โต๊ะกำลังใช้งาน" value={`${occupied} / ${store.tables.length}`} hint={`ว่าง ${free} โต๊ะ`} />
          <Stat label="ยอดค้างในร้าน" value={baht(liveTotal)} hint="รวมทุกโต๊ะที่ยังไม่ปิดบิล" />
        </div>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', marginTop: 18 }}>
          <div className="card pad">
            <div className="between" style={{ marginBottom: 16 }}>
              <h3 className="t-head">ช่วงเวลาที่ลูกค้าเยอะ</h3>
              <span className="t-xs muted">จำนวนโต๊ะที่เปิด</span>
            </div>
            <div className="bars">
              {d.hourly.map((h) => (
                <div key={h.h} title={`${h.h}:00 — ${h.v} โต๊ะ`}>
                  <span className="t-xs bold num">{h.v}</span>
                  <div className={`b ${h.v === peak ? 'b--peak' : ''}`} style={{ height: `${(h.v / peak) * 100}%` }} />
                  <span className="x">{h.h}</span>
                </div>
              ))}
            </div>
            <p className="t-xs muted" style={{ marginTop: 14 }}>
              พีคช่วง <b>18:00–20:00</b> — ควรจัดพนักงานครัวเพิ่มในช่วงนี้
            </p>
          </div>

          <div className="card pad">
            <h3 className="t-head" style={{ marginBottom: 12 }}>เมนูขายดี</h3>
            {d.topItems.map((m, i) => (
              <div key={m.name} className="rank">
                <span className="rank__n">{i + 1}</span>
                <span className="grow">
                  <span className="between t-sm" style={{ marginBottom: 4 }}>
                    <span className="trunc">{m.name}</span>
                    <span className="muted num">{m.qty}</span>
                  </span>
                  <span className="meter" style={{ display: 'block' }}>
                    <i style={{ width: `${(m.qty / d.topItems[0].qty) * 100}%`, background: 'var(--brand)' }} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(288px, 1fr))', marginTop: 16 }}>
          <Split title="สัดส่วนแพ็กเกจ" rows={d.packageMix} />
          <Split title="วิธีชำระเงิน" rows={d.paymentMix} />
        </div>

        <div className="between" style={{ margin: '24px 0 10px' }}>
          <h3 className="t-head">รายได้ต่อโต๊ะ (รอบที่เปิดอยู่)</h3>
          <span className="t-xs muted">คำนวณจากยอดปัจจุบันของแต่ละโต๊ะ</span>
        </div>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>โต๊ะ</th><th>สถานะ</th><th>แพ็กเกจ</th>
                <th className="num">จำนวนคน</th><th className="num">ยอดปัจจุบัน</th><th className="num">ต่อหัว</th>
              </tr>
            </thead>
            <tbody>
              {live.map((r) => (
                <tr key={r.table.id}>
                  <td><b>{r.table.table_number}</b></td>
                  <td className="muted">
                    {r.visit ? 'กำลังใช้งาน' : r.table.status === 'cleaning' ? 'รอทำความสะอาด' : 'ว่าง'}
                  </td>
                  <td className="muted">{r.visit?.package_name_snapshot ?? '—'}</td>
                  <td className="num">{r.guests || '—'}</td>
                  <td className="num bold">{r.total ? baht(r.total) : '—'}</td>
                  <td className="num">{r.guests ? baht(Math.round(r.total / r.guests)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <p className="t-label">{label}</p>
      <p className="stat__v">{value}</p>
      <p className="t-xs muted">{hint}</p>
    </div>
  )
}

function Split({ title, rows }) {
  return (
    <div className="card pad">
      <h3 className="t-head" style={{ marginBottom: 12 }}>{title}</h3>
      {rows.map((r) => (
        <div key={r.name} style={{ marginBottom: 11 }}>
          <div className="between t-sm" style={{ marginBottom: 5 }}>
            <span>{r.name}</span><span className="bold num">{r.pct}%</span>
          </div>
          <div className="meter"><i style={{ width: `${r.pct}%`, background: 'var(--n600)' }} /></div>
        </div>
      ))}
    </div>
  )
}
