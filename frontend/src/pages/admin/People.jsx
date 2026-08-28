import { useState } from 'react'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Empty, Note } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import * as admin from '../../api/admin'
import { useRows } from './Ops'
import { baht, bahtToSatang, satangToText } from '../../utils/money'
import { dateTH } from '../../utils/time'

// ---------------------------------------------------------------------------
// โปรโมชั่น · สมาชิก · พนักงาน
//
// โปรโมชั่นแก้ได้ที่นี่ (RLS manage_promotions = manager) แต่การ "ใช้" โปร
// ทำที่หน้าเช็คบิลผ่าน apply_promotion_code() เท่านั้น เงื่อนไขทั้งหมดตรวจฝั่ง DB
// ---------------------------------------------------------------------------

const DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

export function AdminPromotions() {
  const { rows, error, reload } = useRows(() => admin.listPromotions(), [])
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const run = async (fn) => {
    setBusy(true); setSaveError(null)
    try { await fn(); reload() } catch (e) { setSaveError(e.message) } finally { setBusy(false) }
  }

  return (
    <>
      <TopBar title="โปรโมชั่น" sub="พนักงานพิมพ์โค้ดที่หน้าเช็คบิล เงื่อนไขตรวจที่ฐานข้อมูล">
        <button className="btn btn--quiet btn--sm" onClick={reload}><Icon name="refresh" size={15} /></button>
      </TopBar>

      <div className="body">
        {(error ?? saveError) && (
          <div style={{ marginBottom: 16 }}><Note tone="warn" icon="alert">{error ?? saveError}</Note></div>
        )}
        {rows === null ? <p className="t-sm muted">กำลังโหลด…</p>
          : rows.length === 0 ? <Empty icon="tag" title="ยังไม่มีโปรโมชั่น" />
            : (
              <div className="tablewrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>โค้ด</th><th>ชื่อ</th><th>ส่วนลด</th><th className="num">ยอดขั้นต่ำ (บาท)</th>
                      <th>วัน</th><th>ช่วงเวลา</th><th className="num">ใช้ไป</th><th className="num">เปิด</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => <PromoRow key={p.id} promo={p} busy={busy} run={run} />)}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </>
  )
}

function PromoRow({ promo, busy, run }) {
  const [d, setD] = useState({
    name: promo.name,
    value: promo.type === 'percent' ? promo.value_bp / 100 : satangToText(promo.value_satang ?? 0),
    min: satangToText(promo.min_spend_satang),
    is_active: promo.is_active,
  })

  const days = promo.days_of_week?.length
    ? promo.days_of_week.map((n) => DOW[n]).join(' ')
    : 'ทุกวัน'
  const window = promo.time_start
    ? `${String(promo.time_start).slice(0, 5)}–${String(promo.time_end ?? '').slice(0, 5)}`
    : 'ทั้งวัน'

  return (
    <tr style={{ opacity: d.is_active ? 1 : .55 }}>
      <td><b className="num">{promo.code}</b></td>
      <td><input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></td>
      <td>
        <span className="row g4">
          <input inputMode="decimal" value={d.value} style={{ maxWidth: 80, textAlign: 'right' }}
                 onChange={(e) => setD({ ...d, value: e.target.value })} />
          <span className="t-xs muted">{promo.type === 'percent' ? '%' : promo.type === 'fixed' ? 'บาท' : promo.type}</span>
        </span>
      </td>
      <td className="num">
        <input inputMode="decimal" value={d.min} style={{ maxWidth: 100, textAlign: 'right' }}
               onChange={(e) => setD({ ...d, min: e.target.value })} />
      </td>
      <td className="muted">{days}</td>
      <td className="muted num">{window}</td>
      <td className="num">{promo.uses_count}{promo.max_uses ? ` / ${promo.max_uses}` : ''}</td>
      <td className="num">
        <input type="checkbox" checked={d.is_active}
               onChange={(e) => setD({ ...d, is_active: e.target.checked })} />
      </td>
      <td className="num">
        <button className="btn btn--default btn--sm" disabled={busy}
                onClick={() => run(() => admin.saveRow('promotions', {
                  id: promo.id,
                  name: d.name,
                  is_active: d.is_active,
                  min_spend_satang: bahtToSatang(d.min),
                  ...(promo.type === 'percent'
                    ? { value_bp: Math.round(Number(d.value) * 100) }
                    : promo.type === 'fixed'
                      ? { value_satang: bahtToSatang(d.value) }
                      : {}),
                }))}>
          บันทึก
        </button>
      </td>
    </tr>
  )
}

