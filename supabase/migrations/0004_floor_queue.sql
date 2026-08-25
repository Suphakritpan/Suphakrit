-- ============================================================================
-- 0004 — โซน, โต๊ะ และคิวหน้าร้าน
-- ============================================================================

-- ── โซน ─────────────────────────────────────────────────────────────────────
create table zones (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  code        text not null,
  name        text not null,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (branch_id, code)
);
create trigger trg_zones_updated_at before update on zones
  for each row execute function set_updated_at();

-- ── โต๊ะ ────────────────────────────────────────────────────────────────────
create table tables (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  zone_id       uuid references zones(id) on delete set null,
  table_number  text not null,
  capacity      integer not null check (capacity between 1 and 50),

  -- ข้อ ④: วงจรโต๊ะ available → occupied → cleaning → available
  -- บังคับลำดับด้วย trigger enforce_table_status_transition() ใน 0008
  status        table_status not null default 'available',

  -- QR สติกเกอร์ติดโต๊ะ (ถาวร) — ใช้เป็นทางเข้าสำรองคู่กับรหัส 6 หลักบนสลิป
  qr_token      uuid not null default gen_random_uuid(),

  position_x    numeric(6,2),   -- ตำแหน่งบนผังโต๊ะ
  position_y    numeric(6,2),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (branch_id, table_number)
);
create unique index idx_tables_qr_token on tables(qr_token);
create index idx_tables_status on tables(branch_id, status) where is_active;
create trigger trg_tables_updated_at before update on tables
  for each row execute function set_updated_at();

-- ── คิวหน้าร้าน ─────────────────────────────────────────────────────────────
create table queue_tickets (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branches(id) on delete cascade,
  ticket_number   integer not null,          -- รันรายวันผ่าน next_counter()
  ticket_date     date not null default (now() at time zone 'Asia/Bangkok')::date,

  party_size      integer not null check (party_size between 1 and 50),
  customer_name   text,
  phone           text,
  status          queue_status not null default 'waiting',
  notes           text,

  visit_id        uuid,                      -- เติมตอนจัดโต๊ะ (FK ผูกใน 0005)
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  called_at       timestamptz,
  seated_at       timestamptz,
  updated_at      timestamptz not null default now(),

  unique (branch_id, ticket_date, ticket_number)
);
create index idx_queue_tickets_waiting on queue_tickets(branch_id, ticket_date, ticket_number)
  where status in ('waiting', 'called');
create trigger trg_queue_tickets_updated_at before update on queue_tickets
  for each row execute function set_updated_at();
