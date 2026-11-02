const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { withServer, day } = require('./http-harness.cjs');
const { cipherText } = require('../dist/common/data-crypto.js');
const { benefitDayCount, entitlementDays, estimateBenefit } = require('../dist/leave/sickness-maternity/benefit-rules.js');

const params = { sicknessBands: [{ fromYears: 0, days: 30 }, { fromYears: 15, days: 40 }, { fromYears: 30, days: 60 }], childSick: 20, prenatal: 5, recovery: 5, maternity: 180 };

test('Benefit rules: working vs calendar days, service bands, 75% ÷ 24 estimate, maternity eligibility', () => {
  assert.equal(benefitDayCount('SICK', '2026-10-17', '2026-10-19', [7]), 2, 'Sunday excluded for sickness');
  assert.equal(benefitDayCount('MATERNITY', '2026-10-17', '2026-10-19', [7]), 3, 'calendar days for maternity');
  assert.deepEqual([0, 179, 180, 359, 360].map(months => entitlementDays('SICK', months, params)), [30, 30, 40, 40, 60]);
  const sick = estimateBenefit({ type: 'SICK', recordDays: 3, usedThisYear: 0, entitlement: 30, baseSalaries: ['10000000'], rate: '0.75', standardDays: 24, contributionMonthsLast12: 12, maternityMinMonths: 6 });
  assert.deepEqual([sick.status, sick.days, sick.daily, sick.amount], ['ESTIMATED', 3, '312500', '937500'], '7.500.000/month ÷ 24');
  assert.equal(estimateBenefit({ type: 'SICK', recordDays: 5, usedThisYear: 28, entitlement: 30, baseSalaries: ['10000000'], rate: '0.75', standardDays: 24, contributionMonthsLast12: 12, maternityMinMonths: 6 }).days, 2, 'capped by what is left this year');
  assert.equal(estimateBenefit({ type: 'SICK', recordDays: 3, usedThisYear: 0, entitlement: 30, baseSalaries: [], rate: '0.75', standardDays: 24, contributionMonthsLast12: 12, maternityMinMonths: 6 }).status, 'INSUFFICIENT_DATA');
  assert.equal(estimateBenefit({ type: 'MATERNITY', recordDays: 180, usedThisYear: 0, entitlement: 180, baseSalaries: ['9000000'], rate: '1', standardDays: 24, contributionMonthsLast12: 4, maternityMinMonths: 6 }).status, 'NOT_ELIGIBLE');
});

