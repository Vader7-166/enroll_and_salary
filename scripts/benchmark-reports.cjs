// NFR-12: company-wide monthly report for N employees (default 3.000) must finish within 2 minutes.
// Builds an isolated database (migrate + seed), bulk-inserts approved schedules and daily attendance for one
// 26-day site period with SQL (all N people in the site's teams; periods are per site), then exports ATTENDANCE_MONTHLY (XLSX) as KT over real HTTP and times it.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { withServer } = require('../backend/test/http-harness.cjs');

const count = Number(process.argv[2] ?? 3000);
const LIMIT_MS = 120000;

withServer('benchmark_reports', async ({ db: client, ok, login, url }) => {
  // Bulk seeding needs a longer socket timeout than the interactive default.
  const long = new URL(url); long.searchParams.set('socket_timeout', '600'); long.searchParams.set('pool_timeout', '60');
  const db = new PrismaClient({ datasourceUrl: long.href });
  void client;
  const [kt, ad] = await Promise.all(['kt.all', 'ad.demo'].map(name => login(name)));
  const company = await db.orgUnit.findUniqueOrThrow({ where: { code: 'COMPANY' } });
  const site = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN' } });
  const actor = await db.userAccount.findUniqueOrThrow({ where: { username: 'kt.all' } });
  const shift = (await ok('/shifts/definitions', ad, { orgUnitId: company.id, code: 'BM', name: 'Ca benchmark', kind: 'DAY', startTime: '08:00', endTime: '16:30', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: false })).shift;
  const period = (await ok('/periods', ad, { code: 'BM-OCT', scopeOrgUnitId: site.id, month: '2026-10', dateFrom: '2026-09-26', dateTo: '2026-10-25' })).period;
  await ok('/periods/' + period.id + '/open', ad, { revision: period.revision });
  const started = Date.now();
  await db.$executeRawUnsafe(`CREATE TEMP TABLE bm_team AS SELECT org_unit_id, row_number() OVER (ORDER BY org_unit_id) - 1 AS slot FROM org_unit_version WHERE unit_type = 'TEAM' AND effective_to IS NULL AND site_id = (SELECT site_id FROM org_unit_version WHERE org_unit_id = '${site.id}' LIMIT 1)`);
  const slots = Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM bm_team`))[0].n);
  await db.$executeRawUnsafe(`INSERT INTO employee (id, code, full_name, gender, dob, hire_date) SELECT gen_random_uuid(), 'BM' || lpad(i::text, 5, '0'), 'Nhân sự benchmark ' || i, 'OTHER', DATE '1990-01-01', DATE '2026-01-05' FROM generate_series(1, ${count}) i`);
  await db.$executeRawUnsafe(`INSERT INTO org_assignment (id, employee_id, org_unit_id, is_primary, allocation_ratio, effective_from)
    SELECT gen_random_uuid(), e.id, t.org_unit_id, true, 100, DATE '2026-01-05' FROM (SELECT id, row_number() OVER (ORDER BY code) AS n FROM employee WHERE code LIKE 'BM%') e JOIN bm_team t ON t.slot = e.n % ${slots}`);
  await db.$executeRawUnsafe(`INSERT INTO shift_plan (id, team_org_unit_id, title, status, revision, created_by_id, updated_at) SELECT gen_random_uuid(), org_unit_id, 'Benchmark', 'APPROVED', 1, '${actor.id}', now() FROM bm_team`);
  await db.$executeRawUnsafe(`INSERT INTO shift_schedule (id, plan_id, employee_id, work_date, shift_id, start_at, end_at, work_minutes)
    SELECT gen_random_uuid(), p.id, a.employee_id, d::date, '${shift.id}', (d::date + TIME '08:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', (d::date + TIME '16:30') AT TIME ZONE 'Asia/Ho_Chi_Minh', 480
    FROM org_assignment a JOIN employee e ON e.id = a.employee_id AND e.code LIKE 'BM%' JOIN shift_plan p ON p.team_org_unit_id = a.org_unit_id AND p.title = 'Benchmark'
    CROSS JOIN generate_series(DATE '2026-09-28', DATE '2026-10-25', INTERVAL '1 day') d WHERE extract(isodow FROM d) < 7`);
  await db.$executeRawUnsafe(`INSERT INTO daily_attendance (id, schedule_id, employee_id, org_unit_id, period_id, work_date, status, worked_minutes, day_minutes, night_minutes, late_minutes, early_minutes, absent, work_units, segments, leave, rules)
    SELECT gen_random_uuid(), s.id, s.employee_id, p.team_org_unit_id, '${period.id}', s.work_date, 'OK', 480, 480, 0, 0, 0, false, 1, '[]', '{}', '{}' FROM shift_schedule s JOIN shift_plan p ON p.id = s.plan_id WHERE p.title = 'Benchmark'`);
  const days = Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM daily_attendance WHERE period_id = '${period.id}'`))[0].n);
  console.log(`Seeded ${count} employees / ${days} attendance days across ${slots} teams in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const exportStart = Date.now();
  const { run } = await ok('/reports/ATTENDANCE_MONTHLY/export', kt, { params: { periodId: period.id }, format: 'XLSX' });
  let done;
  while (Date.now() - exportStart < LIMIT_MS * 2) {
    done = (await ok('/reports/runs/' + run.id, kt)).run;
    if (done.status !== 'RUNNING') break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const elapsed = Date.now() - exportStart;
  console.log(`ATTENDANCE_MONTHLY XLSX: ${done.status}, ${done.rowCount} rows, server ${done.durationMs} ms, end-to-end ${elapsed} ms (limit ${LIMIT_MS} ms)`);
  assert.equal(done.status, 'COMPLETED', JSON.stringify(done));
  assert.ok(done.rowCount >= count, 'every employee present');
  await db.$disconnect();
  assert.ok(elapsed <= LIMIT_MS, 'NFR-12 exceeded');
}).catch(error => { console.error(error); process.exitCode = 1; });
