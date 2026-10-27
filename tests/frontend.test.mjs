import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const noop = () => { };
const mkEl = () => ({
  style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop },
  setAttribute: noop, removeAttribute: noop, appendChild: noop, remove: noop,
  addEventListener: noop, removeEventListener: noop, focus: noop, click: noop,
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
});
const appRoot = { _h: '', addEventListener: noop, removeEventListener: noop, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; } };

globalThis.document = {
  getElementById: (id) => (id === 'app' ? appRoot : mkEl()),
  querySelector: () => mkEl(),
  querySelectorAll: () => [],
  createElement: () => mkEl(),
  body: mkEl(),
  addEventListener: noop,
  documentElement: mkEl(),
};
globalThis.window = {
  location: { hostname: 'localhost', hash: '', href: 'http://localhost:3000/', origin: 'http://localhost:3000' },
  history: { replaceState: noop, pushState: noop },
  scrollTo: noop,
  addEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
};
globalThis.location = globalThis.window.location;
globalThis.history = globalThis.window.history;
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, credentials: {} }, configurable: true, writable: true });
globalThis.EventSource = class { constructor() { this.addEventListener = noop; } close() { } };
globalThis.fetch = async (url) => {
  const u = String(url);
  const ok = (data) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }), headers: new Map() });
  if (u.includes('api/health')) return { ok: true, status: 200, json: async () => ({ ok: true, mode: 'server' }), headers: new Map() };
  if (u.includes('rpc/getSettings')) return ok({ public: true, today: '2026-10-24' });
  if (u.includes('rpc/me')) return { ok: false, status: 401, json: async () => ({ error: 'Belum masuk' }), headers: new Map() };
  return ok(null);
};

const PUB = path.join(process.cwd(), 'public');
const MODULES = ['shared/calc.js', 'shared/constants.js', 'shared/memdb.js', 'shared/seed.js', 'shared/services.js', 'ui.js', 'views.js', 'security.js', 'face.js', 'security-views.js', 'api.js', 'app.js'];

test('semua modul frontend dapat dimuat tanpa exception', async () => {
  for (const m of MODULES) {
    await assert.doesNotReject(() => import('../public/' + m), 'modul ' + m + ' gagal dimuat');
  }
});

test('setiap view aplikasi dapat dirender tanpa exception', async () => {
  const { VIEWS } = await import('../public/views.js');
  const { SECURITY_VIEWS } = await import('../public/security-views.js');
  const ctx = {
    api: {
      mode: 'server',
      call: async (n) => {
        if (n === 'me') return { user: { name: 'A', email: 'a@b.c', roles: ['admin'], member_no: 'X', totp_enabled: 0 } };
        if (n === 'dashboard') {
          return {
            today: '2026-10-24', outstanding: 0, byStatus: {}, buckets: { lancar: { count: 0, amount: 0 }, macet: { count: 0, amount: 0 } },
            byPartner: {}, npl: 0, dpd30: 0, protection: 0, protection_coverage: 0, escrow_cash: 0,
            active_investors: 0, payments_total: 0, profit_distributed: 0, unmatched_payments: 0,
            members: 0, pending_kyc: 0, queue: { verify: 0, analyze: 0, committee: 0, sign: 0, disburse: 0, disb_pending: 0, wd_pending: 0 },
            kmh: {}, last_24h: 0, total: 0, blocked: 0, by_severity: {}, by_rule: {}, by_category: {}, top_rules: [],
          };
        }
        if (n === 'kmhWallet') return { available: 0, locked: 0, profit_total: 0, principal_returned: 0, va: '8808900000005' };
        if (n === 'trialBalance') return { rows: [], total_debit: 0, total_credit: 0, assets: 0, liabilities: 0, balanced: true };
        if (n === 'reconcile') return { rows: 0, matched: 0, missing_in_system: [], missing_in_bank: [], amount_mismatch: [], ledger_cash: 0 };
        if (n === 'getSettings') return { today: '2026-10-24', nisbah_investor: 70, protection_pct: 10, kmh_min_pct: 10, min_funding: 1000000, funding_step: 500000, max_investor_pct: 50, listing_days: 7, max_claim_pct: 50, committee_quorum: 2, va_prefix: '8808' };
        if (n === 'portfolio') return { rows: [], wallet: { available: 0, locked: 0, profit_total: 0, principal_returned: 0 } };
        return [];
      },
    },
    me: { user: { name: 'Admin KMH', email: 'admin@kmh.coop', roles: ['admin', 'manajer', 'finance'], member_no: 'STAF-001', totp_enabled: 0 }, wallet: { available: 0, locked: 0 }, unread: 0, today: '2026-10-24' },
    settings: { today: '2026-10-24', va_prefix: '8808' },
    route: 'beranda', params: {}, go: noop, refresh: async () => { },
  };
  for (const [name, view] of Object.entries({ ...VIEWS, ...SECURITY_VIEWS })) {
    if (!view || typeof view.render !== 'function') continue;
    if (name === 'keamanan' || name === 'brankas') continue;
    const html = await view.render(ctx);
    assert.equal(typeof html, 'string', 'view ' + name + ' harus mengembalikan string');
  }
});

