## Context

`shift_plan` (DRAFT/PENDING/APPROVED/RETURNED/CANCELLED) chứa `shift_schedule` theo (plan, employee, work_date) với `startAt/endAt` đã dựng; `shifts.service.ts` kiểm tra ràng buộc từ tham số `SHIFT_MAX_DAILY_MINUTES`, `SHIFT_MAX_WEEKLY_MINUTES`, `SHIFT_MIN_REST_MINUTES`… Ghép công chỉ dùng lịch APPROVED.

## Goals / Non-Goals

**Goals:**
- Giảm thao tác TT khi lập lịch (NFR-49 ≤ 3 bước, NFR-51 QĐ ≤ 2 thao tác).
- Đổi ca không bao giờ làm mất lịch hiện hành trước khi được duyệt.

**Non-Goals:**
- Không in/xuất lịch ca riêng (FR-3.4.3, backlog S).
- Không tối ưu xếp ca tự động theo nhu cầu sản xuất.

## Decisions

1. **Sinh lịch là hàm thuần** `generateFromPattern(pattern, employees[{id, cycleOffset}], dateRange, holidays)` trả danh sách lịch nháp; sau đó đi qua bộ kiểm tra ràng buộc hiện có. Sao chép tháng trước dùng cùng đường: đọc lịch APPROVED tháng trước, ánh xạ ngày theo chế độ `WEEKDAY` hoặc `CYCLE`.
2. **Đổi ca là đối tượng riêng** `shift_swap_request(schedule_id, new_shift_id, reason, status PENDING/APPROVED/RETURNED/REJECTED)` thay vì sửa plan APPROVED: lịch hiện hành giữ nguyên tới khi duyệt.
3. **Duyệt đổi ca** trong một giao dịch: kiểm tra trạng thái kỳ công của ngày (OPEN mới cho; CLOSED/LOCKED → `PERIOD_STATE_CONFLICT`), kiểm tra lại ràng buộc, cập nhật `shift_schedule` (ghi `shift_plan_history` với snapshot trước/sau, tăng revision), gọi tính lại công ngày đó; xác nhận/chốt bị ảnh hưởng mất hiệu lực theo quy tắc hiện có.
4. **Thông báo TT** qua module thông báo khi có (`add-audit-search-and-in-app-notifications`); trước đó hiển thị trạng thái trong danh sách đề xuất.

## Risks / Trade-offs

- [Sinh lịch lớn cho tổ đông] → giới hạn khoảng ngày một kỳ, chèn theo lô.
- [Đổi ca làm thay đổi công đã xác nhận] → dùng cơ chế hủy xác nhận/chốt bị ảnh hưởng đã có ở phân hệ 4.

## Migration Plan

Migration bảng mới; không đổi lịch hiện có.

## Open Questions

- Có cho đổi ca hai nhân viên cho nhau trong một đề xuất (swap đôi) không? Đề xuất R1: một đề xuất đổi một lịch; swap đôi là hai đề xuất liên kết.
