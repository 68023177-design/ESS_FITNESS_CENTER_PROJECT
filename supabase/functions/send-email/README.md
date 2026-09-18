# send-email (optional)

Small Supabase Edge Function that sends a confirmation / reminder email via
[Resend](https://resend.com). The in-app notification system (bell in the navbar)
works without this. Email is a separate add-on triggered by database events.

## 1. Secrets (Supabase Dashboard > Edge Functions > Secrets)

| Name           | Value                                          |
| -------------- | ---------------------------------------------- |
| `RESEND_API_KEY` | API key from https://resend.com                |
| `EDGE_SECRET`    | any long random string (shared with your SQL)  |

## 2. Deploy

```sh
npx --yes supabase functions deploy send-email
```

## 3. Trigger from the database

Enable the `pg_net` extension, then add this block inside
`safe_admin_approve_subscription()` / `admin_reject_subscription()` in
`sql/upgrade.sql` (replace `<project-ref>` and `__EDGE_SECRET__`):

```sql
-- inside the RPC after the update:
select net.http_post(
  url := 'https://<project-ref>.supabase.co/functions/v1/send-email',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer __EDGE_SECRET__'
  ),
  body := jsonb_build_object(
    'to', v_email,
    'subject', 'ESS Fitness Center - แจ้งผลการชำระเงิน',
    'html', '<p>คำสั่งซื้อ ' || v_sub.order_no || ' ได้รับการอนุมัติแล้ว</p>'
  )
);
```

## 4. Daily membership-expiry reminder

Add this to the existing pg_cron job in section 14 of `sql/upgrade.sql`:

```sql
select cron.schedule('ess-remind-expiring', '0 7 * * *', $cron$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer __EDGE_SECRET__'
    ),
    body := jsonb_build_object(
      'to', (select email from public.profiles p
             join public.subscriptions s on s.user_id = p.id
             where s.status = 'active'
               and s.end_date between current_date and current_date + 7
             limit 1),
      'subject', 'ESS Fitness Center - สิทธิ์ใกล้หมดอายุ',
      'html', 'ข้อความแจ้งเตือน...'
    )
  );
$cron$);
```