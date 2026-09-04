import { useStore } from '../context/StoreProvider'
import { Loading, useTick } from '../components/shared/Bits'
import Login from './Login'
import { minutesSince } from '../utils/time'

/**
 * จอแสดงคิวหน้าร้าน — /display
 *
 * เปิดค้างบนทีวีหน้าร้าน ลูกค้าที่ยืนรออ่านจากระยะไกลได้ ไม่มีปุ่มให้กดผิด
 *
 * ทำไมต้องล็อกอินพนักงาน: queue_tickets มี policy ให้เฉพาะ staff อ่าน
 * จอนี้จึงใช้บัญชีพนักงานเปิดค้างไว้ ไม่ได้แก้ RLS เพื่อเปิดให้คนนอกอ่าน
 * (บัตรคิวของลูกค้าใช้ /q/:token ซึ่งอ่านผ่าน RPC ไม่ผ่านตารางตรง)
 *
 * ไม่มีโค้ด realtime ในไฟล์นี้ — StoreProvider subscribe ตาราง queue_tickets
 * กับ tables ไว้แล้วตั้งแต่ mode เป็น live ตัวเลขบนจอจึงขยับเองเมื่อพนักงานกดเรียกคิว
 */
export default function Display() {
  const store = useStore()
  useTick(30000)   // ให้ "รอ X นาที" เดินเอง แม้ไม่มี event เข้ามา

  if (store.mode === 'probing') return <Loading />
  if (store.mode === 'live') {
    if (store.profile === undefined) return <Loading label="กำลังตรวจสอบสิทธิ์…" />
    if (store.profile === null) return <Login kind="staff" />
  }

  const called = store.queueTickets.filter((q) => q.status === 'called')
  const waiting = store.queueTickets.filter((q) => q.status === 'waiting')
  const byStatus = store.tables.reduce((a, t) => ({ ...a, [t.status]: (a[t.status] ?? 0) + 1 }), {})

  return (
    <div style={S.screen}>
      <header style={S.head}>
        <h1 style={S.brand}>{store.settings?.display_name ?? 'Shabu Mood'}</h1>
        <p style={S.sub}>คิวหน้าร้าน</p>
      </header>

      <section style={S.now}>
        <p style={S.label}>กำลังเรียก</p>
        {called.length === 0 ? (
          <p style={S.idle}>ยังไม่มีคิวที่ถูกเรียก</p>
        ) : (
          <div style={S.calledRow}>
            {called.map((q) => (
              <div key={q.id} style={S.calledCard}>
                <span style={S.calledNum}>{q.ticket_number}</span>
                <span style={S.calledMeta}>{q.party_size} ท่าน</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={S.next}>
        <p style={S.label}>คิวถัดไป</p>
        {waiting.length === 0 ? (
          <p style={S.idle}>ไม่มีคิวรอ — เดินเข้าได้เลย</p>
        ) : (
          <div style={S.nextRow}>
            {waiting.slice(0, 6).map((q) => (
              <div key={q.id} style={S.nextCard}>
                <span style={S.nextNum}>{q.ticket_number}</span>
                <span style={S.nextMeta}>{q.party_size} ท่าน · รอ {minutesSince(q.created_at)} นาที</span>
              </div>
            ))}
            {waiting.length > 6 && <div style={S.more}>+{waiting.length - 6}</div>}
          </div>
        )}
      </section>

      <footer style={S.foot}>
        <span>รออยู่ <b style={S.footNum}>{waiting.length}</b> คิว</span>
        <span>โต๊ะว่าง <b style={S.footNum}>{byStatus.available ?? 0}</b></span>
        <span>รอเก็บโต๊ะ <b style={S.footNum}>{byStatus.cleaning ?? 0}</b></span>
        <span>ใช้งานอยู่ <b style={S.footNum}>{byStatus.occupied ?? 0}</b></span>
      </footer>
    </div>
  )
}

// สไตล์อยู่ในไฟล์นี้ที่เดียว — จอนี้ไม่ใช้ layout ร่วมกับหน้าอื่นเลย
// ขนาดตัวอักษรใช้ clamp() เพื่อให้อ่านได้ทั้งจอโน้ตบุ๊กตอนซ้อมและทีวีหน้าร้านจริง
const S = {
  // สูงเท่าจอพอดีและห้ามล้น — จอหน้าร้านไม่มีใครไปเลื่อนให้
  // เคยใช้ minHeight:100vh แล้วแถบล่างตกขอบบนจอเตี้ย (ทดสอบที่ 1280x600 แล้วขาดจริง)
  screen: {
    height: '100dvh', overflow: 'hidden', background: '#0b0b0d', color: '#fff',
    display: 'flex', flexDirection: 'column', gap: 'clamp(10px, 2vh, 40px)',
    padding: 'clamp(16px, 3vw, 56px)', fontVariantNumeric: 'tabular-nums',
  },
  head: { display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' },
  brand: { fontSize: 'clamp(22px, 3vw, 42px)', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' },
  sub: { margin: 0, fontSize: 'clamp(14px, 1.6vw, 22px)', color: '#8a8a93' },

  label: {
    margin: '0 0 clamp(8px, 1.4vh, 18px)', color: '#8a8a93',
    fontSize: 'clamp(13px, 1.5vw, 20px)', letterSpacing: '0.08em', textTransform: 'uppercase',
  },
  idle: { margin: 0, fontSize: 'clamp(20px, 2.6vw, 38px)', color: '#5c5c66' },

  // ยืดเต็มพื้นที่ที่เหลือแล้วจัดกลางแนวตั้ง — บนทีวีจริงส่วนนี้คือสิ่งที่คนอ่านจากท้ายแถว
  // minHeight:0 จำเป็นกับ flex child ที่ต้องหดได้ — ไม่ใส่แล้วมันดันแถวล่างตกขอบ
  now: {
    flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
  },
  calledRow: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 'clamp(12px, 2vw, 28px)' },
  calledCard: {
    background: '#e8442d', borderRadius: 18, padding: 'clamp(10px, 1.6vw, 32px) clamp(18px, 3vw, 48px)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '2.4em',
  },
  // ผูกกับความสูงจอด้วย (26vh) ไม่ใช่ความกว้างอย่างเดียว — จอเตี้ยแต่กว้างจะได้ไม่ล้น
  calledNum: { fontSize: 'clamp(56px, min(14vw, 26vh), 200px)', fontWeight: 800, lineHeight: 1 },
  calledMeta: { fontSize: 'clamp(14px, 1.6vw, 24px)', opacity: 0.85, marginTop: 6 },

  next: { flex: '0 0 auto' },
  nextRow: { display: 'flex', flexWrap: 'wrap', gap: 'clamp(10px, 1.4vw, 20px)', alignItems: 'stretch' },
  nextCard: {
    background: '#17171b', border: '1px solid #26262d', borderRadius: 14,
    padding: 'clamp(10px, 1.4vw, 20px) clamp(14px, 2vw, 28px)',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  nextNum: { fontSize: 'clamp(26px, min(4.5vw, 9vh), 68px)', fontWeight: 700, lineHeight: 1 },
  nextMeta: { fontSize: 'clamp(12px, 1.2vw, 18px)', color: '#8a8a93' },
  more: {
    alignSelf: 'center', color: '#8a8a93', fontSize: 'clamp(20px, 2.4vw, 34px)', fontWeight: 600,
  },

  foot: {
    display: 'flex', flexWrap: 'wrap', gap: 'clamp(14px, 3vw, 48px)',
    borderTop: '1px solid #26262d', paddingTop: 'clamp(12px, 2vh, 24px)',
    color: '#8a8a93', fontSize: 'clamp(14px, 1.6vw, 24px)',
  },
  footNum: { color: '#fff' },
}
