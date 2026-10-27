
import { STATUS_LABEL } from './shared/constants.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const rp = (n) => (n === null || n === undefined || Number.isNaN(n) ? '–' : `Rp${Math.round(n).toLocaleString('id-ID')}`);
export const num = (n) => Number(n || 0).toLocaleString('id-ID');
export const pct = (x, d = 1) => `${(x * 100).toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d })}%`;
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const tgl = (s) => {
  if (!s) return '–';
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};
export const tglJam = (s) => (s ? `${tgl(s)} ${String(s).slice(11, 16)}` : '–');

const TONE = {
  SUBMITTED: 'info', VERIFIED: 'info', ANALYZED: 'warn', APPROVED: 'accent', REJECTED: 'bad', LISTED: 'accent', EXPIRED: '',
  FUNDED: 'warn', AKAD_SIGNED: 'info', DISBURSING: 'info', GRACE: 'accent', REPAYING: 'ok', FAILED_DEPARTURE: 'bad',
  LOSS_HANDLING: 'bad', PAID_OFF: 'ok', CLOSED_BUYBACK: 'warn', CLOSED_LOSS: 'bad', CANCELLED: '',
};
export const statusPill = (s) => `<span class="pill ${TONE[s] || ''}">${esc(STATUS_LABEL[s] || s)}</span>`;
export const bucketPill = (b, dpd) => {
  const tone = { lancar: 'ok', perhatian: 'warn', kurang: 'warn', diragukan: 'bad', macet: 'bad' }[b.key];
  return `<span class="pill ${tone}">${esc(b.label)}${dpd ? ` · ${dpd} hari` : ''}</span>`;
};
export const pill = (text, tone = '') => `<span class="pill ${tone}">${esc(text)}</span>`;
export const grade = (g) => (g ? `<span class="grade ${esc(g)}" title="Grade risiko ${esc(g)}">${esc(g)}</span>` : '<span class="chip">–</span>');
export const progress = (p) => `<div class="progress" role="progressbar" aria-valuenow="${Math.round(p * 100)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${Math.min(100, Math.round(p * 100))}%"></span></div>`;

export function table(cols, rows, { empty = 'Belum ada data.', rowAttr } = {}) {
  if (!rows.length) return `<div class="card flat empty">${esc(empty)}</div>`;
  const head = cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r) => `<tr ${rowAttr ? rowAttr(r) : ''} class="${r.__class || ''}">${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
export const kv = (pairs) => `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
export const stat = (label, value, hint = '') => `<div class="card stat"><span class="label">${esc(label)}</span><span class="value">${value}</span>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
export const pageHead = (eyebrow, title, desc = '', actions = '') => `<div class="page-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1>${desc ? `<p>${desc}</p>` : ''}</div>${actions ? `<div class="row">${actions}</div>` : ''}</div>`;
export const empty = (title, body = '', action = '') => `<div class="card empty"><strong>${esc(title)}</strong>${body ? `<div>${body}</div>` : ''}${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;
export const field = (id, label, input, help = '') => `<div class="field"><label for="${id}">${esc(label)}</label>${input}${help ? `<span class="help">${help}</span>` : ''}</div>`;
export const inp = (id, { type = 'text', value = '', required = false, min, max, step, placeholder = '', name } = {}) =>
  `<input id="${id}" name="${name || id}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} ${step !== undefined ? `step="${step}"` : ''} placeholder="${esc(placeholder)}">`;
