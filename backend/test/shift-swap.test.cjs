const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withServer, day } = require('./http-harness.cjs');
const { generateFromPattern, restViolations, copySourceDate, shiftWindow } = require('../dist/shifts/rotation.js');

test('Rotation helpers: cycle offsets, rest days, rest gaps across midnight, copy date mapping', () => {
  const lines = generateFromPattern(['A', 'A', 'B', 'B', 'C', 'C'], [{ employeeId: 'e1', cycleOffset: 0 }, { employeeId: 'e2', cycleOffset: 2 }], '2026-11-02', '2026-11-07');
  assert.deepEqual(lines.filter(line => line.employeeId === 'e1').map(line => line.shiftId).join(''), 'AABBCC');
  assert.deepEqual(lines.filter(line => line.employeeId === 'e2').map(line => line.shiftId).join(''), 'BBCCAA');
  assert.equal(generateFromPattern(['A', null], [{ employeeId: 'e', cycleOffset: 0 }], '2026-11-02', '2026-11-05').length, 2, 'null is a rest day');
  const c = { startTime: '22:00', endTime: '06:00', crossesMidnight: true }, a = { startTime: '06:00', endTime: '14:00', crossesMidnight: false };
  const violations = restViolations([{ employeeId: 'e', workDate: '2026-11-02', ...shiftWindow('2026-11-02', c) }, { employeeId: 'e', workDate: '2026-11-03', ...shiftWindow('2026-11-03', a) }], 720);
  assert.deepEqual(violations.map(row => [row.workDate, row.gapMinutes]), [['2026-11-03', 0]], 'night C then morning A next day leaves no rest');
  assert.equal(copySourceDate('WEEKDAY', '2026-11-02', '2026-11-08', '2026-11-18'), '2026-11-04', 'same weekday');
  assert.equal(copySourceDate('CYCLE', '2026-11-02', '2026-11-07', '2026-11-08', 6), '2026-11-02', 'cycle phase kept');
  assert.equal(copySourceDate('WEEKDAY', '2026-11-02', '2026-11-04', '2026-11-13'), null, 'no source weekday');
});

