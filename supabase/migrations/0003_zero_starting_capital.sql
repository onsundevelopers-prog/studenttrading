-- ---------------------------------------------------------------------------
-- 0003 — Remove the fabricated $10,000 default starting capital.
--
-- Every new student now starts with zero cash unless the teacher explicitly
-- assigns funds (per student in the roster form, or per class in Controls).
-- The schema, the trading engine, RLS and the asset universe are untouched.
--
-- Run this after 0001/0002: Supabase SQL Editor → New query → paste → Run.
-- Safe to run again.
-- ---------------------------------------------------------------------------

-- New classrooms start their students at zero unless the teacher sets a value.
alter table public.class_settings
  alter column default_starting_capital set default 0;

-- Classrooms that never changed the old default keep carrying a fabricated
-- 10,000. Revert only those: any value a teacher chose for themselves is left
-- exactly as it is.
update public.class_settings
set default_starting_capital = 0,
    updated_at = now()
where default_starting_capital = 10000;

-- A student whose balance is still exactly the old default and who has never
-- traded holds nothing but the fabricated number. Zero them out. Anyone who
-- has traded, or whose balance differs for any other reason, is untouched —
-- this migration never invents or rewrites a real position.
update public.class_members m
set cash_balance    = 0,
    initial_capital = 0
where m.cash_balance = 10000
  and m.initial_capital = 10000
  and not exists (
    select 1
    from public.transactions t
    where t.classroom_id = m.classroom_id
      and t.student_id = m.student_id
  )
  and not exists (
    select 1
    from public.holdings h
    where h.classroom_id = m.classroom_id
      and h.student_id = m.student_id
      and h.quantity > 0
  );
