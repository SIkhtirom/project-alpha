import { esc, rp, num, pct, table, kv, stat, pageHead, empty, field, inp, sel, pill, toast, confirmDialog, modal } from './ui.js';
import { apiGet, apiPost, subscribeSecurityAlerts, renderSecurityBanner, toastSecurity, webauthnRegister, webauthnAuthenticate, faceEnroll, faceUnlock, startFaceCamera, stopFaceCamera } from './security.js';

const SEV_TONE = { critical: 'bad', high: 'bad', medium: 'warn', low: 'info', info: 'info' };
const LOS_TOTAL_DANA = 'Rp 150.000.000.000';
const LOS_TOTAL_BARIS = 560;
const ACCEPT_TITLE = 'Persetujuan Akses Data Nominatif';
const ACCEPT_BODY = 'Verifikasi pendaftaran wajah berhasil. Sistem akan memunculkan 560 baris data nominatif dengan total dana sebesar Rp 150.000.000.000 (150 Miliar). Tekan tombol Accept untuk menampilkan tabel database.';
const SIM_TYPES = [
  ['sqli', 'SQL Injection'],
  ['xss', 'XSS Stored'],
  ['traversal', 'Path Traversal'],
  ['upload', 'Upload Berbahaya'],
  ['bruteforce', 'Brute-Force Login'],
  ['otp', 'Brute-Force OTP'],
  ['session', 'Session Hijack'],
  ['massassign', 'Mass Assignment'],
  ['php2shell', 'Probe PHP2Shell'],
  ['webhook', 'Webhook Spoofing'],
  ['dos', 'DoS / Resource Exhaustion'],
  ['recon', 'Recon / Enumeration'],
];

const state = {
  events: [],
  summary: null,
  rules: [],
  mode: 'block',
  vault: null,
  records: [],
  token: null,
  expiresAt: 0,
  countdownTimer: null,
  lastEventId: 0,
  accepted: false,
  losTab: 'los',
  los: { rows: [], total: 0, page: 1, pages: 1, size: 25, locked: true },
  losSearch: '',
  losGender: '',
  losCounts: null,
  faceProfiles: [],
  enrolled: false,
  unlocked: false,
  lockHidden: false,
  acceptPromptDone: false,
};

function serverOnly(ctx, title, desc) {
  if (ctx.api.mode === 'server') return '';
  return '<div class="notice warn">' + esc(title + ' ' + desc) + ' Modul ini berjalan di sisi server dan tidak tersedia pada mode demo satu berkas.</div>';
}

function sevPill(sev) {
  return pill(String(sev || 'info').toUpperCase(), SEV_TONE[sev] || 'info');
}

function eventRows(rows) {
  if (!rows.length) return empty('Belum ada peristiwa keamanan tercatat.');
  return table(
    [
      { label: 'Waktu', render: (r) => esc(String(r.created_at || '').replace('T', ' ').slice(0, 19)) },
      { label: 'Severity', render: (r) => sevPill(r.severity) },
      { label: 'Rule', render: (r) => '<strong class="mono">' + esc(r.rule_id) + '</strong> ' + esc(r.rule_name || '') },
      { label: 'Kategori', render: (r) => esc(r.category || '-') },
      { label: 'Aksi', render: (r) => pill(String(r.action || '').toUpperCase(), r.action === 'block' ? 'bad' : 'warn') },
      { label: 'Permintaan', render: (r) => '<span class="mono small">' + esc(r.method + ' ' + r.path) + '</span>' },
      { label: 'IP', render: (r) => esc(r.ip || '-') },
      { label: 'Aktor', render: (r) => esc(r.actor_name || '-') },
    ],
    rows,
    { empty: 'Belum ada peristiwa keamanan tercatat.' },
  );
}

