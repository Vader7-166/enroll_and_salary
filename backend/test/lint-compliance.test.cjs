// Task 2.2: the compliance lint finds float money, legal constants and wall-clock parameter lookups, and honours ignores.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const script = resolve(__dirname, '../../scripts/lint-compliance.cjs');
const lint = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('Each rule reports its fixture line; ignores and non-money conversions stay quiet', () => {
  const result = lint('--src', resolve(__dirname, 'fixtures/compliance-lint'), '--json');
  assert.equal(result.status, 0, 'warnings do not fail the build');
  const findings = JSON.parse(result.stdout).map(item => item.line + ':' + item.rule);
  assert.deepEqual(findings.sort(), ['4:money-float', '5:money-float', '6:money-float', '7:legal-constant', '8:legal-constant', '9:date-param-lookup'].sort());
});

test('Promoted rules fail the run', () => {
  assert.equal(lint('--src', resolve(__dirname, 'fixtures/compliance-lint'), '--error', 'money-float').status, 1);
  assert.equal(lint('--src', resolve(__dirname, 'fixtures/compliance-lint'), '--strict').status, 1);
});

test('The backend source is clean under --strict', () => {
  const result = lint('--strict');
  assert.equal(result.status, 0, result.stdout);
});
