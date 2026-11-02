// NFR-08 / NFR-09 / NFR-13 on an isolated database over real HTTP:
//   NFR-08  pairing + splitting after importing one day of the largest site (≈ 4.500 punches)   ≤ 5 min
//   NFR-13  validating and answering an import of a 10.000-row file                            ≤ 1 min
//           measured twice: a file rejected by validation (last row unknown) and a valid file stored + paired end-to-end
//   NFR-09  p95 of the attendance board for a team (TT) ≤ 2 s and a workshop (QĐ) ≤ 4 s
// Employees, approved plans and schedules are bulk-inserted with SQL; the imports and queries go through the API.
// Prints one JSON line; exit 1 when a threshold is exceeded.
const assert = require('node:assert/strict');
const os = require('node:os');
const { PrismaClient } = require('@prisma/client');
const { withServer } = require('../backend/test/http-harness.cjs');

const EMPLOYEES = Number(process.argv[2] ?? 2500);
const LIMITS = { nfr08: 300000, nfr13: 60000, nfr09Team: 2000, nfr09Workshop: 4000 };
const p95 = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]; };

withServer('benchmark_attendance', async ({ request, ok, login, url }) => {
  const long = new URL(url); long.searchParams.set('socket_timeout', '600'); long.searchParams.set('pool_timeout', '60');
  const db = new PrismaClient({ datasourceUrl: long.href });
  const [ad, tt, qd] = await Promise.all(['ad.demo', 'tt.bn', 'qd.bn'].map(name => login(name)));
  const company = await db.orgUnit.findUniqueOrThrow({ where: { code: 'COMPANY' } });
  const siteUnit = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN' } });
  const team = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T1' } });
  const workshop = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1' } });
  const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
  const actor = await db.userAccount.findUniqueOrThrow({ where: { username: 'ad.demo' } });
  const shift = (await ok('/shifts/definitions', ad, { orgUnitId: company.id, code: 'BA', name: 'Ca benchmark', kind: 'DAY', startTime: '08:00', endTime: '16:30', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 30, paidBreak: false })).shift;
  const period = (await ok('/periods', ad, { code: 'BA-OCT', scopeOrgUnitId: siteUnit.id, month: '2026-10', dateFrom: '2026-09-26', dateTo: '2026-10-25' })).period;
  await ok('/periods/' + period.id + '/open', ad, { revision: period.revision });

  await db.$executeRawUnsafe(`CREATE TEMP TABLE ba_team AS SELECT org_unit_id, row_number() OVER (ORDER BY org_unit_id) - 1 AS slot FROM org_unit_version WHERE unit_type = 'TEAM' AND effective_to IS NULL AND site_id = (SELECT site_id FROM org_unit_version WHERE org_unit_id = '${siteUnit.id}' LIMIT 1)`);
  const slots = Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ba_team`))[0].n);
  await db.$executeRawUnsafe(`INSERT INTO employee (id, code, full_name, gender, dob, hire_date) SELECT gen_random_uuid(), 'BA' || lpad(i::text, 5, '0'), 'Nhân sự chấm công ' || i, 'OTHER', DATE '1990-01-01', DATE '2026-01-05' FROM generate_series(1, ${EMPLOYEES}) i`);
  await db.$executeRawUnsafe(`INSERT INTO org_assignment (id, employee_id, org_unit_id, is_primary, allocation_ratio, effective_from)
    SELECT gen_random_uuid(), e.id, t.org_unit_id, true, 100, DATE '2026-01-05' FROM (SELECT id, row_number() OVER (ORDER BY code) AS n FROM employee WHERE code LIKE 'BA%') e JOIN ba_team t ON t.slot = e.n % ${slots}`);
  await db.$executeRawUnsafe(`INSERT INTO shift_plan (id, team_org_unit_id, title, status, revision, created_by_id, updated_at) SELECT gen_random_uuid(), org_unit_id, 'Benchmark', 'APPROVED', 1, '${actor.id}', now() FROM ba_team`);
  await db.$executeRawUnsafe(`INSERT INTO shift_schedule (id, plan_id, employee_id, work_date, shift_id, start_at, end_at, work_minutes)
    SELECT gen_random_uuid(), p.id, a.employee_id, d::date, '${shift.id}', (d::date + TIME '08:00') AT TIME ZONE 'Asia/Ho_Chi_Minh', (d::date + TIME '16:30') AT TIME ZONE 'Asia/Ho_Chi_Minh', 480
    FROM org_assignment a JOIN employee e ON e.id = a.employee_id AND e.code LIKE 'BA%' JOIN shift_plan p ON p.team_org_unit_id = a.org_unit_id AND p.title = 'Benchmark'
    CROSS JOIN generate_series(DATE '2026-10-05', DATE '2026-10-07', INTERVAL '1 day') d`);
  await db.$disconnect();

  const code = i => 'BA' + String(i).padStart(5, '0');
  const punches = (days, people) => days.flatMap(date => Array.from({ length: people }, (_, i) => [[code(i + 1), date, '07:5' + (i % 10) + ':00', 'MAY01', 'IN'], [code(i + 1), date, '16:3' + (i % 10) + ':00', 'MAY01', 'OUT']]).flat());
  const upload = async (rows, name, expectRejected = false) => {
    const form = new FormData();
    form.set('file', new Blob([rows.map(row => row.join(',')).join('\n')]), name);
    form.set('siteId', site.id); form.set('referencePeriodId', period.id);
    const started = Date.now();
    const result = await request('/attendance/imports', ad, form);
    const ms = Date.now() - started;
    if (expectRejected) return { ms, rows: rows.length, status: result.status, errors: result.body.batch?.errors?.length ?? result.body.errors?.length ?? null };
    assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.body).slice(0, 500));
    return { ms, rows: rows.length, summary: result.body.batch?.summary ?? result.body.summary };
  };
  const day = await upload(punches(['2026-10-05'], Math.min(EMPLOYEES, 2250)), 'one-day.csv');
  const tenThousand = punches(['2026-10-06', '2026-10-07'], EMPLOYEES);
  const rejected = await upload([...tenThousand.slice(0, -1), ['KHONGTONTAI', '2026-10-07', '16:35:00', 'MAY01', 'OUT']], 'ten-thousand-invalid.csv', true);
  const large = await upload(tenThousand, 'ten-thousand.csv');

  const board = async (cookie, orgUnitId) => {
    const times = [];
    for (let i = 0; i < 20; i++) {
      const started = Date.now();
      await ok('/attendance/board?' + new URLSearchParams({ periodId: period.id, orgUnitId, pageSize: '100' }), cookie);
      times.push(Date.now() - started);
    }
    return p95(times);
  };
  const teamP95 = await board(tt, team.id), workshopP95 = await board(qd, workshop.id);
  const result = {
    employees: EMPLOYEES, nfr08: { rows: day.rows, ms: day.ms, processed: day.summary?.processed, limitMs: LIMITS.nfr08, pass: day.ms <= LIMITS.nfr08 },
    nfr13: { rows: large.rows, validationRejectMs: rejected.ms, validationStatus: rejected.status, fullImportMs: large.ms, processed: large.summary?.processed, limitMs: LIMITS.nfr13,
      passValidation: rejected.ms <= LIMITS.nfr13, passFullImport: large.ms <= LIMITS.nfr13, pass: rejected.ms <= LIMITS.nfr13 && large.ms <= LIMITS.nfr13 },
    nfr09: { teamP95Ms: teamP95, workshopP95Ms: workshopP95, limitTeamMs: LIMITS.nfr09Team, limitWorkshopMs: LIMITS.nfr09Workshop, pass: teamP95 <= LIMITS.nfr09Team && workshopP95 <= LIMITS.nfr09Workshop },
    node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length,
  };
  console.log(JSON.stringify(result));
  assert.ok(day.summary?.processed >= day.rows / 2 * 0.99, 'one-day import paired every shift: ' + JSON.stringify(day.summary));
  if (!result.nfr08.pass || !result.nfr13.pass || !result.nfr09.pass) process.exitCode = 1;
}).catch(error => { console.error(error); process.exitCode = 1; });
