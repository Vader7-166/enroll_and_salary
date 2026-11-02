## 1. Dữ liệu

- [x] 1.1 Migration `payroll_snapshot` (sheet, content, content hash, locked at/by, compliance result ids), `payroll_sheet_history`; thêm `revision`, `approved_source_hash`, `is_initial` cho kỳ/bảng
- [x] 1.2 Trigger bất biến cho dòng lương, BH, thuế thuộc bảng đã khóa
- [x] 1.3 Tham số `PAYROLL_DUE_WARNING_DAYS`

## 2. Backend

- [x] 2.1 Service duyệt: kiểm tra BLOCKING, nhân viên lỗi, CP-08 đã xác nhận; ghi lịch sử
- [x] 2.2 Sự kiện "nguồn thay đổi" từ payroll-inputs, employee-pay-plans, salary decisions, insurance rates, pit rulesets → về DRAFT + audit
- [x] 2.3 Endpoint xác thực lại trả token ngắn hạn gắn phiên
- [x] 2.4 Service khóa nguyên tử: revision, nguồn công LOCKED, hash nguồn, kỳ trước, snapshot + hash, `PayrollPeriod` LOCKED, cập nhật `tax_deduction_usage`, audit
- [x] 2.5 Cảnh báo hạn chi trong danh sách kỳ lương
- [x] 2.6 PDF bằng chứng tuân thủ từ snapshot
- [x] 2.7 Integration test `backend/test/payroll-lock.test.cjs` (UAT-10, UAT-20, TC-I09, kỳ trước chưa khóa, trigger bất biến, token); script `verify:payroll-lock`

## 3. Giao diện và tài liệu

- [x] 3.1 Nút Duyệt/Khóa có hộp xác nhận, nhập lại mật khẩu, hiển thị trạng thái và lịch sử
- [x] 3.2 Cảnh báo hạn chi và tải PDF tuân thủ
- [x] 3.3 Cập nhật README và docs/20
