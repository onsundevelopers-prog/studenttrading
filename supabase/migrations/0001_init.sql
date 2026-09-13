-- ===========================================================================
-- PaperDesk — Classroom Trading Simulator
-- Migration 0001: schema, constraints, row level security, trading engine
-- ---------------------------------------------------------------------------
-- Run this ONCE in the Supabase SQL Editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). It is written to be re-runnable: it drops and
-- recreates its own functions/types/policies before creating them again.
--
-- Design rules enforced here:
--   * Money is ALWAYS numeric, never float8. Cash numeric(18,4),
--     price numeric(18,6), quantity numeric(24,8).
--   * The database is authoritative. Portfolio value, cash, ownership and
--     profit/loss are computed in SQL, never in React.
--   * Clients have NO write access to any financial table. Every mutation goes
--     through a SECURITY DEFINER function that re-validates its inputs.
--   * This is a SIMULATION. No real money, orders, wallets or custody exist
--     anywhere in this schema.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. Teardown (safe to re-run)
-- ---------------------------------------------------------------------------
drop function if exists public.get_trade_history(uuid, uuid, integer) cascade;
drop function if exists public.get_competition_standings(uuid) cascade;
drop function if exists public.create_competition(uuid, text, text, timestamptz, timestamptz, uuid) cascade;
drop function if exists public.capture_snapshots(uuid) cascade;
drop function if exists public.reset_classroom(uuid, numeric, uuid) cascade;
drop function if exists public.reset_student_portfolio(uuid, uuid, numeric, uuid) cascade;
drop function if exists public.adjust_cash(uuid, uuid, numeric, text, uuid) cascade;
drop function if exists public.get_class_overview(uuid) cascade;
drop function if exists public.get_leaderboard(uuid) cascade;
drop function if exists public.get_portfolio(uuid, uuid) cascade;
drop function if exists public.execute_trade(uuid, uuid, text, text, text, text, uuid) cascade;
drop function if exists public._portfolio_numbers(uuid, uuid) cascade;
drop function if exists public.is_classroom_member(uuid) cascade;
drop function if exists public.is_classroom_teacher(uuid) cascade;
drop function if exists public.upsert_asset(text, text, text, text, text, text) cascade;
drop type if exists public.portfolio_numbers cascade;
drop function if exists public.handle_new_user() cascade;

-- ---------------------------------------------------------------------------
-- 1. Core tables
-- ---------------------------------------------------------------------------

-- profiles: 1:1 with auth.users. `role` is descriptive only — authorisation is
-- always derived from actual ownership rows (classrooms.teacher_id,
-- class_members.student_id), never from a client-supplied role.
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         text not null default 'student' check (role in ('teacher', 'student')),
  full_name    text not null default '',
  login_handle text,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_login_handle_format
    check (login_handle is null or login_handle ~ '^[a-z0-9][a-z0-9._-]{1,31}$')
);

create unique index if not exists profiles_login_handle_key
  on public.profiles (login_handle) where login_handle is not null;

