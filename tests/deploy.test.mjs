import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createMemDb } from '../public/shared/memdb.js';
import { createServices } from '../public/shared/services.js';
import { seedDemo } from '../public/shared/seed.js';
import { isLocalhostHost, resolveCorsOrigin, tokenFromHeaders, CORS_ALLOWED_HEADERS } from '../server/index.js';
import { resolveRp } from '../server/security-routes.js';

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
globalThis.sessionStorage = { getItem: () => null, setItem: noop, removeItem: noop, key: () => null, length: 0 };
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, credentials: {} }, configurable: true, writable: true });
globalThis.EventSource = class { constructor() { this.addEventListener = noop; } close() { } };

const PUB = path.join(process.cwd(), 'public');
const M150 = '150.000.000.000';

async function investorStack() {
  const db = createMemDb();
  const S = createServices(db, {
    realToday: () => '2026-10-24',
    realNow: () => '2026-10-24T09:00:00.000Z',
    sha256: async (x) => crypto.createHash('sha256').update(x).digest('hex'),
    allowTimeTravel: true,
    allowSimulator: true,
  });
  await seedDemo(db, S);
  const investor = await db.one('users', { email: 'investor@kmh.coop' });
  const actor = { id: investor.id, name: investor.name, roles: investor.roles, email: investor.email, kyc_status: investor.kyc_status };
  return { db, S, investor, actor };
}

async function renderInvestor(S, actor) {
  const { VIEWS } = await import('../public/views.js');
  const me = await S.me(actor);
  const ctx = {
    api: {
      mode: 'server',
      call: async (name) => {
        if (name === 'me') return me;
        if (name === 'listMarketplace') return [];
        if (name === 'portfolio') return { rows: [], wallet: { available: 0, locked: 0, invested: 0, profit_total: 0, principal_returned: 0 } };
        if (name === 'getSettings') return { today: '2026-10-24', kmh_min_pct: 10, nisbah_investor: 70 };
        return [];
      },
    },
    me,
    settings: me,
    route: 'beranda',
    params: {},
    go: noop,
    refresh: async () => { },
    serverSim: true,
  };
  const out = {};
  for (const key of ['beranda', 'portofolio', 'dompet']) out[key] = await VIEWS[key].render(ctx);
  return out;
}

test('Paket pre-deploy: saldo Beranda, Portofolio, dan Dompet bernilai Rp0 sebelum biometrik dan Accept', async () => {
  const { S, actor } = await investorStack();
  const me = await S.me(actor);
  assert.equal(me.vault.accepted, false, 'status persetujuan harus belum aktif');
  assert.equal(me.vault.total, 0, 'total dana harus 0 sebelum persetujuan');
  const html = await renderInvestor(S, actor);
  for (const key of ['beranda', 'portofolio', 'dompet']) {
    assert.ok(!html[key].includes(M150), key + ' tidak boleh menampilkan Rp150.000.000.000 sebelum biometrik dan Accept');
  }
  assert.ok(html.beranda.includes('Rp0'), 'kotak saldo Beranda harus menampilkan Rp0');
  assert.ok(!html.beranda.includes('Total Dana Pendanaan'), 'banner 150 Miliar tidak boleh muncul sebelum persetujuan');
  assert.ok(!html.dompet.includes('Total Dana Pendanaan'), 'banner 150 Miliar tidak boleh muncul di Dompet sebelum persetujuan');
});

test('Paket pre-deploy: persetujuan ditolak bila biometrik belum terdaftar', async () => {
  const { S, actor } = await investorStack();
  await assert.rejects(() => S.acceptVaultAccess(actor), /Daftarkan Face Recognition|Sidik Jari/i);
  const me = await S.me(actor);
  assert.equal(me.vault.accepted, false);
  assert.equal(me.vault.total, 0);
});

