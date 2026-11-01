## 1. Dữ liệu

- [x] 1.1 Migration `shift_rotation_pattern` + `shift_rotation_pattern_version` (cơ sở, chu kỳ, dãy ca/ngày nghỉ, nghỉ tối thiểu, hiệu lực)
- [x] 1.2 Migration `shift_swap_request`, `shift_swap_history`

## 2. Xoay ca và lập lịch

- [x] 2.1 CRUD mẫu xoay ca cho AD, kiểm tra ca thuộc chính sách cơ sở
- [x] 2.2 Hàm thuần `generateFromPattern()` và endpoint sinh lịch nháp theo mẫu
- [x] 2.3 Phân ca hàng loạt nhiều nhân viên/ngày
- [x] 2.4 Sao chép lịch tháng trước theo WEEKDAY/CYCLE, bỏ qua nhân viên đã nghỉ
- [x] 2.5 Unit test sinh lịch và ràng buộc; integration test UAT-23

## 3. Đổi ca

- [x] 3.1 Service đề xuất đổi ca: kiểm tra ràng buộc ca mới, PENDING, lịch hiện hành giữ nguyên
- [x] 3.2 QĐ duyệt/trả lại/từ chối; duyệt cập nhật lịch có lịch sử, tính lại công, chặn kỳ đóng/khóa
- [x] 3.3 Integration test `backend/test/shift-swap.test.cjs` (chưa duyệt giữ ca cũ, kỳ khóa, đổi ca giữa chừng); thêm vào `verify:shifts`

## 4. Giao diện và tài liệu

- [x] 4.1 TT: chọn mẫu, sinh lịch, phân hàng loạt, sao chép tháng trước, đề xuất đổi ca
- [x] 4.2 QĐ: danh sách đề xuất đổi ca, duyệt ≤ 2 thao tác
- [x] 4.3 Cập nhật README và docs/20
