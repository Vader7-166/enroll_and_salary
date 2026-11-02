## 1. Ốm đau, thai sản

- [x] 1.1 Migration `sickness_maternity_record` (loại, chứng từ, khoảng ngày, số ngày hưởng, mức dự tính, vết, thực chi) và tham số tỷ lệ hưởng, bảng số ngày theo thâm niên
- [x] 1.2 Service nhập hồ sơ: kiểm tra chứng từ, chính sách, chồng ngày; liên kết đơn nghỉ
- [x] 1.3 Hàm tính số ngày và mức hưởng dự tính có vết; thâm niên đóng từ `insurance_contribution` + số tháng ngoài hệ thống
- [x] 1.4 Ghi thực chi BHXH và chênh lệch
- [x] 1.5 Integration test `backend/test/sickness-maternity.test.cjs`; script `verify:sickness-maternity`

## 2. Tỷ lệ vắng mặt

- [x] 2.1 Truy vấn tổng hợp theo tổ/ngày/loại từ `daily_attendance` và đơn nghỉ, kỳ khóa đọc snapshot; tham số ngưỡng
- [x] 2.2 API `/api/leave/absence-rate` với kiểm tra phạm vi QĐ
- [x] 2.3 Integration test phạm vi và ngưỡng; thêm vào `verify:leave`

## 3. Giao diện và tài liệu

- [x] 3.1 Màn hình hồ sơ ốm đau/thai sản (KT) và tỷ lệ vắng (QĐ)
- [x] 3.2 Cập nhật README và docs/20
