## Context

Lương tối thiểu vùng đã có trong `legal_parameter` (`MIN_WAGE_MONTH_*`) và vùng gắn cơ sở. Hợp đồng có `insurance_eligible` và tham số `INSURANCE_MIN_CONTRACT_MONTHS`. Cấu phần lương có cờ `is_insurable`. Diện đặc thù và đào tạo nghề đến từ `add-employee-payroll-profile`.

## Goals / Non-Goals

**Goals:**
- Bộ tính thuần, Decimal, không hardcode tỷ lệ; test được với bảng pháp lý.
- Diện tham gia xác định theo tháng, giải thích được lý do.

**Non-Goals:**
- Không lập danh sách tăng/giảm hay đối chiếu C12 (thuộc `add-insurance-change-reporting`).
- Không tính chế độ ốm đau/thai sản (thuộc `add-sickness-maternity-and-absence-tracking`).

## Decisions

1. **Bảng `insurance_rate` riêng** thay vì nhồi vào `legal_parameter`: một bản ghi có nhiều trường liên quan (tỷ lệ hai phía, sàn, trần) theo loại BH và vùng; docs 09 §9 đã định nghĩa bảng này. Sàn tham chiếu mức tối thiểu vùng, không lưu trùng số tiền.
2. **Diện tham gia là hàm theo tháng:** `insuranceEligibility(employee, yyyyMm)` trả `{eligible, reasonCode}` với mã như `CONTRACT_UNDER_1_MONTH`, `UNPAID_LEAVE_14_DAYS`, `RETIREE`, `FOREIGNER_RULE`. Số ngày nghỉ không lương lấy từ đơn nghỉ/công đã khóa của tháng.
3. **Lương đóng BH** = Σ cấu phần `is_insurable` theo timeline lương của tháng; áp sàn = mức tối thiểu vùng × (1 + addon nếu đã qua đào tạo) và trần theo từng loại BH. Lưu cả giá trị trước và sau kẹp trong vết.
4. **Làm tròn** theo chính sách khai báo (BR-41) ở cấp từng khoản đóng; engine lương quyết định bước làm tròn tổng.
5. **CP-07** = nhân viên eligible nhưng lương đóng BH trước kẹp bằng 0 hoặc thiếu nguồn → BLOCKING.

## Risks / Trade-offs

- [Tỷ lệ DN gồm nhiều quỹ con (ốm đau/thai sản, TNLĐ-BNN, hưu trí-tử tuất)] → lưu tỷ lệ DN tổng theo loại và tùy chọn chi tiết quỹ con trong JSON để báo cáo; tính toán dùng tổng.
- [Quy định người nước ngoài thay đổi] → cấu hình theo diện và hiệu lực, không ghi cứng.

## Migration Plan

Migration bảng `insurance_rate`, seed mức đóng mô phỏng có căn cứ cho 4 vùng. Không ảnh hưởng dữ liệu cũ.

## Open Questions

- Trần đoàn phí lấy theo quy định công đoàn nào cho dữ liệu mô phỏng? Dùng tham số có nhãn SIMULATION cho đến khi xác nhận.

> Đã chốt khi triển khai: trần đoàn phí là tham số `UNION_FEE_CAP` (SIMULATION, 10% lương cơ sở); mọi NLĐ thuộc diện BHXH coi là đoàn viên; lương đóng BH lấy mức hiệu lực ngày cuối tháng.
