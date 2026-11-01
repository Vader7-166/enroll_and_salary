## Context

Engine có registry stage cho bước 4 (khoản cộng thêm) và bước 10 (điều chỉnh). Kỳ lương khóa có snapshot gồm nguồn công, tham số, phiên bản công thức và kết quả từng dòng. `retro_candidate` được tạo khi lưu quyết định lương hiệu lực quá khứ. Docs 09 §8 định nghĩa `bonus` và `payroll_adjustment`.

## Goals / Non-Goals

**Goals:**
- Hồi tố tái hiện đúng kỳ gốc (công, OT, tham số lương/BH) và chỉ ghi vào kỳ mở sau xác nhận.
- Thưởng tham gia đúng bước và chịu thuế theo kỳ chi.

**Non-Goals:**
- Không mở khóa hay sửa kỳ gốc; không sửa hồ sơ thuế đã khai.
- Không xây hệ thống đánh giá KPI (điểm KPI là đầu vào CONFIRMED từ `payroll-inputs`).

## Decisions

1. **Tính lại kỳ gốc bằng chính engine ở chế độ `REPLAY`**: dùng nguồn trong snapshot kỳ gốc, thay thế đúng nguồn đã đổi (timeline lương mới), tham số theo ngày nghiệp vụ kỳ gốc. Chênh lệch = kết quả replay − snapshot gốc, theo từng dòng lương, BH, thuế. Cách này tránh viết engine thứ hai.
2. **Thuế của khoản truy lĩnh** tính theo lần chi bổ sung (kỳ mở, ngày chi dự kiến của kỳ mở), không sửa `tax_withholding` gốc; số chênh thuế của kỳ gốc chỉ hiển thị tham khảo và liên kết kỳ thuế liên quan.
3. **`payroll_adjustment` DRAFT → CONFIRMED / DISMISSED**; chỉ CONFIRMED được stage điều chỉnh đọc. Xác nhận yêu cầu xác thực lại (NFR-33) và ghi audit.
4. **Thưởng**: `bonus_plan(type, decision_ref, earn_period, pay_payroll_period, scope, formula|amount, status)` sinh `bonus_allocation(employee, amount, trace)`; công thức dùng `formula-engine` với biến như `TARGET`, `KPI_RATE`, `ATTENDANCE_SCORE`. Unique (plan, employee). Stage thưởng chỉ đọc allocation của plan có `pay_payroll_period` = kỳ đang tính và đã CONFIRMED.
5. **Chống trùng P3**: khi plan tham chiếu cùng nguồn KPI đã dùng cho P3 trong phương án của nhân viên mà không có `independent_decision_ref`, báo `BONUS_P3_DOUBLE_COUNT`.

## Risks / Trade-offs

- [Replay chậm với nhiều kỳ] → chỉ replay nhân viên bị ảnh hưởng; giới hạn số kỳ mỗi lần tính.
- [Snapshot cũ thiếu nguồn cần cho replay] → báo `RETRO_SOURCE_UNAVAILABLE`, không ước lượng.

## Migration Plan

Migration bảng mới; đăng ký stage vào engine. Không ảnh hưởng kỳ đã khóa.

## Open Questions

- Có cho phép truy thu làm thực lĩnh kỳ mở âm không? Theo BR-46 thì không; truy thu vượt phải giãn sang kỳ sau — đề xuất dùng cùng cơ chế giãn khấu trừ của CP-04/CP-05.
