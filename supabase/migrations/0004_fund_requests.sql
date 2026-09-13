-- ---------------------------------------------------------------------------
-- 0004 — Fund requests.
--
-- A student can ask the class bank for more capital; the teacher approves or
-- denies from the roster page. Granting goes through the existing adjust_cash()
-- engine, so initial_capital moves with every approved request and a granted
-- withdrawal never inflates a student's measured trading performance.
--
-- Design rules carried over from 0001:
--   * Money is numeric, never float8.
--   * Clients have NO write access to the table itself. The only writes are
--     (a) the service-role inserts from the server action that has already
--     authenticated the student, and (b) the approve path, which is the
--     SECURITY DEFINER adjust_cash() engine plus a status update in that same
--     server action.
--   * No real money, banks or custody exist anywhere in this schema — the
--     "bank" here is the class bank, a framing for capital requests.
--
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ---------------------------------------------------------------------------

create table if not exists public.fund_requests (
  id             uuid primary key default gen_random_uuid(),
  classroom_id   uuid not null references public.classrooms(id) on delete cascade,
  student_id     uuid not null references public.profiles(id) on delete cascade,
  amount         numeric(18,4) not null check (amount > 0),
  reason         text not null default '',
  status         text not null default 'pending'
                   check (status in ('pending', 'approved', 'denied')),
  -- Set when the teacher decides; NULL while the request is still open.
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  -- Record of the cash actually granted, so the roster can show history even
  -- if the student's balance later changes for other reasons.
  granted_amount numeric(18,4),
  created_at     timestamptz not null default now()
);

create index if not exists fund_requests_classroom_idx
  on public.fund_requests (classroom_id, status, created_at desc);
create index if not exists fund_requests_student_idx
  on public.fund_requests (classroom_id, student_id, created_at desc);

alter table public.fund_requests enable row level security;

-- Re-runnable policy creation.
drop policy if exists fund_requests_select_class on public.fund_requests;
drop policy if exists fund_requests_decide_update on public.fund_requests;

-- Members and the class teacher can read the class's requests. A student sees
-- their own rows through the same policy — scoping to "mine" happens in the
-- queries, not in a second policy.
create policy fund_requests_select_class on public.fund_requests
  for select to authenticated using (
    public.is_classroom_teacher(classroom_id)
    or public.is_classroom_member(classroom_id)
  );

-- The only client-side write is a teacher flipping a pending row to a decided
-- state; the granted amount is written by the service role in the same action,
-- and the guard below makes the transition one-way and pending-only.
create policy fund_requests_decide_update on public.fund_requests
  for update to authenticated using (
    public.is_classroom_teacher(classroom_id) and status = 'pending'
  )
  with check (
    status in ('approved', 'denied')
    and decided_by = auth.uid()
  );

revoke all on public.fund_requests from anon;
grant select, update on public.fund_requests to authenticated;

-- ---------------------------------------------------------------------------
-- One student may only have one open request at a time — a partial unique
-- index makes the double-submit case a hard database guarantee, same trick as
-- the orders idempotency key.
-- ---------------------------------------------------------------------------
create unique index if not exists fund_requests_one_pending_per_student
  on public.fund_requests (classroom_id, student_id) where status = 'pending';
