## 1. Dữ liệu

- [x] 1.1 Migration `bonus_plan`, `bonus_allocation` (unique plan+employee), `retro_calculation`, `payroll_adjustment` (decision, origin period, target period, type, diff lương/BH/thuế, status, confirmed by)

## 2. Thưởng

- [x] 2.1 Service đợt thưởng: tạo, chọn đối tượng, tính allocation bằng `formula-engine`, xác nhận
- [x] 2.2 Kiểm tra chống trùng P3 (`BONUS_P3_DOUBLE_COUNT`)
- [x] 2.3 Stage thưởng trong engine: chỉ kỳ chi, trước tổng hợp, phân loại thuế
- [x] 2.4 Unit test FIX-08, TC-I07, kỳ không chi thưởng

## 3. Hồi tố

- [x] 3.1 Chế độ `REPLAY` của engine dùng nguồn snapshot kỳ gốc + nguồn đã đổi
- [x] 3.2 Tính chênh lệch từng dòng lương/BH/thuế, bảng chênh lệch theo kỳ gốc
- [x] 3.3 Xác nhận (xác thực lại) → `payroll_adjustment` CONFIRMED vào kỳ mở; hủy → không đổi dữ liệu; cập nhật `retro_candidate`
- [x] 3.4 Stage điều chỉnh trong engine đọc bút toán CONFIRMED; thuế khoản chi bổ sung theo ngày chi kỳ mở
- [x] 3.5 Integration test UAT-11, TC-P09, `RETRO_SOURCE_UNAVAILABLE`; script `verify:retro`

## 4. Giao diện và tài liệu

- [x] 4.1 Màn hình đợt thưởng; bảng chênh lệch hồi tố và xác nhận
- [x] 4.2 Cập nhật README và docs/20
