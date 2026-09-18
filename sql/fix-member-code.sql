-- ============================================================
-- ESS Fitness Center - FIX: new signups had no member_code
-- Root cause: profiles.member_code had no DEFAULT, and the
-- signup trigger (handle_new_user) doesn't set it, so everyone
-- who registered after the original migration got NULL -> no QR.
-- This makes the column self-fill forever and backfills existing
-- NULL rows. Idempotent: safe to run more than once.
-- To verify after running:
--   select id, email, member_code from public.profiles
--   where member_code is null;   -- expect 0 rows
-- ============================================================

alter table public.profiles alter column member_code set default gen_random_uuid();

update public.profiles set member_code = gen_random_uuid() where member_code is null;

-- ============================================================
-- OPTIONAL cleanup of E2E test data created during verification
-- (only needed if you want the test users/subscriptions removed)
-- ============================================================
-- delete from public.visits        where user_id in (select id from auth.users where email like 'e2e%@ess.local' or email like 'test%@ess.local');
-- delete from public.subscriptions  where user_id in (select id from auth.users where email like 'e2e%@ess.local' or email like 'test%@ess.local');
-- delete from public.notifications  where user_id in (select id from auth.users where email like 'e2e%@ess.local' or email like 'test%@ess.local');
-- delete from public.profiles       where id in (select id from auth.users where email like 'e2e%@ess.local' or email like 'test%@ess.local');
-- delete from auth.users            where email like 'e2e%@ess.local' or email like 'test%@ess.local';