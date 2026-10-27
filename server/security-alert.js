import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
export const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

const nowIso = () => new Date().toISOString();
const rank = (s) => (SEVERITY_RANK[s] ?? 0);

function redact(obj, depth = 0) {
  if (depth > 4) return '[nested]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj.length > 400 ? obj.slice(0, 400) + '…' : obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/pass|password|secret|token|signature|api[_-]?key|authorization/i.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = redact(v, depth + 1);
  }
  return out;
}

export function createSecurityAlert(options = {}) {
  const db = options.db;
  const config = options.config || {};
  const logger = options.logger || console;
  const listeners = new Set();
  let counters = { total: 0, blocked: 0, bySeverity: {}, byRule: {} };

  function onEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function emitToListeners(evt) {
    for (const fn of listeners) {
      try {
        fn(evt);
      } catch (e) {
        logger.error('[security-alert] listener gagal: ' + e.message);
      }
    }
  }

  async function notifyBackoffice(title, body, link, severity) {
    const users = await db.find('users', { active: 1 });
    const targets = users.filter((u) => {
      const roles = String(u.roles || '').split(',');
      return roles.includes('admin') || roles.includes('manajer');
    });
    for (const u of targets) {
      await db.insert('notifications', {
        user_id: u.id,
        title: '[' + String(severity || 'info').toUpperCase() + '] ' + title,
        body,
        link: link || 'keamanan',
        read: 0,
        created_at: nowIso(),
      });
    }
  }

  async function writeAudit(evt) {
    await db.insert('audit_logs', {
      actor_id: evt.actor_id ?? null,
      actor_name: evt.actor_name || 'Firewall KMH',
      action: 'security_alert',
      entity: 'security_event',
      entity_id: evt.id ?? null,
      detail: JSON.stringify(redact({
        severity: evt.severity,
        rule: evt.rule_id,
        category: evt.category,
        action: evt.action,
        ip: evt.ip,
        path: evt.path,
        method: evt.method,
        correlation_id: evt.correlation_id,
      })),
      created_at: nowIso(),
    });
  }

  async function emit(evt) {
    const row = {
      severity: SEVERITIES.includes(evt.severity) ? evt.severity : 'low',
      rule_id: String(evt.rule_id || 'GEN'),
      rule_name: String(evt.rule_name || 'Peristiwa keamanan'),
      category: String(evt.category || 'generic'),
      action: String(evt.action || 'log'),
      method: String(evt.method || '-'),
      path: String(evt.path || '-'),
      ip: String(evt.ip || '-'),
      actor_id: evt.actor_id ?? null,
      actor_name: evt.actor_name || '',
      user_agent: String(evt.user_agent || '').slice(0, 300),
      correlation_id: String(evt.correlation_id || crypto.randomUUID()),
      evidence: JSON.stringify(redact(evt.evidence || {})),
      blocked: evt.action === 'block' ? 1 : 0,
      is_simulation: evt.is_simulation ? 1 : 0,
      created_at: nowIso(),
    };
    let saved = null;
    try {
      saved = await db.insert('security_events', row);
    } catch (e) {
      logger.error('[security-alert] gagal menyimpan security_events: ' + e.message);
    }
    const full = { ...row, id: saved?.id ?? null };
    counters.total += 1;
    if (full.action === 'block') counters.blocked += 1;
    counters.bySeverity[full.severity] = (counters.bySeverity[full.severity] || 0) + 1;
    counters.byRule[full.rule_id] = (counters.byRule[full.rule_id] || 0) + 1;
    emitToListeners(full);
    try {
      await writeAudit(full);
    } catch (e) {
      logger.error('[security-alert] gagal menulis audit_logs: ' + e.message);
    }
    try {
      await notifyBackoffice(
        full.rule_name,
        full.rule_id + ' | ' + full.category + ' | ' + full.method + ' ' + full.path + ' | IP ' + full.ip + ' | aksi: ' + full.action,
        'keamanan',
        full.severity,
      );
    } catch (e) {
      logger.error('[security-alert] gagal membuat notifikasi: ' + e.message);
    }
    dispatch(full);
    return full;
  }

  function dispatch(evt) {
    const minEmail = rank(config.alertEmailMinSeverity || 'high');
    const minWa = rank(config.alertWhatsappMinSeverity || 'critical');
    if (rank(evt.severity) >= minEmail && config.smtpHost) {
      sendSmtp(evt).catch((e) => logger.error('[security-alert] SMTP gagal: ' + e.message));
    }
    if (rank(evt.severity) >= minWa && config.whatsappWebhookUrl) {
      sendWhatsapp(evt).catch((e) => logger.error('[security-alert] WhatsApp gagal: ' + e.message));
    }
  }

  async function sendSmtp(evt) {
    const host = config.smtpHost;
    const port = Number(config.smtpPort || 587);
    const user = config.smtpUser || '';
    const pass = config.smtpPass || '';
    const from = config.smtpFrom || 'security@kmh.coop';
    const to = String(config.smtpTo || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!to.length) return false;
    const subject = '[KMH ' + String(evt.severity).toUpperCase() + '] ' + evt.rule_id + ' ' + evt.rule_name;
    const body = [
      'Waktu: ' + evt.created_at,
      'Severity: ' + evt.severity,
      'Rule: ' + evt.rule_id + ' - ' + evt.rule_name,
      'Kategori: ' + evt.category,
      'Aksi: ' + evt.action,
      'Permintaan: ' + evt.method + ' ' + evt.path,
      'IP: ' + evt.ip,
      'Aktor: ' + (evt.actor_name || '-'),
      'Correlation ID: ' + evt.correlation_id,
      '',
      'Bukti: ' + evt.evidence,
    ].join('\n');
    const msg = [
      'From: ' + from,
      'To: ' + to.join(', '),
      'Subject: ' + subject,
      'Date: ' + new Date().toUTCString(),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');
    await smtpSend({ host, port, user, pass, from, to, msg, secure: config.smtpSecure === 'true' || port === 465 });
    return true;
  }

  async function sendWhatsapp(evt) {
    const url = String(config.whatsappWebhookUrl || '');
    const body = JSON.stringify({
      message: '[KMH FIREWALL ' + String(evt.severity).toUpperCase() + '] ' + evt.rule_id + ' ' + evt.rule_name + ' | ' + evt.method + ' ' + evt.path + ' | IP ' + evt.ip + ' | ' + evt.correlation_id,
      severity: evt.severity,
      rule: evt.rule_id,
      correlation_id: evt.correlation_id,
    });
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    await new Promise((resolve, reject) => {
      const req = lib.request(
        {
          method: 'POST',
          hostname: u.hostname,
          port: u.port || (u.protocol === 'http:' ? 80 : 443),
          path: u.pathname + u.search,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            ...(config.whatsappToken ? { authorization: 'Bearer ' + config.whatsappToken } : {}),
          },
          timeout: 8000,
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(true));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.write(body);
      req.end();
    });
    return true;
  }

  async function listEvents(opts = {}) {
    const limit = Math.min(Number(opts.limit || 100), 500);
    const rows = await db.find('security_events', {}, { orderBy: ['id', 'desc'], limit: 500 });
    const filtered = opts.includeSimulation ? rows : rows.filter((r) => !r.is_simulation);
    return filtered.slice(0, limit).map((r) => ({ ...r, evidence: safeParse(r.evidence) }));
  }

  async function summary() {
    const rows = (await db.find('security_events', {}, { orderBy: ['id', 'desc'], limit: 1000 })).filter((r) => !r.is_simulation);
    const bySeverity = {};
    const byRule = {};
    const byCategory = {};
    let blocked = 0;
    let last24h = 0;
    const cutoff = Date.now() - 24 * 3600e3;
    for (const r of rows) {
      bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
      byRule[r.rule_id] = (byRule[r.rule_id] || 0) + 1;
      byCategory[r.category] = (byCategory[r.category] || 0) + 1;
      if (r.blocked) blocked += 1;
      if (Date.parse(r.created_at) >= cutoff) last24h += 1;
    }
    const top = Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([rule, count]) => ({ rule, count }));
    return {
      total: rows.length,
      last_24h: last24h,
      blocked,
      by_severity: bySeverity,
      by_rule: byRule,
      by_category: byCategory,
      top_rules: top,
      channels: channelStatus(),
      runtime_counters: counters,
    };
  }

  function channelStatus() {
    return {
      in_app: true,
      email: config.smtpHost ? { enabled: true, host: config.smtpHost, port: Number(config.smtpPort || 587), to: config.smtpTo || null } : { enabled: false, reason: 'SMTP_HOST belum diset' },
      whatsapp: config.whatsappWebhookUrl ? { enabled: true } : { enabled: false, reason: 'WHATSAPP_WEBHOOK_URL belum diset' },
    };
  }

  async function resetLog() {
    const events = await db.find('security_events', {});
    const notes = await db.find('notifications', {});
    const audits = await db.find('audit_logs', {});
    let removedEvents = 0;
    for (const row of events) {
      await db.delete('security_events', row.id);
      removedEvents += 1;
    }
    let removedNotes = 0;
    for (const row of notes) {
      if (/^\[(CRITICAL|HIGH|MEDIUM|LOW|INFO)\]/.test(String(row.title || '')) || row.link === 'keamanan') {
        await db.delete('notifications', row.id);
        removedNotes += 1;
      }
    }
    let removedAudits = 0;
    for (const row of audits) {
      if (row.action === 'security_alert') {
        await db.delete('audit_logs', row.id);
        removedAudits += 1;
      }
    }
    counters = { total: 0, blocked: 0, bySeverity: {}, byRule: {} };
    return { removedEvents, removedNotes, removedAudits };
  }

  return { emit, onEvent, listEvents, summary, channelStatus, counters, resetLog };
}

