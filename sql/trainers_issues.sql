-- ============================================================
-- ESS Fitness Center - Trainers & Maintenance Requests
-- Migration: เพิ่มระบบเทรนเนอร์ + ระบบแจ้งเหตุ
-- Idempotent: safe to run more than once.
-- ============================================================

-- ============================================================
-- 1) TABLE: trainers
-- ============================================================
create table if not exists public.trainers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  contact_type   text not null check (contact_type in ('phone','line','facebook','instagram','other')),
  contact_value  text not null,
  rate           text not null default '',
  image_path     text not null default '',
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- เผื่อกรณีตารางเดิมถูกสร้างมาก่อนหน้านี้แล้ว (ยังไม่มีคอลัมน์รูปภาพ)
alter table public.trainers
  add column if not exists image_path text not null default '';

create index if not exists trainers_active_idx
  on public.trainers (active, created_at desc);

alter table public.trainers enable row level security;

-- ----- RLS: trainers -----
-- SELECT: เฉพาะสมาชิกที่ล็อกอินเท่านั้น (A3)
drop policy if exists "trainers_select_auth" on public.trainers;
create policy "trainers_select_auth" on public.trainers
  for select using (auth.role() = 'authenticated');

-- INSERT/UPDATE/DELETE: เฉพาะ admin
drop policy if exists "trainers_insert_admin" on public.trainers;
create policy "trainers_insert_admin" on public.trainers
  for insert with check (public.is_admin());

drop policy if exists "trainers_update_admin" on public.trainers;
create policy "trainers_update_admin" on public.trainers
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "trainers_delete_admin" on public.trainers;
create policy "trainers_delete_admin" on public.trainers
  for delete using (public.is_admin());

-- ============================================================
-- 2) TABLE: maintenance_requests
-- ============================================================
create table if not exists public.maintenance_requests (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid references public.profiles(id) on delete set null,
  reporter_name  text not null default '',
  reporter_email text not null default '',
  title          text not null,
  category       text not null check (category in (
                    'equipment',        -- เครื่องออกกำลังกาย
                    'electrical',       -- ไฟฟ้า/แสงสว่าง
                    'plumbing',         -- น้ำ/สุขภัณฑ์
                    'structure',        -- โครงสร้าง/พื้น
                    'other'             -- อื่นๆ
                  )),
  location       text not null default '',
  description    text not null,
  image_path     text,
  status         text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  admin_note     text not null default '',
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists maintenance_requests_status_idx
  on public.maintenance_requests (status, created_at desc);

create index if not exists maintenance_requests_reporter_idx
  on public.maintenance_requests (reporter_id, created_at desc);

create index if not exists maintenance_requests_created_idx
  on public.maintenance_requests (created_at desc);

alter table public.maintenance_requests enable row level security;

-- ----- RLS: maintenance_requests -----
-- INSERT: ทุกคน (B5)
drop policy if exists "mr_insert_all" on public.maintenance_requests;
create policy "mr_insert_all" on public.maintenance_requests
  for insert with check (true);

-- SELECT
-- Admin: เห็นทั้งหมด
drop policy if exists "mr_select_admin" on public.maintenance_requests;
create policy "mr_select_admin" on public.maintenance_requests
  for select using (public.is_admin());

-- Authenticated: เห็นเฉพาะของตนเอง
drop policy if exists "mr_select_own" on public.maintenance_requests;
create policy "mr_select_own" on public.maintenance_requests
  for select using (auth.uid() = reporter_id);

-- UPDATE/DELETE: เฉพาะ admin
drop policy if exists "mr_update_admin" on public.maintenance_requests;
create policy "mr_update_admin" on public.maintenance_requests
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "mr_delete_admin" on public.maintenance_requests;
create policy "mr_delete_admin" on public.maintenance_requests
  for delete using (public.is_admin());

-- ============================================================
-- 3) STORAGE: buckets
--    - issue-images (private) : รูปแนบจากผู้แจ้งเหตุ
--    - trainer-images (public): รูปประจำเทรนเนอร์
-- ============================================================
insert into storage.buckets (id, name, public)
select 'issue-images', 'issue-images', false
where not exists (select 1 from storage.buckets where id = 'issue-images');

insert into storage.buckets (id, name, public)
select 'trainer-images', 'trainer-images', true
where not exists (select 1 from storage.buckets where id = 'trainer-images');

-- SELECT: admin หรือ owner
drop policy if exists "issue_img_select" on storage.objects;
create policy "issue_img_select" on storage.objects
  for select using (
    bucket_id = 'issue-images' and (
      public.is_admin() or auth.uid() = owner
    )
  );

-- INSERT: authenticated (ปลอดภัยกว่าการเปิดให้ anonymous upload)
drop policy if exists "issue_img_insert_auth" on storage.objects;
create policy "issue_img_insert_auth" on storage.objects
  for insert with check (
    bucket_id = 'issue-images' and auth.role() = 'authenticated'
  );

-- UPDATE: admin หรือ owner
drop policy if exists "issue_img_update" on storage.objects;
create policy "issue_img_update" on storage.objects
  for update using (
    bucket_id = 'issue-images' and (
      public.is_admin() or auth.uid() = owner
    )
  ) with check (
    bucket_id = 'issue-images' and (
      public.is_admin() or auth.uid() = owner
    )
  );

