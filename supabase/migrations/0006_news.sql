-- ---------------------------------------------------------------------------
-- 0006 — News cache and the shared Alpha Vantage call budget.
--
-- Alpha Vantage is the one upstream this app cannot call per request: the free
-- tier allows 25 requests per day *in total*, shared by every student in every
-- classroom. Two mechanisms therefore exist:
--
--   * news_cache  — one durable row per news query, so a cold serverless start
--                   does not spend a request that a warm instance already
--                   spent, and so a class of thirty students costs one call
--                   instead of thirty.
--   * api_quota   — an atomic per-UTC-day counter. consume_api_quota()
--                   increments only while the count is under the ceiling, so N
--                   concurrent requests cannot collectively overshoot it. Same
--                   principle as the trading engine: the decision is made
--                   inside the database, not in application code that raced to
--                   get there.
--
-- Both are service-role only: RLS is enabled with no policies, and the RPC is
-- granted to service_role alone. The news service falls back to an in-process
-- cache when this migration has not been applied, so nothing hard-breaks — it
-- just stops being shared between instances.
--
-- Safe to re-run.
-- ---------------------------------------------------------------------------

create table if not exists public.news_cache (
  cache_key  text primary key,
  payload    jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists news_cache_expires_at_idx
  on public.news_cache (expires_at);

create table if not exists public.api_quota (
  provider     text not null,
  window_start date not null,
  calls        integer not null default 0 check (calls >= 0),
  updated_at   timestamptz not null default now(),
  primary key (provider, window_start)
);

alter table public.news_cache enable row level security;
alter table public.api_quota  enable row level security;

-- No policies: the only writer and reader is the server, through the
-- service-role key. Clients have no business seeing the cache or the counter.
revoke all on public.news_cache from public, anon, authenticated;
revoke all on public.api_quota  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- consume_api_quota: reserve one upstream call, atomically.
--
-- Returns true when a call was reserved, false when the day's ceiling is
-- already reached. The `where` on the conflict update is what makes this safe:
-- a losing race changes no row, therefore returns no row, therefore the caller
-- does not make the upstream call.
-- ---------------------------------------------------------------------------
create or replace function public.consume_api_quota(
  p_provider text,
  p_limit    integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reserved boolean;
begin
  if p_limit is null or p_limit <= 0 then
    return false;
  end if;

  insert into public.api_quota (provider, window_start, calls)
  values (p_provider, (now() at time zone 'utc')::date, 1)
  on conflict (provider, window_start) do update
    set calls = public.api_quota.calls + 1,
        updated_at = now()
    where public.api_quota.calls < p_limit
  returning true into v_reserved;

  return coalesce(v_reserved, false);
end;
$$;

revoke all on function public.consume_api_quota(text, integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_quota(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- How many calls this provider has spent today. Read-only, service-role only.
-- Used by the news service to decide whether to attempt a refresh and by the
-- admin view of quota pressure.
-- ---------------------------------------------------------------------------
create or replace function public.remaining_api_quota(
  p_provider text,
  p_limit    integer
) returns integer
language sql
security definer
set search_path = public
as $$
  select greatest(
    0,
    coalesce(p_limit, 0) - coalesce((
      select calls from public.api_quota
      where provider = p_provider
        and window_start = (now() at time zone 'utc')::date
    ), 0)
  );
$$;

revoke all on function public.remaining_api_quota(text, integer)
  from public, anon, authenticated;
grant execute on function public.remaining_api_quota(text, integer) to service_role;
