## Why

Hồ sơ nhân viên hiện chỉ có thông tin cơ bản; chưa có CCCD, mã số thuế, số sổ BHXH, tài khoản ngân hàng, người phụ thuộc, cư trú thuế và các diện đặc thù (FR-2.1.1, 2.1.2, 2.1.4). Thiếu các dữ liệu này thì không tính được BH bắt buộc (diện tham gia BR-49), thuế TNCN (giảm trừ NPT BR-53, cư trú BR-52) và không xuất được file chi lương. Đây là điều kiện tiên quyết của các change BH, thuế và lương.

## What Changes

- Bổ sung **định danh và thông tin chi trả** cho hồ sơ: CCCD/hộ chiếu, MST, số sổ BHXH, tài khoản ngân hàng (ngân hàng, số tài khoản, chủ tài khoản), liên hệ khẩn cấp, tệp đính kèm; kiểm tra trùng mã NV, MST, số sổ BHXH.
- **Mã hóa AES-256** CCCD và số tài khoản ngân hàng ở tầng lưu trữ (FR-X.1), tái dùng `HR_DATA_KEY`; che trường nhạy cảm theo quyền, AD không xem (FR-1.1.4).
- **Người phụ thuộc** có tháng bắt đầu/kết thúc được giảm trừ, mã số NPT, quan hệ và chứng từ (FR-2.1.2).
- **Hồ sơ thuế theo hiệu lực** (`tax_profile`): cư trú/không cư trú, cam kết tạm không khấu trừ và phiên bản mẫu, ủy quyền quyết toán.
- **Diện đặc thù theo hiệu lực**: người nước ngoài (giấy phép lao động, thời hạn), đã hưởng lương hưu, lao động chưa thành niên, lao động nữ; lao động đã qua đào tạo nghề (cho sàn BH +7%).
- Màn hình KT quản lý các mục trên trong chi tiết nhân viên; lịch sử bất biến và audit.

## Capabilities

### New Capabilities
- `employee-payroll-profile`: định danh, tài khoản chi trả, diện đặc thù và hồ sơ thuế có hiệu lực, mã hóa và che theo quyền.
- `employee-dependents`: người phụ thuộc với khoảng tháng giảm trừ và chứng từ, dùng cho thuế TNCN.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** mở rộng `backend/src/employees/` và `backend/src/personnel/contract-crypto.ts` (tái dùng mã hóa).
- **Database:** migration thêm cột/bảng `employee_identity`, `employee_bank_account`, `employee_dependent`, `tax_profile`, `employee_special_status`; ràng buộc unique MST/BHXH trên giá trị chuẩn hóa (hash) vì giá trị gốc mã hóa.
- **API:** các endpoint dưới `/api/employees/:id/...` cho identity, bank account, dependents, tax profile, special status.
- **Frontend:** tab "Hồ sơ lương & thuế" trong chi tiết nhân viên.
- **Seed:** dữ liệu mô phỏng cho nhân viên demo.
- **Phụ thuộc:** không; là đầu vào của `add-social-insurance-calculation`, `add-personal-income-tax-withholding`, `add-payslips-and-payment-files`.
