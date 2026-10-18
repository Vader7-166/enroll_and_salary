const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeAttendance } = require('../dist/attendance/attendance-engine.js');

const rules = {
  inBeforeMinutes: 15,
  inAfterMinutes: 15,
  outBeforeMinutes: 15,
  outAfterMinutes: 15,
  duplicateWindowMinutes: 5,
};

function schedule(overrides = {}) {
  return {
    id: 'shift-1',
    employeeId: 'employee-1',
    orgUnitId: 'unit-1',
    workDate: '2026-10-02',
    startAt: '2026-10-02T02:00:00.000Z',
    endAt: '2026-10-02T10:00:00.000Z',
    workMinutes: 480,
    breakStartOffset: 180,
    breakMinutes: 45,
    paidBreak: false,
    ...overrides,
  };
}

function punch(id, punchedAt, direction = 'AUTO', employeeId = 'employee-1') {
  return { id, employeeId, punchedAt, direction };
}

function result(schedules, punches, ruleOverrides = {}) {
  return computeAttendance(schedules, punches, Object.fromEntries(schedules.map(item => [item.id, { ...rules, ...ruleOverrides }] )));
}

test('counts paid and unpaid 22:00–06:00 shifts entirely as night work', () => {
  const night = schedule({
    startAt: '2026-10-02T15:00:00.000Z',
    endAt: '2026-10-02T23:00:00.000Z',
    paidBreak: true,
    workDate: '2026-10-02',
  });
  const punches = [
    punch('in', '2026-10-02T15:00:00.000Z', 'IN'),
    punch('out', '2026-10-02T23:00:00.000Z', 'OUT'),
  ];
  const paid = result([night], punches).days[0];
  const unpaid = result([{ ...night, paidBreak: false }], punches).days[0];

  assert.equal(paid.status, 'OK');
  assert.equal(paid.workedMinutes, 480);
  assert.equal(paid.dayMinutes, 0);
  assert.equal(paid.nightMinutes, 480);
  assert.equal(paid.workUnits, '1');
  assert.deepEqual(paid.segments.map(segment => segment.kind), ['NIGHT', 'NIGHT']);
  assert.equal(unpaid.workedMinutes, 435);
  assert.equal(unpaid.dayMinutes, 0);
  assert.equal(unpaid.nightMinutes, 435);
});

test('removes only unpaid-break overlap, including a partial overlap', () => {
  const normal = schedule();
  const full = result([normal], [
    punch('in-full', '2026-10-02T02:00:00.000Z', 'IN'),
    punch('out-full', '2026-10-02T10:00:00.000Z', 'OUT'),
  ]).days[0];
  const partial = result([normal], [
    punch('in-partial', '2026-10-02T04:30:00.000Z', 'IN'),
    punch('out-partial', '2026-10-02T05:15:00.000Z', 'OUT'),
  ], { inAfterMinutes: 180, outBeforeMinutes: 300 }).days[0];

  assert.equal(full.workedMinutes, 435);
  assert.equal(full.nightMinutes, 0);
  assert.equal(full.dayMinutes, 435);
  assert.equal(partial.workedMinutes, 30);
  assert.deepEqual(partial.segments.map(segment => [segment.startAt, segment.endAt]), [
    ['2026-10-02T04:30:00.000Z', '2026-10-02T05:00:00.000Z'],
  ]);
});

test('reports missing and absent shifts without inferring a check-out', () => {
  const normal = schedule();
  const missing = result([normal], [punch('in', '2026-10-02T02:00:00.000Z', 'IN')]).days[0];
  const absent = result([normal], []).days[0];

  assert.equal(missing.status, 'ERR');
  assert.deepEqual(missing.flags, ['MISSING_OUT']);
  assert.equal(missing.workedMinutes, 0);
  assert.equal(missing.checkInId, 'in');
  assert.equal(missing.checkOutId, null);
  assert.equal(absent.status, 'ERR');
  assert.equal(absent.absent, true);
  assert.deepEqual(absent.flags, ['ABSENT']);
});

