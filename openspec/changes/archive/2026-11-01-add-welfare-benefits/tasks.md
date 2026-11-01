## 1. Dữ liệu

- [x] 1.1 Migration `benefit_catalog`, `benefit_catalog_version` (bất biến, không chồng), `benefit_allocation_batch`, `benefit_allocation` (unique catalog+employee+period)
- [x] 1.2 Seed danh mục 12 loại phúc lợi mô phỏng

## 2. Backend

- [x] 2.1 Quản lý danh mục và phiên bản, schema điều kiện hưởng
- [x] 2.2 Hàm đánh giá điều kiện tại ngày tham chiếu, lọc danh sách dự kiến
- [x] 2.3 Thêm/bớt có kiểm tra lại và lý do; xác nhận chống trùng, audit
- [x] 2.4 Stage engine đọc allocation CONFIRMED có cờ vào lương
- [x] 2.5 Truy vấn chi phí theo cost center/kỳ/loại gồm `severance_allowance`, xuất Excel
- [x] 2.6 Integration test `backend/test/welfare.test.cjs` (UAT-28, điều kiện, chưa xác nhận không ảnh hưởng); script `verify:welfare`

## 3. Giao diện và tài liệu

- [x] 3.1 Màn hình danh mục, lô cấp phát, chi phí phúc lợi
- [x] 3.2 Cập nhật README và docs/20