test('Shift rotation (UAT-23), generation, bulk assignment, copy-previous and post-approval swaps on real HTTP', { timeout: 600000 }, async t => {
  await withServer('shift_swap', async ({ db, request, ok, login }) => {
    const [tt, qd, ad, kt] = await Promise.all(['tt.bn', 'qd.bn', 'ad.demo', 'kt.all'].map(name => login(name)));
    const context = await ok('/organization/context', kt);
    const unit = code => context.units.find(row => row.code === code);
    const company = unit('COMPANY'), bn = unit('NM-BN'), na = unit('NM-NA'), team = unit('NM-BN-D1-T1');
    const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const base = { orgUnitId: company.id, kind: 'DAY', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: true };
    const A = (await ok('/shifts/definitions', ad, { ...base, code: 'RA', name: 'Ca 1', startTime: '06:00', endTime: '14:00' })).shift;
    const B = (await ok('/shifts/definitions', ad, { ...base, code: 'RB', name: 'Ca 2', startTime: '14:00', endTime: '22:00' })).shift;
    const C = (await ok('/shifts/definitions', ad, { ...base, orgUnitId: bn.id, code: 'RC', name: 'Ca 3 BN', kind: 'NIGHT', startTime: '22:00', endTime: '06:00', crossesMidnight: true, breakMinutes: 45 })).shift;
    const people = {};
    for (const code of ['P1', 'P2', 'LEAVER', 'SWAP', 'REST', 'FROZEN']) people[code] = (await ok('/employees', kt, { code: 'ROT-' + code, fullName: 'Xoay ca ' + code, gender: 'OTHER', dob: '1985-01-01', hireDate: '2026-01-05', orgUnitId: team.id })).employee;
    async function approved(employee, dates, shift) {
      let plan = (await ok('/shifts/plans', tt, { title: 'Lịch ' + employee.code, teamOrgUnitId: team.id, slots: dates.map(workDate => ({ workDate, shiftId: shift.id, employeeIds: [employee.id] })) })).plan;
      plan = (await ok('/shifts/plans/' + plan.id + '/submit', tt, { revision: plan.revision })).plan;
      return (await ok('/shifts/plans/' + plan.id + '/approve', qd, { revision: plan.revision })).plan;
    }
    let pattern;

    await t.test('UAT-23: patterns use only the site policy shifts; minimum rest cannot go below the legal rest', async () => {
      assert.equal((await request('/shifts/rotation-patterns', tt, { siteOrgUnitId: bn.id, code: 'X', name: 'x', sequence: [A.id], minRestMinutes: 720, effectiveFrom: '2026-01-01' })).status, 403);
      pattern = (await ok('/shifts/rotation-patterns', ad, { siteOrgUnitId: bn.id, code: 'BN-3CA', name: 'Ba ca A-A-B-B-C-C', sequence: [A.id, A.id, B.id, B.id, C.id, C.id], minRestMinutes: 720, effectiveFrom: '2026-01-01' })).pattern;
      assert.equal(pattern.versions[0].cycleDays, 6);
      const foreign = await request('/shifts/rotation-patterns', ad, { siteOrgUnitId: na.id, code: 'NA-2CA', name: 'Hai ca dùng ca C của Bắc Ninh', sequence: [A.id, C.id], minRestMinutes: 720, effectiveFrom: '2026-01-01' });
      assert.deepEqual([foreign.status, foreign.body.code, foreign.body.details.shiftIds], [400, 'SHIFT_NOT_IN_SITE_POLICY', [C.id]]);
      assert.equal((await request('/shifts/rotation-patterns', ad, { siteOrgUnitId: na.id, code: 'NA-LOW', name: 'Nghỉ thấp', sequence: [A.id, null], minRestMinutes: 300, effectiveFrom: '2026-01-01' })).body.code, 'MIN_REST_TOO_LOW');
      assert.ok((await ok('/shifts/rotation-patterns', tt)).items.some(item => item.id === pattern.id), 'TT of the site sees it');
    });

    await t.test('Generate from the pattern with per-person offsets; a rest violation is reported and nothing is saved', async () => {
      let plan = (await ok('/shifts/plans', tt, { title: 'Lịch xoay ca', teamOrgUnitId: team.id, slots: [{ workDate: '2026-11-02', shiftId: A.id, employeeIds: [people.P1.id] }] })).plan;
      const rested = (await ok('/shifts/rotation-patterns', ad, { siteOrgUnitId: bn.id, code: 'BN-3CA-NGHI', name: 'Ba ca có hai ngày nghỉ', sequence: [A.id, A.id, B.id, B.id, C.id, C.id, null, null], minRestMinutes: 720, effectiveFrom: '2026-01-01' })).pattern;
      const generated = await ok('/shifts/plans/' + plan.id + '/generate', tt, { revision: plan.revision, patternId: rested.id, dateFrom: '2026-11-02', dateTo: '2026-11-07', members: [{ employeeId: people.P1.id, cycleOffset: 0 }, { employeeId: people.P2.id, cycleOffset: 6 }] });
      plan = generated.plan;
      const shiftOf = (employee, workDate) => plan.entries.find(entry => entry.employee.id === employee.id && entry.workDate === workDate)?.shift.code;
      assert.equal(['02', '03', '04', '05', '06', '07'].map(dayOf => shiftOf(people.P1, '2026-11-' + dayOf)).join(','), 'RA,RA,RB,RB,RC,RC');
      assert.equal(['02', '03', '04', '05', '06', '07'].map(dayOf => shiftOf(people.P2, '2026-11-' + dayOf) ?? '-').join(','), '-,-,RA,RA,RB,RB', 'offset 6 starts on the two rest days');
      assert.equal(plan.status, 'DRAFT');
      const wrap = await request('/shifts/plans/' + plan.id + '/generate', tt, { revision: plan.revision, patternId: pattern.id, dateFrom: '2026-11-02', dateTo: '2026-11-08', members: [{ employeeId: people.P1.id, cycleOffset: 0 }] });
      assert.deepEqual([wrap.status, wrap.body.code, wrap.body.details.violations[0].workDate], [409, 'SHIFT_REST_VIOLATION', '2026-11-08'], 'C on the 7th then A on the 8th');
      assert.equal((await ok('/shifts/plans/' + plan.id, tt)).plan.revision, plan.revision, 'refused generation saved nothing');
      const bulk = await ok('/shifts/plans/' + plan.id + '/bulk-assign', tt, { revision: plan.revision, shiftId: B.id, employeeIds: [people.P1.id, people.P2.id], dates: ['2026-11-12', '2026-11-13'] });
      assert.equal(bulk.assigned, 4);
      assert.equal(bulk.plan.entries.length, 14);
      assert.equal((await request('/shifts/plans/' + plan.id + '/bulk-assign', qd, { revision: bulk.plan.revision, shiftId: B.id, employeeIds: [people.P1.id], dates: ['2026-11-14'] })).status, 403);
    });

    await t.test('Copy last period by weekday skips employees who left and lists them', async () => {
      await approved(people.LEAVER, ['2026-11-16', '2026-11-17', '2026-11-18'], A);
      await approved(people.REST, ['2026-11-16', '2026-11-18'], B);
      await db.employee.update({ where: { id: people.LEAVER.id }, data: { terminationDate: day('2026-11-20'), status: 'TERMINATED' } });
      const copy = await ok('/shifts/plans/copy-previous', tt, { teamOrgUnitId: team.id, title: 'Sao chép tuần trước', sourceFrom: '2026-11-16', sourceTo: '2026-11-22', targetFrom: '2026-11-23', targetTo: '2026-11-29', mode: 'WEEKDAY' });
      assert.deepEqual(copy.plan.entries.filter(entry => entry.employee.id === people.REST.id).map(entry => [entry.workDate, entry.shift.code]), [['2026-11-23', 'RB'], ['2026-11-25', 'RB']]);
      assert.ok(!copy.plan.entries.some(entry => entry.employee.id === people.LEAVER.id));
      assert.deepEqual(copy.skipped.map(row => [row.id, row.days]), [[people.LEAVER.id, 3]]);
      assert.equal(copy.plan.status, 'DRAFT');
    });

    let swapPlan;
    await t.test('Swap before approval keeps the old shift for attendance; approval re-pairs the day by the new shift', async () => {
      swapPlan = await approved(people.SWAP, ['2026-10-14', '2026-10-15'], B);
      const october = (await ok('/periods', ad, { code: 'ROT-OCT', scopeOrgUnitId: bn.id, month: '2026-10', dateFrom: '2026-09-26', dateTo: '2026-10-25' })).period;
      await ok('/periods/' + october.id + '/open', ad, { revision: october.revision });
      const form = new FormData();
      form.set('file', new Blob([[[people.SWAP.code, '2026-10-15', '22:00:00', 'MAY01', 'IN'], [people.SWAP.code, '2026-10-16', '06:00:00', 'MAY01', 'OUT']].map(row => row.join(',')).join('\n')]), 'punch.csv');
      form.set('siteId', site.id); form.set('referencePeriodId', october.id);
      assert.equal((await request('/attendance/imports', ad, form)).status, 201);
      const schedule = swapPlan.entries.find(entry => entry.workDate === '2026-10-15');
      const attendanceOf = () => db.dailyAttendance.findUnique({ where: { scheduleId: schedule.id }, include: { schedule: { include: { shift: true } } } });
      const before = await attendanceOf();
      assert.equal(before.schedule.shift.code, 'RB');
      assert.equal(before.checkInId, null, 'punches at 22:00/06:00 do not fit shift B');
      const { swap } = await ok('/shifts/swaps', tt, { scheduleId: schedule.id, newShiftId: C.id, reason: 'Đổi sang ca đêm theo yêu cầu sản xuất' });
      assert.equal(swap.status, 'PENDING');
      assert.equal((await attendanceOf()).schedule.shift.code, 'RB', 'pending swap: the approved B shift still drives attendance');
      assert.equal((await request('/shifts/swaps', tt, { scheduleId: schedule.id, newShiftId: A.id, reason: 'Trùng' })).body.code, 'SWAP_PENDING');
      assert.ok((await ok('/notifications', qd)).items.some(item => item.type === 'SHIFT_SWAP_PENDING' && item.payload.swapId === swap.id));
      assert.equal((await request('/shifts/swaps/' + swap.id + '/approve', tt, { revision: swap.revision })).status, 403);
      const decided = await ok('/shifts/swaps/' + swap.id + '/approve', qd, { revision: swap.revision });
      assert.deepEqual([decided.swap.status, decided.attendance.state], ['APPROVED', 'UPDATED']);
      const after = await attendanceOf();
      assert.equal(after.schedule.shift.code, 'RC');
      assert.ok(after.checkInId && after.checkOutId, 'the day is re-paired with the night punches');
      assert.equal(decided.swap.history.at(-1).snapshot.before.shiftId, B.id);
      assert.equal(decided.swap.history.at(-1).snapshot.after.shiftId, C.id);
      const history = await db.shiftPlanHistory.findMany({ where: { planId: swapPlan.id }, orderBy: { revision: 'desc' } });
      assert.equal(history[0].action, 'SWAP');
      assert.ok((await ok('/notifications', tt)).items.some(item => item.type === 'SHIFT_SWAP_DECIDED' && item.payload.swapId === swap.id));
    });

    await t.test('A swap breaking the rest rule is refused at creation; a closed period blocks approval and keeps the schedule', async () => {
      const night = await approved(people.FROZEN, ['2026-09-27'], C);
      const day2 = await approved(people.FROZEN, ['2026-09-28'], C);
      const tooClose = await request('/shifts/swaps', tt, { scheduleId: day2.entries[0].id, newShiftId: A.id, reason: 'Thử' });
      assert.equal(tooClose.body.code, 'SHIFT_CONSTRAINT_VIOLATION', JSON.stringify(tooClose.body));
      const { swap } = await ok('/shifts/swaps', tt, { scheduleId: night.entries[0].id, newShiftId: B.id, reason: 'Đổi ca ngày 27' });
      const period = await db.businessPeriod.findFirstOrThrow({ where: { code: 'ROT-OCT' } });
      await db.$executeRawUnsafe("UPDATE business_period SET status = 'CLOSED' WHERE id = '" + period.id + "'");
      const refused = await request('/shifts/swaps/' + swap.id + '/approve', qd, { revision: swap.revision });
      assert.deepEqual([refused.status, refused.body.code], [409, 'PERIOD_STATE_CONFLICT']);
      assert.equal((await db.shiftSchedule.findUniqueOrThrow({ where: { id: night.entries[0].id } })).shiftId, C.id);
      assert.equal((await db.shiftSwapRequest.findUniqueOrThrow({ where: { id: swap.id } })).status, 'PENDING');
      const rejected = await ok('/shifts/swaps/' + swap.id + '/reject', qd, { revision: swap.revision, reason: 'Kỳ đã chốt' });
      assert.equal(rejected.swap.status, 'REJECTED');
      await assert.rejects(() => db.shiftSwapHistory.deleteMany({ where: { swapId: swap.id } }), /SHIFT_SWAP_HISTORY_IMMUTABLE/);
    });
  });
});
