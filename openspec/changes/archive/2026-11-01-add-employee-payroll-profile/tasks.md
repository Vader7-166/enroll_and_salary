## 1. Dữ liệu

- [x] 1.1 Migration bảng `employee_identity` (CCCD cipher+hash, MST hash unique, số sổ BHXH hash unique, liên hệ khẩn cấp), `employee_bank_account` (ngân hàng, số tài khoản cipher+hash, chủ tài khoản, hiệu lực)
- [x] 1.2 Migration `employee_dependent` (họ tên, quan hệ, MST NPT, tháng từ/đến, chứng từ, phiên bản)
- [x] 1.3 Migration `tax_profile` và `employee_special_status` có hiệu lực không chồng; trigger chặn sửa/xóa lịch sử
- [x] 1.4 Danh mục ngân hàng tối thiểu nếu chưa có
- [x] 1.5 Seed dữ liệu mô phỏng cho nhân viên demo (có nhãn SIMULATION)

## 2. Backend

- [x] 2.1 Tách helper mã hóa dùng chung từ `contract-crypto.ts`, thêm blind index HMAC có `keyVersion`
- [x] 2.2 Service + DTO cho identity, bank account, dependents, tax profile, special status; kiểm tra phạm vi và exclusion
- [x] 2.3 Che trường nhạy cảm theo quyền, AD luôn che; audit đọc đầy đủ và truy cập bị từ chối
- [x] 2.4 Truy vấn `eligibleDependentCount(employeeId, yyyyMm)` và `profileAt(employeeId, date)` cho các phân hệ BH/thuế
- [x] 2.5 Integration test `backend/test/employee-payroll-profile.test.cjs` (trùng MST/BHXH, che trường, hiệu lực chồng, đếm NPT); script `verify:payroll-profile`

## 3. Giao diện và tài liệu

- [x] 3.1 Tab "Hồ sơ lương & thuế" trong chi tiết nhân viên: định danh, ngân hàng, NPT, cư trú, diện đặc thù
- [x] 3.2 Cập nhật README và docs/20