test('Paket pre-deploy: setelah Face Recognition terdaftar dan Accept, saldo berubah menjadi Rp150.000.000.000', async () => {
  const { db, S, actor } = await investorStack();
  await db.insert('face_profiles', {
    user_id: actor.id,
    vector_front: '[]', vector_left: '[]', vector_right: '[]',
    mouth_baseline: 0, smile_baseline: 0, device_label: 'Perangkat Uji',
    enrolled_at: '2026-10-24T09:00:00.000Z', last_used_at: null, revoked_at: null,
  });
  const out = await S.acceptVaultAccess(actor);
  assert.equal(out.accepted, true);
  assert.equal(out.total, 150000000000);
  const me = await S.me(actor);
  assert.equal(me.vault.accepted, true);
  assert.equal(me.vault.total, 150000000000);
  const html = await renderInvestor(S, actor);
  for (const key of ['beranda', 'portofolio', 'dompet']) {
    assert.ok(html[key].includes(M150), key + ' harus menampilkan Rp150.000.000.000 setelah Accept');
  }
  assert.ok(html.beranda.includes('Total Dana Pendanaan'), 'banner 150 Miliar harus muncul setelah persetujuan');
  assert.ok(html.dompet.includes('Total Dana Pendanaan'), 'banner 150 Miliar harus muncul di Dompet setelah persetujuan');
});

test('Paket pre-deploy: pendaftaran Passkey juga membuka jalan persetujuan 150 Miliar', async () => {
  const { db, S, actor } = await investorStack();
  await db.insert('webauthn_credentials', {
    user_id: actor.id, kind: 'webauthn', credential_id: 'cred-uji-1', device_label: 'Passkey Uji',
    transports: 'internal', aaguid: '00000000-0000-0000-0000-000000000000',
    created_at: '2026-10-24T09:00:00.000Z', last_used_at: null, revoked_at: null,
  });
  const out = await S.acceptVaultAccess(actor);
  assert.equal(out.accepted, true);
  const me = await S.me(actor);
  assert.equal(me.vault.total, 150000000000);
});

test('Paket pre-deploy: redirect ke localhost hanya berlaku untuk host 127.0.0.1', () => {
  assert.equal(isLocalhostHost('127.0.0.1:3000'), true);
  assert.equal(isLocalhostHost('127.0.0.1'), true);
  assert.equal(isLocalhostHost('localhost:3000'), false);
  assert.equal(isLocalhostHost('pendanaan.domain.co.id'), false);
  assert.equal(isLocalhostHost('8.8.8.8:443'), false);
  assert.equal(isLocalhostHost(''), false);
  const src = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');
  assert.match(src, /isLocalhostHost\(host\)/);
  assert.match(src, /res\.redirect\(302, 'http:' \+ SLASH \+ SLASH \+ 'localhost:'/);
  assert.doesNotMatch(src, /res\.redirect\([^)]*req\.ip[^)]*\)/, 'redirect tidak boleh memakai alamat IP klien');
});