create table if not exists public.classrooms (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 80),
  section     text,
  join_code   text not null unique check (join_code ~ '^[A-Z0-9]{4,10}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists classrooms_teacher_idx on public.classrooms (teacher_id);

-- 1:1 settings row per classroom.
create table if not exists public.class_settings (
  classroom_id          uuid primary key references public.classrooms(id) on delete cascade,
  trading_enabled       boolean not null default true,
  paused_reason         text,
  trading_opens_at      timestamptz,
  trading_closes_at     timestamptz,
  asset_policy          text not null default 'all' check (asset_policy in ('all', 'allowlist')),
  -- Applied to a student when the teacher adds them, and used as the default for
  -- a whole-class reset. Zero by design: a student has money only because a
  -- teacher explicitly granted it. Never a fabricated balance.
  default_starting_capital numeric(18,4) not null default 0
    check (default_starting_capital >= 0),
  max_trade_value       numeric(18,4) check (max_trade_value is null or max_trade_value > 0),
  max_position_percent  numeric(5,2) check (
                          max_position_percent is null
                          or (max_position_percent > 0 and max_position_percent <= 100)
                        ),
  allow_fractional      boolean not null default true,
  updated_at            timestamptz not null default now()
);

create table if not exists public.class_members (
  id              uuid primary key default gen_random_uuid(),
  classroom_id    uuid not null references public.classrooms(id) on delete cascade,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  display_name    text not null default '',
  external_id     text,                       -- school-issued student id, display only
  cash_balance    numeric(18,4) not null default 0 check (cash_balance >= 0),
  initial_capital numeric(18,4) not null default 0 check (initial_capital >= 0),
  status          text not null default 'active' check (status in ('active', 'removed')),
  joined_at       timestamptz not null default now(),
  unique (classroom_id, student_id)
);

create index if not exists class_members_student_idx on public.class_members (student_id);
create index if not exists class_members_class_idx
  on public.class_members (classroom_id) where status = 'active';

-- Market reference data. `symbol` is the provider symbol (e.g. AAPL,
-- BINANCE:BTCUSDT); `display_symbol` is what a student should read.
create table if not exists public.assets (
  id             uuid primary key default gen_random_uuid(),
  symbol         text not null unique,
  display_symbol text not null,
  name           text not null default '',
  asset_type     text not null check (asset_type in ('stock', 'crypto')),
  exchange       text,
  currency       text not null default 'USD',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists assets_type_idx on public.assets (asset_type) where is_active;

create table if not exists public.classroom_assets (
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  asset_id     uuid not null references public.assets(id) on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (classroom_id, asset_id)
);

create table if not exists public.holdings (
  id            uuid primary key default gen_random_uuid(),
  classroom_id  uuid not null references public.classrooms(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  asset_id      uuid not null references public.assets(id) on delete restrict,
  quantity      numeric(24,8) not null default 0 check (quantity >= 0),
  avg_cost      numeric(18,6) not null default 0 check (avg_cost >= 0),
  realized_pnl  numeric(18,4) not null default 0,
  updated_at    timestamptz not null default now(),
  unique (classroom_id, student_id, asset_id)
);

create index if not exists holdings_student_idx on public.holdings (classroom_id, student_id);

-- orders = the intent + audit trail (filled OR rejected).
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  classroom_id    uuid not null references public.classrooms(id) on delete cascade,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  asset_id        uuid not null references public.assets(id) on delete restrict,
  side            text not null check (side in ('buy', 'sell')),
  quantity        numeric(24,8) not null check (quantity > 0),
  price           numeric(18,6) not null check (price > 0),
  total_value     numeric(18,4) not null check (total_value > 0),
  status          text not null default 'filled' check (status in ('filled', 'rejected')),
  reject_reason   text,
  idempotency_key text,
  created_at      timestamptz not null default now()
);

create index if not exists orders_class_time_idx on public.orders (classroom_id, created_at desc);
create index if not exists orders_student_time_idx on public.orders (student_id, created_at desc);
create unique index if not exists orders_idempotency_key
  on public.orders (student_id, idempotency_key) where idempotency_key is not null;

-- transactions = the immutable ledger of executed trades.
create table if not exists public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  classroom_id        uuid not null references public.classrooms(id) on delete cascade,
  student_id          uuid not null references public.profiles(id) on delete cascade,
  asset_id            uuid not null references public.assets(id) on delete restrict,
  side                text not null check (side in ('buy', 'sell')),
  quantity            numeric(24,8) not null check (quantity > 0),
  price               numeric(18,6) not null check (price > 0),
  total_value         numeric(18,4) not null check (total_value > 0),
  realized_pnl        numeric(18,4),
  cash_balance_after  numeric(18,4) not null,
  created_at          timestamptz not null default now()
);

create index if not exists transactions_student_idx
  on public.transactions (classroom_id, student_id, created_at desc);
create index if not exists transactions_class_idx
  on public.transactions (classroom_id, created_at desc);

create table if not exists public.watchlists (
  id           uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,
  name         text not null default 'Watchlist' check (length(trim(name)) between 1 and 40),
  created_at   timestamptz not null default now()
);

create index if not exists watchlists_student_idx on public.watchlists (classroom_id, student_id);

create table if not exists public.watchlist_items (
  id           uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  asset_id     uuid not null references public.assets(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (watchlist_id, asset_id)
);

create table if not exists public.competitions (
  id           uuid primary key default gen_random_uuid(),
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  description  text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint competitions_window_valid check (ends_at > starts_at)
);

create index if not exists competitions_class_idx on public.competitions (classroom_id, starts_at desc);

create table if not exists public.competition_entries (
  id            uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  opening_value numeric(18,4) not null default 0,
  joined_at     timestamptz not null default now(),
  unique (competition_id, student_id)
);

-- Snapshots are the only source of historical portfolio value. There is no
-- invented data: a chart with one point honestly shows one point.
create table if not exists public.portfolio_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  classroom_id          uuid not null references public.classrooms(id) on delete cascade,
  student_id            uuid not null references public.profiles(id) on delete cascade,
  cash_balance          numeric(18,4) not null,
  holdings_market_value numeric(18,4) not null,
  total_value           numeric(18,4) not null,
  total_pnl             numeric(18,4) not null,
  captured_at           timestamptz not null default now()
);

create index if not exists portfolio_snapshots_student_idx
  on public.portfolio_snapshots (classroom_id, student_id, captured_at desc);

-- Sampled market prices. Finnhub's free tier does not expose historical
-- candles, so price history is accumulated by sampling /quote over time.
create table if not exists public.price_history (
  id          bigserial primary key,
  asset_id    uuid not null references public.assets(id) on delete cascade,
  price       numeric(18,6) not null check (price > 0),
  captured_at timestamptz not null default now()
);

create index if not exists price_history_asset_time_idx
  on public.price_history (asset_id, captured_at desc);

-- Server-side quote cache, keyed by provider symbol. Doubles as the price the
-- database marks portfolios against, and as the write throttle for Finnhub.
create table if not exists public.price_cache (
  symbol        text primary key,
  price         numeric(18,6) not null check (price > 0),
  previous_close numeric(18,6),
  change        numeric(18,6),
  change_percent numeric(12,6),
  day_high      numeric(18,6),
  day_low       numeric(18,6),
  day_open      numeric(18,6),
  provider_time timestamptz,
  fetched_at    timestamptz not null default now(),
  last_error    text,
  error_at      timestamptz
);

create table if not exists public.audit_log (
  id           bigserial primary key,
  classroom_id uuid references public.classrooms(id) on delete cascade,
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  target_type  text,
  target_id    uuid,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_class_idx on public.audit_log (classroom_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. New-user trigger — guarantees every auth user has a profile row
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, login_handle, email)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'teacher' then 'teacher' else 'student' end,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(lower(trim(coalesce(new.raw_user_meta_data ->> 'login_handle', ''))), ''),
    nullif(lower(trim(coalesce(new.email, ''))), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
--    Default deny. Reads are scoped to "my own data, or a class I teach".
--    There are deliberately NO insert/update/delete policies on financial
--    tables: the only writer is the SECURITY DEFINER engine in section 6.
-- ---------------------------------------------------------------------------
-- Helpers used by the policies below. They are SECURITY DEFINER so that a
-- policy on class_members can inspect classrooms without recursing into
-- classrooms' own policies.
create or replace function public.is_classroom_teacher(p_classroom_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.classrooms c
    where c.id = p_classroom_id
      and c.teacher_id = auth.uid()
  );
$$;

create or replace function public.is_classroom_member(p_classroom_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.class_members m
    where m.classroom_id = p_classroom_id
      and m.student_id = auth.uid()
      and m.status = 'active'
  );
$$;

alter table public.profiles            enable row level security;
alter table public.classrooms          enable row level security;
alter table public.class_settings      enable row level security;
alter table public.class_members       enable row level security;
alter table public.assets              enable row level security;
alter table public.classroom_assets    enable row level security;
alter table public.holdings            enable row level security;
alter table public.orders              enable row level security;
alter table public.transactions        enable row level security;
alter table public.watchlists          enable row level security;
alter table public.watchlist_items     enable row level security;
alter table public.competitions        enable row level security;
alter table public.competition_entries enable row level security;
alter table public.portfolio_snapshots enable row level security;
alter table public.price_history       enable row level security;
alter table public.price_cache         enable row level security;
alter table public.audit_log           enable row level security;

-- Re-runnable policy creation
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_select_classmates on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists classrooms_select on public.classrooms;
drop policy if exists classrooms_insert_own on public.classrooms;
drop policy if exists classrooms_update_own on public.classrooms;
drop policy if exists class_settings_select on public.class_settings;
drop policy if exists class_settings_update_own on public.class_settings;
drop policy if exists class_members_select on public.class_members;
drop policy if exists assets_select on public.assets;
drop policy if exists classroom_assets_select on public.classroom_assets;
drop policy if exists holdings_select on public.holdings;
drop policy if exists orders_select on public.orders;
drop policy if exists transactions_select on public.transactions;
drop policy if exists watchlists_select on public.watchlists;
drop policy if exists watchlist_items_select on public.watchlist_items;
drop policy if exists competitions_select on public.competitions;
drop policy if exists competition_entries_select on public.competition_entries;
drop policy if exists portfolio_snapshots_select on public.portfolio_snapshots;
drop policy if exists price_history_select on public.price_history;
drop policy if exists price_cache_select on public.price_cache;
drop policy if exists audit_log_select on public.audit_log;

-- profiles
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

-- A teacher can read the profile of every student in a class they own.
create policy profiles_select_classmates on public.profiles
  for select to authenticated using (
    exists (
      select 1
      from public.class_members m
      join public.classrooms c on c.id = m.classroom_id
      where m.student_id = public.profiles.id
        and c.teacher_id = auth.uid()
    )
  );

-- Deliberately no UPDATE policy on profiles: a client must not be able to
-- rewrite its own `role`. Profile edits go through server actions instead.

-- classrooms
create policy classrooms_select on public.classrooms
  for select to authenticated using (
    teacher_id = auth.uid() or public.is_classroom_member(id)
  );

create policy classrooms_insert_own on public.classrooms
  for insert to authenticated with check (teacher_id = auth.uid());

create policy classrooms_update_own on public.classrooms
  for update to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- class_settings
create policy class_settings_select on public.class_settings
  for select to authenticated using (
    public.is_classroom_teacher(classroom_id) or public.is_classroom_member(classroom_id)
  );

create policy class_settings_update_own on public.class_settings
  for update to authenticated
  using (public.is_classroom_teacher(classroom_id))
  with check (public.is_classroom_teacher(classroom_id));

-- class_members: a student sees only their own membership row.
create policy class_members_select on public.class_members
  for select to authenticated using (
    student_id = auth.uid() or public.is_classroom_teacher(classroom_id)
  );

-- market reference data is readable by any signed-in user
create policy assets_select on public.assets
  for select to authenticated using (true);

create policy classroom_assets_select on public.classroom_assets
  for select to authenticated using (
    public.is_classroom_teacher(classroom_id) or public.is_classroom_member(classroom_id)
  );

-- Financial tables: own rows, or a class I teach.
create policy holdings_select on public.holdings
  for select to authenticated using (
    student_id = auth.uid() or public.is_classroom_teacher(classroom_id)
  );

create policy orders_select on public.orders
  for select to authenticated using (
    student_id = auth.uid() or public.is_classroom_teacher(classroom_id)
  );

create policy transactions_select on public.transactions
  for select to authenticated using (
    student_id = auth.uid() or public.is_classroom_teacher(classroom_id)
  );

create policy watchlists_select on public.watchlists
  for select to authenticated using (student_id = auth.uid());

create policy watchlist_items_select on public.watchlist_items
  for select to authenticated using (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_items.watchlist_id and w.student_id = auth.uid()
    )
  );

create policy competitions_select on public.competitions
  for select to authenticated using (
    public.is_classroom_teacher(classroom_id) or public.is_classroom_member(classroom_id)
  );

create policy competition_entries_select on public.competition_entries
  for select to authenticated using (
    student_id = auth.uid()
    or exists (
      select 1 from public.competitions c
      where c.id = competition_entries.competition_id
        and public.is_classroom_teacher(c.classroom_id)
    )
    or exists (
      select 1 from public.competitions c
      where c.id = competition_entries.competition_id
        and public.is_classroom_member(c.classroom_id)
    )
  );

create policy portfolio_snapshots_select on public.portfolio_snapshots
  for select to authenticated using (
    student_id = auth.uid() or public.is_classroom_teacher(classroom_id)
  );

create policy price_history_select on public.price_history
  for select to authenticated using (true);

create policy price_cache_select on public.price_cache
  for select to authenticated using (true);

create policy audit_log_select on public.audit_log
  for select to authenticated using (public.is_classroom_teacher(classroom_id));

-- ---------------------------------------------------------------------------
-- 5. Portfolio model
-- ---------------------------------------------------------------------------
create type public.portfolio_numbers as (
  -- Explicit membership flag. Callers must branch on this rather than testing
  -- the composite for NULL: `some_composite IS NOT NULL` does not reliably mean
  -- "the function returned a row", which silently skipped members during
  -- snapshotting.
  is_member             boolean,
  cash_balance          numeric,
  initial_capital       numeric,
  holdings_market_value numeric,
  total_value           numeric,
  total_pnl             numeric,
  realized_pnl          numeric,
  unrealized_pnl        numeric,
  trade_count           integer,
  last_trade_at         timestamptz,
  prices_incomplete     boolean
);

-- The single source of truth for "what is this student worth".
-- Marks holdings at the newest cached market price. When a price is missing the
-- cost basis is used AND `prices_incomplete` is raised so the UI can say so
-- instead of quietly showing a wrong number.
create or replace function public._portfolio_numbers(
  p_classroom_id uuid,
  p_student_id   uuid
)
returns public.portfolio_numbers
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out public.portfolio_numbers;
begin
  v_out.is_member := false;

  select
    coalesce(sum(h.quantity * coalesce(pc.price, h.avg_cost)), 0),
    coalesce(sum((coalesce(pc.price, h.avg_cost) - h.avg_cost) * h.quantity), 0),
    coalesce(bool_or(pc.price is null and h.quantity > 0), false)
  into v_out.holdings_market_value, v_out.unrealized_pnl, v_out.prices_incomplete
  from public.holdings h
  left join public.assets a on a.id = h.asset_id
  left join public.price_cache pc on pc.symbol = a.symbol
  where h.classroom_id = p_classroom_id
    and h.student_id = p_student_id
    and h.quantity > 0;

  select
    coalesce(sum(h.realized_pnl), 0)
  into v_out.realized_pnl
  from public.holdings h
  where h.classroom_id = p_classroom_id
    and h.student_id = p_student_id;

  select
    m.cash_balance,
    m.initial_capital
  into v_out.cash_balance, v_out.initial_capital
  from public.class_members m
  where m.classroom_id = p_classroom_id
    and m.student_id = p_student_id
    and m.status = 'active';

  if v_out.cash_balance is null then
    -- Not an active member of this classroom. Return a well-formed row with
    -- is_member = false rather than NULL, so callers can branch predictably.
    v_out.cash_balance          := 0;
    v_out.initial_capital       := 0;
    v_out.holdings_market_value := 0;
    v_out.unrealized_pnl        := 0;
    v_out.realized_pnl          := 0;
    v_out.total_value           := 0;
    v_out.total_pnl             := 0;
    v_out.trade_count           := 0;
    v_out.prices_incomplete     := false;
    return v_out;
  end if;

  v_out.is_member := true;

  v_out.holdings_market_value := round(v_out.holdings_market_value, 4);
  v_out.unrealized_pnl        := round(v_out.unrealized_pnl, 4);
  v_out.realized_pnl          := round(v_out.realized_pnl, 4);
  v_out.total_value           := round(v_out.cash_balance + v_out.holdings_market_value, 4);
  v_out.total_pnl             := round(v_out.total_value - v_out.initial_capital, 4);

  select count(*), max(t.created_at)
  into v_out.trade_count, v_out.last_trade_at
  from public.transactions t
  where t.classroom_id = p_classroom_id
    and t.student_id = p_student_id;

  return v_out;
end;
$$;

-- Full portfolio payload for a student dashboard. All numerics are rendered as
-- text so no precision is lost crossing the JS boundary.
create or replace function public.get_portfolio(
  p_classroom_id uuid,
  p_student_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_numbers public.portfolio_numbers;
  v_holdings jsonb;
  v_today_basis numeric;
  v_today_basis_at timestamptz;
  v_basis_kind text;
begin
  v_numbers := public._portfolio_numbers(p_classroom_id, p_student_id);
  if not v_numbers.is_member then
    return null;
  end if;

  select coalesce(jsonb_agg(x order by x->>'market_value_sort' desc), '[]'::jsonb)
  into v_holdings
  from (
    select jsonb_build_object(
      'asset_id',          a.id,
      'symbol',            a.symbol,
      'display_symbol',    a.display_symbol,
      'name',              a.name,
      'asset_type',        a.asset_type,
      'quantity',          h.quantity::text,
      'avg_cost',          h.avg_cost::text,
      'last_price',        coalesce(pc.price, h.avg_cost)::text,
      'price_stale',       pc.price is null,
      'price_updated_at',  pc.fetched_at,
      'cost_basis',        round(h.quantity * h.avg_cost, 4)::text,
      'market_value',      round(h.quantity * coalesce(pc.price, h.avg_cost), 4)::text,
      'unrealized_pnl',    round((coalesce(pc.price, h.avg_cost) - h.avg_cost) * h.quantity, 4)::text,
      'unrealized_pnl_pct', case
                              when h.avg_cost > 0
                              then round(((coalesce(pc.price, h.avg_cost) - h.avg_cost) / h.avg_cost) * 100, 2)::text
                              else '0'
                            end,
      'realized_pnl',      h.realized_pnl::text,
      'market_value_sort', round(h.quantity * coalesce(pc.price, h.avg_cost), 4)
    ) as x
    from public.holdings h
    join public.assets a on a.id = h.asset_id
    left join public.price_cache pc on pc.symbol = a.symbol
    where h.classroom_id = p_classroom_id
      and h.student_id = p_student_id
      and h.quantity > 0
  ) s;

  -- "Today's P/L" needs a baseline. We use the newest snapshot at or before the
  -- start of today (i.e. yesterday's close). If none exists we say so rather
  -- than invent a number.
  select ps.total_value, ps.captured_at
  into v_today_basis, v_today_basis_at
  from public.portfolio_snapshots ps
  where ps.classroom_id = p_classroom_id
    and ps.student_id = p_student_id
    and ps.captured_at <= date_trunc('day', now())
  order by ps.captured_at desc
  limit 1;

  if v_today_basis is not null then
    v_basis_kind := 'prior_close';
  else
    -- No baseline before today. Fall back to the earliest snapshot we do have,
    -- and only claim a baseline if one was actually found.
    select ps.total_value, ps.captured_at
    into v_today_basis, v_today_basis_at
    from public.portfolio_snapshots ps
    where ps.classroom_id = p_classroom_id
      and ps.student_id = p_student_id
    order by ps.captured_at asc
    limit 1;

    if v_today_basis is not null then
      v_basis_kind := 'first_snapshot';
    end if;
  end if;

  return jsonb_build_object(
    'student_id',            p_student_id,
    'classroom_id',          p_classroom_id,
    'cash_balance',          v_numbers.cash_balance::text,
    'initial_capital',       v_numbers.initial_capital::text,
    'holdings_market_value', v_numbers.holdings_market_value::text,
    'total_value',           v_numbers.total_value::text,
    'total_pnl',             v_numbers.total_pnl::text,
    'total_pnl_percent',     case
                               when v_numbers.initial_capital > 0
                               then round((v_numbers.total_pnl / v_numbers.initial_capital) * 100, 4)::text
                               else '0'
                             end,
    'realized_pnl',          v_numbers.realized_pnl::text,
    'unrealized_pnl',        v_numbers.unrealized_pnl::text,
    'trade_count',           v_numbers.trade_count,
    'last_trade_at',         v_numbers.last_trade_at,
    'prices_incomplete',     coalesce(v_numbers.prices_incomplete, false),
    'today_pnl',             case
                               when v_today_basis is null then null
                               else round(v_numbers.total_value - v_today_basis, 4)::text
                             end,
    'today_pnl_percent',     case
                               when v_today_basis is null or v_today_basis = 0 then null
                               else round(((v_numbers.total_value - v_today_basis) / v_today_basis) * 100, 4)::text
                             end,
    'today_basis_kind',      coalesce(v_basis_kind, 'none'),
    'today_basis_at',        v_today_basis_at,
    'holdings',              coalesce(v_holdings, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Trading engine
-- ---------------------------------------------------------------------------
-- Executes a simulated trade. The caller (a server action) has already
-- authenticated the student and fetched the price from Finnhub; this function
-- re-validates everything that actually matters and performs the mutation
-- atomically under a row lock, so concurrent requests cannot double-spend.
create or replace function public.execute_trade(
  p_classroom_id    uuid,
  p_student_id      uuid,
  p_symbol          text,
  p_side            text,
  p_quantity        text,
  p_price           text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty        numeric(24,8);
  v_price      numeric(18,6);
  v_member     public.class_members%rowtype;
  v_settings   public.class_settings%rowtype;
  v_asset      public.assets%rowtype;
  v_holding    public.holdings%rowtype;
  v_total      numeric(18,4);
  v_new_cash   numeric(18,4);
  v_new_qty    numeric(24,8);
  v_new_avg    numeric(18,6);
  v_realized   numeric(18,4) := null;
  v_order_id   uuid;
  v_existing   uuid;
  v_pos_value  numeric(18,4);
  v_portfolio  numeric(18,4);
  v_side       text;
begin
  -- --- input hygiene -------------------------------------------------------
  if p_side is null or p_side not in ('buy', 'sell') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SIDE',
      'message', 'Order side must be buy or sell.');
  end if;
  v_side := p_side;

  begin
    v_qty := p_quantity::numeric(24,8);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY',
      'message', 'Quantity must be a number.');
  end;

  begin
    v_price := p_price::numeric(18,6);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE',
      'message', 'Price must be a number.');
  end;

  if v_qty is null or v_qty <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY',
      'message', 'Quantity must be greater than zero.');
  end if;

  if v_price is null or v_price <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE',
      'message', 'A positive market price is required to trade.');
  end if;

  -- --- authorisation: membership, not a client-supplied role ---------------
  select * into v_member
  from public.class_members m
  where m.classroom_id = p_classroom_id
    and m.student_id = p_student_id
    and m.status = 'active'
  for update;                                  -- serialises this student's trades

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_MEMBER',
      'message', 'You do not have permission to trade in this classroom.');
  end if;

  select * into v_settings from public.class_settings where classroom_id = p_classroom_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_SETTINGS',
      'message', 'This classroom is not configured for trading.');
  end if;

  if not v_settings.trading_enabled then
    return jsonb_build_object('ok', false, 'code', 'TRADING_PAUSED',
      'message', coalesce(nullif(trim(v_settings.paused_reason), ''),
                          'Trading is currently paused by your teacher.'));
  end if;

  if v_settings.trading_opens_at is not null and now() < v_settings.trading_opens_at then
    return jsonb_build_object('ok', false, 'code', 'MARKET_CLOSED',
      'message', 'The trading window has not opened yet.');
  end if;

  if v_settings.trading_closes_at is not null and now() > v_settings.trading_closes_at then
    return jsonb_build_object('ok', false, 'code', 'MARKET_CLOSED',
      'message', 'The trading window for this classroom has closed.');
  end if;

  select * into v_asset
  from public.assets a
  where a.symbol = p_symbol and a.is_active;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_ASSET',
      'message', 'That asset is not available in the simulator.');
  end if;

  if v_settings.asset_policy = 'allowlist' then
    if not exists (
      select 1 from public.classroom_assets ca
      where ca.classroom_id = p_classroom_id and ca.asset_id = v_asset.id
    ) then
      return jsonb_build_object('ok', false, 'code', 'ASSET_NOT_PERMITTED',
        'message', 'Your teacher has not enabled ' || v_asset.display_symbol || ' for this class.');
    end if;
  end if;

  if not v_settings.allow_fractional and v_asset.asset_type = 'stock' and v_qty <> trunc(v_qty) then
    return jsonb_build_object('ok', false, 'code', 'FRACTIONAL_DISABLED',
      'message', 'Your teacher has limited this class to whole shares.');
  end if;

  v_total := round(v_qty * v_price, 4);
  if v_total <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY',
      'message', 'That trade value is too small to execute.');
  end if;

  if v_settings.max_trade_value is not null and v_total > v_settings.max_trade_value then
    return jsonb_build_object('ok', false, 'code', 'TRADE_TOO_LARGE',
      'message', 'A single order is limited to $' || to_char(v_settings.max_trade_value, 'FM999,999,990.00') || '.');
  end if;

  -- --- idempotency: the same submission can never execute twice ------------
  if p_idempotency_key is not null then
    select o.id into v_existing
    from public.orders o
    where o.student_id = p_student_id
      and o.idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return jsonb_build_object(
        'ok', true, 'duplicate', true,
        'portfolio', public.get_portfolio(p_classroom_id, p_student_id)
      );
    end if;
  end if;

  select * into v_holding
  from public.holdings h
  where h.classroom_id = p_classroom_id
    and h.student_id = p_student_id
    and h.asset_id = v_asset.id
  for update;

  if v_side = 'buy' then
    if v_total > v_member.cash_balance then
      return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_CASH',
        'message', 'Not enough cash to complete this trade. You have $'
                   || to_char(v_member.cash_balance, 'FM999,999,990.00') || ' available.');
    end if;

    -- Concentration limit, measured against the portfolio as it stands before
    -- this order is applied.
    if v_settings.max_position_percent is not null then
      select p.cash_balance + p.holdings_market_value
      into v_portfolio
      from public._portfolio_numbers(p_classroom_id, p_student_id) p
      where p.is_member;

      select round(h.quantity * coalesce(pc.price, h.avg_cost), 4)
      into v_pos_value
      from public.holdings h
      left join public.assets a on a.id = h.asset_id
      left join public.price_cache pc on pc.symbol = a.symbol
      where h.classroom_id = p_classroom_id
        and h.student_id = p_student_id
        and h.asset_id = v_asset.id;

      v_pos_value := coalesce(v_pos_value, 0);

      if v_portfolio > 0
         and ((v_pos_value + v_total) / v_portfolio) * 100 > v_settings.max_position_percent then
        return jsonb_build_object('ok', false, 'code', 'POSITION_LIMIT',
          'message', 'This order would put more than '
                     || to_char(v_settings.max_position_percent, 'FM990.0')
                     || '% of your portfolio in ' || v_asset.display_symbol || '.');
      end if;
    end if;

    v_new_cash := round(v_member.cash_balance - v_total, 4);
    v_new_qty  := coalesce(v_holding.quantity, 0) + v_qty;
    v_new_avg  := round(
      (coalesce(v_holding.quantity, 0) * coalesce(v_holding.avg_cost, 0) + v_qty * v_price)
      / nullif(v_new_qty, 0), 6);
  else
    if coalesce(v_holding.quantity, 0) < v_qty then
      return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_HOLDINGS',
        'message', 'You do not own enough shares to sell this amount.');
    end if;

    v_realized := round((v_price - v_holding.avg_cost) * v_qty, 4);
    v_new_cash := round(v_member.cash_balance + v_total, 4);
    v_new_qty  := v_holding.quantity - v_qty;
    v_new_avg  := case when v_new_qty > 0 then v_holding.avg_cost else 0 end;
  end if;

  -- --- persistence ---------------------------------------------------------
  v_order_id := gen_random_uuid();

  insert into public.orders (
    id, classroom_id, student_id, asset_id, side, quantity, price,
    total_value, status, idempotency_key
  ) values (
    v_order_id, p_classroom_id, p_student_id, v_asset.id, p_side, v_qty, v_price,
    v_total, 'filled', p_idempotency_key
  );

  update public.class_members
  set cash_balance = v_new_cash
  where id = v_member.id;

  insert into public.holdings as hg (
    classroom_id, student_id, asset_id, quantity, avg_cost, realized_pnl, updated_at
  ) values (
    p_classroom_id, p_student_id, v_asset.id, v_new_qty, v_new_avg,
    coalesce(v_realized, 0), now()
  )
  on conflict (classroom_id, student_id, asset_id) do update
  set quantity     = v_new_qty,
      avg_cost     = v_new_avg,
      realized_pnl = hg.realized_pnl + coalesce(v_realized, 0),
      updated_at   = now();

  insert into public.transactions (
    order_id, classroom_id, student_id, asset_id, side, quantity, price,
    total_value, realized_pnl, cash_balance_after
  ) values (
    v_order_id, p_classroom_id, p_student_id, v_asset.id, p_side, v_qty, v_price,
    v_total, v_realized, v_new_cash
  );

  -- A snapshot on every fill means the performance chart reflects real events
  -- immediately, without waiting for the sampling cron.
  perform public.capture_snapshots(p_classroom_id, p_student_id);

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'order_id', v_order_id,
    'side', p_side,
    'symbol', v_asset.symbol,
    'display_symbol', v_asset.display_symbol,
    'quantity', v_qty::text,
    'price', v_price::text,
    'total_value', v_total::text,
    'realized_pnl', coalesce(v_realized, 0)::text,
    'portfolio', public.get_portfolio(p_classroom_id, p_student_id)
  );
