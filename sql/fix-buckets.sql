-- ============================================================
-- ESS Fitness Center - bucket upsert fix
-- storage.buckets on newer Supabase has no unique index on id,
-- so `on conflict (id)` fails with ERROR 42P10. Use a guarded
-- insert instead. Idempotent: safe to run more than once.
-- ============================================================

insert into storage.buckets (id, name, public)
select 'slips', 'slips', false
where not exists (select 1 from storage.buckets where id = 'slips');

insert into storage.buckets (id, name, public)
select 'announcements', 'announcements', true
where not exists (select 1 from storage.buckets where id = 'announcements');