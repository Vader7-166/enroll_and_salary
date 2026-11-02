// Fictional electronics-manufacturing examples, not payroll or statutory policy.
const reference = 'MP-LUONG-2026-10';
const effectiveFrom = '2026-10-01';
const basis = 'Giả định kiểm thử doanh nghiệp điện tử; cờ BH/thuế/OT chỉ để thử phân loại độc lập, không phải kết luận pháp lý hoặc chính sách đã phê duyệt.';
const component = (code, name, flags = {}) => ({
  scope: 'COMPANY', code: 'MP_' + code, name, componentType: 'EARNING', active: true,
  isInsurable: false, taxClassification: 'TAXABLE', isOtBase: false, isProrated: false,
  classificationBasis: basis, ...flags,
});
const components = [
  component('LUONG_THOI_GIAN', 'Lương thời gian theo ngày/giờ công', { isInsurable: true, isOtBase: true, isProrated: true }),
  component('LUONG_SAN_PHAM', 'Lương sản phẩm đạt nghiệm thu'),
  component('LUONG_KHOAN', 'Lương khoán công đoạn đã nghiệm thu'),
  component('PC_TO_TRUONG', 'Phụ cấp trách nhiệm tổ trưởng', { isInsurable: true, isOtBase: true, isProrated: true,
    successor: { name: 'Phụ cấp trách nhiệm tổ trưởng – chính sách mới', isOtBase: false,
      classificationBasis: basis + ' Từ phiên bản mới, thử loại khoản này khỏi căn cứ OT.' } }),
  component('AN_CA', 'Hỗ trợ suất ăn ca', { taxClassification: 'CONDITIONAL' }),
  component('DI_LAI', 'Hỗ trợ đi lại theo ngày làm việc', { taxClassification: 'CONDITIONAL', isProrated: true }),
  component('CHUYEN_CAN', 'Thưởng chuyên cần đủ ngày chuẩn'),
  component('THUONG_NANG_SUAT', 'Thưởng năng suất theo sản phẩm có trần'),
  component('HOA_HONG', 'Hoa hồng doanh số đã xác nhận'),
  component('LUONG_3P', 'Lương kết hợp vị trí, năng lực và kết quả', { isProrated: true }),
  component('TRU_TAM_UNG', 'Khấu trừ tạm ứng đã đối chiếu', { componentType: 'DEDUCTION' }),
  component('DAO_TAO', 'Chi phí đào tạo do doanh nghiệp chi', { componentType: 'EMPLOYER_COST', taxClassification: 'NON_TAXABLE' }),
  component('PC_DIEN_THOAI_CU', 'Phụ cấp điện thoại cũ – ngừng áp dụng', { active: false, taxClassification: 'CONDITIONAL' }),
  ...['NM-BN', 'NM-HNA', 'NM-NA'].map(scope => component('PC_MOI_TRUONG', 'Phụ cấp môi trường sản xuất', {
    scope, isInsurable: true, isOtBase: true, isProrated: true,
  })),
].map((row, index) => ({ ...row, displayOrder: (index + 1) * 10 }));

