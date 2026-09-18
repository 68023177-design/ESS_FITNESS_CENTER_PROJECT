// ============================================================
// ESS Fitness Center - front-desk check-in (admin only)
// Scan the member QR card or search by code / name / email.
// ============================================================
(function () {
  'use strict';
  const ess = window.ess;
  const supabase = ess.client;

  let stream = null;
  let scanning = false;
  let rafId = 0;
  let lastScan = '';
  let lastScanAt = 0;
  let barcodeDetector = null;

  document.addEventListener('DOMContentLoaded', async function () {
    if (!(await ess.requireAdmin())) return;
    await ess.renderNav('checkin');
    await loadToday();
    initScannerButtons();
    initManualSearch();

    document.getElementById('checkin-modal-close').addEventListener('click', closeModal);
    document.getElementById('checkin-modal').addEventListener('click', function (ev) {
      if (ev.target === document.getElementById('checkin-modal')) closeModal();
    });
  });

  // ---------------- CAMERA SCANNER ----------------
  function initScannerButtons() {
    const btn = document.getElementById('btn-camera-toggle');
    btn.addEventListener('click', async function () {
      if (stream) { stopCamera(); return; }
      btn.disabled = true; btn.textContent = 'กำลังเปิดกล้อง...';
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        const video = document.getElementById('qr-video');
        video.srcObject = stream;
        await video.play();
        barcodeDetector = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
        scanning = true;
        btn.textContent = 'ปิดกล้อง';
        document.getElementById('scan-hint').textContent =
          barcodeDetector ? 'สแกนแล้ว (BarcodeDetector)' : 'สแกนแล้ว (jsQR)';
        rafId = requestAnimationFrame(tick);
      } catch (e) {
        ess.toast('เปิดกล้องไม่สำเร็จ: ' + (e.message || e), 'error');
        stopCamera();
      }
      btn.disabled = false;
    });
  }

  function stopCamera() {
    scanning = false;
    cancelAnimationFrame(rafId);
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    const btn = document.getElementById('btn-camera-toggle');
    if (btn) { btn.textContent = 'เปิดกล้องสแกน'; }
    const hint = document.getElementById('scan-hint');
    if (hint) hint.textContent = 'กล้องปิดอยู่ — กด "เปิดกล้องสแกน" เพื่อเริ่ม';
  }

  function tick() {
    if (!scanning) return;
    const video = document.getElementById('qr-video');
    const canvas = document.getElementById('qr-canvas');
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      if (barcodeDetector) {
        barcodeDetector.detect(canvas).then(function (codes) {
          codes.forEach(function (c) {
            if (c.rawValue) handleScan(String(c.rawValue).trim());
          });
        }).catch(function () {});
      } else {
        try {
          const ctx = canvas.getContext('2d');
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(img.data, img.width, img.height);
          if (code && code.data) handleScan(String(code.data).trim());
        } catch (e) { /* frame glitch */ }
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  function handleScan(code) {
    if (!code) return;
    // 10s cooldown per identical code to avoid double-fire
    if (code === lastScan && Date.now() - lastScanAt < 10000) return;
    lastScan = code;
    lastScanAt = Date.now();
    doCheckin(code);
  }

  // ---------------- MANUAL SEARCH ----------------
  function initManualSearch() {
    const input = document.getElementById('member-code-input');
    const btn = document.getElementById('btn-search-member');
    btn.addEventListener('click', function () { searchMember(input.value); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); searchMember(input.value); }
    });
  }

  async function searchMember(text) {
    const q = String(text || '').trim().toLowerCase();
    if (!q) { ess.toast('กรุณากรอกรหัส / ชื่อ / อีเมล / รหัสนักศึกษา', 'error'); return; }
    let matches = filtersToText(q);
    if (!matches.length) return;

    const box = document.getElementById('checkin-result');
    if (matches.length > 1) {
      box.innerHTML = '<p class="muted">พบ ' + matches.length + ' คน ระบุให้ชัดขึ้น:</p>' +
        '<div class="checkin-found">' + matches.map(function (m) {
          return '<button type="button" class="btn btn-outline btn-sm checkin-pick" data-code="' + ess.esc(m.member_code) + '">' +
            ess.esc(m.full_name || 'สมาชิก') + ' <span class="muted">(' + ess.esc(m.email) + ')</span></button>';
        }).join('') + '</div>';
      box.querySelectorAll('.checkin-pick').forEach(function (b) {
        b.addEventListener('click', function () { doCheckin(b.dataset.code); });
      });
      return;
    }
    doCheckin(matches[0].member_code);
  }

  // match by code prefix or by name / email / student id
  async function filtersToText(q) {
    const byCode = (await supabase
      .from('profiles')
      .select('member_code, full_name, email')
      .filter('member_code::text', 'ilike', q + '%')
      .limit(5)).data || [];
    if (byCode.length) return byCode;

    const byText = (await supabase
      .from('profiles')
      .select('member_code, full_name, email')
      .ilike('full_name', '%' + q + '%')
      .limit(5)).data;
    if (byText && byText.length) return byText;

    const byEmail = (await supabase
      .from('profiles')
      .select('member_code, full_name, email')
      .ilike('email', '%' + q + '%')
      .limit(5)).data;
    if (byEmail && byEmail.length) return byEmail;

    const bySid = (await supabase
      .from('profiles')
      .select('member_code, full_name, email')
      .ilike('student_id', '%' + q + '%')
      .limit(5)).data;
    if (bySid && bySid.length) return bySid;

    ess.toast('ไม่พบสมาชิกที่ตรงกับ "' + q + '"', 'error');
    return [];
  }

  // ---------------- CHECK-IN ---------------
  async function doCheckin(code) {
    if (!code || code === 'null') { ess.toast('คิวอาร์โค้ดไม่มีข้อมูลรหัสสมาชิก', 'error'); return; }
    const btnEl = document.getElementById('btn-search-member');
    btnEl.disabled = true;
    try {
      const { data, error } = await supabase.rpc('checkin_member', { p_member_code: code });
      if (error) {
        ess.toast('เช็คอินล้มเหลว: ' + error.message, 'error');
        return;
      }
      showResultModal(data || {});
      loadToday();
    } finally {
      btnEl.disabled = false;
    }
  }

  function showResultModal(r) {
    const body = document.getElementById('checkin-modal-body');
    const ok = r.ok === true;
    const name = r.full_name || '—';
    const pkg = r.package_name || '—';
    const cls = ok ? 'checkin-ok' : 'checkin-no';
    const icon = ok
      ? '<div class="checkin-status-icon">✓</div>'
      : '<div class="checkin-status-icon checkin-status-icon-no">✕</div>';
    const count = typeof r.visit_count === 'number' ? ' · ครั้งที่ ' + r.visit_count : '';
    body.innerHTML =
      '<div class="' + cls + '">' +
      icon +
      '<h3 class="member-card-name">' + ess.esc(name) + '</h3>' +
      '<p>' + ess.esc(r.message || '') + '</p>' +
      (ok ? '<div><span class="badge badge-active">' + ess.esc(pkg) + '</span> ' +
        '<span class="badge badge-active">เหลือ ' + (r.days_left == null ? '-' : r.days_left) + ' วัน</span>' + count + '</div>' : '') +
      '</div>';
    document.getElementById('checkin-modal').classList.add('modal-show');
  }

  function closeModal() {
    document.getElementById('checkin-modal').classList.remove('modal-show');
  }

  // ---------------- TODAY'S VISITS ----------------
  async function loadToday() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const [cnt, list] = await Promise.all([
      supabase.from('visits').select('id', { count: 'exact', head: true }).gte('checked_in_at', startOfDay),
      supabase.from('visits').select('*, profiles(full_name)').gte('checked_in_at', startOfDay).order('checked_in_at', { ascending: false }).limit(50),
    ]);

    const cntEl = document.getElementById('today-count');
    if (cntEl) cntEl.textContent = 'เข้าวันนี้ ' + (cnt.count || 0) + ' ครั้ง';

    const box = document.getElementById('today-visits');
    if (!list.data || !list.data.length) {
      box.innerHTML = '<p class="muted">ยังไม่มีผู้ใช้บริการวันนี้</p>';
      return;
    }
    box.innerHTML = '<div class="sub-row-columns">' + list.data.map(function (v) {
      const prof = v.profiles || {};
      const t = new Date(v.checked_in_at);
      return (
        '<div class="sub-row">' +
        '<div><strong>' + ess.esc(prof.full_name || 'สมาชิก') + '</strong></div>' +
        '<div class="sub-right">' + t.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) + '</div>' +
        '</div>'
      );
    }).join('') + '</div>';
  }
})();