test('accepts punches on inclusive window cutoffs and respects explicit directions', () => {
  const normal = schedule();
  const exact = result([normal], [
    punch('in', '2026-10-02T01:45:00.000Z', 'IN'),
    punch('out', '2026-10-02T10:15:00.000Z', 'OUT'),
  ]).days[0];
  const explicit = result([normal], [
    punch('wrong-out', '2026-10-02T02:00:00.000Z', 'OUT'),
    punch('wrong-in', '2026-10-02T10:00:00.000Z', 'IN'),
  ]);

  assert.equal(exact.status, 'OK');
  assert.equal(exact.workedMinutes, 435);
  assert.deepEqual(explicit.punches.map(item => item.reason), ['OUTSIDE_WINDOW', 'OUTSIDE_WINDOW']);
  assert.deepEqual(explicit.days[0].flags, ['ABSENT']);
});

test('clips a previous-date early check-in to a midnight schedule while retaining its work date', () => {
  const midnight = schedule({
    workDate: '2026-10-03',
    startAt: '2026-10-02T17:00:00.000Z',
    endAt: '2026-10-03T01:00:00.000Z',
    breakMinutes: 0,
  });
  const day = result([midnight], [
    punch('in', '2026-10-02T16:50:00.000Z', 'IN'),
    punch('out', '2026-10-03T01:00:00.000Z', 'OUT'),
  ]).days[0];

  assert.equal(day.workDate, '2026-10-03');
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.nightMinutes, 360);
  assert.equal(day.dayMinutes, 120);
});

test('marks AUTO punches matching both schedule windows as ambiguous instead of assigning them', () => {
  const normal = schedule();
  const computed = result([normal], [punch('auto', '2026-10-02T06:00:00.000Z')], {
    inAfterMinutes: 300,
    outBeforeMinutes: 300,
  });

  assert.deepEqual(computed.punches, [{ punchId: 'auto', scheduleId: null, status: 'AMBIGUOUS', reason: 'AMBIGUOUS' }]);
  assert.equal(computed.days[0].status, 'ERR');
  assert.deepEqual(computed.days[0].flags, ['AMBIGUOUS']);
});

test('suppresses consecutive duplicates, retaining the earliest IN and latest OUT', () => {
  const normal = schedule();
  const computed = result([normal], [
    punch('in-early', '2026-10-02T01:58:00.000Z', 'IN'),
    punch('in-late', '2026-10-02T02:00:00.000Z', 'IN'),
    punch('in-extra', '2026-10-02T02:10:00.000Z', 'IN'),
    punch('out-early', '2026-10-02T10:00:00.000Z', 'OUT'),
    punch('out-late', '2026-10-02T10:03:00.000Z', 'OUT'),
  ]);

  assert.equal(computed.days[0].checkInId, 'in-early');
  assert.equal(computed.days[0].checkOutId, 'out-late');
  assert.equal(computed.days[0].workedMinutes, 435);
  assert.deepEqual(computed.punches.map(item => [item.punchId, item.status, item.reason]), [
    ['in-early', 'MATCHED', null],
    ['in-late', 'SUPPRESSED', 'DUPLICATE_PUNCH'],
    ['in-extra', 'MATCHED', 'EXTRA_PUNCH'],
    ['out-early', 'SUPPRESSED', 'DUPLICATE_PUNCH'],
    ['out-late', 'MATCHED', null],
  ]);
});

test('preserves seconds in worked minutes and rounds late minutes upward', () => {
  const normal = schedule({ breakMinutes: 0 });
  const day = result([normal], [
    punch('in', '2026-10-02T02:00:30.000Z', 'IN'),
    punch('out', '2026-10-02T09:59:45.000Z', 'OUT'),
  ]).days[0];

  assert.equal(day.status, 'OK');
  assert.equal(day.workedMinutes, 479.25);
  assert.equal(day.dayMinutes + day.nightMinutes, day.workedMinutes);
  assert.equal(day.lateMinutes, 1);
  assert.equal(day.earlyMinutes, 1);
  assert.deepEqual(day.flags, ['LATE', 'EARLY']);
});
