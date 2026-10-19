# ESS Fitness Center — มหาวิทยาลัยพะเยา

ระบบเว็บฟิตเนสของมหาวิทยาลัยพะเยา: สมัครสมาชิก เลือกแพคเกจ ชำระเงินด้วย PromptPay QR แล้วติดตามสถานะ / เช็คอินเข้ายิมด้วยคิวอาร์โค้ดการ์ดสมาชิกได้จบในที่เดียว

## โครงสร้างโปรเจกต์

```
├── index.html, packages.html     # หน้าแรก + แพคเกจ (สาธารณะ)
├── login.html, register.html     # เข้าสู่ระบบ / สมัครสมาชิก
├── subscribe.html, payment.html  # สร้างคำสั่งซื้อ + ชำระเงิน (PromptPay QR + สลิป)
├── profile.html                  # โปรไฟล์ / การ์ดสมาชิก (QR) / คำสั่งซื้อ / แจ้งเตือน
├── admin.html                    # หน้า admin (อนุมัติสลิป, แพคเกจ, ข่าว, สถิติ)
├── checkin.html                  # หน้าเช็คอินหน้างาน (สแกน QR / ค้นหาสมาชิก)
├── css/style.css
├── js/                           # app.js, auth.js, admin.js, checkin.js, qrcode.js, config.js, vendor/
├── sql/                          # สคริปต์ฐานข้อมูล (ดู sql/MIGRATIONS.md)
├── supabase/functions/send-email # Edge Function ส่งอีเมล (ไม่บังคับ)
├── build-dist.js                 # สร้าง dist/ สำหรับ deploy
├── server.js                     # dev server (node)
└── test-qr.js, test-pages.js     # เทสต์อัตโนมัติ (npm test)
```

## เทคโนโลยี

- **Frontend**: HTML + CSS + Vanilla JS (ไม่มี framework) ใช้ Supabase JS client แบบ vendored ใน `js/vendor/`
- **Backend**: Supabase (Auth, PostgreSQL + Row Level Security, Storage, RPC)
- **QR**: เขียนเองใน `js/qrcode.js` — สร้าง PromptPay payload ตามมาตรฐาน EMVCo + QR encoder ไร้ dependency (ทดสอบกับ jsQR ได้ผ่าน)
- **Hosting**: Cloudflare Pages (ผ่าน wrangler)

## เริ่มใช้งาน

### 1. ติดตั้ง dependencies

```sh
npm install
```

`npm install` ใช้สำหรับเทสต์ (jsQR, qrcode) เท่านั้น — เว็บจริงโหลด vendor script โดยตรง ไม่ต้อง bundler

### 2. ตั้งค่า Supabase

1. สร้างโปรเจกต์ Supabase ใหม่ แล้วเปิดหน้า **Project Settings → API**
2. ใส่ `SUPABASE_URL` และ `SUPABASE_ANON_KEY` ใน `js/config.js`
3. เปิด SQL Editor แล้วรันตามลำดับ (ดูรายละเอียดการ apply ทีละตัวใน `sql/MIGRATIONS.md`):
   - `sql/setup.sql`
   - `sql/upgrade.sql`
4. สร้างบัญชี admin ด้วยหน้า register แล้วเลื่อนขั้น:
   ```sql
   update public.profiles set role = 'admin'
   where email = 'อีเมลของคุณ';
   ```
5. ตรวจสอบ/แก้เบอร์ PromptPay Merchant ในหน้า **จัดการระบบ → ตั้งค่า** (หรือแก้ seed ใน `setup.sql` ก่อนรันครั้งแรก)

### 3. รัน local

```sh
npm start          # http://localhost:3000
```

### 4. ทดสอบ

```sh
npm test           # QR encode/decode roundtrip + ตรวจ id/script อ้างอิงในหน้า HTML
```

### 5. Deploy ไป Cloudflare Pages

```sh
npm run deploy     # สร้าง dist/ แล้วใช้ wrangler pages deploy
```

## การกำหนดค่า

| ค่า | ที่อยู่ | คำอธิบาย |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `js/config.js` | จุดเชื่อมต่อ Supabase (anon key เป็นสาธารณะโดย design) |
| `DEFAULT_PROMPTPAY_ID` | `js/config.js` | เบอร์พร้อมเพย์สำรอง ใช้เมื่อตาราง `settings` ยังไม่มีค่าจริง |
| `promptpay_id` | ตาราง `settings` | เบอร์พร้อมเพย์จริง — ระบบอ่านค่านี้ก่อนเสมอ แก้ได้ผ่านหน้า admin |

## เรียกใช้ฟีเจอร์เสริม: ส่งอีเมล

ดู `supabase/functions/send-email/README.md` — ต้องตั้งค่า Secrets (`RESEND_API_KEY`, `EDGE_SECRET`) + deploy edge function + เปิด `pg_net`

## สิทธิ์และความปลอดภัย

- กระทำผ่าน RLS + RPC (`security definer`) ทั้งหมด — ตัวอย่าง: `checkin_member()` บังคับให้ผู้เรียกต้องเป็น authenticated, `admin_*` RPC ตรวจ `is_admin()`
- Anonymous ถูก revoke จาก RPC ทั้งหมด (ดู `sql/upgrade.sql`)
- สลิปการโอนเก็บใน bucket เอกชน (`slips`) เปิดดูด้วย signed URL เท่านั้น

## ฟีเจอร์เสริมล่าสุด: ระบบเทรนเนอร์ + ระบบแจ้งเหตุ

รัน `sql/trainers_issues.sql` ใน Supabase SQL Editor เพื่อเพิ่ม 2 ตาราง + bucket `issue-images` (private) + RPC ที่เกี่ยวข้อง
(ถ้าฐานรัน `trainers_issues.sql` ไปแล้ว แต่อยากเพิ่มรูปเทรนเนอร์ ให้รัน `sql/trainer_photos.sql` เพิ่ม)

### ระบบเทรนเนอร์
- **Admin**: จัดการแท็บ "เทรนเนอร์" ใน `admin.html` — เพิ่ม/แก้ไข/ลบ/เปิด-ปิดใช้งาน พร้อมชื่อ, ช่องทางติดต่อ (แยกประเภท), เรทราคา และ **รูปภาพเทรนเนอร์** (อัปโหลด/เปลี่ยน/ลบรูปได้ ไม่เกิน 5 MB)
- **สมาชิก**: ดูรายชื่อเทรนเนอร์ที่ `trainers.html` (ต้องล็อกอินเท่านั้น) — แสดงรูปถ้ามี ถ้าไม่มีจะแสดงอักษรย่อชื่อแทน

### ระบบแจ้งเหตุ
- **ทุกคน**: แจ้งเหตุ/ปัญหาได้ที่ `report-issue.html` — เลือกหมวดหมู่, แนบรูป (เฉพาะสมาชิกที่ล็อกอิน), ไม่ต้องล็อกอินก็แจ้งได้
- **สมาชิก**: ดูสถานะรายงานของตนเองใน `profile.html` (ส่วน "รายงานแจ้งเหตุของฉัน") พร้อมหมายเหตุจากผู้ดูแล
- **Admin**: จัดการแท็บ "แจ้งเหตุ" ใน `admin.html` — เปลี่ยนสถานะ (`open`/`in_progress`/`resolved`/`closed`), ใส่หมายเหตุภายใน, ดูรูป (signed URL), ลบรายงาน
