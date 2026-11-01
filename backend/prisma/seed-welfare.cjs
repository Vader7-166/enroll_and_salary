// Twelve simulation benefits at company level (docs 07 §14, FR-9.1.1); amounts and tax treatment await business
// confirmation. Stable ids + empty updates keep versions created through the API.
const BENEFITS = [
  ['MP_BH_SUC_KHOE', 'HEALTH_INSURANCE', 'Bảo hiểm sức khỏe tự nguyện', '3000000', 'NON_TAXABLE', null, false, { minServiceMonths: 12 }],
  ['MP_KHAM_SUC_KHOE', 'HEALTH_CHECK', 'Khám sức khỏe định kỳ', '800000', 'NON_TAXABLE', null, false, {}],
  ['MP_AN_CA', 'MEAL', 'Ăn ca', '730000', 'EXEMPT_UP_TO_LIMIT', '730000', true, {}],
  ['MP_XE_DUA_DON', 'SHUTTLE', 'Xe đưa đón', '500000', 'NON_TAXABLE', null, false, {}],
  ['MP_DIEN_THOAI', 'PHONE', 'Hỗ trợ điện thoại', '300000', 'TAXABLE', null, true, {}],
  ['MP_DONG_PHUC', 'UNIFORM', 'Đồng phục', '1000000', 'EXEMPT_UP_TO_LIMIT', '5000000', false, {}],
  ['MP_QUA_TET', 'GIFT', 'Quà Tết', '1000000', 'TAXABLE', null, true, { minServiceMonths: 3 }],
  ['MP_HIEU_HI', 'FAMILY_EVENT', 'Hiếu hỉ', '1000000', 'NON_TAXABLE', null, false, {}],
  ['MP_DU_LICH', 'TRAVEL', 'Du lịch hằng năm', '3000000', 'TAXABLE', null, true, { minServiceMonths: 12 }],
  ['MP_DAO_TAO', 'TRAINING', 'Đào tạo', '2000000', 'NON_TAXABLE', null, false, {}],
  ['MP_HO_TRO_NHA_O', 'HOUSING', 'Hỗ trợ nhà ở', '500000', 'TAXABLE', null, true, { contractTypes: ['INDEFINITE', 'FIXED_TERM'] }],
  ['MP_NUOI_CON_NHO', 'CHILDCARE', 'Hỗ trợ nuôi con nhỏ', '300000', 'TAXABLE', null, true, {}],
];

async function seedWelfare(tx, id, companyId, effectiveFrom) {
  for (const [code, category, name, amount, taxTreatment, exemptLimit, payrollIncluded, eligibility] of BENEFITS) {
    await tx.benefitCatalog.upsert({ where: { code }, update: {}, create: { id: id('benefit:' + code), code, orgUnitId: companyId, category } });
    await tx.benefitCatalogVersion.upsert({
      where: { id: id('benefit-version:' + code) }, update: {},
      create: { id: id('benefit-version:' + code), catalogId: id('benefit:' + code), name, amount, taxTreatment, exemptLimit, payrollIncluded, eligibility,
        decisionReference: 'Quy chế phúc lợi mô phỏng HRTP-SIM-2026-V1', status: 'SIMULATION', effectiveFrom },
    });
  }
}
module.exports = { seedWelfare };
