import { useNavigate } from 'react-router-dom'
import { useStore } from '../../context/StoreProvider'
import { CustomerBar } from '../../components/layout/Layouts'
import { Countdown, Chip, Note, Photo, Kv } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import { SERVICE_TYPES } from '../../data/constants'
import { baht } from '../../utils/money'
import { remaining } from '../../utils/time'

export default function CustomerHome() {
  const nav = useNavigate()
  const store = useStore()
  const visit = store.visitOf(store.customerVisitId)
  const table = store.tableOf(visit.table_id)
  const pkg = store.packages.find((p) => p.id === visit.package_id)

  const guests = visit.adult_count + visit.child_count
  const r = remaining(visit.dining_deadline_at)
  const lastOrder = store.settings.last_order_minutes_before_end
  const isPremium = pkg.code === 'premium'

  const help = ['call_staff', 'refill_water', 'clean_table', 'request_bill']

  return (
    <>
      <CustomerBar
        title="Shabu Mood"
        right={<Chip tone="neutral">โต๊ะ {table.table_number}</Chip>}
      />

      <div className="cx__wrap">
        <div className="cx__cols cx__cols--split">
          <div className="stack g16">
            {/* ── สรุปโต๊ะ ── */}
            <div className="cx__hero">
              <Photo src={`/img/cat-${isPremium ? 'beef' : 'pork'}.jpg`} alt="" />
              <div className="cx__heroIn">
                <div className="between" style={{ alignItems: 'flex-end' }}>
                  <div>
                    <p className="t-xs" style={{ opacity: .75 }}>โต๊ะของคุณ</p>
                    <p className="t-display" style={{ fontSize: 32 }}>{table.table_number}</p>
                    <p className="t-sm" style={{ opacity: .88, marginTop: 3 }}>
                      แพ็กเกจ{pkg.name} · {guests} ท่าน
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p className="t-xs" style={{ opacity: .75 }}>เวลาที่เหลือ</p>
                    <Countdown deadline={visit.dining_deadline_at} size="26px" />
                  </div>
                </div>
              </div>
            </div>

            {/* ── เตือนเรื่องเวลา ── */}
            {r.over ? (
              <Note tone="warn" icon="clock">
                หมดเวลาการใช้บริการแล้ว กรุณาติดต่อพนักงานเพื่อเช็คบิล
              </Note>
            ) : r.totalMinutes <= lastOrder + 10 ? (
              <Note tone="warn" icon="clock">
                เหลืออีก {r.totalMinutes} นาที — สั่งอาหารได้ถึงก่อนหมดเวลา {lastOrder} นาที
              </Note>
            ) : null}

            {/* ── หมวดอาหาร ── */}
            <div>
              <div className="between" style={{ marginBottom: 10 }}>
                <h2 className="t-head">เลือกหมวดอาหาร</h2>
                <button className="btn btn--quiet btn--sm" onClick={() => nav('/order/menu')}>
                  ดูทั้งหมด <Icon name="chevronRight" size={14} strokeWidth={2} />
                </button>
              </div>

              <div className="catlist">
                {store.categories.map((c) => (
                  <button key={c.id} className="cat" onClick={() => nav(`/order/menu?cat=${c.id}`)}>
                    <Photo src={c.image} alt={c.name_th} />
                    <span>{c.name_th}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── คอลัมน์ขวาบนจอกว้าง ── */}
          <div className="stack g16">
            <div className="card pad">
              <div className="between" style={{ marginBottom: 12 }}>
                <h2 className="t-head">แพ็กเกจของโต๊ะนี้</h2>
                <Chip tone={isPremium ? 'gold' : 'brand'}>
                  {baht(pkg.price_per_adult_satang)} / ท่าน
                </Chip>
              </div>

              <p className="t-sm muted">{pkg.description}</p>

              <div className="stack g8" style={{ marginTop: 14 }}>
                <Kv label="ผู้ใหญ่" value={`${visit.adult_count} ท่าน`} />
                {visit.child_count > 0 && <Kv label="เด็ก" value={`${visit.child_count} ท่าน`} />}
                {visit.addons.map((a) => (
                  <Kv key={a.add_on_id} label={a.name_snapshot} value={`${a.quantity} ท่าน`} />
                ))}
                <Kv label="เวลานั่ง" value={`${pkg.dining_minutes} นาที`} />
              </div>

              {!isPremium && (
                <div style={{ marginTop: 14 }}>
                  <Note tone="info" icon="lock">
                    เมนูพรีเมียม เช่น เนื้อวากิว แซลมอน หอยเชลล์ สั่งได้เฉพาะแพ็กเกจพรีเมียม
                    หากต้องการอัปเกรดกรุณาแจ้งพนักงาน
                  </Note>
                </div>
              )}
            </div>

            <div className="card pad">
              <h2 className="t-head" style={{ marginBottom: 10 }}>ต้องการความช่วยเหลือ</h2>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(2, 1fr)' }}>
                {help.map((t) => (
                  <button
                    key={t}
                    className="btn btn--default"
                    style={{ justifyContent: 'flex-start', height: 42 }}
                    onClick={() => store.dispatch({ type: 'CALL_STAFF', visitId: visit.id, reqType: t })}
                  >
                    <Icon name={SERVICE_TYPES[t].icon} size={17} />
                    <span className="trunc">{SERVICE_TYPES[t].label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

