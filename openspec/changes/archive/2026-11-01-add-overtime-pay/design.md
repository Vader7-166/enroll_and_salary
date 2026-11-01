## Context

`overtime-actual-engine.ts` đã tạo `overtime_actual` theo nhân viên/ngày công với `eligibleMinutes`, `dayMinutes`, `nightMinutes` và `evidence` chứa các `ActualSegment` (khoảng thời gian, cờ đêm, `eligible`). Giờ chưa được gắn loại ngày và chưa có hệ số. Lịch lễ có trong `backend/src/leave/holiday-calendar.ts`; tham số pháp lý dùng `legal_parameter` với `applicationBasis = WORK_DATE` và phân giải theo `scopeKey` kế thừa (xem `overtime.service.ts`). Khóa kỳ công lưu snapshot bất biến trong `attendance_period_lock_event.snapshot`.

## Goals / Non-Goals

**Goals:**
- Hệ số OT là kết quả tính từ tham số, kiểm chứng đủ TC-O01…O05c, UAT-03, UAT-06.
- Giờ dùng tính tiền đọc từ snapshot khi kỳ công đã LOCKED (UAT-19), không tính lại.
- Tách rõ giờ thực tế / đã duyệt / đủ điều kiện / giờ tính tiền; giờ thực tế không bao giờ bị giảm.
- Một hàm tiền OT thuần, Decimal, có vết, để engine lương gọi.

**Non-Goals:**
- Không xác định đơn giá giờ (thuộc `add-payroll-calculation-engine`, BR-15).
- Không bật quy đổi nghỉ bù; không thêm bảng quỹ nghỉ bù.
- Không đổi luồng đề xuất/duyệt/trần OT hiện có.

## Decisions

1. **Engine thuần tách khỏi service.** `overtime-pay-engine.ts` nhận đoạn giờ, lịch loại ngày và bộ tham số đã phân giải, trả bucket + vết. Giống mẫu `overtime-actual-engine.ts` để test bằng `node --test` không cần DB. Phương án khác (tính trong SQL) bị loại vì khó kiểm chứng bảng pháp lý.
2. **Trình tự cố định theo 06 §5.4:** dựng ngày công → xác định cờ `hasDayOt` (có bất kỳ phút OT đủ điều kiện không phải đêm trong ngày công, xét theo thời gian trước đoạn đêm) → tách đoạn tại 00:00/06:00/22:00 → áp hệ số. Test riêng việc đảo thứ tự làm sai kết quả.
3. **Loại ngày theo ngày lịch của đầu đoạn**, không theo ngày công (ca C ngày thường vắt sang ngày lễ: đoạn sau 00:00 là LE_TET). Ngày nghỉ hằng tuần lấy từ chính sách cơ sở; ngày lễ lấy từ lịch lễ có hiệu lực, gồm ngày nghỉ bù BR-16.
4. **Bucket khóa theo (nhân viên, ngày công, loại ngày, ban đêm, hasDayOt).** Lưu `minutes NUMERIC`, `rate NUMERIC` đã tính, `rateBreakdown JSON` (r_ngày, phụ cấp, hệ số cộng, r_ban_ngày, mã tham số/phiên bản), `sourceHash` của snapshot. Lưu rate đã tính chỉ để truy vết; khi tính lại luôn dựng từ tham số.
5. **Nguồn dữ liệu:** kỳ LOCKED → đọc snapshot khóa; kỳ OPEN/CLOSED → đọc `overtime_actual` hiện hành và gắn nhãn `DRAFT`. Engine lương chính thức chỉ chấp nhận bucket có nguồn LOCKED.
6. **Giờ đêm không OT** lấy từ đoạn ca thường thuộc khung 22:00–06:00 của `daily_attendance`, lưu cùng bảng với `kind = NIGHT_REGULAR` để engine áp `NIGHT_ALLOWANCE_RATE`.
7. **COMP_TIME guard** là endpoint và hàm dùng chung `assertCompTimeDisabled()`; khi tham số thiếu, mặc định coi là `false` và ghi audit cảnh báo cấu hình.

## Risks / Trade-offs

- [Lịch lễ mô phỏng 2026 có nhãn SIMULATION] → bucket mang nhãn nguồn lịch; không coi là căn cứ pháp lý đã duyệt.
- [Snapshot khóa cũ chưa chứa đủ segment] → nếu snapshot thiếu segment, trả `OT_SEGMENTS_UNAVAILABLE` thay vì tính lại từ dữ liệu sống; kỳ mới khóa sau change này bổ sung segment vào snapshot.
- [Cờ hasDayOt khi OT ban ngày nằm sau đoạn đêm trong cùng ngày công] → định nghĩa theo 06 §5.4 là thuộc tính ngày công; ghi rõ trong test và trong vết tính.

## Migration Plan

Migration thêm bảng và seed tham số mô phỏng cho bốn cơ sở. Không đổi dữ liệu `overtime_actual`. Rollback: xóa bảng mới (chưa có consumer chính thức).

## Open Questions

- Ngày nghỉ hằng tuần hiện cấu hình ở đâu trong `site_policy`? Nếu chưa có khóa, thêm `WEEKLY_REST_DAYS` vào chính sách cơ sở.

> Đã chốt khi triển khai: dùng tham số `WEEKLY_REST_DAYS` (GLOBAL, ghi đè theo SITE) vì `site_policy` chỉ lưu số nguyên.
