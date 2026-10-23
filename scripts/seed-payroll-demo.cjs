const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const Decimal = require('decimal.js');
const data = require('../backend/prisma/payroll-demo-data.cjs');

const root = resolve(__dirname, '..');
process.loadEnvFile(resolve(root, 'backend/.env'));
const database = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(database.hostname) || database.pathname !== '/hrtp_demo') {
  throw new Error('This command is only for the local hrtp_demo database, not an operational environment.');
}
const verifyOnly = process.argv.includes('--verify-only');
if (process.argv.slice(2).some(arg => arg !== '--verify-only')) throw new Error('Usage: npm run demo:payroll [-- --verify-only]');
const endpoint = `http://127.0.0.1:${process.env.PORT || '3000'}/api`;
const key = (scope, code, kind = '') => [kind, scope, code].join(':');
const marker = (row, version) => `${data.reference}/${row.kind || 'COMPONENT'}/${row.scope}/${row.code}/${version}`;
const versionFields = ['name', 'unit', 'active', 'status', 'decisionReference', 'reason', 'effectiveFrom', 'effectiveTo', 'priceType', 'amount', 'productCode', 'operationCode', 'componentId', 'expression', 'variables', 'roundingMode', 'roundingScale', 'componentType', 'isInsurable', 'taxClassification', 'isOtBase', 'isProrated', 'displayOrder', 'classificationBasis'];
let cookie;
async function request(path, body) {
  const response = await fetch(endpoint + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}
async function api(path, body) {
  const result = await request(path, body);
  if (result.status < 200 || result.status >= 300) throw new Error(`${path}: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  return result.body;
}
function assertOwned(row, item) {
  if (item && !item.versions.some(version => version.decisionReference === marker(row, '01'))) {
    throw new Error(`Code collision ${row.scope}/${row.code}: existing user data was not changed. Choose different demo codes before loading.`);
  }
}

async function main() {
  const credentials = JSON.parse(readFileSync(resolve(process.env.DEMO_ACCOUNTS_FILE || resolve(root, '.local/demo-accounts.json')), 'utf8'));
  const account = credentials.accounts.find(row => row.username === 'kt.all');
  if (!account) throw new Error('The local credential file must contain kt.all; this command never resets a password.');
  // Login separately: never include credential payloads in error/log output.
  const login = await fetch(endpoint + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: account.username, password: account.password }),
  });
  if (!login.ok) throw new Error('Demo KT login failed: HTTP ' + login.status);
  cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Demo KT login returned no session cookie.');
  try {
    const context = await api('/payroll-configuration/context');
    const units = new Map(context.managementUnits.map(row => [row.code, row.id]));
    for (const scope of ['COMPANY', 'HQ-HN', 'NM-BN', 'NM-HNA', 'NM-NA']) {
      if (!units.has(scope)) throw new Error('Missing manageable demo unit: ' + scope);
    }
    if (context.asOf < data.effectiveFrom) throw new Error('Demo snapshot starts on ' + data.effectiveFrom);
    const firstOfNextMonth = new Date(context.asOf + 'T00:00:00Z');
    firstOfNextMonth.setUTCMonth(firstOfNextMonth.getUTCMonth() + 1, 1);
    const nextDate = firstOfNextMonth.toISOString().slice(0, 10);
    const components = new Map((await api('/salary-components')).items.map(row => [key(row.orgUnitCode, row.code), row]));
    const configurations = new Map((await api('/payroll-configuration')).items.map(row => [key(row.orgUnitCode, row.code, row.kind), row]));
    // Preflight every identifier before writing anything; never upsert over a user's code.
    for (const row of data.components) assertOwned(row, components.get(key(row.scope, row.code)));
    for (const row of [...data.prices, ...data.formulas]) assertOwned(row, configurations.get(key(row.scope, row.code, row.kind)));
    const counts = { created: 0, preserved: 0, appendedVersions: 0 };
    function payload(row) {
      const { scope, successor, componentCode, componentScope, ...fields } = row;
      return {
        ...fields, orgUnitId: units.get(scope), effectiveFrom: data.effectiveFrom,
        status: 'SIMULATION', decisionReference: marker(row, '01'),
        reason: `Dữ liệu mô phỏng vận hành: ${row.name}; không dùng chi trả thực tế.`,
        ...(componentCode ? { componentId: components.get(key(componentScope || 'COMPANY', componentCode))?.id } : {}),
      };
    }
    async function ensure(row, collection, path) {
      const id = key(row.scope, row.code, row.kind);
      if (collection.has(id)) { counts.preserved++; return; }
      if (verifyOnly) throw new Error('Missing demo row: ' + id + '; run npm run demo:payroll first.');
      const body = payload(row);
      if (row.kind === 'FORMULA' && !body.componentId) throw new Error('Missing component for ' + row.code);
      const created = (await api(path, body)).item;
      collection.set(id, created); counts.created++;
    }
    for (const row of data.components) await ensure(row, components, '/salary-components');
    for (const row of [...data.prices, ...data.formulas]) await ensure(row, configurations, '/payroll-configuration');
    for (const row of [...data.components, ...data.prices].filter(row => row.successor)) {
      const collection = row.kind ? configurations : components;
      const id = key(row.scope, row.code, row.kind), item = collection.get(id);
      if (item.versions.some(version => version.decisionReference === marker(row, '02'))) continue;
      if (verifyOnly) throw new Error('Missing future demo version: ' + id);
      if (item.revision !== 1) throw new Error(`User-added versions preserved for ${id}; planned demo successor was not appended.`);
      const body = { ...payload(row), ...row.successor, effectiveFrom: nextDate, decisionReference: marker(row, '02'),
        reason: 'Mô phỏng thay đổi chính sách kỳ tiếp theo; giữ nguyên giá trị và phân loại quá khứ.', revision: item.revision };
      const version = Object.fromEntries(Object.entries(body).filter(([field]) => versionFields.includes(field) || field === 'revision'));
      const path = row.kind ? '/payroll-configuration' : '/salary-components';
      collection.set(id, (await api(`${path}/${item.id}/versions`, version)).item);
      counts.appendedVersions++;
    }
    console.log(JSON.stringify({ dataset: data.reference, components: data.components.length, prices: data.prices.length, formulas: data.formulas.length, ...counts }));
    let passed = 0;
    for (const scenario of data.scenarios) {
      let asOf = data.effectiveFrom;
      if (scenario.successorOf) {
        const [scope, code] = scenario.successorOf;
        const item = configurations.get(key(scope, code, 'PRICE'));
        asOf = item.versions.find(version => version.decisionReference.endsWith('/02')).effectiveFrom;
      }
      const selection = { orgUnitId: units.get(scenario.scope), asOf, formulaCode: scenario.formulaCode };
      const required = await api('/payroll-configuration/preview-context?' + new URLSearchParams(selection));
      const inputs = Object.entries(scenario.values).map(([code, value]) => {
        const definition = required.inputs.find(input => input.code === code);
        assert.ok(definition, 'Unexpected scenario input: ' + code);
        return { code, unit: definition.unit, value };
      });
      const response = await request('/payroll-configuration/preview', { ...selection, inputs });
      if (scenario.error) {
        assert.equal(response.status, scenario.error, scenario.name + ': expected input rejection');
      } else {
        assert.equal(response.status, 201, scenario.name + ': ' + JSON.stringify(response.body));
        const result = response.body.results.find(row => row.code === scenario.formulaCode);
        assert.ok(result && new Decimal(result.value).eq(scenario.expected), scenario.name + ': expected ' + scenario.expected + ', got ' + result?.value);
        if (scenario.order) assert.deepEqual(response.body.order, scenario.order, scenario.name + ': dependency order');
      }
      passed++;
      console.log(`PASS ${scenario.name}: ${scenario.error ? 'HTTP ' + scenario.error : scenario.expected + ' VND'} (${asOf})`);
    }
    console.log(`Verified ${passed}/${data.scenarios.length} worked examples; no employee payroll or attendance data written.`);
  } finally {
    await request('/auth/logout', {}).catch(() => console.warn('Could not log out demo session.'));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
