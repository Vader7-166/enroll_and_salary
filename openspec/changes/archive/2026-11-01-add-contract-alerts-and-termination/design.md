## Context

`employment_contract` có loại, trạng thái, ngày bắt đầu/kết thúc; tham số `FIXED_TERM_MAX_COUNT`, `PROBATION_MAX_DAYS_*` đã seed. `leave-funds` tính số dư phép năm; `employee` có `status` và `terminationDate`. SQ-09 mô tả luồng chấm dứt liên phân hệ.

## Goals / Non-Goals

**Goals:**
- Chấm dứt có giai đoạn xem trước hoàn toàn không ghi dữ liệu nghiệp vụ.
- Trợ cấp và tiền phép vào bảng lương đúng một lần.

**Non-Goals:**
- Không tự chấm dứt HĐ khi hết hạn.
- Không làm quy trình kỷ luật sa thải.

## Decisions

1. **Cảnh báo là truy vấn**, không lưu bảng: tính từ HĐ hiệu lực và tham số tại ngày xem; đếm số HĐ xác định thời hạn đã ký liên tiếp để cảnh báo lần thứ 3.
2. **Xem trước = hàm thuần** `terminationPreview(employee, effectiveDate, reason)` trả HĐ, thâm niên, trợ cấp (công thức + biến), phép chưa nghỉ × đơn giá ngày công tại thời điểm chấm dứt, dòng báo giảm từ bộ sinh biến động BH. Lưu DRAFT chỉ lưu đầu vào quyết định và snapshot xem trước để đối chiếu, không đổi HĐ/nhân viên.
3. **Xác nhận trong một giao dịch**: tính lại xem trước, so với snapshot (khác ⇒ yêu cầu xem lại), cập nhật HĐ `TERMINATED` + `employee.terminationDate`, tạo `severance_allowance` và `termination_payment_item` (unique theo quyết định) gắn kỳ lương mở gần nhất của cơ sở, audit. Unique ngăn ghi hai lần.
4. **Trợ cấp theo tham số**: thời gian tính = tổng thời gian làm việc thực tế − thời gian tham gia BHTN − thời gian đã chi trợ cấp; làm tròn năm theo tham số (ví dụ dưới 6 tháng = 1/2 năm); lương căn cứ = bình quân `SEVERANCE_SALARY_AVERAGE_MONTHS` tháng theo HĐ từ timeline lương.
5. **Engine** có stage đọc `termination_payment_item` của kỳ (cộng thêm, phân loại thuế: tiền phép chưa nghỉ dùng loại `UNUSED_LEAVE_PAY` để bộ thuế xét miễn TC-T13).

## Risks / Trade-offs

- [Thời gian tham gia BHTN trước khi dùng hệ thống không có dữ liệu] → cho KT nhập số tháng BHTN đã tham gia ngoài hệ thống làm căn cứ, kèm chứng từ.
- [Kỳ lương mở gần nhất chưa tồn tại] → khoản ở trạng thái chờ kỳ, gắn khi kỳ được tạo.

## Migration Plan

Migration bảng mới và tham số mô phỏng có căn cứ. Không đổi HĐ hiện có.

## Open Questions

- Quy tắc làm tròn thời gian lẻ để tính trợ cấp cần chủ dự án xác nhận cho dữ liệu mô phỏng.
