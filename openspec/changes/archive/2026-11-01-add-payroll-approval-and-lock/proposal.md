## Why

Sau khi engine tạo bảng lương nháp, KT cần duyệt, đưa về nháp khi đầu vào đổi và khóa kỳ lương với snapshot bất biến (FR-7.5.1…7.5.3, FR-1.5.2 phần kỳ lương, BR-43, UAT-10, UAT-20). Phiếu lương, file chi, báo cáo quỹ lương, BH/thuế đều chỉ được lấy từ bảng lương đã khóa, nên đây là cổng tiếp theo.

## What Changes

- Vòng trạng thái bảng lương **DRAFT → APPROVED → LOCKED**; mỗi lần duyệt/khóa ghi người, thời điểm, tổng tiền và hash nội dung.
- **Duyệt** chỉ khi không còn BLOCKING, không còn nhân viên lỗi và mọi CP-08 vượt ngưỡng đã được xác nhận.
- **Tự về Nháp**: bất kỳ thay đổi nguồn sau duyệt (đầu vào lương, phương án, quyết định lương, mức BH, quy tắc thuế…) làm bảng lương về DRAFT và phải duyệt lại; ghi audit lý do (UAT-10, TC-I09).
- **Khóa kỳ lương** nguyên tử theo revision: kiểm tra lại nguồn công LOCKED, bảng APPROVED, kỳ lương trước cùng cơ sở đã khóa (trừ kỳ khởi tạo); ghi `payroll_snapshot` + hash, chuyển `PayrollPeriod` sang LOCKED; `tax_withholding`, `insurance_contribution`, dòng lương trở thành bất biến; cập nhật số giảm trừ đã dùng trong năm.
- **Xác thực lại** (nhập lại mật khẩu) cho thao tác khóa (NFR-33).
- **Cảnh báo hạn chi**: kỳ lương sắp đến ngày chi dự kiến mà chưa khóa (FR-7.5.3).
- **Bằng chứng tuân thủ** CP-01…CP-09 lưu kèm snapshot, xuất PDF theo mẫu docs 13 §5.1 (UAT-20).

## Capabilities

### New Capabilities
- `payroll-approval-lock`: duyệt, tự về nháp khi nguồn đổi, khóa kỳ lương nguyên tử với snapshot/hash, cảnh báo hạn chi và báo cáo bằng chứng tuân thủ.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** mở rộng `backend/src/payroll/` (approval service, lock service, source-change listener, compliance PDF); hook vào các service nguồn để phát sự kiện thay đổi.
- **Database:** `payroll_snapshot`, `payroll_sheet_history`; thêm `revision` cho `payroll_sheet`; trigger bất biến cho dữ liệu đã khóa.
- **API:** `/api/payroll/sheets/:id/approve`, `/return-to-draft`, `/lock`, `/compliance-report.pdf`.
- **Dependency:** thư viện tạo PDF (ví dụ `pdfkit`) dùng chung với phiếu lương.
- **Phụ thuộc:** `add-payroll-calculation-engine`.
- **Ghi chú phạm vi:** FR-7.5.4 (đền bù chậm trả) cần ngày chi thực tế nên nằm trong `add-payslips-and-payment-files`.
