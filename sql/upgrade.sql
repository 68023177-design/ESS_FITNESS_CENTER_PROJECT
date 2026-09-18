-- ============================================================
-- ESS Fitness Center (University of Phayao) - Upgrade
-- Adds: member QR check-in, order_no, order lifecycle (cancel /
-- resubmit / timeout), notifications & admin RPCs.
-- Idempotent: safe to run more than once (Supabase SQL Editor).
-- ============================================================

-- ============================================================
-- 1) PROFILES: member_code for QR membership cards
-- ============================================================
alter table public.profiles add column if not exists member_code uuid;

-- PENDING/NEW signups must get a QR code automatically (the signup
-- trigger does not set it), so the column must self-fill by default.
alter table public.profiles alter column member_code set default gen_random_uuid();

update public.profiles set member_code = gen_random_uuid() where member_code is null;

create unique index if not exists profiles_member_code_idx
  on public.profiles (member_code);

-- ============================================================
-- 2) SUBSCRIPTIONS: human-friendly order number + cancelled status
-- ============================================================
alter table public.subscriptions add column if not exists order_no text;

create or replace function public.gen_order_no()
returns text
language sql
stable
set search_path = public
as $$
  select 'ESS-' || to_char(now(), 'YYYYMM') || '-' ||
         upper(substr(md5(gen_random_uuid()::text), 1, 8));
$$;

update public.subscriptions set order_no = public.gen_order_no() where order_no is null;

create unique index if not exists subscriptions_order_no_idx
  on public.subscriptions (order_no);

drop trigger if exists trg_subscriptions_order_no on public.subscriptions;

create or replace function public.handle_sub_order_no()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.order_no is null then
    new.order_no := public.gen_order_no();
  end if;
  return new;
end;
$$;

create trigger trg_subscriptions_order_no
  before insert on public.subscriptions
  for each row execute function public.handle_sub_order_no();

-- allow 'cancelled' status (timeout / user cancel)
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in ('pending','active','rejected','expired','cancelled'));

-- ============================================================
-- 3) VISITS: gym check-in log
-- ============================================================
create table if not exists public.visits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  sub_id        uuid references public.subscriptions(id) on delete set null,
  checked_in_at timestamptz not null default now(),
  checkin_by    uuid references public.profiles(id) on delete set null
);

create index if not exists visits_user_idx
  on public.visits (user_id, checked_in_at desc);
create index if not exists visits_at_idx
  on public.visits (checked_in_at desc);

alter table public.visits enable row level security;

drop policy if exists "visits_select_admin" on public.visits;
create policy "visits_select_admin" on public.visits
  for select using (public.is_admin());

drop policy if exists "visits_select_own" on public.visits;
create policy "visits_select_own" on public.visits
  for select using (auth.uid() = user_id);

drop policy if exists "visits_select_operator" on public.visits;
create policy "visits_select_operator" on public.visits
  for select using (auth.uid() = checkin_by);

