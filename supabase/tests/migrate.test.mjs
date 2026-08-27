import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
import path from 'path'

const BASE = path.resolve(import.meta.dirname, '..')

const FILES = [
  'migrations/0001_extensions_enums.sql',
  'migrations/0002_core_config.sql',
  'migrations/0003_menu_packages.sql',
  'migrations/0004_floor_queue.sql',
  'migrations/0005_visits.sql',
  'migrations/0006_orders.sql',
  'migrations/0007_billing_payments.sql',
  'migrations/0008_functions_rpc.sql',
  'migrations/0009_rls_realtime.sql',
  'migrations/0010_token_fallback.sql',
  'migrations/0011_queue_tickets.sql',
  'migrations/0012_scope_staff_rls_by_branch.sql',
  'migrations/0013_align_remote_grants.sql',
  'migrations/0014_queue_dashboard_and_guest_adjust.sql',
  'seed.sql',
]

// สิ่งที่มีเฉพาะบน Supabase — PGlite ไม่มีให้ ต้อง stub เอง
const PRELUDE = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);
create or replace function auth.uid() returns uuid language sql stable as $fn$ select null::uuid $fn$;
create publication supabase_realtime;
`

// บรรทัดที่ PGlite รันไม่ได้เพราะไม่มี role / extension เหล่านี้
function sanitize(sql) {
  return sql
    .replace(/^create extension.*$/gmi, '-- [skip] extension')
    .replace(/^\s*(grant|revoke)\b[^;]*;/gmi, '-- [skip] grant/revoke')
    .replace(/^\s*alter default privileges[^;]*;/gmi, '-- [skip] default privileges')
    .replace(/\bto (anon, authenticated|authenticated, anon|anon|authenticated|service_role)\b/gi, '')
}

const db = new PGlite()
let failures = 0

await db.exec(PRELUDE)
console.log('prelude ok\n')

for (const f of FILES) {
  const raw = fs.readFileSync(path.join(BASE, f), 'utf8')
  try {
    await db.exec(sanitize(raw))
    console.log(`✅ ${f}`)
  } catch (e) {
    failures++
    console.log(`❌ ${f}`)
    console.log(`   ${e.message.split('\n')[0]}`)
    if (e.cause?.detail) console.log(`   detail: ${e.cause.detail}`)
    if (e.cause?.hint) console.log(`   hint:   ${e.cause.hint}`)
    // หาบรรทัดที่พัง
    const pos = e.cause?.position ? Number(e.cause.position) : null
    if (pos) {
      const upto = sanitize(raw).slice(0, pos)
      const line = upto.split('\n').length
      const src = raw.split('\n')
      console.log(`   ~บรรทัด ${line}: ${(src[line - 1] ?? '').trim().slice(0, 100)}`)
    }
  }
}

if (!failures) {
  console.log('\n── ตรวจผลลัพธ์ ──')
  const q = async (sql) => (await db.query(sql)).rows
  const [{ n: tables }] = await q(`select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`)
  const [{ n: funcs }]  = await q(`select count(*)::int n from information_schema.routines where routine_schema='public'`)
  const [{ n: pols }]   = await q(`select count(*)::int n from pg_policies where schemaname='public'`)
  const [{ n: menu }]   = await q(`select count(*)::int n from menu_items`)
  const [{ n: locked }] = await q(`select count(*)::int n from menu_item_packages`)
  const [{ n: tbl }]    = await q(`select count(*)::int n from tables`)
  const pkgs = await q(`select name, price_per_adult_satang, dining_minutes from buffet_packages order by sort_order`)
  const add  = await q(`select name, price_satang, charge_basis from add_ons`)

  console.log(`ตาราง ${tables} | function ${funcs} | policy ${pols}`)
  console.log(`เมนู ${menu} รายการ | ล็อกพรีเมียม ${locked} | โต๊ะ ${tbl}`)
  console.log('แพ็กเกจ:', pkgs.map(p => `${p.name} ${p.price_per_adult_satang / 100}฿/${p.dining_minutes}น.`).join('  '))
  console.log('add-on :', add.map(a => `${a.name} ${a.price_satang / 100}฿ (${a.charge_basis})`).join('  '))
}

process.exit(failures ? 1 : 0)
