
import {
  esc, rp, num, pct, tgl, tglJam, statusPill, bucketPill, pill, grade, progress, table, kv, stat, pageHead, empty,
  field, inp, sel, confirmDialog, modal, copyText, money,
} from './ui.js';
import { ST, STATUS_LABEL, COST_COMPONENTS, ROLES, ROLE_LABEL, ACC_LABEL, BACKOFFICE, VAULT_TOTAL_DANA, VAULT_LOS_KONTRAK } from './shared/constants.js';

const roles = (ctx) => ctx.me?.user?.roles || [];
const has = (ctx, ...r) => roles(ctx).some((x) => r.includes(x));
const call = (ctx, name, args) => ctx.api.call(name, args);
const finRow = (r) => `data-open="${r.id}" class="link-row"`;
const isDemo = (ctx) => ctx.api.mode === 'demo';
const vaultInfo = (me) => {
  const v = (me && me.vault) || {};
  const total = Number(v.total || 0);
  const contracts = Number(v.los_contracts || VAULT_LOS_KONTRAK);
  if (!v.accepted || !total) return { active: false, total: 0, contracts };
  return { active: true, total, contracts };
};
const vaultAmount = (me) => {
  const v = vaultInfo(me);
  return v.active ? v.total : null;
};
const vaultStat = (me) => {
  const v = vaultInfo(me);
  if (!v.active) return '';
  return stat('Total Dana Pendanaan', rp(v.total), `${num(v.contracts)} kontrak pembiayaan LOS`);
};
const vaultBanner = (me) => {
  const v = vaultInfo(me);
  if (!v.active) return '';
  return `<div class="card stack vault-total" style="margin-top:16px">
    <div class="row between"><div class="section-title" style="margin:0">Total Dana Pendanaan</div><span class="pill ok">${num(v.contracts)} Kontrak Pembiayaan LOS</span></div>
    <div class="vault-amount">${rp(v.total)}</div>
    <div class="small muted">Dana kelolaan komitmen pendanaan pada 560 kontrak pembiayaan Data Nominatif LOS. Rincian data tersedia pada menu Brankas Data Nominatif.</div>
  </div>`;
};
const simOn = (ctx) => isDemo(ctx) || ctx.serverSim;

function vaBox(va, label = 'Nomor Virtual Account') {
  if (!va) return '';
  return `<div class="va-box"><button class="btn sm" data-act="copy" data-text="${esc(va)}">Salin</button><div class="va-text"><div class="small muted">${esc(label)}</div><div class="va" id="va-${esc(va)}">${esc(va.replace(/(\d{4})(?=\d)/g, '$1 '))}</div></div></div>`;
}
const copyAction = async (_ctx, btn) => { await copyText(btn.dataset.text, document.getElementById(`va-${btn.dataset.text}`)); return false; };

function simForm(ctx, va, suggested, label = 'Konfirmasi Top-up VA') {
  if (!simOn(ctx) || !va) return '';
  return `<form class="inline-form" data-form="simulate" style="margin-top:10px">
    <input type="hidden" name="va_number" value="${esc(va)}">
    ${field(`sim-${va}`, label, inp(`sim-${va}`, { name: 'amount', value: suggested ? num(suggested) : '', placeholder: 'Nominal' }), 'Dana top-up dikreditkan secara otomatis ke saldo dompet investor setelah pembayaran Virtual Account terverifikasi.')}
    <button class="btn" type="submit">Konfirmasi Top-up VA</button></form>`;
}
const simulateForm = async (ctx, d) => {
  const r = await call(ctx, 'simulatePayment', { va_number: d.va_number, amount: money(d.amount) });
  return r.event?.status === 'processed' ? `Pembayaran Rp${num(money(d.amount))} diterima dan diproses` : `Pembayaran tercatat dengan status ${r.event?.status}`;
};


const beranda = {
  roles: ['pendana'],
  async render(ctx) {
    const me = ctx.me;
    if (me.user.kyc_status !== 'approved') return pageHead('Pendana', `Halo, ${me.user.name}`) + `<div class="notice warn">Akun Anda sedang diverifikasi admin KMH. Setelah disetujui, nomor Virtual Account untuk top-up akan tampil di sini.</div>`;
    const [market, port] = await Promise.all([call(ctx, 'listMarketplace'), call(ctx, 'portfolio')]);
    const w = port.wallet;
    const active = port.rows.filter((r) => [ST.GRACE, ST.REPAYING, ST.DISBURSING, ST.AKAD_SIGNED].includes(r.status));
    const watch = port.rows.filter((r) => r.dpd > 0);
    return pageHead('Pendana', `Halo, ${me.user.name.split(' ')[0]}`, 'Ringkasan dana Anda di syirkah pembiayaan KMH.') + `
      <div class="grid ${vaultInfo(me).active ? 'g5' : 'g4'}">
        ${stat('Saldo tersedia', rp(vaultAmount(me) ?? w.available), 'Siap didanakakan atau ditarik')}
        ${stat('Dana terkunci', rp(vaultAmount(me) ?? w.locked), 'Menunggu pembiayaan terdanai penuh')}
        ${stat('Modal tersalur', rp(vaultAmount(me) ?? w.invested), `${active.length} pembiayaan berjalan`)}
        ${stat('Bagi hasil diterima', rp(w.profit_total), `Pokok kembali ${rp(w.principal_returned)}`)}
        ${vaultStat(me)}
      </div>
      ${vaultBanner(me)}
      <div class="split" style="margin-top:16px">
        <div class="stack">
          <div class="section-title">Peluang pendanaan terbuka <a href="#pasar" data-route="pasar" class="small">Lihat semua</a></div>
          ${market.length ? market.slice(0, 3).map((f) => listingCard(f)).join('') : empty('Belum ada pembiayaan yang menggalang dana', 'Anda akan menerima notifikasi saat ada peluang baru.')}
        </div>
        <div class="stack">
          <div class="card stack"><div class="section-title">Top-up saldo</div>
            <p class="small muted" style="margin:0">Transfer dari rekening bank mana pun ke nomor VA pribadi Anda. Saldo bertambah otomatis setelah bank mengonfirmasi.</p>
            ${vaBox(me.va)}${simForm(ctx, me.va, 5000000, 'Konfirmasi Top-up VA')}
          </div>
          ${watch.length ? `<div class="card attention stack"><div class="section-title">Perlu perhatian</div>${watch.map((r) => `<div class="row" style="justify-content:space-between"><a href="#pembiayaan-${r.financing_id}" data-route="pembiayaan" data-id="${r.financing_id}">${esc(r.code)}</a>${bucketPill(r.bucket, r.dpd)}</div>`).join('')}<p class="small muted" style="margin:0">Bagi hasil ikut tertunda selama angsuran terlambat. Tim KMH sedang melakukan penagihan.</p></div>` : ''}
        </div>
      </div>`;
  },
  actions: { copy: copyAction },
  forms: { simulate: simulateForm },
};

function estProfit(f, amount) {
  const memberCapital = f.principal - Math.ceil((f.principal * f.kmh_min_pct) / 100);
  const pool = f.ujrah * (1 - f.protection_pct / 100) * (f.nisbah_investor / 100);
  return Math.floor((pool * amount) / memberCapital);
}
function annualized(f) {
  const memberCapital = f.principal - Math.ceil((f.principal * f.kmh_min_pct) / 100);
  const r = estProfit(f, memberCapital) / memberCapital;
  return { total: r, yearly: (r / (f.grace_months + f.tenor)) * 12 };
}

function listingCard(f) {
  const y = annualized(f);
  return `<article class="card listing">
    <div class="listing-top"><div class="row" style="gap:10px;align-items:flex-start">${grade(f.grade)}<div><h3>${esc(f.purpose)}</h3><div class="small muted">${esc(f.code)} · ${esc(f.partner_name)} · Penerima ${esc(f.borrower_name)}</div></div></div>
      <span class="pill ${f.days_left <= 2 ? 'warn' : 'accent'}">${f.days_left >= 0 ? `${f.days_left} hari lagi` : 'Berakhir'}</span></div>
    <div class="facts">
      <div><span>Kebutuhan</span><span>${rp(f.principal)}</span></div>
      <div><span>Tenor</span><span>${f.grace_months} + ${f.tenor} bln</span></div>
      <div><span>Nisbah pendana</span><span>${f.nisbah_investor}%</span></div>
      <div><span>Perkiraan hasil</span><span>±${pct(y.yearly)} /thn</span></div>
    </div>
    <div class="stack" style="gap:6px">${progress(f.progress)}<div class="row small muted" style="justify-content:space-between"><span>${rp(f.funded)} terkumpul (${pct(f.progress, 0)})</span><span>Sisa ${rp(f.principal - f.funded)}</span></div></div>
    <div class="row" style="justify-content:space-between">${f.my_amount ? `<span class="small">Porsi Anda <strong>${rp(f.my_amount)}</strong></span>` : '<span></span>'}<button class="btn primary" data-route="pembiayaan" data-id="${f.id}">Lihat & danai</button></div>
  </article>`;
}

const pasar = {
  roles: ['pendana'],
  async render(ctx) {
    const list = await call(ctx, 'listMarketplace');
    return pageHead('Pendana', 'Peluang pendanaan', 'Pembiayaan calon peserta magang ke Jepang yang telah dianalisa dan disetujui Komite. Data penerima disamarkan. Hasil bergantung pada pembayaran nyata dan tidak dijamin.') +
      `<div class="grid g2">${list.map(listingCard).join('')}</div>${list.length ? '' : empty('Belum ada peluang terbuka', 'Saat Komite menyetujui pengajuan baru, peluangnya tampil di sini dan Anda mendapat notifikasi.')}`;
  },
};

const portofolio = {
  roles: ['pendana'],
  async render(ctx) {
    const p = await call(ctx, 'portfolio');
    const rows = p.rows;
    const tot = { amount: 0, principal_returned: 0, profit: 0, outstanding: 0 };
    rows.forEach((r) => { if (!r.funding_status.every((s) => s === 'released')) { tot.amount += r.amount; tot.principal_returned += r.principal_returned; tot.profit += r.profit; tot.outstanding += r.outstanding; } });
    const me = ctx.me;
    const vinfo = vaultInfo(me);
    return pageHead('Pendana', 'Portofolio', 'Setiap porsi adalah modal Anda dalam syirkah pembiayaan tertentu.') +
      `<div class="grid ${vinfo.active ? 'g5' : 'g4'}" style="margin-bottom:16px">${stat('Total didanakan', rp(vaultAmount(me) ?? tot.amount))}${stat('Pokok kembali', rp(tot.principal_returned))}${stat('Bagi hasil diterima', rp(tot.profit))}${stat('Sisa modal berjalan', rp(vaultAmount(me) ?? tot.outstanding))}${vaultStat(me)}</div>` +
      (vinfo.active ? `<div class="card stack vault-total" style="margin-bottom:16px"><div class="row between"><div class="section-title" style="margin:0">Portofolio Aktif Pendana</div><span class="pill ok">${num(vinfo.contracts)} Kontrak Pembiayaan LOS</span></div><div class="vault-amount">${rp(vinfo.total)}</div><div class="small muted">Rincian dan alokasi dana tersedia pada menu Brankas Data Nominatif.</div></div>` : '') +
      table([
        { label: 'Pembiayaan', render: (r) => `<strong>${esc(r.code)}</strong>` },
        { label: 'Status', render: (r) => statusPill(r.status) },
        { label: 'Kualitas', render: (r) => (r.schedule_count ? bucketPill(r.bucket, r.dpd) : '<span class="muted">–</span>') },
        { label: 'Angsuran', render: (r) => (r.schedule_count ? `${r.paid_count}/${r.schedule_count}` : '–') },
        { label: 'Porsi', num: true, render: (r) => rp(r.amount) },
        { label: 'Pokok kembali', num: true, render: (r) => rp(r.principal_returned) },
        { label: 'Bagi hasil', num: true, render: (r) => rp(r.profit) },
        { label: 'Sisa modal', num: true, render: (r) => rp(r.outstanding) },
      ], rows.map((r) => ({ ...r, id: r.financing_id })), { rowAttr: finRow, empty: 'Anda belum mendanai pembiayaan apa pun.' });
  },
};

