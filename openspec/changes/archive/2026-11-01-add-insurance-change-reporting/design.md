## Context

Diện tham gia BH theo tháng và lương đóng BH có từ `add-social-insurance-calculation`; số đóng thực tế của tháng nằm trong `insurance_contribution` của bảng lương đã khóa. Biến động nhân sự đến từ hợp đồng, `employee.terminationDate`, đơn nghỉ và quyết định lương.

## Goals / Non-Goals

**Goals:**
- Danh sách sinh tự động, giải thích được nguồn từng dòng, chốt bất biến.
- Đối chiếu C12 chỉ ra chênh lệch theo nhân sự.

**Non-Goals:**
- Không nộp hồ sơ lên cổng BHXH (ngoài R1).
- Không quản lý thẻ BHYT.

## Decisions

1. **Sinh bằng so sánh trạng thái tháng N với N−1**: với mỗi nhân viên, so `insuranceEligibility` và lương đóng BH giữa hai tháng; khác diện ⇒ tăng/giảm, khác lương ⇒ điều chỉnh. Cách này dùng lại bộ tính BH, không cần bắt mọi sự kiện.
2. **Danh sách DRAFT → FINALIZED theo (cơ sở, tháng)**; FINALIZED bất biến (trigger). Tính lại khi DRAFT. Biến động phát hiện sau khi tháng đã chốt được ghi vào danh sách tháng hiện hành với cờ `late` và tham chiếu tháng gốc.
3. **Truy thu/thoái thu** = Σ theo tháng gốc (mức đóng đúng − mức đã kê khai) cho từng loại BH, dùng mức đóng hiệu lực của tháng gốc.
4. **C12 import** dùng mẫu ánh xạ cột lưu như cấu hình (tương tự hồ sơ nhập chấm công); đối chiếu theo số sổ BHXH (hash) → nhân viên; phân loại chênh lệch `MISSING_IN_C12`, `MISSING_IN_SYSTEM`, `AMOUNT_DIFF`, `SALARY_BASE_DIFF`.

## Risks / Trade-offs

- [Mẫu C12 thật chưa có] → dùng mẫu mô phỏng có nhãn; mẫu ánh xạ cấu hình được khi có mẫu thật.
- [Số sổ BHXH thiếu] → dòng không ghép được đưa vào `MISSING_IN_SYSTEM` kèm gợi ý theo tên/ngày sinh, không tự ghép.

## Migration Plan

Migration bảng mới; seed mẫu xuất và mẫu C12 mô phỏng.

## Open Questions

- Mẫu kê khai (D02-LT hay mẫu hiện hành) cho tệp xuất? Đề xuất cấu hình cột, mặc định theo mẫu mô phỏng.
