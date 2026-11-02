## 1. Danh mục dùng chung (FR-1.4.2)

- [ ] 1.1 Migration `locality`/`locality_version`, `education_level` + khóa ngoại tùy chọn từ hồ sơ nhân viên; seed mô phỏng
- [ ] 1.2 API AD quản trị (tạo phiên bản, đóng hiệu lực, audit) và chọn danh mục trong form hồ sơ
- [ ] 1.3 Test tích hợp: phiên bản không chồng, tra cứu theo ngày, quyền AD, audit; cập nhật `function-map.json` bỏ gap

## 2. Quá trình công tác (FR-2.1.3)

- [ ] 2.1 `GET /employees/:id/employment-history` hợp nhất các nguồn, phạm vi/loại trừ, che lương
- [ ] 2.2 Tab Quá trình công tác trong hồ sơ nhân viên
- [ ] 2.3 Test: đủ các mốc theo thứ tự, điều chuyển giữa kỳ, người không có quyền lương không thấy số tiền, nhân viên bị loại trừ trả rỗng

## 3. Xóa mềm (FR-X.3)

- [ ] 3.1 Rà soát mọi `.delete`/`.deleteMany`, chốt danh sách ngoại lệ có lý do
- [ ] 3.2 Trigger chặn DELETE cho bảng nghiệp vụ còn thiếu; luật lint `hard-delete` và test fixture
- [ ] 3.3 Cập nhật docs 09 và `function-map.json`

## 4. Thông lượng nhập công (NFR-13)

- [ ] 4.1 Chèn bản ghi thô theo lô và ghép theo lô nhân viên-ngày
- [ ] 4.2 Chạy lại toàn bộ suite chấm công, đối chiếu kết quả không đổi
- [ ] 4.3 `benchmark:attendance` đạt `nfr13.pass=true`; lưu kết quả vào báo cáo nightly