test('halaman login Tahap 1 hanya memuat Email, Kata Sandi, dan tombol Masuk', async () => {
  await import('../public/app.js');
  await new Promise((r) => setTimeout(r, 800));
  const html = appRoot.innerHTML || '';
  assert.ok(html.length > 300, 'halaman login harus ter-render, panjang=' + html.length);
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
  assert.match(html, />Masuk</);
  assert.doesNotMatch(html, /name="otp"/, 'input kode autentikator harus dihapus dari halaman login');
  assert.doesNotMatch(html, /l-otp/);
  assert.doesNotMatch(html, /privy/i, 'referensi ID PRIVY harus hilang');
  assert.doesNotMatch(html, /Dua tahap/);
  assert.doesNotMatch(html, /privy-hints/);
});

test('app.js mengimpor seluruh simbol yang dipakai (anti ReferenceError)', () => {
  const src = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  const head = src.slice(0, 1200);
  for (const sym of ['detectMode', 'serverApi', 'demoApi', 'ROLE_LABEL', 'BACKOFFICE', 'esc', 'toast', 'formData', 'confirmDialog', 'modal', 'table', 'field', 'inp']) {
    assert.ok(head.includes(sym), 'simbol ' + sym + ' harus diimpor di app.js');
  }
});

test('tombol buka kunci database merespons meski menu Keamanan & Firewall dibuka lebih dulu', async () => {
  const { SECURITY_VIEWS } = await import('../public/security-views.js');
  const appended = [];
  globalThis.document.body.appendChild = (el) => { appended.push(el); };
  const listeners = [];
  const content = { addEventListener: (t, fn) => { if (t === 'click') listeners.push(fn); } };
  const ctx = {
    api: { mode: 'server', call: async () => ({}) },
    me: { user: { name: 'Admin', email: 'a@b.c', roles: ['admin', 'manajer', 'finance'], member_no: 'X', totp_enabled: 0 } },
    settings: {}, route: 'brankas', params: {}, go: () => { }, refresh: async () => { },
  };
  SECURITY_VIEWS.keamanan.after(ctx, content);
  SECURITY_VIEWS.brankas.after(ctx, content);
  assert.ok(listeners.length >= 2, 'kedua view harus mendaftarkan listener klik masing-masing');
  const btn = { dataset: { sec: 'unlock-face' }, closest: () => btn, disabled: false };
  for (const fn of listeners) await fn({ target: btn, preventDefault: () => { } });
  assert.ok(appended.length > 0, 'modal kamera Face Recognition harus muncul saat tombol diklik');
  assert.match(String(appended[0].innerHTML || ''), /Mulai Verifikasi/);
});

test('popup konfirmasi keluar memakai narasi yang diminta', () => {
  const src = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  assert.match(src, /Apakah yakin anda ingin keluar\?/);
  assert.match(src, /Ya, Keluar/);
  assert.match(src, /Batal/);
});

test('halaman 2FA Google Authenticator tersedia dengan QR dan kode rahasia', () => {
  const src = fs.readFileSync(path.join(PUB, 'app.js'), 'utf8');
  assert.match(src, /Verifikasi 2FA Google Authenticator/);
  assert.match(src, /qr-2fa/);
  assert.match(src, /secret-box/);
  assert.match(src, /name: 'code'/);
});

test('tidak ada referensi ID PRIVY di seluruh frontend dan server', () => {
  const roots = [path.join(process.cwd(), 'public'), path.join(process.cwd(), 'server')];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const f of roots.flatMap(walk).filter((f) => /\.(js|mjs)$/.test(f))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /privy/i, 'referensi privy masih ada di ' + f);
  }
});


