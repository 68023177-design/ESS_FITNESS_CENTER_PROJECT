// ============================================================
// ESS Fitness Center - shared auth / session / nav helpers
// ============================================================
(function () {
  'use strict';

  const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  window.ess = window.ess || {};

  async function getSession() {
    const { data } = await client.auth.getSession();
    return data && data.session ? data.session : null;
  }

  async function getProfile() {
    const session = await getSession();
    if (!session) return null;
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  }

  async function requireLogin() {
    const session = await getSession();
    if (!session) {
      window.location.href = 'login.html';
      return null;
    }
    const profile = await getProfile();
    if (!profile) {
      window.location.href = 'login.html';
      return null;
    }
    return { session, profile };
  }

  async function requireAdmin() {
    const ctx = await requireLogin();
    if (!ctx) return null;
    if (ctx.profile.role !== 'admin') {
      window.location.href = 'index.html';
      return null;
    }
    return ctx;
  }

  async function logout() {
    try { await client.auth.signOut(); } catch (e) { /* ignore */ }
    window.location.href = 'login.html';
  }

  function formatMoney(v) {
    const n = Number(v || 0);
    return n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusLabel(s) {
    const map = {
      pending: ['รอตรวจสอบ', 'badge-pending'],
      active: ['สมัครแล้ว (Active)', 'badge-active'],
      rejected: ['ไม่อนุมัติ', 'badge-rejected'],
      expired: ['หมดอายุ', 'badge-expired'],
      cancelled: ['ยกเลิกแล้ว', 'badge-expired'],
    };
    const m = map[s] || [s, 'badge'];
    return '<span class="badge ' + m[1] + '">' + m[0] + '</span>';
  }

  function toast(message, type) {
    type = type || 'info';
    const box = document.getElementById('toast-box');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(function () {
      el.classList.add('toast-hide');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 3200);
  }

  async function renderNav(active) {
    const nav = document.getElementById('navbar');
    if (!nav) return;
    const session = await getSession();
    const profile = session ? await getProfile() : null;
    const isAdmin = profile && profile.role === 'admin';

    let inner = '';
    inner += '<a href="index.html" class="nav-brand">' +
      '<span class="nav-brand-mark">ESS</span><span>' + APP_SHORT_NAME + '</span></a>';
    inner += '<button type="button" id="nav-toggle" class="nav-toggle" aria-label="เปิดเมนู" aria-expanded="false"><span></span><span></span><span></span></button>';
    inner += '<div class="nav-links">';
    inner += '<a href="index.html" data-nav="index">หน้าแรก</a>';
    inner += '<a href="packages.html" data-nav="packages">แพคเกจ</a>';
    if (session) {
      inner += '<a href="profile.html" data-nav="profile">โปรไฟล์</a>';
      if (isAdmin) inner += '<a href="admin.html" data-nav="admin">จัดการระบบ</a>';
      if (isAdmin) inner += '<a href="checkin.html" data-nav="checkin">เช็คอิน</a>';
      inner += '<a href="profile.html" class="nav-bell" id="nav-bell" title="การแจ้งเตือน" aria-label="การแจ้งเตือน">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>' +
        '<span id="nav-bell-badge" class="nav-bell-badge" style="display:none;">0</span></a>';
      inner += '<button type="button" class="btn-link" id="btn-logout">ออกจากระบบ</button>';
    } else {
      inner += '<a href="login.html" data-nav="login" class="nav-cta">เข้าสู่ระบบ</a>';
      inner += '<a href="register.html" data-nav="register" class="nav-cta nav-cta-solid">สมัครสมาชิก</a>';
    }
    inner += '</div>';
    nav.innerHTML = inner;

    const toggle = document.getElementById('nav-toggle');
    const linksBox = nav.querySelector('.nav-links');
    function closeMenu() {
      if (nav) nav.classList.remove('nav-open');
      if (toggle) {
        toggle.classList.remove('nav-toggle-active');
        toggle.setAttribute('aria-expanded', 'false');
      }
    }
    if (toggle && linksBox) {
      toggle.addEventListener('click', function () {
        const open = nav.classList.toggle('nav-open');
        toggle.classList.toggle('nav-toggle-active', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      linksBox.addEventListener('click', function (ev) {
        if (ev.target.closest('a, button')) closeMenu();
      });
    }

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    if (session) startNotifPoller();

    if (active) {
      const target = nav.querySelector('[data-nav="' + active + '"]');
      if (target) target.classList.add('nav-active');
    }
  }

  // Unread-notification badge in the navbar (poll every 30s)
  async function refreshBell() {
    const badge = document.getElementById('nav-bell-badge');
    if (!badge) return;
    const { count } = await client
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('read_at', null);
    const n = count || 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.style.display = n > 0 ? 'block' : 'none';
  }
  function startNotifPoller() {
    refreshBell();
    setInterval(refreshBell, 30000);
  }

  window.ess.client = client;
  window.ess.getSession = getSession;
  window.ess.getProfile = getProfile;
  window.ess.requireLogin = requireLogin;
  window.ess.requireAdmin = requireAdmin;
  window.ess.logout = logout;
  window.ess.formatMoney = formatMoney;
  window.ess.formatDate = formatDate;
  window.ess.esc = esc;
  window.ess.statusLabel = statusLabel;
  window.ess.toast = toast;
  window.ess.renderNav = renderNav;
})();