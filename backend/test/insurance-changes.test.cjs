const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { withServer, day } = require('./http-harness.cjs');
const { cipherText, blindIndex } = require('../dist/common/data-crypto.js');
const { detectChange, arrearsFor } = require('../dist/social-insurance/changes/change-rules.js');

const state = (month, extra = {}) => ({ month, present: true, eligible: { BHXH: true, BHYT: true, BHTN: true }, reasonCode: 'ELIGIBLE', base: { BHXH: '7000000', BHYT: '7000000', BHTN: '7000000' },
  contribution: { BHXH: { employee: '560000', employer: '1225000' }, BHYT: { employee: '105000', employer: '210000' }, BHTN: { employee: '70000', employer: '70000' } },
  hireDate: '2026-01-01', terminationDate: null, maternity: false, sources: {}, ...extra });
const off = (month, reasonCode, extra = {}) => state(month, { eligible: { BHXH: false, BHYT: false, BHTN: false }, reasonCode, base: null, contribution: null, ...extra });

test('Month-over-month rules: termination once, hire, maternity, salary change, arrears', () => {
  const termination = detectChange(state('2026-08'), state('2026-09', { terminationDate: '2026-09-20' }));
  assert.deepEqual([termination.type, termination.reason, termination.effectiveDate], ['DECREASE', 'TERMINATION', '2026-09-20']);
  assert.equal(detectChange(state('2026-09', { terminationDate: '2026-09-20' }), off('2026-10', 'TERMINATION', { terminationDate: '2026-09-20' })), null, 'never reported twice');
  const hire = detectChange(off('2026-08', 'NOT_EMPLOYED', { present: false, hireDate: '2026-09-10' }), state('2026-09', { hireDate: '2026-09-10' }));
  assert.deepEqual([hire.type, hire.reason, hire.effectiveDate], ['INCREASE', 'NEW_HIRE', '2026-09-10']);
  assert.equal(detectChange(state('2026-09'), off('2026-10', 'UNPAID_LEAVE_14_DAYS', { maternity: true })).reason, 'MATERNITY');
  assert.equal(detectChange(off('2026-10', 'UNPAID_LEAVE_14_DAYS', { maternity: true }), state('2026-11')).reason, 'RETURN_TO_WORK');
  const raise = detectChange(state('2026-09'), state('2026-10', { base: { BHXH: '8000000', BHYT: '8000000', BHTN: '8000000' } }));
  assert.deepEqual([raise.type, raise.reason, raise.old.base.BHXH, raise.new.base.BHXH], ['ADJUST', 'SALARY_CHANGE', '7000000', '8000000']);
  assert.equal(detectChange(state('2026-09'), state('2026-10')), null);
  const owed = arrearsFor(off('2026-08', 'NO_CONTRACT'), state('2026-08'));
  assert.deepEqual([owed.direction, owed.total, owed.perKind.BHXH.employer], ['ARREARS', '2240000', '1225000']);
  assert.equal(arrearsFor(state('2026-08'), off('2026-08', 'NO_CONTRACT')).direction, 'REFUND');
  assert.equal(arrearsFor(state('2026-08'), state('2026-08')), null);
});