-- ============================================================
-- 4) NOTIFICATIONS: in-app alerts
-- ============================================================
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  body       text not null default '',
  link       text not null default '',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update using (auth.uid() = user_id);

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 5) RPC: checkin_member() - server-side gate for the front desk
-- ============================================================
create or replace function public.checkin_member(p_member_code text)
returns table (
  ok           boolean,
  message      text,
  full_name    text,
  package_name text,
  days_left    integer,
  visit_count  integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_sub     public.subscriptions%rowtype;
  v_code    text;
  v_count   integer;
begin
  -- only authenticated users may check members in (anonymous locked out)
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  -- normalize the scanned code: drop outer whitespace, ignore case
  v_code := lower(btrim(p_member_code));

  select * into v_profile
    from public.profiles
    where lower(btrim(member_code::text)) = v_code;
  if not found then
    return query select false, 'ไม่พบสมาชิก ตรวจสอบคิวอาร์โค้ดอีกครั้ง',
      null::text, null::text, null::integer, null::integer;
    return;
  end if;

  -- lazy expiry: flip any active subs that already passed end_date
  update public.subscriptions set status = 'expired'
    where user_id = v_profile.id and status = 'active' and end_date < current_date;

  select * into v_sub
    from public.subscriptions
    where user_id = v_profile.id and status = 'active'
    order by end_date desc
    limit 1;
  if not found then
    return query select false, 'สมาชิกไม่มีแพคเกจที่ใช้งานอยู่ (หมดอายุแล้ว)',
      v_profile.full_name, null::text, null::integer, null::integer;
    return;
  end if;

  -- anti double-tap: ignore a second scan within 10 seconds
  if exists (
    select 1 from public.visits
    where user_id = v_profile.id and checked_in_at > now() - interval '10 seconds'
  ) then
    select count(*) into v_count from public.visits where user_id = v_profile.id;
    return query select true,
      'เช็คอินซ้ำภายใน 10 วินาที — ถือว่าเป็นการเช็คอินครั้งนี้แล้ว',
      v_profile.full_name, v_sub.package_name,
      (v_sub.end_date - current_date), v_count;
    return;
  end if;

  insert into public.visits (user_id, sub_id, checkin_by)
  values (v_profile.id, v_sub.id, auth.uid());

  select count(*) into v_count from public.visits where user_id = v_profile.id;
  return query select true, 'เช็คอินสำเร็จ ยินดีต้อนรับเข้าศูนย์ฯ',
    v_profile.full_name, v_sub.package_name,
    (v_sub.end_date - current_date), v_count;
end;
$$;

-- ============================================================
-- 6) RPC: expire_subscriptions() - active -> expired after end_date
-- ============================================================
create or replace function public.expire_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.subscriptions set status = 'expired'
    where status = 'active' and end_date < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================
-- 7) RPC: expire_pending_orders(hours) - timeout stale orders
-- ============================================================
create or replace function public.expire_pending_orders(p_hours integer default 48)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.subscriptions set status = 'cancelled'
    where status = 'pending'
      and created_at < now() - make_interval(hours => p_hours);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================
-- 8) RPC: cancel_subscription(id) - owner cancels a pending order
-- ============================================================
create or replace function public.cancel_subscription(p_sub_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions set status = 'cancelled'
    where id = p_sub_id and user_id = auth.uid() and status = 'pending';
  return found;
end;
$$;

-- ============================================================
-- 9) RPC: resubmit_subscription(id, slip_path) - rejected -> pending
--     NOTE: the replaced slip is removed CLIENT-side via the
--     Storage API (slips_delete_owner policy). Direct deletes on
--     storage.objects are blocked by Supabase, so this function
--     only swaps the metadata.
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

