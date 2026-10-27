import { Client } from 'pg';

const email = String(process.argv[2] || 'investor@kmh.coop').trim().toLowerCase();
const scheme = 'postgres:' + String.fromCharCode(47, 47);
const connectionString = process.env.DATABASE_URL || (scheme + 'kmh:kmh_local_dev_2026@127.0.0.1:5432/kmh');

const client = new Client({ connectionString });
await client.connect();

const before = (await client.query('select id, email, totp_enabled, totp_secret from users where email=$1', [email])).rows[0];
if (!before) {
  console.log('Akun tidak ditemukan: ' + email);
  await client.end();
  process.exit(1);
}

const affected = await client.query(
  'update users set totp_enabled=0, totp_secret=null, totp_fail_count=0, totp_locked_until=null where email=$1 and id=$2 returning id, email, totp_enabled, totp_secret',
  [email, before.id],
);

const others = (await client.query('select count(*)::int as n from users where id<>$1 and totp_secret is not null', [before.id])).rows[0].n;

console.log('Target   : ' + email + ' (id=' + before.id + ')');
console.log('Sebelum  : totp_enabled=' + before.totp_enabled + ' secret=' + (before.totp_secret ? 'ada' : 'kosong'));
console.log('Sesudah  : ' + JSON.stringify(affected.rows[0]));
console.log('Akun lain dengan secret TOTP utuh : ' + others);

await client.end();
console.log('Selesai. Restart server agar ensureTotpSecrets() membuat rahasia baru.');
