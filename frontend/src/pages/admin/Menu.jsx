import { useRef, useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Note, Photo } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import * as admin from '../../api/admin'
import { bahtToSatang, satangToText } from '../../utils/money'
import { SIZE_TAG, SIZES, hasSizes } from '../../data/constants'

// ---------------------------------------------------------------------------
// จัดการเมนู — เพิ่ม แก้ ลบ เปลี่ยนรูป เปลี่ยนสถานีครัว และล็อกแพ็กเกจ
//
// กฎ "เมนูนี้สั่งได้ไหม" บังคับใน place_order() ฝั่งฐานข้อมูล หน้านี้แค่แก้ข้อมูลต้นทาง
// ปุ่ม "กดเมื่อของหมด" ยังไปทาง RPC set_menu_item_availability() เหมือนเดิม
// เพราะ RLS จำกัดได้แค่ระดับแถว ถ้าให้ UPDATE ตรงพนักงานครัวจะแก้ราคาได้ด้วย
//
// ขนาดจาน (เล็ก/กลาง/ใหญ่) เก็บเป็น tag ชื่อ 'sizes' ในคอลัมน์ tags ที่มีอยู่แล้ว
// ไม่ได้เพิ่มคอลัมน์ใหม่ เพราะขนาดไม่กระทบราคา — ของในบุฟเฟต์คิดตามหัวไม่ใช่ตามจาน
// มันคือคำสั่งถึงครัว ไม่ใช่ข้อมูลการเงิน
// ---------------------------------------------------------------------------

const VIEW_KEY = 'shabu.menu.view'
const readView = () => {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
}

