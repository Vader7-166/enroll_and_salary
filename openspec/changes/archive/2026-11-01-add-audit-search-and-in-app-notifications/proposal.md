## Why

Nhật ký kiểm toán đã chỉ-thêm (trigger chặn sửa/xóa) và có chuỗi băm, nhưng chưa có màn hình AD tra cứu theo phạm vi/điều kiện (FR-1.6.4) và chưa có tác vụ kiểm tra toàn vẹn chuỗi định kỳ (FR-1.6.1, NFR-26). R1 cũng bắt buộc thông báo trong ứng dụng cho TT/QĐ/KT ở các luồng duyệt/chốt (FR-X.5) và cảnh báo tham số sắp hết hiệu lực chưa có bản kế tiếp (FR-1.3.3). Các change khác (đổi ca, khóa lương, hạn chi) cần kênh thông báo dùng chung.

## What Changes

- **Tra cứu nhật ký** cho AD: lọc theo thời gian, người thực hiện, hành động, loại/mã đối tượng, kết quả (gồm truy cập bị từ chối), trong phạm vi AD; xem giá trị cũ/mới; xuất tệp có audit. Giá trị nhạy cảm (lương) bị che với AD.
- **Kiểm tra toàn vẹn chuỗi băm** định kỳ và theo yêu cầu: tính lại `record_hash` theo thứ tự, phát hiện đứt chuỗi hoặc sai băm, lưu kết quả kiểm tra và cảnh báo AD.
- **Thông báo trong ứng dụng**: hộp thông báo trên header cho TT/QĐ/KT/AD, đánh dấu đã đọc, liên kết tới màn hình đúng quyền; sự kiện gồm lịch ca chờ duyệt/trả lại, OT chờ duyệt/kết quả, đơn đổi ca, xưởng đã chốt, kỳ công trả lại/khóa, bảng lương về nháp, hạn chi lương, tham số sắp hết hiệu lực. Không gửi email.
- **Cảnh báo tham số sắp hết hiệu lực** chưa có bản kế tiếp trong N ngày (tham số), hiển thị trong thiết lập và gửi thông báo AD.

## Capabilities

### New Capabilities
- `audit-search`: tra cứu, xuất nhật ký theo phạm vi và kiểm tra toàn vẹn chuỗi băm định kỳ.
- `in-app-notifications`: thông báo trong ứng dụng theo vai trò/phạm vi cho các sự kiện duyệt, chốt, khóa và cảnh báo.
- `parameter-expiry-warning`: cảnh báo tham số pháp lý sắp hết hiệu lực chưa có bản kế tiếp.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** `backend/src/audit/` (search, integrity job), module mới `backend/src/notifications/`; các service phát sự kiện (shifts, overtime, attendance closure/lock, payroll, settings).
- **Database:** `audit_integrity_check`, `notification`, `notification_recipient`; index cho `audit_log` (occurred_at, entity_type, actor_id).
- **API:** `/api/audit/logs`, `/api/audit/integrity-checks`, `/api/notifications`.
- **Frontend:** màn hình "Nhật ký kiểm toán" (AD), chuông thông báo trên header.
- **Phụ thuộc:** không; nên làm sớm để các change khác dùng kênh thông báo.
