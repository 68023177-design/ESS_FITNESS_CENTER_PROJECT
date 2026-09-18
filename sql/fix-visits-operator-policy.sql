-- ============================================================
-- ESS Fitness Center - show recorded check-ins to the operator
-- The check-in page (loadToday) reads visits. RLS only allowed
-- admins (is_admin) and the member themselves (user_id) to see
-- rows, so a non-admin operator scanning other members saw an
-- empty "เข้าวันนี้" list even though visits were recorded.
-- This adds a policy letting the operator who scanned (checkin_by)
-- select the visits they recorded. Idempotent: safe to re-run.
-- ============================================================

drop policy if exists "visits_select_operator" on public.visits;
create policy "visits_select_operator" on public.visits
  for select using (auth.uid() = checkin_by);