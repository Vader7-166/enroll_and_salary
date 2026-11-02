## Why

Phân hệ ca đã có danh mục ca, lịch tổ và duyệt/trả lại, nhưng còn thiếu mẫu xoay ca (FR-3.1.3), lập lịch theo mẫu/phân ca hàng loạt/sao chép tháng trước (FR-3.2.1) và đề xuất đổi ca sau khi lịch đã duyệt cùng luồng QĐ duyệt (FR-3.3.1, 3.4.2). Đổi ca giữa chừng là tình huống biên số 6 của ca đêm bắc cầu (06 §3.4): công phải ghi theo ca thực tế đã duyệt đổi.

## What Changes

- **Mẫu xoay ca** theo cơ sở: chu kỳ (số ngày), thứ tự ca từng ngày trong chu kỳ (gồm ngày nghỉ), ràng buộc nghỉ tối thiểu giữa hai ca; có hiệu lực.
- **Lập lịch theo mẫu** cho tổ trong kỳ với điểm bắt đầu chu kỳ từng nhân viên; **phân ca hàng loạt** cho nhiều nhân viên/ngày; **sao chép lịch tháng trước** căn theo thứ trong tuần hoặc theo chu kỳ. Mọi lịch sinh ra là DRAFT và chạy đủ kiểm tra ràng buộc hiện có (nghỉ giữa ca, trần giờ tuần, trùng đơn nghỉ đã duyệt, công đã khóa).
- **Đề xuất đổi ca** sau khi lịch đã duyệt: TT chọn nhân viên, ngày, ca cũ, ca mới, lý do; kiểm tra ràng buộc của ca mới; trạng thái chờ duyệt; **lịch hiện hành giữ nguyên cho đến khi QĐ duyệt**.
- **QĐ duyệt/trả lại/từ chối** đề xuất đổi ca; duyệt cập nhật lịch đã duyệt (phiên bản mới), tính lại công của ngày bị ảnh hưởng nếu kỳ công còn mở, thông báo TT; kỳ đã đóng/khóa bị chặn.

## Capabilities

### New Capabilities
- `shift-rotation`: mẫu xoay ca, lập lịch theo mẫu, phân ca hàng loạt và sao chép lịch tháng trước.
- `shift-swap`: đề xuất đổi ca sau duyệt, QĐ duyệt và cập nhật lịch có phiên bản.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** mở rộng `backend/src/shifts/`; gọi tính lại công (`attendance.service`) khi đổi ca được duyệt.
- **Database:** `shift_rotation_pattern`, `shift_rotation_pattern_version`, `shift_swap_request`, `shift_swap_history`.
- **API:** `/api/shifts/rotation-patterns`, `/api/shifts/plans/:id/generate`, `/api/shifts/plans/:id/bulk-assign`, `/api/shifts/plans/copy-previous`, `/api/shifts/swaps`.
- **Phụ thuộc:** không phụ thuộc phân hệ lương; làm song song được.
