

export const TABLES = [
  'users', 'kyc_docs', 'partners', 'wallets', 'journals', 'ledger_lines', 'financings', 'financing_costs', 'fundings',
  'committee_votes', 'contracts', 'disbursements', 'schedules', 'virtual_accounts', 'payment_events', 'distributions',
  'withdrawals', 'collections', 'loss_events', 'notifications', 'audit_logs', 'settings', 'recon_runs',
  'face_profiles', 'webauthn_credentials',
];

const match = (row, where) => Object.entries(where).every(([k, v]) => {
  const rv = row[k] === undefined ? null : row[k];
  return Array.isArray(v) ? v.includes(rv) : rv === (v === undefined ? null : v);
});

export function createMemDb(initial) {
  let state = initial ? JSON.parse(JSON.stringify(initial)) : { seq: {}, t: {} };
  for (const t of TABLES) { state.t[t] ||= []; state.seq[t] ||= 0; }
  let inTx = false;
  const listeners = [];

  const api = {
    async insert(table, row) {
      const r = { ...row, id: ++state.seq[table] };
      for (const k of Object.keys(r)) if (r[k] === undefined) r[k] = null;
      state.t[table].push(r);
      return { ...r };
    },
    async update(table, id, patch) {
      const r = state.t[table].find((x) => x.id === id);
      if (r) Object.assign(r, patch);
      return r ? { ...r } : null;
    },
    async delete(table, id) { state.t[table] = state.t[table].filter((x) => x.id !== id); },
    async get(table, id) { const r = state.t[table].find((x) => x.id === id); return r ? { ...r } : null; },
    async find(table, where = {}, opts = {}) {
      let rows = state.t[table].filter((r) => match(r, where));
      if (opts.orderBy) {
        const [col, dir] = opts.orderBy;
        rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      if (opts.limit) rows = rows.slice(0, opts.limit);
      return rows.map((r) => ({ ...r }));
    },
    async one(table, where) { return state.t[table].find((r) => match(r, where)) ? { ...state.t[table].find((r) => match(r, where)) } : null; },
    async lock() {},
    async tx(fn) {
      if (inTx) return fn(api);
      const snap = JSON.stringify(state);
      inTx = true;
      try {
        const out = await fn(api);
        inTx = false;
        listeners.forEach((l) => l(state));
        return out;
      } catch (e) {
        state = JSON.parse(snap);
        inTx = false;
        throw e;
      }
    },
    onCommit(fn) { listeners.push(fn); },
    dump() { return state; },
  };
  return api;
}
