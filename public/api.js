


import { createServices } from './shared/services.js';
import { createMemDb } from './shared/memdb.js';
import { seedDemo } from './shared/seed.js';
import { friendlyError } from './ui.js';

const DEMO_KEY = 'kmh-p2p-demo-v1';
const PERSONA_KEY = 'kmh-p2p-demo-persona';
const SESSION_PREFIX = 'kmh_session_token_v1:';
const SLASH_CODE = String.fromCharCode(47);

export const isAbsoluteUrl = (path) => {
  const p = String(path || '');
  if (!/^https?:/i.test(p)) return false;
  const colon = p.indexOf(':');
  return colon > 0 && p.charCodeAt(colon + 1) === SLASH_CODE.charCodeAt(0);
};

function readApiBase() {
  let raw = '';
  try {
    const meta = document.querySelector('meta[name="kmh-api-base"]');
    raw = String(meta?.getAttribute('content') || '').trim();
  } catch { raw = ''; }
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

export const API_BASE = readApiBase();

const apiUrl = (path) => {
  const p = String(path || '');
  if (isAbsoluteUrl(p)) return p;
  if (!API_BASE) return p;
  return API_BASE + (p.startsWith('/') ? p : '/' + p);
};

export const apiBaseUrl = apiUrl;

const sessionStore = {
  key() { return SESSION_PREFIX + (API_BASE || 'same-origin'); },
  get() { try { return sessionStorage.getItem(this.key()) || ''; } catch { return ''; } },
  set(v) { try { sessionStorage.setItem(this.key(), String(v || '')); } catch { } },
  del() { try { sessionStorage.removeItem(this.key()); } catch { } },
};

export function clearStaleSession() {
  try {
    const keep = sessionStore.key();
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i) || '';
      if (k.startsWith(SESSION_PREFIX) && k !== keep) sessionStorage.removeItem(k);
    }
  } catch { }
  try {
    const stamp = 'kmh_api_origin_v1';
    const now = API_BASE || (globalThis.location ? globalThis.location.origin : '');
    const prev = localStorage.getItem(stamp);
    if (prev && prev !== now) {
      localStorage.removeItem(DEMO_KEY);
      localStorage.removeItem(PERSONA_KEY);
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith(SESSION_PREFIX) || k === 'kmh_face_device_key_v1') localStorage.removeItem(k);
      }
    }
    localStorage.setItem(stamp, now);
  } catch { }
}

export function sessionToken() {
  return sessionStore.get();
}

export function setSessionToken(token) {
  const t = String(token || '').trim();
  if (!t) { sessionStore.del(); return; }
  sessionStore.set(t);
}

export function authHeaders(extra) {
  const h = { ...(extra || {}) };
  const token = sessionStore.get();
  if (token) {
    h.Authorization = 'Bearer ' + token;
    h['X-Session-Token'] = token;
  }
  return h;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const wib = () => new Date(Date.now() + 7 * 3600e3);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {  } },
  del(k) { try { localStorage.removeItem(k); } catch {  } },
};

export async function detectMode() {
  try {
    const r = await fetch(apiUrl('api/health'), { headers: { accept: 'application/json' } });
    if (!r.ok) return 'demo';
    const j = await r.json();
    return j && j.mode === 'server' ? 'server' : 'demo';
  } catch { return 'demo'; }
}

export function serverApi() {
  async function post(url, body) {
    let r;
    try {
      r = await fetch(apiUrl(url), { method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body: JSON.stringify(body || {}), credentials: 'include' });
    } catch (e) {
      throw new Error(friendlyError(e));
    }
    let j = {};
    try { j = await r.json(); } catch { }
    if (!r.ok) { const e = new Error(j.error || 'Permintaan gagal. Silakan coba kembali.'); e.status = r.status; e.need_otp = j.need_otp; e.fromServer = true; throw e; }
    return j;
  }
  return {
    mode: 'server',
    async call(name, args) { return (await post(`api/rpc/${name}`, args)).data; },
    async login(email, password) {
      const out = await post('api/auth/login', { email, password });
      return out;
    },
    async verifyOtp(challenge, code) {
      const out = await post('api/auth/2fa/verify', { challenge, code });
      if (out && out.token) setSessionToken(out.token);
      return out;
    },
    async logout() {
      try { sessionStore.del(); } catch { }
      return post('api/auth/logout');
    },
    register: (a) => post('api/auth/register', a),
    async changePassword(current, next) {
      const out = await post('api/auth/password', { current, next });
      if (out && out.token) setSessionToken(out.token);
      return out;
    },
    setup2fa: () => post('api/auth/2fa/setup'),
    enable2fa: (otp) => post('api/auth/2fa/enable', { otp }),
    async uploadKyc(kind, file) {
      const fd = new FormData(); fd.append('kind', kind); fd.append('file', file);
      const r = await fetch(apiUrl('api/upload/kyc'), { method: 'POST', headers: authHeaders(), body: fd, credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Unggah gagal');
      return j.data;
    },
    kycUrl: (id) => apiUrl(`api/kyc/${id}`),
  };
}

export async function demoApi() {
  let saved = null;
  try { saved = JSON.parse(store.get(DEMO_KEY) || 'null'); } catch { saved = null; }
  const db = createMemDb(saved || undefined);
  const env = { realToday: () => wib().toISOString().slice(0, 10), realNow: () => wib().toISOString(), sha256, allowTimeTravel: true, allowSimulator: true };
  const S = createServices(db, env);
  if (!saved) {
    await seedDemo(db, S);
    store.set(DEMO_KEY, JSON.stringify(db.dump()));
  }
  db.onCommit((state) => store.set(DEMO_KEY, JSON.stringify(state)));
  let personaId = Number(store.get(PERSONA_KEY)) || null;
  const actor = async () => {
    if (!personaId) return null;
    const u = await db.get('users', personaId);
    return u ? { id: u.id, name: u.name, roles: u.roles, kyc_status: u.kyc_status } : null;
  };
  return {
    mode: 'demo',
    async call(name, args) {
      if (!S.__public.includes(name)) throw new Error('Layanan tidak dikenal');
      const a = await actor();
      const out = await S[name](a, args || {});
      return out === undefined ? null : JSON.parse(JSON.stringify(out));
    },
    async login() { return { ok: true, demo: true }; },
    async verifyOtp() { return { ok: true, demo: true }; },
    async personas() {
      const us = await db.find('users', { active: 1 });
      return us.map((u) => ({ id: u.id, name: u.name, roles: String(u.roles).split(','), kyc: u.kyc_status }));
    },
    setPersona(id) { personaId = Number(id); store.set(PERSONA_KEY, String(id)); },
    getPersona() { return personaId; },
    reset() { store.del(DEMO_KEY); store.del(PERSONA_KEY); },
    async uploadKyc(kind, file) { return S.addKycDoc(await actor(), { kind, filename: file.name, stored_path: '' }); },
    kycUrl: () => null,
  };
}
