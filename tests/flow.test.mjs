
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createMemDb } from '../public/shared/memdb.js';
import { createServices } from '../public/shared/services.js';
import { seedDemo } from '../public/shared/seed.js';
import { splitUjrah, allocatePayment, capSplit } from '../public/shared/calc.js';

async function setup() {
  const db = createMemDb();
  const S = createServices(db, {
    realToday: () => '2026-10-24', realNow: () => '2026-10-24T09:00:00.000Z',
    sha256: async (s) => crypto.createHash('sha256').update(s).digest('hex'), allowTimeTravel: true, allowSimulator: true,
  });
  const P = await seedDemo(db, S);
  return { db, S, P };
}
const balanced = async (S, admin) => { const tb = await S.trialBalance(admin); assert.ok(tb.balanced, 'neraca saldo harus seimbang'); return tb; };

test('pembagian ujrah sesuai Bab 5.3', () => {
  assert.deepEqual(splitUjrah(450000, 10, 70), { protection: 45000, net: 405000, investor: 283500, kmh: 121500 });
});

test('pembayaran parsial dialokasikan proporsional (Lampiran H #6)', () => {
  const s = [{ id: 1, seq: 1, principal_due: 2500000, ujrah_due: 450000, paid_principal: 0, paid_ujrah: 0 }];
  const r = allocatePayment(s, 1475000);
  assert.equal(r.items[0].principal, 1250000);
  assert.equal(r.items[0].ujrah, 225000);
});

test('capSplit tidak melebihi batas tiap pihak', () => {
  const r = capSplit(100, [1, 1, 1], [10, 50, 50]);
  assert.equal(r.reduce((a, b) => a + b, 0), 100);
  assert.ok(r[0] <= 10);
});

test('simulasi Bab 5: lunas 12 angsuran, distribusi & rekap sesuai', async () => {
  const { S, P } = await setup();
  let f = await S.getFinancing(P.admin, { id: P.app1.id });
  for (const s of f.schedules.filter((x) => x.status !== 'paid')) {
    await S.advanceDate(P.admin, { date: s.due_date });
    await S.simulatePayment(P.finance, { va_number: f.va_number, amount: s.principal_due + s.ujrah_due });
  }
  f = await S.getFinancing(P.admin, { id: P.app1.id });
  assert.equal(f.status, 'PAID_OFF');
  const by = Object.fromEntries(f.fundings.map((x) => [x.name, x]));
  assert.equal(by['Ani Rahmawati'].profit, 1701000);
  assert.equal(by['Bayu Pratama'].profit, 945000);
  assert.equal(by['Citra Lestari'].profit, 756000);
  assert.equal(by['Ani Rahmawati'].principal_returned, 13500000);
  const d = await S.dashboard(P.admin);
  assert.equal(d.protection, 540000);
  const kmh = await S.kmhWallet(P.manajer);
  assert.equal(kmh.profit_total, 1458000);
  await balanced(S, P.admin);
});

test('webhook duplikat hanya diproses sekali (Lampiran H #1)', async () => {
  const { S, P } = await setup();
  const me = await S.me(P.C);
  const before = me.wallet.available;
  const args = { provider: 'bank', external_id: 'X-1', va_number: me.va, amount: 1000000 };
  await S.receivePayment(null, args); const r2 = await S.receivePayment(null, args); await S.receivePayment(null, args);
  assert.equal(r2.duplicate, true);
  assert.equal((await S.me(P.C)).wallet.available, before + 1000000);
});

test('aturan pendanaan: batas porsi, saldo, kelipatan, tidak berlebih (H #3, #8)', async () => {
  const { S, P } = await setup();
  const id = P.app2.id;
  await assert.rejects(S.fund(P.C, { id, amount: 1200000 }), /kelipatan/);
  await assert.rejects(S.fund(P.A, { id, amount: 8000000 }), /maksimal 50%/);
  await assert.rejects(S.fund(P.E, { id, amount: 1000000 }), /akses/);
  const f = await S.getFinancing(P.admin, { id });
  const remaining = f.principal - f.funded;
  await assert.rejects(S.fund(P.C, { id, amount: remaining + 500000 }), /Sisa kebutuhan/);
  await balanced(S, P.admin);
});

test('listing kedaluwarsa mengembalikan dana terkunci (H #4)', async () => {
  const { S, P } = await setup();
  const before = (await S.me(P.Dm)).wallet;
  await S.advanceDate(P.admin, { days: 10 });
  const f = await S.getFinancing(P.admin, { id: P.app2.id });
  assert.equal(f.status, 'EXPIRED');
  const after = (await S.me(P.Dm)).wallet;
  assert.equal(after.locked, 0);
  assert.equal(after.available, before.available + before.locked);
  await balanced(S, P.admin);
});

test('maker-checker: pembuat tidak boleh menyetujui (H #7) & penarikan', async () => {
  const { S, P, db } = await setup();
  
  await db.tx((t) => t.update('users', P.finance.id, { roles: 'finance,manajer' }));
  const fm = { ...P.finance, roles: 'finance,manajer' };
  const w = (await S.listWithdrawals(P.admin, {}))[0];
  await S.verifyWithdrawal(fm, { withdrawal_id: w.id });
  await assert.rejects(S.decideWithdrawal(fm, { withdrawal_id: w.id, approve: true }), /berbeda/);
  await S.decideWithdrawal(P.manajer, { withdrawal_id: w.id, approve: true });
  await balanced(S, P.admin);
});

