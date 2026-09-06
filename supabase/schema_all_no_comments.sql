create extension if not exists pgcrypto;
create extension if not exists citext;

create type staff_role as enum ('owner', 'manager', 'staff', 'kitchen', 'cashier');

create type table_status as enum ('available', 'occupied', 'cleaning', 'reserved', 'disabled');

create type visit_status as enum ('open', 'awaiting_payment', 'paid', 'closed', 'void');

create type order_status as enum ('pending', 'preparing', 'ready', 'served', 'cancelled');

create type queue_status as enum ('waiting', 'called', 'seated', 'cancelled', 'no_show');

create type service_request_type as enum
  ('call_staff', 'request_bill', 'refill_water', 'clean_table', 'other');
create type service_request_status as enum ('open', 'acknowledged', 'done', 'cancelled');

create type payment_method as enum ('cash', 'transfer', 'card', 'qr_promptpay');
create type payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled', 'refunded');

create type payment_provider as enum ('mock_cash', 'mock_promptpay', 'mock_card');
create type payment_mode as enum ('mock', 'live');

create type bill_line_kind as enum
  ('buffet_adult', 'buffet_child', 'add_on', 'a_la_carte', 'discount', 'service_charge', 'vat');

create type addon_charge_basis as enum ('per_person', 'per_visit');

create type promotion_type as enum ('percent', 'fixed', 'free_addon');
create type promotion_scope as enum ('bill', 'buffet', 'a_la_carte');
create type loyalty_txn_type as enum ('earn', 'redeem', 'adjust', 'expire');
create type customer_tier as enum ('bronze', 'silver', 'gold');

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  address     text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_branches_updated_at before update on branches
  for each row execute function set_updated_at();

