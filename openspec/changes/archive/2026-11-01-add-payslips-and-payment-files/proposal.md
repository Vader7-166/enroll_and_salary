## Why

Doanh nghiệp bắt buộc gửi bảng kê lương cho từng người (BR-62, phạt 10–20 triệu nếu không gửi) và chi lương qua ngân hàng với phí do doanh nghiệp chịu (BR-60). R1 cần phiếu lương PDF có mật khẩu, file chi theo mẫu ngân hàng, ghi nhận ngày chi thực tế và đền bù chậm trả (FR-7.6.1…7.6.3, FR-7.5.4, BR-61, UAT-01, NFR-10).

## What Changes

- **Phiếu lương** từng người từ bảng lương đã khóa: PDF đặt mật khẩu mở tệp theo quy tắc cấu hình, đủ nội dung bảng kê bắt buộc (lương cứng, phụ cấp, OT, BH, thuế, khấu trừ, điều chỉnh có kỳ gốc, thực lĩnh, đơn vị và số công từng đoạn); bản in theo từng người. Kỳ chưa khóa không xuất được.
- **Xuất hàng loạt** phiếu lương cho một cơ sở (~1.100 tệp ≤ 10 phút) dạng gói nén; ghi audit mỗi lần xuất; mật khẩu không gửi cùng kênh với tệp.
- **Mẫu file chi lương cấu hình theo ngân hàng** (cột, thứ tự, định dạng, tách theo cơ sở); thêm ngân hàng là khai báo cấu hình (NFR-21). File ghi đúng thực lĩnh, không trừ phí; tệp tạm được mã hóa; xuất cần xác thực lại.
- **Ghi nhận ngày chi thực tế** theo lô chi; xuất file không đồng nghĩa đã thanh toán.
- **Đền bù chậm trả > 15 ngày** theo `LATE_PAYMENT_RATE`, cộng vào kỳ lương kế tiếp thành dòng riêng có thuyết minh; chậm dưới 15 ngày chỉ cảnh báo.
- Ngày chi thực tế cập nhật trạng thái `ACTUAL` cho bản ghi khấu trừ thuế; nếu ngày chi đổi năm thuế so với dự kiến → báo cần chọn lại bộ thuế, không mở khóa bảng lương.

## Capabilities

### New Capabilities
- `payslips`: phiếu lương PDF có mật khẩu và bản in từ bảng lương đã khóa, xuất hàng loạt có audit.
- `salary-payment`: mẫu file chi theo ngân hàng, xuất file chi, ghi nhận ngày chi thực tế và đền bù chậm trả lương.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** module `backend/src/payroll-output/` (payslip renderer, bank file exporter, payment batch, late-payment compensation).
- **Database:** `payslip`, `bank_file_template`, `salary_payment_batch`, `salary_payment_item`; tham số `LATE_PAYMENT_RATE`, `LATE_PAYMENT_GRACE_DAYS`, `PAYSLIP_PASSWORD_RULE`.
- **Dependency:** thư viện PDF hỗ trợ mã hóa (ví dụ `pdfkit` có `userPassword`), `exceljs` (đã có) cho file chi, nén zip.
- **API:** `/api/payroll/sheets/:id/payslips`, `/api/payroll/payment-batches`, `/api/payroll/bank-templates`.
- **Phụ thuộc:** `add-payroll-approval-and-lock`, `add-employee-payroll-profile` (tài khoản ngân hàng).
