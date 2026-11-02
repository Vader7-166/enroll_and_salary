const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { withServer, day } = require('./http-harness.cjs');
const { cipherText } = require('../dist/common/data-crypto.js');

test('Core reports framework and 10.x reports on real HTTP', { timeout: 600000 }, async t => {
  await withServer('reports', async ({ db, request, ok, login, account }) => {
    const [tt, qd, kt, ad] = await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'ad.demo'].map(name => login(name)));
    const key = Buffer.from(process.env.HR_DATA_KEY, 'base64');
    const unit = code => db.orgUnit.findUniqueOrThrow({ where: { code } });
    const [company, site, team, team2] = await Promise.all(['COMPANY', 'NM-BN', 'NM-BN-D1-T1', 'NM-BN-D1-T2'].map(unit));
    const ktActor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const person = (code, orgUnit) => db.employee.create({ data: { code: 'BC-' + tag + '-' + code, fullName: 'Báo cáo ' + code, gender: 'FEMALE', dob: day('1990-01-01'), hireDate: day('2026-01-05'),
      assignments: { create: { orgUnitId: orgUnit.id, effectiveFrom: day('2026-01-05'), allocationRatio: '100', isPrimary: true } } } });
    const [a, b, c] = [await person('A', team), await person('B', team), await person('C', team2)];
    const shift = (await ok('/shifts/definitions', ad, { orgUnitId: company.id, code: 'BC' + tag, name: 'Ca báo cáo', kind: 'DAY', startTime: '08:00', endTime: '16:30', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: false })).shift;
    const tt2 = await account('tt.bc2', 'TT', 'NM-BN-D1-T2', 'tt.bn');
    const period = (await ok('/periods', ad, { code: 'BC-OCT-' + tag, scopeOrgUnitId: site.id, month: '2026-10', dateFrom: '2026-09-26', dateTo: '2026-10-25' })).period;
    await ok('/periods/' + period.id + '/open', ad, { revision: period.revision });
    const schedules = {};
    for (const [employee, orgUnit, planner] of [[a, team, tt], [b, team, tt], [c, team2, tt2]]) {
      let plan = (await ok('/shifts/plans', planner, { title: 'BC ' + employee.code, teamOrgUnitId: orgUnit.id, slots: ['2026-10-13', '2026-10-14'].map(workDate => ({ workDate, shiftId: shift.id, employeeIds: [employee.id] })) })).plan;
      plan = (await ok('/shifts/plans/' + plan.id + '/submit', planner, { revision: plan.revision })).plan;
      plan = (await ok('/shifts/plans/' + plan.id + '/approve', qd, { revision: plan.revision })).plan;
      for (const entry of plan.entries) {
        schedules[employee.id + entry.workDate] = entry;
        await db.dailyAttendance.create({ data: { scheduleId: entry.id, employeeId: employee.id, orgUnitId: orgUnit.id, periodId: period.id, workDate: day(entry.workDate), status: 'OK', workedMinutes: '480', dayMinutes: '480', nightMinutes: '0',
          lateMinutes: employee === b && entry.workDate === '2026-10-13' ? 12 : 0, earlyMinutes: 0, absent: false, workUnits: '1', segments: [], rules: {}, leave: {} } });
      }
    }

    await t.test('Catalog follows role and permission', async () => {
      const types = async cookie => (await ok('/reports', cookie)).items.map(item => item.type);
      assert.ok((await types(tt)).includes('ATTENDANCE_MONTHLY'));
      assert.ok(!(await types(tt)).includes('PAYROLL_PAYMENT'));
      assert.ok((await types(kt)).includes('PAYROLL_PAYMENT') && (await types(kt)).includes('LABOR_REGISTER'));
      assert.ok(!(await types(ad)).includes('PAYROLL_PAYMENT'), 'AD never reads payroll reports');
      assert.equal((await request('/reports/PAYROLL_PAYMENT/preview?payrollPeriodId=' + randomUUID(), tt)).status, 403);
    });

    await t.test('UAT-14: a TT sees only their team; UAT-22: a Hà Nam QĐ asking for the company gets only their scope', async () => {
      const own = await ok('/reports/ATTENDANCE_MONTHLY/preview?periodId=' + period.id, tt);
      assert.deepEqual(own.rows.map(row => row.code).filter(code => code.startsWith('BC-')).sort(), [a.code, b.code]);
      assert.deepEqual([own.status, own.statusLabel], ['DRAFT', 'Nháp']);
      assert.equal(own.rows.find(row => row.code === a.code)['d2026-10-13'], 'X');
      const qdHaNam = await account('qd.bchna', 'QD', 'NM-HNA-D1', 'qd.bn');
      assert.equal((await request('/reports/ATTENDANCE_MONTHLY/preview?periodId=' + period.id + '&orgUnitId=' + company.id, qdHaNam)).status, 403);
      assert.deepEqual((await ok('/reports/ATTENDANCE_MONTHLY/preview?periodId=' + period.id, qdHaNam)).rows, []);
      const late = await ok('/reports/LATE_EARLY/preview?periodId=' + period.id, qd);
      assert.deepEqual(late.rows.map(row => [row.code, row.late]), [[b.code, 12]]);
      assert.match(late.notes.join(' '), /KHÔNG dùng để trừ lương/);
      const weekly = await ok('/reports/WEEKLY_HOURS/preview?dateFrom=2026-10-12&dateTo=2026-10-18', qd);
      assert.match(weekly.notes.join(' '), /SMETA\/BSCI\/RBA/);
      assert.equal(weekly.rows.find(row => row.code === c.code).regular, 16);
    });

    await t.test('A locked period re-prints from its snapshot (Official, same numbers, source hash)', async () => {
      const snapshot = { teams: [{ team: { id: team.id }, days: [a, b].flatMap(employee => ['2026-10-13', '2026-10-14'].map(workDate => ({ scheduleId: schedules[employee.id + workDate].id, employee: { id: employee.id, code: employee.code, fullName: employee.fullName },
        workDate, shiftCode: shift.code, status: 'OK', workedMinutes: 480, workUnits: employee === a && workDate === '2026-10-14' ? '0.5' : '1', flags: [], leave: {}, correctionId: null }))) }] };
      await db.$executeRawUnsafe("UPDATE business_period SET status = 'LOCKED' WHERE id = '" + period.id + "'");
      await db.attendancePeriodLockEvent.create({ data: { periodId: period.id, revision: 99, action: 'LOCK', sourceHash: 'c'.repeat(64), note: 'test', snapshot, actorId: ktActor.id } });
      const first = await ok('/reports/ATTENDANCE_MONTHLY/preview?periodId=' + period.id, kt);
      assert.deepEqual([first.status, first.statusLabel, first.sourceHash], ['OFFICIAL', 'Chính thức', 'c'.repeat(64)]);
      assert.equal(first.rows.find(row => row.code === a.code).workUnits, 1.5, 'snapshot value, not the live 2.0');
      assert.ok(!first.rows.some(row => row.code === c.code), 'only what the snapshot holds');
      const again = await ok('/reports/ATTENDANCE_MONTHLY/preview?periodId=' + period.id, kt);
      assert.deepEqual(again.rows, first.rows);
    });

    let payrollPeriod;
    await t.test('Payroll payment from the locked snapshot, adjustment origin shown; UAT-21 cost split 9/26 and 17/26', async () => {
      payrollPeriod = await db.payrollPeriod.create({ data: { code: 'BC-PL-' + tag, siteOrgUnitId: site.id, dateFrom: day('2026-10-01'), dateTo: day('2026-10-26') } });
      const run = await db.payrollRun.create({ data: { payrollPeriodId: payrollPeriod.id, siteOrgUnitId: site.id, status: 'COMPLETED', startedById: ktActor.id } });
      const sheet = await db.payrollSheet.create({ data: { payrollPeriodId: payrollPeriod.id, lastRunId: run.id } });
      const totals = { gross: '26000000', insuranceEmployee: '2730000', unionFee: '0', insuranceEmployer: '5980000', tax: '500000', deductions: '0', adjustments: '1000000', net: '23770000', employerCost: '0' };
      const pe = await db.payrollEmployee.create({ data: { sheetId: sheet.id, runId: run.id, employeeId: a.id, status: 'OK', sourceHash: 'a'.repeat(64), totalsCipher: cipherText(key, JSON.stringify(totals)), netPayCipher: cipherText(key, totals.net),
        detailCipher: cipherText(key, JSON.stringify({ costAllocation: [{ costCenterCode: 'CC-A', orgUnitId: team.id, days: 9, ratio: '0.346154', amount: '9000000' }, { costCenterCode: 'CC-B', orgUnitId: team2.id, days: 17, ratio: '0.653846', amount: '17000000' }] })) } });
      let lineNo = 1;
      for (const [lineType, componentCode, amount] of [['MAIN', 'LUONG', '26000000'], ['INSURANCE_EMPLOYER', 'BHXH', '4550000'], ['INSURANCE_EMPLOYER', 'KPCD', '520000'], ['ADJUSTMENT', 'RETRO_PAY', '1000000']])
        await db.payrollLine.create({ data: { payrollEmployeeId: pe.id, lineNo: lineNo++, lineType, label: lineType === 'ADJUSTMENT' ? 'Truy lĩnh lương' : lineType, componentCode, amountCipher: cipherText(key, amount), traceCipher: cipherText(key, '{}'), sourceReference: lineType === 'ADJUSTMENT' ? 'Kỳ gốc 08/2026' : null } });
      await db.payrollSheet.update({ where: { id: sheet.id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: ktActor.id } });
      const content = { employees: [{ employeeId: a.id, code: a.code, fullName: a.fullName, status: 'OK', totals, lines: [{ lineType: 'MAIN', label: 'Lương', componentCode: 'LUONG', sourceReference: null, amount: '26000000' }, { lineType: 'ADJUSTMENT', label: 'Truy lĩnh lương', componentCode: 'RETRO_PAY', sourceReference: 'Kỳ gốc 08/2026', amount: '1000000' }] }] };
      await db.payrollSnapshot.create({ data: { sheetId: sheet.id, contentCipher: cipherText(key, JSON.stringify(content)), contentHash: 'd'.repeat(64), sourceHash: 'a'.repeat(64), compliance: [], parameters: {}, complianceResultIds: [], lockedById: ktActor.id } });
      await db.payrollSheet.update({ where: { id: sheet.id }, data: { status: 'LOCKED', lockedAt: new Date(), lockedById: ktActor.id } });
      const pay = await ok('/reports/PAYROLL_PAYMENT/preview?payrollPeriodId=' + payrollPeriod.id, kt);
      assert.deepEqual([pay.status, pay.sourceHash, pay.rows[0].main, pay.rows[0].net, pay.rows[0].adjustmentOrigin], ['OFFICIAL', 'd'.repeat(64), 26000000, 23770000, 'Truy lĩnh lương (Kỳ gốc 08/2026)']);
      const cost = await ok('/reports/COST_ALLOCATION/preview?payrollPeriodId=' + payrollPeriod.id, kt);
      assert.deepEqual(cost.rows.map(row => [row.costCenter, row.salary]), [['CC-A', 9000000], ['CC-B', 17000000]]);
      assert.equal(cost.rows[0].union + cost.rows[1].union, 520000, 'KPCĐ split by the same ratio');
      assert.match(cost.notes.join(' '), /không đẩy sang ERP/);
    });

    await t.test('Tax withholding is grouped by the payment date: December pay paid 09/01/2026 falls in January 2026', async () => {
      const ruleset = await db.taxRuleset.findUniqueOrThrow({ where: { code: 'RES-PROG-2026' } });
      const detail = { exemptions: { taxable: '20000000', exempt: '1000000' }, tax: '500000' };
      await db.taxWithholding.create({ data: { employeeId: a.id, paymentKey: 'payroll:PL-2025-12:' + a.id, paymentDate: day('2026-01-09'), paymentDateStatus: 'ACTUAL', taxPeriod: '2026-01', subject: 'RESIDENT_PROGRESSIVE', branch: 'PROGRESSIVE', rulesetId: ruleset.id, status: 'LOCKED', filingStatus: 'FILED', detailCipher: cipherText(key, JSON.stringify(detail)) } });
      const january = await ok('/reports/TAX_WITHHOLDING/preview?month=2026-01', kt);
      const row = january.rows.find(item => item.code === a.code);
      assert.deepEqual([row.paymentDate, row.ruleset, row.tax, row.link], ['2026-01-09', 'RES-PROG-2026', 500000, 'Giữ nguyên số đã khai (chuyển tiếp 2026)']);
      assert.ok(!(await ok('/reports/TAX_WITHHOLDING/preview?month=2025-12', kt)).rows.some(item => item.code === a.code));
    });

    await t.test('Exports run in the background with header, Draft/Official label, audit; PDF too; masked columns stay masked in files', async () => {
      const { run } = await ok('/reports/PAYROLL_PAYMENT/export', kt, { params: { payrollPeriodId: payrollPeriod.id }, format: 'XLSX' });
      assert.equal(run.status, 'RUNNING');
      let done; for (let attempt = 0; attempt < 50; attempt++) { done = (await ok('/reports/runs/' + run.id, kt)).run; if (done.status !== 'RUNNING') break; await new Promise(resolve => setTimeout(resolve, 100)); }
      assert.deepEqual([done.status, done.dataStatus, done.rowCount], ['COMPLETED', 'OFFICIAL', 1], JSON.stringify(done));
      const file = await request('/reports/runs/' + run.id + '/download', kt);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(file.body);
      const text = []; book.worksheets[0].eachRow(row => text.push(row.values.slice(1).join(' | ')));
      assert.ok(text.some(line => line === 'Trạng thái dữ liệu: Chính thức'));
      assert.ok(text.some(line => /^Xuất lúc .* bởi kt\.all/.test(line)));
      assert.ok(text.some(line => line.includes('Kỳ gốc 08/2026')));
      assert.ok(await db.auditLog.findFirst({ where: { entityType: 'report_run', entityId: run.id, action: 'EXPORT' } }));
      assert.equal((await request('/reports/runs/' + run.id + '/download', tt)).status, 404, 'only the requester downloads');
      const pdf = (await ok('/reports/ATTENDANCE_MONTHLY/export', qd, { params: { periodId: period.id }, format: 'PDF' })).run;
      let pdfDone; for (let attempt = 0; attempt < 50; attempt++) { pdfDone = (await ok('/reports/runs/' + pdf.id, qd)).run; if (pdfDone.status !== 'RUNNING') break; await new Promise(resolve => setTimeout(resolve, 100)); }
      assert.equal(pdfDone.status, 'COMPLETED', JSON.stringify(pdfDone));
      assert.equal((await request('/reports/runs/' + pdf.id + '/download', qd)).body.subarray(0, 4).toString(), '%PDF');
      const role = await db.role.findUniqueOrThrow({ where: { code: 'KT' } });
      await db.role.update({ where: { code: 'KT' }, data: { permissions: role.permissions.filter(item => item !== 'employee.sensitive.read') } });
      await db.employeeIdentity.create({ data: { employeeId: a.id, documentType: 'CCCD', idNumberCipher: cipherText(key, '001090000001'), idNumberHash: 'h-' + tag, dataStatus: 'SIMULATION' } });
      const register = await ok('/reports/LABOR_REGISTER/preview?year=2026&orgUnitId=' + team.id, await login('kt.all'));
      const mine = register.rows.find(item => item.fullName === a.fullName);
      assert.deepEqual([mine.idNumber, mine.position === undefined], ['***', false], 'personal column masked without employee.sensitive.read');
      assert.match(register.notes.join(' '), /không tự điền/);
      await db.role.update({ where: { code: 'KT' }, data: { permissions: role.permissions } });
    });

    await t.test('Every catalogued report runs; transfer out of the workshop is listed; missing sources say so instead of zeros', async () => {
      const other = await unit('NM-BN-D2');
      const moved = await person('MOVE', team);
      await db.personnelTransfer.create({ data: { employeeId: moved.id, fromOrgUnitId: team.id, toOrgUnitId: other.id, effectiveFrom: day('2026-10-20'), decisionNumber: 'DC-' + tag, decisionDate: day('2026-10-15'), reason: 'Điều chuyển' } });
      const workshop = await unit('NM-BN-D1');
      const changes = await ok('/reports/WORKFORCE_CHANGES/preview?dateFrom=2026-10-01&dateTo=2026-10-31&orgUnitId=' + workshop.id, qd);
      assert.ok(changes.rows.some(row => row.section === 'Điều chuyển ra' && row.code === moved.code));
      const params = { periodId: period.id, payrollPeriodId: payrollPeriod.id, month: '2026-10', year: '2026', dateFrom: '2026-07-01', dateTo: '2026-10-31' };
      for (const item of (await ok('/reports', kt)).items) {
        const query = new URLSearchParams();
        for (const name of item.params) {
          if (name === 'dateRange') { query.set('dateFrom', params.dateFrom); query.set('dateTo', params.dateTo); }
          else if (name === 'orgUnitId') { if (['INSURANCE_CHANGES', 'C12_RECONCILIATION'].includes(item.type)) query.set('orgUnitId', site.id); else if (item.type === 'WORKFORCE_CHANGES') query.set('orgUnitId', workshop.id); }
          else query.set(name, params[name]);
        }
        const result = await request('/reports/' + item.type + '/preview?' + query, kt);
        if (['INSURANCE_CHANGES', 'C12_RECONCILIATION'].includes(item.type)) assert.equal(result.status, 404, item.type + ' without a source is reported, not zero');
        else assert.equal(result.status, 200, item.type + ' ' + JSON.stringify(result.body));
      }
    });

    await t.test('Names follow the organization as of the report period', async () => {
      const version = await db.orgUnitVersion.findFirstOrThrow({ where: { orgUnitId: team2.id, effectiveTo: null } });
      await db.$transaction([
        db.orgUnitVersion.update({ where: { id: version.id }, data: { effectiveTo: day('2026-10-31') } }),
        db.orgUnitVersion.create({ data: { orgUnitId: team2.id, parentId: version.parentId, siteId: version.siteId, name: 'Tổ đổi tên ' + tag, type: version.type, level: version.level, costCenterCode: version.costCenterCode, effectiveFrom: day('2026-11-01') } }),
      ]);
      const weekly = await ok('/reports/WEEKLY_HOURS/preview?dateFrom=2026-10-12&dateTo=2026-10-18', qd);
      assert.equal(weekly.rows.find(row => row.code === c.code).unit, version.name, 'the October report keeps the old name');
    });
  });
});
