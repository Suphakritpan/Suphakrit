import { useState } from 'react'
import { useStore } from '../context/StoreProvider'
import { Note } from '../components/shared/Bits'
import Icon from '../components/ui/Icon'

/**
 * ล็อกอินพนักงาน / ผู้จัดการ
 *
 * หน้านี้ไม่ได้เป็นตัวกันความปลอดภัย — ของจริงกันที่ RLS และ is_staff() ในฐานข้อมูล
 * คนที่ไม่มี session ต่อให้เปิดหน้าจอได้ ก็ไม่มีข้อมูลอะไรกลับมาให้เห็น
 * หน้านี้มีไว้เพื่อ "สร้าง session" และบอกให้รู้ว่าต้องล็อกอินก่อน
 */
export default function Login({ kind = 'staff' }) {
  const { signInStaff } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signInStaff(email.trim(), password)
      // ไม่ต้อง navigate — onAuthChange ใน StoreProvider จะอัปเดต session
      // แล้ว ConsoleLayout จะเรนเดอร์คอนโซลแทนหน้านี้เอง
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="entry">
      <div className="entry__body" style={{ maxWidth: 420, margin: '0 auto', paddingTop: 64 }}>
        <div className="card pad-l">
          <div className="row g8" style={{ marginBottom: 6, color: 'var(--brand)' }}>
            <Icon name="flame" size={21} strokeWidth={1.7} />
            <b>Shabu Mood</b>
          </div>
          <h1 className="t-title" style={{ marginBottom: 4 }}>
            {kind === 'admin' ? 'เข้าสู่ระบบผู้จัดการ' : 'เข้าสู่ระบบพนักงาน'}
          </h1>
          <p className="t-sm muted" style={{ marginBottom: 18 }}>
            ใช้บัญชีที่ผู้จัดการสร้างให้ ไม่ใช่บัญชีลูกค้า
          </p>

          <form onSubmit={submit}>
            <label className="field">
              <span>อีเมล</span>
              <input type="email" required autoComplete="username"
                     value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>รหัสผ่าน</span>
              <input type="password" required autoComplete="current-password"
                     value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>

            {error && <div style={{ marginBottom: 12 }}><Note tone="warn" icon="alert">{error}</Note></div>}

            <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={busy}>
              {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        </div>

        <p className="t-xs dim" style={{ marginTop: 16, lineHeight: 1.8, textAlign: 'center' }}>
          ลูกค้าไม่ต้องล็อกอิน — สแกน QR บนสลิปที่โต๊ะได้เลย
        </p>
      </div>
    </div>
  )
}
