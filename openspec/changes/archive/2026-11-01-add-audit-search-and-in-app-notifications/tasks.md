## 1. Nhật ký kiểm toán

- [x] 1.1 Migration thêm cột `scope_org_unit_id` (nullable) và index cho `audit_log`; bảng `audit_integrity_check`
- [x] 1.2 Ghi `scope_org_unit_id` trong `audit.service.ts` cho bản ghi mới
- [x] 1.3 API tra cứu có lọc, phân trang con trỏ, che giá trị lương với AD; xuất Excel có audit
- [x] 1.4 Job kiểm tra toàn vẹn chuỗi băm hằng ngày + chạy thủ công, lưu kết quả, cảnh báo AD
- [x] 1.5 Integration test `backend/test/audit-search.test.cjs` (phạm vi, bị từ chối, phát hiện sai băm); script `verify:audit`

## 2. Thông báo

- [x] 2.1 Migration `notification`, `notification_recipient`
- [x] 2.2 `NotificationsService.emit()` xác định người nhận theo vai trò/phạm vi, gọi sau commit
- [x] 2.3 Phát sự kiện từ shifts, overtime, workshop closure, period lock, payroll, settings
- [x] 2.4 API danh sách/đếm chưa đọc/đánh dấu đã đọc
- [x] 2.5 Integration test người nhận đúng phạm vi và lỗi không ảnh hưởng nghiệp vụ

## 3. Cảnh báo tham số

- [x] 3.1 Tham số `PARAMETER_EXPIRY_WARNING_DAYS`; truy vấn tham số sắp hết hạn chưa có bản kế tiếp; thông báo AD

## 4. Giao diện và tài liệu

- [x] 4.1 Màn hình "Nhật ký kiểm toán" và kết quả kiểm tra toàn vẹn (AD)
- [x] 4.2 Chuông thông báo trên header, polling 60 giây
- [x] 4.3 Danh sách tham số sắp hết hiệu lực trong thiết lập
- [x] 4.4 Cập nhật README và docs/20