const dompet = {
  roles: ['pendana'],
  async render(ctx) {
    const me = ctx.me;
    if (me.user.kyc_status !== 'approved') return pageHead('Pendana', 'Dompet & VA') + '<div class="notice warn">Dompet aktif setelah akun diverifikasi.</div>';
    const [mut, wds] = await Promise.all([call(ctx, 'walletMutations', { limit: 60 }), call(ctx, 'listWithdrawals', { mine: true })]);
    const w = me.wallet;
    const u = me.user;
    return pageHead('Pendana', 'Dompet & VA', 'Saldo dicatat di buku besar KMH; uangnya berada di rekening penampung terpisah dari kas operasional koperasi.') + `
      <div class="grid ${vaultInfo(me).active ? 'g5' : 'g4'}">${stat('Saldo tersedia', rp(vaultAmount(me) ?? w.available))}${stat('Dana terkunci', rp(vaultAmount(me) ?? w.locked))}${stat('Dalam proses tarik', rp(w.withdrawing))}${stat('Modal tersalur', rp(vaultAmount(me) ?? w.invested))}${vaultStat(me)}</div>
      ${vaultBanner(me)}
      <div class="grid g2" style="margin-top:16px">
        <div class="card stack"><div class="section-title">Top-up</div>${vaBox(me.va)}
          <p class="small muted" style="margin:0">Gunakan menu transfer ke Virtual Account di aplikasi bank Anda. Tidak ada minimum top-up.</p>${simForm(ctx, me.va, 5000000, 'Konfirmasi Top-up VA')}</div>
        <div class="card stack"><div class="section-title">Tarik dana</div>
          ${u.bank_account ? `<p class="small muted" style="margin:0">Ke ${esc(u.bank_name)} ${esc(u.bank_account)} a.n. ${esc(u.bank_holder || u.name)}. Diproses Finance lalu disetujui Manajer.</p>
          <form class="inline-form" data-form="withdraw">${field('wd-amount', 'Nominal', inp('wd-amount', { name: 'amount', placeholder: 'mis. 1.000.000', required: true }))}<button class="btn primary" type="submit">Ajukan penarikan</button></form>`
          : `<div class="notice warn">Lengkapi rekening bank atas nama Anda di <a href="#akun" data-route="akun">Profil</a> sebelum menarik dana.</div>`}
        </div>
      </div>
      <div class="section-title" style="margin-top:20px">Permintaan penarikan</div>
      ${table([{ label: 'Tanggal', render: (r) => tglJam(r.created_at) }, { label: 'Tujuan', key: 'note' }, { label: 'Status', render: (r) => pill({ requested: 'Menunggu Finance', verified: 'Menunggu Manajer', paid: 'Ditransfer', rejected: 'Ditolak' }[r.status], { paid: 'ok', rejected: 'bad' }[r.status] || 'warn') }, { label: 'Nominal', num: true, render: (r) => rp(r.amount) }], wds, { empty: 'Belum ada penarikan.' })}
      <div class="section-title" style="margin-top:20px">Mutasi saldo tersedia</div>
      ${table([{ label: 'Waktu', render: (r) => tglJam(r.at) }, { label: 'Keterangan', key: 'description' }, { label: 'Nominal', num: true, render: (r) => `<span style="color:var(${r.amount < 0 ? '--bad' : '--ok'})">${r.amount < 0 ? '−' : '+'}${rp(Math.abs(r.amount))}</span>` }], mut, { empty: 'Belum ada mutasi.' })}`;
  },
  actions: { copy: copyAction },
  forms: {
    simulate: simulateForm,
    withdraw: async (ctx, d) => { await call(ctx, 'requestWithdrawal', { amount: money(d.amount) }); return 'Permintaan penarikan dikirim ke Finance'; },
  },
};


const saya = {
  roles: ['penerima'],
  async render(ctx) {
    const list = await call(ctx, 'listFinancings', { mine: true });
    const head = pageHead('Penerima', 'Pembiayaan saya', 'Pembiayaan biaya pelatihan dan keberangkatan magang ke Jepang dengan akad Ijarah Multijasa.', '<button class="btn primary" data-route="ajukan">Ajukan pembiayaan</button>');
    if (!list.length) return head + empty('Belum ada pengajuan', 'Siapkan rincian biaya dari LPK/SO dan data penjamin, lalu ajukan pembiayaan.', '<button class="btn primary" data-route="ajukan">Mulai pengajuan</button>');
    return head + `<div class="stack">${list.map((f) => `<div class="card stack">
      <div class="row" style="justify-content:space-between"><div><div class="small muted">${esc(f.code)} · ${esc(f.partner_name)}</div><h3 style="font-size:16px">${esc(f.purpose)}</h3></div>${statusPill(f.status)}</div>
      ${timeline(f.status)}
      <div class="grid g4">
        <div class="stat"><span class="label">Biaya dibiayai</span><span class="value" style="font-size:18px">${rp(f.principal)}</span></div>
        <div class="stat"><span class="label">Ujrah</span><span class="value" style="font-size:18px">${f.ujrah ? rp(f.ujrah) : '–'}</span></div>
        <div class="stat"><span class="label">Sisa pokok</span><span class="value" style="font-size:18px">${rp(f.outstanding)}</span></div>
        <div class="stat"><span class="label">Angsuran</span><span class="value" style="font-size:18px">${f.installment ? rp(f.installment) : '–'}</span><span class="hint">${f.schedule_count ? `${f.paid_count} dari ${f.schedule_count} lunas` : ''}</span></div>
      </div>
      ${f.status === ST.FUNDED ? '<div class="notice info">Dana sudah terkumpul. Baca dan tanda tangani akad untuk melanjutkan ke pencairan.</div>' : ''}
      <div class="row"><button class="btn" data-route="pembiayaan" data-id="${f.id}">Buka rincian</button></div>
    </div>`).join('')}</div>`;
  },
};

