import crypto from 'node:crypto';
import { tokenHash } from './los-import.js';
import { VAULT_TOTAL_DANA, VAULT_LOS_KONTRAK } from '../public/shared/constants.js';

const nowIso = () => new Date().toISOString();
const DUMMY_NIK = '3273010101900001';

export function createVault(options = {}) {
  const db = options.db;
  const envelope = options.envelope;
  const biometric = options.biometric;
  const alert = options.alert;
  const logger = options.logger || console;

  function userAad(userId, field) {
    return ['kmh', 'user', String(userId), field].join('|');
  }

  function recordAad(refType, refId, field) {
    return ['kmh', 'vault', String(refType), String(refId), field].join('|');
  }

  function losAad(losCode, field) {
    return ['kmh', 'los', String(losCode), field].join('|');
  }

  function losAad560(idPengajuan, field) {
    return ['kmh', 'los560', String(idPengajuan), field].join('|');
  }

  function maskName(name) {
    return String(name || '-').split(/\s+/).map((p) => (p ? p[0] + '.' : '')).join(' ');
  }

  async function encryptFields(obj, aadFn) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = await envelope.encryptField(v === null || v === undefined ? '' : String(v), aadFn(k));
    }
    return out;
  }

  async function decryptFields(obj, aadFn) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      try {
        out[k] = await envelope.decryptField(v, aadFn(k));
      } catch {
        out[k] = '';
      }
    }
    return out;
  }

  function preview(value) {
    if (!value) return '-';
    const raw = String(value);
    return raw.slice(0, 22) + '…' + raw.slice(-8);
  }

  async function buildRecords() {
    const users = await db.find('users', {});
    const financings = await db.find('financings', {});
    const fundings = await db.find('fundings', {});
    const dists = await db.find('distributions', {});
    const schedules = await db.find('schedules', {});

    const dummyCities = ['Bandung - Dago', 'Bandung - Coblong', 'Bandung - Sukajadi', 'Bandung - Cibeunying', 'Bandung - Antapani', 'Sumedang - Kota Sumedang', 'Garut - Tarogong Kidul', 'Tasikmalaya - Kota Tasikmalaya'];
    const keyVersion = envelope.info().key_version;
    for (const [idx, u] of users.entries()) {
      const patch = {};
      const rotated = u.enc_key_version !== keyVersion;
      if (!u.nik_enc || rotated) patch.nik_enc = await envelope.encryptField(DUMMY_NIK, userAad(u.id, 'nik'));
      if (u.bank_account && (!u.bank_account_enc || rotated)) patch.bank_account_enc = await envelope.encryptField(u.bank_account, userAad(u.id, 'bank_account'));
      if (!u.address) patch.address = 'Jalan Dummy No. ' + (idx + 1) + ', ' + (dummyCities[idx % dummyCities.length] || 'Bandung');
      if (patch.address && (!u.address_enc || rotated)) patch.address_enc = await envelope.encryptField(patch.address, userAad(u.id, 'address'));
      if (rotated) patch.enc_key_version = keyVersion;
      if (Object.keys(patch).length) await db.update('users', u.id, patch);
    }

    const built = { members: 0, financings: 0, los: 0 };

    for (const u of users.filter((x) => String(x.roles || '').split(',').includes('pendana') || String(x.roles || '').split(',').includes('penerima'))) {
      const mine = fundings.filter((f) => f.investor_type === 'member' && Number(f.investor_id) === Number(u.id) && f.status !== 'released');
      const totalModal = mine.reduce((a, f) => a + Number(f.amount || 0), 0);
      const totalProfit = dists.filter((d) => Number(d.wallet_id) === Number(u.wallet_id)).reduce((a, d) => a + Number(d.profit || 0), 0);
      const payload = {
        nama: u.name || '',
        nik: DUMMY_NIK,
        nomor_rekening: u.bank_account || '-',
        bank: u.bank_name || '-',
        alamat: u.address || '-',
        nilai_penempatan: String(totalModal),
        total_bagi_hasil: String(totalProfit),
        status_kyc: u.kyc_status || '-',
        nomor_anggota: u.member_no || '-',
      };
      const enc = await encryptFields(payload, (f) => recordAad('member', u.id, f));
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const ex = await db.one('nominative_records', { ref_type: 'member', ref_id: u.id });
      if (ex) {
        if (ex.fingerprint !== fingerprint || ex.key_version !== keyVersion) {
          await db.update('nominative_records', ex.id, { enc_payload: JSON.stringify(enc), fingerprint, key_version: keyVersion, subject_mask: maskName(u.name), updated_at: nowIso() });
        }
      } else {
        await db.insert('nominative_records', {
          ref_type: 'member',
          ref_id: u.id,
          code: u.member_no || String(u.id),
          subject_mask: maskName(u.name),
          enc_payload: JSON.stringify(enc),
          fingerprint,
          key_version: envelope.info().key_version,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        built.members += 1;
      }
    }

    for (const f of financings) {
      const borrower = users.find((u) => Number(u.id) === Number(f.borrower_id));
      const first = schedules.find((s) => Number(s.financing_id) === Number(f.id));
      const payload = {
        kode: f.code || '',
        nama_penerima: borrower ? borrower.name : '-',
        pokok: String(f.principal || 0),
        ujrah: String(f.ujrah || 0),
        tenor: String(f.tenor || 0),
        angsuran: first ? String(Number(first.principal_due || 0) + Number(first.ujrah_due || 0)) : '0',
        status: f.status || '-',
        tujuan: f.purpose || '',
        penjamin: f.guarantor_name || '-',
      };
      const enc = await encryptFields(payload, (fld) => recordAad('financing', f.id, fld));
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const ex = await db.one('nominative_records', { ref_type: 'financing', ref_id: f.id });
      if (ex) {
        if (ex.fingerprint !== fingerprint || ex.key_version !== keyVersion) {
          await db.update('nominative_records', ex.id, { enc_payload: JSON.stringify(enc), fingerprint, key_version: keyVersion, subject_mask: maskName(payload.nama_penerima), updated_at: nowIso() });
        }
      } else {
        await db.insert('nominative_records', {
          ref_type: 'financing',
          ref_id: f.id,
          code: f.code || String(f.id),
          subject_mask: maskName(payload.nama_penerima),
          enc_payload: JSON.stringify(enc),
          fingerprint,
          key_version: envelope.info().key_version,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        built.financings += 1;
      }
    }

    const losSeeds = [
      ['LOS-KMH-2026-0001', 'KMH-0101', 'Ani Rahmawati', '7012345601', 'BSI', 'Bandung - Dago', 'KSM-UMUM', 13500000, 1266750],
      ['LOS-KMH-2026-0002', 'KMH-0102', 'Bayu Pratama', '7012345602', 'BSI', 'Bandung - Coblong', 'KSM-UMUM', 7500000, 703750],
      ['LOS-KMH-2026-0003', 'KMH-0103', 'Citra Lestari', '7012345603', 'BSI', 'Bandung - Sukajadi', 'KSM-UMUM', 6000000, 563000],
      ['LOS-KMH-2026-0004', 'KMH-0104', 'Dimas Hidayat', '7012345604', 'BSI', 'Sumedang', 'KSM-UMUM', 8000000, 400000],
      ['LOS-KMH-2026-0005', 'KMH-0105', 'Gita Permata', '7012345605', 'BSI', 'Bandung - Cibeunying', 'KSM-UMUM', 5000000, 250000],
      ['LOS-KMH-2026-0006', 'KMH-0106', 'Hendra Wijaya', '7012345606', 'Bank Muamalat', 'Bandung - Sukajadi', 'KSM-MUAMALAT', 10000000, 500000],
    ];
    const hasRealLos = (await db.find('los_records', {}, { limit: 1 })).length > 0;
    if (hasRealLos) return { members: built.members, financings: built.financings, los: 0, los_fallback: 0 };
    for (const [code, memberCode, name, account, bank, alamat, product, principal, installment] of losSeeds) {
      const ex = await db.one('nominative_los_records', { los_code: code });
      const payload = {
        los_code: code,
        nomor_anggota: memberCode,
        nama: name,
        nik: DUMMY_NIK,
        nomor_rekening: account,
        bank,
        alamat,
        produk: product,
        pokok: String(principal),
        angsuran: String(installment),
        status_akun: 'AKTIF',
      };
      const enc = await encryptFields(payload, (f) => losAad(code, f));
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      if (ex) {
        if (ex.fingerprint !== fingerprint || ex.key_version !== keyVersion) {
          await db.update('nominative_los_records', ex.id, { enc_payload: JSON.stringify(enc), fingerprint, key_version: keyVersion, updated_at: nowIso() });
        }
      } else {
        await db.insert('nominative_los_records', {
          los_code: code,
          member_code: memberCode,
          enc_payload: JSON.stringify(enc),
          fingerprint,
          key_version: envelope.info().key_version,
          created_at: nowIso(),
          updated_at: nowIso(),
        });
        built.los += 1;
      }
    }
    return built;
  }

  async function status(actor, session) {
    const info = envelope.info();
    const [members, fins, los, creds, faces] = await Promise.all([
      db.find('nominative_records', { ref_type: 'member' }),
      db.find('nominative_records', { ref_type: 'financing' }),
      db.find('nominative_los_records', {}),
      db.find('webauthn_credentials', { user_id: actor.id }),
      db.find('face_profiles', { user_id: actor.id }),
    ]);
    return {
      locked: !session || !session.valid,
      session: session && session.valid ? { method: session.method, scope: session.scope, expires_at: session.expires_at } : null,
      encryption: {
        algorithm: info.algorithm,
        provider: info.provider,
        kms_ready: info.kms_ready,
        kms_key_id: info.kms_key_id,
        key_version: info.key_version,
        local_vault_ready: info.local_vault_ready,
        envelope_ready: info.envelope_ready,
        aad_scheme: info.aad_scheme,
        aws_kms_ready_label: 'AWS KMS Envelope Encryption Ready',
      },
      counts: {
        member_records: members.length,
        financing_records: fins.length,
        los_records: los.length,
        total_records: members.length + fins.length + los.length,
      },
      biometric_devices: creds.filter((c) => !c.revoked_at).length + faces.filter((f) => !f.revoked_at).length,
      enrolled: creds.filter((c) => !c.revoked_at).length + faces.filter((f) => !f.revoked_at).length > 0,
      face_devices: faces.filter((f) => !f.revoked_at).length,
      webauthn_devices: creds.filter((c) => !c.revoked_at).length,
    };
  }

  async function listRecords(actor, session) {
    const unlocked = Boolean(session && session.valid);
    const rows = await db.find('nominative_records', {}, { orderBy: ['ref_type', 'asc'] });
    const losRows = await db.find('nominative_los_records', {}, { orderBy: ['los_code', 'asc'] });
    const out = [];
    for (const r of rows) {
      const enc = JSON.parse(r.enc_payload || '{}');
      if (unlocked) {
        const plain = await decryptFields(enc, (f) => recordAad(r.ref_type, r.ref_id, f));
        out.push({
          group: r.ref_type === 'member' ? 'ANGGOTA' : 'PEMBIAYAAN',
          code: r.code,
          subject: plain.nama || plain.kode || r.subject_mask,
          nik: plain.nik || '-',
          nomor_rekening: plain.nomor_rekening || '-',
          bank: plain.bank || '-',
          alamat: plain.alamat || '-',
          nilai: plain.nilai_penempatan || plain.pokok || '0',
          nilai_lain: plain.total_bagi_hasil || plain.angsuran || '-',
          status: plain.status || plain.status_kyc || '-',
          locked: false,
        });
      } else {
        out.push({
          group: r.ref_type === 'member' ? 'ANGGOTA' : 'PEMBIAYAAN',
          code: r.code,
          subject: r.subject_mask,
          nik: preview(enc.nik),
          nomor_rekening: preview(enc.nomor_rekening),
          bank: preview(enc.bank),
          alamat: preview(enc.alamat),
          nilai: preview(enc.nilai_penempatan || enc.pokok),
          nilai_lain: preview(enc.total_bagi_hasil || enc.angsuran),
          status: 'TERKUNCI',
          locked: true,
        });
      }
    }
    for (const r of losRows) {
      const enc = JSON.parse(r.enc_payload || '{}');
      if (unlocked) {
        const plain = await decryptFields(enc, (f) => losAad(r.los_code, f));
        out.push({
          group: 'LOS',
          code: r.los_code,
          subject: plain.nama,
          nik: plain.nik,
          nomor_rekening: plain.nomor_rekening,
          bank: plain.bank,
          alamat: plain.alamat,
          nilai: plain.pokok,
          nilai_lain: plain.angsuran,
          status: plain.status_akun,
          locked: false,
        });
      } else {
        out.push({
          group: 'LOS',
          code: r.los_code,
          subject: r.member_code,
          nik: preview(enc.nik),
          nomor_rekening: preview(enc.nomor_rekening),
          bank: preview(enc.bank),
          alamat: preview(enc.alamat),
          nilai: preview(enc.pokok),
          nilai_lain: preview(enc.angsuran),
          status: 'TERKUNCI',
          locked: true,
        });
      }
    }
    return out;
  }

  async function recordUnlock(actor, info = {}) {
    const method = String(info.method || 'face-recognition');
    const metode = method === 'face-recognition' ? 'Face Recognition' : 'Sidik Jari / Passkey';
    const scope = String(info.scope || 'vault');
    const records = Number(info.records || 0);
    const path = String(info.path || '/api/vault/unlock');
    await alert.emit({
      severity: 'low',
      rule_id: 'VAULT_UNLOCK',
      rule_name: 'Akses Brankas Data Nominatif dibuka',
      category: 'vault_access',
      action: 'log',
      method: 'POST',
      path,
      ip: actor.ip || '-',
      actor_id: actor.id ?? null,
      actor_name: actor.name || '',
      user_agent: actor.user_agent || '',
      evidence: { method, scope, records, total: VAULT_TOTAL_DANA, los_contracts: VAULT_LOS_KONTRAK },
    });
    await db.insert('notifications', {
      user_id: actor.id,
      title: 'Akses Brankas Data Nominatif dibuka',
      body: 'Brankas Data Nominatif berhasil dibuka menggunakan ' + metode + '. Rincian data tampil dan akses ditutup otomatis setelah batas waktu berakhir.',
      link: 'brankas',
      read: 0,
      created_at: new Date().toISOString(),
    });
    await db.tx((t) => t.insert('audit_logs', {
      actor_id: actor.id,
      actor_name: actor.name,
      action: 'vault_unlock',
      entity: 'nominative_vault',
      entity_id: null,
      detail: JSON.stringify({ method, scope, records, total: VAULT_TOTAL_DANA, los_contracts: VAULT_LOS_KONTRAK, ip: actor.ip || '-' }),
      created_at: nowIso(),
    }));
    return { method, scope, records };
  }

  async function unlock(actor, token) {
    const session = await biometric.verifyStepUp(token, 'vault');
    if (!session.valid) throw new Error('Verifikasi biometrik tidak valid: ' + session.reason);
    const rows = await listRecords(actor, session);
    await recordUnlock(actor, { method: session.method, scope: session.scope, records: rows.length, path: '/api/vault/unlock' });
    await db.tx((t) => {
      return t.update('users', actor.id, { vault_accepted_at: new Date().toISOString(), vault_total: VAULT_TOTAL_DANA });
    });
    return { session, records: rows, unlocked_at: nowIso() };
  }

  async function lock(actor, tokenId) {
    if (tokenId) await biometric.revokeSession(tokenId, actor);
    else {
      const sess = await biometric.listSessions(actor.id);
      const active = sess.find((s) => s.active);
      if (active) await biometric.revokeSession(active.id, actor);
    }
    return true;
  }

  async function columnStatus(actor) {
    const rows = await db.find('users', {}, { orderBy: ['id', 'asc'] });
    return rows.map((u) => ({
      member_no: u.member_no,
      name_masked: maskName(u.name),
      nik_enc: preview(u.nik_enc),
      bank_account_enc: preview(u.bank_account_enc),
      address_enc: preview(u.address_enc),
      encrypted: Boolean(u.nik_enc && u.bank_account_enc),
    }));
  }

  async function losCounts() {
    const total = (await db.find('los_records', {}, { limit: 2000 })).length;
    const rows = await db.find('los_records', {}, { limit: 2000 });
    const byGender = {};
    const bySourceStatus = {};
    let active = 0;
    for (const r of rows) {
      const g = String(r.gender || '-');
      byGender[g] = (byGender[g] || 0) + 1;
      const s = String(r.source_loan_status || '-');
      bySourceStatus[s] = (bySourceStatus[s] || 0) + 1;
      if (r.is_active) active += 1;
    }
    return { total: rows.length || total, active, by_gender: byGender, by_source_status: bySourceStatus };
  }

  async function listLosRecords(options = {}) {
    const { session, search = '', gender = '', sourceStatus = '', page = 1, size = 25 } = options;
    const unlocked = Boolean(session && session.valid);
    const limit = Math.min(Math.max(Number(size || 25), 1), 200);
    const currentPage = Math.max(Number(page || 1), 1);
    const rows = await db.find('los_records', {}, { orderBy: ['seq_no', 'asc'] });
    const needle = String(search || '').trim();
    const needleHash = needle ? tokenHash(needle) : null;
    const needleParts = needle ? needle.toLowerCase().split(/[\s@.+-]+/).filter((x) => x.length >= 3).map(tokenHash) : [];
    let filtered = rows;
    if (gender) filtered = filtered.filter((r) => String(r.gender || '-') === gender);
    if (sourceStatus) filtered = filtered.filter((r) => String(r.source_loan_status || '-') === sourceStatus);
    if (needleHash) {
      filtered = filtered.filter((r) => {
        if (String(r.id_pengajuan || '').toLowerCase().includes(needle.toLowerCase())) return true;
        if (String(r.loan_code || '').toLowerCase().includes(needle.toLowerCase())) return true;
        if (String(r.source_id || '').toLowerCase() === needle.toLowerCase()) return true;
        const tokens = JSON.parse(r.search_tokens || '[]');
        if (tokens.includes(needleHash)) return true;
        return needleParts.length > 0 && needleParts.every((h) => tokens.includes(h));
      });
    }
    const total = filtered.length;
    const start = (currentPage - 1) * limit;
    const pageRows = filtered.slice(start, start + limit);
    const out = [];
    for (const r of pageRows) {
      const enc = JSON.parse(r.enc_payload || '{}');
      if (unlocked) {
        const plain = await decryptFields(enc, (f) => losAad560(r.id_pengajuan, f));
        out.push({
          id_pengajuan: r.id_pengajuan,
          seq_no: r.seq_no,
          source_id: r.source_id,
          full_name: plain.full_name || '-',
          email_address: plain.email_address || '-',
          phone_number: plain.phone_number || '-',
          identification_number: plain.identification_number || '-',
          gender: r.gender || '-',
          place_of_birth: plain.place_of_birth || '-',
          date_of_birth: plain.date_of_birth || '-',
          loan_code: r.loan_code || '-',
          loan_status: r.loan_status,
          active_badge: r.active_badge,
          is_active: Boolean(r.is_active),
          ntf_total: r.ntf_total || '-',
          installment_real: r.installment_real || '-',
          lender_id: r.lender_id || '-',
          created_at_src: r.created_at_src || '-',
          updated_at_src: r.updated_at_src || '-',
          locked: false,
        });
      } else {
        out.push({
          id_pengajuan: r.id_pengajuan,
          seq_no: r.seq_no,
          source_id: r.source_id,
          full_name: preview(enc.full_name),
          email_address: preview(enc.email_address),
          phone_number: preview(enc.phone_number),
          identification_number: preview(enc.identification_number),
          gender: r.gender || '-',
          place_of_birth: preview(enc.place_of_birth),
          date_of_birth: preview(enc.date_of_birth),
          loan_code: r.loan_code || '-',
          loan_status: r.loan_status,
          active_badge: r.active_badge,
          is_active: Boolean(r.is_active),
          ntf_total: r.ntf_total || '-',
          installment_real: r.installment_real || '-',
          lender_id: r.lender_id || '-',
          created_at_src: r.created_at_src || '-',
          updated_at_src: r.updated_at_src || '-',
          locked: true,
        });
      }
    }
    return {
      rows: out,
      locked: !unlocked,
      total,
      page: currentPage,
      size: limit,
      pages: Math.max(Math.ceil(total / limit), 1),
    };
  }

  return { buildRecords, status, listRecords, listLosRecords, losCounts, unlock, lock, columnStatus, recordUnlock, DUMMY_NIK };
}
