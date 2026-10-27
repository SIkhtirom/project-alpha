import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as acorn from 'acorn';

const PUB = path.join(process.cwd(), 'public');

const GLOBALS = new Set([
  'window', 'document', 'console', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'matchMedia',
  'localStorage', 'sessionStorage', 'navigator', 'location', 'history', 'crypto', 'atob', 'btoa',
  'Uint8Array', 'Int8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array', 'ArrayBuffer', 'SharedArrayBuffer',
  'DataView', 'TextEncoder', 'TextDecoder', 'Promise', 'JSON', 'Math', 'Date', 'Object', 'Array', 'String',
  'Number', 'Boolean', 'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError',
  'URIError', 'AggregateError', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'RegExp', 'Proxy', 'Reflect',
  'BigInt', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent',
  'encodeURI', 'decodeURI', 'Blob', 'File', 'FileReader', 'FormData', 'EventSource', 'CustomEvent',
  'Event', 'HTMLElement', 'HTMLInputElement', 'HTMLVideoElement', 'Image', 'URL', 'URLSearchParams',
  'structuredClone', 'globalThis', 'undefined', 'NaN', 'Infinity', 'Intl', 'alert', 'confirm', 'prompt',
  'CSS', 'performance', 'WebSocket', 'Headers', 'Request', 'Response', 'AbortController', 'TextEncoderStream',
  'getSelection', 'scrollTo', 'scrollBy', 'open', 'close', 'print', 'focus', 'blur', 'innerWidth', 'innerHeight',
  'devicePixelRatio', 'self', 'history', 'location', 'name', 'status', 'origin', 'hash', 'host', 'hostname', 'protocol', 'pathname', 'search', 'top', 'parent', 'frames', 'length', 'Notification', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
]);

function collectPattern(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Identifier': out.add(node.name); break;
    case 'ObjectPattern': for (const pr of node.properties) collectPattern(pr.type === 'RestElement' ? pr.argument : pr.value, out); break;
    case 'ArrayPattern': for (const el of node.elements) collectPattern(el, out); break;
    case 'AssignmentPattern': collectPattern(node.left, out); break;
    case 'RestElement': collectPattern(node.argument, out); break;
    default: break;
  }
}

function analyze(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const declared = new Set();
  const used = [];

  const walk = (node, parent, key) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDeclaration':
        for (const sp of node.specifiers) declared.add(sp.local.name);
        break;
      case 'VariableDeclarator':
        collectPattern(node.id, declared);
        break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (node.id) declared.add(node.id.name);
        for (const pr of node.params) collectPattern(pr, declared);
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (node.id) declared.add(node.id.name);
        break;
      case 'CatchClause':
        collectPattern(node.param, declared);
        break;
      case 'LabeledStatement':
      case 'BreakStatement':
      case 'ContinueStatement':
        if (node.label) declared.add(node.label.name);
        break;
      default: break;
    }
    const isPropertyKey = parent && (parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition') && key === 'key' && !parent.computed;
    const isMemberProp = parent && parent.type === 'MemberExpression' && key === 'property' && !parent.computed;
    const isObjPropValue = parent && parent.type === 'Property' && key === 'value';
    if (node.type === 'Identifier' && !isPropertyKey && !isMemberProp && !(isObjPropValue && parent.shorthand)) {
      used.push({ name: node.name, line: node.loc ? node.loc.start.line : 0 });
    }
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'loc' || k === 'start' || k === 'end') continue;
      const child = node[k];
      if (Array.isArray(child)) for (const c of child) walk(c, node, k);
      else if (child && typeof child === 'object') walk(child, node, k);
    }
  };
  walk(ast, null, null);

  const missing = [];
  const seen = new Set();
  for (const u of used) {
    if (declared.has(u.name) || GLOBALS.has(u.name)) continue;
    if (seen.has(u.name)) continue;
    seen.add(u.name);
    missing.push(u);
  }
  return missing;
}

