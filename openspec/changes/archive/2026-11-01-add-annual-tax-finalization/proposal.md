## Why

Dự thảo quyết toán thuế TNCN năm thuộc R1 (19 §1, FR-8.5.1, 8.5.2, BR-55, R1-AC-08). Năm 2026 còn có chuyển tiếp: hồ sơ 6 tháng đầu đã khai theo bộ cũ phải giữ nguyên và đối chiếu ở quyết toán (TC-T10, khoản 2 Điều 70 NĐ 253/2026). Cần tổng hợp theo năm chi trả từ bản ghi khấu trừ của bảng lương đã khóa.

## What Changes

- **Tổng hợp năm theo năm chi trả** cho từng nhân viên: tổng thu nhập chịu thuế, phần miễn, giảm trừ bản thân và NPT theo số tháng đủ điều kiện, BH được trừ, giảm trừ khác có trần năm (y tế/giáo dục), thuế đã khấu trừ thực tế.
- **Tính thuế năm** bằng biểu năm (ngưỡng tháng × 12) của bộ quy tắc năm; tính chênh lệch nộp thừa/thiếu.
- **Quản lý ủy quyền quyết toán** theo hồ sơ thuế; chỉ lập dự thảo cho người đủ điều kiện ủy quyền, liệt kê người không đủ điều kiện kèm lý do.
- **Kiểm tra dữ liệu** trước dự thảo: khoản dự kiến chưa có ngày chi thực tế, cờ `TAX_CONTEXT_CHANGED` chưa xử lý, NPT thiếu chứng từ.
- **Chuyển tiếp 2026**: giữ snapshot số đã khấu trừ/khai theo bộ cũ, tính nghĩa vụ năm theo bộ mới, điều chỉnh chênh lệch tại quyết toán, không sửa hồ sơ gốc.
- **Dự thảo hồ sơ** kèm phụ lục, xuất tệp Excel; trạng thái DRAFT/DONE; không kê khai điện tử.

## Capabilities

### New Capabilities
- `annual-tax-finalization`: tổng hợp năm chi trả, tính thuế năm, ủy quyền, kiểm tra dữ liệu, chuyển tiếp 2026 và xuất dự thảo hồ sơ.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** `backend/src/personal-income-tax/finalization/`.
- **Database:** `annual_tax_finalization`, `annual_tax_finalization_line`.
- **API:** `/api/pit/finalizations`.
- **Phụ thuộc:** `add-personal-income-tax-withholding`, `add-payroll-approval-and-lock`, `add-payslips-and-payment-files` (ngày chi thực tế).
