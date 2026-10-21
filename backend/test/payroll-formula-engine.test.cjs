const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileFormula, decimalValue, roundFormula } = require('../dist/payroll-configuration/formula-engine');
const calculate = (expression, values = {}) => compileFormula(expression, Object.keys(values)).evaluate(new Map(Object.entries(values)));
const throwsCode = (fn, code) => assert.throws(fn, error => error.getStatus?.() === 400 && error.getResponse().code === code);

test('formula arithmetic preserves decimal precision, precedence and left association', () => {
  assert.equal(calculate('0.1 + 0.2').toFixed(), '0.3');
  assert.equal(calculate('A - B - C', { A: '10', B: '3', C: '2' }).toFixed(), '5');
  assert.equal(calculate('24 / 3 / 2 + 2 * -3').toFixed(), '-2');
  assert.equal(calculate('-(A + B) * +C', { A: '0.1', B: '0.2', C: '10' }).toFixed(), '-3');
  assert.equal(calculate('1 / 3').toFixed(), '0.' + '3'.repeat(80));
});

test('IF evaluates only its selected branch and comparisons remain numeric', () => {
  assert.equal(calculate('IF(D == 0, 0, A / D)', { A: '100', D: '0' }).toFixed(), '0');
  assert.equal(calculate('IF(D != 0, A / D, 7)', { A: '100', D: '4' }).toFixed(), '25');
  assert.equal(calculate('IF(2 > 1, MIN(8, MAX(3, ABS(-5))), 1 / 0)').toFixed(), '5');
  assert.equal(calculate('(1 <= 1) + (2 >= 3) + (1 < 2)').toFixed(), '2');
  throwsCode(() => calculate('IF(0, 7, A / D)', { A: '100', D: '0' }), 'FORMULA_DIVISION_BY_ZERO');
});

test('rounding declares its step, tie policy and negative-number direction', () => {
  assert.equal(calculate('ROUND(A, 0) + ROUND(B, 0)', { A: '0.5', B: '0.5' }).toFixed(), '2');
  assert.equal(calculate('ROUND(A + B, 0)', { A: '0.5', B: '0.5' }).toFixed(), '1');
  assert.equal(roundFormula(calculate('5 / 2'), 'HALF_EVEN', 0).toFixed(), '2');
  assert.equal(roundFormula(calculate('5 / 2'), 'HALF_UP', 0).toFixed(), '3');
  assert.equal(roundFormula(decimalValue('-1.9'), 'DOWN', 0).toFixed(), '-1');
  assert.equal(roundFormula(decimalValue('-1.9'), 'UP', 0).toFixed(), '-2');
  assert.equal(roundFormula(decimalValue('-1.9'), 'FLOOR', 0).toFixed(), '-2');
  assert.equal(roundFormula(decimalValue('-1.9'), 'CEIL', 0).toFixed(), '-1');
  assert.equal(calculate('ROUND(1250, -2)').toFixed(), '1300');
  throwsCode(() => calculate('ROUND(1, 1.5)'), 'FORMULA_ROUNDING_INVALID');
  throwsCode(() => roundFormula(decimalValue('1'), 'HALF_UP', 7), 'FORMULA_ROUNDING_INVALID');
});

test('declarations cannot be duplicated, omitted or silently unused; missing is not zero', () => {
  throwsCode(() => compileFormula('A + B', ['A']), 'FORMULA_VARIABLES_INVALID');
  throwsCode(() => compileFormula('A', ['A', 'B']), 'FORMULA_VARIABLES_INVALID');
  throwsCode(() => compileFormula('A', ['A', 'A']), 'FORMULA_VARIABLES_INVALID');
  throwsCode(() => compileFormula('A', ['a']), 'FORMULA_VARIABLES_INVALID');
  throwsCode(() => compileFormula('A', ['A']).evaluate(new Map()), 'FORMULA_INPUT_MISSING');
  assert.equal(calculate('A * 100', { A: '0' }).toFixed(), '0');
});

test('untrusted expressions cannot access properties, arbitrary calls, assignment or statements', () => {
  for (const expression of ['A.constructor', 'process.exit()', 'CONSTRUCTOR(1)', 'A = 1', '1; 2', 'A[0]', '1 || 2', 'IF(1, 2)', 'MIN()', 'ROUND(1)', '2 ** 3', '1e9']) {
    throwsCode(() => compileFormula(expression), 'FORMULA_SYNTAX_INVALID');
  }
});

test('numeric boundaries reject coercion, non-finite values and unrepresentable results', () => {
  for (const value of [1.2, null, '', ' ', 'NaN', 'Infinity', '1e5', '0.1234567890123456789']) {
    throwsCode(() => decimalValue(value), 'FORMULA_DECIMAL_INVALID');
  }
  throwsCode(() => calculate('999999999999999999999999999999 * 10'), 'FORMULA_RESULT_RANGE');
  assert.equal(calculate('999999999999999999999999999999 - 999999999999999999999999999998').toFixed(), '1');
});

test('expression complexity stays bounded before evaluation', () => {
  throwsCode(() => compileFormula('('.repeat(34) + '1' + ')'.repeat(34)), 'FORMULA_COMPLEXITY_LIMIT');
  throwsCode(() => compileFormula(Array.from({ length: 35 }, () => '1').join('+')), 'FORMULA_COMPLEXITY_LIMIT');
  throwsCode(() => compileFormula('1'.repeat(2001)), 'FORMULA_SYNTAX_INVALID');
});
