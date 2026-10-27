


export const DEMO_PASSWORD = 'demo12345';
export const DEMO_INVESTOR = {
  email: 'investor@kmh.coop',
  name: 'Investor KMH',
  member_no: 'KMH-0801',
  phone: '08120000801',
  bank_account: '7012345801',
};

export async function seedDemo(db, S, { passwordHash = null, investorPasswordHash = null } = {}) {
  const setDate = (date) => S.advanceDate(admin, { date });
  
  const adminRow = await db.tx((t) => t.insert('users', {
    member_no: 'STAF-001', name: 'Admin KMH', email: 'admin@kmh.coop', phone: '0811000001', password_hash: passwordHash,
    roles: 'admin', kyc_status: 'approved', kyc_note: '', bank_name: '', bank_account: '', bank_holder: '', address: '',
    totp_secret: null, totp_enabled: 0, active: 1, created_at: '2026-01-05T08:00:00.000Z',
  }));
  const admin = { id: adminRow.id, name: adminRow.name, roles: 'admin' };
  await setDate('2026-01-05');

  const mk = async (name, email, roles, extra = {}) => {
    const u = await S.createUser(admin, { name, email, roles, password_hash: extra.hash || passwordHash, phone: extra.phone || '08120000000', member_no: extra.member_no, bank_name: extra.bank_name || 'BSI', bank_account: extra.bank_account || '', bank_holder: name, kyc_status: extra.kyc_status || 'approved' });
    return { id: u.id, name: u.name, roles: roles.join(',') };
  };
  const analis = await mk('Rina Kusuma', 'analis@kmh.coop', ['analis'], { member_no: 'STAF-002' });
  const komite1 = await mk('H. Ahmad Fauzi', 'komite1@kmh.coop', ['komite'], { member_no: 'STAF-003' });
  const komite2 = await mk('Dewi Anggraini', 'komite2@kmh.coop', ['komite'], { member_no: 'STAF-004' });
  const finance = await mk('Budi Santoso', 'finance@kmh.coop', ['finance'], { member_no: 'STAF-005' });
  const manajer = await mk('Sari Wulandari', 'manajer@kmh.coop', ['manajer'], { member_no: 'STAF-006' });
  const A = await mk('Ani Rahmawati', 'ani@contoh.id', ['pendana'], { member_no: 'KMH-0101', bank_account: '7012345601' });
  const B = await mk('Bayu Pratama', 'bayu@contoh.id', ['pendana'], { member_no: 'KMH-0102', bank_account: '7012345602' });
  const C = await mk('Citra Lestari', 'citra@contoh.id', ['pendana'], { member_no: 'KMH-0103', bank_account: '7012345603' });
  const Dm = await mk('Dimas Hidayat', 'dimas@contoh.id', ['pendana'], { member_no: 'KMH-0104', bank_account: '7012345604' });
  const D = await mk('Dodi Saputra', 'dodi@contoh.id', ['penerima'], { member_no: 'KMH-0201' });
  const E = await mk('Eka Wulandari', 'eka@contoh.id', ['penerima'], { member_no: 'KMH-0202' });
  const F = await mk('Fajar Nugroho', 'fajar@contoh.id', ['penerima'], { member_no: 'KMH-0203' });
  const investor = await mk(DEMO_INVESTOR.name, DEMO_INVESTOR.email, ['pendana'], { member_no: DEMO_INVESTOR.member_no, phone: DEMO_INVESTOR.phone, bank_account: DEMO_INVESTOR.bank_account, hash: investorPasswordHash || passwordHash });
  
  await S.register(null, { member_no: 'KMH-0105', name: 'Gita Permata', email: 'gita@contoh.id', phone: '081299900105', roles: ['pendana'], password_hash: passwordHash, bank_name: 'BSI', bank_account: '7012345605', bank_holder: 'Gita Permata' });

  const lpk = await S.savePartner(admin, { type: 'LPK', name: 'LPK Hikari Nusantara', contact: 'Pak Yusuf · 0812-3456-7001', bank_name: 'BSI', bank_account: '7100200301', exposure_limit: 300000000 });
  const so = await S.savePartner(admin, { type: 'SO', name: 'SO Mirai Bersama', contact: 'Bu Laras · 0812-3456-7002', bank_name: 'Bank Muamalat', bank_account: '3310044501', exposure_limit: 300000000 });

  
  const kmhInfo = await S.kmhWallet(manajer);
  const pay = (va, amount, note) => S.simulatePayment(finance, { va_number: va, amount, note });
  await pay(kmhInfo.va, 50000000, 'Setoran modal KMH');
  for (const [u, amt] of [[A, 20000000], [B, 10000000], [C, 8000000], [Dm, 15000000]]) {
    const me = await S.me(u);
    await pay(me.va, amt, 'Top-up pendana');
  }

  
  const app1 = await S.createApplication(D, {
    partner_id: lpk.id, purpose: 'Magang Jepang – bidang pengolahan makanan (Ikusei Shuro/TITP)', departure_plan: 'Rencana berangkat Mei 2026',
    japan_company: 'Shizuoka Food Processing Co.', japan_job: 'Operator pengolahan makanan', est_salary: 13500000,
    guarantor_name: 'Suparman', guarantor_phone: '081311112222', guarantor_relation: 'Ayah',
    costs: [
      { component: 'Pelatihan bahasa & budaya Jepang', amount: 12000000, partner_id: lpk.id },
      { component: 'Pemeriksaan kesehatan (MCU)', amount: 1500000, partner_id: lpk.id },
      { component: 'Pengurusan dokumen & paspor', amount: 1500000, partner_id: lpk.id },
      { component: 'Biaya Sending Organization', amount: 6000000, partner_id: so.id },
      { component: 'Visa & COE', amount: 3000000, partner_id: so.id },
      { component: 'Tiket & keberangkatan', amount: 6000000, partner_id: so.id },
    ],
  });
  await S.verifyApplication(analis, { id: app1.id, ok: true, note: 'Dokumen lengkap, kontrak penerimaan terverifikasi ke SO.' });
  await S.analyzeApplication(analis, {
    id: app1.id, score: { character: 5, capacity: 4, capital: 3, collateral: 4, condition: 4 },
    ujrah: 5400000, tenor: 12, grace_months: 4, salary_idr: 13500000, note: 'Gaji bersih estimasi ¥140.000/bln. Angsuran 22% gaji.',
  });
  await S.committeeVote(komite1, { id: app1.id, decision: 'approve', note: 'Layak.' });
  await S.committeeVote(komite2, { id: app1.id, decision: 'approve', note: 'Setuju, pantau keberangkatan.' });
  await setDate('2026-01-07');
  await S.fund(A, { id: app1.id, amount: 13500000 });
  await S.fund(B, { id: app1.id, amount: 7500000 });
  await S.fund(C, { id: app1.id, amount: 6000000 });
  await S.signContract(D, { id: app1.id, as: 'penerima', ip: '103.10.0.21' });
  await S.signContract(manajer, { id: app1.id, as: 'kmh', ip: '103.10.0.5' });
  await setDate('2026-01-15');
  await S.createDisbursements(finance, { id: app1.id });
  for (const d of await S.listDisbursements(finance, { status: 'pending' })) await S.approveDisbursement(manajer, { disbursement_id: d.id, approve: true, proof: `BSI-TRF-${d.id}` });
  const f1 = await S.getFinancing(admin, { id: app1.id });
  
  for (const s of f1.schedules.slice(0, 4)) {
    await setDate(s.due_date);
    await pay(f1.va_number, s.principal_due + s.ujrah_due, `Angsuran ke-${s.seq}`);
  }

  
  await setDate('2026-10-12');
  const app2 = await S.createApplication(E, {
    partner_id: so.id, purpose: 'Magang Jepang – bidang perawatan lansia (kaigo)', departure_plan: 'Rencana berangkat Maret 2027',
    japan_company: 'Aichi Care Service', japan_job: 'Asisten perawat lansia', est_salary: 14000000,
    guarantor_name: 'Rahmat', guarantor_phone: '081322223333', guarantor_relation: 'Kakak',
    costs: [
      { component: 'Pelatihan bahasa & budaya Jepang', amount: 10000000, partner_id: lpk.id },
      { component: 'Pemeriksaan kesehatan (MCU)', amount: 1500000, partner_id: lpk.id },
      { component: 'Biaya Sending Organization', amount: 6500000, partner_id: so.id },
      { component: 'Tiket & keberangkatan', amount: 6000000, partner_id: so.id },
    ],
  });
  await S.verifyApplication(analis, { id: app2.id, ok: true, note: 'Lengkap.' });
  await S.analyzeApplication(analis, { id: app2.id, score: { character: 4, capacity: 4, capital: 3, collateral: 3, condition: 4 }, ujrah: 4320000, tenor: 12, grace_months: 5, salary_idr: 14000000, note: 'Sertifikat JLPT N4 sudah dimiliki.' });
  await setDate('2026-10-19');
  await S.committeeVote(komite1, { id: app2.id, decision: 'approve' });
  await S.committeeVote(komite2, { id: app2.id, decision: 'approve' });
  await setDate('2026-10-20');
  await S.fund(Dm, { id: app2.id, amount: 8000000 });
  await S.fund(A, { id: app2.id, amount: 5000000 });

  
  await setDate('2026-10-23');
  await S.createApplication(F, {
    partner_id: lpk.id, purpose: 'Magang Jepang – bidang konstruksi', departure_plan: 'Rencana berangkat Juni 2027',
    japan_company: 'Osaka Kensetsu K.K.', japan_job: 'Pekerja bekisting', est_salary: 15000000,
    guarantor_name: 'Siti Aminah', guarantor_phone: '081344445555', guarantor_relation: 'Ibu',
    costs: [
      { component: 'Pelatihan bahasa & budaya Jepang', amount: 12000000, partner_id: lpk.id },
      { component: 'Biaya Sending Organization', amount: 7000000, partner_id: so.id },
      { component: 'Tiket & keberangkatan', amount: 6500000, partner_id: so.id },
    ],
  });

  
  await S.updateProfile(B, { bank_name: 'BSI', bank_account: '7012345602', bank_holder: 'Bayu Pratama' });
  await S.requestWithdrawal(B, { amount: 1000000 });

  await setDate('2026-10-24');
  return { admin, analis, komite1, komite2, finance, manajer, A, B, C, Dm, D, E, F, investor, app1, app2 };
}
