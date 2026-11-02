const { test, beforeEach } = require("node:test");
const assert = require('node:assert/strict');
const { computeOvertimeAttendance } = require('../dist/attendance/overtime-actual-engine.js');

const rules = { inBeforeMinutes: 15, inAfterMinutes: 15, outBeforeMinutes: 15, outAfterMinutes: 15, duplicateWindowMinutes: 5 };
beforeEach(t => t.mock.method(Date, "now", () => Date.parse("2026-10-18T12:00:00Z")));

function schedule(overrides = {}) {
  return {
    id: 'shift-1', employeeId: 'employee-1', orgUnitId: 'unit-1', workDate: '2026-10-02',
    startAt: '2026-10-02T01:00:00.000Z', endAt: '2026-10-02T09:00:00.000Z', workMinutes: 480,
    breakStartOffset: 240, breakMinutes: 0, paidBreak: true, ...overrides,
  };
}

function request(overrides = {}) {
  return {
    id: 'request-1', employeeId: 'employee-1', orgUnitId: 'unit-1', workDate: '2026-10-02',
    title: 'OT', status: 'APPROVED', revision: 1, startAt: '2026-10-02T09:00:00.000Z', endAt: '2026-10-02T11:00:00.000Z',
    requestedMinutes: 120, consentReference: 'consent', ...overrides,
  };
}

function punch(id, punchedAt, direction) {
  return { id, employeeId: 'employee-1', punchedAt, direction };
}

function result({ schedules = [], requests = [], punches = [], assignments = [{ employeeId: 'employee-1', orgUnitId: 'unit-1', workDate: '2026-10-02' }] }) {
  return computeOvertimeAttendance({ schedules, requests, punches, assignments, rules: { 'unit-1:2026-10-02': rules, 'unit-2:2026-10-02': rules, 'unit-1:2026-12-31': rules } });
}

test('reconciles a contiguous night shift and approved extension without changing normal attendance', () => {
  const night = schedule({ startAt: '2026-10-02T15:00:00.000Z', endAt: '2026-10-02T23:00:00.000Z', workDate: '2026-10-02' });
  const output = result({ schedules: [night], requests: [request({ startAt: '2026-10-02T23:00:00.000Z', endAt: '2026-10-03T01:00:00.000Z' })], punches: [punch('in', '2026-10-02T15:00:00.000Z', 'IN'), punch('out', '2026-10-03T01:10:00.000Z', 'OUT')] });
  assert.equal(output.attendance.days[0].workedMinutes, 480);
  assert.equal(output.actuals[0].actualMinutes, 130);
  assert.equal(output.actuals[0].eligibleMinutes, 120);
  assert.equal(output.actuals[0].unapprovedMinutes, 10);
  assert.equal(output.actuals[0].dayMinutes, 120);
});

test('uses the union of overlapping approvals rather than the minimum request total', () => {
  const output = result({ schedules: [schedule()], requests: [request(), request({ id: 'request-2', startAt: '2026-10-02T10:00:00.000Z', endAt: '2026-10-02T12:00:00.000Z' })], punches: [punch('in', '2026-10-02T01:00:00.000Z', 'IN'), punch('out', '2026-10-02T12:00:00.000Z', 'OUT')] });
  const actual = output.actuals[0];
  assert.equal(actual.requestedMinutes, 240);
  assert.equal(actual.approvedMinutes, 180);
  assert.equal(actual.actualMinutes, 180);
  assert.equal(actual.eligibleMinutes, 180);
});

test('keeps an approved request unworked when its pair is missing', () => {
  const output = result({ schedules: [schedule()], requests: [request()], punches: [punch('in', '2026-10-02T01:00:00.000Z', 'IN')] });
  const actual = output.actuals[0];
  assert.equal(actual.eligibleMinutes, 0);
  assert.equal(actual.unworkedApprovedMinutes, 120);
  assert.ok(actual.flags.includes('UNMATCHED_PUNCH'));
  assert.ok(actual.flags.includes('APPROVED_NOT_WORKED'));
});

