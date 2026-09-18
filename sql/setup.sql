-- ============================================================
-- ESS Fitness Center (University of Phayao) - Sprint 1
-- Idempotent: safe to run more than once.
-- Can be executed in Supabase SQL Editor or via Management API.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- TABLE: profiles  (created before is_admin() because is_admin
-- is a LANGUAGE sql function and its body is validated on create)
-- ============================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  student_id  text not null default '',
  phone       text not null default '',
  sex         text not null default 'other' check (sex in ('male','female','other')),
  role        text not null default 'user' check (role in ('user','admin')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

-- ============================================================
-- HELPER: is_admin()
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ============================================================
-- TRIGGER: create a profile row automatically on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, student_id, phone, sex)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'student_id', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'sex', 'other')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- TABLE: packages
-- ============================================================
create table if not exists public.packages (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text not null default '',
  price           numeric(10,2) not null check (price >= 0),
  duration_months integer not null default 1 check (duration_months > 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- TABLE: subscriptions
-- ============================================================
create table if not exists public.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  package_id   uuid not null references public.packages(id),
  package_name text not null,
  amount       numeric(10,2) not null,
  status       text not null default 'pending'
               check (status in ('pending','active','rejected','expired')),
  slip_path    text,
  start_date   date,
  end_date     date,
  admin_note   text not null default '',
  paid_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists subscriptions_user_idx on public.subscriptions (user_id);
create index if not exists subscriptions_status_idx on public.subscriptions (status);

-- ============================================================
-- TABLE: settings
-- ============================================================
create table if not exists public.settings (
  key    text primary key,
  value  text not null default ''
);

insert into public.settings (key, value)
values
  ('promptpay_id', '0643453115') -- merchant PromptPay mobile number (10) / national ID (13)
on conflict (key) do nothing;

insert into public.settings (key, value)
values
  ('gym_name', 'ESS Fitness Center')
on conflict (key) do nothing;

-- ============================================================
-- SEED: default packages
-- ============================================================
insert into public.packages (name, description, price, duration_months, is_active)
select * from (values
  ('แพคเกจรายเดือน',         'สิทธิ์เข้าใช้ยิมตามรอบเดือน 30 วัน',   300::numeric(10,2), 1, true),
  ('แพคเกจ 3 เดือน',         'สิทธิ์เข้าใช้ยิม 3 เดือน ประหยัดกว่า',   800::numeric(10,2), 3, true),
  ('แพคเกจ 6 เดือน',         'สิทธิ์เข้าใช้ยิม 6 เดือน คุ้มสุด',      1400::numeric(10,2), 6, true),
  ('แพคเกจรายปี (12 เดือน)', 'สิทธิ์เข้าใช้ยิม 12 เดือน ราคาพิเศษ',   2500::numeric(10,2), 12, true)
) as v(name, description, price, duration_months, is_active)
where not exists (select 1 from public.packages);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles      enable row level security;
alter table public.packages      enable row level security;
alter table public.subscriptions enable row level security;
alter table public.settings      enable row level security;

-- ----- profiles -----
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select using (public.is_admin());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin());

-- ----- packages (public read, admin write) -----
drop policy if exists "packages_select_public" on public.packages;
create policy "packages_select_public" on public.packages
  for select using (true);

drop policy if exists "packages_insert_admin" on public.packages;
create policy "packages_insert_admin" on public.packages
  for insert with check (public.is_admin());

drop policy if exists "packages_update_admin" on public.packages;
create policy "packages_update_admin" on public.packages
  for update using (public.is_admin());

drop policy if exists "packages_delete_admin" on public.packages;
create policy "packages_delete_admin" on public.packages
  for delete using (public.is_admin());

-- ----- subscriptions (own read/insert, admin all) -----
drop policy if exists "subs_select_own" on public.subscriptions;
create policy "subs_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "subs_select_admin" on public.subscriptions;
create policy "subs_select_admin" on public.subscriptions
  for select using (public.is_admin());

drop policy if exists "subs_insert_own" on public.subscriptions;
create policy "subs_insert_own" on public.subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists "subs_update_admin" on public.subscriptions;
create policy "subs_update_admin" on public.subscriptions
  for update using (public.is_admin()) with check (public.is_admin());

-- owner may update their own order only while it is still pending (e.g. attach a slip)
drop policy if exists "subs_update_owner_pending" on public.subscriptions;
create policy "subs_update_owner_pending" on public.subscriptions
  for update using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status = 'pending');

-- ----- settings (public read, admin write) -----
drop policy if exists "settings_select_public" on public.settings;
create policy "settings_select_public" on public.settings
  for select using (true);

drop policy if exists "settings_insert_admin" on public.settings;
create policy "settings_insert_admin" on public.settings
  for insert with check (public.is_admin());

drop policy if exists "settings_update_admin" on public.settings;
create policy "settings_update_admin" on public.settings
  for update using (public.is_admin());

-- ============================================================
-- STORAGE: private bucket for payment slips
-- NOTE: use INSERT...WHERE NOT EXISTS - storage.buckets may have no
-- unique index on id on newer Supabase versions, which makes the
-- ON CONFLICT clause fail with SQLSTATE 42P10.
insert into storage.buckets (id, name, public)
select 'slips', 'slips', false
where not exists (select 1 from storage.buckets where id = 'slips');

drop policy if exists "slips_insert_auth" on storage.objects;
create policy "slips_insert_auth" on storage.objects
  for insert with check (bucket_id = 'slips' and auth.role() = 'authenticated');

drop policy if exists "slips_select_owner" on storage.objects;
create policy "slips_select_owner" on storage.objects
  for select using (bucket_id = 'slips' and owner = auth.uid());

drop policy if exists "slips_select_admin" on storage.objects;
create policy "slips_select_admin" on storage.objects
  for select using (bucket_id = 'slips' and public.is_admin());

-- ============================================================
-- TABLE: announcements (news / announcements from admin)
-- ============================================================
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

-- ============================================================
-- STORAGE: public bucket for announcement cover images
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

-- ============================================================
-- AFTER SETUP: promote the first account to admin
-- Run this after creating your admin account (replace the email):
--   update public.profiles set role = 'admin'
--   where email = 'you@example.com';
-- ============================================================
