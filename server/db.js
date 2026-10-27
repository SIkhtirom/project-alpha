
import knexLib from 'knex';
import pg from 'pg';

pg.types.setTypeParser(20, (v) => parseInt(v, 10)); 

export function createKnex(config) {
  if (config.databaseUrl) {
    return knexLib({ client: 'pg', connection: config.databaseUrl, pool: { min: 0, max: 10 } });
  }
  return knexLib({ client: 'better-sqlite3', connection: { filename: config.sqliteFile || ':memory:' }, useNullAsDefault: true, pool: { min: 1, max: 1 } });
}

function wrap(k, isPg) {
  const applyWhere = (q, where) => {
    for (const [col, v] of Object.entries(where || {})) {
      if (Array.isArray(v)) q.whereIn(col, v);
      else if (v === null || v === undefined) q.whereNull(col);
      else q.where(col, v);
    }
    return q;
  };
  const api = {
    async insert(table, row) {
      const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
      const [r] = await k(table).insert(clean).returning('*');
      return r;
    },
    async update(table, id, patch) {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length) await k(table).where({ id }).update(clean);
      return k(table).where({ id }).first();
    },
    async delete(table, id) { await k(table).where({ id }).del(); },
    async get(table, id) { return (await k(table).where({ id }).first()) || null; },
    async find(table, where = {}, opts = {}) {
      const q = applyWhere(k(table).select('*'), where);
      if (opts.orderBy) q.orderBy(opts.orderBy[0], opts.orderBy[1] || 'asc');
      else q.orderBy('id', 'asc');
      if (opts.limit) q.limit(opts.limit);
      return q;
    },
    async one(table, where) { return (await applyWhere(k(table).select('*'), where).orderBy('id', 'asc').first()) || null; },
    async lock(table, id) { if (isPg) await k(table).where({ id }).forUpdate().first(); },
  };
  return api;
}

export function createDb(knex) {
  const isPg = knex.client.config.client === 'pg';
  const base = wrap(knex, isPg);
  return {
    ...base,
    async tx(fn) {
      return knex.transaction(async (trx) => fn({ ...wrap(trx, isPg), tx: (f) => f(wrap(trx, isPg)) }), isPg ? { isolationLevel: 'read committed' } : undefined);
    },
  };
}
