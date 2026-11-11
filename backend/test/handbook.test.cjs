const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { loadCorpus, permitted } = require('../dist/ai-business-assistant/corpus.js');
const { buildHandbookCatalog } = require('../dist/ai-business-assistant/handbook.js');
const { withServer } = require('./http-harness.cjs');

function corpusFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hrtp-handbook-'));
  const chunk = (file, text = 'Overview\n1. First step\n- Note') => writeFileSync(join(dir, file), text);
  chunk('guide.txt'); chunk('policy.txt'); chunk('last-day.txt'); chunk('expired.txt'); chunk('invalid.txt');
  const shared = { title: 'Controlled article', section: 'source §1', roles: ['TT'], label: 'SIMULATION', pageKeys: ['attendance'], keywords: [], effectiveFrom: null, effectiveTo: null };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    promptVersion: 'TEST',
    routes: {
      ATTENDANCE: { route: 'attendance', label: 'Attendance', roles: ['TT'], permission: 'guide.read' },
      UNSAFE: { route: 'https://outside.example', label: 'Unsafe', roles: ['TT'], permission: 'guide.read' },
    },
    chunks: [
      { ...shared, sourceId: 'GUIDE', file: 'guide.txt', requiredPermissions: ['guide.read'], actions: ['ATTENDANCE', 'UNSAFE'] },
      { ...shared, sourceId: 'POLICY', file: 'policy.txt', requiredPermissions: ['policy.read'], actions: [], handbookOnly: true, handbook: { kind: 'policy', category: 'attendance', scope: 'TT scope', version: 'POLICY-1' } },
      { ...shared, sourceId: 'LAST_DAY', file: 'last-day.txt', requiredPermissions: ['guide.read'], actions: [], effectiveTo: '2026-06-30' },
      { ...shared, sourceId: 'EXPIRED', file: 'expired.txt', requiredPermissions: ['guide.read'], actions: [], effectiveTo: '2026-06-29' },
      { ...shared, sourceId: 'INVALID_POLICY', file: 'invalid.txt', requiredPermissions: ['policy.read'], actions: [], handbookOnly: true },
      { ...shared, sourceId: 'MALFORMED_POLICY', file: 'invalid.txt', requiredPermissions: ['policy.read'], actions: [], handbookOnly: true, handbook: { kind: 'policy', category: 'attendance' } },
    ],
  }));
  return dir;
}

test('Handbook filters articles and canonical links without changing AI corpus eligibility', () => {
  const dir = corpusFixture();
  try {
    const corpus = loadCorpus(dir);
    assert.ok(corpus.warnings.some(warning => warning.startsWith('INVALID_POLICY')));
    assert.ok(corpus.warnings.some(warning => warning.startsWith('MALFORMED_POLICY')));
    assert.deepEqual(corpus.chunks.map(chunk => chunk.sourceId), ['GUIDE', 'POLICY', 'LAST_DAY', 'EXPIRED']);

    const partial = { roles: ['TT'], permissions: ['guide.read', 'policy.read'] };
    const catalog = buildHandbookCatalog(corpus, partial, '2026-06-30');
    assert.deepEqual(catalog.roles, ['TT']);
    assert.deepEqual(catalog.items.map(item => item.id), ['GUIDE', 'POLICY', 'LAST_DAY']);
    assert.deepEqual(catalog.items.find(item => item.id === 'GUIDE').actions, []);
    assert.ok(!permitted(corpus, partial, '2026-06-30').some(chunk => chunk.sourceId === 'POLICY'));

    const linked = buildHandbookCatalog(corpus, { ...partial, permissions: [...partial.permissions, 'attendance.read'] }, '2026-06-30');
    assert.deepEqual(linked.items.find(item => item.id === 'GUIDE').actions.map(action => ({ actionKey: action.actionKey, route: action.route, roles: action.roles })), [{ actionKey: 'ATTENDANCE', route: 'attendance', roles: ['TT'] }]);
    assert.ok(!linked.items.flatMap(item => item.actions).some(action => action.route.includes('://')));
    assert.ok(!buildHandbookCatalog(corpus, partial, '2026-07-01').items.some(item => item.id === 'LAST_DAY'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Handbook HTTP endpoint is authenticated and remains available with AI disabled', { timeout: 600000 }, async () => {
  await withServer('handbook_catalog', async ({ request, ok, login }) => {
    assert.equal((await request('/handbook')).status, 401);
    const catalog = await ok('/handbook?roles=KT&permissions=payroll.read', await login('tt.bn'));
    assert.deepEqual(catalog.roles, ['TT']);
    assert.ok(catalog.items.some(item => item.id === 'TT-04'), 'team leader can read shift-planning guidance while AI is disabled');
    assert.ok(catalog.items.some(item => item.id === 'POL-ATTENDANCE'), 'reference policies are available independently of AI');
    assert.ok(!catalog.items.some(item => item.id.startsWith('KT-') || item.id.startsWith('AD-') || item.id === 'POL-PAYROLL'));
    assert.ok(catalog.items.every(item => item.roles.every(role => role === 'TT')));
    assert.ok(catalog.items.flatMap(item => item.actions).every(action => !action.route.startsWith('#/') && !action.route.includes('://')));
  }, { env: { AI_BUSINESS_ASSISTANT_ENABLED: 'false' } });
});
