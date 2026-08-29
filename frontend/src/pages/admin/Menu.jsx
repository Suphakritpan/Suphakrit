import { useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Note, Photo } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import * as admin from '../../api/admin'
import { bahtToSatang, satangToText } from '../../utils/money'

// ---------------------------------------------------------------------------
// จัดการเมนู — เพิ่ม แก้ ลบ เปลี่ยนสถานีครัว และล็อกแพ็กเกจ
//
// กฎ "เมนูนี้สั่งได้ไหม" บังคับใน place_order() ฝั่งฐานข้อมูล หน้านี้แค่แก้ข้อมูลต้นทาง
// ปุ่ม "กดเมื่อของหมด" ยังไปทาง RPC set_menu_item_availability() เหมือนเดิม
// เพราะ RLS จำกัดได้แค่ระดับแถว ถ้าให้ UPDATE ตรงพนักงานครัวจะแก้ราคาได้ด้วย
// ---------------------------------------------------------------------------

export default function AdminMenu() {
  const store = useStore()
  const [cat, setCat] = useState('all')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const run = async (fn) => {
    setBusy(true); setError(null)
    try { await fn(); await store.reloadReference() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const items = cat === 'all' ? store.menuItems : store.menuItems.filter((m) => m.category_id === cat)
  const out = store.menuItems.filter((m) => !m.is_available).length
  const locked = store.menuItems.filter((m) => m.allowed_package_ids.length > 0).length
  const category = store.categories.find((c) => c.id === cat)

  return (
    <>
      <TopBar title="จัดการเมนู" sub={`${store.menuItems.length} รายการใน ${store.categories.length} หมวด`}>
        {out > 0 && <Chip tone="warn">ของหมด {out}</Chip>}
        <Chip tone="neutral" icon="lock">ล็อกแพ็กเกจ {locked}</Chip>
        <button className="btn btn--primary btn--sm" onClick={() => setAdding(true)}>
          <Icon name="menuBook" size={15} /> เพิ่มเมนู
        </button>
      </TopBar>

      <div className="body">
        <div style={{ marginBottom: 16 }}>
          <Note tone="info" icon="lock">
            เมนูที่ล็อกแพ็กเกจจะสั่งได้เฉพาะแพ็กเกจที่ติ๊กไว้ ส่วนเมนูที่ไม่ล็อกสั่งได้ทุกแพ็กเกจ
            กฎนี้บังคับที่ฐานข้อมูลใน <b>place_order()</b> ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ
          </Note>
        </div>
        {error && <div style={{ marginBottom: 16 }}><Note tone="warn" icon="alert">{error}</Note></div>}

        <div className="row g8 wrap scroll-x" style={{ marginBottom: 16 }}>
          <button className={`tab ${cat === 'all' ? 'tab--on' : ''}`} onClick={() => setCat('all')}>
            ทั้งหมด · {store.menuItems.length}
          </button>
          {store.categories.map((c) => (
            <button key={c.id} className={`tab ${cat === c.id ? 'tab--on' : ''}`} onClick={() => setCat(c.id)}>
              {c.name_th} · {store.menuItems.filter((m) => m.category_id === c.id).length}
            </button>
          ))}
        </div>

        {category && (
          <div className="card" style={{ marginBottom: 16, overflow: 'hidden', display: 'flex' }}>
            <Photo src={category.image} alt={category.name_th}
                   style={{ width: 132, height: 92, objectFit: 'cover', flex: 'none' }} />
            <div className="pad grow">
              <p className="t-head">{category.name_th}</p>
              <p className="t-xs muted" style={{ marginTop: 3 }}>
                รูปหมวดนี้ใช้เป็นหัวเรื่องบนหน้าจอลูกค้า
              </p>
            </div>
          </div>
        )}

        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>เมนู</th><th>หมวด</th><th>สถานีครัว</th>
                <th>ประเภท</th><th className="num">ราคา (บาท)</th><th>ล็อกแพ็กเกจ</th><th className="num">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <MenuRow key={m.id} item={m} store={store} busy={busy} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {adding && <NewItemSheet store={store} busy={busy} run={run} onClose={() => setAdding(false)} />}
    </>
  )
}

function MenuRow({ item, store, busy, run }) {
  const [d, setD] = useState({
    name_th: item.name_th,
    category_id: item.category_id,
    station_id: item.station_id ?? '',
    is_included_in_buffet: item.is_included_in_buffet,
    price: item.a_la_carte_price_satang == null ? '' : satangToText(item.a_la_carte_price_satang),
  })
  const [locks, setLocks] = useState(item.allowed_package_ids)

  const toggleLock = (pkgId) =>
    setLocks(locks.includes(pkgId) ? locks.filter((x) => x !== pkgId) : [...locks, pkgId])

  const save = () => run(async () => {
    await admin.saveRow('menu_items', {
      id: item.id,
      name_th: d.name_th,
      category_id: d.category_id,
      station_id: d.station_id || null,
      is_included_in_buffet: d.is_included_in_buffet,
      // constraint chk_menu_item_pricing บังคับว่าของในบุฟเฟต์ต้องไม่มีราคา
      a_la_carte_price_satang: d.is_included_in_buffet ? null : bahtToSatang(d.price),
    })
    await admin.setMenuPackages(item.id, locks)
  })

  return (
    <tr style={{ opacity: item.is_available ? 1 : .55 }}>
      <td>
        <input value={d.name_th} onChange={(e) => setD({ ...d, name_th: e.target.value })} />
      </td>
      <td>
        <select value={d.category_id} onChange={(e) => setD({ ...d, category_id: e.target.value })}>
          {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name_th}</option>)}
        </select>
      </td>
      <td>
        <select value={d.station_id} onChange={(e) => setD({ ...d, station_id: e.target.value })}>
          <option value="">—</option>
          {store.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </td>
      <td>
        <select value={d.is_included_in_buffet ? 'buffet' : 'alacarte'}
                onChange={(e) => setD({ ...d, is_included_in_buffet: e.target.value === 'buffet' })}>
          <option value="buffet">รวมในบุฟเฟต์</option>
          <option value="alacarte">สั่งพิเศษ</option>
        </select>
      </td>
      <td className="num">
        <input inputMode="decimal" value={d.is_included_in_buffet ? '' : d.price}
               disabled={d.is_included_in_buffet} style={{ maxWidth: 100, textAlign: 'right' }}
               onChange={(e) => setD({ ...d, price: e.target.value })} />
      </td>
      <td>
        <span className="row g8 wrap">
          {store.packages.map((p) => (
            <label key={p.id} className="row g4 t-xs" style={{ whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={locks.includes(p.id)} onChange={() => toggleLock(p.id)} />
              {p.name}
            </label>
          ))}
        </span>
      </td>
      <td className="num">
        <span className="row g8" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--default btn--sm" disabled={busy} onClick={save}>บันทึก</button>
          {/* ไม่ส่งสถานะปลายทางไปเอง — ปุ่มนี้ถือค่าจากรอบ render ที่อาจเก่าไปแล้ว
              ให้ StoreProvider อ่านค่าล่าสุดผ่าน referenceRef แล้วสลับเอง */}
          <button className={`btn btn--sm ${item.is_available ? 'btn--quiet' : 'btn--primary'}`}
                  onClick={() => store.dispatch({ type: 'TOGGLE_MENU', menuId: item.id })}>
            {item.is_available ? '86' : 'คืน'}
          </button>
          <button className="btn btn--quiet btn--sm" disabled={busy}
                  title="ลบเมนู (ทำได้เฉพาะเมนูที่ยังไม่เคยถูกสั่ง)"
                  onClick={() => run(() => admin.deleteRow('menu_items', item.id))}>
            <Icon name="close" size={14} />
          </button>
        </span>
      </td>
    </tr>
  )
}

function NewItemSheet({ store, busy, run, onClose }) {
  const [d, setD] = useState({
    name_th: '',
    category_id: store.categories[0]?.id ?? '',
    station_id: store.stations[0]?.id ?? '',
    is_included_in_buffet: true,
    price: '',
  })

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd">
          <h3 className="t-title">เพิ่มเมนู</h3>
          <p className="t-xs muted" style={{ marginTop: 3 }}>
            ล็อกแพ็กเกจตั้งได้หลังบันทึก จากช่องติ๊กในตาราง
          </p>
        </div>
        <div className="sheet__bd">
          <label className="field">
            <span>ชื่อเมนู</span>
            <input value={d.name_th} onChange={(e) => setD({ ...d, name_th: e.target.value })} />
          </label>
          <div className="row g12">
            <label className="field grow">
              <span>หมวด</span>
              <select value={d.category_id} onChange={(e) => setD({ ...d, category_id: e.target.value })}>
                {store.categories.map((c) => <option key={c.id} value={c.id}>{c.name_th}</option>)}
              </select>
            </label>
            <label className="field grow">
              <span>สถานีครัว</span>
              <select value={d.station_id} onChange={(e) => setD({ ...d, station_id: e.target.value })}>
                <option value="">—</option>
                {store.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          <div className="row g12">
            <label className="field grow">
              <span>ประเภท</span>
              <select value={d.is_included_in_buffet ? 'buffet' : 'alacarte'}
                      onChange={(e) => setD({ ...d, is_included_in_buffet: e.target.value === 'buffet' })}>
                <option value="buffet">รวมในบุฟเฟต์</option>
                <option value="alacarte">สั่งพิเศษ</option>
              </select>
            </label>
            <label className="field grow">
              <span>ราคา (บาท)</span>
              <input inputMode="decimal" value={d.price} disabled={d.is_included_in_buffet}
                     onChange={(e) => setD({ ...d, price: e.target.value })} />
            </label>
          </div>
        </div>
        <div className="sheet__ft">
          <button className="btn btn--default" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn--primary grow" disabled={busy || !d.name_th || !d.category_id}
                  onClick={() => run(async () => {
                    await admin.saveRow('menu_items', {
                      branch_id: store.branchId,
                      name_th: d.name_th,
                      category_id: d.category_id,
                      station_id: d.station_id || null,
                      is_included_in_buffet: d.is_included_in_buffet,
                      a_la_carte_price_satang: d.is_included_in_buffet ? null : bahtToSatang(d.price),
                    })
                    onClose()
                  })}>
            เพิ่มเมนู
          </button>
        </div>
      </div>
    </div>
  )
}