test('tidak ada variabel atau fungsi yang tidak terdefinisi di modul frontend utama', () => {
  const files = ['security.js', 'face.js', 'security-views.js', 'app.js', 'api.js', 'ui.js', 'views.js'];
  for (const f of files) {
    const missing = analyze(path.join(PUB, f));
    const names = missing.map((m) => m.name + ' (baris ' + m.line + ')').join(', ');
    assert.equal(missing.length, 0, 'simbol tak terdefinisi di public/' + f + ': ' + names);
  }
});

test('fungsi base64url tersedia untuk WebAuthn di public/security.js', () => {
  const src = fs.readFileSync(path.join(PUB, 'security.js'), 'utf8');
  assert.match(src, /export function b64u\(/);
  assert.match(src, /export function unb64u\(/);
  assert.match(src, /function b64uToBuf\(/);
  const missing = analyze(path.join(PUB, 'security.js'));
  assert.equal(missing.length, 0);
});

test('pesan galat yang ditampilkan ke pengguna berbahasa Indonesia', () => {
  const ui = fs.readFileSync(path.join(PUB, 'ui.js'), 'utf8');
  assert.match(ui, /export function friendlyError/);
  assert.match(ui, /Pendaftaran sidik jari dibatalkan/);
  assert.match(ui, /Akses kamera belum diizinkan/);
  assert.match(ui, /Koneksi ke server terputus/);
  const sec = fs.readFileSync(path.join(PUB, 'security.js'), 'utf8');
  assert.match(sec, /friendlyError/);
  const api = fs.readFileSync(path.join(PUB, 'api.js'), 'utf8');
  assert.match(api, /friendlyError/);
});

test('tata letak login memakai container layar penuh dan QR di tengah', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'public', 'styles.css'), 'utf8');
  assert.match(css, /\.auth \{[^}]*min-height: 100vh/);
  assert.match(css, /\.auth \{[^}]*display: flex/);
  assert.match(css, /\.auth \{[^}]*justify-content: center/);
  const scss = fs.readFileSync(path.join(process.cwd(), 'public', 'security.css'), 'utf8');
  assert.match(scss, /\.twofa-link \{[^}]*flex-direction: column/);
  assert.match(scss, /\.twofa-link \{[^}]*align-items: center/);
  assert.match(scss, /\.qr-2fa \{[^}]*margin: 0 auto/);
});

