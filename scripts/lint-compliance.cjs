// Local compliance lint (task 2.2) on the TypeScript AST, no network needed. Rules:
//   money-float        money in payroll/insurance/tax/benefit code must stay Decimal: no parseFloat, Number(…)/toNumber() on money names
//   legal-constant     a literal equal to a known legal value (regional minimum, family deduction, contribution rates…) belongs in legal_parameter
//   date-param-lookup  parameter/ruleset lookups take the business date of the record, never `new Date()`
// Suppress one finding with `// compliance-lint-ignore <rule>: <reason>` on the line or the line above.
// Findings are warnings (exit 0) until the rule is promoted: `--error <rule>` (repeatable) or `--strict` (all rules) exit 1.
const ts = require('typescript');
const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const args = process.argv.slice(2);
// --src points the lint at another tree (the rule tests use a fixture directory).
const src = args.includes('--src') ? resolve(args[args.indexOf('--src') + 1]) : join(root, 'backend/src');
const strict = args.includes('--strict');
const errorRules = new Set(args.flatMap((arg, index) => arg === '--error' ? [args[index + 1]] : []));
const json = args.includes('--json');

const MONEY_DIRS = /^(payroll|payroll-events|payroll-output|payroll-inputs|payroll-configuration|employee-pay-plans|salary-components|salary-decisions|social-insurance|personal-income-tax|overtime-pay|welfare|personnel\/termination)/;
const MONEY_NAME = /(amount|salary|wage|money|gross|net(?![a-z])|tax(?!Code|code|Profile|profile)|insurance|premium|allowance|bonus|deduction|severance|price|total|pay(?!load|ment(Date|date))|fund|arrear|refund)/i;
const LEGAL_VALUES = new Map([
  ...[4960000, 4410000, 3860000, 3450000, 4680000, 4160000, 3640000, 3250000, 5310000, 4730000, 4140000, 3700000].map(v => [v, 'lương tối thiểu vùng']),
  [2340000, 'lương cơ sở'], [11000000, 'giảm trừ bản thân 2020'], [4400000, 'giảm trừ NPT 2020'], [15500000, 'giảm trừ bản thân 2026'], [6200000, 'giảm trừ NPT 2026'],
  [0.175, 'tỷ lệ BHXH DN'], [0.08, 'tỷ lệ BHXH NLĐ'], [0.015, 'tỷ lệ BHYT NLĐ'], [0.03, 'tỷ lệ BHYT DN'], [0.105, 'tổng tỷ lệ NLĐ'], [0.215, 'tổng tỷ lệ DN'], [0.85, 'tỷ lệ lương thử việc'],
]);
const PARAM_CALL = /(param|legal|ruleset|rateFor|minimumFor|regionalMinimum)/i;

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.endsWith('.spec.ts')) out.push(path);
  }
  return out;
}

const findings = [];
for (const file of files(src)) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const rel = relative(src, file).replace(/\\/g, '/');
  const lines = text.split('\n');
  const money = MONEY_DIRS.test(rel);
  const report = (node, rule, message) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const ignore = new RegExp('compliance-lint-ignore\\s+' + rule + '\\b');
    if (ignore.test(lines[line] ?? '') || ignore.test(lines[line - 1] ?? '')) return;
    findings.push({ rule, file: 'backend/src/' + rel, line: line + 1, message, severity: strict || errorRules.has(rule) ? 'error' : 'warning' });
  };
  const visit = node => {
    if (money && ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (callee === 'parseFloat') report(node, 'money-float', 'parseFloat trong mã tiền tệ; dùng Prisma.Decimal.');
      // Only values that read like money; Number(await param("…_MONTHS")) or Number(period.slice(0, 4)) are counts, not amounts.
      const value = node.arguments[0];
      const plain = value && (ts.isIdentifier(value) || ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value));
      if (callee === 'Number' && plain && MONEY_NAME.test(value.getText(sf))) report(node, 'money-float', 'Number(' + node.arguments[0].getText(sf).slice(0, 40) + ') biến tiền thành float.');
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'toNumber' && MONEY_NAME.test(node.expression.expression.getText(sf)))
        report(node, 'money-float', node.expression.expression.getText(sf).slice(0, 40) + '.toNumber() biến tiền thành float.');
    }
    if (ts.isNumericLiteral(node) && LEGAL_VALUES.has(Number(node.text)) && !/^(migrations|seed)/.test(rel))
      report(node, 'legal-constant', node.text + ' trùng ' + LEGAL_VALUES.get(Number(node.text)) + '; lấy từ legal_parameter theo ngày hiệu lực.');
    if (ts.isNewExpression(node) && node.expression.getText(sf) === 'Date' && !(node.arguments?.length)) {
      for (let parent = node.parent; parent && !ts.isFunctionLike(parent) && !ts.isBlock(parent); parent = parent.parent) {
        if (ts.isCallExpression(parent) && PARAM_CALL.test(parent.expression.getText(sf))) {
          report(node, 'date-param-lookup', 'new Date() khi tra ' + parent.expression.getText(sf).slice(0, 40) + '; dùng ngày nghiệp vụ của bản ghi.');
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const errors = findings.filter(item => item.severity === 'error');
if (json) console.log(JSON.stringify(findings, null, 1));
else {
  for (const item of findings) console.log(`${item.file}:${item.line} ${item.severity} [${item.rule}] ${item.message}`);
  const byRule = {};
  for (const item of findings) byRule[item.rule] = (byRule[item.rule] ?? 0) + 1;
  console.log(`compliance-lint: ${findings.length} finding(s) ${JSON.stringify(byRule)}, ${errors.length} error(s)`);
}
if (errors.length) process.exitCode = 1;
