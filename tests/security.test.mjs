import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createMemDb } from '../public/shared/memdb.js';
import { createServices } from '../public/shared/services.js';
import { seedDemo } from '../public/shared/seed.js';
import { createEnvelope } from '../server/crypto-envelope.js';
import { createSecurityAlert } from '../server/security-alert.js';
import { createWaf } from '../server/waf.js';
import { createBiometric, cosine } from '../server/biometric.js';
import { createFaceRecognition } from '../server/face.js';
import { createVault } from '../server/vault.js';
import { verifyWebhookSignature } from '../server/index.js';

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
  const waf = createWaf({ db, alert, config: { trustProxyHops: 0, bruteForceMax: 3 } });
  await waf.setMode('block');
  const envelope = createEnvelope({ masterSecret: 'kunci-uji-lokal-yang-panjang-sekali-1234567890' });
  await envelope.init();
  return { db, alert, waf, envelope };
}

function fakeReq(url, body, ip = '203.0.113.9') {
  return {
    method: 'POST',
    url,
    originalUrl: url,
    ip,
    headers: { 'user-agent': 'node-test/1.0', host: 'localhost:3000' },
    body,
    params: {},
  };
}

test('11 uji alur lama tetap lulus 100 persen', () => {
  const res = spawnSync(process.execPath, ['tests/flow.test.mjs'], { encoding: 'utf8', cwd: process.cwd() });
  const combined = String(res.stdout || '') + String(res.stderr || '');
  assert.equal(res.status, 0, 'uji alur lama harus keluar dengan status 0');
  assert.match(combined, /pass 11/);
  assert.doesNotMatch(combined, /fail [1-9]/);
});

test('tanda tangan webhook salah ditolak dan yang benar diterima', () => {
  const secret = 'rahasia-webhook-uji';
  const raw = Buffer.from(JSON.stringify({ transaction_id: 'X-1', va_number: '8808100000001', amount: 1000 }), 'utf8');
  const good = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(verifyWebhookSignature(raw, good, secret), true);
  assert.equal(verifyWebhookSignature(raw, 'deadbeef', secret), false);
  assert.equal(verifyWebhookSignature(raw, '', secret), false);
  assert.equal(verifyWebhookSignature(Buffer.from('{\"a\":2}'), good, secret), false);
  assert.equal(verifyWebhookSignature(raw, good, 'rahasia-lain'), false);
});

test('WAF memblokir payload SQL injection dan mencatat ke security_events', async () => {
  const { db, waf, alert } = await buildStack();
  const req = fakeReq('/api/rpc/createApplication', { purpose: "x'; DROP TABLE ledger_lines; --" });
  const verdict = await waf.rpcGuard('createApplication', req.body, { id: 5, name: 'Dodi', roles: 'penerima' }, req);
  assert.equal(verdict.action, 'block');
  assert.equal(verdict.hits[0].rule_id, 'W1');
  const events = await db.find('security_events', {});
  assert.ok(events.length >= 1, 'peristiwa keamanan harus tercatat');
  assert.equal(events[0].rule_id, 'W1');
  assert.equal(events[0].category, 'sql_injection');
  assert.equal(events[0].action, 'block');
  const notes = await db.find('notifications', {});
  assert.ok(notes.length >= 1, 'notifikasi in-app harus terbentuk');
  const audits = await db.find('audit_logs', {});
  assert.ok(audits.some((a) => a.action === 'security_alert'));
  const summary = await alert.summary();
  assert.ok(summary.total >= 1);
});

test('WAF memblokir payload XSS tersimpan dan path traversal', async () => {
  const { db, waf } = await buildStack();
  const xss = fakeReq('/api/rpc/createApplication', { purpose: '<script>fetch("https://evil.tld")</script>' });
  const v1 = await waf.rpcGuard('createApplication', xss.body, { id: 5, name: 'Dodi', roles: 'penerima' }, xss);
  assert.equal(v1.action, 'block');
  assert.equal(v1.hits[0].rule_id, 'W2');

  const trav = fakeReq('/api/kyc/../../etc/passwd', {});
  const v2 = await waf.rpcGuard('getFinancing', trav.body, { id: 5, name: 'Dodi', roles: 'penerima' }, trav);
  assert.equal(v2.action, 'block');
  assert.ok(v2.hits.some((h) => h.rule_id === 'W3'));

  const events = await db.find('security_events', {});
  assert.ok(events.some((e) => e.rule_id === 'W2'));
  assert.ok(events.some((e) => e.rule_id === 'W3'));
});

