import { Client } from 'pg';

const email = String(process.argv[2] || 'investor@kmh.coop').trim().toLowerCase();
const scheme = 'postgres:' + String.fromCharCode(47, 47);
const connectionString = process.env.DATABASE_URL || (scheme + 'kmh:kmh_local_dev_2026@127.0.0.1:5432/kmh');

const client = new Client({ connectionString });
await client.connect();

const target = (await client.query('select id, email, member_no, roles, kyc_status, totp_enabled from users where email=$1', [email])).rows[0];
if (!target) {
  console.log('Akun tidak ditemukan: ' + email);
  await client.end();
  process.exit(1);
}

const tables = (await client.query("select table_name from information_schema.tables where table_schema='public'")).rows.map((r) => r.table_name);
const wipe = [];
for (const t of ['sessions', 'vault_sessions', 'login_challenges', 'webauthn_challenges', 'face_challenges', 'face_profiles', 'webauthn_credentials']) {
  if (!tables.includes(t)) continue;
  await client.query('delete from ' + t);
  wipe.push(t);
}
if (tables.includes('security_events')) {
  await client.query('truncate table security_events restart identity');
  wipe.push('security_events (truncate)');
}
if (tables.includes('notifications')) {
  await client.query('delete from notifications where user_id=$1', [target.id]);
  wipe.push('notifications (user ' + target.id + ')');
}

const reset = await client.query(
  'update users set totp_enabled=0, totp_secret=null, totp_fail_count=0, totp_locked_until=null, vault_accepted_at=null, vault_total=0 where id=$1 returning id, email, totp_enabled, totp_secret, totp_fail_count, vault_accepted_at, vault_total',
  [target.id],
);

await client.query("delete from audit_logs where actor_id=$1 and action in ('vault_accept','vault_unlock','face_enroll','face_unlock','login_stage2_2fa_ok','webauthn_register')", [target.id]);

console.log('=== RESET AKUN PAK ERI ===');
console.log('Target          : ' + target.email + ' (id=' + target.id + ', ' + target.member_no + ', peran ' + target.roles + ', KYC ' + target.kyc_status + ')');
console.log('Password        : tidak diubah (tetap dipakai Pak Eri)');
console.log('Tabel dikosongkan: ' + (wipe.length ? wipe.join(', ') : 'tidak ada'));
console.log('Status akhir    : ' + JSON.stringify(reset.rows[0]));
console.log('Catatan         : secret TOTP baru dibuat server saat start, QR muncul di layar 2FA saat login pertama.');

await client.end();
