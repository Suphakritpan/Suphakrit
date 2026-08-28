import { useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Note } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import * as admin from '../../api/admin'
import { useRows } from './Ops'
import { bahtToSatang, satangToText } from '../../utils/money'
import { TABLE_STATUS, VISIT_STATUS } from '../../data/constants'

// ---------------------------------------------------------------------------
// หน้าแก้ข้อมูลหลักของร้าน — แพ็กเกจ · โต๊ะ · ตั้งค่า
//
// เขียนตรงเข้าตารางผ่าน api/admin.js ได้ เพราะ RLS ชุด manage_* ให้เฉพาะ is_manager()
// ค่าที่แก้ที่นี่มีผลกับกฎที่ RPC ฝั่งฐานข้อมูลบังคับจริง ไม่ใช่แค่การแสดงผล
// ---------------------------------------------------------------------------

/** ปุ่มบันทึกต่อแถว/ต่อการ์ด — เก็บสถานะ busy กับ error ไว้ที่เดียว */
function useSaver(after) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const run = async (fn) => {
    setBusy(true); setError(null)
    try {
      await fn()
      await after?.()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return { busy, error, run }
}

// ── แพ็กเกจ & Add-on ────────────────────────────────────────────────────────
export function AdminPackages() {
  const store = useStore()
  const { busy, error, run } = useSaver(store.reloadReference)

  return (
    <>
      <TopBar title="แพ็กเกจ & Add-on" sub="ราคาทั้งหมดอยู่ในฐานข้อมูล แก้ได้โดยไม่ต้อง deploy" />
      <div className="body">
        <div style={{ marginBottom: 18 }}>
          <Note tone="info" icon="tag">
            ระบบ snapshot ราคาไว้ตอนเปิดโต๊ะ การขึ้นราคาวันนี้จึงไม่กระทบบิลของโต๊ะที่นั่งอยู่แล้ว
          </Note>
        </div>
        {error && <div style={{ marginBottom: 16 }}><Note tone="warn" icon="alert">{error}</Note></div>}

        <p className="t-label" style={{ marginBottom: 10 }}>แพ็กเกจบุฟเฟต์</p>
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {store.packages.map((p) => (
            <PackageCard key={p.id} pkg={p} store={store} busy={busy} run={run} />
          ))}
        </div>

        <p className="t-label" style={{ margin: '24px 0 10px' }}>Add-on</p>
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr><th>ชื่อ</th><th>รายละเอียด</th><th>วิธีคิด</th><th className="num">ราคา (บาท)</th><th /></tr>
            </thead>
            <tbody>
              {store.addOns.map((a) => <AddOnRow key={a.id} addOn={a} busy={busy} run={run} />)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function PackageCard({ pkg, store, busy, run }) {
  const [d, setD] = useState({
    name: pkg.name,
    adult: satangToText(pkg.price_per_adult_satang),
    child: satangToText(pkg.price_per_child_satang),
    minutes: pkg.dining_minutes,
    childAge: pkg.child_max_age,
  })
  const lockedCount = store.menuItems.filter((m) => m.allowed_package_ids.includes(pkg.id)).length
  const premium = pkg.code === 'premium'

  return (
    <div className="card pad" style={{ borderTop: `3px solid ${premium ? 'var(--gold)' : 'var(--brand)'}` }}>
      <div className="between" style={{ marginBottom: 10 }}>
        <h3 className="t-head">{pkg.name}</h3>
        <Chip tone={premium ? 'gold' : 'brand'}>{pkg.code}</Chip>
      </div>

      <label className="field">
        <span>ชื่อที่แสดง</span>
        <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>
      <div className="row g12">
        <label className="field grow">
          <span>ผู้ใหญ่ (บาท)</span>
          <input inputMode="decimal" value={d.adult} onChange={(e) => setD({ ...d, adult: e.target.value })} />
        </label>
        <label className="field grow">
          <span>เด็ก (บาท)</span>
          <input inputMode="decimal" value={d.child} onChange={(e) => setD({ ...d, child: e.target.value })} />
        </label>
      </div>
      <div className="row g12">
        <label className="field grow">
          <span>เวลานั่ง (นาที)</span>
          <input type="number" min="15" value={d.minutes}
                 onChange={(e) => setD({ ...d, minutes: +e.target.value })} />
        </label>
        <label className="field grow">
          <span>อายุเด็กไม่เกิน (ปี)</span>
          <input type="number" min="0" value={d.childAge}
                 onChange={(e) => setD({ ...d, childAge: +e.target.value })} />
        </label>
      </div>

      <p className="t-xs muted" style={{ marginBottom: 10 }}>
        เมนูที่ล็อกให้แพ็กเกจนี้ {lockedCount} รายการ — แก้ได้ที่หน้าจัดการเมนู
      </p>

      <button className="btn btn--primary btn--block" disabled={busy}
              onClick={() => run(() => admin.saveRow('buffet_packages', {
                id: pkg.id,
                name: d.name,
                price_per_adult_satang: bahtToSatang(d.adult),
                price_per_child_satang: bahtToSatang(d.child),
                dining_minutes: d.minutes,
                child_max_age: d.childAge,
              }))}>
        บันทึก
      </button>
    </div>
  )
}

function AddOnRow({ addOn, busy, run }) {
  const [price, setPrice] = useState(satangToText(addOn.price_satang))
  const [name, setName] = useState(addOn.name)

  return (
    <tr>
      <td><input value={name} onChange={(e) => setName(e.target.value)} /></td>
      <td className="muted">{addOn.description}</td>
      <td>{addOn.charge_basis === 'per_person' ? 'คิดตามจำนวนคน' : 'คิดครั้งเดียวทั้งโต๊ะ'}</td>
      <td className="num">
        <input inputMode="decimal" value={price} style={{ maxWidth: 110, textAlign: 'right' }}
               onChange={(e) => setPrice(e.target.value)} />
      </td>
      <td className="num">
        <button className="btn btn--default btn--sm" disabled={busy}
                onClick={() => run(() => admin.saveRow('add_ons', {
                  id: addOn.id, name, price_satang: bahtToSatang(price),
                }))}>
          บันทึก
        </button>
      </td>
    </tr>
  )
}

// ── โต๊ะ & QR ───────────────────────────────────────────────────────────────
export function AdminTables() {
  const store = useStore()
  const { busy, error, run } = useSaver(store.reloadReference)
  const [adding, setAdding] = useState(false)

  const zones = store.zones ?? []

  return (
    <>
      <TopBar title="โต๊ะ & QR" sub={`${store.tables.length} โต๊ะใน ${zones.length} โซน`}>
        <button className="btn btn--primary btn--sm no-print" onClick={() => setAdding(true)}>
          <Icon name="grid" size={15} /> เพิ่มโต๊ะ
        </button>
        <button className="btn btn--default btn--sm no-print" onClick={() => window.print()}>
          <Icon name="printer" size={15} /> พิมพ์ QR ทุกโต๊ะ
        </button>
      </TopBar>

      <div className="body">
        <div style={{ marginBottom: 18 }}>
          <Note tone="info" icon="lock">
            QR สติกเกอร์ติดโต๊ะเป็นแบบถาวร ลูกค้าที่สแกนต้องใส่รหัส 6 หลักจากสลิปด้วย
            ส่วน QR บนสลิปใช้ได้รอบเดียวและตายทันทีที่ปิดบิล
          </Note>
        </div>
        {error && <div style={{ marginBottom: 16 }}><Note tone="warn" icon="alert">{error}</Note></div>}

        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>โต๊ะ</th><th className="num">ที่นั่ง</th><th>โซน</th>
                <th>สถานะ</th><th>รหัสเข้าโต๊ะ</th><th className="num">เปิดใช้</th><th />
              </tr>
            </thead>
            <tbody>
              {store.tables.map((t) => (
                <TableRow key={t.id} table={t} zones={zones} store={store} busy={busy} run={run} />
              ))}
            </tbody>
          </table>
        </div>

        <p className="t-label" style={{ margin: '24px 0 10px' }}>โซน</p>
        <div className="row g8 wrap">
          {zones.map((z) => <Chip key={z.id} tone="neutral">{z.code} · {z.name}</Chip>)}
          <ZoneAdd branchId={store.branchId} busy={busy} run={run} />
        </div>
      </div>

      {adding && (
        <NewTableSheet store={store} zones={zones} busy={busy} run={run} onClose={() => setAdding(false)} />
      )}
    </>
  )
}

function TableRow({ table, zones, store, busy, run }) {
  const [d, setD] = useState({
    table_number: table.table_number, capacity: table.capacity,
    zone_id: table.zone_id ?? '', is_active: table.is_active,
  })
  const visit = store.activeVisitOf(table.id)
  const meta = TABLE_STATUS[table.status]
  const chip = (visit && visit.status !== 'open') ? VISIT_STATUS[visit.status] : meta

  return (
    <tr>
      <td>
        <input value={d.table_number} style={{ maxWidth: 90 }}
               onChange={(e) => setD({ ...d, table_number: e.target.value })} />
      </td>
      <td className="num">
        <input type="number" min="1" max="50" value={d.capacity} style={{ maxWidth: 80, textAlign: 'right' }}
               onChange={(e) => setD({ ...d, capacity: +e.target.value })} />
      </td>
      <td>
        <select value={d.zone_id} onChange={(e) => setD({ ...d, zone_id: e.target.value })}>
          <option value="">—</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.code} · {z.name}</option>)}
        </select>
      </td>
      <td><Chip tone={chip.tone}>{chip.label}</Chip></td>
      <td className="num muted">{visit?.access_code ?? '—'}</td>
      <td className="num">
        <input type="checkbox" checked={d.is_active}
               onChange={(e) => setD({ ...d, is_active: e.target.checked })} />
      </td>
      <td className="num">
        <span className="row g8" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--default btn--sm" disabled={busy}
                  onClick={() => run(() => admin.saveRow('tables', { id: table.id, ...d, zone_id: d.zone_id || null }))}>
            บันทึก
          </button>
          {/* ลบได้เฉพาะโต๊ะว่าง — โต๊ะที่มีประวัติบิลจะถูก FK กันไว้ ให้ปิดใช้งานแทน */}
          {table.status === 'available' && !visit && (
            <button className="btn btn--quiet btn--sm" disabled={busy}
                    onClick={() => run(() => admin.deleteRow('tables', table.id))}>
              <Icon name="close" size={14} />
            </button>
          )}
        </span>
      </td>
    </tr>
  )
}

function ZoneAdd({ branchId, busy, run }) {
  const [open, setOpen] = useState(false)
  const [d, setD] = useState({ code: '', name: '' })

  if (!open) {
    return (
      <button className="btn btn--quiet btn--sm" onClick={() => setOpen(true)}>
        <Icon name="grid" size={14} /> เพิ่มโซน
      </button>
    )
  }

  return (
    <span className="row g8">
      <input placeholder="รหัส (A)" value={d.code} style={{ maxWidth: 90 }}
             onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} />
      <input placeholder="ชื่อโซน" value={d.name} style={{ maxWidth: 160 }}
             onChange={(e) => setD({ ...d, name: e.target.value })} />
      <button className="btn btn--primary btn--sm" disabled={busy || !d.code || !d.name}
              onClick={() => run(async () => {
                await admin.saveRow('zones', { branch_id: branchId, code: d.code, name: d.name })
                setOpen(false); setD({ code: '', name: '' })
              })}>
        เพิ่ม
      </button>
      <button className="btn btn--quiet btn--sm" onClick={() => setOpen(false)}>ยกเลิก</button>
    </span>
  )
}