test('reconciles multiple disjoint standalone approved contexts in one pass', () => {
  const output = result({
    requests: [request({ startAt: '2026-10-02T10:00:00.000Z', endAt: '2026-10-02T11:00:00.000Z', requestedMinutes: 60 }), request({ id: 'request-2', startAt: '2026-10-02T13:00:00.000Z', endAt: '2026-10-02T14:00:00.000Z', requestedMinutes: 60 })],
    punches: [punch('in-1', '2026-10-02T10:00:00.000Z', 'IN'), punch('out-1', '2026-10-02T11:00:00.000Z', 'OUT'), punch('in-2', '2026-10-02T13:00:00.000Z', 'IN'), punch('out-2', '2026-10-02T14:00:00.000Z', 'OUT')],
  });
  const actual = output.actuals[0];
  assert.equal(actual.pairs.length, 2);
  assert.equal(actual.actualMinutes, 120);
  assert.equal(actual.eligibleMinutes, 120);
  assert.equal(new Set(actual.punchIds).size, 4);
});

test('does not count an unpaid lunch inside the normal scheduled interval as overtime', () => {
  const output = result({
    schedules: [schedule({ breakStartOffset: 240, breakMinutes: 60, paidBreak: false })],
    requests: [request()],
    punches: [punch('in', '2026-10-02T01:00:00.000Z', 'IN'), punch('out', '2026-10-02T11:00:00.000Z', 'OUT')],
  });
  const actual = output.actuals[0];
  assert.equal(actual.actualMinutes, 120);
  assert.equal(actual.eligibleMinutes, 120);
  assert.equal(actual.unworkedApprovedMinutes, 0);
});

test('pairs explicit unmatched IN and OUT for standalone pending work but never grants eligibility', () => {
  const output = result({
    requests: [request({ status: 'PENDING', startAt: '2026-10-02T10:00:00.000Z', endAt: '2026-10-02T12:00:00.000Z' })],
    punches: [punch('in', '2026-10-02T10:00:00.000Z', 'IN'), punch('out', '2026-10-02T12:00:00.000Z', 'OUT')],
  });
  const actual = output.actuals[0];
  assert.equal(actual.actualMinutes, 120);
  assert.equal(actual.eligibleMinutes, 0);
  assert.equal(actual.unapprovedMinutes, 120);
  assert.ok(actual.flags.includes('UNAPPROVED_WORK'));
});

test('attributes standalone approved work across Vietnam day and night segments', () => {
  const output = result({
    requests: [request({ startAt: '2026-10-02T13:00:00.000Z', endAt: '2026-10-02T16:00:00.000Z', requestedMinutes: 180 })],
    punches: [punch('in', '2026-10-02T13:10:00.000Z', 'IN'), punch('out', '2026-10-02T15:50:00.000Z', 'OUT')],
  });
  const actual = output.actuals[0];
  assert.equal(actual.actualMinutes, 160);
  assert.equal(actual.eligibleMinutes, 160);
  assert.equal(actual.dayMinutes, 110);
  assert.equal(actual.nightMinutes, 50);
});

test('splits standalone overtime at the Vietnam year boundary while retaining its business work date', () => {
  const output = result({
    requests: [request({ workDate: '2026-12-31', startAt: '2026-12-31T16:30:00.000Z', endAt: '2026-12-31T18:30:00.000Z' })],
    punches: [punch('in', '2026-12-31T16:30:00.000Z', 'IN'), punch('out', '2026-12-31T18:30:00.000Z', 'OUT')],
    assignments: [{ employeeId: 'employee-1', orgUnitId: 'unit-1', workDate: '2026-12-31' }],
  });
  const actual = output.actuals[0];
  assert.equal(actual.workDate, '2026-12-31');
  assert.deepEqual(actual.segments.map(segment => [segment.calendarDate, segment.minutes]), [['2026-12-31', 30], ['2027-01-01', 90]]);
  assert.equal(actual.nightMinutes, 120);
});

