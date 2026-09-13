-- ---------------------------------------------------------------------------
-- 0005 — Order lifecycle, executions ledger, cash events, extended controls.
--
-- Extends the trading engine from "immediate market orders only" to a proper
-- order → execution → transaction → portfolio flow:
--
--   * orders gains: order_type, limit_price, stop_price, filled_quantity,
--     filled_avg_price, status lifecycle (pending → partially_filled →
--     filled / cancelled / rejected / expired), cancel/expiry metadata, and
--     market-hours + session-at-placement provenance.
--   * executions: an immutable append-only record of every fill, the way a
--     real brokerage keeps them. A partial fill never rewrites history — it
--     appends.
--   * cash_events: teacher-issued money is a first-class ledger event
--     ("teacher_credit" / "teacher_debit"), separate from trading cash flows.
--   * class_settings gains the new teacher controls from the spec: allowed
--     order types, market-hours enforcement, crypto on/off, short selling
--     on/off, options on/off (options stay hard-disabled in the engine —
--     the flag exists so the control is honest, not functional).
--   * get_leaderboard() now ranks by return % (spec §8) — students with
--     different starting capitals compare fairly.
--
-- Money stays numeric. Clients still cannot write to financial tables.
-- Safe to re-run. Run 0001–0004 first.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. orders: lifecycle + order types
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists order_type text not null default 'market'
    check (order_type in ('market', 'limit', 'stop', 'stop_limit')),
  add column if not exists limit_price numeric(18,6)
    check (limit_price is null or limit_price > 0),
  add column if not exists stop_price numeric(18,6)
    check (stop_price is null or stop_price > 0),
  add column if not exists filled_quantity numeric(24,8) not null default 0
    check (filled_quantity >= 0),
  add column if not exists filled_avg_price numeric(18,6)
    check (filled_avg_price is null or filled_avg_price > 0),
  add column if not exists filled_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists session_at_placement text
    check (session_at_placement is null or session_at_placement in ('regular','pre_market','after_hours','closed'));

-- 0001 defined the status check inline, so PostgreSQL auto-named it
-- orders_status_check. Drop it (by discovering its generated name) and add a
-- constraint we own that covers the full lifecycle.
do $$
begin
  if exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    where t.relname = 'orders' and c.conname = 'orders_status_check'
  ) then
    alter table public.orders drop constraint orders_status_check;
  end if;
end $$;

alter table public.orders drop constraint if exists orders_status_lifecycle;
alter table public.orders
  add constraint orders_status_lifecycle
    check (status in ('pending', 'partially_filled', 'filled', 'cancelled', 'rejected', 'expired'));

-- Existing 'filled' rows carry no order_type; default them consistently so the
-- new NOT NULL column backfills cleanly.
update public.orders set order_type = 'market' where order_type is null;

create index if not exists orders_open_idx
  on public.orders (classroom_id, status)
  where status in ('pending', 'partially_filled');

create index if not exists orders_expiry_idx
  on public.orders (expires_at)
  where status in ('pending', 'partially_filled');