// ── สมาชิกและแต้ม ───────────────────────────────────────────────────────────
export function AdminCustomers() {
  const { rows, error } = useRows(() => admin.listCustomers(), [])
  const { rows: ledger } = useRows(() => admin.listLoyalty(50), [])

  return (
    <>
      <TopBar title="สมาชิก & แต้ม" sub="อ่านอย่างเดียว — แต้มถูกบันทึกอัตโนมัติตอนปิดรอบ" />
      <div className="body">
        {error && <div style={{ marginBottom: 16 }}><Note tone="warn" icon="alert">{error}</Note></div>}

        <p className="t-label" style={{ marginBottom: 10 }}>สมาชิก</p>
        {rows === null ? <p className="t-sm muted">กำลังโหลด…</p>
          : rows.length === 0 ? <Empty icon="users" title="ยังไม่มีสมาชิก" />
            : (
              <div className="tablewrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>ชื่อ</th><th>เบอร์โทร</th><th>ระดับ</th><th className="num">มากี่ครั้ง</th>
                      <th className="num">ยอดสะสม</th><th className="num">แต้ม</th><th>มาล่าสุด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id}>
                        <td><b>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</b></td>
                        <td className="num muted">{c.phone}</td>
                        <td><Chip tone="neutral">{c.tier}</Chip></td>
                        <td className="num">{c.total_visits}</td>
                        <td className="num">{baht(c.total_spend_satang)}</td>
                        <td className="num bold">{c.points_balance ?? 0}</td>
                        <td className="muted">{c.last_visit_at ? dateTH(c.last_visit_at) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

        <p className="t-label" style={{ margin: '24px 0 10px' }}>รายการแต้มล่าสุด</p>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>วันที่</th><th>ประเภท</th><th className="num">แต้ม</th><th>หมายเหตุ</th></tr></thead>
            <tbody>
              {(ledger ?? []).map((t) => (
                <tr key={t.id}>
                  <td className="muted">{dateTH(t.created_at)}</td>
                  <td><Chip tone={t.type === 'earn' ? 'ok' : 'neutral'}>{t.type}</Chip></td>
                  <td className="num bold">{t.points}</td>
                  <td className="muted">{t.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── พนักงาน ─────────────────────────────────────────────────────────────────
export function AdminStaff() {
  const { rows, error } = useRows(() => admin.listStaff(), [])

  return (
    <>
      <TopBar title="พนักงาน" sub="สร้างผู้ใช้ใหม่ทำที่ Supabase Auth แล้วผูกสิทธิ์ในตาราง profiles" />
      <div className="body">
        {error && <div style={{ marginBottom: 16 }}><Note tone="warn" icon="alert">{error}</Note></div>}
        {rows === null ? <p className="t-sm muted">กำลังโหลด…</p> : (
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>ชื่อ</th><th>สิทธิ์</th><th>สถานะ</th><th>เพิ่มเมื่อ</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.full_name ?? '—'}</b></td>
                    <td><Chip tone={p.role === 'manager' ? 'gold' : 'neutral'}>{p.role}</Chip></td>
                    <td className="muted">{p.is_active === false ? 'ปิดใช้งาน' : 'ใช้งาน'}</td>
                    <td className="muted">{dateTH(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
