-- ===========================================================================
-- PaperDesk — Migration 0002
-- Fix: get_class_overview() referenced a column that does not exist
-- ---------------------------------------------------------------------------
-- `get_class_overview()` reads the leaderboard internally to name the leading
-- and lagging students. It was selecting `label`, but that is only an alias
-- inside get_leaderboard()'s own CTE — the column the function actually exposes
-- through its RETURNS TABLE signature is `display_name`.
--
-- The result was a hard failure on every call:
--     column "label" does not exist
-- which took out the whole teacher overview (class totals, best/worst performer,
-- recent activity) while leaving the rest of the app working, so it was easy to
-- miss. The local PGlite suite never called this function; both the suite and
-- the live end-to-end script now do.
--
-- Safe to run on a database that has only had 0001: it replaces one function and
-- touches no data. Also harmless to re-run.
--
-- If you are setting up from scratch you can run 0001 and then 0002, or just
-- 0001 — it already contains the corrected function.
-- ===========================================================================

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
