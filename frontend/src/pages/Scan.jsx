import { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { Note } from '../components/shared/Bits'

// ---------------------------------------------------------------------------
// สแกน QR ในแอป — สำหรับลูกค้าที่เปิดเว็บร้านค้างไว้แล้วอยากสแกนจากในนี้เลย
//
// ถอดรหัสสองทาง ตามที่เครื่องรองรับ
//   1. BarcodeDetector ของเบราว์เซอร์ — เร็วและไม่กินแบตเพราะทำที่ระดับระบบ
//      มีใน Chrome/Android แต่ Safari บน iOS ยังไม่มี
//   2. jsQR อ่านจากเฟรมที่วาดลง canvas — ช้ากว่าแต่ทำงานได้ทุกที่
// โหลด jsQR แบบ dynamic import เพื่อไม่ให้เครื่องที่ใช้ทางแรกต้องดาวน์โหลดไปเปล่า ๆ
//
// ⚠️ กล้องเปิดได้เฉพาะหน้าที่เสิร์ฟผ่าน https (หรือ localhost) เป็นข้อบังคับของเบราว์เซอร์
//    ไม่ใช่ข้อจำกัดของระบบนี้ — บอกผู้ใช้ตรง ๆ แทนที่จะปล่อยให้จอค้างดำ
// ---------------------------------------------------------------------------

/** รับได้ทั้งลิงก์เต็มและโค้ดเปล่า คืน path ในแอปที่ควรพาไป */
export function routeFromScan(text) {
  const raw = (text ?? '').trim()
  if (!raw) return null

  const m = raw.match(/\/(v|q)\/([A-Za-z0-9-]{6,})/)
  if (m) return `/${m[1]}/${m[2]}`

  // QR ที่เก็บ token เปล่า ๆ ให้ถือว่าเป็น QR ของโต๊ะ ซึ่งเป็นกรณีที่พบบ่อยกว่า
  if (/^[0-9a-f-]{20,}$/i.test(raw)) return `/v/${raw}`
  return null
}

export default function Scan() {
  const nav = useNavigate()
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  const [manual, setManual] = useState('')

  useEffect(() => {
    let stream = null
    let raf = 0
    let stopped = false
    let detector = null
    let jsQR = null

    const handle = (text) => {
      const to = routeFromScan(text)
      if (!to || stopped) return
      stopped = true
      nav(to)
    }

    async function tick() {
      const video = videoRef.current
      if (stopped || !video || video.readyState < 2) {
        raf = requestAnimationFrame(tick)
        return
      }
      try {
        if (detector) {
          const found = await detector.detect(video)
          if (found[0]?.rawValue) return handle(found[0].rawValue)
        } else if (jsQR) {
          const c = canvasRef.current
          const w = video.videoWidth, h = video.videoHeight
          if (w && h) {
            c.width = w; c.height = h
            const ctx = c.getContext('2d', { willReadFrequently: true })
            ctx.drawImage(video, 0, 0, w, h)
            const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)
            if (found?.data) return handle(found.data)
          }
        }
      } catch { /* เฟรมเดียวอ่านไม่ออกไม่ใช่เรื่องใหญ่ ลองเฟรมถัดไป */ }
      if (!stopped) raf = requestAnimationFrame(tick)
    }

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('เบราว์เซอร์นี้เปิดกล้องไม่ได้')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } }, audio: false,
        })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setReady(true)

        if ('BarcodeDetector' in window) {
          const kinds = await window.BarcodeDetector.getSupportedFormats?.() ?? []
          if (kinds.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        }
        if (!detector) jsQR = (await import('jsqr')).default

        raf = requestAnimationFrame(tick)
      } catch (e) {
        setError(
          e?.name === 'NotAllowedError'
            ? 'ยังไม่ได้อนุญาตให้ใช้กล้อง — กดอนุญาตในแถบที่เบราว์เซอร์ถามแล้วลองใหม่'
            : location.protocol !== 'https:' && location.hostname !== 'localhost'
              ? 'เบราว์เซอร์เปิดกล้องให้เฉพาะหน้าเว็บที่เป็น https เท่านั้น'
              : (e?.message ?? 'เปิดกล้องไม่สำเร็จ'))
      }
    }

    start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [nav])

  const goManual = () => {
    const to = routeFromScan(manual)
    if (to) nav(to)
    else setError('ลิงก์หรือโค้ดนี้อ่านไม่ออก ลองคัดลอกมาใหม่ทั้งบรรทัด')
  }

  return (
    <div className="cx">
      <header className="cx__bar">
        <Link className="btn btn--quiet btn--icon btn--sm" to="/" aria-label="ย้อนกลับ">
          <Icon name="arrowLeft" size={18} />
        </Link>
        <h1 className="grow trunc">สแกน QR</h1>
      </header>

      <div className="cx__wrap" style={{ maxWidth: 480, margin: '0 auto', paddingTop: 16 }}>
        <div className="scanbox">
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} hidden />
          <div className="scanbox__frame" aria-hidden="true" />
          {!ready && !error && <p className="scanbox__hint">กำลังเปิดกล้อง…</p>}
        </div>

        <p className="t-sm muted" style={{ margin: '12px 0 16px', textAlign: 'center' }}>
          เล็ง QR บนโต๊ะหรือบนบัตรคิวให้อยู่ในกรอบ ระบบจะพาไปต่อเอง
        </p>

        {error && <div style={{ marginBottom: 16 }}><Note tone="warn" icon="alert">{error}</Note></div>}

        <label className="field">
          <span>หรือวางลิงก์ / โค้ดจาก QR ที่นี่</span>
          <input value={manual} onChange={(e) => setManual(e.target.value)}
                 placeholder="https://… /v/…" onKeyDown={(e) => e.key === 'Enter' && goManual()} />
        </label>
        <button className="btn btn--primary btn--block" disabled={!manual.trim()} onClick={goManual}>
          ไปต่อ
        </button>

        <p className="t-xs muted" style={{ marginTop: 14, textAlign: 'center' }}>
          สแกนด้วยกล้องของเครื่องก็ได้เหมือนกัน หน้านี้มีไว้สำหรับคนที่เปิดเว็บร้านค้างอยู่แล้ว
        </p>
      </div>
    </div>
  )
}
