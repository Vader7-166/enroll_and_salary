## Why

Hệ thống đã đối chiếu được giờ OT thực tế với đề xuất đã duyệt (`overtime_actual`), nhưng chưa phân loại giờ theo loại ngày/ban đêm và chưa có hệ số OT tính từ tham số (FR-5.4.2…5.4.4, BR-23…25). Đây là đầu vào bắt buộc của engine lương (bước 2–3 trong 06 §6.2), nên phải làm trước. FR-5.5.1 (quy đổi nghỉ bù chưa kích hoạt) cũng chưa có kiểm tra bắt buộc theo DEC-01.

## What Changes

- Thêm bộ tính **hệ số OT** thuần (pure) theo công thức ba số hạng Điều 57 NĐ 145/2020: `r_ngày + phụ_cấp_đêm + hệ_số_cộng × r_ban_ngày`; mọi hệ số lấy từ `legal_parameter` theo ngày nghiệp vụ, không lưu 200/210/270/390 làm hằng số.
- Phân loại **loại ngày** (THUONG / NGHI_TUAN / LE_TET) cho từng đoạn giờ theo lịch nghỉ lễ và ngày nghỉ hằng tuần của cơ sở; tách đoạn tại 00:00/06:00/22:00.
- Xác định cờ **"đã có OT ban ngày trong cùng ngày công"** trên ngày công trước khi áp hệ số (BR-25).
- Sinh **bảng giờ OT theo nhóm hệ số** (`overtime_pay_bucket`) cho từng nhân viên/ngày công từ nguồn công đã khóa, tách giờ thực tế / đã duyệt / đủ điều kiện tính tiền (FR-5.4.1); phần lệch vẫn đi luồng ngoại lệ công hiện có.
- Sinh **giờ đêm không phải OT** để tính phụ cấp ca đêm 30% (06 §6.2 bước 3).
- Hàm tính tiền OT khi đã có đơn giá giờ (dùng bởi engine lương), kèm vết tính.
- Kiểm tra **COMP_TIME_ENABLED=false**: mọi yêu cầu quy đổi trả `COMP_TIME_DISABLED`, không sinh quỹ, không giảm tiền hoặc giờ OT (FR-5.5.1, TC-B01…B03).
- Màn hình KT/QĐ xem chi tiết giờ OT theo hệ số và vết phân rã hệ số.

## Capabilities

### New Capabilities
- `overtime-pay`: phân loại đoạn giờ OT theo loại ngày/ban đêm, tính hệ số từ tham số, nhóm giờ OT đủ điều kiện theo hệ số, giờ đêm không OT, hàm tính tiền OT có vết và kiểm tra quy đổi nghỉ bù chưa kích hoạt.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** module mới `backend/src/overtime-pay/` (engine thuần + service + controller); đọc `overtime_actual`, snapshot khóa kỳ công (`attendance_period_lock_event`), `holiday-calendar.ts`, `legal_parameter`.
- **Database:** migration thêm `overtime_pay_bucket` và tham số `OT_RATE_WEEKDAY`, `OT_RATE_WEEKLY_REST`, `OT_RATE_HOLIDAY`, `NIGHT_ALLOWANCE_RATE`, `NIGHT_OT_ADDON_RATE`, `COMP_TIME_ENABLED` trong seed mô phỏng.
- **API:** `GET /api/overtime-pay/buckets`, `POST /api/overtime-pay/rate-preview`, `POST /api/overtime-pay/comp-time-requests` (luôn `COMP_TIME_DISABLED`).
- **Frontend:** tab "Giờ OT theo hệ số" trong khu OT.
- **Test:** `backend/test/overtime-pay-engine.test.cjs`, `overtime-pay.test.cjs`; script `verify:overtime-pay`.
- **Phụ thuộc:** không phụ thuộc change khác; là đầu vào của `add-payroll-calculation-engine`.
