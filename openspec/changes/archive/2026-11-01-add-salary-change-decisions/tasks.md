## 1. Dữ liệu

- [x] 1.1 Migration `salary_decision` (số, ngày quyết định, ngày hiệu lực, lý do, căn cứ, người lập) và `employee_salary` (cấu phần, amount cipher, hiệu lực, decision id) với unique (employee, component, effective_from) và trigger bất biến
- [x] 1.2 Migration `retro_candidate` (decision, payroll period, status PENDING/RESOLVED/DISMISSED, người xử lý)

## 2. Backend

- [x] 2.1 Service lập quyết định: kiểm tra phạm vi, đóng dòng cũ cùng giao dịch, mã hóa số tiền, audit
- [x] 2.2 Hàm `salaryTimeline(employeeId, from, to)` hợp nhất nguồn hợp đồng/phụ lục và quyết định thành đoạn không chồng
- [x] 2.3 Hàm `unitSegments(employeeId, from, to)` trả đơn vị, cơ sở, vùng, cost center và số ngày
- [x] 2.4 Phát hiện hồi tố khi lưu quyết định (truy vấn kỳ lương LOCKED; rỗng khi chưa có)
- [x] 2.5 Cảnh báo BR-08 trong luồng điều chuyển, yêu cầu xác nhận có lý do
- [x] 2.6 Integration test `backend/test/salary-decisions.test.cjs` (TC-P02, TC-P07, TC-P08, hồi tố, trùng ngày); script `verify:salary-decisions`

## 3. Giao diện và tài liệu

- [x] 3.1 Mục "Quyết định lương" và dòng thời gian lương trong chi tiết nhân viên; danh sách ứng viên hồi tố cho KT
- [x] 3.2 Cập nhật README và docs/20
