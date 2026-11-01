## Context

Docs 09 §10 định nghĩa `benefit_catalog`, `benefit_allocation` (unique chống trùng) và `severance_allowance`. Cấu phần lương có phân loại thuế; bộ thuế có định mức miễn theo hiệu lực (ví dụ ăn ca). Engine có registry stage khoản cộng thêm.

## Goals / Non-Goals

**Goals:**
- Điều kiện hưởng là dữ liệu, lọc lặp lại được.
- Không cấp trùng; danh sách dự kiến không ảnh hưởng lương.

**Non-Goals:**
- Không làm phúc lợi tự chọn (ngoài phạm vi theo docs 07 §14).
- Không quản lý kho đồng phục/quà.

## Decisions

1. **Danh mục có phiên bản**: `benefit_catalog(code)` + `benefit_catalog_version(name, amount, tax_treatment TAXABLE/NON_TAXABLE/EXEMPT_UP_TO_LIMIT, payroll_included, eligibility JSON, effective_from/to)`; quy tắc phiên bản như cấu phần lương.
2. **Điều kiện hưởng JSON có schema** giới hạn: `{minServiceMonths, jobGrades[], contractTypes[], orgUnitIds[] (kế thừa cây)}`; đánh giá bằng hàm thuần tại ngày tham chiếu của kỳ, không cho biểu thức tự do.
3. **Lô cấp phát** DRAFT → CONFIRMED; thêm/bớt chỉ ở DRAFT, mỗi lần thay đổi chạy lại kiểm tra điều kiện (người bị thêm thủ công không đủ điều kiện phải có lý do). Xác nhận kiểm tra unique `(catalog, employee, period_code)` trên toàn hệ thống; dòng trùng bị loại khỏi xác nhận và báo cho KT.
4. **Đưa vào lương**: allocation có `payroll_included` gắn `payroll_period_id`; stage engine đọc allocation CONFIRMED, gắn loại thu nhập theo `tax_treatment` để bộ thuế xử lý.
5. **Chi phí** là truy vấn tổng hợp allocation CONFIRMED + `severance_allowance` theo cost center của nhân viên tại kỳ.

## Risks / Trade-offs

- [Điều kiện phức tạp hơn schema] → bổ sung trường vào schema có phiên bản; không mở biểu thức tự do.

## Migration Plan

Migration bảng mới; seed danh mục mô phỏng.

## Open Questions

- Định mức miễn thuế của từng khoản phúc lợi (đồng phục, điện thoại…) có cần ruleset riêng? Đề xuất dùng định mức trong ruleset thuế theo hiệu lực.
