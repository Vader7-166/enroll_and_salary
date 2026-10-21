const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readFileSync, rmSync } = require('node:fs');
const net = require('node:net');
const Decimal = require("decimal.js");
function assertDecimal(actual, expected) {
  assert.equal(typeof actual, "string", "Decimal values travel as strings");
  assert.equal(new Decimal(actual).eq(expected), true, actual + " != " + expected);
}
const { businessDate } = require('../dist/auth/business-date');

process.loadEnvFile(resolve(__dirname, '../.env'));

const root = resolve(__dirname, '../..');
const backend = resolve(root, 'backend');
const date = value => new Date(value + 'T00:00:00.000Z');
const text = value => value.toISOString().slice(0, 10);
const today = text(businessDate());
const after = days => text(new Date(date(today).getTime() + days * 86400000));

function errorCode(response) {
  return response.body?.code ?? response.body?.error?.code ?? response.body?.response?.code;
}

test('Payroll configuration: isolated PostgreSQL and real HTTP', { timeout: 180000 }, async t => {
  const name = 'hrtp_payroll_configuration_' + randomUUID().replaceAll('-', '');
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient();
  const url = new URL(base);
  url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = {
    ...process.env,
    DATABASE_URL: url.href,
    SEED_ALLOW_ISOLATED: 'true',
    SEED_DATASET: 'foundation',
    DEMO_ACCOUNTS_FILE: credentialsPath,
  };
  let db;
  let server;
  let logs = '';

  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [[resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], ['prisma/seed.cjs']]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 45000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer();
    await new Promise(done => listener.listen(0, '127.0.0.1', done));
    const port = listener.address().port;
    await new Promise(done => listener.close(done));
    server = spawn(process.execPath, ['dist/main.js'], {
      cwd: backend,
      env: { ...env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', chunk => { logs += chunk; });
    server.stderr.on('data', chunk => { logs += chunk; });
    await new Promise((ready, reject) => {
      let finished = false;
      const timeout = setTimeout(() => {
        finished = true;
        reject(new Error(logs));
      }, 20000);
      server.once('exit', code => {
        finished = true;
        clearTimeout(timeout);
        reject(new Error('API exited ' + code + '\n' + logs));
      });
      const poll = async () => {
        if (finished) return;
        try {
          if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) {
            finished = true;
            clearTimeout(timeout);
            ready();
            return;
          }
        } catch {}
        if (!finished) setTimeout(poll, 100);
      };
      poll();
    });

    async function request(path, cookie, body) {
      const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body: await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0],
      };
    }
    async function ok(path, cookie, body) {
      const result = await request(path, cookie, body);
      assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result) + (result.status >= 500 ? '\n' + logs : ''));
      return result.body;
    }
    async function login(username) {
      const account = credentials.find(value => value.username === username);
      return (await request('/auth/login', null, { username, password: account.password })).cookie;
    }

    const [kt, local, tt, qd, ad] = await Promise.all(['kt.all', 'kt.bn', 'tt.bn', 'qd.bn', 'ad.demo'].map(login));
    const [company, site, remote, team] = await Promise.all(['COMPANY', 'NM-BN', 'NM-NA', 'NM-BN-D1-T1'].map(code => db.orgUnit.findUniqueOrThrow({ where: { code } })));
    const siteVersion = await db.orgUnitVersion.findFirstOrThrow({ where: { orgUnitId: site.id, effectiveFrom: { lte: date(today) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date(today) } }] } });
    const physicalSite = await db.site.findUniqueOrThrow({ where: { id: siteVersion.siteId } });
    const path = '/payroll-configuration';
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const code = stem => `${stem}_${suffix}`;
    const common = {
      name: 'Cấu hình kiểm chứng',
      unit: 'VND',
      active: true,
      status: 'SIMULATION',
      decisionReference: 'DEC-03-PAYROLL-CONFIG',
      reason: 'Kiểm chứng danh mục giá và công thức',
      effectiveFrom: today,
    };
    const componentInput = {
      name: 'Thành phần công thức kiểm chứng',
      componentType: 'EARNING',
      active: true,
      isInsurable: false,
      taxClassification: 'NON_TAXABLE',
      isOtBase: false,
      isProrated: true,
      displayOrder: 51,
      status: 'SIMULATION',
      classificationBasis: 'Dùng riêng cho kiểm chứng công thức khai báo.',
      decisionReference: 'DEC-03-PAYROLL-CONFIG',
      reason: 'Tạo thành phần công thức kiểm chứng',
      effectiveFrom: today,
    };
    const createComponent = async (orgUnitId, componentCode) => (await ok('/salary-components', kt, { ...componentInput, orgUnitId, code: componentCode })).item;
    const priceInput = (configurationCode, priceType, amount, unit, extra = {}) => ({
      ...common,
      ...extra,
      kind: 'PRICE',
      code: configurationCode,
      orgUnitId: company.id,
      priceType,
      amount,
      unit,
    });
    const formulaInput = (configurationCode, componentId, expression, variables, unit = 'VND', extra = {}) => ({
          ...common,
          ...extra,
          kind: 'FORMULA',
          code: configurationCode,
          orgUnitId: company.id,
          componentId,
          expression,
          variables,
          roundingMode: 'HALF_UP',
          roundingScale: 2,
          unit,
        });
        const versionInput = ({ kind, code: ignoredCode, orgUnitId, ...version }) => version;
        const priceVersion = (...args) => versionInput(priceInput(...args));
        const formulaVersion = (...args) => versionInput(formulaInput(...args));
    const detail = async (id, asOf = today, cookie = kt) => (await ok(`${path}/${id}?asOf=${asOf}`, cookie)).item;

    let companyComponent;
    let month;
    let p1;
    let productFormula;
    let rootFormula;

    await t.test('KT-only authorization, read-only permissions, and site visibility preserve ancestor read without ancestor management', async () => {
      assert.equal((await request(path + '/context')).status, 401);
      for (const cookie of [tt, qd, ad]) {
        assert.equal((await request(path, cookie)).status, 403);
        assert.equal((await request(path + '/context', cookie)).status, 403);
        assert.equal((await request(path, cookie, priceInput(code('DENIED'), 'P1', '1', 'VND'))).status, 403);
      }
      const role = await db.role.findUniqueOrThrow({ where: { code: 'KT' } });
      try {
        await db.role.update({ where: { code: "KT" }, data: { permissions: role.permissions.filter(value => value !== "payroll.components.manage") } });
        const context = await ok(path + '/context', local);
        assert.deepEqual(context.managementUnits, []);
        assert.equal((await request(path, local, { ...priceInput(code('READONLY'), 'P1', '1', 'VND'), orgUnitId: site.id })).status, 403);
      } finally {
        await db.role.update({ where: { code: "KT" }, data: { permissions: role.permissions } });
      }

      companyComponent = await createComponent(company.id, code('COMPONENT'));
      const companyPrice = (await ok(path, kt, priceInput(code('COMPANY'), 'P1', '1.000000', 'VND'))).item;
      const localPrice = (await ok(path, local, { ...priceInput(code('LOCAL'), 'P1', '2.000000', 'VND'), orgUnitId: site.id })).item;
      const hiddenPrice = (await ok(path, kt, { ...priceInput(code('REMOTE'), 'P1', '3.000000', 'VND'), orgUnitId: remote.id })).item;
      const context = await ok(path + '/context', local);
      assert.deepEqual(context.managementUnits.map(unit => unit.id), [site.id]);
      assert.deepEqual(new Set(context.units.map(unit => unit.id)), new Set([company.id, site.id]));
      const visible = (await ok(path, local)).items;
      assert.deepEqual(new Set(visible.map(item => item.id)), new Set([companyPrice.id, localPrice.id]));
      assert.equal(visible.find(item => item.id === companyPrice.id).canManage, false);
      assert.equal(visible.find(item => item.id === localPrice.id).canManage, true);
      assert.equal((await request(`${path}/${hiddenPrice.id}`, local)).status, 404);
      assert.equal((await request(`${path}?orgUnitId=${remote.id}`, local)).status, 404);
      assert.equal((await request(`${path}/${companyPrice.id}/versions`, local, { ...priceVersion(companyPrice.code, 'P1', '1', 'VND'), revision: 1, effectiveFrom: after(1) })).status, 404);
      assert.equal((await request(path, kt, { ...priceInput(code('TEAM'), 'P1', '1', 'VND'), orgUnitId: team.id })).status, 400);
    });

    await t.test('price kinds retain exact decimal values and required product or operation provenance', async () => {
      const cases = [
        ['MONTH', 'MONTHLY', '12345678.120000', 'VND/month'],
        ['DAY', 'DAILY', '456789.120000', 'VND/day'],
        ['HOUR', 'HOURLY', '45678.120000', 'VND/hour'],
        ['PRODUCT', 'PRODUCT', '100.125000', 'VND/product', { productCode: 'SP-ALPHA' }],
        ['PIECE', 'PIECEWORK', '10.250000', 'VND/piece', { operationCode: 'OP-CUT' }],
        ['COMM', 'COMMISSION', '12.500000', '%'],
        ['P1', 'P1', '1.100000', 'VND'],
        ['P2', 'P2', '2.200000', 'VND'],
        ['P3', 'P3', '3.300000', 'VND'],
      ];
      const created = {};
      for (const [stem, priceType, amount, unit, extra] of cases) {
        created[stem] = (await ok(path, kt, priceInput(code(stem), priceType, amount, unit, extra))).item;
      }
      month = created.MONTH;
      p1 = created.P1;
      const storedProduct = await detail(created.PRODUCT.id);
      assert.deepEqual(
        [storedProduct.activeVersion.priceType, storedProduct.activeVersion.amount, storedProduct.activeVersion.unit, storedProduct.activeVersion.productCode],
        ['PRODUCT', '100.125000', 'VND/product', 'SP-ALPHA'],
      );
      const storedPiece = await detail(created.PIECE.id);
      assert.deepEqual([storedPiece.activeVersion.priceType, storedPiece.activeVersion.operationCode], ['PIECEWORK', 'OP-CUT']);
      assert.deepEqual(
        ['MONTH', 'DAY', 'HOUR', 'COMM', 'P1', 'P2', 'P3'].map(stem => [created[stem].activeVersion.priceType, created[stem].activeVersion.amount, created[stem].activeVersion.unit]),
        [['MONTHLY', '12345678.120000', 'VND/month'], ['DAILY', '456789.120000', 'VND/day'], ['HOURLY', '45678.120000', 'VND/hour'], ['COMMISSION', '12.500000', '%'], ['P1', '1.100000', 'VND'], ['P2', '2.200000', 'VND'], ['P3', '3.300000', 'VND']],
      );
      for (const invalid of [
        priceInput(code('NO_PRODUCT'), 'PRODUCT', '1', 'VND/product'),
        priceInput(code('NO_OPERATION'), 'PIECEWORK', '1', 'VND/piece'),
        priceInput(code('BAD_COMM'), 'COMMISSION', '100.000001', '%'),
        priceInput(code('BAD_UNIT'), 'COMMISSION', '1', 'VND'),
        priceInput(code('NEGATIVE'), 'P1', '-0.000001', 'VND'),
      ]) {
        assert.equal((await request(path, kt, invalid)).status, 400);
      }
    });

    await t.test('successors use inclusive history, reject stale or overlapping dates, and serialize concurrent revisions', async () => {
      const original = await detail(month.id);
      assert.equal((await request(`${path}/${month.id}/versions`, kt, { ...priceVersion(month.code, 'MONTHLY', '12345679.120000', 'VND/month'), revision: original.revision, effectiveFrom: today })).status, 400);
      const successor = (await ok(`${path}/${month.id}/versions`, kt, { ...priceVersion(month.code, 'MONTHLY', '12345679.120000', 'VND/month'), revision: original.revision, effectiveFrom: after(1) })).item;
      assert.equal(successor.revision, original.revision + 1);
      assert.equal(successor.versions.find(version => version.id === original.activeVersion.id).effectiveTo, today);
      assert.equal((await detail(month.id, today)).activeVersion.amount, '12345678.120000');
      assert.equal((await detail(month.id, after(1))).activeVersion.amount, '12345679.120000');
      assert.equal((await request(`${path}/${month.id}/versions`, kt, { ...priceVersion(month.code, 'MONTHLY', '12345680.120000', 'VND/month'), revision: original.revision, effectiveFrom: after(2) })).status, 409);

      const start = after(3);
      const current = await detail(p1.id);
      const responses = await Promise.all(['A', 'B'].map((letter, index) => request(`${path}/${p1.id}/versions`, kt, {
        ...priceVersion(p1.code, 'P1', index ? '1.200000' : '1.300000', 'VND'),
        revision: current.revision,
        effectiveFrom: start,
        name: 'Phiên bản tranh chấp ' + letter,
      })));
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
      const final = await detail(p1.id, start);
      assert.equal(final.revision, current.revision + 1);
      assert.equal(final.versions.length, current.versions.length + 1);
    });

    await t.test('formula declarations, products, P tiers, monthly pro-rata, topological traces, and rounding execute declaratively', async () => {
      const priceItems = (await ok(`${path}?kind=PRICE&orgUnitId=${company.id}`, kt)).items;
      const find = type => priceItems.find(item => item.activeVersion.priceType === type);
      const product = find('PRODUCT');
      const p2 = find('P2');
      const p3 = find('P3');
      productFormula = (await ok(path, kt, formulaInput(code('PRODUCT_FORMULA'), companyComponent.id,
        'GIA_SP * SO_LUONG + P1 + P2 + P3',
        [
          { symbol: 'GIA_SP', source: 'PRICE', reference: product.code, unit: 'VND/product' },
          { symbol: 'SO_LUONG', source: 'INPUT', reference: 'SAN_LUONG', unit: 'product', min: '0', max: '100' },
          { symbol: 'P1', source: 'PRICE', reference: p1.code, unit: 'VND' },
          { symbol: 'P2', source: 'PRICE', reference: p2.code, unit: 'VND' },
          { symbol: 'P3', source: 'PRICE', reference: p3.code, unit: 'VND' },
        ],
      ))).item;
      rootFormula = (await ok(path, kt, formulaInput(code('MONTHLY_PRORATA'), companyComponent.id,
        'THU_NHAP_SAN_PHAM + LUONG_THANG * NGAY_CONG / NGAY_CHUAN',
        [
          { symbol: 'THU_NHAP_SAN_PHAM', source: 'FORMULA', reference: productFormula.code, unit: 'VND' },
          { symbol: 'LUONG_THANG', source: 'PRICE', reference: month.code, unit: 'VND/month' },
          { symbol: 'NGAY_CONG', source: 'INPUT', reference: 'WORK_DAYS', unit: 'day', min: '0', max: '31' },
          { symbol: 'NGAY_CHUAN', source: 'INPUT', reference: 'STANDARD_DAYS', unit: 'day', min: '1', max: '31' },
        ],
      ))).item;
      const context = await ok(`${path}/preview-context?orgUnitId=${company.id}&asOf=${today}&formulaCode=${rootFormula.code}`, kt);
      assert.deepEqual(context.inputs.map(input => input.code).sort(), ['SAN_LUONG', 'STANDARD_DAYS', 'WORK_DAYS']);
      assert.deepEqual(context.order, [productFormula.code, rootFormula.code]);
      const preview = await ok(`${path}/preview`, kt, {
        orgUnitId: company.id,
        asOf: today,
        formulaCode: rootFormula.code,
        inputs: [
          { code: 'SAN_LUONG', unit: 'product', value: '5' },
          { code: 'WORK_DAYS', unit: 'day', value: '1' },
          { code: 'STANDARD_DAYS', unit: 'day', value: '30' },
        ],
      });
      assert.deepEqual(preview.order, [productFormula.code, rootFormula.code]);
      assert.deepEqual(preview.results.map(result => result.code), [productFormula.code, rootFormula.code]);
      assertDecimal(preview.results[0].value, "507.23");
      assertDecimal(preview.results[1].value, "412029.83");
      assertDecimal(preview.results[0].rawValue, "507.225");
      const productTrace = preview.results[0].variables.find(variable => variable.symbol === 'GIA_SP');
      const formulaTrace = preview.results[1].variables.find(variable => variable.symbol === 'THU_NHAP_SAN_PHAM');
      assert.equal(productTrace.versionId, product.activeVersion.id);
      assert.equal(formulaTrace.versionId, productFormula.activeVersion.id);
    });

    await t.test('unsafe expressions and incomplete or redundant declarations fail before headers are persisted', async () => {
      const invalids = [
        ['UNSAFE', 'ABS.constructor("return 1")()', []],
        ['MISSING', 'UNDECLARED + 1', []],
        ['UNUSED', 'A + 1', [{ symbol: 'A', source: 'INPUT', reference: 'A', unit: 'count' }, { symbol: 'B', source: 'INPUT', reference: 'B', unit: 'count' }]],
        ['DUPLICATE', 'A + 1', [{ symbol: 'A', source: 'INPUT', reference: 'A', unit: 'count' }, { symbol: 'A', source: 'INPUT', reference: 'OTHER', unit: 'count' }]],
      ];
      for (const [stem, expression, variables] of invalids) {
        const badCode = code(stem);
        const result = await request(path, kt, formulaInput(badCode, companyComponent.id, expression, variables));
        assert.equal(result.status, 400);
        assert.equal(await db.payrollConfiguration.findUnique({ where: { orgUnitId_kind_code: { orgUnitId: company.id, kind: 'FORMULA', code: badCode } } }), null);
      }
    });

    await t.test('future cycles, dependency gaps, and dependent unit changes reject without partial dated history', async () => {
      const a = (await ok(path, kt, formulaInput(code('CYCLE_A'), companyComponent.id, '1', []))).item;
      const b = (await ok(path, kt, formulaInput(code('CYCLE_B'), companyComponent.id, '2', []))).item;
      const cycleDate = after(8);
      const aNext = await request(`${path}/${a.id}/versions`, kt, {
        ...formulaVersion(a.code, companyComponent.id, 'B + 1', [{ symbol: 'B', source: 'FORMULA', reference: b.code, unit: 'VND' }]),
        revision: a.revision,
        effectiveFrom: cycleDate,
      });
      assert.equal(aNext.status, 201, JSON.stringify(aNext.body));
      const bNext = await request(`${path}/${b.id}/versions`, kt, {
        ...formulaVersion(b.code, companyComponent.id, 'A + 1', [{ symbol: 'A', source: 'FORMULA', reference: a.code, unit: 'VND' }]),
        revision: b.revision,
        effectiveFrom: cycleDate,
      });
      assert.equal(bNext.status, 400);
      assert.equal((await detail(b.id, cycleDate)).revision, b.revision);

      const gappedPrice = (await ok(path, kt, { ...priceInput(code('GAP_PRICE'), 'P1', '7', 'VND'), effectiveTo: after(9) })).item;
      const gappedCode = code('GAP_FORMULA');
      const gap = await request(path, kt, formulaInput(gappedCode, companyComponent.id, 'G', [{ symbol: 'G', source: 'PRICE', reference: gappedPrice.code, unit: 'VND' }]));
      assert.equal(gap.status, 400);
      assert.equal(await db.payrollConfiguration.findUnique({ where: { orgUnitId_kind_code: { orgUnitId: company.id, kind: 'FORMULA', code: gappedCode } } }), null);

      const before = await detail(p1.id, after(3));
      const previewBody = { orgUnitId: company.id, asOf: after(10), formulaCode: rootFormula.code, inputs: [
        { code: 'SAN_LUONG', unit: 'product', value: '5' },
        { code: 'WORK_DAYS', unit: 'day', value: '1' },
        { code: 'STANDARD_DAYS', unit: 'day', value: '30' },
      ] };
      const beforePreview = await ok(path + '/preview', kt, previewBody);
      const rejected = await request(path + '/' + p1.id + '/versions', kt, {
        ...priceVersion(p1.code, 'P1', '1.400000', 'VND/day'), revision: before.revision, effectiveFrom: after(10),
      });
      assert.equal(rejected.status, 400);
      const unchanged = await detail(p1.id, after(10));
      assert.equal(unchanged.revision, before.revision);
      assert.equal(unchanged.activeVersion.unit, 'VND');
      const stillValid = await ok(path + '/preview', kt, previewBody);
      assert.deepEqual(stillValid, beforePreview);
    });

    await t.test('parameter sources choose dated site over region and global values, while company only resolves global', async () => {
      const parameterCode = code('PARAMETER');
      const parameter = value => ({
        paramCode: parameterCode,
        subjectType: 'ALL',
        applicationBasis: 'WORK_DATE',
        value,
        unit: 'ratio',
        effectiveFrom: date(today),
        documentEffectiveDate: date(today),
        legalBasis: 'Căn cứ kiểm chứng tham số công thức',
      });
      await db.legalParameter.create({ data: { ...parameter('0.10'), scopeKey: 'GLOBAL' } });
      await db.legalParameter.create({ data: { ...parameter('0.15'), scopeKey: 'REGION:' + physicalSite.wageRegionCode } });
      await db.legalParameter.create({ data: { ...parameter('0.20'), scopeKey: 'SITE:' + physicalSite.id } });
      const localParameterFormula = (await ok(path, kt, { ...formulaInput(code('SITE_PARAMETER'), companyComponent.id, 'TY_LE * 100', [{ symbol: 'TY_LE', source: 'PARAMETER', reference: parameterCode, unit: 'ratio' }], 'ratio'), orgUnitId: site.id })).item;
      const sitePreview = await ok(`${path}/preview`, kt, { orgUnitId: site.id, asOf: today, formulaCode: localParameterFormula.code, inputs: [] });
      assertDecimal(sitePreview.results.at(-1).value, '20.000000');
      const globalParameterFormula = (await ok(path, kt, formulaInput(code('GLOBAL_PARAMETER'), companyComponent.id, 'TY_LE * 100', [{ symbol: 'TY_LE', source: 'PARAMETER', reference: parameterCode, unit: 'ratio' }], 'ratio'))).item;
      const companyPreview = await ok(`${path}/preview`, kt, { orgUnitId: company.id, asOf: today, formulaCode: globalParameterFormula.code, inputs: [] });
      assertDecimal(companyPreview.results.at(-1).value, '10.000000');
      const wrongUnit = await request(path, kt, formulaInput(code('PARAMETER_UNIT'), companyComponent.id, 'TY_LE', [{ symbol: 'TY_LE', source: 'PARAMETER', reference: parameterCode, unit: 'VND' }]));
      assert.equal(wrongUnit.status, 400);
    });

    await t.test('preview distinguishes missing sample data from zero, enforces input units and bounds, detects division by zero, and keeps IF lazy', async () => {
      const division = (await ok(path, kt, formulaInput(code('DIVISION'), companyComponent.id, 'A / B', [
        { symbol: 'A', source: 'INPUT', reference: 'A', unit: 'count' },
        { symbol: 'B', source: 'INPUT', reference: 'B', unit: 'count' },
      ], 'count'))).item;
      const preview = body => request(`${path}/preview`, kt, { orgUnitId: company.id, asOf: today, formulaCode: division.code, inputs: body });
      const missing = await preview([{ code: 'A', unit: 'count', value: '0' }]);
      assert.equal(missing.status, 400);
      assert.equal(errorCode(missing), 'PREVIEW_INPUT_MISSING');
      const wrongUnit = await preview([{ code: 'A', unit: 'amount', value: '0' }, { code: 'B', unit: 'count', value: '2' }]);
      assert.equal(wrongUnit.status, 400);
      const zero = await preview([{ code: 'A', unit: 'count', value: '0' }, { code: 'B', unit: 'count', value: '2' }]);
      assert.equal(zero.status, 201);
      assertDecimal(zero.body.results.at(-1).value, '0.000000');
      const divideByZero = await preview([{ code: 'A', unit: 'count', value: '1' }, { code: 'B', unit: 'count', value: '0' }]);
      assert.equal(divideByZero.status, 400);
      assert.equal(errorCode(divideByZero), 'FORMULA_DIVISION_BY_ZERO');

      const bounded = await request(`${path}/preview`, kt, {
        orgUnitId: company.id,
        asOf: today,
        formulaCode: productFormula.code,
        inputs: [{ code: 'SAN_LUONG', unit: 'product', value: '101' }],
      });
      assert.equal(bounded.status, 400);
      const lazy = (await ok(path, kt, formulaInput(code('LAZY_IF'), companyComponent.id, 'IF(0, 1 / 0, 3)', [], 'count'))).item;
      const lazyPreview = await ok(`${path}/preview`, kt, { orgUnitId: company.id, asOf: today, formulaCode: lazy.code, inputs: [] });
      assertDecimal(lazyPreview.results.at(-1).value, '3.000000');
    });

    await t.test('site overrides preserve historical company sources and reject inherited unit changes, inactivity and cross-scope cycles atomically', async () => {
      const rateCode = code('INHERITED_RATE');
      await ok(path, kt, priceInput(rateCode, 'P1', '10', 'VND'));
      const inherited = (await ok(path, kt, formulaInput(code('INHERITED_FORMULA'), companyComponent.id, 'P', [{ symbol: 'P', source: 'PRICE', reference: rateCode, unit: 'VND' }]))).item;
      const localRate = (await ok(path, local, { ...priceInput(rateCode, 'P1', '20', 'VND'), orgUnitId: site.id, effectiveFrom: after(5) })).item;
      const run = asOf => ok(path + '/preview', local, { orgUnitId: site.id, asOf, formulaCode: inherited.code, inputs: [] });
      assertDecimal((await run(today)).results.at(-1).value, '10');
      assertDecimal((await run(after(5))).results.at(-1).value, '20');
      const before = await detail(localRate.id, after(8));
      for (const change of [{ active: false }, { unit: 'VND/day' }]) {
        const rejected = await request(path + '/' + localRate.id + '/versions', local, { ...priceVersion(rateCode, 'P1', '30', 'VND'), revision: before.revision, effectiveFrom: after(8), ...change });
        assert.equal(rejected.status, 400);
        assert.deepEqual(await detail(localRate.id, after(8)), before);
      }
      const a = (await ok(path, kt, formulaInput(code('INHERITED_A'), companyComponent.id, '1', []))).item;
      const b = (await ok(path, kt, formulaInput(code('INHERITED_B'), companyComponent.id, 'A', [{ symbol: 'A', source: 'FORMULA', reference: a.code, unit: 'VND' }]))).item;
      const cycle = await request(path, local, { ...formulaInput(a.code, companyComponent.id, 'B', [{ symbol: 'B', source: 'FORMULA', reference: b.code, unit: 'VND' }]), orgUnitId: site.id, effectiveFrom: after(12) });
      assert.equal(cycle.status, 400);
      assert.equal(await db.payrollConfiguration.findUnique({ where: { orgUnitId_kind_code: { orgUnitId: site.id, kind: 'FORMULA', code: a.code } } }), null);
    });

    await t.test('component and parameter expiry plus future inactive successors are checked across the entire formula interval', async () => {
      const finiteComponent = (await ok('/salary-components', kt, { ...componentInput, orgUnitId: company.id, code: code('FINITE_COMPONENT'), effectiveTo: after(3) })).item;
      const missingComponent = await request(path, kt, formulaInput(code('FINITE_COMPONENT_FORMULA'), finiteComponent.id, '1', []));
      assert.equal(missingComponent.status, 400);
      const paramCode = code('FINITE_PARAMETER');
      await db.legalParameter.create({ data: { paramCode, scopeKey: 'GLOBAL', subjectType: 'ALL', applicationBasis: 'WORK_DATE', value: '0.3', unit: 'ratio', effectiveFrom: date(today), effectiveTo: date(after(4)), documentEffectiveDate: date(today), legalBasis: 'Căn cứ kiểm chứng hạn hiệu lực tham số' } });
      assert.equal((await request(path, kt, formulaInput(code('EXPIRED_PARAMETER_FORMULA'), companyComponent.id, 'P', [{ symbol: 'P', source: 'PARAMETER', reference: paramCode, unit: 'ratio' }], 'ratio'))).status, 400);
      const inactivePrice = (await ok(path, kt, priceInput(code('FUTURE_INACTIVE'), 'P1', '2', 'VND'))).item;
      await ok(path + '/' + inactivePrice.id + '/versions', kt, { ...priceVersion(inactivePrice.code, 'P1', '2', 'VND'), revision: inactivePrice.revision, active: false, effectiveFrom: after(6) });
      const formula = formulaInput(code('INACTIVE_SOURCE_FORMULA'), companyComponent.id, 'P', [{ symbol: 'P', source: 'PRICE', reference: inactivePrice.code, unit: 'VND' }]);
      assert.equal((await request(path, kt, formula)).status, 400);
      const finite = await ok(path, kt, { ...formula, effectiveTo: after(5) });
      assert.equal(finite.item.activeVersion.effectiveTo, after(5));
      assert.equal((await request(path + '?asOf=2026-13-01', kt)).status, 400);
    });

    await t.test('shared DAG inputs merge compatible bounds, reject contradictions, and retain NONE precision through reused dependencies', async () => {
      const sub = (await ok(path, kt, { ...formulaInput(code('PRECISE_NONE'), companyComponent.id, 'X / 128', [{ symbol: 'X', source: 'INPUT', reference: 'SHARED_X', unit: 'count', min: '0', max: '9' }], 'count'), roundingMode: 'NONE', roundingScale: 0 })).item;
      const variables = [
        { symbol: 'A', source: 'FORMULA', reference: sub.code, unit: 'count' },
        { symbol: 'B', source: 'FORMULA', reference: sub.code, unit: 'count' },
        { symbol: 'X', source: 'INPUT', reference: 'SHARED_X', unit: 'count', min: '1', max: '7' },
      ];
      const root = (await ok(path, kt, formulaInput(code('SHARED_ROOT'), companyComponent.id, '(A + B) * 64 + X', variables, 'count'))).item;
      const context = await ok(path + '/preview-context?orgUnitId=' + company.id + '&asOf=' + today + '&formulaCode=' + root.code, kt);
      assert.deepEqual(context.inputs, [{ code: 'SHARED_X', unit: 'count', min: '1', max: '7' }]);
      assert.deepEqual(context.order, [sub.code, root.code]);
      const preview = await ok(path + '/preview', kt, { orgUnitId: company.id, asOf: today, formulaCode: root.code, inputs: [{ code: 'SHARED_X', unit: 'count', value: '1' }] });
      assert.deepEqual(preview.results.map(row => row.code), [sub.code, root.code]);
      assertDecimal(preview.results[0].rawValue, '0.0078125');
      assertDecimal(preview.results[0].value, '0.0078125');
      assertDecimal(preview.results[1].value, '2');
      for (const input of [{ ...variables[2], unit: 'VND' }, { ...variables[2], min: '10', max: '20' }]) {
        assert.equal((await request(path, kt, formulaInput(code('BAD_SHARED_' + input.unit), companyComponent.id, 'A + B + X', [variables[0], variables[1], input], 'count'))).status, 400);
      }
    });

    await t.test('database guards make catalog history immutable and prevent direct overlapping or destructive SQL', async () => {
      const before = await detail(rootFormula.id);
      const version = before.versions[0];
      for (const data of [{ name: 'Ghi đè' }, { unit: 'VND/day' }, { expression: '1' }, { effectiveFrom: date(after(20)) }]) {
        await assert.rejects(db.payrollConfigurationVersion.update({ where: { id: version.id }, data }), /immutable/);
      }
      await assert.rejects(db.payrollConfigurationVersion.delete({ where: { id: version.id } }), /immutable/);
      await assert.rejects(db.payrollConfiguration.update({ where: { id: rootFormula.id }, data: { code: code('REWRITE') } }), /immutable/);
      await assert.rejects(db.payrollConfiguration.delete({ where: { id: rootFormula.id } }), /immutable/);
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE "payroll_configuration_version"'), /immutable/);
      await assert.rejects(db.$executeRawUnsafe('TRUNCATE "payroll_configuration" CASCADE'), /immutable/);
      const stored = await db.payrollConfigurationVersion.findUniqueOrThrow({ where: { id: version.id } });
      const { id, createdAt, ...fields } = stored;
      await assert.rejects(db.payrollConfigurationVersion.create({ data: { ...fields, effectiveFrom: date(after(20)) } }), /no_overlap/);
      assert.deepEqual(await detail(rootFormula.id), before);
    });
  } finally {
    if (server) {
      server.kill();
      await new Promise(done => server.exitCode !== null ? done() : server.once('exit', done));
    }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
