-- ============================================================
-- ESS Fitness Center - Fix: announcements (ข่าวสาร / ระบบโพส)
-- The live database is missing the announcements table + bucket.
-- Paste this into Supabase SQL Editor and run once.
-- Idempotent: safe to run more than once.
-- ============================================================

-- ----- TABLE: announcements -----
create table if not exists public.announcements (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  content      text not null default '',
  image_url    text,
  author_id    uuid references public.profiles(id) on delete set null,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists announcements_published_idx
  on public.announcements (is_published, created_at desc);

alter table public.announcements enable row level security;

-- ----- RLS POLICIES -----
-- everyone can read published news; admins can see all (incl. drafts)
drop policy if exists "announcements_select_public" on public.announcements;
create policy "announcements_select_public" on public.announcements
  for select using (is_published = true);

drop policy if exists "announcements_select_admin" on public.announcements;
create policy "announcements_select_admin" on public.announcements
  for select using (public.is_admin());

drop policy if exists "announcements_insert_admin" on public.announcements;
create policy "announcements_insert_admin" on public.announcements
  for insert with check (public.is_admin());

drop policy if exists "announcements_update_admin" on public.announcements;
create policy "announcements_update_admin" on public.announcements
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "announcements_delete_admin" on public.announcements;
create policy "announcements_delete_admin" on public.announcements
  for delete using (public.is_admin());

-- ----- STORAGE: public bucket for announcement cover images -----
-- NOTE: INSERT...WHERE NOT EXISTS (no ON CONFLICT - storage.buckets
-- may lack a unique index on id on newer Supabase versions, 42P10)
insert into storage.buckets (id, name, public)
select 'announcements', 'announcements', true
where not exists (select 1 from storage.buckets where id = 'announcements');

drop policy if exists "announcements_img_insert_auth" on storage.objects;
create policy "announcements_img_insert_auth" on storage.objects
  for insert with check (bucket_id = 'announcements' and auth.role() = 'authenticated' and public.is_admin());

drop policy if exists "announcements_img_select_public" on storage.objects;
create policy "announcements_img_select_public" on storage.objects
  for select using (bucket_id = 'announcements');

drop policy if exists "announcements_img_update_owner" on storage.objects;
create policy "announcements_img_update_owner" on storage.objects
  for update using (bucket_id = 'announcements' and (auth.uid() = owner or public.is_admin()));

drop policy if exists "announcements_img_delete_admin" on storage.objects;
create policy "announcements_img_delete_admin" on storage.objects
  for delete using (bucket_id = 'announcements' and public.is_admin());