test('leaves an ambiguous punch unresolved and never uses it for both approval contexts', () => {
  const second = request({ id: 'request-2', orgUnitId: 'unit-2' });
  const output = computeOvertimeAttendance({
    schedules: [], requests: [request(), second], punches: [punch('in', '2026-10-02T09:00:00.000Z', 'IN'), punch('out', '2026-10-02T11:00:00.000Z', 'OUT')],
    assignments: [{ employeeId: 'employee-1', orgUnitId: 'unit-1', workDate: '2026-10-02' }, { employeeId: 'employee-1', orgUnitId: 'unit-2', workDate: '2026-10-02' }],
    rules: { 'unit-1:2026-10-02': rules, 'unit-2:2026-10-02': rules },
  });
  assert.equal(output.actuals.reduce((total, actual) => total + actual.eligibleMinutes, 0), 0);
  assert.ok(output.actuals.every(actual => actual.flags.includes('UNMATCHED_PUNCH')));
  assert.ok(output.attendance.punches.every(resolution => resolution.status === 'AMBIGUOUS'));
});


test('never bridges a nonworking gap between separate unregistered explicit sessions', () => {
  const actual = result({ punches: [punch('in-1', '2026-10-02T01:00:00Z', 'IN'), punch('out-1', '2026-10-02T02:00:00Z', 'OUT'), punch('in-2', '2026-10-02T06:00:00Z', 'IN'), punch('out-2', '2026-10-02T07:00:00Z', 'OUT')] }).actuals[0];
  assert.equal(actual.actualMinutes, 120);
  assert.equal(actual.eligibleMinutes, 0);
  assert.deepEqual(actual.segments.map(s => s.minutes), [60, 60]);
});

test('owns an unregistered overnight pair by IN date, not a second next-day OUT result', () => {
  const output = computeOvertimeAttendance({ schedules: [], requests: [], assignments: ['2026-10-02', '2026-10-03'].map(workDate => ({ employeeId: 'employee-1', orgUnitId: 'unit-1', workDate })), punches: [punch('in', '2026-10-02T16:00:00Z', 'IN'), punch('out', '2026-10-02T18:00:00Z', 'OUT')], rules: { 'unit-1:2026-10-02': rules, 'unit-1:2026-10-03': rules } });
  const first = output.actuals.find(a => a.workDate === '2026-10-02'), next = output.actuals.find(a => a.workDate === '2026-10-03');
  assert.equal(first.actualMinutes, 120); assert.equal(first.eligibleMinutes, 0);
  assert.deepEqual(first.segments.map(s => [s.calendarDate, s.minutes]), [['2026-10-02', 60], ['2026-10-03', 60]]);
  assert.deepEqual(next.punchIds, []); assert.deepEqual(next.flags, []); assert.equal(next.actualMinutes, 0);
});

test('does not infer an unregistered session across an unresolved AUTO event', () => {
  const actual = result({ punches: [punch('in', '2026-10-02T01:00:00Z', 'IN'), punch('auto', '2026-10-02T02:00:00Z', 'AUTO'), punch('out', '2026-10-02T03:00:00Z', 'OUT')] }).actuals[0];
  assert.equal(actual.actualMinutes, 0); assert.equal(actual.eligibleMinutes, 0);
  assert.ok(actual.flags.includes('UNMATCHED_PUNCH')); assert.deepEqual(actual.pairs, []);
});

test('waits for future punches instead of classifying future approval as unworked', () => {
  const actual = result({ requests: [request({ startAt: '2099-10-02T09:00:00Z', endAt: '2099-10-02T11:00:00Z' })] }).actuals[0];
  assert.equal(actual.eligibleMinutes, 0); assert.deepEqual(actual.flags, ['AWAITING_PUNCHES']);
});

