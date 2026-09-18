-- ============================================================
-- ESS Fitness Center - FIX: resubmit_subscription returned 403
-- Root cause: the function deleted the old slip via a direct
-- `delete from storage.objects`, which Supabase explicitly
-- blocks (SQLSTATE 42501) - so resubmit always failed whenever
-- a previous slip existed (and rolled back the status change).
-- Fix: swap only the metadata; the app now removes the old slip
-- through the Storage API (slips_delete_owner policy).
-- Idempotent: safe to run more than once.
-- ============================================================

create or replace function public.resubmit_subscription(
  p_sub_id    uuid,
  p_slip_path text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
    set status = 'pending', slip_path = p_slip_path, admin_note = ''
    where id = p_sub_id and status = 'rejected'
      and user_id = auth.uid();
  if not found then
    return false;
  end if;

  return true;
end;
$$;

-- To verify after running:
--   select proname, prosrc from pg_proc where proname = 'resubmit_subscription';
-- expect NO "storage.objects" in prosrc.