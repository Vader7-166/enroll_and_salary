// FR-X.4 retention: hourly for 48 h, first-of-day for 90 days, first-of-month for 36 months (3-year payroll retention).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const os = require('node:os');

test('Pruning keeps recent hours, one backup per day and per month, and removes the rest with their checksums', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'hrtp-retention-'));
  try {
    const now = Date.parse('2026-11-01T12:00:00Z');
    const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const names = [];
    const add = ms => { const name = 'hrtp-' + stamp(ms) + '.dump.enc'; names.push(name); writeFileSync(join(dir, name), 'x'); writeFileSync(join(dir, name + '.sha256'), 'x'); return name; };
    const hour = 3600e3, day = 24 * hour;
    const recent = [add(now - hour), add(now - 47 * hour)];
    const dayFirst = add(now - 10 * day - 5 * hour), daySecond = add(now - 10 * day - 4 * hour);
    const julyOpener = add(now - 121 * day), old = add(now - 120 * day + hour);
    const monthFirst = add(Date.parse('2025-03-01T00:00:00Z')), monthLater = add(Date.parse('2025-03-02T00:00:00Z'));
    const tooOld = add(Date.parse('2023-01-01T00:00:00Z'));
    writeFileSync(join(dir, 'notes.txt'), 'kept: not a backup');
    const result = spawnSync('sh', [resolve(__dirname, '../../deploy/backup/backup.sh')], { env: { ...process.env, BACKUP_DIR: dir, BACKUP_RETENTION_ONLY: 'true', BACKUP_NOW: String(now / 1000) }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const left = readdirSync(dir).filter(name => name.endsWith('.dump.enc')).sort();
    assert.deepEqual(left, [...recent, dayFirst, julyOpener, monthFirst].sort());
    for (const gone of [daySecond, old, monthLater, tooOld]) assert.ok(!readdirSync(dir).includes(gone + '.sha256'));
    assert.ok(readdirSync(dir).includes('notes.txt'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
