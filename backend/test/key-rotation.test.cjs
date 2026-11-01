// FR-X.2 key rotation: v1 → v2 re-encrypts every ciphertext, reads stay identical and duplicate checks still work.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { withServer } = require('./http-harness.cjs');
const crypto = require('../dist/common/data-crypto.js');

const date = value => new Date(value + 'T00:00:00.000Z');
const script = resolve(__dirname, '../../scripts/rotate-keys.cjs');

test('Key ring keeps the legacy format, prefixes other keys and refuses unknown ones', () => {
  const v1 = randomBytes(32), v2 = randomBytes(32);
  try {
    crypto.resetKeyRing({ active: 'v1', keys: new Map([['v1', v1]]) });
    const legacy = crypto.cipherText(v1, 'MST 0123456789');
    assert.match(legacy, /^v1\./);
    const legacyIndex = crypto.blindIndex(v1, 'TAX_CODE', '0123456789');
    assert.match(legacyIndex, /^b1\./);
    const legacyFile = crypto.sealBuffer(v1, Buffer.from('zip'));
    crypto.resetKeyRing({ active: 'v2', keys: new Map([['v1', v1], ['v2', v2]]) });
    const rotated = crypto.cipherText(v1, 'MST 0123456789');
    assert.match(rotated, /^kv2\.v1\./);
    assert.equal(crypto.cipherKeyId(rotated), 'v2');
    assert.equal(crypto.plainText(v1, rotated), 'MST 0123456789');
    assert.equal(crypto.plainText(v1, legacy), 'MST 0123456789', 'old ciphertexts stay readable while v1 is in the ring');
    assert.match(crypto.blindIndex(v1, 'TAX_CODE', '0123456789'), /^b2\./);
    assert.notEqual(crypto.blindIndex(v1, 'TAX_CODE', '0123456789').slice(3), legacyIndex.slice(3));
    assert.equal(crypto.openBuffer(v1, crypto.sealBuffer(v1, Buffer.from('zip'))).toString(), 'zip');
    assert.equal(crypto.openBuffer(v1, legacyFile).toString(), 'zip');
    crypto.resetKeyRing({ active: 'v2', keys: new Map([['v2', v2]]) });
    assert.throws(() => crypto.plainText(v1, crypto.cipherText(v1, 'x').replace('kv2.', 'kv3.')), /Không có khóa v3/);
    crypto.resetKeyRing();
    assert.throws(() => crypto.keyRing({ HR_DATA_KEY: v1.toString('base64'), HR_DATA_KEYS: 'v2:short' }), /HR_DATA_KEYS/);
    crypto.resetKeyRing();
    assert.throws(() => crypto.keyRing({ HR_DATA_KEY: v1.toString('base64'), HR_DATA_KEY_ACTIVE: 'v9' }), /not in the key ring/);
  } finally {
    crypto.resetKeyRing();
  }
});

test('keys:rotate moves every ciphertext and blind index to v2 on isolated PostgreSQL', { timeout: 300000 }, async () => {
  await withServer('key_rotation', async ({ db, ok, request, login, env, restart }) => {
    const tag = randomUUID().slice(0, 8).toUpperCase();
    const [kt, ad] = await Promise.all(['kt.all', 'ad.demo'].map(name => login(name)));
    const context = await ok('/organization/context', ad);
    const team = context.units.find(row => row.code === 'NM-BN-D1-T1');
    const people = {};
    for (const code of ['A', 'B']) people[code] = await db.employee.create({ data: { code: 'KR-' + tag + '-' + code, fullName: 'Xoay khóa ' + code, gender: 'FEMALE', dob: date('1990-01-01'), hireDate: date('2026-01-01'), assignments: { create: { orgUnitId: team.id, effectiveFrom: date('2026-01-01'), allocationRatio: '100', isPrimary: true } } } });
    const base = id => '/employees/' + id + '/payroll-profile';
    const identity = (overrides = {}) => ({ revision: 0, documentType: 'CCCD', idNumber: '001090012345', taxCode: '0123456789', siBookNumber: '0123456789', emergencyContactName: 'Người thân', emergencyContactPhone: '0901234567', emergencyContactRelation: 'Mẹ', dataStatus: 'SIMULATION', reason: 'KT nhập hồ sơ', ...overrides });
    await ok(base(people.A.id) + '/identity', kt, identity());
    await ok(base(people.A.id) + '/bank-accounts', kt, { bankCode: 'VCB', accountNumber: '0011 0022 3344', accountHolder: 'XOAY KHOA A', effectiveFrom: '2026-01-01', dataStatus: 'SIMULATION', reason: 'Tài khoản nhận lương' });
    const before = await ok(base(people.A.id), kt);

    const v2 = randomBytes(32).toString('base64');
    const ringEnv = { HR_DATA_KEYS: 'v2:' + v2, HR_DATA_KEY_ACTIVE: 'v2' };
    const run = args => {
      const result = spawnSync(process.execPath, [script, ...args], { env: { ...env, ...ringEnv }, encoding: 'utf8', timeout: 120000 });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      return result.stdout.trim().split('\n').map(line => JSON.parse(line));
    };
    const [rotation, status] = run([]);
    assert.ok(rotation.rewrittenRows.employee_identity >= 1 && rotation.rewrittenRows.employee_bank_account >= 1, JSON.stringify(rotation));
    assert.deepEqual(Object.keys(status.ciphertextsByKey), ['v2'], 'no ciphertext left on v1');
    assert.deepEqual(status.removableKeys, ['v1']);
    const stored = await db.employeeIdentity.findUniqueOrThrow({ where: { employeeId: people.A.id } });
    assert.match(stored.taxCodeCipher, /^kv2\./);
    assert.match(stored.taxCodeHash, /^b2\./);
    assert.match((await db.employeeBankAccount.findFirstOrThrow({ where: { employeeId: people.A.id } })).accountNumberHash, /^b2\./);
    const [rerun] = run([]);
    assert.deepEqual(rerun.rewrittenRows, { employee_bank_account: 1, employee_identity: 1 }, 'a re-run only refreshes the blind indexes');

    await restart(ringEnv);
    const kt2 = await login('kt.all');
    const after = await ok(base(people.A.id), kt2);
    assert.deepEqual([after.identity.idNumber, after.identity.taxCode, after.identity.siBookNumber, after.bankAccounts[0].accountNumber], [before.identity.idNumber, before.identity.taxCode, before.identity.siBookNumber, before.bankAccounts[0].accountNumber]);
    const clash = await request(base(people.B.id) + '/identity', kt2, identity({ idNumber: '001090099999', taxCode: '0123 456 789', siBookNumber: '9999999999' }));
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'DUPLICATE_TAX_CODE', 'duplicate tax code still detected after rotation');
    await ok(base(people.B.id) + '/identity', kt2, identity({ idNumber: '001090099999', taxCode: '9876543210', siBookNumber: '9999999999' }));
    assert.match((await db.employeeIdentity.findUniqueOrThrow({ where: { employeeId: people.B.id } })).idNumberCipher, /^kv2\./);
  });
});
