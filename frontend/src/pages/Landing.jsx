import { Link } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { Photo, ConnectionBadge, ConnectionNote } from '../components/shared/Bits'

const SIDES = [
  {
    n: 1, to: '/order', icon: 'phone', title: 'ฝั่งลูกค้า', tag: 'มือถือ',
    img: '/img/cat-beef.jpg',
    desc: 'สแกน QR ที่โต๊ะ เลือกอาหาร ส่งออเดอร์เอง ติดตามสถานะรายจาน เรียกพนักงาน และดูยอดเงินได้ตลอดมื้อ',
    points: ['เมนูแยกหมวดพร้อมรูปจริง', 'นับถอยหลังเวลาบุฟเฟต์', 'ล็อกเมนูตามแพ็กเกจอัตโนมัติ'],
  },
  {
    n: 2, to: '/staff', icon: 'chefHat', title: 'ฝั่งพนักงาน & ครัว', tag: 'แท็บเล็ต',
    img: '/img/cat-pork.jpg',
    desc: 'ผังโต๊ะพร้อมเวลาที่เหลือ จัดคิวหน้าร้าน เปิดโต๊ะและออก QR จอครัวแยกสถานี และเช็คบิล',
    points: ['ผังโต๊ะพร้อมแถบเวลา', 'จอครัวแยกตามสถานี', 'เช็คบิล 4 ช่องทาง'],
  },
  {
    n: 3, to: '/admin', icon: 'chart', title: 'ฝั่งผู้จัดการ', tag: 'คอมพิวเตอร์',
    img: '/img/cat-seafood.jpg',
    desc: 'ยอดขาย เมนูขายดี ช่วงเวลาที่ลูกค้าเยอะ รายได้ต่อโต๊ะ พร้อมจัดการเมนู แพ็กเกจ โต๊ะ และการตั้งค่าร้าน',
    points: ['ยอดขายและเมนูขายดี', 'ช่วงเวลาที่ลูกค้าเยอะ', 'รายได้ต่อโต๊ะรายตัว'],
  },
]

const FACTS = [
  ['28', 'ตารางในฐานข้อมูล'],
  ['54', 'RLS Policy'],
  ['32', 'ฟังก์ชัน / RPC'],
  ['28', 'เคสทดสอบที่ผ่าน'],
]

export default function Landing() {
  return (
    <div className="entry">
      <div className="entry__hero">
        <Photo src="/img/hero-interior.jpg" alt="บรรยากาศภายในร้าน" />
        <div className="entry__heroInner">
          <div className="entry__mark">
            <Icon name="flame" size={16} strokeWidth={1.8} />
            SHABU MOOD
          </div>
          <h1 className="t-display" style={{ fontSize: 36, maxWidth: 660, marginTop: 16 }}>
            ระบบบริหารร้านชาบูบุฟเฟต์<br />พร้อมสั่งอาหารผ่าน QR
          </h1>
          <span className="entry__pill">ครบทั้งลูกค้า · พนักงาน · ครัว · ผู้จัดการ</span>
        </div>
      </div>

      <div className="entry__body">
        <div style={{ marginBottom: 18 }}><ConnectionNote /></div>

        <div className="entry__grid">
          {SIDES.map((s) => (
            <Link key={s.to} to={s.to} className="entry__card">
              <div className="entry__card__hd">
                <span className="numdot" style={{ background: 'rgba(255,255,255,.2)' }}>{s.n}</span>
                <span className="grow">{s.title}</span>
                <span className="chip chip--gold">{s.tag}</span>
              </div>

              <Photo src={s.img} alt="" style={{ width: '100%', height: 118, objectFit: 'cover' }} />

              <div className="entry__card__bd">
                <p className="t-sm muted">{s.desc}</p>
                <ul className="stack g8" style={{ marginTop: 2 }}>
                  {s.points.map((p) => (
                    <li key={p} className="row g8 t-sm">
                      <span style={{ color: 'var(--r600)' }}><Icon name="check" size={15} strokeWidth={2.2} /></span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
                <span className="row g4 t-sm bold" style={{ color: 'var(--r700)', marginTop: 'auto', paddingTop: 8 }}>
                  เข้าใช้งาน <Icon name="chevronRight" size={15} strokeWidth={2.2} />
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="panel" style={{ marginTop: 26 }}>
          <div className="panel__hd panel__hd--dark">
            <span className="row g8"><Icon name="check" size={17} strokeWidth={2} /> สถานะระบบ</span>
            <ConnectionBadge onDark />
          </div>
          <div className="panel__bd">
            <div className="between wrap g16">
              <p className="t-sm muted" style={{ maxWidth: 480 }}>
                ฐานข้อมูลผ่านการรันจริงบน Postgres และทดสอบกฎทางธุรกิจครบทุกข้อแล้ว
                หน้าจอที่เห็นตอนนี้ยังใช้ข้อมูลจำลอง เพราะยังไม่ได้ push schema ขึ้น Supabase
              </p>
              <div className="row g16 wrap">
                {FACTS.map(([n, l]) => (
                  <div key={l} style={{ textAlign: 'center' }}>
                    <div className="t-display num" style={{ fontSize: 26, color: 'var(--r700)' }}>{n}</div>
                    <div className="t-xs muted">{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="t-xs dim" style={{ marginTop: 20, lineHeight: 1.8 }}>
          หน้านี้มีไว้สำหรับสาธิตเท่านั้น — ของจริงลูกค้าเข้าผ่าน QR บนสลิปโดยตรง
          ส่วนพนักงานและผู้จัดการต้องล็อกอินก่อน
        </p>
      </div>
    </div>
  )
}
