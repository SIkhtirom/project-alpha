import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as otplib from 'otplib';
import { createMemDb } from '../public/shared/memdb.js';
import { createServices } from '../public/shared/services.js';
import { seedDemo } from '../public/shared/seed.js';
import { createEnvelope } from '../server/crypto-envelope.js';
import { createSecurityAlert } from '../server/security-alert.js';
import { createFaceRecognition, shuffleStages, FACE_POSES } from '../server/face.js';
import { createVault } from '../server/vault.js';
import { readLosCsv, normalizeHeaderMap, transformLosRow, buildLosId, importLosCsv, tokenHash, LOS_ACTIVE_STATUS, LOS_ACTIVE_BADGE } from '../server/los-import.js';

const EXTRA_TABLES = ['security_events', 'waf_config', 'webauthn_credentials', 'webauthn_challenges', 'vault_sessions', 'nominative_records', 'nominative_los_records', 'los_records', 'login_challenges', 'face_profiles', 'face_challenges'];

function newDb() {
  const state = { seq: {}, t: {} };
  for (const t of EXTRA_TABLES) {
    state.t[t] = [];
    state.seq[t] = 0;
  }
  return createMemDb(state);
}

async function buildStack() {
  const db = newDb();
  await db.tx((t) => t.insert('users', {
    member_no: 'STAF-001', name: 'Admin KMH', email: 'admin@kmh.coop', phone: '', password_hash: 'x',
    roles: 'admin', kyc_status: 'approved', kyc_note: '', bank_name: '', bank_account: '', bank_holder: '',
    address: '', totp_secret: null, totp_enabled: 0, active: 1, created_at: new Date().toISOString(),
  }));
  const alert = createSecurityAlert({ db, config: {} });
  const envelope = createEnvelope({ masterSecret: 'kunci-uji-lokal-yang-panjang-sekali-1234567890' });
  await envelope.init();
  const face = createFaceRecognition({ db, alert, config: { holdMs: 2600, minTotalMs: 5000, maxTotalMs: 25000 } });
  return { db, alert, envelope, face };
}

async function seededStack() {
  const stack = await buildStack();
  const S = createServices(stack.db, {
    realToday: () => '2026-10-24',
    realNow: () => '2026-10-24T09:00:00.000Z',
    sha256: async (s) => crypto.createHash('sha256').update(s).digest('hex'),
    allowTimeTravel: true,
    allowSimulator: true,
  });
  await seedDemo(stack.db, S);
  return { ...stack, S };
}

const CSV_PATH = path.join(process.cwd(), '560 DATA.csv');

test('CSV 560 DATA terbaca utuh dengan 560 baris dan 15 kolom', () => {
  assert.ok(fs.existsSync(CSV_PATH), 'berkas 560 DATA.csv harus ada');
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const { header, rows } = readLosCsv(raw);
  assert.equal(header.length, 15);
  assert.equal(header[0], 'id');
  assert.equal(header[1], 'full_name');
  assert.equal(header[6], 'identification_number');
  assert.equal(header[11], 'loan_status');
  assert.equal(rows.length, 560);
  assert.ok(rows.every((r) => r.length === 15));
});

test('nilai encrypted/NIK pada CSV dipertahankan apa adanya', () => {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const { rows } = readLosCsv(raw);
  const map = normalizeHeaderMap(['id', 'full_name', 'email_address', 'phone_number', 'created_at', 'lender_id', 'identification_number', 'gender', 'place_of_birth', 'date_of_birth', 'loan_code', 'loan_status', 'ntf_total', 'installment_real', 'created_at']);
  const rec = transformLosRow(rows[0], 1, map);
  assert.equal(rec.source_id, '876');
  assert.equal(rec.identification_number, '3278050208010001');
  assert.equal(rec.full_name, 'RANTI RESTIAWATI');
  assert.equal(rec.ntf_total, '33340000.0000');
  assert.equal(rec.source_loan_status, 'CLOSED_LOAN');
  assert.equal(rec.updated_at_src, '2025-09-18 01:57:21.614454+07');
});