test('Insurance change lists, finalization, late changes with arrears, export and C12 on real HTTP', { timeout: 900000 }, async t => {
  await withServer('insurance_changes', async ({ db, request, ok, login }) => {
    const [kt, ktBn, tt] = await Promise.all(['kt.all', 'kt.bn', 'tt.bn'].map(name => login(name)));
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const site = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const team = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T1' } });
    const ktActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const siBooks = {};
    async function person(code, hireDate, salary, contract = true) {
      const employee = await db.employee.create({ data: { code: 'BH-' + tag + '-' + code, fullName: 'Biến động ' + code, gender: 'OTHER', dob: day('1990-01-01'), hireDate: day(hireDate),
        assignments: { create: { orgUnitId: team.id, effectiveFrom: day(hireDate), allocationRatio: '100', isPrimary: true } } } });
      if (contract) await addContract(employee.id, code, hireDate, salary);
      const siBook = String(1000000000 + Object.keys(siBooks).length + 1);
      siBooks[code] = siBook;
      await db.employeeIdentity.create({ data: { employeeId: employee.id, documentType: 'CCCD', idNumberCipher: cipherText(key, '0010900000' + code.padStart(2, '0')), idNumberHash: blindIndex(key, 'ID_NUMBER', tag + code),
        siBookCipher: cipherText(key, siBook), siBookHash: blindIndex(key, 'SI_BOOK', siBook), dataStatus: 'SIMULATION' } });
      return employee;
    }
    function addContract(employeeId, code, startDate, salary) {
      return db.employmentContract.create({ data: { employeeId, number: 'HD-' + code, type: 'INDEFINITE', status: 'ACTIVE', startDate: day(startDate), signedDate: day(startDate), salaryCipher: cipherText(key, salary), salaryBasis: 'MONTHLY', insuranceEligible: true } });
    }
    const A = await person('A', '2026-01-05', '7000000');
    const B = await person('B', '2026-01-05', '7000000');
    const C = await person('C', '2026-09-10', '6000000');
    const D = await person('D', '2026-08-01', '6500000', false);
    const generate = month => ok('/social-insurance/change-lists/generate', kt, { siteOrgUnitId: site.id, month });
    const finalize = list => ok('/social-insurance/change-lists/' + list.id + '/finalize', kt, { revision: list.revision, contentHash: list.contentHash });
    const mine = (result, employee) => result.items.filter(item => item.employee.id === employee.id);

    await t.test('Only KT in scope; August and September generated from month-over-month state and finalized', async () => {
      assert.equal((await request('/social-insurance/change-lists/generate', tt, { siteOrgUnitId: site.id, month: '2026-08' })).status, 403);
      const hna = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-HNA' } });
      assert.equal((await request('/social-insurance/change-lists/generate', ktBn, { siteOrgUnitId: hna.id, month: '2026-08' })).status, 403);
      const august = await generate('2026-08');
      assert.equal(august.list.status, 'DRAFT');
      assert.deepEqual([mine(august, A), mine(august, D)].map(rows => rows.length), [0, 0], 'A unchanged since July; D has no contract yet');
      await finalize(august.list);
      const september = await generate('2026-09');
      const hire = mine(september, C);
      assert.deepEqual(hire.map(item => [item.changeType, item.reasonCode, item.effectiveDate, item.late]), [['INCREASE', 'NEW_HIRE', '2026-09-10', false]]);
      assert.equal(hire[0].new.base.BHXH, '6000000');
      const closed = await finalize(september.list);
      assert.equal(closed.list.status, 'FINALIZED');
      assert.equal((await request('/social-insurance/change-lists/generate', kt, { siteOrgUnitId: site.id, month: '2026-09' })).body.code, 'INSURANCE_LIST_FINALIZED');
      await assert.rejects(() => db.insuranceChangeItem.updateMany({ where: { listId: closed.list.id }, data: { reasonCode: 'X' } }), /INSURANCE_LIST_FINALIZED/);
      await assert.rejects(() => db.insuranceChangeState.deleteMany({ where: { listId: closed.list.id } }), /INSURANCE_LIST_FINALIZED/);
    });

    let october;
    await t.test('Changes entered after finalization go to the open month as late items with arrears per origin month', async () => {
      await db.employee.update({ where: { id: A.id }, data: { terminationDate: day('2026-09-20') } });
      await addContract(D.id, 'D', '2026-08-01', '6500000');
      await ok('/employees/' + B.id + '/salary-decisions', kt, { decisionNumber: 'QD-' + tag, decisionDate: '2026-09-25', effectiveFrom: '2026-10-01', reason: 'Tăng lương', legalBasis: 'Quy chế lương', lines: [{ amount: '8000000', salaryBasis: 'MONTHLY' }] });
      october = await generate('2026-10');
      const [termination] = mine(october, A);
      assert.deepEqual([termination.changeType, termination.reasonCode, termination.effectiveDate, termination.late, termination.originMonth], ['DECREASE', 'TERMINATION', '2026-09-20', true, '2026-09']);
      assert.equal(termination.arrearsMonths, 0, 'September was still a contribution month');
      const [lateHire] = mine(october, D);
      assert.deepEqual([lateHire.changeType, lateHire.late, lateHire.originMonth, lateHire.effectiveDate], ['INCREASE', true, '2026-08', '2026-08-01']);
      assert.deepEqual(lateHire.arrears.map(row => [row.originMonth, row.direction]), [['2026-08', 'ARREARS'], ['2026-09', 'ARREARS']], 'arrears for August and September');
      const bhxh = lateHire.arrears[0].perKind.BHXH;
      assert.deepEqual([bhxh.employee, bhxh.employer], ['520000', '1137500'], '8% / 17.5% of 6.500.000 at August rates');
      const [raise] = mine(october, B);
      assert.deepEqual([raise.changeType, raise.reasonCode, raise.old.base.BHXH, raise.new.base.BHXH, raise.late], ['ADJUST', 'SALARY_CHANGE', '7000000', '8000000', false]);
      assert.equal(mine(october, C).length, 0);
    });

    await t.test('Finalize requires the reviewed content hash; export is configured and audited', async () => {
      assert.equal((await request('/social-insurance/change-lists/' + october.list.id + '/finalize', kt, { revision: october.list.revision, contentHash: '0'.repeat(64) })).status, 409);
      await ok('/employees/' + C.id + '/salary-decisions', kt, { decisionNumber: 'QD-C-' + tag, decisionDate: '2026-09-28', effectiveFrom: '2026-10-01', reason: 'Điều chỉnh', legalBasis: 'Quy chế lương', lines: [{ amount: '6200000', salaryBasis: 'MONTHLY' }] });
      const stale = await request('/social-insurance/change-lists/' + october.list.id + '/finalize', kt, { revision: october.list.revision, contentHash: october.list.contentHash });
      assert.deepEqual([stale.status, stale.body.code], [409, 'INSURANCE_SOURCE_CHANGED'], 'a source change after review is caught');
      october = await generate('2026-10');
      assert.deepEqual(mine(october, C).map(item => [item.changeType, item.new.base.BHXH]), [['ADJUST', '6200000']]);
      const file = await request('/social-insurance/change-lists/' + october.list.id + '/export', kt);
      assert.equal(file.status, 200);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(file.body);
      const sheet = book.worksheets[0];
      assert.equal(sheet.getRow(1).getCell(1).value, 'Mã NV');
      const rows = []; sheet.eachRow((row, number) => { if (number > 1) rows.push(row.values.slice(1)); });
      assert.equal(rows.length, october.items.length);
      assert.ok(rows.some(row => row[2] === siBooks.D && row[3] === 'Báo tăng' && row[8] === 'Có' && row[9] === '2026-08'), JSON.stringify(rows));
      assert.ok(await db.auditLog.findFirst({ where: { entityType: 'insurance_change_list', entityId: october.list.id, action: 'EXPORT', scopeOrgUnitId: site.id } }));
      const done = await finalize(october.list);
      assert.equal(done.list.status, 'FINALIZED');
    });

    await t.test('C12 reconciliation against locked payroll: amount and base differences, missing on either side, no auto-match', async () => {
      const period = await db.payrollPeriod.create({ data: { code: 'PL-BH-' + tag, siteOrgUnitId: site.id, dateFrom: day('2026-10-01'), dateTo: day('2026-10-31') } });
      const run = await db.payrollRun.create({ data: { payrollPeriodId: period.id, siteOrgUnitId: site.id, status: 'COMPLETED', startedById: ktActor.id } });
      const sheet = await db.payrollSheet.create({ data: { payrollPeriodId: period.id, lastRunId: run.id } });
      const contribution = (base, rate) => ({ salary: { perKind: { BHXH: { value: String(base) } } }, contribution: { lines: [
        { kind: 'BHXH', employee: String(base * 0.08), employer: String(base * 0.175) }, { kind: 'BHYT', employee: String(base * 0.015), employer: String(base * 0.03) },
        { kind: 'BHTN', employee: String(base * 0.01), employer: String(base * 0.01) }, { kind: 'KPCD', employee: '0', employer: String(base * 0.02) }] }, rate });
      const totals = {};
      for (const [employee, base] of [[B, 8000000], [C, 6000000], [D, 6500000]]) {
        const row = await db.payrollEmployee.create({ data: { sheetId: sheet.id, runId: run.id, employeeId: employee.id, status: 'OK', sourceHash: 'a'.repeat(64), totalsCipher: cipherText(key, '{}'), netPayCipher: cipherText(key, '0'), detailCipher: cipherText(key, '{}') } });
        await db.insuranceContribution.create({ data: { payrollPeriodId: period.id, payrollEmployeeId: row.id, employeeId: employee.id, contributionMonth: '2026-10', eligible: { BHXH: true, BHYT: true, BHTN: true }, detailCipher: cipherText(key, JSON.stringify(contribution(base))) } });
        totals[employee.id] = base * 0.32;
      }
      const csv = (rows) => new Blob([['Mã số BHXH,Họ và tên,Mức lương đóng,Số phải đóng', ...rows].join('\n')], { type: 'text/csv' });
      const upload = (rows) => { const form = new FormData(); form.set('siteOrgUnitId', site.id); form.set('month', '2026-10'); form.set('file', csv(rows), 'c12.csv'); return request('/social-insurance/c12-imports', kt, form); };
      const draft = await upload([siBooks.B + ',Biến động B,8000000,' + totals[B.id]]);
      assert.equal(draft.body.import.summary.systemEmployees, 0, 'only LOCKED sheets count');
      await db.payrollSheet.update({ where: { id: sheet.id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: ktActor.id } });
      await db.payrollSnapshot.create({ data: { sheetId: sheet.id, contentCipher: cipherText(key, '{}'), contentHash: 'b'.repeat(64), sourceHash: 'a'.repeat(64), compliance: [], parameters: {}, complianceResultIds: [], lockedById: ktActor.id } });
      await db.payrollSheet.update({ where: { id: sheet.id }, data: { status: 'LOCKED', lockedAt: new Date(), lockedById: ktActor.id } });

      const result = (await upload([
        siBooks.B + ',Biến động B,8000000,' + (totals[B.id] + 1000),
        siBooks.C + ',Biến động C,6100000,' + totals[C.id],
        '9999999999,Biến động D,6500000,2080000',
      ])).body;
      const by = category => result.differences.filter(row => row.category === category);
      assert.deepEqual(by('AMOUNT_DIFF').map(row => [row.employeeId, row.c12, row.system, row.difference]), [[B.id, String(totals[B.id] + 1000), String(totals[B.id]), '1000']]);
      assert.deepEqual(by('SALARY_BASE_DIFF').map(row => [row.employeeId, row.c12, row.system]), [[C.id, '6100000', '6000000']]);
      const unmatched = by('MISSING_IN_SYSTEM');
      assert.deepEqual(unmatched.map(row => [row.employeeId, row.reason, row.rowNumber]), [[null, 'SI_BOOK_NOT_FOUND', 4]]);
      assert.deepEqual(unmatched[0].hints.map(hint => hint.code), [D.code], 'name hint only, never auto-matched');
      assert.deepEqual(by('MISSING_IN_C12').map(row => row.employeeId), [D.id]);
      assert.deepEqual([result.import.summary.matched, result.import.summary.rows], [2, 3]);
      await assert.rejects(() => db.c12Difference.deleteMany({ where: { importId: result.import.id } }), /C12_IMMUTABLE/);
      const listed = await ok('/social-insurance/c12-imports?siteOrgUnitId=' + site.id + '&month=2026-10', kt);
      assert.equal(listed.items.length, 2);
      const missing = await request('/social-insurance/c12-imports', kt, (() => { const form = new FormData(); form.set('siteOrgUnitId', site.id); form.set('month', '2026-10'); form.set('file', new Blob(['A,B\n1,2'], { type: 'text/csv' }), 'bad.csv'); return form; })());
      assert.deepEqual([missing.status, missing.body.code], [400, 'C12_COLUMNS_MISSING']);
    });
  });
});
