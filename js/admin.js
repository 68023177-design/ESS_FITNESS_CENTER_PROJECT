// ============================================================
// ESS Fitness Center - admin dashboard logic
// ============================================================
(function () {
  'use strict';
  const ess = window.ess;
  const supabase = ess.client;

  document.addEventListener('DOMContentLoaded', async function () {
    if (!(await ess.requireAdmin())) return;
    await ess.renderNav('admin');
    initTabs();
    await loadStats();
    await loadPackages();
    await loadMembers();
    await loadSubscriptions();
    await loadSettings();
    await loadNews();
    await loadStatsTab();
  });

  function initTabs() {
    document.querySelectorAll('[data-tab-btn]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('[data-tab-btn]').forEach(function (b) { b.classList.remove('tab-active'); });
        document.querySelectorAll('[data-tab-pane]').forEach(function (p) { p.classList.remove('tab-show'); });
        btn.classList.add('tab-active');
        const pane = document.querySelector('[data-tab-pane="' + btn.dataset.tabBtn + '"]');
        if (pane) pane.classList.add('tab-show');
      });
    });
  }

  async function loadStats() {
    const [m, s, p, subs] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact' }),
      supabase.from('subscriptions').select('id', { count: 'exact' }).eq('status', 'active'),
      supabase.from('subscriptions').select('id', { count: 'exact' }).eq('status', 'pending'),
      supabase.from('subscriptions').select('id', { count: 'exact' }),
    ]);
    setStat('stat-members', m.count || 0);
    setStat('stat-sub', s.count || 0);
    setStat('stat-pending', p.count || 0);
    setStat('stat-subs', subs.count || 0);
  }
  function setStat(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  // ---------------- PACKAGES ----------------
  async function loadPackages() {
    const { data } = await supabase.from('packages').select('*').order('price', { ascending: true });
    renderPackages(data || []);
  }

  function renderPackages(packages) {
    const tbody = document.querySelector('#packages-table tbody');
    tbody.innerHTML = packages.map(function (p) {
      return '<tr>' +
        '<td><strong>' + ess.esc(p.name) + '</strong></td>' +
        '<td>' + ess.esc(p.description || '-') + '</td>' +
        '<td>฿' + ess.formatMoney(p.price) + '</td>' +
        '<td>' + p.duration_months + ' เดือน</td>' +
        '<td>' + (p.is_active ? '<span class="badge badge-active">เปิด</span>' : '<span class="badge badge-expired">ปิด</span>') + '</td>' +
        '<td class="row-actions">' +
        '<button type="button" class="btn btn-sm btn-outline" data-edit-pkg="' + p.id + '">แก้ไข</button> ' +
        '<button type="button" class="btn btn-sm btn-outline" data-toggle-pkg="' + p.id + '">' + (p.is_active ? 'ปิดใช้' : 'เปิดใช้') + '</button> ' +
        '<button type="button" class="btn btn-sm btn-danger-outline" data-del-pkg="' + p.id + '">ลบ</button>' +
        '</td></tr>';
    }).join('');

    // events
    tbody.querySelectorAll('[data-edit-pkg]').forEach(function (b) {
      b.addEventListener('click', function () {
        const pkg = packages.find(function (p) { return p.id === b.dataset.editPkg; });
        openPackageForm(pkg);
      });
    });
    tbody.querySelectorAll('[data-toggle-pkg]').forEach(function (b) {
      b.addEventListener('click', async function () {
        const pkg = packages.find(function (p) { return p.id === b.dataset.togglePkg; });
        if (!pkg) return;
        const { error } = await supabase.from('packages').update({ is_active: !pkg.is_active }).eq('id', pkg.id);
        if (error) { ess.toast('เกิดข้อผิดพลาด: ' + error.message, 'error'); return; }
        ess.toast('อัปเดตสถานะแพคเกจแล้ว', 'success');
        loadPackages();
      });
    });
    tbody.querySelectorAll('[data-del-pkg]').forEach(function (b) {
      b.addEventListener('click', async function () {
        const pkg = packages.find(function (p) { return p.id === b.dataset.delPkg; });
        if (!pkg || !confirm('ลบแพคเกจ "' + pkg.name + '"?')) return;
        const { error } = await supabase.from('packages').delete().eq('id', pkg.id);
        if (error) { ess.toast('ลบไม่สำเร็จ (อาจมีคำสั่งซื้ออยู่): ' + error.message, 'error'); return; }
        ess.toast('ลบแพคเกจแล้ว', 'success');
        loadPackages();
      });
    });

    const addBtn = document.getElementById('btn-add-pkg');
    addBtn.onclick = null;
    addBtn.addEventListener('click', function () { openPackageForm(null); });
  }

  function openPackageForm(pkg) {
    const modal = document.getElementById('pkg-modal');
    modal.classList.add('modal-show');
    document.getElementById('pkg-name').value = pkg ? pkg.name : '';
    document.getElementById('pkg-desc').value = pkg ? (pkg.description || '') : '';
    document.getElementById('pkg-price').value = pkg ? pkg.price : '';
    document.getElementById('pkg-duration').value = pkg ? pkg.duration_months : 1;
    document.getElementById('pkg-active').checked = pkg ? pkg.is_active : true;
    document.getElementById('pkg-form').dataset.id = pkg ? pkg.id : '';
    document.getElementById('pkg-modal-title').textContent = pkg ? 'แก้ไขแพคเกจ' : 'เพิ่มแพคเกจใหม่';
  }

  function initPackageForm() {
    const form = document.getElementById('pkg-form');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const id = form.dataset.id || null;
      const payload = {
        name: document.getElementById('pkg-name').value.trim(),
        description: document.getElementById('pkg-desc').value.trim(),
        price: parseFloat(document.getElementById('pkg-price').value) || 0,
        duration_months: parseInt(document.getElementById('pkg-duration').value, 10) || 1,
        is_active: document.getElementById('pkg-active').checked,
      };
      let error;
      if (id) {
        const r = await supabase.from('packages').update(payload).eq('id', id);
        error = r.error;
      } else {
        const r = await supabase.from('packages').insert(payload);
        error = r.error;
      }
      if (error) { ess.toast('บันทึกไม่สำเร็จ: ' + error.message, 'error'); return; }
      ess.toast('บันทึกแพคเกจแล้ว', 'success');
      document.getElementById('pkg-modal').classList.remove('modal-show');
      loadPackages();
    });
    document.getElementById('pkg-modal-close').addEventListener('click', function () {
      document.getElementById('pkg-modal').classList.remove('modal-show');
    });
    document.getElementById('pkg-modal-cancel').addEventListener('click', function () {
      document.getElementById('pkg-modal').classList.remove('modal-show');
    });
    document.getElementById('pkg-modal').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('pkg-modal')) {
        document.getElementById('pkg-modal').classList.remove('modal-show');
      }
    });
  }
  initPackageForm();

  // ---------------- MEMBERS ----------------
  async function loadMembers() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    renderMembers(data || []);
  }
  const memberSearch = document.getElementById('member-search');
  if (memberSearch) {
    memberSearch.addEventListener('input', async function () {
      loadMembers();
    });
  }

  function renderMembers(members) {
    const tbody = document.querySelector('#members-table tbody');
    const q = (document.getElementById('member-search').value || '').toLowerCase().trim();
    const filtered = members.filter(function (m) {
      return (m.full_name + ' ' + m.email + ' ' + (m.student_id || '')).toLowerCase().indexOf(q) !== -1;
    });
    tbody.innerHTML = filtered.map(function (m) {
      return '<tr>' +
        '<td><strong>' + ess.esc(m.full_name || '-') + '</strong></td>' +
        '<td>' + ess.esc(m.email) + '</td>' +
        '<td>' + ess.esc(m.student_id || '-') + '</td>' +
        '<td>' + ess.esc(m.phone || '-') + '</td>' +
        '<td>' + (m.role === 'admin' ? '<span class="badge badge-active">Admin</span>' : 'สมาชิก') + '</td>' +
        '<td>' + ess.formatDate(m.created_at) + '</td></tr>';
    }).join('');
  }

  // ---------------- NEWS / ANNOUNCEMENTS ----------------
  async function loadNews() {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });
    renderNews(data || []);
  }

  function publicImgUrl(path) {
    return path ? SUPABASE_URL + '/storage/v1/object/public/announcements/' + path : '';
  }

  function renderNews(items) {
    const container = document.getElementById('news-admin-list');
    const addBtn = document.getElementById('btn-add-news');
    addBtn.onclick = function () { openNewsForm(null); };
    if (!items.length) {
      container.innerHTML = '<p class="muted">ยังไม่มีข่าวสาร — กด "+ เพิ่มข่าวสาร" เพื่อสร้าง</p>';
      return;
    }
    container.innerHTML = items.map(function (a) {
      const img = a.image_url
        ? '<img class="news-thumb" src="' + publicImgUrl(a.image_url) + '" alt="">'
        : '';
      const badge = a.is_published
        ? '<span class="badge badge-active">ประกาศแล้ว</span>'
        : '<span class="badge badge-expired">ฉบับร่าง</span>';
      return (
        '<div class="admin-sub">' +
        img +
        '<div class="admin-sub-info">' +
        '<strong>' + ess.esc(a.title) + '</strong>' +
        '<span class="muted">' + ess.formatDate(a.created_at) + ' · ' + badge + '</span>' +
        '</div>' +
        '<div class="admin-sub-right">' +
        '<button type="button" class="btn btn-sm btn-outline" data-publish-news="' + a.id + '">' + (a.is_published ? 'ปิดประกาศ' : 'เปิดประกาศ') + '</button> ' +
        '<button type="button" class="btn btn-sm btn-outline" data-edit-news="' + a.id + '">แก้ไข</button> ' +
        '<button type="button" class="btn btn-sm btn-danger-outline" data-del-news="' + a.id + '">ลบ</button>' +
        '</div></div>'
      );
    }).join('');

    container.querySelectorAll('[data-publish-news]').forEach(function (b) {
      b.addEventListener('click', function () { toggleNewsPublish(b.dataset.publishNews); });
    });
    container.querySelectorAll('[data-edit-news]').forEach(function (b) {
      b.addEventListener('click', function () {
        const item = items.find(function (x) { return x.id === b.dataset.editNews; });
        openNewsForm(item);
      });
    });
    container.querySelectorAll('[data-del-news]').forEach(function (b) {
      b.addEventListener('click', function () { delNews(b.dataset.delNews); });
    });
  }

  async function toggleNewsPublish(id) {
    const { data: cur } = await supabase.from('announcements').select('id,is_published').eq('id', id).maybeSingle();
    if (!cur) return;
    const { error } = await supabase
      .from('announcements')
      .update({ is_published: !cur.is_published, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { ess.toast('เกิดข้อผิดพลาด: ' + error.message, 'error'); return; }
    ess.toast(cur.is_published ? 'ปิดประกาศแล้ว' : 'เปิดประกาศแล้ว', 'success');
    loadNews();
  }

  async function delNews(id) {
    if (!confirm('ลบข่าวสารนี้?')) return;
    const { data: item } = await supabase.from('announcements').select('image_url').eq('id', id).maybeSingle();
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) { ess.toast('ลบไม่สำเร็จ: ' + error.message, 'error'); return; }
    if (item && item.image_url) {
      supabase.storage.from('announcements').remove([item.image_url]).catch(function () {});
    }
    ess.toast('ลบข่าวสารแล้ว', 'success');
    loadNews();
  }

  function openNewsForm(item) {
    const modal = document.getElementById('news-modal');
    modal.classList.add('modal-show');
    document.getElementById('news-title').value = item ? item.title : '';
    document.getElementById('news-content').value = item ? (item.content || '') : '';
    document.getElementById('news-published').checked = item ? item.is_published : false;
    document.getElementById('news-existing-img').value = item ? (item.image_url || '') : '';
    document.getElementById('news-img-file').value = '';
    const preview = document.getElementById('news-img-preview');
    preview.innerHTML = item && item.image_url
      ? '<img class="slip-img" src="' + publicImgUrl(item.image_url) + '" alt="รูปปัจจุบัน">'
      : '';
    document.getElementById('news-form').dataset.id = item ? item.id : '';
    document.getElementById('news-modal-title').textContent = item ? 'แก้ไขข่าวสาร' : 'เพิ่มข่าวสาร';
  }

  function initNewsForm() {
    const form = document.getElementById('news-form');
    const fileInput = document.getElementById('news-img-file');
    fileInput.addEventListener('change', function () {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.type.indexOf('image/') !== 0) { ess.toast('กรุณาเลือกไฟล์รูปภาพเท่านั้น', 'error'); fileInput.value = ''; return; }
      if (f.size > 5 * 1024 * 1024) { ess.toast('รูปภาพต้องไม่เกิน 5 MB', 'error'); fileInput.value = ''; return; }
      const reader = new FileReader();
      reader.onload = function () {
        document.getElementById('news-img-preview').innerHTML = '<img class="slip-img" src="' + reader.result + '" alt="รูปใหม่">';
      };
      reader.readAsDataURL(f);
    });

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const id = form.dataset.id || null;
      const title = document.getElementById('news-title').value.trim();
      if (!title) { ess.toast('กรุณากรอกหัวข้อข่าว', 'error'); return; }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'กำลังบันทึก...';

      const payload = {
        title: title,
        content: document.getElementById('news-content').value.trim(),
        is_published: document.getElementById('news-published').checked,
        updated_at: new Date().toISOString(),
      };

      let recordId = id;
      try {
        if (!id) {
          const { data: ins, error: insErr } = await supabase.from('announcements').insert(payload).select().single();
          if (insErr) throw insErr;
          recordId = ins.id;
        } else {
          const { error: upErr } = await supabase.from('announcements').update(payload).eq('id', id);
          if (upErr) throw upErr;
        }

        const f = fileInput.files && fileInput.files[0];
        if (f) {
          const path = 'news/' + recordId + '-' + Date.now() + '-' + f.name.replace(/[^\w.\-]+/g, '_');
          const { error: upErr2 } = await supabase.storage.from('announcements').upload(path, f, { upsert: false, contentType: f.type });
          if (upErr2) throw upErr2;
          const oldImg = document.getElementById('news-existing-img').value;
          const { error: imgErr } = await supabase.from('announcements').update({ image_url: path }).eq('id', recordId);
          if (imgErr) throw imgErr;
          if (oldImg && oldImg !== path) {
            supabase.storage.from('announcements').remove([oldImg]).catch(function () {});
          }
        }
        ess.toast('บันทึกข่าวสารแล้ว', 'success');
        document.getElementById('news-modal').classList.remove('modal-show');
        loadNews();
      } catch (e) {
        ess.toast('บันทึกไม่สำเร็จ: ' + (e.message || e), 'error');
      }
      btn.disabled = false; btn.textContent = 'บันทึก';
    });

    document.getElementById('news-modal-close').addEventListener('click', function () {
      document.getElementById('news-modal').classList.remove('modal-show');
    });
    document.getElementById('news-modal-cancel').addEventListener('click', function () {
      document.getElementById('news-modal').classList.remove('modal-show');
    });
    document.getElementById('news-modal').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('news-modal')) {
        document.getElementById('news-modal').classList.remove('modal-show');
      }
    });
  }
  initNewsForm();

  // ---------------- SUBSCRIPTIONS / PAYMENTS ----------------
  let packagesMap = {};

  async function loadSubscriptions() {
    const [pkgRes, subRes] = await Promise.all([
      supabase.from('packages').select('id,duration_months,name'),
      supabase.from('subscriptions').select('*, profiles(email, full_name)').order('created_at', { ascending: false }),
    ]);
    packagesMap = {};
    (pkgRes.data || []).forEach(function (p) { packagesMap[p.id] = p; });
    renderSubs(subRes.data || []);
  }

  function renderSubs(subs) {
    const container = document.getElementById('subs-list');
    if (!subs.length) {
      container.innerHTML = '<p class="muted">ยังไม่มีคำสั่งซื้อ</p>';
      return;
    }
    const sorted = subs.slice().sort(function (a, b) {
      return rank(a.status) - rank(b.status) || new Date(b.created_at) - new Date(a.created_at);
    });
    function rank(s) { return s === 'pending' ? 0 : s === 'active' ? 1 : 2; }

    container.innerHTML = sorted.map(function (s) {
      const prof = s.profiles || {};
      const pkg = packagesMap[s.package_id] || {};
      const months = pkg.duration_months || 1;
      let actions = '';
      if (s.status === 'pending') {
        actions =
          ' <button type="button" class="btn btn-sm btn-primary" data-approve="' + s.id + '">อนุมัติ</button>' +
          ' <button type="button" class="btn btn-sm btn-danger-outline" data-reject="' + s.id + '">ไม่อนุมัติ</button>';
      }
      return (
        '<div class="admin-sub">' +
        '<div class="admin-sub-info">' +
        '<strong>' + ess.esc(prof.full_name || prof.email || 'สมาชิก') + '</strong>' +
        '<span>เลขที่ ' + ess.esc(s.order_no || '-') + ' · ฿' + ess.formatMoney(s.amount) + ' · ' + ess.esc(s.package_name) + '</span>' +
        '<span class="muted">' + ess.esc(prof.email || '') + ' · ' + ess.formatDate(s.created_at) + '</span>' +
        (s.admin_note ? '<span class="muted">หมายเหตุ: ' + ess.esc(s.admin_note) + '</span>' : '') +
        '</div>' +
        '<div class="admin-sub-right">' +
        ess.statusLabel(s.status) +
        (s.slip_path ? ' <button type="button" class="btn btn-sm btn-outline" data-slip="' + s.slip_path + '">ดูสลิป</button>' : '<span class="muted"> (ยังไม่ส่งสลิป)</span>') +
        actions +
        '</div></div>'
      );
    }).join('');

    container.querySelectorAll('[data-slip]').forEach(function (b) {
      b.addEventListener('click', async function () {
        openSlipModal(b.dataset.slip);
      });
    });
    container.querySelectorAll('[data-approve]').forEach(function (b) {
      b.addEventListener('click', function () { approveSub(b.dataset.approve); });
    });
    container.querySelectorAll('[data-reject]').forEach(function (b) {
      b.addEventListener('click', function () { rejectSub(b.dataset.reject); });
    });
  }

  async function openSlipModal(path) {
    const { data } = await supabase.storage.from('slips').createSignedUrl(path, 3600);
    const modal = document.getElementById('slip-modal');
    document.getElementById('slip-modal-img').src = data ? data.signedUrl : '';
    modal.classList.add('modal-show');
  }

  async function approveSub(id) {
    if (!confirm('ยืนยันการอนุมัติชำระเงินและเปิดใช้งานแพคเกจ?')) return;
    const { data, error } = await supabase.rpc('admin_approve_subscription', { p_sub_id: id, p_admin_note: '' });
    if (error) { ess.toast('เกิดข้อผิดพลาด: ' + error.message, 'error'); return; }
    if (!data) { ess.toast('ไม่อนุมัติได้ (สถานะไม่ใช่ pending)', 'error'); return; }
    ess.toast('อนุมัติแล้ว สมาชิกใช้งานได้ (แจ้งเตือนถูกส่งแล้ว)', 'success');
    loadSubscriptions();
    loadStats();
    loadStatsTab();
  }

  async function rejectSub(id) {
    const note = prompt('หมายเหตุการไม่อนุมัติ (ไม่บังคับ):', '');
    if (note === null) return;
    const { data, error } = await supabase.rpc('admin_reject_subscription', { p_sub_id: id, p_note: note || '' });
    if (error) { ess.toast('เกิดข้อผิดพลาด: ' + error.message, 'error'); return; }
    if (!data) { ess.toast('ไม่อนุมัติได้ (สถานะไม่ใช่ pending)', 'error'); return; }
    ess.toast('ไม่อนุมัติคำสั่งซื้อแล้ว', 'success');
    loadSubscriptions();
    loadStats();
  }

  // ---------------- SETTINGS ----------------
  async function loadSettings() {
    const { data } = await supabase.from('settings').select('key,value').eq('key', 'promptpay_id').maybeSingle();
    if (data) document.getElementById('set-promptpay').value = data.value;
  }

  async function initSettingsForm() {
    const form = document.getElementById('settings-form');
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      const value = document.getElementById('set-promptpay').value.trim();
      const digits = value.replace(/\D/g, '');
      if (digits.length !== 10 && digits.length !== 13) {
        ess.toast('เบอร์พร้อมเพย์ต้องเป็นเบอร์โทร 10 หลัก หรือ เลข 13 หลัก', 'error');
        return;
      }
      const { data, error } = await supabase.from('settings').upsert({ key: 'promptpay_id', value: digits });
      if (error) { ess.toast('บันทึกไม่สำเร็จ: ' + error.message, 'error'); return; }
      ess.toast('บันทึกเบอร์พร้อมเพย์แล้ว (ใช้กับ QR ใหม่)', 'success');
    });
  }
  initSettingsForm();

  // slip modal close
  document.getElementById('slip-modal-close').addEventListener('click', function () {
    document.getElementById('slip-modal').classList.remove('modal-show');
  });

  // ---------------- STATS DASHBOARD ----------------
  async function loadStatsTab() {
    loadVisitChart();
    loadRevenueChart();
    loadPkgStats();
    loadExpiring();
  }

  function renderBarChart(elId, labels, values, money) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!labels.length) { el.innerHTML = '<p class="muted">ยังไม่มีข้อมูล</p>'; return; }
    const max = Math.max.apply(null, values.concat([1]));
    el.innerHTML = '<div class="barchart-row">' + labels.map(function (lab, i) {
      const h = Math.max(4, Math.round((values[i] / max) * 150));
      return (
        '<div class="barchart-col" title="' + ess.esc(lab) + ': ' +
        (money ? ess.formatMoney(values[i]) : values[i]) + '">' +
        '<div class="barchart-bar" style="height:' + h + 'px;">' +
        '<span class="barchart-val">' + (money ? Math.round(values[i]) : values[i]) + '</span></div>' +
        '<span class="barchart-label">' + ess.esc(lab) + '</span></div>'
      );
    }).join('') + '</div>';
  }

  async function loadVisitChart() {
    const since = new Date();
    since.setDate(since.getDate() - 13);
    since.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('visits')
      .select('checked_in_at')
      .gte('checked_in_at', since.toISOString())
      .order('checked_in_at', { ascending: true });
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      days.push({ key: key, label: (d.getMonth() + 1) + '/' + d.getDate(), n: 0 });
    }
    (data || []).forEach(function (v) {
      const key = new Date(v.checked_in_at).toISOString().slice(0, 10);
      const day = days.find(function (x) { return x.key === key; });
      if (day) day.n++;
    });
    renderBarChart('chart-visits', days.map(function (d) { return d.label; }), days.map(function (d) { return d.n; }), false);
  }

  async function loadRevenueChart() {
    const since = new Date();
    since.setMonth(since.getMonth() - 5);
    since.setDate(1); since.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from('subscriptions')
      .select('amount, paid_at, status')
      .gte('paid_at', since.toISOString())
      .not('status', 'eq', 'rejected')
      .not('status', 'eq', 'cancelled');
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: (d.getMonth() + 1) + '/', sum: 0 });
    }
    (data || []).forEach(function (s) {
      if (!s.paid_at) return;
      const key = new Date(s.paid_at).toISOString().slice(0, 7);
      const m = months.find(function (x) { return x.key === key; });
      if (m) m.sum += Number(s.amount) || 0;
    });
    renderBarChart('chart-revenue', months.map(function (m) { return m.label; }), months.map(function (m) { return m.sum; }), true);
  }

  async function loadPkgStats() {
    const { data } = await supabase
      .from('subscriptions')
      .select('package_name, status')
      .in('status', ['active', 'expired']);
    const box = document.getElementById('stats-packages');
    if (!box) return;
    const tally = {};
    (data || []).forEach(function (s) {
      tally[s.package_name] = (tally[s.package_name] || 0) + 1;
    });
    const rows = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; });
    const total = rows.reduce(function (sum, k) { return sum + tally[k]; }, 0);
    if (!rows.length) { box.innerHTML = '<p class="muted">ยังไม่มีข้อมูล</p>'; return; }
    box.innerHTML = rows.map(function (k) {
      const pct = total ? Math.round((tally[k] / total) * 100) : 0;
      return (
        '<div class="stat-row"><span>' + ess.esc(k) + '</span>' +
        '<div class="stat-pct"><div style="width:' + pct + '%;"></div></div>' +
        '<span> ' + tally[k] + ' คน</span></div>'
      );
    }).join('');
  }

  async function loadExpiring() {
    const today = new Date();
    const fmt = function (d) { return d.toISOString().slice(0, 10); };
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + 30);
    const { data } = await supabase
      .from('subscriptions')
      .select('*, profiles(full_name, email)')
      .eq('status', 'active')
      .gte('end_date', fmt(today))
      .lte('end_date', fmt(windowEnd))
      .order('end_date', { ascending: true });
    const box = document.getElementById('stats-expiring');
    if (!box) return;
    if (!data || !data.length) {
      box.innerHTML = '<p class="muted">ไม่มีสมาชิกหมดอายุภายใน 30 วัน</p>';
      return;
    }
    const daysLeft = function (end) {
      const dif = Math.ceil((new Date(end) - new Date()) / 86400000);
      return dif <= 7
        ? '<span class="badge badge-rejected">' + dif + ' วัน</span>'
        : '<span class="badge badge-pending">' + dif + ' วัน</span>';
    };
    box.innerHTML = data.map(function (s) {
      const prof = s.profiles || {};
      return (
        '<div class="sub-row"><div><strong>' + ess.esc(prof.full_name || 'สมาชิก') + '</strong> ' + daysLeft(s.end_date) +
        '<br><span class="muted">' + ess.esc(prof.email || '') + ' · หมด ' + ess.formatDate(s.end_date) + '</span></div></div>'
      );
    }).join('');
  }
})();