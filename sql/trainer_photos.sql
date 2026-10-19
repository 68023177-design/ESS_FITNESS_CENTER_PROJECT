-- ============================================================
-- ESS Fitness Center - Trainer photos (รูปภาพเทรนเนอร์)
-- Migration: เพิ่มคอลัมน์ image_path + bucket trainer-images
--             และอัปเดต RPC admin_create/update_trainer ให้รองรับรูป
-- ใช้กรณีฐานข้อมูลที่รัน sql/trainers_issues.sql ไปแล้ว
-- Idempotent: safe to run more than once.
-- ============================================================

-- ============================================================
-- 1) COLUMN: trainers.image_path
--    เก็บ path ใน storage (เช่น trainers/1712-ab12.jpg) ไม่ใช่ URL เต็ม
-- ============================================================
alter table public.trainers
  add column if not exists image_path text not null default '';

-- ============================================================
-- 2) STORAGE: bucket trainer-images (public)
--    public เพราะหน้า "รายชื่อเทรนเนอร์" แสดงรูปด้วย <img src> ตรง ๆ
--    (เขียน-ลบ จำกัดเฉพาะ admin เท่านั้น)
-- NOTE: INSERT...WHERE NOT EXISTS (no ON CONFLICT - storage.buckets
-- may lack a unique index on id on newer Supabase versions, 42P10)
-- ============================================================
insert into storage.buckets (id, name, public)
select 'trainer-images', 'trainer-images', true
where not exists (select 1 from storage.buckets where id = 'trainer-images');

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
-- 3) RPC: เวอร์ชันที่รองรับรูปภาพ
--    ลบ signature เดิมก่อน ไม่งั้น Postgres จะมี 2 overload
--    และเรียกด้วย named args จะเจอ "function call is ambiguous"
-- ============================================================
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
         -- p_image_path = null -> ไม่เปลี่ยนรูปเดิม, '' -> ลบรูป
         image_path = coalesce(p_image_path, trainers.image_path)
   where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.admin_update_trainer(uuid,text,text,text,text,boolean,text) from public, anon;
grant execute on function public.admin_update_trainer(uuid,text,text,text,text,boolean,text) to authenticated;
