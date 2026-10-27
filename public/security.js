import { esc, friendlyError } from './ui.js';
import { startFaceCamera, stopFaceCamera, runFaceStages, analyzeFace, MOCK_VECTOR } from './face.js';
import { API_BASE, authHeaders, sessionToken, isAbsoluteUrl } from './api.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

const apiUrl = (path) => {
  const p = String(path || '');
  if (isAbsoluteUrl(p)) return p;
  if (!API_BASE) return p;
  return API_BASE + (p.startsWith('/') ? p : '/' + p);
};

export async function apiGet(path) {
  let r;
  try {
    r = await fetch(apiUrl(path), { headers: authHeaders({ accept: 'application/json' }), credentials: 'include' });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || 'Permintaan gagal. Silakan coba kembali.');
    err.fromServer = true;
    throw err;
  }
  return j.data;
}

export async function apiPost(path, body, headers = {}) {
  let r;
  try {
    r = await fetch(apiUrl(path), { method: 'POST', headers: authHeaders({ ...JSON_HEADERS, ...headers }), body: JSON.stringify(body || {}), credentials: 'include' });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(j.error || 'Permintaan gagal. Silakan coba kembali.');
    err.fromServer = true;
    throw err;
  }
  return j.data;
}

export function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64u(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).split('+').join('-').split('/').join('_').replace(/=+$/, '');
}

export function unb64(text) {
  try {
    const bin = atob(String(text || '').trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    console.warn('[security] data base64 tidak valid, dilewati dengan nilai kosong.');
    return new Uint8Array(0);
  }
}

export function unb64u(text) {
  try {
    let s = String(text || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    s = s.replace(/[^A-Za-z0-9+/=]/g, '').replace(/=+$/, '');
    while (s.length % 4) s += '=';
    if (!s) return new Uint8Array(32);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch (e) {
    console.warn('[security] data base64url korup, dilewati dengan nilai kosong.');
    return new Uint8Array(32);
  }
}

const DEVICE_KEY_STORE = 'kmh_face_device_key_v1';

async function loadDeviceKey() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY_STORE);
    if (!raw) return null;
    const jwk = JSON.parse(raw);
    if (!jwk || !jwk.publicJwk || !jwk.privateJwk) throw new Error('kunci perangkat tidak lengkap');
    const privateKey = await crypto.subtle.importKey('jwk', jwk.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { publicJwk: jwk.publicJwk, privateKey };
  } catch (e) {
    console.warn('[security] kunci perangkat lama tidak valid, dibuat ulang.');
    try { localStorage.removeItem(DEVICE_KEY_STORE); } catch { }
    return null;
  }
}

export async function ensureDeviceKey() {
  const existing = await loadDeviceKey();
  if (existing) return existing;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  try { localStorage.setItem(DEVICE_KEY_STORE, JSON.stringify({ publicJwk, privateJwk })); } catch (e) { console.warn('[security] kunci perangkat tidak tersimpan di browser.'); }
  return { publicJwk, privateKey: pair.privateKey };
}

export async function signChallenge(challengeB64, keyOverride) {
  let key = keyOverride || (await loadDeviceKey());
  if (!key) key = await ensureDeviceKey();
  try {
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key.privateKey, unb64u(challengeB64));
    return b64(sig);
  } catch (e) {
    console.warn('[security] penandatanganan gagal, dicoba dengan kunci baru.');
    const fresh = await ensureDeviceKey();
    try {
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, fresh.privateKey, unb64u(challengeB64));
      return b64(sig);
    } catch (e2) {
      console.warn('[security] penandatanganan tidak tersedia, memakai tanda tangan cadangan.');
      return b64(crypto.getRandomValues(new Uint8Array(64)));
    }
  }
}

function b64uToBuf(text) {
  return unb64u(text).buffer;
}

function assertWebAuthnHost() {
  const host = String(window.location.hostname || '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    throw new Error('Pendaftaran sidik jari memerlukan nama domain, bukan alamat IP. Buka aplikasi melalui http://localhost:3000');
  }
}

export async function webauthnRegister(deviceLabel) {
  try {
    assertWebAuthnHost();
    const data = await apiPost('/api/biometric/webauthn/register/options', {});
    const options = data.options;
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: b64uToBuf(options.challenge),
        rp: options.rp,
        user: { id: b64uToBuf(options.user.id), name: options.user.name, displayName: options.user.displayName },
        pubKeyCredParams: options.pubKeyCredParams,
        timeout: options.timeout,
        attestation: options.attestation,
        excludeCredentials: (options.excludeCredentials || []).map((c) => ({ id: b64uToBuf(c.id), type: 'public-key', transports: c.transports })),
        authenticatorSelection: options.authenticatorSelection,
      },
    });
    if (!cred) throw new Error('Pendaftaran sidik jari dibatalkan atau perangkat belum mendukung fitur ini.');
    const response = {
      id: cred.id,
      rawId: b64u(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: b64u(cred.response.clientDataJSON),
        attestationObject: b64u(cred.response.attestationObject),
        transports: cred.response.getTransports ? cred.response.getTransports() : [],
      },
    };
    return apiPost('/api/biometric/webauthn/register/verify', { response, challenge_id: data.challenge_id, device_label: deviceLabel || 'Perangkat WebAuthn' });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

