const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

// Stable IDs and empty updates preserve all dated versions edited through the API.
async function seedHrSettings(tx, id, effectiveFrom) {
  const simulation = JSON.parse(readFileSync(resolve(__dirname, '../../docs/config/hrtp-simulation-policy.json'), 'utf8'));
  const parameters = [];
  for (const [region, monthly, hourly] of [
    ['I', '5310000', '25500'], ['II', '4730000', '22700'],
    ['III', '4140000', '20000'], ['IV', '3700000', '17800'],
  ]) {
    parameters.push([`MIN_WAGE_MONTH_${region}`, monthly, 'VND/month', 'NĐ 293/2025/NĐ-CP; hiệu lực 01/01/2026; tài liệu 04 BR-06']);
    parameters.push([`MIN_WAGE_HOUR_${region}`, hourly, 'VND/hour', 'NĐ 293/2025/NĐ-CP; hiệu lực 01/01/2026; tài liệu 04 BR-06']);
  }
  parameters.push(
    ['PROBATION_MIN_RATIO', '0.85', 'ratio', 'BLLĐ 2019 Điều 26; tài liệu 04 BR-09'],
    ['PROBATION_MAX_DAYS_TECHNICAL', '60', 'day', 'BLLĐ 2019 Điều 25; tài liệu 04 BR-57'],
    ['PROBATION_MAX_DAYS_WORKER', '30', 'day', 'BLLĐ 2019 Điều 25; tài liệu 04 BR-57'],
    ['FIXED_TERM_MIN_MONTHS', '12', 'month', 'Giới hạn mô phỏng của tài liệu 04 BR-57; không phải sàn thời hạn chung của pháp luật'],
    ['FIXED_TERM_MAX_MONTHS', '36', 'month', 'BLLĐ 2019 Điều 20; tài liệu 04 BR-57'],
    ['FIXED_TERM_MAX_COUNT', '2', 'count', 'BLLĐ 2019 Điều 20; tài liệu 04 BR-58'],
    ['INSURANCE_MIN_CONTRACT_MONTHS', '1', 'month', 'Tài liệu 04 BR-49; điều kiện theo thời hạn hợp đồng, không thay thế xác định đối tượng BH'],
  );
  for (const [paramCode, value, unit, legalBasis] of parameters) {
    await tx.legalParameter.upsert({
      where: { id: id('parameter:' + paramCode) }, update: {},
      create: { id: id('parameter:' + paramCode), paramCode, scopeKey: 'GLOBAL', subjectType: 'ALL',
        applicationBasis: 'WORK_DATE', value, unit, effectiveFrom, documentEffectiveDate: effectiveFrom, legalBasis },
    });
  }
  for (const site of simulation.sites) {
    await tx.sitePolicy.upsert({
      where: { id: id('policy:cutoff:' + site.code) }, update: {},
      create: { id: id('policy:cutoff:' + site.code), orgUnitId: id('org:' + site.code), policyKey: 'CUTOFF_DAY',
        value: simulation.defaults.attendance_cutoff_day, status: 'SIMULATION',
        decisionReference: simulation.policy_set_id + ' / DEC-03', effectiveFrom },
    });
  }
}
module.exports = { seedHrSettings };
