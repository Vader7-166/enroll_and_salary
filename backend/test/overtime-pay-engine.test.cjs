const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkDay, otRate, otPay, nightAllowancePay, splitInterval, dayTypeOf } = require('../dist/overtime-pay/overtime-pay-engine.js');

function source(paramCode, value) { return { id: 'p-' + paramCode, paramCode, scopeKey: 'GLOBAL', effectiveFrom: '2026-01-01', value }; }
function parameters(overrides = {}) {
  const values = { OT_RATE_WEEKDAY: '1.5', OT_RATE_WEEKLY_REST: '2.0', OT_RATE_HOLIDAY: '3.0', NIGHT_ALLOWANCE_RATE: '0.3', NIGHT_OT_ADDON_RATE: '0.2', ...overrides };
  return Object.fromEntries(Object.entries(values).map(([code, value]) => [code, source(code, value)]));
}
// 2026-10-03 is Saturday, 2026-10-04 Sunday; 2026-09-02 is a holiday in the demo calendar.
const calendar = { holidays: ['2026-09-01', '2026-09-02'], weeklyRestDays: [7] };
const at = (date, time) => new Date(date + 'T' + time + ':00+07:00').toISOString();
const ot = (date, from, toDate, to, eligible = true) => ({ startAt: at(date, from), endAt: at(toDate, to), eligible });
function day(workDate, overtime, extra = {}) {
  return buildWorkDay({ employeeId: 'e1', orgUnitId: 'u1', workDate, overtime, regular: [], parameters: parameters(), calendar, ...extra });
}
const rate = value => Number(value);
const view = result => result.buckets.map(b => [b.kind, b.dayType, b.isNight, rate(b.rate), rate(b.minutes)]);

test('Standard parameters derive 200/210/270/390 without stored constants', () => {
  const p = parameters();
  assert.equal(rate(otRate('THUONG', true, false, p).rate), 2.0);
  assert.equal(rate(otRate('THUONG', true, true, p).rate), 2.1);
  assert.equal(rate(otRate('NGHI_TUAN', true, false, p).rate), 2.7);
  assert.equal(rate(otRate('LE_TET', true, false, p).rate), 3.9);
  const breakdown = otRate('THUONG', true, true, p).breakdown;
  assert.deepEqual([breakdown.dayRate, breakdown.nightAllowance, breakdown.addonRate, breakdown.daytimeRate], ['1.5', '0.3', '0.2', '1.5']);
  assert.deepEqual(breakdown.parameters.map(item => item.paramCode), ['OT_RATE_WEEKDAY', 'NIGHT_ALLOWANCE_RATE', 'NIGHT_OT_ADDON_RATE']);
});

test('TC-O01 / UAT-03: night OT on configured weekly rest day is 270%', () => {
  const result = day('2026-10-04', [ot('2026-10-04', '22:00', '2026-10-05', '00:00')]);
  assert.deepEqual(view(result), [['OT', 'NGHI_TUAN', true, 2.7, 120]]);
});

test('TC-O02: daytime then night OT on a weekday is 150% then 210%', () => {
  const result = day('2026-10-05', [ot('2026-10-05', '20:00', '2026-10-06', '00:00')]);
  assert.deepEqual(view(result), [['OT', 'THUONG', false, 1.5, 120], ['OT', 'THUONG', true, 2.1, 120]]);
  assert.equal(result.hasDayOt, true);
});

test('TC-O03: night-only OT on a weekday is 200%', () => {
  const result = day('2026-10-05', [ot('2026-10-05', '22:00', '2026-10-06', '00:00')]);
  assert.deepEqual(view(result), [['OT', 'THUONG', true, 2.0, 120]]);
  assert.equal(result.hasDayOt, false);
});

test('TC-O04 / UAT-06: Saturday 20:00 to Sunday 02:00 splits into 150 / 210 / 270', () => {
  const result = day('2026-10-03', [ot('2026-10-03', '20:00', '2026-10-04', '02:00')]);
  assert.deepEqual(result.segments.overtime.map(s => [s.calendarDate, s.dayType, s.isNight, Number(s.minutes)]), [
    ['2026-10-03', 'THUONG', false, 120], ['2026-10-03', 'THUONG', true, 120], ['2026-10-04', 'NGHI_TUAN', true, 120],
  ]);
  assert.deepEqual(view(result), [['OT', 'NGHI_TUAN', true, 2.7, 120], ['OT', 'THUONG', false, 1.5, 120], ['OT', 'THUONG', true, 2.1, 120]]);
  assert.ok(result.buckets.every(bucket => bucket.workDate === '2026-10-03'));
});

