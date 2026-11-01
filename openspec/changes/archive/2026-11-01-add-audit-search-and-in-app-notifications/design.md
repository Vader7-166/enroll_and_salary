## Context

`audit_log` có `prev_hash`/`record_hash`, trigger `audit_no_update_delete`/`audit_no_truncate` và `REVOKE UPDATE, DELETE, TRUNCATE`. `audit.service.ts` ghi bản ghi; chưa có API đọc. Không có cơ chế thông báo; frontend dùng TanStack Query.

## Goals / Non-Goals

**Goals:**
- AD tra cứu nhanh trên khối lượng lớn, đúng phạm vi.
- Phát hiện được mọi sửa đổi chuỗi băm ngoài ứng dụng.
- Kênh thông báo đơn giản, đáng tin, đúng quyền.

**Non-Goals:**
- Không email/SMS/push (ngoài R1).
- Không WebSocket; polling là đủ cho R1.

## Decisions

1. **Phạm vi tra cứu của AD** theo `scopeOrgUnitId` của assignment: lọc bản ghi có đối tượng thuộc cây phạm vi (lưu `scope_org_unit_id` mới vào bản ghi audit từ nay; bản ghi cũ suy ra theo đối tượng nếu có thể, không thì chỉ AD phạm vi công ty thấy).
2. **Kiểm tra toàn vẹn** chạy theo lô tăng dần `id`, tính lại hash từ trường chuẩn hóa + `prev_hash`, so `record_hash`; lưu `audit_integrity_check(from_id, to_id, status, first_broken_id)`. Lịch chạy hằng ngày bằng scheduler trong tiến trình (`@nestjs/schedule`) và nút chạy thủ công.
3. **Thông báo** = `notification(type, payload, link_key, created_at)` + `notification_recipient(user_id, read_at)`; người nhận xác định khi phát dựa trên vai trò/phạm vi hiện hành. Link là `link_key` ánh xạ ở frontend, kiểm tra quyền lại khi mở. Frontend polling 60 giây.
4. **Phát sự kiện** qua `NotificationsService.emit(type, scope, payload)` gọi sau commit giao dịch nghiệp vụ; lỗi gửi thông báo không làm hỏng nghiệp vụ.
5. **Tham số sắp hết hạn** là truy vấn: bản ghi có `effective_to` trong N ngày và không có bản cùng mã/scope/subject/basis bắt đầu ngày kế tiếp.

## Risks / Trade-offs

- [Audit log lớn làm chậm tra cứu] → index tổng hợp, phân trang theo con trỏ, giới hạn khoảng thời gian mặc định.
- [Thêm cột `scope_org_unit_id` vào bảng chỉ-thêm] → ALTER thêm cột nullable không sửa bản ghi cũ; trigger vẫn chặn UPDATE.

## Migration Plan

Migration thêm cột/ index, bảng mới. Không sửa bản ghi audit cũ.

## Open Questions

- Thời gian giữ thông báo đã đọc? Đề xuất 90 ngày, không ảnh hưởng audit.