const STEPS = [
  ['Diajukan', [ST.SUBMITTED]], ['Verifikasi', [ST.VERIFIED]], ['Analisa & komite', [ST.ANALYZED, ST.APPROVED]], ['Penggalangan', [ST.LISTED, ST.EXPIRED]],
  ['Akad', [ST.FUNDED]], ['Pencairan', [ST.AKAD_SIGNED, ST.DISBURSING]], ['Masa tenggang', [ST.GRACE]], ['Angsuran', [ST.REPAYING, ST.FAILED_DEPARTURE, ST.LOSS_HANDLING, ST.CLOSED_BUYBACK]], ['Selesai', [ST.PAID_OFF, ST.CLOSED_LOSS, ST.CANCELLED]],
];
function timeline(status) {
  if (status === ST.REJECTED) return '<div class="notice bad small">Pengajuan ditolak. Lihat catatan di rincian.</div>';
  const idx = STEPS.findIndex(([, ss]) => ss.includes(status));
  return `<ol class="timeline" aria-label="Tahap pembiayaan">${STEPS.map(([l], i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${esc(l)}</li>`).join('')}</ol>`;
}

const ajukan = {
  roles: ['penerima'],
  async render(ctx) {
    if (ctx.me.user.kyc_status !== 'approved') return pageHead('Penerima', 'Ajukan pembiayaan') + '<div class="notice warn">Pengajuan dapat dibuat setelah akun Anda diverifikasi admin KMH.</div>';
    const partners = await call(ctx, 'listPartners');
    const popts = partners.map((p) => [p.id, `${p.name} (${p.type})`]);
    const row = (i, comp = '', amt = '') => `<div class="inline-form cost-row">
      ${field(`c-comp-${i}`, 'Komponen biaya', sel(`c-comp-${i}`, COST_COMPONENTS.map((c) => [c, c]), comp || COST_COMPONENTS[i % COST_COMPONENTS.length], 'comp'))}
      ${field(`c-amt-${i}`, 'Nominal (Rp)', inp(`c-amt-${i}`, { name: 'amt', value: amt, placeholder: '0' }))}
      ${field(`c-par-${i}`, 'Dibayarkan ke', sel(`c-par-${i}`, popts, '', 'par'))}</div>`;
    return pageHead('Penerima', 'Ajukan pembiayaan', 'Isi sesuai rincian biaya resmi dari LPK/SO. Dana akan dibayarkan langsung ke mitra, bukan tunai.') + `
      <form class="form card" data-form="apply" id="apply-form">
        <div class="section-title">Program</div>
        <div class="grid g2">
          ${field('a-partner', 'LPK/SO utama', sel('a-partner', popts, '', 'partner_id'))}
          ${field('a-purpose', 'Program / bidang magang', inp('a-purpose', { name: 'purpose', required: true, placeholder: 'mis. Magang Jepang – bidang pengolahan makanan' }))}
          ${field('a-company', 'Perusahaan penerima di Jepang', inp('a-company', { name: 'japan_company', placeholder: 'Bila sudah ada' }))}
          ${field('a-job', 'Jenis pekerjaan', inp('a-job', { name: 'japan_job' }))}
          ${field('a-plan', 'Rencana keberangkatan', inp('a-plan', { name: 'departure_plan', placeholder: 'mis. Mei 2027' }))}
          ${field('a-salary', 'Perkiraan gaji bersih per bulan (Rp)', inp('a-salary', { name: 'est_salary', placeholder: 'Setelah pajak, asuransi & asrama' }), 'Dipakai untuk menilai kemampuan bayar.')}
        </div>
        <div class="section-title">Rincian biaya</div>
        <div id="cost-rows" class="stack" style="gap:8px">${row(0)}${row(1)}${row(3)}</div>
        <div class="row" style="justify-content:space-between"><button class="btn sm" type="button" data-act="add-cost">Tambah komponen</button><div>Total pengajuan <strong id="cost-total" class="num">Rp0</strong></div></div>
        <div class="section-title">Penjamin</div>
        <div class="grid g3">
          ${field('a-g-name', 'Nama penjamin', inp('a-g-name', { name: 'guarantor_name', required: true }))}
          ${field('a-g-phone', 'HP penjamin', inp('a-g-phone', { name: 'guarantor_phone', type: 'tel', required: true }))}
          ${field('a-g-rel', 'Hubungan', sel('a-g-rel', [['Ayah', 'Ayah'], ['Ibu', 'Ibu'], ['Suami/Istri', 'Suami/Istri'], ['Saudara kandung', 'Saudara kandung'], ['Lainnya', 'Lainnya']], 'Ayah', 'guarantor_relation'))}
        </div>
        <div class="row"><button class="btn primary" type="submit">Kirim pengajuan</button><span class="small muted">Analis KMH akan menghubungi Anda untuk verifikasi dokumen.</span></div>
      </form>`;
  },
  onInput(_ctx, e) { if (e.target.name === 'amt') updateCostTotal(); },
  actions: {
    'add-cost': async (ctx) => {
      const wrap = document.getElementById('cost-rows');
      const i = wrap.children.length + 10;
      const first = wrap.querySelector('.cost-row');
      const clone = first.cloneNode(true);
      clone.querySelectorAll('[id]').forEach((el) => { el.id = el.id.replace(/\d+$/, i); });
      clone.querySelectorAll('label[for]').forEach((el) => { el.htmlFor = el.htmlFor.replace(/\d+$/, i); });
      clone.querySelector('input').value = '';
      wrap.appendChild(clone);
      return false;
    },
  },
  forms: {
    apply: async (ctx, d) => {
      const comps = [].concat(d.comp || []), amts = [].concat(d.amt || []), pars = [].concat(d.par || []);
      const costs = comps.map((c, i) => ({ component: c, amount: money(amts[i]), partner_id: Number(pars[i]) })).filter((c) => c.amount > 0);
      const f = await call(ctx, 'createApplication', { ...d, partner_id: Number(d.partner_id), est_salary: money(d.est_salary), costs });
      await ctx.go('pembiayaan', { id: f.id });
      return `Pengajuan ${f.code} terkirim`;
    },
  },
};
function updateCostTotal() {
  const t = [...document.querySelectorAll('input[name=amt]')].reduce((a, el) => a + money(el.value), 0);
  const el = document.getElementById('cost-total');
  if (el) el.textContent = rp(t);
}


const pembiayaan = {
  async render(ctx) {
    const id = ctx.params.id;
    if (!id) return empty('Pilih pembiayaan dari daftar');
    const f = await call(ctx, 'getFinancing', { id });
    const back = has(ctx, ...BACKOFFICE);
    const parts = [];
    parts.push(pageHead(f.code, f.purpose, `${esc(f.partner_name)} · Penerima ${esc(f.borrower_name)}${f.borrower_member_no ? ` (${esc(f.borrower_member_no)})` : ''}`,
      `${grade(f.grade)} ${statusPill(f.status)} ${f.schedule_count && f.outstanding ? bucketPill(f.bucket, f.dpd) : ''}`));
    parts.push(`<div class="card" style="margin-bottom:16px">${timeline(f.status)}</div>`);

    const left = [], right = [];
    
    left.push(`<div class="card stack"><div class="section-title">Struktur pembiayaan</div>${kv([
      ['Biaya jasa (pokok)', rp(f.principal)], ['Ujrah (tetap)', f.ujrah ? rp(f.ujrah) : '<span class="muted">Ditetapkan analis</span>'],
      ['Total kewajiban', f.ujrah ? rp(f.principal + f.ujrah) : '–'], ['Tenor', `${f.tenor} bulan setelah tenggang ${f.grace_months} bulan`],
      ['Angsuran', f.installment ? `${rp(f.installment)} / bulan` : '–'], ['Nisbah hasil syirkah', `Pendana ${f.nisbah_investor}% : KMH ${100 - f.nisbah_investor}%`],
      ['Dana Proteksi', `${f.protection_pct}% dari ujrah`], ['Modal KMH minimal', `${f.kmh_min_pct}%`],
      f.first_due ? ['Angsuran pertama', tgl(f.first_due)] : null, ['Sisa pokok', [ST.SUBMITTED, ST.VERIFIED, ST.ANALYZED, ST.APPROVED, ST.LISTED, ST.EXPIRED, ST.FUNDED, ST.REJECTED].includes(f.status) ? '<span class="muted">Belum disalurkan</span>' : rp(f.outstanding)],
      f.va_number && (back || f.is_owner) ? ['VA angsuran', `<span class="mono">${esc(f.va_number)}</span>`] : null,
    ])}</div>`);
    if (back || f.is_owner) left.push(`<div class="card stack"><div class="section-title">Program & penjamin</div>${kv([
      ['Perusahaan di Jepang', esc(f.japan_company || '–')], ['Pekerjaan', esc(f.japan_job || '–')], ['Rencana berangkat', esc(f.departure_plan || '–')],
      ['Perkiraan gaji bersih', f.est_salary ? rp(f.est_salary) : '–'], ['Penjamin', `${esc(f.guarantor_name)} (${esc(f.guarantor_relation)}) · ${esc(f.guarantor_phone)}`],
    ])}</div>`);

    
    left.push(`<div><div class="section-title">Komponen biaya</div>${table([
      { label: 'Komponen', key: 'component' }, { label: 'Status', render: (c) => (c.disbursed ? pill('Dibayarkan', 'ok') : pill('Belum cair')) }, { label: 'Nominal', num: true, render: (c) => rp(c.amount) },
    ], f.costs)}</div>`);

    
    if (f.fundings.length) {
      left.push(`<div><div class="section-title">${back ? 'Pemodal syirkah' : 'Porsi Anda'}</div>${table([
        { label: 'Pemodal', render: (r) => esc(r.name) }, { label: 'Status', render: (r) => pill({ locked: 'Terkunci', active: 'Aktif', released: 'Dikembalikan', bought_back: 'Diambil alih KMH' }[r.status] || r.status, { active: 'ok', locked: 'warn' }[r.status] || '') },
        { label: 'Porsi', num: true, render: (r) => `${rp(r.amount)} <span class="muted small">${pct(r.amount / f.principal)}</span>` },
        { label: 'Pokok kembali', num: true, render: (r) => rp(r.principal_returned) }, { label: 'Bagi hasil', num: true, render: (r) => rp(r.profit) },
      ], f.fundings)}</div>`);
    }

    
    if (f.schedules.length) {
      left.push(`<div><div class="section-title">Jadwal angsuran</div>${table([
        { label: '#', render: (s) => s.seq }, { label: 'Jatuh tempo', render: (s) => tgl(s.due_date) },
        { label: 'Pokok', num: true, render: (s) => rp(s.principal_due) }, { label: 'Ujrah', num: true, render: (s) => rp(s.ujrah_due) },
        { label: 'Terbayar', num: true, render: (s) => rp(s.paid_principal + s.paid_ujrah) },
        { label: 'Status', render: (s) => pill({ open: s.due_date < ctx.me.today ? 'Terlambat' : 'Belum jatuh tempo', partial: 'Sebagian', paid: 'Lunas', cancelled: 'Dibatalkan', written_off: 'Dihapus buku' }[s.status], s.status === 'paid' ? 'ok' : s.status === 'open' && s.due_date < ctx.me.today ? 'bad' : s.status === 'partial' ? 'warn' : '') },
      ], f.schedules)}</div>`);
    }
    if (f.payments.length) {
      left.push(`<div><div class="section-title">Pembayaran masuk</div>${table([
        { label: 'Waktu', render: (p) => tglJam(p.paid_at) }, { label: 'Sumber', render: (p) => `${esc(p.provider)} <span class="small muted mono">${esc(p.external_id)}</span>` },
        { label: 'Alokasi', render: (p) => esc(p.note) }, { label: 'Nominal', num: true, render: (p) => rp(p.amount) },
      ], f.payments)}</div>`);
    }

    
    const R = roles(ctx);
    if (f.status === ST.LISTED && R.includes('pendana') && !f.is_owner) right.push(fundPanel(ctx, f));
    if (f.is_owner && f.va_number && [ST.GRACE, ST.REPAYING, ST.FAILED_DEPARTURE, ST.LOSS_HANDLING, ST.CLOSED_BUYBACK].includes(f.status)) {
      const next = f.schedules.find((s) => s.status === 'open' || s.status === 'partial');
      right.push(`<div class="card stack attention"><div class="section-title">Bayar angsuran</div>${vaBox(f.va_number, 'VA angsuran')}
        ${next ? `<div class="small">Tagihan berikutnya: <strong>${rp(next.principal_due + next.ujrah_due - next.paid_principal - next.paid_ujrah)}</strong>, jatuh tempo ${tgl(next.due_date)}.</div>` : ''}
        <p class="small muted" style="margin:0">Dari Jepang: kirim remitansi ke nomor VA ini. Keluarga di Indonesia juga dapat membayar ke VA yang sama.</p>
        ${simForm(ctx, f.va_number, next ? next.principal_due + next.ujrah_due - next.paid_principal - next.paid_ujrah : 0, 'Simulasikan pembayaran')}</div>`);
    }
    if (f.contract) right.push(contractPanel(ctx, f));
    if (back) right.push(...backofficePanels(ctx, f));
    if (f.verify_note || f.analysis_note) right.push(`<div class="card stack"><div class="section-title">Catatan</div>${f.verify_note ? `<div><div class="small muted">Verifikasi</div>${esc(f.verify_note)}</div>` : ''}${f.analysis_note ? `<div><div class="small muted">Analisa</div>${esc(f.analysis_note)}</div>` : ''}</div>`);

    parts.push(`<div class="split"><div class="stack">${left.join('')}</div><div class="stack">${right.join('') || '<div class="card tint small muted">Tidak ada tindakan untuk peran Anda pada tahap ini.</div>'}</div></div>`);
    return parts.join('');
  },
  onInput(ctx, e) {
    if (e.target.id === 'fund-amount') {
      const el = document.getElementById('fund-est');
      if (el) el.textContent = rp(estProfit(JSON.parse(el.dataset.f), money(e.target.value)));
    }
    if (e.target.closest('#analyze-form')) analyzePreview();
  },
  onChange(ctx, e) { if (e.target.closest('#analyze-form')) analyzePreview(); },
  actions: {
    copy: copyAction,
    'fund-fill': async (_ctx, btn) => { const i = document.getElementById('fund-amount'); i.value = num(Number(btn.dataset.v)); i.dispatchEvent(new Event('input', { bubbles: true })); return false; },
    'view-contract': async (ctx) => {
      const c = await call(ctx, 'getContract', { id: ctx.params.id });
      await modal(`<h3>Akad pembiayaan</h3><div class="contract">${esc(c.body)}</div><div class="small muted mono" style="overflow-wrap:anywhere">SHA-256: ${esc(c.sha256)}</div><div class="row" style="justify-content:flex-end"><button class="btn" data-modal="cancel">Tutup</button></div>`, { wide: true });
      return false;
    },
    sign: async (ctx, btn) => {
      const c = await call(ctx, 'getContract', { id: ctx.params.id });
      const ok = await modal(`<h3>Tanda tangani akad</h3><div class="contract">${esc(c.body)}</div>
        <p class="small muted" style="margin:0">Dengan menekan tombol di bawah, Anda menyetujui seluruh isi akad. Waktu, alamat IP, dan sidik isi akad (SHA-256) dicatat sebagai bukti.</p>
        <div class="row" style="justify-content:flex-end"><button class="btn" data-modal="cancel">Batal</button><button class="btn primary" data-modal="ok">Saya setuju & tanda tangani</button></div>`, { wide: true });
      if (!ok) return false;
      const r = await call(ctx, 'signContract', { id: ctx.params.id, as: btn.dataset.as });
      return r.complete ? 'Akad lengkap. Pembiayaan masuk tahap pencairan.' : 'Tanda tangan tercatat. Menunggu pihak lain.';
    },
    relist: async (ctx) => { await call(ctx, 'listFinancing', { id: ctx.params.id }); return 'Pembiayaan ditayangkan untuk penggalangan dana'; },
    'create-disb': async (ctx) => { const r = await call(ctx, 'createDisbursements', { id: ctx.params.id }); return `${r.created} instruksi pencairan dibuat dan menunggu persetujuan Manajer`; },
    'approve-disb': async (ctx, btn) => {
      if (!(await confirmDialog('Setujui pencairan?', `Transfer ${esc(btn.dataset.amount)} ke ${esc(btn.dataset.to)}. Pastikan transfer bank sudah dilakukan atau dijadwalkan.`, 'Setujui pencairan'))) return false;
      await call(ctx, 'approveDisbursement', { disbursement_id: Number(btn.dataset.id), approve: true, proof: '' }); return 'Pencairan disetujui dan dicatat';
    },
    'start-loss': async (ctx) => {
      if (!(await confirmDialog('Mulai penanganan kerugian?', 'Pembiayaan akan masuk tahap penanganan kerugian (waterfall: penjamin → Dana Proteksi → ambil alih KMH → hapus buku).', 'Mulai', true))) return false;
      await call(ctx, 'startLossHandling', { id: ctx.params.id }); return 'Status: penanganan kerugian';
    },
    buyback: async (ctx) => {
      if (!(await confirmDialog('Ambil alih porsi pendana?', 'KMH membayar sisa pokok porsi setiap pendana dari dompet KMH (tanpa bagi hasil yang belum terealisasi). Hak tagih berpindah ke KMH. Pastikan sudah ada persetujuan DPS.', 'Ambil alih', true))) return false;
      const r = await call(ctx, 'buyback', { id: ctx.params.id }); return `Porsi pendana diambil alih: ${rp(r.amount)}`;
    },
    writeoff: async (ctx) => {
      if (!(await confirmDialog('Hapus buku sisa pokok?', 'Sisa pokok dibebankan kepada pemegang modal sesuai porsi. Tindakan ini tidak dapat dibatalkan.', 'Hapus buku', true))) return false;
      const r = await call(ctx, 'writeOff', { id: ctx.params.id }); return `Dihapusbukukan: ${rp(r.amount)}`;
    },
  },
  forms: {
    simulate: simulateForm,
    fund: async (ctx, d) => { const r = await call(ctx, 'fund', { id: ctx.params.id, amount: money(d.amount) }); return r.full ? 'Pendanaan berhasil. Pembiayaan kini terdanai penuh.' : `Pendanaan ${rp(money(d.amount))} berhasil dikunci`; },
    verify: async (ctx, d, form) => {
      const ok = form.querySelector('[name=decision]:checked')?.value === 'ok';
      await call(ctx, 'verifyApplication', { id: ctx.params.id, ok, note: d.note }); return ok ? 'Pengajuan terverifikasi' : 'Pengajuan ditolak';
    },
    analyze: async (ctx, d) => {
      const r = await call(ctx, 'analyzeApplication', {
        id: ctx.params.id, ujrah: money(d.ujrah), tenor: Number(d.tenor), grace_months: Number(d.grace_months), nisbah_investor: Number(d.nisbah_investor), protection_pct: Number(d.protection_pct),
        salary_idr: money(d.salary_idr), note: d.note, score: { character: d.character, capacity: d.capacity, capital: d.capital, collateral: d.collateral, condition: d.condition },
      });
      return `Analisa tersimpan. Grade ${r.grade}; diteruskan ke Komite.`;
    },
    vote: async (ctx, d, form) => {
      const decision = form.querySelector('[name=decision]:checked')?.value;
      if (!decision) throw new Error('Pilih keputusan');
      const r = await call(ctx, 'committeeVote', { id: ctx.params.id, decision, note: d.note });
      return { LISTED: 'Disetujui dan langsung ditayangkan', APPROVED: 'Disetujui; menunggu saldo KMH untuk ditayangkan', REJECTED: 'Pengajuan ditolak', ANALYZED: `Keputusan tercatat (${r.approvals} persetujuan)` }[r.status];
    },
    failed: async (ctx, d) => { const r = await call(ctx, 'markFailedDeparture', { id: ctx.params.id, note: d.note }); return `Ditandai gagal berangkat. Sisa kewajiban ${rp(r.outstanding)}`; },
    note: async (ctx, d) => { await call(ctx, 'addCollectionNote', { id: ctx.params.id, action: d.action, note: d.note, promise_date: d.promise_date }); return 'Catatan penagihan disimpan'; },
    claim: async (ctx, d) => { const r = await call(ctx, 'claimProtection', { id: ctx.params.id, amount: money(d.amount), note: d.note }); return `Klaim Dana Proteksi ${rp(r.amount)} dibagikan ke pemegang modal`; },
    manualpay: async (ctx, d) => { const r = await call(ctx, 'recordManualPayment', { va_number: d.va_number, amount: money(d.amount), reference: d.reference }); return r.duplicate ? 'Referensi ini sudah pernah dicatat' : 'Pembayaran manual dicatat'; },
  },
};

function fundPanel(ctx, f) {
  const s = ctx.me.wallet;
  const remaining = f.principal - f.funded;
  const cap = Math.floor((f.principal * f.max_investor_pct) / 100) - f.my_amount;
  const maxAllowed = Math.max(0, Math.min(remaining, cap, s?.available || 0));
  const fdata = esc(JSON.stringify({ principal: f.principal, ujrah: f.ujrah, kmh_min_pct: f.kmh_min_pct, protection_pct: f.protection_pct, nisbah_investor: f.nisbah_investor }));
  const quick = [1000000, 2500000, 5000000].filter((v) => v <= maxAllowed);
  return `<div class="card stack attention"><div class="section-title">Danai pembiayaan ini</div>
    ${progress(f.progress)}<div class="small muted">${rp(f.funded)} dari ${rp(f.principal)} · berakhir ${tgl(f.listing_deadline)}</div>
    ${kv([['Saldo tersedia', rp(s?.available || 0)], ['Porsi Anda saat ini', rp(f.my_amount)], ['Batas porsi per pendana', `${f.max_investor_pct}% (${rp(Math.floor((f.principal * f.max_investor_pct) / 100))})`], ['Minimum', `${rp(f.min_funding)}, kelipatan ${rp(f.funding_step)}`]])}
    <form class="form" data-form="fund">
      ${field('fund-amount', 'Nominal pendanaan', inp('fund-amount', { name: 'amount', required: true, placeholder: 'mis. 2.500.000' }))}
      <div class="row">${quick.map((v) => `<button class="btn sm" type="button" data-act="fund-fill" data-v="${v}">${rp(v)}</button>`).join('')}${remaining <= maxAllowed ? `<button class="btn sm" type="button" data-act="fund-fill" data-v="${remaining}">Sisa ${rp(remaining)}</button>` : ''}</div>
      <div class="small">Perkiraan bagi hasil bila lancar: <strong id="fund-est" data-f="${fdata}">Rp0</strong></div>
      <button class="btn primary" type="submit">Kunci dana</button>
      <p class="small muted" style="margin:0">Dana terkunci sampai pembiayaan terdanai penuh. Bila tidak terdanai sampai batas waktu, dana kembali ke saldo. Hasil tidak dijamin; kerugian ditanggung sesuai porsi modal setelah lapis Dana Proteksi.</p>
    </form></div>`;
}

function contractPanel(ctx, f) {
  const sigs = f.contract.signatures;
  const signed = (r) => sigs.find((s) => s.role === r);
  const R = roles(ctx);
  const btns = [];
  if (f.status === ST.FUNDED && f.is_owner && !signed('penerima')) btns.push('<button class="btn primary" data-act="sign" data-as="penerima">Baca & tanda tangani</button>');
  if (f.status === ST.FUNDED && R.includes('manajer') && !signed('kmh')) btns.push('<button class="btn primary" data-act="sign" data-as="kmh">Tanda tangani atas nama KMH</button>');
  const line = (r, label) => { const s = signed(r); return `<div class="row" style="justify-content:space-between"><span>${label}</span>${s ? `<span class="small">${pill('Ditandatangani', 'ok')} ${esc(s.name)} · ${tglJam(s.at)}</span>` : pill('Belum')}</div>`; };
  return `<div class="card stack"><div class="section-title">Akad <button class="btn sm" data-act="view-contract">Lihat isi akad</button></div>
    ${line('penerima', 'Penerima jasa')}${line('kmh', 'KMH (pengelola syirkah)')}
    <div class="small muted mono" style="overflow-wrap:anywhere">SHA-256 ${esc(f.contract.sha256.slice(0, 24))}…</div>${btns.join('')}</div>`;
}

function analyzePreview() {
  const form = document.getElementById('analyze-form');
  if (!form) return;
  const g = (n) => form.querySelector(`[name=${n}]`)?.value;
  const scores = ['character', 'capacity', 'capital', 'collateral', 'condition'].map((k) => Number(g(k)));
  const avg = scores.reduce((a, b) => a + b, 0) / 5;
  const principal = Number(form.dataset.principal);
  const inst = Math.ceil((principal + money(g('ujrah'))) / Math.max(1, Number(g('tenor'))));
  const salary = money(g('salary_idr'));
  const ratio = salary ? inst / salary : null;
  const gr = avg >= 4.2 ? 'A' : avg >= 3.4 ? 'B' : avg >= 2.6 ? 'C' : 'D';
  const max = Number(form.dataset.maxratio);
  document.getElementById('an-preview').innerHTML = `Rata-rata 5C <strong>${avg.toFixed(2)}</strong> → grade ${grade(gr)} · Angsuran <strong>${rp(inst)}</strong>${ratio !== null ? ` · <span style="color:var(${ratio * 100 > max ? '--bad' : '--ok'})">${(ratio * 100).toFixed(1)}% dari gaji</span> (batas ${max}%)` : ''}`;
}

function backofficePanels(ctx, f) {
  const R = roles(ctx);
  const out = [];
  if (f.borrower) out.push(`<div class="card stack"><div class="section-title">Penerima</div>${kv([['Nama', esc(f.borrower.name)], ['No. anggota', esc(f.borrower.member_no)], ['KYC', pill(f.borrower.kyc_status === 'approved' ? 'Disetujui' : f.borrower.kyc_status, f.borrower.kyc_status === 'approved' ? 'ok' : 'warn')], ['HP', esc(f.borrower.phone)]])}</div>`);

  if (R.includes('analis') && f.status === ST.SUBMITTED) {
    out.push(`<div class="card stack attention"><div class="section-title">Verifikasi dokumen</div>
      <form class="form" data-form="verify"><div class="checks"><label><input type="radio" name="decision" value="ok" checked> Lengkap & valid</label><label><input type="radio" name="decision" value="reject"> Tolak</label></div>
      ${field('v-note', 'Catatan', '<textarea id="v-note" name="note" placeholder="Hasil cek KTP, KK, kontrak/LoA dari SO, kunjungan"></textarea>')}
      <button class="btn primary" type="submit">Simpan verifikasi</button></form></div>`);
  }
  if (R.includes('analis') && [ST.VERIFIED, ST.ANALYZED].includes(f.status)) {
    const sc = f.score || {};
    const opt = (n, label) => field(`an-${n}`, label, sel(`an-${n}`, [[5, '5 – Sangat baik'], [4, '4 – Baik'], [3, '3 – Cukup'], [2, '2 – Kurang'], [1, '1 – Buruk']], sc[n] || 4, n));
    out.push(`<div class="card stack attention"><div class="section-title">Analisa 5C & struktur</div>
      <form class="form" data-form="analyze" id="analyze-form" data-principal="${f.principal}" data-maxratio="${ctx.settings?.max_installment_ratio || 30}">
        <div class="grid g2">${opt('character', 'Character')}${opt('capacity', 'Capacity')}${opt('capital', 'Capital')}${opt('collateral', 'Collateral (penjamin)')}${opt('condition', 'Condition')}
        ${field('an-salary', 'Gaji bersih/bln (Rp)', inp('an-salary', { name: 'salary_idr', value: num(sc.salary || f.est_salary || 0) }))}</div>
        <div class="grid g2">
          ${field('an-ujrah', 'Ujrah tetap (Rp)', inp('an-ujrah', { name: 'ujrah', value: num(f.ujrah || Math.round(f.principal * 0.18)), required: true }), 'Nominal tetap di akad, bukan bunga berjalan.')}
          ${field('an-tenor', 'Tenor (bulan)', inp('an-tenor', { name: 'tenor', type: 'number', value: f.tenor, min: 1, max: 60 }))}
          ${field('an-grace', 'Masa tenggang (bulan)', inp('an-grace', { name: 'grace_months', type: 'number', value: f.grace_months, min: 0, max: 24 }))}
          ${field('an-nisbah', 'Nisbah pendana (%)', inp('an-nisbah', { name: 'nisbah_investor', type: 'number', value: f.nisbah_investor, min: 1, max: 99 }))}
          ${field('an-prot', 'Porsi Dana Proteksi (% ujrah)', inp('an-prot', { name: 'protection_pct', type: 'number', value: f.protection_pct, min: 0, max: 50 }))}
        </div>
        <div class="notice info small" id="an-preview">Isi parameter untuk melihat grade dan rasio angsuran.</div>
        ${field('an-note', 'Catatan analis', `<textarea id="an-note" name="note">${esc(f.analysis_note || '')}</textarea>`)}
        <button class="btn primary" type="submit">Simpan & teruskan ke Komite</button></form></div>`);
    setTimeout(analyzePreview, 0);
  }
  if (f.status === ST.ANALYZED || f.votes.length) {
    const sc = f.score || {};
    const voted = f.votes.some((v) => v.user_id === ctx.me.user.id);
    out.push(`<div class="card stack ${R.includes('komite') && f.status === ST.ANALYZED && !voted ? 'attention' : ''}"><div class="section-title">Keputusan Komite</div>
      ${f.score ? kv([['Skor 5C', `C ${sc.character} · Cap ${sc.capacity} · Mod ${sc.capital} · Jam ${sc.collateral} · Kon ${sc.condition} (rata-rata ${sc.avg})`], ['Rasio angsuran', sc.ratio !== null && sc.ratio !== undefined ? `${sc.ratio}% dari gaji ${sc.ratio_ok ? pill('Dalam batas', 'ok') : pill('Melebihi batas', 'bad')}` : '–']]) : ''}
      ${f.votes.map((v) => `<div class="row small" style="justify-content:space-between"><span>${esc(v.name)}</span>${pill(v.decision === 'approve' ? 'Setuju' : 'Tolak', v.decision === 'approve' ? 'ok' : 'bad')}</div>${v.note ? `<div class="small muted">${esc(v.note)}</div>` : ''}`).join('')}
      <div class="small muted">Butuh ${f.committee_quorum} persetujuan; satu penolakan menolak pengajuan.</div>
      ${R.includes('komite') && f.status === ST.ANALYZED && !voted ? `<form class="form" data-form="vote"><div class="checks"><label><input type="radio" name="decision" value="approve"> Setujui</label><label><input type="radio" name="decision" value="reject"> Tolak</label></div>${field('vote-note', 'Pertimbangan', '<textarea id="vote-note" name="note"></textarea>')}<button class="btn primary" type="submit">Simpan keputusan</button></form>` : ''}</div>`);
  }
  if (has(ctx, 'manajer', 'admin') && [ST.APPROVED, ST.EXPIRED].includes(f.status)) {
    out.push(`<div class="card stack attention"><div class="section-title">Tayangkan</div><p class="small muted" style="margin:0">${f.status === ST.EXPIRED ? 'Penggalangan sebelumnya tidak mencapai target.' : 'Menunggu saldo KMH untuk modal minimal.'} Menayangkan akan mengunci modal KMH ${f.kmh_min_pct}% dan membuka batas waktu baru.</p><button class="btn primary" data-act="relist">Tayangkan untuk pendanaan</button></div>`);
  }
  if ([ST.AKAD_SIGNED, ST.DISBURSING].includes(f.status) && has(ctx, 'finance', 'manajer')) {
    const pend = f.disbursements.filter((d) => d.status === 'pending');
    const missing = f.costs.filter((c) => !f.disbursements.some((d) => d.cost_id === c.id && d.status !== 'rejected'));
    out.push(`<div class="card stack attention"><div class="section-title">Pencairan ke mitra</div>
      ${f.disbursements.map((d) => `<div class="row small" style="justify-content:space-between"><span>${esc(d.component)}</span><span>${rp(d.amount)} ${pill({ pending: 'Menunggu', paid: 'Dibayar', rejected: 'Ditolak', cancelled: 'Batal' }[d.status], d.status === 'paid' ? 'ok' : d.status === 'pending' ? 'warn' : '')}</span></div>`).join('')}
      ${R.includes('finance') && missing.length ? '<button class="btn primary" data-act="create-disb">Buat instruksi pencairan</button>' : ''}
      ${R.includes('manajer') && pend.length ? pend.map((d) => `<button class="btn" data-act="approve-disb" data-id="${d.id}" data-amount="${rp(d.amount)}" data-to="${esc(d.component)}">Setujui ${esc(d.component)} · ${rp(d.amount)}</button>`).join('') : ''}
      ${R.includes('manajer') && pend.some((d) => d.maker_id === ctx.me.user.id) ? '<div class="small muted">Instruksi yang Anda buat sendiri harus disetujui orang lain.</div>' : ''}</div>`);
  }
  if ([ST.AKAD_SIGNED, ST.DISBURSING, ST.GRACE].includes(f.status) && has(ctx, 'analis', 'manajer')) {
    out.push(`<details class="card"><summary class="section-title" style="cursor:pointer;margin:0">Peserta gagal berangkat?</summary>
      <form class="form" data-form="failed" style="margin-top:12px"><p class="small muted" style="margin:0">Instruksi pencairan yang belum disetujui dibatalkan dan modalnya dikembalikan ke pemodal. Biaya yang sudah dibayarkan menjadi kewajiban peserta & penjamin dalam satu tagihan 30 hari.</p>
      ${field('fd-note', 'Kronologi', '<textarea id="fd-note" name="note" required></textarea>')}<button class="btn danger" type="submit">Tandai gagal berangkat</button></form></details>`);
  }
  const payable = [ST.GRACE, ST.REPAYING, ST.FAILED_DEPARTURE, ST.LOSS_HANDLING, ST.CLOSED_BUYBACK].includes(f.status);
  if (payable && has(ctx, 'analis', 'manajer', 'finance', 'komite')) {
    out.push(`<div class="card stack"><div class="section-title">Penagihan</div>
      ${f.collections.slice(0, 5).map((c) => `<div class="small"><strong>${esc(c.action)}</strong> · ${tgl(c.created_at)} · ${esc(c.officer)}${c.promise_date ? ` · janji bayar ${tgl(c.promise_date)}` : ''}<div class="muted">${esc(c.note)}</div></div>`).join('<hr class="sep">') || '<div class="small muted">Belum ada catatan.</div>'}
      ${has(ctx, 'analis', 'manajer', 'finance') ? `<form class="form" data-form="note">${field('cn-action', 'Tindakan', sel('cn-action', [['Pengingat WhatsApp', 'Pengingat WhatsApp'], ['Telepon peserta', 'Telepon peserta'], ['Hubungi penjamin', 'Hubungi penjamin'], ['Koordinasi SO/kumiai', 'Koordinasi SO/kumiai'], ['Kunjungan', 'Kunjungan'], ['Surat peringatan', 'Surat peringatan']], '', 'action'))}
        ${field('cn-note', 'Hasil', '<textarea id="cn-note" name="note"></textarea>')}${field('cn-promise', 'Janji bayar (opsional)', inp('cn-promise', { type: 'date', name: 'promise_date' }))}<button class="btn" type="submit">Simpan catatan</button></form>` : ''}</div>`);
    if (R.includes('finance') && f.va_number) {
      out.push(`<details class="card"><summary class="section-title" style="cursor:pointer;margin:0">Catat pembayaran manual / dari penjamin</summary>
        <form class="form" data-form="manualpay" style="margin-top:12px"><input type="hidden" name="va_number" value="${esc(f.va_number)}">
        ${field('mp-amount', 'Nominal', inp('mp-amount', { name: 'amount', required: true }))}${field('mp-ref', 'Nomor referensi bukti transfer', inp('mp-ref', { name: 'reference', required: true }), 'Satu referensi hanya bisa dicatat sekali.')}
        <button class="btn" type="submit">Catat pembayaran</button></form></details>`);
    }
  }
  if (has(ctx, 'komite', 'manajer') && ((f.status === ST.REPAYING && f.dpd > 90) || f.status === ST.FAILED_DEPARTURE)) {
    out.push(`<div class="card stack attention"><div class="section-title">Penanganan kerugian</div><p class="small muted" style="margin:0">${f.status === ST.FAILED_DEPARTURE ? 'Peserta gagal berangkat.' : `Tunggakan ${f.dpd} hari (macet).`} Pastikan penagihan dan klaim ke penjamin sudah dilakukan.</p><button class="btn danger" data-act="start-loss">Mulai penanganan kerugian</button></div>`);
  }
  if (R.includes('komite') && [ST.LOSS_HANDLING, ST.CLOSED_BUYBACK].includes(f.status)) {
    const claimed = f.losses.filter((l) => l.kind === 'protection').reduce((a, l) => a + l.amount, 0);
    const limit = Math.max(0, Math.min(f.protection_balance, Math.floor(((f.outstanding + claimed) * f.max_claim_pct) / 100) - claimed, f.outstanding));
    out.push(`<div class="card stack attention"><div class="section-title">Waterfall kerugian</div>
      ${kv([['Sisa pokok', rp(f.outstanding)], ['Saldo Dana Proteksi', rp(f.protection_balance)], ['Sudah diklaim', rp(claimed)], ['Batas klaim saat ini', rp(limit)]])}
      ${f.status === ST.LOSS_HANDLING ? `<form class="inline-form" data-form="claim">${field('cl-amount', 'Klaim Dana Proteksi', inp('cl-amount', { name: 'amount', value: num(limit) }))}${field('cl-note', 'Dasar keputusan', inp('cl-note', { name: 'note', placeholder: 'No. berita acara komite' }))}<button class="btn" type="submit" ${limit ? '' : 'disabled'}>Klaim</button></form>
        <button class="btn danger" data-act="buyback">Ambil alih porsi pendana (buyback)</button>` : ''}
      <button class="btn danger" data-act="writeoff">Hapus buku sisa pokok</button>
      ${f.losses.length ? `<div class="small muted">${f.losses.map((l) => `${esc({ protection: 'Klaim proteksi', buyback: 'Ambil alih', writeoff: 'Hapus buku', failed_departure: 'Gagal berangkat' }[l.kind])}: ${rp(l.amount)} (${tgl(l.created_at)})`).join(' · ')}</div>` : ''}</div>`);
  }
  return out;
}


const dasbor = {
  roles: BACKOFFICE,
  async render(ctx) {
    const d = await call(ctx, 'dashboard');
    const kmh = await call(ctx, 'kmhWallet').catch(() => null);
    const q = d.queue;
    const task = (label, n, route, who) => `<a class="card flat row" style="justify-content:space-between;text-decoration:none;color:inherit;padding:12px 14px" href="#${route}" data-route="${route}"><span><strong>${esc(label)}</strong><span class="small muted" style="display:block">${esc(who)}</span></span><span class="value num" style="font-size:20px;font-weight:800;color:var(${n ? '--hikari' : '--faint'})">${n}</span></a>`;
    const maxB = Math.max(1, ...Object.values(d.buckets).map((b) => b.amount));
    const bColors = { lancar: '--ok', perhatian: '--warn', kurang: '--warn', diragukan: '--bad', macet: '--bad' };
    const bLabel = { lancar: 'Lancar', perhatian: 'Perhatian (1–30)', kurang: 'Kurang lancar (31–60)', diragukan: 'Diragukan (61–90)', macet: 'Macet (>90)' };
    const partners = Object.entries(d.byPartner);
    return pageHead('Back-office', 'Dasbor portofolio', `Posisi per ${tgl(d.today)}. Angka dihitung langsung dari buku besar.`) + `
      <div class="grid g4">
        ${stat('Outstanding pokok', rp(d.outstanding), `${(d.byStatus.REPAYING || 0) + (d.byStatus.GRACE || 0)} pembiayaan berjalan`)}
        ${stat('NPL (macet)', pct(d.npl), `DPD >30: ${pct(d.dpd30)}`)}
        ${stat('Dana Proteksi', rp(d.protection), `Cakupan ${pct(d.protection_coverage)} dari outstanding`)}
        ${stat('Kas rekening penampung', rp(d.escrow_cash), `${d.active_investors} pendana aktif`)}
      </div>
      <div class="split" style="margin-top:16px">
        <div class="stack">
          <div class="card stack"><div class="section-title">Kualitas portofolio (DPD)</div><div class="bars">
            ${Object.entries(d.buckets).map(([k, b]) => `<div class="bar-row"><span class="small">${bLabel[k]}</span><div class="bar-track"><span style="width:${(b.amount / maxB) * 100}%;background:var(${bColors[k]})"></span></div><span class="small num" style="text-align:right">${rp(b.amount)} · ${b.count}</span></div>`).join('')}
          </div></div>
          <div class="card stack"><div class="section-title">Eksposur per mitra LPK/SO</div>${partners.length ? `<div class="bars">${partners.map(([n, v]) => `<div class="bar-row"><span class="small">${esc(n)}</span><div class="bar-track"><span style="width:${(v / d.outstanding) * 100}%;background:var(--accent)"></span></div><span class="small num" style="text-align:right">${rp(v)}</span></div>`).join('')}</div>` : '<div class="small muted">Belum ada outstanding.</div>'}</div>
          ${kmh ? `<div class="card stack"><div class="section-title">Dompet KMH</div><div class="grid g3">${stat('Tersedia', rp(kmh.available))}${stat('Terkunci', rp(kmh.locked))}${stat('Modal tersalur', rp(kmh.invested))}</div>
            <div class="small muted">Bagi hasil & nisbah diterima KMH: ${rp(kmh.profit_total)}. Saldo tersedia dipakai untuk modal minimal ${ctx.settings?.kmh_min_pct || 10}% dan cadangan ambil alih.</div>${vaBox(kmh.va, 'VA setoran modal KMH')}${has(ctx, 'finance', 'manajer') ? simForm(ctx, kmh.va, 10000000, 'Simulasikan setoran KMH') : ''}</div>` : ''}
        </div>
        <div class="stack">
          <div class="section-title">Antrian kerja</div>
          ${task('Verifikasi dokumen', q.verify, 'antrian', 'Analis')}${task('Analisa 5C', q.analyze, 'antrian', 'Analis')}${task('Keputusan komite', q.committee, 'antrian', 'Komite')}
          ${task('Akad menunggu tanda tangan', q.sign, 'antrian', 'Penerima & Manajer')}${task('Siap/sedang dicairkan', q.disburse, 'antrian', 'Finance')}
          ${task('Pencairan menunggu persetujuan', q.disb_pending, 'pencairan', 'Manajer')}${task('Penarikan dana', q.wd_pending, 'penarikan', 'Finance & Manajer')}
          ${task('Verifikasi anggota', d.pending_kyc, 'anggota', 'Admin')}${task('Pembayaran tak dikenali/titipan', d.unmatched_payments, 'pembayaran', 'Finance')}
        </div>
      </div>`;
  },
  actions: { copy: copyAction },
  forms: { simulate: simulateForm },
};

const TABS = [
  ['verifikasi', 'Verifikasi', [ST.SUBMITTED]], ['analisa', 'Analisa', [ST.VERIFIED]], ['komite', 'Komite', [ST.ANALYZED]],
  ['tayang', 'Penggalangan', [ST.APPROVED, ST.LISTED, ST.EXPIRED]], ['akad', 'Akad & pencairan', [ST.FUNDED, ST.AKAD_SIGNED, ST.DISBURSING]],
  ['berjalan', 'Berjalan', [ST.GRACE, ST.REPAYING, ST.FAILED_DEPARTURE, ST.LOSS_HANDLING, ST.CLOSED_BUYBACK]], ['selesai', 'Selesai/ditolak', [ST.PAID_OFF, ST.CLOSED_LOSS, ST.REJECTED, ST.CANCELLED]],
];
const antrian = {
  roles: BACKOFFICE,
  async render(ctx) {
    const all = await call(ctx, 'listFinancings', {});
    const tab = ctx.tab || (all.some((f) => f.status === ST.SUBMITTED) ? 'verifikasi' : 'berjalan');
    const cur = TABS.find((t) => t[0] === tab) || TABS[0];
    const rows = all.filter((f) => cur[2].includes(f.status));
    return pageHead('Back-office', 'Pengajuan & pembiayaan', 'Klik baris untuk membuka rincian dan tindakan sesuai peran Anda.') +
      `<div class="tabs" role="tablist">${TABS.map(([k, l, ss]) => `<button role="tab" data-act="tab" data-tab="${k}" class="${k === cur[0] ? 'active' : ''}">${esc(l)}<span class="count">${all.filter((f) => ss.includes(f.status)).length}</span></button>`).join('')}</div>` +
      table([
        { label: 'Kode', render: (f) => `<strong>${esc(f.code)}</strong>` }, { label: 'Penerima', render: (f) => esc(f.borrower_name) }, { label: 'Mitra', render: (f) => esc(f.partner_name) },
        { label: 'Grade', render: (f) => grade(f.grade) }, { label: 'Status', render: (f) => statusPill(f.status) },
        { label: 'Kualitas', render: (f) => (f.schedule_count && f.outstanding ? bucketPill(f.bucket, f.dpd) : f.status === ST.LISTED ? `${pct(f.progress, 0)} terdanai` : '–') },
        { label: 'Pokok', num: true, render: (f) => rp(f.principal) }, { label: 'Outstanding', num: true, render: (f) => rp(f.outstanding) },
      ], rows, { rowAttr: finRow, empty: 'Tidak ada pembiayaan pada tahap ini.' });
  },
  actions: { tab: async (ctx, btn) => { ctx.tab = btn.dataset.tab; return ''; } },
};

const penagihan = {
  roles: ['analis', 'komite', 'finance', 'manajer', 'admin'],
  async render(ctx) {
    const list = await call(ctx, 'listCollections');
    return pageHead('Back-office', 'Pemantauan & penagihan', 'Diurutkan dari tunggakan terlama. Pengingat dikirim H-3, H, dan H+1; eskalasi mengikuti bucket DPD.') +
      table([
        { label: 'Kode', render: (f) => `<strong>${esc(f.code)}</strong>` }, { label: 'Penerima', render: (f) => esc(f.borrower_name) }, { label: 'Status', render: (f) => statusPill(f.status) },
        { label: 'Kualitas', render: (f) => bucketPill(f.bucket, f.dpd) }, { label: 'Angsuran', render: (f) => `${f.paid_count}/${f.schedule_count}` },
        { label: 'Catatan terakhir', render: (f) => (f.last_note ? `${esc(f.last_note.action)} · ${tgl(f.last_note.created_at)}` : '<span class="muted">–</span>') },
        { label: 'Outstanding', num: true, render: (f) => rp(f.outstanding) },
      ], list, { rowAttr: finRow, empty: 'Belum ada pembiayaan dalam masa angsuran.' });
  },
};

const pencairan = {
  roles: ['finance', 'manajer', 'admin'],
  async render(ctx) {
    const list = await call(ctx, 'listDisbursements', {});
    return pageHead('Back-office', 'Pencairan', 'Dana dibayarkan langsung ke rekening mitra terdaftar. Finance membuat instruksi, Manajer menyetujui setelah transfer dilakukan.') +
      table([
        { label: 'Dibuat', render: (d) => tglJam(d.created_at) }, { label: 'Pembiayaan', render: (d) => `<a href="#pembiayaan-${d.financing_id}" data-route="pembiayaan" data-id="${d.financing_id}">${esc(d.code)}</a>` },
        { label: 'Komponen', key: 'component' }, { label: 'Tujuan', render: (d) => `${esc(d.partner_name)}<div class="small muted mono">${esc(d.partner_bank)}</div>` },
        { label: 'Maker / checker', render: (d) => `${esc(d.maker_name || '–')} / ${esc(d.checker_name || '–')}` },
        { label: 'Status', render: (d) => pill({ pending: 'Menunggu', paid: 'Dibayar', rejected: 'Ditolak', cancelled: 'Batal' }[d.status], d.status === 'paid' ? 'ok' : d.status === 'pending' ? 'warn' : '') },
        { label: 'Nominal', num: true, render: (d) => rp(d.amount) },
        { label: '', render: (d) => (d.status === 'pending' && has(ctx, 'manajer') && d.maker_id !== ctx.me.user.id ? `<div class="row"><button class="btn sm primary" data-act="approve" data-id="${d.id}">Setujui</button><button class="btn sm danger" data-act="reject" data-id="${d.id}">Tolak</button></div>` : '') },
      ], list, { empty: 'Belum ada instruksi pencairan.' });
  },
  actions: {
    approve: async (ctx, btn) => { if (!(await confirmDialog('Setujui pencairan?', 'Pastikan transfer ke rekening mitra sudah dilakukan.', 'Setujui'))) return false; await call(ctx, 'approveDisbursement', { disbursement_id: Number(btn.dataset.id), approve: true }); return 'Pencairan disetujui'; },
    reject: async (ctx, btn) => { await call(ctx, 'approveDisbursement', { disbursement_id: Number(btn.dataset.id), approve: false }); return 'Instruksi ditolak; Finance dapat membuat ulang'; },
  },
};

const penarikan = {
  roles: ['finance', 'manajer', 'admin'],
  async render(ctx) {
    const list = await call(ctx, 'listWithdrawals', {});
    return pageHead('Back-office', 'Penarikan dana pendana', 'Finance memverifikasi rekening tujuan atas nama pendana, lalu Manajer menyetujui dan mentransfer.') +
      table([
        { label: 'Diajukan', render: (w) => tglJam(w.created_at) }, { label: 'Pendana', render: (w) => esc(w.user_name) }, { label: 'Rekening tujuan', key: 'note' },
        { label: 'Status', render: (w) => pill({ requested: 'Menunggu Finance', verified: 'Menunggu Manajer', paid: 'Ditransfer', rejected: 'Ditolak' }[w.status], { paid: 'ok', rejected: 'bad' }[w.status] || 'warn') },
        { label: 'Nominal', num: true, render: (w) => rp(w.amount) },
        { label: '', render: (w) => {
          const b = [];
          if (w.status === 'requested' && has(ctx, 'finance')) b.push(`<button class="btn sm primary" data-act="verify" data-id="${w.id}">Verifikasi</button>`);
          if (w.status === 'verified' && has(ctx, 'manajer') && w.maker_id !== ctx.me.user.id) b.push(`<button class="btn sm primary" data-act="approve" data-id="${w.id}">Setujui & transfer</button>`);
          if (['requested', 'verified'].includes(w.status) && has(ctx, 'finance', 'manajer')) b.push(`<button class="btn sm danger" data-act="reject" data-id="${w.id}">Tolak</button>`);
          return `<div class="row">${b.join('')}</div>`;
        } },
      ], list, { empty: 'Belum ada permintaan penarikan.' });
  },
  actions: {
    verify: async (ctx, btn) => { await call(ctx, 'verifyWithdrawal', { withdrawal_id: Number(btn.dataset.id) }); return 'Diverifikasi; menunggu Manajer'; },
    approve: async (ctx, btn) => { if (!(await confirmDialog('Setujui penarikan?', 'Lakukan transfer bank ke rekening tujuan, lalu setujui di sini agar saldo tercatat keluar.', 'Setujui'))) return false; await call(ctx, 'decideWithdrawal', { withdrawal_id: Number(btn.dataset.id), approve: true }); return 'Penarikan ditransfer'; },
    reject: async (ctx, btn) => { await call(ctx, 'decideWithdrawal', { withdrawal_id: Number(btn.dataset.id), approve: false, note: 'Data rekening perlu diperbaiki' }); return 'Penarikan ditolak; saldo dikembalikan'; },
  },
};

const pembayaran = {
  roles: ['finance', 'manajer', 'admin'],
  async render(ctx) {
    const [events, vas] = await Promise.all([call(ctx, 'listPayments', {}), call(ctx, 'listVAs')]);
    const sim = simOn(ctx) && has(ctx, 'finance', 'manajer', 'admin');
    return pageHead('Back-office', 'Pembayaran Virtual Account', 'Setiap notifikasi bank dicatat sekali berdasarkan ID transaksi, lalu diproses otomatis menjadi top-up atau angsuran.') + `
      ${sim ? `<div class="card stack" style="margin-bottom:16px"><div class="section-title">Simulator VA</div><p class="small muted" style="margin:0">Meniru notifikasi dari bank untuk uji coba. Matikan di server produksi (ALLOW_VA_SIMULATOR=false).</p>
        <form class="inline-form" data-form="simulate">${field('sim-va', 'Nomor VA', sel('sim-va', vas.map((v) => [v.va_number, `${v.va_number} · ${v.owner}`]), '', 'va_number'))}${field('sim-amt', 'Nominal', inp('sim-amt', { name: 'amount', required: true, placeholder: 'mis. 2.950.000' }))}<button class="btn primary" type="submit">Kirim notifikasi</button></form></div>` : ''}
      ${table([
        { label: 'Diterima', render: (p) => tglJam(p.paid_at) }, { label: 'Sumber', render: (p) => `${esc(p.provider)}<div class="small muted mono">${esc(p.external_id)}</div>` },
        { label: 'VA', render: (p) => `<span class="mono">${esc(p.va_number)}</span>` },
        { label: 'Status', render: (p) => pill({ processed: 'Diproses', unmatched: 'VA tidak dikenal', suspense: 'Titipan', received: 'Diterima' }[p.status] || p.status, { processed: 'ok', unmatched: 'bad', suspense: 'warn' }[p.status] || '') },
        { label: 'Keterangan', render: (p) => esc(p.note) }, { label: 'Nominal', num: true, render: (p) => rp(p.amount) },
      ], events, { empty: 'Belum ada pembayaran masuk.' })}`;
  },
  forms: { simulate: simulateForm },
};

const rekonsiliasi = {
  roles: ['finance'],
  async render(ctx) {
    const r = ctx.recon;
    return pageHead('Back-office', 'Rekonsiliasi harian', 'Tempel laporan mutasi/settlement dari bank atau payment gateway (CSV: id transaksi, nomor VA, nominal, tanggal). Sistem mencocokkan dengan pembayaran tercatat.') + `
      <form class="form card" data-form="recon">
        ${field('rc-csv', 'Data mutasi (CSV)', `<textarea id="rc-csv" name="csv" style="min-height:160px;font-family:var(--font-mono);font-size:12.5px" placeholder="SIM-001,88082000000005,2950000,2026-10-15">${esc(ctx.reconCsv || '')}</textarea>`)}
        <div class="row"><button class="btn primary" type="submit">Cocokkan</button><button class="btn" type="button" data-act="sample">Isi contoh dari transaksi tercatat</button></div>
      </form>
      ${r ? `<div class="grid g4" style="margin-top:16px">${stat('Baris mutasi', num(r.rows))}${stat('Cocok', num(r.matched))}${stat('Selisih', num(r.missing_in_system.length + r.missing_in_bank.length + r.amount_mismatch.length))}${stat('Kas penampung (buku)', rp(r.ledger_cash))}</div>
        ${r.missing_in_system.length ? `<div class="section-title" style="margin-top:16px">Ada di bank, belum tercatat di sistem</div>${table([{ label: 'ID', key: 'external_id' }, { label: 'VA', key: 'va_number' }, { label: 'Tanggal', key: 'date' }, { label: 'Nominal', num: true, render: (x) => rp(x.amount) }], r.missing_in_system)}<p class="small muted">Catat melalui pembayaran manual setelah memastikan pemilik VA.</p>` : ''}
        ${r.missing_in_bank.length ? `<div class="section-title" style="margin-top:16px">Tercatat di sistem, tidak ada di mutasi bank</div>${table([{ label: 'ID', key: 'external_id' }, { label: 'VA', key: 'va_number' }, { label: 'Tanggal', render: (x) => tglJam(x.date) }, { label: 'Nominal', num: true, render: (x) => rp(x.amount) }], r.missing_in_bank)}` : ''}
        ${r.amount_mismatch.length ? `<div class="section-title" style="margin-top:16px">Nominal berbeda</div>${table([{ label: 'ID', key: 'external_id' }, { label: 'Bank', num: true, render: (x) => rp(x.bank) }, { label: 'Sistem', num: true, render: (x) => rp(x.system) }], r.amount_mismatch)}` : ''}
        ${!r.missing_in_system.length && !r.missing_in_bank.length && !r.amount_mismatch.length ? '<div class="notice ok" style="margin-top:16px">Semua transaksi cocok.</div>' : ''}` : ''}`;
  },
  actions: {
    sample: async (ctx) => {
      const ev = (await call(ctx, 'listPayments', {})).filter((p) => p.provider !== 'manual').slice(0, 8);
      ctx.reconCsv = ev.map((p, i) => `${p.external_id},${p.va_number},${i === 1 ? p.amount - 50000 : p.amount},${String(p.paid_at).slice(0, 10)}`).concat(['BANK-TRX-9001,88081999999999,750000,' + ctx.me.today]).join('\n');
      ctx.recon = null; return '';
    },
  },
  forms: { recon: async (ctx, d) => { ctx.reconCsv = d.csv; ctx.recon = await call(ctx, 'reconcile', { csv: d.csv }); return 'Rekonsiliasi selesai'; } },
};

const buku = {
  roles: ['finance', 'manajer', 'admin'],
  async render(ctx) {
    const [tb, js] = await Promise.all([call(ctx, 'trialBalance'), call(ctx, 'journals', { limit: 40 })]);
    return pageHead('Back-office', 'Buku besar', 'Ledger double-entry append-only: setiap perpindahan nilai adalah satu jurnal seimbang. Koreksi dilakukan dengan jurnal balik.') + `
      <div class="notice ${tb.balanced ? 'ok' : 'bad'}" style="margin-bottom:12px">${tb.balanced ? `Seimbang: total debit = total kredit (${rp(tb.total_debit)}); aset = kewajiban & modal syirkah (${rp(tb.assets)}).` : 'Tidak seimbang. Hentikan transaksi dan hubungi pengembang.'}</div>
      ${table([{ label: 'Akun', render: (r) => `<span class="mono">${r.account}</span> ${esc(ACC_LABEL[r.account] || '')}` }, { label: 'Debit', num: true, render: (r) => rp(r.debit) }, { label: 'Kredit', num: true, render: (r) => rp(r.credit) }, { label: 'Saldo', num: true, render: (r) => rp(r.balance) }],
        [...tb.rows, { account: '', debit: tb.total_debit, credit: tb.total_credit, balance: null, __class: 'total' }])}
      <div class="section-title" style="margin-top:20px">Jurnal terbaru</div>
      ${table([{ label: 'Waktu', render: (j) => tglJam(j.created_at) }, { label: 'Keterangan', render: (j) => `${esc(j.description)}<div class="small muted">${esc(j.ref_type)} #${j.ref_id ?? '–'}</div>` },
        { label: 'Baris', render: (j) => j.lines.map((l) => `<div class="small mono">${l.account} ${l.debit ? `D ${num(l.debit)}` : `K ${num(l.credit)}`}${l.wallet_id ? ` w${l.wallet_id}` : ''}${l.financing_id ? ` f${l.financing_id}` : ''}</div>`).join('') }], js)}`;
  },
};

const anggota = {
  roles: ['admin', 'analis', 'manajer', 'finance'],
  async render(ctx) {
    const list = await call(ctx, 'listMembers', {});
    const admin = has(ctx, 'admin');
    const pending = list.filter((u) => u.kyc_status === 'pending');
    const roleChecks = (u) => `<div class="checks">${ROLES.map((r) => `<label><input type="checkbox" name="roles" value="${r}" ${u.roles.includes(r) ? 'checked' : ''}> ${ROLE_LABEL[r]}</label>`).join('')}</div>`;
    return pageHead('Back-office', 'Anggota', 'Verifikasi data anggota terhadap buku induk KMH sebelum akun dapat bertransaksi.') + `
      ${admin && pending.length ? `<div class="section-title">Menunggu verifikasi</div><div class="grid g2" style="margin-bottom:16px">${pending.map((u) => `<form class="card stack attention" data-form="kyc">
        <input type="hidden" name="user_id" value="${u.id}"><div><strong>${esc(u.name)}</strong> <span class="small muted">${esc(u.member_no)} · ${esc(u.email)} · ${esc(u.phone)}</span></div>
        <div class="small">Dokumen: ${u.docs.length ? u.docs.map((d) => (ctx.api.kycUrl(d.id) ? `<a href="${ctx.api.kycUrl(d.id)}" target="_blank" rel="noopener">${esc(d.kind)}</a>` : esc(`${d.kind} (${d.filename})`))).join(', ') : '<span class="muted">belum ada unggahan</span>'}</div>
        ${roleChecks(u)}${field(`kyc-note-${u.id}`, 'Catatan', inp(`kyc-note-${u.id}`, { name: 'note', placeholder: 'mis. cocok dengan buku induk' }))}
        <div class="row"><button class="btn primary" type="submit" name="approve" value="1">Setujui</button><button class="btn danger" type="button" data-act="reject-kyc" data-id="${u.id}">Tolak</button></div></form>`).join('')}</div>` : ''}
      ${table([
        { label: 'Nama', render: (u) => `<strong>${esc(u.name)}</strong><div class="small muted">${esc(u.email)}</div>` }, { label: 'No. anggota', render: (u) => `<span class="mono">${esc(u.member_no)}</span>` },
        { label: 'Peran', render: (u) => u.roles.map((r) => `<span class="chip">${ROLE_LABEL[r]}</span>`).join(' ') },
        { label: 'KYC', render: (u) => pill({ approved: 'Disetujui', pending: 'Menunggu', rejected: 'Ditolak' }[u.kyc_status], { approved: 'ok', pending: 'warn', rejected: 'bad' }[u.kyc_status]) },
        { label: '2FA', render: (u) => (u.totp_enabled ? pill('Aktif', 'ok') : '<span class="muted small">–</span>') },
        { label: 'Status', render: (u) => (u.active ? 'Aktif' : '<span class="muted">Nonaktif</span>') },
        { label: '', render: (u) => (admin && u.id !== ctx.me.user.id ? `<button class="btn sm" data-act="toggle" data-id="${u.id}" data-active="${u.active ? 0 : 1}">${u.active ? 'Nonaktifkan' : 'Aktifkan'}</button>` : '') },
      ], list)}
      ${admin ? `<form class="form card" data-form="staff" style="margin-top:16px"><div class="section-title">Tambah pengguna (staf atau anggota terverifikasi)</div>
        <div class="grid g3">${field('st-name', 'Nama', inp('st-name', { name: 'name', required: true }))}${field('st-email', 'Email', inp('st-email', { name: 'email', type: 'email', required: true }))}${field('st-no', 'No. anggota/staf', inp('st-no', { name: 'member_no', required: true }))}
        ${field('st-phone', 'HP', inp('st-phone', { name: 'phone', type: 'tel' }))}${ctx.api.mode === 'server' ? field('st-pass', 'Kata sandi awal', inp('st-pass', { name: 'password', type: 'password', required: true })) : ''}</div>
        ${roleChecks({ roles: [] })}<button class="btn primary" type="submit">Tambah pengguna</button></form>` : ''}`;
  },
  actions: {
    'reject-kyc': async (ctx, btn) => { await call(ctx, 'verifyMember', { user_id: Number(btn.dataset.id), approve: false, note: document.getElementById(`kyc-note-${btn.dataset.id}`)?.value || 'Data tidak cocok dengan buku induk' }); return 'Pendaftaran ditolak'; },
    toggle: async (ctx, btn) => { await call(ctx, 'setUserActive', { user_id: Number(btn.dataset.id), active: btn.dataset.active === '1' }); return 'Status pengguna diperbarui'; },
  },
  forms: {
    kyc: async (ctx, d) => { await call(ctx, 'verifyMember', { user_id: Number(d.user_id), approve: true, note: d.note, roles: [].concat(d.roles || []) }); return 'Anggota disetujui; VA dibuat'; },
    staff: async (ctx, d) => { await call(ctx, 'createUser', { ...d, roles: [].concat(d.roles || []) }); return 'Pengguna ditambahkan'; },
  },
};

const mitra = {
  roles: ['admin', 'manajer', 'analis'],
  async render(ctx) {
    const list = await call(ctx, 'listPartners');
    const admin = has(ctx, 'admin');
    return pageHead('Back-office', 'Mitra LPK/SO', 'Rekening mitra adalah satu-satunya tujuan pencairan. Batas eksposur mencegah konsentrasi risiko pada satu mitra.') +
      table([
        { label: 'Mitra', render: (p) => `<strong>${esc(p.name)}</strong><div class="small muted">${esc(p.contact)}</div>` }, { label: 'Jenis', render: (p) => `<span class="chip">${esc(p.type)}</span>` },
        { label: 'Rekening', render: (p) => `<span class="mono small">${esc(p.bank_name)} ${esc(p.bank_account)}</span>` }, { label: 'Pembiayaan', num: true, render: (p) => p.financing_count },
        { label: 'Eksposur / batas', num: true, render: (p) => `${rp(p.exposure)} / ${rp(p.exposure_limit)}${p.exposure_limit && p.exposure > p.exposure_limit ? ` ${pill('Melebihi', 'bad')}` : ''}` },
      ], list) + (admin ? `<form class="form card" data-form="partner" style="margin-top:16px"><div class="section-title">Tambah mitra</div><div class="grid g3">
        ${field('p-type', 'Jenis', sel('p-type', [['LPK', 'LPK'], ['SO', 'Sending Organization'], ['Vendor', 'Vendor lain']], 'LPK', 'type'))}${field('p-name', 'Nama', inp('p-name', { name: 'name', required: true }))}${field('p-contact', 'Kontak', inp('p-contact', { name: 'contact' }))}
        ${field('p-bank', 'Bank', inp('p-bank', { name: 'bank_name', required: true }))}${field('p-acc', 'Nomor rekening', inp('p-acc', { name: 'bank_account', required: true }))}${field('p-limit', 'Batas eksposur (Rp)', inp('p-limit', { name: 'exposure_limit', value: '300.000.000' }))}
      </div><button class="btn primary" type="submit">Simpan mitra</button></form>` : '');
  },
  forms: { partner: async (ctx, d) => { await call(ctx, 'savePartner', { ...d, exposure_limit: money(d.exposure_limit) }); return 'Mitra disimpan'; } },
};

const audit = {
  roles: ['admin', 'manajer', 'pendana'],
  async render(ctx) {
    const list = await call(ctx, 'auditLog', { limit: 200 });
    return pageHead('Back-office', 'Jejak audit', 'Setiap tindakan tercatat: siapa, kapan, apa, dan rinciannya.') +
      table([{ label: 'Waktu', render: (a) => tglJam(a.created_at) }, { label: 'Pelaku', render: (a) => esc(a.actor_name) }, { label: 'Tindakan', render: (a) => `<span class="mono small">${esc(a.action)}</span>` },
        { label: 'Objek', render: (a) => `${esc(a.entity)} #${a.entity_id ?? '–'}` }, { label: 'Rincian', render: (a) => `<span class="small muted mono" style="overflow-wrap:anywhere">${esc(a.detail).slice(0, 160)}</span>` }], list);
  },
};