test('TC-O05 / O05b / O05c: only weekday OT raised to 160%', () => {
  const p = parameters({ OT_RATE_WEEKDAY: '1.6' });
  assert.equal(rate(otRate('THUONG', true, true, p).rate), 2.22);
  assert.equal(rate(otRate('THUONG', true, false, p).rate), 2.1);
  assert.equal(rate(otRate('THUONG', false, true, p).rate), 1.6);
  assert.equal(rate(otRate('NGHI_TUAN', true, false, p).rate), 2.7);
  assert.equal(rate(otRate('LE_TET', true, true, p).rate), 3.9);
});

test('Shift crossing into a holiday keeps the work date but labels pieces by calendar date', () => {
  const result = buildWorkDay({ employeeId: 'e1', orgUnitId: 'u1', workDate: '2026-08-31', overtime: [], regular: [{ startAt: at('2026-08-31', '22:00'), endAt: at('2026-09-01', '06:00') }], parameters: parameters(), calendar });
  assert.deepEqual(view(result), [['NIGHT_REGULAR', 'LE_TET', true, 0.3, 360], ['NIGHT_REGULAR', 'THUONG', true, 0.3, 120]]);
  assert.equal(dayTypeOf('2026-09-01', calendar), 'LE_TET');
});

test('TC-A02: regular C shift yields 8 night hours and no OT bucket', () => {
  const result = buildWorkDay({ employeeId: 'e1', orgUnitId: 'u1', workDate: '2026-10-06', overtime: [], regular: [{ startAt: at('2026-10-06', '22:00'), endAt: at('2026-10-07', '06:00') }], parameters: parameters(), calendar });
  assert.equal(result.buckets.filter(b => b.kind === 'OT').length, 0);
  assert.equal(result.buckets.reduce((total, b) => total + Number(b.minutes), 0), 480);
  assert.equal(Number(nightAllowancePay('25000', result.buckets).amount), 25000 * 0.3 * 8);
});

test('Only approved-and-worked pieces are paid; unapproved pieces stay in segments', () => {
  const result = day('2026-10-05', [ot('2026-10-05', '17:00', '2026-10-05', '19:50'), ot('2026-10-05', '19:50', '2026-10-05', '20:30', false)]);
  assert.deepEqual(view(result), [['OT', 'THUONG', false, 1.5, 170]]);
  assert.equal(result.segments.overtime.reduce((total, s) => total + Number(s.minutes), 0), 210);
});

test('Missing rate parameter blocks the work day with OT_RATE_PARAMETER_MISSING', () => {
  const p = parameters(); delete p.NIGHT_OT_ADDON_RATE;
  const result = day('2026-10-05', [ot('2026-10-05', '22:00', '2026-10-06', '00:00')], { parameters: p });
  assert.equal(result.buckets.length, 0);
  assert.equal(result.error.code, 'OT_RATE_PARAMETER_MISSING');
  assert.deepEqual(result.error.paramCodes, ['NIGHT_OT_ADDON_RATE']);
});

test('FIX-09 / TC-B01: two weekday OT hours at 100.000 đ and 150% pay 300.000 đ with trace', () => {
  const result = day('2026-10-05', [ot('2026-10-05', '17:00', '2026-10-05', '19:00')]);
  const pay = otPay('100000', result.buckets);
  assert.equal(pay.amount, '300000');
  assert.deepEqual([pay.lines[0].hours, pay.lines[0].rate, pay.lines[0].rateBreakdown.parameters[0].paramCode], ['2', '1.5', 'OT_RATE_WEEKDAY']);
});

test('hasDayOt is a work-day property: deciding it piece by piece gives a wrong rate', () => {
  // Night C shift with OT 04:00-06:00 continuing into daytime OT 06:00-08:00 on a weekday.
  const result = day('2026-10-05', [ot('2026-10-06', '04:00', '2026-10-06', '08:00')]);
  const night = result.buckets.find(b => b.isNight);
  assert.equal(rate(night.rate), 2.1);
  // Applying the rate before the work-day flag is known (only earlier pieces counted) would give 200%.
  const premature = otRate(night.dayType, true, false, parameters());
  assert.notEqual(premature.rate, night.rate);
});

test('Splitter cuts at 00:00, 06:00 and 22:00 Vietnam time', () => {
  const pieces = splitInterval({ startAt: at('2026-10-05', '21:00'), endAt: at('2026-10-06', '07:00') }, calendar);
  assert.deepEqual(pieces.map(p => [p.startAt.slice(11, 16), Number(p.minutes), p.isNight]), [['14:00', 60, false], ['15:00', 120, true], ['17:00', 360, true], ['23:00', 60, false]]);
});
