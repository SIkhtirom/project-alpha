import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LOS_DELIMITER = ';';
export const LOS_BASE_STAMP = '261024-2140';
export const LOS_ACTIVE_STATUS = 'Active';
export const LOS_ACTIVE_BADGE = 'ACTIVE — TERVERIFIKASI LOS';
export const LOS_SOURCE_HEADER = [
  'id', 'full_name', 'email_address', 'phone_number', 'created_at', 'lender_id',
  'identification_number', 'gender', 'place_of_birth', 'date_of_birth', 'loan_code',
  'loan_status', 'ntf_total', 'installment_real', 'created_at',
];
export const LOS_SENSITIVE_FIELDS = ['full_name', 'email_address', 'phone_number', 'identification_number', 'place_of_birth', 'date_of_birth'];

export function parseDelimited(text, delimiter = LOS_DELIMITER) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === delimiter) { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += c;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function cleanHeader(raw) {
  return String(raw || '').replace(/^\uFEFF/, '').trim();
}

export function readLosCsv(csvText) {
  const rows = parseDelimited(String(csvText || ''));
  const cleaned = rows.filter((r) => r.length > 1 || (r.length === 1 && String(r[0]).trim() !== ''));
  if (!cleaned.length) return { header: [], rows: [] };
  const header = cleaned[0].map(cleanHeader);
  const body = cleaned.slice(1).filter((r) => String(r[0] || '').trim() !== '');
  return { header, rows: body };
}

export function normalizeHeaderMap(header) {
  const map = {};
  const seen = {};
  header.forEach((h, i) => {
    const base = cleanHeader(h) || ('kolom_' + (i + 1));
    seen[base] = (seen[base] || 0) + 1;
    const key = seen[base] > 1 ? base + '_' + seen[base] : base;
    map[key] = i;
  });
  return map;
}

export function buildLosId(seq, stamp = LOS_BASE_STAMP) {
  return 'LOA-' + stamp + '-' + String(seq).padStart(3, '0');
}

export function tokenHash(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase()).digest('hex');
}

export function searchTokens(record) {
  const out = [];
  for (const f of ['full_name', 'email_address', 'phone_number', 'identification_number']) {
    const v = String(record[f] || '').trim();
    if (!v) continue;
    out.push(tokenHash(v));
    for (const part of v.toLowerCase().split(/[\s@.+-]+/)) {
      if (part.length >= 3) out.push(tokenHash(part));
    }
  }
  return [...new Set(out)];
}

export function transformLosRow(cells, index, headerMap) {
  const get = (name) => {
    const key = headerMap[name];
    if (key === undefined) return '';
    return String(cells[headerMap[name]] ?? '').trim();
  };
  const sourceId = get('id');
  const idPengajuan = buildLosId(index);
  const originalStatus = get('loan_status');
  const record = {
    id_pengajuan: idPengajuan,
    seq_no: index,
    source_id: sourceId,
    full_name: get('full_name'),
    email_address: get('email_address'),
    phone_number: get('phone_number'),
    created_at_src: get('created_at'),
    lender_id: get('lender_id'),
    identification_number: get('identification_number'),
    gender: get('gender'),
    place_of_birth: get('place_of_birth'),
    date_of_birth: get('date_of_birth'),
    loan_code: get('loan_code'),
    loan_status: LOS_ACTIVE_STATUS,
    source_loan_status: originalStatus,
    ntf_total: get('ntf_total'),
    installment_real: get('installment_real'),
    updated_at_src: headerMap.created_at_2 !== undefined ? String(cells[headerMap.created_at_2] ?? '').trim() : '',
    is_active: 1,
    active_badge: LOS_ACTIVE_BADGE,
  };
  return record;
}

export function losAad(idPengajuan, field) {
  return ['kmh', 'los560', idPengajuan, field].join('|');
}

export async function encryptLosRecord(envelope, record) {
  const payload = {};
  for (const f of LOS_SENSITIVE_FIELDS) payload[f] = String(record[f] || '');
  const enc = {};
  for (const f of LOS_SENSITIVE_FIELDS) {
    enc[f] = await envelope.encryptField(payload[f], losAad(record.id_pengajuan, f));
  }
  return JSON.stringify(enc);
}

export async function importLosCsv(options = {}) {
  const { db, envelope, csvText, csvPath, logger = console, stamp = LOS_BASE_STAMP } = options;
  let text = csvText;
  let source = 'inline';
  if (!text && csvPath && fs.existsSync(csvPath)) {
    text = fs.readFileSync(csvPath, 'utf8');
    source = csvPath;
  }
  if (!text) return { imported: 0, skipped: 0, total: 0, reason: 'sumber CSV tidak ditemukan' };
  const { header, rows } = readLosCsv(text);
  const headerMap = normalizeHeaderMap(header);
  const keyVersion = envelope.info().key_version;
  let imported = 0;
  let skipped = 0;
  for (const [i, cells] of rows.entries()) {
    const seq = i + 1;
    const record = transformLosRow(cells, seq, headerMap);
    const encPayload = await encryptLosRecord(envelope, record);
    const tokens = searchTokens(record);
    const ex = await db.one('los_records', { id_pengajuan: record.id_pengajuan });
    const row = {
      id_pengajuan: record.id_pengajuan,
      seq_no: record.seq_no,
      source_id: record.source_id,
      gender: record.gender || '-',
      loan_code: record.loan_code,
      loan_status: LOS_ACTIVE_STATUS,
      source_loan_status: record.source_loan_status,
      ntf_total: record.ntf_total,
      installment_real: record.installment_real,
      lender_id: record.lender_id,
      created_at_src: record.created_at_src,
      updated_at_src: record.updated_at_src,
      enc_payload: encPayload,
      search_tokens: JSON.stringify(tokens),
      is_active: 1,
      active_badge: LOS_ACTIVE_BADGE,
      key_version: keyVersion,
      updated_at: new Date().toISOString(),
    };
    if (ex) {
      if (ex.key_version !== keyVersion || ex.source_loan_status !== record.source_loan_status || ex.loan_code !== record.loan_code || ex.ntf_total !== record.ntf_total || ex.gender !== (record.gender || '-')) {
        await db.update('los_records', ex.id, row);
      } else {
        skipped += 1;
        continue;
      }
    } else {
      await db.insert('los_records', { ...row, created_at: new Date().toISOString() });
    }
    imported += 1;
  }
  logger.info('[los-import] sumber=' + source + ' total=' + rows.length + ' diimpor=' + imported + ' dilewati=' + skipped);
  return { imported, skipped, total: rows.length, source, stamp };
}

export function defaultLosCsvPath(root) {
  return path.join(root, '560 DATA.csv');
}

export async function ensureLosDataset(options = {}) {
  const { db, envelope, root, logger = console } = options;
  const csvPath = options.csvPath || defaultLosCsvPath(root);
  if (!fs.existsSync(csvPath)) {
    logger.warn('[los-import] berkas "560 DATA.csv" tidak ditemukan di ' + csvPath + '; dataset LOS kosong');
    return { imported: 0, skipped: 0, total: 0, reason: 'CSV tidak ditemukan' };
  }
  try {
    return await importLosCsv({ db, envelope, csvPath, logger });
  } catch (e) {
    logger.error('[los-import] gagal: ' + e.message);
    return { imported: 0, skipped: 0, total: 0, reason: e.message };
  }
}
