import { detectMode, serverApi, demoApi, clearStaleSession, apiBaseUrl } from './api.js';
import { esc, toast, formData, confirmDialog, modal, table, field, inp, friendlyError } from './ui.js';
import { ROLE_LABEL, BACKOFFICE } from './shared/constants.js';
import { VIEWS as BASE_VIEWS } from './views.js';
import { SECURITY_VIEWS } from './security-views.js';

const VIEWS = { ...BASE_VIEWS, ...SECURITY_VIEWS };

const ctx = { api: null, me: null, settings: null, route: 'beranda', params: {}, refresh: null, go: null, otp: null };

const root = document.getElementById('app');

const NAV = [
  { group: 'Pendana', role: 'pendana', items: [['beranda', 'Beranda'], ['pasar', 'Peluang pendanaan'], ['portofolio', 'Portofolio'], ['dompet', 'Dompet & VA'], ['keamanan', 'Keamanan & Firewall (WAF)', ['admin', 'manajer', 'pendana']], ['brankas', 'Brankas Data Nominatif', ['admin', 'manajer', 'finance', 'pendana']], ['audit', 'Jejak Audit', ['admin', 'manajer', 'pendana']]] },
  { group: 'Penerima', role: 'penerima', items: [['saya', 'Pembiayaan saya'], ['ajukan', 'Ajukan pembiayaan']] },
  { group: 'Back-office', roles: BACKOFFICE, items: [
    ['dasbor', 'Dasbor', BACKOFFICE], ['antrian', 'Pengajuan & pembiayaan', BACKOFFICE], ['penagihan', 'Pemantauan & penagihan', ['analis', 'komite', 'finance', 'manajer', 'admin']],
    ['pencairan', 'Pencairan', ['finance', 'manajer', 'admin']], ['penarikan', 'Penarikan dana', ['finance', 'manajer', 'admin']],
    ['pembayaran', 'Pembayaran VA', ['finance', 'manajer', 'admin']], ['rekonsiliasi', 'Rekonsiliasi', ['finance']],
    ['keamanan', 'Keamanan & Firewall (WAF)', ['admin', 'manajer']], ['brankas', 'Brankas Data Nominatif', ['admin', 'manajer', 'finance']],
    ['buku', 'Buku besar', ['finance', 'manajer', 'admin']], ['anggota', 'Anggota', ['admin', 'analis', 'manajer', 'finance']],
    ['mitra', 'Mitra LPK/SO', ['admin', 'manajer', 'analis']], ['audit', 'Jejak audit', ['admin', 'manajer']], ['pengaturan', 'Pengaturan', ['admin']],
  ] },
  { group: 'Akun', items: [['notifikasi', 'Notifikasi'], ['akun', 'Profil & keamanan']] },
];

const roles = () => ctx.me?.user?.roles || [];
const hasAny = (list) => roles().some((r) => list.includes(r));

function defaultRoute() {
  if (hasAny(BACKOFFICE)) return 'dasbor';
  if (roles().includes('pendana')) return 'beranda';
  if (roles().includes('penerima')) return 'saya';
  return 'akun';
}

function navHtml() {
  const counts = { notifikasi: ctx.me?.unread || 0 };
  return NAV.map((g) => {
    if (g.role && !roles().includes(g.role)) return '';
    if (g.roles && !hasAny(g.roles)) return '';
    const items = g.items.filter((it) => !it[2] || hasAny(it[2]));
    if (!items.length) return '';
    return `<div class="nav-group">${esc(g.group)}</div><nav class="nav">${items.map(([r, l]) => `<a href="#${r}" data-route="${r}" class="${ctx.route === r || (ctx.route === 'pembiayaan' && r === ctx.from) ? 'active' : ''}">${esc(l)}${counts[r] ? `<span class="count">${counts[r]}</span>` : ''}</a>`).join('')}</nav>`;
  }).join('');
}

