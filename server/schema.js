import { ST, PAYABLE, BACKOFFICE, ROLES } from '../public/shared/constants.js';

export async function ensureSchema(knex) {
  const T = async (name, build) => { if (!(await knex.schema.hasTable(name))) await knex.schema.createTable(name, build); };
  const C = async (table, column, build) => {
    if (!(await knex.schema.hasColumn(table, column))) await knex.schema.alterTable(table, (t) => build(t));
  };
  const money = (t, c) => t.bigInteger(c).notNullable().defaultTo(0);
  const ts = (t, c = 'created_at') => t.string(c, 40);

  await T('users', (t) => {
    t.increments('id'); t.string('member_no', 40).notNullable().unique(); t.string('name', 160).notNullable();
    t.string('email', 160).notNullable().unique(); t.string('phone', 40); t.string('password_hash', 200);
    t.string('roles', 200).notNullable(); t.string('kyc_status', 20).notNullable(); t.text('kyc_note');
    t.string('bank_name', 80); t.string('bank_account', 60); t.string('bank_holder', 160); t.text('address');
    t.string('totp_secret', 80); t.integer('totp_enabled').defaultTo(0); t.integer('active').defaultTo(1); ts(t);
  });
  await C('users', 'nik_enc', (t) => t.string('nik_enc', 600));
  await C('users', 'bank_account_enc', (t) => t.string('bank_account_enc', 600));
  await C('users', 'address_enc', (t) => t.string('address_enc', 600));
  await C('users', 'enc_key_version', (t) => t.string('enc_key_version', 80));
  await C('users', 'totp_fail_count', (t) => t.integer('totp_fail_count').defaultTo(0));
  await C('users', 'totp_locked_until', (t) => t.string('totp_locked_until', 40));
  await C('users', 'vault_accepted_at', (t) => t.string('vault_accepted_at', 40));
  await C('users', 'vault_total', (t) => t.bigInteger('vault_total').defaultTo(0));

  await T('kyc_docs', (t) => { t.increments('id'); t.integer('user_id').notNullable().index(); t.string('kind', 40); t.string('filename', 200); t.string('stored_path', 300); ts(t); });
  await T('partners', (t) => {
    t.increments('id'); t.string('type', 20); t.string('name', 160).notNullable(); t.string('contact', 200);
    t.string('bank_name', 80); t.string('bank_account', 60); money(t, 'exposure_limit'); t.integer('active').defaultTo(1); ts(t);
  });
  await T('wallets', (t) => { t.increments('id'); t.string('owner_type', 20).notNullable(); t.integer('owner_id'); t.unique(['owner_type', 'owner_id']); });
  await T('journals', (t) => { t.increments('id'); t.string('ref_type', 40); t.integer('ref_id'); t.string('description', 300); t.integer('created_by'); ts(t); });
  await T('ledger_lines', (t) => {
    t.increments('id'); t.integer('journal_id').notNullable().index(); t.string('account', 8).notNullable();
    t.integer('wallet_id'); t.integer('financing_id'); money(t, 'debit'); money(t, 'credit');
    t.index(['account', 'wallet_id']); t.index(['account', 'financing_id']);
  });
  await T('financings', (t) => {
    t.increments('id'); t.string('code', 40); t.integer('borrower_id').notNullable().index(); t.integer('partner_id');
    money(t, 'principal'); money(t, 'ujrah'); t.integer('tenor'); t.integer('grace_months');
    t.string('purpose', 300); t.string('departure_plan', 300); t.string('japan_company', 200); t.string('japan_job', 200); money(t, 'est_salary');
    t.string('guarantor_name', 160); t.string('guarantor_phone', 40); t.string('guarantor_relation', 60);
    t.string('grade', 2); t.text('score_json'); t.text('analysis_note'); t.text('verify_note');
    t.integer('nisbah_investor'); t.integer('protection_pct'); t.integer('kmh_min_pct');
    t.string('status', 30).notNullable().index(); t.string('listing_deadline', 10); t.string('contract_hash', 80); t.string('va_number', 40);
    ts(t); ts(t, 'updated_at'); ts(t, 'disbursed_at'); t.string('first_due', 10);
  });
  await T('financing_costs', (t) => { t.increments('id'); t.integer('financing_id').notNullable().index(); t.string('component', 160); money(t, 'amount'); t.integer('partner_id'); t.integer('disbursed').defaultTo(0); });
  await T('fundings', (t) => {
    t.increments('id'); t.integer('financing_id').notNullable().index(); t.string('investor_type', 20); t.integer('investor_id');
    t.integer('wallet_id'); money(t, 'amount'); t.string('status', 20); ts(t);
  });
  await T('committee_votes', (t) => { t.increments('id'); t.integer('financing_id').notNullable(); t.integer('user_id').notNullable(); t.string('decision', 10); t.text('note'); ts(t); t.unique(['financing_id', 'user_id']); });
  await T('contracts', (t) => { t.increments('id'); t.integer('financing_id').notNullable().unique(); t.text('body'); t.string('sha256', 80); t.text('signatures'); ts(t); });
  await T('disbursements', (t) => {
    t.increments('id'); t.integer('financing_id').notNullable().index(); t.integer('cost_id'); t.integer('partner_id'); money(t, 'amount');
    t.string('status', 20); t.integer('maker_id'); t.integer('checker_id'); t.string('proof', 200); ts(t); ts(t, 'approved_at');
  });
  await T('schedules', (t) => {
    t.increments('id'); t.integer('financing_id').notNullable().index(); t.integer('seq'); t.string('due_date', 10);
    money(t, 'principal_due'); money(t, 'ujrah_due'); money(t, 'paid_principal'); money(t, 'paid_ujrah'); t.string('status', 20); ts(t, 'paid_at');
  });
  await T('virtual_accounts', (t) => { t.increments('id'); t.string('owner_type', 20); t.integer('owner_id'); t.string('va_number', 40).notNullable().unique(); ts(t); });
  await T('payment_events', (t) => {
    t.increments('id'); t.string('provider', 40).notNullable(); t.string('external_id', 120).notNullable(); t.string('va_number', 40);
    money(t, 'amount'); t.string('paid_at', 40); t.string('status', 20); t.text('note'); t.text('raw'); t.integer('financing_id'); ts(t);
    t.unique(['provider', 'external_id']);
  });
  await T('distributions', (t) => {
    t.increments('id'); t.integer('payment_event_id'); t.integer('financing_id').index(); t.integer('wallet_id').index(); t.integer('funding_id').index();
    money(t, 'principal'); money(t, 'profit'); t.string('kind', 30); ts(t);
  });
  await T('withdrawals', (t) => { t.increments('id'); t.integer('user_id').index(); t.integer('wallet_id'); money(t, 'amount'); t.string('status', 20); t.integer('maker_id'); t.integer('checker_id'); t.text('note'); ts(t); ts(t, 'updated_at'); });
  await T('collections', (t) => { t.increments('id'); t.integer('financing_id').index(); t.integer('officer_id'); t.string('action', 80); t.text('note'); t.string('promise_date', 10); ts(t); });
  await T('loss_events', (t) => { t.increments('id'); t.integer('financing_id').index(); t.string('kind', 30); money(t, 'amount'); t.integer('actor_id'); t.text('note'); ts(t); });
  await T('notifications', (t) => { t.increments('id'); t.integer('user_id').index(); t.string('title', 200); t.text('body'); t.string('link', 80); t.integer('read').defaultTo(0); ts(t); });
  await T('audit_logs', (t) => { t.increments('id'); t.integer('actor_id'); t.string('actor_name', 160); t.string('action', 60); t.string('entity', 40); t.integer('entity_id'); t.text('detail'); ts(t); });
  await T('settings', (t) => { t.increments('id'); t.string('key', 60).notNullable().unique(); t.text('value'); });
  await T('recon_runs', (t) => { t.increments('id'); t.integer('actor_id'); ts(t); t.text('summary'); });

  await T('security_events', (t) => {
    t.increments('id');
    t.string('severity', 20).notNullable().index();
    t.string('rule_id', 20).notNullable().index();
    t.string('rule_name', 160);
    t.string('category', 40).index();
    t.string('action', 20);
    t.string('method', 10);
    t.string('path', 300);
    t.string('ip', 80);
    t.integer('actor_id');
    t.string('actor_name', 160);
    t.string('user_agent', 300);
    t.string('correlation_id', 80);
    t.text('evidence');
    t.integer('blocked').defaultTo(0);
    t.integer('is_simulation').defaultTo(0);
    ts(t);
    t.index(['created_at']);
  });
  await C('security_events', 'is_simulation', (t) => t.integer('is_simulation').defaultTo(0));
  await T('waf_config', (t) => { t.increments('id'); t.string('key', 60).notNullable().unique(); t.text('value'); ts(t, 'updated_at'); });
  await T('webauthn_credentials', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().index();
    t.string('kind', 20).notNullable();
    t.string('credential_id', 200).notNullable().unique();
    t.text('public_key');
    t.bigInteger('counter').defaultTo(0);
    t.string('transports', 200);
    t.string('aaguid', 80);
    t.string('device_label', 160);
    t.text('eye_vector');
    t.string('eye_hash', 120);
    ts(t);
    ts(t, 'last_used_at');
    ts(t, 'revoked_at');
  });
  await T('webauthn_challenges', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().index();
    t.string('challenge', 200).notNullable().unique();
    t.string('kind', 40);
    ts(t, 'expires_at');
    ts(t, 'consumed_at');
    t.text('meta');
    ts(t);
  });
  await T('vault_sessions', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().index();
    t.string('token_id', 80).notNullable().unique();
    t.string('method', 40);
    t.string('scope', 60);
    ts(t, 'unlocked_at');
    ts(t, 'expires_at');
    ts(t, 'revoked_at');
    t.string('ip', 80);
    ts(t);
  });
  await T('nominative_records', (t) => {
    t.increments('id');
    t.string('ref_type', 30).notNullable();
    t.integer('ref_id').notNullable();
    t.string('code', 60);
    t.string('subject_mask', 160);
    t.text('enc_payload');
    t.string('fingerprint', 80);
    t.string('key_version', 80);
    ts(t);
    ts(t, 'updated_at');
    t.unique(['ref_type', 'ref_id']);
  });
  await T('nominative_los_records', (t) => {
    t.increments('id');
    t.string('los_code', 60).notNullable().unique();
    t.string('member_code', 60);
    t.text('enc_payload');
    t.string('fingerprint', 80);
    t.string('key_version', 80);
    ts(t);
    ts(t, 'updated_at');
  });
  await T('los_records', (t) => {
    t.increments('id');
    t.string('id_pengajuan', 40).notNullable().unique();
    t.integer('seq_no').index();
    t.string('source_id', 40);
    t.string('gender', 20).index();
    t.string('loan_code', 120).index();
    t.string('loan_status', 30).index();
    t.string('source_loan_status', 40);
    t.string('ntf_total', 40);
    t.string('installment_real', 40);
    t.string('lender_id', 40);
    t.string('created_at_src', 40);
    t.string('updated_at_src', 40);
    t.text('enc_payload');
    t.text('search_tokens');
    t.integer('is_active').defaultTo(1).index();
    t.string('active_badge', 60);
    t.string('key_version', 80);
    ts(t);
    ts(t, 'updated_at');
  });
  await T('login_challenges', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().index();
    t.string('challenge', 120).notNullable().unique();
    t.string('stage', 30).notNullable();
    t.integer('attempts').defaultTo(0);
    t.string('ip', 80);
    t.string('user_agent', 300);
    ts(t, 'created_at');
    ts(t, 'expires_at');
    ts(t, 'consumed_at');
    ts(t, 'blocked_at');
  });
  await T('face_profiles', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().unique();
    t.text('device_public_jwk');
    t.string('device_label', 160);
    t.text('vector_front');
    t.text('vector_left');
    t.text('vector_right');
    t.double('mouth_baseline').defaultTo(0);
    t.double('smile_baseline').defaultTo(0);
    ts(t, 'enrolled_at');
    ts(t, 'last_used_at');
    ts(t, 'revoked_at');
  });
  await T('face_challenges', (t) => {
    t.increments('id');
    t.integer('user_id').notNullable().index();
    t.string('challenge', 120).notNullable().unique();
    t.string('kind', 30);
    t.text('stages');
    t.text('meta');
    ts(t, 'issued_at');
    ts(t, 'expires_at');
    ts(t, 'consumed_at');
    ts(t, 'failed_at');
  });

  if (knex.client.config.client === 'pg') {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION kmh_ledger_immutable() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'Ledger bersifat append-only; buat jurnal balik untuk koreksi'; END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS kmh_ledger_lines_immutable ON ledger_lines;
      CREATE TRIGGER kmh_ledger_lines_immutable BEFORE UPDATE OR DELETE ON ledger_lines FOR EACH ROW EXECUTE FUNCTION kmh_ledger_immutable();
      DROP TRIGGER IF EXISTS kmh_journals_immutable ON journals;
      CREATE TRIGGER kmh_journals_immutable BEFORE UPDATE OR DELETE ON journals FOR EACH ROW EXECUTE FUNCTION kmh_ledger_immutable();
    `);
  }

  return {
    states: Object.values(ST),
    payable: PAYABLE,
    backoffice: BACKOFFICE,
    roles: ROLES,
  };
}
