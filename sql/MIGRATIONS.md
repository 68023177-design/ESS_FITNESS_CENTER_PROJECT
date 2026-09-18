# SQL Migrations — ESS Fitness Center

สคริปต์ในโฟลเดอร์นี้ถูก apply เข้าฐานข้อมูล Supabase ผ่าน **SQL Editor** ทั้งหมด ทุกไฟล์ออกแบบมาให้ **idempotent** (รันซ้ำได้โดยไม่พัง)

## ลำดับการติดตั้งฐานข้อมูลใหม่ (จากศูนย์)

| ลำดับ | ไฟล์ | ทำอะไร |
| --- | --- | --- |
| 1 | `setup.sql` | schema ฐาน (profiles, packages, subscriptions, settings, announcements), RLS, bucket `slips` (ส่วนตัว) + `announcements` (สาธารณะ), seed แพคเกจ + `promptpay_id`, หมายเหตุ: ยังไม่มี `member_code` / `visits` / `notifications` / RPC |
| 2 | `upgrade.sql` | เติม `member_code` (QR การ์ด), `order_no`, ตาราง `visits` + `notifications`, RPC ทั้งหมด (checkin / expire / cancel / resubmit / approve / reject), ตรึงสิทธิ์: revoke `anon`/`PUBLIC` จาก RPC |

หลังรันจบ ให้เลื่อนขั้น admin:

```sql
update public.profiles set role = 'admin'
where email = 'อีเมลของคุณ';
```

> `setup.sql` ไม่ควรรันบน DB ที่มีข้อมูลอยู่แล้ว เพราะ seed/ค่าเริ่มต้นอาจโต้แย้งกับข้อมูลจริง ฐานที่ใช้งานอยู่ให้ใช้หัวข้อถัดไป

## ฐานข้อมูลที่ใช้งานอยู่แล้ว (live DB)

ฐานจริงอาจยังขาดฟีเจอร์บางอย่าง ตัว `fix-*.sql` เป็นการ patch ทีละกรณีที่เจอจริง — **ดูว่ากรณีไหนตรงกับคุณแล้วค่อยรัน** ทุกตัว idempotent:

| ไฟล์ | แก้อะไร | ควรใช้เมื่อไหร่ |
| --- | --- | --- |
| `fix-buckets.sql` | สร้าง bucket `slips` / `announcements` แบบ guarded insert (หลีกเลี่ยง 42P10) | ไม่เคยรัน `setup.sql` เต็ม หรือ bucket หาย |
| `fix-member-code.sql` | ตั้ง default + backfill `member_code` ให้ NULL | สมาชิกใหม่ไม่มี QR การ์ด (กรณีผู้ใช้ที่สมัครก่อน migration มี `member_code` เป็น NULL) |
| `fix-checkin-match.sql` | `checkin_member()` normalize (trim + lowercase) ก่อนเทียบ | เช็คอินปฏิเสธ QR ที่มีตัวอักษรพิมพ์เล็ก/เว้นวรรค |
| `fix-resubmit.sql` | `resubmit_subscription()` เลิก `delete storage.objects` (ถูก Supabase บล็อก → 403) | การส่งสลิปใหม่ล้มเหลวตอนมีสลิปเก่า |
| `fix-visits-operator-policy.sql` | เพิ่ม policy ให้ผู้เช็คอิน (`checkin_by`) อ่าน visits ที่ตนเองบันทึก | หน้าเช็คอินของเจ้าหน้าที่ที่ไม่ได้เป็น admin ขึ้นประวัติ "วันนี้" ว่าง |
| `cleanup-test-data.sql` | สร้าง RPC `cleanup_test_data()` ลบข้อมูลเทสต์ (`%@ess.local`) เฉพาะ admin | ต้องการล้างข้อมูล E2E (ลบ RPC ได้ภายหลังด้วย drop function) |

> โน้ตสำคัญ: ถ้ารันสคริปต์นี้แล้วแก้ปัญหา ให้**อัปเดต/yำสิทธิ์ความถูกต้องของ `setup.sql` / `upgrade.sql`** ด้วยเสมอ เพื่อให้ฐานใหม่ไม่กลับมีบั๊กซ้ำ (เช่น เราแก้ policy bucket แล้วต้องแก้ที่ `setup.sql` + `announcements.sql` ด้วย)

## ไฟล์ที่ซ้ำ/ไม่ต้องใช้

- `harden.sql` = ชุดย่อยของ `upgrade.sql` (revoke `anon`/`PUBLIC` จาก RPC + checkin กัน anonymous) — ไม่ต้องรันแยก ถ้ารัน `upgrade.sql` ครบแล้ว **เก็บไว้เป็นเอกสารอ้างอิงเท่านั้น**

## งานดูแลอัตโนมัติ (optional)

- สั่ง expire คำสั่งซื้อหมดอายุ / สิทธิ์หมดอายุ ได้ผ่าน RPC `expire_pending_orders(48)` / `expire_subscriptions()` — แอปจะเรียกเองครั้งละ session ก็ได้ แต่แนะนำตั้ง pg_cron ตามตัวอย่างท้าย `upgrade.sql` (ข้อ 14) เพื่อให้ทำงานทุกวันตี 3