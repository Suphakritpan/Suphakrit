import { useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Note, Photo } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { baht } from '../../utils/money'

export default function AdminMenu() {
  const store = useStore()
  const [cat, setCat] = useState('all')

  const items = cat === 'all' ? store.menuItems : store.menuItems.filter((m) => m.category_id === cat)
  const out = store.menuItems.filter((m) => !m.is_available).length
  const locked = store.menuItems.filter((m) => m.allowed_package_ids.length > 0).length
  const category = store.categories.find((c) => c.id === cat)

  return (
    <>
      <TopBar title="จัดการเมนู" sub={`${store.menuItems.length} รายการใน ${store.categories.length} หมวด`}>
        {out > 0 && <Chip tone="warn">ของหมด {out}</Chip>}
        <Chip tone="neutral" icon="lock">ล็อกแพ็กเกจ {locked}</Chip>
      </TopBar>

      <div className="body">
        <div style={{ marginBottom: 16 }}>
          <Note tone="info" icon="lock">
            เมนูที่ล็อกแพ็กเกจจะสั่งได้เฉพาะแพ็กเกจที่ระบุ ส่วนเมนูที่ไม่ล็อกสั่งได้ทุกแพ็กเกจ
            กฎนี้บังคับที่ฐานข้อมูลใน <b>place_order()</b> ไม่ใช่แค่ซ่อนปุ่มบนหน้าจอ
          </Note>
        </div>

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
                รูปหมวดนี้ใช้เป็นหัวเรื่องบนหน้าจอลูกค้า — เปลี่ยนได้จากคอลัมน์ image_url
              </p>
            </div>
          </div>
        )}

        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>เมนู</th><th>หมวด</th><th>สถานีครัว</th>
                <th>ประเภท</th><th>ล็อกแพ็กเกจ</th><th className="num">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => {
                const c = store.categories.find((x) => x.id === m.category_id)
                const st = store.stations.find((x) => x.id === m.station_id)
                const locks = m.allowed_package_ids
                  .map((id) => store.packages.find((p) => p.id === id)?.name).filter(Boolean)

                return (
                  <tr key={m.id} style={{ opacity: m.is_available ? 1 : .5 }}>
                    <td><b>{m.name_th}</b></td>
                    <td className="muted">{c?.name_th}</td>
                    <td className="muted">{st?.name}</td>
                    <td>
                      {m.is_included_in_buffet
                        ? <span className="muted">รวมในบุฟเฟต์</span>
                        : <Chip tone="gold">สั่งพิเศษ {baht(m.a_la_carte_price_satang)}</Chip>}
                    </td>
                    <td>
                      {locks.length
                        ? <Chip tone="brand" icon="lock">{locks.join(', ')}</Chip>
                        : <span className="muted">ทุกแพ็กเกจ</span>}
                    </td>
                    <td className="num">
                      <button className={`btn btn--sm ${m.is_available ? 'btn--default' : 'btn--primary'}`}
                              onClick={() => store.dispatch({ type: 'TOGGLE_MENU', menuId: m.id })}>
                        {m.is_available ? 'กดเมื่อของหมด' : 'ของหมด — กดคืน'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