export const keamanan = {
  roles: ['admin', 'manajer', 'pendana'],
  async render(ctx) {
    const server = ctx.api.mode === 'server';
    if (!server) return pageHead('Keamanan', 'Application Firewall & Security Alert') + serverOnly(ctx, 'Modul Keamanan & Firewall.', '');
    state.summary = await apiGet('/api/security/summary');
    state.rules = await apiGet('/api/security/rules');
    state.mode = state.summary.waf.mode;
    state.events = await apiGet('/api/security/events?limit=60');
    state.lastEventId = state.events.length ? Number(state.events[0].id || 0) : 0;
    const s = state.summary;
    const ev = s.events;
    const isAdmin = (ctx.me?.user?.roles || []).includes('admin');
    return pageHead('Keamanan & Firewall', 'Application Firewall KMH dan Security Alert Real-Time',
      'Pemantauan keamanan platform secara langsung.') +
      '<div class="sec-grid">' +
      '<div class="card stat"><span class="label">Status kesehatan</span><span class="value">' + esc(s.health.status) + '</span><span class="hint">' + esc(s.health.note) + '</span></div>' +
      '<div class="card stat"><span class="label">Peristiwa 24 jam</span><span class="value">' + num(ev.last_24h) + '</span><span class="hint">total ' + num(ev.total) + ' sejak log dibersihkan</span></div>' +
      '<div class="card stat"><span class="label">Diblokir</span><span class="value">' + num(ev.blocked) + '</span><span class="hint">permintaan ditolak Firewall</span></div>' +
      '<div class="card stat"><span class="label">Kritis</span><span class="value">' + num(ev.by_severity?.critical || 0) + '</span><span class="hint">peringatan tier tertinggi</span></div>' +
      '</div>' +
      '<div class="grid g2 sec-top">' +
      '<div class="card stack"><div class="section-title">Mode Firewall</div>' +
      (isAdmin ? '<div class="row wrap">' +
      ['off', 'detect', 'block'].map((m) => '<button class="btn ' + (state.mode === m ? 'primary' : '') + '" data-sec="wafmode" data-mode="' + m + '">' + (m === 'off' ? 'Nonaktif' : m === 'detect' ? 'Deteksi (log)' : 'Blokir + Alert') + '</button>').join('') +
      '</div>' : '<p class="small muted" style="margin:0">Mode Firewall: <strong>' + esc(state.mode.toUpperCase()) + '</strong>. Perubahan mode hanya dapat dilakukan oleh Admin KMH.</p>') +
      kv([
        ['Runtime', s.runtime.node],
        ['Aturan aktif', num(s.waf.rules)],
        ['Ambang blokir', num(s.waf.threshold) + ' poin'],
        ['Saluran alert', Object.entries(ev.channels || {}).map(([k, v]) => k + ': ' + (v.enabled ? 'aktif' : 'nonaktif')).join(' | ')],
      ]) +
      '</div>' +
      '<div class="card stack"><div class="section-title">Uji WAF</div>' +
      '<div class="row wrap sec-sim">' + SIM_TYPES.map(([t, l]) => '<button class="btn sm" data-sec="sim" data-type="' + t + '">' + esc(l) + '</button>').join('') + '</div>' +
      '<div id="sim-result"></div>' +
      '</div>' +
      '</div>' +
      '<div class="card stack"><div class="section-title">Katalog aturan WAF</div>' +
      table([
        { label: 'Rule', render: (r) => '<span class="mono">' + esc(r.id) + '</span>' },
        { label: 'Nama', key: 'name' },
        { label: 'Kategori', key: 'category' },
        { label: 'Severity', render: (r) => sevPill(r.severity) },
        { label: 'Poin', num: true, render: (r) => num(r.points) },
      ], state.rules) +
      '</div>' +
      '<div class="card stack"><div class="section-title">Log peristiwa keamanan (real-time)</div>' +
      '<div class="row wrap"><button class="btn sm" data-sec="refresh">Segarkan</button>' +
      (isAdmin ? '<button class="btn sm" data-sec="testchannel">Uji saluran notifikasi</button><button class="btn sm danger" data-sec="resetlog">Bersihkan log firewall</button>' : '') +
      '</div>' +
      '<div id="sec-events">' + eventRows(state.events) + '</div>' +
      '</div>';
  },
  after(ctx, root) {
    if (ctx.api.mode !== 'server') return;
    if (!state.unsubscribed) {
      state.unsubscribed = subscribeSecurityAlerts((evt) => {
        renderSecurityBanner(document.getElementById('sec-banner'), evt);
        toastSecurity(document.getElementById('toast-host'), evt);
        state.events.unshift(evt);
        if (state.events.length > 120) state.events.pop();
        const host = document.getElementById('sec-events');
        if (host) host.innerHTML = eventRows(state.events);
      });
    }
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-sec]');
      if (!btn) return;
      const act = btn.dataset.sec;
      try {
        if (act === 'wafmode') {
          btn.disabled = true;
          const out = await apiPost('/api/security/mode', { mode: btn.dataset.mode });
          state.mode = out.mode;
          toast('Mode Firewall diubah ke ' + out.mode.toUpperCase());
          await ctx.refresh();
          return;
        }
        if (act === 'sim') {
          btn.disabled = true;
          const out = await apiPost('/api/security/simulate', { type: btn.dataset.type });
          const host = document.getElementById('sim-result');
          if (host) {
            host.innerHTML = '<div class="notice ' + (out.blocked ? 'bad' : 'warn') + '"><strong>' + esc(out.simulation.toUpperCase()) + '</strong> &rarr; ' +
              (out.blocked ? 'DIBLOKIR' : 'DILULUSKAN (mode ' + esc(out.mode) + ')') + ' | skor ' + num(out.points) + ' | aturan: ' +
              esc((out.hits || []).map((h) => h.rule_id).join(', ')) + '</div>';
          }
          toast('Simulasi ' + out.simulation + ': ' + (out.blocked ? 'diblokir Firewall' : 'tidak diblokir'));
          return;
        }
        if (act === 'refresh') {
          state.events = await apiGet('/api/security/events?limit=60');
          const host = document.getElementById('sec-events');
          if (host) host.innerHTML = eventRows(state.events);
          toast('Log keamanan disegarkan');
          return;
        }
        if (act === 'testchannel') {
          const out = await apiPost('/api/security/test-channels', {});
          toast('Uji alert dikirim: ' + JSON.stringify(out.channels));
          return;
        }
        if (act === 'resetlog') {
          const ok = await confirmDialog('Bersihkan log firewall?', 'Seluruh catatan security_events, notifikasi security, dan jejak audit security_alert akan dihapus. Tindakan ini tidak dapat dibatalkan.', 'Bersihkan', true);
          if (!ok) return;
          const out = await apiPost('/api/security/reset', {});
          toast('Log dibersihkan: ' + out.removedEvents + ' peristiwa, ' + out.removedNotes + ' notifikasi');
          await ctx.refresh();
          return;
        }
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  },
};