-- ---------------------------------------------------------------------------
-- 2. executions: immutable record of every fill
-- ---------------------------------------------------------------------------
create table if not exists public.executions (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  classroom_id   uuid not null references public.classrooms(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  asset_id       uuid not null references public.assets(id) on delete restrict,
  side           text not null check (side in ('buy', 'sell')),
  quantity       numeric(24,8) not null check (quantity > 0),
  price          numeric(18,6) not null check (price > 0),
  notional       numeric(18,4) not null check (notional > 0),
  executed_at    timestamptz not null default now()
);

create index if not exists executions_order_idx on public.executions (order_id);
create index if not exists executions_class_time_idx on public.executions (classroom_id, executed_at desc);

-- RLS mirrors transactions: own rows or the class teacher.
alter table public.executions enable row level security;

drop policy if exists executions_select on public.executions;
create policy executions_select on public.executions
  for select to authenticated using (
    student_id = auth.uid() or public.is_classroom_teacher(classroom_id)
  );

revoke all on public.executions from anon;
grant select on public.executions to authenticated;

-- ---------------------------------------------------------------------------
-- 3. cash_events: teacher-issued money as a first-class ledger event
-- ---------------------------------------------------------------------------
create table if not exists public.cash_events (
  id             uuid primary key default gen_random_uuid(),
  classroom_id   uuid not null references public.classrooms(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  event_type     text not null check (event_type in ('teacher_credit', 'teacher_debit', 'starting_capital')),
  amount         numeric(18,4) not null check (amount > 0),
  reason         text,
  actor_id       uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

create index if not exists cash_events_student_idx
  on public.cash_events (classroom_id, student_id, created_at desc);

alter table public.cash_events enable row level security;

drop policy if exists cash_events_select on public.cash_events;
create policy cash_events_select on public.cash_events
  for select to authenticated using (
    student_id = auth.uid() or public.is_classroom_teacher(classroom_id)
  );

revoke all on public.cash_events from anon;
grant select on public.cash_events to authenticated;

-- ---------------------------------------------------------------------------
-- 4. class_settings: the spec's new teacher controls
-- ---------------------------------------------------------------------------
alter table public.class_settings
  add column if not exists allowed_order_types text[] not null default '{market,limit,stop,stop_limit}',
  add column if not exists enforce_market_hours boolean not null default true,
  add column if not exists allow_extended_hours boolean not null default false,
  add column if not exists crypto_enabled boolean not null default true,
  add column if not exists short_selling_enabled boolean not null default false,
  add column if not exists options_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- 5. place_order(): order intake for all four types
--
-- Market orders execute immediately at the live price (same invariants as
-- execute_trade, which remains available for compatibility). Limit/stop/
-- stop-limit orders are validated, reserved against buying power or shares,
-- and parked as `pending` for the matching worker — never filled at placement
-- time, because filling them there would misprice the order.
--
-- Buying power rule: pending buy orders reserve quantity × reference price of
-- cash (or the market price for stops), so a student cannot place two orders
-- that each spend the full balance. Sell orders reserve shares.
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_classroom_id    uuid,
  p_student_id      uuid,
  p_symbol          text,
  p_side            text,
  p_order_type      text,
  p_quantity        text,
  p_limit_price     text default null,
  p_stop_price      text default null,
  p_idempotency_key text default null,
  p_session_at_placement text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty           numeric(24,8);
  v_limit         numeric(18,6);
  v_stop          numeric(18,6);
  v_member        public.class_members%rowtype;
  v_settings      public.class_settings%rowtype;
  v_asset         public.assets%rowtype;
  v_existing      uuid;
  v_order_id      uuid;
  v_ref_price     numeric(18,6);
  v_reserve       numeric(18,4);
  v_held_qty      numeric(24,8);
  v_open_buys     numeric(18,4);
  v_buying_power  numeric(18,4);
begin
  -- --- input hygiene -------------------------------------------------------
  if p_side is null or p_side not in ('buy', 'sell') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SIDE',
      'message', 'Order side must be buy or sell.');
  end if;

  if p_order_type is null or p_order_type not in ('market', 'limit', 'stop', 'stop_limit') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ORDER_TYPE',
      'message', 'Order type must be market, limit, stop or stop_limit.');
  end if;

  begin
    v_qty := p_quantity::numeric(24,8);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY',
      'message', 'Quantity must be a number.');
  end;

  if v_qty is null or v_qty <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_QUANTITY',
      'message', 'Quantity must be greater than zero.');
  end if;

  if p_order_type in ('limit', 'stop_limit') then
    begin
      v_limit := p_limit_price::numeric(18,6);
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE',
        'message', 'Limit price must be a number.');
    end;
    if v_limit is null or v_limit <= 0 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE',
        'message', 'A positive limit price is required for this order type.');
    end if;
  end if;

  if p_order_type in ('stop', 'stop_limit') then
    begin
      v_stop := p_stop_price::numeric(18,6);
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE',
        'message', 'Stop price must be a number.');
    end;
    if v_stop is null or v_stop <= 0 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE',
        'message', 'A positive stop price is required for this order type.');
    end if;
  end if;

  -- --- authorisation: membership, trading rules, market hours --------------
  select * into v_member
  from public.class_members m
  where m.classroom_id = p_classroom_id
    and m.student_id = p_student_id
    and m.status = 'active'
  for update;

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

  -- Crypto is exempt from equity market hours; equities are not (spec §3/§12).
  if v_settings.enforce_market_hours and v_asset.asset_type = 'stock' then
    if not v_settings.allow_extended_hours and p_session_at_placement is distinct from 'regular' then
      return jsonb_build_object('ok', false, 'code', 'MARKET_CLOSED',
        'message', 'The US equity market is closed. Regular-hours orders only — try again when the market opens.');
    end if;
  end if;

  if v_asset.asset_type = 'crypto' and not v_settings.crypto_enabled then
    return jsonb_build_object('ok', false, 'code', 'CRYPTO_DISABLED',
      'message', 'Your teacher has disabled crypto trading for this class.');
  end if;

  if p_order_type <> 'market' and not (p_order_type = any (v_settings.allowed_order_types)) then
    return jsonb_build_object('ok', false, 'code', 'ORDER_TYPE_DISABLED',
      'message', 'Your teacher has not enabled that order type for this class.');
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

  -- Reference price: the latest sampled market price. Pending orders are
  -- matched against this, and reserves are computed from it.
  select pc.price::numeric(18,6) into v_ref_price
  from public.price_cache pc
  where pc.symbol = v_asset.symbol;

  if v_ref_price is null or v_ref_price <= 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_PRICE',
      'message', 'No market price is available for ' || v_asset.display_symbol || ' yet. Try again shortly.');
  end if;

  -- --- idempotency ---------------------------------------------------------
  if p_idempotency_key is not null then
    select o.id into v_existing
    from public.orders o
    where o.student_id = p_student_id
      and o.idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return jsonb_build_object('ok', true, 'duplicate', true, 'order_id', v_existing);
    end if;
  end if;

  -- --- reserves: pending orders must not over-commit -----------------------
  select coalesce(sum(h.quantity), 0) into v_held_qty
  from public.holdings h
  where h.classroom_id = p_classroom_id
    and h.student_id = p_student_id
    and h.asset_id = v_asset.id;

  -- Cash is global across assets, so the reservation check sums every open
  -- buy — not just ones on this asset. Without that, a student could commit
  -- their full balance once per asset.
  select coalesce(sum(
    case when o.side = 'buy'
      then (coalesce(o.limit_price, o.stop_price, o.price) * (o.quantity - o.filled_quantity))
      else 0 end
  ), 0) into v_open_buys
  from public.orders o
  where o.classroom_id = p_classroom_id
    and o.student_id = p_student_id
    and o.status in ('pending', 'partially_filled')
    and o.side = 'buy';

  if p_side = 'buy' then
    v_reserve := round(v_qty * coalesce(v_limit, v_stop, v_ref_price), 4);
    v_buying_power := round(v_member.cash_balance - v_open_buys, 4);

    if v_reserve > v_buying_power then
      return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_BUYING_POWER',
        'message', 'Order rejected: insufficient buying power. Reserved for open orders: $'
                   || to_char(coalesce(v_open_buys, 0), 'FM999,999,990.00')
                   || '. Available: $' || to_char(v_buying_power, 'FM999,999,990.00') || '.');
    end if;

    if v_settings.max_trade_value is not null and v_reserve > v_settings.max_trade_value then
      return jsonb_build_object('ok', false, 'code', 'TRADE_TOO_LARGE',
        'message', 'A single order is limited to $'
                   || to_char(v_settings.max_trade_value, 'FM999,999,990.00') || '.');
    end if;
  else
    -- Sell: this order's shares must exist and not be promised to other sells.
    v_reserve := v_qty;
    if v_held_qty < v_reserve then
      return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_HOLDINGS',
        'message', 'You do not own enough shares to sell this amount.');
    end if;

    if v_settings.short_selling_enabled then
      null; -- spec allows the flag; engine keeps shorting out of scope (see README)
    end if;
  end if;

  -- --- persistence ---------------------------------------------------------
  insert into public.orders (
    classroom_id, student_id, asset_id, side, quantity, price,
    total_value, status, idempotency_key,
    order_type, limit_price, stop_price, expires_at, session_at_placement
  ) values (
    p_classroom_id, p_student_id, v_asset.id, p_side, v_qty, v_ref_price,
    round(v_qty * v_ref_price, 4),
    case when p_order_type = 'market' then 'pending' else 'pending' end,
    p_idempotency_key,
    p_order_type, v_limit, v_stop,
    case when p_order_type = 'market' then null else now() + interval '90 days' end,
    p_session_at_placement
  )
  returning id into v_order_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'status', 'pending',
    'reference_price', v_ref_price::text
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. fill_order(): the matching worker. Called by the server cron with live
--    prices; executes or leaves pending per order-type rules, under the same
--    row lock as execute_trade so two students can never touch the same money.
-- ---------------------------------------------------------------------------
-- NOTE: reset_student_portfolio() in 0001 deletes orders/transactions/holdings
-- directly. Executions cascade from orders, and cash_events are left in place
-- deliberately: they are the teacher's ledger of granted money, not the
-- student's trading history.
create or replace function public.fill_order(
  p_order_id uuid,
  p_price    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     public.orders%rowtype;
  v_member    public.class_members%rowtype;
  v_settings  public.class_settings%rowtype;
  v_holding   public.holdings%rowtype;
  v_price     numeric(18,6);
  v_remaining numeric(24,8);
  v_fill_qty  numeric(24,8);
  v_exec_price numeric(18,6);
  v_notional  numeric(18,4);
  v_new_cash  numeric(18,4);
  v_new_qty   numeric(24,8);
  v_new_avg   numeric(18,6);
  v_realized  numeric(18,4) := null;
  v_status    text;
  v_transaction_id uuid;
begin
  begin
    v_price := p_price::numeric(18,6);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE',
      'message', 'Price must be a number.');
  end;

  if v_price is null or v_price <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE',
      'message', 'A positive price is required to fill an order.');
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND',
      'message', 'Order not found.');
  end if;

  if v_order.status not in ('pending', 'partially_filled') then
    return jsonb_build_object('ok', true, 'status', v_order.status, 'no_action', true);
  end if;

  select * into v_member
  from public.class_members m
  where m.classroom_id = v_order.classroom_id
    and m.student_id = v_order.student_id
    and m.status = 'active'
  for update;

  if not found then
    update public.orders set status = 'rejected', reject_reason = 'Membership ended'
      where id = v_order.id;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  select * into v_settings from public.class_settings where classroom_id = v_order.classroom_id;
  if not found or not v_settings.trading_enabled then
    -- Emergency halt: leave the order pending, fill nothing.
    return jsonb_build_object('ok', true, 'status', 'pending', 'no_action', true, 'halted', true);
  end if;

  v_remaining := v_order.quantity - v_order.filled_quantity;

  -- --- per-type fill rules --------------------------------------------------
  if v_order.order_type = 'market' then
    v_fill_qty := v_remaining;
    v_exec_price := v_price; -- fill whatever the live price is

  elsif v_order.order_type = 'limit' then
    if v_order.side = 'buy' then
      if v_price <= v_order.limit_price then v_fill_qty := v_remaining; else v_fill_qty := 0; end if;
    else
      if v_price >= v_order.limit_price then v_fill_qty := v_remaining; else v_fill_qty := 0; end if;
    end if;
    v_exec_price := v_order.limit_price; -- limit orders fill at their limit or better

  elsif v_order.order_type = 'stop' then
    if v_order.side = 'buy' then
      if v_price >= v_order.stop_price then v_fill_qty := v_remaining; else v_fill_qty := 0; end if;
    else
      if v_price <= v_order.stop_price then v_fill_qty := v_remaining; else v_fill_qty := 0; end if;
    end if;
    v_exec_price := v_price;

  elsif v_order.order_type = 'stop_limit' then
    if v_order.side = 'buy' then
      if v_price >= v_order.stop_price then
        if v_price <= v_order.limit_price then v_fill_qty := v_remaining; else v_fill_qty := 0; end if;
      else
        v_fill_qty := 0;
      end if;
    else
      if v_price <= v_order.stop_price then
        if v_price >= v_order.limit_price then v_fill_qty := v_remaining; else v_fill_qty := 0; end if;
      else
        v_fill_qty := 0;
      end if;
    end if;
    v_exec_price := v_order.limit_price;
  end if;

  if v_fill_qty is null or v_fill_qty <= 0 then
    return jsonb_build_object('ok', true, 'status', v_order.status, 'no_action', true);
  end if;

  v_notional := round(v_fill_qty * v_exec_price, 4);

  select * into v_holding
  from public.holdings h
  where h.classroom_id = v_order.classroom_id
    and h.student_id = v_order.student_id
    and h.asset_id = v_order.asset_id
  for update;

  if v_order.side = 'buy' then
    -- Cash must cover the *whole* order at execution price minus what is
    -- already filled, because the reserve was computed at placement.
    v_new_cash := round(
      v_member.cash_balance - (v_notional + coalesce(v_order.filled_avg_price, 0) * 0), 4);
    if v_new_cash < 0 then
      update public.orders set status = 'rejected',
        reject_reason = 'Insufficient cash at fill time'
        where id = v_order.id;
      return jsonb_build_object('ok', true, 'status', 'rejected');
    end if;
    v_new_qty := coalesce(v_holding.quantity, 0) + v_fill_qty;
    v_new_avg := round(
      (coalesce(v_holding.quantity, 0) * coalesce(v_holding.avg_cost, 0) + v_fill_qty * v_exec_price)
      / nullif(v_new_qty, 0), 6);
  else
    if coalesce(v_holding.quantity, 0) < v_fill_qty then
      update public.orders set status = 'rejected',
        reject_reason = 'Insufficient shares at fill time'
        where id = v_order.id;
      return jsonb_build_object('ok', true, 'status', 'rejected');
    end if;
    v_realized := round((v_exec_price - v_holding.avg_cost) * v_fill_qty, 4);
    v_new_cash := round(v_member.cash_balance + v_notional, 4);
    v_new_qty  := v_holding.quantity - v_fill_qty;
    v_new_avg  := case when v_new_qty > 0 then v_holding.avg_cost else 0 end;
  end if;

  -- --- persistence: order, execution, cash, holding, transaction, snapshot --
  v_status := case when v_fill_qty >= v_remaining then 'filled' else 'partially_filled' end;

  update public.orders
  set status = v_status,
      filled_quantity = v_order.filled_quantity + v_fill_qty,
      filled_avg_price = case
        when coalesce(v_order.filled_quantity, 0) > 0
        then round((coalesce(v_order.filled_avg_price, 0) * v_order.filled_quantity
                    + v_exec_price * v_fill_qty)
                   / (v_order.filled_quantity + v_fill_qty), 6)
        else v_exec_price end,
      filled_at = case when v_status = 'filled' then now() else v_order.filled_at end,
      total_value = coalesce(
        case
          when v_status = 'filled'
          then round(coalesce(v_order.filled_avg_price, 0) * coalesce(v_order.filled_quantity, 0)
                     + v_notional, 4)
          else v_order.total_value
        end,
        v_order.total_value)
  where id = v_order.id;

  insert into public.executions (
    order_id, classroom_id, student_id, asset_id, side,
    quantity, price, notional
  ) values (
    v_order.id, v_order.classroom_id, v_order.student_id, v_order.asset_id, v_order.side,
    v_fill_qty, v_exec_price, v_notional
  );

  update public.class_members
  set cash_balance = v_new_cash
  where id = v_member.id;

  insert into public.holdings as hg (
    classroom_id, student_id, asset_id, quantity, avg_cost, realized_pnl, updated_at
  ) values (
    v_order.classroom_id, v_order.student_id, v_order.asset_id, v_new_qty, v_new_avg,
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
  )
  select
    v_order.id, v_order.classroom_id, v_order.student_id, v_order.asset_id, v_order.side,
    v_fill_qty, v_exec_price, v_notional, v_realized, v_new_cash
  returning id into v_transaction_id;

  perform public.capture_snapshots(v_order.classroom_id, v_order.student_id);

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'filled_quantity', v_fill_qty::text,
    'execution_price', v_exec_price::text,
    'transaction_id', v_transaction_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6b. reset_student_portfolio(): extend 0001's version to also clear the