export default function AdminMenu() {
  const store = useStore()
  const [cat, setCat] = useState('all')
  const [view, setView] = useState(readView)
  const [editing, setEditing] = useState(null)   // เมนูที่กำลังแก้ · 'new' = เพิ่มใหม่
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const run = async (fn) => {
    setBusy(true); setError(null)
    try { await fn(); await store.reloadReference() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const pickView = (v) => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch { /* โหมดส่วนตัวห้ามเขียน ไม่เป็นไร */ }
  }

  const items = cat === 'all' ? store.menuItems : store.menuItems.filter((m) => m.category_id === cat)
  const out = store.menuItems.filter((m) => !m.is_available).length
  const locked = store.menuItems.filter((m) => m.allowed_package_ids.length > 0).length
  const noPhoto = store.menuItems.filter((m) => !m.image_url).length
  const category = store.categories.find((c) => c.id === cat)

  return (
    <>
      <TopBar title="จัดการเมนู" sub={`${store.menuItems.length} รายการใน ${store.categories.length} หมวด`}>
        {out > 0 && <Chip tone="warn">ของหมด {out}</Chip>}
        {noPhoto > 0 && <Chip tone="neutral">ยังไม่มีรูป {noPhoto}</Chip>}
        <Chip tone="neutral" icon="lock">ล็อกแพ็กเกจ {locked}</Chip>
        <button className="btn btn--primary btn--sm" onClick={() => setEditing('new')}>
          <Icon name="plus" size={15} /> เพิ่มเมนู
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

        <div className="between wrap g12" style={{ marginBottom: 16 }}>
          <div className="row g8 wrap scroll-x">
            <button className={`tab ${cat === 'all' ? 'tab--on' : ''}`} onClick={() => setCat('all')}>
              ทั้งหมด · {store.menuItems.length}
            </button>
            {store.categories.map((c) => (
              <button key={c.id} className={`tab ${cat === c.id ? 'tab--on' : ''}`} onClick={() => setCat(c.id)}>
                {c.name_th} · {store.menuItems.filter((m) => m.category_id === c.id).length}
              </button>
            ))}
          </div>

          {/* สลับมุมมอง — จำค่าไว้ในเครื่อง เปิดหน้านี้ครั้งหน้าได้แบบเดิม */}
          <div className="viewtoggle" role="group" aria-label="รูปแบบการแสดงผล">
            <button className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'}
                    onClick={() => pickView('list')}>
              <Icon name="receipt" size={14} /> ลิสต์
            </button>
            <button className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'}
                    onClick={() => pickView('grid')}>
              <Icon name="grid" size={14} /> กริด
            </button>
          </div>
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

        {view === 'grid' ? (
          <div className="mgrid">
            {items.map((m) => (
              <MenuCard key={m.id} item={m} store={store} busy={busy} run={run}
                        onEdit={() => setEditing(m)} />
            ))}
          </div>
        ) : (
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>รูป</th>
                  <th>เมนู</th><th>หมวด</th><th>สถานีครัว</th>
                  <th>ประเภท</th><th className="num">ราคา (บาท)</th>
                  <th>ขนาด</th><th>ล็อกแพ็กเกจ</th><th className="num">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <MenuRow key={m.id} item={m} store={store} busy={busy} run={run}
                           onEdit={() => setEditing(m)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <ItemSheet store={store} busy={busy} run={run}
                   item={editing === 'new' ? null : editing}
                   onClose={() => setEditing(null)} />
      )}
    </>
  )
}

/** การ์ดในมุมมองกริด — รูปนำ กดที่การ์ดเพื่อแก้ */
function MenuCard({ item, store, busy, run, onEdit }) {
  const cat = store.categories.find((c) => c.id === item.category_id)
  return (
    <div className={`mcard ${item.is_available ? '' : 'mcard--off'}`}>
      <button className="mcard__ph" onClick={onEdit} title="กดเพื่อแก้ไขเมนูนี้">
        <Photo src={item.image_url} alt={item.name_th} />
        {!item.image_url && <span className="mcard__noph"><Icon name="plus" size={16} /> ใส่รูป</span>}
      </button>
      <div className="mcard__bd">
        <p className="bold trunc">{item.name_th}</p>
        <p className="t-xs muted trunc" style={{ marginTop: 2 }}>{cat?.name_th ?? '—'}</p>
        <div className="row g4 wrap" style={{ marginTop: 7 }}>
          {item.is_included_in_buffet
            ? <Chip tone="ok">บุฟเฟต์</Chip>
            : <Chip tone="info">฿{satangToText(item.a_la_carte_price_satang ?? 0)}</Chip>}
          {hasSizes(item) && <Chip tone="neutral">เล็ก/กลาง/ใหญ่</Chip>}
          {!item.is_available && <Chip tone="warn">ของหมด</Chip>}
        </div>
      </div>
      <div className="mcard__ft">
        <button className="btn btn--default btn--sm grow" onClick={onEdit}>แก้ไข</button>
        <button className={`btn btn--sm ${item.is_available ? 'btn--quiet' : 'btn--primary'}`}
                disabled={busy}
                onClick={() => store.dispatch({ type: 'TOGGLE_MENU', menuId: item.id })}>
          {item.is_available ? '86' : 'คืน'}
        </button>
      </div>
    </div>
  )
}

function MenuRow({ item, store, busy, run, onEdit }) {
  const [d, setD] = useState({
    name_th: item.name_th,
    category_id: item.category_id,
    station_id: item.station_id ?? '',
    is_included_in_buffet: item.is_included_in_buffet,
    price: item.a_la_carte_price_satang == null ? '' : satangToText(item.a_la_carte_price_satang),
  })
  const [locks, setLocks] = useState(item.allowed_package_ids)
  const [sizes, setSizes] = useState(hasSizes(item))

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
      tags: withSizeTag(item.tags, sizes),
    })
    await admin.setMenuPackages(item.id, locks)
  })

  return (
    <tr style={{ opacity: item.is_available ? 1 : .55 }}>
      <td>
        <button className="thumb" onClick={onEdit} title="เปลี่ยนรูป">
          <Photo src={item.image_url} alt="" />
          {!item.image_url && <Icon name="plus" size={13} />}
        </button>
      </td>
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
        <label className="row g4 t-xs" style={{ whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={sizes} onChange={() => setSizes(!sizes)} />
          เลือกขนาดได้
        </label>
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

/** เติมหรือถอด tag ขนาด โดยไม่ไปแตะ tag อื่นที่ติดอยู่ เช่น premium */
function withSizeTag(tags, on) {
  const rest = (tags ?? []).filter((t) => t !== SIZE_TAG)
  return on ? [...rest, SIZE_TAG] : rest
}

/** ฟอร์มเดียวใช้ทั้งเพิ่มใหม่และแก้ของเดิม — คนกรอกเห็นช่องเดียวกันทั้งสองกรณี */
function ItemSheet({ store, busy, run, item, onClose }) {
  const isNew = !item
  const [d, setD] = useState({
    name_th: item?.name_th ?? '',
    category_id: item?.category_id ?? store.categories[0]?.id ?? '',
    station_id: item?.station_id ?? store.stations[0]?.id ?? '',
    is_included_in_buffet: item?.is_included_in_buffet ?? true,
    price: item?.a_la_carte_price_satang == null ? '' : satangToText(item.a_la_carte_price_satang),
    image_url: item?.image_url ?? '',
    sizes: item ? hasSizes(item) : false,
  })
  const [uploading, setUploading] = useState(false)
  const [upError, setUpError] = useState(null)
  const fileRef = useRef(null)

  const pickFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''                       // เลือกไฟล์เดิมซ้ำได้
    if (!file) return
    setUploading(true); setUpError(null)
    try {
      const url = await admin.uploadMenuImage(file, item?.id)
      setD((prev) => ({ ...prev, image_url: url }))
    } catch (err) { setUpError(err.message) } finally { setUploading(false) }
  }

  const save = () => run(async () => {
    await admin.saveRow('menu_items', {
      ...(isNew ? { branch_id: store.branchId } : { id: item.id }),
      name_th: d.name_th,
      category_id: d.category_id,
      station_id: d.station_id || null,
      is_included_in_buffet: d.is_included_in_buffet,
      a_la_carte_price_satang: d.is_included_in_buffet ? null : bahtToSatang(d.price),
      image_url: d.image_url.trim() || null,
      tags: withSizeTag(item?.tags, d.sizes),
    })
    onClose()
  })

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
        <div className="sheet__hd">
          <h3 className="t-title">{isNew ? 'เพิ่มเมนู' : d.name_th || 'แก้ไขเมนู'}</h3>
          <p className="t-xs muted" style={{ marginTop: 3 }}>
            {isNew ? 'ล็อกแพ็กเกจตั้งได้หลังบันทึก จากช่องติ๊กในมุมมองลิสต์'
                   : 'ล็อกแพ็กเกจแก้ได้ในมุมมองลิสต์'}
          </p>
        </div>

        <div className="sheet__bd">
          {/* ── รูปเมนู ─────────────────────────────────────────────────── */}
          <div className="imgpick">
            <Photo src={d.image_url} alt="" className="imgpick__ph" style={{ background: 'var(--o-ground)' }} />
            <div className="grow">
              <p className="t-label">รูปเมนู</p>
              <div className="row g8 wrap" style={{ margin: '6px 0 8px' }}>
                <button className="btn btn--default btn--sm" disabled={uploading}
                        onClick={() => fileRef.current?.click()}>
                  {uploading ? 'กำลังอัปโหลด…' : d.image_url ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
                </button>
                {d.image_url && (
                  <button className="btn btn--quiet btn--sm"
                          onClick={() => setD({ ...d, image_url: '' })}>เอารูปออก</button>
                )}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />
              </div>
              <input placeholder="หรือวาง URL รูปที่นี่" value={d.image_url}
                     onChange={(e) => setD({ ...d, image_url: e.target.value })} />
              {upError && <p className="t-xs" style={{ color: 'var(--o-alert, #c43e1c)', marginTop: 6 }}>{upError}</p>}
            </div>
          </div>

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
              <input inputMode="decimal" value={d.is_included_in_buffet ? '' : d.price}
                     disabled={d.is_included_in_buffet}
                     onChange={(e) => setD({ ...d, price: e.target.value })} />
            </label>
          </div>

          {/* ── ขนาดจาน ─────────────────────────────────────────────────── */}
          <label className="field" style={{ marginBottom: 4 }}>
            <span>ขนาดจาน</span>
            <label className="row g8 t-sm" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={d.sizes} onChange={() => setD({ ...d, sizes: !d.sizes })} />
              ให้ลูกค้าเลือก {SIZES.join(' / ')} ตอนสั่ง
            </label>
          </label>
          <p className="t-xs muted">
            เหมาะกับหมวดเนื้อสัตว์และผัก ขนาดไม่เปลี่ยนราคา เพราะของในบุฟเฟต์คิดตามจำนวนคน
            ขนาดที่เลือกจะไปขึ้นบนใบสั่งที่ครัว
          </p>
        </div>

        <div className="sheet__ft">
          <button className="btn btn--default" onClick={onClose}>ยกเลิก</button>
          <button className="btn btn--primary grow"
                  disabled={busy || uploading || !d.name_th || !d.category_id}
                  onClick={save}>
            {isNew ? 'เพิ่มเมนู' : 'บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  )
}