function p2pTable(rows) {
  if (!rows.length) return empty('Belum ada record data nominatif.');
  return table(
    [
      { label: 'Kelompok', render: (r) => pill(r.group, r.group === 'LOS' ? 'info' : r.group === 'ANGGOTA' ? 'ok' : 'accent') },
      { label: 'Kode', render: (r) => '<span class="mono small">' + esc(r.code) + '</span>' },
      { label: 'Subjek', render: (r) => esc(r.subject) },
      { label: 'NIK', render: (r) => '<span class="mono small cipher">' + esc(r.nik) + '</span>' },
      { label: 'Nomor rekening', render: (r) => '<span class="mono small cipher">' + esc(r.nomor_rekening) + '</span>' },
      { label: 'Alamat', render: (r) => '<span class="mono small cipher">' + esc(r.alamat) + '</span>' },
      { label: 'Nilai', render: (r) => '<span class="mono small cipher">' + esc(r.nilai) + '</span>' },
    ],
    rows,
  );
}

function losTable(rows, locked) {
  if (!rows.length) return empty('Tidak ada record LOS yang cocok dengan filter.');
  return table(
    [
      { label: 'ID Pengajuan', render: (r) => '<span class="mono small">' + esc(r.id_pengajuan) + '</span>' },
      { label: 'Nama lengkap', render: (r) => locked ? '<span class="mono small cipher">' + esc(r.full_name) + '</span>' : esc(r.full_name) },
      { label: 'Email', render: (r) => locked ? '<span class="mono small cipher">' + esc(r.email_address) + '</span>' : esc(r.email_address) },
      { label: 'Telepon', render: (r) => locked ? '<span class="mono small cipher">' + esc(r.phone_number) + '</span>' : esc(r.phone_number) },
      { label: 'NIK', render: (r) => locked ? '<span class="mono small cipher">' + esc(r.identification_number) + '</span>' : esc(r.identification_number) },
      { label: 'Jenis kelamin', render: (r) => esc(r.gender || '-') },
      { label: 'Loan code', render: (r) => '<span class="mono small">' + esc(r.loan_code || '-') + '</span>' },
      { label: 'Pokok', render: (r) => '<span class="mono small">' + esc(r.ntf_total || '-') + '</span>' },
      { label: 'Angsuran', render: (r) => '<span class="mono small">' + esc(r.installment_real || '-') + '</span>' },
      { label: 'Status', render: (r) => pill(r.active_badge || 'ACTIVE', 'ok') },
    ],
    rows,
  );
}