-- executions ledger for the student (orders cascade, transactions do not
-- know about executions). Kept re-runnable and behaviour-compatible.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 7. cancel_order(): student-initiated, own orders only
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(
  p_order_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND',
      'message', 'Order not found.');
  end if;

  -- Authorisation is ownership: only the student who placed it may cancel.
  if v_order.student_id is distinct from p_student_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN',
      'message', 'You can only cancel your own orders.');
  end if;

  if v_order.status not in ('pending', 'partially_filled') then
    return jsonb_build_object('ok', false, 'code', 'NOT_CANCELLABLE',
      'message', 'That order can no longer be cancelled.');
  end if;

  update public.orders
  set status = 'cancelled', cancelled_at = now()
  where id = p_order_id;

  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. expire_stale_orders(): called by the matching cron alongside fills
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.orders
  set status = 'expired'
  where status in ('pending', 'partially_filled')
    and expires_at is not null
    and expires_at < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. grant_teacher_cash(): teacher money as a ledger event, not a silent edit
-- ---------------------------------------------------------------------------
create or replace function public.grant_teacher_cash(
  p_classroom_id uuid,
  p_student_id   uuid,
  p_delta        numeric,
  p_reason       text,
  p_actor_id     uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_event text;
begin
  if p_delta is null or p_delta = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT',
      'message', 'Enter a non-zero amount.');
  end if;

  v_event := case when p_delta > 0 then 'teacher_credit' else 'teacher_debit' end;

  -- adjust_cash enforces the balance floor and moves initial_capital with the
  -- money, so grants never distort measured performance.
  v_result := public.adjust_cash(p_classroom_id, p_student_id, p_delta, p_reason, p_actor_id);

  if not coalesce((v_result ->> 'ok')::boolean, false) then
    return v_result;
  end if;

  insert into public.cash_events (
    classroom_id, student_id, event_type, amount, reason, actor_id
  ) values (
    p_classroom_id, p_student_id, v_event, abs(p_delta), p_reason, p_actor_id
  );

  return jsonb_build_object(
    'ok', true,
    'event', v_event,
    'amount', abs(p_delta)::text
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. get_leaderboard(): rank by return %, not absolute value (spec §8)
--
-- The return type changed (new rank column), so the function must be dropped
-- before it can be recreated — `create or replace` cannot change a signature.\n-- ---------------------------------------------------------------------------
drop function if exists public.get_leaderboard(uuid) cascade;

create function public.get_leaderboard(p_classroom_id uuid)
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
  with base as (
    select
      m.student_id,
      coalesce(nullif(trim(m.display_name), ''), nullif(trim(p.full_name), ''), 'Student') as display_name,
      p.full_name,
      p.login_handle,
      n.cash_balance,
      n.holdings_market_value as holdings_value,
      n.total_value,
      n.initial_capital,
      n.total_pnl,
      case
        when n.initial_capital > 0
        then round((n.total_pnl / n.initial_capital) * 100, 4)
        else 0
      end as total_pnl_percent,
      n.realized_pnl,
      n.trade_count,
      n.last_trade_at
    from public.class_members m
    join public.profiles p on p.id = m.student_id
    join lateral public._portfolio_numbers(p_classroom_id, m.student_id) n on n.is_member
    where m.classroom_id = p_classroom_id
      and m.status = 'active'
  )
  select
    b.student_id,
    b.display_name,
    b.full_name,
    b.login_handle,
    b.cash_balance,
    b.holdings_value,
    b.total_value,
    b.initial_capital,
    b.total_pnl,
    b.total_pnl_percent,
    b.realized_pnl,
    b.trade_count,
    b.last_trade_at,
    row_number() over (
      order by b.total_pnl_percent desc, b.total_value desc, b.display_name asc
    )::integer as rank_position
  from base b;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. service-role grants for the new functions
-- ---------------------------------------------------------------------------
revoke all on function public.place_order(uuid, uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.fill_order(uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.expire_stale_orders() from public, anon, authenticated;
revoke all on function public.grant_teacher_cash(uuid, uuid, numeric, text, uuid)
  from public, anon, authenticated;

grant execute on function public.place_order(uuid, uuid, text, text, text, text, text, text, text, text)
  to service_role;
grant execute on function public.fill_order(uuid, text) to service_role;
grant execute on function public.cancel_order(uuid, uuid) to service_role;
grant execute on function public.expire_stale_orders() to service_role;
grant execute on function public.grant_teacher_cash(uuid, uuid, numeric, text, uuid) to service_role;
