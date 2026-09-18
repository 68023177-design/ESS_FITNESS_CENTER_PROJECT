const fs = require('fs');

const required = {
  'index.html': ['navbar', 'toast-box', 'news-list'],
  'packages.html': ['navbar', 'toast-box', 'packages-grid'],
  'login.html': ['login-form', 'email', 'password', 'form-error'],
  'register.html': ['register-form', 'full-name', 'email', 'student-id', 'phone', 'sex', 'password', 'confirm-password', 'form-error'],
  'subscribe.html': ['package-box', 'btn-create-sub'],
  'payment.html': ['pay-sub-status', 'pay-step', 'pay-done', 'qr-canvas', 'qr-amount-hint', 'slip-file', 'slip-preview', 'slip-preview-done', 'btn-submit-slip'],
  'profile.html': ['pv-email', 'pv-name', 'pv-student', 'pv-phone', 'pv-sex', 'pv-role', 'pv-joined', 'profile-edit-form', 'pe-full-name', 'pe-student-id', 'pe-phone', 'pe-sex', 'pw-form', 'pw-new', 'my-subs'],
  'admin.html': ['stat-members', 'stat-sub', 'stat-pending', 'stat-subs', 'packages-table', 'btn-add-pkg', 'pkg-modal', 'pkg-form', 'pkg-name', 'pkg-desc', 'pkg-price', 'pkg-duration', 'pkg-active', 'pkg-modal-title', 'pkg-modal-close', 'pkg-modal-cancel', 'members-table', 'member-search', 'subs-list', 'slip-modal', 'slip-modal-img', 'slip-modal-close', 'settings-form', 'set-promptpay', 'btn-add-news', 'news-admin-list', 'news-modal', 'news-form', 'news-title', 'news-content', 'news-img-file', 'news-img-preview', 'news-published', 'news-existing-img', 'news-modal-title', 'news-modal-close', 'news-modal-cancel'],
};

let fail = 0;
for (const [file, ids] of Object.entries(required)) {
  const html = fs.readFileSync(file, 'utf8');
  const htmlId = /id="([^"]+)"/g;
  const present = new Set();
  let m;
  while ((m = htmlId.exec(html))) present.add(m[1]);
  for (const id of ids) {
    if (!present.has(id)) {
      console.log('MISSING id="' + id + '" in ' + file);
      fail++;
    }
  }
}
if (fail) {
  console.log('FAILED: ' + fail + ' missing ids');
  process.exit(1);
}
console.log('All referenced element ids present.');

// verify every script include exists
const pages = Object.keys(required) + 'index.html';
for (const f of fs.readdirSync('.').filter(x => x.endsWith('.html'))) {
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script src="([^"]+)"><\/script>/g;
  let s;
  while ((s = re.exec(html))) {
    if (!fs.existsSync(s[1])) {
      console.log('MISSING script file: ' + s[1] + ' (in ' + f + ')');
      fail++;
    }
  }
  const re2 = /<link rel="stylesheet" href="([^"]+)">/g;
  let l;
  while ((l = re2.exec(html))) {
    if (!fs.existsSync(l[1])) {
      console.log('MISSING css file: ' + l[1] + ' (in ' + f + ')');
      fail++;
    }
  }
}
console.log(fail ? 'FAILED checks' : 'All script/css references resolve.');