create table restaurant_settings (
  branch_id                     uuid primary key references branches(id) on delete cascade,

  display_name                  text not null,
  legal_name                    text,
  tax_id                        text,
  address                       text,
  phone                         text,
  logo_url                      text,
  receipt_footer                text,

  vat_enabled                   boolean not null default false,
  vat_rate_bp                   integer not null default 700  check (vat_rate_bp between 0 and 10000),
  vat_inclusive                 boolean not null default true,
  service_charge_enabled        boolean not null default false,
  service_charge_rate_bp        integer not null default 1000 check (service_charge_rate_bp between 0 and 10000),

  default_dining_minutes        integer not null default 90  check (default_dining_minutes between 15 and 480),
  last_order_minutes_before_end integer not null default 15  check (last_order_minutes_before_end >= 0),

  max_qty_per_item              integer not null default 10 check (max_qty_per_item between 1 and 999),
  max_items_per_order           integer not null default 30 check (max_items_per_order between 1 and 999),
  max_units_per_order           integer not null default 60 check (max_units_per_order between 1 and 9999),
  min_seconds_between_orders    integer not null default 30 check (min_seconds_between_orders >= 0),
  max_unserved_orders_per_visit integer not null default 5  check (max_unserved_orders_per_visit between 1 and 99),

  qr_max_failed_attempts        integer not null default 5  check (qr_max_failed_attempts between 1 and 99),
  qr_attempt_window_minutes     integer not null default 15 check (qr_attempt_window_minutes between 1 and 1440),
  qr_max_devices_per_visit      integer not null default 12 check (qr_max_devices_per_visit between 1 and 99),

  points_baht_per_point         integer not null default 100 check (points_baht_per_point > 0),
  points_enabled                boolean not null default true,

  payment_mode                  payment_mode not null default 'mock',
  promptpay_id                  text,

  timezone                      text not null default 'Asia/Bangkok',
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create trigger trg_restaurant_settings_updated_at before update on restaurant_settings
  for each row execute function set_updated_at();

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  branch_id   uuid not null references branches(id),
  full_name   text not null,
  role        staff_role not null default 'staff',
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_profiles_branch_active on profiles(branch_id) where is_active;
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

create table kitchen_stations (
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
create trigger trg_kitchen_stations_updated_at before update on kitchen_stations
  for each row execute function set_updated_at();

create table daily_counters (
  branch_id     uuid not null references branches(id) on delete cascade,
  counter_key   text not null,
  counter_date  date not null,
  current_value integer not null default 0 check (current_value >= 0),
  primary key (branch_id, counter_key, counter_date)
);

create table audit_logs (
  id          bigserial primary key,
  branch_id   uuid references branches(id) on delete set null,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_role  staff_role,
  action      text not null,
  entity      text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);
create index idx_audit_logs_entity  on audit_logs(entity, entity_id, created_at desc);
create index idx_audit_logs_created on audit_logs(branch_id, created_at desc);

create or replace function log_audit(
  p_action  text,
  p_entity  text,
  p_entity_id text,
  p_before  jsonb default null,
  p_after   jsonb default null,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid;
  v_role   staff_role;
begin
  select branch_id, role into v_branch, v_role from profiles where id = auth.uid();

  insert into audit_logs (branch_id, actor_id, actor_role, action, entity, entity_id, before, after, reason)
  values (v_branch, auth.uid(), v_role, p_action, p_entity, p_entity_id, p_before, p_after, p_reason);
end;
$$;

create table buffet_packages (
  id                      uuid primary key default gen_random_uuid(),
  branch_id               uuid not null references branches(id) on delete cascade,
  code                    text not null,
  name                    text not null,
  description             text,

  price_per_adult_satang  integer not null check (price_per_adult_satang >= 0),
  price_per_child_satang  integer not null default 0 check (price_per_child_satang >= 0),
  child_max_age           integer check (child_max_age between 0 and 25),

  dining_minutes          integer check (dining_minutes between 15 and 480),

  color                   text,
  sort_order              integer not null default 0,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (branch_id, code)
);
create index idx_buffet_packages_active on buffet_packages(branch_id, sort_order) where is_active;
create trigger trg_buffet_packages_updated_at before update on buffet_packages
  for each row execute function set_updated_at();

create table add_ons (
  id                      uuid primary key default gen_random_uuid(),
  branch_id               uuid not null references branches(id) on delete cascade,
  code                    text not null,
  name                    text not null,
  description             text,
  price_satang            integer not null check (price_satang >= 0),
  charge_basis            addon_charge_basis not null default 'per_person',
  sort_order              integer not null default 0,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (branch_id, code)
);
create trigger trg_add_ons_updated_at before update on add_ons
  for each row execute function set_updated_at();

create table menu_categories (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  code        text not null,
  name_th     text not null,
  name_en     text,
  icon        text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (branch_id, code)
);
create trigger trg_menu_categories_updated_at before update on menu_categories
  for each row execute function set_updated_at();

create table menu_items (
  id                      uuid primary key default gen_random_uuid(),
  branch_id               uuid not null references branches(id) on delete cascade,
  category_id             uuid not null references menu_categories(id) on delete restrict,
  station_id              uuid references kitchen_stations(id) on delete set null,

  name_th                 text not null,
  name_en                 text,
  description             text,
  image_url               text,

  is_included_in_buffet   boolean not null default true,
  a_la_carte_price_satang integer check (a_la_carte_price_satang >= 0),

  is_available            boolean not null default true,
  prep_minutes            integer not null default 5 check (prep_minutes >= 0),
  sort_order              integer not null default 0,
  tags                    text[] not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint chk_menu_item_pricing check (
    (is_included_in_buffet and a_la_carte_price_satang is null)
    or (not is_included_in_buffet and a_la_carte_price_satang is not null)
  )
);
create index idx_menu_items_category  on menu_items(branch_id, category_id, sort_order);
create index idx_menu_items_available on menu_items(branch_id) where is_available;
create index idx_menu_items_station   on menu_items(station_id);
create trigger trg_menu_items_updated_at before update on menu_items
  for each row execute function set_updated_at();

create table menu_item_packages (
  menu_item_id  uuid not null references menu_items(id) on delete cascade,
  package_id    uuid not null references buffet_packages(id) on delete cascade,
  primary key (menu_item_id, package_id)
);
create index idx_menu_item_packages_package on menu_item_packages(package_id);

comment on table menu_item_packages is
  'เมนูที่ไม่มีแถวในตารางนี้ = สั่งได้ทุกแพ็กเกจ; ถ้ามีแถว = สั่งได้เฉพาะแพ็กเกจที่ระบุ';

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

create table tables (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  zone_id       uuid references zones(id) on delete set null,
  table_number  text not null,
  capacity      integer not null check (capacity between 1 and 50),

  status        table_status not null default 'available',

  qr_token      uuid not null default gen_random_uuid(),

  position_x    numeric(6,2),
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

create table queue_tickets (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branches(id) on delete cascade,
  ticket_number   integer not null,
  ticket_date     date not null default (now() at time zone 'Asia/Bangkok')::date,

  party_size      integer not null check (party_size between 1 and 50),
  customer_name   text,
  phone           text,
  status          queue_status not null default 'waiting',
  notes           text,

  visit_id        uuid,
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

create table customers (
  id                  uuid primary key default gen_random_uuid(),
  branch_id           uuid not null references branches(id) on delete cascade,
  phone               text not null,
  first_name          text,
  last_name           text,
  birthdate           date,
  tier                customer_tier not null default 'bronze',

  points_balance      integer not null default 0 check (points_balance >= 0),
  total_visits        integer not null default 0 check (total_visits >= 0),
  total_spend_satang  bigint  not null default 0 check (total_spend_satang >= 0),

  marketing_consent   boolean not null default false,
  notes               text,
  first_visit_at      timestamptz,
  last_visit_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (branch_id, phone)
);
create trigger trg_customers_updated_at before update on customers
  for each row execute function set_updated_at();

create table visits (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  visit_code    text not null,
  table_id      uuid not null references tables(id) on delete restrict,
  customer_id   uuid references customers(id) on delete set null,

  package_id    uuid not null references buffet_packages(id) on delete restrict,

  package_name_snapshot           text    not null,
  package_price_adult_satang      integer not null check (package_price_adult_satang >= 0),
  package_price_child_satang      integer not null check (package_price_child_satang >= 0),

  adult_count   integer not null default 1 check (adult_count  >= 0),
  child_count   integer not null default 0 check (child_count  >= 0),

  status        visit_status not null default 'open',

  opened_by     uuid references profiles(id) on delete set null,
  closed_by     uuid references profiles(id) on delete set null,
  check_in_at   timestamptz not null default now(),
  dining_deadline_at timestamptz not null,
  billed_at     timestamptz,
  paid_at       timestamptz,
  check_out_at  timestamptz,

  session_token uuid default gen_random_uuid(),
  access_code   text,
  access_locked_until timestamptz,

  subtotal_satang       integer not null default 0 check (subtotal_satang       >= 0),
  discount_satang       integer not null default 0 check (discount_satang       >= 0),
  service_charge_satang integer not null default 0 check (service_charge_satang >= 0),
  vat_satang            integer not null default 0 check (vat_satang            >= 0),
  total_satang          integer not null default 0 check (total_satang          >= 0),

  notes         text,
  void_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint chk_visit_has_guests check (adult_count + child_count >= 1),
  unique (branch_id, visit_code)
);

create unique index idx_visits_one_active_per_table
  on visits(table_id) where status in ('open', 'awaiting_payment', 'paid');

create unique index idx_visits_session_token on visits(session_token) where session_token is not null;
create index idx_visits_active   on visits(branch_id, status) where status in ('open', 'awaiting_payment');
create index idx_visits_customer on visits(customer_id, check_in_at desc);
create index idx_visits_checkin  on visits(branch_id, check_in_at desc);
create trigger trg_visits_updated_at before update on visits
  for each row execute function set_updated_at();

alter table queue_tickets
  add constraint fk_queue_tickets_visit foreign key (visit_id) references visits(id) on delete set null;

create table visit_addons (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits(id) on delete cascade,
  add_on_id         uuid not null references add_ons(id) on delete restrict,

  name_snapshot     text not null,
  unit_price_satang integer not null check (unit_price_satang >= 0),
  charge_basis      addon_charge_basis not null,
  quantity          integer not null check (quantity > 0),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (visit_id, add_on_id)
);
create index idx_visit_addons_visit on visit_addons(visit_id);
create trigger trg_visit_addons_updated_at before update on visit_addons
  for each row execute function set_updated_at();

create table visit_devices (
  id            uuid primary key default gen_random_uuid(),
  visit_id      uuid not null references visits(id) on delete cascade,
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  nickname      text,
  user_agent    text,
  revoked_at    timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (visit_id, auth_user_id)
);
create index idx_visit_devices_user on visit_devices(auth_user_id) where revoked_at is null;
create index idx_visit_devices_visit on visit_devices(visit_id);

create table visit_access_attempts (
  id           bigserial primary key,
  visit_id     uuid references visits(id) on delete cascade,
  table_id     uuid references tables(id) on delete cascade,
  auth_user_id uuid,
  succeeded    boolean not null,
  attempted_at timestamptz not null default now()
);
create index idx_visit_access_attempts_recent
  on visit_access_attempts(visit_id, attempted_at desc) where not succeeded;
create index idx_visit_access_attempts_table
  on visit_access_attempts(table_id, attempted_at desc) where not succeeded;

create table orders (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits(id) on delete cascade,
  order_number      integer not null,

  placed_by_device_id uuid references visit_devices(id) on delete set null,
  placed_by_staff_id  uuid references profiles(id) on delete set null,

  status            order_status not null default 'pending',
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (visit_id, order_number)
);
create index idx_orders_visit  on orders(visit_id, order_number);
create index idx_orders_active on orders(status, created_at) where status <> 'served' and status <> 'cancelled';
create trigger trg_orders_updated_at before update on orders
  for each row execute function set_updated_at();

create table order_items (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references orders(id) on delete cascade,
  menu_item_id      uuid not null references menu_items(id) on delete restrict,

  name_snapshot     text not null,
  station_id        uuid references kitchen_stations(id) on delete set null,

  quantity          integer not null check (quantity between 1 and 999),

  is_buffet_included boolean not null default true,
  unit_price_satang  integer not null default 0 check (unit_price_satang >= 0),
  line_total_satang  integer not null default 0 check (line_total_satang >= 0),

  status            order_status not null default 'pending',
  note              text,
  cancelled_reason  text,

  started_at        timestamptz,
  ready_at          timestamptz,
  served_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint chk_order_item_buffet_price check (
    (is_buffet_included and unit_price_satang = 0 and line_total_satang = 0)
    or (not is_buffet_included and line_total_satang = unit_price_satang * quantity)
  )
);
create index idx_order_items_order   on order_items(order_id);
create index idx_order_items_station on order_items(station_id, status, created_at)
  where status in ('pending', 'preparing');
create index idx_order_items_menu    on order_items(menu_item_id);
create trigger trg_order_items_updated_at before update on order_items
  for each row execute function set_updated_at();

create table order_status_history (
  id            bigserial primary key,
  order_item_id uuid not null references order_items(id) on delete cascade,
  from_status   order_status,
  to_status     order_status not null,
  changed_by    uuid references profiles(id) on delete set null,
  changed_at    timestamptz not null default now()
);
create index idx_order_status_history_item on order_status_history(order_item_id, changed_at);

create table service_requests (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null references visits(id) on delete cascade,
  table_id        uuid not null references tables(id) on delete cascade,
  type            service_request_type not null default 'call_staff',
  message         text,
  status          service_request_status not null default 'open',

  created_by_device_id uuid references visit_devices(id) on delete set null,
  acknowledged_by uuid references profiles(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_service_requests_open on service_requests(table_id, created_at)
  where status in ('open', 'acknowledged');
create index idx_service_requests_visit on service_requests(visit_id, created_at desc);
create trigger trg_service_requests_updated_at before update on service_requests
  for each row execute function set_updated_at();

create unique index idx_service_requests_one_open_per_type
  on service_requests(visit_id, type) where status = 'open';

create table promotions (
  id                uuid primary key default gen_random_uuid(),
  branch_id         uuid not null references branches(id) on delete cascade,
  code              text not null,
  name              text not null,
  description       text,

  type              promotion_type not null,
  scope             promotion_scope not null default 'bill',
  value_bp          integer check (value_bp between 0 and 10000),
  value_satang      integer check (value_satang >= 0),
  free_add_on_id    uuid references add_ons(id) on delete set null,

  min_spend_satang  integer not null default 0 check (min_spend_satang >= 0),
  starts_at         timestamptz,
  ends_at           timestamptz,
  days_of_week      smallint[] not null default '{}',
  time_start        time,
  time_end          time,
  max_uses          integer check (max_uses > 0),
  uses_count        integer not null default 0 check (uses_count >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (branch_id, code),
  constraint chk_promotion_value check (
    (type = 'percent'     and value_bp     is not null)
    or (type = 'fixed'    and value_satang is not null)
    or (type = 'free_addon' and free_add_on_id is not null)
  ),
  constraint chk_promotion_window check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create trigger trg_promotions_updated_at before update on promotions
  for each row execute function set_updated_at();

create table visit_promotions (
  visit_id        uuid not null references visits(id) on delete cascade,
  promotion_id    uuid not null references promotions(id) on delete restrict,
  name_snapshot   text not null,
  discount_satang integer not null check (discount_satang >= 0),
  applied_by      uuid references profiles(id) on delete set null,
  applied_at      timestamptz not null default now(),
  primary key (visit_id, promotion_id)
);

create table bill_lines (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits(id) on delete cascade,
  kind              bill_line_kind not null,
  description       text not null,
  quantity          numeric(10,2) not null default 1,
  unit_price_satang integer not null default 0,
  amount_satang     integer not null,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now()
);
create index idx_bill_lines_visit on bill_lines(visit_id, sort_order);

create table payments (
  id                uuid primary key default gen_random_uuid(),
  visit_id          uuid not null references visits(id) on delete cascade,
  method            payment_method not null,
  provider          payment_provider not null,

  amount_satang     integer not null check (amount_satang > 0),
  tendered_satang   integer check (tendered_satang >= 0),
  change_satang     integer not null default 0 check (change_satang >= 0),

  status            payment_status not null default 'pending',

  receipt_number    integer,
  receipt_date      date,
  provider_ref      text,
  provider_payload  jsonb,
  failure_reason    text,

  processed_by      uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  updated_at        timestamptz not null default now(),

  constraint chk_payment_cash_tender check (
    method = 'cash'
    or tendered_satang is null
    or tendered_satang = amount_satang
  ),
  constraint chk_payment_change check (
    change_satang = 0
    or (tendered_satang is not null and change_satang = tendered_satang - amount_satang)
  )
);
create index idx_payments_visit on payments(visit_id, created_at);
create index idx_payments_status on payments(status, created_at desc);
create unique index idx_payments_provider_ref on payments(provider, provider_ref)
  where provider_ref is not null;
create trigger trg_payments_updated_at before update on payments
  for each row execute function set_updated_at();

create or replace function enforce_payment_not_exceeding_total()
returns trigger
language plpgsql
as $$
declare
  v_total     integer;
  v_status    visit_status;
  v_paid      integer;
begin

  if new.status <> 'succeeded' then
    return new;
  end if;

  select total_satang, status into v_total, v_status
  from visits where id = new.visit_id
  for update;

  if v_status in ('closed', 'void') then
    raise exception 'ชำระเงินไม่ได้: visit นี้ปิดหรือถูกยกเลิกไปแล้ว (status=%)', v_status
      using errcode = 'check_violation';
  end if;

  if v_total <= 0 then
    raise exception 'ชำระเงินไม่ได้: ยังไม่ได้คำนวณยอดบิล ต้องกดเช็คบิลก่อน'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount_satang), 0) into v_paid
  from payments
  where visit_id = new.visit_id
    and status = 'succeeded'
    and id <> new.id;

  if v_paid + new.amount_satang > v_total then
    raise exception
      'ชำระเกินยอดบิล: จ่ายแล้ว % สตางค์ + ครั้งนี้ % สตางค์ เกินยอด % สตางค์ (คงเหลือ %)',
      v_paid, new.amount_satang, v_total, v_total - v_paid
      using errcode = 'check_violation';
  end if;

  if new.completed_at is null then
    new.completed_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_payments_no_overpay
  before insert or update on payments
  for each row execute function enforce_payment_not_exceeding_total();

create table loyalty_transactions (
  id             bigserial primary key,
  customer_id    uuid not null references customers(id) on delete cascade,
  visit_id       uuid references visits(id) on delete set null,
  type           loyalty_txn_type not null,
  points         integer not null,
  balance_after  integer not null check (balance_after >= 0),
  note           text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint chk_loyalty_sign check (
    (type in ('earn') and points > 0)
    or (type in ('redeem', 'expire') and points < 0)
    or (type = 'adjust' and points <> 0)
  )
);
create index idx_loyalty_customer on loyalty_transactions(customer_id, created_at desc);
create index idx_loyalty_visit    on loyalty_transactions(visit_id);

create or replace function apply_loyalty_transaction()
returns trigger
language plpgsql
as $$
declare
  v_balance integer;
begin
  select points_balance into v_balance
  from customers where id = new.customer_id
  for update;

  if v_balance + new.points < 0 then
    raise exception 'แต้มไม่พอ: คงเหลือ % แต้ม ต้องการใช้ % แต้ม', v_balance, abs(new.points)
      using errcode = 'check_violation';
  end if;

  new.balance_after := v_balance + new.points;

  update customers
     set points_balance = new.balance_after
   where id = new.customer_id;

  return new;
end;
$$;

create trigger trg_loyalty_apply
  before insert on loyalty_transactions
  for each row execute function apply_loyalty_transaction();

create or replace function is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and is_active);
$$;

create or replace function is_manager()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_active and role in ('owner', 'manager')
  );
$$;

create or replace function current_staff_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from profiles where id = auth.uid() and is_active;
$$;

create or replace function current_visit_id()
returns uuid language sql stable security definer set search_path = public as $$
  select d.visit_id
  from visit_devices d
  join visits v on v.id = d.visit_id
  where d.auth_user_id = auth.uid()
    and d.revoked_at is null
    and v.status in ('open', 'awaiting_payment', 'paid')
  order by d.last_seen_at desc
  limit 1;
$$;

create or replace function next_counter(p_branch_id uuid, p_key text, p_date date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_date  date;
  v_value integer;
begin
  v_date := coalesce(p_date, (now() at time zone 'Asia/Bangkok')::date);

  insert into daily_counters (branch_id, counter_key, counter_date, current_value)
  values (p_branch_id, p_key, v_date, 1)
  on conflict (branch_id, counter_key, counter_date)
  do update set current_value = daily_counters.current_value + 1
  returning current_value into v_value;

  return v_value;
end;
$$;

create or replace function enforce_table_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'available' and new.status in ('occupied', 'reserved', 'cleaning', 'disabled'))
    or (old.status = 'occupied'  and new.status in ('cleaning', 'available'))
    or (old.status = 'cleaning'  and new.status in ('available', 'disabled'))
    or (old.status = 'reserved'  and new.status in ('occupied', 'available', 'disabled'))
    or (old.status = 'disabled'  and new.status in ('available'))
  ) then
    raise exception 'เปลี่ยนสถานะโต๊ะจาก % ไป % ไม่ได้', old.status, new.status
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_tables_status_transition
  before update of status on tables
  for each row execute function enforce_table_status_transition();

create or replace function enforce_visit_status_transition()
returns trigger language plpgsql as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
       (old.status = 'open'             and new.status in ('awaiting_payment', 'void'))
    or (old.status = 'awaiting_payment' and new.status in ('open', 'paid', 'void'))
    or (old.status = 'paid'             and new.status in ('closed', 'void'))
  ) then
    raise exception 'เปลี่ยนสถานะ visit จาก % ไป % ไม่ได้', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'void' and coalesce(new.void_reason, '') = '' then
    raise exception 'ยกเลิกบิลต้องระบุเหตุผล (void_reason)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_visits_status_transition
  before update of status on visits
  for each row execute function enforce_visit_status_transition();

create or replace function rollup_order_status()
returns trigger language plpgsql as $$
declare
  v_order_id uuid;
  v_new      order_status;
begin
  v_order_id := coalesce(new.order_id, old.order_id);

  select case
           when count(*) filter (where status <> 'cancelled') = 0 then 'cancelled'
           when count(*) filter (where status = 'pending')    > 0 then 'pending'
           when count(*) filter (where status = 'preparing')  > 0 then 'preparing'
           when count(*) filter (where status = 'ready')      > 0 then 'ready'
           else 'served'
         end::order_status
    into v_new
  from order_items where order_id = v_order_id;

  update orders set status = v_new where id = v_order_id and status <> v_new;
  return null;
end;
$$;

create trigger trg_order_items_rollup
  after insert or update of status or delete on order_items
  for each row execute function rollup_order_status();

create or replace function record_order_item_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.status = old.status then
    return new;
  end if;

  insert into order_status_history (order_item_id, from_status, to_status, changed_by)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    (select p.id from profiles p where p.id = auth.uid())
  );

  return new;
end;
$$;

create trigger trg_order_items_history
  after insert or update of status on order_items
  for each row execute function record_order_item_history();

create or replace function open_visit(
  p_table_id         uuid,
  p_package_id       uuid,
  p_adult_count      integer,
  p_child_count      integer default 0,
  p_addons           jsonb   default '[]'::jsonb,
  p_queue_ticket_id  uuid    default null,
  p_customer_phone   text    default null
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_branch    uuid;
  v_table     public.tables;
  v_package   buffet_packages;
  v_settings  restaurant_settings;
  v_visit     visits;
  v_minutes   integer;
  v_seq       integer;
  v_code      text;
  v_customer  uuid;
  v_addon     jsonb;
  v_addon_row add_ons;
  v_qty       integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่เปิดโต๊ะได้' using errcode = '42501';
  end if;

  v_branch := current_staff_branch();

  select * into v_table from tables where id = p_table_id for update;
  if not found then
    raise exception 'ไม่พบโต๊ะที่ระบุ' using errcode = 'no_data_found';
  end if;
  if v_table.branch_id <> v_branch then
    raise exception 'โต๊ะนี้ไม่ได้อยู่ในสาขาของคุณ' using errcode = '42501';
  end if;
  if v_table.status <> 'available' then
    raise exception 'โต๊ะ % ยังไม่ว่าง (สถานะ %)', v_table.table_number, v_table.status
      using errcode = 'check_violation';
  end if;

  select * into v_package from buffet_packages
   where id = p_package_id and branch_id = v_branch and is_active;
  if not found then
    raise exception 'ไม่พบแพ็กเกจบุฟเฟต์ที่เลือก หรือแพ็กเกจถูกปิดใช้งานแล้ว'
      using errcode = 'no_data_found';
  end if;

  if coalesce(p_adult_count, 0) + coalesce(p_child_count, 0) < 1 then
    raise exception 'ต้องมีลูกค้าอย่างน้อย 1 คน' using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_branch;

  v_minutes := coalesce(v_package.dining_minutes, v_settings.default_dining_minutes);

  if p_customer_phone is not null and length(trim(p_customer_phone)) > 0 then
    insert into customers (branch_id, phone, first_visit_at, last_visit_at)
    values (v_branch, trim(p_customer_phone), now(), now())
    on conflict (branch_id, phone)
      do update set last_visit_at = now()
    returning id into v_customer;
  end if;

  v_seq  := next_counter(v_branch, 'visit_code');
  v_code := v_table.table_number || '-'
         || to_char(now() at time zone v_settings.timezone, 'MMDD') || '-'
         || lpad(v_seq::text, 3, '0');

  insert into visits (
    branch_id, visit_code, table_id, customer_id, package_id,
    package_name_snapshot, package_price_adult_satang, package_price_child_satang,
    adult_count, child_count, opened_by, dining_deadline_at, access_code
  ) values (
    v_branch, v_code, p_table_id, v_customer, p_package_id,
    v_package.name, v_package.price_per_adult_satang, v_package.price_per_child_satang,
    coalesce(p_adult_count, 0), coalesce(p_child_count, 0), auth.uid(),
    now() + make_interval(mins => v_minutes),
    lpad((floor(random() * 1000000))::int::text, 6, '0')
  ) returning * into v_visit;

  for v_addon in select * from jsonb_array_elements(coalesce(p_addons, '[]'::jsonb))
  loop
    select * into v_addon_row from add_ons
     where id = (v_addon->>'add_on_id')::uuid and branch_id = v_branch and is_active;
    if not found then
      raise exception 'ไม่พบ add-on ที่เลือก หรือถูกปิดใช้งานแล้ว' using errcode = 'no_data_found';
    end if;

    v_qty := coalesce((v_addon->>'quantity')::integer,
                      case when v_addon_row.charge_basis = 'per_person'
                           then v_visit.adult_count + v_visit.child_count else 1 end);

    if v_qty <= 0 then
      continue;
    end if;
    if v_addon_row.charge_basis = 'per_person'
       and v_qty > v_visit.adult_count + v_visit.child_count then
      raise exception 'จำนวน add-on "%" (%) มากกว่าจำนวนคนในโต๊ะ (%)',
        v_addon_row.name, v_qty, v_visit.adult_count + v_visit.child_count
        using errcode = 'check_violation';
    end if;

    insert into visit_addons (visit_id, add_on_id, name_snapshot, unit_price_satang, charge_basis, quantity)
    values (v_visit.id, v_addon_row.id, v_addon_row.name, v_addon_row.price_satang,
            v_addon_row.charge_basis, v_qty);
  end loop;

  update tables set status = 'occupied' where id = p_table_id;

  if p_queue_ticket_id is not null then
    update queue_tickets
       set status = 'seated', seated_at = now(), visit_id = v_visit.id
     where id = p_queue_ticket_id and status in ('waiting', 'called');
  end if;

  perform log_audit('visit.open', 'visits', v_visit.id::text, null, to_jsonb(v_visit));

  return v_visit;
end;
$$;

create or replace function join_visit(
  p_session_token   uuid default null,
  p_table_qr_token  uuid default null,
  p_access_code     text default null,
  p_nickname        text default null,
  p_user_agent      text default null
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit     visits;
  v_table     public.tables;
  v_settings  restaurant_settings;
  v_fails     integer;
  v_devices   integer;
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบแบบไม่ระบุตัวตนก่อนสแกน QR' using errcode = '42501';
  end if;

  if p_session_token is not null then
    select * into v_visit from visits where session_token = p_session_token;

  elsif p_table_qr_token is not null then
    select * into v_table from tables where qr_token = p_table_qr_token;
    if not found then
      raise exception 'QR ไม่ถูกต้อง' using errcode = 'no_data_found';
    end if;

    select * into v_visit from visits
     where table_id = v_table.id and status in ('open', 'awaiting_payment')
     order by check_in_at desc limit 1;

    if not found then
      insert into visit_access_attempts (table_id, auth_user_id, succeeded)
      values (v_table.id, auth.uid(), false);
      raise exception 'โต๊ะนี้ยังไม่ได้เปิดใช้บริการ กรุณาติดต่อพนักงาน'
        using errcode = 'no_data_found';
    end if;

    select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

    if v_visit.access_locked_until is not null and v_visit.access_locked_until > now() then
      raise exception 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน'
        using errcode = '42501';
    end if;

    select count(*) into v_fails
    from visit_access_attempts
    where visit_id = v_visit.id
      and not succeeded
      and attempted_at > now() - make_interval(mins => v_settings.qr_attempt_window_minutes);

    if v_fails >= v_settings.qr_max_failed_attempts then
      update visits
         set access_locked_until = now() + make_interval(mins => v_settings.qr_attempt_window_minutes)
       where id = v_visit.id;
      raise exception 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน' using errcode = '42501';
    end if;

    if p_access_code is null or v_visit.access_code is distinct from trim(p_access_code) then
      insert into visit_access_attempts (visit_id, table_id, auth_user_id, succeeded)
      values (v_visit.id, v_table.id, auth.uid(), false);
      raise exception 'รหัสเข้าโต๊ะไม่ถูกต้อง' using errcode = '42501';
    end if;
  else
    raise exception 'ต้องระบุ session_token หรือ table_qr_token' using errcode = 'invalid_parameter_value';
  end if;

  if v_visit.id is null then
    raise exception 'QR นี้ใช้ไม่ได้แล้ว' using errcode = 'no_data_found';
  end if;

  if v_visit.status <> 'open' then
    raise exception 'รอบการใช้บริการนี้ปิดแล้ว ไม่สามารถสั่งอาหารได้'
      using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  select count(*) into v_devices
  from visit_devices where visit_id = v_visit.id and revoked_at is null;

  if v_devices >= v_settings.qr_max_devices_per_visit
     and not exists (select 1 from visit_devices
                      where visit_id = v_visit.id and auth_user_id = auth.uid()) then
    raise exception 'โต๊ะนี้มีอุปกรณ์เชื่อมต่อครบจำนวนแล้ว กรุณาติดต่อพนักงาน'
      using errcode = 'check_violation';
  end if;

  insert into visit_devices (visit_id, auth_user_id, nickname, user_agent)
  values (v_visit.id, auth.uid(), p_nickname, p_user_agent)
  on conflict (visit_id, auth_user_id)
    do update set last_seen_at = now(), revoked_at = null,
                  nickname = coalesce(excluded.nickname, visit_devices.nickname);

  insert into visit_access_attempts (visit_id, table_id, auth_user_id, succeeded)
  values (v_visit.id, v_visit.table_id, auth.uid(), true);

  return v_visit;
end;
$$;

create or replace function place_order(
  p_visit_id uuid,
  p_items    jsonb,
  p_note     text default null
)
returns orders
language plpgsql security definer set search_path = public as $$
declare
  v_visit      visits;
  v_settings   restaurant_settings;
  v_order      orders;
  v_device     uuid;
  v_is_staff   boolean;
  v_item       jsonb;
  v_menu       menu_items;
  v_qty        integer;
  v_units      integer := 0;
  v_lines      integer := 0;
  v_seq        integer;
  v_last       timestamptz;
  v_unserved   integer;
  v_deadline   timestamptz;
begin
  v_is_staff := is_staff();

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if not v_is_staff then
    select id into v_device from visit_devices
     where visit_id = p_visit_id and auth_user_id = auth.uid() and revoked_at is null;
    if v_device is null then
      raise exception 'ไม่มีสิทธิ์สั่งอาหารเข้าโต๊ะนี้' using errcode = '42501';
    end if;
  end if;

  if v_visit.status <> 'open' then
    raise exception 'สั่งอาหารไม่ได้: รอบการใช้บริการอยู่ในสถานะ %', v_visit.status
      using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  v_deadline := v_visit.dining_deadline_at
                - make_interval(mins => v_settings.last_order_minutes_before_end);
  if now() > v_deadline and not v_is_staff then
    raise exception 'หมดเวลาสั่งอาหารแล้ว (สั่งได้ถึง %) กรุณาติดต่อพนักงาน',
      to_char(v_deadline at time zone v_settings.timezone, 'HH24:MI')
      using errcode = 'check_violation';
  end if;

  if not v_is_staff and v_settings.min_seconds_between_orders > 0 then
    select max(created_at) into v_last from orders where visit_id = p_visit_id;
    if v_last is not null
       and now() < v_last + make_interval(secs => v_settings.min_seconds_between_orders) then
      raise exception 'สั่งถี่เกินไป กรุณารอ % วินาทีแล้วลองใหม่',
        ceil(extract(epoch from (v_last + make_interval(secs => v_settings.min_seconds_between_orders)) - now()))
        using errcode = 'check_violation';
    end if;
  end if;

  if not v_is_staff then
    select count(*) into v_unserved from orders
     where visit_id = p_visit_id and status in ('pending', 'preparing', 'ready');
    if v_unserved >= v_settings.max_unserved_orders_per_visit then
      raise exception 'มีออเดอร์ที่ยังไม่ได้เสิร์ฟครบ % รอบแล้ว กรุณารออาหารชุดก่อนหน้า',
        v_settings.max_unserved_orders_per_visit
        using errcode = 'check_violation';
    end if;
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'ยังไม่ได้เลือกรายการอาหาร' using errcode = 'invalid_parameter_value';
  end if;

  v_seq := coalesce((select max(order_number) from orders where visit_id = p_visit_id), 0) + 1;

  insert into orders (visit_id, order_number, placed_by_device_id, placed_by_staff_id, note)
  values (p_visit_id, v_seq, v_device, case when v_is_staff then auth.uid() end, p_note)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty   := coalesce((v_item->>'quantity')::integer, 0);
    v_lines := v_lines + 1;
    v_units := v_units + v_qty;

    if v_qty <= 0 then
      raise exception 'จำนวนต้องมากกว่า 0' using errcode = 'check_violation';
    end if;

    if v_qty > v_settings.max_qty_per_item then
      raise exception 'สั่งได้สูงสุด % ที่ต่อเมนูต่อรอบ', v_settings.max_qty_per_item
        using errcode = 'check_violation';
    end if;

    select * into v_menu from menu_items
     where id = (v_item->>'menu_item_id')::uuid and branch_id = v_visit.branch_id;
    if not found then
      raise exception 'ไม่พบเมนูที่เลือก' using errcode = 'no_data_found';
    end if;
    if not v_menu.is_available then
      raise exception 'เมนู "%" หมดแล้ว', v_menu.name_th using errcode = 'check_violation';
    end if;

    if exists (select 1 from menu_item_packages where menu_item_id = v_menu.id)
       and not exists (
         select 1 from menu_item_packages
         where menu_item_id = v_menu.id and package_id = v_visit.package_id
       ) then
      raise exception 'เมนู "%" สั่งได้เฉพาะแพ็กเกจอื่น ไม่รวมอยู่ในแพ็กเกจ "%"',
        v_menu.name_th, v_visit.package_name_snapshot
        using errcode = 'check_violation';
    end if;

    insert into order_items (
      order_id, menu_item_id, name_snapshot, station_id, quantity,
      is_buffet_included, unit_price_satang, line_total_satang, note
    ) values (
      v_order.id, v_menu.id, v_menu.name_th, v_menu.station_id, v_qty,
      v_menu.is_included_in_buffet,
      case when v_menu.is_included_in_buffet then 0 else v_menu.a_la_carte_price_satang end,
      case when v_menu.is_included_in_buffet then 0 else v_menu.a_la_carte_price_satang * v_qty end,
      nullif(trim(coalesce(v_item->>'note', '')), '')
    );
  end loop;

  if v_lines > v_settings.max_items_per_order then
    raise exception 'หนึ่งรอบสั่งได้ไม่เกิน % รายการ', v_settings.max_items_per_order
      using errcode = 'check_violation';
  end if;
  if v_units > v_settings.max_units_per_order then
    raise exception 'หนึ่งรอบสั่งได้ไม่เกิน % ที่รวมทุกเมนู', v_settings.max_units_per_order
      using errcode = 'check_violation';
  end if;

  return v_order;
end;
$$;

create or replace function advance_order_item(p_item_id uuid, p_next order_status)
returns order_items
language plpgsql security definer set search_path = public as $$
declare
  v_item order_items;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_item from order_items where id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบรายการอาหาร' using errcode = 'no_data_found';
  end if;

  if not (
       (v_item.status = 'pending'   and p_next in ('preparing', 'cancelled'))
    or (v_item.status = 'preparing' and p_next in ('ready', 'cancelled'))
    or (v_item.status = 'ready'     and p_next in ('served', 'preparing'))
    or (v_item.status = 'served'    and p_next in ('ready'))
  ) then
    raise exception 'เปลี่ยนสถานะจาก % ไป % ไม่ได้', v_item.status, p_next
      using errcode = 'check_violation';
  end if;

  update order_items
     set status     = p_next,
         started_at = case when p_next = 'preparing' then coalesce(started_at, now()) else started_at end,
         ready_at   = case when p_next = 'ready'     then now() else ready_at end,
         served_at  = case when p_next = 'served'    then now() else served_at end
   where id = p_item_id
  returning * into v_item;

  return v_item;
end;
$$;

create or replace function recalculate_visit_totals(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit     visits;
  v_settings  restaurant_settings;
  v_buffet    integer := 0;
  v_addons    integer := 0;
  v_alacarte  integer := 0;
  v_subtotal  integer := 0;
  v_discount  integer := 0;
  v_base      integer := 0;
  v_service   integer := 0;
  v_vat       integer := 0;
  v_total     integer := 0;
  v_sort      integer := 0;
  r           record;
begin
  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  delete from bill_lines where visit_id = p_visit_id;

  v_buffet := v_visit.adult_count * v_visit.package_price_adult_satang
            + v_visit.child_count * v_visit.package_price_child_satang;

  if v_visit.adult_count > 0 then
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'buffet_adult',
            v_visit.package_name_snapshot || ' (ผู้ใหญ่)',
            v_visit.adult_count, v_visit.package_price_adult_satang,
            v_visit.adult_count * v_visit.package_price_adult_satang, v_sort);
  end if;

  if v_visit.child_count > 0 then
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'buffet_child',
            v_visit.package_name_snapshot || ' (เด็ก)',
            v_visit.child_count, v_visit.package_price_child_satang,
            v_visit.child_count * v_visit.package_price_child_satang, v_sort);
  end if;

  for r in select * from visit_addons where visit_id = p_visit_id order by created_at
  loop
    v_addons := v_addons + r.unit_price_satang * r.quantity;
    v_sort   := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'add_on', r.name_snapshot, r.quantity, r.unit_price_satang,
            r.unit_price_satang * r.quantity, v_sort);
  end loop;

  for r in
    select oi.name_snapshot, sum(oi.quantity) as qty, max(oi.unit_price_satang) as price,
           sum(oi.line_total_satang) as total
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.visit_id = p_visit_id
      and not oi.is_buffet_included
      and oi.status <> 'cancelled'
    group by oi.name_snapshot
  loop
    v_alacarte := v_alacarte + r.total;
    v_sort     := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'a_la_carte', r.name_snapshot, r.qty, r.price, r.total, v_sort);
  end loop;

  v_subtotal := v_buffet + v_addons + v_alacarte;

  select coalesce(sum(discount_satang), 0) into v_discount
  from visit_promotions where visit_id = p_visit_id;
  v_discount := least(v_discount, v_subtotal);

  for r in select * from visit_promotions where visit_id = p_visit_id
  loop
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'discount', r.name_snapshot, 1, -r.discount_satang, -r.discount_satang, v_sort);
  end loop;

  v_base := v_subtotal - v_discount;

  if v_settings.service_charge_enabled and v_settings.service_charge_rate_bp > 0 then
    v_service := round(v_base::numeric * v_settings.service_charge_rate_bp / 10000)::integer;
    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'service_charge',
            'Service Charge ' || (v_settings.service_charge_rate_bp / 100.0) || '%',
            1, v_service, v_service, v_sort);
  end if;

  if v_settings.vat_enabled and v_settings.vat_rate_bp > 0 then
    if v_settings.vat_inclusive then
      v_total := v_base + v_service;
      v_vat   := round((v_total::numeric * v_settings.vat_rate_bp)
                       / (10000 + v_settings.vat_rate_bp))::integer;
    else
      v_vat   := round((v_base + v_service)::numeric * v_settings.vat_rate_bp / 10000)::integer;
      v_total := v_base + v_service + v_vat;
    end if;

    v_sort := v_sort + 1;
    insert into bill_lines (visit_id, kind, description, quantity, unit_price_satang, amount_satang, sort_order)
    values (p_visit_id, 'vat',
            'VAT ' || (v_settings.vat_rate_bp / 100.0) || '%'
              || case when v_settings.vat_inclusive then ' (รวมในราคาแล้ว)' else '' end,
            1, v_vat, case when v_settings.vat_inclusive then 0 else v_vat end, v_sort);
  else
    v_total := v_base + v_service;
  end if;

  update visits
     set subtotal_satang       = v_subtotal,
         discount_satang       = v_discount,
         service_charge_satang = v_service,
         vat_satang            = v_vat,
         total_satang          = v_total
   where id = p_visit_id
  returning * into v_visit;

  return v_visit;
