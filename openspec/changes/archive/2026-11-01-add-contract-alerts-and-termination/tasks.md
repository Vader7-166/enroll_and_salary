## 1. Cảnh báo hợp đồng

- [x] 1.1 Tham số `CONTRACT_EXPIRY_WARNING_DAYS` (30/60) trong seed
- [x] 1.2 Truy vấn cảnh báo: sắp hết hạn, quá hạn, hết thử việc, đủ 2 lần HĐ xác định thời hạn; số ngày còn lại; kiểm tra phạm vi
- [x] 1.3 Màn hình "Cảnh báo hợp đồng" cho KT

## 2. Chấm dứt hợp đồng

- [x] 2.1 Migration `termination_decision` (DRAFT/CONFIRMED/CANCELLED, snapshot xem trước), `severance_allowance`, `termination_payment_item` (unique theo quyết định và loại)
- [x] 2.2 Tham số trợ cấp có căn cứ BLLĐ 2019 Điều 46, 47 và nhãn SIMULATION; cho nhập số tháng BHTN ngoài hệ thống kèm chứng từ
- [x] 2.3 Hàm `terminationPreview()`: HĐ, thâm niên, trợ cấp, phép chưa nghỉ, dòng báo giảm BH
- [x] 2.4 Xác nhận một giao dịch (xác thực lại): HĐ, ngày nghỉ việc, khoản vào kỳ lương mở gần nhất, audit; chống xác nhận lặp
- [x] 2.5 Stage engine đọc `termination_payment_item` của kỳ, phân loại thuế `UNUSED_LEAVE_PAY`
- [x] 2.6 Integration test `backend/test/termination.test.cjs` (UAT-27, xác nhận lặp, trừ BHTN, mức tối thiểu); script `verify:termination`

## 3. Giao diện và tài liệu

- [x] 3.1 Màn hình lập/xem trước/xác nhận chấm dứt
- [x] 3.2 Cập nhật README và docs/20
