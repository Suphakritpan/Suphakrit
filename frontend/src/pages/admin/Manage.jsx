import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Note, Kv } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { baht } from '../../utils/money'
import { TABLE_STATUS } from '../../data/constants'

// ── แพ็กเกจ & Add-on ────────────────────────────────────────────────────────
export function AdminPackages() {
  const store = useStore()

  return (
    <>
      <TopBar title="แพ็กเกจ & Add-on" sub="ราคาทั้งหมดอยู่ในฐานข้อมูล แก้ได้โดยไม่ต้อง deploy" />
      <div className="body">
        <div style={{ marginBottom: 18 }}>
          <Note tone="info" icon="tag">
            ระบบ snapshot ราคาไว้ตอนเปิดโต๊ะ การขึ้นราคาวันนี้จึงไม่กระทบบิลของเมื่อวาน
          </Note>
        </div>

        <p className="t-label" style={{ marginBottom: 10 }}>แพ็กเกจบุฟเฟต์</p>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(292px, 1fr))' }}>
          {store.packages.map((p) => {
            const lockedCount = store.menuItems.filter((m) => m.allowed_package_ids.includes(p.id)).length
            const premium = p.code === 'premium'
            return (
              <div key={p.id} className="card pad" style={{ borderTop: `3px solid ${premium ? 'var(--gold)' : 'var(--brand)'}` }}>
                <div className="between" style={{ marginBottom: 8 }}>
                  <h3 className="t-head">{p.name}</h3>
                  <Chip tone={premium ? 'gold' : 'brand'} icon="clock">{p.dining_minutes} นาที</Chip>
                </div>
                <p className="t-sm muted" style={{ marginBottom: 14 }}>{p.description}</p>

                <div className="stack g8">
                  <Kv label="ผู้ใหญ่" value={baht(p.price_per_adult_satang)} />
                  <Kv label={`เด็ก (ไม่เกิน ${p.child_max_age} ปี)`} value={baht(p.price_per_child_satang)} />
                  <Kv label="เมนูที่ล็อกให้แพ็กเกจนี้" value={`${lockedCount} รายการ`} />
                </div>
              </div>
            )
          })}
        </div>

        <p className="t-label" style={{ margin: '24px 0 10px' }}>Add-on</p>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th>ชื่อ</th><th>รายละเอียด</th><th>วิธีคิด</th><th className="num">ราคา</th></tr>
            </thead>
            <tbody>
              {store.addOns.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.name}</b></td>
                  <td className="muted">{a.description}</td>
                  <td>{a.charge_basis === 'per_person' ? 'คิดตามจำนวนคน' : 'คิดครั้งเดียวทั้งโต๊ะ'}</td>
                  <td className="num bold">{baht(a.price_satang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── โต๊ะ & QR ───────────────────────────────────────────────────────────────
export function AdminTables() {
  const store = useStore()
  const zones = [...new Set(store.tables.map((t) => t.zone))]

  return (
    <>
      <TopBar title="โต๊ะ & QR" sub={`${store.tables.length} โต๊ะใน ${zones.length} โซน`}>
        <button className="btn btn--default btn--sm no-print" onClick={() => window.print()}>
          <Icon name="printer" size={15} /> พิมพ์ QR ทุกโต๊ะ
        </button>
      </TopBar>

      <div className="body">
        <div style={{ marginBottom: 18 }}>
          <Note tone="info" icon="lock">
            QR สติกเกอร์ติดโต๊ะเป็นแบบถาวร แต่ลูกค้าต้องใส่รหัส 6 หลักจากสลิปด้วย
            ส่วน QR บนสลิปใช้ได้รอบเดียวและตายทันทีที่ปิดบิล คนนอกร้านสแกนแล้วสั่งไม่ได้
          </Note>
        </div>

        {zones.map((z) => (
          <div key={z} style={{ marginBottom: 24 }}>
            <p className="t-label" style={{ marginBottom: 10 }}>โซน {z}</p>
            <div className="floor">
              {store.tables.filter((t) => t.zone === z).map((t) => {
                const meta = TABLE_STATUS[t.status]
                const visit = store.activeVisitOf(t.id)
                return (
                  <div key={t.id} className={`tcard ${meta.cls}`}>
                    <div className="between">
                      <p className="tcard__no">{t.table_number}</p>
                      <Chip tone={meta.tone}>{meta.label}</Chip>
                    </div>
                    <p className="t-xs muted" style={{ marginTop: 3 }}>{t.capacity} ที่นั่ง</p>
                    <div className="between t-xs" style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--n100)' }}>
                      <span className="muted">รหัสเข้าโต๊ะ</span>
                      <span className="bold num">{visit?.access_code ?? '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// ── ตั้งค่าร้าน ─────────────────────────────────────────────────────────────
export function AdminSettings() {
  const s = useStore().settings

  const groups = [
    {
      icon: 'tag', title: 'ภาษีและค่าบริการ',
      rows: [
        ['VAT', s.vat_enabled ? `เปิด ${s.vat_rate_bp / 100}%${s.vat_inclusive ? ' (รวมในราคา)' : ' (บวกเพิ่ม)'}` : 'ปิด — ร้านยังไม่จด VAT'],
        ['Service Charge', s.service_charge_enabled ? `เปิด ${s.service_charge_rate_bp / 100}%` : 'ปิด'],
      ],
    },
    {
      icon: 'clock', title: 'เวลาการใช้บริการ',
      rows: [
        ['เวลานั่งเริ่มต้น', `${s.default_dining_minutes} นาที`],
        ['ปิดรับออเดอร์ก่อนหมดเวลา', `${s.last_order_minutes_before_end} นาที`],
      ],
    },
    {
      icon: 'lock', title: 'เพดานการสั่ง',
      rows: [
        ['สูงสุดต่อเมนูต่อรอบ', `${s.max_qty_per_item} ที่`],
        ['สูงสุดต่อรอบ', `${s.max_items_per_order} รายการ / ${s.max_units_per_order} ที่`],
        ['หน่วงเวลาระหว่างรอบ', `${s.min_seconds_between_orders} วินาที`],
        ['ออเดอร์ค้างได้สูงสุด', `${s.max_unserved_orders_per_visit} รอบ`],
      ],
    },
    {
      icon: 'wallet', title: 'แต้มสะสมและการชำระเงิน',
      rows: [
        ['ระบบแต้ม', s.points_enabled ? `เปิด — ทุก ${s.points_baht_per_point} บาท = 1 แต้ม` : 'ปิด'],
        ['โหมดชำระเงิน', s.payment_mode === 'mock' ? 'ทดสอบ (mock) — ยังไม่ตัดเงินจริง' : 'ใช้งานจริง'],
      ],
    },
  ]

  return (
    <>
      <TopBar title="ตั้งค่าร้าน" sub="ค่าเหล่านี้ถูกอ่านโดย RPC ฝั่งฐานข้อมูลโดยตรง" />
      <div className="body">
        <div style={{ marginBottom: 18 }}>
          <Note tone="warn" icon="alert">
            ค่าทั้งหมดเก็บอยู่ในตาราง <b>restaurant_settings</b> การแก้ที่นี่มีผลกับกฎที่บังคับจริง
            ไม่ใช่แค่การแสดงผลบนหน้าจอ
          </Note>
        </div>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {groups.map((g) => (
            <div key={g.title} className="card pad">
              <div className="row g8" style={{ marginBottom: 12 }}>
                <span style={{ color: 'var(--n500)' }}><Icon name={g.icon} size={17} /></span>
                <h3 className="t-head">{g.title}</h3>
              </div>
              {g.rows.map(([k, v]) => (
                <div key={k} className="between t-sm"
                     style={{ padding: '8px 0', borderBottom: '1px solid var(--n100)', alignItems: 'flex-start' }}>
                  <span className="muted">{k}</span>
                  <span className="bold" style={{ textAlign: 'right' }}>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

