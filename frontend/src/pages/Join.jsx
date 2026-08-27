import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../context/StoreProvider'
import { Note } from '../components/shared/Bits'
import Icon from '../components/ui/Icon'

/**
 * ปลายทางของ QR บนสลิป — /v/:token
 *
 * token คือ visits.session_token ซึ่งถูกล้างเป็น null ทันทีที่ปิดบิล
 * ดังนั้น QR ของรอบเก่าจะสั่งอาหารเข้าบิลใหม่ไม่ได้ ตามที่ออกแบบไว้
 *
 * ตัว join ทำงานฝั่งฐานข้อมูลทั้งหมด (join_visit) หน้านี้แค่เรียกแล้วพาไปต่อ
 */
export default function Join() {
  const { token } = useParams()
  const nav = useNavigate()
  const { joinByToken, mode } = useStore()
  const [error, setError] = useState(null)
  const done = useRef(false)

  useEffect(() => {
    // โหมด demo ไม่มีฐานข้อมูลให้ join — พาเข้าหน้าลูกค้าไปเลย
    if (mode === 'demo') { nav('/order', { replace: true }); return }
    if (mode !== 'live' || done.current) return

    done.current = true
    joinByToken(token)
      .then(() => nav('/order', { replace: true }))
      .catch((e) => setError(e.message))
  }, [token, mode, joinByToken, nav])

  return (
    <div className="cx__wrap" style={{ paddingTop: 72, maxWidth: 420, margin: '0 auto' }}>
      {error ? (
        <>
          <Note tone="warn" icon="alert">{error}</Note>
          <p className="t-sm muted" style={{ marginTop: 14, lineHeight: 1.8 }}>
            ถ้าเพิ่งนั่งโต๊ะนี้ ลองสแกน QR บนสลิปใบล่าสุด
            หรือแจ้งพนักงานเพื่อออกสลิปใหม่
          </p>
        </>
      ) : (
        <div className="row g12" style={{ justifyContent: 'center', color: 'var(--n300)' }}>
          <Icon name="refresh" size={19} />
          <span className="t-sm">กำลังเปิดโต๊ะของคุณ…</span>
        </div>
      )}
    </div>
  )
}
