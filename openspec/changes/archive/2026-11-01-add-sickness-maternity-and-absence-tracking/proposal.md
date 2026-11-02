## Why

Phân hệ 6 còn thiếu hai chức năng M: KT theo dõi chế độ ốm đau/thai sản do BHXH chi trả (FR-6.4.1, BR-35) và QĐ theo dõi tỷ lệ vắng mặt của xưởng (FR-6.5.1, UAT-25). Loại nghỉ ốm/thai sản đã có trong danh mục nhưng chưa có hồ sơ chứng từ, số ngày hưởng và mức hưởng dự tính; tỷ lệ vắng chưa có màn hình.

## What Changes

- **Hồ sơ ốm đau/thai sản**: KT nhập chứng từ (loại chế độ, số chứng từ, khoảng ngày, cơ sở y tế), hệ thống kiểm tra chứng từ và chính sách, tính số ngày hưởng theo thâm niên đóng BH và mức hưởng dự tính (ốm đau theo tỷ lệ lương đóng BHXH; thai sản theo bình quân lương đóng 6 tháng liền kề) từ tham số; theo dõi số tiền BHXH đã chi trả thực tế.
- Liên kết hồ sơ với đơn nghỉ đã duyệt và ký hiệu công; ngày nghỉ hưởng BHXH không tính lương công ty.
- **Tỷ lệ vắng mặt**: QĐ chọn xưởng và khoảng thời gian; hệ thống tổng hợp đơn nghỉ và ngày công vắng, hiển thị tỷ lệ vắng theo tổ, theo ngày, theo loại nghỉ; cảnh báo khi vượt ngưỡng cấu hình.

## Capabilities

### New Capabilities
- `sickness-maternity-tracking`: hồ sơ chứng từ ốm đau/thai sản, số ngày và mức hưởng dự tính, theo dõi tiền BHXH chi trả.
- `absence-rate`: tổng hợp và cảnh báo tỷ lệ vắng mặt theo tổ, ngày, loại nghỉ cho QĐ.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** `backend/src/leave/sickness-maternity/`, `backend/src/leave/absence-rate/`.
- **Database:** `sickness_maternity_record`; tham số `SICKNESS_BENEFIT_RATE`, `MATERNITY_BENEFIT_RATE`, bảng số ngày hưởng theo thâm niên, `ABSENCE_RATE_WARNING_THRESHOLD`.
- **API:** `/api/leave/sickness-maternity`, `/api/leave/absence-rate`.
- **Phụ thuộc:** `add-social-insurance-calculation` (lương đóng BHXH, thâm niên đóng); độc lập với engine lương.