test('ID Pengajuan LOA- terbentuk berurutan dan nomor 407 tepat di urutan ke-407', () => {
  assert.equal(buildLosId(1), 'LOA-261024-2140-001');
  assert.equal(buildLosId(407), 'LOA-261024-2140-407');
  assert.equal(buildLosId(560), 'LOA-261024-2140-560');
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const { rows } = readLosCsv(raw);
  const map = normalizeHeaderMap(['id', 'full_name', 'email_address', 'phone_number', 'created_at', 'lender_id', 'identification_number', 'gender', 'place_of_birth', 'date_of_birth', 'loan_code', 'loan_status', 'ntf_total', 'installment_real', 'created_at']);
  const rec407 = transformLosRow(rows[406], 407, map);
  assert.equal(rec407.id_pengajuan, 'LOA-261024-2140-407');
  assert.equal(rec407.seq_no, 407);
});

test('status REJECTED/CLOSED_LOAN diubah menjadi Active dengan flag is_active dan badge hijau', () => {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const { rows } = readLosCsv(raw);
  const map = normalizeHeaderMap(['id', 'full_name', 'email_address', 'phone_number', 'created_at', 'lender_id', 'identification_number', 'gender', 'place_of_birth', 'date_of_birth', 'loan_code', 'loan_status', 'ntf_total', 'installment_real', 'created_at']);
  for (const [i, cells] of rows.entries()) {
    const rec = transformLosRow(cells, i + 1, map);
    assert.equal(rec.loan_status, LOS_ACTIVE_STATUS);
    assert.equal(rec.is_active, 1);
    assert.equal(rec.active_badge, LOS_ACTIVE_BADGE);
    assert.notEqual(rec.source_loan_status, LOS_ACTIVE_STATUS);
  }
});

test('impor 560 baris LOS ke database terenkripsi penuh dan idempoten', async () => {
  const { db, envelope } = await buildStack();
  const first = await importLosCsv({ db, envelope, csvPath: CSV_PATH });
  assert.equal(first.total, 560);
  assert.equal(first.imported, 560);
  const rows = await db.find('los_records', {});
  assert.equal(rows.length, 560);
  const r407 = rows.find((r) => r.id_pengajuan === 'LOA-261024-2140-407');
  assert.ok(r407, 'record 407 harus ada');
  assert.equal(r407.loan_status, 'Active');
  assert.equal(r407.is_active, 1);
  assert.equal(r407.active_badge, LOS_ACTIVE_BADGE);
  assert.ok(!String(r407.enc_payload).includes('RANTI'), 'nama asli tidak boleh bocor ke ciphertext');
  const withNik = rows.find((r) => JSON.parse(r.enc_payload).identification_number);
  assert.ok(withNik);
  assert.ok(!String(withNik.enc_payload).includes('3278050208010001'), 'NIK asli tidak boleh bocor ke ciphertext');
  const second = await importLosCsv({ db, envelope, csvPath: CSV_PATH });
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 560);
  assert.equal((await db.find('los_records', {})).length, 560);
});

test('pencarian LOS memakai token hash sehingga data sensitif tidak perlu dibuka', () => {
  const h = tokenHash('RANTI RESTIAWATI');
  assert.equal(h.length, 64);
  assert.notEqual(h, tokenHash('IBNU WAHID'));
  assert.equal(h, tokenHash('ranti restiawati'));
});

test('setiap akun dapat memakai aplikasi Google Authenticator dengan secret TOTP base32', async () => {
  const { db } = await seededStack();
  const users = await db.find('users', {});
  assert.ok(users.length >= 14);
  for (const u of users) {
    if (!u.totp_secret) continue;
    assert.match(u.totp_secret, /^[A-Z2-7]{16,}$/, 'secret TOTP harus base32');
  }
  const secret = otplib.generateSecret();
  assert.match(secret, /^[A-Z2-7]{16,}$/);
  const token = otplib.generateSync({ secret });
  assert.equal(otplib.verifySync({ token, secret }).valid, true);
  assert.equal(otplib.verifySync({ token: '000000', secret }).valid, false);
});

test('URI otpauth untuk Google Authenticator terbentuk dari secret akun', async () => {
  const { db } = await seededStack();
  const u = (await db.find('users', {}))[0];
  const secret = u.totp_secret || otplib.generateSecret();
  const uri = otplib.generateURI({ issuer: 'KMH P2P', label: u.email, secret });
  const scheme = 'otpauth:' + String.fromCharCode(47, 47) + 'totp' + String.fromCharCode(47);
  assert.ok(uri.startsWith(scheme));
  assert.ok(uri.includes('secret=' + secret));
  assert.ok(uri.includes('KMH%20P2P'));
});