test('pop-up Accept hanya muncul sekali dan terpisah dari alur buka kunci', () => {
  const src = fs.readFileSync(path.join(PUB, 'security-views.js'), 'utf8');
  assert.match(src, /acceptPromptDone/);
  const modalFn = src.slice(src.indexOf('async function showAcceptModal'), src.indexOf('async function showAcceptModal') + 420);
  assert.match(modalFn, /if \(state\.acceptPromptDone\) return;/);
  assert.doesNotMatch(src, /setTimeout\(\(\) => \{ showAcceptModal/, 'pop-up tidak boleh dipicu otomatis oleh render');
  const unlockBlock = src.slice(src.indexOf("act === 'unlock-face'"), src.indexOf("act === 'unlock-face'") + 400);
  assert.doesNotMatch(unlockBlock, /showAcceptModal/, 'buka kunci tidak boleh memunculkan pop-up Accept');
  const unlockWa = src.slice(src.indexOf("act === 'unlock-webauthn'"), src.indexOf("act === 'unlock-webauthn'") + 500);
  assert.doesNotMatch(unlockWa, /showAcceptModal/, 'buka kunci sidik jari tidak boleh memunculkan pop-up Accept');
});

test('pendaftaran wajah memakai validasi pose ketat dan jeda 5 detik', () => {
  const face = fs.readFileSync(path.join(PUB, 'face.js'), 'utf8');
  assert.match(face, /Posisi Wajah Salah/);
  assert.match(face, /strictPose/);
  assert.match(face, /wrong-pose/);
  const sec = fs.readFileSync(path.join(PUB, 'security.js'), 'utf8');
  assert.match(sec, /strictPose: true/);
  assert.match(sec, /strictPose: true/);
  assert.doesNotMatch(sec, /strictPose: false/);
  const srv = fs.readFileSync(path.join(process.cwd(), 'server', 'face.js'), 'utf8');
  assert.match(srv, /FACE_ENROLL_HOLD_MS = 5000/);
});

test('arah orientasi wajah divalidasi ketat dan tidak ada toleransi buta', () => {
  const face = fs.readFileSync(path.join(PUB, 'face.js'), 'utf8');
  assert.match(face, /FACE_FRONT_TOLERANCE = 0\.13/);
  assert.match(face, /FACE_SIDE_THRESHOLD = 0\.16/);
  assert.doesNotMatch(face, /FACE_OFFSET_TOLERANCE/);
  assert.match(face, /if \(stage\.key === 'left'\) return off >= FACE_SIDE_THRESHOLD;/);
  assert.match(face, /if \(stage\.key === 'right'\) return off <= -FACE_SIDE_THRESHOLD;/);
  const srv = fs.readFileSync(path.join(process.cwd(), 'server', 'face.js'), 'utf8');
  assert.match(srv, /FACE_POSE_SIMILARITY_MIN = 0\.35/);
});

test('tombol Kunci Kembali selalu menutup tampilan walau permintaan server gagal', () => {
  const src = fs.readFileSync(path.join(PUB, 'security-views.js'), 'utf8');
  const lockBlock = src.slice(src.indexOf("act === 'lock'"), src.indexOf("act === 'lock'") + 520);
  assert.match(lockBlock, /lockVault\(ctx\);/);
  const idxLocal = lockBlock.indexOf('lockVault(ctx);');
  const idxApi = lockBlock.indexOf("apiPost('/api/vault/lock'");
  assert.ok(idxLocal >= 0 && idxApi >= 0, 'kunci lokal dan panggilan server harus ada');
  assert.ok(idxLocal < idxApi, 'kunci lokal harus dijalankan lebih dulu agar tampilan tetap tertutup');
  assert.match(lockBlock, /catch/);
  const lockVaultBlock = src.slice(src.indexOf('function lockVault'), src.indexOf('function lockVault') + 420);
  assert.match(lockVaultBlock, /state\.lockHidden = true;/);
  assert.match(lockVaultBlock, /state\.token = null;/);
  assert.match(src, /const showTable = enrolled && state\.accepted && !state\.lockHidden;/);
});

test('mesin deteksi wajah punya fallback berlapis dan mock enrollment', () => {
  const face = fs.readFileSync(path.join(PUB, 'face.js'), 'utf8');
  assert.match(face, /export const MOCK_VECTOR/);
  assert.match(face, /detectBySkin/);
  assert.match(face, /detectByMotion/);
  assert.match(face, /mock = true/);
  assert.match(face, /mock,/);
  assert.match(face, /allowMock/);
  assert.match(face, /console\.warn/);
  const sec = fs.readFileSync(path.join(PUB, 'security.js'), 'utf8');
  assert.match(sec, /MOCK_VECTOR\.slice\(\)/);
  assert.match(sec, /fallback: captured\.mocked === true/);
});

test('akun Pendana punya menu keamanan, brankas, dan jejak audit tanpa duplikasi', () => {
  const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  const nav = app.slice(app.indexOf("group: 'Pendana'"), app.indexOf("group: 'Penerima'"));
  assert.match(nav, /'keamanan', 'Keamanan & Firewall \(WAF\)'/);
  assert.match(nav, /'brankas', 'Brankas Data Nominatif'/);
  assert.match(nav, /'audit', 'Jejak Audit'/);
  assert.doesNotMatch(nav, /'notifikasi'/, 'menu Notifikasi tidak boleh diduplikasi di grup Pendana');
  const notifTotal = (app.match(/'notifikasi', 'Notifikasi'/g) || []).length;
  assert.equal(notifTotal, 1, 'menu Notifikasi hanya boleh terdaftar satu kali (grup Akun)');
});

test('backend memberi akses Pendana pada WAF, Brankas, dan Jejak Audit', () => {
  const routes = fs.readFileSync(path.join(process.cwd(), 'server', 'security-routes.js'), 'utf8');
  assert.match(routes, /const backoffice = \['admin', 'manajer', 'pendana'\]/);
  assert.match(routes, /const vaultRoles = \['admin', 'manajer', 'finance', 'pendana'\]/);
  const services = fs.readFileSync(path.join(process.cwd(), 'public', 'shared', 'services.js'), 'utf8');
  assert.match(services, /S\.auditLog[\s\S]{0,160}need\(actor, 'admin', 'manajer', 'pendana'\)/);
  const views = fs.readFileSync(path.join(PUB, 'views.js'), 'utf8');
  assert.match(views, /const audit = \{\s*roles: \['admin', 'manajer', 'pendana'\]/);
  const sec = fs.readFileSync(path.join(PUB, 'security-views.js'), 'utf8');
  assert.match(sec, /export const keamanan = \{\s*roles: \['admin', 'manajer', 'pendana'\]/);
  assert.match(sec, /export const brankas = \{\s*roles: \['admin', 'manajer', 'finance', 'pendana'\]/);
});

test('akun demo investor dikonfigurasi lengkap di server dan seed', () => {
  const idx = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');
  assert.match(idx, /export const DEMO_INVESTOR = \{/);
  assert.match(idx, /email: 'investor@kmh\.coop'/);
  assert.match(idx, /name: 'Investor KMH'/);
  assert.match(idx, /roles: \['pendana'\]/);
  assert.match(idx, /ensureDemoInvestor\(db, S\)/);
  assert.match(idx, /investorPasswordHash: bcrypt\.hashSync\(DEMO_INVESTOR\.password, 10\)/);
  const seed = fs.readFileSync(path.join(process.cwd(), 'public', 'shared', 'seed.js'), 'utf8');
  assert.match(seed, /export const DEMO_INVESTOR = \{/);
  assert.match(seed, /investorPasswordHash/);
});

test('tombol simulasi gagal verifikasi wajah sudah dihapus permanen', () => {
  const views = fs.readFileSync(path.join(PUB, 'security-views.js'), 'utf8');
  const sec = fs.readFileSync(path.join(PUB, 'security.js'), 'utf8');
  const face = fs.readFileSync(path.join(PUB, 'face.js'), 'utf8');
  assert.doesNotMatch(views, /Simulasikan Gagal Verifikasi/);
  assert.doesNotMatch(views, /data-face="simulate"/);
  assert.doesNotMatch(sec, /simulateFailure/);
  assert.doesNotMatch(face, /simulateFailure/);
  assert.doesNotMatch(views, /dataset\.face === 'simulate'/);
});

test('server menerima pendaftaran wajah secara langsung tanpa validasi akhir yang memblokir', () => {
  const srv = fs.readFileSync(path.join(process.cwd(), 'server', 'face.js'), 'utf8');
  assert.match(srv, /challengeTtlMs \|\| 20 \* 60e3/);
  const enrollBlock = srv.slice(srv.indexOf('async function enrollVerify'), srv.indexOf('async function unlockVerify'));
  assert.doesNotMatch(enrollBlock, /jumlah tahapan tidak lengkap/);
  assert.doesNotMatch(enrollBlock, /pose belum lengkap/);
  assert.match(enrollBlock, /return \{ ok: true, enrolled: true, poses: FACE_POSES/);
  assert.match(srv, /return \{ ok: true, enrolled: true, poses: FACE_POSES/);
});

test('endpoint pendaftaran menyiapkan secret 2FA dan peran pendana', () => {
  const idx = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');
  assert.match(idx, /app\.post\('\/api\/auth\/register'/);
  assert.match(idx, /await ensureUserSecret\(db, row\)/);
  const svc = fs.readFileSync(path.join(process.cwd(), 'public', 'shared', 'services.js'), 'utf8');
  assert.match(svc, /kyc_status: 'approved'/);
  assert.match(svc, /if \(wanted\.includes\('pendana'\)\) \{ await wallet\(t, 'member', u\.id\); await ensureVA\(t, 'member', u\.id\); \}/);
});

test('halaman Beranda, Portofolio, dan Dompet menampilkan dana Rp 150 Miliar untuk akun Pendana', () => {
  const views = fs.readFileSync(path.join(PUB, 'views.js'), 'utf8');
  assert.match(views, /const vaultStat = /);
  assert.match(views, /const vaultBanner = /);
  const beranda = views.slice(views.indexOf('const beranda = {'), views.indexOf('const pasar = {'));
  const portofolio = views.slice(views.indexOf('const portofolio = {'), views.indexOf('const dompet = {'));
  const dompet = views.slice(views.indexOf('const dompet = {'), views.indexOf('const saya = {'));
  assert.match(beranda, /vaultStat\(me\)/);
  assert.match(beranda, /vaultBanner\(me\)/);
  assert.match(portofolio, /vaultStat\(me\)/);
  assert.match(portofolio, /Portofolio Aktif Pendana/);
  assert.match(dompet, /vaultStat\(me\)/);
  assert.match(dompet, /vaultBanner\(me\)/);
  const constants = fs.readFileSync(path.join(process.cwd(), 'public', 'shared', 'constants.js'), 'utf8');
  assert.match(constants, /export const VAULT_TOTAL_DANA = 150000000000;/);
  assert.match(constants, /export const VAULT_LOS_KONTRAK = 560;/);
});

test('logo KMH terpasang di sidebar, tab browser, login, daftar, dan 2FA', () => {
  const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const logoCount = (app.match(/brand-mark-img/g) || []).length;
  assert.ok(logoCount >= 3, 'logo harus terpasang di sidebar, login/daftar, dan 2FA, ditemukan=' + logoCount);
  assert.doesNotMatch(app, /brand-mark"[^>]*>KMH</, 'teks KMH pada kotak logo harus diganti gambar');
  assert.match(html, /<link rel="icon" type="image\/png" href="\/KMH.png">/);
  assert.match(html, /<link rel="shortcut icon" type="image\/png" href="\/KMH.png">/);
  assert.ok(fs.existsSync(path.join(process.cwd(), 'public', 'KMH.png')), 'file logo harus tersalin ke public/');
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(css, /\.brand-mark-img img/);
});

test('input form pendaftaran memiliki styling yang sama dengan input lain', () => {
  const app = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(app, /id="r-no" name="member_no" type="text"/);
  assert.match(app, /id="r-name" name="name" type="text"/);
  assert.match(css, /input:not\(\[type\]\), input\[type=text\]/);
});

test('tombol Salin berada di sebelah kiri nomor Virtual Account', () => {
  const views = fs.readFileSync(path.join(PUB, 'views.js'), 'utf8');
  const i = views.indexOf('function vaBox');
  const block = views.slice(i, i + 600);
  const btn = block.indexOf('data-act="copy"');
  const va = block.indexOf('class="va"');
  assert.ok(btn > 0 && va > 0);
  assert.ok(btn < va, 'tombol Salin harus berada sebelum nomor VA');
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(css, /\.va-box \{ display: inline-flex; align-items: center;/);
});

test('angka pada box statistik tidak melebar keluar kotak', () => {
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  assert.match(css, /\.stat \{[^}]*min-width: 0;[^}]*overflow: hidden;/);
  assert.match(css, /\.stat \.value \{[^}]*font-size: clamp\(/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test('routing memakai jalur autentikasi #auth/login dan #auth/2fa', () => {
  const src = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  assert.match(src, /auth\/login/);
  assert.match(src, /auth\/2fa/);
  assert.match(src, /syncHash/);
  assert.match(src, /hashchange/);
});

