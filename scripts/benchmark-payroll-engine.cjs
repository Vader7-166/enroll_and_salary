// NFR-07 engine benchmark: 3.000 simulated employees on 4 sites through the real payroll pipeline,
// insurance and PIT engines. Excludes database load/persist time; see docs/20 for what is measured.
const { performance } = require('node:perf_hooks');
const os = require('node:os');
const { calculateEmployee } = require('../backend/dist/payroll/payroll-engine.js');
const { insuranceEligibility, insurableSalary, insuranceContribution, checkCp07 } = require('../backend/dist/social-insurance/insurance-engine.js');
const { selectTaxContext, withhold } = require('../backend/dist/personal-income-tax/pit-engine.js');

const M = 1_000_000;
const brackets = [[0, 10 * M, '0.05'], [10 * M, 30 * M, '0.1'], [30 * M, 60 * M, '0.2'], [60 * M, 100 * M, '0.3'], [100 * M, null, '0.35']].map(([lower, upper, rate], index) => ({ basis: 'MONTH', bracketNo: index + 1, lower: String(lower), upper: upper === null ? null : String(upper), rate }));
const ruleset = { id: 'r26', code: 'RES-PROG-2026', subject: 'RESIDENT_PROGRESSIVE', exemptionMode: 'ELIGIBLE_PAYMENT', effectiveFrom: '2026-01-01', effectiveTo: null, settings: { selfDeduction: '15500000', dependentDeduction: '6200000' }, brackets, legalBasis: 'SIM', status: 'SIMULATION' };
const sites = [['I', '5310000'], ['I', '5310000'], ['II', '4730000'], ['III', '4140000']];
const rates = { BHXH: { id: 'a', employeeRate: '0.08', employerRate: '0.175' }, BHYT: { id: 'b', employeeRate: '0.015', employerRate: '0.03' }, BHTN: { id: 'c', employeeRate: '0.01', employerRate: '0.01' }, KPCD: { id: 'd', employeeRate: '0', employerRate: '0.02' } };
const days = Array.from({ length: 26 }, (_, index) => ({ workDate: '2026-10-' + String(index + 1).padStart(2, '0'), workUnits: '1', workedMinutes: 480, status: 'OK', correctionId: null }));

function contextFor(index) {
  const [region, minimum] = sites[index % 4];
  const salary = String(6_000_000 + (index % 50) * 400_000);
  const buckets = index % 3 === 0 ? [{ employeeId: 'e' + index, orgUnitId: 'u', workDate: '2026-10-05', kind: 'OT', dayType: 'THUONG', isNight: false, hasDayOt: true, minutes: '120', rate: '1.5', rateBreakdown: { parameters: [] } }] : [];
  return {
    employee: { id: 'e' + index, code: 'NV' + index, fullName: 'NV ' + index, hireDate: '2026-01-01', terminationDate: null },
    period: { id: 'p', code: 'PL', dateFrom: '2026-10-01', dateTo: '2026-10-31', paymentDate: '2026-11-05', month: '2026-10' },
    planVersions: [{ id: 'pl', payMode: 'MONTHLY', status: 'SIMULATION', effectiveFrom: '2026-01-01', effectiveTo: null, lines: [{ componentId: 'T', role: 'BASE', sourceType: 'TIME', allocation: 'INDIVIDUAL' }] }],
    components: { T: { isInsurable: true, taxClassification: 'TAXABLE', isOtBase: true, isProrated: true, componentType: 'EARNING', code: 'LUONG_TG', name: 'Lương thời gian' } },
    inputs: [], salary: [{ componentId: null, componentCode: null, componentName: 'Lương', from: '2026-10-01', to: '2026-10-31', amount: salary, salaryBasis: 'MONTHLY', source: 'CONTRACT', sourceId: 'hd' + index, reference: 'HD' }],
    units: [{ orgUnitId: 'u' + (index % 4), orgUnitCode: 'U', orgUnitName: 'U', siteId: 's' + (index % 4), wageRegionCode: region, costCenterCode: 'CC' + (index % 4), from: '2026-10-01', to: '2026-10-31', days: 31, minimumMonth: { id: 'm', value: minimum }, minimumHour: null }],
    attendance: { available: true, days, regularMinutes: String(26 * 480), lockHashes: ['h'] }, buckets, bucketHash: 'b', contracts: [], previousGross: index % 5 === 0 ? salary : null,
    params: { standardWorkdays: { id: 's', value: '26' }, deductionMaxNetRatio: { id: 'd', value: '0.3' }, varianceThreshold: { id: 'v', value: '0.2' }, otMonthMaxMinutes: { id: 'o', value: '2400' }, probationMinRatio: { id: 'q', value: '0.85' }, roundingScale: 0 },
  };
}

async function main() {
  const count = Number(process.argv[2] ?? 3000);
  const contexts = Array.from({ length: count }, (_, index) => contextFor(index));
  const started = performance.now();
  let errors = 0, net = 0;
  for (const ctx of contexts) {
    const minimum = ctx.units[0].minimumMonth.value;
    const result = await calculateEmployee(ctx, {
      insurance: async extra => {
        const eligibility = insuranceEligibility({ month: '2026-10', contracts: [{ type: 'INDEFINITE', insuranceEligible: true }], statuses: [], unpaidLeaveDays: 0, unpaidLeaveThreshold: 14 });
        const salary = insurableSalary({ components: [{ code: 'AGREED', name: 'Lương', amount: ctx.salary[0].amount, insurable: true }, ...extra], regionalMinimum: minimum, trainedAddon: null, caps: { BHXH: '46800000', BHYT: '46800000', BHTN: String(Number(minimum) * 20) } });
        const contribution = insuranceContribution({ eligibility, salary, rates, unionFee: { rate: '0.01', cap: '234000', parameterIds: [] }, rounding: { scale: 0 } });
        return { eligible: eligibility.eligible, reasonCode: eligibility.reasonCode, insurableRaw: salary.raw, cp07: checkCp07(eligibility, salary), lines: contribution.lines, trace: {} };
      },
      tax: async (items, insurance) => {
        const context = selectTaxContext({ rulesets: [ruleset], subject: 'RESIDENT_PROGRESSIVE', paymentDate: '2026-11-05', paymentDateStatus: 'PROJECTED' });
        const value = withhold(context, items, null, { insurance, dependents: Number(ctx.employee.id.slice(1)) % 3 }, { commitment: false, voluntaryRequest: false });
        return { tax: value.tax, branch: value.branch, rulesetId: 'r26', rulesetCode: 'RES-PROG-2026', taxPeriod: '2026-11', exceptions: value.exemptions.exceptions, trace: {} };
      },
    });
    if (result.status === 'ERROR') errors += 1; else net += Number(result.totals.net);
  }
  const seconds = (performance.now() - started) / 1000;
  console.log(JSON.stringify({ employees: count, sites: 4, seconds: Number(seconds.toFixed(3)), perEmployeeMs: Number((seconds * 1000 / count).toFixed(3)), errors, totalNet: net, nfr07LimitSeconds: 900, passEngineOnly: seconds < 900, node: process.version, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: Number((os.totalmem() / 2 ** 30).toFixed(1)) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