const pengaturan = {
  roles: ['admin'],
  async render(ctx) {
    const s = await call(ctx, 'getSettings');
    const n = (k, label, help = '') => field(`s-${k}`, label, inp(`s-${k}`, { name: k, value: s[k] }), help);
    return pageHead('Back-office', 'Pengaturan', 'Parameter berlaku untuk pengajuan baru. Pembiayaan yang sudah dianalisa memakai parameter yang tercatat padanya.') + `
      <form class="form card" data-form="settings"><div class="grid g3">
        ${n('nisbah_investor', 'Nisbah pendana (%)', 'Sisa untuk KMH sebagai syarik pengelola.')}${n('protection_pct', 'Porsi Dana Proteksi (% ujrah)')}${n('kmh_min_pct', 'Modal minimal KMH (%)')}
        ${n('min_funding', 'Minimum porsi (Rp)')}${n('funding_step', 'Kelipatan porsi (Rp)')}${n('max_investor_pct', 'Porsi maks. satu pendana (%)')}
        ${n('listing_days', 'Lama penggalangan (hari)')}${n('max_claim_pct', 'Klaim Dana Proteksi maks. (% sisa pokok)')}${n('committee_quorum', 'Kuorum persetujuan komite')}
        ${n('max_installment_ratio', 'Angsuran maks. (% gaji)')}${n('va_prefix', 'Prefix VA', 'Dari bank/payment gateway.')}
        ${s.allow_time_travel ? field('s-sim', 'Tanggal simulasi', inp('s-sim', { type: 'date', name: 'sim_date', value: s.sim_date }), 'Hanya untuk lingkungan uji.') : ''}
      </div><button class="btn primary" type="submit">Simpan pengaturan</button></form>`;
  },
  forms: {
    settings: async (ctx, d) => {
      const o = {};
      for (const [k, v] of Object.entries(d)) o[k] = k === 'va_prefix' || k === 'sim_date' ? v : money(v);
      await call(ctx, 'updateSettings', o); ctx.settings = await call(ctx, 'getSettings'); return 'Pengaturan disimpan';
    },
  },
};


