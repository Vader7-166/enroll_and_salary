## 1. Dữ liệu

- [x] 1.1 Migration `payslip` (payroll employee, issued at/by, file ref, status), `bank_file_template`, `salary_payment_batch`, `salary_payment_item`
- [x] 1.2 Tham số `LATE_PAYMENT_RATE`, `LATE_PAYMENT_GRACE_DAYS`, `PAYSLIP_PASSWORD_RULE`; seed một mẫu ngân hàng mô phỏng

## 2. Phiếu lương

- [x] 2.1 Renderer phiếu lương PDF từ snapshot, đủ nội dung bảng kê, mật khẩu theo quy tắc
- [x] 2.2 Job xuất hàng loạt có tiến độ, zip, link tải một lần, ghi lỗi từng tệp, audit
- [x] 2.3 Bản in từng người

## 3. Chi lương

- [x] 3.1 Quản lý mẫu file chi theo ngân hàng
- [x] 3.2 Xuất file chi (xác thực lại, tệp tạm mã hóa, đúng thực lĩnh, tách theo cơ sở), tạo lô chi
- [x] 3.3 Ghi ngày chi thực tế, cập nhật thuế ACTUAL, đánh dấu `TAX_CONTEXT_CHANGED`
- [x] 3.4 Tính đền bù chậm trả và đưa vào registry stage điều chỉnh của engine

## 4. Kiểm thử, giao diện, tài liệu

- [x] 4.1 Integration test `backend/test/payroll-output.test.cjs` (UAT-01, BR-60, đền bù >15/≤15 ngày, lỗi giữa chừng không đổi dữ liệu); script `verify:payroll-output`
- [x] 4.2 Đo xuất 1.100 phiếu lương (NFR-10)
- [x] 4.3 Màn hình phiếu lương, lô chi, mẫu ngân hàng; cập nhật README và docs/20