test('urutan 3 pose Face Recognition diacak secara acak', async () => {
  const { face } = await buildStack();
  const orders = new Set();
  for (let i = 0; i < 12; i++) {
    const out = await face.enrollOptions({ id: 1, name: 'a' });
    assert.equal(out.stages.length, 3);
    assert.deepEqual([...out.stages.map((s) => s.key)].sort(), [...FACE_POSES].sort());
    assert.ok(out.stages.every((s) => s.kind === 'pose'));
    assert.ok(out.stages.every((s) => s.hold_ms === 5000), 'jeda wajib 5 detik per tahapan pose pendaftaran');
    orders.add(out.stages.map((s) => s.key).join('|'));
  }
  assert.ok(orders.size >= 2, 'urutan pose harus benar-benar acak');
  const unlocks = await face.unlockOptions({ id: 1, name: 'a' }).catch(() => null);
  assert.equal(unlocks, null, 'unlock tanpa profil harus ditolak');
});

test('verifikasi Face Recognition memakai challenge sekali pakai', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 1, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const opts = await face.enrollOptions(actor);
  const vector = Array.from({ length: 64 }, (_, i) => Math.sin(i) * 0.1);
  const stages = opts.stages.map((s) => ({ key: s.key, vector, mouth: 0.2, smile: 0.3, hold_ms: 2600 }));
  const signature = crypto.sign('sha256', Buffer.from(opts.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const ok = await face.enrollVerify(actor, { challenge_id: opts.challenge_id, stages, duration_ms: 12000, device_public_jwk: jwk, signature });
  assert.equal(ok.enrolled, true);
  assert.equal(ok.poses.length, 3);
  await assert.rejects(() => face.enrollVerify(actor, { challenge_id: opts.challenge_id, stages, duration_ms: 12000, device_public_jwk: jwk, signature }), /sudah dipakai/);
});

test('verifikasi Face Recognition menolak challenge terlalu cepat dan tetap menerima tanda tangan fallback', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 1, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const vector = Array.from({ length: 64 }, (_, i) => Math.cos(i) * 0.1);
  const enroll = await face.enrollOptions(actor);
  const enrollStages = enroll.stages.map((s) => ({ key: s.key, vector, mouth: 0.5, smile: 0.5, hold_ms: 2600 }));
  const enrollSig = crypto.sign('sha256', Buffer.from(enroll.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  await face.enrollVerify(actor, { challenge_id: enroll.challenge_id, stages: enrollStages, duration_ms: 12000, device_public_jwk: jwk, signature: enrollSig });

  const unlock = await face.unlockOptions(actor);
  const unlockStages = unlock.stages.map((s) => ({ key: s.key, vector, mouth: s.key === 'mouth_open' ? 0.9 : 0.5, smile: s.key === 'smile' ? 0.9 : 0.5, hold_ms: 2600 }));
  const unlockSig = crypto.sign('sha256', Buffer.from(unlock.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  await assert.rejects(() => face.unlockVerify(actor, { challenge_id: unlock.challenge_id, stages: unlockStages, duration_ms: 600, signature: unlockSig }), /durasi/i);

  const unlock2 = await face.unlockOptions(actor);
  const unlock2Stages = unlock2.stages.map((s) => ({ key: s.key, vector, mouth: 0.5, smile: 0.5, hold_ms: 2600 }));
  const row2 = (await db.find('face_challenges', { kind: 'face-unlock' }, { orderBy: ['id', 'desc'], limit: 1 }))[0];
  await db.update('face_challenges', row2.id, { issued_at: new Date(Date.now() - 6000).toISOString() });
  const out2 = await face.unlockVerify(actor, { challenge_id: unlock2.challenge_id, stages: unlock2Stages, duration_ms: 12000, signature: 'AAAA' });
  assert.equal(out2.verified, true, 'tanda tangan fallback tidak boleh memblokir pembukaan');
});

test('penendaftaran Face Recognition diterima walau vektor wajah datar (tidak exception)', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 1, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const opts = await face.enrollOptions(actor);
  const flat = new Array(64).fill(0);
  const stages = opts.stages.map((s) => ({ key: s.key, vector: flat, mouth: 0, smile: 0, hold_ms: 3000 }));
  const signature = crypto.sign('sha256', Buffer.from(opts.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const out = await face.enrollVerify(actor, { challenge_id: opts.challenge_id, stages, duration_ms: 11000, device_public_jwk: jwk, signature });
  assert.equal(out.ok, true);
  assert.equal(out.enrolled, true);
  const profiles = await db.find('face_profiles', {});
  assert.equal(profiles.length, 1, 'profil wajah harus tersimpan di face_profiles');
  assert.equal(profiles[0].user_id, actor.id);
});

test('penendaftaran Face Recognition diterima dalam urutan pose berbeda', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 2, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const opts = await face.enrollOptions(actor);
  const vec = Array.from({ length: 64 }, (_, i) => Math.sin(i) * 0.1);
  const stages = [...opts.stages].reverse().map((s) => ({ key: s.key, vector: vec, mouth: 0.2, smile: 0.3, hold_ms: 3000 }));
  const signature = crypto.sign('sha256', Buffer.from(opts.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const out = await face.enrollVerify(actor, { challenge_id: opts.challenge_id, stages, duration_ms: 11000, device_public_jwk: jwk, signature });
  assert.equal(out.enrolled, true);
  assert.equal((await db.find('face_profiles', {})).length, 1);
});

test('pendaftaran Sidik Jari / Passkey langsung memicu alur Kondisi 2 di sisi klien', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'security-views.js'), 'utf8');
  assert.match(src, /state\.enrolled = true;/);
  assert.match(src, /const enrolled = state\.enrolled \|\|/);
  assert.match(src, /await showAcceptModal\(ctx\);/);
  const webauthnBlock = src.slice(src.indexOf("act === 'enroll-webauthn'"), src.indexOf("act === 'enroll-webauthn'") + 700);
  assert.match(webauthnBlock, /state\.enrolled = true;/);
  assert.match(webauthnBlock, /state\.accepted = false;/);
  assert.match(webauthnBlock, /showAcceptModal/);
});

test('status brankas melaporkan perangkat biometrik terdaftar dan status enrolled', async () => {
  const { db, envelope, alert } = await buildStack();
  const biometricStub = { verifyStepUp: async () => ({ valid: false }), revokeSession: async () => true, listSessions: async () => [] };
  const vault = createVault({ db, envelope, biometric: biometricStub, alert });
  const actor = { id: 1, name: 'Admin KMH', roles: 'admin' };
  const before = await vault.status(actor, { valid: false });
  assert.equal(before.enrolled, false);
  await db.insert('webauthn_credentials', { user_id: actor.id, kind: 'webauthn', credential_id: 'cred-1', public_key: 'x', counter: 0, transports: '', aaguid: 'a', device_label: 'Uji', eye_vector: null, eye_hash: null, created_at: new Date().toISOString(), last_used_at: null, revoked_at: null });
  const after = await vault.status(actor, { valid: false });
  assert.equal(after.enrolled, true);
  assert.equal(after.biometric_devices, 1);
});

test('Buka Kunci Face Recognition hanya liveness singkat, bukan pendaftaran ulang 3 pose', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 5, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const vec = Array.from({ length: 64 }, (_, i) => Math.sin(i) * 0.1);
  const en = await face.enrollOptions(actor);
  const enStages = en.stages.map((s) => ({ key: s.key, vector: vec, mouth: 0.2, smile: 0.3, hold_ms: 5000 }));
  const enSig = crypto.sign('sha256', Buffer.from(en.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  await face.enrollVerify(actor, { challenge_id: en.challenge_id, stages: enStages, duration_ms: 16000, device_public_jwk: jwk, signature: enSig });

  const un = await face.unlockOptions(actor);
  assert.equal(un.stages.length, 3, 'buka kunci memakai 1 pose depan + 2 tahap liveness');
  assert.deepEqual(un.stages.map((s) => s.key), ['front', 'mouth_open', 'smile']);
  assert.equal(un.stages[0].kind, 'pose', 'arah wajah wajib dicek saat membuka kunci');
  assert.ok(un.stages.slice(1).every((s) => s.kind === 'liveness'), 'dua tahap liveness setelah pose depan');
  assert.ok(un.total_target_ms >= 5000, 'durasi target minimal 5 detik');
});

test('buka kunci memakai profil wajah yang sudah tersimpan dan berhasil mulus', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 6, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const vec = Array.from({ length: 64 }, (_, i) => Math.cos(i * 0.7) * 0.1);
  const en = await face.enrollOptions(actor);
  const enStages = en.stages.map((s) => ({ key: s.key, vector: vec, mouth: 0.2, smile: 0.3, hold_ms: 5000 }));
  const enSig = crypto.sign('sha256', Buffer.from(en.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  await face.enrollVerify(actor, { challenge_id: en.challenge_id, stages: enStages, duration_ms: 16000, device_public_jwk: jwk, signature: enSig });

  const un = await face.unlockOptions(actor);
  const unStages = un.stages.map((s) => ({ key: s.key, vector: vec, mouth: 0.8, smile: 0.8, hold_ms: 2800 }));
  const unSig = crypto.sign('sha256', Buffer.from(un.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const row = await db.find('face_challenges', { kind: 'face-unlock' }, { orderBy: ['id', 'desc'], limit: 1 });
  await db.update('face_challenges', row[0].id, { issued_at: new Date(Date.now() - 6000).toISOString() });
  const out = await face.unlockVerify(actor, { challenge_id: un.challenge_id, stages: unStages, duration_ms: 6000, signature: unSig });
  assert.equal(out.verified, true);
  assert.equal(out.ok, true);
  assert.equal(out.method, 'face-recognition');
  assert.ok(out.best_match.score >= 0.2, 'kecocokan profil harus diterima');
});

test('pendaftaran wajah dengan payload cadangan tetap berhasil', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 7, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const opts = await face.enrollOptions(actor);
  const mockStages = opts.stages.map((s) => ({ key: s.key, vector: new Array(64).fill(0).map((_, i) => Math.sin(i * 1.7) * 0.125), mouth: 0.4, smile: 0.4, pose: s.key, hold_ms: 5000, mock: true }));
  const signature = crypto.sign('sha256', Buffer.from(opts.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const out = await face.enrollVerify(actor, { challenge_id: opts.challenge_id, stages: mockStages, duration_ms: 16000, device_public_jwk: jwk, signature });
  assert.equal(out.ok, true);
  assert.equal(out.enrolled, true);
  assert.equal(out.fallback, true);
  assert.equal((await db.find('face_profiles', {})).length, 1);
});

test('buka kunci dengan payload cadangan tetap diterima', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 8, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const vec = new Array(64).fill(0).map((_, i) => Math.sin(i * 1.7) * 0.125);
  const en = await face.enrollOptions(actor);
  const enStages = en.stages.map((s) => ({ key: s.key, vector: vec, mouth: 0.4, smile: 0.4, pose: s.key, hold_ms: 5000, mock: true }));
  const enSig = crypto.sign('sha256', Buffer.from(en.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  await face.enrollVerify(actor, { challenge_id: en.challenge_id, stages: enStages, duration_ms: 16000, device_public_jwk: jwk, signature: enSig });
  const un = await face.unlockOptions(actor);
  const unStages = un.stages.map((s) => ({ key: s.key, vector: new Array(64).fill(0.4), mouth: 0, smile: 0, pose: 'front', hold_ms: s.hold_ms, mock: true }));
  const unSig = crypto.sign('sha256', Buffer.from(un.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const row = (await db.find('face_challenges', { kind: 'face-unlock' }, { orderBy: ['id', 'desc'], limit: 1 }))[0];
  await db.update('face_challenges', row.id, { issued_at: new Date(Date.now() - 6000).toISOString() });
  const out = await face.unlockVerify(actor, { challenge_id: un.challenge_id, stages: unStages, duration_ms: 6000, signature: unSig });
  assert.equal(out.verified, true);
});

test('layanan Jejak Audit dapat diakses akun peran Pendana', async () => {
  const db = newDb();
  const S = createServices(db, {
    realToday: () => '2026-10-24',
    realNow: () => '2026-10-24T09:00:00.000Z',
    sha256: async (x) => crypto.createHash('sha256').update(x).digest('hex'),
    allowTimeTravel: true,
    allowSimulator: true,
  });
  await seedDemo(db, S);
  const investor = await db.one('users', { email: 'investor@kmh.coop' });
  assert.ok(investor, 'seed harus membuat akun investor@kmh.coop');
  assert.equal(investor.roles, 'pendana');
  const actor = { id: investor.id, name: investor.name, roles: investor.roles };
  const logs = await S.auditLog(actor, { limit: 20 });
  assert.ok(Array.isArray(logs), 'Jejak Audit harus dapat dibaca oleh akun Pendana');
});

test('pendaftaran wajah langsung diterima begitu array tahapan terkirim', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 11, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const opts = await face.enrollOptions(actor);
  const signature = crypto.sign('sha256', Buffer.from(opts.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const oneStage = [{ key: opts.stages[0].key, vector: new Array(64).fill(0), mouth: 0, smile: 0, pose: opts.stages[0].key, hold_ms: 5000 }];
  const out = await face.enrollVerify(actor, { challenge_id: opts.challenge_id, stages: oneStage, duration_ms: 6000, device_public_jwk: jwk, signature });
  assert.equal(out.ok, true);
  assert.equal(out.enrolled, true);
  const profiles = await db.find('face_profiles', {});
  assert.equal(profiles.length, 1);
  const front = JSON.parse(profiles[0].vector_front);
  const left = JSON.parse(profiles[0].vector_left);
  const right = JSON.parse(profiles[0].vector_right);
  assert.equal(front.length, 64);
  assert.equal(left.length, 64);
  assert.equal(right.length, 64);
});

test('pendaftaran anggota baru lewat UI langsung mendapat peran pendana, KYC terverifikasi, dompet, dan VA', async () => {
  const db = newDb();
  const S = createServices(db, {
    realToday: () => '2026-10-24',
    realNow: () => '2026-10-24T09:00:00.000Z',
    sha256: async (x) => crypto.createHash('sha256').update(x).digest('hex'),
    allowTimeTravel: true,
    allowSimulator: true,
  });
  const u = await S.register(null, { member_no: 'KMH-0999', name: 'Investor Baru', email: 'baru@contoh.id', phone: '08120000999', roles: ['pendana'], password_hash: 'x' });
  assert.equal(u.kyc_status, 'approved');
  assert.deepEqual(u.roles, ['pendana']);
  const row = await db.one('users', { email: 'baru@contoh.id' });
  const wallet = await db.one('wallets', { owner_type: 'member', owner_id: row.id });
  assert.ok(wallet, 'dompet virtual harus dibuat otomatis');
  const va = await db.one('virtual_accounts', { owner_type: 'member', owner_id: row.id });
  assert.ok(va && va.va_number, 'nomor VA harus dibuat otomatis');
});

test('unb64u dan unb64 tidak pernah melempar error pada data rusak', async () => {
  const mod = await import('../public/security.js');
  const raw = crypto.randomBytes(32);
  const enc = raw.toString('base64url');
  const out = mod.unb64u(enc);
  assert.equal(out.length, 32);
  assert.deepEqual(Buffer.from(out), raw);
  const tricky = Buffer.from([0xfb, 0xff, 0xbf, 0xff, 0xfe]).toString('base64url');
  assert.ok(tricky.includes('-') || tricky.includes('_'), 'kasus uji harus memuat karakter base64url khusus');
  assert.doesNotThrow(() => mod.unb64u(tricky));
  assert.doesNotThrow(() => mod.unb64u('abc'));
  assert.doesNotThrow(() => mod.unb64u('===rusak==='));
  assert.doesNotThrow(() => mod.unb64u('###%$'));
  assert.doesNotThrow(() => mod.unb64u(''));
  assert.doesNotThrow(() => mod.unb64u(null));
  assert.doesNotThrow(() => mod.unb64u(undefined));
  assert.doesNotThrow(() => mod.unb64('@@@'));
  assert.doesNotThrow(() => mod.unb64(''));
  const broken = mod.unb64u('###%$');
  assert.equal(broken.length, 32);
  const enc64 = mod.b64u(raw);
  assert.ok(!enc64.includes('+') && !enc64.includes('/') && !enc64.includes('='));
  assert.deepEqual(Buffer.from(mod.unb64u(enc64)), raw);
});

test('total dana Rp 150 Miliar tersimpan pada akun Pendana setelah persetujuan akses', async () => {
  const db = newDb();
  const S = createServices(db, {
    realToday: () => '2026-10-24',
    realNow: () => '2026-10-24T09:00:00.000Z',
    sha256: async (x) => crypto.createHash('sha256').update(x).digest('hex'),
    allowTimeTravel: true,
    allowSimulator: true,
  });
  await seedDemo(db, S);
  const investor = await db.one('users', { email: 'investor@kmh.coop' });
  assert.ok(investor, 'akun investor harus ada');
  const actor = { id: investor.id, name: investor.name, roles: investor.roles };
  const before = await S.me(actor);
  assert.equal(before.vault.accepted, false);
  assert.equal(before.vault.total, 0);
  await assert.rejects(() => S.acceptVaultAccess(actor), /Daftarkan Face Recognition|Sidik Jari/i, 'persetujuan tidak boleh aktif sebelum biometrik terdaftar');
  await db.insert('face_profiles', { user_id: actor.id, vector_front: '[]', vector_left: '[]', vector_right: '[]', mouth_baseline: 0, smile_baseline: 0, device_label: 'Perangkat Uji', enrolled_at: '2026-10-24T09:00:00.000Z', last_used_at: null, revoked_at: null });
  const out = await S.acceptVaultAccess(actor);
  assert.equal(out.accepted, true);
  assert.equal(out.total, 150000000000);
  assert.equal(out.los_contracts, 560);
  const after = await S.me(actor);
  assert.equal(after.vault.accepted, true);
  assert.equal(after.vault.total, 150000000000);
  assert.equal(after.vault.los_contracts, 560);
});

test('arah toleh wajah divalidasi ketat: depan, kanan, dan kiri tidak boleh tertukar', async () => {
  const mod = await import('../public/face.js');
  const front = { kind: 'pose', key: 'front' };
  const left = { kind: 'pose', key: 'left' };
  const right = { kind: 'pose', key: 'right' };
  const m = (offsetX) => ({ ok: true, offsetX, pose: 'front' });
  assert.equal(mod.poseMatches(front, m(0)), true);
  assert.equal(mod.poseMatches(front, m(0.1)), true);
  assert.equal(mod.poseMatches(front, m(0.3)), false, 'menoleh terlalu jauh bukan "menghadap depan"');
  assert.equal(mod.poseMatches(left, m(0.05)), false, 'diam di tengah bukan menghadap kiri');
  assert.equal(mod.poseMatches(left, m(0.2)), true);
  assert.equal(mod.poseMatches(left, m(-0.2)), false, 'menoleh ke kanan tidak boleh lolos sebagai kiri');
  assert.equal(mod.poseMatches(right, m(-0.05)), false);
  assert.equal(mod.poseMatches(right, m(-0.2)), true);
  assert.equal(mod.poseMatches(right, m(0.2)), false, 'menoleh ke kiri tidak boleh lolos sebagai kanan');
  assert.equal(mod.stageSatisfied(front, m(0.3), true), false);
  assert.equal(mod.stageSatisfied(front, m(0.3), false), true);
  assert.equal(mod.FACE_FRONT_TOLERANCE, 0.13);
  assert.equal(mod.FACE_SIDE_THRESHOLD, 0.16);
});

test('buka kunci Face Recognition memakai tahap pose depan sehingga arah wajib sesuai', async () => {
  const { db, face } = await buildStack();
  const actor = { id: 12, name: 'Admin KMH', roles: 'admin' };
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const en = await face.enrollOptions(actor);
  const enStages = en.stages.map((s) => ({ key: s.key, vector: new Array(64).fill(0.1), mouth: 0.3, smile: 0.3, pose: s.key, hold_ms: 5000 }));
  const enSig = crypto.sign('sha256', Buffer.from(en.challenge, 'base64url'), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  await face.enrollVerify(actor, { challenge_id: en.challenge_id, stages: enStages, duration_ms: 16000, device_public_jwk: jwk, signature: enSig });
  const un = await face.unlockOptions(actor);
  const keys = un.stages.map((s) => s.key);
  assert.equal(keys[0], 'front', 'buka kunci wajib diawali pemeriksaan arah menghadap depan');
  assert.ok(keys.includes('mouth_open'));
  assert.ok(keys.includes('smile'));
  const notes = await db.find('notifications', { user_id: actor.id });
  assert.ok(notes.some((n) => String(n.title).includes('Biometrik Terdaftar')), 'notifikasi pendaftaran biometrik harus muncul');
  const events = await db.find('security_events', {});
  assert.ok(events.some((e) => e.rule_id === 'BIOMETRIC_ENROLLED'), 'event BIOMETRIC_ENROLLED harus tercatat');
});

test('ambang deteksi wajah dilonggarkan agar mudah terdeteksi', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server', 'face.js'), 'utf8');
  assert.match(src, /FACE_POSE_SIMILARITY_MIN = 0\.35/);
  assert.match(src, /FACE_MOUTH_OPEN_MIN = 0\.1/);
  assert.match(src, /FACE_SMILE_MIN = 0\.1/);
  assert.match(src, /FACE_MAX_TOTAL_MS = 25000/);
  assert.match(src, /FACE_STAGE_HOLD_MS = 2800/);
  assert.match(src, /FACE_ENROLL_HOLD_MS = 5000/);
  const clientSrc = fs.readFileSync(path.join(process.cwd(), 'public', 'face.js'), 'utf8');
  assert.match(clientSrc, /FACE_FRONT_TOLERANCE = 0\.13/);
  assert.match(clientSrc, /FACE_SIDE_THRESHOLD = 0\.16/);
  assert.match(src, /FACE_ENROLL_HOLD_MS = 5000/);
  assert.match(src, /FACE_UNLOCK_SIMILARITY_MIN = 0.2/);
});

test('tiga kegagalan Face Recognition memicu Security Alert CRITICAL', async () => {
  const { db, face, alert } = await buildStack();
  const actor = { id: 1, name: 'Admin KMH', roles: 'admin' };
  for (let i = 0; i < 3; i++) {
    const n = await face.registerFailure(actor, 'simulasi gagal #' + (i + 1));
    assert.equal(n, i + 1);
  }
  const events = await db.find('security_events', {});
  const critical = events.find((e) => e.rule_id === 'FACE_LOCKOUT');
  assert.ok(critical, 'harus ada event FACE_LOCKOUT');
  assert.equal(critical.severity, 'critical');
  assert.equal(critical.category, 'biometric_failure');
});

test('urutan acak memakai fungsi shuffleStages tanpa mengubah himpunan asal', () => {
  const out = shuffleStages(['a', 'b', 'c']);
  assert.equal(out.length, 3);
  assert.deepEqual([...out].sort(), ['a', 'b', 'c']);
});

test('pembukaan brankas mencatat event keamanan dan notifikasi menu Notifikasi', async () => {
  const { db, alert, envelope } = await buildStack();
  const vault = createVault({ db, envelope, biometric: null, alert });
  const actor = { id: 15, name: 'Investor KMH', roles: 'pendana', ip: '127.0.0.1' };
  await vault.recordUnlock(actor, { method: 'face-recognition', scope: 'vault', records: 560, path: '/api/face/unlock/verify' });
  const events = await db.find('security_events', { rule_id: 'VAULT_UNLOCK' });
  assert.equal(events.length, 1, 'event VAULT_UNLOCK harus tercatat pada log keamanan');
  assert.equal(events[0].category, 'vault_access');
  assert.equal(events[0].actor_id, actor.id);
  const notes = await db.find('notifications', { user_id: actor.id });
  assert.equal(notes.length, 1, 'notifikasi buka brankas harus muncul di menu Notifikasi');
  assert.match(String(notes[0].title), /Brankas Data Nominatif/);
  assert.match(String(notes[0].body), /Face Recognition/);
  const audits = await db.find('audit_logs', { action: 'vault_unlock' });
  assert.equal(audits.length, 1, 'jejak audit vault_unlock harus tercatat');
});

test('rute buka kunci biometrik memanggil pencatatan akses brankas', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server', 'security-routes.js'), 'utf8');
  assert.match(src, /vault\.recordUnlock/);
  const vaultSrc = fs.readFileSync(path.join(process.cwd(), 'server', 'vault.js'), 'utf8');
  assert.match(vaultSrc, /rule_id: 'VAULT_UNLOCK'/);
  assert.match(vaultSrc, /recordUnlock/);
});

test('kode 2FA salah membuat notifikasi keamanan dan event log firewall', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server', 'index.js'), 'utf8');
  assert.match(src, /Peringatan Keamanan: Percobaan verifikasi 2FA Google Authenticator gagal/);
  assert.match(src, /rule_id: critical \? 'TOTP_LOCKOUT' : 'TOTP_FAIL'/);
  assert.match(src, /await db\.insert\('notifications'/);
  const faceSrc = fs.readFileSync(path.join(process.cwd(), 'server', 'face.js'), 'utf8');
  assert.match(faceSrc, /Biometrik Terdaftar/);
  assert.match(faceSrc, /BIOMETRIC_ENROLLED/);
});
