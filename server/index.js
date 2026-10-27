import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as otplib from 'otplib';
import { createKnex, createDb } from './db.js';
import { ensureSchema } from './schema.js';
import { createServices, AppError, rolesOf } from '../public/shared/services.js';
import { seedDemo } from '../public/shared/seed.js';
import { createEnvelope } from './crypto-envelope.js';
import { createSecurityAlert } from './security-alert.js';
import { createWaf, CRITICAL_SERVICES } from './waf.js';
import { createBiometric } from './biometric.js';
import { createVault } from './vault.js';
import { createSecurityRoutes } from './security-routes.js';
import { createFaceRecognition } from './face.js';
import { ensureLosDataset } from './los-import.js';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const DEMO_INVESTOR = {
  email: 'investor@kmh.coop',
  name: 'Investor KMH',
  member_no: 'KMH-0801',
  phone: '08120000801',
  bank_name: 'BSI',
  bank_account: '7012345801',
  bank_holder: 'Investor KMH',
  password: 'KtGZQ54U_2BS_4Uh$ius',
};

const CRITICAL_RPC_TIERS = new Set(['fund', 'signContract', 'approveDisbursement', 'decideWithdrawal', 'claimProtection', 'buyback', 'writeOff', 'committeeVote', 'updateSettings', 'createUser', 'verifyMember', 'setUserActive', 'savePartner', 'recordManualPayment', 'simulatePayment', 'advanceDate']);
const READ_ONLY_RPC_TIERS = new Set(['me', 'getSettings', 'listMarketplace', 'listFinancings', 'getFinancing', 'listMembers', 'listPartners', 'listPayments', 'listVAs', 'listDisbursements', 'listWithdrawals', 'listCollections', 'dashboard', 'trialBalance', 'journals', 'auditLog', 'portfolio', 'walletMutations', 'notifications', 'kmhWallet', 'getContract', 'listFinancing']);
const MAGIC_BYTES = [
  { mime: 'image/jpeg', ext: ['.jpg', '.jpeg'], bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: ['.png'], bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'application/pdf', ext: ['.pdf'], bytes: [0x25, 0x50, 0x44, 0x46] },
];

export function loadConfig(env = process.env) {
  const cfg = {
    port: Number(env.PORT || 3000),
    databaseUrl: env.DATABASE_URL || '',
    sqliteFile: env.SQLITE_FILE || '',
    jwtSecret: env.JWT_SECRET || '',
    cookieSecure: env.COOKIE_SECURE !== 'false',
    vaProvider: env.VA_PROVIDER || 'simulator',
    vaWebhookSecret: env.VA_WEBHOOK_SECRET || '',
    allowSimulator: env.ALLOW_VA_SIMULATOR === 'true',
    allowTimeTravel: env.ALLOW_TIME_TRAVEL === 'true',
    uploadDir: env.UPLOAD_DIR || path.join(ROOT, 'data', 'uploads'),
    adminEmail: env.ADMIN_EMAIL || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    adminName: env.ADMIN_NAME || 'Administrator KMH',
    require2faBackoffice: env.REQUIRE_2FA_BACKOFFICE === 'true',
    timezone: env.TZ_OFFSET_HOURS ? Number(env.TZ_OFFSET_HOURS) : 7,
    trustProxyHops: env.TRUST_PROXY_HOPS ? Number(env.TRUST_PROXY_HOPS) : 0,
    allowedHosts: env.ALLOWED_HOSTS || '',
    allowedOrigins: env.ALLOWED_ORIGINS || '',
    cookieSameSite: env.COOKIE_SAMESITE || 'strict',
    wafMode: env.WAF_MODE || 'block',
    wafThreshold: Number(env.WAF_BLOCK_THRESHOLD || 60),
    webhookIpAllowlist: env.VA_WEBHOOK_IP_ALLOWLIST || '',
    envelopeMasterKey: env.ENVELOPE_MASTER_KEY || '',
    awsKmsKeyId: env.AWS_KMS_KEY_ID || '',
    awsRegion: env.AWS_REGION || 'ap-southeast-1',
    webauthnRpId: env.WEBAUTHN_RP_ID || 'localhost',
    webauthnRpName: env.WEBAUTHN_RP_NAME || 'KMH P2P',
    webauthnOrigin: env.WEBAUTHN_ORIGIN || '',
    stepUpTtlSeconds: Number(env.STEP_UP_TTL_SECONDS || 600),
    vaultTtlSeconds: Number(env.VAULT_TTL_SECONDS || 600),
    requireStepUp: env.REQUIRE_STEP_UP !== 'false',
    requireStepUpStrict: env.REQUIRE_STEP_UP_STRICT === 'true',
    smtpHost: env.SMTP_HOST || '',
    smtpPort: env.SMTP_PORT || '587',
    smtpSecure: env.SMTP_SECURE || '',
    smtpUser: env.SMTP_USER || '',
    smtpPass: env.SMTP_PASS || '',
    smtpFrom: env.SMTP_FROM || '',
    smtpTo: env.SMTP_TO || '',
    whatsappWebhookUrl: env.WHATSAPP_WEBHOOK_URL || '',
    whatsappToken: env.WHATSAPP_TOKEN || '',
    alertEmailMinSeverity: env.SECURITY_ALERT_EMAIL_MIN_SEVERITY || 'high',
    alertWhatsappMinSeverity: env.SECURITY_ALERT_WHATSAPP_MIN_SEVERITY || 'critical',
    bruteForceMax: Number(env.BRUTE_FORCE_MAX || 5),
    loginRateLimit: Number(env.LOGIN_RATE_LIMIT || 10),
    bruteForceWindowMs: Number(env.BRUTE_FORCE_WINDOW_MS || 15 * 60e3),
    otpMax: Number(env.OTP_MAX_ATTEMPTS || 5),
    otpWindowMs: Number(env.OTP_WINDOW_MS || 10 * 60e3),
    otpMaxAttempts: Number(env.OTP_MAX_ATTEMPTS || 3),
    otpChallengeTtlMs: Number(env.OTP_CHALLENGE_TTL_MS || 5 * 60e3),
    faceHoldMs: Number(env.FACE_HOLD_MS || 2600),
    faceMinTotalMs: Number(env.FACE_MIN_TOTAL_MS || 5000),
    faceMaxTotalMs: Number(env.FACE_MAX_TOTAL_MS || 25000),
    losCsvPath: env.LOS_CSV_PATH || '',
  };
  if (!cfg.jwtSecret || cfg.jwtSecret.length < 32) throw new Error('JWT_SECRET wajib diisi minimal 32 karakter');
  if (!cfg.envelopeMasterKey) cfg.envelopeMasterKey = cfg.jwtSecret;
  return cfg;
}

