/** นับแถวก่อน/หลังรัน concurrency test — ไฟล์ชั่วคราว ลบทิ้งหลังใช้ */
import pg from 'pg'

const c = new pg.Client({ connectionString: process.env.DATABASE_URL })
await c.connect()
const [row] = (await c.query(`
  select
    (select count(*) from visits)                             as visits,
    (select count(*) from queue_tickets)                      as queue_tickets,
    (select count(*) from orders)                             as orders,
    (select count(*) from payments)                           as payments,
    (select count(*) from tables where status <> 'available') as tables_busy,
    (select coalesce(max(current_value), 0) from daily_counters
      where counter_key = 'queue_ticket' and counter_date = current_date) as queue_no_today
`)).rows
console.log(process.argv[2] ?? '', JSON.stringify(row))
await c.end()
