## Context

Danh mục loại nghỉ có cờ `si_paid`, `requires_document`; đơn nghỉ một cấp do TT duyệt đã đưa ký hiệu vào bảng công. Docs 09 §7 định nghĩa `sickness_maternity_record`; tỷ lệ vắng là truy vấn tổng hợp, không có bảng riêng.

## Goals / Non-Goals

**Goals:**
- Theo dõi dự tính và thực chi BHXH, không lẫn với lương công ty.
- Tỷ lệ vắng đúng phạm vi QĐ, theo cây tổ chức tại kỳ.

**Non-Goals:**
- Không lập/nộp hồ sơ đề nghị lên cơ quan BHXH (BR-35).
- QĐ không duyệt đơn nghỉ (BR-33).

## Decisions

1. **Mức hưởng là ước tính có vết**: số ngày theo bảng tham số (thâm niên đóng BH × điều kiện làm việc), mức = tỷ lệ × lương đóng BHXH (ốm đau) hoặc bình quân 6 tháng (thai sản) / số ngày chuẩn theo tham số; lưu vết và nhãn "dự tính".
2. **Thâm niên đóng BH** lấy từ lịch sử `insurance_contribution` + số tháng nhập ngoài hệ thống có chứng từ.
3. **Tỷ lệ vắng** = (ngày vắng có đơn + ngày vắng không đơn) / ngày công kế hoạch theo lịch đã duyệt, tính theo tổ/ngày/loại; nguồn là `daily_attendance` và đơn nghỉ đã duyệt; kỳ khóa đọc snapshot.

## Risks / Trade-offs

- [Thiếu lịch sử đóng BH trước hệ thống] → cho nhập số tháng ngoài hệ thống kèm chứng từ; thiếu thì ghi "không đủ dữ liệu", không tự giả định.

## Migration Plan

Migration bảng mới và tham số mô phỏng có căn cứ.

## Open Questions

- Bảng số ngày hưởng ốm đau theo thâm niên áp dụng cho dữ liệu mô phỏng cần xác nhận theo Luật BHXH hiện hành.