export const sel = (id, options, value = '', name) => `<select id="${id}" name="${name || id}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;


let toastWrap;
export function toast(msg, kind = 'ok') {
  if (!toastWrap) { toastWrap = document.createElement('div'); toastWrap.className = 'toast-wrap'; toastWrap.setAttribute('role', 'status'); document.body.appendChild(toastWrap); }
  const t = document.createElement('div');
  t.className = `toast ${kind === 'error' ? 'error' : ''}`;
  t.textContent = msg;
  toastWrap.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3500);
}

export function modal(html, { wide = false } = {}) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    back.addEventListener('click', (e) => {
      if (e.target === back) return close(null);
      const b = e.target.closest('[data-modal]');
      if (b) close(b.dataset.modal === 'ok' ? true : b.dataset.modal === 'cancel' ? null : b.dataset.modal);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
    back.querySelector('[data-modal="ok"], [data-modal="cancel"]')?.focus();
  });
}
export const confirmDialog = (title, body, okLabel = 'Lanjutkan', danger = false) =>
  modal(`<h3>${esc(title)}</h3><div class="muted">${body}</div><div class="row" style="justify-content:flex-end"><button class="btn" data-modal="cancel">Batal</button><button class="btn ${danger ? 'danger' : 'primary'}" data-modal="ok">${esc(okLabel)}</button></div>`);

export async function copyText(text, el) {
  try { await navigator.clipboard.writeText(text); toast('Disalin ke papan klip'); }
  catch {
    if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    toast('Teks sudah dipilih; salin dengan Ctrl+C');
  }
}

export const formData = (form) => {
  const fd = new FormData(form);
  const o = {};
  for (const [k, v] of fd.entries()) {
    if (o[k] !== undefined) o[k] = [].concat(o[k], v); else o[k] = v;
  }
  return o;
};
export const money = (v) => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;

const ERROR_PATTERNS = [
  [/NotAllowedError/i, 'Pendaftaran sidik jari dibatalkan atau perangkat belum mendukung fitur ini.'],
  [/InvalidStateError/i, 'Ada permintaan biometrik yang masih menunggu. Silakan coba lagi.'],
  [/NotSupportedError/i, 'Perangkat ini belum mendukung biometrid. Silakan gunakan Face Recognition.'],
  [/SecurityError/i, 'Koneksi aman diperlukan untuk memakai sidik jari. Buka aplikasi melalui alamat https.'],
  [/AbortError/i, 'Permintaan dibatalkan. Silakan coba lagi.'],
  [/is not defined/i, 'Terjadi kesalahan pada aplikasi. Silakan muat ulang halaman.'],
  [/Permission denied|izin kamera|NotAllowedError/i, 'Akses kamera belum diizinkan. Mohon aktifkan kamera pada browser Anda.'],
  [/getUserMedia|NotFoundError|OverconstrainedError|DeviceNotFound/i, 'Kamera tidak ditemukan atau sedang digunakan aplikasi lain. Mohon tutup aplikasi lain lalu coba kembali.'],
  [/kamera/i, 'Kamera tidak dapat diakses. Mohon pastikan kamera terhubung dan sudah diizinkan.'],
  [/fetch failed|NetworkError|Failed to fetch|ECONNREFUSED|ENOTFOUND/i, 'Koneksi ke server terputus. Mohon periksa jaringan Anda lalu coba lagi.'],
  [/timeout/i, 'Permintaan terlalu lama. Mohon coba lagi.'],
  [/WAF_BLOCK/i, 'Permintaan ditolak oleh sistem keamanan. Silakan periksa kembali isian Anda.'],
  [/unauthorized|401/i, 'Sesi Anda telah berakhir. Silakan masuk kembali.'],
  [/forbidden|403/i, 'Anda tidak memiliki hak akses untuk tindakan ini.'],
  [/too many|429/i, 'Terlalu banyak percobaan. Mohon tunggu beberapa saat lalu coba lagi.'],
  [/internal server|500|503|502/i, 'Layanan sedang mengalami kendala. Silakan coba beberapa saat lagi.'],
  [/SyntaxError|ReferenceError|TypeError|RangeError/i, 'Terjadi kesalahan pada aplikasi. Silakan muat ulang halaman.'],
  [/duplicate|already exists/i, 'Data tersebut sudah terdaftar.'],
  [/required|wajib diisi/i, 'Mohon lengkapi kolom yang masih kosong.'],
  [/tidak sesuai|tidak cocok/i, 'Data yang dimasukkan tidak sesuai dengan data kami.'],
  [/salah|ditolak/i, 'Data yang dimasukkan tidak dapat diterima. Mohon periksa kembali.'],
];

export function friendlyError(e) {
  if (e && e.fromServer && e.message) return String(e.message);
  const raw = String((e && (e.message || e.error)) || e || '').trim();
  if (!raw) return 'Terjadi kesalahan yang tidak diketahui. Silakan coba lagi.';
  for (const [re, msg] of ERROR_PATTERNS) {
    if (re.test(raw)) return msg;
  }
  return 'Permintaan tidak dapat diproses. Silakan coba kembali.';
}