function faceOverlayShell(title, subtitle) {
  const overlay = document.createElement('div');
  overlay.className = 'face-overlay';
  overlay.innerHTML =
    '<div class="face-overlay-card card stack">' +
    '<div class="row between"><div class="face-head"><div class="section-title">' + esc(title) + '</div><div class="small muted">' + esc(subtitle) + '</div></div>' +
    '<button class="btn sm" data-face="close">Tutup</button></div>' +
    '<div class="face-stage-grid" id="face-stages"></div>' +
    '<div class="face-instruction" id="face-instruction"></div>' +
    '<div class="face-progress"><div class="face-progress-bar" id="face-progress"></div></div>' +
    '<div class="face-camera"><div class="retina-box"><video id="face-video" playsinline muted></video><div class="retina-scan"></div><div class="retina-ring"></div></div>' +
    '<div class="face-camera-note" id="face-note">Posisikan wajah di dalam lingkaran, lalu ikuti instruksi di atas.</div></div>' +
    '<div class="row wrap"><button class="btn primary" data-face="start">Mulai Verifikasi</button>' +
    '<span class="small muted" id="face-meta"></span></div>' +
    '</div>';
  document.body.appendChild(overlay);
  return overlay;
}

function paintStages(host, stages, activeIndex, doneKeys) {
  host.innerHTML = stages.map((s, i) => {
    const stateCls = doneKeys.has(s.key) ? 'done' : (i === activeIndex ? 'active' : 'wait');
    const badge = doneKeys.has(s.key) ? 'SELESAI' : (i === activeIndex ? 'SEDANG BERJALAN' : 'MENUNGGU');
    return '<div class="face-stage ' + stateCls + '"><span class="mono">' + esc(s.key) + '</span><strong>' + esc(s.label) + '</strong><em>' + esc(badge) + '</em></div>';
  }).join('');
}

async function runFaceFlow(ctx, mode) {
  const enrolling = mode === 'enroll';
  const overlay = faceOverlayShell(
    enrolling ? 'Pendaftaran Face Recognition' : 'Verifikasi Face Recognition',
    enrolling
      ? 'Tiga posisi wajah dengan urutan acak. Tahan setiap pose sampai indikator terisi.'
      : 'Tiga pose acakfollowed oleh tantangan buka mulut dan senyum.'
  );
  const video = overlay.querySelector('#face-video');
  const instr = overlay.querySelector('#face-instruction');
  const bar = overlay.querySelector('#face-progress');
  const stageHost = overlay.querySelector('#face-stages');
  const meta = overlay.querySelector('#face-meta');
  const note = overlay.querySelector('#face-note');
  const doneKeys = new Set();
  let stages = [];
  let stream = null;

  const cleanup = () => {
    if (stream) { stopFaceCamera(stream); stream = null; }
    overlay.remove();
  };

  overlay.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-face]');
    if (!btn) return;
    if (btn.dataset.face === 'close') { cleanup(); return; }
    if (btn.dataset.face === 'start') {
      btn.disabled = true;
      const onOptions = (d) => {
        stages = d.stages;
        paintStages(stageHost, stages, 0, doneKeys);
        meta.textContent = 'Target durasi ' + Math.round((d.total_target_ms || 10000) / 1000) + ' detik';
      };
      const onProgress = (p) => {
        const wrong = p.phase === 'wrong-pose';
        if (wrong) {
          instr.textContent = 'Posisi Wajah Salah';
          instr.classList.add('face-wrong');
          note.textContent = 'Posisi Wajah Salah — ' + (p.stage ? p.stage.instruction : 'Arahkan wajah sesuai instruksi') + '. Progres ditahan sampai arah wajah benar.';
        } else {
          instr.classList.remove('face-wrong');
          instr.textContent = p.stage ? p.stage.instruction : '';
          note.textContent = 'Posisikan wajah di dalam lingkaran, lalu ikuti instruksi di atas.';
        }
        bar.style.width = wrong ? '0%' : Math.round((p.ratio || 0) * 100) + '%';
        if (p.stage && p.phase === 'hold') doneKeys.add(p.stage.key);
        paintStages(stageHost, stages, p.index, doneKeys);
      };
      try {
        const out = enrolling
          ? await faceEnroll({ video, onOptions, onProgress })
          : await faceUnlock({ video, scope: 'vault', onOptions, onProgress });
        if (enrolling) {
          state.enrolled = true;
          state.accepted = false;
          state.lockHidden = false;
          toast(out && out.fallback
            ? 'Pendaftaran Face Recognition berhasil dengan mode cadangan kamera. Mohon lakukan pendaftaran ulang saat kamera siap agar kualitas lebih baik.'
            : 'Pendaftaran Face Recognition berhasil');
          cleanup();
          await ctx.refresh();
          await showAcceptModal(ctx);
          return;
        }
        state.token = out.stepup.token;
        state.expiresAt = Date.now() + out.stepup.expires_in * 1000;
        toast('Verifikasi wajah berhasil. Data nominatif dibuka selama 10 menit.');
        cleanup();
        await ctx.refresh();
        startCountdown(ctx);
        return;
      } catch (err) {
        toast(err.message, 'error');
        instr.textContent = 'Gagal: ' + err.message;
        btn.disabled = false;
      }
    }
  });

  try {
    stream = await startFaceCamera(video);
    note.textContent = 'Kamera aktif. Ikuti instruksi di atas.';
  } catch (e) {
    instr.textContent = 'Kamera tidak dapat diakses: ' + e.message;
  }
}

