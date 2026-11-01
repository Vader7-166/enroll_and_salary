const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { withServer, day, today, addDays } = require('./http-harness.cjs');
const { cipherText } = require('../dist/common/data-crypto.js');
const { allowance, serviceYears, unusedLeavePay, workedMonths, averageSalary } = require('../dist/personnel/termination-rules.js');
const { calculateEmployee } = require('../dist/payroll/payroll-engine.js');

test('Severance math: worked months, half-year remainder, BHTN deduction, job-loss floor, unused leave', () => {
  assert.equal(workedMonths('2020-10-01', '2026-09-30'), 72);
  assert.equal(workedMonths('2026-02-01', '2026-09-30'), 8);
  assert.deepEqual([0, 3, 6, 15, 18].map(months => serviceYears(months, 1, 6).toString()), ['0', '0.5', '1', '1.5', '2']);
  const severance = allowance({ kind: 'SEVERANCE', workedMonths: 72, unemploymentMonths: 48, previouslyPaidMonths: 0, averageSalary: '10000000', monthsPerYear: '0.5', minimumMonths: null, halfFrom: 1, fullFrom: 6 });
  assert.deepEqual([severance.countedMonths, severance.years, severance.amount], [24, '2', '10000000'], '6 years worked, 4 years of BHTN → 2 years');
  const jobLoss = allowance({ kind: 'JOB_LOSS', workedMonths: 8, unemploymentMonths: 0, previouslyPaidMonths: 0, averageSalary: '8000000', monthsPerYear: '1', minimumMonths: '2', halfFrom: 1, fullFrom: 6 });
  assert.deepEqual([jobLoss.computed, jobLoss.minimumApplied, jobLoss.amount], ['8000000', true, '16000000']);
  assert.equal(allowance({ kind: 'SEVERANCE', workedMonths: 30, unemploymentMonths: 0, previouslyPaidMonths: 30, averageSalary: '9000000', monthsPerYear: '0.5', minimumMonths: null, halfFrom: 1, fullFrom: 6 }).amount, '0', 'time already compensated is not paid twice');
  assert.equal(averageSalary(['9000000', '10000000', '11000000']), '10000000');
  assert.deepEqual(unusedLeavePay('3', '7800000', '26'), { days: '3', dailyRate: '300000', amount: '900000' });
});

test('Engine stage: termination lines are non-insurable earnings; severance non-taxable, unused leave is UNUSED_LEAVE', async () => {
  const ctx = {
    employee: { id: 'e1', code: 'NV1', fullName: 'NV 1', hireDate: '2026-01-01', terminationDate: '2026-10-20' },
    period: { id: 'p', code: 'PL-10', dateFrom: '2026-10-01', dateTo: '2026-10-31', paymentDate: '2026-11-05', month: '2026-10' },
    planVersions: [{ id: 'pl', payMode: 'MONTHLY', status: 'SIMULATION', effectiveFrom: '2026-01-01', effectiveTo: null, lines: [{ componentId: 'T', role: 'BASE', sourceType: 'TIME', allocation: 'INDIVIDUAL' }] }],
    components: { T: { isInsurable: true, taxClassification: 'TAXABLE', isOtBase: true, isProrated: true, componentType: 'EARNING', code: 'LUONG_TG', name: 'Lương thời gian' } },
    inputs: [], salary: [{ componentId: null, componentCode: null, componentName: 'Lương', from: '2026-10-01', to: '2026-10-20', amount: '10000000', salaryBasis: 'MONTHLY', source: 'CONTRACT', sourceId: 'hd', reference: 'HD' }],
    units: [{ orgUnitId: 'u', orgUnitCode: 'U', orgUnitName: 'U', siteId: 's', wageRegionCode: 'I', costCenterCode: 'CC', from: '2026-10-01', to: '2026-10-20', days: 20, minimumMonth: { id: 'm', value: '4960000' }, minimumHour: null }],
    attendance: { available: true, days: Array.from({ length: 16 }, (_, index) => ({ workDate: '2026-10-' + String(index + 1).padStart(2, '0'), workUnits: '1', workedMinutes: 480, status: 'OK', correctionId: null })), regularMinutes: String(16 * 480), lockHashes: ['h'] },
    buckets: [], bucketHash: null, contracts: [], previousGross: null,
    params: { standardWorkdays: { id: 's', value: '26' }, deductionMaxNetRatio: { id: 'd', value: '0.3' }, varianceThreshold: null, otMonthMaxMinutes: null, probationMinRatio: null, roundingScale: 0 },
  };
  const capture = {};
  const hooks = { insurance: async extra => { capture.extra = extra; return { eligible: {}, reasonCode: 'OK', insurableRaw: null, cp07: null, lines: [], trace: {} }; },
    tax: async items => { capture.items = items; return { tax: '0', branch: 'PROGRESSIVE', rulesetId: 'r', rulesetCode: 'R', taxPeriod: '2026-11', exceptions: [], trace: {} }; } };
  const plain = await calculateEmployee(ctx, hooks);
  const result = await calculateEmployee({ ...ctx, terminations: [
    { id: 't1', kind: 'SEVERANCE', label: 'Trợ cấp thôi việc', amount: '10000000', decisionNumber: 'QD-1', trace: {} },
    { id: 't2', kind: 'UNUSED_LEAVE_PAY', label: 'Tiền phép năm chưa nghỉ', amount: '1153846', decisionNumber: 'QD-1', trace: {} }] }, hooks);
  const lines = result.lines.filter(line => line.lineType === 'TERMINATION');
  assert.deepEqual(lines.map(line => [line.componentCode, line.amount, line.flags.isInsurable]), [['SEVERANCE', '10000000', false], ['UNUSED_LEAVE_PAY', '1153846', false]]);
  assert.deepEqual(capture.extra, [], 'never part of the insurable salary');
  const kinds = capture.items.filter(item => item.sourceRef.startsWith('TERMINATION')).map(item => [item.kind, item.amountPaid, item.evidenceRef]);
  assert.deepEqual(kinds, [['NON_TAXABLE', '10000000', undefined], ['UNUSED_LEAVE', '1153846', 'Quyết định chấm dứt QD-1']]);
  assert.equal(Number(result.totals.gross) - Number(plain.totals.gross), 11153846);
  assert.notEqual(result.sourceHash, plain.sourceHash);
});

