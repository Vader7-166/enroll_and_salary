// Import cost when shift plans are approved for whole periods ahead, as in real operation.
// scripts/benchmark-attendance.cjs only schedules three days, which hid that every import reprocesses all schedules of the
// adjacent periods inside one transaction (timeout 90 s): a ~1.100-person site with two months of approved schedules failed.
//   node scripts/benchmark-attendance-month.cjs [employees=1100]
// Isolated database over real HTTP. Prints one JSON line; exit 1 when an import exceeds the budget.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { withServer } = require('../backend/test/http-harness.cjs');

const EMPLOYEES = Number(process.argv[2] ?? 1100);
// --with-history: every other already-ended day of the window also has punches (≈ 75k), processed once before measuring,
// as in a site whose earlier weeks were imported. Without it only the measured days have punches.
const WITH_HISTORY = process.argv.includes('--with-history');
// Two thirds of the 90 s interactive-transaction timeout of AttendanceService. The first import is the worst case: it
// writes every already-ended day of both periods (≈ 40k absent days here) for the first time.
const BUDGET_MS = 60000;

withServer('benchmark_attendance_month', async ({ request, ok, login, url }) => {
  let historyProcessMs = null;
  const long = new URL(url); long.searchParams.set('socket_timeout', '600'); long.searchParams.set('pool_timeout', '60');
  const db = new PrismaClient({ datasourceUrl: long.href });
  const ad = await login('ad.demo');
  const company = await db.orgUnit.findUniqueOrThrow({ where: { code: 'COMPANY' } });
  const siteUnit = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN' } });
  const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
  const actor = await db.userAccount.findUniqueOrThrow({ where: { username: 'ad.demo' } });
  const shift = (await ok('/shifts/definitions', ad, { orgUnitId: company.id, code: 'BM', name: 'Ca benchmark tháng', kind: 'DAY', startTime: '08:00', endTime: '16:30', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: false })).shift;
  const periods = [];
  for (const [code, month] of [['BM-OCT', '2026-10'], ['BM-NOV', '2026-11']]) {
    const period = (await ok('/periods', ad, { code, scopeOrgUnitId: siteUnit.id, month })).period;
    await ok('/periods/' + period.id + '/open', ad, { revision: period.revision });
    periods.push(period);
  }
  await db.$executeRawUnsafe(`CREATE TEMP TABLE bm_team AS SELECT org_unit_id, row_number() OVER (ORDER BY org_unit_id) - 1 AS slot FROM org_unit_version WHERE unit_type = 'TEAM' AND effective_to IS NULL AND site_id = '${site.id}'`);
  const slots = Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM bm_team`))[0].n);
  await db.$executeRawUnsafe(`INSERT INTO employee (id, code, full_name, gender, dob, hire_date) SELECT gen_random_uuid(), 'BM' || lpad(i::text, 5, '0'), 'Nhân sự benchmark tháng ' || i, 'OTHER', DATE '1990-01-01', DATE '2026-01-05' FROM generate_series(1, ${EMPLOYEES}) i`);
  await db.$executeRawUnsafe(`INSERT INTO org_assignment (id, employee_id, org_unit_id, is_primary, allocation_ratio, effective_from)
    SELECT gen_random_uuid(), e.id, t.org_unit_id, true, 100, DATE '2026-01-05' FROM (SELECT id, row_number() OVER (ORDER BY code) AS n FROM employee WHERE code LIKE 'BM%') e JOIN bm_team t ON t.slot = e.n % ${slots}`);
  await db.$executeRawUnsafe(`INSERT INTO shift_plan (id, team_org_unit_id, title, status, revision, created_by_id, updated_at) SELECT gen_random_uuid(), org_unit_id, 'Benchmark tháng', 'APPROVED', 1, '${actor.id}', now() FROM bm_team`);
  // Both periods fully scheduled in advance (26/09 → 25/11), like monthly approved plans.
  await db.$executeRawUnsafe(`INSERT INTO shift_schedule (id, plan_id, employee_id, work_date, shift_id, start_at, end_at, work_minutes)
    SELECT gen_random_uuid(), p.id, a.employee_id, d::date, '${shift.id}', (d::date + TIME '08:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', (d::date + TIME '16:30') AT TIME ZONE 'Asia/Ho_Chi_Minh', 480
    FROM org_assignment a JOIN employee e ON e.id = a.employee_id AND e.code LIKE 'BM%' JOIN shift_plan p ON p.team_org_unit_id = a.org_unit_id AND p.title = 'Benchmark tháng'
    CROSS JOIN generate_series(DATE '2026-09-26', DATE '2026-11-25', INTERVAL '1 day') d`);
  const schedules = Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM shift_schedule`))[0].n);
  if (WITH_HISTORY) {
    const [{ id: batchId }] = await db.$queryRawUnsafe(`INSERT INTO attendance_import (id, site_id, reference_period_id, file_name, file_hash, mapping, status, total_rows, summary, errors, created_by_id)
      VALUES (gen_random_uuid(), '${site.id}', '${periods[0].id}', 'history.sql', repeat('0', 64), '{}', 'ACCEPTED', 0, '{}', '[]', '${actor.id}') RETURNING id::text`);
    await db.$executeRawUnsafe(`INSERT INTO raw_punch (id, site_id, employee_id, punched_at, device_code, direction, batch_id, row_number, source)
      SELECT gen_random_uuid(), '${site.id}', employee_id, at, 'MAY01', dir, '${batchId}', row_number() OVER (), '[]'::jsonb FROM (
        SELECT employee_id, start_at - INTERVAL '7 minutes' AS at, 'IN' AS dir FROM shift_schedule WHERE work_date BETWEEN DATE '2026-09-26' AND DATE '2026-10-31' AND work_date NOT IN (DATE '2026-10-05', DATE '2026-10-06')
        UNION ALL SELECT employee_id, end_at + INTERVAL '5 minutes', 'OUT' FROM shift_schedule WHERE work_date BETWEEN DATE '2026-09-26' AND DATE '2026-10-31' AND work_date NOT IN (DATE '2026-10-05', DATE '2026-10-06')) p`);
    const started = Date.now();
    await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: periods[0].id });
    historyProcessMs = Date.now() - started;
  }
  const punchesBefore = Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM raw_punch`))[0].n);
  await db.$disconnect();

  const code = i => 'BM' + String(i).padStart(5, '0');
  const upload = async (date, label) => {
    const rows = Array.from({ length: EMPLOYEES }, (_, i) => [[code(i + 1), date, '07:5' + (i % 10) + ':00', 'MAY01', 'IN'], [code(i + 1), date, '16:3' + (i % 10) + ':00', 'MAY01', 'OUT']]).flat();
    const form = new FormData();
    form.set('file', new Blob([rows.map(row => row.join(',')).join('\n')]), label + '.csv');
    form.set('siteId', site.id); form.set('referencePeriodId', periods[0].id);
    const started = Date.now();
    const result = await request('/attendance/imports', ad, form);
    const ms = Date.now() - started;
    assert.ok(result.status >= 200 && result.status < 300, label + ' HTTP ' + result.status + ' ' + JSON.stringify(result.body).slice(0, 300));
    return { rows: rows.length, ms, summary: result.body.batch?.summary };
  };
  const first = await upload('2026-10-05', 'day-1');
  const second = await upload('2026-10-06', 'day-2');
  const result = { employees: EMPLOYEES, schedules, withHistory: WITH_HISTORY, punchesBefore, historyProcessMs, budgetMs: BUDGET_MS, firstImport: { ms: first.ms, processed: first.summary?.processed }, secondImport: { ms: second.ms, processed: second.summary?.processed },
    pass: first.ms <= BUDGET_MS && second.ms <= BUDGET_MS, node: process.version };
  console.log(JSON.stringify(result));
  assert.ok(first.summary?.processed >= first.rows * 0.99, 'every punch paired: ' + JSON.stringify(first.summary));
  if (!result.pass) process.exitCode = 1;
}, WITH_HISTORY ? { env: { ATTENDANCE_TRANSACTION_TIMEOUT_MS: '900000' } } : {}).catch(error => { console.error(error); process.exitCode = 1; });
