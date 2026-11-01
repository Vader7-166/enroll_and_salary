const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withServer, today, addDays } = require('./http-harness.cjs');

test('In-app notifications: role/scope recipients, read state, failure isolation, parameter expiry', { timeout: 600000 }, async t => {
  await withServer('notifications', async ({ db, request, ok, login, account, logs, password }) => {
    const [tt, qd, kt, ad] = await Promise.all(['tt.bn', 'qd.bn', 'kt.all', 'ad.demo'].map(name => login(name)));
    const qdHaNam = await account('qd.hna', 'QD', 'NM-HNA-D1', 'qd.bn');
    const team = await db.orgUnit.findUniqueOrThrow({ where: { code: 'NM-BN-D1-T1' } });
    const year = new Date().getUTCFullYear() + 1;
    const workers = [];
    for (const code of ['A', 'B', 'C'])
      workers.push((await ok('/employees', kt, { code: 'NT-' + code, fullName: 'Thông báo ' + code, gender: 'OTHER', dob: '1985-01-01', hireDate: (year - 1) + '-01-01', orgUnitId: team.id })).employee);
    const input = (employeeId, day) => ({ teamOrgUnitId: team.id, title: 'Tăng ca thông báo ' + day, workDate: year + '-06-' + day,
      startAt: year + '-06-' + day + 'T17:00:00+07:00', endAt: year + '-06-' + day + 'T20:00:00+07:00', reason: 'Đơn hàng gấp',
      members: [{ employeeId, consentReference: 'DY-' + employeeId.slice(0, 8) }] });
    const inbox = async cookie => ok('/notifications', cookie);
    const submitted = async (employeeId, day) => {
      const draft = (await ok('/overtime/requests', tt, input(employeeId, day))).request;
      return (await ok('/overtime/requests/' + draft.id + '/submit', tt, { revision: draft.revision })).request;
    };

    await t.test('OT submitted: the QĐ of the workshop containing the team is notified, nobody else', async () => {
      const request = await submitted(workers[0].id, '10');
      const qdInbox = await inbox(qd);
      const item = qdInbox.items.find(row => row.type === 'OVERTIME_PENDING');
      assert.ok(item, JSON.stringify(qdInbox));
      assert.deepEqual([item.linkKey, item.payload.requestId, item.readAt], ['overtime', request.id, null]);
      assert.ok(qdInbox.unread >= 1);
      for (const other of [tt, kt, ad, qdHaNam]) assert.ok(!(await inbox(other)).items.some(row => row.type === 'OVERTIME_PENDING'));

      const decided = (await ok('/overtime/requests/' + request.id + '/return', qd, { revision: request.revision, reason: 'Bổ sung lý do' })).request;
      assert.equal(decided.status, 'RETURNED');
      const ttItem = (await inbox(tt)).items.find(row => row.type === 'OVERTIME_DECIDED');
      assert.ok(ttItem && ttItem.payload.status === 'RETURNED' && ttItem.title.includes('bị trả lại'));
      assert.ok(!(await inbox(qd)).items.some(row => row.type === 'OVERTIME_DECIDED'), 'the deciding QĐ is not notified of their own action');
    });

    await t.test('Mark read one or all; counts follow', async () => {
      const before = await ok('/notifications/unread-count', qd);
      const first = (await inbox(qd)).items[0];
      const after = await ok('/notifications/read', qd, { ids: [first.id] });
      assert.equal(after.unread, before.unread - 1);
      assert.ok((await ok('/notifications?unreadOnly=true', qd)).items.every(row => row.id !== first.id));
      assert.equal((await ok('/notifications/read', tt, { ids: [first.id] })).updated, 0, 'one user cannot mark another user\'s notification');
      assert.equal((await ok('/notifications/read', qd, { all: true })).unread, 0);
    });

    await t.test('A failing notification never undoes the business action', async () => {
      const request = await submitted(workers[1].id, '11');
      await db.$executeRawUnsafe('ALTER TABLE notification RENAME TO notification_offline');
      try {
        const approved = (await ok('/overtime/requests/' + request.id + '/approve', qd, { revision: request.revision })).request;
        assert.equal(approved.status, 'APPROVED');
      } finally {
        await db.$executeRawUnsafe('ALTER TABLE notification_offline RENAME TO notification');
      }
      assert.equal((await db.overtimeRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'APPROVED');
      assert.match(logs(), /Notification OVERTIME_DECIDED failed/);
    });

    await t.test('Opening an old notification after scope revocation is refused by the target screen', async () => {
      const request = await submitted(workers[2].id, '12');
      const item = (await inbox(qd)).items.find(row => row.payload.requestId === request.id);
      assert.ok(item);
      assert.equal((await request_(qd, item.payload.requestId)).status, 200);
      const qdAccount = await db.userAccount.findUniqueOrThrow({ where: { username: 'qd.bn' } });
      await db.roleAssignment.updateMany({ where: { userAccountId: qdAccount.id }, data: { effectiveTo: new Date(addDays(today(), -1) + 'T00:00:00.000Z') } });
      assert.equal((await request_(await login('qd.bn'), item.payload.requestId)).status, 403);
    });
    function request_(cookie, id) { return request('/overtime/requests/' + id, cookie); }

    await t.test('Parameter ending soon without a successor is listed and notified once to AD', async () => {
      const from = addDays(today(), -10), to = addDays(today(), 20);
      const reauthToken = (await ok('/auth/reauthenticate', ad, { password: password('ad.demo') })).token;
      await ok('/settings/parameters', ad, { reauthToken, paramCode: 'NOTIFY_TEST_PARAM', scopeKey: 'GLOBAL', subjectType: 'ALL', applicationBasis: 'WORK_DATE', value: '1', unit: 'count',
        effectiveFrom: from, effectiveTo: to, documentEffectiveDate: from, legalBasis: 'Kiểm thử cảnh báo hết hiệu lực' });
      const expiring = await ok('/settings/parameters/expiring', ad);
      assert.equal(expiring.warningDays, 30);
      const listed = expiring.items.find(row => row.paramCode === 'NOTIFY_TEST_PARAM');
      assert.equal(listed?.daysLeft, 20);
      assert.equal((await request('/notifications/daily-jobs/run', kt, {})).status, 403);
      const run = await ok('/notifications/daily-jobs/run', ad, {});
      assert.equal(run['parameter-expiry'], 'OK', JSON.stringify(run));
      await ok('/notifications/daily-jobs/run', ad, {});
      assert.equal((await inbox(ad)).items.filter(row => row.type === 'PARAMETER_EXPIRING' && row.payload.paramCode === 'NOTIFY_TEST_PARAM').length, 1, 'deduplicated across runs');
      assert.ok(!(await inbox(kt)).items.some(row => row.type === 'PARAMETER_EXPIRING'));

      await ok('/settings/parameters', ad, { reauthToken, paramCode: 'NOTIFY_TEST_PARAM', scopeKey: 'GLOBAL', subjectType: 'ALL', applicationBasis: 'WORK_DATE', value: '2', unit: 'count',
        effectiveFrom: addDays(to, 1), documentEffectiveDate: addDays(to, 1), legalBasis: 'Bản kế tiếp' });
      assert.ok(!(await ok('/settings/parameters/expiring', ad)).items.some(row => row.paramCode === 'NOTIFY_TEST_PARAM'), 'a successor from the next day clears the warning');
    });
  });
});
