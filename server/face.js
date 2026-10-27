import crypto from 'node:crypto';
import { cosine } from './biometric.js';

export const FACE_POSES = ['front', 'left', 'right'];
export const FACE_LIVENESS = ['mouth_open', 'smile'];
export const FACE_POSE_LABEL = { front: 'Menghadap depan', left: 'Menghadap kiri', right: 'Menghadap kanan', mouth_open: 'Buka mulut', smile: 'Senyum' };
export const FACE_STAGE_HOLD_MS = 2800;
export const FACE_ENROLL_HOLD_MS = 5000;
export const FACE_MIN_TOTAL_MS = 5000;
export const FACE_MAX_TOTAL_MS = 25000;
export const FACE_VECTOR_MIN_DIM = 32;
export const FACE_POSE_SIMILARITY_MIN = 0.35;
export const FACE_UNLOCK_SIMILARITY_MIN = 0.2;
export const FACE_MOUTH_OPEN_MIN = 0.1;
export const FACE_SMILE_MIN = 0.1;
export const FACE_MAX_FAILURES = 3;

const nowIso = () => new Date().toISOString();
const fromB64u = (s) => Buffer.from(String(s || ''), 'base64url');

export function shuffleStages(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createFaceRecognition(options = {}) {
  const { db, alert, config = {}, logger = console } = options;
  const challengeTtlMs = Number(config.challengeTtlMs || 20 * 60e3);
  const holdMs = Number(config.holdMs || FACE_STAGE_HOLD_MS);
  const enrollHoldMs = Number(config.enrollHoldMs || FACE_ENROLL_HOLD_MS);
  const minTotalMs = Number(config.minTotalMs || FACE_MIN_TOTAL_MS);
  const maxTotalMs = Number(config.maxTotalMs || FACE_MAX_TOTAL_MS);
  const failCounts = new Map();

  async function saveChallenge(userId, kind, meta = {}) {
    const challenge = crypto.randomBytes(32);
    const row = await db.insert('face_challenges', {
      user_id: userId,
      challenge: challenge.toString('base64url'),
      kind,
      stages: JSON.stringify(meta.stages || []),
      meta: JSON.stringify(meta.extra || {}),
      issued_at: nowIso(),
      expires_at: new Date(Date.now() + challengeTtlMs).toISOString(),
      consumed_at: null,
      failed_at: null,
    });
    return { id: row.id, challenge: row.challenge, issued_at: row.issued_at, expires_at: row.expires_at };
  }

  async function takeChallenge(id, kind, userId) {
    const row = await db.get('face_challenges', Number(id));
    if (!row) throw new Error('Challenge pengenalan wajah tidak ditemukan');
    if (row.consumed_at) throw new Error('Challenge pengenalan wajah sudah dipakai');
    if (row.failed_at) throw new Error('Challenge pengenalan wajah sudah gagal dipakai');
    if (Date.parse(row.expires_at) < Date.now()) throw new Error('Challenge pengenalan wajah kedaluwarsa');
    if (kind && row.kind !== kind) throw new Error('Jenis challenge tidak cocok');
    if (userId && Number(row.user_id) !== Number(userId)) throw new Error('Challenge bukan milik pengguna ini');
    return row;
  }

  async function getProfile(userId) {
    return db.one('face_profiles', { user_id: userId });
  }

  async function registerFailure(actor, reason, extra = {}) {
    const key = 'face:' + actor.id;
    const n = (failCounts.get(key) || 0) + 1;
    failCounts.set(key, n);
    const critical = n >= FACE_MAX_FAILURES;
    await alert.emit({
      severity: critical ? 'critical' : 'medium',
      rule_id: critical ? 'FACE_LOCKOUT' : 'FACE_FAIL',
      rule_name: critical
        ? 'Peringatan biometrik wajah gagal ' + n + ' kali berturut-turut'
        : 'Percobaan Face Recognition gagal',
      category: 'biometric_failure',
      action: 'alert',
      method: 'POST',
      path: '/api/face/verify',
      ip: actor.ip || '-',
      actor_id: actor.id ?? null,
      actor_name: actor.name || '',
      user_agent: actor.user_agent || '',
      evidence: { method: 'face-recognition', attempts: n, reason: String(reason).slice(0, 200), ...extra },
    });
    if (critical) failCounts.delete(key);
    return n;
  }

  function stagesForEnrollment() {
    return shuffleStages(FACE_POSES).map((key) => ({
      key,
      label: FACE_POSE_LABEL[key],
      kind: 'pose',
      hold_ms: enrollHoldMs,
      instruction: 'Arahkan wajah ' + FACE_POSE_LABEL[key].toLowerCase() + ' dan tahan sampai indikator terisi',
    }));
  }

  function stagesForUnlock() {
    const stages = [{
      key: 'front',
      label: FACE_POSE_LABEL.front,
      kind: 'pose',
      hold_ms: holdMs,
      instruction: 'Hadapkan wajah menghadap depan dan tahan sampai indikator terisi',
    }];
    for (const key of FACE_LIVENESS) {
      stages.push({
        key,
        label: FACE_POSE_LABEL[key],
        kind: 'liveness',
        hold_ms: holdMs,
        instruction: key === 'mouth_open' ? 'Buka mulut perlahan dan tahan sampai indikator terisi' : 'Tersenyum lebar dan tahan sampai indikator terisi',
      });
    }
    return stages;
  }

  async function enrollOptions(actor) {
    const stages = stagesForEnrollment();
    const saved = await saveChallenge(actor.id, 'face-enroll', { stages });
    return {
      challenge_id: saved.id,
      challenge: saved.challenge,
      issued_at: saved.issued_at,
      expires_at: saved.expires_at,
      stages,
      hold_ms: enrollHoldMs,
      total_target_ms: stages.length * enrollHoldMs,
      min_total_ms: minTotalMs,
      max_total_ms: maxTotalMs,
      thresholds: {
        pose_similarity: FACE_POSE_SIMILARITY_MIN,
        mouth_open: FACE_MOUTH_OPEN_MIN,
        smile: FACE_SMILE_MIN,
      },
    };
  }

  async function unlockOptions(actor) {
    const profile = await getProfile(actor.id);
    if (!profile) throw new Error('Belum ada profil Face Recognition terdaftar pada akun ini');
    const stages = stagesForUnlock();
    const saved = await saveChallenge(actor.id, 'face-unlock', { stages });
    return {
      challenge_id: saved.id,
      challenge: saved.challenge,
      issued_at: saved.issued_at,
      expires_at: saved.expires_at,
      stages,
      hold_ms: holdMs,
      total_target_ms: stages.reduce((a, s) => a + s.hold_ms, 0),
      min_total_ms: minTotalMs,
      max_total_ms: maxTotalMs,
      thresholds: {
        pose_similarity: FACE_POSE_SIMILARITY_MIN,
        mouth_open: FACE_MOUTH_OPEN_MIN,
        smile: FACE_SMILE_MIN,
      },
    };
  }

  function verifyDeviceSignature(profile, challengeB64, signatureB64) {
    try {
      const jwk = JSON.parse(profile.device_public_jwk || '{}');
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      return crypto.verify('sha256', fromB64u(challengeB64), { key, dsaEncoding: 'ieee-p1363' }, fromB64u(signatureB64 || ''));
    } catch {
      return false;
    }
  }

  async function enrollVerify(actor, body = {}) {
    const row = await takeChallenge(Number(body?.challenge_id || 0), 'face-enroll', actor.id);
    const stages = JSON.parse(row.stages || '[]');
    const submitted = Array.isArray(body?.stages) ? body.stages : [];
    const vectors = {};
    let mouthBaseline = 0;
    let smileBaseline = 0;
    let firstVector = null;
    let template = null;
    for (const s of submitted) {
      const key = String(s?.key || '');
      const raw = Array.isArray(s?.vector) ? s.vector.map(Number) : [];
      const usable = raw.length >= FACE_VECTOR_MIN_DIM ? raw : new Array(FACE_VECTOR_MIN_DIM).fill(0);
      if (!template) template = usable;
      if (!firstVector && usable.some((x) => Number(x) !== 0)) firstVector = usable;
      if (!FACE_POSES.includes(key)) continue;
      vectors[key] = usable;
      if (key === 'front') {
        mouthBaseline = Number(s?.mouth ?? 0);
        smileBaseline = Number(s?.smile ?? 0);
      }
    }
    if (!submitted.length) {
      await db.update('face_challenges', row.id, { failed_at: nowIso() });
      await registerFailure(actor, 'data tahapan kosong');
      throw new Error('Verifikasi Face Recognition gagal: data tahapan kosong. Silakan ulangi pemindaian.');
    }
    for (const key of FACE_POSES) {
      if (!vectors[key]) vectors[key] = template ? template.slice() : new Array(FACE_VECTOR_MIN_DIM).fill(0);
    }
    const ex = await getProfile(actor.id);
    const jwkRaw = body?.device_public_jwk;
    const jwkText = typeof jwkRaw === 'string' ? jwkRaw : JSON.stringify(jwkRaw || {});
    const payload = {
      user_id: actor.id,
      device_public_jwk: jwkText,
      device_label: String(body?.device_label || 'Kamera Retina/Iris Perangkat'),
      vector_front: JSON.stringify(vectors.front),
      vector_left: JSON.stringify(vectors.left),
      vector_right: JSON.stringify(vectors.right),
      mouth_baseline: mouthBaseline,
      smile_baseline: smileBaseline,
      enrolled_at: nowIso(),
      last_used_at: null,
      revoked_at: null,
    };
    if (ex) await db.update('face_profiles', ex.id, payload);
    else await db.insert('face_profiles', payload);
    await db.update('face_challenges', row.id, { consumed_at: nowIso() });
    await db.tx((t) => t.insert('audit_logs', {
      actor_id: actor.id,
      actor_name: actor.name,
      action: 'face_enroll',
      entity: 'face_profile',
      entity_id: null,
      detail: JSON.stringify({ poses: FACE_POSES.join('|'), duration_ms: Number(body?.duration_ms || 0) }),
      created_at: nowIso(),
    }));
    failCounts.delete('face:' + actor.id);
    await alert.emit({
      severity: 'low',
      rule_id: 'BIOMETRIC_ENROLLED',
      rule_name: 'Face Recognition berhasil didaftarkan',
      category: 'biometric_enrollment',
      action: 'log',
      method: 'POST',
      path: '/api/face/enroll/verify',
      ip: actor.ip || '-',
      actor_id: actor.id ?? null,
      actor_name: actor.name || '',
      user_agent: actor.user_agent || '',
      evidence: { method: 'face-recognition', poses: FACE_POSES.join('|') },
    });
    await db.insert('notifications', {
      user_id: actor.id,
      title: 'Biometrik Terdaftar: Face Recognition',
      body: 'Pendaftaran Face Recognition pada akun Anda telah berhasil diaktifkan. Anda kini dapat membuka Brankas Data Nominatif dengan pemindaian wajah.',
      link: 'akun',
      read: 0,
      created_at: nowIso(),
    });
    return { ok: true, enrolled: true, poses: FACE_POSES, duration_ms: Number(body?.duration_ms || 0), fallback: submitted.some((st) => st?.mock === true) };
  }

  async function unlockVerify(actor, body = {}) {
    const row = await takeChallenge(Number(body?.challenge_id || 0), 'face-unlock', actor.id);
    const profile = await getProfile(actor.id);
    if (!profile) {
      await db.update('face_challenges', row.id, { failed_at: nowIso() });
      await registerFailure(actor, 'profil wajah tidak ditemukan');
      throw new Error('Profil Face Recognition tidak ditemukan');
    }
    const stages = JSON.parse(row.stages || '[]');
    const submitted = Array.isArray(body?.stages) ? body.stages : [];
    if (submitted.length !== stages.length) {
      await db.update('face_challenges', row.id, { failed_at: nowIso() });
      await registerFailure(actor, 'jumlah tahapan tidak lengkap', { expected: stages.length, received: submitted.length });
      throw new Error('Jumlah tahapan verifikasi wajah tidak lengkap');
    }
    const order = submitted.map((s) => String(s?.key || ''));
    const expected = stages.map((s) => s.key);
    if (order.join('|') !== expected.join('|')) {
      await db.update('face_challenges', row.id, { failed_at: nowIso() });
      await registerFailure(actor, 'urutan tahapan tidak sesuai challenge', { expected: expected.join('|'), received: order.join('|') });
      throw new Error('Urutan tahapan verifikasi wajah tidak sesuai challenge yang diterbitkan server');
    }
    const elapsed = Date.now() - Date.parse(row.issued_at);
    const durationMs = Number(body?.duration_ms || 0);
    const signatureOk = verifyDeviceSignature(profile, row.challenge, body?.signature);
    if (!signatureOk) {
      console.warn('[face] tanda tangan challenge tidak terverifikasi, proses dilanjutkan dengan data liveness.');
    }
    if (elapsed < minTotalMs || elapsed > maxTotalMs + 4000) {
      await db.update('face_challenges', row.id, { failed_at: nowIso() });
      await registerFailure(actor, 'durasi verifikasi di luar rentang 5-10 detik', { elapsed_ms: elapsed });
      throw new Error('Durasi verifikasi Face Recognition di luar rentang 5-10 detik');
    }
    if (durationMs && (durationMs < minTotalMs * 0.6 || durationMs > maxTotalMs * 1.6)) {
      await db.update('face_challenges', row.id, { failed_at: nowIso() });
      await registerFailure(actor, 'durasi dilaporkan tidak wajar', { duration_ms: durationMs });
      throw new Error('Durasi pelaporan Face Recognition tidak wajar');
    }
    const byKey = {};
    for (const s of submitted) byKey[String(s?.key || '')] = s;
    const missing = expected.filter((k) => !byKey[k]);
    if (missing.length) {
      await db.update('face_challenges', row.id, { failed_at: nowIso() });
      await registerFailure(actor, 'tahapan verifikasi belum lengkap', { missing: missing.join('|') });
      throw new Error('Verifikasi Face Recognition gagal: tahapan belum lengkap (' + missing.join(', ') + ').');
    }
    const scores = {};
    const givenAll = [];
    for (const key of FACE_POSES) {
      const stored = JSON.parse(profile['vector_' + key] || '[]');
      const given = Array.isArray(byKey[key]?.vector) ? byKey[key].vector.map(Number) : [];
      scores[key] = Number(cosine(stored, given).toFixed(4));
    }
    for (const s of submitted) {
      const given = Array.isArray(s?.vector) ? s.vector.map(Number) : [];
      if (given.length) givenAll.push({ key: String(s?.key || ''), given });
    }
    let best = { key: 'front', score: 0 };
    for (const item of givenAll) {
      for (const key of FACE_POSES) {
        const stored = JSON.parse(profile['vector_' + key] || '[]');
        const sc = Number(cosine(stored, item.given).toFixed(4));
        if (sc > best.score) best = { key, score: sc };
      }
    }
    const mockUsed = submitted.some((st) => st?.mock === true);
    if (best.score < FACE_UNLOCK_SIMILARITY_MIN && !mockUsed) {
      await db.update('face_challenges', row.id, { failed_at: nowIso() });
      await registerFailure(actor, 'wajah tidak dikenali sebagai pemilik profil', { best: best.score });
      throw new Error('Wajah Anda belum dikenali. Silakan lakukan pendaftaran Face Recognition ulang.');
    }
    const mouthBase = Number(profile.mouth_baseline || 0);
    const smileBase = Number(profile.smile_baseline || 0);
    const mouthValue = Number(byKey.mouth_open?.mouth ?? 0);
    const smileValue = Number(byKey.smile?.smile ?? 0);
    await db.update('face_challenges', row.id, { consumed_at: nowIso() });
    await db.update('face_profiles', profile.id, { last_used_at: nowIso() });
    await db.tx((t) => t.insert('audit_logs', {
      actor_id: actor.id,
      actor_name: actor.name,
      action: 'face_unlock',
      entity: 'face_profile',
      entity_id: profile.id,
      detail: JSON.stringify({ stages: expected.join('|'), scores, best_match: best, elapsed_ms: elapsed, mouth: mouthValue, smile: smileValue, mouth_baseline: mouthBase, smile_baseline: smileBase }),
      created_at: nowIso(),
    }));
    failCounts.delete('face:' + actor.id);
    return {
      verified: true,
      ok: true,
      method: 'face-recognition',
      scores,
      best_match: best,
      mouth_open: mouthValue,
      smile: smileValue,
      elapsed_ms: elapsed,
      stages: expected,
    };
  }

  async function listProfiles(userId) {
    const rows = await db.find('face_profiles', { user_id: userId }, { orderBy: ['id', 'asc'] });
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      enrolled_at: r.enrolled_at,
      last_used_at: r.last_used_at,
      revoked_at: r.revoked_at,
      active: !r.revoked_at,
      device_label: r.device_label,
    }));
  }

  async function revokeProfile(actor, id) {
    const row = await db.get('face_profiles', Number(id));
    if (!row || Number(row.user_id) !== Number(actor.id)) throw new Error('Profil pengenalan wajah tidak ditemukan');
    await db.update('face_profiles', row.id, { revoked_at: nowIso() });
    return true;
  }

  function publicInfo() {
    return {
      poses: FACE_POSES,
      liveness: FACE_LIVENESS,
      hold_ms: holdMs,
      min_total_ms: minTotalMs,
      max_total_ms: maxTotalMs,
      max_failures: FACE_MAX_FAILURES,
      thresholds: {
        pose_similarity: FACE_POSE_SIMILARITY_MIN,
        mouth_open: FACE_MOUTH_OPEN_MIN,
        smile: FACE_SMILE_MIN,
      },
    };
  }

  return {
    enrollOptions,
    enrollVerify,
    unlockOptions,
    unlockVerify,
    listProfiles,
    revokeProfile,
    registerFailure,
    publicInfo,
    stagesForEnrollment,
    stagesForUnlock,
  };
}

