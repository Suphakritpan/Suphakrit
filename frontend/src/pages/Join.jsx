import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreProvider'
import { Note } from '../components/shared/Bits'
import Icon from '../components/ui/Icon'

/**
 * ปลายทางของ QR ทั้งสองแบบ — /v/:token
 *
 *   QR บนสลิป      token = visits.session_token ใช้ได้รอบเดียว
 *                  ถูกล้างเป็น null ทันทีที่ปิดบิล QR รอบเก่าจึงสั่งเข้าบิลใหม่ไม่ได้
 *   QR ติดโต๊ะ      token = tables.qr_token เป็นสติกเกอร์ถาวร
 *                  จึงต้องใส่รหัส 6 หลักจากสลิปด้วย ไม่งั้นคนเดินผ่านก็สั่งได้
 *
 * หน้านี้ลองทางแรกก่อนเพราะเป็นทางปกติ ถ้าฐานข้อมูลปฏิเสธค่อยขอรหัส
 * ตัวตรวจรหัส ล็อกเมื่อผิดหลายครั้ง และเพดานจำนวนเครื่อง อยู่ใน join_visit ทั้งหมด
 */
export default function Join() {
  const { token } = useParams()
  const nav = useNavigate()
  const { joinByToken, mode } = useStore()
  const [error, setError] = useState(null)
  const [needCode, setNeedCode] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    // โหมด demo ไม่มีฐานข้อมูลให้ join — พาเข้าหน้าลูกค้าไปเลย
    if (mode === 'demo') { nav('/order', { replace: true }); return }
    if (mode !== 'live' || done.current) return

    done.current = true
    joinByToken(token)
      .then(() => nav('/order', { replace: true }))
      .catch((e) => { setError(e.message); setNeedCode(true) })
  }, [token, mode, joinByToken, nav])

  async function submitCode(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      await joinByToken(token, code.trim())
      nav('/order', { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="cx__wrap" style={{ paddingTop: 72, maxWidth: 420, margin: '0 auto' }}>
      {needCode ? (
        <form onSubmit={submitCode}>
          <h1 className="t-title" style={{ marginBottom: 6 }}>ใส่รหัสเข้าโต๊ะ</h1>
          <p className="t-sm muted" style={{ marginBottom: 16, lineHeight: 1.8 }}>
            รหัส 6 หลักอยู่บนใบรับประทานที่พนักงานให้ไว้ที่โต๊ะ
          </p>

          <label className="field">
            <span>รหัส 6 หลัก</span>
            <input
              inputMode="numeric" autoFocus maxLength={6} value={code}
              onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              style={{ fontSize: 24, letterSpacing: '.28em', textAlign: 'center' }}
            />
          </label>

          {error && <Note tone="warn" icon="alert">{error}</Note>}

          <button className="btn btn--primary btn--lg btn--block" style={{ marginTop: 14 }}
                  disabled={busy || code.length < 6}>
            {busy ? 'กำลังเข้าโต๊ะ…' : 'เข้าโต๊ะ'}
          </button>

          <p className="t-xs muted" style={{ marginTop: 14, lineHeight: 1.8 }}>
            ใส่รหัสผิดหลายครั้งระบบจะล็อกชั่วคราวเพื่อความปลอดภัย
            ถ้ารหัสหาย แจ้งพนักงานเพื่อออกสลิปใหม่
          </p>
        </form>
      ) : (
        <div className="row g12" style={{ justifyContent: 'center', color: 'var(--n300)' }}>
          <Icon name="refresh" size={19} />
          <span className="t-sm">กำลังเปิดโต๊ะของคุณ…</span>
        </div>
      )}
    </div>
  )
}
