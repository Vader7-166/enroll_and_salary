const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { withServer } = require('./http-harness.cjs');
const { maskSalary } = require('../dist/audit/audit-search.service.js');
const { auditedEntityTypes, resolveAuditScope } = require('../dist/audit/audit-scope.js');

test('Salary-bearing values are masked for AD at any depth', () => {
  assert.deepEqual(maskSalary({ revision: 2, salaryCipher: 'x', totals: { gross: '1' }, lines: [{ amount: '5', label: 'L' }], reason: 'r', net: null }),
    { revision: 2, salaryCipher: '***', totals: '***', lines: [{ amount: '***', label: 'L' }], reason: 'r', net: null });
});

test('Audit search by AD scope, denied access, export audit, and hash-chain integrity on real HTTP', { timeout: 600000 }, async t => {
  await withServer('audit_search', async ({ db, request, ok, login, account }) => {
    const [tt, kt, ad] = await Promise.all(['tt.bn', 'kt.all', 'ad.demo'].map(name => login(name)));
    const adHaNam = await account('ad.hna', 'AD', 'NM-HNA');
    const context = await ok('/organization/context', kt);
    const unit = code => context.units.find(row => row.code === code);
    const hnaTeam = context.units.find(row => row.code.startsWith('NM-HNA') && row.type === 'TEAM');
    assert.ok(hnaTeam);
    const make = async (code, orgUnitId) => (await ok('/employees', kt, { code, fullName: 'Kiểm toán ' + code, gender: 'OTHER', dob: '1990-01-01', hireDate: '2026-01-05', orgUnitId })).employee;
    const bn = await make('AU-BN', unit('NM-BN-D1-T1').id);
    const hna = await make('AU-HNA', hnaTeam.id);

    await t.test('Every entity resolver runs without aborting the writer transaction', async () => {
      await db.$transaction(async tx => {
        for (const entityType of auditedEntityTypes) assert.equal(await resolveAuditScope(tx, { entityType, entityId: randomUUID(), result: 'SUCCESS' }), null, entityType);
        assert.equal(await resolveAuditScope(tx, { entityType: 'employee', entityId: 'not-a-uuid', result: 'DENIED' }), null);
      });
      const created = await db.auditLog.findFirst({ where: { entityType: 'employee', entityId: hna.id, action: 'CREATE' } });
      assert.equal(created?.scopeOrgUnitId, hnaTeam.id, 'new records carry the scope of the entity');
    });

    await t.test('AD sees only their scope; denied and out-of-scope access are searchable', async () => {
      assert.equal((await ok('/employees/' + hna.id, tt)).employee, null, 'TT of Bắc Ninh cannot read a Hà Nam employee');
      await ok('/employees/' + bn.id, kt);
      assert.equal((await request('/employees', ad)).status, 403, 'AD has no employee.read: a DENIED record');

      const all = await ok('/audit/logs?entityType=employee&pageSize=200', ad);
      assert.ok(all.items.some(row => row.entityId === hna.id && row.result === 'EMPTY' && row.actor.username === 'tt.bn'));
      assert.ok(all.items.some(row => row.entityId === bn.id && row.action === 'READ'));
      const denied = await ok('/audit/logs?result=DENIED', ad);
      assert.ok(denied.items.length && denied.items.every(row => row.result === 'DENIED'));
      assert.ok(denied.items.some(row => row.actor?.username === 'ad.demo' && row.action === 'ACCESS_DENIED'));

      const haNam = await ok('/audit/logs?entityType=employee&pageSize=200', adHaNam);
      assert.ok(haNam.items.some(row => row.entityId === hna.id), 'Hà Nam AD sees Hà Nam records');
      assert.ok(!haNam.items.some(row => row.entityId === bn.id), 'Hà Nam AD never sees Bắc Ninh records');
      assert.ok(haNam.items.every(row => row.scopeOrgUnitId !== null), 'unscoped (account/parameter) records stay company-only');

      assert.equal((await request('/audit/logs', kt)).status, 403, 'KT cannot search the audit log');
      assert.equal((await request('/audit/logs?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z', ad)).status, 400, 'range is bounded');
    });

    await t.test('Cursor pagination walks the result without overlap', async () => {
      for (let index = 0; index < 25; index++) await ok('/employees/' + bn.id, kt);
      const first = await ok('/audit/logs?pageSize=20', ad);
      assert.ok(first.nextCursor);
      const second = await ok('/audit/logs?pageSize=20&cursor=' + first.nextCursor, ad);
      const ids = new Set(first.items.map(row => row.id));
      assert.ok(second.items.every(row => !ids.has(row.id) && BigInt(row.id) < BigInt(first.nextCursor)));
    });

    await t.test('Export is an xlsx file and is itself audited', async () => {
      const file = await request('/audit/logs/export?entityType=employee', ad);
      assert.equal(file.status, 200);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(file.body);
      assert.equal(book.worksheets[0].getRow(2).getCell(1).value, 'Mã');
      assert.ok(await db.auditLog.findFirst({ where: { entityType: 'audit_log', action: 'EXPORT', actor: { username: 'ad.demo' } } }));
    });

    await t.test('Integrity check is valid, then detects a record edited with the trigger disabled', async () => {
      const valid = await ok('/audit/integrity-checks', ad, {});
      assert.equal(valid.status, 'VALID', JSON.stringify(valid));
      assert.ok(valid.checkedCount > 10);
      assert.equal((await request('/audit/integrity-checks', adHaNam, {})).status, 400, 'only company-scope AD run the full chain check');
      const target = await db.auditLog.findFirstOrThrow({ where: { entityType: 'employee', entityId: bn.id, action: 'READ' } });
      await db.$executeRawUnsafe('ALTER TABLE audit_log DISABLE TRIGGER audit_no_update_delete');
      await db.$executeRawUnsafe("UPDATE audit_log SET result = 'TAMPERED' WHERE id = " + target.id);
      await db.$executeRawUnsafe('ALTER TABLE audit_log ENABLE TRIGGER audit_no_update_delete');
      const broken = await ok('/audit/integrity-checks', ad, {});
      assert.deepEqual([broken.status, broken.firstBrokenId, broken.failureReason], ['BROKEN', target.id.toString(), 'HASH_MISMATCH']);
      const history = await ok('/audit/integrity-checks', ad);
      assert.deepEqual(history.items.slice(0, 2).map(row => row.status), ['BROKEN', 'VALID']);
      const inbox = await ok('/notifications', ad);
      assert.ok(inbox.items.some(row => row.type === 'AUDIT_INTEGRITY_BROKEN' && row.payload.firstBrokenId === target.id.toString()));
      assert.ok((await ok('/notifications', adHaNam)).items.every(row => row.type !== 'AUDIT_INTEGRITY_BROKEN'), 'chain alerts go to company AD');
      await assert.rejects(() => db.auditLog.update({ where: { id: target.id }, data: { result: 'X' } }), 'trigger is active again');
    });
  });
});