function verifyTotp(secret, token) {
  try {
    const out = otplib.verifySync({ token: String(token || ''), secret: String(secret || '') });
    return Boolean(out && out.valid);
  } catch {
    return false;
  }
}

function detectFileType(head) {
  for (const m of MAGIC_BYTES) {
    if (m.bytes.every((b, i) => head[i] === b)) return m;
  }
  return null;
}

async function ensureUserSecret(db, user) {
  const secret = otplib.generateSecret();
  await db.update('users', user.id, { totp_secret: secret });
  return secret;
}

async function ensureDemoInvestor(db, S) {
  const email = DEMO_INVESTOR.email;
  const existing = await db.one('users', { email });
  if (existing) return { created: false, user: existing };
  const actor = { id: null, name: 'Sistem KMH', roles: 'admin' };
  const user = await S.createUser(actor, {
    name: DEMO_INVESTOR.name,
    email,
    roles: ['pendana'],
    member_no: DEMO_INVESTOR.member_no,
    password_hash: bcrypt.hashSync(DEMO_INVESTOR.password, 10),
    phone: DEMO_INVESTOR.phone,
    bank_name: DEMO_INVESTOR.bank_name,
    bank_account: DEMO_INVESTOR.bank_account,
    bank_holder: DEMO_INVESTOR.bank_holder,
    kyc_status: 'approved',
  });
  console.log('Akun demo investor dibuat: ' + email);
  return { created: true, user };
}

async function ensureTotpSecrets(db) {
  const users = await db.find('users', {});
  let made = 0;
  for (const u of users) {
    if (u.totp_secret) continue;
    await ensureUserSecret(db, u);
    made += 1;
  }
  if (made) console.log('Secret 2FA Google Authenticator dibuat untuk ' + made + ' akun');
  return made;
}

