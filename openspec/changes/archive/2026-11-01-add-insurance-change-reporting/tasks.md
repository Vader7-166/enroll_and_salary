## 1. Dữ liệu

- [x] 1.1 Migration `insurance_change_list` (cơ sở, tháng, status DRAFT/FINALIZED), `insurance_change_item`, `insurance_arrears`, `c12_import`, `c12_difference`; trigger bất biến khi FINALIZED
- [x] 1.2 Seed mẫu xuất danh sách và mẫu ánh xạ C12 mô phỏng

## 2. Backend

- [x] 2.1 Bộ sinh danh sách so sánh tháng N/N−1 dùng `insuranceEligibility` và lương đóng BH
- [x] 2.2 Chốt danh sách, ghi biến động muộn vào tháng mở với tham chiếu tháng gốc
- [x] 2.3 Tính truy thu/thoái thu theo mức đóng tháng gốc
- [x] 2.4 Xuất Excel theo mẫu cấu hình, audit
- [x] 2.5 Nhập C12 theo mẫu ánh xạ, ghép theo hash số sổ BHXH, phân loại chênh lệch
- [x] 2.6 Integration test `backend/test/insurance-changes.test.cjs`; script `verify:insurance-changes`

## 3. Giao diện và tài liệu

- [x] 3.1 Màn hình danh sách biến động, chốt, xuất; màn hình đối chiếu C12
- [x] 3.2 Cập nhật README và docs/20
