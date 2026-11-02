const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { withServer, day } = require('./http-harness.cjs');
const { cipherText } = require('../dist/common/data-crypto.js');
const { parseEligibility, evaluate } = require('../dist/welfare/eligibility.js');
const { calculateEmployee } = require('../dist/payroll/payroll-engine.js');

test('Eligibility is a closed schema evaluated against facts; every failed rule is reported', () => {
  assert.throws(() => parseEligibility({ formula: 'SENIORITY > 6' }), /không hỗ trợ trường formula/);
  assert.throws(() => parseEligibility({ minServiceMonths: -1 }));
  assert.throws(() => parseEligibility({ contractTypes: ['PERMANENT'] }));
  const unit = randomUUID(), other = randomUUID();
  const rule = parseEligibility({ minServiceMonths: 6, contractTypes: ['INDEFINITE'], orgUnitIds: [unit] });
  const facts = { employed: true, serviceMonths: 9, jobGradeCode: 'G2', contractType: 'INDEFINITE', unitPath: [other, unit] };
  assert.deepEqual(evaluate(rule, facts), { eligible: true, failed: [] }, 'a parent unit covers its subtree');
  assert.deepEqual(evaluate(rule, { ...facts, serviceMonths: 2, contractType: 'FIXED_TERM' }).failed.map(item => item.rule), ['minServiceMonths', 'contractTypes']);
  assert.deepEqual(evaluate({}, { ...facts, employed: false }).failed.map(item => item.rule), ['EMPLOYED']);
});

test('Engine stage: welfare lines are non-insurable; tax per catalog treatment, exemption up to the limit', async () => {
  const ctx = {
    employee: { id: 'e1', code: 'NV1', fullName: 'NV 1', hireDate: '2026-01-01', terminationDate: null },
    period: { id: 'p', code: 'PL-10', dateFrom: '2026-10-01', dateTo: '2026-10-26', paymentDate: '2026-11-05', month: '2026-10' },
    planVersions: [{ id: 'pl', payMode: 'MONTHLY', status: 'SIMULATION', effectiveFrom: '2026-01-01', effectiveTo: null, lines: [{ componentId: 'T', role: 'BASE', sourceType: 'TIME', allocation: 'INDIVIDUAL' }] }],
    components: { T: { isInsurable: true, taxClassification: 'TAXABLE', isOtBase: true, isProrated: true, componentType: 'EARNING', code: 'LUONG_TG', name: 'Lương thời gian' } },
    inputs: [], salary: [{ componentId: null, componentCode: null, componentName: 'Lương', from: '2026-10-01', to: '2026-10-26', amount: '10000000', salaryBasis: 'MONTHLY', source: 'CONTRACT', sourceId: 'hd', reference: 'HD' }],
    units: [{ orgUnitId: 'u', orgUnitCode: 'U', orgUnitName: 'U', siteId: 's', wageRegionCode: 'I', costCenterCode: 'CC', from: '2026-10-01', to: '2026-10-26', days: 26, minimumMonth: { id: 'm', value: '4960000' }, minimumHour: null }],
    attendance: { available: true, days: Array.from({ length: 26 }, (_, index) => ({ workDate: '2026-10-' + String(index + 1).padStart(2, '0'), workUnits: '1', workedMinutes: 480, status: 'OK', correctionId: null })), regularMinutes: String(26 * 480), lockHashes: ['h'] },
    buckets: [], bucketHash: null, contracts: [], previousGross: null,
    params: { standardWorkdays: { id: 's', value: '26' }, deductionMaxNetRatio: { id: 'd', value: '0.3' }, varianceThreshold: null, otMonthMaxMinutes: null, probationMinRatio: null, roundingScale: 0 },
    benefits: [
      { id: 'b1', code: 'NUOI_CON', label: 'Hỗ trợ nuôi con nhỏ', amount: '300000', taxTreatment: 'TAXABLE', exemptLimit: null, batchCode: 'L1', periodCode: '2026-10' },
      { id: 'b2', code: 'KHAM_SK', label: 'Khám sức khỏe', amount: '800000', taxTreatment: 'NON_TAXABLE', exemptLimit: null, batchCode: 'L2', periodCode: '2026-10' },
      { id: 'b3', code: 'AN_CA', label: 'Ăn ca', amount: '900000', taxTreatment: 'EXEMPT_UP_TO_LIMIT', exemptLimit: '730000', batchCode: 'L3', periodCode: '2026-10' },
    ],
  };
  const capture = {};
  const result = await calculateEmployee(ctx, { insurance: async extra => { capture.extra = extra; return { eligible: {}, reasonCode: 'OK', insurableRaw: null, cp07: null, lines: [], trace: {} }; },
    tax: async items => { capture.items = items; return { tax: '0', branch: 'PROGRESSIVE', rulesetId: 'r', rulesetCode: 'R', taxPeriod: '2026-11', exceptions: [], trace: {} }; } });
  assert.deepEqual(result.lines.filter(line => line.lineType === 'BENEFIT').map(line => [line.componentCode, line.amount, line.flags.isInsurable]), [['NUOI_CON', '300000', false], ['KHAM_SK', '800000', false], ['AN_CA', '900000', false]]);
  assert.deepEqual(capture.extra, []);
  const items = capture.items.filter(item => item.sourceRef.startsWith('BENEFIT')).map(item => [item.kind, item.amountPaid]);
  assert.deepEqual(items, [['SALARY', '300000'], ['NON_TAXABLE', '800000'], ['NON_TAXABLE', '730000'], ['SALARY', '170000']]);
});