test('alur penuh: pengajuan baru sampai pencairan, lalu gagal berangkat', async () => {
  const { S, P } = await setup();
  const f3 = (await S.listFinancings(P.admin, { status: 'SUBMITTED' }))[0];
  await S.verifyApplication(P.analis, { id: f3.id, ok: true });
  await S.analyzeApplication(P.analis, { id: f3.id, score: { character: 4, capacity: 4, capital: 3, collateral: 4, condition: 4 }, ujrah: 4590000, tenor: 12, grace_months: 4 });
  await S.committeeVote(P.komite1, { id: f3.id, decision: 'approve' });
  const r = await S.committeeVote(P.komite2, { id: f3.id, decision: 'approve' });
  assert.equal(r.status, 'LISTED');
  const f = await S.getFinancing(P.admin, { id: f3.id });
  let left = f.principal - f.funded;
  for (const u of [P.C, P.Dm, P.A]) {
    const cap = Math.floor(f.principal * 0.5);
    const avail = (await S.me(u)).wallet.available;
    let amt = Math.min(left, cap, Math.floor(avail / 500000) * 500000);
    if (amt <= 0) continue;
    if (amt !== left && amt < 1000000) continue;
    await S.fund(u, { id: f3.id, amount: amt });
    left -= amt;
    if (!left) break;
  }
  if (left) { await S.simulatePayment(P.finance, { va_number: (await S.me(P.B)).va, amount: left }); await S.fund(P.B, { id: f3.id, amount: left }); }
  assert.equal((await S.getFinancing(P.admin, { id: f3.id })).status, 'FUNDED');
  await S.signContract(P.F, { id: f3.id, as: 'penerima' });
  await S.signContract(P.manajer, { id: f3.id, as: 'kmh' });
  await S.createDisbursements(P.finance, { id: f3.id });
  const ds = (await S.listDisbursements(P.finance, { status: 'pending' })).filter((d) => d.financing_id === f3.id);
  await assert.rejects(S.approveDisbursement(P.finance, { disbursement_id: ds[0].id, approve: true }), /akses/);
  await S.approveDisbursement(P.manajer, { disbursement_id: ds[0].id, approve: true }); 
  const r2 = await S.markFailedDeparture(P.analis, { id: f3.id, note: 'Tidak lulus MCU' });
  assert.equal(r2.outstanding, ds[0].amount);
  const ff = await S.getFinancing(P.admin, { id: f3.id });
  assert.equal(ff.status, 'FAILED_DEPARTURE');
  await balanced(S, P.admin);
});

test('waterfall kerugian: klaim proteksi, buyback, hapus buku (Bab 5.6)', async () => {
  const { S, P } = await setup();
  const id = P.app1.id;
  await assert.rejects(S.startLossHandling(P.komite1, { id }), /DPD > 90/);
  await S.advanceDate(P.admin, { days: 100 });
  await S.startLossHandling(P.komite1, { id });
  
  let f = await S.getFinancing(P.admin, { id });
  assert.equal(f.outstanding, 20000000);
  await S.recordManualPayment(P.finance, { va_number: f.va_number, amount: 5000000, reference: 'PENJAMIN-01' });
  f = await S.getFinancing(P.admin, { id });
  const claimable = Math.min(f.protection_balance, Math.floor(f.outstanding * 0.5));
  await S.claimProtection(P.komite1, { id, amount: claimable });
  await assert.rejects(S.claimProtection(P.komite1, { id, amount: 99999999 }), /maksimal/);
  const aniBefore = (await S.me(P.A)).wallet.available;
  const bb = await S.buyback(P.komite1, { id });
  const aniAfter = (await S.me(P.A)).wallet.available;
  f = await S.getFinancing(P.admin, { id });
  assert.equal(f.status, 'CLOSED_BUYBACK');
  assert.ok(aniAfter > aniBefore);
  assert.equal(f.fundings.filter((x) => x.investor_type === 'member' && x.status === 'bought_back').length, 3);
  
  const k1 = (await S.kmhWallet(P.manajer)).available;
  await S.simulatePayment(P.finance, { va_number: f.va_number, amount: 1000000 });
  const k2 = (await S.kmhWallet(P.manajer)).available;
  assert.ok(k2 > k1);
  const w = await S.writeOff(P.komite1, { id });
  assert.ok(w.amount >= 0);
  assert.equal((await S.getFinancing(P.admin, { id })).status, 'CLOSED_LOSS');
  const tb = await balanced(S, P.admin);
  assert.equal(tb.rows.find((r) => r.account === '3100').balance, (await S.getFinancing(P.admin, { id: P.app1.id })).outstanding);
  assert.ok(bb.amount > 0);
});

test('akses data: pendana tidak bisa membuka data penerima lain (H #12)', async () => {
  const { S, P } = await setup();
  await assert.rejects(S.listMembers(P.A, {}), /akses/);
  await assert.rejects(S.getFinancing(P.Dm, { id: P.app1.id }), /akses/);
  const pub = await S.getFinancing(P.Dm, { id: P.app2.id });
  assert.ok(!pub.borrower);
  assert.match(pub.borrower_name, /^E\. W\.$/);
});
