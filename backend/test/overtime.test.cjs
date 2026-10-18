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

test('Overtime requests on isolated PostgreSQL and HTTP API', { timeout: 180000 }, async t => {
  const name = 'hrtp_overtime_' + randomUUID().replaceAll('-', '');
  const base = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
  const admin = new PrismaClient();
  const url = new URL(base); url.pathname = '/' + name;
  const credentialsPath = resolve(root, '.local', name + '.json');
  const env = { ...process.env, DATABASE_URL: url.href, SEED_ALLOW_ISOLATED: 'true', SEED_DATASET: 'foundation', DEMO_ACCOUNTS_FILE: credentialsPath };
  let server, db;
  try {
    await admin.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
    for (const args of [[resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], ['prisma/seed.cjs']]) {
      const result = spawnSync(process.execPath, args, { cwd: backend, env, encoding: 'utf8', timeout: 45000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
    }
    db = new PrismaClient({ datasourceUrl: url.href });
    const credentials = JSON.parse(readFileSync(credentialsPath, 'utf8')).accounts;
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    server = spawn(process.execPath, ['dist/main.js'], { cwd: backend, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((ready, reject) => {
      let logs = ''; const timer = setTimeout(() => reject(new Error('API readiness: ' + logs)), 15000);
      const receive = chunk => { logs += chunk; if (logs.includes('API ready at')) { clearTimeout(timer); ready(); } };
      server.stdout.on('data', receive); server.stderr.on('data', receive);
      server.once('exit', code => { clearTimeout(timer); reject(new Error('API exited ' + code + ': ' + logs)); });
    });
    async function requestCall(path, cookie, body) {
      const response = await fetch('http://127.0.0.1:' + port + '/api' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    }
    async function ok(path, cookie, body) {
      const response = await requestCall(path, cookie, body);
      assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response));
      return response.body;
    }
    const cookies = {};
    for (const username of ['tt.bn', 'qd.bn', 'kt.all', 'ad.demo']) {
      const account = credentials.find(candidate => candidate.username === username);
      const response = await requestCall('/auth/login', null, { username, password: account.password });
      assert.equal(response.status, 201); cookies[username] = response.cookie;
    }
    const tt = cookies['tt.bn']; const qd = cookies['qd.bn']; const kt = cookies['kt.all']; const ad = cookies['ad.demo'];
    const year = new Date().getUTCFullYear() + 1;
    const date = (month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const context = await ok('/overtime/context', tt);
    const source = context.units.find(unit => unit.code === 'NM-BN-D1-T1');
    const other = await db.orgUnit.findUnique({ where: { code: "NM-BN-D1-T2" } });
    const remote = await db.orgUnit.findUnique({ where: { code: "NM-NA-D1-T1" } });
    const site = await db.orgUnit.findUnique({ where: { code: "NM-BN" } });
    assert.ok(source && other && remote && site);
    assert.equal(context.canPlan, true); assert.equal(context.canApprove, false);
    const qdContext = await ok('/overtime/context', qd);
    assert.equal(qdContext.canPlan, false); assert.equal(qdContext.canApprove, true);
    assert.equal((await requestCall('/overtime/context', ad)).status, 403);

    const workers = {};
    for (const code of ['FLOW', 'REJECT', 'BOUNDARY', 'CAP', 'LOCK', 'HISTORY', 'SHIFT']) {
      workers[code] = (await ok('/employees', kt, {
        code: 'OT-' + code, fullName: 'Nhân sự kiểm chứng tăng ca ' + code,
        gender: 'OTHER', dob: '1985-01-01', hireDate: `${year - 1}-01-01`, orgUnitId: source.id,
      })).employee;
    }
    const foreign = (await ok('/employees', kt, {
      code: 'OT-FOREIGN', fullName: 'Nhân sự tổ khác', gender: 'OTHER', dob: '1985-01-01', hireDate: `${year - 1}-01-01`, orgUnitId: other.id,
    })).employee;

    function input(employeeId, workDate = date(6, 10), overrides = {}) {
      return {
        teamOrgUnitId: source.id, title: 'Tăng ca kiểm chứng', workDate,
        startAt: `${workDate}T17:00:00+07:00`, endAt: `${workDate}T20:00:00+07:00`,
        reason: 'Hoàn thành đơn hàng đã phân công', members: [{ employeeId, consentReference: 'ĐỒNG-Ý-' + employeeId.slice(0, 8) }],
        ...overrides,
      };
    }
    async function create(employeeId, workDate, overrides) {
      return (await ok('/overtime/requests', tt, input(employeeId, workDate, overrides))).request;
    }
    async function submit(request) { return (await ok('/overtime/requests/' + request.id + '/submit', tt, { revision: request.revision })).request; }
    async function approve(request) { return (await ok('/overtime/requests/' + request.id + '/approve', qd, { revision: request.revision })).request; }

    await t.test('Scope, members, consent, and group validation are atomic', async () => {
      const members = await ok('/overtime/members?teamOrgUnitId=' + source.id + '&workDate=' + date(6, 10), tt);
      assert.ok(members.items.some(member => member.id === workers.FLOW.id));
      assert.equal((await requestCall('/overtime/members?teamOrgUnitId=' + remote.id + '&workDate=' + date(6, 10), tt)).status, 403);
      assert.equal((await requestCall('/overtime/requests', qd, input(workers.FLOW.id))).status, 403);
      assert.equal((await requestCall('/overtime/requests', kt, input(workers.FLOW.id))).status, 403);
      assert.equal((await requestCall('/overtime/requests', ad, input(workers.FLOW.id))).status, 403);
      const before = await db.overtimeRequest.count();
      assert.equal((await requestCall('/overtime/requests', tt, input(workers.FLOW.id, date(6, 10), { members: [
        { employeeId: workers.FLOW.id, consentReference: 'ĐỒNG-Ý' }, { employeeId: foreign.id, consentReference: 'ĐỒNG-Ý' },
      ] }))).status, 403);
      assert.equal(await db.overtimeRequest.count(), before);
      assert.equal((await requestCall('/overtime/requests', tt, input(workers.FLOW.id, date(6, 10), { members: [{ employeeId: workers.FLOW.id, consentReference: '   ' }] }))).status, 400);
      assert.equal((await requestCall('/overtime/requests', tt, input(workers.FLOW.id, date(6, 11), { workDate: date(6, 12) }))).status, 400);
      assert.equal((await requestCall('/overtime/requests', tt, input(workers.FLOW.id, date(6, 11), { endAt: `${date(6, 12)}T06:00:00+07:00` }))).status, 400);
      const ttAccount = await db.userAccount.findUnique({ where: { username: 'tt.bn' } });
      await db.employeeExclusion.create({ data: { userAccountId: ttAccount.id, employeeId: workers.FLOW.id, effectiveFrom: new Date(`${year - 1}-01-01T00:00:00Z`) } });
      assert.equal((await requestCall('/overtime/requests', tt, input(workers.FLOW.id, date(6, 11)))).status, 403);
      await db.employeeExclusion.deleteMany({ where: { userAccountId: ttAccount.id, employeeId: workers.FLOW.id } });
    });

    await t.test('Return, revision, concurrent approval, immutable audit, rejection and cancellation', async () => {
      let request = await create(workers.FLOW.id, date(6, 12));
      assert.equal(request.status, 'DRAFT');
      request = await submit(request);
      assert.equal((await requestCall('/overtime/requests/' + request.id + '/approve', tt, { revision: request.revision })).status, 403);
      assert.equal((await requestCall('/overtime/requests/' + request.id + '/return', qd, { revision: request.revision, reason: '   ' })).status, 400);
      request = (await ok('/overtime/requests/' + request.id + '/return', qd, { revision: request.revision, reason: 'Bổ sung phạm vi đơn hàng' })).request;
      request = (await ok('/overtime/requests/' + request.id + '/update', tt, { ...input(workers.FLOW.id, date(6, 12), { title: 'Tăng ca đã điều chỉnh' }), revision: request.revision })).request;
      request = await submit(request);
      assert.equal((await requestCall('/overtime/requests/' + request.id + '/approve', qd, { revision: 0 })).status, 409);
      const approvals = await Promise.all([1, 2].map(() => requestCall('/overtime/requests/' + request.id + '/approve', qd, { revision: request.revision })));
      assert.deepEqual(approvals.map(result => result.status).sort(), [201, 409]);
      request = approvals.find(result => result.status === 201).body.request;
      assert.equal(request.status, 'APPROVED');
      assert.equal((await requestCall('/overtime/requests/' + request.id + '/update', tt, { ...input(workers.FLOW.id, date(6, 12)), revision: request.revision })).status, 409);
      assert.equal((await requestCall('/overtime/requests/' + request.id + '/cancel', tt, { revision: request.revision, reason: 'Không thể hủy đã duyệt' })).status, 409);
      const detail = await ok('/overtime/requests/' + request.id, qd);
      assert.deepEqual(detail.history.map(row => row.action), ['CREATE', 'SUBMIT', 'RETURN', 'UPDATE', 'SUBMIT', 'APPROVE']);
      assert.equal(detail.history[0].snapshot.title, 'Tăng ca kiểm chứng');
      assert.equal(detail.history[3].snapshot.title, 'Tăng ca đã điều chỉnh');
      await assert.rejects(() => db.overtimeHistory.update({ where: { id: detail.history[0].id }, data: { reason: "tamper" } }));

      let rejected = await create(workers.REJECT.id, date(6, 13)); rejected = await submit(rejected);
      rejected = (await ok('/overtime/requests/' + rejected.id + '/reject', qd, { revision: rejected.revision, reason: 'Không đủ nhu cầu sản xuất' })).request;
      assert.equal(rejected.status, 'REJECTED');
      assert.equal((await requestCall('/overtime/requests/' + rejected.id + '/update', tt, { ...input(workers.REJECT.id, date(6, 13)), revision: rejected.revision })).status, 409);
      const draft = await create(workers.REJECT.id, date(6, 14));
      const cancelled = (await ok('/overtime/requests/' + draft.id + '/cancel', tt, { revision: draft.revision, reason: 'Dừng nhu cầu' })).request;
      assert.equal(cancelled.status, 'CANCELLED');
    });


    await t.test('Touching intervals do not overlap; normal shifts and overlapping OT do', async () => {
      const first = await create(workers.BOUNDARY.id, date(6, 15), { endAt: `${date(6, 15)}T19:00:00+07:00` });
      const touching = await create(workers.BOUNDARY.id, date(6, 15), { startAt: `${date(6, 15)}T19:00:00+07:00`, endAt: `${date(6, 15)}T21:00:00+07:00` });
      assert.equal(touching.status, 'DRAFT');
      assert.equal((await requestCall('/overtime/requests', tt, input(workers.BOUNDARY.id, date(6, 15), { startAt: `${date(6, 15)}T18:59:00+07:00`, endAt: `${date(6, 15)}T20:00:00+07:00` }))).status, 409);
      const pendingBoundary = await submit(first);
      assert.equal((await requestCall("/employees/" + workers.BOUNDARY.id + "/transfers", kt, { toOrgUnitId: other.id, effectiveFrom: date(6, 15), decisionDate: date(6, 14), decisionNumber: "OT-PENDING-TRANSFER", reason: "Đổi tổ khi có OT chờ duyệt" })).status, 409);
      const overlappingShift = (await ok("/shifts/definitions", ad, { orgUnitId: source.id, code: "OT-LATE", name: "Ca chiều trùng OT", kind: "DAY", startTime: "17:00", endTime: "21:00", crossesMidnight: false, breakStartOffset: 120, breakMinutes: 30, paidBreak: false })).shift;
      assert.equal((await requestCall("/shifts/plans", tt, { title: "Ca trùng OT chờ duyệt", teamOrgUnitId: source.id, slots: [{ workDate: date(6, 15), shiftId: overlappingShift.id, employeeIds: [workers.BOUNDARY.id] }] })).status, 409);
      await ok("/overtime/requests/" + pendingBoundary.id + "/cancel", tt, { revision: pendingBoundary.revision, reason: "Kết thúc kiểm chứng khoảng thời gian" });
      const definition = (await ok('/shifts/definitions', ad, { orgUnitId: source.id, code: 'OT-NORMAL', name: 'Ca trùng tăng ca', kind: 'DAY', startTime: '08:00', endTime: '17:00', crossesMidnight: false, breakStartOffset: 240, breakMinutes: 60, paidBreak: false })).shift;
      let plan = (await ok('/shifts/plans', tt, { title: 'Ca kiểm chứng OT', teamOrgUnitId: source.id, slots: [{ workDate: date(6, 16), shiftId: definition.id, employeeIds: [workers.SHIFT.id] }] })).plan;
      plan = (await ok('/shifts/plans/' + plan.id + '/submit', tt, { revision: plan.revision })).plan;
      await ok('/shifts/plans/' + plan.id + '/approve', qd, { revision: plan.revision });
      assert.equal((await requestCall('/overtime/requests', tt, input(workers.SHIFT.id, date(6, 16), { startAt: `${date(6, 16)}T16:00:00+07:00`, endAt: `${date(6, 16)}T18:00:00+07:00` }))).status, 409);
    });

    async function fixture(employeeId, workDate, startAt, endAt) {
      return db.overtimeRequest.create({ data: {
        teamOrgUnitId: source.id, title: 'Dữ liệu hạn mức', workDate: new Date(workDate + 'T00:00:00Z'),
        startAt: new Date(startAt), endAt: new Date(endAt), requestedMinutes: Math.round((new Date(endAt) - new Date(startAt)) / 60000),
        reason: 'Dữ liệu kiểm chứng hạn mức', status: 'APPROVED', createdById: (await db.userAccount.findUnique({ where: { username: 'tt.bn' } })).id,
        members: { create: [{ employeeId, consentReference: 'ĐỒNG-Ý-FIXTURE' }] },
      } });
    }

    await t.test('Daily, monthly, yearly caps, warning and pending recheck use approved reservations', async () => {
      await fixture(workers.CAP.id, date(6, 17), `${date(6, 17)}T03:00:00.000Z`, `${date(6, 17)}T07:00:00.000Z`);
      let cap = await create(workers.CAP.id, date(6, 17), { startAt: `${date(6, 17)}T17:00:00+07:00`, endAt: `${date(6, 17)}T18:00:00+07:00` });
      cap = await submit(cap);
      assert.equal((await requestCall('/overtime/requests/' + cap.id + '/approve', qd, { revision: cap.revision })).status, 409);

      for (let day = 1; day <= 9; day++) await fixture(workers.CAP.id, date(7, day), `${date(7, day)}T10:00:00.000Z`, `${date(7, day)}T14:00:00.000Z`);
      const warning = await create(workers.CAP.id, date(7, 10));
      const warningDetail = await ok('/overtime/requests/' + warning.id, tt);
      assert.deepEqual(warningDetail.review.employees[0].months, [{ month: `${year}-07`, minutes: 2340, limitMinutes: 2400 }]);
      assert.equal(warningDetail.review.warnings.length, 1);
      await fixture(workers.CAP.id, date(7, 10), `${date(7, 10)}T03:00:00.000Z`, `${date(7, 10)}T07:00:00.000Z`);
      const pending = await submit(warning);
      assert.equal((await requestCall('/overtime/requests/' + pending.id + '/approve', qd, { revision: pending.revision })).status, 409);

      for (let month = 1; month <= 12; month++) for (let index = 1; index <= 4; index++) {
        const day = month === 7 ? index + 10 : index;
        await fixture(workers.CAP.id, date(month, day), `${date(month, day)}T10:00:00.000Z`, `${date(month, day)}T14:00:00.000Z`);
      }
      const annual = await create(workers.CAP.id, date(12, 20));
      const annualPending = await submit(annual);
      assert.equal((await requestCall('/overtime/requests/' + annualPending.id + '/approve', qd, { revision: annualPending.revision })).status, 409);
      const bn = await db.site.findUnique({ where: { code: "NM-BN" } });
      const parameter = { scopeKey: "SITE:" + bn.id, subjectType: "ALL", applicationBasis: "WORK_DATE", effectiveFrom: date(1, 1), documentEffectiveDate: date(1, 1), legalBasis: "Căn cứ kiểm chứng trần 300 giờ" };
      await ok("/settings/parameters", ad, { ...parameter, paramCode: "OT_YEAR_MAX_MINUTES", value: "18000", unit: "minute" });
      assert.equal((await requestCall("/overtime/requests/" + annualPending.id + "/approve", qd, { revision: annualPending.revision })).status, 409);
      await ok("/settings/parameters", ad, { ...parameter, paramCode: "OT_300_NOTICE_REFERENCE", value: "TB-300-OT", unit: "reference" });
      await ok("/settings/parameters", ad, { ...parameter, paramCode: "OT_300_NOTICE_DATE", value: date(12, 21), unit: "date" });
      assert.equal((await requestCall("/overtime/requests/" + annualPending.id + "/approve", qd, { revision: annualPending.revision })).status, 409);
      await ok("/settings/parameters", ad, { ...parameter, effectiveFrom: date(12, 1), documentEffectiveDate: date(12, 1), paramCode: "OT_300_NOTICE_DATE", value: date(12, 1), unit: "date" });
      assert.equal((await approve(annualPending)).status, "APPROVED");
    });

    await t.test('Cross-midnight minutes split month/year and ancestor locks prevent every write', async () => {
      await fixture(workers.LOCK.id, date(12, 30), `${date(12, 30)}T15:00:00.000Z`, `${date(12, 31)}T01:00:00.000Z`);
      const crossing = await create(workers.LOCK.id, date(12, 31), { startAt: `${date(12, 31)}T22:00:00+07:00`, endAt: `${year + 1}-01-01T02:00:00+07:00` });
      const crossingDetail = await ok('/overtime/requests/' + crossing.id, tt);
      assert.deepEqual(crossingDetail.review.employees[0].months, [
        { month: `${year}-12`, minutes: 720, limitMinutes: 2400 },
        { month: `${year + 1}-01`, minutes: 120, limitMinutes: 2400 },
      ]);
      const period = (await ok('/periods', ad, { code: 'OT-LOCK', scopeOrgUnitId: site.id, month: `${year}-12`, dateFrom: date(12, 1), dateTo: date(12, 31) })).period;
      await db.businessPeriod.update({ where: { id: period.id }, data: { status: 'LOCKED' } });
      assert.equal((await requestCall('/overtime/requests', tt, input(workers.LOCK.id, date(12, 20)))).status, 409);
      assert.equal((await requestCall('/overtime/requests/' + crossing.id + '/update', tt, { ...input(workers.LOCK.id, date(12, 31)), revision: crossing.revision })).status, 409);
      assert.equal((await requestCall('/overtime/requests/' + crossing.id + '/cancel', tt, { revision: crossing.revision, reason: 'Kỳ khóa' })).status, 409);
      await db.businessPeriod.update({ where: { id: period.id }, data: { status: 'OPEN' } });
    });

    await t.test('Lists and historical snapshots enforce current scope after a worker moves', async () => {
      await db.employee.update({ where: { id: workers.HISTORY.id }, data: { hireDate: new Date(`${year - 2}-01-01T00:00:00Z`) } });
      const historicalDay = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
      const transferDay = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const historical = await create(workers.HISTORY.id, historicalDay);
      await ok("/employees/" + workers.HISTORY.id + "/transfers", kt, { toOrgUnitId: other.id, effectiveFrom: transferDay, decisionDate: transferDay, decisionNumber: "OT-HISTORY-SCOPE", reason: "Kiểm chứng phạm vi lịch sử" });
      assert.equal((await requestCall('/overtime/requests/' + historical.id, tt)).status, 403);
      const list = await ok(`/overtime/requests?dateFrom=${historicalDay}&dateTo=${historicalDay}`, tt);
      assert.equal(list.items.some(item => item.id === historical.id), false);
      const accounting = await ok('/overtime/requests/' + historical.id, kt);
      assert.equal(accounting.history[0].snapshot.members[0].employee.id, workers.HISTORY.id);
    });
  } finally {
    if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; }
    if (db) await db.$disconnect();
    await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS "' + name + '" WITH (FORCE)');
    await admin.$disconnect(); rmSync(credentialsPath, { force: true });
  }
});
