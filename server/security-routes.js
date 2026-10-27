import express from 'express';

const SLASH = String.fromCharCode(47);

export function hostnameOf(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  try { return new URL(v).hostname.toLowerCase(); } catch { }
  try { return new URL('https:' + SLASH + SLASH + v).hostname.toLowerCase(); } catch { }
  return v.split(':')[0].toLowerCase();
}

export function resolveRp(headers = {}, protocol = 'http') {
  const h = headers || {};
  const originHeader = String(h.origin || '').trim();
  const hostHeader = String(h.host || 'localhost');
  const origin = originHeader || ((protocol || 'http') + ':' + SLASH + SLASH + hostHeader);
  const fromOrigin = hostnameOf(originHeader);
  const fromHost = hostnameOf(hostHeader);
  let rpID = fromOrigin || fromHost || 'localhost';
  if (!rpID || rpID === '127.0.0.1' || rpID === '0.0.0.0' || rpID === '::1') rpID = 'localhost';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(rpID)) rpID = 'localhost';
  return { rpID, origin };
}

export function createSecurityRoutes(ctx) {
  const { db, waf, alert, biometric, vault, face, actorFrom, config, securityLimiter } = ctx;
  const router = express.Router();
  const backoffice = ['admin', 'manajer', 'pendana'];
  const vaultRoles = ['admin', 'manajer', 'finance', 'pendana'];
  const safeMessage = (e) => {
    const msg = String((e && e.message) || '');
    if (e && e.status && e.status < 500) return msg;
    if (/tidak ditemukan|tidak ada|wajib|tidak sesuai|sudah|batas|login|kunci|belum|durasi|rentang|wajah|perangkat|biometrik|tantangan|verifikasi|kamera|terlalu|salah|gagal/i.test(msg)) return msg;
    return 'Permintaan tidak dapat diproses. Silakan coba kembali.';
  };
  const rpOf = (req) => resolveRp({ origin: req.get('origin'), host: req.get('host') }, req.protocol);

  router.use((req, res, next) => {
    const p = String(req.path || '');
    if (securityLimiter && (p.startsWith('/security') || p.startsWith('/biometric') || p.startsWith('/vault'))) return securityLimiter(req, res, next);
    return next();
  });

  const needAuth = async (req, res, next) => {
    try {
      const actor = await actorFrom(req);
      if (!actor) {
        res.status(401).json({ error: 'Silakan masuk terlebih dahulu' });
        return;
      }
      req.actor = actor;
      next();
    } catch {
      res.status(500).json({ error: 'Gagal memverifikasi sesi' });
    }
  };

  const needRole = (roles) => async (req, res, next) => {
    try {
      const actor = await actorFrom(req);
      if (!actor) {
        res.status(401).json({ error: 'Silakan masuk terlebih dahulu' });
        return;
      }
      const list = String(actor.roles || '').split(',');
      if (!roles.some((r) => list.includes(r))) {
        res.status(403).json({ error: 'Anda tidak memiliki akses ke modul keamanan ini' });
        return;
      }
      req.actor = actor;
      next();
    } catch {
      res.status(500).json({ error: 'Gagal memeriksa hak akses' });
    }
  };

  router.get('/security/summary', needRole(backoffice), async (req, res) => {
    try {
      const summary = await alert.summary();
      const mode = await waf.getMode();
      res.json({
        ok: true,
        data: {
          waf: { mode, threshold: ctx.wafThreshold, rules: waf.ruleCatalog().length, trust_proxy_hops: config.trustProxyHops },
          events: summary,
          envelope: ctx.envelope.info(),
          biometric: biometric.publicInfo(),
          runtime: {
            node: process.version,
            uptime_seconds: Math.round(process.uptime()),
            memory_mb: Math.round(process.memoryUsage().rss / 1048576),
            pid: process.pid,
          },
          health: runtimeHealth(summary),
        },
      });
    } catch (e) {
      res.status(500).json({ error: safeMessage(e) });
    }
  });

  router.get('/security/events', needRole(backoffice), async (req, res) => {
    try {
      const rows = await alert.listEvents({ limit: Number(req.query.limit || 100), includeSimulation: req.query.include_simulation === '1' });
      res.json({ ok: true, data: rows });
    } catch (e) {
      res.status(500).json({ error: safeMessage(e) });
    }
  });

  router.post('/security/reset', needRole(['admin']), async (req, res) => {
    try {
      const out = await alert.resetLog();
      res.json({ ok: true, data: out });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.get('/security/rules', needRole(backoffice), async (_req, res) => {
    res.json({ ok: true, data: waf.ruleCatalog() });
  });

  router.post('/security/mode', needRole(['admin']), async (req, res) => {
    try {
      const mode = await waf.setMode(String(req.body?.mode || ''));
      await alert.emit({
        severity: 'medium',
        rule_id: 'WAF_CFG',
        rule_name: 'Mode WAF diubah',
        category: 'configuration',
        action: 'log',
        method: 'POST',
        path: '/api/security/mode',
        ip: req.ip,
        actor_id: req.actor?.id ?? null,
        actor_name: req.actor?.name || '',
        user_agent: req.headers['user-agent'] || '',
        evidence: { mode },
      });
      res.json({ ok: true, data: { mode } });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/security/simulate', needRole(backoffice), async (req, res) => {
    try {
      const out = await waf.simulate(String(req.body?.type || ''), { ...req.actor, ip: req.ip });
      res.json({ ok: true, data: out });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/security/test-channels', needRole(['admin']), async (req, res) => {
    try {
      const evt = await alert.emit({
        severity: 'medium',
        rule_id: 'CHANNEL_TEST',
        rule_name: 'Uji saluran Security Alert',
        category: 'configuration',
        action: 'log',
        method: 'POST',
        path: '/api/security/test-channels',
        ip: req.ip,
        actor_id: req.actor?.id ?? null,
        actor_name: req.actor?.name || '',
        user_agent: req.headers['user-agent'] || '',
        evidence: { note: 'Pengujian manual dari panel keamanan' },
      });
      res.json({ ok: true, data: { event: evt, channels: alert.channelStatus() } });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.get('/security/stream', needRole(backoffice), async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write('event: ready\ndata: ' + JSON.stringify({ ok: true, at: new Date().toISOString() }) + '\n\n');
    const off = alert.onEvent((evt) => {
      res.write('event: security\ndata: ' + JSON.stringify(evt) + '\n\n');
    });
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { } }, 25000);
    req.on('close', () => {
      off();
      clearInterval(ping);
      try { res.end(); } catch { }
    });
  });

  router.get('/biometric/info', needAuth, async (_req, res) => {
    res.json({ ok: true, data: biometric.publicInfo() });
  });

  router.get('/biometric/credentials', needAuth, async (req, res) => {
    try {
      const rows = await biometric.listCredentials(req.actor.id);
      res.json({ ok: true, data: rows });
    } catch (e) {
      res.status(500).json({ error: safeMessage(e) });
    }
  });

  router.post('/biometric/webauthn/register/options', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await biometric.registerOptions(req.actor, rpOf(req)) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/biometric/webauthn/register/verify', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await biometric.registerVerify(req.actor, req.body || {}, rpOf(req)) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/biometric/webauthn/authenticate/options', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await biometric.authOptions(req.actor, rpOf(req)) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/biometric/webauthn/authenticate/verify', needAuth, async (req, res) => {
    try {
      const out = await biometric.authVerify(req.actor, req.body || {}, rpOf(req));
      const scope = String(req.body?.scope || 'vault');
      const stepup = await biometric.issueStepUp({ ...req.actor, ip: req.ip }, out.method, scope);
      if (scope === 'vault') {
        await vault.recordUnlock({ ...req.actor, ip: req.ip }, { method: out.method, scope, records: 0, path: '/api/biometric/webauthn/authenticate/verify' });
      }
      res.json({ ok: true, data: { ...out, scope, stepup } });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/biometric/retina/enroll', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await biometric.enrollRetina(req.actor, req.body || {}) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/biometric/retina/options', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await biometric.retinaOptions(req.actor) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/biometric/retina/verify', needAuth, async (req, res) => {
    try {
      const out = await biometric.retinaVerify(req.actor, req.body || {});
      const scope = String(req.body?.scope || 'vault');
      const stepup = await biometric.issueStepUp({ ...req.actor, ip: req.ip }, out.method, scope);
      res.json({ ok: true, data: { ...out, scope, stepup } });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/biometric/revoke', needAuth, async (req, res) => {
    try {
      await biometric.revokeCredential(req.actor, req.body?.id);
      res.json({ ok: true, data: { revoked: true } });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.get('/vault/status', needRole(vaultRoles), async (req, res) => {
    try {
      const token = String(req.headers['x-kmh-stepup'] || req.headers['x-vault-token'] || req.query.token || '');
      const session = await biometric.verifyStepUp(token, 'vault');
      res.json({ ok: true, data: await vault.status(req.actor, session) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.get('/vault/records', needRole(vaultRoles), async (req, res) => {
    try {
      const token = String(req.headers['x-kmh-stepup'] || req.headers['x-vault-token'] || req.query.token || '');
      const session = await biometric.verifyStepUp(token, 'vault');
      const rows = await vault.listRecords(req.actor, session);
      res.json({ ok: true, data: { rows, locked: !(session && session.valid), session: session && session.valid ? { method: session.method, expires_at: session.expires_at } : null } });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/vault/unlock', needRole(vaultRoles), async (req, res) => {
    try {
      res.json({ ok: true, data: await vault.unlock(req.actor, String(req.body?.token || '')) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/vault/lock', needRole(vaultRoles), async (req, res) => {
    try {
      await vault.lock(req.actor, req.body?.token_id);
      res.json({ ok: true, data: { locked: true } });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.get('/vault/columns', needRole(vaultRoles), async (_req, res) => {
    try {
      res.json({ ok: true, data: await vault.columnStatus() });
    } catch (e) {
      res.status(500).json({ error: safeMessage(e) });
    }
  });

  router.get('/vault/sessions', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await biometric.listSessions(req.actor.id) });
    } catch (e) {
      res.status(500).json({ error: safeMessage(e) });
    }
  });

  router.get('/vault/los/counts', needRole(vaultRoles), async (_req, res) => {
    try {
      res.json({ ok: true, data: await vault.losCounts() });
    } catch (e) {
      res.status(500).json({ error: safeMessage(e) });
    }
  });

  router.get('/vault/los', needRole(vaultRoles), async (req, res) => {
    try {
      const token = String(req.headers['x-kmh-stepup'] || req.headers['x-vault-token'] || req.query.token || '');
      const session = await biometric.verifyStepUp(token, 'vault');
      const data = await vault.listLosRecords({
        session,
        search: req.query.search || '',
        gender: req.query.gender || '',
        sourceStatus: req.query.source_status || '',
        page: req.query.page || 1,
        size: req.query.size || 25,
      });
      res.json({ ok: true, data });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.get('/face/info', needAuth, async (_req, res) => {
    res.json({ ok: true, data: face.publicInfo() });
  });

  router.get('/face/profiles', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await face.listProfiles(req.actor.id) });
    } catch (e) {
      res.status(500).json({ error: safeMessage(e) });
    }
  });

  router.post('/face/enroll/options', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await face.enrollOptions(req.actor) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/face/enroll/verify', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await face.enrollVerify(req.actor, req.body || {}) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/face/unlock/options', needAuth, async (req, res) => {
    try {
      res.json({ ok: true, data: await face.unlockOptions(req.actor) });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/face/unlock/verify', needAuth, async (req, res) => {
    try {
      const out = await face.unlockVerify(req.actor, req.body || {});
      const scope = String(req.body?.scope || 'vault');
      const stepup = await biometric.issueStepUp({ ...req.actor, ip: req.ip }, 'face-recognition', scope);
      if (scope === 'vault') {
        await vault.recordUnlock({ ...req.actor, ip: req.ip }, { method: 'face-recognition', scope, records: 0, path: '/api/face/unlock/verify' });
      }
      res.json({ ok: true, data: { ...out, scope, stepup } });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  router.post('/face/revoke', needAuth, async (req, res) => {
    try {
      await face.revokeProfile(req.actor, req.body?.id);
      res.json({ ok: true, data: { revoked: true } });
    } catch (e) {
      res.status(400).json({ error: safeMessage(e) });
    }
  });

  return router;
}

function runtimeHealth(summary) {
  const critical = summary.by_severity?.critical || 0;
  const blocked = summary.blocked || 0;
  let status = 'SEHAT';
  let note = 'Tidak ada ancaman kritis dalam 24 jam terakhir';
  if (critical > 0) {
    status = 'WASPADA';
    note = critical + ' peristiwa kritis tercatat; periksa log dan lakukan blokir IP/akun';
  }
  if (blocked > 25) {
    status = 'KRITIS';
    note = 'Volume pemblokiran tinggi; indikasi serangan otomatis aktif';
  }
  return { status, note, critical, blocked };
}