test('WAF memblokir mass assignment dan mendeteksi probe PHP2Shell', async () => {
  const { db, waf } = await buildStack();
  const req = fakeReq('/api/rpc/updateProfile', { name: 'Budi', roles: 'admin', kyc_status: 'approved' });
  const verdict = await waf.rpcGuard('updateProfile', req.body, { id: 7, name: 'Budi', roles: 'finance' }, req);
  assert.equal(verdict.action, 'block');
  assert.equal(verdict.hits[0].rule_id, 'W8');

  const probe = fakeReq('/index.php', { probe: 'auto_prepend_file=php:' + String.fromCharCode(47, 47) + 'input' });
  const v2 = await waf.rpcGuard('getFinancing', probe.body, { id: 1, name: 'A', roles: 'pendana' }, probe);
  assert.equal(v2.action, 'block');
  assert.ok(v2.hits.some((h) => h.rule_id === 'W10'));

  const events = await db.find('security_events', {});
  assert.ok(events.some((e) => e.rule_id === 'W8'));
  assert.ok(events.some((e) => e.rule_id === 'W10'));
});

test('mode WAF detect hanya mencatat tanpa memblokir', async () => {
  const { db, waf } = await buildStack();
  await waf.setMode('detect');
  const req = fakeReq('/api/rpc/createApplication', { purpose: "'; DROP TABLE x; --" });
  const verdict = await waf.rpcGuard('createApplication', req.body, { id: 5, name: 'Dodi', roles: 'penerima' }, req);
  assert.notEqual(verdict.action, 'block');
  const events = await db.find('security_events', {});
  assert.ok(events.length >= 1);
  assert.equal(events[0].action, 'log');
});

test('simulasi serangan WAF menghasilkan rundown aturan dan menandai pemblokiran', async () => {
  const { waf } = await buildStack();
  const out = await waf.simulate('sqli', { id: 1, name: 'Admin', roles: 'admin' });
  assert.equal(out.simulation, 'sqli');
  assert.equal(out.blocked, true);
  assert.ok(out.hits.some((h) => h.rule_id === 'W1'));
});

test('envelope encryption AES-256-GCM membalik data dengan benar dan menolak AAD salah', async () => {
  const { envelope } = await buildStack();
  const info = envelope.info();
  assert.equal(info.algorithm, 'AES-256-GCM');
  assert.equal(info.provider, 'local-vault');
  assert.equal(info.envelope_ready, true);
  const payload = { nama: 'Ani Rahmawati', nik: '3273010101900001', saldo: 13500000 };
  const aad = 'kmh|vault|member|7|nama';
  const rec = await envelope.encryptJson(payload, aad);
  assert.ok(!rec.includes('Ani Rahmawati'), 'ciphertext tidak boleh memuat teks asli');
  const back = await envelope.decryptJson(rec, aad);
  assert.deepEqual(back, payload);
  await assert.rejects(() => envelope.decryptJson(rec, 'aad: salah'), /AAD/);
});

test('data nominatif hanya terbuka setelah otorisasi biometrik valid', async () => {
  const { db, envelope, alert } = await buildStack();
  const S = createServices(db, {
    realToday: () => '2026-10-24',
    realNow: () => '2026-10-24T09:00:00.000Z',
    sha256: async (s) => crypto.createHash('sha256').update(s).digest('hex'),
    allowTimeTravel: true,
    allowSimulator: true,
  });
  await seedDemo(db, S);
  const biometricStub = {
    verifyStepUp: async (token, scope) => (token === 'token-valid' && scope === 'vault'
      ? { valid: true, method: 'webauthn', scope: 'vault', expires_at: new Date(Date.now() + 300000).toISOString() }
      : { valid: false, reason: 'token tidak valid' }),
    revokeSession: async () => true,
    listSessions: async () => [],
  };
  const vault = createVault({ db, envelope, biometric: biometricStub, alert });
  const built = await vault.buildRecords();
  assert.ok(built.members > 0, 'record anggota harus terbentuk');
  assert.ok(built.financings > 0, 'record pembiayaan harus terbentuk');
  assert.ok(built.los > 0, 'record LOS harus terbentuk');

  const actor = { id: 1, name: 'Admin KMH', roles: 'admin' };
  const locked = await vault.listRecords(actor, { valid: false });
  assert.ok(locked.length > 0);
  assert.ok(locked.every((r) => r.locked === true), 'semua baris harus terkunci');
  const member = locked.find((r) => r.group === 'ANGGOTA');
  assert.ok(member.nik.includes('…'), 'kolom NIK harus tampil sebagai ciphertext');
  assert.ok(!member.nik.includes('3273010101900001'), 'NIK asli tidak boleh terlihat');

  const unlocked = await vault.listRecords(actor, { valid: true, method: 'webauthn' });
  const plainMember = unlocked.find((r) => r.group === 'ANGGOTA');
  assert.equal(plainMember.locked, false);
  assert.equal(plainMember.nik, '3273010101900001');
  assert.ok(plainMember.nomor_rekening.length > 0);

  await assert.rejects(() => vault.unlock(actor, 'token-palsu'), /tidak valid/);
  const ok = await vault.unlock(actor, 'token-valid');
  assert.equal(ok.records.length, unlocked.length);
  const audits = await db.find('audit_logs', {});
  assert.ok(audits.some((a) => a.action === 'vault_unlock'), 'akses dekripsi harus tercatat di audit_logs');
});