test('uses corrected disjoint intervals for overtime only where they intersect approved time', () => {
  const output = computeOvertimeAttendance({
    schedules: [schedule()],
    requests: [request({ startAt: '2026-10-02T09:00:00.000Z', endAt: '2026-10-02T12:00:00.000Z', requestedMinutes: 180 })],
    punches: [],
    assignments: [{ employeeId: 'employee-1', orgUnitId: 'unit-1', workDate: '2026-10-02' }],
    rules: { 'unit-1:2026-10-02': rules },
    adjustments: [{
      id: 'adjustment-ot', employeeId: 'employee-1', orgUnitId: 'unit-1', workDate: '2026-10-02',
      intervals: [
        { startAt: '2026-10-02T01:00:00.000Z', endAt: '2026-10-02T09:00:00.000Z' },
        { startAt: '2026-10-02T10:00:00.000Z', endAt: '2026-10-02T11:00:00.000Z' },
      ], excuseLateEarly: false,
    }],
  });
  const actual = output.actuals[0];

  assert.equal(actual.adjustmentId, 'adjustment-ot');
  assert.equal(actual.actualMinutes, 60);
  assert.equal(actual.eligibleMinutes, 60);
  assert.equal(actual.unworkedApprovedMinutes, 120);
  assert.deepEqual(actual.segments.map(segment => [segment.startAt, segment.endAt, segment.eligible]), [
    ['2026-10-02T10:00:00.000Z', '2026-10-02T11:00:00.000Z', true],
  ]);
});

test('does not turn BR21 regular credit into observed overtime', () => {
  const output = computeOvertimeAttendance({
    schedules: [schedule()],
    requests: [request({ startAt: '2026-10-02T10:00:00.000Z', endAt: '2026-10-02T12:00:00.000Z', requestedMinutes: 120 })],
    punches: [punch('in', '2026-10-02T01:10:00.000Z', 'IN'), punch('out', '2026-10-02T08:55:00.000Z', 'OUT')],
    assignments: [{ employeeId: 'employee-1', orgUnitId: 'unit-1', workDate: '2026-10-02' }],
    rules: { 'unit-1:2026-10-02': rules },
    adjustments: [{
      id: 'explanation-br21', employeeId: 'employee-1', orgUnitId: 'unit-1', workDate: '2026-10-02', intervals: null, excuseLateEarly: true,
    }],
  });
  const day = output.attendance.days[0];
  const actual = output.actuals[0];

  assert.equal(day.adjustmentId, 'explanation-br21');
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.lateMinutes, 0);
  assert.equal(day.earlyMinutes, 0);
  assert.equal(actual.adjustmentId, 'explanation-br21');
  assert.equal(actual.actualMinutes, 0);
  assert.equal(actual.eligibleMinutes, 0);
});

test("resolves standalone missing-punch presence using attested intervals without inventing raw events", () => {
  const output = computeOvertimeAttendance({
    schedules: [], requests: [],
    punches: [punch("raw-in", "2026-10-02T10:00:00.000Z", "IN")],
    assignments: [{ employeeId: "employee-1", orgUnitId: "unit-1", workDate: "2026-10-02" }],
    rules: { "unit-1:2026-10-02": rules },
    adjustments: [{ id: "attested", employeeId: "employee-1", orgUnitId: "unit-1", workDate: "2026-10-02",
      intervals: [{ startAt: "2026-10-02T10:00:00.000Z", endAt: "2026-10-02T11:00:00.000Z" }], excuseLateEarly: false }],
  });
  const actual = output.actuals[0];
  assert.equal(actual.actualMinutes, 60);
  assert.equal(actual.eligibleMinutes, 0);
  assert.deepEqual(actual.flags, ["UNAPPROVED_WORK"]);
  assert.deepEqual(actual.punchIds, ["raw-in"]);
  assert.deepEqual(actual.pairs.map(pair => [pair.checkInId, pair.checkOutId, pair.checkInAt, pair.checkOutAt]),
    [[null, null, "2026-10-02T10:00:00.000Z", "2026-10-02T11:00:00.000Z"]]);
  assert.deepEqual(output.attendance.punches, [{ punchId: "raw-in", scheduleId: null, status: "UNMATCHED", reason: "NO_APPROVED_SHIFT" }]);
});
