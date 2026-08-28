import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore, useCart } from '../../context/StoreProvider'
import { CustomerBar } from '../../components/layout/Layouts'
import { Step, Empty, Note, Chip, Photo } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { baht } from '../../utils/money'
import { remaining } from '../../utils/time'

export default function CustomerMenu() {
  const [params, setParams] = useSearchParams()
  const store = useStore()
  const cart = useCart()
  const [review, setReview] = useState(false)
  const [q, setQ] = useState('')

  const visit = store.visitOf(store.customerVisitId)
  const s = store.settings
  const activeCat = params.get('cat') ?? store.categories[0].id
  const category = store.categories.find((c) => c.id === activeCat)

  // ── กฎเดียวกับที่ place_order() บังคับในฐานข้อมูล ──
  const r = remaining(visit.dining_deadline_at)
  const closed = r.over || r.totalMinutes <= s.last_order_minutes_before_end

  const myOrders = store.ordersOf(visit.id)
  const lastAt = myOrders.length ? Math.max(...myOrders.map((o) => +new Date(o.created_at))) : 0
  const waitLeft = Math.max(0, Math.ceil((lastAt + s.min_seconds_between_orders * 1000 - Date.now()) / 1000))

  const unserved = myOrders.filter((o) =>
    o.items.some((i) => i.status !== 'served' && i.status !== 'cancelled')).length
  const tooMany = unserved >= s.max_unserved_orders_per_visit

  const searching = q.trim().length > 0
  const items = useMemo(() => {
    if (searching) return store.menuItems.filter((m) => m.name_th.includes(q.trim()))
    return store.menuItems.filter((m) => m.category_id === activeCat)
  }, [store.menuItems, activeCat, q, searching])

  /** ข้อ ② — เมนูที่ล็อกแพ็กเกจต้องตรงกับแพ็กเกจของโต๊ะนี้ */
  const locked = (m) =>
    m.allowed_package_ids.length > 0 && !m.allowed_package_ids.includes(visit.package_id)

  const lines = cart.lines.map(([id, qty]) => ({ menu: store.menuItems.find((m) => m.id === id), qty }))
  const extra = lines.reduce((n, l) => n + (l.menu.a_la_carte_price_satang ?? 0) * l.qty, 0)

  const overLines = cart.lines.length > s.max_items_per_order
  const overUnits = cart.totalUnits > s.max_units_per_order
  const blocked = closed || waitLeft > 0 || tooMany || overLines || overUnits

  const [sending, setSending] = useState(false)

  // ต้องรอผลจริง — ของเดิมล้างตะกร้าทันทีโดยไม่สนว่าฐานข้อมูลรับหรือไม่
  // เมนูที่เพิ่งหมดจะถูกปฏิเสธฝั่ง server แล้วลูกค้าเห็นตะกร้าว่างเปล่า เข้าใจว่าสั่งสำเร็จ
  async function confirm() {
    setSending(true)
    const ok = await store.dispatch({
      type: 'PLACE_ORDER',
      visitId: visit.id,
      items: cart.lines.map(([menu_item_id, quantity]) => ({ menu_item_id, quantity })),
    })
    setSending(false)
    if (!ok) return          // ข้อความจากฐานข้อมูลขึ้นเป็น toast ให้แล้ว ตะกร้าคงไว้ให้แก้
    cart.clear()
    setReview(false)
  }

  return (
    <>
      <CustomerBar title="เมนูอาหาร" back="/order" />

      <div className="tabbar scroll-x">
        {store.categories.map((c) => (
          <button
            key={c.id}
            className={`tab ${c.id === activeCat && !searching ? 'tab--on' : ''}`}
            onClick={() => { setQ(''); setParams({ cat: c.id }) }}
          >
            {c.name_th}
          </button>
        ))}
      </div>

      <div className="cx__wrap" style={{ paddingBottom: cart.totalUnits ? 128 : 90 }}>
        {closed && (
          <div style={{ marginBottom: 14 }}>
            <Note tone="warn" icon="clock">
              {r.over
                ? 'หมดเวลาการใช้บริการแล้ว'
                : `ปิดรับออเดอร์แล้ว สั่งได้ถึงก่อนหมดเวลา ${s.last_order_minutes_before_end} นาที`}
              {' '}กรุณาติดต่อพนักงาน
            </Note>
          </div>
        )}

        <div className="cx__cols cx__cols--split">
          <div>
            {/* ── หัวหมวดพร้อมรูปจริง ── */}
            {!searching && category && (
              <div className="cx__hero" style={{ minHeight: 108, marginBottom: 14 }}>
                <Photo src={category.image} alt={category.name_th} />
                <div className="cx__heroIn">
                  <p className="t-title">{category.name_th}</p>
                  <p className="t-xs" style={{ opacity: .8 }}>{items.length} รายการ</p>
                </div>
              </div>
            )}

            <div className="between" style={{ marginBottom: 12 }}>
              <div className="field" style={{ margin: 0, flex: 1, maxWidth: 280 }}>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 11, top: 10, color: 'var(--n400)' }}>
                    <Icon name="search" size={17} />
                  </span>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="ค้นหาเมนู"
                    style={{ paddingLeft: 36 }}
                  />
                </div>
              </div>
              {searching && (
                <button className="btn btn--quiet btn--sm" onClick={() => setQ('')}>
                  <Icon name="close" size={15} /> ล้าง
                </button>
              )}
            </div>

            {items.length === 0 && <Empty icon="search" title="ไม่พบเมนูที่ค้นหา" hint="ลองพิมพ์ชื่ออื่นดูนะคะ" />}

            {items.map((m) => {
              const isLocked = locked(m)
              const out = !m.is_available
              const off = isLocked || out || closed

              return (
                <div key={m.id} className={`mrow ${off ? 'mrow--off' : ''}`}>
                  <div className="grow">
                    <div className="row g8">
                      <span className="mrow__name">{m.name_th}</span>
                      {isLocked && <Chip tone="neutral" icon="lock">พรีเมียม</Chip>}
                      {out && <Chip tone="warn">ของหมด</Chip>}
                    </div>
                    <p className="t-xs muted" style={{ marginTop: 2 }}>
                      {isLocked
                        ? 'สั่งได้เฉพาะแพ็กเกจพรีเมียม'
                        : out
                          ? 'เมนูนี้หมดชั่วคราว'
                          : m.is_included_in_buffet
                            ? 'รวมในบุฟเฟต์'
                            : `สั่งพิเศษ ${baht(m.a_la_carte_price_satang)}`}
                    </p>
                  </div>

                  <Step
                    value={cart.cart[m.id] ?? 0}
                    max={off ? 0 : s.max_qty_per_item}
                    onAdd={() => !off && cart.add(m.id)}
                    onSub={() => cart.sub(m.id)}
                  />
                </div>
              )
            })}
          </div>

          {/* ── สรุปตะกร้าบนจอกว้าง ── */}
          <div className="card pad no-print" style={{ position: 'sticky', top: 116 }}>
            <h2 className="t-head" style={{ marginBottom: 10 }}>ตะกร้าของคุณ</h2>

            {lines.length === 0 ? (
              <p className="t-sm muted">ยังไม่ได้เลือกอะไร กดปุ่ม + ที่เมนูเพื่อเพิ่มลงตะกร้า</p>
            ) : (
              <>
                <div className="stack g8">
                  {lines.map((l) => (
                    <div key={l.menu.id} className="between t-sm">
                      <span className="trunc">{l.menu.name_th}</span>
                      <span className="bold num">× {l.qty}</span>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '1px solid var(--n100)', margin: '12px 0' }} />
                <div className="between t-sm">
                  <span className="muted">รวมจำนวน</span>
                  <span className="bold num">{cart.totalUnits} ที่</span>
                </div>
                {extra > 0 && (
                  <div className="between t-sm" style={{ marginTop: 4 }}>
                    <span className="muted">อาหารสั่งพิเศษ</span>
                    <span className="bold num">{baht(extra)}</span>
                  </div>
                )}
                <button
                  className="btn btn--primary btn--block"
                  style={{ marginTop: 14 }}
                  onClick={() => setReview(true)}
                >
                  ตรวจสอบและยืนยัน
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── แถบตะกร้าลอย (มือถือ) ── */}
      {cart.totalUnits > 0 && (
        <div className="cartdock">
          <button className="cartdock__in" onClick={() => setReview(true)}>
            <span className="row g12">
              <Icon name="tray" size={19} />
              <span style={{ textAlign: 'left' }}>
                <span className="bold t-sm">{cart.lines.length} รายการ · {cart.totalUnits} ที่</span>
                {extra > 0 && <span className="t-xs" style={{ display: 'block', opacity: .7 }}>สั่งพิเศษ {baht(extra)}</span>}
              </span>
            </span>
            <span className="btn btn--sm" style={{ background: 'rgba(255,255,255,.16)', color: '#fff' }}>
              ยืนยัน <Icon name="chevronRight" size={14} strokeWidth={2} />
            </span>
          </button>
        </div>
      )}

      {/* ── ยืนยันออเดอร์ ── */}
      {review && (
        <div className="sheet" onClick={() => setReview(false)}>
          <div className="sheet__box" onClick={(e) => e.stopPropagation()}>
            <div className="sheet__hd between">
              <div>
                <h3 className="t-title">ตรวจสอบออเดอร์</h3>
                <p className="t-xs muted">
                  โต๊ะ {store.tableOf(visit.table_id).table_number} · รอบที่ {myOrders.length + 1}
                </p>
              </div>
              <button className="btn btn--quiet btn--icon btn--sm" onClick={() => setReview(false)}>
                <Icon name="close" size={17} />
              </button>
            </div>

            <div className="sheet__bd">
              {lines.map((l) => (
                <div key={l.menu.id} className="between" style={{ padding: '9px 0', borderBottom: '1px solid var(--n100)' }}>
                  <span className="grow">
                    <span className="bold t-sm">{l.menu.name_th}</span>
                    {!l.menu.is_included_in_buffet && (
                      <span className="t-xs muted" style={{ display: 'block' }}>
                        {baht(l.menu.a_la_carte_price_satang)} × {l.qty}
                      </span>
                    )}
                  </span>
                  <Step value={l.qty} max={s.max_qty_per_item}
                        onAdd={() => cart.add(l.menu.id)} onSub={() => cart.sub(l.menu.id)} />
                </div>
              ))}

              <div className="between" style={{ marginTop: 14 }}>
                <span className="muted t-sm">รวมจำนวน</span>
                <span className="bold num">{cart.totalUnits} ที่</span>
              </div>
              {extra > 0 && (
                <div className="between" style={{ marginTop: 5 }}>
                  <span className="muted t-sm">อาหารสั่งพิเศษ (คิดเงินเพิ่ม)</span>
                  <span className="bold num">{baht(extra)}</span>
                </div>
              )}

              <div className="stack g8" style={{ marginTop: 14 }}>
                {overLines && <Note tone="warn">หนึ่งรอบสั่งได้ไม่เกิน {s.max_items_per_order} รายการ</Note>}
                {overUnits && <Note tone="warn">หนึ่งรอบสั่งได้ไม่เกิน {s.max_units_per_order} ที่รวมทุกเมนู</Note>}
                {tooMany && (
                  <Note tone="warn">
                    มีออเดอร์ที่ยังไม่ได้เสิร์ฟครบ {s.max_unserved_orders_per_visit} รอบแล้ว กรุณารออาหารชุดก่อนหน้า
                  </Note>
                )}
                {waitLeft > 0 && <Note tone="warn" icon="clock">เพิ่งสั่งไป กรุณารออีก {waitLeft} วินาที</Note>}
              </div>
            </div>

            <div className="sheet__ft">
              <button className="btn btn--default grow" onClick={() => setReview(false)}>สั่งเพิ่ม</button>
              <button className="btn btn--primary grow" disabled={blocked || sending} onClick={confirm}>
                <Icon name="check" size={16} strokeWidth={2} /> {sending ? 'กำลังส่ง…' : 'ยืนยันการสั่ง'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
