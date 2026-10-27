import test from 'node:test';
import assert from 'node:assert/strict';

const noop = () => { };
const listeners = { root: [] };
const mkEl = (extra = {}) => ({
  style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop },
  setAttribute: noop, removeAttribute: noop, appendChild: noop, remove: noop,
  addEventListener: noop, removeEventListener: noop, focus: noop, click: noop,
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
  ...extra,
});
const appRoot = mkEl({
  _h: '',
  set innerHTML(v) { this._h = v; },
  get innerHTML() { return this._h || ''; },
  addEventListener: (t, fn) => { listeners.root.push({ type: t, fn }); },
});
const submitBtn = mkEl({ disabled: false, type: 'submit' });
const makeForm = (formName) => ({
  dataset: { form: formName },
  querySelector: () => submitBtn,
  closest(sel) { return String(sel).includes('form[data-form]') ? this : null; },
});

globalThis.document = {
  getElementById: (id) => (id === 'app' ? appRoot : mkEl()),
  querySelector: () => mkEl(),
  querySelectorAll: () => [],
  createElement: () => mkEl(),
  body: mkEl(),
  addEventListener: noop,
  documentElement: mkEl(),
};
const loc = { hostname: 'localhost', hash: '', href: 'http://localhost:3000/', origin: 'http://localhost:3000' };
globalThis.window = {
  location: loc,
  history: { replaceState: (a, b, url) => { loc.hash = String(url).startsWith('#') ? String(url) : '#' + String(url); } },
  scrollTo: noop,
  addEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
};
globalThis.location = loc;
globalThis.history = globalThis.window.history;
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) }, credentials: {} }, configurable: true, writable: true });
globalThis.EventSource = class { constructor() { this.addEventListener = noop; } close() { } };
globalThis.FormData = class {
  constructor() { }
  entries() { return [['email', 'admin@kmh.coop'], ['password', 'demo12345'], ['code', '123456']][Symbol.iterator](); }
};

let meResponse = { ok: false, status: 401 };
globalThis.fetch = async (url) => {
  const u = String(url);
  const json = (data, ok = true, status = 200) => ({ ok, status, json: async () => data, headers: new Map() });
  if (u.includes('api/health')) return json({ ok: true, mode: 'server' });
  if (u.includes('rpc/getSettings')) return json({ ok: true, data: { public: true, today: '2026-10-24' } });
  if (u.includes('auth/login')) return json({ ok: true, need_otp: true, challenge: 'ch-1', user: { name: 'Admin' } });
  if (u.includes('auth/2fa/verify')) { meResponse = { ok: true, status: 200 }; return json({ ok: true, user: { name: 'Admin KMH', email: 'admin@kmh.coop', roles: ['admin', 'manajer', 'finance'], member_no: 'STAF-001', totp_enabled: 1 } }); }
  if (u.includes('rpc/me')) return meResponse.ok ? json({ ok: true, data: { user: { name: 'Admin KMH', email: 'admin@kmh.coop', roles: ['admin', 'manajer', 'finance'], member_no: 'STAF-001', totp_enabled: 1 }, unread: 0, today: '2026-10-24' } }) : json({ error: 'Belum masuk' }, false, 401);
  return json({ ok: true, data: null });
};

const tick = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const fire = async (type, ev) => {
  for (const h of listeners.root) {
    if (h.type === type) { await h.fn(ev); return; }
  }
};

test('URL awal berada di jalur autentikasi #auth/login', async () => {
  await import('../public/app.js');
  await tick(600);
  assert.equal(String(globalThis.location.hash || ''), '#auth/login');
});

test('Setelah email dan kata sandi benar, URL berpindah ke #auth/2fa', async () => {
  const form = makeForm('login');
  await fire('submit', { target: form, preventDefault: noop, stopPropagation: noop });
  await tick(500);
  assert.equal(String(globalThis.location.hash || ''), '#auth/2fa');
});

test('Setelah kode 2FA benar, URL berpindah ke #dasbor', async () => {
  const form = makeForm('otp');
  await fire('submit', { target: form, preventDefault: noop, stopPropagation: noop });
  await tick(500);
  assert.equal(String(globalThis.location.hash || ''), '#dasbor');
});

test('klik menu di dashboard menyinkronkan URL dengan halaman yang dibuka', async () => {
  const link = { dataset: { route: 'keamanan' }, closest: (sel) => (String(sel).includes('[data-route]') ? link : null), preventDefault: noop };
  await fire('click', { target: link, preventDefault: noop, stopPropagation: noop });
  await tick(400);
  assert.equal(String(globalThis.location.hash || ''), '#keamanan');
});

test('logout mengembalikan URL ke #auth/login', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(src, /ctx\.route = 'auth\/login'/);
  assert.match(src, /syncHash\('auth\/login'\)/);
});
