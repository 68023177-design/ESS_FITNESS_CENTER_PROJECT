// ============================================================
// ESS Fitness Center - public & member pages logic
// ============================================================
(function () {
  'use strict';
  const ess = window.ess;
  const supabase = ess.client;

  function getParam(name) {
    const p = new URLSearchParams(window.location.search);
    return p.get(name);
  }

  const NEWS_EXCERPT_LEN = 220;

  function imageUrl(path) {
    if (!path) return '';
    return SUPABASE_URL + '/storage/v1/object/public/announcements/' + path;
  }

  function excerpt(text, len) {
    text = String(text == null ? '' : text);
    if (text.length <= len) return text;
    return text.slice(0, len).trimEnd() + '…';
  }

  const handlers = {
    home: initHome,
    packages: initPackages,
    login: initLogin,
    register: initRegister,
    subscribe: initSubscribe,
    payment: initPayment,
    profile: initProfile,
  };

  document.addEventListener('DOMContentLoaded', async function () {
    const page = document.body.dataset.page || 'home';
    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear() + 543;
    await ess.renderNav(
      page === 'subscribe' || page === 'payment' ? 'packages' : page
    );
    maybeRunMaintenance();
    if (handlers[page]) await handlers[page]();
  });

  // Maintenance RPCs are harmless & idempotent; run once per session
  // so stale pending orders get cancelled even without pg_cron enabled.
  async function maybeRunMaintenance() {
    if (sessionStorage.getItem('ess-maint-done')) return;
    if (!(await ess.getSession())) return;
    sessionStorage.setItem('ess-maint-done', '1');
    supabase.rpc('expire_pending_orders', { p_hours: 48 }).catch(function () {});
    supabase.rpc('expire_subscriptions').catch(function () {});
  }

  // ---------------- HOME ----------------
  async function initHome() {
    const list = document.getElementById('news-list');
    if (!list) return;
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_published', true)
      .order('created_at', { ascending: false });

    if (error) {
      list.innerHTML = '<p class="muted">โหลดข่าวสารไม่สำเร็จ กรุณาลองใหม่ภายหลัง</p>';
      return;
    }
    if (!data || !data.length) {
      list.innerHTML = '<div class="card"><p class="muted">ยังไม่มีข่าวประกาศในขณะนี้</p></div>';
      return;
    }
    const calSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>';
    list.innerHTML = '<div class="news-grid">' + data.map(function (a) {
      const img = a.image_url
        ? '<div class="news-cover-wrap"><img class="news-cover" src="' + imageUrl(a.image_url) + '" alt="' + ess.esc(a.title) + '" loading="lazy"></div>'
        : '';
      const body = String(a.content || '');
      const hasMore = body.length > NEWS_EXCERPT_LEN;
      return (
        '<article class="card news-card">' +
        img +
        '<div class="news-body">' +
        '<div class="news-meta"><span class="news-date-tag">' + calSvg + ess.formatDate(a.created_at) + '</span></div>' +
        '<h3 class="news-title">' + ess.esc(a.title) + '</h3>' +
        '<p class="news-text">' + ess.esc(excerpt(body, NEWS_EXCERPT_LEN)) + '</p>' +
        (hasMore ? '<button type="button" class="btn btn-ghost btn-sm news-toggle">อ่านเพิ่มเติม ▾</button>' : '') +
        '<div class="news-full">' + ess.esc(body) + '</div>' +
        '</div>' +
        '</article>'
      );
    }).join('') + '</div>';

    list.querySelectorAll('.news-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const full = btn.closest('.news-card').querySelector('.news-full');
        const isOpen = full.classList.toggle('news-open');
        btn.textContent = isOpen ? 'ย่อ ▴' : 'อ่านเพิ่มเติม ▾';
        btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    });
  }

  // ---------------- PACKAGES ----------------
  async function initPackages() {
    const grid = document.getElementById('packages-grid');
    if (!grid) return;
    const { data: packages, error } = await supabase
      .from('packages')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true });

    if (error) {
      grid.innerHTML = '<p class="muted">โหลดแพคเกจไม่สำเร็จ กรุณาตรวจสอบการตั้งค่า Supabase</p>';
      return;
    }
    if (!packages || !packages.length) {
      grid.innerHTML = '<p class="muted">ยังไม่มีแพคเกจให้บริการ</p>';
      return;
    }
    grid.innerHTML = packages.map(function (p) {
      return (
        '<div class="card package-card">' +
        '<h3>' + ess.esc(p.name) + '</h3>' +
        '<p class="package-desc">' + ess.esc(p.description || '') + '</p>' +
        '<div class="package-price"><span class="currency">฿</span>' + ess.formatMoney(p.price) + '</div>' +
        '<p class="package-duration">' + p.duration_months + ' เดือน</p>' +
        '<button type="button" class="btn btn-primary btn-block" data-package="' + p.id + '">สมัครแพคเกจ</button>' +
        '</div>'
      );
    }).join('');

    grid.addEventListener('click', async function (ev) {
      const btn = ev.target.closest('[data-package]');
      if (!btn) return;
      const id = btn.dataset.package;
      const session = await ess.getSession();
      if (session) {
        window.location.href = 'subscribe.html?package=' + id;
      } else {
        window.location.href = 'login.html?redirect=subscribe.html%3Fpackage%3D' + id;
      }
    });
  }

  // ---------------- LOGIN ----------------
  async function initLogin() {
    const form = document.getElementById('login-form');
    if (!form) return;
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const errBox = document.getElementById('form-error');
      errBox.textContent = '';
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ...';
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          errBox.textContent = error.message === 'Invalid login credentials'
            ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
            : error.message;
          btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
          return;
        }
        const redirect = getParam('redirect');
        window.location.href = redirect || 'profile.html';
      } catch (e) {
        errBox.textContent = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
        btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ';
      }
    });
  }

  // ---------------- REGISTER ----------------
  async function initRegister() {
    const form = document.getElementById('register-form');
    if (!form) return;
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const fullName = document.getElementById('full-name').value.trim();
      const email = document.getElementById('email').value.trim();
      const studentId = document.getElementById('student-id').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const sex = document.getElementById('sex').value;
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm-password').value;
      const errBox = document.getElementById('form-error');
      errBox.textContent = '';

      if (!fullName) { errBox.textContent = 'กรุณากรอกชื่อ-นามสกุล'; return; }
      if (password.length < 6) { errBox.textContent = 'รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร'; return; }
      if (password !== confirm) { errBox.textContent = 'รหัสผ่านไม่ตรงกัน'; return; }

      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'กำลังสมัคร...';
      try {
        const { data: signUpData, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, student_id: studentId, phone: phone, sex: sex },
          },
        });
        if (error) {
          errBox.textContent = error.message;
          btn.disabled = false; btn.textContent = 'สมัครสมาชิก';
          return;
        }
        if (signUpData.session) {
          // email confirmation disabled -> profile already created & we are logged in
          ess.toast('สมัครสมาชิกสำเร็จ ยินดีต้อนรับ!', 'success');
          setTimeout(() => { window.location.href = 'profile.html'; }, 1200);
        } else {
          // email confirmation enabled
          ess.toast('สมัครสำเร็จ! กรุณายืนยันอีเมลในกล่องจดหมายของคุณ', 'success');
          setTimeout(() => { window.location.href = 'login.html'; }, 2000);
        }
      } catch (e2) {
        errBox.textContent = 'เกิดข้อผิดพลาด กรุณาลองใหม่';
        btn.disabled = false; btn.textContent = 'สมัครสมาชิก';
      }
    });
  }

  // ---------------- SUBSCRIBE ----------------
  async function initSubscribe() {
    const ctx = await ess.requireLogin();
    if (!ctx) return;
    const packageId = getParam('package');
    if (!packageId) {
      window.location.href = 'index.html#packages';
      return;
    }
    const box = document.getElementById('package-box');
    const { data: pkg, error } = await supabase
      .from('packages')
      .select('*')
      .eq('id', packageId)
      .maybeSingle();
    if (error || !pkg || !pkg.is_active) {
      box.innerHTML = '<p class="muted">ไม่พบแพคเกจนี้</p>';
      return;
    }
    box.innerHTML =
      '<h3>' + ess.esc(pkg.name) + '</h3>' +
      '<p class="package-desc">' + ess.esc(pkg.description || '') + '</p>' +
      '<div class="package-price"><span class="currency">฿</span>' + ess.formatMoney(pkg.price) + '</div>' +
      '<p class="package-duration">ระยะเวลา ' + pkg.duration_months + ' เดือน</p>';

    document.getElementById('btn-create-sub').addEventListener('click', async function () {
      const btn = this;
      btn.disabled = true; btn.textContent = 'กำลังสร้างคำสั่งซื้อ...';
      const { data: sub, error: subError } = await supabase
        .from('subscriptions')
        .insert({
          user_id: ctx.session.user.id,
          package_id: pkg.id,
          package_name: pkg.name,
          amount: pkg.price,
          status: 'pending',
        })
        .select()
        .single();
      if (subError) {
        ess.toast('สร้างคำสั่งซื้อไม่สำเร็จ: ' + subError.message, 'error');
        btn.disabled = false; btn.textContent = 'ยืนยันสมัครแพคเกจ';
        return;
      }
      ess.toast('สร้างคำสั่งซื้อแล้ว ไปชำระเงิน', 'success');
      window.location.href = 'payment.html?sub=' + sub.id;
    });
  }

  // ---------------- PAYMENT ----------------
  async function initPayment() {
    const ctx = await ess.requireLogin();
    if (!ctx) return;
    const subId = getParam('sub');
    if (!subId) { window.location.href = 'index.html#packages'; return; }

    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('id', subId)
      .maybeSingle();
    if (error || !sub || sub.user_id !== ctx.session.user.id) {
      const s = document.getElementById('pay-sub-status');
      if (s) s.innerHTML = '<p class="muted">ไม่พบคำสั่งซื้อนี้</p>';
      return;
    }

    // promptpay id from settings (fallback to config default)
    const { data: settings } = await supabase.from('settings').select('key,value').eq('key', 'promptpay_id').maybeSingle();
    const promptpayId = (settings && settings.value) || window.DEFAULT_PROMPTPAY_ID;

    const statusEl = document.getElementById('pay-sub-status');
    statusEl.innerHTML =
      'เลขที่คำสั่งซื้อ: <strong>' + ess.esc(sub.order_no || '-') + '</strong> — ' +
      ess.esc(sub.package_name) + ' · ฿' + ess.formatMoney(sub.amount) +
      ' ' + ess.statusLabel(sub.status);

    if (sub.status === 'pending') {
      document.getElementById('pay-step').style.display = 'block';
      renderQR(sub.amount, promptpayId);
      initSlipUpload(sub);
      initCancelSub(sub);
      const stale = sub.created_at && (Date.now() - new Date(sub.created_at).getTime()) > 48 * 3600 * 1000;
      const staleHint = document.getElementById('pay-stale-hint');
      if (staleHint) {
        staleHint.style.display = stale ? 'block' : 'none';
      }
    } else if (sub.status === 'rejected') {
      document.getElementById('pay-resubmit').style.display = 'block';
      document.getElementById('pay-resubmit-note').textContent =
        sub.admin_note ? 'หมายเหตุจากผู้ดูแล: ' + sub.admin_note : 'โปรดส่งหลักฐานการชำระเงินใหม่อีกครั้ง';
      initResubmit(sub);
    } else {
      document.getElementById('pay-done').style.display = 'block';
      const z = document.getElementById('pay-receipt');
      if (z) {
        z.innerHTML = '<strong>' + ess.esc(sub.order_no || '-') + '</strong> · ' +
          ess.esc(sub.package_name) + ' · ฿' + ess.formatMoney(sub.amount) +
          (sub.start_date ? ' · ' + ess.formatDate(sub.start_date) + ' — ' + ess.formatDate(sub.end_date) : '');
      }
      if (sub.slip_path) {
        showSlipThumb(sub.slip_path);
      }
    }
  }

  async function initCancelSub(sub) {
    const btn = document.getElementById('btn-cancel-sub');
    if (!btn) return;
    btn.addEventListener('click', async function () {
      if (!confirm('ยกเลิกคำสั่งซื้อนี้?')) return;
      const { data, error } = await supabase.rpc('cancel_subscription', { p_sub_id: sub.id });
      if (error) { ess.toast('ยกเลิกไม่สำเร็จ: ' + error.message, 'error'); return; }
      ess.toast(data ? 'ยกเลิกคำสั่งซื้อแล้ว' : 'ไม่สามารถยกเลิกได้ (สถานะเปลี่ยนไปแล้ว)', 'success');
      setTimeout(function () { window.location.reload(); }, 900);
    });
  }

  async function initResubmit(sub) {
    const input = document.getElementById('slip-file-2');
    const preview = document.getElementById('slip-preview-2');
    if (!input) return;
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      if (!f) return;
      if (f.type.indexOf('image/') !== 0) { ess.toast('กรุณาเลือกไฟล์รูปภาพเท่านั้น', 'error'); return; }
      if (f.size > 3 * 1024 * 1024) { ess.toast('รูปภาพต้องไม่เกิน 3 MB', 'error'); return; }
      const reader = new FileReader();
      reader.onload = function () {
        preview.innerHTML = '<img class="slip-img" src="' + reader.result + '" alt="สลิปใหม่">';
      };
      reader.readAsDataURL(f);
    });

    document.getElementById('btn-submit-slip-2').addEventListener('click', async function () {
      const f = input.files && input.files[0];
      if (!f) { ess.toast('กรุณาเลือกรูปสลิปก่อน', 'error'); return; }
      const btn = this;
      btn.disabled = true; btn.textContent = 'กำลังส่งสลิป...';
      const path = 'slips/' + sub.id + '-' + Date.now() + '-' + f.name.replace(/[^\w.\-]+/g, '_');
      const { error: upError } = await supabase.storage.from('slips').upload(path, f, { upsert: false, contentType: f.type });
      if (upError) {
        ess.toast('อัปโหลดสลิปไม่สำเร็จ: ' + upError.message, 'error');
        btn.disabled = false; btn.textContent = 'ยืนยันส่งสลิปใหม่';
        return;
      }
      const { data, error } = await supabase.rpc('resubmit_subscription', { p_sub_id: sub.id, p_slip_path: path });
      if (error) {
        ess.toast('ไม่สำเร็จ: ' + error.message, 'error');
        btn.disabled = false; btn.textContent = 'ยืนยันส่งสลิปใหม่';
        return;
      }
      if (!data) { ess.toast('ส่งใหม่ไม่ได้ (คำสั่งซื้อนี้เปลี่ยนสถานะแล้ว)', 'error'); return; }
      if (sub.slip_path && sub.slip_path !== path) {
        supabase.storage.from('slips').remove([sub.slip_path]).catch(function () {});
      }
      ess.toast('ส่งสลิปใหม่แล้ว รอแอดมินตรวจสอบ', 'success');
      setTimeout(function () { window.location.href = 'profile.html'; }, 1200);
    });
  }

  function renderQR(amount, promptpayId) {
    const canvas = document.getElementById('qr-canvas');
    const payload = window.QRCodeLib.promptpayPayload(promptpayId, Number(amount));
    const matrix = window.QRCodeLib.createMatrix(payload, 'M');
    window.QRCodeLib.renderToCanvas(canvas, matrix, 8, 4);
    const hint = document.getElementById('qr-amount-hint');
    if (hint) hint.textContent = 'ยอดชำระ ฿' + ess.formatMoney(amount) + ' สแกนแล้วโอนตามยอดนี้';
  }

  async function showSlipThumb(path) {
    const box = document.getElementById('slip-preview-done');
    if (!box) return;
    const { data } = await supabase.storage.from('slips').createSignedUrl(path, 3600);
    if (data) {
      box.innerHTML = '<img class="slip-img" src="' + data.signedUrl + '" alt="สลิปการโอนเงิน">';
    }
  }

  function initSlipUpload(sub) {
    const input = document.getElementById('slip-file');
    const preview = document.getElementById('slip-preview');
    input.addEventListener('change', function () {
      const f = input.files && input.files[0];
      if (!f) return;
      const isImage = f.type.indexOf('image/') === 0;
      if (!isImage) { ess.toast('กรุณาเลือกไฟล์รูปภาพเท่านั้น', 'error'); return; }
      if (f.size > 3 * 1024 * 1024) { ess.toast('รูปภาพต้องไม่เกิน 3 MB', 'error'); return; }
      const reader = new FileReader();
      reader.onload = function () {
        preview.innerHTML = '<img class="slip-img" src="' + reader.result + '" alt="สลิปตัวอย่าง">';
      };
      reader.readAsDataURL(f);
    });

    document.getElementById('btn-submit-slip').addEventListener('click', async function () {
      const f = input.files && input.files[0];
      if (!f) { ess.toast('กรุณาเลือกรูปสลิปก่อน', 'error'); return; }
      const btn = this;
      btn.disabled = true; btn.textContent = 'กำลังส่งสลิป...';
      const path = 'slips/' + sub.id + '-' + Date.now() + '-' + f.name.replace(/[^\w.\-]+/g, '_');
      const { error: upError } = await supabase.storage.from('slips').upload(path, f, { upsert: false, contentType: f.type });
      if (upError) {
        ess.toast('อัปโหลดสลิปไม่สำเร็จ: ' + upError.message, 'error');
        btn.disabled = false; btn.textContent = 'ยืนยันชำระเงิน';
        return;
      }
      const { error: subError } = await supabase
        .from('subscriptions')
        .update({ slip_path: path })
        .eq('id', sub.id);
      if (subError) {
        ess.toast('บันทึกข้อมูลไม่สำเร็จ: ' + subError.message, 'error');
        btn.disabled = false; btn.textContent = 'ยืนยันชำระเงิน';
        return;
      }
      ess.toast('ส่งสลิปแล้ว รอแอดมินตรวจสอบ', 'success');
      setTimeout(() => { window.location.href = 'profile.html'; }, 1400);
    });
  }

  // ---------------- PROFILE ----------------
  async function initProfile() {
    const ctx = await ess.requireLogin();
    if (!ctx) return;
    const p = ctx.profile;
    document.getElementById('pv-email').textContent = p.email;
    document.getElementById('pv-name').textContent = p.full_name || '-';
    document.getElementById('pv-student').textContent = p.student_id || '-';
    document.getElementById('pv-phone').textContent = p.phone || '-';
    document.getElementById('pv-sex').textContent =
      p.sex === 'male' ? 'ชาย' : p.sex === 'female' ? 'หญิง' : 'ไม่ระบุ';
    document.getElementById('pv-role').textContent = p.role === 'admin' ? 'ผู้ดูแลระบบ' : 'สมาชิก';
    document.getElementById('pv-joined').textContent = ess.formatDate(p.created_at);

    // edit form
    const form = document.getElementById('profile-edit-form');
    if (form) {
      document.getElementById('pe-full-name').value = p.full_name || '';
      document.getElementById('pe-student-id').value = p.student_id || '';
      document.getElementById('pe-phone').value = p.phone || '';
      document.getElementById('pe-sex').value = p.sex || 'other';
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
        const { error } = await supabase
          .from('profiles')
          .update({
            full_name: document.getElementById('pe-full-name').value.trim(),
            student_id: document.getElementById('pe-student-id').value.trim(),
            phone: document.getElementById('pe-phone').value.trim(),
            sex: document.getElementById('pe-sex').value,
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id);
        if (error) {
          ess.toast('บันทึกไม่สำเร็จ: ' + error.message, 'error');
          btn.disabled = false; btn.textContent = 'บันทึกข้อมูล';
          return;
        }
        ess.toast('บันทึกข้อมูลสำเร็จ', 'success');
        btn.disabled = false; btn.textContent = 'บันทึกข้อมูล';
        window.location.reload();
      });
    }

    // password change
    const pwForm = document.getElementById('pw-form');
    if (pwForm) {
      pwForm.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        const pw = document.getElementById('pw-new').value;
        if (pw.length < 6) { ess.toast('รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร', 'error'); return; }
        const { error } = await supabase.auth.updateUser({ password: pw });
        if (error) { ess.toast('เปลี่ยนรหัสไม่สำเร็จ: ' + error.message, 'error'); return; }
        ess.toast('เปลี่ยนรหัสผ่านสำเร็จ', 'success');
        pwForm.reset();
      });
    }

    // my subscriptions
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', p.id)
      .order('created_at', { ascending: false });

    renderMemberCard(p, subs || []);
    renderMySubs(p, subs || []);

    // my notifications
    const notifBox = document.getElementById('my-notifs');
    if (notifBox) {
      const { data: notifs } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!notifs || !notifs.length) {
        notifBox.innerHTML = '<p class="muted">ยังไม่มีแจ้งเตือน</p>';
      } else {
        notifBox.innerHTML =
          '<div class="notif-list">' + notifs.map(function (n) {
            return (
              '<div class="notif-row' + (n.read_at ? '' : ' notif-unread') + '">' +
              '<div><strong>' + ess.esc(n.title) + '</strong><br>' +
              '<span class="muted">' + ess.esc(n.body || '') + '</span>' +
              '<div class="notif-time">' + ess.formatDate(n.created_at) + '</div></div>' +
              (n.link ? '<a class="btn-link" href="' + ess.esc(n.link) + '">ดู</a>' : '') +
              '</div>'
            );
          }).join('') + '</div>' +
          '<button type="button" id="btn-notif-readall" class="btn btn-sm btn-outline" style="margin-top:12px;">ทำเครื่องหมายอ่านแล้วทั้งหมด</button>';
        document.getElementById('btn-notif-readall').addEventListener('click', async function () {
          const unread = notifs.filter(function (n) { return !n.read_at; });
          if (!unread.length) { ess.toast('อ่านแล้วทั้งหมดแล้ว', 'info'); return; }
          const { error } = await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .in('id', unread.map(function (n) { return n.id; }));
          if (!error) window.location.reload();
        });
      }
    }
  }

  // ---------------- MEMBER CARD (QR check-in) ----------------
  function renderMemberCard(p, subs) {
    const wrap = document.getElementById('member-card-wrap');
    if (!wrap) return;
    const hasActive = subs.some(function (s) { return s.status === 'active'; });
    const activeSub = subs.find(function (s) { return s.status === 'active'; });

    if (!p.member_code) {
      wrap.innerHTML = '<p class="muted">การ์ดสมาชิกยังไม่พร้อมใช้งาน (กรุณาให้ผู้ดูแลรันการอัปเกรดฐานข้อมูล)</p>';
      return;
    }

    let statusHtml;
    let statusClass = 'member-card';
    if (hasActive) {
      statusClass = 'member-card member-ok';
      statusHtml = '<span class="badge badge-active">สิทธิ์ใช้งานถึง ' + ess.formatDate(activeSub.end_date) +
        ' (เหลือ ' + Math.max(0, Math.ceil((new Date(activeSub.end_date) - new Date()) / 86400000)) + ' วัน)</span>';
    } else if (subs.some(function (s) { return s.status === 'pending' || s.status === 'rejected' || s.status === 'cancelled'; })) {
      statusClass = 'member-card member-warn';
      statusHtml = '<span class="badge badge-pending">ยังไม่มีสิทธิ์เข้าใช้ (รอชำระเงิน)</span>';
    } else {
      statusClass = 'member-card member-expired';
      statusHtml = '<span class="badge badge-expired">หมดอายุสิทธิ์ — ต่ออายุแพคเกจเพื่อเข้าใช้</span>';
    }

    const canvas = document.createElement('canvas');
    try {
      const qr = window.QRCodeLib.buildMatrix(String(p.member_code), 'M');
      window.QRCodeLib.renderToCanvas(canvas, qr, 6, 4);
    } catch (e) {
      canvas.width = canvas.height = 0;
    }

    wrap.innerHTML =
      '<div class="' + statusClass + '">' +
      '<div class="member-card-head"><span class="member-card-logo">ESS</span>' +
      '<span class="member-card-name">' + ess.esc(p.full_name || 'สมาชิก') + '</span></div>' +
      '<div class="member-card-qr"><canvas></canvas><span class="muted">โชว์ QR นี้กับเจ้าหน้าที่เพื่อเข้ายิม</span></div>' +
      '<div class="member-card-foot">' + statusHtml +
      '<span class="muted">รหัส ' + ess.esc(String(p.member_code).slice(0, 8).toUpperCase()) + '</span>' +
      '</div></div>';

    const cv = wrap.querySelector('canvas');
    if (cv) {
      wrap.querySelector('.member-card-qr').replaceChild(canvas, cv);
    }
  }

  // ---------------- MY SUBSCRIPTIONS RENDER ----------------
  function renderMySubs(p, subs) {
    const list = document.getElementById('my-subs');
    if (!list) return;
    if (!subs.length) {
      list.innerHTML = '<p class="muted">ยังไม่มีแพคเกจที่สมัคร — <a href="packages.html">เลือกแพคเกจเลย</a></p>';
      return;
    }
    list.innerHTML = subs.map(function (s) {
      let actions = '';
      let period = '';
      if (s.status === 'pending') {
        actions =
          ' <a class="btn-link" href="payment.html?sub=' + s.id + '">ไปชำระเงิน</a>' +
          ' <button type="button" class="btn-link" data-cancel-sub="' + s.id + '">ยกเลิก</button>';
      }
      if (s.status === 'active') {
        actions = ' <a class="btn-link" href="subscribe.html?package=' + s.package_id + '&renew=1">ต่ออายุแพคเกจ</a>';
      }
      if (s.status === 'rejected') {
        actions = ' <a class="btn-link" href="payment.html?sub=' + s.id + '">ส่งสลิปใหม่</a>';
      }
      if (s.status === 'expired') {
        actions = ' <a class="btn-link" href="subscribe.html?package=' + s.package_id + '&renew=1">สมัครใหม่ / ต่ออายุ</a>';
      }
      if (s.start_date) {
        period = 'เริ่ม ' + ess.formatDate(s.start_date) + ' — ' + ess.formatDate(s.end_date);
      }
      const note = s.admin_note ? '<br><span class="muted">หมายเหตุ: ' + ess.esc(s.admin_note) + '</span>' : '';
      return (
        '<div class="sub-row">' +
        '<div><strong>' + ess.esc(s.package_name) + '</strong><br>' +
        '<span class="muted">เลขที่ ' + ess.esc(s.order_no || '-') + ' · ฿' + ess.formatMoney(s.amount) + ' · สมัครเมื่อ ' + ess.formatDate(s.created_at) + '</span>' +
        note + '</div>' +
        '<div class="sub-right">' + ess.statusLabel(s.status) +
        (period ? '<br><span class="muted">' + ess.esc(period) + '</span>' : '') +
        actions + '</div>' +
        '</div>'
      );
    }).join('');

    list.querySelectorAll('[data-cancel-sub]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('ยกเลิกคำสั่งซื้อนี้?')) return;
        const { data, error } = await supabase.rpc('cancel_subscription', { p_sub_id: b.dataset.cancelSub });
        if (error) { ess.toast('ยกเลิกไม่สำเร็จ: ' + error.message, 'error'); return; }
        ess.toast(data ? 'ยกเลิกแล้ว' : 'ยกเลิกไม่ได้ (สถานะไม่ใช่ pending)', 'success');
        setTimeout(function () { window.location.reload(); }, 900);
      });
    });
  }
})();