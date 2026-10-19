const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { readFileSync, rmSync } = require('node:fs');
const net = require('node:net');

process.loadEnvFile(resolve(__dirname, '../.env'));
const backend = resolve(__dirname, '..');
const root = resolve(backend, '..');
const workDate = '2026-10-10';

function correctionPayload(periodId, employeeId, orgUnitId, extra = {}) {
  return {
    periodId,
    kind: 'CORRECTION',
    reason: 'Biên bản điều chỉnh chấm công CA-2026-10-10',
    evidenceReference: 'BB-CA-2026-10-10',
    items: [{
      employeeId,
      orgUnitId,
      workDate,
      intervals: [{ startAt: '2026-10-10T08:00:00+07:00', endAt: '2026-10-10T18:30:00+07:00' }],
      excuseLateEarly: false,
    }],
    ...extra,
  };
}

test('Attendance corrections: isolated PostgreSQL and real HTTP', { timeout: 180000 }, async t => {
  const name = 'hrtp_corrections_' + randomUUID().replaceAll('-', '');
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient();
  const url = new URL(base); url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = { ...process.env, DATABASE_URL: url.href, SEED_ALLOW_ISOLATED: 'true', SEED_DATASET: 'foundation', DEMO_ACCOUNTS_FILE: credentialsPath };
  let server, db, serverLogs = '';

  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [[resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], ['prisma/seed.cjs']]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 45000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer();
    await new Promise(done => listener.listen(0, '127.0.0.1', done));
    const port = listener.address().port;
    await new Promise(done => listener.close(done));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', chunk => { serverLogs += chunk; });
    server.stderr.on('data', chunk => { serverLogs += chunk; });
    await new Promise((ready, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out\n' + serverLogs)), 20000);
      server.once('exit', code => { clearTimeout(timeout); reject(new Error('Server exited ' + code + '\n' + serverLogs)); });
      const poll = async () => {
        try {
          if ((await fetch('http://127.0.0.1:' + port + '/api/health')).ok) { clearTimeout(timeout); ready(); return; }
        } catch {}
        setTimeout(poll, 100);
      };
      poll();
    });

    async function request(path, cookie, body) {
      const form = body instanceof FormData;
      const response = await fetch('http://127.0.0.1:' + port + '/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { cookie } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: form ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      const contentType = response.headers.get('content-type') || '';
      const bodyValue = contentType.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
      return { status: response.status, body: bodyValue, cookie: response.headers.get('set-cookie')?.split(';')[0], contentType };
    }
    async function ok(path, cookie, body) {
      const response = await request(path, cookie, body);
      assert.ok(response.status >= 200 && response.status < 300, JSON.stringify({ status: response.status, body: response.body }) + (response.status >= 500 ? '\n' + serverLogs : ''));
      return response.body;
    }
    async function login(username) {
      const account = credentials.find(value => value.username === username);
      assert.ok(account, 'fixture account ' + username);
      const response = await request('/auth/login', null, { username, password: account.password });
      assert.equal(response.status, 201, JSON.stringify(response.body));
      return response.cookie;
    }
    const [tt, qd, kt, ad] = await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'ad.demo'].map(login));
    const context = await ok('/organization/context', kt);
    const unit = code => {
      const value = context.units.find(item => item.code === code);
      assert.ok(value, 'seed unit ' + code);
      return value;
    };
    const team = unit('NM-BN-D1-T1');
    const department = unit('NM-BN-D1');
    const company = unit('COMPANY');
    const remoteTeam = unit('NM-NA-D1-T1');
    const siteUnit = unit('NM-BN');
    const site = await db.site.findUniqueOrThrow({ where: { code: 'NM-BN' } });
    const author = await db.userAccount.findUniqueOrThrow({ where: { username: 'tt.bn' } });

    const people = {};
    for (const code of ['MAIN', 'SECOND', 'NIGHT', 'EXCLUDED']) {
      people[code] = (await ok('/employees', kt, {
        code: 'COR-' + code,
        fullName: 'Nhân sự giải trình ' + code,
        gender: 'OTHER', dob: '1985-01-01', hireDate: '2026-01-01', orgUnitId: team.id,
      })).employee;
    }
    const remote = (await ok('/employees', kt, {
      code: 'COR-REMOTE', fullName: 'Nhân sự ngoài phạm vi', gender: 'OTHER', dob: '1985-01-01', hireDate: '2026-01-01', orgUnitId: remoteTeam.id,
    })).employee;
    const shift = (await ok('/shifts/definitions', ad, {
      orgUnitId: company.id, code: 'COR-HC', name: 'Ca hành chính giải trình', kind: 'ADMINISTRATIVE',
      startTime: '08:00', endTime: '17:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 60, paidBreak: false,
    })).shift;
    const nightShift = (await ok('/shifts/definitions', ad, {
      orgUnitId: company.id, code: 'COR-NIGHT', name: 'Ca đêm giải trình', kind: 'NIGHT',
      startTime: '22:00', endTime: '06:00', crossesMidnight: true, breakStartOffset: 240, breakMinutes: 45, paidBreak: true,
    })).shift;
    async function approvePlan(employee, chosenShift = shift, chosenUnit = team) {
      let plan = (await ok('/shifts/plans', tt, { title: 'Lịch giải trình ' + employee.code, teamOrgUnitId: chosenUnit.id, slots: [{ workDate, shiftId: chosenShift.id, employeeIds: [employee.id] }] })).plan;
      plan = (await ok('/shifts/plans/' + plan.id + '/submit', tt, { revision: plan.revision })).plan;
      return (await ok('/shifts/plans/' + plan.id + '/approve', qd, { revision: plan.revision })).plan;
    }
    for (const person of [people.MAIN, people.SECOND, people.EXCLUDED]) await approvePlan(person);
    await approvePlan(people.NIGHT, nightShift);
    let period = (await ok('/periods', ad, { code: 'COR-OCT', scopeOrgUnitId: siteUnit.id, month: '2026-10', dateFrom: '2026-09-26', dateTo: '2026-10-25' })).period;
    period = (await ok('/periods/' + period.id + '/open', ad, { revision: period.revision })).period;

    await db.overtimeRequest.create({ data: {
      teamOrgUnitId: team.id, title: 'OT đã duyệt để đối chiếu điều chỉnh', workDate: new Date(workDate),
      startAt: new Date('2026-10-10T17:00:00+07:00'), endAt: new Date('2026-10-10T19:00:00+07:00'), requestedMinutes: 120,
      reason: 'Quyết định OT COR-2026-10-10', status: 'APPROVED', createdById: author.id,
      members: { create: { employeeId: people.MAIN.id, consentReference: 'CONSENT-COR-MAIN' } },
    } });
    function line(employee, date, time, direction) { return [employee.code, date, time, 'COR-DEVICE', direction].join(','); }
    async function upload(lines) {
      const form = new FormData();
      form.set('file', new Blob([lines.join('\n')], { type: 'text/csv' }), 'correction-source.csv');
      form.set('siteId', site.id); form.set('referencePeriodId', period.id);
      return ok('/attendance/imports', ad, form);
    }
    await upload([
      line(people.MAIN, workDate, '08:10:00', 'IN'), line(people.MAIN, workDate, '19:00:00', 'OUT'),
      line(people.SECOND, workDate, '08:10:00', 'IN'), line(people.SECOND, workDate, '17:00:00', 'OUT'),
      line(people.EXCLUDED, workDate, '08:10:00', 'IN'), line(people.EXCLUDED, workDate, '17:00:00', 'OUT'),
      line(people.NIGHT, workDate, '22:00:00', 'IN'), line(people.NIGHT, '2026-10-11', '06:00:00', 'OUT'),
    ]);
    await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: period.id });
    const sourcePunches = await db.rawPunch.findMany({ where: { employeeId: people.MAIN.id }, orderBy: { punchedAt: 'asc' }, select: { id: true, punchedAt: true, direction: true, deviceCode: true, source: true } });
    assert.equal(sourcePunches.length, 2);
    const board = async (cookie = tt) => ok('/attendance/board?periodId=' + period.id + '&pageSize=100', cookie);
    const boardDay = async (employeeId, cookie = tt) => (await board(cookie)).items.find(item => item.employee.id === employeeId && item.workDate === workDate);
    const actuals = async () => ok('/attendance/overtime-actuals?periodId=' + period.id + '&pageSize=100', tt);
    const mainBefore = await boardDay(people.MAIN.id);
    const actualBefore = (await actuals()).items.find(item => item.employee.id === people.MAIN.id && item.workDate === workDate);
    assert.deepEqual([mainBefore.workedMinutes, mainBefore.lateMinutes, mainBefore.earlyMinutes], [470, 10, 0]);
    assert.deepEqual([actualBefore.actualMinutes, actualBefore.eligibleMinutes], [120, 120]);
    const targetPage = await ok('/attendance/corrections/targets?periodId=' + period.id + '&workDate=' + workDate + '&orgUnitId=' + team.id + '&search=COR-MAIN&pageSize=20', tt);
    const mainTarget = targetPage.items.find(item => item.employee.id === people.MAIN.id);
    assert.ok(mainTarget, 'target picker returns only computed attendance dates in scope');
    assert.deepEqual([mainTarget.daily.workedMinutes, mainTarget.daily.lateMinutes, mainTarget.actual.eligibleMinutes], [470, 10, 120]);

    async function create(cookie, payload) { return request('/attendance/corrections', cookie, payload); }
    async function detail(id, cookie = tt) {
      const list = await ok('/attendance/corrections?periodId=' + period.id + '&pageSize=100', cookie);
      const found = list.items.find(item => item.id === id);
      assert.ok(found, 'correction is visible in its period list');
      return found;
    }
    async function submit(correction, cookie = tt) { return request('/attendance/corrections/' + correction.id + '/submit', cookie, { revision: correction.revision }); }
    let remoteScopeCookie;

    await t.test('requires explain permission, effective scope, and absence of employee exclusion', async () => {
      assert.equal((await create(kt, correctionPayload(period.id, people.MAIN.id, team.id))).status, 403, 'KT is read-only');
      assert.equal((await create(tt, correctionPayload(period.id, remote.id, remoteTeam.id))).status, 403, 'TT may not write outside team scope');
      await db.employeeExclusion.create({ data: { userAccountId: author.id, employeeId: people.EXCLUDED.id, effectiveFrom: new Date(workDate), effectiveTo: new Date(workDate) } });
      assert.equal((await create(tt, correctionPayload(period.id, people.EXCLUDED.id, team.id))).status, 403, 'excluded employee cannot be corrected');
      const expired = await db.userAccount.create({ data: { username: "expired.correction", displayName: "Quyền đã hết hạn", passwordHash: author.passwordHash, passwordChangedAt: new Date(), assignments: { create: { roleCode: "TT", scopeOrgUnitId: team.id, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-01-02") } } } });
      const expiredLogin = await request('/auth/login', null, { username: expired.username, password: credentials.find(value => value.username === 'tt.bn').password });
      assert.equal(expiredLogin.status, 201);
      assert.equal((await create(expiredLogin.cookie, correctionPayload(period.id, people.MAIN.id, team.id))).status, 403, 'expired role cannot create');
      const remoteScoped = await db.userAccount.create({ data: { username: 'remote.correction', displayName: 'Tổ trưởng ngoài phạm vi', passwordHash: author.passwordHash, passwordChangedAt: new Date(), assignments: { create: { roleCode: 'TT', scopeOrgUnitId: remoteTeam.id, effectiveFrom: new Date('2026-01-01') } } } });
      const remoteLogin = await request('/auth/login', null, { username: remoteScoped.username, password: credentials.find(value => value.username === 'tt.bn').password });
      assert.equal(remoteLogin.status, 201);
      remoteScopeCookie = remoteLogin.cookie;
      assert.equal((await create(remoteScopeCookie, correctionPayload(period.id, people.MAIN.id, team.id))).status, 403, 'a valid foreign-team TT cannot access this correction target');
    });

    let evidenceCorrection;
    await t.test('stores protected evidence and exposes it only with correction visibility', async () => {
      const created = await create(tt, correctionPayload(period.id, people.SECOND.id, team.id, { reason: 'Biên bản đính kèm COR-EVIDENCE' }));
      assert.equal(created.status, 201, JSON.stringify(created.body));
      evidenceCorrection = created.body.correction;
      const file = Buffer.from('%PDF-1.4\nBằng chứng giải trình COR-EVIDENCE\n%%EOF');
      const form = new FormData(); form.set('file', new Blob([file], { type: 'application/pdf' }), 'bien-ban.pdf');
      const attached = await request('/attendance/corrections/' + evidenceCorrection.id + '/evidence', tt, form);
      assert.equal(attached.status, 201, JSON.stringify(attached.body));
      evidenceCorrection = attached.body.correction;
      assert.equal(evidenceCorrection.evidence.length, 1);
      const evidence = evidenceCorrection.evidence[0];
      const downloaded = await request('/attendance/corrections/' + evidenceCorrection.id + '/evidence/' + evidence.id, tt);
      assert.equal(downloaded.status, 200); assert.deepEqual(downloaded.body, file);
      assert.equal((await request('/attendance/corrections/' + evidenceCorrection.id + '/evidence/' + evidence.id, null)).status, 401);
      assert.equal((await request('/attendance/corrections/' + evidenceCorrection.id + '/evidence/' + evidence.id, remoteScopeCookie)).status, 404, 'an out-of-scope user cannot discover protected correction evidence');
    });

    await t.test('rejects locked target, locked overnight source, and leaves failed incident bulk atomic', async () => {
      const sourceLock = await db.businessPeriod.create({ data: { code: 'COR-SOURCE-LOCK', scopeOrgUnitId: company.id, periodType: 'ATTENDANCE', dateFrom: new Date('2026-10-11'), dateTo: new Date('2026-10-11'), cutoffDay: 25, cutoffPolicyId: period.cutoffPolicyId, status: 'LOCKED' } });
      const atomic = correctionPayload(period.id, people.MAIN.id, team.id, {
        reason: 'Biên bản atomic COR-ATOMIC', incidentReference: 'INC-COR-ATOMIC',
        items: [
          correctionPayload(period.id, people.MAIN.id, team.id).items[0],
          { employeeId: people.NIGHT.id, orgUnitId: team.id, workDate, intervals: [{ startAt: '2026-10-10T22:00:00+07:00', endAt: '2026-10-11T06:00:00+07:00' }], excuseLateEarly: false },
        ],
      });
      const denied = await create(tt, atomic);
      assert.equal(denied.status, 409, 'a locked source calendar date rejects the whole request');
      const atomicRows = (await ok('/attendance/corrections?periodId=' + period.id + '&pageSize=100', tt)).items.filter(item => item.reason === atomic.reason);
      assert.equal(atomicRows.length, 0, 'atomic failure persists no partial correction');
      await db.businessPeriod.update({ where: { id: sourceLock.id }, data: { status: 'OPEN' } });
      await db.businessPeriod.update({ where: { id: period.id }, data: { status: 'CLOSED' } });
      assert.equal((await create(tt, correctionPayload(period.id, people.MAIN.id, team.id, { reason: 'Biên bản mục tiêu đóng' }))).status, 409, 'closed target rejects writes');
      await db.businessPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
    });

    await t.test('return/edit/resubmit/reject remains non-applying', async () => {
      const created = (await create(tt, correctionPayload(period.id, people.SECOND.id, team.id, { reason: 'Biên bản bị trả COR-RETURN' }))).body.correction;
      const pending = (await submit(created)).body.correction;
      const returned = await request('/attendance/corrections/' + pending.id + '/return', qd, { revision: pending.revision, reason: 'Thiếu số hiệu chứng từ' });
      assert.equal(returned.status, 201, JSON.stringify(returned.body)); assert.equal(returned.body.correction.status, 'RETURNED');
      assert.equal((await boardDay(people.SECOND.id)).adjustmentId, null, 'returned correction has no payroll effect');
      const edited = await request('/attendance/corrections/' + pending.id + '/update', tt, { ...correctionPayload(period.id, people.SECOND.id, team.id, { reason: 'Biên bản bổ sung COR-RETURN', revision: returned.body.correction.revision }) });
      assert.equal(edited.status, 201, JSON.stringify(edited.body));
      const resubmitted = (await submit(edited.body.correction)).body.correction;
      const rejected = await request('/attendance/corrections/' + resubmitted.id + '/reject', qd, { revision: resubmitted.revision, reason: 'Không đủ căn cứ điều chỉnh' });
      assert.equal(rejected.status, 201, JSON.stringify(rejected.body)); assert.equal(rejected.body.correction.status, 'REJECTED');
      assert.equal((await boardDay(people.SECOND.id)).adjustmentId, null, 'rejected correction never applies');
    });

    await t.test('approves exactly once, replaces calculated regular/OT results, persists on AD reprocess, and preserves raw punches', async () => {
      const created = (await create(tt, correctionPayload(period.id, people.MAIN.id, team.id))).body.correction;
      const pending = (await submit(created)).body.correction;
      assert.equal((await request('/attendance/corrections/' + pending.id + '/approve', tt, { revision: pending.revision })).status, 403, 'TT cannot self-review');
      const reviews = await Promise.all([0, 1].map(() => request('/attendance/corrections/' + pending.id + '/approve', qd, { revision: pending.revision })));
      assert.deepEqual(reviews.map(response => response.status).sort((a, b) => a - b), [201, 409], 'concurrent review consumes one revision exactly once');
      const approved = reviews.find(response => response.status === 201).body.correction;
      assert.equal(approved.status, 'APPROVED');
      const day = await boardDay(people.MAIN.id);
      const actual = (await actuals()).items.find(item => item.employee.id === people.MAIN.id && item.workDate === workDate);
      assert.deepEqual([day.workedMinutes, day.lateMinutes, day.earlyMinutes], [480, 0, 0]);
      assert.equal(day.adjustmentId, approved.items[0].id); assert.equal(day.correctionId, approved.id);
      assert.deepEqual([actual.actualMinutes, actual.eligibleMinutes], [90, 90]);
      assert.equal(actual.adjustmentId, approved.items[0].id); assert.equal(actual.correctionId, approved.id);
      await ok('/attendance/process', ad, { siteId: site.id, referencePeriodId: period.id });
      const reprocessed = await boardDay(people.MAIN.id);
      assert.deepEqual([reprocessed.workedMinutes, reprocessed.lateMinutes, reprocessed.earlyMinutes, reprocessed.adjustmentId, reprocessed.correctionId], [480, 0, 0, approved.items[0].id, approved.id]);
      const rawAfter = await db.rawPunch.findMany({ where: { employeeId: people.MAIN.id }, orderBy: { punchedAt: 'asc' }, select: { id: true, punchedAt: true, direction: true, deviceCode: true, source: true } });
      assert.deepEqual(rawAfter, sourcePunches, 'approval and reprocessing never rewrite immutable punch sources');
      const correction = await detail(approved.id);
      assert.equal(correction.history.filter(row => row.action === 'APPROVE').length, 1, 'only one approval history record exists');
      const explanationDraft = (await create(tt, {
        periodId: period.id,
        kind: 'EXPLANATION',
        reason: 'Giải trình bổ sung sau điều chỉnh COR-EXPLANATION',
        evidenceReference: 'BB-GT-2026-10-10',
        items: [{ employeeId: people.MAIN.id, orgUnitId: team.id, workDate, intervals: null, excuseLateEarly: false }],
      })).body.correction;
      assert.equal(explanationDraft.items[0].intervals, null, 'explanation preserves its null-interval evidence record');
      const explanationPending = (await submit(explanationDraft)).body.correction;
      const explanationApproved = (await request('/attendance/corrections/' + explanationPending.id + '/approve', qd, { revision: explanationPending.revision })).body.correction;
      const explainedDay = await boardDay(people.MAIN.id);
      const explainedActual = (await actuals()).items.find(item => item.employee.id === people.MAIN.id && item.workDate === workDate);
      assert.deepEqual([explainedDay.workedMinutes, explainedDay.lateMinutes, explainedDay.earlyMinutes], [480, 0, 0], 'later explanation inherits the approved correction intervals');
      assert.deepEqual([explainedActual.actualMinutes, explainedActual.eligibleMinutes], [90, 90], 'later explanation does not discard corrected OT presence');
      assert.equal(explainedDay.adjustmentId, explanationApproved.items[0].id);
      assert.equal(explainedActual.adjustmentId, explanationApproved.items[0].id);
    });

    await t.test('stale source is rejected and requires editing/resubmission before review', async () => {
      const created = (await create(tt, correctionPayload(period.id, people.NIGHT.id, team.id, {
        reason: 'Biên bản nguồn thay đổi COR-STALE',
        items: [{ employeeId: people.NIGHT.id, orgUnitId: team.id, workDate, intervals: [{ startAt: '2026-10-10T22:00:00+07:00', endAt: '2026-10-11T06:00:00+07:00' }], excuseLateEarly: false }],
      }))).body.correction;
      const pending = (await submit(created)).body.correction;
      await upload([line(people.NIGHT, '2026-10-11', '06:05:00', 'OUT')]);
      const stale = await request('/attendance/corrections/' + pending.id + '/approve', qd, { revision: pending.revision });
      assert.equal(stale.status, 409, 'review recomputes and rejects changed attendance source');
      const staleRecord = await detail(pending.id);
      assert.equal(staleRecord.status, 'PENDING', 'a stale failed review does not mutate the pending correction');
      const returned = await request('/attendance/corrections/' + pending.id + '/return', qd, { revision: staleRecord.revision, reason: 'Nguồn chấm công đã thay đổi sau khi gửi' });
      assert.equal(returned.status, 201, JSON.stringify(returned.body));
      assert.equal(returned.body.correction.status, 'RETURNED');
      const edited = await request('/attendance/corrections/' + pending.id + '/update', tt, {
        ...correctionPayload(period.id, people.NIGHT.id, team.id, {
          reason: 'Biên bản nguồn đã cập nhật COR-STALE', revision: returned.body.correction.revision,
          items: [{ employeeId: people.NIGHT.id, orgUnitId: team.id, workDate, intervals: [{ startAt: '2026-10-10T22:00:00+07:00', endAt: '2026-10-11T06:05:00+07:00' }], excuseLateEarly: false }],
        }),
      });
      assert.equal(edited.status, 201, JSON.stringify(edited.body));
      const resubmitted = (await submit(edited.body.correction)).body.correction;
      assert.equal((await request('/attendance/corrections/' + resubmitted.id + '/approve', qd, { revision: resubmitted.revision })).status, 201, 'edited source snapshot may be resubmitted and approved');
    });
  } finally {
    if (server && server.exitCode === null) { server.kill(); await new Promise(done => server.once('exit', done)); }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect();
    rmSync(credentialsPath, { force: true });
  }
});
