import { useCallback, useEffect, useState } from 'react'
import { useStore } from '../../context/StoreProvider'
import { TopBar } from '../../components/layout/Layouts'
import { Chip, Empty, Note } from '../../components/shared/Bits'
import Icon from '../../components/ui/Icon'
import * as admin from '../../api/admin'
import { baht } from '../../utils/money'
import { clockTH, dateTH, minutesSince } from '../../utils/time'
import { ORDER_STATUS, VISIT_STATUS } from '../../data/constants'

// ---------------------------------------------------------------------------
// หน้าตรวจสอบของผู้จัดการ — คิว · รอบการใช้บริการ · บิลและการชำระเงิน · audit
//
// ข้อมูลพวกนี้ไม่ได้อยู่ใน store กลาง เพราะ store เก็บเฉพาะ "สิ่งที่กำลังเกิดขึ้น"
// ส่วนหน้าผู้จัดการต้องเห็นของที่จบไปแล้ววันนี้ด้วย จึงโหลดแยกทีละหน้า
// ---------------------------------------------------------------------------

/** โหลดข้อมูลของหน้านั้น ๆ พร้อมปุ่มโหลดใหม่ — ไม่มี cache ตั้งใจให้เห็นของสดเสมอ */
export function useRows(loader, deps = []) {
  const [state, setState] = useState({ rows: null, error: null })
  const reload = useCallback(() => {
    let alive = true
    loader()
      .then((rows) => { if (alive) setState({ rows, error: null }) })
      .catch((e) => { if (alive) setState({ rows: [], error: e.message }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(reload, [reload])
  return { ...state, reload }
}

function Frame({ title, sub, error, rows, children, actions }) {
  return (
    <>
      <TopBar title={title} sub={sub}>{actions}</TopBar>
      <div className="body">
        {error && <div style={{ marginBottom: 16 }}><Note tone="warn" icon="alert">{error}</Note></div>}
        {rows === null
          ? <p className="t-sm muted">กำลังโหลด…</p>
          : rows.length === 0
            ? <Empty icon="tray" title="ยังไม่มีข้อมูลของวันนี้" />
            : children}
      </div>
    </>
  )
}

const QUEUE_STATUS = {
  waiting:   { label: 'รออยู่',        tone: 'warn' },
  called:    { label: 'เรียกแล้ว',     tone: 'info' },
  seated:    { label: 'จัดโต๊ะแล้ว',    tone: 'ok' },
  cancelled: { label: 'ยกเลิก',        tone: 'neutral' },
  no_show:   { label: 'ไม่มาตามเรียก', tone: 'brand' },
}

// ── คิวทั้งวัน ──────────────────────────────────────────────────────────────
export function AdminQueue() {
  const store = useStore()
  const tz = store.settings?.timezone ?? 'Asia/Bangkok'
  const { rows, error, reload } = useRows(() => admin.listQueueToday(tz), [tz])

  const tally = (rows ?? []).reduce((a, q) => ({ ...a, [q.status]: (a[q.status] ?? 0) + 1 }), {})

  return (
    <Frame
      title="คิวทั้งวัน" sub="ทุกสถานะ รวมที่ยกเลิกและไม่มาตามเรียก"
      error={error} rows={rows}
      actions={
        <>
          {Object.entries(QUEUE_STATUS).map(([k, v]) => (
            tally[k] ? <Chip key={k} tone={v.tone}>{v.label} {tally[k]}</Chip> : null
          ))}
          <button className="btn btn--quiet btn--sm" onClick={reload}>
            <Icon name="refresh" size={15} />
          </button>
        </>
      }
    >
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>คิว</th><th className="num">จำนวน</th><th>ชื่อ</th><th>เบอร์โทร</th>
              <th>ออกบัตร</th><th>เรียกเมื่อ</th><th>จัดโต๊ะเมื่อ</th>
              <th className="num">รอ (นาที)</th><th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((q) => {
              const until = q.seated_at ?? q.called_at ?? q.updated_at ?? new Date().toISOString()
              return (
                <tr key={q.id}>
                  <td><b className="num">{q.ticket_number}</b></td>
                  <td className="num">
                    {q.party_size}
                    {q.child_count > 0 && <span className="muted"> (เด็ก {q.child_count})</span>}
                  </td>
                  <td className="muted">{q.customer_name ?? '—'}</td>
                  <td className="muted num">{q.phone ?? '—'}</td>
                  <td className="num">{clockTH(q.created_at)}</td>
                  <td className="num">{clockTH(q.called_at)}</td>
                  <td className="num">{clockTH(q.seated_at)}</td>
                  <td className="num">{minutesSince(q.created_at, new Date(until).getTime())}</td>
                  <td>
                    <Chip tone={QUEUE_STATUS[q.status]?.tone ?? 'neutral'}>
                      {QUEUE_STATUS[q.status]?.label ?? q.status}
                    </Chip>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Frame>
  )
}

// ── รอบการใช้บริการ + drill-down ────────────────────────────────────────────
export function AdminVisits() {
  const store = useStore()
  const tz = store.settings?.timezone ?? 'Asia/Bangkok'
  const { rows, error, reload } = useRows(() => admin.listVisitsToday(tz), [tz])
  const [openId, setOpenId] = useState(null)

  return (
    <Frame
      title="รอบการใช้บริการวันนี้" sub="กดที่แถวเพื่อดูออเดอร์ บิล และการชำระเงินของโต๊ะนั้น"
      error={error} rows={rows}
      actions={<button className="btn btn--quiet btn--sm" onClick={reload}><Icon name="refresh" size={15} /></button>}
    >
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>บิล</th><th>โต๊ะ</th><th>แพ็กเกจ</th><th className="num">คน</th>
              <th>เข้าร้าน</th><th>ออก</th><th className="num">ยอด</th><th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((v) => (
              <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(v.id)}>
                <td><b className="num">{v.visit_code}</b></td>
                <td className="num">{store.tableOf(v.table_id)?.table_number ?? '—'}</td>
                <td className="muted">{v.package_name_snapshot}</td>
                <td className="num">{v.adult_count + v.child_count}</td>
                <td className="num">{clockTH(v.check_in_at)}</td>
                <td className="num">{clockTH(v.check_out_at)}</td>
                <td className="num bold">{baht(v.total_satang)}</td>
                <td>
                  <Chip tone={VISIT_STATUS[v.status]?.tone ?? 'neutral'}>
                    {VISIT_STATUS[v.status]?.label ?? v.status}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openId && (
        <VisitSheet
          visit={(rows ?? []).find((v) => v.id === openId)}
          table={store.tableOf((rows ?? []).find((v) => v.id === openId)?.table_id)}
          onClose={() => setOpenId(null)}
        />
      )}
    </Frame>
  )
}

function VisitSheet({ visit, table, onClose }) {
  const { rows: detail, error } = useRows(async () => [await admin.visitDetail(visit.id)], [visit.id])
  const d = detail?.[0]

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className="sheet__hd between">
          <div>
            <h3 className="t-title">โต๊ะ {table?.table_number ?? '—'} · {visit.visit_code}</h3>
            <p className="t-xs muted">
              {visit.package_name_snapshot} · {visit.adult_count + visit.child_count} ท่าน ·
              เข้าร้าน {clockTH(visit.check_in_at)}
            </p>
          </div>
          <Chip tone={VISIT_STATUS[visit.status]?.tone ?? 'neutral'}>
            {VISIT_STATUS[visit.status]?.label ?? visit.status}
          </Chip>
        </div>

        <div className="sheet__bd">
          {error && <Note tone="warn" icon="alert">{error}</Note>}
          {!d ? <p className="t-sm muted">กำลังโหลด…</p> : (
            <>
              <p className="t-label" style={{ marginBottom: 8 }}>ออเดอร์ {d.orders.length} รอบ</p>
              {d.orders.map((o) => (
                <div key={o.id} className="card pad-s" style={{ marginBottom: 8 }}>
                  <div className="between t-xs muted" style={{ marginBottom: 6 }}>
                    <span>รอบที่ {o.order_number}</span><span>{clockTH(o.created_at)}</span>
                  </div>
                  {o.items.map((i) => (
                    <div key={i.id} className="between t-sm" style={{ padding: '3px 0' }}>
                      <span className="trunc">{i.quantity} × {i.name_snapshot}</span>
                      <span className="row g8">
                        {i.cancelled_reason && <span className="t-xs muted">{i.cancelled_reason}</span>}
                        <Chip tone={ORDER_STATUS[i.status]?.tone ?? 'neutral'}>
                          {ORDER_STATUS[i.status]?.label ?? i.status}
                        </Chip>
                      </span>
                    </div>
                  ))}
                </div>
              ))}

              <p className="t-label" style={{ margin: '16px 0 8px' }}>บิล</p>
              <div className="slip">
                {d.billLines.map((l) => (
                  <div key={l.id} className="slip__l">
                    <span>{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ''}</span>
                    <span className="num">{baht(l.amount_satang)}</span>
                  </div>
                ))}
                <div className="slip__r" />
                <div className="slip__total">
                  <span>ยอดสุทธิ</span><span className="num">{baht(visit.total_satang)}</span>
                </div>
              </div>

              <p className="t-label" style={{ margin: '16px 0 8px' }}>การชำระเงิน</p>
              {d.payments.length === 0 ? (
                <p className="t-sm muted">ยังไม่มีรายการชำระ</p>
              ) : d.payments.map((p) => (
                <div key={p.id} className="between t-sm" style={{ padding: '4px 0' }}>
                  <span>{p.method} · {clockTH(p.completed_at ?? p.created_at)}</span>
                  <span className="row g8">
                    <span className="num bold">{baht(p.amount_satang)}</span>
                    <Chip tone={p.status === 'succeeded' ? 'ok' : 'neutral'}>{p.status}</Chip>
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="sheet__ft">
          <button className="btn btn--default grow" onClick={onClose}>ปิด</button>
        </div>
      </div>
    </div>
  )
}

// ── บิลและการชำระเงิน ───────────────────────────────────────────────────────
export function AdminBills() {
  const store = useStore()
  const tz = store.settings?.timezone ?? 'Asia/Bangkok'
  const { rows, error, reload } = useRows(() => admin.listPaymentsToday(tz), [tz])

  const ok = (rows ?? []).filter((p) => p.status === 'succeeded')
  const total = ok.reduce((n, p) => n + p.amount_satang, 0)
  const byMethod = ok.reduce((a, p) => ({ ...a, [p.method]: (a[p.method] ?? 0) + p.amount_satang }), {})

  return (
    <Frame
      title="บิล & การชำระเงิน" sub="ทุกรายการของวันนี้ รวมที่ยกเลิกและที่ค้าง"
      error={error} rows={rows}
      actions={
        <>
          <Chip tone="ok">รับจริง {baht(total)}</Chip>
          <button className="btn btn--quiet btn--sm" onClick={reload}><Icon name="refresh" size={15} /></button>
        </>
      }
    >
      <div className="row g8 wrap" style={{ marginBottom: 16 }}>
        {Object.entries(byMethod).map(([m, n]) => (
          <Chip key={m} tone="neutral">{m} · {baht(n)}</Chip>
        ))}
      </div>

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>เวลา</th><th>ใบเสร็จ</th><th>ช่องทาง</th>
              <th className="num">ยอด</th><th className="num">รับมา</th><th className="num">ทอน</th><th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((p) => (
              <tr key={p.id}>
                <td className="num">{clockTH(p.completed_at ?? p.created_at)}</td>
                <td className="num muted">{p.receipt_number ?? '—'}</td>
                <td>{p.method}</td>
                <td className="num bold">{baht(p.amount_satang)}</td>
                <td className="num muted">{p.tendered_satang ? baht(p.tendered_satang) : '—'}</td>
                <td className="num muted">{p.change_satang ? baht(p.change_satang) : '—'}</td>
                <td>
                  <Chip tone={p.status === 'succeeded' ? 'ok' : p.status === 'failed' ? 'brand' : 'neutral'}>
                    {p.status}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  )
}

// ── audit log ───────────────────────────────────────────────────────────────
export function AdminAudit() {
  const { rows, error, reload } = useRows(() => admin.listAudit(200), [])
  const [openId, setOpenId] = useState(null)
  const open = (rows ?? []).find((r) => r.id === openId)

  return (
    <Frame
      title="บันทึกการตรวจสอบ" sub="200 รายการล่าสุด — ใครทำ เมื่อไร ก่อน/หลังเป็นอะไร"
      error={error} rows={rows}
      actions={<button className="btn btn--quiet btn--sm" onClick={reload}><Icon name="refresh" size={15} /></button>}
    >
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr><th>เวลา</th><th>การกระทำ</th><th>ตาราง</th><th>ผู้ทำ</th><th>เหตุผล</th><th /></tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id}>
                <td className="num">{dateTH(r.created_at)} {clockTH(r.created_at)}</td>
                <td><b>{r.action}</b></td>
                <td className="muted">{r.entity}</td>
                <td className="muted">{r.actor_role ?? '—'}</td>
                <td className="muted trunc" style={{ maxWidth: 220 }}>{r.reason ?? '—'}</td>
                <td className="num">
                  {(r.before || r.after) && (
                    <button className="btn btn--quiet btn--sm" onClick={() => setOpenId(r.id)}>ดูค่า</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="sheet" onClick={() => setOpenId(null)}>
          <div className="sheet__box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="sheet__hd">
              <h3 className="t-title">{open.action}</h3>
              <p className="t-xs muted">{open.entity} · {open.entity_id}</p>
            </div>
            <div className="sheet__bd">
              <p className="t-label" style={{ marginBottom: 6 }}>ก่อน</p>
              <pre className="t-xs" style={{ overflowX: 'auto', background: 'var(--n50)', padding: 10, borderRadius: 8 }}>
                {JSON.stringify(open.before, null, 2) ?? '—'}
              </pre>
              <p className="t-label" style={{ margin: '14px 0 6px' }}>หลัง</p>
              <pre className="t-xs" style={{ overflowX: 'auto', background: 'var(--n50)', padding: 10, borderRadius: 8 }}>
                {JSON.stringify(open.after, null, 2) ?? '—'}
              </pre>
            </div>
            <div className="sheet__ft">
              <button className="btn btn--default grow" onClick={() => setOpenId(null)}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </Frame>
  )
}
