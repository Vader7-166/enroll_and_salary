# sickness-maternity-tracking Specification

## Purpose
TBD - created by archiving change add-sickness-maternity-and-absence-tracking. Update Purpose after archive.
## Requirements
### Requirement: Hồ sơ chứng từ ốm đau và thai sản
Hệ thống SHALL cho KT nhập hồ sơ chế độ ốm đau, con ốm, thai sản, khám thai, dưỡng sức gồm loại chế độ, số chứng từ, khoảng ngày và tệp chứng từ, và MUST kiểm tra loại nghỉ yêu cầu chứng từ, chính sách hiệu lực và chồng ngày với hồ sơ khác.

#### Scenario: Thiếu chứng từ
- **WHEN** KT lưu hồ sơ ốm đau không có tệp chứng từ
- **THEN** hệ thống từ chối với lỗi thiếu chứng từ

#### Scenario: Chồng ngày
- **WHEN** hồ sơ mới có khoảng ngày chồng một hồ sơ đã có của cùng nhân viên
- **THEN** hệ thống báo chồng và chỉ ra hồ sơ bị chồng

### Requirement: Số ngày và mức hưởng dự tính
Hệ thống SHALL tính số ngày được hưởng theo thâm niên đóng BH và mức hưởng dự tính theo tham số hiệu lực (ốm đau theo tỷ lệ lương đóng BHXH, thai sản theo bình quân lương đóng 6 tháng liền kề), kèm vết và nhãn dự tính.

#### Scenario: Ốm đau
- **WHEN** nhân viên có lương đóng BHXH 10.000.000 đ và tỷ lệ hưởng ốm đau 75%
- **THEN** mức hưởng dự tính dựa trên 7.500.000 đ/tháng chia theo số ngày chuẩn cấu hình, có vết tham số

### Requirement: Theo dõi tiền BHXH chi trả
Hệ thống SHALL cho KT ghi nhận số tiền BHXH đã chi trả thực tế cho từng hồ sơ và hiển thị chênh lệch với mức dự tính; ngày nghỉ hưởng BHXH MUST NOT được tính lương công ty.

#### Scenario: Ghi nhận thực chi
- **WHEN** KT ghi số tiền BHXH đã chi cho hồ sơ thai sản
- **THEN** hồ sơ hiển thị dự tính, thực chi và chênh lệch

