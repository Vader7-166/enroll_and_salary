## 1. Dữ liệu và tham số

- [x] 1.1 Migration thêm bảng `overtime_pay_bucket` (employee, org unit, attendance period, work date, kind OT/NIGHT_REGULAR, day type, is night, has day OT, minutes, rate, rate breakdown JSON, source status DRAFT/LOCKED, source hash) với unique theo khóa bucket
- [x] 1.2 Thêm tham số `OT_RATE_WEEKDAY`, `OT_RATE_WEEKLY_REST`, `OT_RATE_HOLIDAY`, `NIGHT_ALLOWANCE_RATE`, `NIGHT_OT_ADDON_RATE`, `COMP_TIME_ENABLED` vào seed mô phỏng có căn cứ và nhãn SIMULATION
- [x] 1.3 Xác định nguồn ngày nghỉ hằng tuần theo cơ sở (thêm khóa `WEEKLY_REST_DAYS` vào chính sách cơ sở nếu chưa có)

## 2. Engine thuần

- [x] 2.1 Viết `overtime-pay-engine.ts`: tách đoạn tại 00:00/06:00/22:00, gán loại ngày theo lịch lễ và ngày nghỉ tuần
- [x] 2.2 Xác định cờ `hasDayOt` trên ngày công trước khi áp hệ số
- [x] 2.3 Hàm `otRate()` theo công thức ba số hạng, trả phân rã và mã tham số
- [x] 2.4 Gom bucket OT và bucket giờ đêm không OT
- [x] 2.5 Hàm `otPay(hourlyRate, buckets)` bằng Decimal, trả vết
- [x] 2.6 Unit test TC-O01…O05c, TC-O04, UAT-03, UAT-06, TC-A02, FIX-09 và test đảo thứ tự bước làm sai kết quả

## 3. Service và API

- [x] 3.1 Service đọc snapshot khóa kỳ công (LOCKED) hoặc `overtime_actual` hiện hành (DRAFT), phân giải tham số theo scope kế thừa
- [x] 3.2 Bổ sung segment OT vào nội dung snapshot khi khóa kỳ công mới; trả `OT_SEGMENTS_UNAVAILABLE` khi snapshot cũ thiếu
- [x] 3.3 `GET /api/overtime-pay/buckets` theo kỳ/đơn vị/nhân viên, kiểm tra quyền và exclusion
- [x] 3.4 `POST /api/overtime-pay/rate-preview` cho KT chạy thử hệ số theo tham số
- [x] 3.5 `POST /api/overtime-pay/comp-time-requests` luôn trả `COMP_TIME_DISABLED`, ghi audit
- [x] 3.6 Integration test `backend/test/overtime-pay.test.cjs`: quyền, kỳ khóa dùng snapshot, TC-B01…B03; thêm script `verify:overtime-pay`

## 4. Giao diện và tài liệu

- [x] 4.1 Tab "Giờ OT theo hệ số" hiển thị bucket, nhãn Nháp/Đã khóa và phân rã hệ số
- [x] 4.2 Cập nhật README (bảng tính năng) và docs/20 mục hướng dẫn kiểm chứng