test('Contract alerts and termination (UAT-27) on real HTTP', { timeout: 600000 }, async t => {
  await withServer('termination', async ({ db, request, ok, login, password }) => {
    const [kt, tt] = await Promise.all(['kt.all', 'tt.bn'].map(name => login(name)));
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const team = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T1' } });
    const site = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const ktActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
    const tag = randomUUID().slice(0, 6).toUpperCase();
    async function person(code, hireDate, contracts) {
      const employee = await db.employee.create({ data: { code: 'CD-' + tag + '-' + code, fullName: 'Chấm dứt ' + code, gender: 'OTHER', dob: day('1985-01-01'), hireDate: day(hireDate),
        assignments: { create: { orgUnitId: team.id, effectiveFrom: day(hireDate < '2026-01-01' ? '2026-01-01' : hireDate), allocationRatio: '100', isPrimary: true } } } });
      for (const [index, [type, start, end, salary]] of contracts.entries())
        await db.employmentContract.create({ data: { employeeId: employee.id, number: 'HD-' + code + '-' + index, type, status: 'ACTIVE', startDate: day(start), endDate: end ? day(end) : null, signedDate: day(start), salaryCipher: cipherText(key, salary ?? '10000000'), salaryBasis: 'MONTHLY', insuranceEligible: type !== 'PROBATION' } });
      return employee;
    }
    async function leave(employee, days) {
      const operation = await db.leaveOperation.create({ data: { requestId: randomUUID(), requestHash: 'a'.repeat(64), kind: 'RECALCULATE', effectiveDate: day('2026-01-01'), reason: 'Quỹ phép', reference: 'TEST', snapshot: {}, actorId: ktActor.id } });
      const balance = await db.leaveBalance.upsert({ where: { employeeId_year: { employeeId: employee.id, year: 2026 } }, update: {}, create: { employeeId: employee.id, year: 2026 } });
      await db.leaveLedgerEntry.create({ data: { balanceId: balance.id, operationId: operation.id, kind: 'ENTITLEMENT', bucket: 'ANNUAL', days } });
    }
    const reauth = async () => (await ok('/auth/reauthenticate', kt, { password: password('kt.all') })).token;
    const period = await db.payrollPeriod.create({ data: { code: 'PL-CD-' + tag, siteOrgUnitId: site.id, dateFrom: day('2026-09-01'), dateTo: day('2026-09-30') } });
    const now = today();

    await t.test('Alerts: expiring in 25 days, probation ending, overdue untouched, two fixed-term contracts, 60-day window', async () => {
      const expiring = await person('EXP', '2026-01-05', [['FIXED_TERM', '2026-01-05', addDays(now, 25)]]);
      const probation = await person('PRB', '2026-01-05', [['PROBATION', addDays(now, -20), addDays(now, 10)]]);
      const overdue = await person('OVD', '2026-01-05', [['FIXED_TERM', '2026-01-05', addDays(now, -3)]]);
      const twice = await person('TWO', '2026-01-05', [['FIXED_TERM', '2026-01-05', addDays(now, -100)], ['FIXED_TERM', addDays(now, -99), addDays(now, 300)]]);
      const later = await person('LTR', '2026-01-05', [['FIXED_TERM', '2026-01-05', addDays(now, 45)]]);
      assert.equal((await request('/personnel/contract-alerts', tt)).status, 403);
      const alerts = await ok('/personnel/contract-alerts', kt);
      assert.equal(alerts.days, 30);
      const of = employee => alerts.items.filter(item => item.employee.id === employee.id).map(item => [item.kind, item.daysLeft]);
      assert.deepEqual(of(expiring), [['EXPIRING', 25]]);
      assert.deepEqual(of(probation), [['PROBATION_ENDING', 10]]);
      assert.deepEqual(of(overdue), [['OVERDUE', -3]]);
      assert.deepEqual(of(twice), [['FIXED_TERM_LIMIT', 300]]);
      assert.deepEqual(of(later), []);
      assert.deepEqual((await ok('/personnel/contract-alerts?days=60', kt)).items.filter(item => item.employee.id === later.id).map(item => item.kind), ['EXPIRING']);
      assert.equal((await request('/personnel/contract-alerts?days=45', kt)).status, 400);
      const contract = await db.employmentContract.findFirstOrThrow({ where: { employeeId: overdue.id } });
      assert.deepEqual([contract.status, contract.terminatedOn], ['ACTIVE', null], 'an overdue contract is never terminated automatically');
      assert.equal((await db.employee.findUniqueOrThrow({ where: { id: overdue.id } })).status, 'ACTIVE');
    });

    let resign;
    const input = (employee, extra = {}) => ({ employeeId: employee.id, decisionNumber: 'QD-CD-' + employee.code, effectiveDate: '2026-09-30', reason: 'RESIGNATION', legalBasis: 'BLLĐ 2019 Điều 35, 46', ...extra });
    await t.test('UAT-27 draft: preview with allowance, unused leave and insurance decrease; nothing else changes', async () => {
      resign = await person('RES', '2020-10-01', [['INDEFINITE', '2020-10-01', null, '10000000']]);
      await leave(resign, '3');
      assert.equal((await request('/personnel/terminations', kt, input(resign, { externalUnemploymentMonths: 48 }))).body.code, 'EVIDENCE_REQUIRED', 'external BHTN months need evidence');
      const { decision } = await ok('/personnel/terminations', kt, input(resign, { externalUnemploymentMonths: 48, externalUnemploymentEvidence: 'Sổ BHXH xác nhận 48 tháng BHTN' }));
      const preview = decision.preview;
      assert.deepEqual([preview.service.workedMonths, preview.service.unemploymentMonthsExternal, preview.allowance.countedMonths, preview.allowance.years, preview.allowance.amount], [72, 48, 24, '2', '10000000']);
      assert.deepEqual([preview.unusedLeave.days, preview.unusedLeave.amount], ['3', '1153846'], '3 days × 10.000.000 / 26');
      assert.deepEqual([preview.insuranceDecrease?.type, preview.insuranceDecrease?.reason, preview.insuranceDecrease?.effectiveDate], ['DECREASE', 'TERMINATION', '2026-09-30']);
      assert.equal(preview.payrollPeriod.id, period.id);
      const contract = await db.employmentContract.findFirstOrThrow({ where: { employeeId: resign.id } });
      const employee = await db.employee.findUniqueOrThrow({ where: { id: resign.id } });
      assert.deepEqual([contract.terminatedOn, employee.terminationDate, employee.status], [null, null, 'ACTIVE']);
      assert.equal(await db.terminationPaymentItem.count({ where: { employeeId: resign.id } }) + await db.severanceAllowance.count({ where: { employeeId: resign.id } }), 0);
      resign.decision = decision;
      assert.equal((await request('/personnel/terminations', kt, input(resign, { decisionNumber: 'QD-2' }))).body.code, 'TERMINATION_EXISTS');
    });

    await t.test('UAT-27 confirm: re-authenticated, once only under concurrency, items in the nearest open payroll period', async () => {
      const decision = resign.decision;
      const path = '/personnel/terminations/' + decision.id + '/confirm';
      assert.equal((await request(path, kt, { revision: decision.revision, previewHash: decision.previewHash, reauthToken: '1.x' })).body.code, 'REAUTH_REQUIRED');
      assert.equal((await request(path, kt, { revision: decision.revision, previewHash: 'f'.repeat(64), reauthToken: await reauth() })).body.code, 'STALE_PREVIEW');
      const token = await reauth();
      const results = await Promise.all([1, 2].map(() => request(path, kt, { revision: decision.revision, previewHash: decision.previewHash, reauthToken: token })));
      assert.deepEqual(results.map(result => result.status).sort(), [201, 409], JSON.stringify(results.map(result => result.body)));
      const done = results.find(result => result.status === 201).body;
      assert.equal(done.decision.status, 'CONFIRMED');
      assert.deepEqual(done.items.map(item => [item.kind, item.amount]), [['SEVERANCE', '10000000'], ['UNUSED_LEAVE_PAY', '1153846']]);
      assert.equal((await request(path, kt, { revision: done.decision.revision, previewHash: decision.previewHash, reauthToken: await reauth() })).body.code, 'TERMINATION_NOT_DRAFT');
      assert.equal(await db.severanceAllowance.count({ where: { employeeId: resign.id } }), 1);
      const items = await db.terminationPaymentItem.findMany({ where: { employeeId: resign.id } });
      assert.deepEqual(items.map(item => [item.kind, item.payrollPeriodId]).sort(), [['SEVERANCE', period.id], ['UNUSED_LEAVE_PAY', period.id]]);
      const contract = await db.employmentContract.findFirstOrThrow({ where: { employeeId: resign.id } });
      const employee = await db.employee.findUniqueOrThrow({ where: { id: resign.id } });
      assert.deepEqual([contract.terminatedOn?.toISOString().slice(0, 10), contract.terminationDecisionId, employee.terminationDate?.toISOString().slice(0, 10), employee.status], ['2026-09-30', decision.id, '2026-09-30', 'TERMINATED']);
      await assert.rejects(() => db.terminationPaymentItem.updateMany({ where: { employeeId: resign.id }, data: { label: 'x' } }), /TERMINATION_IMMUTABLE/);
      await assert.rejects(() => db.terminationDecision.update({ where: { id: decision.id }, data: { note: 'x' } }), /TERMINATION_DECISION_FINAL/);
      assert.ok(await db.auditLog.findFirst({ where: { entityType: 'termination_decision', entityId: decision.id, action: 'CONFIRM', scopeOrgUnitId: team.id } }));
    });

    await t.test('Source change after preview blocks confirmation until refreshed; job loss uses the minimum', async () => {
      const lost = await person('JOB', '2026-02-01', [['INDEFINITE', '2026-02-01', null, '8000000']]);
      const { decision } = await ok('/personnel/terminations', kt, input(lost, { reason: 'JOB_LOSS', legalBasis: 'BLLĐ 2019 Điều 42, 47' }));
      assert.deepEqual([decision.preview.allowance.kind, decision.preview.allowance.computed, decision.preview.allowance.minimumApplied, decision.preview.allowance.amount], ['JOB_LOSS', '8000000', true, '16000000']);
      await leave(lost, '2');
      const changed = await request('/personnel/terminations/' + decision.id + '/confirm', kt, { revision: decision.revision, previewHash: decision.previewHash, reauthToken: await reauth() });
      assert.deepEqual([changed.status, changed.body.code], [409, 'PREVIEW_CHANGED']);
      assert.equal(await db.terminationPaymentItem.count({ where: { employeeId: lost.id } }), 0, 'refused confirmation writes nothing');
      const refreshed = (await ok('/personnel/terminations/' + decision.id + '/refresh', kt, { revision: decision.revision })).decision;
      assert.equal(refreshed.preview.unusedLeave.days, '2');
      const done = await ok('/personnel/terminations/' + refreshed.id + '/confirm', kt, { revision: refreshed.revision, previewHash: refreshed.previewHash, reauthToken: await reauth() });
      assert.deepEqual(done.items.map(item => item.kind), ['JOB_LOSS', 'UNUSED_LEAVE_PAY']);
    });

    await t.test('Cancelling a draft leaves no business data; a new draft can follow', async () => {
      const other = await person('CAN', '2026-01-05', [['INDEFINITE', '2026-01-05', null, '9000000']]);
      const { decision } = await ok('/personnel/terminations', kt, input(other, { reason: 'OTHER' }));
      assert.equal(decision.preview.allowance, null, 'reason OTHER carries no allowance');
      const cancelled = (await ok('/personnel/terminations/' + decision.id + '/cancel', kt, { revision: decision.revision, reason: 'Người lao động ở lại' })).decision;
      assert.equal(cancelled.status, 'CANCELLED');
      const contract = await db.employmentContract.findFirstOrThrow({ where: { employeeId: other.id } });
      assert.deepEqual([contract.terminatedOn, (await db.employee.findUniqueOrThrow({ where: { id: other.id } })).status], [null, 'ACTIVE']);
      assert.equal(await db.terminationPaymentItem.count({ where: { employeeId: other.id } }), 0);
      assert.equal((await request('/personnel/terminations/' + decision.id + '/confirm', kt, { revision: cancelled.revision, previewHash: decision.previewHash, reauthToken: await reauth() })).body.code, 'TERMINATION_NOT_DRAFT');
      await ok('/personnel/terminations', kt, input(other, { decisionNumber: 'QD-NEW-' + tag }));
      const listed = await ok('/personnel/terminations', kt);
      assert.ok(listed.items.some(row => row.employee.id === other.id && row.status === 'DRAFT'));
    });
  });
});