async function demoBar() {
  if (ctx.api.mode !== 'demo') return '';
  const ps = await ctx.api.personas();
  const groups = {};
  for (const p of ps) { const key = p.roles.some((r) => BACKOFFICE.includes(r)) ? 'Pengelola KMH' : 'Anggota'; (groups[key] ||= []).push(p); }
  const opts = Object.entries(groups).map(([g, list]) => `<optgroup label="${g}">${list.map((p) => `<option value="${p.id}" ${p.id === ctx.api.getPersona() ? 'selected' : ''}>${esc(p.name)} — ${p.roles.map((r) => ROLE_LABEL[r]).join(', ')}${p.kyc !== 'approved' ? ' (belum terverifikasi)' : ''}</option>`).join('')}</optgroup>`).join('');
  return `<div class="demo-bar" aria-label="Kontrol demo">
    <span class="tag">Mode demo</span>
    <label class="row small" for="persona">Masuk sebagai <select id="persona" style="width:auto;max-width:min(320px,70vw);padding:5px 8px">${opts}</select></label>
    <span class="clock small">Tanggal sistem <span class="date">${esc(ctx.me?.today || ctx.settings?.today || '')}</span>
      <button class="btn sm" data-act="time" data-days="1">+1 hari</button><button class="btn sm" data-act="time" data-months="1">+1 bulan</button></span>
    <button class="btn sm ghost" data-act="reset-demo">Atur ulang data</button>
  </div>`;
}

async function loadMe() {
  try { ctx.me = await ctx.api.call('me'); } catch (e) { if (e.status === 401) ctx.me = null; else throw e; }
}

export async function render() {
  const view = VIEWS[ctx.route] || VIEWS.beranda;
  if (!ctx.me) return renderAuth();
  if (view.roles && !hasAny(view.roles)) { ctx.route = defaultRoute(); return render(); }
  let body;
  try { body = await view.render(ctx); } catch (e) { body = `<div class="notice bad">${esc(friendlyError(e))}</div>`; }
  const u = ctx.me.user;
  root.innerHTML = `
    <div id="sec-banner"></div>
    <div id="toast-host"></div>
    <div class="shell">
      <aside class="rail" id="rail">
        <div class="brand"><div class="brand-mark brand-mark-img"><img src="/KMH.png" alt="Logo KMH"></div><div><div class="brand-name">KMH Pendanaan</div><div class="brand-sub">P2P Syariah · Musyarakah</div></div></div>
        ${navHtml()}
        <div class="rail-foot">Koperasi Kita Miraino Hikari<br>Platform internal anggota</div>
      </aside>
      <div class="main">
        ${await demoBar()}
        <header class="topbar">
          <button class="btn sm menu-btn" data-act="menu" aria-label="Buka menu">Menu</button>
          <div class="small muted">${esc(u.member_no)} · ${u.roles.map((r) => ROLE_LABEL[r]).join(', ')}</div>
          <div class="who"><strong>${esc(u.name)}</strong>${ctx.api.mode === 'server' ? '<button class="btn sm" data-act="logout">Keluar</button>' : ''}</div>
        </header>
        <main class="content" id="content">${body}</main>
      </div>
    </div>`;
  view.after?.(ctx, document.getElementById('content'));
}

function renderOtpStage() {
  const s = ctx.otp || {};
  const u = s.user || {};
  const setup = Boolean(s.setup_required);
  root.innerHTML = `<div class="auth"><div class="card stack">
    <div class="brand" style="border:0;padding:0;margin:0"><div class="brand-mark brand-mark-img"><img src="/KMH.png" alt="Logo KMH"></div><div><div class="brand-name">KMH Pendanaan</div><div class="brand-sub muted">P2P Syariah antar anggota</div></div></div>
    <h2 style="font-size:18px;margin:0">Verifikasi 2FA Google Authenticator</h2>
    <p class="small muted" style="margin:0">Selamat datang <strong>${esc(u.name || '')}</strong>. Masukkan kode 6 digit dari aplikasi Google Authenticator pada ponsel Anda untuk melanjutkan.</p>
    ${setup ? `<div class="row wrap twofa-link"><img class="qr-2fa" src="${esc(s.qr || '')}" alt="QR Code Google Authenticator"><div class="twofa-link-text"><div class="section-title">Hubungkan ponsel Anda</div><p class="small muted" style="margin:0 0 6px">Buka Google Authenticator, pilih tombol tambah, lalu pindai QR di samping. Bila pindai tidak tersedia, masukkan kode rahasia berikut secara manual:</p><div class="mono secret-box">${esc(s.secret || '')}</div></div></div>` : ''}
    <form class="form" data-form="otp">
      ${field('otp-code', 'Kode 6 digit', inp('otp-code', { name: 'code', required: true, maxlength: 6, placeholder: '000000' }))}
      <button class="btn primary" type="submit">Verifikasi &amp; Masuk</button>
      <button class="btn ghost" type="button" data-act="otp-back">Kembali</button>
    </form>
  </div></div>`;
}