exception
  when unique_violation then
    -- Concurrent duplicate submission with the same idempotency key.
    return jsonb_build_object(
      'ok', true, 'duplicate', true,
      'portfolio', public.get_portfolio(p_classroom_id, p_student_id)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Snapshots, resets, teacher controls
-- ---------------------------------------------------------------------------
create or replace function public.capture_snapshots(
  p_classroom_id uuid default null,
  p_student_id   uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
  n public.portfolio_numbers;
begin
  for r in
    select m.classroom_id, m.student_id
    from public.class_members m
    where m.status = 'active'
      and (p_classroom_id is null or m.classroom_id = p_classroom_id)
      and (p_student_id is null or m.student_id = p_student_id)
  loop
    n := public._portfolio_numbers(r.classroom_id, r.student_id);
    if n.is_member then
      insert into public.portfolio_snapshots (
        classroom_id, student_id, cash_balance, holdings_market_value,
        total_value, total_pnl
      ) values (
        r.classroom_id, r.student_id, n.cash_balance, n.holdings_market_value,
        n.total_value, n.total_pnl
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- Adjust a student's virtual cash. `initial_capital` moves with it so that a
-- teacher-funded bonus never shows up as investment performance.
create or replace function public.adjust_cash(
  p_classroom_id uuid,
  p_student_id   uuid,
  p_delta        numeric,
  p_reason       text default null,
  p_actor_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.class_members%rowtype;
begin
  if p_delta is null or p_delta = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT',
      'message', 'Enter a non-zero amount.');
  end if;

  select * into v_member
  from public.class_members m
  where m.classroom_id = p_classroom_id and m.student_id = p_student_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_MEMBER',
      'message', 'That student is not in this classroom.');
  end if;

  if v_member.cash_balance + p_delta < 0
     or v_member.initial_capital + p_delta < 0 then
    return jsonb_build_object('ok', false, 'code', 'WOULD_GO_NEGATIVE',
      'message', 'That adjustment would push the balance below zero.');
  end if;

  update public.class_members
  set cash_balance    = round(cash_balance + p_delta, 4),
      initial_capital = round(initial_capital + p_delta, 4)
  where id = v_member.id;

  insert into public.audit_log (classroom_id, actor_id, action, target_type, target_id, detail)
  values (p_classroom_id, p_actor_id, 'adjust_cash', 'student', p_student_id,
          jsonb_build_object('delta', p_delta, 'reason', p_reason));

  perform public.capture_snapshots(p_classroom_id, p_student_id);

  return jsonb_build_object('ok', true,
    'portfolio', public.get_portfolio(p_classroom_id, p_student_id));
end;
$$;

create or replace function public.reset_student_portfolio(
  p_classroom_id      uuid,
  p_student_id        uuid,
  p_starting_capital  numeric default null,
  p_actor_id          uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capital numeric(18,4);
begin
  select coalesce(p_starting_capital, m.initial_capital)
  into v_capital
  from public.class_members m
  where m.classroom_id = p_classroom_id and m.student_id = p_student_id;

  if v_capital is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_MEMBER',
      'message', 'That student is not in this classroom.');
  end if;

  if v_capital < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_CAPITAL',
      'message', 'Starting capital cannot be negative.');
  end if;

  delete from public.transactions where classroom_id = p_classroom_id and student_id = p_student_id;
  delete from public.orders       where classroom_id = p_classroom_id and student_id = p_student_id;
  delete from public.holdings     where classroom_id = p_classroom_id and student_id = p_student_id;
  delete from public.portfolio_snapshots where classroom_id = p_classroom_id and student_id = p_student_id;

  update public.class_members
  set cash_balance    = v_capital,
      initial_capital = v_capital
  where classroom_id = p_classroom_id and student_id = p_student_id;

  insert into public.audit_log (classroom_id, actor_id, action, target_type, target_id, detail)
  values (p_classroom_id, p_actor_id, 'reset_student', 'student', p_student_id,
          jsonb_build_object('starting_capital', v_capital));

  perform public.capture_snapshots(p_classroom_id, p_student_id);

  return jsonb_build_object('ok', true,
    'portfolio', public.get_portfolio(p_classroom_id, p_student_id));
end;
$$;

create or replace function public.reset_classroom(
  p_classroom_id     uuid,
  p_starting_capital numeric default null,
  p_actor_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.transactions where classroom_id = p_classroom_id;
  delete from public.orders       where classroom_id = p_classroom_id;
  delete from public.holdings     where classroom_id = p_classroom_id;
  delete from public.portfolio_snapshots where classroom_id = p_classroom_id;
  delete from public.competition_entries
    where competition_id in (select id from public.competitions where classroom_id = p_classroom_id);

  update public.class_members
  set cash_balance    = coalesce(p_starting_capital, initial_capital),
      initial_capital = coalesce(p_starting_capital, initial_capital)
  where classroom_id = p_classroom_id;

  get diagnostics v_count = row_count;

  insert into public.audit_log (classroom_id, actor_id, action, target_type, detail)
  values (p_classroom_id, p_actor_id, 'reset_classroom', 'classroom',
          jsonb_build_object('students', v_count, 'starting_capital', p_starting_capital));

  perform public.capture_snapshots(p_classroom_id);

  return jsonb_build_object('ok', true, 'students_reset', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Leaderboards, class overview, competitions
-- ---------------------------------------------------------------------------
create or replace function public.get_leaderboard(p_classroom_id uuid)
returns table (
  student_id        uuid,
  display_name      text,
  full_name         text,
  login_handle      text,
  cash_balance      numeric,
  holdings_value    numeric,
  total_value       numeric,
  initial_capital   numeric,
  total_pnl         numeric,
  total_pnl_percent numeric,
  realized_pnl      numeric,
  trade_count       integer,
  last_trade_at     timestamptz,
  rank_position     integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  with members as (
    select
      m.student_id,
      coalesce(nullif(trim(m.display_name), ''), nullif(trim(p.full_name), ''), 'Student') as label,
      p.full_name,
      p.login_handle,
      n.cash_balance, n.holdings_market_value, n.total_value,
      n.initial_capital, n.total_pnl, n.realized_pnl, n.trade_count, n.last_trade_at
    from public.class_members m
    join public.profiles p on p.id = m.student_id
    cross join lateral public._portfolio_numbers(m.classroom_id, m.student_id) n
    where m.classroom_id = p_classroom_id
      and m.status = 'active'
      and n.is_member
  )
  select
    mm.student_id, mm.label, mm.full_name, mm.login_handle,
    mm.cash_balance, mm.holdings_market_value, mm.total_value,
    mm.initial_capital, mm.total_pnl,
    case when mm.initial_capital > 0
         then round((mm.total_pnl / mm.initial_capital) * 100, 4)
         else 0::numeric end,
    mm.realized_pnl, mm.trade_count, mm.last_trade_at,
    rank() over (order by mm.total_value desc)::integer
  from members mm
  order by mm.total_value desc, mm.label asc;
end;
$$;

create or replace function public.get_class_overview(p_classroom_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_active_count integer;
  v_leader_label text;
  v_lagging_label text;
  v_trades_24h integer;
  v_recent jsonb;
begin
  select count(*) into v_active_count
  from public.class_members where classroom_id = p_classroom_id and status = 'active';

  -- get_leaderboard() exposes the label as `display_name` (the RETURNS TABLE
  -- column name), not as the `label` alias used inside its own CTE.
  select display_name into v_leader_label from public.get_leaderboard(p_classroom_id) limit 1;

  select display_name into v_lagging_label
  from public.get_leaderboard(p_classroom_id) order by total_value asc limit 1;

  select count(*) into v_trades_24h
  from public.transactions
  where classroom_id = p_classroom_id and created_at > now() - interval '24 hours';

  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_recent
  from (
    select
      tr.id, tr.side, tr.quantity::text, tr.price::text, tr.total_value::text,
      tr.created_at, a.display_symbol, a.name, a.asset_type,
      coalesce(nullif(trim(m.display_name), ''), nullif(trim(p.full_name), ''), 'Student') as student_label,
      tr.student_id
    from public.transactions tr
    join public.assets a on a.id = tr.asset_id
    join public.class_members m
      on m.classroom_id = tr.classroom_id and m.student_id = tr.student_id
    join public.profiles p on p.id = tr.student_id
    where tr.classroom_id = p_classroom_id
    order by tr.created_at desc
    limit 25
  ) t;

  select jsonb_build_object(
    'classroom_id',      p_classroom_id,
    'student_count',     v_active_count,
    'total_capital',     coalesce(sum(initial_capital), 0)::text,
    'cash_total',        coalesce(sum(cash_balance), 0)::text,
    'trades_24h',        v_trades_24h,
    'leader',            v_leader_label,
    'lagging',           v_lagging_label,
    'recent_trades',     v_recent
  ) into v_result
  from public.class_members
  where classroom_id = p_classroom_id and status = 'active';

  return coalesce(v_result, jsonb_build_object(
    'classroom_id', p_classroom_id, 'student_count', 0, 'total_capital', '0',
    'cash_total', '0', 'trades_24h', 0, 'leader', null, 'lagging', null,
    'recent_trades', '[]'::jsonb));
end;
$$;

create or replace function public.create_competition(
  p_classroom_id uuid,
  p_name         text,
  p_description  text,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_created_by   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_NAME',
      'message', 'Give the competition a name.');
  end if;

  if p_ends_at <= p_starts_at then
    return jsonb_build_object('ok', false, 'code', 'INVALID_WINDOW',
      'message', 'The end time must be after the start time.');
  end if;

  insert into public.competitions (classroom_id, name, description, starts_at, ends_at, created_by)
  values (p_classroom_id, trim(p_name), nullif(trim(coalesce(p_description, '')), ''),
          p_starts_at, p_ends_at, p_created_by)
  returning id into v_id;

  -- Baseline every active member at their value right now, so the standings are
  -- a real return over the competition window rather than since inception.
  insert into public.competition_entries (competition_id, student_id, opening_value)
  select v_id, m.student_id, coalesce(n.total_value, 0)
  from public.class_members m
  cross join lateral public._portfolio_numbers(m.classroom_id, m.student_id) n
  where m.classroom_id = p_classroom_id and m.status = 'active' and n.is_member;

  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'competition_id', v_id, 'entries', v_count);
end;
$$;

create or replace function public.get_competition_standings(p_competition_id uuid)
returns table (
  student_id    uuid,
  label         text,
  opening_value numeric,
  current_value numeric,
  return_abs    numeric,
  return_pct    numeric,
  trade_count   integer,
  rank_position integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_classroom uuid;
begin
  select c.classroom_id into v_classroom
  from public.competitions c where c.id = p_competition_id;

  if v_classroom is null then
    return;
  end if;

  return query
  with rows as (
    select
      e.student_id,
      coalesce(nullif(trim(m.display_name), ''), nullif(trim(p.full_name), ''), 'Student') as label,
      e.opening_value,
      coalesce(n.total_value, e.opening_value) as current_value,
      coalesce(n.trade_count, 0) as trade_count
    from public.competition_entries e
    join public.class_members m
      on m.classroom_id = v_classroom and m.student_id = e.student_id
    join public.profiles p on p.id = e.student_id
    cross join lateral public._portfolio_numbers(v_classroom, e.student_id) n
    where e.competition_id = p_competition_id
  )
  select
    r.student_id,
    r.label,
    r.opening_value,
    r.current_value,
    round(r.current_value - r.opening_value, 4),
    case when r.opening_value > 0
         then round(((r.current_value - r.opening_value) / r.opening_value) * 100, 4)
         else 0::numeric end,
    r.trade_count,
    rank() over (order by (r.current_value - r.opening_value) desc)::integer
  from rows r
  order by (r.current_value - r.opening_value) desc, r.label asc;
end;
$$;

-- Trade history with a filter, used by both dashboards.
create or replace function public.get_trade_history(
  p_classroom_id uuid,
  p_student_id   uuid default null,
  p_limit        integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  from (
    select
      tr.id,
      tr.side,
      tr.quantity::text        as quantity,
      tr.price::text           as price,
      tr.total_value::text     as total_value,
      tr.realized_pnl::text    as realized_pnl,
      tr.cash_balance_after::text as cash_balance_after,
      tr.created_at,
      a.symbol, a.display_symbol, a.name, a.asset_type,
      tr.student_id,
      coalesce(nullif(trim(m.display_name), ''), nullif(trim(p.full_name), ''), 'Student') as student_label
    from public.transactions tr
    join public.assets a on a.id = tr.asset_id
    join public.class_members m
      on m.classroom_id = tr.classroom_id and m.student_id = tr.student_id
    join public.profiles p on p.id = tr.student_id
    where tr.classroom_id = p_classroom_id
      and (p_student_id is null or tr.student_id = p_student_id)
    order by tr.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) t;
$$;

-- Convenience: create/refresh an asset row from market data the server fetched.
create or replace function public.upsert_asset(
  p_symbol         text,
  p_display_symbol text,
  p_name           text,
  p_asset_type     text,
  p_exchange       text default null,
  p_currency       text default 'USD'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_symbol is null or length(trim(p_symbol)) = 0 then
    raise exception 'symbol required';
  end if;

  if p_asset_type not in ('stock', 'crypto') then
    raise exception 'invalid asset type %', p_asset_type;
  end if;

  insert into public.assets (symbol, display_symbol, name, asset_type, exchange, currency)
  values (
    upper(trim(p_symbol)),
    coalesce(nullif(trim(p_display_symbol), ''), upper(trim(p_symbol))),
    coalesce(p_name, ''),
    p_asset_type,
    p_exchange,
    coalesce(p_currency, 'USD')
  )
  on conflict (symbol) do update
  set display_symbol = excluded.display_symbol,
      name           = case when excluded.name = '' then public.assets.name else excluded.name end,
      exchange       = coalesce(excluded.exchange, public.assets.exchange),
      is_active      = true
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Grants
--    These functions are SECURITY DEFINER, so RLS does not apply inside them.
--    If a student could call get_portfolio() directly through PostgREST they
--    could pass somebody else's student_id and read it. They therefore get NO
--    execute grant: every RPC is callable only by service_role, which is used
--    exclusively inside server actions that have already authenticated the
--    caller and checked authorisation. Table reads that students and teachers
--    do perform directly are guarded by the RLS policies in section 4.
-- ---------------------------------------------------------------------------
revoke all on function public.get_portfolio(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_leaderboard(uuid) from public, anon, authenticated;
revoke all on function public.get_class_overview(uuid) from public, anon, authenticated;
revoke all on function public.get_trade_history(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_competition_standings(uuid) from public, anon, authenticated;
revoke all on function public.execute_trade(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.adjust_cash(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.reset_student_portfolio(uuid, uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public.reset_classroom(uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public.create_competition(uuid, text, text, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.capture_snapshots(uuid, uuid) from public, anon, authenticated;
revoke all on function public.upsert_asset(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public._portfolio_numbers(uuid, uuid) from public, anon, authenticated;

grant execute on function public.get_portfolio(uuid, uuid) to service_role;
grant execute on function public.get_leaderboard(uuid) to service_role;
grant execute on function public.get_class_overview(uuid) to service_role;
grant execute on function public.get_trade_history(uuid, uuid, integer) to service_role;
grant execute on function public.get_competition_standings(uuid) to service_role;
grant execute on function public.execute_trade(uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.adjust_cash(uuid, uuid, numeric, text, uuid) to service_role;
grant execute on function public.reset_student_portfolio(uuid, uuid, numeric, uuid) to service_role;
grant execute on function public.reset_classroom(uuid, numeric, uuid) to service_role;
grant execute on function public.create_competition(uuid, text, text, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.capture_snapshots(uuid, uuid) to service_role;
grant execute on function public.upsert_asset(text, text, text, text, text, text) to service_role;
grant execute on function public._portfolio_numbers(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Reference data — the tradeable universe
--     This is market metadata (symbols and names), not fabricated prices or
--     users. Prices always come from Finnhub at request time.
-- ---------------------------------------------------------------------------
insert into public.assets (symbol, display_symbol, name, asset_type, exchange) values
  ('AAPL',  'AAPL',  'Apple Inc.',                    'stock', 'NASDAQ'),
  ('MSFT',  'MSFT',  'Microsoft Corporation',          'stock', 'NASDAQ'),
  ('NVDA',  'NVDA',  'NVIDIA Corporation',             'stock', 'NASDAQ'),
  ('AMZN',  'AMZN',  'Amazon.com, Inc.',               'stock', 'NASDAQ'),
  ('GOOGL', 'GOOGL', 'Alphabet Inc. Class A',          'stock', 'NASDAQ'),
  ('META',  'META',  'Meta Platforms, Inc.',           'stock', 'NASDAQ'),
  ('TSLA',  'TSLA',  'Tesla, Inc.',                    'stock', 'NASDAQ'),
  ('BRK.B', 'BRK.B', 'Berkshire Hathaway Inc. Class B','stock', 'NYSE'),
  ('JPM',   'JPM',   'JPMorgan Chase & Co.',           'stock', 'NYSE'),
  ('V',     'V',     'Visa Inc.',                      'stock', 'NYSE'),
  ('MA',    'MA',    'Mastercard Incorporated',        'stock', 'NYSE'),
  ('UNH',   'UNH',   'UnitedHealth Group Inc.',        'stock', 'NYSE'),
  ('XOM',   'XOM',   'Exxon Mobil Corporation',        'stock', 'NYSE'),
  ('JNJ',   'JNJ',   'Johnson & Johnson',              'stock', 'NYSE'),
  ('PG',    'PG',    'The Procter & Gamble Company',   'stock', 'NYSE'),
  ('KO',    'KO',    'The Coca-Cola Company',          'stock', 'NYSE'),
  ('PEP',   'PEP',   'PepsiCo, Inc.',                  'stock', 'NASDAQ'),
  ('WMT',   'WMT',   'Walmart Inc.',                   'stock', 'NYSE'),
  ('COST',  'COST',  'Costco Wholesale Corporation',   'stock', 'NASDAQ'),
  ('HD',    'HD',    'The Home Depot, Inc.',           'stock', 'NYSE'),
  ('MCD',   'MCD',   'McDonald''s Corporation',        'stock', 'NYSE'),
  ('DIS',   'DIS',   'The Walt Disney Company',        'stock', 'NYSE'),
  ('NKE',   'NKE',   'NIKE, Inc.',                     'stock', 'NYSE'),
  ('SBUX',  'SBUX',  'Starbucks Corporation',          'stock', 'NASDAQ'),
  ('BA',    'BA',    'The Boeing Company',             'stock', 'NYSE'),
  ('CAT',   'CAT',   'Caterpillar Inc.',               'stock', 'NYSE'),
  ('GE',    'GE',    'GE Aerospace',                   'stock', 'NYSE'),
  ('F',     'F',     'Ford Motor Company',             'stock', 'NYSE'),
  ('GM',    'GM',    'General Motors Company',         'stock', 'NYSE'),
  ('T',     'T',     'AT&T Inc.',                      'stock', 'NYSE'),
  ('VZ',    'VZ',    'Verizon Communications Inc.',    'stock', 'NYSE'),
  ('PFE',   'PFE',   'Pfizer Inc.',                    'stock', 'NYSE'),
  ('MRK',   'MRK',   'Merck & Co., Inc.',              'stock', 'NYSE'),
  ('ABBV',  'ABBV',  'AbbVie Inc.',                    'stock', 'NYSE'),
  ('LLY',   'LLY',   'Eli Lilly and Company',          'stock', 'NYSE'),
  ('AMD',   'AMD',   'Advanced Micro Devices, Inc.',   'stock', 'NASDAQ'),
  ('INTC',  'INTC',  'Intel Corporation',              'stock', 'NASDAQ'),
  ('MU',    'MU',    'Micron Technology, Inc.',        'stock', 'NASDAQ'),
  ('QCOM',  'QCOM',  'QUALCOMM Incorporated',          'stock', 'NASDAQ'),
  ('AVGO',  'AVGO',  'Broadcom Inc.',                  'stock', 'NASDAQ'),
  ('CRM',   'CRM',   'Salesforce, Inc.',               'stock', 'NYSE'),
  ('ORCL',  'ORCL',  'Oracle Corporation',             'stock', 'NYSE'),
  ('ADBE',  'ADBE',  'Adobe Inc.',                     'stock', 'NASDAQ'),
  ('NFLX',  'NFLX',  'Netflix, Inc.',                  'stock', 'NASDAQ'),
  ('PYPL',  'PYPL',  'PayPal Holdings, Inc.',          'stock', 'NASDAQ'),
  ('UBER',  'UBER',  'Uber Technologies, Inc.',        'stock', 'NYSE'),
  ('ABNB',  'ABNB',  'Airbnb, Inc.',                   'stock', 'NASDAQ'),
  ('SHOP',  'SHOP',  'Shopify Inc.',                   'stock', 'NYSE'),
  ('PLTR',  'PLTR',  'Palantir Technologies Inc.',     'stock', 'NASDAQ'),
  ('COIN',  'COIN',  'Coinbase Global, Inc.',          'stock', 'NASDAQ'),
  ('SOFI',  'SOFI',  'SoFi Technologies, Inc.',        'stock', 'NASDAQ'),
  ('SPY',   'SPY',   'SPDR S&P 500 ETF Trust',         'stock', 'NYSE ARCA'),
  ('QQQ',   'QQQ',   'Invesco QQQ Trust',              'stock', 'NASDAQ'),
  ('IWM',   'IWM',   'iShares Russell 2000 ETF',       'stock', 'NYSE ARCA'),
  ('GLD',   'GLD',   'SPDR Gold Shares',               'stock', 'NYSE ARCA'),
  ('BINANCE:BTCUSDT', 'BTC/USDT', 'Bitcoin',  'crypto', 'BINANCE'),
  ('BINANCE:ETHUSDT', 'ETH/USDT', 'Ethereum', 'crypto', 'BINANCE'),
  ('BINANCE:SOLUSDT', 'SOL/USDT', 'Solana',   'crypto', 'BINANCE'),
  ('BINANCE:ADAUSDT', 'ADA/USDT', 'Cardano',  'crypto', 'BINANCE'),
  ('BINANCE:XRPUSDT', 'XRP/USDT', 'XRP',      'crypto', 'BINANCE'),
  ('BINANCE:DOGEUSDT','DOGE/USDT','Dogecoin', 'crypto', 'BINANCE'),
  ('BINANCE:AVAXUSDT','AVAX/USDT','Avalanche','crypto', 'BINANCE'),
  ('BINANCE:LINKUSDT','LINK/USDT','Chainlink','crypto', 'BINANCE'),
  ('BINANCE:DOTUSDT', 'DOT/USDT', 'Polkadot', 'crypto', 'BINANCE'),
  ('BINANCE:LTCUSDT', 'LTC/USDT', 'Litecoin', 'crypto', 'BINANCE'),
  ('BINANCE:UNIUSDT', 'UNI/USDT', 'Uniswap',  'crypto', 'BINANCE'),
  ('BINANCE:ATOMUSDT','ATOM/USDT','Cosmos',   'crypto', 'BINANCE')
on conflict (symbol) do update
  set display_symbol = excluded.display_symbol,
      name           = excluded.name,
      asset_type     = excluded.asset_type,
      exchange       = excluded.exchange,
      is_active      = true;

-- ---------------------------------------------------------------------------
-- 11. Ensure every classroom has a settings row (trigger keeps it true)
-- ---------------------------------------------------------------------------
create or replace function public.ensure_class_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.class_settings (classroom_id)
  values (new.id)
  on conflict (classroom_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_classroom_created on public.classrooms;
create trigger on_classroom_created
  after insert on public.classrooms
  for each row execute function public.ensure_class_settings();

insert into public.class_settings (classroom_id)
select c.id from public.classrooms c
on conflict (classroom_id) do nothing;