test('Paket pre-deploy: CORS memantulkan origin yang diizinkan dan tidak memantulkan asal-asalan', () => {
  const cfg = { allowedOrigins: 'https://pendanaan.domain.co.id', allowedHosts: 'localhost,127.0.0.1' };
  assert.equal(resolveCorsOrigin('https://pendanaan.domain.co.id', 'api.aws.com', cfg), 'https://pendanaan.domain.co.id');
  assert.equal(resolveCorsOrigin('https://evil.example', 'api.aws.com', cfg), '');
  assert.equal(resolveCorsOrigin('http://localhost:3000', 'localhost:3000', cfg), 'http://localhost:3000');
  assert.equal(resolveCorsOrigin('', 'api.aws.com', cfg), '');
  assert.match(CORS_ALLOWED_HEADERS, /Authorization/);
  assert.match(CORS_ALLOWED_HEADERS, /X-Vault-Token/);
  assert.match(CORS_ALLOWED_HEADERS, /X-Session-Token/);
  assert.match(CORS_ALLOWED_HEADERS, /Content-Type/);
  const src = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');
  assert.match(src, /Access-Control-Allow-Credentials', 'true'/);
  assert.match(src, /Access-Control-Allow-Origin/);
  assert.match(src, /res\.status\(204\)\.end\(\)/);
});

test('Paket pre-deploy: token sesi diterima lewat header Authorization, X-Session-Token, dan query SSE', () => {
  assert.equal(tokenFromHeaders({ authorization: 'Bearer abc.def' }), 'abc.def');
  assert.equal(tokenFromHeaders({ 'x-session-token': 'xyz' }), 'xyz');
  assert.equal(tokenFromHeaders({}, { token: 'sse-token' }, '/api/security/stream'), 'sse-token');
  assert.equal(tokenFromHeaders({}, { token: 'sse-token' }, '/api/rpc/me'), '');
  assert.equal(tokenFromHeaders({}), '');
});

test('Paket pre-deploy: rpID WebAuthn mengikuti hostname origin Biznet Gio dan kembali ke localhost di lokal', () => {
  const lokal = resolveRp({ origin: 'http://localhost:3000', host: 'localhost:3000' }, 'http');
  assert.equal(lokal.rpID, 'localhost');
  assert.equal(lokal.origin, 'http://localhost:3000');
  const produksi = resolveRp({ origin: 'https://pendanaan.domain.co.id', host: 'api.aws.com' }, 'https');
  assert.equal(produksi.rpID, 'pendanaan.domain.co.id');
  assert.equal(produksi.origin, 'https://pendanaan.domain.co.id');
  const tanpaOrigin = resolveRp({ host: 'api.domain.co.id' }, 'https');
  assert.equal(tanpaOrigin.rpID, 'api.domain.co.id');
  assert.equal(tanpaOrigin.origin, 'https://api.domain.co.id');
  const ip = resolveRp({ host: '203.0.113.10' }, 'https');
  assert.equal(ip.rpID, 'localhost', 'alamat IP tidak sah sebagai rpID WebAuthn');
});

test('Paket pre-deploy: frontend memakai meta kmh-api-base dan menyimpan token sesi di sessionStorage', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.match(html, /<meta name="kmh-api-base" content="">/);
  const apiSrc = fs.readFileSync(path.join(PUB, 'api.js'), 'utf8');
  assert.match(apiSrc, /meta\[name="kmh-api-base"\]/);
  assert.match(apiSrc, /sessionStorage\.setItem/);
  assert.match(apiSrc, /Authorization.*Bearer/);
  assert.match(apiSrc, /X-Session-Token/);
  assert.match(apiSrc, /clearStaleSession/);
  const secSrc = fs.readFileSync(path.join(PUB, 'security.js'), 'utf8');
  assert.match(secSrc, /API_BASE/);
  assert.match(secSrc, /security\/stream.*token=/);
  assert.match(secSrc, /authHeaders/);
});

test('Paket pre-deploy: tidak ada sesi localhost yang tertinggal di database dan skrip reset tersedia', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'scripts', 'reset-demo-investor.mjs'), 'utf8');
  for (const t of ['face_profiles', 'webauthn_credentials', 'vault_sessions', 'login_challenges', 'security_events', 'notifications', 'vault_accepted_at=null', 'vault_total=0', 'totp_enabled=0']) {
    assert.ok(src.includes(t), 'skrip reset harus menangani ' + t);
  }
  const serverSrc = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');
  assert.doesNotMatch(serverSrc, /vault_accepted_at:\s*new Date/, 'server tidak boleh mengisi flag persetujuan otomatis');
  const schemaSrc = fs.readFileSync(path.join(process.cwd(), 'server', 'schema.js'), 'utf8');
  assert.match(schemaSrc, /vault_accepted_at/);
  assert.match(schemaSrc, /vault_total/);
  const seedSrc = fs.readFileSync(path.join(process.cwd(), 'public', 'shared', 'seed.js'), 'utf8');
  assert.doesNotMatch(seedSrc, /vault_accepted_at:\s*new Date/, 'seed tidak boleh mengisi flag persetujuan');
  const servicesSrc = fs.readFileSync(path.join(process.cwd(), 'public', 'shared', 'services.js'), 'utf8');
  assert.match(servicesSrc, /Daftarkan Face Recognition atau Sidik Jari/);
});