-- DELETE: admin
drop policy if exists "issue_img_delete_admin" on storage.objects;
create policy "issue_img_delete_admin" on storage.objects
  for delete using (
    bucket_id = 'issue-images' and public.is_admin()
  );

-- ----- trainer-images (public bucket) -----
drop policy if exists "trainer_img_select_public" on storage.objects;
create policy "trainer_img_select_public" on storage.objects
  for select using (bucket_id = 'trainer-images');

drop policy if exists "trainer_img_insert_admin" on storage.objects;
create policy "trainer_img_insert_admin" on storage.objects
  for insert with check (bucket_id = 'trainer-images' and public.is_admin());

drop policy if exists "trainer_img_update_admin" on storage.objects;
create policy "trainer_img_update_admin" on storage.objects
  for update using (bucket_id = 'trainer-images' and public.is_admin())
  with check (bucket_id = 'trainer-images' and public.is_admin());

drop policy if exists "trainer_img_delete_admin" on storage.objects;
create policy "trainer_img_delete_admin" on storage.objects
  for delete using (bucket_id = 'trainer-images' and public.is_admin());

-- ============================================================
-- 4) TRIGGER: auto-update updated_at
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_trainers_updated_at on public.trainers;
create trigger trg_trainers_updated_at
  before update on public.trainers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_mr_updated_at on public.maintenance_requests;
create trigger trg_mr_updated_at
  before update on public.maintenance_requests
  for each row execute function public.set_updated_at();

-- ============================================================
-- 5) RPC: Trainers (admin CRUD) - สอดคล้องกับแนวทาง admin_*
--    p_image_path = null -> ไม่เปลี่ยนรูปเดิม, '' -> ลบรูป
-- ============================================================

-- ลบ signature เดิม (ที่ยังไม่รองรับรูป) ก่อน ไม่งั้นจะมี 2 overload
-- และเรียกด้วย named args จะเจอ "function call is ambiguous"
drop function if exists public.admin_create_trainer(text,text,text,text,boolean);
drop function if exists public.admin_update_trainer(uuid,text,text,text,text,boolean);

create or replace function public.admin_create_trainer(
  p_name text,
  p_contact_type text,
  p_contact_value text,
  p_rate text,
  p_active boolean default true,
  p_image_path text default null
)
returns public.trainers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trainers%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  insert into public.trainers (name, contact_type, contact_value, rate, active, image_path)
  values (p_name, p_contact_type, p_contact_value, p_rate, coalesce(p_active,true), coalesce(p_image_path,''))
  returning * into v_row;
  return v_row;
end;
$$;

drop policy if exists "trainers_rpc_block_anon" on public.trainers;
revoke all on function public.admin_create_trainer(text,text,text,text,boolean,text) from public, anon;
grant execute on function public.admin_create_trainer(text,text,text,text,boolean,text) to authenticated;

create or replace function public.admin_update_trainer(
  p_id uuid,
  p_name text,
  p_contact_type text,
  p_contact_value text,
  p_rate text,
  p_active boolean,
  p_image_path text default null
)
returns public.trainers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trainers%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  update public.trainers
     set name = p_name,
         contact_type = p_contact_type,
         contact_value = p_contact_value,
         rate = p_rate,
         active = p_active,
         image_path = coalesce(p_image_path, trainers.image_path)
   where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.admin_update_trainer(uuid,text,text,text,text,boolean,text) from public, anon;
grant execute on function public.admin_update_trainer(uuid,text,text,text,text,boolean,text) to authenticated;

create or replace function public.admin_toggle_trainer_active(p_id uuid, p_active boolean)
returns public.trainers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.trainers%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  update public.trainers set active = p_active where id = p_id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.admin_toggle_trainer_active(uuid,boolean) from public, anon;
grant execute on function public.admin_toggle_trainer_active(uuid,boolean) to authenticated;

create or replace function public.admin_delete_trainer(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  delete from public.trainers where id = p_id;
end;
$$;

revoke all on function public.admin_delete_trainer(uuid) from public, anon;
grant execute on function public.admin_delete_trainer(uuid) to authenticated;

-- ============================================================
-- 6) RPC: Maintenance Requests (admin)
-- ============================================================
create or replace function public.admin_list_maintenance_requests(p_status text default null)
returns setof public.maintenance_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  if p_status is null or trim(p_status) = '' then
    return query
      select * from public.maintenance_requests
      order by created_at desc;
  else
    return query
      select * from public.maintenance_requests
      where status = p_status
      order by created_at desc;
  end if;
end;
$$;

revoke all on function public.admin_list_maintenance_requests(text) from public, anon;
grant execute on function public.admin_list_maintenance_requests(text) to authenticated;

create or replace function public.admin_update_maintenance_request(
  p_id uuid,
  p_status text,
  p_admin_note text default ''
)
returns public.maintenance_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.maintenance_requests%rowtype;
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  update public.maintenance_requests
     set status = p_status,
         admin_note = coalesce(p_admin_note, ''),
         resolved_at = case when p_status in ('resolved','closed') then now() else resolved_at end
   where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.admin_update_maintenance_request(uuid,text,text) from public, anon;
grant execute on function public.admin_update_maintenance_request(uuid,text,text) to authenticated;

create or replace function public.admin_delete_maintenance_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;
  delete from public.maintenance_requests where id = p_id;
end;
$$;

revoke all on function public.admin_delete_maintenance_request(uuid) from public, anon;
grant execute on function public.admin_delete_maintenance_request(uuid) to authenticated;