async function showAcceptModal(ctx) {
  if (state.acceptPromptDone) return;
  state.acceptPromptDone = true;
  const answer = await modal(
    '<h3>' + esc(ACCEPT_TITLE) + '</h3><div class="muted" style="margin:10px 0 16px">' + esc(ACCEPT_BODY) + '</div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn primary" data-modal="accept">Accept</button></div>',
    { wide: true },
  );
  if (answer === 'accept') {
    state.accepted = true;
    state.lockHidden = false;
    try { await ctx.api.call('acceptVaultAccess', {}); } catch (e) { console.warn('gagal menandai persetujuan akses:', e && e.message); }
  }
  await ctx.refresh();
}

export const brankas = {
  roles: ['admin', 'manajer', 'finance', 'pendana'],
  async render(ctx) {
    const server = ctx.api.mode === 'server';
    if (!server) return pageHead('Brankas Data Nominatif', 'P2P Kita Miraino Hikari') + serverOnly(ctx, 'Modul Brankas Data Nominatif.', '');
    state.vault = await apiGet('/api/vault/status');
    state.faceProfiles = await apiGet('/api/face/profiles');
    const creds = await apiGet('/api/biometric/credentials');
    const enrolled = state.enrolled || state.faceProfiles.some((p) => p.active) || creds.some((c) => c.active);
    const unlocked = Boolean(state.token) && state.expiresAt > Date.now();
    state.unlocked = unlocked;
    const showTable = enrolled && state.accepted && !state.lockHidden;
    const showTabs = unlocked;
    const canUnlock = enrolled && !unlocked;
    const canLock = unlocked;
    const tokenQuery = state.token ? '?token=' + encodeURIComponent(state.token) : '';
    let losData = { rows: [], total: 0, page: 1, pages: 1, size: 25, locked: true };
    if (showTable) {
      losData = await apiGet('/api/vault/los?page=' + state.los.page + '&size=' + state.los.size + '&search=' + encodeURIComponent(state.losSearch) + '&gender=' + encodeURIComponent(state.losGender) + (state.token ? '&token=' + encodeURIComponent(state.token) : ''));
      state.los = { ...state.los, ...losData };
      state.losCounts = await apiGet('/api/vault/los/counts');
      if (state.losTab === 'p2p') {
        const data = await apiGet('/api/vault/records' + tokenQuery);
        state.records = data.rows || [];
      }
    }
    const genderOptions = Object.entries(state.losCounts?.by_gender || {});
    const html =
      pageHead('Brankas Data Nominatif', 'P2P Kita Miraino Hikari',
        'Pusat pengelolaan informasi anggota dan Data Nominatif pembiayaan KMH. Untuk menjaga kerahasiaan data anggota, rincian informasi hanya dapat dibuka oleh petugas berwenang melalui verifikasi wajah atau sidik jari dan akan tertutup otomatis setelah batas waktu akses berakhir.') +
      '<div class="sec-grid">' +
      '<div class="card stat"><span class="label">Status Akses</span><span class="value ' + (unlocked ? 'ok' : '') + '">' + (unlocked ? 'TERBUKA' : enrolled ? 'MENUNGGU PEMERIKSAAN' : 'BELUM TERDAFTAR') + '</span><span class="hint">' + (unlocked ? 'Akses rincian data sedang aktif' : enrolled ? 'Lakukan pemindaian wajah untuk membuka rincian data' : 'Daftarkan Face Recognition terlebih dahulu') + '</span></div>' +
      '<div class="card stat"><span class="label">Masa Akses</span><span class="value" style="font-size:18px">10 MENIT</span><span class="hint">' + (unlocked ? 'Hitung mundur berjalan di bawah' : 'Berlaku sejak pemindaian wajah berhasil') + '</span></div>' +
      '<div class="card stat"><span class="label">Total Dana Pembiayaan</span><span class="value" style="font-size:18px">' + LOS_TOTAL_DANA + '</span><span class="hint">' + num(LOS_TOTAL_BARIS) + ' baris data nominatif</span></div>' +
      '<div class="card stat"><span class="label">Data LOS</span><span class="value">' + num(state.losCounts?.total || LOS_TOTAL_BARIS) + '</span><span class="hint">baris data siap diakses petugas berwenang</span></div>' +
      '</div>' +
      '<div class="grid g2 sec-top">' +
      '<div class="card stack"><div class="section-title">Pembuka Kunci Biometrik</div>' +
      '<p class="small muted" style="margin:0">Gunakan verifikasi wajah atau sidik jari Anda untuk membuka akses rincian Data Nominatif. Ikuti instruksi arah wajah di layar kamera selama 10-15 detik hingga verifikasi selesai. Demi keamanan, akses akan dikunci apabila terjadi tiga kali kegagalan verifikasi.</p>' +
      '<div class="row wrap">' +
      '<button class="btn primary" data-sec="unlock-face"' + (canUnlock ? '' : ' disabled') + '>Buka Kunci Database (Face Recognition)</button>' +
      '<button class="btn" data-sec="unlock-webauthn"' + (canUnlock ? '' : ' disabled') + '>Buka Kunci (Sidik Jari / Passkey)</button>' +
      '<button class="btn danger" data-sec="lock"' + (canLock ? '' : ' disabled') + '>Kunci Kembali Database Sekarang</button>' +
      '</div>' +
      '<div id="vault-timer" class="small">' + (unlocked ? 'Sisa waktu akses: <strong id="vault-countdown">-</strong>' : 'Rincian data tidak sedang dibuka') + '</div>' +
      '<div class="section-title">Perangkat biometrik terdaftar</div>' +
      (state.faceProfiles.length
        ? table([
          { label: 'Jenis', render: () => pill('Face Recognition', 'ok') },
          { label: 'Terdaftar', render: (r) => esc(String(r.enrolled_at || '-').replace('T', ' ').slice(0, 19)) },
          { label: 'Terakhir dipakai', render: (r) => esc(String(r.last_used_at || '-').replace('T', ' ').slice(0, 19)) },
          { label: '', render: (r) => r.active ? '<button class="btn sm" data-sec="revokeface" data-id="' + r.id + '">Cabut</button>' : pill('Dicabut', 'bad') },
        ], state.faceProfiles)
        : empty('Belum ada profil Face Recognition terdaftar.')) +
      (creds.length
        ? table([
          { label: 'Jenis', render: () => pill('WebAuthn / FIDO2', 'accent') },
          { label: 'Perangkat', key: 'device_label' },
          { label: '', render: (r) => r.active ? '<button class="btn sm" data-sec="revoke" data-id="' + r.id + '">Cabut</button>' : pill('Dicabut', 'bad') },
        ], creds)
        : '') +
      '<div class="row wrap"><button class="btn sm" data-sec="enroll-face">Daftarkan Face Recognition</button><button class="btn sm" data-sec="enroll-webauthn">Daftarkan Sidik Jari / Passkey</button>' +
      (enrolled && !state.accepted ? '<button class="btn sm primary" data-sec="showtable">Tampilkan Tabel Data</button>' : '') +
      '</div>' +
      '</div>' +
      '<div class="card stack"><div class="section-title">Tata cara Face Recognition</div>' +
      '<ol class="small muted face-guide">' +
      '<li>Langkah 1: Klik tombol Daftarkan Face Recognition dan posisikan wajah di area kamera.</li>' +
      '<li>Langkah 2: Setujui konfirmasi penampilan data nominatif melalui jendela persetujuan (Accept).</li>' +
      '<li>Langkah 3: Lakukan pemindaian wajah untuk membuka rincian data selama masa akses 10 menit.</li>' +
      '</ol>' +
      '</div>' +
      '<div id="vault-result" class="notice"></div>' +
      '</div>' +
      (showTable
        ? '<div class="card stack"><div class="section-title">Data Nominatif</div>' +
        (showTabs
          ? '<div class="row wrap sec-tabs">' +
          '<button class="btn ' + (state.losTab === 'los' ? 'primary' : '') + '" data-sec="tab" data-tab="los">Data Nominatif LOS (' + num(LOS_TOTAL_BARIS) + ' Data)</button>' +
          '<button class="btn ' + (state.losTab === 'p2p' ? 'primary' : '') + '" data-sec="tab" data-tab="p2p">P2P (Anggota &amp; Pembiayaan)</button>' +
          '</div>'
          : '') +
        (showTabs ? losPanel(state.los, state.losCounts, state.losSearch, state.losGender) : '') +
        (showTabs && state.losTab === 'p2p' ? p2pTable(state.records) : '') +
        (!showTabs ? losTable(state.los.rows, true) : '') +
        '</div>'
        : '');
    return html;
  },
  after(ctx, root) {
    if (ctx.api.mode !== 'server') return;
    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-sec]');
      if (!btn) return;
      const act = btn.dataset.sec;
      const res = document.getElementById('vault-result');
      try {
        if (act === 'tab') {
          state.losTab = btn.dataset.tab;
          await ctx.refresh();
          return;
        }
        if (act === 'unlock-webauthn') {
          btn.disabled = true;
          const out = await webauthnAuthenticate('vault');
          state.token = out.stepup.token;
          state.expiresAt = Date.now() + out.stepup.expires_in * 1000;
          state.enrolled = true;
          state.accepted = true;
          state.lockHidden = false;
          if (res) res.innerHTML = '<div class="notice ok">Verifikasi sidik jari berhasil. Rincian data dibuka selama 10 menit.</div>';
          toast('Rincian data nominatif dibuka');
          await ctx.refresh();
          startCountdown(ctx);
          return;
        }
        if (act === 'unlock-face') {
          btn.disabled = true;
          await runFaceFlow(ctx, 'unlock');
          return;
        }
        if (act === 'enroll-face') {
          btn.disabled = true;
          await runFaceFlow(ctx, 'enroll');
          return;
        }
        if (act === 'lock') {
          btn.disabled = true;
          lockVault(ctx);
          try {
            await apiPost('/api/vault/lock', {});
          } catch (e) {
            toast('Akses data nominatif ditutup pada perangkat ini.', 'error');
          }
          toast('Akses data nominatif ditutup');
          await ctx.refresh();
          return;
        }
        if (act === 'enroll-webauthn') {
          btn.disabled = true;
          const out = await webauthnRegister('Perangkat WebAuthn');
          state.enrolled = true;
          state.accepted = false;
          state.lockHidden = false;
          if (res) res.innerHTML = '<div class="notice ok">Perangkat sidik jari berhasil didaftarkan.</div>';
          toast('Perangkat biometrik berhasil didaftarkan');
          await ctx.refresh();
          await showAcceptModal(ctx);
          return;
        }
        if (act === 'revoke') {
          const ok = await confirmDialog('Cabut perangkat biometrik?', 'Perangkat ini tidak lagi dapat membuka brankas data nominatif.', 'Cabut', true);
          if (!ok) return;
          await apiPost('/api/biometric/revoke', { id: btn.dataset.id });
          toast('Perangkat dicabut');
          await ctx.refresh();
          return;
        }
        if (act === 'revokeface') {
          const ok = await confirmDialog('Cabut profil Face Recognition?', 'Profil ini tidak lagi dapat membuka brankas data nominatif.', 'Cabut', true);
          if (!ok) return;
          await apiPost('/api/face/revoke', { id: btn.dataset.id });
          toast('Profil Face Recognition dicabut');
          await ctx.refresh();
          return;
        }
        if (act === 'los-page') {
          state.los.page = Number(btn.dataset.page || 1);
          await ctx.refresh();
          return;
        }
        if (act === 'los-search') {
          state.losSearch = (document.getElementById('los-search')?.value || '').trim();
          state.los.page = 1;
          await ctx.refresh();
          return;
        }
        if (act === 'los-filter-gender') {
          state.losGender = btn.dataset.value || '';
          state.los.page = 1;
          await ctx.refresh();
          return;
        }
        if (act === 'showtable') {
          state.accepted = true;
          state.lockHidden = false;
          state.acceptPromptDone = true;
          await ctx.refresh();
          return;
        }
      } catch (err) {
        if (res) res.innerHTML = '<div class="notice bad">' + esc(err.message) + '</div>';
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const el = e.target.closest('#los-search');
      if (!el) return;
      e.preventDefault();
      state.losSearch = el.value.trim();
      state.los.page = 1;
      ctx.refresh();
    });
    if (state.token) startCountdown(ctx);
  },
};

