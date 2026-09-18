-- ============================================================
-- ESS Fitness Center - one-time test-data cleanup helper
-- This ONLY deletes accounts whose email ends with @ess.local
-- (the throwaway accounts created during E2E verification).
-- Real members/orders are NOT touched.
-- Guarded by is_admin(): only admins may call it.
-- Paste + Run once to CREATE it, then it is invoked via the app
-- (RPC) by the admin. Can be dropped afterwards if not wanted.
-- ============================================================

create or replace function public.cleanup_test_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'permission denied';
  end if;

  delete from public.visits
    where user_id in (select id from auth.users where email like '%ess.local');
  delete from public.subscriptions
    where user_id in (select id from auth.users where email like '%ess.local');
  delete from public.notifications
    where user_id in (select id from auth.users where email like '%ess.local');
  delete from public.profiles
    where id in (select id from auth.users where email like '%ess.local');

  delete from auth.users where email like '%ess.local';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function public.cleanup_test_data() to authenticated;
revoke execute on function public.cleanup_test_data() from public;
revoke execute on function public.cleanup_test_data() from anon;

-- To fully remove this helper afterwards:
--   drop function if exists public.cleanup_test_data();