test('kolom terenkripsi Lampiran B terisi pada tabel users', async () => {
  const { db, envelope, alert } = await buildStack();
  const S = createServices(db, {
    realToday: () => '2026-10-24',
    realNow: () => '2026-10-24T09:00:00.000Z',
    sha256: async (s) => crypto.createHash('sha256').update(s).digest('hex'),
    allowTimeTravel: true,
    allowSimulator: true,
  });
  await seedDemo(db, S);
  const biometricStub = { verifyStepUp: async () => ({ valid: false }), revokeSession: async () => true, listSessions: async () => [] };
  const vault = createVault({ db, envelope, biometric: biometricStub, alert });
  await vault.buildRecords();
  const users = await db.find('users', {});
  assert.ok(users.every((u) => Boolean(u.nik_enc)), 'nik_enc harus terisi');
  assert.ok(users.some((u) => Boolean(u.bank_account_enc)), 'bank_account_enc harus terisi');
  assert.ok(users.some((u) => Boolean(u.address_enc)), 'address_enc harus terisi');
  const withBank = users.find((u) => u.bank_account);
  assert.ok(!String(withBank.bank_account_enc).includes(withBank.bank_account), 'rekening asli tidak boleh bocor ke ciphertext');
});

test('Face Recognition menggantikan Retina dan memicu alert kritis setelah tiga kali gagal', async () => {
  const { db, alert } = await buildStack();
  const biometric = createBiometric({
    db,
    alert,
    config: { rpID: 'localhost', origin: 'http://localhost:3000', jwtSecret: 'kunci-uji-yang-panjang-sekali-1234567890', port: 3000 },
  });
  const face = createFaceRecognition({
    db,
    alert,
    config: { rpID: 'localhost', origin: 'http://localhost:3000', jwtSecret: 'kunci-uji-yang-panjang-sekali-1234567890', port: 3000 },
  });
  assert.equal(biometric.enrollRetina, undefined, 'modul retina sudah digantikan Face Recognition');
  assert.equal(typeof face.enrollOptions, 'function');
  assert.equal(typeof face.unlockOptions, 'function');
  const actor = { id: 3, name: 'Budi Santoso', roles: 'finance' };
  const opts = await face.enrollOptions(actor);
  assert.equal(opts.stages.length, 3);
  assert.ok(opts.stages.every((s) => s.hold_ms >= 2000), 'setiap pose ditahan sekitar 2 detik');
  for (let i = 0; i < 3; i++) {
    const n = await face.registerFailure(actor, 'simulasi gagal #' + (i + 1));
    assert.equal(n, i + 1);
  }
  const events = await db.find('security_events', {});
  assert.ok(events.some((e) => e.rule_id === 'FACE_LOCKOUT' && e.severity === 'critical'), 'tiga kali gagal harus memicu alert kritis');
});

test('kesamaan kosinus vektor retina membedakan pola berbeda', () => {
  const a = Array.from({ length: 64 }, (_, i) => Math.cos(i * 0.3));
  const b = Array.from({ length: 64 }, (_, i) => Math.sin(i * 0.7));
  assert.ok(cosine(a, a) > 0.999);
  assert.ok(cosine(a, b) < 0.9);
});

test('token step-up kedaluwarsa atau dicabut tidak diterima', async () => {
  const { db, alert } = await buildStack();
  const biometric = createBiometric({
    db,
    alert,
    config: { jwtSecret: 'kunci-uji-yang-panjang-sekali-1234567890', port: 3000, stepUpTtlMs: 60000, vaultTtlMs: 60000 },
  });
  const actor = { id: 9, name: 'Admin KMH', roles: 'admin' };
  const issued = await biometric.issueStepUp(actor, 'webauthn', 'vault');
  const valid = await biometric.verifyStepUp(issued.token, 'vault');
  assert.equal(valid.valid, true);
  const wrongScope = await biometric.verifyStepUp(issued.token, 'critical-op');
  assert.equal(wrongScope.valid, false);
  const sessions = await biometric.listSessions(actor.id);
  await biometric.revokeSession(sessions[0].id, actor);
  const revoked = await biometric.verifyStepUp(issued.token, 'vault');
  assert.equal(revoked.valid, false);
});