test('Welfare catalog, draft allocation, duplicate-proof confirmation (UAT-28) and costs on real HTTP', { timeout: 600000 }, async t => {
  await withServer('welfare', async ({ db, request, ok, login }) => {
    const [kt, tt] = await Promise.all(['kt.all', 'tt.bn'].map(name => login(name)));
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const company = await db.orgUnit.findUniqueOrThrow({ where: { code: 'COMPANY' } });
    const site = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const team = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T1' } });
    const ktActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
    const tag = randomUUID().slice(0, 6).toUpperCase();
    async function person(code, hireDate) {
      const employee = await db.employee.create({ data: { code: 'PL-' + tag + '-' + code, fullName: 'Phúc lợi ' + code, gender: 'FEMALE', dob: day('1990-01-01'), hireDate: day(hireDate),
        assignments: { create: { orgUnitId: team.id, effectiveFrom: day(hireDate), allocationRatio: '100', isPrimary: true } } } });
      await db.employmentContract.create({ data: { employeeId: employee.id, number: 'HD-' + code, type: 'INDEFINITE', status: 'ACTIVE', startDate: day(hireDate), signedDate: day(hireDate), salaryCipher: cipherText(key, '9000000'), salaryBasis: 'MONTHLY', insuranceEligible: true } });
      return employee;
    }
    const senior = await person('A', '2026-01-05');
    const junior = await person('B', '2026-08-01');
    const period = await db.payrollPeriod.create({ data: { code: 'PL-PL-' + tag, siteOrgUnitId: site.id, dateFrom: day('2026-10-01'), dateTo: day('2026-10-31') } });
    const version = { name: 'Quà sinh nhật', amount: '500000', taxTreatment: 'TAXABLE', payrollIncluded: true, eligibility: { minServiceMonths: 6 }, decisionReference: 'Quy chế phúc lợi 2026', status: 'SIMULATION', effectiveFrom: '2026-01-01' };
    let catalog;

    await t.test('Catalog: twelve seeded benefits; KT creates a versioned benefit with data-only eligibility', async () => {
      assert.equal((await request('/welfare/catalog', tt)).status, 403);
      const seeded = await ok('/welfare/catalog?asOf=2026-10-15', kt);
      assert.equal(seeded.items.filter(item => item.code.startsWith('MP_')).length, 12);
      assert.equal(new Set(seeded.items.map(item => item.category)).size, 12);
      assert.ok(seeded.items.every(item => item.current?.status === 'SIMULATION'));
      assert.equal((await request('/welfare/catalog', kt, { code: 'BAD_' + tag, orgUnitId: company.id, category: 'GIFT', version: { ...version, eligibility: { formula: 'x' } } })).body.code, 'ELIGIBILITY_INVALID');
      catalog = await ok('/welfare/catalog', kt, { code: 'QUA_SINH_NHAT_' + tag, orgUnitId: company.id, category: 'GIFT', version });
      assert.equal((await request('/welfare/catalog/' + catalog.id + '/versions', kt, { ...version, effectiveFrom: '2025-12-01' })).body.code, 'VERSION_ORDER');
      const next = await ok('/welfare/catalog/' + catalog.id + '/versions', kt, { ...version, amount: '600000', effectiveFrom: '2027-01-01' });
      assert.equal(next.version.amount, '600000');
      const [first] = await db.benefitCatalogVersion.findMany({ where: { catalogId: catalog.id }, orderBy: { effectiveFrom: 'asc' } });
      assert.equal(first.effectiveTo.toISOString().slice(0, 10), '2026-12-31', 'predecessor closed the day before');
      await assert.rejects(() => db.benefitCatalogVersion.update({ where: { id: first.id }, data: { amount: '1' } }), /BENEFIT_VERSION_IMMUTABLE/);
    });

    let batch;
    const create = (extra = {}) => ok('/welfare/allocations', kt, { catalogId: catalog.id, periodCode: '2026-10', referenceDate: '2026-10-15', scopeOrgUnitId: team.id, payrollPeriodId: period.id, ...extra });
    await t.test('Provisional list filters by eligibility and does not touch payroll or costs', async () => {
      assert.equal((await request('/welfare/allocations', kt, { catalogId: catalog.id, periodCode: '2026-10', referenceDate: '2026-10-15', scopeOrgUnitId: team.id })).body.code, 'PAYROLL_PERIOD_REQUIRED');
      batch = await create();
      const ids = batch.candidates.map(row => row.employee.id);
      assert.ok(ids.includes(senior.id));
      assert.ok(!ids.includes(junior.id), 'two months of service is below six');
      assert.equal(await db.benefitAllocation.count(), 0);
      assert.deepEqual((await ok('/welfare/costs?from=2026-10&to=2026-10', kt)).items, []);
    });

    await t.test('Manual add of an ineligible employee needs a reason; edits re-check and bump the revision', async () => {
      const refused = await request('/welfare/allocations/' + batch.batch.id + '/candidates', kt, { revision: batch.batch.revision, employeeId: junior.id });
      assert.deepEqual([refused.status, refused.body.code, refused.body.details.failed[0].rule], [400, 'BENEFIT_NOT_ELIGIBLE', 'minServiceMonths']);
      batch = await ok('/welfare/allocations/' + batch.batch.id + '/candidates', kt, { revision: batch.batch.revision, employeeId: junior.id, reason: 'Quyết định giám đốc cho nhân viên mới' });
      const manual = batch.candidates.find(row => row.employee.id === junior.id);
      assert.deepEqual([manual.eligible, manual.manual, manual.manualReason], [false, true, 'Quyết định giám đốc cho nhân viên mới']);
      assert.equal((await request('/welfare/allocations/' + batch.batch.id + '/confirm', kt, { revision: 1 })).body.code, 'STALE_REVISION');
      const others = batch.candidates.filter(row => ![senior.id, junior.id].includes(row.employee.id));
      for (const row of others) batch = await ok('/welfare/allocations/' + batch.batch.id + '/candidates/remove', kt, { revision: batch.batch.revision, employeeId: row.employee.id });
      assert.deepEqual(batch.candidates.map(row => row.employee.id).sort(), [senior.id, junior.id].sort());
    });

    await t.test('Confirmation records each person once, bound to the payroll period; the batch is final', async () => {
      const done = await ok('/welfare/allocations/' + batch.batch.id + '/confirm', kt, { revision: batch.batch.revision });
      assert.equal(done.batch.status, 'CONFIRMED');
      assert.deepEqual([done.confirmation.recorded, done.confirmation.duplicates], [2, []]);
      const rows = await db.benefitAllocation.findMany({ where: { batchId: batch.batch.id } });
      assert.ok(rows.every(row => row.payrollPeriodId === period.id && row.taxTreatment === 'TAXABLE'));
      assert.equal(rows.find(row => row.employeeId === junior.id).manualReason, 'Quyết định giám đốc cho nhân viên mới');
      assert.equal((await request('/welfare/allocations/' + batch.batch.id + '/candidates', kt, { revision: done.batch.revision, employeeId: senior.id })).body.code, 'BENEFIT_BATCH_FINAL');
      await assert.rejects(() => db.benefitAllocation.updateMany({ where: { batchId: batch.batch.id }, data: { periodCode: 'X' } }), /BENEFIT_ALLOCATION_IMMUTABLE/);
    });

    await t.test('UAT-28: a second batch of the same benefit and period reports duplicates and records nothing twice', async () => {
      const second = await create({ note: 'Lô bổ sung' });
      assert.ok(second.candidates.some(row => row.employee.id === senior.id));
      const done = await ok('/welfare/allocations/' + second.batch.id + '/confirm', kt, { revision: second.batch.revision });
      assert.ok(done.confirmation.duplicates.some(row => row.employeeId === senior.id && row.existingBatch === batch.batch.code));
      assert.equal(await db.benefitAllocation.count({ where: { catalogId: catalog.id, employeeId: senior.id, periodCode: '2026-10' } }), 1);
      const other = await create({ periodCode: '2026-11', payrollPeriodId: period.id });
      const cancelled = await ok('/welfare/allocations/' + other.batch.id + '/cancel', kt, { revision: other.batch.revision, reason: 'Lập nhầm kỳ' });
      assert.deepEqual([cancelled.batch.status, cancelled.candidates.length, cancelled.allocations.length], ['CANCELLED', 0, 0]);
    });

    await t.test('Costs by month, cost center and category include confirmed severance; export is audited', async () => {
      const leaver = await person('C', '2026-01-05');
      const decision = await db.terminationDecision.create({ data: { employeeId: leaver.id, decisionNumber: 'QD-' + tag, effectiveDate: day('2026-10-20'), reason: 'RESIGNATION', allowanceKind: 'SEVERANCE', legalBasis: 'BLLĐ', previewCipher: cipherText(key, '{}'), previewHash: 'a'.repeat(64), status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: ktActor.id, createdById: ktActor.id } });
      await db.severanceAllowance.create({ data: { decisionId: decision.id, employeeId: leaver.id, allowanceKind: 'SEVERANCE', serviceMonths: 9, detailCipher: cipherText(key, '{}'), amountCipher: cipherText(key, '4500000') } });
      const report = await ok('/welfare/costs?from=2026-10&to=2026-10', kt);
      const gift = report.items.find(row => row.category === 'GIFT');
      assert.ok(gift.count >= 2 && Number(gift.amount) === gift.count * 500000, JSON.stringify(report.items));
      const severance = report.items.find(row => row.category === 'SEVERANCE');
      assert.deepEqual([severance.count, severance.amount, severance.categoryLabel], [1, '4500000', 'Trợ cấp thôi việc']);
      assert.equal(report.total, String(Number(gift.amount) + 4500000));
      const file = await request('/welfare/costs/export?from=2026-10&to=2026-10', kt);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(file.body);
      assert.equal(book.worksheets[0].getRow(2).getCell(5).value, 'Số tiền');
      assert.ok(await db.auditLog.findFirst({ where: { entityType: 'welfare_costs', action: 'EXPORT' } }));
    });
  });
});
