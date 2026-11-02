// NFR-10 payslip benchmark: 1.100 password-protected payslip PDFs for one site rendered from a snapshot-shaped
// payload and packed into one archive, as the bulk export job does. Excludes database reads; see docs/20.
const { performance } = require('node:perf_hooks');
const os = require('node:os');
const JSZip = require('jszip');
const { payslipView, payslipPassword, parsePasswordRule, renderPayslipPdf } = require('../backend/dist/payroll-output/payslip-renderer.js');

const COUNT = Number(process.env.PAYSLIP_COUNT ?? 1100);
const content = { period: { id: 'p', code: 'PL-2026-10-BN', siteOrgUnitId: 's', dateFrom: '2026-10-01', dateTo: '2026-10-31', expectedPaymentDate: '2026-11-05' }, sheet: { id: 's' }, employees: [] };
const employee = index => ({
  employeeId: 'e' + index, code: 'BN' + String(index).padStart(5, '0'), fullName: 'Nguyễn Văn Thử ' + index, status: 'OK',
  totals: { gross: '14250000', insuranceEmployee: '1365000', unionFee: '130000', tax: '0', deductions: '200000', adjustments: '27397', net: '12582397' },
  units: [{ orgUnitCode: 'NM-BN-D1-T1', orgUnitName: 'Tổ 1', from: '2026-10-01', to: '2026-10-15', workUnits: '12' }, { orgUnitCode: 'NM-BN-D2-T3', orgUnitName: 'Tổ 3', from: '2026-10-16', to: '2026-10-31', workUnits: '14' }],
  lines: [
    { lineNo: 1, lineType: 'MAIN', label: 'Lương thời gian', componentCode: 'LUONG_TG', quantity: '26', amount: '13000000' },
    { lineNo: 2, lineType: 'ALLOWANCE', label: 'Phụ cấp ăn ca', componentCode: 'AN_CA', amount: '730000' },
    { lineNo: 3, lineType: 'OT', label: 'Tiền làm thêm giờ', componentCode: null, quantity: '6', amount: '520000' },
    { lineNo: 4, lineType: 'INSURANCE_EMPLOYEE', label: 'BHXH (NLĐ)', componentCode: 'BHXH', amount: '1040000' },
    { lineNo: 5, lineType: 'INSURANCE_EMPLOYEE', label: 'BHYT (NLĐ)', componentCode: 'BHYT', amount: '195000' },
    { lineNo: 6, lineType: 'INSURANCE_EMPLOYEE', label: 'BHTN (NLĐ)', componentCode: 'BHTN', amount: '130000' },
    { lineNo: 7, lineType: 'UNION_FEE', label: 'Đoàn phí công đoàn', componentCode: null, amount: '130000' },
    { lineNo: 8, lineType: 'TAX', label: 'Thuế TNCN', componentCode: null, amount: '0' },
    { lineNo: 9, lineType: 'DEDUCTION', label: 'Khấu trừ đồng phục', componentCode: 'KT_DP', amount: '200000' },
    { lineNo: 10, lineType: 'ADJUSTMENT', label: 'Đền bù chậm trả lương kỳ PL-2026-09-BN', componentCode: 'LATE_PAYMENT_COMPENSATION', sourceReference: 'Kỳ gốc PL-2026-09-BN', amount: '27397' },
    { lineNo: 11, lineType: 'NET', label: 'Thực lĩnh', componentCode: null, amount: '12582397' },
  ],
});

(async () => {
  const tokens = parsePasswordRule('EMPLOYEE_CODE+ID_LAST4+DOB_DDMMYYYY');
  const zip = new JSZip();
  const started = performance.now();
  for (let index = 0; index < COUNT; index += 1) {
    const row = employee(index);
    const password = payslipPassword(tokens, { employeeCode: row.code, idNumber: '0010900' + String(index).padStart(5, '0'), dob: '1990-01-15' });
    const pdf = await renderPayslipPdf(payslipView(content, row, { siteName: 'Nhà máy Bắc Ninh', companyName: 'Công ty mô phỏng', snapshotHash: 'a'.repeat(64) }), password);
    zip.file('phieu-luong-' + row.code + '.pdf', pdf);
  }
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  const seconds = (performance.now() - started) / 1000;
  console.log(JSON.stringify({ payslips: COUNT, seconds: Number(seconds.toFixed(2)), msPerPayslip: Number((seconds * 1000 / COUNT).toFixed(1)), archiveMB: Number((archive.length / 1048576).toFixed(1)), limitSeconds: 600, cpu: os.cpus()[0]?.model, node: process.version }));
  if (seconds > 600) process.exitCode = 1;
})();