end;
$$;

create or replace function request_visit_bill(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
begin
  select * into v_visit from visits where id = p_visit_id;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if not is_staff() and current_visit_id() is distinct from p_visit_id then
    raise exception 'ไม่มีสิทธิ์เช็คบิลโต๊ะนี้' using errcode = '42501';
  end if;

  if v_visit.status = 'open' then
    update visits set status = 'awaiting_payment', billed_at = now() where id = p_visit_id;
  end if;

  return recalculate_visit_totals(p_visit_id);
end;
$$;

create or replace function visit_amount_due(p_visit_id uuid)
returns integer language sql stable security definer set search_path = public as $$
  select v.total_satang - coalesce(
    (select sum(p.amount_satang) from payments p
      where p.visit_id = v.id and p.status = 'succeeded'), 0)
  from visits v where v.id = p_visit_id;
$$;

create or replace function create_payment(
  p_visit_id  uuid,
  p_method    payment_method,
  p_amount_satang integer,
  p_tendered_satang integer default null,
  p_provider_ref text default null,
  p_payload   jsonb default null
)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_settings restaurant_settings;
  v_due      integer;
  v_provider payment_provider;
  v_payment  payments;
  v_change   integer := 0;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่รับชำระเงินได้' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if v_visit.status not in ('awaiting_payment', 'paid') then
    raise exception 'รับชำระเงินไม่ได้: ต้องกดเช็คบิลก่อน (สถานะปัจจุบัน %)', v_visit.status
      using errcode = 'check_violation';
  end if;

  if p_amount_satang <= 0 then
    raise exception 'ยอดชำระต้องมากกว่า 0' using errcode = 'check_violation';
  end if;

  v_due := visit_amount_due(p_visit_id);
  if p_amount_satang > v_due then
    raise exception 'ยอดชำระ % สตางค์ เกินยอดคงเหลือ % สตางค์', p_amount_satang, v_due
      using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  v_provider := case p_method
                  when 'cash'         then 'mock_cash'
                  when 'transfer'     then 'mock_promptpay'
                  when 'qr_promptpay' then 'mock_promptpay'
                  when 'card'         then 'mock_card'
                end::payment_provider;

  if p_method = 'cash' and p_tendered_satang is not null then
    if p_tendered_satang < p_amount_satang then
      raise exception 'เงินที่รับมา (%) น้อยกว่ายอดที่ต้องชำระ (%)', p_tendered_satang, p_amount_satang
        using errcode = 'check_violation';
    end if;
    v_change := p_tendered_satang - p_amount_satang;
  end if;

  insert into payments (
    visit_id, method, provider, amount_satang, tendered_satang, change_satang,
    status, provider_ref, provider_payload, processed_by
  ) values (
    p_visit_id, p_method, v_provider, p_amount_satang,
    case when p_method = 'cash' then p_tendered_satang end, v_change,
    'pending', p_provider_ref, p_payload, auth.uid()
  ) returning * into v_payment;

  perform log_audit('payment.create', 'payments', v_payment.id::text, null, to_jsonb(v_payment));

  return v_payment;
end;
$$;

create or replace function confirm_payment(
  p_payment_id   uuid,
  p_provider_ref text default null,
  p_payload      jsonb default null
)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
  v_before  jsonb;
  v_due     integer;
  v_branch  uuid;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบรายการชำระเงิน' using errcode = 'no_data_found';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'รายการนี้ถูกดำเนินการไปแล้ว (สถานะ %)', v_payment.status
      using errcode = 'check_violation';
  end if;

  v_before := to_jsonb(v_payment);

  select branch_id into v_branch from visits where id = v_payment.visit_id;

  update payments
     set status = 'succeeded',
         provider_ref = coalesce(p_provider_ref, provider_ref),
         provider_payload = coalesce(p_payload, provider_payload),
         receipt_number = next_counter(v_branch, 'receipt'),
         receipt_date = (now() at time zone 'Asia/Bangkok')::date,
         completed_at = now()
   where id = p_payment_id
  returning * into v_payment;

  v_due := visit_amount_due(v_payment.visit_id);
  if v_due <= 0 then
    update visits set status = 'paid', paid_at = now()
     where id = v_payment.visit_id and status = 'awaiting_payment';
  end if;

  perform log_audit('payment.confirm', 'payments', v_payment.id::text, v_before, to_jsonb(v_payment));

  return v_payment;
end;
$$;

create or replace function cancel_payment(p_payment_id uuid, p_reason text default null)
returns payments
language plpgsql security definer set search_path = public as $$
declare
  v_payment payments;
  v_before  jsonb;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบรายการชำระเงิน' using errcode = 'no_data_found';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'ยกเลิกได้เฉพาะรายการที่ยังรอดำเนินการ' using errcode = 'check_violation';
  end if;

  v_before := to_jsonb(v_payment);

  update payments
     set status = 'cancelled', failure_reason = p_reason, completed_at = now()
   where id = p_payment_id
  returning * into v_payment;

  perform log_audit('payment.cancel', 'payments', v_payment.id::text, v_before, to_jsonb(v_payment), p_reason);

  return v_payment;
end;
$$;

create or replace function close_visit(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_settings restaurant_settings;
  v_points   integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if v_visit.status <> 'paid' then
    raise exception 'ปิดรอบไม่ได้: ต้องชำระเงินครบก่อน (สถานะปัจจุบัน %, คงเหลือ % สตางค์)',
      v_visit.status, visit_amount_due(p_visit_id)
      using errcode = 'check_violation';
  end if;

  update visits
     set status = 'closed',
         check_out_at = now(),
         closed_by = auth.uid(),
         session_token = null,
         access_code = null
   where id = p_visit_id
  returning * into v_visit;

  update visit_devices set revoked_at = now()
   where visit_id = p_visit_id and revoked_at is null;

  update tables set status = 'cleaning' where id = v_visit.table_id;

  update service_requests set status = 'done', resolved_at = now()
   where visit_id = p_visit_id and status in ('open', 'acknowledged');

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;
  if v_settings.points_enabled and v_visit.customer_id is not null then
    v_points := floor((v_visit.total_satang / 100.0) / v_settings.points_baht_per_point)::integer;
    if v_points > 0 then
      insert into loyalty_transactions (customer_id, visit_id, type, points, note, created_by)
      values (v_visit.customer_id, p_visit_id, 'earn', v_points,
              'สะสมจากบิล ' || v_visit.visit_code, auth.uid());
    end if;

    update customers
       set total_visits = total_visits + 1,
           total_spend_satang = total_spend_satang + v_visit.total_satang,
           last_visit_at = now(),
           first_visit_at = coalesce(first_visit_at, now())
     where id = v_visit.customer_id;
  end if;

  perform log_audit('visit.close', 'visits', p_visit_id::text, null, to_jsonb(v_visit));

  return v_visit;
end;
$$;

create or replace function mark_table_clean(p_table_id uuid)
returns public.tables
language plpgsql security definer set search_path = public as $$
declare
  v_table public.tables;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  update tables set status = 'available'
   where id = p_table_id and status = 'cleaning'
  returning * into v_table;

  if not found then
    raise exception 'โต๊ะนี้ไม่ได้อยู่ในสถานะรอทำความสะอาด' using errcode = 'check_violation';
  end if;

  perform log_audit('table.clean', 'tables', p_table_id::text, null, to_jsonb(v_table));
  return v_table;
end;
$$;

create or replace function set_menu_item_availability(p_menu_item_id uuid, p_available boolean)
returns menu_items
language plpgsql security definer set search_path = public as $$
declare
  v_item menu_items;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  update menu_items set is_available = p_available
   where id = p_menu_item_id and branch_id = current_staff_branch()
  returning * into v_item;

  if not found then
    raise exception 'ไม่พบเมนูที่ระบุ' using errcode = 'no_data_found';
  end if;

  perform log_audit(
    case when p_available then 'menu_item.restock' else 'menu_item.86' end,
    'menu_items', p_menu_item_id::text, null, jsonb_build_object('is_available', p_available));

  return v_item;
end;
$$;

create or replace function void_visit(p_visit_id uuid, p_reason text)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_before jsonb;
begin
  if not is_manager() then
    raise exception 'เฉพาะผู้จัดการเท่านั้นที่ยกเลิกบิลได้' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'ต้องระบุเหตุผลในการยกเลิกบิล' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  v_before := to_jsonb(v_visit);

  update visits
     set status = 'void', void_reason = p_reason, closed_by = auth.uid(),
         check_out_at = now(), session_token = null, access_code = null
   where id = p_visit_id
  returning * into v_visit;

  update visit_devices set revoked_at = now() where visit_id = p_visit_id and revoked_at is null;
  update tables set status = 'cleaning' where id = v_visit.table_id and status = 'occupied';

  perform log_audit('visit.void', 'visits', p_visit_id::text, v_before, to_jsonb(v_visit), p_reason);
  return v_visit;
end;
$$;

alter table branches              enable row level security;
alter table restaurant_settings   enable row level security;
alter table profiles              enable row level security;
alter table kitchen_stations      enable row level security;
alter table daily_counters        enable row level security;
alter table audit_logs            enable row level security;
alter table buffet_packages       enable row level security;
alter table add_ons               enable row level security;
alter table menu_categories       enable row level security;
alter table menu_items            enable row level security;
alter table menu_item_packages    enable row level security;
alter table zones                 enable row level security;
alter table tables                enable row level security;
alter table queue_tickets         enable row level security;
alter table customers             enable row level security;
alter table visits                enable row level security;
alter table visit_addons          enable row level security;
alter table visit_devices         enable row level security;
alter table visit_access_attempts enable row level security;
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table order_status_history  enable row level security;
alter table service_requests      enable row level security;
alter table promotions            enable row level security;
alter table visit_promotions      enable row level security;
alter table bill_lines            enable row level security;
alter table payments              enable row level security;
alter table loyalty_transactions  enable row level security;

create policy read_menu_categories on menu_categories
  for select to authenticated using (true);
create policy manage_menu_categories on menu_categories
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_menu_items on menu_items
  for select to authenticated using (true);
create policy manage_menu_items on menu_items
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_menu_item_packages on menu_item_packages
  for select to authenticated using (true);
create policy manage_menu_item_packages on menu_item_packages
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_buffet_packages on buffet_packages
  for select to authenticated using (true);
create policy manage_buffet_packages on buffet_packages
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_add_ons on add_ons
  for select to authenticated using (true);
create policy manage_add_ons on add_ons
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_kitchen_stations on kitchen_stations
  for select to authenticated using (true);
create policy manage_kitchen_stations on kitchen_stations
  for all to authenticated using (is_manager()) with check (is_manager());

create policy read_zones on zones for select to authenticated using (is_staff());
create policy manage_zones on zones for all to authenticated
  using (is_manager()) with check (is_manager());

create policy read_tables on tables
  for select to authenticated using (
    is_staff()
    or id = (select table_id from visits where id = current_visit_id())
  );
create policy manage_tables on tables
  for all to authenticated using (is_manager()) with check (is_manager());
create policy staff_update_table_status on tables
  for update to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_settings on restaurant_settings
  for select to authenticated using (is_staff());
create policy manage_settings on restaurant_settings
  for all to authenticated using (is_manager()) with check (is_manager());

create view public_settings as
  select branch_id,
         display_name,
         logo_url,
         timezone,
         default_dining_minutes,
         last_order_minutes_before_end,
         max_qty_per_item,
         max_items_per_order,
         max_units_per_order,
         min_seconds_between_orders,
         max_unserved_orders_per_visit,
         vat_enabled,
         vat_rate_bp,
         vat_inclusive,
         service_charge_enabled,
         service_charge_rate_bp,
         points_enabled,
         points_baht_per_point,
         payment_mode
  from restaurant_settings;

grant select on public_settings to authenticated;

create policy read_branches on branches for select to authenticated using (true);
create policy manage_branches on branches for all to authenticated
  using (is_manager()) with check (is_manager());

create policy read_own_profile on profiles
  for select to authenticated using (id = auth.uid() or is_staff());
create policy manage_profiles on profiles
  for all to authenticated using (is_manager()) with check (is_manager());

create policy staff_read_queue on queue_tickets
  for select to authenticated using (is_staff());
create policy staff_write_queue on queue_tickets
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_customers on customers
  for select to authenticated using (is_staff());
create policy staff_write_customers on customers
  for all to authenticated using (is_staff()) with check (is_staff());

create policy manager_read_audit on audit_logs
  for select to authenticated using (is_manager());

create policy staff_read_counters on daily_counters
  for select to authenticated using (is_staff());

create policy manage_promotions on promotions
  for all to authenticated using (is_manager()) with check (is_manager());
create policy staff_read_promotions on promotions
  for select to authenticated using (is_staff());

create policy read_own_visit on visits
  for select to authenticated using (is_staff() or id = current_visit_id());
create policy staff_write_visits on visits
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_visit_addons on visit_addons
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_visit_addons on visit_addons
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_devices on visit_devices
  for select to authenticated using (
    is_staff() or auth_user_id = auth.uid() or visit_id = current_visit_id()
  );
create policy staff_write_devices on visit_devices
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_access_attempts on visit_access_attempts
  for select to authenticated using (is_staff());

create policy read_own_orders on orders
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_orders on orders
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_order_items on order_items
  for select to authenticated using (
    is_staff()
    or order_id in (select id from orders where visit_id = current_visit_id())
  );
create policy staff_write_order_items on order_items
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_order_history on order_status_history
  for select to authenticated using (is_staff());

create policy read_own_service_requests on service_requests
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy create_own_service_request on service_requests
  for insert to authenticated with check (
    visit_id = current_visit_id()
    and table_id = (select table_id from visits where id = current_visit_id())
  );
create policy staff_write_service_requests on service_requests
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_bill_lines on bill_lines
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_bill_lines on bill_lines
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_visit_promotions on visit_promotions
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_visit_promotions on visit_promotions
  for all to authenticated using (is_staff()) with check (is_staff());

create policy read_own_payments on payments
  for select to authenticated using (is_staff() or visit_id = current_visit_id());
create policy staff_write_payments on payments
  for all to authenticated using (is_staff()) with check (is_staff());

create policy staff_read_loyalty on loyalty_transactions
  for select to authenticated using (is_staff());
create policy staff_write_loyalty on loyalty_transactions
  for all to authenticated using (is_staff()) with check (is_staff());

grant execute on function join_visit(uuid, uuid, text, text, text)  to authenticated;
grant execute on function place_order(uuid, jsonb, text)            to authenticated;
grant execute on function request_visit_bill(uuid)                  to authenticated;
grant execute on function current_visit_id()                        to authenticated;
grant execute on function visit_amount_due(uuid)                    to authenticated;

grant execute on function open_visit(uuid, uuid, integer, integer, jsonb, uuid, text) to authenticated;
grant execute on function advance_order_item(uuid, order_status)    to authenticated;
grant execute on function recalculate_visit_totals(uuid)            to authenticated;
grant execute on function create_payment(uuid, payment_method, integer, integer, text, jsonb) to authenticated;
grant execute on function confirm_payment(uuid, text, jsonb)        to authenticated;
grant execute on function cancel_payment(uuid, text)                to authenticated;
grant execute on function close_visit(uuid)                         to authenticated;
grant execute on function mark_table_clean(uuid)                    to authenticated;
grant execute on function void_visit(uuid, text)                    to authenticated;
grant execute on function set_menu_item_availability(uuid, boolean) to authenticated;
grant execute on function is_staff()                                to authenticated;
grant execute on function is_manager()                              to authenticated;

revoke execute on function next_counter(uuid, text, date) from authenticated, anon;
revoke execute on function log_audit(text, text, text, jsonb, jsonb, text) from authenticated, anon;

revoke all on all tables in schema public from anon;

alter publication supabase_realtime add table visits;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table service_requests;
alter publication supabase_realtime add table tables;
alter publication supabase_realtime add table queue_tickets;
alter publication supabase_realtime add table payments;

alter table visits           replica identity full;
alter table orders           replica identity full;
alter table order_items      replica identity full;
alter table service_requests replica identity full;
alter table tables           replica identity full;
alter table queue_tickets    replica identity full;

create or replace function resolve_visit_token(p_token text, p_require_open boolean default true)
returns visits
language plpgsql stable security definer set search_path = public as $$
declare
  v_visit visits;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'ไม่มี token' using errcode = '42501';
  end if;

  begin
    select * into v_visit from visits where session_token = trim(p_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'token ไม่ถูกต้อง' using errcode = '42501';
  end;

  if v_visit.id is null then
    raise exception 'QR นี้ใช้ไม่ได้แล้ว' using errcode = '42501';
  end if;

  if p_require_open and v_visit.status <> 'open' then
    raise exception 'รอบการใช้บริการนี้ปิดแล้ว' using errcode = 'check_violation';
  end if;

  return v_visit;
end;
$$;

create or replace function get_visit_by_token(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_visit visits;
  v_table public.tables;
begin
  v_visit := resolve_visit_token(p_token, false);
  select * into v_table from public.tables where id = v_visit.table_id;

  return jsonb_build_object(
    'visit_id',        v_visit.id,
    'visit_code',      v_visit.visit_code,
    'table_number',    v_table.table_number,
    'status',          v_visit.status,
    'package_name',    v_visit.package_name_snapshot,
    'package_id',      v_visit.package_id,
    'adult_count',     v_visit.adult_count,
    'child_count',     v_visit.child_count,
    'check_in_at',     v_visit.check_in_at,
    'deadline_at',     v_visit.dining_deadline_at,
    'subtotal_satang', v_visit.subtotal_satang,
    'total_satang',    v_visit.total_satang
  );
end;
$$;

create or replace function get_visit_orders(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_visit visits;
begin
  v_visit := resolve_visit_token(p_token, false);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'order_id',     o.id,
             'order_number', o.order_number,
             'status',       o.status,
             'created_at',   o.created_at,
             'items', (
               select jsonb_agg(jsonb_build_object(
                        'name',     oi.name_snapshot,
                        'quantity', oi.quantity,
                        'status',   oi.status,
                        'note',     oi.note
                      ) order by oi.created_at)
               from order_items oi where oi.order_id = o.id
             )
           ) order by o.order_number)
    from orders o where o.visit_id = v_visit.id
  ), '[]'::jsonb);
end;
$$;

create or replace function place_order_by_token(p_token text, p_items jsonb, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_order orders;
begin
  v_visit := resolve_visit_token(p_token, true);
  v_order := place_order(v_visit.id, p_items, p_note);

  return jsonb_build_object(
    'order_id',     v_order.id,
    'order_number', v_order.order_number,
    'status',       v_order.status
  );
end;
$$;

create or replace function call_staff_by_token(
  p_token   text,
  p_type    service_request_type default 'call_staff',
  p_message text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_req   service_requests;
begin
  v_visit := resolve_visit_token(p_token, false);

  select * into v_req from service_requests
   where visit_id = v_visit.id and type = p_type and status = 'open';

  if not found then
    insert into service_requests (visit_id, table_id, type, message)
    values (v_visit.id, v_visit.table_id, p_type, p_message)
    returning * into v_req;
  end if;

  return jsonb_build_object('request_id', v_req.id, 'status', v_req.status, 'type', v_req.type);
end;
$$;

revoke execute on function resolve_visit_token(text, boolean) from public, anon, authenticated;

grant execute on function get_visit_by_token(text)                                to anon, authenticated;
grant execute on function get_visit_orders(text)                                  to anon, authenticated;
grant execute on function place_order_by_token(text, jsonb, text)                 to anon, authenticated;
grant execute on function call_staff_by_token(text, service_request_type, text)   to anon, authenticated;

comment on function place_order_by_token(text, jsonb, text) is
  'ทางเข้าสำรองเมื่อเปิด Anonymous sign-in ไม่ได้ — ไม่มี realtime ต้อง poll get_visit_orders()';

alter table queue_tickets
  add column if not exists public_token uuid not null default gen_random_uuid();

create unique index if not exists queue_tickets_public_token_idx
  on queue_tickets (public_token);

create or replace function issue_queue_ticket(
  p_party_size    integer,
  p_customer_name text default null,
  p_phone         text default null,
  p_notes         text default null
)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_branch uuid;
  v_number integer;
  v_row    queue_tickets;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่ออกบัตรคิวได้' using errcode = '42501';
  end if;

  if p_party_size is null or p_party_size < 1 then
    raise exception 'จำนวนคนต้องอย่างน้อย 1 ท่าน' using errcode = 'check_violation';
  end if;

  v_branch := current_staff_branch();
  if v_branch is null then
    raise exception 'ไม่พบสาขาของพนักงานคนนี้' using errcode = 'no_data_found';
  end if;

  v_number := next_counter(v_branch, 'queue');

  insert into queue_tickets (
    branch_id, ticket_number, party_size, customer_name, phone, notes, created_by
  ) values (
    v_branch, v_number, p_party_size,
    nullif(trim(coalesce(p_customer_name, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning * into v_row;

  perform log_audit('issue_queue_ticket', 'queue_tickets', v_row.id::text,
                    null, to_jsonb(v_row), null);
  return v_row;
end;
$$;

create or replace function call_queue_ticket(p_id uuid)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare v_row queue_tickets;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  update queue_tickets
     set status = 'called', called_at = now(), updated_at = now()
   where id = p_id and status = 'waiting'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'เรียกคิวนี้ไม่ได้ (อาจถูกเรียก จัดโต๊ะ หรือยกเลิกไปแล้ว)'
      using errcode = 'check_violation';
  end if;
  return v_row;
end;
$$;

create or replace function cancel_queue_ticket(p_id uuid, p_no_show boolean default false)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare v_row queue_tickets;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  update queue_tickets
     set status = case when p_no_show then 'no_show' else 'cancelled' end::queue_status,
         updated_at = now()
   where id = p_id and status in ('waiting', 'called')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'ยกเลิกคิวนี้ไม่ได้ (จัดโต๊ะไปแล้วหรือยกเลิกไปแล้ว)'
      using errcode = 'check_violation';
  end if;
  return v_row;
end;
$$;

create or replace function get_queue_status(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row     queue_tickets;
  v_ahead   integer;
  v_serving integer;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'ไม่มี token' using errcode = '42501';
  end if;

  begin
    select * into v_row from queue_tickets where public_token = trim(p_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'บัตรคิวนี้ใช้ไม่ได้' using errcode = '42501';
  end;

  if v_row.id is null then
    raise exception 'ไม่พบบัตรคิวนี้' using errcode = '42501';
  end if;

  select count(*) into v_ahead
    from queue_tickets q
   where q.branch_id    = v_row.branch_id
     and q.ticket_date  = v_row.ticket_date
     and q.status in ('waiting', 'called')
     and q.ticket_number < v_row.ticket_number;

  select max(q.ticket_number) into v_serving
    from queue_tickets q
   where q.branch_id   = v_row.branch_id
     and q.ticket_date = v_row.ticket_date
     and q.status      = 'called';

  return jsonb_build_object(
    'now_serving',   v_serving,
    'ticket_number', v_row.ticket_number,
    'party_size',    v_row.party_size,
    'status',        v_row.status,
    'ahead',         coalesce(v_ahead, 0),
    'created_at',    v_row.created_at,
    'called_at',     v_row.called_at,
    'seated_at',     v_row.seated_at
  );
end;
$$;

grant execute on function issue_queue_ticket(integer, text, text, text) to authenticated;
grant execute on function call_queue_ticket(uuid)                       to authenticated;
grant execute on function cancel_queue_ticket(uuid, boolean)            to authenticated;

grant execute on function get_queue_status(text) to anon, authenticated;

drop policy if exists read_tables on tables;
create policy read_tables on tables
  for select to authenticated using (
    (is_staff() and branch_id = current_staff_branch())
    or id = (select table_id from visits where id = current_visit_id())
  );

drop policy if exists staff_update_table_status on tables;
create policy staff_update_table_status on tables
  for update to authenticated
  using      (is_staff() and branch_id = current_staff_branch())
  with check (is_staff() and branch_id = current_staff_branch());

drop policy if exists staff_read_queue on queue_tickets;
create policy staff_read_queue on queue_tickets
  for select to authenticated
  using (is_staff() and branch_id = current_staff_branch());

drop policy if exists staff_write_queue on queue_tickets;
create policy staff_write_queue on queue_tickets
  for all to authenticated
  using      (is_staff() and branch_id = current_staff_branch())
  with check (is_staff() and branch_id = current_staff_branch());

drop policy if exists read_own_visit on visits;
create policy read_own_visit on visits
  for select to authenticated using (
    (is_staff() and branch_id = current_staff_branch())
    or id = current_visit_id()
  );

drop policy if exists staff_write_visits on visits;
create policy staff_write_visits on visits
  for all to authenticated
  using      (is_staff() and branch_id = current_staff_branch())
  with check (is_staff() and branch_id = current_staff_branch());

drop policy if exists read_own_orders on orders;
create policy read_own_orders on orders
  for select to authenticated using (
    (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()))
    or visit_id = current_visit_id()
  );

drop policy if exists staff_write_orders on orders;
create policy staff_write_orders on orders
  for all to authenticated
  using      (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()))
  with check (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()));

drop policy if exists read_own_payments on payments;
create policy read_own_payments on payments
  for select to authenticated using (
    (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()))
    or visit_id = current_visit_id()
  );

drop policy if exists staff_write_payments on payments;
create policy staff_write_payments on payments
  for all to authenticated
  using      (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()))
  with check (is_staff() and visit_id in (select id from visits where branch_id = current_staff_branch()));

revoke execute on function next_counter(uuid, text, date)
  from public, anon, authenticated;

revoke execute on function log_audit(text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;

revoke execute on function resolve_visit_token(text, boolean)
  from public, anon, authenticated;

revoke execute on function recalculate_visit_totals(uuid)
  from public, anon, authenticated;

do $$
begin
  execute 'revoke execute on function bootstrap_staff_profile(text, text, staff_role, text)
             from public, anon, authenticated';
exception
  when undefined_function then
    raise notice 'ข้าม bootstrap_staff_profile — ยังไม่ได้รัน seed_dev_staff.sql';
end;
$$;

revoke all on public_settings from public, anon;
grant select on public_settings to authenticated;

alter table queue_tickets
  add column if not exists adult_count integer not null default 0 check (adult_count >= 0),
  add column if not exists child_count integer not null default 0 check (child_count >= 0);

alter table restaurant_settings
  add column if not exists queue_grace_minutes integer not null default 5
    check (queue_grace_minutes between 0 and 60);

drop function if exists issue_queue_ticket(integer, text, text, text);

create or replace function issue_queue_ticket(
  p_party_size    integer,
  p_customer_name text default null,
  p_phone         text default null,
  p_notes         text default null,
  p_adult_count   integer default null,
  p_child_count   integer default 0
)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_branch  uuid;
  v_number  integer;
  v_adults  integer;
  v_children integer;
  v_row     queue_tickets;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่ออกบัตรคิวได้' using errcode = '42501';
  end if;

  v_children := greatest(coalesce(p_child_count, 0), 0);
  v_adults   := coalesce(p_adult_count, greatest(coalesce(p_party_size, 0) - v_children, 0));

  if v_adults + v_children < 1 then
    raise exception 'จำนวนคนต้องอย่างน้อย 1 ท่าน' using errcode = 'check_violation';
  end if;

  v_branch := current_staff_branch();
  if v_branch is null then
    raise exception 'ไม่พบสาขาของพนักงานคนนี้' using errcode = 'no_data_found';
  end if;

  v_number := next_counter(v_branch, 'queue');

  insert into queue_tickets (
    branch_id, ticket_number, party_size, adult_count, child_count,
    customer_name, phone, notes, created_by
  ) values (
    v_branch, v_number, v_adults + v_children, v_adults, v_children,
    nullif(trim(coalesce(p_customer_name, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning * into v_row;

  perform log_audit('issue_queue_ticket', 'queue_tickets', v_row.id::text,
                    null, to_jsonb(v_row), null);
  return v_row;
end;
$$;

create or replace function cancel_queue_ticket(p_id uuid, p_no_show boolean default false)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_row   queue_tickets;
  v_grace integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_row from queue_tickets where id = p_id;
  if v_row.id is null then
    raise exception 'ไม่พบบัตรคิวนี้' using errcode = 'no_data_found';
  end if;

  if p_no_show then
    if v_row.status <> 'called' then
      raise exception 'ตัดเป็นไม่มาตามเรียกได้เฉพาะคิวที่เรียกแล้ว (สถานะปัจจุบัน %)', v_row.status
        using errcode = 'check_violation';
    end if;
    select queue_grace_minutes into v_grace
      from restaurant_settings where branch_id = v_row.branch_id;
    if v_row.called_at + make_interval(mins => coalesce(v_grace, 5)) > now() then
      raise exception 'ยังไม่ครบเวลารอ % นาทีนับจากที่เรียกคิว', coalesce(v_grace, 5)
        using errcode = 'check_violation';
    end if;
  end if;

  update queue_tickets
     set status = case when p_no_show then 'no_show' else 'cancelled' end::queue_status,
         updated_at = now()
   where id = p_id and status in ('waiting', 'called')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'ยกเลิกคิวนี้ไม่ได้ (จัดโต๊ะไปแล้วหรือยกเลิกไปแล้ว)'
      using errcode = 'check_violation';
  end if;
  return v_row;
end;
$$;

create or replace function get_queue_status(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row       queue_tickets;
  v_ahead     integer;
  v_serving   integer;
  v_available integer;
  v_cleaning  integer;
  v_grace     integer;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'ไม่มี token' using errcode = '42501';
  end if;

  begin
    select * into v_row from queue_tickets where public_token = trim(p_token)::uuid;
  exception when invalid_text_representation then
    raise exception 'บัตรคิวนี้ใช้ไม่ได้' using errcode = '42501';
  end;

  if v_row.id is null then
    raise exception 'ไม่พบบัตรคิวนี้' using errcode = '42501';
  end if;

  select count(*) into v_ahead
    from queue_tickets q
   where q.branch_id    = v_row.branch_id
     and q.ticket_date  = v_row.ticket_date
     and q.status in ('waiting', 'called')
     and q.ticket_number < v_row.ticket_number;

  select max(q.ticket_number) into v_serving
    from queue_tickets q
   where q.branch_id   = v_row.branch_id
     and q.ticket_date = v_row.ticket_date
     and q.status      = 'called';

  select count(*) filter (where status = 'available'),
         count(*) filter (where status = 'cleaning')
    into v_available, v_cleaning
    from public.tables
   where branch_id = v_row.branch_id and is_active;

  select queue_grace_minutes into v_grace
    from restaurant_settings where branch_id = v_row.branch_id;

  return jsonb_build_object(
    'now_serving',     v_serving,
    'ticket_number',   v_row.ticket_number,
    'party_size',      v_row.party_size,
    'adult_count',     v_row.adult_count,
    'child_count',     v_row.child_count,
    'status',          v_row.status,
    'ahead',           coalesce(v_ahead, 0),
    'near_turn',       coalesce(v_ahead, 0) <= 3 and v_row.status = 'waiting',
    'tables_available', coalesce(v_available, 0),
    'tables_cleaning',  coalesce(v_cleaning, 0),
    'grace_minutes',   coalesce(v_grace, 5),
    'created_at',      v_row.created_at,
    'called_at',       v_row.called_at,
    'seated_at',       v_row.seated_at
  );
end;
$$;

create or replace function adjust_visit_guests(
  p_visit_id uuid,
  p_adults   integer,
  p_children integer default 0
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit  visits;
  v_table  public.tables;
  v_guests integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่แก้จำนวนคนได้' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id;
  if v_visit.id is null then
    raise exception 'ไม่พบรอบการใช้บริการนี้' using errcode = 'no_data_found';
  end if;

  if v_visit.status <> 'open' then
    raise exception 'แก้จำนวนคนได้เฉพาะรอบที่ยังเปิดอยู่ (สถานะปัจจุบัน %)', v_visit.status
      using errcode = 'check_violation';
  end if;

  v_guests := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if v_guests < 1 then
    raise exception 'จำนวนคนต้องอย่างน้อย 1 ท่าน' using errcode = 'check_violation';
  end if;

  select * into v_table from public.tables where id = v_visit.table_id;
  if v_guests > v_table.capacity then
    raise exception 'จำนวน % ท่าน เกินความจุโต๊ะ % (% ที่นั่ง)',
      v_guests, v_table.table_number, v_table.capacity using errcode = 'check_violation';
  end if;

  update visits
     set adult_count = p_adults,
         child_count = coalesce(p_children, 0),
         updated_at  = now()
   where id = p_visit_id
  returning * into v_visit;

  update visit_addons
     set quantity = v_guests
   where visit_id = p_visit_id and charge_basis = 'per_person';

  perform log_audit('adjust_visit_guests', 'visits', p_visit_id::text,
                    jsonb_build_object('adult_count', v_visit.adult_count,
                                       'child_count', v_visit.child_count),
                    jsonb_build_object('adult_count', p_adults,
                                       'child_count', coalesce(p_children, 0)), null);
  return v_visit;
end;
$$;

create or replace function visit_amount_reserved(p_visit_id uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_satang), 0)::integer
    from payments
   where visit_id = p_visit_id and status in ('pending', 'succeeded');
$$;

create or replace function trg_payment_reserve_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_total    integer;
  v_reserved integer;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  select total_satang into v_total from visits where id = new.visit_id;
  v_reserved := visit_amount_reserved(new.visit_id);

  if v_reserved + new.amount_satang > coalesce(v_total, 0) then
    raise exception
      'มีรายการชำระค้างอยู่แล้ว % สตางค์ จากยอดบิล % สตางค์ — ยกเลิกรายการค้างก่อนสร้างใหม่',
      v_reserved, coalesce(v_total, 0)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_reserve_guard on payments;
create trigger payment_reserve_guard
  before insert on payments
  for each row execute function trg_payment_reserve_guard();

revoke execute on function visit_amount_reserved(uuid) from public, anon;
revoke execute on function trg_payment_reserve_guard() from public, anon, authenticated;
grant  execute on function visit_amount_reserved(uuid) to authenticated;

create or replace function adjust_visit_guests(
  p_visit_id uuid,
  p_adults   integer,
  p_children integer default 0
)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit  visits;
  v_before jsonb;
  v_table  public.tables;
  v_guests integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่แก้จำนวนคนได้' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id;
  if v_visit.id is null then
    raise exception 'ไม่พบรอบการใช้บริการนี้' using errcode = 'no_data_found';
  end if;

  if v_visit.status <> 'open' then
    raise exception 'แก้จำนวนคนได้เฉพาะรอบที่ยังเปิดอยู่ (สถานะปัจจุบัน %)', v_visit.status
      using errcode = 'check_violation';
  end if;

  v_before := jsonb_build_object('adult_count', v_visit.adult_count,
                                 'child_count', v_visit.child_count);

  v_guests := coalesce(p_adults, 0) + coalesce(p_children, 0);
  if v_guests < 1 then
    raise exception 'จำนวนคนต้องอย่างน้อย 1 ท่าน' using errcode = 'check_violation';
  end if;

  select * into v_table from public.tables where id = v_visit.table_id;
  if v_guests > v_table.capacity then
    raise exception 'จำนวน % ท่าน เกินความจุโต๊ะ % (% ที่นั่ง)',
      v_guests, v_table.table_number, v_table.capacity using errcode = 'check_violation';
  end if;

  update visits
     set adult_count = p_adults,
         child_count = coalesce(p_children, 0),
         updated_at  = now()
   where id = p_visit_id
  returning * into v_visit;

  update visit_addons
     set quantity = v_guests
   where visit_id = p_visit_id and charge_basis = 'per_person';

  perform log_audit('adjust_visit_guests', 'visits', p_visit_id::text,
                    v_before,
                    jsonb_build_object('adult_count', v_visit.adult_count,
                                       'child_count', v_visit.child_count), null);
  return v_visit;
end;
$$;

create or replace function close_visit(p_visit_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_settings restaurant_settings;
  v_points   integer;
  v_pending  integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if v_visit.status <> 'paid' then
    raise exception 'ปิดรอบไม่ได้: ต้องชำระเงินครบก่อน (สถานะปัจจุบัน %, คงเหลือ % สตางค์)',
      v_visit.status, visit_amount_due(p_visit_id)
      using errcode = 'check_violation';
  end if;

  select count(*) into v_pending
  from order_items oi
  join orders o on o.id = oi.order_id
  where o.visit_id = p_visit_id
    and oi.status in ('pending', 'preparing', 'ready');

  if v_pending > 0 then
    raise exception 'ปิดรอบไม่ได้: ยังมีอาหารค้างที่ครัว % รายการ — ให้ครัวกดเสิร์ฟหรือยกเลิกก่อน', v_pending
      using errcode = 'check_violation';
  end if;

  update visits
     set status = 'closed',
         check_out_at = now(),
         closed_by = auth.uid(),
         session_token = null,
         access_code = null
   where id = p_visit_id
  returning * into v_visit;

  update visit_devices set revoked_at = now()
   where visit_id = p_visit_id and revoked_at is null;

  update tables set status = 'cleaning' where id = v_visit.table_id;

  update service_requests set status = 'done', resolved_at = now()
   where visit_id = p_visit_id and status in ('open', 'acknowledged');

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;
  if v_settings.points_enabled and v_visit.customer_id is not null then
    v_points := floor((v_visit.total_satang / 100.0) / v_settings.points_baht_per_point)::integer;
    if v_points > 0 then
      insert into loyalty_transactions (customer_id, visit_id, type, points, note, created_by)
      values (v_visit.customer_id, p_visit_id, 'earn', v_points,
              'สะสมจากบิล ' || v_visit.visit_code, auth.uid());
    end if;

    update customers
       set total_visits = total_visits + 1,
           total_spend_satang = total_spend_satang + v_visit.total_satang,
           last_visit_at = now(),
           first_visit_at = coalesce(first_visit_at, now())
     where id = v_visit.customer_id;
  end if;

  perform log_audit('visit.close', 'visits', p_visit_id::text, null, to_jsonb(v_visit));

  return v_visit;
end;
$$;

drop function if exists advance_order_item(uuid, order_status);

create or replace function advance_order_item(
  p_item_id uuid,
  p_next    order_status,
  p_reason  text default null
)
returns order_items
language plpgsql security definer set search_path = public as $$
declare
  v_item order_items;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_item from order_items where id = p_item_id for update;
  if not found then
    raise exception 'ไม่พบรายการอาหาร' using errcode = 'no_data_found';
  end if;

  if not (
       (v_item.status = 'pending'   and p_next in ('preparing', 'cancelled'))
    or (v_item.status = 'preparing' and p_next in ('ready', 'cancelled'))
    or (v_item.status = 'ready'     and p_next in ('served', 'preparing', 'cancelled'))
    or (v_item.status = 'served'    and p_next in ('ready'))
  ) then
    raise exception 'เปลี่ยนสถานะจาก % ไป % ไม่ได้', v_item.status, p_next
      using errcode = 'check_violation';
  end if;

  update order_items
     set status     = p_next,
         started_at = case when p_next = 'preparing' then coalesce(started_at, now()) else started_at end,
         ready_at   = case when p_next = 'ready'     then now() else ready_at end,
         served_at  = case when p_next = 'served'    then now() else served_at end,
         cancelled_reason = case when p_next = 'cancelled'
                                 then coalesce(nullif(trim(p_reason), ''), 'ยกเลิกโดยพนักงาน')
                                 else cancelled_reason end
   where id = p_item_id
  returning * into v_item;

  if p_next = 'cancelled' then
    perform log_audit('order_item.cancel', 'order_items', p_item_id::text,
                      null, to_jsonb(v_item), v_item.cancelled_reason);

    perform recalculate_visit_totals(v.id)
    from visits v
    join orders o on o.visit_id = v.id
    where o.id = v_item.order_id and v.status in ('open', 'awaiting_payment');
  end if;

  return v_item;
end;
$$;

create or replace function apply_promotion_code(p_visit_id uuid, p_code text)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit    visits;
  v_promo    promotions;
  v_settings restaurant_settings;
  v_local    timestamptz := now();
  v_dow      smallint;
  v_time     time;
  v_paid     integer;
  v_discount integer := 0;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้นที่ใส่โปรโมชั่นได้' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;

  if v_visit.status not in ('open', 'awaiting_payment') then
    raise exception 'ใส่โปรโมชั่นไม่ได้: รอบนี้อยู่ในสถานะ %', v_visit.status
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount_satang), 0) into v_paid
    from payments where visit_id = p_visit_id and status = 'succeeded';
  if v_paid > 0 then
    raise exception 'ใส่โปรโมชั่นไม่ได้: รับชำระเงินไปแล้ว % สตางค์ — ยกเลิกรายการชำระก่อน', v_paid
      using errcode = 'check_violation';
  end if;

  select * into v_promo from promotions
   where branch_id = v_visit.branch_id
     and upper(code) = upper(trim(coalesce(p_code, '')));
  if not found then
    raise exception 'ไม่พบโค้ดโปรโมชั่นนี้' using errcode = 'no_data_found';
  end if;

  if not v_promo.is_active then
    raise exception 'โปรโมชั่น % ถูกปิดใช้งานอยู่', v_promo.code using errcode = 'check_violation';
  end if;

  if exists (select 1 from visit_promotions
              where visit_id = p_visit_id and promotion_id = v_promo.id) then
    raise exception 'ใส่โปรโมชั่น % ไปแล้ว', v_promo.code using errcode = 'check_violation';
  end if;

  if v_promo.starts_at is not null and v_promo.starts_at > now() then
    raise exception 'โปรโมชั่น % ยังไม่เริ่ม', v_promo.code using errcode = 'check_violation';
  end if;
  if v_promo.ends_at is not null and v_promo.ends_at <= now() then
    raise exception 'โปรโมชั่น % หมดอายุแล้ว', v_promo.code using errcode = 'check_violation';
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;
  v_dow  := extract(dow  from v_local at time zone coalesce(v_settings.timezone, 'Asia/Bangkok'))::smallint;
  v_time := (v_local at time zone coalesce(v_settings.timezone, 'Asia/Bangkok'))::time;

  if array_length(v_promo.days_of_week, 1) is not null
     and not (v_dow = any (v_promo.days_of_week)) then
    raise exception 'โปรโมชั่น % ใช้ไม่ได้ในวันนี้', v_promo.code using errcode = 'check_violation';
  end if;

  if (v_promo.time_start is not null and v_time < v_promo.time_start)
     or (v_promo.time_end is not null and v_time > v_promo.time_end) then
    raise exception 'โปรโมชั่น % ใช้ได้ช่วง %–% เท่านั้น',
      v_promo.code, v_promo.time_start, v_promo.time_end using errcode = 'check_violation';
  end if;

  if v_promo.max_uses is not null and v_promo.uses_count >= v_promo.max_uses then
    raise exception 'โปรโมชั่น % ถูกใช้ครบจำนวนแล้ว', v_promo.code using errcode = 'check_violation';
  end if;

  v_visit := recalculate_visit_totals(p_visit_id);

  if v_visit.subtotal_satang < v_promo.min_spend_satang then
    raise exception 'โปรโมชั่น % ต้องมียอดขั้นต่ำ % สตางค์ (ยอดปัจจุบัน %)',
      v_promo.code, v_promo.min_spend_satang, v_visit.subtotal_satang
      using errcode = 'check_violation';
  end if;

  v_discount := case v_promo.type
    when 'percent' then round(v_visit.subtotal_satang::numeric * v_promo.value_bp / 10000)::integer
    when 'fixed'   then least(v_promo.value_satang, v_visit.subtotal_satang)
    when 'free_addon' then coalesce(
      (select sum(unit_price_satang * quantity) from visit_addons
        where visit_id = p_visit_id and add_on_id = v_promo.free_add_on_id), 0)
  end;

  insert into visit_promotions (visit_id, promotion_id, name_snapshot, discount_satang, applied_by)
  values (p_visit_id, v_promo.id, v_promo.name, greatest(v_discount, 0), auth.uid());

  update promotions set uses_count = uses_count + 1 where id = v_promo.id;

  perform log_audit('promotion.apply', 'visits', p_visit_id::text, null,
                    jsonb_build_object('code', v_promo.code, 'discount_satang', v_discount),
                    v_promo.name);

  return recalculate_visit_totals(p_visit_id);
end;
$$;

create or replace function remove_visit_promotion(p_visit_id uuid, p_promotion_id uuid)
returns visits
language plpgsql security definer set search_path = public as $$
declare
  v_visit visits;
  v_row   visit_promotions;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_visit from visits where id = p_visit_id for update;
  if not found then
    raise exception 'ไม่พบรอบการใช้บริการ' using errcode = 'no_data_found';
  end if;
  if v_visit.status not in ('open', 'awaiting_payment') then
    raise exception 'ถอดโปรโมชั่นไม่ได้: รอบนี้อยู่ในสถานะ %', v_visit.status
      using errcode = 'check_violation';
  end if;

  delete from visit_promotions
   where visit_id = p_visit_id and promotion_id = p_promotion_id
  returning * into v_row;

  if v_row.visit_id is null then
    raise exception 'ไม่พบโปรโมชั่นนี้ในบิล' using errcode = 'no_data_found';
  end if;

  update promotions set uses_count = greatest(uses_count - 1, 0) where id = p_promotion_id;

  perform log_audit('promotion.remove', 'visits', p_visit_id::text, to_jsonb(v_row), null);

  return recalculate_visit_totals(p_visit_id);
end;
$$;

create or replace function cancel_queue_ticket(p_id uuid, p_no_show boolean default false)
returns queue_tickets
language plpgsql security definer set search_path = public as $$
declare
  v_row    queue_tickets;
  v_before jsonb;
  v_grace  integer;
begin
  if not is_staff() then
    raise exception 'เฉพาะพนักงานเท่านั้น' using errcode = '42501';
  end if;

  select * into v_row from queue_tickets where id = p_id;
  if v_row.id is null then
    raise exception 'ไม่พบบัตรคิวนี้' using errcode = 'no_data_found';
  end if;
  v_before := to_jsonb(v_row);

  if p_no_show then
    if v_row.status <> 'called' then
      raise exception 'ตัดเป็นไม่มาตามเรียกได้เฉพาะคิวที่เรียกแล้ว (สถานะปัจจุบัน %)', v_row.status
        using errcode = 'check_violation';
    end if;
    select queue_grace_minutes into v_grace
      from restaurant_settings where branch_id = v_row.branch_id;
    if v_row.called_at + make_interval(mins => coalesce(v_grace, 5)) > now() then
      raise exception 'ยังไม่ครบเวลารอ % นาทีนับจากที่เรียกคิว', coalesce(v_grace, 5)
        using errcode = 'check_violation';
    end if;
  end if;

  update queue_tickets
     set status = case when p_no_show then 'no_show' else 'cancelled' end::queue_status,
         updated_at = now()
   where id = p_id and status in ('waiting', 'called')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'ยกเลิกคิวนี้ไม่ได้ (จัดโต๊ะไปแล้วหรือยกเลิกไปแล้ว)'
      using errcode = 'check_violation';
  end if;

  perform log_audit(case when p_no_show then 'queue.no_show' else 'queue.cancel' end,
                    'queue_tickets', p_id::text, v_before, to_jsonb(v_row));
  return v_row;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table menu_items;
exception when duplicate_object then null;
end $$;

revoke execute on function advance_order_item(uuid, order_status, text)  from public, anon;
revoke execute on function apply_promotion_code(uuid, text)              from public, anon;
revoke execute on function remove_visit_promotion(uuid, uuid)            from public, anon;
grant  execute on function advance_order_item(uuid, order_status, text)  to authenticated;
grant  execute on function apply_promotion_code(uuid, text)              to authenticated;
grant  execute on function remove_visit_promotion(uuid, uuid)            to authenticated;

create or replace function join_visit_with_code(
  p_table_qr_token uuid,
  p_access_code    text,
  p_nickname       text default null,
  p_user_agent     text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_table    public.tables;
  v_visit    visits;
  v_settings restaurant_settings;
  v_fails    integer;
begin
  if auth.uid() is null then
    raise exception 'ต้องเข้าสู่ระบบแบบไม่ระบุตัวตนก่อนสแกน QR' using errcode = '42501';
  end if;

  select * into v_table from tables where qr_token = p_table_qr_token;
  if not found then

    raise exception 'QR ไม่ถูกต้อง' using errcode = 'no_data_found';
  end if;

  select * into v_visit from visits
   where table_id = v_table.id and status in ('open', 'awaiting_payment')
   order by check_in_at desc limit 1;

  if not found then
    insert into visit_access_attempts (table_id, auth_user_id, succeeded)
    values (v_table.id, auth.uid(), false);
    return jsonb_build_object('ok', false,
      'error', 'โต๊ะนี้ยังไม่ได้เปิดใช้บริการ กรุณาติดต่อพนักงาน');
  end if;

  select * into v_settings from restaurant_settings where branch_id = v_visit.branch_id;

  if v_visit.access_locked_until is not null and v_visit.access_locked_until > now() then
    return jsonb_build_object('ok', false,
      'error', 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน');
  end if;

  select count(*) into v_fails
  from visit_access_attempts
  where visit_id = v_visit.id
    and not succeeded
    and attempted_at > now() - make_interval(mins => v_settings.qr_attempt_window_minutes);

  if v_fails >= v_settings.qr_max_failed_attempts then
    update visits
       set access_locked_until = now() + make_interval(mins => v_settings.qr_attempt_window_minutes)
     where id = v_visit.id;
    return jsonb_build_object('ok', false,
      'error', 'ใส่รหัสผิดหลายครั้งเกินไป กรุณาติดต่อพนักงาน');
  end if;

  if p_access_code is null or v_visit.access_code is distinct from trim(p_access_code) then
    insert into visit_access_attempts (visit_id, table_id, auth_user_id, succeeded)
    values (v_visit.id, v_table.id, auth.uid(), false);
    return jsonb_build_object('ok', false, 'error', 'รหัสเข้าโต๊ะไม่ถูกต้อง');
  end if;

  return jsonb_build_object('ok', true, 'visit',
    to_jsonb(join_visit(v_visit.session_token, null, null, p_nickname, p_user_agent)));
end;
$$;

revoke execute on function join_visit_with_code(uuid, text, text, text) from public, anon;
grant  execute on function join_visit_with_code(uuid, text, text, text) to authenticated;

drop policy if exists staff_read_settings on restaurant_settings;

create policy manager_read_settings on restaurant_settings
  for select using (is_manager());

create or replace function visit_amount_due(p_visit_id uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_due integer;
begin

  if not (is_staff() or p_visit_id = current_visit_id()) then
    raise exception 'ไม่มีสิทธิ์ดูยอดของรอบนี้' using errcode = '42501';
  end if;

  select v.total_satang - coalesce(
    (select sum(p.amount_satang) from payments p
      where p.visit_id = v.id and p.status = 'succeeded'), 0)
    into v_due
  from visits v where v.id = p_visit_id;

  return v_due;
end;
$$;

revoke execute on function visit_amount_due(uuid) from anon;
grant  execute on function visit_amount_due(uuid) to authenticated;

create or replace function visit_amount_due(p_visit_id uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_due integer;
begin

  if not coalesce(is_staff() or p_visit_id = current_visit_id(), false) then
    raise exception 'ไม่มีสิทธิ์ดูยอดของรอบนี้' using errcode = '42501';
  end if;

  select v.total_satang - coalesce(
    (select sum(p.amount_satang) from payments p
      where p.visit_id = v.id and p.status = 'succeeded'), 0)
    into v_due
  from visits v where v.id = p_visit_id;

  return v_due;
end;
$$;

revoke execute on function visit_amount_due(uuid) from public;
revoke execute on function visit_amount_due(uuid) from anon;
grant  execute on function visit_amount_due(uuid) to authenticated;

insert into branches (code, name, address, phone)
values ('main', 'Shabu Mood สาขาหลัก', '—', '—')
on conflict (code) do nothing;

insert into restaurant_settings (
  branch_id, display_name, receipt_footer,
  vat_enabled, service_charge_enabled,
  default_dining_minutes, last_order_minutes_before_end,
  points_enabled, points_baht_per_point, payment_mode
)
select id, 'Shabu Mood', 'ขอบคุณที่ใช้บริการ อิ่มอร่อยกับชาบูมู้ดนะคะ',
       false, false, 90, 15, true, 100, 'mock'
from branches where code = 'main'
on conflict (branch_id) do nothing;

insert into kitchen_stations (branch_id, code, name, sort_order)
select b.id, s.code, s.name, s.sort_order
from branches b
cross join (values
  ('meat', 'ครัวเนื้อ/หมู',     1),
  ('veg',  'ครัวผัก/ของสด',     2),
  ('fry',  'ครัวทอด',           3),
  ('bar',  'บาร์น้ำ/ของหวาน',   4)
) as s(code, name, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

insert into buffet_packages (
  branch_id, code, name, description,
  price_per_adult_satang, price_per_child_satang, child_max_age,
  dining_minutes, color, sort_order
)
select b.id, p.code, p.name, p.description,
       p.adult, p.child, p.child_age, p.minutes, p.color, p.sort_order
from branches b
cross join (values
  ('standard', 'มาตรฐาน', 'เนื้อหมู ซีฟู้ดพื้นฐาน ผัก เห็ด ลูกชิ้น ของทอด ของหวาน',
   29900, 14900, 10, 90,  '#C62828', 1),
  ('premium',  'พรีเมียม', 'ทุกอย่างในแพ็กเกจมาตรฐาน + เนื้อวากิว แซลมอน หอยเชลล์ กุ้งแม่น้ำ',
   39900, 19900, 10, 120, '#AD8B00', 2)
) as p(code, name, description, adult, child, child_age, minutes, color, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

insert into add_ons (branch_id, code, name, description, price_satang, charge_basis, sort_order)
select b.id, a.code, a.name, a.description, a.price, a.basis::addon_charge_basis, a.sort_order
from branches b
cross join (values
  ('drink_refill', 'น้ำรีฟิลไม่อั้น', 'น้ำอัดลม น้ำหวาน ชา รีฟิลได้ไม่จำกัดตลอดมื้อ',
   3900, 'per_person', 1)
) as a(code, name, description, price, basis, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

insert into menu_categories (branch_id, code, name_th, name_en, icon, sort_order)
select b.id, c.code, c.th, c.en, c.icon, c.sort_order
from branches b
cross join (values
  ('beef',      'เนื้อ',       'Beef',      '🥩', 1),
  ('pork',      'หมู',         'Pork',      '🐷', 2),
  ('seafood',   'ซีฟู้ด',      'Seafood',   '🦐', 3),
  ('vegetable', 'ผัก',         'Vegetable', '🥬', 4),
  ('mushroom',  'เห็ด',        'Mushroom',  '🍄', 5),
  ('meatball',  'ลูกชิ้น',     'Meatball',  '🍡', 6),
  ('fried',     'ของทอด',      'Fried',     '🍤', 7),
  ('noodle',    'เส้นและอื่นๆ', 'Noodle',    '🍜', 8),
  ('drink',     'เครื่องดื่ม',  'Drink',     '🥤', 9),
  ('dessert',   'ของหวาน',     'Dessert',   '🍨', 10)
) as c(code, th, en, icon, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

with data(cat, station, name_th, name_en, sort_order, is_premium, price) as (values

  ('beef','meat','เนื้อสไลด์',        'Sliced Beef',        1, false, null::integer),
  ('beef','meat','เนื้อสันคอ',        'Beef Chuck',         2, false, null),
  ('beef','meat','เนื้อใบพาย',        'Beef Blade',         3, false, null),
  ('beef','meat','เนื้อสามชั้น',      'Beef Brisket',       4, false, null),
  ('beef','meat','เนื้อริบอาย',       'Ribeye',             5, true,  null),
  ('beef','meat','เนื้อวากิว A5',     'Wagyu A5',           6, true,  null),

  ('pork','meat','หมูสไลด์',          'Sliced Pork',        1, false, null),
  ('pork','meat','หมูสามชั้น',        'Pork Belly',         2, false, null),
  ('pork','meat','หมูสันคอ',          'Pork Collar',        3, false, null),
  ('pork','meat','หมูนุ่ม',           'Tender Pork',        4, false, null),
  ('pork','meat','หมูเด้ง',           'Bouncy Pork',        5, false, null),
  ('pork','meat','เบคอน',             'Bacon',              6, false, null),

  ('seafood','meat','กุ้งขาว',        'White Shrimp',       1, false, null),
  ('seafood','meat','ปลาหมึก',        'Squid',              2, false, null),
  ('seafood','meat','หอยแมลงภู่',     'Mussel',             3, false, null),
  ('seafood','meat','ปลาดอรี่',       'Dory Fish',          4, false, null),
  ('seafood','meat','ปูอัด',          'Crab Stick',         5, false, null),
  ('seafood','meat','ปลาแซลมอน',      'Salmon',             6, true,  null),
  ('seafood','meat','หอยเชลล์',       'Scallop',            7, true,  null),
  ('seafood','meat','กุ้งแม่น้ำ',     'River Prawn',        8, true,  null),

  ('vegetable','veg','ผักกาดขาว',     'Chinese Cabbage',    1, false, null),
  ('vegetable','veg','ผักบุ้ง',       'Morning Glory',      2, false, null),
  ('vegetable','veg','คะน้า',         'Kale',               3, false, null),
  ('vegetable','veg','ข้าวโพดอ่อน',   'Baby Corn',          4, false, null),
  ('vegetable','veg','แครอท',         'Carrot',             5, false, null),
  ('vegetable','veg','ฟักทอง',        'Pumpkin',            6, false, null),
  ('vegetable','veg','ผักกาดแก้ว',    'Iceberg Lettuce',    7, false, null),
  ('vegetable','veg','ต้นหอม',        'Spring Onion',       8, false, null),

  ('mushroom','veg','เห็ดเข็มทอง',    'Enoki Mushroom',     1, false, null),
  ('mushroom','veg','เห็ดหอม',        'Shiitake',           2, false, null),
  ('mushroom','veg','เห็ดออรินจิ',    'King Oyster',        3, false, null),
  ('mushroom','veg','เห็ดนางฟ้า',     'Oyster Mushroom',    4, false, null),
  ('mushroom','veg','เห็ดฟาง',        'Straw Mushroom',     5, false, null),

  ('meatball','veg','ลูกชิ้นหมู',     'Pork Ball',          1, false, null),
  ('meatball','veg','ลูกชิ้นเนื้อ',   'Beef Ball',          2, false, null),
  ('meatball','veg','ลูกชิ้นปลา',     'Fish Ball',          3, false, null),
  ('meatball','veg','ลูกชิ้นกุ้ง',    'Shrimp Ball',        4, false, null),
  ('meatball','veg','เต้าหู้ปลา',     'Fish Tofu',          5, false, null),
  ('meatball','veg','ไส้กรอก',        'Sausage',            6, false, null),
  ('meatball','veg','เกี๊ยวกุ้ง',     'Shrimp Wonton',      7, false, null),

  ('fried','fry','เกี๊ยวทอด',         'Fried Wonton',       1, false, null),
  ('fried','fry','ปอเปี๊ยะทอด',       'Spring Roll',        2, false, null),
  ('fried','fry','ไก่ป๊อป',           'Popcorn Chicken',    3, false, null),
  ('fried','fry','เฟรนช์ฟรายส์',      'French Fries',       4, false, null),

  ('noodle','veg','วุ้นเส้น',         'Glass Noodle',       1, false, null),
  ('noodle','veg','บะหมี่',           'Egg Noodle',         2, false, null),
  ('noodle','veg','อูด้ง',            'Udon',               3, false, null),
  ('noodle','veg','เส้นราเมง',        'Ramen',              4, false, null),
  ('noodle','veg','เต้าหู้ไข่',       'Egg Tofu',           5, false, null),
  ('noodle','veg','ไข่ไก่',           'Egg',                6, false, null),
  ('noodle','veg','ข้าวสวย',          'Steamed Rice',       7, false, null),

  ('drink','bar','น้ำเปล่า',          'Water',              1, false, null),
  ('drink','bar','น้ำแดง',            'Red Soda',           2, false, null),
  ('drink','bar','น้ำเขียว',          'Green Soda',         3, false, null),
  ('drink','bar','โค้ก',              'Coke',               4, false, null),
  ('drink','bar','สไปรท์',            'Sprite',             5, false, null),
  ('drink','bar','ชาเขียว',           'Green Tea',          6, false, null),

  ('drink','bar','เบียร์สิงห์',       'Singha Beer',        7, false, 12000),
  ('drink','bar','โซดา',              'Soda',               8, false, 3000),

  ('dessert','bar','ไอศกรีมวานิลลา',  'Vanilla Ice Cream',  1, false, null),
  ('dessert','bar','ไอศกรีมช็อกโกแลต','Chocolate Ice Cream',2, false, null),
  ('dessert','bar','ไอศกรีมชาเขียว',  'Green Tea Ice Cream',3, false, null),
  ('dessert','bar','บัวลอย',          'Bua Loy',            4, false, null),
  ('dessert','bar','วุ้นกะทิ',        'Coconut Jelly',      5, false, null)
)
insert into menu_items (
  branch_id, category_id, station_id, name_th, name_en,
  is_included_in_buffet, a_la_carte_price_satang, sort_order, tags
)
select b.id, mc.id, ks.id, d.name_th, d.name_en,
       d.price is null,
       d.price,
       d.sort_order,
       case when d.is_premium then array['premium'] else '{}'::text[] end
from data d
join branches b on b.code = 'main'
join menu_categories  mc on mc.branch_id = b.id and mc.code = d.cat
join kitchen_stations ks on ks.branch_id = b.id and ks.code = d.station
where not exists (
  select 1 from menu_items mi
  where mi.branch_id = b.id and mi.category_id = mc.id and mi.name_th = d.name_th
);

insert into menu_item_packages (menu_item_id, package_id)
select mi.id, bp.id
from menu_items mi
join branches b        on b.id = mi.branch_id and b.code = 'main'
join buffet_packages bp on bp.branch_id = b.id and bp.code = 'premium'
where 'premium' = any(mi.tags)
on conflict do nothing;

insert into zones (branch_id, code, name, sort_order)
select b.id, z.code, z.name, z.sort_order
from branches b
cross join (values
  ('A', 'โซน A (ริมหน้าต่าง)', 1),
  ('B', 'โซน B (กลางร้าน)',    2),
  ('C', 'โซน C (ห้องแอร์)',    3)
) as z(code, name, sort_order)
where b.code = 'main'
on conflict (branch_id, code) do nothing;

insert into tables (branch_id, zone_id, table_number, capacity, position_x, position_y)
select b.id, z.id, t.number, t.capacity, t.x, t.y
from branches b
join zones z on z.branch_id = b.id
cross join lateral (values
  (z.code || '1', case when z.code = 'C' then 6 else 4 end, 1.0, 1.0),
  (z.code || '2', case when z.code = 'C' then 6 else 4 end, 2.0, 1.0),
  (z.code || '3', case when z.code = 'C' then 6 else 4 end, 1.0, 2.0),
  (z.code || '4', case when z.code = 'C' then 6 else 4 end, 2.0, 2.0)
) as t(number, capacity, x, y)
where b.code = 'main'
on conflict (branch_id, table_number) do nothing;

insert into promotions (
  branch_id, code, name, description, type, scope,
  value_bp, min_spend_satang, days_of_week, time_start, time_end
)
select b.id, 'LUNCH10', 'ลดมื้อกลางวัน 10%',
       'ลด 10% สำหรับลูกค้าที่เข้าร้านวันจันทร์–ศุกร์ ก่อน 16:00 น.',
       'percent'::promotion_type, 'bill'::promotion_scope,
       1000, 0, array[1,2,3,4,5]::smallint[], '11:00'::time, '16:00'::time
from branches b where b.code = 'main'
on conflict (branch_id, code) do nothing;

do $$
declare
  v_menu    integer;
  v_premium integer;
  v_tables  integer;
begin
  select count(*) into v_menu    from menu_items;
  select count(*) into v_premium from menu_item_packages;
  select count(*) into v_tables  from tables;

  raise notice 'seed เสร็จแล้ว: เมนู % รายการ / ล็อกพรีเมียม % รายการ / โต๊ะ % โต๊ะ',
    v_menu, v_premium, v_tables;
end $$;

create or replace function bootstrap_staff_profile(
  p_email     text,
  p_full_name text,
  p_role      staff_role,
  p_branch_code text default 'main'
)
returns profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_branch  uuid;
  v_profile profiles;
begin
  select id into v_user_id from auth.users where email = lower(trim(p_email));
  if v_user_id is null then
    raise exception
      'ยังไม่มีผู้ใช้อีเมล % ใน auth.users — สร้างผู้ใช้ก่อนแล้วค่อยรันสคริปต์นี้', p_email
      using errcode = 'no_data_found';
  end if;

  select id into v_branch from branches where code = p_branch_code;
  if v_branch is null then
    raise exception 'ไม่พบสาขารหัส % — รัน seed.sql ก่อน', p_branch_code
      using errcode = 'no_data_found';
  end if;

  insert into profiles (id, branch_id, full_name, role)
  values (v_user_id, v_branch, p_full_name, p_role)
  on conflict (id) do update
    set full_name = excluded.full_name,
        role      = excluded.role,
        branch_id = excluded.branch_id,
        is_active = true
  returning * into v_profile;

  raise notice 'ผูกบัญชี % เป็น % เรียบร้อย', p_email, p_role;
  return v_profile;
end;
$$;

revoke execute on function bootstrap_staff_profile(text, text, staff_role, text)
  from authenticated, anon;

begin;

do $$
declare
  v_uid    uuid := '00000000-0000-0000-0000-0000000000aa';
  v_cust   uuid := '00000000-0000-0000-0000-0000000000bb';
  v_branch uuid;
  v_table  uuid;
  v_pkg    uuid;
  v_visit  visits;
  v_tok    uuid;
  v_item   uuid;
  v_pay    payments;
  v_cnt    integer;
  v_exp    integer;
begin

  select id into v_branch from branches limit 1;
  if v_branch is null then
    raise exception '❌ ไม่มีข้อมูลใน branches — ยังไม่ได้รัน seed.sql';
  end if;

  begin
    insert into auth.users(id) values (v_uid)  on conflict do nothing;
    insert into auth.users(id) values (v_cust) on conflict do nothing;
  exception when insufficient_privilege then
    raise exception 'ต้องรันไฟล์นี้จาก Supabase Dashboard → SQL Editor (ต้องมีสิทธิ์เขียน auth.users)';
  end;

  insert into profiles(id, branch_id, full_name, role)
  values (v_uid, v_branch, 'บัญชีทดสอบ verify.sql', 'owner')
  on conflict (id) do update set role = 'owner', is_active = true;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);

  if not is_staff() then raise exception '❌ is_staff() ไม่ทำงาน'; end if;
  raise notice '✅ helper สิทธิ์ (is_staff / is_manager / current_staff_branch)';

  select id into v_table from tables where branch_id = v_branch and status = 'available'
   order by table_number limit 1;
  select id into v_pkg from buffet_packages where branch_id = v_branch and is_active
   order by price_per_adult_satang limit 1;
  if v_table is null then raise exception '❌ ไม่มีโต๊ะว่าง'; end if;
  if v_pkg   is null then raise exception '❌ ไม่มีแพ็กเกจบุฟเฟต์'; end if;

  v_visit := open_visit(v_table, v_pkg, 3, 1);
  v_tok   := v_visit.session_token;
  raise notice '✅ เปิดโต๊ะ % (ผู้ใหญ่ 3 เด็ก 1)', v_visit.visit_code;

  if (select status from tables where id = v_table) <> 'occupied' then
    raise exception '❌ โต๊ะไม่เปลี่ยนเป็น occupied';
  end if;
  raise notice '✅ โต๊ะเปลี่ยนสถานะเป็น occupied อัตโนมัติ';

  begin
    perform open_visit(v_table, v_pkg, 2, 0);
    raise exception '❌ เปิดโต๊ะที่ไม่ว่างซ้ำได้';
  exception when check_violation then
    raise notice '✅ กันเปิดโต๊ะซ้ำ';
  end;

  perform set_config('request.jwt.claim.sub', v_cust::text, true);
  v_visit := join_visit(p_session_token := v_tok, p_nickname := 'ลูกค้าทดสอบ');
  if current_visit_id() is distinct from v_visit.id then
    raise exception '❌ current_visit_id() ไม่ผูกกับ visit ที่ join';
  end if;
  raise notice '✅ ลูกค้าสแกน QR เข้า visit ได้';

  perform place_order(
    v_visit.id,
    (select jsonb_agg(jsonb_build_object('menu_item_id', id, 'quantity', 2))
       from (select id from menu_items where is_available and branch_id = v_branch limit 3) s),
    'ทดสอบจากมือถือลูกค้า');
  raise notice '✅ ลูกค้าสั่งอาหารผ่าน QR ได้ (จุดที่เคยพังเพราะ FK ของ order_status_history)';

  select count(*) into v_cnt
  from order_status_history h
  join order_items oi on oi.id = h.order_item_id
  join orders o on o.id = oi.order_id
  where o.visit_id = v_visit.id;
  if v_cnt = 0 then raise exception '❌ ไม่มีการบันทึก order_status_history'; end if;
  raise notice '✅ บันทึกประวัติสถานะ % แถว (changed_by = null เพราะผู้สั่งคือลูกค้า)', v_cnt;

  begin
    perform place_order(
      (select id from visits where id <> v_visit.id and status in ('open','awaiting_payment') limit 1),
      '[]'::jsonb, null);
    raise exception '❌ สั่งอาหารเข้าโต๊ะคนอื่นได้';
  exception
    when insufficient_privilege then raise notice '✅ กันสั่งข้ามโต๊ะ';
    when no_data_found          then raise notice '✅ กันสั่งข้ามโต๊ะ (ไม่มีโต๊ะอื่นเปิดอยู่)';
  end;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  select oi.id into v_item from order_items oi
   join orders o on o.id = oi.order_id where o.visit_id = v_visit.id limit 1;

  perform advance_order_item(v_item, 'preparing');
  perform advance_order_item(v_item, 'ready');
  perform advance_order_item(v_item, 'served');
  raise notice '✅ ครัวเดินสถานะ pending → preparing → ready → served';

  begin
    perform advance_order_item(v_item, 'pending');
    raise exception '❌ ถอยสถานะข้ามขั้นได้';
  exception when check_violation then
    raise notice '✅ กันถอยสถานะข้ามขั้น';
  end;

  begin
    perform create_payment(v_visit.id, 'cash', 100, 100, null, null);
    raise exception '❌ จ่ายเงินได้ทั้งที่ยังไม่เช็คบิล';
  exception when check_violation or invalid_parameter_value then
    raise notice '✅ กันจ่ายเงินก่อนเช็คบิล';
  end;

  v_visit := request_visit_bill(v_visit.id);

  v_exp := 3 * v_visit.package_price_adult_satang + 1 * v_visit.package_price_child_satang;
  if v_visit.subtotal_satang <> v_exp then
    raise exception '❌ subtotal ผิด: ได้ % ควรได้ %', v_visit.subtotal_satang, v_exp;
  end if;
  raise notice '✅ ยอดบุฟเฟต์คิดต่อคนถูกต้อง: % บาท (สั่งอาหารแล้วยอดไม่ขยับ)',
               v_visit.subtotal_satang / 100.0;
  raise notice '   subtotal % / service % / vat % / รวม % บาท',
    v_visit.subtotal_satang/100.0, v_visit.service_charge_satang/100.0,
    v_visit.vat_satang/100.0, v_visit.total_satang/100.0;

  begin
    perform create_payment(v_visit.id, 'cash', v_visit.total_satang + 100000,
                           v_visit.total_satang + 100000, null, null);
    raise exception '❌ จ่ายเกินยอดได้';
  exception when check_violation or invalid_parameter_value then
    raise notice '✅ กันรับชำระเกินยอด';
  end;

  v_pay := create_payment(v_visit.id, 'cash', v_visit.total_satang,
                          v_visit.total_satang + 5000, null, null);
  if v_pay.change_satang <> 5000 then
    raise exception '❌ คำนวณเงินทอนผิด: ได้ %', v_pay.change_satang;
  end if;
  raise notice '✅ คำนวณเงินทอนถูกต้อง (% บาท)', v_pay.change_satang/100.0;

  v_pay := confirm_payment(v_pay.id, 'VERIFY-TEST', null);
  if visit_amount_due(v_visit.id) <> 0 then
    raise exception '❌ ยังค้างชำระหลังจ่ายครบ';
  end if;
  raise notice '✅ ยืนยันการชำระเงิน ยอดค้าง 0';

  v_visit := close_visit(v_visit.id);
  if v_visit.status <> 'closed' then raise exception '❌ ปิด visit ไม่สำเร็จ'; end if;
  if (select status from tables where id = v_table) <> 'cleaning' then
    raise exception '❌ โต๊ะไม่เปลี่ยนเป็น cleaning หลังปิดบิล';
  end if;
  raise notice '✅ ปิดบิลแล้วโต๊ะเปลี่ยนเป็น cleaning อัตโนมัติ';

  perform set_config('request.jwt.claim.sub', v_cust::text, true);
  begin
    perform place_order(v_visit.id, '[]'::jsonb, null);
    raise exception '❌ visit ปิดแล้วยังสั่งอาหารได้';
  exception when insufficient_privilege then
    raise notice '✅ visit ปิดแล้วสั่งอาหารไม่ได้';
  end;

  begin
    perform join_visit(p_session_token := v_tok);
    raise exception '❌ QR เดิมยังใช้เข้าโต๊ะได้';
  exception when others then
    raise notice '✅ QR เดิมใช้ไม่ได้แล้ว';
  end;

  raise notice '';
  raise notice '═══ ผ่านทั้งหมด ═══';
end $$;

do $$
declare v_leak text;
begin
  select string_agg(column_name, ', ') into v_leak
  from information_schema.columns
  where table_name = 'public_settings'
    and column_name in ('promptpay_id', 'tax_id', 'legal_name');

  if v_leak is not null then
    raise exception '❌ public_settings เผยคอลัมน์ลับ: %', v_leak;
  end if;
  raise notice '✅ public_settings ไม่เผย promptpay_id / tax_id / legal_name';
end $$;

select 'ตาราง'            as รายการ, count(*)::text as จำนวน from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'ตารางที่เปิด RLS', count(*)::text from pg_class
  where relrowsecurity and relnamespace = 'public'::regnamespace
union all
select 'RLS policy', count(*)::text from pg_policy
union all
select 'ตารางที่เปิด Realtime', count(*)::text from pg_publication_tables
  where pubname = 'supabase_realtime';

rollback;
