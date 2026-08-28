import { useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Empty, MockBanner, Note, unservedOf } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { PAYMENT_METHODS, TEST_CARDS, VISIT_STATUS } from '../../data/constants'
import { baht, satangToText, bahtToSatang, previewBill } from '../../utils/money'
import { clockTH } from '../../utils/time'

export default function StaffCheckout() {
  const store = useStore()
  const [visitId, setVisitId] = useState(null)

  const billable = store.activeVisits()
  const visit = billable.find((v) => v.id === visitId)

  return (
    <>
      <TopBar title="เช็คบิล & ชำระเงิน" sub="เลือกโต๊ะที่ต้องการปิดบิล">
        <Chip tone="neutral">{billable.length} โต๊ะ</Chip>
      </TopBar>

      <div className="body">
        <div style={{ marginBottom: 16 }}><MockBanner /></div>

        {!visit ? (
          <>
            {billable.length === 0 && <Empty icon="receipt" title="ยังไม่มีโต๊ะที่ต้องเช็คบิล" />}
            <div className="floor">
              {billable.map((v) => {
                const t = store.tableOf(v.table_id)
                const bill = previewBill({
                  visit: v, addons: v.addons,
                  extraItems: store.extraItemsOf(v.id), settings: store.settings,
                })
                const asked = store.serviceRequests.some(
                  (r) => r.visit_id === v.id && r.type === 'request_bill' && r.status === 'open')

                return (
                  <button key={v.id} className="tcard tcard--occupied" onClick={() => setVisitId(v.id)}>
                    <div className="tcard__flags">
                      {asked && <Chip tone="gold" icon="bell">ขอเช็คบิล</Chip>}
                    </div>
                    <p className="tcard__no">{t.table_number}</p>
                    <p className="t-xs muted num">{v.visit_code}</p>
                    <p className="t-title num" style={{ marginTop: 8 }}>{baht(bill.total)}</p>
                    <p className="t-xs muted">
                      {v.package_name_snapshot} · {v.adult_count + v.child_count} ท่าน
                    </p>
                    <div style={{ marginTop: 9 }}>
                      <Chip tone={VISIT_STATUS[v.status].tone}>{VISIT_STATUS[v.status].label}</Chip>
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <BillPanel visit={visit} store={store} onBack={() => setVisitId(null)} />
        )}
      </div>
    </>
  )
}

function BillPanel({ visit, store, onBack }) {
  const s = store.settings
  const table = store.tableOf(visit.table_id)
  const extras = store.extraItemsOf(visit.id)
  const bill = previewBill({ visit, addons: visit.addons, extraItems: extras, settings: s })

  const paid = store.payments
    .filter((p) => p.visit_id === visit.id && p.status === 'succeeded')
    .reduce((n, p) => n + p.amount_satang, 0)
  const due = Math.max(0, bill.total - paid)

  // อาหารที่ยังไม่ถึงมือลูกค้า — close_visit() ฝั่งฐานข้อมูลบล็อกการปิดรอบถ้ายังเหลือ
  const waiting = unservedOf(store, visit.id)

  const [method, setMethod] = useState('cash')
  const [tendered, setTendered] = useState('')
  const [card, setCard] = useState(TEST_CARDS[0].number)
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const tenderedSatang = bahtToSatang(tendered)
  const change = method === 'cash' && tenderedSatang > due ? tenderedSatang - due : 0
  const short = method === 'cash' && tendered !== '' && tenderedSatang < due
  const cardResult = TEST_CARDS.find((c) => c.number === card)?.result

  const points = s.points_enabled && phone ? Math.floor(bill.total / 100 / s.points_baht_per_point) : 0

  async function pay() {
    setBusy(true); setResult(null)

    if (method === 'card' && cardResult !== 'approved') {
      setBusy(false)
      setResult({ ok: false, text: cardResult === 'declined' ? 'บัตรถูกปฏิเสธ (do_not_honor)' : 'เชื่อมต่อเครื่องรูดบัตรไม่ได้' })
      return
    }

    // ต้องรอผลจริงจากฐานข้อมูล — ของเดิมขึ้น "สำเร็จ" หลังหน่วง 850ms
    // โดยไม่สนว่า RPC ผ่านหรือไม่ ทำให้พนักงานเห็นว่าเก็บเงินแล้วทั้งที่ยังไม่ได้เก็บ
    const ok = await store.dispatch({
      type: 'PAY_VISIT', visitId: visit.id, method, amount: due, tendered: tenderedSatang || undefined,
    })
    setBusy(false)
    setResult(ok
      ? { ok: true, text: 'ชำระเงินสำเร็จ ออกใบเสร็จแล้ว' }
      : { ok: false, text: 'รับชำระไม่สำเร็จ — ดูข้อความแจ้งเตือนด้านล่างจอ ยอดยังไม่ถูกตัด' })
  }

  return (
    <>
      <button className="btn btn--quiet btn--sm" style={{ marginBottom: 14 }} onClick={onBack}>
        <Icon name="arrowLeft" size={15} /> เลือกโต๊ะอื่น
      </button>

      <div style={{ display: 'grid', gap: 18, gridTemplateColumns: 'minmax(0,1fr) minmax(0,368px)', alignItems: 'start' }}>
        {/* ── ใบเสร็จ ── */}
        <div className="card pad-l">
          <div className="between" style={{ marginBottom: 16 }}>
            <div>
              <h3 className="t-title">โต๊ะ {table.table_number}</h3>
              <p className="t-xs muted num">{visit.visit_code} · เข้าร้าน {clockTH(visit.check_in_at)}</p>
            </div>
            <Chip tone={VISIT_STATUS[visit.status].tone}>{VISIT_STATUS[visit.status].label}</Chip>
          </div>

          <div className="slip">
            {visit.adult_count > 0 && (
              <L label={`${visit.package_name_snapshot} (ผู้ใหญ่) × ${visit.adult_count}`}
                 v={visit.adult_count * visit.package_price_adult_satang} />
            )}
            {visit.child_count > 0 && (
              <L label={`${visit.package_name_snapshot} (เด็ก) × ${visit.child_count}`}
                 v={visit.child_count * visit.package_price_child_satang} />
            )}
            {visit.addons.map((a) => (
              <L key={a.add_on_id} label={`${a.name_snapshot} × ${a.quantity}`}
                 v={a.unit_price_satang * a.quantity} />
            ))}
            {extras.map((e) => (
              <L key={e.name_snapshot} label={`${e.name_snapshot} × ${e.quantity}`}
                 v={e.unit_price_satang * e.quantity} />
            ))}

            <div className="slip__r" />
            <L label="รวมก่อนภาษี" v={bill.subtotal} />
            {(visit.promotions ?? []).map((p) => (
              <L key={p.promotion_id} label={`ส่วนลด · ${p.name_snapshot}`} v={-p.discount_satang} />
            ))}
            {s.service_charge_enabled && <L label={`Service Charge ${s.service_charge_rate_bp / 100}%`} v={bill.service} />}
            {s.vat_enabled && (
              <L label={`VAT ${s.vat_rate_bp / 100}%${s.vat_inclusive ? ' (รวมแล้ว)' : ''}`}
                 v={s.vat_inclusive ? 0 : bill.vat} />
            )}
            <div className="slip__r" />
            <div className="slip__total"><span>ยอดสุทธิ</span><span className="num">{baht(bill.total)}</span></div>

            {paid > 0 && (
              <>
                <L label="ชำระแล้ว" v={-paid} />
                <div className="slip__total" style={{ fontSize: 14 }}>
                  <span>คงเหลือ</span><span className="num">{baht(due)}</span>
                </div>
              </>
            )}

            {s.payment_mode === 'mock' && (
              <p className="t-xs" style={{ marginTop: 14, textAlign: 'center', color: 'var(--brand)', fontWeight: 600 }}>
                ใบเสร็จทดสอบ — ไม่ใช่เอกสารทางภาษี
              </p>
            )}
          </div>
        </div>

        {/* ── ชำระเงิน ── */}
        <div className="card pad">
          <h3 className="t-head" style={{ marginBottom: 12 }}>รับชำระเงิน</h3>

          {waiting.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <Note tone="warn" icon="clock">
                ยังมีอาหารค้างที่ครัว {waiting.length} รายการ — เก็บเงินได้
                แต่ปิดรอบไม่ได้จนกว่าครัวจะกดเสิร์ฟหรือยกเลิกครบ
              </Note>
            </div>
          )}

          {due === 0 ? (
            <>
              <div style={{ marginBottom: 14 }}>
                <Note tone="ok" icon="check">
                  ชำระครบแล้ว ขั้นถัดไปคือปิดรอบเพื่อส่งโต๊ะไปทำความสะอาด
                </Note>
              </div>
              <button className="btn btn--primary btn--block"
                      disabled={visit.status !== 'paid' || waiting.length > 0}
                      onClick={() => { store.dispatch({ type: 'CLOSE_VISIT', visitId: visit.id }); onBack() }}>
                {waiting.length > 0 ? `รอครัวเคลียร์อีก ${waiting.length} รายการ` : 'ปิดรอบ · โต๊ะไปทำความสะอาด'}
              </button>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', padding: '4px 0 16px' }}>
                <p className="t-xs muted">ยอดที่ต้องชำระ</p>
                <p className="t-display num" style={{ fontSize: 32 }}>{baht(due)}</p>
              </div>

              <PromoBox visit={visit} store={store} />

              {PAYMENT_METHODS.map((m) => (
                <button key={m.id} className={`pay ${method === m.id ? 'pay--on' : ''}`}
                        onClick={() => { setMethod(m.id); setResult(null) }}>
                  <span className="pay__ico"><Icon name={m.icon} size={17} /></span>
                  <span className="grow">
                    <span className="bold t-sm">{m.label}</span>
                    <span className="t-xs muted" style={{ display: 'block' }}>{m.hint}</span>
                  </span>
                  {method === m.id && <span className="pay__check"><Icon name="check" size={17} strokeWidth={2} /></span>}
                </button>
              ))}

              <div style={{ marginTop: 16 }}>
                {method === 'cash' && (
                  <>
                    <label className="field">
                      {/* ปล่อยว่าง = รับพอดี — ของเดิม placeholder โชว์ยอดเหมือนกรอกไว้แล้ว
                          แต่ปุ่มยืนยันถูก disable เงียบ ๆ จนกว่าจะพิมพ์เอง */}
                      <span>รับเงินมา (บาท) · ปล่อยว่างคือรับพอดี</span>
                      <input inputMode="decimal" value={tendered} placeholder={satangToText(due)}
                             onChange={(e) => setTendered(e.target.value)} />
                    </label>
                    <div className="row g8 wrap" style={{ marginBottom: 12 }}>
                      <button className="btn btn--default btn--sm" onClick={() => setTendered(satangToText(due))}>พอดี</button>
                      {[500, 1000, 2000].map((n) => (
                        <button key={n} className="btn btn--default btn--sm" onClick={() => setTendered(String(n))}>
                          {n.toLocaleString('th-TH')}
                        </button>
                      ))}
                    </div>
                    {short && <div style={{ marginBottom: 12 }}><Note tone="warn">เงินที่รับมาน้อยกว่ายอดที่ต้องชำระ</Note></div>}
                    {change > 0 && (
                      <div className="between" style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--brand-soft)', borderRadius: 'var(--r-md)' }}>
                        <span className="bold t-sm">เงินทอน</span>
                        <span className="t-title num" style={{ color: 'var(--brand)' }}>{baht(change)}</span>
                      </div>
                    )}
                  </>
                )}

                {method === 'qr_promptpay' && (
                  <div style={{ textAlign: 'center', marginBottom: 12 }}>
                    <FauxQR />
                    <p className="t-xs muted" style={{ marginTop: 10, lineHeight: 1.7 }}>
                      QR จำลอง — ของจริงสร้าง payload EMVCo จาก PromptPay ID + ยอดเงิน
                      ให้ลูกค้าสแกน แล้วพนักงานกดยืนยันเมื่อเห็นสลิป
                    </p>
                  </div>
                )}

                {method === 'card' && (
                  <label className="field">
                    <span>เลขบัตรทดสอบ</span>
                    <select value={card} onChange={(e) => setCard(e.target.value)}>
                      {TEST_CARDS.map((c) => (
                        <option key={c.number} value={c.number}>{c.number} — {c.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {method === 'transfer' && (
                  <div style={{ marginBottom: 12 }}>
                    <Note tone="info" icon="bank">
                      ให้ลูกค้าโอนแล้วแสดงสลิป พนักงานตรวจสลิปก่อนกดยืนยัน
                    </Note>
                  </div>
                )}
              </div>

              <label className="field">
                <span>เบอร์โทรสมาชิก (ไม่บังคับ)</span>
                <input inputMode="tel" value={phone} placeholder="08X-XXX-XXXX"
                       onChange={(e) => setPhone(e.target.value)} />
              </label>
              {points > 0 && (
                <div className="between" style={{ marginBottom: 12 }}>
                  <span className="t-sm muted">แต้มที่จะได้รับ</span>
                  <Chip tone="gold" icon="sparkle">+{points}</Chip>
                </div>
              )}

              {result && (
                <div style={{ marginBottom: 12 }}>
                  <Note tone={result.ok ? 'ok' : 'warn'} icon={result.ok ? 'check' : 'alert'}>{result.text}</Note>
                </div>
              )}

              <button className="btn btn--primary btn--lg btn--block"
                      disabled={busy || short}
                      onClick={pay}>
                {busy ? 'กำลังดำเนินการ…' : `ยืนยันรับชำระ ${baht(due)}`}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * ใส่โค้ดโปรโมชั่นก่อนรับเงิน
 *
 * เงื่อนไขทั้งหมด (วัน เวลา ยอดขั้นต่ำ จำนวนครั้ง) ตรวจใน apply_promotion_code()
 * หน้าจอมีหน้าที่ส่งโค้ดกับแสดงข้อความกลับเท่านั้น — ห้ามคิดส่วนลดเองฝั่งเบราว์เซอร์
 */
function PromoBox({ visit, store }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const applied = visit.promotions ?? []

  async function run(fn) {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {applied.map((p) => (
        <div key={p.promotion_id} className="between" style={{ marginBottom: 8 }}>
          <Chip tone="gold" icon="tag">{p.name_snapshot} −{baht(p.discount_satang)}</Chip>
          <button className="btn btn--quiet btn--sm" disabled={busy}
                  onClick={() => run(() => store.removePromo(visit.id, p.promotion_id))}>
            ถอด
          </button>
        </div>
      ))}

      <div className="row g8">
        <input className="grow" placeholder="โค้ดโปรโมชั่น" value={code}
               style={{ textTransform: 'uppercase' }}
               onChange={(e) => setCode(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key !== 'Enter' || !code.trim()) return
                 run(async () => { await store.applyPromo(visit.id, code.trim()); setCode('') })
               }} />
        <button className="btn btn--default" disabled={busy || !code.trim()}
                onClick={() => run(async () => { await store.applyPromo(visit.id, code.trim()); setCode('') })}>
          ใส่โค้ด
        </button>
      </div>

      {error && <div style={{ marginTop: 10 }}><Note tone="warn" icon="alert">{error}</Note></div>}
    </div>
  )
}

function L({ label, v }) {
  return <div className="slip__l"><span>{label}</span><span className="num">{baht(v)}</span></div>
}

/** บล็อกลาย QR จำลอง ไม่ใช่ QR ที่สแกนได้จริง */
function FauxQR() {
  const cells = Array.from({ length: 169 }, (_, i) => (i * 7919) % 11 > 4)
  return (
    <div style={{
      width: 156, height: 156, margin: '0 auto', padding: 8, background: '#fff',
      border: '1px solid var(--n200)', borderRadius: 'var(--r-md)',
      display: 'grid', gridTemplateColumns: 'repeat(13, 1fr)', gap: 1,
    }} aria-label="QR จำลอง">
      {cells.map((on, i) => (
        <div key={i} style={{ background: on ? 'var(--n900)' : 'transparent', borderRadius: 1 }} />
      ))}
    </div>
  )
}