function safeParse(text) {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return { raw: String(text || '').slice(0, 400) };
  }
}

function smtpSend(opts) {
  const { host, port, user, pass, from, to, msg } = opts;
  const secure = Boolean(opts.secure);
  return new Promise((resolve, reject) => {
    let socket;
    const timer = setTimeout(() => { try { socket.destroy(); } catch { } reject(new Error('SMTP timeout')); }, 15000);
    const connect = () => {
      socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      socket.on('error', (e) => { clearTimeout(timer); reject(e); });
      socket.on('close', () => clearTimeout(timer));
      socket.on('data', onData);
      socket.on('connect', () => { socket.write('EHLO kmh.local\r\n'); });
    };

    let buffer = '';
    const steps = [];
    const push = (expect, write) => steps.push({ expect, write });

    push(220, () => socket.write('EHLO kmh.local\r\n'));
    push(250, () => {
      if (user && pass) {
        push(334, () => socket.write('AUTH LOGIN\r\n'));
        push(334, () => socket.write(Buffer.from(user, 'utf8').toString('base64') + '\r\n'));
        push(235, () => socket.write(Buffer.from(pass, 'utf8').toString('base64') + '\r\n'));
        push(250, () => socket.write('MAIL FROM:<' + from + '>\r\n'));
      } else {
        push(250, () => socket.write('MAIL FROM:<' + from + '>\r\n'));
      }
    });
    push(250, () => socket.write('RCPT TO:<' + to[0] + '>\r\n'));
    push(354, () => socket.write('DATA\r\n'));
    push(250, () => socket.write(msg.replace(/\r?\n/g, '\r\n') + '\r\n.\r\n'));
    push(221, () => { socket.write('QUIT\r\n'); });

    let step = 0;
    function onData(chunk) {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (/^\d{3}-/.test(line)) continue;
        const match = /^(\d{3}) /.exec(line);
        if (!match) continue;
        const code = Number(match[1]);
        const current = steps[step];
        if (!current) { clearTimeout(timer); socket.destroy(); resolve(true); return; }
        if (code !== current.expect) {
          clearTimeout(timer);
          socket.destroy();
          reject(new Error('SMTP respons tak terduga: ' + line.trim()));
          return;
        }
        step += 1;
        const next = steps[step];
        if (next) { next.write(); continue; }
        clearTimeout(timer);
        try { socket.end(); } catch { }
        resolve(true);
        return;
      }
    }

    connect();
  });
}