-- ============================================================
-- 10) RPC: admin_approve_subscription(id, note) - approve payment,
--     mark active with non-overlapping dates when renewing
-- ============================================================
create or replace function public.admin_approve_subscription(
  p_sub_id      uuid,
  p_admin_note  text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub     public.subscriptions%rowtype;
  v_pkg     public.packages%rowtype;
  v_months  integer;
  v_start   date;
  v_end     date;
  v_max_end date;
  v_email   text;
begin
  if not public.is_admin() then
    raise exception 'permission denied';
  end if;

  select * into v_sub from public.subscriptions where id = p_sub_id;
  if not found or v_sub.status <> 'pending' then
    return false;
  end if;

  select * into v_pkg from public.packages where id = v_sub.package_id;
  v_months := coalesce(v_pkg.duration_months, 1);

  -- renewal overlap guard: new validity starts the day after the
  -- latest active sub ends (or today when nothing is running)
  select max(end_date) into v_max_end
    from public.subscriptions
    where user_id = v_sub.user_id and status = 'active';
  v_start := greatest(current_date, coalesce(v_max_end, current_date - 1) + 1);
  v_end   := (v_start + make_interval(months => v_months))::date;

  update public.subscriptions
    set status = 'active',
        start_date = v_start,
        end_date   = v_end,
        paid_at    = now(),
        admin_note = p_admin_note
    where id = p_sub_id;

  select email into v_email from public.profiles where id = v_sub.user_id;

  insert into public.notifications (user_id, title, body, link)
  values (
    v_sub.user_id,
    'ชำระเงินอนุมัติแล้ว',
    'แพคเกจ ' || v_sub.package_name || ' ใช้งานได้ถึง ' ||
      to_char(v_end, 'DD/MM/YYYY') || ' (เลขที่คำสั่งซื้อ ' || v_sub.order_no || ')',
    'profile.html'
  );

  return true;
end;
$$;

-- ============================================================
-- 11) RPC: admin_reject_subscription(id, note)
-- ============================================================
create or replace function public.admin_reject_subscription(
  p_sub_id uuid,
  p_note   text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  if not public.is_admin() then
    raise exception 'permission denied';
  end if;

  select * into v_sub from public.subscriptions where id = p_sub_id;
  if not found or v_sub.status <> 'pending' then
    return false;
  end if;

  update public.subscriptions
    set status = 'rejected', admin_note = p_note
    where id = p_sub_id;

  insert into public.notifications (user_id, title, body, link)
  values (
    v_sub.user_id,
    'ชำระเงินไม่ผ่านการอนุมัติ',
    'คำสั่งซื้อ ' || v_sub.order_no || ' ถูกไม่อนุมัติ' ||
      case when p_note <> '' then ' — ' || p_note else '' end ||
      ' คุณสามารถส่งสลิปใหม่ได้จากหน้าโปรไฟล์',
    'profile.html'
  );

  return true;
end;
$$;

-- ============================================================
-- 12) STORAGE: allow owner to delete their own slip (used by
--     resubmit cleanup + manual tidy)
-- ============================================================
drop policy if exists "slips_delete_owner" on storage.objects;
create policy "slips_delete_owner" on storage.objects
  for delete using (bucket_id = 'slips' and owner = auth.uid());

-- ============================================================
-- 13) GRANTS: authenticated users may call the RPCs
-- ============================================================
grant execute on function public.gen_order_no() to authenticated;
grant execute on function public.handle_sub_order_no() to authenticated;
grant execute on function public.checkin_member(text) to authenticated;
grant execute on function public.expire_subscriptions() to authenticated;
grant execute on function public.expire_pending_orders(integer) to authenticated;
grant execute on function public.cancel_subscription(uuid) to authenticated;
grant execute on function public.resubmit_subscription(uuid, text) to authenticated;
grant execute on function public.admin_approve_subscription(uuid, text) to authenticated;
grant execute on function public.admin_reject_subscription(uuid, text) to authenticated;

-- lock anonymous callers out (the app always runs as authenticated)
revoke execute on function public.gen_order_no() from public;
revoke execute on function public.handle_sub_order_no() from public;
revoke execute on function public.checkin_member(text) from public;
revoke execute on function public.expire_subscriptions() from public;
revoke execute on function public.expire_pending_orders(integer) from public;
revoke execute on function public.cancel_subscription(uuid) from public;
revoke execute on function public.resubmit_subscription(uuid, text) from public;
revoke execute on function public.admin_approve_subscription(uuid, text) from public;
revoke execute on function public.admin_reject_subscription(uuid, text) from public;

-- Supabase also grants new functions directly to `anon` (not just PUBLIC)
revoke execute on function public.gen_order_no() from anon;
revoke execute on function public.handle_sub_order_no() from anon;
revoke execute on function public.checkin_member(text) from anon;
revoke execute on function public.expire_subscriptions() from anon;
revoke execute on function public.expire_pending_orders(integer) from anon;
revoke execute on function public.cancel_subscription(uuid) from anon;
revoke execute on function public.resubmit_subscription(uuid, text) from anon;
revoke execute on function public.admin_approve_subscription(uuid, text) from anon;
revoke execute on function public.admin_reject_subscription(uuid, text) from anon;

-- ============================================================
-- 14) OPTIONAL: daily maintenance schedule (pg_cron)
--     Enable "pg_cron" in Supabase Dashboard > Database > Extensions,
--     then uncomment and run once:
-- ============================================================
-- insert into cron.job (schedule, command, jobname) values
-- ('0 3 * * *',
--  $$ select public.expire_subscriptions(); select public.expire_pending_orders(48); $$,
--  'ess-fitness-expire')
-- on conflict (jobname) do nothing;