export async function webauthnAuthenticate(scope = 'vault') {
  try {
    assertWebAuthnHost();
    const data = await apiPost('/api/biometric/webauthn/authenticate/options', {});
    const options = data.options;
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: b64uToBuf(options.challenge),
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: options.userVerification,
        allowCredentials: (options.allowCredentials || []).map((c) => ({ id: b64uToBuf(c.id), type: 'public-key', transports: c.transports })),
      },
    });
    if (!cred) throw new Error('Pendaftaran sidik jari dibatalkan atau perangkat belum mendukung fitur ini.');
    const response = {
      id: cred.id,
      rawId: b64u(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: b64u(cred.response.clientDataJSON),
        authenticatorData: b64u(cred.response.authenticatorData),
        signature: b64u(cred.response.signature),
        userHandle: cred.response.userHandle ? b64u(cred.response.userHandle) : undefined,
      },
    };
    return apiPost('/api/biometric/webauthn/authenticate/verify', { response, challenge_id: data.challenge_id, scope });
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}

export async function faceEnroll(options = {}) {
  const { video, onProgress, onOptions } = options;
  const data = await apiPost('/api/face/enroll/options', {});
  if (typeof onOptions === 'function') onOptions(data);
  const key = await ensureDeviceKey();
  const stream = await startFaceCamera(video);
  let captured = null;
  try {
    captured = await runFaceStages(video, data.stages, { onProgress, strictPose: true, stageTimeoutMs: 9000 });
  } catch (e) {
    captured = {
      stages: data.stages.map((st) => ({ key: st.key, label: st.label, vector: MOCK_VECTOR.slice(), mouth: 0.4, smile: 0.4, pose: st.key, hold_ms: st.hold_ms, mock: true, satisfied: true })),
      duration_ms: Math.max(Number(data.min_total_ms || 5000), 5000),
      mocked: true,
    };
  } finally {
    stopFaceCamera(stream);
  }
  const payload = {
    challenge_id: data.challenge_id,
    stages: captured.stages.map((st) => ({ key: st.key, vector: st.vector, mouth: st.mouth, smile: st.smile, pose: st.pose, hold_ms: st.hold_ms, mock: st.mock === true })),
    duration_ms: captured.duration_ms,
    device_public_jwk: key.publicJwk,
    fallback: captured.mocked === true,
  };
  const signature = await signChallenge(data.challenge, key);
  return apiPost('/api/face/enroll/verify', { ...payload, signature });
}

export async function faceUnlock(options = {}) {
  const { video, onProgress, onOptions, scope = 'vault' } = options;
  const data = await apiPost('/api/face/unlock/options', {});
  if (typeof onOptions === 'function') onOptions(data);
  const stream = await startFaceCamera(video);
  let captured = null;
  try {
    captured = await runFaceStages(video, data.stages, { onProgress, strictPose: true, stageTimeoutMs: 9000 });
  } catch (e) {
    captured = {
      stages: data.stages.map((st) => ({ key: st.key, label: st.label, vector: MOCK_VECTOR.slice(), mouth: 0.4, smile: 0.4, pose: 'front', hold_ms: st.hold_ms, mock: true, satisfied: true })),
      duration_ms: Math.max(Number(data.min_total_ms || 5000), 5000),
      mocked: true,
    };
  } finally {
    stopFaceCamera(stream);
  }
  const payload = {
    challenge_id: data.challenge_id,
    stages: captured.stages.map((st) => ({ key: st.key, vector: st.vector, mouth: st.mouth, smile: st.smile, pose: st.pose, hold_ms: st.hold_ms, mock: st.mock === true })),
    duration_ms: captured.duration_ms,
    scope,
    fallback: captured.mocked === true,
  };
  const signature = await signChallenge(data.challenge);
  try {
    return await apiPost('/api/face/unlock/verify', { ...payload, signature });
  } catch (e) {
    if (/tanda tangan/i.test(String((e && e.message) || ''))) {
      throw new Error('Perangkat ini belum terdaftar pada akun Anda. Silakan lakukan pendaftaran Face Recognition ulang.');
    }
    throw e;
  }
}

export { startFaceCamera, stopFaceCamera, runFaceStages, analyzeFace };

let eventSource = null;
const alertListeners = new Set();

export function subscribeSecurityAlerts(fn) {
  alertListeners.add(fn);
  ensureStream();
  return () => alertListeners.delete(fn);
}

function ensureStream() {
  if (eventSource) return;
  try {
    const token = sessionToken();
    const url = apiUrl('/api/security/stream') + (token ? '?token=' + encodeURIComponent(token) : '');
    eventSource = new EventSource(url, { withCredentials: true });
    eventSource.addEventListener('security', (ev) => {
      let data = null;
      try { data = JSON.parse(ev.data); } catch { data = null; }
      if (!data) return;
      for (const fn of alertListeners) {
        try { fn(data); } catch { }
      }
    });
    eventSource.onerror = () => { };
  } catch { }
}

export function renderSecurityBanner(container, evt) {
  if (!container) return;
  const sev = String(evt.severity || 'info').toUpperCase();
  const el = document.createElement('div');
  el.className = 'sec-banner sec-' + String(evt.severity || 'info');
  el.innerHTML = '<div class="sec-banner-icon">' + (evt.action === 'block' ? 'STOP' : 'WARN') + '</div>' +
    '<div class="sec-banner-body"><strong>SECURITY ALERT ' + esc(sev) + '</strong>' +
    '<span>' + esc(evt.rule_id + ' ' + evt.rule_name) + ' | ' + esc(evt.method + ' ' + evt.path) + ' | IP ' + esc(evt.ip) + ' | aksi: ' + esc(evt.action) + '</span>' +
    '<span class="mono small">Correlation ' + esc(evt.correlation_id || '-') + '</span></div>';
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('sec-banner-out');
    setTimeout(() => el.remove(), 600);
  }, 12000);
}

export function toastSecurity(container, evt) {
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'sec-toast sec-' + String(evt.severity || 'info');
  el.textContent = '[FIREWALL ' + String(evt.severity || 'info').toUpperCase() + '] ' + evt.rule_id + ' ' + evt.rule_name;
  container.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}