const price = (code, name, priceType, amount, unit, extra = {}) => ({
  scope: 'COMPANY', code: 'MP_' + code, name, priceType, amount, unit, kind: 'PRICE', active: true, ...extra,
});
const prices = [
  price('LUONG_CN', 'Mức lương tháng công nhân sản xuất', 'MONTHLY', '6500000', 'VND/tháng'),
  price('LUONG_NV', 'Mức lương tháng chuyên viên văn phòng', 'MONTHLY', '14000000', 'VND/tháng'),
  price('CONG_NGAY', 'Đơn giá ngày làm việc thời vụ', 'DAILY', '280000', 'VND/ngày'),
  price('CONG_GIO', 'Đơn giá giờ làm việc thông thường', 'HOURLY', '40000', 'VND/giờ'),
  price('SP_BO_MACH', 'Đơn giá bo mạch điều khiển A1 đạt QC', 'PRODUCT', '1250', 'VND/sản phẩm', { productCode: 'PCB_CTRL_A1' }),
  price('KHOAN_HAN', 'Khoán hàn lô 100 bo mạch đã nghiệm thu', 'PIECEWORK', '180000', 'VND/lô', { productCode: 'PCB_CTRL_A1', operationCode: 'HAN_LO_100' }),
  price('TYLE_HOA_HONG', 'Tỷ lệ hoa hồng doanh số đã thu tiền', 'COMMISSION', '1.5', '%'),
  price('P1', 'P1 – mức lương vị trí kỹ sư sản xuất', 'P1', '9000000', 'VND/tháng'),
  price('P2', 'P2 – mức bổ sung năng lực bậc 3', 'P2', '2000000', 'VND/tháng'),
  price('P3', 'P3 – mức thưởng mục tiêu KPI 100%', 'P3', '3000000', 'VND/tháng'),
  price('SUAT_AN', 'Định mức hỗ trợ một suất ăn ca', 'DAILY', '25000', 'VND/suất', { successor: { amount: '27000', name: 'Định mức suất ăn ca – kỳ mới' } }),
  price('DI_LAI', 'Định mức hỗ trợ đi lại tháng đủ công', 'MONTHLY', '300000', 'VND/tháng'),
  price('PC_TO_TRUONG', 'Định mức phụ cấp trách nhiệm tổ trưởng', 'MONTHLY', '1200000', 'VND/tháng'),
  price('CHUYEN_CAN', 'Mức thưởng chuyên cần tháng đủ công', 'MONTHLY', '500000', 'VND/tháng'),
  price('THUONG_SP_TYLE', 'Tỷ lệ thưởng năng suất sản phẩm', 'COMMISSION', '3', '%'),
  price('THUONG_SP_TRAN', 'Trần thưởng năng suất tháng', 'MONTHLY', '800000', 'VND'),
  price('DAO_TAO', 'Dự toán đào tạo an toàn một người', 'MONTHLY', '500000', 'VND/người'),
  price('PC_DIEN_THOAI_CU', 'Định mức điện thoại cũ – ngừng áp dụng', 'MONTHLY', '200000', 'VND/tháng', { active: false }),
  ...[
    ['NM-BN', '6800000', '1350', '30000', '500000'],
    ['NM-HNA', '6500000', '1200', '28000', '400000'],
    ['NM-NA', '6200000', '1100', '25000', '350000'],
  ].flatMap(([scope, salary, product, meal, environment]) => [
    price('LUONG_CN', 'Mức lương tháng công nhân tại nhà máy', 'MONTHLY', salary, 'VND/tháng', {
      scope, ...(scope === 'NM-BN' ? { successor: { amount: '7100000', name: 'Mức lương tháng công nhân – điều chỉnh kỳ mới' } } : {}),
    }),
    price('SP_BO_MACH', 'Đơn giá bo mạch A1 theo nhà máy', 'PRODUCT', product, 'VND/sản phẩm', { scope, productCode: 'PCB_CTRL_A1' }),
    price('SUAT_AN', 'Định mức suất ăn ca theo nhà máy', 'DAILY', meal, 'VND/suất', { scope }),
    price('PC_MOI_TRUONG', 'Định mức phụ cấp môi trường sản xuất', 'MONTHLY', environment, 'VND/tháng', { scope }),
  ]),
  price('LUONG_NV', 'Mức lương chuyên viên trụ sở Hà Nội', 'MONTHLY', '14500000', 'VND/tháng', { scope: 'HQ-HN' }),
  price('CONG_GIO', 'Đơn giá giờ công thông thường tại trụ sở', 'HOURLY', '45000', 'VND/giờ', { scope: 'HQ-HN' }),
];
const input = (symbol, unit, min, max) => ({ symbol, source: 'INPUT', reference: symbol, unit, min, max });
const source = (symbol, code, unit, type = 'PRICE') => ({ symbol, source: type, reference: 'MP_' + code, unit });
const workdays = () => [input('NGAY_CONG', 'ngày', '0', '31'), input('NGAY_CHUAN', 'ngày', '1', '31')];
const formula = (code, name, componentCode, expression, variables, extra = {}) => ({
  scope: 'COMPANY', code: 'MP_' + code, name, kind: 'FORMULA', componentCode: 'MP_' + componentCode,
  expression, variables, unit: 'VND', active: true, roundingMode: 'HALF_UP', roundingScale: 0, ...extra,
});
const formulas = [
  formula('LUONG_CN', 'Lương công nhân theo ngày công thực tế', 'LUONG_THOI_GIAN', 'LUONG_THANG * NGAY_CONG / NGAY_CHUAN', [source('LUONG_THANG', 'LUONG_CN', 'VND/tháng'), ...workdays()]),
  formula('LUONG_NV', 'Lương chuyên viên theo ngày công thực tế', 'LUONG_THOI_GIAN', 'LUONG_THANG * NGAY_CONG / NGAY_CHUAN', [source('LUONG_THANG', 'LUONG_NV', 'VND/tháng'), ...workdays()]),
  formula('LUONG_NGAY', 'Lương thời vụ theo ngày làm việc', 'LUONG_THOI_GIAN', 'DON_GIA * SO_NGAY', [source('DON_GIA', 'CONG_NGAY', 'VND/ngày'), input('SO_NGAY', 'ngày', '0', '31')]),
  formula('LUONG_GIO', 'Lương giờ thông thường – không phải tiền OT', 'LUONG_THOI_GIAN', 'DON_GIA * SO_GIO', [source('DON_GIA', 'CONG_GIO', 'VND/giờ'), input('SO_GIO', 'giờ', '0', '300')]),
  formula('LUONG_SAN_PHAM', 'Lương bo mạch A1 theo sản phẩm đạt QC', 'LUONG_SAN_PHAM', 'DON_GIA * SL_DAT', [source('DON_GIA', 'SP_BO_MACH', 'VND/sản phẩm'), input('SL_DAT', 'sản phẩm', '0', '100000')]),
  formula('LUONG_KHOAN', 'Lương khoán hàn lô 100 bo mạch', 'LUONG_KHOAN', 'DON_GIA * SO_LO', [source('DON_GIA', 'KHOAN_HAN', 'VND/lô'), input('SO_LO', 'lô', '0', '60')]),
  formula('AN_CA', 'Hỗ trợ ăn ca theo số suất xác nhận', 'AN_CA', 'SUAT_AN * SO_SUAT', [source('SUAT_AN', 'SUAT_AN', 'VND/suất'), input('SO_SUAT', 'suất', '0', '62')]),
  formula('DI_LAI', 'Hỗ trợ đi lại phân bổ theo ngày công', 'DI_LAI', 'DINH_MUC * NGAY_CONG / NGAY_CHUAN', [source('DINH_MUC', 'DI_LAI', 'VND/tháng'), ...workdays()]),
  formula('PC_TO_TRUONG', 'Phụ cấp trách nhiệm theo ngày công', 'PC_TO_TRUONG', 'DINH_MUC * NGAY_CONG / NGAY_CHUAN', [source('DINH_MUC', 'PC_TO_TRUONG', 'VND/tháng'), ...workdays()]),
  formula('CHUYEN_CAN', 'Thưởng chuyên cần khi đủ ngày chuẩn', 'CHUYEN_CAN', 'IF(NGAY_CONG >= NGAY_CHUAN, DINH_MUC, 0)', [...workdays(), source('DINH_MUC', 'CHUYEN_CAN', 'VND/tháng')]),
  formula('HOA_HONG', 'Hoa hồng theo doanh số đã xác nhận', 'HOA_HONG', 'DOANH_SO * TY_LE / 100', [input('DOANH_SO', 'VND', '0', '1000000000000'), source('TY_LE', 'TYLE_HOA_HONG', '%')]),
  formula('LUONG_3P', 'Lương 3P: P1/P2 theo công và P3 theo KPI', 'LUONG_3P', '(P1 + P2) * NGAY_CONG / NGAY_CHUAN + P3 * KPI / 100', [source('P1', 'P1', 'VND/tháng'), source('P2', 'P2', 'VND/tháng'), source('P3', 'P3', 'VND/tháng'), ...workdays(), input('KPI', '%', '0', '150')]),
  formula('THUONG_NANG_SUAT', 'Thưởng năng suất 3% lương sản phẩm, tối đa 800.000', 'THUONG_NANG_SUAT', 'MIN(LUONG_SP * TY_LE / 100, TRAN)', [source('LUONG_SP', 'LUONG_SAN_PHAM', 'VND', 'FORMULA'), source('TY_LE', 'THUONG_SP_TYLE', '%'), source('TRAN', 'THUONG_SP_TRAN', 'VND')]),
  formula('TRU_TAM_UNG', 'Khấu trừ số tạm ứng đã đối chiếu', 'TRU_TAM_UNG', 'TAM_UNG_DA_XAC_NHAN', [input('TAM_UNG_DA_XAC_NHAN', 'VND', '0', '20000000')]),
  ...['NM-BN', 'NM-HNA', 'NM-NA'].map(scope => formula('PC_MOI_TRUONG', 'Phụ cấp môi trường theo ngày công nhà máy', 'PC_MOI_TRUONG', 'DINH_MUC * NGAY_CONG / NGAY_CHUAN', [source('DINH_MUC', 'PC_MOI_TRUONG', 'VND/tháng'), ...workdays()], { scope, componentScope: scope })),
];

