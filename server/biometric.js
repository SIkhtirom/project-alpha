import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

const nowIso = () => new Date().toISOString();
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

export const WEB_AUTHN_MAX_FAILURES = 3;

export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += Number(a[i] || 0) * Number(b[i] || 0);
    na += Number(a[i] || 0) ** 2;
    nb += Number(b[i] || 0) ** 2;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function createBiometric(options = {}) {
  const db = options.db;
  const alert = options.alert;
  const config = options.config || {};
  const logger = options.logger || console;
  const rpName = String(config.rpName || 'KMH P2P');
  const rpID = String(config.rpID || 'localhost');
  const origin = String(config.origin || ('http:' + String.fromCharCode(47, 47) + 'localhost:' + (config.port || 3000)));
  const stepUpSecret = String(config.stepUpSecret || config.jwtSecret || 'kmh-stepup-secret');
  const stepUpTtlMs = Number(config.stepUpTtlMs || 5 * 60e3);
  const vaultTtlMs = Number(config.vaultTtlMs || 5 * 60e3);
  const challengeTtlMs = Number(config.challengeTtlMs || 2 * 60e3);
  const failCounts = new Map();

  function userIdBytes(id) {
    return Buffer.from(String(id), 'utf8');
  }

  function resolveRp(opts) {
    const o = opts || {};
    return {
      rpID: String(o.rpID || rpID),
      origin: String(o.origin || origin),
    };
  }

  async function saveChallenge(userId, kind, challengeB64, meta = {}) {
    const row = await db.insert('webauthn_challenges', {
      user_id: userId,
      challenge: String(challengeB64 || ''),
      kind,
      expires_at: new Date(Date.now() + challengeTtlMs).toISOString(),
      consumed_at: null,
      meta: JSON.stringify(meta),
      created_at: nowIso(),
    });
    return { id: row.id, challenge: String(challengeB64 || ''), expires_at: row.expires_at };
  }

  async function takeChallenge(id, kind, userId) {
    const row = await db.get('webauthn_challenges', Number(id));
    if (!row) throw new Error('Challenge biometrik tidak ditemukan');
    if (row.consumed_at) throw new Error('Challenge biometrik sudah dipakai');
    if (Date.parse(row.expires_at) < Date.now()) throw new Error('Challenge biometrik kedaluwarsa');
    if (kind && row.kind !== kind) throw new Error('Jenis challenge tidak cocok');
    if (userId && Number(row.user_id) !== Number(userId)) throw new Error('Challenge bukan milik pengguna ini');
    await db.update('webauthn_challenges', row.id, { consumed_at: nowIso() });
    return row;
  }

  async function listCredentials(userId) {
    const rows = await db.find('webauthn_credentials', { user_id: userId }, { orderBy: ['id', 'asc'] });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      credential_id: r.credential_id,
      device_label: r.device_label,
      transports: r.transports ? String(r.transports).split(',').filter(Boolean) : [],
      aaguid: r.aaguid,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
      revoked_at: r.revoked_at,
      active: !r.revoked_at,
    }));
  }

  async function registerOptions(actor, opts) {
    const rp = resolveRp(opts);
    const existing = await listCredentials(actor.id);
    const options = await generateRegistrationOptions({
      rpName,
      rpID: rp.rpID,
      userName: actor.email || actor.name || String(actor.id),
      userDisplayName: actor.name || String(actor.id),
      userID: userIdBytes(actor.id),
      attestationType: 'none',
      excludeCredentials: existing.filter((c) => c.kind === 'webauthn').map((c) => ({ id: c.credential_id, transports: c.transports })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    const stored = await saveChallenge(actor.id, 'webauthn-register', options.challenge, { options: JSON.stringify(options) });
    return { options, challenge_id: stored.id };
  }

  async function registerVerify(actor, body, opts) {
    const rp = resolveRp(opts);
    const response = body?.response;
    if (!response) throw new Error('Respons registrasi WebAuthn tidak lengkap');
    const challengeId = Number(body?.challenge_id || 0);
    const row = await takeChallenge(challengeId, 'webauthn-register', actor.id);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: row.challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: false,
      });
    } catch (e) {
      await registerFailure(actor, 'webauthn', e.message);
      throw new Error('Verifikasi registrasi WebAuthn gagal: ' + e.message);
    }
    if (!verification.verified || !verification.registrationInfo) throw new Error('Registrasi WebAuthn tidak terverifikasi');
    const cred = verification.registrationInfo.credential;
    const info = verification.registrationInfo;
    const stored = await db.insert('webauthn_credentials', {
      user_id: actor.id,
      kind: 'webauthn',
      credential_id: cred.id,
      public_key: b64u(cred.publicKey),
      counter: Number(cred.counter || 0),
      transports: (cred.transports || []).join(','),
      aaguid: info.aaguid || '',
      device_label: String(body?.device_label || 'Perangkat WebAuthn'),
      eye_vector: null,
      eye_hash: null,
      created_at: nowIso(),
      last_used_at: null,
      revoked_at: null,
    });
    await db.tx((t) => t.insert('audit_logs', {
      actor_id: actor.id,
      actor_name: actor.name,
      action: 'webauthn_register',
      entity: 'webauthn_credential',
      entity_id: stored.id,
      detail: JSON.stringify({ credential_id: cred.id, aaguid: info.aaguid, device: stored.device_label }),
      created_at: nowIso(),
    }));
    failCounts.delete('bio:' + actor.id);
    await alert.emit({
      severity: 'low',
      rule_id: 'BIOMETRIC_ENROLLED',
      rule_name: 'Sidik Jari / Passkey berhasil didaftarkan',
      category: 'biometric_enrollment',
      action: 'log',
      method: 'POST',
      path: '/api/biometric/webauthn/register/verify',
      ip: actor.ip || '-',
      actor_id: actor.id ?? null,
      actor_name: actor.name || '',
      user_agent: actor.user_agent || '',
      evidence: { method: 'webauthn', aaguid: info.aaguid },
    });
    await db.insert('notifications', {
      user_id: actor.id,
      title: 'Biometrik Terdaftar: Sidik Jari / Passkey',
      body: 'Pendaftaran Sidik Jari / Passkey pada akun Anda telah berhasil diaktifkan. Anda kini dapat membuka Brankas Data Nominatif dengan sidik jari.',
      link: 'akun',
      read: 0,
      created_at: nowIso(),
    });
    return { credential_id: cred.id, id: stored.id, aaguid: info.aaguid, user_verified: info.userVerified };
  }

  async function authOptions(actor, opts) {
    const rp = resolveRp(opts);
    const creds = (await db.find('webauthn_credentials', { user_id: actor.id })).filter((c) => !c.revoked_at && c.kind === 'webauthn');
    if (!creds.length) throw new Error('Belum ada perangkat biometrik WebAuthn terdaftar');
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      userVerification: 'preferred',
      allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports ? String(c.transports).split(',').filter(Boolean) : undefined })),
    });
    const stored = await saveChallenge(actor.id, 'webauthn-auth', options.challenge, { options: JSON.stringify(options) });
    return { options, challenge_id: stored.id };
  }

  async function authVerify(actor, body, opts) {
    const rp = resolveRp(opts);
    const response = body?.response;
    if (!response) throw new Error('Respons autentikasi WebAuthn tidak lengkap');
    const row = await takeChallenge(Number(body?.challenge_id || 0), 'webauthn-auth', actor.id);
    const credRow = await db.one('webauthn_credentials', { user_id: actor.id, credential_id: response.id });
    if (!credRow) throw new Error('Kredensial tidak dikenal');
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: row.challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        requireUserVerification: false,
        credential: {
          id: credRow.credential_id,
          publicKey: fromB64u(credRow.public_key),
          counter: Number(credRow.counter || 0),
          transports: credRow.transports ? String(credRow.transports).split(',').filter(Boolean) : undefined,
        },
      });
    } catch (e) {
      await registerFailure(actor, 'webauthn', e.message);
      throw new Error('Verifikasi WebAuthn gagal: ' + e.message);
    }
    if (!verification.verified) throw new Error('Pernyataan WebAuthn tidak valid');
    await db.update('webauthn_credentials', credRow.id, { counter: Number(verification.authenticationInfo.newCounter || 0), last_used_at: nowIso() });
    failCounts.delete('bio:' + actor.id);
    return {
      method: 'webauthn',
      credential_id: credRow.credential_id,
      user_verified: verification.authenticationInfo.userVerified,
      counter: verification.authenticationInfo.newCounter,
    };
  }

  async function registerFailure(actor, method, reason) {
    const key = 'bio:' + actor.id;
    const n = (failCounts.get(key) || 0) + 1;
    failCounts.set(key, n);
    await alert.emit({
      severity: n >= WEB_AUTHN_MAX_FAILURES ? 'critical' : 'medium',
      rule_id: n >= WEB_AUTHN_MAX_FAILURES ? 'BIO_LOCKOUT' : 'BIO_FAIL',
      rule_name: n >= WEB_AUTHN_MAX_FAILURES ? 'Biometrik gagal 3x berturut-turut' : 'Percobaan biometrik gagal',
      category: 'biometric_failure',
      action: 'alert',
      method: 'POST',
      path: '/api/biometric/verify',
      ip: actor.ip || '-',
      actor_id: actor.id ?? null,
      actor_name: actor.name || '',
      user_agent: actor.user_agent || '',
      evidence: { method, attempts: n, reason: String(reason).slice(0, 200) },
    });
    if (n >= WEB_AUTHN_MAX_FAILURES) {
      failCounts.delete(key);
    }
    return n;
  }

  async function issueStepUp(actor, method, scope = 'critical-op', ttlMs = stepUpTtlMs) {
    const jti = crypto.randomUUID();
    const token = jwt.sign({ uid: actor.id, jti, method, scope, name: actor.name }, stepUpSecret, { expiresIn: Math.floor(ttlMs / 1000) });
    await db.insert('vault_sessions', {
      user_id: actor.id,
      token_id: jti,
      method,
      scope,
      unlocked_at: nowIso(),
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
      revoked_at: null,
      ip: actor.ip || '',
      created_at: nowIso(),
    });
    await db.tx((t) => t.insert('audit_logs', {
      actor_id: actor.id,
      actor_name: actor.name,
      action: 'stepup_granted',
      entity: 'vault_session',
      entity_id: null,
      detail: JSON.stringify({ method, scope, jti }),
      created_at: nowIso(),
    }));
    return { token, expires_in: Math.floor(ttlMs / 1000), expires_at: new Date(Date.now() + ttlMs).toISOString(), method, scope };
  }

  async function verifyStepUp(token, scope) {
    if (!token) return { valid: false, reason: 'token tidak ada' };
    let payload;
    try {
      payload = jwt.verify(token, stepUpSecret);
    } catch (e) {
      return { valid: false, reason: 'token tidak valid atau kedaluwarsa' };
    }
    if (scope && payload.scope !== scope) return { valid: false, reason: 'cakupan token tidak sesuai' };
    const sess = await db.one('vault_sessions', { token_id: payload.jti });
    if (!sess) return { valid: false, reason: 'sesi biometrik tidak ditemukan' };
    if (sess.revoked_at) return { valid: false, reason: 'sesi biometrik sudah dikunci' };
    if (Date.parse(sess.expires_at) < Date.now()) return { valid: false, reason: 'sesi biometrik kedaluwarsa' };
    return { valid: true, uid: payload.uid, method: payload.method, scope: payload.scope, expires_at: sess.expires_at, token_id: payload.jti };
  }

  async function revokeSession(tokenId, actor) {
    const sess = await db.get('vault_sessions', Number(tokenId));
    if (!sess) return false;
    await db.update('vault_sessions', sess.id, { revoked_at: nowIso() });
    await db.tx((t) => t.insert('audit_logs', {
      actor_id: actor?.id ?? null,
      actor_name: actor?.name || 'Sistem',
      action: 'vault_lock',
      entity: 'vault_session',
      entity_id: sess.id,
      detail: JSON.stringify({ method: sess.method, scope: sess.scope }),
      created_at: nowIso(),
    }));
    return true;
  }

  async function listSessions(userId) {
    const rows = await db.find('vault_sessions', { user_id: userId }, { orderBy: ['id', 'desc'], limit: 20 });
    return rows.map((r) => ({
      id: r.id,
      method: r.method,
      scope: r.scope,
      unlocked_at: r.unlocked_at,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
      active: !r.revoked_at && Date.parse(r.expires_at) > Date.now(),
    }));
  }

  async function revokeCredential(actor, id) {
    const row = await db.get('webauthn_credentials', Number(id));
    if (!row || Number(row.user_id) !== Number(actor.id)) throw new Error('Kredensial tidak ditemukan');
    await db.update('webauthn_credentials', row.id, { revoked_at: nowIso() });
    return true;
  }

  function publicInfo() {
    return {
      rp_name: rpName,
      rp_id: rpID,
      origin,
      step_up_ttl_seconds: Math.floor(stepUpTtlMs / 1000),
      vault_ttl_seconds: Math.floor(vaultTtlMs / 1000),
      max_failures: WEB_AUTHN_MAX_FAILURES,
      webauthn_supported: true,
    };
  }

  return {
    registerOptions,
    registerVerify,
    authOptions,
    authVerify,
    listCredentials,
    revokeCredential,
    issueStepUp,
    verifyStepUp,
    revokeSession,
    listSessions,
    publicInfo,
  };
}
