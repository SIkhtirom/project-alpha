



import { ST, ACC, DEFAULT_SETTINGS, PAYABLE, BACKOFFICE, ROLES, VAULT_TOTAL_DANA, VAULT_LOS_KONTRAK } from './constants.js';
import {
  sum, splitLR, capSplit, addMonths, addDays, buildSchedule, allocatePayment, splitUjrah,
  gradeFromScore, computeDpd, dpdBucket, parseCsv, daysBetween,
} from './calc.js';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const int = (v, name) => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d-]/g, '')) : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new AppError(`${name} harus berupa angka bulat`);
  return n;
};
const req = (v, name) => { if (v === undefined || v === null || String(v).trim() === '') throw new AppError(`${name} wajib diisi`); return String(v).trim(); };
export const rolesOf = (u) => (u?.roles ? String(u.roles).split(',').filter(Boolean) : []);
const has = (actor, ...roles) => rolesOf(actor).some((r) => roles.includes(r));
const need = (actor, ...roles) => {
  if (!actor) throw new AppError('Silakan masuk terlebih dahulu', 401);
  if (!has(actor, ...roles)) throw new AppError('Anda tidak memiliki akses untuk tindakan ini', 403);
};
const isBack = (a) => has(a, ...BACKOFFICE);

export function createServices(db, env) {
  

  
  async function settings(t = db) {
    const rows = await t.find('settings', {});
    const s = { ...DEFAULT_SETTINGS };
    for (const r of rows) s[r.key] = typeof DEFAULT_SETTINGS[r.key] === 'number' ? Number(r.value) : r.value;
    return s;
  }
  async function today(t = db) {
    if (env.allowTimeTravel) { const s = await settings(t); if (s.sim_date) return s.sim_date; }
    return env.realToday();
  }
  async function stamp(t = db) {
    const d = await today(t);
    const now = env.realNow();
    return d === now.slice(0, 10) ? now : `${d}T${now.slice(11)}`;
  }
  async function audit(t, actor, action, entity, entity_id, detail = {}) {
    await t.insert('audit_logs', {
      actor_id: actor?.id ?? null, actor_name: actor?.name ?? 'Sistem', action, entity, entity_id: entity_id ?? null,
      detail: JSON.stringify(detail), created_at: await stamp(t),
    });
  }
  async function notify(t, user_id, title, body, link = '') {
    if (!user_id) return;
    await t.insert('notifications', { user_id, title, body, link, read: 0, created_at: await stamp(t) });
  }
  async function notifyRole(t, role, title, body, link = '') {
    const users = await t.find('users', { active: 1 });
    for (const u of users) if (rolesOf(u).includes(role)) await notify(t, u.id, title, body, link);
  }

  
  async function post(t, { ref_type, ref_id, description, actor, lines }) {
    const ls = lines.filter((l) => (l.debit || 0) + (l.credit || 0) > 0);
    for (const l of ls) if ((l.debit || 0) < 0 || (l.credit || 0) < 0) throw new AppError('Nominal jurnal negatif', 500);
    const d = sum(ls, (l) => l.debit || 0), c = sum(ls, (l) => l.credit || 0);
    if (d !== c) throw new AppError(`Jurnal tidak seimbang (${d} ≠ ${c})`, 500);
    if (d === 0) return null;
    const j = await t.insert('journals', { ref_type, ref_id: ref_id ?? null, description, created_by: actor?.id ?? null, created_at: await stamp(t) });
    for (const l of ls) {
      await t.insert('ledger_lines', {
        journal_id: j.id, account: l.account, wallet_id: l.wallet_id ?? null, financing_id: l.financing_id ?? null,
        debit: l.debit || 0, credit: l.credit || 0,
      });
    }
    return j;
  }
  async function bal(t, where) {
    const rows = await t.find('ledger_lines', where);
    const d = sum(rows, (r) => r.debit), c = sum(rows, (r) => r.credit);
    return where.account.startsWith('1') ? d - c : c - d;
  }
  async function wallet(t, owner_type, owner_id = null) {
    const w = await t.one('wallets', { owner_type, owner_id });
    return w || t.insert('wallets', { owner_type, owner_id });
  }
  const escrowW = (t) => wallet(t, 'escrow');
  const kmhW = (t) => wallet(t, 'kmh');
  const protW = (t) => wallet(t, 'protection');
  const holderWallet = async (t, f) => (f.investor_type === 'member' ? wallet(t, 'member', f.investor_id) : kmhW(t));
  const availAcc = (f) => (f.investor_type === 'member' ? ACC.AVAIL : ACC.KMH_AVAIL);
  const lockAcc = (f) => (f.investor_type === 'member' ? ACC.LOCKED : ACC.KMH_LOCKED);

  async function ensureVA(t, owner_type, owner_id) {
    const ex = await t.one('virtual_accounts', { owner_type, owner_id });
    if (ex) return ex;
    const s = await settings(t);
    const digit = { member: '1', financing: '2', kmh: '9' }[owner_type];
    const tmp = await t.insert('virtual_accounts', { owner_type, owner_id, va_number: `tmp-${owner_type}-${owner_id}`, created_at: await stamp(t) });
    const va_number = `${s.va_prefix}${digit}${String(tmp.id).padStart(8, '0')}`;
    await t.update('virtual_accounts', tmp.id, { va_number });
    return { ...tmp, va_number };
  }

  
  async function holders(t, financing_id) {
    const fs = await t.find('fundings', { financing_id, status: 'active' }, { orderBy: ['id', 'asc'] });
    const out = [];
    for (const f of fs) {
      const w = await holderWallet(t, f);
      out.push({ ...f, wallet_id: w.id });
    }
    
    const byWallet = {};
    for (const h of out) {
      if (byWallet[h.wallet_id] === undefined) byWallet[h.wallet_id] = await bal(t, { account: ACC.MODAL, wallet_id: h.wallet_id, financing_id });
    }
    const walletWeight = {};
    for (const h of out) walletWeight[h.wallet_id] = (walletWeight[h.wallet_id] || 0) + h.amount;
    for (const h of out) h.remaining = Math.floor((byWallet[h.wallet_id] * h.amount) / walletWeight[h.wallet_id]);
    
    for (const wid of Object.keys(byWallet)) {
      const rows = out.filter((h) => String(h.wallet_id) === String(wid));
      const diff = byWallet[wid] - sum(rows, (r) => r.remaining);
      if (rows.length) rows[0].remaining += diff;
    }
    return out;
  }

  
  async function capitalLines(t, financing_id, total, creditSide = true) {
    const hs = await holders(t, financing_id);
    const shares = capSplit(total, hs.map((h) => h.amount), hs.map((h) => h.remaining));
    const lines = [];
    hs.forEach((h, i) => {
      if (!shares[i]) return;
      lines.push({ account: ACC.MODAL, wallet_id: h.wallet_id, financing_id, debit: shares[i] });
      if (creditSide) lines.push({ account: availAcc(h), wallet_id: h.wallet_id, credit: shares[i] });
    });
    return { lines, hs, shares };
  }

  
  async function getFin(t, id) {
    const f = await t.get('financings', int(id, 'ID pembiayaan'));
    if (!f) throw new AppError('Pembiayaan tidak ditemukan', 404);
    return f;
  }
  async function fundedTotal(t, financing_id) {
    const fs = await t.find('fundings', { financing_id, status: ['locked', 'active'] });
    return sum(fs.filter((f) => f.investor_type !== 'kmh_buyback'), (f) => f.amount);
  }
  async function walletSummary(t, w, kind = 'member') {
    const avail = await bal(t, { account: kind === 'member' ? ACC.AVAIL : ACC.KMH_AVAIL, wallet_id: w.id });
    const locked = await bal(t, { account: kind === 'member' ? ACC.LOCKED : ACC.KMH_LOCKED, wallet_id: w.id });
    const withdrawing = kind === 'member' ? await bal(t, { account: ACC.WD_HOLD, wallet_id: w.id }) : 0;
    const invested = await bal(t, { account: ACC.MODAL, wallet_id: w.id });
    const dists = await t.find('distributions', { wallet_id: w.id });
    return {
      wallet_id: w.id, available: avail, locked, withdrawing, invested,
      profit_total: sum(dists, (d) => d.profit), principal_returned: sum(dists, (d) => d.principal),
    };
  }
  function publicUser(u) {
    if (!u) return null;
    const { password_hash, totp_secret, ...rest } = u;
    return { ...rest, roles: rolesOf(u), totp_enabled: !!u.totp_enabled };
  }
  function mask(name) {
    return String(name).split(/\s+/).map((p) => p[0] + '.').join(' ');
  }

  async function finView(t, f, actor) {
    const td = await today(t);
    const borrower = await t.get('users', f.borrower_id);
    const partner = f.partner_id ? await t.get('partners', f.partner_id) : null;
    const scheds = await t.find('schedules', { financing_id: f.id }, { orderBy: ['seq', 'asc'] });
    const funded = await fundedTotal(t, f.id);
    const outstanding = await bal(t, { account: ACC.PIUTANG, financing_id: f.id });
    const live = scheds.filter((s) => s.status !== 'cancelled');
    const dpd = [ST.REPAYING, ST.FAILED_DEPARTURE, ST.LOSS_HANDLING, ST.CLOSED_BUYBACK].includes(f.status) ? computeDpd(live, td) : 0;
    const showName = actor && (isBack(actor) || actor.id === f.borrower_id);
    const installment = live.length ? live[0].principal_due + live[0].ujrah_due : null;
    return {
      ...f, score: f.score_json ? JSON.parse(f.score_json) : null,
      borrower_name: showName ? borrower?.name : mask(borrower?.name || '-'),
      borrower_member_no: showName ? borrower?.member_no : null,
      partner_name: partner?.name || '-', funded, progress: f.principal ? funded / f.principal : 0,
      outstanding, dpd, bucket: dpdBucket(dpd), installment,
      paid_count: live.filter((s) => s.status === 'paid').length, schedule_count: live.length,
      days_left: f.listing_deadline ? daysBetween(td, f.listing_deadline) : null,
    };
  }

  
  async function tick() {
    return db.tx(async (t) => {
      const td = await today(t);
      const listed = await t.find('financings', { status: ST.LISTED });
      let expired = 0;
      for (const f of listed) {
        if (f.listing_deadline && f.listing_deadline < td && (await fundedTotal(t, f.id)) < f.principal) {
          await releaseFundings(t, f, null);
          await t.update('financings', f.id, { status: ST.EXPIRED, updated_at: await stamp(t) });
          await notify(t, f.borrower_id, 'Penggalangan dana berakhir', `Pembiayaan ${f.code} tidak terdanai penuh. Dana pendana telah dikembalikan.`, `pembiayaan:${f.id}`);
          await audit(t, null, 'listing_expired', 'financing', f.id);
          expired++;
        }
      }
      return { today: td, expired };
    });
  }
  async function releaseFundings(t, f, actor) {
    const fs = await t.find('fundings', { financing_id: f.id, status: 'locked' });
    for (const fu of fs) {
      const w = await holderWallet(t, fu);
      await post(t, {
        ref_type: 'release', ref_id: fu.id, actor, description: `Pengembalian dana terkunci ${f.code}`,
        lines: [{ account: lockAcc(fu), wallet_id: w.id, debit: fu.amount }, { account: availAcc(fu), wallet_id: w.id, credit: fu.amount }],
      });
      await t.update('fundings', fu.id, { status: 'released' });
      if (fu.investor_type === 'member') await notify(t, fu.investor_id, 'Dana dikembalikan', `Porsi Anda di ${f.code} dikembalikan ke saldo tersedia.`, 'dompet');
    }
  }

  
  const S = {};

  
  S.getSettings = async (actor) => ({ ...(await settings()), allow_time_travel: !!env.allowTimeTravel, today: await today() });
  S.updateSettings = async (actor, args) => {
    need(actor, 'admin');
    return db.tx(async (t) => {
      for (const [k, v] of Object.entries(args || {})) {
        if (!(k in DEFAULT_SETTINGS)) continue;
        if (k === 'sim_date' && !env.allowTimeTravel) continue;
        const val = typeof DEFAULT_SETTINGS[k] === 'number' ? String(int(v, k)) : String(v ?? '');
        const ex = await t.one('settings', { key: k });
        if (ex) await t.update('settings', ex.id, { value: val }); else await t.insert('settings', { key: k, value: val });
      }
      await audit(t, actor, 'update_settings', 'settings', null, args);
      return settings(t);
    });
  };
  S.advanceDate = async (actor, { days = 0, months = 0, date } = {}) => {
    if (!env.allowTimeTravel) throw new AppError('Simulasi tanggal tidak diaktifkan di server ini', 403);
    need(actor, 'admin', 'manajer', 'finance', 'analis', 'komite', 'pendana', 'penerima');
    const cur = await today();
    let next = date || cur;
    if (months) next = addMonths(next, int(months, 'Bulan'));
    if (days) next = addDays(next, int(days, 'Hari'));
    await db.tx(async (t) => {
      const ex = await t.one('settings', { key: 'sim_date' });
      if (ex) await t.update('settings', ex.id, { value: next }); else await t.insert('settings', { key: 'sim_date', value: next });
    });
    await tick();
    return { today: next };
  };

  
  S.register = async (_actor, a) => db.tx(async (t) => {
    const member_no = req(a.member_no, 'Nomor anggota');
    const email = req(a.email, 'Email').toLowerCase();
    if (await t.one('users', { email })) throw new AppError('Email sudah terdaftar');
    if (await t.one('users', { member_no })) throw new AppError('Nomor anggota sudah terdaftar');
    const wanted = (a.roles || ['pendana']).filter((r) => r === 'pendana' || r === 'penerima');
    if (!wanted.length) throw new AppError('Pilih minimal satu peran: Pendana atau Penerima');
    const u = await t.insert('users', {
      member_no, name: req(a.name, 'Nama'), email, phone: req(a.phone, 'Nomor HP'),
      password_hash: a.password_hash || null, roles: wanted.join(','), kyc_status: 'approved', kyc_note: '',
      bank_name: a.bank_name || '', bank_account: a.bank_account || '', bank_holder: a.bank_holder || '', address: a.address || '',
      totp_secret: null, totp_enabled: 0, active: 1, created_at: await stamp(t),
    });
    if (wanted.includes('pendana')) { await wallet(t, 'member', u.id); await ensureVA(t, 'member', u.id); }
    await audit(t, u, 'register', 'user', u.id, { member_no, roles: wanted });
    await notifyRole(t, 'admin', 'Pendaftaran anggota baru', `${u.name} (${member_no}) bergabung sebagai anggota pendana.`, 'anggota');
    return publicUser(u);
  });
  S.createUser = async (actor, a) => {
    need(actor, 'admin');
    return db.tx(async (t) => {
      const email = req(a.email, 'Email').toLowerCase();
      if (await t.one('users', { email })) throw new AppError('Email sudah terdaftar');
      const roles = (a.roles || []).filter((r) => ROLES.includes(r));
      if (!roles.length) throw new AppError('Pilih minimal satu peran');
      const u = await t.insert('users', {
        member_no: a.member_no || `STAF-${Date.now() % 100000}`, name: req(a.name, 'Nama'), email, phone: a.phone || '',
        password_hash: a.password_hash || null, roles: roles.join(','), kyc_status: a.kyc_status || 'approved', kyc_note: '',
        bank_name: a.bank_name || '', bank_account: a.bank_account || '', bank_holder: a.bank_holder || '', address: '',
        totp_secret: null, totp_enabled: 0, active: 1, created_at: await stamp(t),
      });
      if (u.kyc_status === 'approved' && roles.includes('pendana')) { await wallet(t, 'member', u.id); await ensureVA(t, 'member', u.id); }
      await audit(t, actor, 'create_user', 'user', u.id, { roles });
      return publicUser(u);
    });
  };
  S.me = async (actor) => {
    if (!actor) return null;
    const u = await db.get('users', actor.id);
    const out = { user: publicUser(u) };
    if (rolesOf(u).includes('pendana') && u.kyc_status === 'approved') {
      const w = await wallet(db, 'member', u.id);
      out.wallet = await walletSummary(db, w);
      out.va = (await db.one('virtual_accounts', { owner_type: 'member', owner_id: u.id }))?.va_number || null;
    }
    out.unread = (await db.find('notifications', { user_id: u.id, read: 0 })).length;
    out.today = await today();
    out.vault = {
      accepted: Boolean(u.vault_accepted_at),
      total: u.vault_accepted_at ? Number(u.vault_total || VAULT_TOTAL_DANA) : 0,
      los_contracts: VAULT_LOS_KONTRAK,
      accepted_at: u.vault_accepted_at || null,
    };
    return out;
  };
  S.acceptVaultAccess = async (actor) => {
    if (!actor) throw new AppError('Silakan masuk terlebih dahulu', 401);
    const faces = await db.find('face_profiles', { user_id: actor.id, revoked_at: null });
    const creds = await db.find('webauthn_credentials', { user_id: actor.id, revoked_at: null });
    if (!faces.length && !creds.length) {
      throw new AppError('Daftarkan Face Recognition atau Sidik Jari / Passkey terlebih dahulu sebelum menyetujui akses data nominatif.', 403);
    }
    return db.tx(async (t) => {
      const at = await stamp(t);
      await t.update('users', actor.id, { vault_accepted_at: at, vault_total: VAULT_TOTAL_DANA });
      await audit(t, actor, 'vault_accept', 'user', actor.id, { total: VAULT_TOTAL_DANA, los_contracts: VAULT_LOS_KONTRAK, method: faces.length ? 'face-recognition' : 'webauthn' });
      return { accepted: true, total: VAULT_TOTAL_DANA, los_contracts: VAULT_LOS_KONTRAK, accepted_at: at };
    });
  };
  S.updateProfile = async (actor, a) => {
    if (!actor) throw new AppError('Silakan masuk terlebih dahulu', 401);
    return db.tx(async (t) => {
      const patch = {};
      for (const k of ['phone', 'bank_name', 'bank_account', 'bank_holder', 'address']) if (a[k] !== undefined) patch[k] = String(a[k]).trim();
      await t.update('users', actor.id, patch);
      await audit(t, actor, 'update_profile', 'user', actor.id, patch);
      return publicUser(await t.get('users', actor.id));
    });
  };
  S.listMembers = async (actor, { status } = {}) => {
    need(actor, 'admin', 'analis', 'manajer', 'finance');
    const us = await db.find('users', status ? { kyc_status: status } : {}, { orderBy: ['id', 'desc'] });
    const docs = await db.find('kyc_docs', {});
    return us.map((u) => ({ ...publicUser(u), docs: docs.filter((d) => d.user_id === u.id).map((d) => ({ id: d.id, kind: d.kind, filename: d.filename })) }));
  };
  S.verifyMember = async (actor, { user_id, approve, note, roles }) => {
    need(actor, 'admin');
    return db.tx(async (t) => {
      const u = await t.get('users', int(user_id, 'ID anggota'));
      if (!u) throw new AppError('Anggota tidak ditemukan', 404);
      const patch = { kyc_status: approve ? 'approved' : 'rejected', kyc_note: note || '' };
      if (roles) {
        const rs = roles.filter((r) => ROLES.includes(r));
        if (!rs.length) throw new AppError('Pilih minimal satu peran');
        patch.roles = rs.join(',');
      }
      await t.update('users', u.id, patch);
      const nu = await t.get('users', u.id);
      if (approve && rolesOf(nu).includes('pendana')) { await wallet(t, 'member', u.id); await ensureVA(t, 'member', u.id); }
      await notify(t, u.id, approve ? 'Verifikasi disetujui' : 'Verifikasi ditolak',
        approve ? 'Akun Anda aktif. Anda sudah dapat bertransaksi.' : `Alasan: ${note || '-'}`, 'akun');
      await audit(t, actor, approve ? 'kyc_approve' : 'kyc_reject', 'user', u.id, { note, roles: patch.roles });
      return publicUser(nu);
    });
  };
  S.setUserActive = async (actor, { user_id, active }) => {
    need(actor, 'admin');
    return db.tx(async (t) => {
      await t.update('users', int(user_id, 'ID'), { active: active ? 1 : 0 });
      await audit(t, actor, active ? 'user_enable' : 'user_disable', 'user', user_id);
      return true;
    });
  };
  S.addKycDoc = async (actor, { kind, filename, stored_path }) => {
    if (!actor) throw new AppError('Silakan masuk terlebih dahulu', 401);
    return db.tx(async (t) => {
      const d = await t.insert('kyc_docs', { user_id: actor.id, kind: req(kind, 'Jenis dokumen'), filename: req(filename, 'Nama berkas'), stored_path: stored_path || '', created_at: await stamp(t) });
      await audit(t, actor, 'kyc_upload', 'kyc_doc', d.id, { kind, filename });
      return d;
    });
  };

  
  S.listPartners = async (actor) => {
    if (!actor) throw new AppError('Silakan masuk terlebih dahulu', 401);
    const ps = await db.find('partners', {}, { orderBy: ['name', 'asc'] });
    const td = await today();
    const fins = await db.find('financings', {});
    const out = [];
    for (const p of ps) {
      let exposure = 0;
      for (const f of fins.filter((x) => x.partner_id === p.id)) exposure += await bal(db, { account: ACC.PIUTANG, financing_id: f.id });
      out.push({ ...p, exposure, financing_count: fins.filter((x) => x.partner_id === p.id).length });
    }
    return isBack(actor) ? out : out.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, type: p.type }));
  };
  S.savePartner = async (actor, a) => {
    need(actor, 'admin');
    return db.tx(async (t) => {
      const row = {
        type: req(a.type, 'Jenis mitra'), name: req(a.name, 'Nama mitra'), contact: a.contact || '',
        bank_name: req(a.bank_name, 'Bank'), bank_account: req(a.bank_account, 'Nomor rekening'),
        exposure_limit: int(a.exposure_limit || 0, 'Batas eksposur'), active: a.active === false ? 0 : 1,
      };
      let p;
      if (a.id) { await t.update('partners', int(a.id, 'ID'), row); p = await t.get('partners', int(a.id, 'ID')); }
      else p = await t.insert('partners', { ...row, created_at: await stamp(t) });
      await audit(t, actor, a.id ? 'partner_update' : 'partner_create', 'partner', p.id, row);
      return p;
    });
  };

  
  S.receivePayment = async (actor, a) => db.tx(async (t) => {
    const provider = req(a.provider, 'Penyedia');
    const external_id = req(a.external_id, 'ID transaksi');
    const dup = await t.one('payment_events', { provider, external_id });
    if (dup) return { duplicate: true, event: dup };
    const amount = int(a.amount, 'Nominal');
    if (amount <= 0) throw new AppError('Nominal harus lebih dari 0');
    const va_number = req(a.va_number, 'Nomor VA');
    const va = await t.one('virtual_accounts', { va_number });
    const ev = await t.insert('payment_events', {
      provider, external_id, va_number, amount, paid_at: a.paid_at || (await stamp(t)), status: 'received', note: '',
      raw: JSON.stringify(a.raw || {}), financing_id: null, created_at: await stamp(t),
    });
    const escrow = await escrowW(t);
    if (!va) {
      await t.update('payment_events', ev.id, { status: 'unmatched', note: 'Nomor VA tidak dikenal' });
      await notifyRole(t, 'finance', 'Pembayaran tidak dikenali', `VA ${va_number} Rp${amount} tidak terdaftar.`, 'pembayaran');
      return { event: { ...ev, status: 'unmatched' } };
    }
    if (va.owner_type === 'member' || va.owner_type === 'kmh') {
      const w = va.owner_type === 'member' ? await wallet(t, 'member', va.owner_id) : await kmhW(t);
      await post(t, {
        ref_type: 'topup', ref_id: ev.id, actor, description: `Top-up via VA ${va_number}`,
        lines: [{ account: ACC.KAS, wallet_id: escrow.id, debit: amount }, { account: va.owner_type === 'member' ? ACC.AVAIL : ACC.KMH_AVAIL, wallet_id: w.id, credit: amount }],
      });
      await t.update('payment_events', ev.id, { status: 'processed', note: 'Top-up saldo' });
      if (va.owner_type === 'member') await notify(t, va.owner_id, 'Top-up diterima', `Saldo bertambah Rp${amount.toLocaleString('id-ID')}.`, 'dompet');
      await audit(t, actor, 'payment_topup', 'payment_event', ev.id, { va_number, amount });
      return { event: { ...ev, status: 'processed' } };
    }
    const res = await applyFinancingPayment(t, va.owner_id, amount, ev, actor);
    return { event: await t.get('payment_events', ev.id), ...res };
  });

  async function applyFinancingPayment(t, fid, amount, ev, actor) {
    const f = await t.get('financings', fid);
    const escrow = await escrowW(t);
    await t.update('payment_events', ev.id, { financing_id: fid });
    if (!PAYABLE.includes(f.status)) {
      await post(t, {
        ref_type: 'suspense', ref_id: ev.id, actor, description: `Titipan ${f.code} (status ${f.status})`,
        lines: [{ account: ACC.KAS, wallet_id: escrow.id, debit: amount }, { account: ACC.TITIPAN, financing_id: fid, credit: amount }],
      });
      await t.update('payment_events', ev.id, { status: 'suspense', note: 'Dicatat sebagai titipan; pembiayaan belum dalam masa bayar' });
      await notifyRole(t, 'finance', 'Pembayaran masuk titipan', `${f.code} menerima Rp${amount} saat status ${f.status}.`, `pembiayaan:${fid}`);
      return { suspense: amount };
    }
    const scheds = (await t.find('schedules', { financing_id: fid }, { orderBy: ['seq', 'asc'] })).filter((s) => s.status !== 'cancelled' && s.status !== 'written_off');
    const { items, leftover } = allocatePayment(scheds, amount);
    const P = sum(items, (i) => i.principal), U = sum(items, (i) => i.ujrah);
    await post(t, {
      ref_type: 'repayment', ref_id: ev.id, actor, description: `Angsuran ${f.code} via VA`,
      lines: [
        { account: ACC.KAS, wallet_id: escrow.id, debit: amount },
        { account: ACC.PIUTANG, financing_id: fid, credit: P },
        { account: ACC.UJRAH, financing_id: fid, credit: U },
        { account: ACC.TITIPAN, financing_id: fid, credit: leftover },
      ],
    });
    const at = await stamp(t);
    for (const it of items) {
      const s = scheds.find((x) => x.id === it.schedule_id);
      const pp = s.paid_principal + it.principal, pu = s.paid_ujrah + it.ujrah;
      const full = pp + pu >= s.principal_due + s.ujrah_due;
      await t.update('schedules', s.id, { paid_principal: pp, paid_ujrah: pu, status: full ? 'paid' : 'partial', paid_at: full ? at : s.paid_at });
    }
    await distribute(t, f, P, U, ev.id, actor);
    const outstanding = await bal(t, { account: ACC.PIUTANG, financing_id: fid });
    const remainingUjrah = sum(scheds, (s) => s.ujrah_due) - sum(scheds, (s) => s.paid_ujrah) - U;
    let status = f.status;
    if (f.status === ST.GRACE) status = ST.REPAYING;
    if (outstanding === 0 && remainingUjrah <= 0) status = ST.PAID_OFF;
    await t.update('financings', fid, { status, updated_at: at });
    await t.update('payment_events', ev.id, {
      status: 'processed',
      note: `Pokok Rp${P.toLocaleString('id-ID')}, ujrah Rp${U.toLocaleString('id-ID')}${leftover ? `, titipan Rp${leftover.toLocaleString('id-ID')}` : ''}`,
    });
    await notify(t, f.borrower_id, 'Pembayaran diterima', `Pembayaran ${f.code} sebesar Rp${amount.toLocaleString('id-ID')} telah tercatat.`, `pembiayaan:${fid}`);
    if (status === ST.PAID_OFF) await notify(t, f.borrower_id, 'Pembiayaan lunas', `Terima kasih, ${f.code} telah lunas.`, `pembiayaan:${fid}`);
    if (leftover) await notifyRole(t, 'finance', 'Kelebihan bayar', `${f.code} kelebihan bayar Rp${leftover}; perlu dikembalikan.`, `pembiayaan:${fid}`);
    await audit(t, actor, 'payment_financing', 'financing', fid, { amount, P, U, leftover });
    return { principal: P, ujrah: U, leftover };
  }

  async function distribute(t, f, P, U, evId, actor) {
    const hs = await holders(t, f.id);
    if (!hs.length) return;
    const kmh = await kmhW(t), prot = await protW(t);
    const at = await stamp(t);
    const rows = [];
    if (U > 0) {
      const sp = splitUjrah(U, f.protection_pct, f.nisbah_investor);
      const lines = [{ account: ACC.UJRAH, financing_id: f.id, debit: U }];
      if (sp.protection) { lines.push({ account: ACC.PROTEKSI, wallet_id: prot.id, credit: sp.protection }); rows.push({ wallet_id: prot.id, funding_id: null, principal: 0, profit: sp.protection, kind: 'proteksi' }); }
      const pool = hs.filter((h) => h.investor_type !== 'kmh');
      let kmhProfit = sp.kmh;
      if (sp.kmh) rows.push({ wallet_id: kmh.id, funding_id: null, principal: 0, profit: sp.kmh, kind: 'nisbah_kmh' });
      if (pool.length) {
        const shares = splitLR(sp.investor, pool.map((h) => h.amount));
        pool.forEach((h, i) => {
          if (!shares[i]) return;
          if (h.investor_type === 'member') {
            lines.push({ account: ACC.AVAIL, wallet_id: h.wallet_id, credit: shares[i] });
            rows.push({ wallet_id: h.wallet_id, funding_id: h.id, principal: 0, profit: shares[i], kind: 'bagi_hasil' });
          } else { kmhProfit += shares[i]; rows.push({ wallet_id: kmh.id, funding_id: h.id, principal: 0, profit: shares[i], kind: 'bagi_hasil' }); }
        });
      } else if (sp.investor) { kmhProfit += sp.investor; rows.push({ wallet_id: kmh.id, funding_id: null, principal: 0, profit: sp.investor, kind: 'bagi_hasil' }); }
      if (kmhProfit) lines.push({ account: ACC.KMH_AVAIL, wallet_id: kmh.id, credit: kmhProfit });
      await post(t, { ref_type: 'distribution', ref_id: evId, actor, description: `Distribusi ujrah ${f.code}`, lines });
    }
    if (P > 0) {
      const { lines, hs: hh, shares } = await capitalLines(t, f.id, P);
      await post(t, { ref_type: 'principal_return', ref_id: evId, actor, description: `Pengembalian pokok ${f.code}`, lines });
      hh.forEach((h, i) => { if (shares[i]) rows.push({ wallet_id: h.wallet_id, funding_id: h.id, principal: shares[i], profit: 0, kind: 'pokok' }); });
    }
    for (const r of rows) await t.insert('distributions', { ...r, payment_event_id: evId, financing_id: f.id, created_at: at });
    const notified = new Set();
    for (const h of hs) if (h.investor_type === 'member' && !notified.has(h.investor_id)) {
      notified.add(h.investor_id);
      await notify(t, h.investor_id, 'Hasil diterima', `Pembayaran ${f.code} telah dibagikan ke saldo Anda.`, 'portofolio');
    }
  }

  S.simulatePayment = async (actor, { va_number, amount, note }) => {
    need(actor, 'finance', 'admin', 'pendana', 'penerima', 'manajer');
    if (!env.allowSimulator) throw new AppError('Simulator VA tidak aktif di server ini', 403);
    return S.receivePayment(actor, { provider: 'simulator', external_id: `SIM-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, va_number, amount, raw: { note: note || '' } });
  };
  S.recordManualPayment = async (actor, { va_number, amount, reference }) => {
    need(actor, 'finance');
    return S.receivePayment(actor, { provider: 'manual', external_id: req(reference, 'Nomor referensi bukti transfer'), va_number, amount, raw: { by: actor.name } });
  };
  S.listPayments = async (actor, { status } = {}) => {
    need(actor, 'finance', 'manajer', 'admin');
    return db.find('payment_events', status ? { status } : {}, { orderBy: ['id', 'desc'], limit: 300 });
  };
  S.listVAs = async (actor) => {
    need(actor, 'finance', 'manajer', 'admin');
    const vas = await db.find('virtual_accounts', {}, { orderBy: ['id', 'asc'] });
    const out = [];
    for (const v of vas) {
      let owner = 'KMH';
      if (v.owner_type === 'member') owner = (await db.get('users', v.owner_id))?.name;
      if (v.owner_type === 'financing') owner = (await db.get('financings', v.owner_id))?.code;
      out.push({ ...v, owner });
    }
    return out;
  };

  
  S.createApplication = async (actor, a) => {
    need(actor, 'penerima');
    return db.tx(async (t) => {
      const u = await t.get('users', actor.id);
      if (u.kyc_status !== 'approved') throw new AppError('Akun Anda belum terverifikasi');
      const open = (await t.find('financings', { borrower_id: u.id })).filter((f) => ![ST.REJECTED, ST.EXPIRED, ST.PAID_OFF, ST.CLOSED_LOSS, ST.CLOSED_BUYBACK, ST.CANCELLED].includes(f.status));
      if (open.length) throw new AppError('Anda masih memiliki pengajuan/pembiayaan yang berjalan');
      const partner = await t.get('partners', int(a.partner_id, 'Mitra LPK/SO'));
      if (!partner || !partner.active) throw new AppError('Mitra LPK/SO tidak valid');
      const costs = (a.costs || []).filter((c) => c && c.component && Number(c.amount) > 0)
        .map((c) => ({ component: String(c.component).trim(), amount: int(c.amount, 'Biaya'), partner_id: c.partner_id ? int(c.partner_id, 'Mitra') : partner.id }));
      if (!costs.length) throw new AppError('Isi minimal satu komponen biaya');
      const principal = sum(costs, (c) => c.amount);
      if (principal < 1000000) throw new AppError('Total pembiayaan minimal Rp1.000.000');
      const s = await settings(t);
      const at = await stamp(t);
      const f = await t.insert('financings', {
        code: 'TMP', borrower_id: u.id, partner_id: partner.id, principal, ujrah: 0, tenor: 12, grace_months: 4,
        purpose: req(a.purpose, 'Program/tujuan'), departure_plan: a.departure_plan || '', japan_company: a.japan_company || '',
        japan_job: a.japan_job || '', est_salary: a.est_salary ? int(a.est_salary, 'Perkiraan gaji') : 0,
        guarantor_name: req(a.guarantor_name, 'Nama penjamin'), guarantor_phone: req(a.guarantor_phone, 'HP penjamin'),
        guarantor_relation: req(a.guarantor_relation, 'Hubungan penjamin'), grade: null, score_json: null,
        analysis_note: '', verify_note: '', nisbah_investor: s.nisbah_investor, protection_pct: s.protection_pct, kmh_min_pct: s.kmh_min_pct,
        status: ST.SUBMITTED, listing_deadline: null, contract_hash: null, va_number: null, created_at: at, updated_at: at, disbursed_at: null, first_due: null,
      });
      const code = `KMH-${at.slice(2, 4)}${at.slice(5, 7)}-${String(f.id).padStart(4, '0')}`;
      await t.update('financings', f.id, { code });
      for (const c of costs) await t.insert('financing_costs', { financing_id: f.id, ...c, disbursed: 0 });
      await notifyRole(t, 'analis', 'Pengajuan baru', `${code} dari ${u.name} — Rp${principal.toLocaleString('id-ID')}.`, `pembiayaan:${f.id}`);
      await audit(t, actor, 'application_submit', 'financing', f.id, { principal, costs });
      return { ...f, code };
    });
  };

  S.verifyApplication = async (actor, { id, ok, note }) => {
    need(actor, 'analis');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      if (f.status !== ST.SUBMITTED) throw new AppError('Pengajuan tidak dalam tahap verifikasi');
      const b = await t.get('users', f.borrower_id);
      if (ok && b.kyc_status !== 'approved') throw new AppError('KYC penerima belum disetujui');
      await t.update('financings', f.id, { status: ok ? ST.VERIFIED : ST.REJECTED, verify_note: note || '', updated_at: await stamp(t) });
      await notify(t, f.borrower_id, ok ? 'Dokumen terverifikasi' : 'Pengajuan ditolak', ok ? `${f.code} lanjut ke tahap analisa.` : `${f.code}: ${note || '-'}`, `pembiayaan:${f.id}`);
      await audit(t, actor, ok ? 'verify_ok' : 'verify_reject', 'financing', f.id, { note });
      return true;
    });
  };

  S.analyzeApplication = async (actor, a) => {
    need(actor, 'analis');
    return db.tx(async (t) => {
      const f = await getFin(t, a.id);
      if (f.status !== ST.VERIFIED && f.status !== ST.ANALYZED) throw new AppError('Pengajuan belum terverifikasi');
      const keys = ['character', 'capacity', 'capital', 'collateral', 'condition'];
      const score = {};
      for (const k of keys) { const v = int(a.score?.[k], `Skor ${k}`); if (v < 1 || v > 5) throw new AppError('Skor 5C bernilai 1–5'); score[k] = v; }
      const avg = sum(keys, (k) => score[k]) / keys.length;
      const grade = gradeFromScore(avg);
      const ujrah = int(a.ujrah, 'Ujrah');
      const tenor = int(a.tenor, 'Tenor');
      const grace = int(a.grace_months, 'Masa tenggang');
      if (ujrah <= 0) throw new AppError('Ujrah harus lebih dari 0');
      if (tenor < 1 || tenor > 60) throw new AppError('Tenor 1–60 bulan');
      if (grace < 0 || grace > 24) throw new AppError('Masa tenggang 0–24 bulan');
      const nisbah = int(a.nisbah_investor ?? f.nisbah_investor, 'Nisbah');
      const prot = int(a.protection_pct ?? f.protection_pct, 'Porsi Dana Proteksi');
      if (nisbah < 1 || nisbah > 99) throw new AppError('Nisbah pendana 1–99%');
      if (prot < 0 || prot > 50) throw new AppError('Porsi Dana Proteksi 0–50%');
      const salary = a.salary_idr ? int(a.salary_idr, 'Gaji bersih') : f.est_salary;
      const inst = Math.ceil((f.principal + ujrah) / tenor);
      const s = await settings(t);
      const ratio = salary ? Math.round((inst / salary) * 1000) / 10 : null;
      score.avg = Math.round(avg * 100) / 100; score.installment = inst; score.salary = salary; score.ratio = ratio;
      score.ratio_ok = ratio === null ? null : ratio <= s.max_installment_ratio;
      await t.update('financings', f.id, {
        ujrah, tenor, grace_months: grace, nisbah_investor: nisbah, protection_pct: prot, est_salary: salary || 0,
        grade, score_json: JSON.stringify(score), analysis_note: a.note || '', status: ST.ANALYZED, updated_at: await stamp(t),
      });
      
      for (const v of await t.find('committee_votes', { financing_id: f.id })) await t.delete('committee_votes', v.id);
      await notifyRole(t, 'komite', 'Menunggu keputusan komite', `${f.code} grade ${grade}, Rp${f.principal.toLocaleString('id-ID')}.`, `pembiayaan:${f.id}`);
      await audit(t, actor, 'analyze', 'financing', f.id, { score, ujrah, tenor, grace, nisbah, prot });
      return { grade, score };
    });
  };

  async function tryList(t, f, actor) {
    const s = await settings(t);
    const kmhMin = Math.ceil((f.principal * f.kmh_min_pct) / 100);
    const kw = await kmhW(t);
    const avail = await bal(t, { account: ACC.KMH_AVAIL, wallet_id: kw.id });
    if (avail < kmhMin) {
      await notifyRole(t, 'manajer', 'Saldo KMH kurang', `${f.code} butuh modal KMH Rp${kmhMin.toLocaleString('id-ID')}; saldo KMH Rp${avail.toLocaleString('id-ID')}.`, `pembiayaan:${f.id}`);
      return false;
    }
    const fu = await t.insert('fundings', { financing_id: f.id, investor_type: 'kmh', investor_id: null, wallet_id: kw.id, amount: kmhMin, status: 'locked', created_at: await stamp(t) });
    await post(t, {
      ref_type: 'funding', ref_id: fu.id, actor, description: `Modal KMH ${f.code}`,
      lines: [{ account: ACC.KMH_AVAIL, wallet_id: kw.id, debit: kmhMin }, { account: ACC.KMH_LOCKED, wallet_id: kw.id, credit: kmhMin }],
    });
    const td = await today(t);
    await t.update('financings', f.id, { status: ST.LISTED, listing_deadline: addDays(td, s.listing_days), updated_at: await stamp(t) });
    await notifyRole(t, 'pendana', 'Peluang pendanaan baru', `${f.code} grade ${f.grade}, Rp${f.principal.toLocaleString('id-ID')}, tenor ${f.tenor} bln.`, `pembiayaan:${f.id}`);
    await notify(t, f.borrower_id, 'Pengajuan disetujui', `${f.code} sedang dalam penggalangan dana.`, `pembiayaan:${f.id}`);
    return true;
  }

  S.committeeVote = async (actor, { id, decision, note }) => {
    need(actor, 'komite');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      if (f.status !== ST.ANALYZED) throw new AppError('Pengajuan tidak menunggu keputusan komite');
      if (f.borrower_id === actor.id) throw new AppError('Anda tidak boleh memutus pengajuan sendiri');
      if (!['approve', 'reject'].includes(decision)) throw new AppError('Keputusan tidak valid');
      if (await t.one('committee_votes', { financing_id: f.id, user_id: actor.id })) throw new AppError('Anda sudah memberikan keputusan');
      await t.insert('committee_votes', { financing_id: f.id, user_id: actor.id, decision, note: note || '', created_at: await stamp(t) });
      await audit(t, actor, `vote_${decision}`, 'financing', f.id, { note });
      if (decision === 'reject') {
        await t.update('financings', f.id, { status: ST.REJECTED, updated_at: await stamp(t) });
        await notify(t, f.borrower_id, 'Pengajuan ditolak komite', `${f.code}: ${note || '-'}`, `pembiayaan:${f.id}`);
        return { status: ST.REJECTED };
      }
      const s = await settings(t);
      const approvals = (await t.find('committee_votes', { financing_id: f.id, decision: 'approve' })).length;
      if (approvals >= s.committee_quorum) {
        await t.update('financings', f.id, { status: ST.APPROVED, updated_at: await stamp(t) });
        const listed = await tryList(t, { ...f, status: ST.APPROVED }, actor);
        return { status: listed ? ST.LISTED : ST.APPROVED };
      }
      return { status: ST.ANALYZED, approvals };
    });
  };

  S.listFinancing = async (actor, { id }) => {
    need(actor, 'manajer', 'admin');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      if (![ST.APPROVED, ST.EXPIRED].includes(f.status)) throw new AppError('Hanya pembiayaan disetujui atau tidak terdanai yang bisa ditayangkan');
      const ok = await tryList(t, f, actor);
      if (!ok) throw new AppError('Saldo KMH belum cukup untuk modal minimal. Top-up dompet KMH terlebih dahulu.');
      await audit(t, actor, 'relist', 'financing', f.id);
      return true;
    });
  };

  
  S.listMarketplace = async (actor) => {
    if (!actor) throw new AppError('Silakan masuk terlebih dahulu', 401);
    await tick();
    const fs = await db.find('financings', { status: ST.LISTED }, { orderBy: ['listing_deadline', 'asc'] });
    const out = [];
    for (const f of fs) {
      const v = await finView(db, f, actor);
      const mine = await db.find('fundings', { financing_id: f.id, investor_type: 'member', investor_id: actor.id, status: ['locked', 'active'] });
      out.push({ ...v, my_amount: sum(mine, (m) => m.amount) });
    }
    return out;
  };

  S.fund = async (actor, { id, amount }) => {
    need(actor, 'pendana');
    await tick();
    return db.tx(async (t) => {
      const u = await t.get('users', actor.id);
      if (u.kyc_status !== 'approved') throw new AppError('Akun Anda belum terverifikasi');
      await t.lock('financings', int(id, 'ID'));
      const f = await getFin(t, id);
      if (f.status !== ST.LISTED) throw new AppError('Pembiayaan ini tidak sedang menggalang dana');
      if (f.borrower_id === u.id) throw new AppError('Anda tidak dapat mendanai pembiayaan sendiri');
      const s = await settings(t);
      const amt = int(amount, 'Nominal');
      const remaining = f.principal - (await fundedTotal(t, f.id));
      if (remaining <= 0) throw new AppError('Pembiayaan sudah terdanai penuh');
      if (amt > remaining) throw new AppError(`Sisa kebutuhan hanya Rp${remaining.toLocaleString('id-ID')}`);
      if (amt !== remaining) {
        if (amt < s.min_funding) throw new AppError(`Minimum pendanaan Rp${s.min_funding.toLocaleString('id-ID')}`);
        if (amt % s.funding_step !== 0) throw new AppError(`Nominal harus kelipatan Rp${s.funding_step.toLocaleString('id-ID')}`);
      }
      const mine = sum(await t.find('fundings', { financing_id: f.id, investor_type: 'member', investor_id: u.id, status: ['locked', 'active'] }), (x) => x.amount);
      const cap = Math.floor((f.principal * s.max_investor_pct) / 100);
      if (mine + amt > cap) throw new AppError(`Porsi satu pendana maksimal ${s.max_investor_pct}% (Rp${cap.toLocaleString('id-ID')}). Sisa batas Anda Rp${Math.max(0, cap - mine).toLocaleString('id-ID')}`);
      const w = await wallet(t, 'member', u.id);
      const avail = await bal(t, { account: ACC.AVAIL, wallet_id: w.id });
      if (avail < amt) throw new AppError(`Saldo tersedia Rp${avail.toLocaleString('id-ID')} tidak cukup. Lakukan top-up melalui VA Anda.`);
      const fu = await t.insert('fundings', { financing_id: f.id, investor_type: 'member', investor_id: u.id, wallet_id: w.id, amount: amt, status: 'locked', created_at: await stamp(t) });
      await post(t, {
        ref_type: 'funding', ref_id: fu.id, actor, description: `Pendanaan ${f.code}`,
        lines: [{ account: ACC.AVAIL, wallet_id: w.id, debit: amt }, { account: ACC.LOCKED, wallet_id: w.id, credit: amt }],
      });
      await audit(t, actor, 'fund', 'financing', f.id, { amount: amt });
      let full = false;
      if (amt === remaining) {
        full = true;
        await t.update('financings', f.id, { status: ST.FUNDED, updated_at: await stamp(t) });
        await createContract(t, f);
        const va = await ensureVA(t, 'financing', f.id);
        await t.update('financings', f.id, { va_number: va.va_number });
        await notify(t, f.borrower_id, 'Pembiayaan terdanai penuh', `${f.code} siap ditandatangani. Silakan baca dan tanda tangani akad.`, `pembiayaan:${f.id}`);
        await notifyRole(t, 'manajer', 'Akad menunggu tanda tangan KMH', `${f.code} terdanai penuh.`, `pembiayaan:${f.id}`);
      }
      return { funding: fu, full };
    });
  };

  
  async function createContract(t, f) {
    const b = await t.get('users', f.borrower_id);
    const p = await t.get('partners', f.partner_id);
    const costs = await t.find('financing_costs', { financing_id: f.id });
    const fs = await t.find('fundings', { financing_id: f.id, status: ['locked', 'active'] });
    const s = await settings(t);
    const rp = (n) => `Rp${n.toLocaleString('id-ID')}`;
    const inst = Math.floor(f.principal / f.tenor) + Math.floor(f.ujrah / f.tenor);
    const body = [
      `AKAD PEMBIAYAAN IJARAH MULTIJASA No. ${f.code}`,
      ``,
      `Para pihak:`,
      `1. Koperasi Kita Miraino Hikari (KMH), bertindak untuk dan atas nama syirkah pembiayaan ${f.code} ("Pemberi Jasa").`,
      `2. ${b.name}, anggota KMH No. ${b.member_no} ("Penerima Jasa").`,
      `3. ${p?.name || '-'} sebagai penyelenggara pelatihan/penempatan ("Mitra").`,
      `4. ${f.guarantor_name} (${f.guarantor_relation}) sebagai penjamin.`,
      ``,
      `Pasal 1 – Objek akad`,
      `Pemberi Jasa menyediakan jasa pelatihan dan pengurusan keberangkatan magang ke Jepang (${f.purpose}) dengan rincian:`,
      ...costs.map((c) => `   - ${c.component}: ${rp(c.amount)}`),
      `   Total biaya jasa: ${rp(f.principal)}.`,
      ``,
      `Pasal 2 – Ujrah dan kewajiban`,
      `Ujrah atas jasa ditetapkan tetap sebesar ${rp(f.ujrah)}. Total kewajiban Penerima Jasa ${rp(f.principal + f.ujrah)}, dibayar ${f.tenor} kali angsuran bulanan sekitar ${rp(inst)} setelah masa tenggang ${f.grace_months} bulan sejak pencairan terakhir.`,
      ``,
      `Pasal 3 – Pencairan`,
      `Biaya dibayarkan langsung kepada Mitra/vendor secara bertahap sesuai komponen biaya, tidak diserahkan tunai kepada Penerima Jasa.`,
      ``,
      `Pasal 4 – Pembayaran`,
      `Pembayaran dilakukan melalui Virtual Account yang tercantum pada portal. Pembayaran sebagian dialokasikan proporsional antara pokok dan ujrah pada jadwal tertua.`,
      ``,
      `Pasal 5 – Keterlambatan`,
      `Tidak ada denda yang menjadi pendapatan. Ketentuan ta'zir/ta'widh mengikuti opini Dewan Pengawas Syariah KMH; dana ta'zir disalurkan sebagai dana sosial.`,
      ``,
      `Pasal 6 – Gagal berangkat`,
      `Bila Penerima Jasa gagal berangkat, biaya yang belum dibayarkan ke Mitra dibatalkan; biaya yang telah dibayarkan menjadi kewajiban Penerima Jasa dan Penjamin, dikurangi pengembalian dari Mitra.`,
      ``,
      `LAMPIRAN – SYIRKAH MUSYARAKAH PENDANA`,
      `Modal syirkah ${rp(f.principal)} berasal dari ${fs.length} pemodal (termasuk KMH minimal ${f.kmh_min_pct}%). Hasil syirkah berupa ujrah yang benar-benar diterima, setelah ${f.protection_pct}% disisihkan ke Dana Proteksi (tabarru'), dibagi dengan nisbah pendana ${f.nisbah_investor}% : KMH ${100 - f.nisbah_investor}%. Kerugian ditanggung sesuai porsi modal, kecuali karena kelalaian KMH. Dana Proteksi tidak menjamin pengembalian modal; klaim maksimal ${s.max_claim_pct}% sisa pokok dan sebatas saldo. Pengambilalihan (buyback) oleh KMH bersifat janji sepihak pada nilai pokok tersisa.`,
    ].join('\n');
    const sha = await env.sha256(body);
    const ex = await t.one('contracts', { financing_id: f.id });
    if (ex) await t.update('contracts', ex.id, { body, sha256: sha, signatures: '[]' });
    else await t.insert('contracts', { financing_id: f.id, body, sha256: sha, signatures: '[]', created_at: await stamp(t) });
    await t.update('financings', f.id, { contract_hash: sha });
  }

  S.getContract = async (actor, { id }) => {
    if (!actor) throw new AppError('Silakan masuk terlebih dahulu', 401);
    const f = await getFin(db, id);
    const isInvestor = (await db.find('fundings', { financing_id: f.id, investor_type: 'member', investor_id: actor.id })).length > 0;
    if (!(isBack(actor) || actor.id === f.borrower_id || isInvestor)) throw new AppError('Anda tidak memiliki akses ke akad ini', 403);
    const c = await db.one('contracts', { financing_id: f.id });
    return c ? { ...c, signatures: JSON.parse(c.signatures || '[]') } : null;
  };

  S.signContract = async (actor, { id, as, ip }) => {
    if (!actor) throw new AppError('Silakan masuk terlebih dahulu', 401);
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      if (f.status !== ST.FUNDED) throw new AppError('Akad belum siap ditandatangani');
      const c = await t.one('contracts', { financing_id: f.id });
      const sigs = JSON.parse(c.signatures || '[]');
      let role;
      if (as === 'penerima') { if (actor.id !== f.borrower_id) throw new AppError('Hanya penerima pembiayaan yang dapat menandatangani', 403); role = 'penerima'; }
      else if (as === 'kmh') { need(actor, 'manajer'); role = 'kmh'; }
      else throw new AppError('Peran penanda tangan tidak valid');
      if (sigs.some((s) => s.role === role)) throw new AppError('Akad sudah ditandatangani oleh pihak ini');
      if (await env.sha256(c.body) !== c.sha256) throw new AppError('Isi akad berubah; tanda tangan dibatalkan', 409);
      sigs.push({ role, user_id: actor.id, name: actor.name, at: await stamp(t), ip: ip || '-', sha256: c.sha256 });
      await t.update('contracts', c.id, { signatures: JSON.stringify(sigs) });
      await audit(t, actor, 'sign_contract', 'financing', f.id, { role, sha256: c.sha256 });
      if (sigs.some((s) => s.role === 'penerima') && sigs.some((s) => s.role === 'kmh')) {
        
        const fs = await t.find('fundings', { financing_id: f.id, status: 'locked' });
        const lines = [];
        for (const fu of fs) {
          const w = await holderWallet(t, fu);
          lines.push({ account: lockAcc(fu), wallet_id: w.id, debit: fu.amount });
          lines.push({ account: ACC.MODAL, wallet_id: w.id, financing_id: f.id, credit: fu.amount });
          await t.update('fundings', fu.id, { status: 'active' });
        }
        await post(t, { ref_type: 'akad', ref_id: f.id, actor, description: `Modal syirkah ${f.code}`, lines });
        await post(t, {
          ref_type: 'akad', ref_id: f.id, actor, description: `Pengakuan piutang & utang pencairan ${f.code}`,
          lines: [{ account: ACC.PIUTANG, financing_id: f.id, debit: f.principal }, { account: ACC.UTANG_CAIR, financing_id: f.id, credit: f.principal }],
        });
        await t.update('financings', f.id, { status: ST.AKAD_SIGNED, updated_at: await stamp(t) });
        await notifyRole(t, 'finance', 'Siap dicairkan', `${f.code} — akad lengkap.`, `pembiayaan:${f.id}`);
        for (const fu of fs.filter((x) => x.investor_type === 'member')) await notify(t, fu.investor_id, 'Akad ditandatangani', `${f.code} memasuki tahap pencairan.`, 'portofolio');
        return { complete: true };
      }
      return { complete: false };
    });
  };

  
  S.createDisbursements = async (actor, { id }) => {
    need(actor, 'finance');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      if (![ST.AKAD_SIGNED, ST.DISBURSING].includes(f.status)) throw new AppError('Pembiayaan belum siap dicairkan');
      const costs = await t.find('financing_costs', { financing_id: f.id });
      const existing = await t.find('disbursements', { financing_id: f.id });
      let n = 0;
      for (const c of costs) {
        if (existing.some((d) => d.cost_id === c.id && d.status !== 'rejected')) continue;
        await t.insert('disbursements', { financing_id: f.id, cost_id: c.id, partner_id: c.partner_id || f.partner_id, amount: c.amount, status: 'pending', maker_id: actor.id, checker_id: null, proof: '', created_at: await stamp(t), approved_at: null });
        n++;
      }
      await audit(t, actor, 'disbursement_create', 'financing', f.id, { count: n });
      if (n) await notifyRole(t, 'manajer', 'Pencairan menunggu persetujuan', `${f.code}: ${n} instruksi pencairan.`, 'pencairan');
      return { created: n };
    });
  };
  S.listDisbursements = async (actor, { status } = {}) => {
    need(actor, 'finance', 'manajer', 'admin');
    const ds = await db.find('disbursements', status ? { status } : {}, { orderBy: ['id', 'desc'] });
    const out = [];
    for (const d of ds) {
      const f = await db.get('financings', d.financing_id);
      const c = await db.get('financing_costs', d.cost_id);
      const p = await db.get('partners', d.partner_id);
      const mk = d.maker_id ? await db.get('users', d.maker_id) : null;
      const ck = d.checker_id ? await db.get('users', d.checker_id) : null;
      out.push({ ...d, code: f?.code, component: c?.component, partner_name: p?.name, partner_bank: p ? `${p.bank_name} ${p.bank_account}` : '', maker_name: mk?.name, checker_name: ck?.name });
    }
    return out;
  };
  S.approveDisbursement = async (actor, { disbursement_id, approve, proof }) => {
    need(actor, 'manajer');
    return db.tx(async (t) => {
      const d = await t.get('disbursements', int(disbursement_id, 'ID'));
      if (!d || d.status !== 'pending') throw new AppError('Instruksi pencairan tidak dalam status menunggu');
      if (d.maker_id === actor.id) throw new AppError('Pembuat dan penyetuju pencairan harus orang berbeda');
      const f = await t.get('financings', d.financing_id);
      if (![ST.AKAD_SIGNED, ST.DISBURSING].includes(f.status)) throw new AppError('Status pembiayaan tidak mengizinkan pencairan');
      const at = await stamp(t);
      if (!approve) {
        await t.update('disbursements', d.id, { status: 'rejected', checker_id: actor.id, approved_at: at });
        await audit(t, actor, 'disbursement_reject', 'disbursement', d.id);
        return { status: 'rejected' };
      }
      const escrow = await escrowW(t);
      await post(t, {
        ref_type: 'disbursement', ref_id: d.id, actor, description: `Pencairan ${f.code} ke mitra`,
        lines: [{ account: ACC.UTANG_CAIR, financing_id: f.id, debit: d.amount }, { account: ACC.KAS, wallet_id: escrow.id, credit: d.amount }],
      });
      await t.update('disbursements', d.id, { status: 'paid', checker_id: actor.id, approved_at: at, proof: proof || `TRF-${d.id}` });
      await t.update('financing_costs', d.cost_id, { disbursed: 1 });
      const left = await bal(t, { account: ACC.UTANG_CAIR, financing_id: f.id });
      if (left === 0) {
        const td = await today(t);
        const firstDue = addMonths(td, f.grace_months + 1);
        for (const r of buildSchedule({ principal: f.principal, ujrah: f.ujrah, tenor: f.tenor, firstDue })) {
          await t.insert('schedules', { financing_id: f.id, ...r, paid_principal: 0, paid_ujrah: 0, status: 'open', paid_at: null });
        }
        await t.update('financings', f.id, { status: ST.GRACE, disbursed_at: at, first_due: firstDue, updated_at: at });
        await notify(t, f.borrower_id, 'Pencairan selesai', `${f.code}: angsuran pertama jatuh tempo ${firstDue} melalui VA ${f.va_number}.`, `pembiayaan:${f.id}`);
      } else {
        await t.update('financings', f.id, { status: ST.DISBURSING, updated_at: at });
      }
      await audit(t, actor, 'disbursement_approve', 'disbursement', d.id, { amount: d.amount });
      return { status: 'paid' };
    });
  };

  S.markFailedDeparture = async (actor, { id, note }) => {
    need(actor, 'analis', 'manajer');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      if (![ST.AKAD_SIGNED, ST.DISBURSING, ST.GRACE].includes(f.status)) throw new AppError('Hanya untuk pembiayaan yang belum memasuki masa angsuran');
      const at = await stamp(t);
      for (const d of await t.find('disbursements', { financing_id: f.id, status: 'pending' })) await t.update('disbursements', d.id, { status: 'cancelled', checker_id: actor.id, approved_at: at });
      const undisbursed = await bal(t, { account: ACC.UTANG_CAIR, financing_id: f.id });
      if (undisbursed > 0) {
        await post(t, {
          ref_type: 'failed_departure', ref_id: f.id, actor, description: `Pembatalan biaya belum cair ${f.code}`,
          lines: [{ account: ACC.UTANG_CAIR, financing_id: f.id, debit: undisbursed }, { account: ACC.PIUTANG, financing_id: f.id, credit: undisbursed }],
        });
        const { lines } = await capitalLines(t, f.id, undisbursed);
        await post(t, { ref_type: 'failed_departure', ref_id: f.id, actor, description: `Pengembalian modal belum cair ${f.code}`, lines });
      }
      for (const s of await t.find('schedules', { financing_id: f.id })) await t.update('schedules', s.id, { status: 'cancelled' });
      const outstanding = await bal(t, { account: ACC.PIUTANG, financing_id: f.id });
      await t.insert('loss_events', { financing_id: f.id, kind: 'failed_departure', amount: undisbursed, actor_id: actor.id, note: note || '', created_at: at });
      if (outstanding === 0) {
        await t.update('financings', f.id, { status: ST.CANCELLED, updated_at: at });
      } else {
        const td = await today(t);
        const maxSeq = (await t.find('schedules', { financing_id: f.id })).length;
        await t.insert('schedules', { financing_id: f.id, seq: maxSeq + 1, due_date: addDays(td, 30), principal_due: outstanding, ujrah_due: 0, paid_principal: 0, paid_ujrah: 0, status: 'open', paid_at: null });
        if (!f.va_number) { const va = await ensureVA(t, 'financing', f.id); await t.update('financings', f.id, { va_number: va.va_number }); }
        await t.update('financings', f.id, { status: ST.FAILED_DEPARTURE, updated_at: at });
      }
      await notify(t, f.borrower_id, 'Status gagal berangkat', `${f.code}: sisa kewajiban Rp${outstanding.toLocaleString('id-ID')}.`, `pembiayaan:${f.id}`);
      await audit(t, actor, 'failed_departure', 'financing', f.id, { note, undisbursed, outstanding });
      return { outstanding };
    });
  };

  
  S.listCollections = async (actor) => {
    need(actor, 'analis', 'manajer', 'komite', 'finance', 'admin');
    const fs = await db.find('financings', { status: [ST.REPAYING, ST.FAILED_DEPARTURE, ST.LOSS_HANDLING, ST.CLOSED_BUYBACK, ST.GRACE] });
    const out = [];
    for (const f of fs) {
      const v = await finView(db, f, actor);
      const notes = await db.find('collections', { financing_id: f.id }, { orderBy: ['id', 'desc'], limit: 1 });
      out.push({ ...v, last_note: notes[0] || null });
    }
    return out.sort((a, b) => b.dpd - a.dpd);
  };
  S.addCollectionNote = async (actor, { id, action, note, promise_date }) => {
    need(actor, 'analis', 'manajer', 'finance');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      const r = await t.insert('collections', { financing_id: f.id, officer_id: actor.id, action: req(action, 'Tindakan'), note: note || '', promise_date: promise_date || null, created_at: await stamp(t) });
      await audit(t, actor, 'collection_note', 'financing', f.id, { action });
      return r;
    });
  };
  S.startLossHandling = async (actor, { id, note }) => {
    need(actor, 'komite', 'manajer');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      const v = await finView(t, f, actor);
      if (f.status === ST.REPAYING && v.dpd <= 90) throw new AppError(`Penanganan kerugian dimulai setelah DPD > 90 (saat ini ${v.dpd} hari)`);
      if (![ST.REPAYING, ST.FAILED_DEPARTURE].includes(f.status)) throw new AppError('Status tidak memenuhi syarat penanganan kerugian');
      await t.update('financings', f.id, { status: ST.LOSS_HANDLING, updated_at: await stamp(t) });
      await audit(t, actor, 'loss_start', 'financing', f.id, { note, dpd: v.dpd });
      return true;
    });
  };
  S.claimProtection = async (actor, { id, amount, note }) => {
    need(actor, 'komite');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      if (f.status !== ST.LOSS_HANDLING) throw new AppError('Klaim hanya pada tahap penanganan kerugian');
      const s = await settings(t);
      const outstanding = await bal(t, { account: ACC.PIUTANG, financing_id: f.id });
      const prot = await protW(t);
      const pbal = await bal(t, { account: ACC.PROTEKSI, wallet_id: prot.id });
      const claimedBefore = sum(await t.find('loss_events', { financing_id: f.id, kind: 'protection' }), (x) => x.amount);
      const limit = Math.min(pbal, Math.floor(((outstanding + claimedBefore) * s.max_claim_pct) / 100) - claimedBefore, outstanding);
      const amt = int(amount, 'Nominal klaim');
      if (amt <= 0) throw new AppError('Nominal klaim harus lebih dari 0');
      if (amt > limit) throw new AppError(`Klaim maksimal Rp${Math.max(0, limit).toLocaleString('id-ID')} (batas ${s.max_claim_pct}% sisa pokok dan saldo Dana Proteksi)`);
      const { lines, hs, shares } = await capitalLines(t, f.id, amt, false);
      const pay = [{ account: ACC.PROTEKSI, wallet_id: prot.id, debit: amt }];
      hs.forEach((h, i) => { if (shares[i]) pay.push({ account: availAcc(h), wallet_id: h.wallet_id, credit: shares[i] }); });
      await post(t, { ref_type: 'protection_claim', ref_id: f.id, actor, description: `Klaim Dana Proteksi ${f.code}`, lines: pay });
      await post(t, { ref_type: 'protection_claim', ref_id: f.id, actor, description: `Pengurangan piutang atas klaim ${f.code}`, lines: [...lines, { account: ACC.PIUTANG, financing_id: f.id, credit: amt }] });
      const at = await stamp(t);
      for (let i = 0; i < hs.length; i++) if (shares[i]) await t.insert('distributions', { payment_event_id: null, financing_id: f.id, wallet_id: hs[i].wallet_id, funding_id: hs[i].id, principal: shares[i], profit: 0, kind: 'klaim_proteksi', created_at: at });
      await t.insert('loss_events', { financing_id: f.id, kind: 'protection', amount: amt, actor_id: actor.id, note: note || '', created_at: at });
      await reduceScheduleOpenPrincipal(t, f.id, amt);
      for (const h of hs) if (h.investor_type === 'member') await notify(t, h.investor_id, 'Klaim Dana Proteksi', `${f.code}: sebagian pokok dikembalikan dari Dana Proteksi.`, 'portofolio');
      await audit(t, actor, 'protection_claim', 'financing', f.id, { amount: amt, note });
      return { amount: amt };
    });
  };
  
  async function reduceScheduleOpenPrincipal(t, fid, amount) {
    let left = amount;
    const ss = (await t.find('schedules', { financing_id: fid }, { orderBy: ['seq', 'desc'] })).filter((s) => !['cancelled', 'written_off', 'paid'].includes(s.status));
    for (const s of ss) {
      if (left <= 0) break;
      const room = s.principal_due - s.paid_principal;
      const cut = Math.min(room, left);
      const pd = s.principal_due - cut;
      const full = s.paid_principal + s.paid_ujrah >= pd + s.ujrah_due;
      await t.update('schedules', s.id, { principal_due: pd, status: full ? (s.paid_principal + s.paid_ujrah > 0 ? 'paid' : 'written_off') : s.status });
      left -= cut;
    }
  }
  S.buyback = async (actor, { id, note }) => {
    need(actor, 'komite');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      if (f.status !== ST.LOSS_HANDLING) throw new AppError('Pengambilalihan hanya pada tahap penanganan kerugian');
      const hs = (await holders(t, f.id)).filter((h) => h.investor_type === 'member' && h.remaining > 0);
      if (!hs.length) throw new AppError('Tidak ada porsi pendana yang tersisa');
      const total = sum(hs, (h) => h.remaining);
      const kw = await kmhW(t);
      const kavail = await bal(t, { account: ACC.KMH_AVAIL, wallet_id: kw.id });
      if (kavail < total) throw new AppError(`Saldo KMH Rp${kavail.toLocaleString('id-ID')} tidak cukup untuk mengambil alih Rp${total.toLocaleString('id-ID')}`);
      const lines = [{ account: ACC.KMH_AVAIL, wallet_id: kw.id, debit: total }];
      const cap = [{ account: ACC.MODAL, wallet_id: kw.id, financing_id: f.id, credit: total }];
      for (const h of hs) {
        lines.push({ account: ACC.AVAIL, wallet_id: h.wallet_id, credit: h.remaining });
        cap.push({ account: ACC.MODAL, wallet_id: h.wallet_id, financing_id: f.id, debit: h.remaining });
      }
      await post(t, { ref_type: 'buyback', ref_id: f.id, actor, description: `Pembayaran pengambilalihan porsi ${f.code}`, lines });
      await post(t, { ref_type: 'buyback', ref_id: f.id, actor, description: `Pengalihan modal syirkah ${f.code} ke KMH`, lines: cap });
      const at = await stamp(t);
      let weight = 0;
      for (const h of hs) {
        await t.update('fundings', h.id, { status: 'bought_back' });
        weight += h.amount;
        await t.insert('distributions', { payment_event_id: null, financing_id: f.id, wallet_id: h.wallet_id, funding_id: h.id, principal: h.remaining, profit: 0, kind: 'buyback', created_at: at });
        await notify(t, h.investor_id, 'Porsi diambil alih KMH', `${f.code}: sisa pokok Rp${h.remaining.toLocaleString('id-ID')} dikembalikan ke saldo Anda.`, 'portofolio');
      }
      await t.insert('fundings', { financing_id: f.id, investor_type: 'kmh_buyback', investor_id: null, wallet_id: kw.id, amount: weight, status: 'active', created_at: at });
      await t.insert('loss_events', { financing_id: f.id, kind: 'buyback', amount: total, actor_id: actor.id, note: note || '', created_at: at });
      await t.update('financings', f.id, { status: ST.CLOSED_BUYBACK, updated_at: at });
      await audit(t, actor, 'buyback', 'financing', f.id, { total, note });
      return { amount: total };
    });
  };
  S.writeOff = async (actor, { id, note }) => {
    need(actor, 'komite');
    return db.tx(async (t) => {
      const f = await getFin(t, id);
      if (![ST.LOSS_HANDLING, ST.CLOSED_BUYBACK].includes(f.status)) throw new AppError('Hapus buku hanya setelah penanganan kerugian');
      const outstanding = await bal(t, { account: ACC.PIUTANG, financing_id: f.id });
      if (outstanding > 0) {
        const { lines } = await capitalLines(t, f.id, outstanding, false);
        await post(t, { ref_type: 'write_off', ref_id: f.id, actor, description: `Hapus buku sisa pokok ${f.code}`, lines: [...lines, { account: ACC.PIUTANG, financing_id: f.id, credit: outstanding }] });
      }
      const at = await stamp(t);
      for (const s of await t.find('schedules', { financing_id: f.id })) if (!['paid', 'cancelled'].includes(s.status)) await t.update('schedules', s.id, { status: 'written_off' });
      await t.insert('loss_events', { financing_id: f.id, kind: 'writeoff', amount: outstanding, actor_id: actor.id, note: note || '', created_at: at });
      await t.update('financings', f.id, { status: ST.CLOSED_LOSS, updated_at: at });
      await audit(t, actor, 'write_off', 'financing', f.id, { outstanding, note });
      return { amount: outstanding };
    });
  };

  
  S.requestWithdrawal = async (actor, { amount }) => {
    need(actor, 'pendana');
    return db.tx(async (t) => {
      const u = await t.get('users', actor.id);
      if (!u.bank_account) throw new AppError('Lengkapi rekening bank atas nama Anda di halaman Akun');
      const amt = int(amount, 'Nominal');
      if (amt < 10000) throw new AppError('Minimal penarikan Rp10.000');
      const w = await wallet(t, 'member', u.id);
      const avail = await bal(t, { account: ACC.AVAIL, wallet_id: w.id });
      if (amt > avail) throw new AppError(`Saldo tersedia hanya Rp${avail.toLocaleString('id-ID')}`);
      const at = await stamp(t);
      const wd = await t.insert('withdrawals', { user_id: u.id, wallet_id: w.id, amount: amt, status: 'requested', maker_id: null, checker_id: null, note: `${u.bank_name} ${u.bank_account} a.n. ${u.bank_holder || u.name}`, created_at: at, updated_at: at });
      await post(t, { ref_type: 'withdrawal_hold', ref_id: wd.id, actor, description: 'Permintaan penarikan', lines: [{ account: ACC.AVAIL, wallet_id: w.id, debit: amt }, { account: ACC.WD_HOLD, wallet_id: w.id, credit: amt }] });
      await notifyRole(t, 'finance', 'Permintaan penarikan', `${u.name} Rp${amt.toLocaleString('id-ID')}.`, 'penarikan');
      await audit(t, actor, 'withdraw_request', 'withdrawal', wd.id, { amount: amt });
      return wd;
    });
  };
  S.listWithdrawals = async (actor, { mine } = {}) => {
    if (mine) { if (!actor) throw new AppError('Silakan masuk', 401); return db.find('withdrawals', { user_id: actor.id }, { orderBy: ['id', 'desc'] }); }
    need(actor, 'finance', 'manajer', 'admin');
    const ws = await db.find('withdrawals', {}, { orderBy: ['id', 'desc'] });
    const out = [];
    for (const w of ws) out.push({ ...w, user_name: (await db.get('users', w.user_id))?.name, maker_name: w.maker_id ? (await db.get('users', w.maker_id))?.name : null });
    return out;
  };
  S.verifyWithdrawal = async (actor, { withdrawal_id }) => {
    need(actor, 'finance');
    return db.tx(async (t) => {
      const w = await t.get('withdrawals', int(withdrawal_id, 'ID'));
      if (!w || w.status !== 'requested') throw new AppError('Permintaan tidak dalam status menunggu verifikasi');
      await t.update('withdrawals', w.id, { status: 'verified', maker_id: actor.id, updated_at: await stamp(t) });
      await notifyRole(t, 'manajer', 'Penarikan menunggu persetujuan', `Rp${w.amount.toLocaleString('id-ID')}.`, 'penarikan');
      await audit(t, actor, 'withdraw_verify', 'withdrawal', w.id);
      return true;
    });
  };
  S.decideWithdrawal = async (actor, { withdrawal_id, approve, note }) => {
    need(actor, 'manajer', 'finance');
    return db.tx(async (t) => {
      const w = await t.get('withdrawals', int(withdrawal_id, 'ID'));
      if (!w || !['requested', 'verified'].includes(w.status)) throw new AppError('Permintaan sudah diproses');
      const at = await stamp(t);
      if (!approve) {
        await post(t, { ref_type: 'withdrawal_reject', ref_id: w.id, actor, description: 'Penarikan ditolak', lines: [{ account: ACC.WD_HOLD, wallet_id: w.wallet_id, debit: w.amount }, { account: ACC.AVAIL, wallet_id: w.wallet_id, credit: w.amount }] });
        await t.update('withdrawals', w.id, { status: 'rejected', checker_id: actor.id, note: `${w.note} | Ditolak: ${note || '-'}`, updated_at: at });
        await notify(t, w.user_id, 'Penarikan ditolak', note || 'Hubungi KMH untuk informasi.', 'dompet');
        await audit(t, actor, 'withdraw_reject', 'withdrawal', w.id, { note });
        return { status: 'rejected' };
      }
      need(actor, 'manajer');
      if (w.status !== 'verified') throw new AppError('Penarikan harus diverifikasi Finance terlebih dahulu');
      if (w.maker_id === actor.id) throw new AppError('Verifikator dan penyetuju harus orang berbeda');
      const escrow = await escrowW(t);
      await post(t, { ref_type: 'withdrawal', ref_id: w.id, actor, description: 'Transfer penarikan dana', lines: [{ account: ACC.WD_HOLD, wallet_id: w.wallet_id, debit: w.amount }, { account: ACC.KAS, wallet_id: escrow.id, credit: w.amount }] });
      await t.update('withdrawals', w.id, { status: 'paid', checker_id: actor.id, updated_at: at });
      await notify(t, w.user_id, 'Penarikan ditransfer', `Rp${w.amount.toLocaleString('id-ID')} dikirim ke rekening Anda.`, 'dompet');
      await audit(t, actor, 'withdraw_approve', 'withdrawal', w.id);
      return { status: 'paid' };
    });
  };

  
  S.listFinancings = async (actor, { status, mine } = {}) => {
    if (!actor) throw new AppError('Silakan masuk', 401);
    let fs;
    if (mine) fs = await db.find('financings', { borrower_id: actor.id }, { orderBy: ['id', 'desc'] });
    else { need(actor, ...BACKOFFICE); fs = await db.find('financings', status ? { status } : {}, { orderBy: ['id', 'desc'] }); }
    const out = [];
    for (const f of fs) out.push(await finView(db, f, actor));
    return out;
  };
  S.getFinancing = async (actor, { id }) => {
    if (!actor) throw new AppError('Silakan masuk', 401);
    await tick();
    const f = await getFin(db, id);
    const myFund = await db.find('fundings', { financing_id: f.id, investor_type: 'member', investor_id: actor.id });
    const isOwner = actor.id === f.borrower_id;
    const back = isBack(actor);
    if (!back && !isOwner && !myFund.length && f.status !== ST.LISTED) throw new AppError('Anda tidak memiliki akses ke pembiayaan ini', 403);
    const v = await finView(db, f, actor);
    const costs = await db.find('financing_costs', { financing_id: f.id });
    const schedules = await db.find('schedules', { financing_id: f.id }, { orderBy: ['seq', 'asc'] });
    const fundingsAll = await db.find('fundings', { financing_id: f.id }, { orderBy: ['id', 'asc'] });
    const fundings = [];
    for (const fu of fundingsAll) {
      if (!back && !(fu.investor_type === 'member' && fu.investor_id === actor.id)) continue;
      const name = fu.investor_type === 'member' ? (await db.get('users', fu.investor_id))?.name : fu.investor_type === 'kmh' ? 'KMH (modal sendiri)' : 'KMH (ambil alih)';
      const dists = await db.find('distributions', { funding_id: fu.id });
      fundings.push({ ...fu, name, profit: sum(dists, (d) => d.profit), principal_returned: sum(dists, (d) => d.principal) });
    }
    const contract = (back || isOwner || myFund.length) ? await db.one('contracts', { financing_id: f.id }) : null;
    const votes = back ? await db.find('committee_votes', { financing_id: f.id }) : [];
    for (const vt of votes) vt.name = (await db.get('users', vt.user_id))?.name;
    const disb = back || isOwner ? await db.find('disbursements', { financing_id: f.id }) : [];
    for (const d of disb) d.component = (await db.get('financing_costs', d.cost_id))?.component;
    const payments = back || isOwner ? await db.find('payment_events', { financing_id: f.id }, { orderBy: ['id', 'desc'] }) : [];
    const collections = back ? await db.find('collections', { financing_id: f.id }, { orderBy: ['id', 'desc'] }) : [];
    for (const c of collections) c.officer = (await db.get('users', c.officer_id))?.name;
    const losses = back ? await db.find('loss_events', { financing_id: f.id }) : [];
    const prot = await protW(db);
    const s = await settings();
    const borrower = back ? publicUser(await db.get('users', f.borrower_id)) : null;
    return {
      ...v, costs, schedules, fundings, votes, disbursements: disb, payments, collections, losses, borrower,
      contract: contract ? { sha256: contract.sha256, signatures: JSON.parse(contract.signatures || '[]') } : null,
      protection_balance: back ? await bal(db, { account: ACC.PROTEKSI, wallet_id: prot.id }) : null,
      max_claim_pct: s.max_claim_pct, committee_quorum: s.committee_quorum,
      min_funding: s.min_funding, funding_step: s.funding_step, max_investor_pct: s.max_investor_pct,
      my_amount: sum(myFund.filter((x) => ['locked', 'active'].includes(x.status)), (x) => x.amount),
      is_owner: isOwner,
    };
  };

  S.portfolio = async (actor) => {
    need(actor, 'pendana');
    const fus = await db.find('fundings', { investor_type: 'member', investor_id: actor.id }, { orderBy: ['id', 'desc'] });
    const byFin = {};
    for (const fu of fus) (byFin[fu.financing_id] ||= []).push(fu);
    const rows = [];
    const w = await wallet(db, 'member', actor.id);
    for (const fid of Object.keys(byFin)) {
      const f = await db.get('financings', Number(fid));
      const v = await finView(db, f, actor);
      const list = byFin[fid];
      const dists = await db.find('distributions', { financing_id: f.id, wallet_id: w.id });
      const capital = await bal(db, { account: ACC.MODAL, wallet_id: w.id, financing_id: f.id });
      const lockedAmt = sum(list.filter((x) => x.status === 'locked'), (x) => x.amount);
      rows.push({
        financing_id: f.id, code: f.code, status: f.status, grade: f.grade, tenor: f.tenor, dpd: v.dpd, bucket: v.bucket,
        amount: sum(list.filter((x) => x.status !== 'released'), (x) => x.amount), funding_status: list.map((x) => x.status),
        profit: sum(dists, (d) => d.profit), principal_returned: sum(dists, (d) => d.principal), outstanding: capital + lockedAmt,
        paid_count: v.paid_count, schedule_count: v.schedule_count, nisbah: f.nisbah_investor,
      });
    }
    return { rows, wallet: await walletSummary(db, w) };
  };

  S.walletMutations = async (actor, { limit = 100 } = {}) => {
    if (!actor) throw new AppError('Silakan masuk', 401);
    const w = await wallet(db, 'member', actor.id);
    const lines = await db.find('ledger_lines', { wallet_id: w.id, account: [ACC.AVAIL] }, { orderBy: ['id', 'desc'], limit });
    const out = [];
    for (const l of lines) {
      const j = await db.get('journals', l.journal_id);
      out.push({ id: l.id, at: j.created_at, description: j.description, ref_type: j.ref_type, amount: l.credit - l.debit });
    }
    return out;
  };

  S.notifications = async (actor) => {
    if (!actor) throw new AppError('Silakan masuk', 401);
    return db.find('notifications', { user_id: actor.id }, { orderBy: ['id', 'desc'], limit: 100 });
  };
  S.markNotificationsRead = async (actor) => {
    if (!actor) throw new AppError('Silakan masuk', 401);
    return db.tx(async (t) => {
      for (const n of await t.find('notifications', { user_id: actor.id, read: 0 })) await t.update('notifications', n.id, { read: 1 });
      return true;
    });
  };

  
  S.dashboard = async (actor) => {
    need(actor, ...BACKOFFICE);
    await tick();
    const fs = await db.find('financings', {});
    const byStatus = {};
    const buckets = { lancar: { count: 0, amount: 0 }, perhatian: { count: 0, amount: 0 }, kurang: { count: 0, amount: 0 }, diragukan: { count: 0, amount: 0 }, macet: { count: 0, amount: 0 } };
    let outstanding = 0;
    const byPartner = {};
    for (const f of fs) {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
      const v = await finView(db, f, actor);
      if (v.outstanding > 0) {
        outstanding += v.outstanding;
        buckets[v.bucket.key].count++; buckets[v.bucket.key].amount += v.outstanding;
        byPartner[v.partner_name] = (byPartner[v.partner_name] || 0) + v.outstanding;
      }
    }
    const prot = await protW(db), kw = await kmhW(db), esc = await escrowW(db);
    const protection = await bal(db, { account: ACC.PROTEKSI, wallet_id: prot.id });
    const users = await db.find('users', {});
    const investors = new Set((await db.find('fundings', { investor_type: 'member', status: ['locked', 'active'] })).map((x) => x.investor_id));
    const payments = await db.find('payment_events', {});
    const dists = await db.find('distributions', {});
    return {
      today: await today(), outstanding, byStatus, buckets, byPartner,
      npl: outstanding ? (buckets.macet.amount) / outstanding : 0,
      dpd30: outstanding ? (buckets.kurang.amount + buckets.diragukan.amount + buckets.macet.amount) / outstanding : 0,
      protection, protection_coverage: outstanding ? protection / outstanding : 0,
      kmh: await walletSummary(db, kw, 'kmh'), escrow_cash: await bal(db, { account: ACC.KAS, wallet_id: esc.id }),
      members: users.filter((u) => rolesOf(u).some((r) => r === 'pendana' || r === 'penerima')).length,
      pending_kyc: users.filter((u) => u.kyc_status === 'pending').length,
      active_investors: investors.size,
      payments_total: sum(payments.filter((p) => p.status === 'processed'), (p) => p.amount),
      profit_distributed: sum(dists.filter((d) => d.kind === 'bagi_hasil'), (d) => d.profit),
      unmatched_payments: payments.filter((p) => ['unmatched', 'suspense'].includes(p.status)).length,
      queue: {
        verify: byStatus[ST.SUBMITTED] || 0, analyze: byStatus[ST.VERIFIED] || 0, committee: byStatus[ST.ANALYZED] || 0,
        sign: byStatus[ST.FUNDED] || 0, disburse: (byStatus[ST.AKAD_SIGNED] || 0) + (byStatus[ST.DISBURSING] || 0),
        disb_pending: (await db.find('disbursements', { status: 'pending' })).length,
        wd_pending: (await db.find('withdrawals', { status: ['requested', 'verified'] })).length,
      },
    };
  };
  S.trialBalance = async (actor) => {
    need(actor, 'finance', 'manajer', 'admin');
    const lines = await db.find('ledger_lines', {});
    const acc = {};
    for (const l of lines) { const a = (acc[l.account] ||= { account: l.account, debit: 0, credit: 0 }); a.debit += l.debit; a.credit += l.credit; }
    const rows = Object.values(acc).sort((a, b) => a.account.localeCompare(b.account)).map((a) => ({ ...a, balance: a.account.startsWith('1') ? a.debit - a.credit : a.credit - a.debit }));
    const assets = sum(rows.filter((r) => r.account.startsWith('1')), (r) => r.balance);
    const liab = sum(rows.filter((r) => !r.account.startsWith('1') && r.account !== ACC.UJRAH), (r) => r.balance) + (rows.find((r) => r.account === ACC.UJRAH)?.balance || 0);
    return { rows, total_debit: sum(rows, (r) => r.debit), total_credit: sum(rows, (r) => r.credit), assets, liabilities: liab, balanced: sum(rows, (r) => r.debit) === sum(rows, (r) => r.credit) && assets === liab };
  };
  S.journals = async (actor, { limit = 60 } = {}) => {
    need(actor, 'finance', 'manajer', 'admin');
    const js = await db.find('journals', {}, { orderBy: ['id', 'desc'], limit });
    const out = [];
    for (const j of js) out.push({ ...j, lines: await db.find('ledger_lines', { journal_id: j.id }) });
    return out;
  };
  S.auditLog = async (actor, { limit = 200 } = {}) => {
    need(actor, 'admin', 'manajer', 'pendana');
    return db.find('audit_logs', {}, { orderBy: ['id', 'desc'], limit });
  };

  
  S.reconcile = async (actor, { csv, provider }) => {
    need(actor, 'finance');
    const rows = parseCsv(req(csv, 'Data mutasi')).filter((r) => r.length >= 3 && /\d/.test(r[2]));
    const events = await db.find('payment_events', provider ? { provider } : {});
    const seen = new Set();
    const matched = [], missing_in_system = [], amount_mismatch = [];
    for (const [external_id, va_number, amount, date] of rows) {
      const ev = events.find((e) => e.external_id === external_id);
      const amt = Number(String(amount).replace(/[^\d]/g, ''));
      if (!ev) { missing_in_system.push({ external_id, va_number, amount: amt, date }); continue; }
      seen.add(ev.id);
      if (ev.amount !== amt) amount_mismatch.push({ external_id, bank: amt, system: ev.amount });
      else matched.push({ external_id, amount: amt });
    }
    const dates = new Set(rows.map((r) => (r[3] || '').slice(0, 10)).filter(Boolean));
    const missing_in_bank = events.filter((e) => !seen.has(e.id) && e.provider !== 'manual' && (!dates.size || dates.has(String(e.paid_at).slice(0, 10))))
      .map((e) => ({ external_id: e.external_id, va_number: e.va_number, amount: e.amount, date: e.paid_at }));
    const esc = await escrowW(db);
    const summary = { rows: rows.length, matched: matched.length, missing_in_system, missing_in_bank, amount_mismatch, ledger_cash: await bal(db, { account: ACC.KAS, wallet_id: esc.id }) };
    await db.tx(async (t) => {
      await t.insert('recon_runs', { actor_id: actor.id, created_at: await stamp(t), summary: JSON.stringify({ ...summary, missing_in_system: summary.missing_in_system.length, missing_in_bank: summary.missing_in_bank.length, amount_mismatch: summary.amount_mismatch.length }) });
      await audit(t, actor, 'reconcile', 'recon', null, { rows: rows.length });
    });
    return summary;
  };

  S.kmhWallet = async (actor) => {
    need(actor, 'manajer', 'finance', 'admin');
    const kw = await kmhW(db);
    const va = await ensureVAOutside('kmh', null);
    return { ...(await walletSummary(db, kw, 'kmh')), va };
  };
  async function ensureVAOutside(type, id) {
    const ex = await db.one('virtual_accounts', { owner_type: type, owner_id: id });
    if (ex) return ex.va_number;
    return db.tx(async (t) => (await ensureVA(t, type, id)).va_number);
  }

  S.tick = async () => tick();

  
  S.__public = [
    'getSettings', 'updateSettings', 'advanceDate', 'createUser', 'me', 'updateProfile', 'listMembers', 'verifyMember', 'setUserActive', 'acceptVaultAccess',
    'listPartners', 'savePartner', 'simulatePayment', 'recordManualPayment', 'listPayments', 'listVAs',
    'createApplication', 'verifyApplication', 'analyzeApplication', 'committeeVote', 'listFinancing', 'listMarketplace', 'fund',
    'getContract', 'signContract', 'createDisbursements', 'listDisbursements', 'approveDisbursement', 'markFailedDeparture',
    'listCollections', 'addCollectionNote', 'startLossHandling', 'claimProtection', 'buyback', 'writeOff',
    'requestWithdrawal', 'listWithdrawals', 'verifyWithdrawal', 'decideWithdrawal', 'listFinancings', 'getFinancing', 'portfolio',
    'walletMutations', 'notifications', 'markNotificationsRead', 'dashboard', 'trialBalance', 'journals', 'auditLog', 'reconcile', 'kmhWallet',
  ];
  return S;
}
