## Why

Engine lương cần tính BH bắt buộc ở bước 6 (06 §6.2) nhưng hệ thống chưa có mức đóng theo vùng, sàn/trần, xác định diện tham gia hay bộ tính BH (FR-8.1.1, 8.2.1–8.2.3; BR-47…50). Cổng `CP-07` (thuộc diện nhưng chưa có lương đóng BH) cũng cần dữ liệu này. Làm bộ tính BH độc lập trước để kiểm chứng bằng fixture trước khi ghép vào engine.

## What Changes

- KT quản lý **mức đóng theo hiệu lực** cho BHXH/BHYT/BHTN/KPCĐ: tỷ lệ NLĐ, tỷ lệ DN, sàn, trần, vùng, căn cứ; thêm bản mới đóng bản cũ, chặn chồng (BR-02).
- **Xác định diện tham gia** theo loại/thời hạn HĐ, thử việc, nghỉ không lương ≥ 14 ngày trong tháng, đã hưởng lương hưu, người nước ngoài (BR-49).
- **Lương đóng BH quản lý riêng** với lương thực trả: tổng cấu phần `is_insurable`, kẹp trong [sàn vùng (+7% nếu đã qua đào tạo nghề), trần] (BR-47).
- **Bộ tính BH thuần** trả phần NLĐ/DN từng loại, KPCĐ 2% (DN) và đoàn phí 1% có trần (BR-50), có vết tham số.
- Hàm kiểm tra **CP-07** cho engine lương.

## Capabilities

### New Capabilities
- `social-insurance-calculation`: mức đóng theo hiệu lực, diện tham gia, lương đóng BH có sàn/trần, tính BH hai phía, KPCĐ, đoàn phí và kiểm tra CP-07.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** module mới `backend/src/social-insurance/` (engine thuần + service + controller).
- **Database:** bảng `insurance_rate`; tham số `UNION_FEE_RATE`, `UNION_FEE_CAP`, `INSURANCE_TRAINED_FLOOR_ADDON`, `UNPAID_LEAVE_INSURANCE_EXEMPT_DAYS` trong seed mô phỏng. Lưu kết quả đóng (`insurance_contribution`) do engine lương ghi.
- **API:** `/api/social-insurance/rates` (KT), `/api/social-insurance/preview`.
- **Frontend:** màn hình "Mức đóng BH" cho KT.
- **Phụ thuộc:** `add-employee-payroll-profile` (diện đặc thù, đào tạo nghề); dùng bởi `add-payroll-calculation-engine`, `add-insurance-change-reporting`.