function NewTableSheet({ store, zones, busy, run, onClose }) {
  const [d, setD] = useState({ table_number: '', capacity: 4, zone_id: zones[0]?.id ?? '' })

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd">
          <h3 className="t-title">เพิ่มโต๊ะ</h3>
          <p className="t-xs muted" style={{ marginTop: 3 }}>ฐานข้อมูลจะออก qr_token ให้เองตอนสร้าง</p>
        </div>
        <div className="sheet__bd">
          <div className="row g12">
            <label className="field grow">
              <span>หมายเลขโต๊ะ</span>
              <input value={d.table_number} onChange={(e) => setD({ ...d, table_number: e.target.value })} />
            </label>
            <label className="field grow">
              <span>ที่นั่ง</span>
              <input type="number" min="1" max="50" value={d.capacity}
                     onChange={(e) => setD({ ...d, capacity: +e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>โซน</span>
            <select value={d.zone_id} onChange={(e) => setD({ ...d, zone_id: e.target.value })}>
              <option value="">—</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.code} · {z.name}</option>)}
            </select>
          </label>
        </div>
        <div className="sheet__ft">
          <button className="btn btn--default" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn--primary grow" disabled={busy || !d.table_number}
                  onClick={() => run(async () => {
                    await admin.saveRow('tables', {
                      branch_id: store.branchId, table_number: d.table_number,
                      capacity: d.capacity, zone_id: d.zone_id || null,
                    })
                    onClose()
                  })}>
            เพิ่มโต๊ะ
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ตั้งค่าร้าน ─────────────────────────────────────────────────────────────
// ค่าที่ RPC ฝั่งฐานข้อมูลอ่านไปใช้จริง — แก้แล้วมีผลกับกฎ ไม่ใช่แค่หน้าจอ
const GROUPS = [
  {
    icon: 'tag', title: 'ภาษีและค่าบริการ',
    fields: [
      ['vat_enabled', 'เก็บ VAT', 'bool'],
      ['vat_rate_bp', 'อัตรา VAT (%)', 'pct'],
      ['vat_inclusive', 'ราคารวม VAT แล้ว', 'bool'],
      ['service_charge_enabled', 'เก็บ Service Charge', 'bool'],
      ['service_charge_rate_bp', 'อัตรา Service Charge (%)', 'pct'],
    ],
  },
  {
    icon: 'clock', title: 'เวลาการใช้บริการ',
    fields: [
      ['default_dining_minutes', 'เวลานั่งเริ่มต้น (นาที)', 'int'],
      ['last_order_minutes_before_end', 'ปิดรับออเดอร์ก่อนหมดเวลา (นาที)', 'int'],
      ['queue_grace_minutes', 'ผ่อนผันก่อนตัดคิวไม่มาตามเรียก (นาที)', 'int'],
    ],
  },
  {
    icon: 'lock', title: 'เพดานการสั่ง',
    fields: [
      ['max_qty_per_item', 'สูงสุดต่อเมนูต่อรอบ', 'int'],
      ['max_items_per_order', 'สูงสุดต่อรอบ (รายการ)', 'int'],
      ['max_units_per_order', 'สูงสุดต่อรอบ (ที่)', 'int'],
      ['min_seconds_between_orders', 'หน่วงเวลาระหว่างรอบ (วินาที)', 'int'],
      ['max_unserved_orders_per_visit', 'ออเดอร์ค้างได้สูงสุด (รอบ)', 'int'],
    ],
  },
  {
    icon: 'qr', title: 'ความปลอดภัยของ QR',
    fields: [
      ['qr_max_failed_attempts', 'ใส่รหัสผิดได้สูงสุด (ครั้ง)', 'int'],
      ['qr_attempt_window_minutes', 'ช่วงนับ/ล็อก (นาที)', 'int'],
      ['qr_max_devices_per_visit', 'อุปกรณ์ต่อโต๊ะ (เครื่อง)', 'int'],
    ],
  },
  {
    icon: 'wallet', title: 'แต้มสะสมและการชำระเงิน',
    fields: [
      ['points_enabled', 'เปิดระบบแต้ม', 'bool'],
      ['points_baht_per_point', 'กี่บาทได้ 1 แต้ม', 'int'],
      ['payment_mode', 'โหมดชำระเงิน', 'select', ['mock', 'live']],
      ['promptpay_id', 'PromptPay ID', 'text'],
    ],
  },
]

export function AdminSettings() {
  const store = useStore()
  const { rows, error: loadError, reload } = useRows(() => admin.loadSettings().then((s) => (s ? [s] : [])), [])
  const { busy, error, run } = useSaver(async () => { await store.reloadReference(); reload() })
  const [draft, setDraft] = useState(null)

  const row = draft ?? rows?.[0] ?? null
  const set = (k, v) => setDraft({ ...(draft ?? rows[0]), [k]: v })

  return (
    <>
      <TopBar title="ตั้งค่าร้าน" sub="ค่าเหล่านี้ถูกอ่านโดย RPC ฝั่งฐานข้อมูลโดยตรง">
        {row && (
          <button className="btn btn--primary btn--sm" disabled={busy || !draft}
                  onClick={() => run(async () => {
                    await admin.saveRow('restaurant_settings', draft, 'branch_id')
                    setDraft(null)
                  })}>
            {busy ? 'กำลังบันทึก…' : 'บันทึกทั้งหมด'}
          </button>
        )}
      </TopBar>

      <div className="body">
        <div style={{ marginBottom: 18 }}>
          <Note tone="warn" icon="alert">
            ค่าทั้งหมดเก็บอยู่ในตาราง <b>restaurant_settings</b> การแก้ที่นี่มีผลกับกฎที่บังคับจริง
            เช่น เวลาปิดรับออเดอร์และเพดานการสั่ง ไม่ใช่แค่การแสดงผล
          </Note>
        </div>
        {(error ?? loadError) && (
          <div style={{ marginBottom: 16 }}><Note tone="warn" icon="alert">{error ?? loadError}</Note></div>
        )}

        {rows === null ? <p className="t-sm muted">กำลังโหลด…</p>
          : !row ? <Note tone="warn" icon="alert">อ่านแถวตั้งค่าของสาขานี้ไม่ได้ — ต้องล็อกอินเป็นผู้จัดการ</Note> : (
          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            {GROUPS.map((g) => (
              <div key={g.title} className="card pad">
                <div className="row g8" style={{ marginBottom: 12 }}>
                  <span style={{ color: 'var(--n500)' }}><Icon name={g.icon} size={17} /></span>
                  <h3 className="t-head">{g.title}</h3>
                </div>
                {g.fields.map(([key, label, type, options]) => (
                  <SettingField key={key} value={row[key]} label={label} type={type} options={options}
                                onChange={(v) => set(key, v)} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ใช้ <label> ครอบ ไม่ใช่ <span> ลอย ๆ — โปรแกรมอ่านหน้าจอถึงจะบอกได้ว่าช่องนี้คืออะไร
// (และทำให้เทสต์อ้างช่องด้วยชื่อที่ผู้ใช้เห็นได้ แทนการไล่ DOM)
function SettingField({ value, label, type, options, onChange }) {
  const box = { padding: '8px 0', borderBottom: '1px solid var(--n100)' }

  if (type === 'bool') {
    return (
      <label className="between t-sm" style={box}>
        <span className="muted">{label}</span>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
      </label>
    )
  }
  if (type === 'select') {
    return (
      <label className="between t-sm" style={box}>
        <span className="muted">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} style={{ maxWidth: 140 }}>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    )
  }
  // basis point เก็บเป็น 700 = 7.00% — ให้ผู้จัดการกรอกเป็นเปอร์เซ็นต์ตามที่คิดในหัว
  const shown = type === 'pct' ? value / 100 : value
  return (
    <label className="between t-sm" style={box}>
      <span className="muted">{label}</span>
      <input
        type={type === 'text' ? 'text' : 'number'}
        value={shown ?? ''}
        style={{ maxWidth: 140, textAlign: 'right' }}
        onChange={(e) => onChange(
          type === 'text' ? e.target.value
            : type === 'pct' ? Math.round(Number(e.target.value) * 100)
              : Math.round(Number(e.target.value)))}
      />
    </label>
  )
}
