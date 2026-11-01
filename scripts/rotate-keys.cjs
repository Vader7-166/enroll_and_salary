// FR-X.2 key rotation: re-encrypts every `*_cipher` column under HR_DATA_KEY_ACTIVE and recomputes the blind indexes.
//   npm run keys:rotate              rotate (one transaction per table, immutability triggers bypassed for the rewrite only)
//   npm run keys:rotate -- --check   report how many ciphertexts each key still protects; a key is removable at 0
// Needs HR_DATA_KEY (v1), HR_DATA_KEYS, HR_DATA_KEY_ACTIVE and DATABASE_URL in the environment, plus `npm run build`.
// The database role must be allowed to SET session_replication_role (superuser or granted SET on it).
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const envFile = resolve(__dirname, '../backend/.env');
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
const { PrismaClient } = require('@prisma/client');
const { keyRing, cipherKeyId, cipherText, plainText, blindIndex } = require('../backend/dist/common/data-crypto.js');

const BATCH = 500;
const HASHES = {
  employee_identity: row => ({
    id_number_hash: blindIndex(v1, 'ID_NUMBER', plainText(v1, row.id_number_cipher)),
    tax_code_hash: row.tax_code_cipher ? blindIndex(v1, 'TAX_CODE', plainText(v1, row.tax_code_cipher)) : null,
    si_book_hash: row.si_book_cipher ? blindIndex(v1, 'SI_BOOK', plainText(v1, row.si_book_cipher)) : null,
  }),
  employee_bank_account: row => ({ account_number_hash: blindIndex(v1, 'BANK_ACCOUNT', row.bank_code + ':' + plainText(v1, row.account_number_cipher)) }),
};
let v1;

async function cipherColumns(db) {
  const rows = await db.$queryRawUnsafe(`SELECT c.table_name, c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = current_schema() AND c.column_name LIKE '%\\_cipher' AND c.data_type IN ('text', 'character varying') ORDER BY 1, 2`);
  const tables = new Map();
  for (const row of rows) tables.set(row.table_name, [...(tables.get(row.table_name) ?? []), row.column_name]);
  return tables;
}

async function check(db, tables) {
  const usage = {};
  for (const [table, columns] of tables) for (const column of columns) {
    const counts = await db.$queryRawUnsafe(`SELECT CASE WHEN "${column}" LIKE 'k%' THEN split_part("${column}", '.', 1) ELSE 'kv1' END AS key_id, count(*)::int AS n
      FROM "${table}" WHERE "${column}" IS NOT NULL GROUP BY 1`);
    for (const { key_id, n } of counts) usage[key_id.slice(1)] = (usage[key_id.slice(1)] ?? 0) + n;
  }
  const archives = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM payslip_export WHERE status = 'COMPLETED' AND expires_at > now()`);
  return { usage, liveArchives: archives[0].n };
}

async function rotate(db, tables, active) {
  const report = {};
  for (const [table, columns] of tables) {
    const hashes = HASHES[table];
    const select = ['ctid::text AS ctid', ...columns.map(c => `"${c}"`), ...(table === 'employee_bank_account' ? ['bank_code'] : [])].join(', ');
    const stale = columns.map(c => `("${c}" IS NOT NULL AND "${c}" NOT LIKE 'k${active}.%')`).join(' OR ');
    // Blind indexes must move even when the ciphertexts are already on the active key (e.g. a re-run after a crash).
    const where = hashes ? 'true' : stale;
    let done = 0;
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      const rows = await tx.$queryRawUnsafe(`SELECT ${select} FROM "${table}" WHERE ${where}`);
      for (let i = 0; i < rows.length; i += BATCH) {
        for (const row of rows.slice(i, i + BATCH)) {
          const next = {};
          for (const column of columns) if (row[column] !== null && cipherKeyId(row[column]) !== active) next[column] = cipherText(v1, plainText(v1, row[column]));
          if (hashes) Object.assign(next, hashes(row));
          const keys = Object.keys(next);
          if (!keys.length) continue;
          await tx.$executeRawUnsafe(`UPDATE "${table}" SET ${keys.map((k, n) => `"${k}" = $${n + 1}`).join(', ')} WHERE ctid = $${keys.length + 1}::tid`, ...keys.map(k => next[k]), row.ctid);
          done++;
        }
      }
    }, { timeout: 30 * 60 * 1000, maxWait: 60000 });
    if (done) report[table] = done;
  }
  return report;
}

async function main() {
  const ring = keyRing();
  v1 = ring.keys.get('v1');
  if (!v1) throw new Error('HR_DATA_KEY (key v1) is required.');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('socket_timeout', '1800');
  const db = new PrismaClient({ datasourceUrl: url.href });
  try {
    const tables = await cipherColumns(db);
    if (!process.argv.includes('--check')) {
      const started = Date.now();
      const rewritten = await rotate(db, tables, ring.active);
      console.log(JSON.stringify({ active: ring.active, rewrittenRows: rewritten, seconds: (Date.now() - started) / 1000 }));
    }
    const { usage, liveArchives } = await check(db, tables);
    const removable = [...ring.keys.keys()].filter(id => id !== ring.active && !usage[id] && (id !== 'v1' || liveArchives === 0));
    console.log(JSON.stringify({ active: ring.active, ciphertextsByKey: usage, livePayslipArchives: liveArchives, removableKeys: removable }));
  } finally {
    await db.$disconnect();
  }
}

main().catch(error => { console.error(error.message ?? error); process.exitCode = 1; });