// Expected amounts are independent worked examples, not computed by the formula engine.
const scenario = (name, scope, formulaCode, values, expected, extra = {}) => ({ name, scope, formulaCode: 'MP_' + formulaCode, values, expected, ...extra });
const days = { NGAY_CONG: '22', NGAY_CHUAN: '26' };
const scenarios = [
  scenario('Công nhân Bắc Ninh, 22/26 công', 'NM-BN', 'LUONG_CN', days, '5753846'),
  scenario('Công nhân Hà Nam, 22/26 công', 'NM-HNA', 'LUONG_CN', days, '5500000'),
  scenario('Công nhân Nghệ An, 22/26 công', 'NM-NA', 'LUONG_CN', days, '5246154'),
  scenario('Trụ sở kế thừa mức công nhân công ty', 'HQ-HN', 'LUONG_CN', days, '5500000'),
  scenario('Chuyên viên Hà Nội, 22/26 công', 'HQ-HN', 'LUONG_NV', days, '12269231'),
  scenario('Lao động thời vụ 12 ngày', 'NM-BN', 'LUONG_NGAY', { SO_NGAY: '12' }, '3360000'),
  scenario('Giờ thông thường tại nhà máy', 'NM-BN', 'LUONG_GIO', { SO_GIO: '176' }, '7040000'),
  scenario('Giờ thông thường tại trụ sở', 'HQ-HN', 'LUONG_GIO', { SO_GIO: '176' }, '7920000'),
  scenario('3.200 bo mạch đạt QC tại Bắc Ninh', 'NM-BN', 'LUONG_SAN_PHAM', { SL_DAT: '3200' }, '4320000'),
  scenario('3.200 bo mạch đạt QC tại Hà Nam', 'NM-HNA', 'LUONG_SAN_PHAM', { SL_DAT: '3200' }, '3840000'),
  scenario('3.200 bo mạch đạt QC tại Nghệ An', 'NM-NA', 'LUONG_SAN_PHAM', { SL_DAT: '3200' }, '3520000'),
  scenario('12 lô khoán hàn đã nghiệm thu', 'NM-BN', 'LUONG_KHOAN', { SO_LO: '12' }, '2160000'),
  scenario('22 suất ăn tại Bắc Ninh', 'NM-BN', 'AN_CA', { SO_SUAT: '22' }, '660000'),
  scenario('22 suất ăn tại trụ sở, định mức công ty', 'HQ-HN', 'AN_CA', { SO_SUAT: '22' }, '550000'),
  scenario('Hỗ trợ đi lại 22/26 công', 'NM-BN', 'DI_LAI', days, '253846'),
  scenario('Phụ cấp tổ trưởng 22/26 công', 'NM-BN', 'PC_TO_TRUONG', days, '1015385'),
  scenario('Chuyên cần đủ 26 công', 'NM-BN', 'CHUYEN_CAN', { NGAY_CONG: '26', NGAY_CHUAN: '26' }, '500000'),
  scenario('Chuyên cần thiếu một công', 'NM-BN', 'CHUYEN_CAN', { NGAY_CONG: '25', NGAY_CHUAN: '26' }, '0'),
  scenario('Không có ngày làm việc, khai báo số 0', 'NM-BN', 'LUONG_CN', { NGAY_CONG: '0', NGAY_CHUAN: '26' }, '0'),
  scenario('Hoa hồng 1,5% doanh số 180 triệu', 'HQ-HN', 'HOA_HONG', { DOANH_SO: '180000000' }, '2700000'),
  scenario('Lương 3P, 22 công và KPI 90%', 'NM-BN', 'LUONG_3P', { ...days, KPI: '90' }, '12007692'),
  scenario('Thưởng năng suất truy ngược công thức lương sản phẩm', 'NM-BN', 'THUONG_NANG_SUAT', { SL_DAT: '3200' }, '129600', { order: ['MP_LUONG_SAN_PHAM', 'MP_THUONG_NANG_SUAT'] }),
  scenario('Thưởng năng suất chạm trần', 'NM-BN', 'THUONG_NANG_SUAT', { SL_DAT: '50000' }, '800000'),
  scenario('Khấu trừ tạm ứng hai triệu', 'NM-BN', 'TRU_TAM_UNG', { TAM_UNG_DA_XAC_NHAN: '2000000' }, '2000000'),
  scenario('Phụ cấp môi trường Bắc Ninh', 'NM-BN', 'PC_MOI_TRUONG', days, '423077'),
  scenario('Phụ cấp môi trường Hà Nam', 'NM-HNA', 'PC_MOI_TRUONG', days, '338462'),
  scenario('Phụ cấp môi trường Nghệ An', 'NM-NA', 'PC_MOI_TRUONG', days, '296154'),
  scenario('Bắc Ninh sau điều chỉnh mức tháng lên 7,1 triệu', 'NM-BN', 'LUONG_CN', days, '6007692', { successorOf: ['NM-BN', 'MP_LUONG_CN'] }),
  scenario('Trụ sở sau điều chỉnh suất ăn lên 27.000', 'HQ-HN', 'AN_CA', { SO_SUAT: '22' }, '594000', { successorOf: ['COMPANY', 'MP_SUAT_AN'] }),
  scenario('Thiếu ngày công không được mặc định bằng 0', 'NM-BN', 'LUONG_CN', { NGAY_CHUAN: '26' }, undefined, { error: 400 }),
  scenario('Ngày chuẩn bằng 0 bị từ chối', 'NM-BN', 'LUONG_CN', { NGAY_CONG: '22', NGAY_CHUAN: '0' }, undefined, { error: 400 }),
  scenario('Sản phẩm nghiệm thu âm bị từ chối', 'NM-BN', 'LUONG_SAN_PHAM', { SL_DAT: '-1' }, undefined, { error: 400 }),
];
module.exports = { reference, effectiveFrom, components, prices, formulas, scenarios };