export function verifyWebhookSignature(raw, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const sig = String(signature || '');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export const CORS_ALLOWED_HEADERS = 'Content-Type, Authorization, X-Vault-Token, X-Session-Token, X-KMH-Stepup, Accept';

export function isLocalhostHost(host) {
  return /^127\.0\.0\.1(:\d+)?$/.test(String(host || ''));
}

export function resolveCorsOrigin(origin, host, cfg = {}) {
  const o = String(origin || '').trim();
  if (!o) return '';
  let parsed = null;
  try { parsed = new URL(o); } catch { return ''; }
  if (!parsed || !parsed.hostname) return '';
  const hostname = parsed.hostname.toLowerCase();
  const hostName = String(host || '').split(':')[0].toLowerCase();
  if (hostname === hostName) return o;
  const list = String(cfg.allowedOrigins || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (list.includes(o.toLowerCase()) || list.includes(hostname)) return o;
  const hosts = String(cfg.allowedHosts || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (hosts.includes(hostname)) return o;
  return '';
}

export function tokenFromHeaders(headers = {}, query = {}, url = '') {
  const h = headers || {};
  const auth = String(h.authorization || '');
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const header = String(h['x-session-token'] || '');
  if (header) return header.trim();
  if (String(url || '').includes('/security/stream')) {
    const q = String(query?.token || '');
    if (q) return q.trim();
  }
  return '';
}

export async function createApp(cfg) {
  const knex = createKnex(cfg);
  await ensureSchema(knex);
  const db = createDb(knex);
  const localNow = () => new Date(Date.now() + cfg.timezone * 3600e3);
  const S = createServices(db, {
    realToday: () => localNow().toISOString().slice(0, 10),
    realNow: () => localNow().toISOString(),
    sha256: async (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex'),
    allowTimeTravel: cfg.allowTimeTravel,
    allowSimulator: cfg.allowSimulator,
  });

  const envelope = createEnvelope({
    masterSecret: cfg.envelopeMasterKey,
    awsKeyId: cfg.awsKmsKeyId,
    awsRegion: cfg.awsRegion,
  });
  await envelope.init();

  const alert = createSecurityAlert({
    db,
    config: {
      smtpHost: cfg.smtpHost,
      smtpPort: cfg.smtpPort,
      smtpSecure: cfg.smtpSecure,
      smtpUser: cfg.smtpUser,
      smtpPass: cfg.smtpPass,
      smtpFrom: cfg.smtpFrom,
      smtpTo: cfg.smtpTo,
      whatsappWebhookUrl: cfg.whatsappWebhookUrl,
      whatsappToken: cfg.whatsappToken,
      alertEmailMinSeverity: cfg.alertEmailMinSeverity,
      alertWhatsappMinSeverity: cfg.alertWhatsappMinSeverity,
    },
  });

  const waf = createWaf({
    db,
    alert,
    config: {
      trustProxyHops: cfg.trustProxyHops,
      allowedHosts: cfg.allowedHosts,
      webhookIpAllowlist: cfg.webhookIpAllowlist,
      bruteForceMax: cfg.bruteForceMax,
      bruteForceWindowMs: cfg.bruteForceWindowMs,
      otpMax: cfg.otpMax,
      otpWindowMs: cfg.otpWindowMs,
    },
  });
  if (cfg.wafMode && cfg.wafMode !== 'block') {
    try { await waf.setMode(cfg.wafMode); } catch { }
  }

  const SLASH = String.fromCharCode(47);
  const biometric = createBiometric({
    db,
    alert,
    config: {
      rpName: cfg.webauthnRpName,
      rpID: cfg.webauthnRpId,
      origin: cfg.webauthnOrigin || ('http:' + SLASH + SLASH + 'localhost:' + cfg.port),
      jwtSecret: cfg.jwtSecret,
      port: cfg.port,
      stepUpTtlMs: cfg.stepUpTtlSeconds * 1000,
      vaultTtlMs: cfg.vaultTtlSeconds * 1000,
    },
  });

  const vault = createVault({ db, envelope, biometric, alert });

  const face = createFaceRecognition({
    db,
    alert,
    config: {
      holdMs: cfg.faceHoldMs,
      minTotalMs: cfg.faceMinTotalMs,
      maxTotalMs: cfg.faceMaxTotalMs,
      challengeTtlMs: 20 * 60e3,
    },
  });

  await db.tx(async (t) => {
    for (const type of ['escrow', 'kmh', 'protection']) if (!(await t.one('wallets', { owner_type: type, owner_id: null }))) await t.insert('wallets', { owner_type: type, owner_id: null });
  });
  if (cfg.adminEmail && cfg.adminPassword && !(await db.one('users', { email: cfg.adminEmail.toLowerCase() }))) {
    await db.tx((t) => t.insert('users', {
      member_no: 'STAF-ADMIN', name: cfg.adminName, email: cfg.adminEmail.toLowerCase(), phone: '', password_hash: bcrypt.hashSync(cfg.adminPassword, 12),
      roles: 'admin', kyc_status: 'approved', kyc_note: '', bank_name: '', bank_account: '', bank_holder: '', address: '', totp_secret: null, totp_enabled: 0, active: 1,
      created_at: new Date().toISOString(),
    }));
    console.log(`Admin awal dibuat: ${cfg.adminEmail}`);
  }

  try {
    const built = await vault.buildRecords();
    console.log(`Brankas data nominatif siap: ${built.members} anggota, ${built.financings} pembiayaan, ${built.los} record LOS`);
  } catch (e) {
    console.error('Gagal membangun brankas data nominatif: ' + e.message);
  }

  const losDataset = await ensureLosDataset({
    db,
    envelope,
    root: ROOT,
    csvPath: cfg.losCsvPath || undefined,
  });
  if (losDataset.total) console.log(`Dataset LOS 560: ${losDataset.total} baris (diimpor ${losDataset.imported}, sudah ada ${losDataset.skipped})`);

  await ensureDemoInvestor(db, S);
  await ensureTotpSecrets(db);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxyHops);

  const CORS_HEADERS = CORS_ALLOWED_HEADERS;
  const originAllowed = (origin, host) => Boolean(resolveCorsOrigin(origin, host, cfg));

  app.use((req, res, next) => {
    const origin = String(req.headers.origin || '');
    if (origin && originAllowed(origin, req.headers.host)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use((req, res, next) => {
    const host = String(req.headers.host || '');
    const isApi = req.path.startsWith('/api/');
    if (req.method === 'GET' && !isApi && isLocalhostHost(host)) {
      const port = host.split(':')[1] || String(cfg.port);
      res.redirect(302, 'http:' + SLASH + SLASH + 'localhost:' + port + req.originalUrl);
      return;
    }
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'], frameSrc: ["'none'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
      },
    },
  }));

  app.post('/api/webhooks/va/:provider', express.raw({ type: '*' + SLASH + '*', limit: '256kb' }), async (req, res) => {
    try {
      const provider = req.params.provider;
      if (provider !== cfg.vaProvider) return res.status(404).json({ error: 'Penyedia tidak dikenal' });
      const verdict = await waf.webhookGuard(req);
      if (verdict.action === 'block') {
        return res.status(403).json({ error: 'Permintaan webhook ditolak oleh Application Firewall KMH', code: 'WAF_BLOCK', rule: verdict.hits[0].rule_id });
      }
      if (!cfg.vaWebhookSecret) return res.status(503).json({ error: 'VA_WEBHOOK_SECRET belum diatur' });
      const raw = req.body instanceof Buffer ? req.body : Buffer.from('');
      const sig = String(req.get('x-signature') || '');
      const ok = verifyWebhookSignature(raw, sig, cfg.vaWebhookSecret);
      if (!ok) {
        console.warn(`[keamanan] tanda tangan webhook ${provider} tidak valid dari ${req.ip}`);
        await alert.emit({
          severity: 'critical', rule_id: 'W9', rule_name: 'Tanda tangan webhook tidak valid', category: 'webhook_spoofing', action: 'block',
          method: 'POST', path: req.originalUrl, ip: req.ip, user_agent: req.headers['user-agent'] || '',
          evidence: { provider, signature_length: sig.length },
        });
        return res.status(401).json({ error: 'Tanda tangan tidak valid' });
      }
      const body = JSON.parse(raw.toString('utf8'));
      const payload = mapProviderPayload(provider, body);
      const out = await S.receivePayment(null, { provider, ...payload, raw: body });
      res.json({ ok: true, duplicate: !!out.duplicate, status: out.event?.status });
    } catch (e) {
      console.error('webhook error', e);
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/rpc/')) return next();
    return waf.guard(req, res, next);
  });

  const COOKIE = 'kmh_session';
  const sign = (u) => jwt.sign({ uid: u.id, v: u.password_hash ? u.password_hash.slice(-10) : '' }, cfg.jwtSecret, { expiresIn: '8h' });
  const setCookie = (res, token) => res.cookie(COOKIE, token, { httpOnly: true, sameSite: cfg.cookieSameSite, secure: cfg.cookieSecure, maxAge: 8 * 3600e3 });
  function tokenFromRequest(req) {
    const fromCookie = req.cookies?.[COOKIE];
    if (fromCookie) return String(fromCookie);
    return tokenFromHeaders(req.headers, req.query, req.originalUrl);
  }
  async function actorFrom(req) {
    const token = tokenFromRequest(req);
    if (!token) return null;
    try {
      const p = jwt.verify(token, cfg.jwtSecret);
      const u = await db.get('users', p.uid);
      if (!u || !u.active) return null;
      if ((u.password_hash ? u.password_hash.slice(-10) : '') !== p.v) return null;
      const anomaly = waf.checkSessionAnomaly(token, req.ip);
      if (anomaly) {
        await alert.emit({
          severity: 'high', rule_id: 'W7', rule_name: 'Token sesi dipakai dari alamat IP berbeda', category: 'session_anomaly', action: 'log',
          method: req.method, path: req.originalUrl, ip: req.ip, actor_id: u.id, actor_name: u.name,
          user_agent: req.headers['user-agent'] || '', evidence: { first_ip: anomaly.firstIp, current_ip: anomaly.nowIp },
        });
      }
      return { id: u.id, name: u.name, roles: u.roles, kyc_status: u.kyc_status, email: u.email };
    } catch { return null; }
  }

  const limiterOpts = { standardHeaders: true, legacyHeaders: false, validate: { trustProxy: true, xForwardedForHeader: false } };
  const loginLimiter = rateLimit({ ...limiterOpts, windowMs: 15 * 60e3, limit: cfg.loginRateLimit, skipSuccessfulRequests: true, message: { error: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' } });
  const rpcLimiter = rateLimit({ ...limiterOpts, windowMs: 5 * 60e3, limit: 240, message: { error: 'Terlalu banyak permintaan. Coba lagi sebentar.' } });
  const criticalRpcLimiter = rateLimit({ ...limiterOpts, windowMs: 5 * 60e3, limit: 40, message: { error: 'Terlalu banyak permintaan pada operasi kritis.' } });
  const readRpcLimiter = rateLimit({ ...limiterOpts, windowMs: 5 * 60e3, limit: 900, message: { error: 'Terlalu banyak permintaan baca.' } });
  const otpLimiter = rateLimit({ ...limiterOpts, windowMs: 10 * 60e3, limit: 20, skipSuccessfulRequests: true, message: { error: 'Terlalu banyak percobaan kode autentikator.' } });
  const uploadLimiter = rateLimit({ ...limiterOpts, windowMs: 60 * 60e3, limit: 40, message: { error: 'Batas unggah berkas tercapai.' } });
  const securityLimiter = rateLimit({ ...limiterOpts, windowMs: 60e3, limit: 180, message: { error: 'Terlalu banyak permintaan modul keamanan.' } });
  const tieredRpcLimiter = (req, res, next) => {
    const name = String(req.params?.name || '');
    if (CRITICAL_RPC_TIERS.has(name)) return criticalRpcLimiter(req, res, next);
    if (READ_ONLY_RPC_TIERS.has(name)) return readRpcLimiter(req, res, next);
    return rpcLimiter(req, res, next);
  };

  app.get('/api/health', async (_req, res) => {
    await knex.raw('select 1');
    const mode = await waf.getMode();
    res.json({
      ok: true, mode: 'server', time_travel: cfg.allowTimeTravel, simulator: cfg.allowSimulator,
      waf_mode: mode, envelope: envelope.info(), node: process.version, build: '2.0.0-security',
    });
  });

  app.post('/api/auth/register', loginLimiter, wrapAsync(async (req, res) => {
    const a = req.body || {};
    if (!a.password || String(a.password).length < 8) throw new AppError('Kata sandi minimal 8 karakter');
    const roles = Array.isArray(a.roles) && a.roles.length ? a.roles : ['pendana'];
    const u = await S.register(null, { ...a, roles, password_hash: bcrypt.hashSync(String(a.password), 12) });
    const row = await db.get('users', u.id);
    await ensureUserSecret(db, row);
    res.json({
      ok: true,
      user: {
        id: row.id, name: row.name, email: row.email, member_no: row.member_no,
        roles: String(row.roles || '').split(','), kyc_status: row.kyc_status, totp_enabled: false,
      },
    });
  }));

  app.post('/api/auth/login', loginLimiter, wrapAsync(async (req, res) => {
    const { email, password } = req.body || {};
    const addr = String(email || '').toLowerCase().trim();
    const u = await db.one('users', { email: addr });
    const valid = Boolean(u && u.password_hash && u.active) && bcrypt.compareSync(String(password || ''), u.password_hash);
    if (!valid) {
      const cnt = waf.registerLoginFailure(addr, req.ip);
      if (cnt.byUser >= cfg.bruteForceMax) {
        await alert.emit({
          severity: 'critical', rule_id: 'W5', rule_name: 'Brute force login', category: 'brute_force', action: 'block',
          method: 'POST', path: '/api/auth/login', ip: req.ip, user_agent: req.headers['user-agent'] || '',
          evidence: { email_masked: addr.replace(/^(.).*(@.*)$/, '$1***$2'), attempts_user: cnt.byUser, attempts_ip: cnt.byIp, window_minutes: 15 },
        });
        throw new AppError('Terlalu banyak percobaan gagal. Akun dikunci sementara 15 menit.', 429);
      }
      if (cnt.byIp >= cfg.bruteForceMax * 3) {
        await alert.emit({
          severity: 'critical', rule_id: 'W5', rule_name: 'Brute force login massal', category: 'brute_force', action: 'block',
          method: 'POST', path: '/api/auth/login', ip: req.ip, user_agent: req.headers['user-agent'] || '',
          evidence: { attempts_ip: cnt.byIp, window_minutes: 15 },
        });
        throw new AppError('Permintaan ditolak sementara oleh Firewall (batas percobaan IP tercapai).', 429);
      }
      throw new AppError('Email atau kata sandi salah', 401);
    }
    waf.registerLoginSuccess(addr, req.ip);
    if (u.totp_locked_until && Date.parse(u.totp_locked_until) > Date.now()) {
      await alert.emit({
        severity: 'critical', rule_id: 'TOTP_LOCKOUT', rule_name: 'Masuk diblokir setelah tiga kali kode 2FA salah', category: 'otp_brute_force', action: 'block',
        method: 'POST', path: '/api/auth/login', ip: req.ip, actor_id: u.id, actor_name: u.name,
        user_agent: req.headers['user-agent'] || '', evidence: { locked_until: u.totp_locked_until, fail_count: u.totp_fail_count },
      });
      throw new AppError('Percobaan masuk diblokir sementara karena kode 2FA salah berulang. Coba lagi beberapa menit lagi.', 429);
    }
    const secret = u.totp_secret || await ensureUserSecret(db, u);
    const challenge = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + cfg.otpChallengeTtlMs).toISOString();
    await db.insert('login_challenges', {
      user_id: u.id,
      challenge,
      stage: 'totp',
      attempts: 0,
      ip: req.ip,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      consumed_at: null,
      blocked_at: null,
    });
    const needsSetup = !u.totp_enabled;
    const uri = otplib.generateURI({ issuer: 'KMH P2P', label: u.email, secret });
    const qr = needsSetup ? await QRCode.toDataURL(uri, { margin: 1, width: 240 }) : null;
    await db.tx((t) => t.insert('audit_logs', {
      actor_id: u.id,
      actor_name: u.name,
      action: 'login_stage1_ok',
      entity: 'login_challenge',
      entity_id: null,
      detail: JSON.stringify({ stage: 'totp', expires_at: expiresAt, ip: req.ip, setup_required: needsSetup }),
      created_at: new Date().toISOString(),
    }));
    res.json({
      ok: true,
      need_otp: true,
      challenge,
      expires_at: expiresAt,
      stage: 'totp',
      user: { name: u.name, email: u.email },
      setup_required: needsSetup,
      qr,
      secret: needsSetup ? secret : null,
      otpauth: needsSetup ? uri : null,
    });
  }));

  app.post('/api/auth/2fa/verify', otpLimiter, wrapAsync(async (req, res) => {
    const { challenge, code } = req.body || {};
    const row = await db.one('login_challenges', { challenge: String(challenge || '') });
    if (!row) throw new AppError('Sesi verifikasi tidak ditemukan atau sudah berakhir', 401);
    if (row.blocked_at) throw new AppError('Percobaan masuk diblokir sementara karena terlalu banyak kesalahan kode 2FA', 429);
    if (row.consumed_at) throw new AppError('Sesi verifikasi sudah digunakan', 401);
    if (Date.parse(row.expires_at) < Date.now()) throw new AppError('Sesi verifikasi kedaluwarsa, silakan masuk kembali', 401);
    const u = await db.get('users', row.user_id);
    if (!u || !u.active) throw new AppError('Akun tidak aktif', 401);
    const secret = u.totp_secret || '';
    if (!secret || !verifyTotp(secret, code)) {
      const attempts = Number(u.totp_fail_count || 0) + 1;
      const critical = attempts >= cfg.otpMaxAttempts;
      const lockedUntil = critical ? new Date(Date.now() + 15 * 60e3).toISOString() : null;
      await db.update('users', u.id, { totp_fail_count: attempts, totp_locked_until: lockedUntil });
      await db.update('login_challenges', row.id, { attempts, blocked_at: critical ? new Date().toISOString() : null });
      if (critical) {
        const pendings = await db.find('login_challenges', { user_id: u.id, consumed_at: null });
        for (const p of pendings) await db.update('login_challenges', p.id, { blocked_at: new Date().toISOString() });
      }
      await db.insert('notifications', {
        user_id: u.id,
        title: 'Peringatan Keamanan: Percobaan verifikasi 2FA Google Authenticator gagal',
        body: 'Percobaan verifikasi 2FA Google Authenticator gagal pada akun Anda. Jika bukan Anda, segera ganti kata sandi dan hubungi Admin KMH.',
        link: 'akun',
        read: 0,
        created_at: new Date().toISOString(),
      });
      await alert.emit({
        severity: critical ? 'critical' : 'medium',
        rule_id: critical ? 'TOTP_LOCKOUT' : 'TOTP_FAIL',
        rule_name: critical ? 'Kode 2FA salah ' + attempts + ' kali berturut-turut' : 'Kode 2FA salah',
        category: 'otp_brute_force',
        action: critical ? 'block' : 'log',
        method: 'POST',
        path: '/api/auth/2fa/verify',
        ip: req.ip,
        actor_id: u.id,
        actor_name: u.name,
        user_agent: req.headers['user-agent'] || '',
        evidence: { attempts, locked_until: lockedUntil, setup_required: !u.totp_enabled },
      });
      if (critical) throw new AppError('Kode 2FA salah ' + attempts + ' kali. Masuk diblokir 15 menit dan insiden dicatat di Log Firewall.', 429);
      throw new AppError('Kode 2FA salah. Sisa percobaan: ' + Math.max(0, cfg.otpMaxAttempts - attempts), 401);
    }
    const patch = { totp_fail_count: 0, totp_locked_until: null };
    if (!u.totp_enabled) patch.totp_enabled = 1;
    await db.update('users', u.id, patch);
    await db.update('login_challenges', row.id, { consumed_at: new Date().toISOString(), attempts: 0 });
    await db.tx((t) => t.insert('audit_logs', {
      actor_id: u.id,
      actor_name: u.name,
      action: 'login_stage2_2fa_ok',
      entity: 'login_challenge',
      entity_id: row.id,
      detail: JSON.stringify({ method: 'totp', ip: req.ip, enrolled: !u.totp_enabled }),
      created_at: new Date().toISOString(),
    }));
    const token = sign(u);
    setCookie(res, token);
    res.json({ ok: true, token, user: { name: u.name, email: u.email, roles: rolesOf(u) } });
  }));

  app.post('/api/auth/logout', (_req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });

  app.post('/api/auth/password', wrapAsync(async (req, res) => {
    const actor = await actorFrom(req);
    if (!actor) throw new AppError('Silakan masuk', 401);
    const { current, next } = req.body || {};
    const u = await db.get('users', actor.id);
    if (!bcrypt.compareSync(String(current || ''), u.password_hash || '')) throw new AppError('Kata sandi lama salah');
    if (!next || String(next).length < 8) throw new AppError('Kata sandi baru minimal 8 karakter');
    const hash = bcrypt.hashSync(String(next), 12);
    await db.tx((t) => t.update('users', u.id, { password_hash: hash }));
    const token = sign({ ...u, password_hash: hash });
    setCookie(res, token);
    res.json({ ok: true, token });
  }));

  app.post('/api/auth/2fa/setup', otpLimiter, wrapAsync(async (req, res) => {
    const actor = await actorFrom(req);
    if (!actor) throw new AppError('Silakan masuk', 401);
    const u = await db.get('users', actor.id);
    const secret = otplib.generateSecret();
    await db.tx((t) => t.update('users', u.id, { totp_secret: secret, totp_enabled: 0 }));
    res.json({ secret, otpauth: otplib.generateURI({ issuer: 'KMH P2P', label: u.email, secret }) });
  }));

  app.post('/api/auth/2fa/enable', otpLimiter, wrapAsync(async (req, res) => {
    const actor = await actorFrom(req);
    if (!actor) throw new AppError('Silakan masuk', 401);
    const u = await db.get('users', actor.id);
    if (!u.totp_secret || !verifyTotp(u.totp_secret, req.body?.otp)) throw new AppError('Kode tidak cocok. Periksa jam ponsel dan coba lagi.');
    await db.tx((t) => t.update('users', u.id, { totp_enabled: 1 }));
    res.json({ ok: true });
  }));

  app.use('/api', createSecurityRoutes({ db, waf, alert, biometric, vault, face, envelope, actorFrom, config: cfg, logger: console, wafThreshold: cfg.wafThreshold, securityLimiter }));

  const ALLOWED = new Set(S.__public);
  app.post('/api/rpc/:name', tieredRpcLimiter, wrapAsync(async (req, res) => {
    const name = req.params.name;
    if (!ALLOWED.has(name)) {
      await alert.emit({
        severity: 'low', rule_id: 'W12', rule_name: 'Nama layanan RPC tidak dikenal', category: 'recon', action: 'log',
        method: 'POST', path: req.originalUrl, ip: req.ip, user_agent: req.headers['user-agent'] || '', evidence: { name },
      });
      throw new AppError('Layanan tidak dikenal', 404);
    }
    const actor = await actorFrom(req);
    if (!actor) {
      if (name === 'getSettings') {
        const s = await S.getSettings(null);
        res.json({ ok: true, data: { public: true, authenticated: false, app: 'KMH P2P Syariah', today: s.today, allow_time_travel: s.allow_time_travel, simulator: cfg.allowSimulator } });
        return;
      }
      throw new AppError('Sesi berakhir. Silakan masuk kembali.', 401);
    }
    if (actor && cfg.require2faBackoffice && rolesOf(actor).some((r) => ['analis', 'komite', 'finance', 'manajer', 'admin'].includes(r))) {
      const u = await db.get('users', actor.id);
      if (!u.totp_enabled && !['me', 'getSettings', 'notifications', 'markNotificationsRead', 'updateProfile'].includes(name)) throw new AppError('Aktifkan autentikasi dua langkah di halaman Akun sebelum memakai menu back-office', 403);
    }
    const args = { ...(req.body || {}) };
    const rawArgs = { ...args };
    delete args.password_hash;
    if (name === 'createUser' && args.password) { if (String(args.password).length < 8) throw new AppError('Kata sandi minimal 8 karakter'); args.password_hash = bcrypt.hashSync(String(args.password), 12); delete args.password; }
    if (name === 'signContract') args.ip = req.ip;

    const verdict = await waf.rpcGuard(name, rawArgs, actor, req);
    if (verdict.action === 'block') {
      return res.status(403).json({ error: 'Permintaan ditolak oleh Application Firewall KMH', code: 'WAF_BLOCK', rule: verdict.hits[0].rule_id });
    }

    if (CRITICAL_SERVICES.has(name) && cfg.requireStepUp) {
      const hasCred = Boolean(await db.one('webauthn_credentials', { user_id: actor.id }));
      const token = String(req.headers['x-kmh-stepup'] || '');
      if (hasCred) {
        const step = await biometric.verifyStepUp(token, 'critical-op');
        if (!step.valid) throw new AppError('Operasi kritis memerlukan verifikasi biometrik (step-up auth). Aktifkan biometrik terlebih dahulu.', 403);
      } else if (cfg.requireStepUpStrict) {
        throw new AppError('Belum ada perangkat biometrik terdaftar pada akun Anda. Daftarkan sidik jari atau passkey terlebih dahulu.', 403);
      } else {
        await alert.emit({
          severity: 'low', rule_id: 'STEPUP_POLICY', rule_name: 'Operasi kritis tanpa biometrik terdaftar', category: 'stepup_policy', action: 'log',
          method: 'POST', path: req.originalUrl, ip: req.ip, actor_id: actor.id, actor_name: actor.name,
          user_agent: req.headers['user-agent'] || '', evidence: { service: name },
        });
      }
    }

    const out = await S[name](actor, args);
    res.json({ ok: true, data: out ?? null });
  }));

  fs.mkdirSync(cfg.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 12, parts: 20 },
    fileFilter: (_r, f, cb) => cb(null, ['image/jpeg', 'image/png', 'application/pdf'].includes(f.mimetype)),
  });
  app.post('/api/upload/kyc', uploadLimiter, upload.single('file'), wrapAsync(async (req, res) => {
    const actor = await actorFrom(req);
    if (!actor) throw new AppError('Silakan masuk', 401);
    if (!req.file) throw new AppError('Berkas wajib JPG, PNG, atau PDF maksimal 5 MB');
    const head = Buffer.from(req.file.buffer || []).subarray(0, 8);
    const detected = detectFileType(head);
    if (!detected) {
      await alert.emit({
        severity: 'high', rule_id: 'W4', rule_name: 'Magic byte berkas tidak dikenali', category: 'upload_abuse', action: 'block',
        method: 'POST', path: req.originalUrl, ip: req.ip, actor_id: actor.id, actor_name: actor.name,
        user_agent: req.headers['user-agent'] || '', evidence: { filename: req.file.originalname, declared_mime: req.file.mimetype, head: head.toString('hex') },
      });
      throw new AppError('Isi berkas tidak sesuai format JPG, PNG, atau PDF yang diizinkan', 400);
    }
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext && !detected.ext.includes(ext)) {
      await alert.emit({
        severity: 'high', rule_id: 'W4', rule_name: 'Ekstensi berkas tidak cocok dengan isi', category: 'upload_abuse', action: 'block',
        method: 'POST', path: req.originalUrl, ip: req.ip, actor_id: actor.id, actor_name: actor.name,
        user_agent: req.headers['user-agent'] || '', evidence: { filename: req.file.originalname, extension: ext, detected: detected.mime },
      });
      throw new AppError('Ekstensi berkas tidak cocok dengan isi berkas yang diunggah', 400);
    }
    const storedName = Date.now() + '-' + crypto.randomBytes(8).toString('hex') + detected.ext[0];
    fs.writeFileSync(path.join(cfg.uploadDir, storedName), req.file.buffer);
    const d = await S.addKycDoc(actor, { kind: req.body.kind, filename: req.file.originalname, stored_path: storedName });
    res.json({ ok: true, data: { id: d.id, kind: d.kind, filename: d.filename } });
  }));

  app.get('/api/kyc/:id', wrapAsync(async (req, res) => {
    const actor = await actorFrom(req);
    const d = await db.get('kyc_docs', Number(req.params.id));
    if (!actor || !d) throw new AppError('Tidak ditemukan', 404);
    const allowed = actor.id === d.user_id || rolesOf(actor).some((r) => ['admin', 'analis'].includes(r));
    if (!allowed) throw new AppError('Anda tidak memiliki akses ke dokumen ini', 403);
    const file = path.join(cfg.uploadDir, path.basename(d.stored_path));
    if (!fs.existsSync(file)) throw new AppError('Berkas tidak ditemukan di server', 404);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.download(file, d.filename);
  }));

  app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', maxAge: '1h' }));
  app.use((err, _req, res, _next) => {
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Terjadi kesalahan di server. Hubungi admin.' : err.message });
  });

  const timer = setInterval(() => S.tick().catch((e) => console.error('tick', e)), 15 * 60e3);
  timer.unref();

  return { app, knex, db, S, close: async () => { clearInterval(timer); await knex.destroy(); } };
}

function wrapAsync(fn) {
  return (req, res, next) => fn(req, res, next).catch((e) => {
    const status = e.status || 500;
    if (status >= 500) console.error(e);
    res.status(status).json({ error: status >= 500 ? 'Terjadi kesalahan di server. Hubungi admin.' : e.message });
  });
}

export function mapProviderPayload(provider, b) {
  return {
    external_id: String(b.transaction_id ?? b.external_id ?? b.id ?? ''),
    va_number: String(b.va_number ?? b.account_number ?? b.virtual_account ?? ''),
    amount: Number(b.amount ?? b.paid_amount ?? 0),
    paid_at: b.paid_at ?? b.transaction_timestamp ?? new Date().toISOString(),
  };
}

export { seedDemo };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const { app, S, db } = await createApp(cfg);
  if (process.argv.includes('--seed-los')) {
    const out = await ensureLosDataset({ db, envelope, root: ROOT, csvPath: cfg.losCsvPath || undefined });
    console.log('Dataset LOS: total ' + out.total + ', diimpor ' + out.imported + ', diperbarui ' + out.skipped);
    process.exit(0);
  }
  if (process.argv.includes('--seed-demo')) {
    if ((await db.find('users', {})).length > 1) { console.log('Data sudah ada; seed demo dilewati.'); process.exit(0); }
    if (!cfg.allowTimeTravel || !cfg.allowSimulator) { console.error('Seed demo membutuhkan ALLOW_TIME_TRAVEL=true dan ALLOW_VA_SIMULATOR=true (lingkungan uji saja).'); process.exit(1); }
    await seedDemo(db, S, { passwordHash: bcrypt.hashSync('demo12345', 10), investorPasswordHash: bcrypt.hashSync(DEMO_INVESTOR.password, 10) });
    console.log('Data demo dibuat. Kata sandi semua akun: demo12345');
    process.exit(0);
  }
  app.listen(cfg.port, () => console.log(`KMH P2P berjalan di port ${cfg.port} (${cfg.databaseUrl ? 'PostgreSQL' : 'SQLite'})`));
}