function lockVault(ctx) {
  state.token = null;
  state.expiresAt = 0;
  state.accepted = false;
  state.lockHidden = true;
  state.unlocked = false;
  state.los.rows = [];
  state.los.total = 0;
  state.los.page = 1;
  state.los.locked = true;
  state.records = [];
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

function losPanel(los, counts, search, gender) {
  const pages = [];
  const from = Math.max(1, los.page - 2);
  const to = Math.min(los.pages, from + 4);
  for (let i = from; i <= to; i++) pages.push(i);
  const genderOptions = Object.entries(counts?.by_gender || {});
  return '<div class="sec-los-toolbar">' +
    '<input id="los-search" class="input" placeholder="Cari nama, email, telepon, NIK, ID Pengajuan, atau loan code..." value="' + esc(search) + '">' +
    '<button class="btn primary" data-sec="los-search">Cari</button>' +
    '<div class="row wrap sec-filter">' +
    '<button class="btn sm ' + (gender === '' ? 'primary' : '') + '" data-sec="los-filter-gender" data-value="">Semua gender</button>' +
    genderOptions.map(([k, v]) => '<button class="btn sm ' + (gender === k ? 'primary' : '') + '" data-sec="los-filter-gender" data-value="' + esc(k) + '">' + esc(k) + ' (' + num(v) + ')</button>').join('') +
    '</div>' +
    '</div>' +
    '<div class="row wrap sec-los-meta">' +
    '<span class="pill info">Total ' + num(los.total) + ' record</span>' +
    '<span class="pill ok">ACTIVE</span>' +
    '<span class="small muted">Halaman ' + num(los.page) + ' dari ' + num(los.pages) + ' · ' + num(los.size) + ' baris per halaman</span>' +
    '</div>' +
    losTable(los.rows, los.locked) +
    '<div class="row wrap sec-pager">' +
    '<button class="btn sm" data-sec="los-page" data-page="' + Math.max(1, los.page - 1) + '"' + (los.page <= 1 ? ' disabled' : '') + '>Sebelumnya</button>' +
    pages.map((p) => '<button class="btn sm ' + (p === los.page ? 'primary' : '') + '" data-sec="los-page" data-page="' + p + '">' + num(p) + '</button>').join('') +
    '<button class="btn sm" data-sec="los-page" data-page="' + Math.min(los.pages, los.page + 1) + '"' + (los.page >= los.pages ? ' disabled' : '') + '>Berikutnya</button>' +
    '</div>';
}

function startCountdown(ctx) {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  const tick = async () => {
    const el = document.getElementById('vault-countdown');
    const left = Math.max(0, Math.round((state.expiresAt - Date.now()) / 1000));
    if (el) el.textContent = left + ' detik';
    if (left <= 0 && state.token) {
      lockVault(ctx);
      toast('Masa akses berakhir. Rincian data ditutup otomatis.');
      await ctx.refresh();
    }
  };
  tick();
  state.countdownTimer = setInterval(tick, 1000);
}

export const SECURITY_VIEWS = { keamanan, brankas };