function renderAuth() {
  if (ctx.otp) return renderOtpStage();
  const reg = ctx.route === 'auth/register';
  root.innerHTML = `<div class="auth"><div class="card stack">
    <div class="brand" style="border:0;padding:0;margin:0"><div class="brand-mark brand-mark-img"><img src="/KMH.png" alt="Logo KMH"></div><div><div class="brand-name">KMH Pendanaan</div><div class="brand-sub muted">P2P Syariah antar anggota</div></div></div>
    ${reg ? `<h2 style="font-size:18px">Daftar sebagai anggota</h2>
      <form class="form" data-form="register"><div class="field"><label for="r-no">Nomor anggota KMH</label><input id="r-no" name="member_no" type="text" required></div>
        <div class="field"><label for="r-name">Nama lengkap sesuai KTP</label><input id="r-name" name="name" type="text" required></div>
        <div class="field"><label for="r-email">Email</label><input id="r-email" name="email" type="email" required></div>
        <div class="field"><label for="r-phone">Nomor HP/WhatsApp</label><input id="r-phone" name="phone" type="tel" required></div>
        <div class="field"><label for="r-pass">Kata sandi (min. 8 karakter)</label><input id="r-pass" name="password" type="password" minlength="8" required></div>
        <div class="field"><span class="small muted">Saya ingin</span><div class="checks"><label><input type="checkbox" name="roles" value="pendana" checked> Mendanai</label><label><input type="checkbox" name="roles" value="penerima"> Mengajukan pembiayaan</label></div></div>
        <button class="btn primary" type="submit">Kirim pendaftaran</button>
      </form>
      <p class="small muted">Sudah punya akun? <a href="#auth/login" data-route="auth/login">Masuk</a></p>`
    : `<h2 style="font-size:18px">Masuk</h2>
      <form class="form" data-form="login">
        <div class="field"><label for="l-email">Email</label><input id="l-email" name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="l-pass">Kata Sandi</label><input id="l-pass" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary" type="submit">Masuk</button>
      </form>
      <p class="small muted">Belum punya akun? <a href="#auth/register" data-route="auth/register">Daftar di sini</a></p>`}
  </div></div>`;
}

function go(route, params = {}) {
  if (ctx.route !== 'pembiayaan') ctx.from = ctx.route;
  ctx.route = route; ctx.params = params;
  const token = params.id ? `${route}-${params.id}` : route;
  if (location.hash !== `#${token}`) history.replaceState(null, '', `#${token}`);
  document.getElementById('rail')?.classList.remove('open');
  window.scrollTo(0, 0);
  return render();
}
ctx.go = go;
ctx.refresh = async () => { await loadMe(); await render(); };

window.addEventListener('hashchange', () => {
  const h = parseHash();
  const isAuth = (r) => String(r || '').startsWith('auth/');
  if (!ctx.me) {
    ctx.route = ctx.otp ? 'auth/2fa' : 'auth/login';
    syncHash(ctx.route);
    renderAuth();
    return;
  }
  if (isAuth(h.route)) {
    ctx.route = defaultRoute();
    syncHash(ctx.route);
    render();
    return;
  }
  ctx.route = h.route;
  ctx.params = h.params;
  render();
});