const notifikasi = {
  async render(ctx) {
    const list = await call(ctx, 'notifications');
    const html = pageHead('Akun', 'Notifikasi', '', list.some((n) => !n.read) ? '<button class="btn" data-act="read">Tandai semua dibaca</button>' : '') +
      (list.length ? `<div class="card" style="padding:0">${list.map((n) => {
        const [r, id] = String(n.link || '').split(':');
        return `<div style="padding:14px 18px;border-bottom:1px solid var(--line);${n.read ? '' : 'background:var(--accent-soft)'}"><div class="row" style="justify-content:space-between"><strong>${esc(n.title)}</strong><span class="small muted">${tglJam(n.created_at)}</span></div><div class="small">${esc(n.body)}</div>${r ? `<a class="small" href="#${r}${id ? `-${id}` : ''}" data-route="${r}" ${id ? `data-id="${id}"` : ''}>Buka</a>` : ''}</div>`;
      }).join('')}</div>` : empty('Belum ada notifikasi'));
    return html;
  },
  actions: { read: async (ctx) => { await call(ctx, 'markNotificationsRead'); return 'Semua notifikasi ditandai dibaca'; } },
};

const akun = {
  async render(ctx) {
    const u = ctx.me.user;
    const server = ctx.api.mode === 'server';
    return pageHead('Akun', 'Profil & keamanan') + `<div class="grid g2">
      <form class="form card" data-form="profile"><div class="section-title">Data anggota</div>
        ${kv([['Nama', esc(u.name)], ['No. anggota', esc(u.member_no)], ['Email', esc(u.email)], ['Status KYC', pill({ approved: 'Terverifikasi', pending: 'Menunggu verifikasi', rejected: 'Ditolak' }[u.kyc_status], { approved: 'ok', pending: 'warn', rejected: 'bad' }[u.kyc_status])]])}
        ${field('pf-phone', 'Nomor HP', inp('pf-phone', { name: 'phone', value: u.phone, type: 'tel' }))}
        ${field('pf-bank', 'Bank', inp('pf-bank', { name: 'bank_name', value: u.bank_name }))}
        ${field('pf-acc', 'Nomor rekening', inp('pf-acc', { name: 'bank_account', value: u.bank_account }))}
        ${field('pf-holder', 'Nama pemilik rekening', inp('pf-holder', { name: 'bank_holder', value: u.bank_holder || u.name }), 'Penarikan hanya ke rekening atas nama Anda sendiri.')}
        <button class="btn primary" type="submit">Simpan</button></form>
      <div class="stack">
        <form class="form card" data-form="kycdoc"><div class="section-title">Dokumen identitas</div>
          ${field('kd-kind', 'Jenis dokumen', sel('kd-kind', [['KTP', 'KTP'], ['KK', 'Kartu Keluarga'], ['Swafoto dengan KTP', 'Swafoto dengan KTP'], ['Kontrak/LoA magang', 'Kontrak/LoA magang']], 'KTP', 'kind'))}
          ${field('kd-file', 'Berkas (JPG, PNG, PDF; maks. 5 MB)', '<input id="kd-file" name="file" type="file" accept=".jpg,.jpeg,.png,.pdf" required>')}
          <button class="btn" type="submit">Unggah</button>${server ? '' : '<p class="small muted" style="margin:0">Di mode demo hanya nama berkas yang dicatat.</p>'}</form>
        ${server ? `<form class="form card" data-form="password"><div class="section-title">Ganti kata sandi</div>${field('pw-cur', 'Kata sandi saat ini', inp('pw-cur', { name: 'current', type: 'password', required: true }))}${field('pw-new', 'Kata sandi baru (min. 8)', inp('pw-new', { name: 'next', type: 'password', required: true }))}<button class="btn" type="submit">Ganti</button></form>
        <div class="card stack"><div class="section-title">Autentikasi dua langkah</div>${u.totp_enabled ? pill('Aktif', 'ok') : `<p class="small muted" style="margin:0">Wajib untuk staf back-office. Gunakan Google Authenticator, Microsoft Authenticator, atau aplikasi TOTP lain.</p><button class="btn" data-act="setup2fa">Aktifkan</button><div id="twofa"></div>`}</div>` : ''}
      </div></div>`;
  },
  actions: {
    setup2fa: async (ctx) => {
      const r = await ctx.api.setup2fa();
      document.getElementById('twofa').innerHTML = `<div class="notice info small">Tambahkan akun manual di aplikasi autentikator dengan kunci berikut, lalu masukkan kode 6 digit.<div class="mono" style="font-size:15px;margin-top:6px;overflow-wrap:anywhere">${esc(r.secret)}</div></div>
        <form class="inline-form" data-form="enable2fa">${field('otp-code', 'Kode 6 digit', inp('otp-code', { name: 'otp', required: true }))}<button class="btn primary" type="submit">Verifikasi</button></form>`;
      return false;
    },
  },
  forms: {
    profile: async (ctx, d) => { await call(ctx, 'updateProfile', d); return 'Profil disimpan'; },
    password: async (ctx, d) => { await ctx.api.changePassword(d.current, d.next); return 'Kata sandi diganti'; },
    enable2fa: async (ctx, d) => { await ctx.api.enable2fa(d.otp); return 'Autentikasi dua langkah aktif'; },
    kycdoc: async (ctx, d, form) => { const file = form.querySelector('input[type=file]').files[0]; if (!file) throw new Error('Pilih berkas'); await ctx.api.uploadKyc(d.kind, file); return 'Dokumen diunggah'; },
  },
};

export const VIEWS = { beranda, pasar, portofolio, dompet, saya, ajukan, pembiayaan, dasbor, antrian, penagihan, pencairan, penarikan, pembayaran, rekonsiliasi, buku, anggota, mitra, audit, pengaturan, notifikasi, akun };