test('Sickness/maternity records and workshop absence rate (UAT-25) on real HTTP', { timeout: 600000 }, async t => {
  await withServer('sickness_maternity', async ({ db, request, ok, login, account }) => {
    const [kt, tt, qd, ad] = await Promise.all(['kt.all', 'tt.bn', 'qd.bn', 'ad.demo'].map(name => login(name)));
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const site = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const team = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T1' } });
    const team2 = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T2' } });
    const workshop = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1' } });
    const ktActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const person = async (code, unit = team, gender = 'FEMALE') => db.employee.create({ data: { code: 'OM-' + tag + '-' + code, fullName: 'Chế độ ' + code, gender, dob: day('1992-01-01'), hireDate: day('2026-01-05'),
      assignments: { create: { orgUnitId: unit.id, effectiveFrom: day('2026-01-05'), allocationRatio: '100', isPrimary: true } } } });
    /** One locked payroll month per call: the contribution history the estimate reads. */
    async function contributions(employee, months) {
      for (const [month, base] of months) {
        const period = await db.payrollPeriod.findFirst({ where: { code: 'OM-' + tag + '-' + month } }) ?? await db.payrollPeriod.create({ data: { code: 'OM-' + tag + '-' + month, siteOrgUnitId: site.id, dateFrom: day(month + '-01'), dateTo: day(month + '-28') } });
        let sheet = await db.payrollSheet.findUnique({ where: { payrollPeriodId: period.id } });
        const run = await db.payrollRun.create({ data: { payrollPeriodId: period.id, siteOrgUnitId: site.id, status: 'COMPLETED', startedById: ktActor.id } });
        if (!sheet) sheet = await db.payrollSheet.create({ data: { payrollPeriodId: period.id, lastRunId: run.id } });
        if (sheet.status === 'LOCKED') throw new Error('one locked sheet per month in this fixture');
        const row = await db.payrollEmployee.create({ data: { sheetId: sheet.id, runId: run.id, employeeId: employee.id, status: 'OK', sourceHash: 'a'.repeat(64), totalsCipher: cipherText(key, '{}'), netPayCipher: cipherText(key, '0'), detailCipher: cipherText(key, '{}') } });
        await db.insuranceContribution.create({ data: { payrollPeriodId: period.id, payrollEmployeeId: row.id, employeeId: employee.id, contributionMonth: month, eligible: { BHXH: true, BHYT: true, BHTN: true }, detailCipher: cipherText(key, JSON.stringify({ salary: { perKind: { BHXH: { value: base } } }, contribution: null })) } });
      }
    }
    async function lockMonths(months) {
      for (const month of months) {
        const period = await db.payrollPeriod.findFirstOrThrow({ where: { code: 'OM-' + tag + '-' + month } });
        const sheet = await db.payrollSheet.findUniqueOrThrow({ where: { payrollPeriodId: period.id } });
        await db.payrollSheet.update({ where: { id: sheet.id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: ktActor.id } });
        await db.payrollSnapshot.create({ data: { sheetId: sheet.id, contentCipher: cipherText(key, '{}'), contentHash: 'b'.repeat(64), sourceHash: 'a'.repeat(64), compliance: [], parameters: {}, complianceResultIds: [], lockedById: ktActor.id } });
        await db.payrollSheet.update({ where: { id: sheet.id }, data: { status: 'LOCKED', lockedAt: new Date(), lockedById: ktActor.id } });
      }
    }
    const sick = await person('SICK');
    const mother = await person('MOM');
    const short = await person('SHORT');
    const months = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    await contributions(sick, months.map(month => [month, '10000000']));
    await contributions(mother, months.map((month, index) => [month, String(8000000 + index * 400000)]));
    await contributions(short, months.slice(2).map(month => [month, '7000000']));
    await lockMonths(months);
    const upload = (fields, file = true) => {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.set(name, String(value));
      if (file) form.set('file', new Blob(['%PDF-1.4 giấy chứng nhận'], { type: 'application/pdf' }), 'giay-chung-nhan.pdf');
      return request('/leave/sickness-maternity', kt, form);
    };

    await t.test('Sickness record: evidence required, estimate with trace from the locked BHXH salary, overlap refused', async () => {
      const sickType = await db.leaveTypeVersion.findFirstOrThrow({ where: { leaveType: { code: 'SICK' } } });
      assert.deepEqual([sickType.isPaid, sickType.siPaid], [false, true], 'SI-paid leave days are not paid by the company');
      assert.equal((await upload({ employeeId: sick.id, benefitType: 'SICK', documentNumber: 'GCN-1', facility: 'BV Bắc Ninh', dateFrom: '2026-10-13', dateTo: '2026-10-15' }, false)).body.code, 'EVIDENCE_REQUIRED');
      const ttForm = new FormData(); ttForm.set('employeeId', sick.id);
      assert.equal((await request('/leave/sickness-maternity', tt, ttForm)).status, 403, 'TT cannot record');
      const created = await upload({ employeeId: sick.id, benefitType: 'SICK', documentNumber: 'GCN-1', facility: 'BV Bắc Ninh', dateFrom: '2026-10-13', dateTo: '2026-10-15' });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const record = created.body.record;
      assert.deepEqual([record.estimateStatus, record.estimate.label, record.estimate.days, record.estimate.base, record.estimate.daily, record.estimate.amount], ['ESTIMATED', 'Dự tính', 3, '10000000', '312500', '937500']);
      assert.deepEqual(record.estimate.baseMonths, ['2026-09']);
      assert.ok(record.estimate.parameters.SICKNESS_BENEFIT_RATE && record.estimate.parameters.SI_BENEFIT_STANDARD_DAYS, 'parameter trace');
      const overlap = await upload({ employeeId: sick.id, benefitType: 'SICK', documentNumber: 'GCN-2', facility: 'BV', dateFrom: '2026-10-15', dateTo: '2026-10-16' });
      assert.deepEqual([overlap.status, overlap.body.code, overlap.body.details.recordId], [409, 'RECORD_OVERLAP', record.id]);
      const paid = await ok('/leave/sickness-maternity/' + record.id + '/payment', kt, { revision: record.revision, amount: '900000', paidDate: '2026-11-20', reference: 'UNC-BHXH-01' });
      assert.deepEqual([paid.record.paidAmount, paid.record.difference, paid.record.estimate.amount], ['900000', '-37500', '937500']);
      await assert.rejects(() => db.sicknessMaternityRecord.update({ where: { id: record.id }, data: { estimateStatus: 'NOT_ELIGIBLE' } }), /SI_BENEFIT_RECORD_IMMUTABLE/);
      const file = await request('/leave/sickness-maternity/' + record.id + '/evidence', kt);
      assert.equal(file.status, 200);
      assert.ok(await db.auditLog.findFirst({ where: { entityType: 'sickness_maternity_record', entityId: record.id, action: 'DOWNLOAD_EVIDENCE' } }));
    });

    await t.test('Maternity: average of six locked months; fewer than six months in the last twelve is not eligible', async () => {
      const record = (await upload({ employeeId: mother.id, benefitType: 'MATERNITY', documentNumber: 'GRV-1', facility: 'BV Sản nhi', dateFrom: '2026-10-01', dateTo: '2027-03-29' })).body.record;
      assert.deepEqual([record.estimateStatus, record.estimate.days, record.estimate.base], ['ESTIMATED', 180, '9000000'], 'average of 8.0 … 10.0 million');
      assert.equal(record.estimate.amount, '54000000', '180 calendar days × 100% × 9.000.000 ÷ 30');
      const refused = (await upload({ employeeId: short.id, benefitType: 'MATERNITY', documentNumber: 'GRV-2', facility: 'BV', dateFrom: '2026-10-05', dateTo: '2027-04-02' })).body.record;
      assert.deepEqual([refused.estimateStatus, refused.estimate.amount], ['NOT_ELIGIBLE', null]);
      const list = await ok('/leave/sickness-maternity?year=2026', kt);
      assert.equal(list.items.filter(item => [sick.id, mother.id, short.id].includes(item.employee.id)).length, 3);
    });

    await t.test('Absence rate per team/day/type within the QĐ scope, holidays excluded, threshold warnings (UAT-25)', async () => {
      const company = await db.orgUnit.findUniqueOrThrow({ where: { code: 'COMPANY' } });
      const shift = (await ok('/shifts/definitions', ad, { orgUnitId: company.id, code: 'OM' + tag, name: 'Ca hành chính', kind: 'DAY', startTime: '08:00', endTime: '16:30', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: false })).shift;
      const workers = { leave: await person('W1'), absent: await person('W2'), holiday: await person('W3'), present: await person('W4'), other: await person('W5', team2) };
      const dates = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'];
      const period = (await ok('/periods', ad, { code: 'OM-OCT-' + tag, scopeOrgUnitId: site.id, month: '2026-10', dateFrom: '2026-09-26', dateTo: '2026-10-25' })).period;
      await ok('/periods/' + period.id + '/open', ad, { revision: period.revision });
      const annual = await db.leaveTypeVersion.findFirstOrThrow({ where: { leaveType: { code: 'ANNUAL' } } });
      const tt2 = await account('tt.t2', 'TT', 'NM-BN-D1-T2', 'tt.bn');
      for (const [name, employee] of Object.entries(workers)) {
        const unit = name === 'other' ? team2 : team, planner = name === 'other' ? tt2 : tt;
        let plan = (await ok('/shifts/plans', planner, { title: 'Vắng ' + name, teamOrgUnitId: unit.id, slots: dates.map(workDate => ({ workDate, shiftId: shift.id, employeeIds: [employee.id] })) })).plan;
        plan = (await ok('/shifts/plans/' + plan.id + '/submit', planner, { revision: plan.revision })).plan;
        plan = (await ok('/shifts/plans/' + plan.id + '/approve', qd, { revision: plan.revision })).plan;
        for (const entry of plan.entries) {
          const source = (extra = {}) => ({ requestId: randomUUID(), revision: 1, workDate: entry.workDate, scheduleId: entry.id, orgUnitId: unit.id, startAt: entry.startAt, endAt: entry.endAt, minutes: 480, workMinutes: 480, attendanceSymbol: 'P', isPaid: true, countsAsWorkday: true, holiday: false, holidayParameterId: 'h', typeVersionId: annual.id, ...extra });
          const sources = name === 'leave' ? [source()] : name === 'holiday' && entry.workDate === '2026-10-17' ? [source({ holiday: true, attendanceSymbol: 'L' })] : [];
          await db.dailyAttendance.create({ data: { scheduleId: entry.id, employeeId: employee.id, orgUnitId: unit.id, periodId: period.id, workDate: day(entry.workDate), status: name === 'absent' && entry.workDate === '2026-10-13' ? 'ERR' : 'OK',
            workedMinutes: '0', dayMinutes: '0', nightMinutes: '0', lateMinutes: 0, earlyMinutes: 0, absent: name === 'absent' && entry.workDate === '2026-10-13', workUnits: '1', segments: [], rules: {},
            leave: { minutes: sources.reduce((sum, item) => sum + item.minutes, 0), paidMinutes: 0, countedUnits: '0', symbols: sources.map(item => item.attendanceSymbol), sources } } });
        }
      }
      const result = await ok('/leave/absence-rate?workshopOrgUnitId=' + workshop.id + '&dateFrom=2026-10-13&dateTo=2026-10-17', qd);
      const t1 = result.byTeam.find(row => row.orgUnitId === team.id), t2 = result.byTeam.find(row => row.orgUnitId === team2.id);
      assert.deepEqual([t1.planned, t1.absent, t1.rate, t1.warning], [20, '6', '0.3', true], 'five leave days + one unexcused of twenty');
      assert.deepEqual([t2.planned, t2.absent, t2.warning], [5, '0', false]);
      const cell = result.cells.find(row => row.orgUnitId === team.id && row.workDate === '2026-10-13');
      assert.deepEqual([cell.planned, cell.absent, cell.rate, cell.warning], [4, '2', '0.5', true]);
      assert.deepEqual(result.byType.map(row => [row.code, row.days]), [['ANNUAL', '5'], ['UNEXCUSED', '1']], 'the holiday is not an absence');
      assert.equal(result.threshold, '0.1');
      const qdHaNam = await account('qd.hna2', 'QD', 'NM-HNA-D1', 'qd.bn');
      assert.equal((await request('/leave/absence-rate?workshopOrgUnitId=' + workshop.id + '&dateFrom=2026-10-13&dateTo=2026-10-17', qdHaNam)).status, 403, 'Hà Nam QĐ cannot see Bắc Ninh');
      const own = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-HNA-D1' } });
      assert.deepEqual((await ok('/leave/absence-rate?workshopOrgUnitId=' + own.id + '&dateFrom=2026-10-13&dateTo=2026-10-17', qdHaNam)).byTeam, [], 'only their own workshop');
      const me = (await ok('/auth/me', qd)).user;
      assert.ok(!me.permissions.includes('leave.request'), 'QĐ sees approved leave but has no leave decision action (BR-33)');
    });
  });
});