function parseHash() {
  const raw = String(location.hash || '').replace(/^#\/?/, '');
  if (!raw) return { route: 'auth/login', params: {} };
  const parts = raw.split('/').filter(Boolean);
  if (parts[0] === 'auth') return { route: 'auth/' + (parts[1] || 'login'), params: {} };
  const m = /^([a-z]+)(?:-(\d+))?$/.exec(parts[0] || '');
  if (!m) return { route: 'auth/login', params: {} };
  return { route: m[1], params: m[2] ? { id: Number(m[2]) } : {} };
}

function syncHash(route, params = {}) {
  const token = params.id ? route + '-' + params.id : route;
  if (String(location.hash || '').replace(/^#/, '') !== token) {
    history.replaceState(null, '', '#' + token);
  }
}


root.addEventListener('click', async (e) => {
  const link = e.target.closest('[data-route]');
  if (link) { e.preventDefault(); const r = link.dataset.route; return go(r, link.dataset.id ? { id: Number(link.dataset.id) } : {}); }
  const row = e.target.closest('tr[data-open]');
  if (row && !e.target.closest('button, a, input, select')) return go('pembiayaan', { id: Number(row.dataset.open) });
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  try {
    if (act === 'menu') return document.getElementById('rail').classList.toggle('open');
    if (act === 'logout') {
      const answer = await modal('<p>Apakah yakin anda ingin keluar?</p><div class="row" style="justify-content:flex-end"><button class="btn" data-modal="batal">Batal</button><button class="btn danger" data-modal="ya">Ya, Keluar</button></div>');
      if (answer !== 'ya') return;
      await ctx.api.logout();
      ctx.me = null;
      ctx.otp = null;
      ctx.route = 'auth/login';
      syncHash('auth/login');
      return render();
    }
    if (act === 'otp-back') { ctx.otp = null; return renderAuth(); }
    if (act === 'time') { const r = await ctx.api.call('advanceDate', { days: Number(btn.dataset.days || 0), months: Number(btn.dataset.months || 0) }); toast(`Tanggal sistem: ${r.today}`); return ctx.refresh(); }
    if (act === 'reset-demo') {
      if (!(await confirmDialog('Atur ulang data demo?', 'Semua transaksi yang Anda buat di demo ini akan dihapus dan data contoh dibuat ulang.', 'Atur ulang', true))) return;
      ctx.api.reset(); location.hash = ''; location.reload(); return;
    }
    const view = VIEWS[ctx.route];
    const handler = view?.actions?.[act];
    if (handler) {
      btn.disabled = true;
      const msg = await handler(ctx, btn);
      if (msg) toast(msg);
      if (msg !== false) await ctx.refresh();
    }
  } catch (err) { toast(friendlyError(err), 'error'); } finally { btn.disabled = false; }
});

root.addEventListener('change', async (e) => {
  if (e.target.id === 'persona') { ctx.api.setPersona(e.target.value); await loadMe(); return go(defaultRoute()); }
  const view = VIEWS[ctx.route];
  view?.onChange?.(ctx, e);
});
root.addEventListener('input', (e) => { VIEWS[ctx.route]?.onInput?.(ctx, e); });

root.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const name = form.dataset.form;
  const data = formData(form);
  const submit = form.querySelector('[type=submit]');
  if (submit) submit.disabled = true;
  try {
    if (name === 'login') {
      const res = await ctx.api.login(data.email, data.password);
      if (res && res.need_otp) {
        ctx.otp = res;
        ctx.route = 'auth/2fa';
        syncHash('auth/2fa');
        renderAuth();
        return;
      }
      await loadMe(); return go(defaultRoute());
    }
    if (name === 'otp') {
      const btn = form.querySelector('[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const res = await ctx.api.verifyOtp(ctx.otp.challenge, data.code);
        ctx.otp = null;
        toast('Selamat datang, ' + (res?.user?.name || ''));
        await loadMe();
        return go(defaultRoute());
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    if (name === 'register') {
      await ctx.api.register({ ...data, roles: [].concat(data.roles || []) });
      toast('Pendaftaran terkirim. Admin KMH akan memverifikasi data Anda.');
      ctx.route = 'auth/login'; syncHash('auth/login'); return renderAuth();
    }
    const handler = VIEWS[ctx.route]?.forms?.[name];
    if (!handler) return;
    const msg = await handler(ctx, data, form);
    if (msg) toast(msg);
    if (msg !== false) await ctx.refresh();
  } catch (err) { toast(friendlyError(err), 'error'); } finally { if (submit) submit.disabled = false; }
});


(async function start() {
  root.innerHTML = '<div class="auth"><div class="card">Memuat…</div></div>';
  clearStaleSession();
  const mode = await detectMode();
  ctx.api = mode === 'server' ? serverApi() : await demoApi();
  if (mode === 'server') { try { const h = await (await fetch(apiBaseUrl('api/health'))).json(); ctx.serverSim = !!h.simulator; } catch { ctx.serverSim = false; } }
  if (mode === 'demo' && !ctx.api.getPersona()) {
    const ps = await ctx.api.personas();
    ctx.api.setPersona(ps.find((p) => p.name.startsWith('Ani'))?.id || ps[0].id);
  }
  ctx.settings = await ctx.api.call('getSettings').catch(() => null);
  await loadMe();
  const h = parseHash();
  const isAuth = (r) => String(r || '').startsWith('auth/');
  if (h && (VIEWS[h.route] || isAuth(h.route))) { ctx.route = h.route; ctx.params = h.params; }
  else ctx.route = ctx.me ? defaultRoute() : 'auth/login';
  if (ctx.me && isAuth(ctx.route)) ctx.route = defaultRoute();
  if (!ctx.me) ctx.route = ctx.otp ? 'auth/2fa' : 'auth/login';
  syncHash(ctx.route, ctx.params);
  await render();
})().catch((e) => { root.innerHTML = `<div class="auth"><div class="card notice bad">Aplikasi gagal dimuat: ${esc(e.message)}</div></div>`; });
