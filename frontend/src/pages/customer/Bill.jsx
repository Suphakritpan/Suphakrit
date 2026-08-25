import { useStore } from '../../context/StoreProvider'
import { CustomerBar } from '../../components/layout/Layouts'
import { Chip, MockBanner } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { baht, previewBill } from '../../utils/money'
import { VISIT_STATUS } from '../../data/constants'

export default function CustomerBill() {
  const store = useStore()
  const visit = store.visitOf(store.customerVisitId)
  const table = store.tableOf(visit.table_id)
  const extras = store.extraItemsOf(visit.id)
  const s = store.settings

  const bill = previewBill({ visit, addons: visit.addons, extraItems: extras, settings: s })
  const guests = visit.adult_count + visit.child_count
  const points = s.points_enabled ? Math.floor(bill.total / 100 / s.points_baht_per_point) : 0

  return (
    <>
      <CustomerBar title="ยอดเงิน" back="/order" />

      <div className="cx__wrap">
        <div style={{ marginBottom: 16 }}><MockBanner /></div>

        <div className="cx__cols cx__cols--split">
          <div className="card">
            <div className="between pad" style={{ borderBottom: '1px solid var(--n100)' }}>
              <span className="t-sm muted">โต๊ะ {table.table_number} · {visit.visit_code}</span>
              <Chip tone={VISIT_STATUS[visit.status].tone}>{VISIT_STATUS[visit.status].label}</Chip>
            </div>

            <div className="pad-l" style={{ textAlign: 'center', borderBottom: '1px solid var(--n100)' }}>
              <p className="t-xs muted">ยอดรวมโดยประมาณ</p>
              <p className="t-display num" style={{ fontSize: 38, marginTop: 2 }}>{baht(bill.total)}</p>
              <p className="t-xs muted">
                {guests} ท่าน · เฉลี่ย {baht(Math.round(bill.total / guests))} ต่อท่าน
              </p>
            </div>

            <div className="pad">
              <p className="t-label" style={{ marginBottom: 10 }}>รายละเอียด</p>

              {visit.adult_count > 0 && (
                <Row label={`${visit.package_name_snapshot} (ผู้ใหญ่)`}
                     sub={`${baht(visit.package_price_adult_satang)} × ${visit.adult_count}`}
                     amount={visit.adult_count * visit.package_price_adult_satang} />
              )}
              {visit.child_count > 0 && (
                <Row label={`${visit.package_name_snapshot} (เด็ก)`}
                     sub={`${baht(visit.package_price_child_satang)} × ${visit.child_count}`}
                     amount={visit.child_count * visit.package_price_child_satang} />
              )}
              {visit.addons.map((a) => (
                <Row key={a.add_on_id} label={a.name_snapshot}
                     sub={`${baht(a.unit_price_satang)} × ${a.quantity} ท่าน`}
                     amount={a.unit_price_satang * a.quantity} />
              ))}
              {extras.map((e) => (
                <Row key={e.name_snapshot} label={e.name_snapshot}
                     sub={`สั่งพิเศษ ${baht(e.unit_price_satang)} × ${e.quantity}`}
                     amount={e.unit_price_satang * e.quantity} />
              ))}

              <div style={{ borderTop: '1px solid var(--n200)', margin: '12px 0' }} />

              <Row label="รวมก่อนภาษี" amount={bill.subtotal} bold />
              {bill.discount > 0 && <Row label="ส่วนลด" amount={-bill.discount} />}
              {s.service_charge_enabled && (
                <Row label={`Service Charge ${s.service_charge_rate_bp / 100}%`} amount={bill.service} />
              )}
              {s.vat_enabled && (
                <Row label={`VAT ${s.vat_rate_bp / 100}%${s.vat_inclusive ? ' (รวมในราคาแล้ว)' : ''}`}
                     sub={s.vat_inclusive ? `ภาษีที่รวมอยู่ ${baht(bill.vat)}` : null}
                     amount={s.vat_inclusive ? 0 : bill.vat} />
              )}

              <div style={{ borderTop: '2px solid var(--n800)', margin: '12px 0 10px' }} />
              <div className="between">
                <span className="t-head">ยอดสุทธิ</span>
                <span className="t-title num">{baht(bill.total)}</span>
              </div>
            </div>
          </div>

          <div className="stack g16">
            {points > 0 && (
              <div className="card pad">
                <div className="between">
                  <div>
                    <p className="bold t-sm">แต้มที่จะได้รับ</p>
                    <p className="t-xs muted" style={{ marginTop: 3 }}>
                      ทุก {s.points_baht_per_point} บาท = 1 แต้ม
                      แจ้งเบอร์โทรกับพนักงานตอนเช็คบิลเพื่อสะสม
                    </p>
                  </div>
                  <Chip tone="gold" icon="sparkle">+{points}</Chip>
                </div>
              </div>
            )}

            <div className="card pad">
              <p className="t-head" style={{ marginBottom: 4 }}>พร้อมเช็คบิลแล้ว?</p>
              <p className="t-sm muted" style={{ marginBottom: 12 }}>
                กดแจ้งพนักงาน แล้วรอที่โต๊ะได้เลย พนักงานจะนำใบเสร็จมาให้และรับชำระที่โต๊ะ
              </p>
              <button
                className="btn btn--primary btn--lg btn--block"
                onClick={() => store.dispatch({ type: 'CALL_STAFF', visitId: visit.id, reqType: 'request_bill' })}
              >
                <Icon name="receipt" size={17} /> เรียกพนักงานเช็คบิล
              </button>
            </div>

            <p className="t-xs dim" style={{ lineHeight: 1.8 }}>
              ยอดนี้เป็นการคำนวณเพื่อแสดงผลเท่านั้น
              ยอดที่ใช้เก็บเงินจริงคำนวณจากฐานข้อมูลตอนพนักงานกดเช็คบิล
              เพื่อกันการแก้ตัวเลขจากฝั่งเบราว์เซอร์
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

function Row({ label, sub, amount, bold }) {
  return (
    <div className="between" style={{ padding: '5px 0', alignItems: 'flex-start' }}>
      <span className={bold ? 'bold t-sm' : 't-sm'}>
        {label}
        {sub && <span className="t-xs muted" style={{ display: 'block' }}>{sub}</span>}
      </span>
      <span className={`num ${bold ? 'bold' : ''}`}>{baht(amount)}</span>
    </div>
  )
}
