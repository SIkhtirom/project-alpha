

export const sum = (arr, f = (x) => x) => arr.reduce((a, b) => a + f(b), 0);


export function splitLR(total, weights) {
  const W = sum(weights);
  if (W <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / W);
  const base = raw.map(Math.floor);
  let rem = total - sum(base);
  const order = raw.map((r, i) => [r - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < rem; k++) base[order[k % order.length][1]] += 1;
  return base;
}


export function capSplit(total, weights, caps) {
  const capTotal = sum(caps);
  if (total > capTotal) throw new Error(`Nominal ${total} melebihi kapasitas ${capTotal}`);
  const out = splitLR(total, weights);
  let excess = 0;
  for (let i = 0; i < out.length; i++) if (out[i] > caps[i]) { excess += out[i] - caps[i]; out[i] = caps[i]; }
  while (excess > 0) {
    const idx = out.map((v, i) => i).filter((i) => out[i] < caps[i]);
    const add = splitLR(excess, idx.map((i) => weights[i] || 1));
    excess = 0;
    idx.forEach((i, k) => {
      const room = caps[i] - out[i];
      const take = Math.min(room, add[k]);
      out[i] += take; excess += add[k] - take;
    });
  }
  return out;
}

const pad = (n) => String(n).padStart(2, '0');
export function parseDate(s) { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return { y, m, d }; }
export function fmtDate({ y, m, d }) { return `${y}-${pad(m)}-${pad(d)}`; }
export function addMonths(s, n) {
  const { y, m, d } = parseDate(s);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fmtDate({ y: ny, m: nm, d: Math.min(d, last) });
}
export function addDays(s, n) {
  const { y, m, d } = parseDate(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return fmtDate({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}
export function daysBetween(a, b) {
  const A = parseDate(a), B = parseDate(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}


export function buildSchedule({ principal, ujrah, tenor, firstDue }) {
  const p = Math.floor(principal / tenor), u = Math.floor(ujrah / tenor);
  const rows = [];
  for (let i = 1; i <= tenor; i++) {
    rows.push({
      seq: i, due_date: addMonths(firstDue, i - 1),
      principal_due: i === tenor ? principal - p * (tenor - 1) : p,
      ujrah_due: i === tenor ? ujrah - u * (tenor - 1) : u,
    });
  }
  return rows;
}


export function allocatePayment(schedules, amount) {
  const items = [];
  let left = amount;
  for (const s of [...schedules].sort((a, b) => a.seq - b.seq)) {
    if (left <= 0) break;
    const pr = s.principal_due - s.paid_principal, ur = s.ujrah_due - s.paid_ujrah;
    const rem = pr + ur;
    if (rem <= 0) continue;
    const take = Math.min(left, rem);
    let p, u;
    if (take === rem) { p = pr; u = ur; } else { u = Math.floor((take * ur) / rem); p = take - u; if (p > pr) { p = pr; u = take - p; } }
    items.push({ schedule_id: s.id, seq: s.seq, principal: p, ujrah: u });
    left -= take;
  }
  return { items, leftover: left };
}


export function splitUjrah(ujrah, protectionPct, nisbahInvestor) {
  const protection = Math.floor((ujrah * protectionPct) / 100);
  const net = ujrah - protection;
  const investor = Math.floor((net * nisbahInvestor) / 100);
  return { protection, net, investor, kmh: net - investor };
}

export function gradeFromScore(avg) {
  if (avg >= 4.2) return 'A';
  if (avg >= 3.4) return 'B';
  if (avg >= 2.6) return 'C';
  return 'D';
}

export function dpdBucket(dpd) {
  if (dpd <= 0) return { key: 'lancar', label: 'Lancar' };
  if (dpd <= 30) return { key: 'perhatian', label: 'Perhatian khusus' };
  if (dpd <= 60) return { key: 'kurang', label: 'Kurang lancar' };
  if (dpd <= 90) return { key: 'diragukan', label: 'Diragukan' };
  return { key: 'macet', label: 'Macet' };
}


export function computeDpd(schedules, today) {
  const open = schedules
    .filter((s) => s.status !== 'cancelled' && s.status !== 'written_off' && s.paid_principal + s.paid_ujrah < s.principal_due + s.ujrah_due)
    .sort((a, b) => a.seq - b.seq);
  if (!open.length) return 0;
  return Math.max(0, daysBetween(open[0].due_date, today));
}

export function parseCsv(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, '')));
}
