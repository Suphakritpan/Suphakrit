import { useSupabaseStatus } from '@/hooks/useSupabaseStatus'

// หน้าชั่วคราวสำหรับตรวจว่าเชื่อม Supabase ได้แล้วจริง
// จะถูกแทนที่ด้วย Router (customer / staff / admin) ในขั้นถัดไป
export default function App() {
  const { ok, status, detail } = useSupabaseStatus()

  const tone = status === 'checking' ? 'pending' : ok ? 'good' : 'bad'

  return (
    <main className="boot">
      <h1>Shabu Mood</h1>
      <p className="subtitle">Frontend scaffold — Supabase connection check</p>

      <div className={`status status--${tone}`}>
        <span className="dot" aria-hidden="true" />
        <div>
          <strong>{status}</strong>
          <p>{detail}</p>
        </div>
      </div>

      {!ok && status !== 'checking' && (
        <ol className="fix">
          <li>
            สร้างโปรเจกต์ที่ <code>supabase.com/dashboard</code>
          </li>
          <li>
            คัดลอก <code>Project URL</code> และ <code>anon public</code> จาก Project Settings →
            Data API
          </li>
          <li>
            วางลงใน <code>frontend/.env.local</code>
          </li>
          <li>
            รีสตาร์ท <code>npm run dev</code> (Vite อ่าน env ตอน start เท่านั้น)
          </li>
        </ol>
      )}
    </main>
  )
}
