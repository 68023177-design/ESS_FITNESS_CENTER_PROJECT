-- ============================================================
-- ESS Fitness Center - check-in lookup hardening
-- Normalizes the scanned value (trim + lowercase) before matching
-- so a valid member QR is never rejected over case / whitespace.
-- Also the function already requires an authenticated caller.
-- Idempotent: safe to run more than once.
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
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  v_code := lower(btrim(p_member_code));

  select * into v_profile
    from public.profiles
    where lower(btrim(member_code::text)) = v_code;
  if not found then
    return query select false, 'ไม่พบสมาชิก ตรวจสอบคิวอาร์โค้ดอีกครั้ง',
      null::text, null::text, null::integer, null::integer;
    return;
  end if;

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

grant execute on function public.checkin_member(text) to authenticated;
revoke execute on function public.checkin_member(text) from public;
revoke execute on function public.checkin_member(text) from anon;