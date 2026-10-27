import crypto from 'node:crypto';

const ALG = 'AES-256-GCM';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const KEK_INFO = 'kmh-envelope-kek-v1';

const toB64 = (b) => Buffer.from(b).toString('base64');
const fromB64 = (s) => Buffer.from(String(s || ''), 'base64');
const nowIso = () => new Date().toISOString();

export function deriveKek(secret, info = KEK_INFO) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret || ''), 'utf8'), Buffer.alloc(32), Buffer.from(String(info), 'utf8'), KEY_LEN));
}

export function envelopeAad(parts) {
  return Array.isArray(parts) ? parts.join('|') : String(parts || '');
}

export function createEnvelope(options = {}) {
  const masterSecret = String(options.masterSecret || '');
  const awsKeyId = String(options.awsKeyId || '');
  const awsRegion = String(options.awsRegion || 'ap-southeast-1');
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  const kek = masterSecret ? deriveKek(masterSecret) : null;
  let kmsClient = null;
  let kmsReady = false;
  let kmsError = '';
  const provider = awsKeyId ? 'aws-kms' : 'local-vault';
  const keyVersion = awsKeyId
    ? 'aws-kms:' + awsKeyId
    : 'local-vault:' + crypto.createHash('sha256').update(kek || Buffer.alloc(0)).digest('hex').slice(0, 16);

  async function init() {
    if (!awsKeyId) {
      kmsError = 'AWS_KMS_KEY_ID tidak diset; memakai Local Master Key Vault';
      logger.warn('[envelope] ' + kmsError);
      return info();
    }
    try {
      const mod = await import('@aws-sdk/client-kms');
      kmsClient = new mod.KMSClient({ region: awsRegion });
      kmsReady = true;
      kmsError = '';
      logger.info('[envelope] AWS KMS siap, keyId=' + awsKeyId);
    } catch (e) {
      kmsClient = null;
      kmsReady = false;
      kmsError = 'AWS KMS tidak tersedia (' + e.message + '); fallback ke Local Master Key Vault';
      logger.warn('[envelope] ' + kmsError);
    }
    return info();
  }

  function requireKek() {
    if (!kek) throw new Error('ENVELOPE_MASTER_KEY belum diset; enkripsi data nominatif tidak dapat dijalankan');
    return kek;
  }

  async function wrapDek(dek, aad) {
    if (kmsReady && kmsClient) {
      try {
        const mod = await import('@aws-sdk/client-kms');
        const res = await kmsClient.send(new mod.GenerateDataKeyCommand({
          KeyId: awsKeyId,
          EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
          KeySpec: 'AES_256',
          EncryptionContext: { kms: 'kmh', aad: String(aad || '').slice(0, 200) },
        }));
        return {
          provider: 'aws-kms',
          wrapped: toB64(res.CiphertextBlob),
          keyId: awsKeyId,
          dekPlain: Buffer.from(res.Plaintext),
        };
      } catch (e) {
        kmsError = 'GenerateDataKey gagal (' + e.message + '); fallback ke Local Master Key Vault';
        logger.warn('[envelope] ' + kmsError);
      }
    }
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', requireKek(), iv);
    cipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    return {
      provider: 'local-vault',
      wrapped: toB64(Buffer.concat([iv, ct, cipher.getAuthTag()])),
      keyId: keyVersion,
      dekPlain: dek,
    };
  }

  async function unwrapDek(rec, aad) {
    if (rec.key_provider === 'aws-kms') {
      if (!kmsReady || !kmsClient) throw new Error('Kunci AWS KMS tidak dapat dibuka: KMS tidak siap');
      const mod = await import('@aws-sdk/client-kms');
      const res = await kmsClient.send(new mod.DecryptCommand({
        KeyId: rec.key_version,
        CiphertextBlob: fromB64(rec.wrapped_dek),
        EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
        EncryptionContext: { kms: 'kmh', aad: String(aad || '').slice(0, 200) },
      }));
      return Buffer.from(res.Plaintext);
    }
    const blob = fromB64(rec.wrapped_dek);
    const iv = blob.subarray(0, IV_LEN);
    const tag = blob.subarray(blob.length - TAG_LEN);
    const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN);
    const decipher = crypto.createDecipheriv('aes-256-gcm', requireKek(), iv);
    decipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }

  async function encryptBytes(plain, aad) {
    const buf = Buffer.isBuffer(plain) ? plain : Buffer.from(String(plain), 'utf8');
    const dek = crypto.randomBytes(KEY_LEN);
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));
    const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrapped = await wrapDek(dek, aad);
    dek.fill(0);
    return {
      v: 1,
      alg: ALG,
      key_provider: wrapped.provider,
      key_version: wrapped.keyId,
      aad: String(aad || ''),
      iv: toB64(iv),
      tag: toB64(tag),
      ct: toB64(ct),
      wrapped_dek: wrapped.wrapped,
      created_at: nowIso(),
    };
  }

  async function decryptBytes(rec, aad) {
    if (!rec || !rec.ct) throw new Error('Envelope tidak lengkap');
    if (String(rec.aad || '') !== String(aad || '')) throw new Error('AAD envelope tidak cocok; dekripsi ditolak');
    const dek = await unwrapDek(rec, aad);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', dek, fromB64(rec.iv));
      decipher.setAAD(Buffer.from(String(aad || ''), 'utf8'));
      decipher.setAuthTag(fromB64(rec.tag));
      return Buffer.concat([decipher.update(fromB64(rec.ct)), decipher.final()]);
    } finally {
      dek.fill(0);
    }
  }

  async function encryptJson(obj, aad) {
    const rec = await encryptBytes(Buffer.from(JSON.stringify(obj ?? null), 'utf8'), aad);
    return JSON.stringify(rec);
  }

  async function decryptJson(text, aad) {
    let rec;
    try {
      rec = typeof text === 'string' ? JSON.parse(text) : text;
    } catch {
      throw new Error('Envelope rusak: JSON tidak valid');
    }
    const buf = await decryptBytes(rec, aad);
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      throw new Error('Envelope rusak: muatan bukan JSON valid');
    }
  }

  async function encryptField(value, aad) {
    if (value === null || value === undefined || value === '') return '';
    const rec = await encryptBytes(Buffer.from(String(value), 'utf8'), aad);
    return toB64(Buffer.from(JSON.stringify(rec), 'utf8'));
  }

  async function decryptField(value, aad) {
    if (!value) return '';
    const rec = JSON.parse(Buffer.from(String(value), 'base64').toString('utf8'));
    const buf = await decryptBytes(rec, aad);
    return buf.toString('utf8');
  }

  function info() {
    return {
      algorithm: ALG,
      provider,
      kms_ready: kmsReady,
      kms_key_id: awsKeyId || null,
      kms_error: kmsError || null,
      key_version: keyVersion,
      local_vault_ready: Boolean(kek),
      envelope_ready: Boolean(kek) || kmsReady,
      aad_scheme: 'context-bound',
    };
  }

  function previewCipher(text) {
    if (!text) return '';
    const raw = String(text);
    return raw.slice(0, 28) + '…' + raw.slice(-12);
  }

  return {
    init,
    info,
    encryptBytes,
    decryptBytes,
    encryptJson,
    decryptJson,
    encryptField,
    decryptField,
    previewCipher,
    deriveKek,
  };
}
