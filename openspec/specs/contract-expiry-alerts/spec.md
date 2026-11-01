# contract-expiry-alerts Specification

## Purpose
TBD - created by archiving change add-contract-alerts-and-termination. Update Purpose after archive.
## Requirements
### Requirement: Danh sách cảnh báo hợp đồng
Hệ thống SHALL hiển thị cho KT trong phạm vi danh sách HĐ hết hạn trong số ngày cảnh báo cấu hình (30 hoặc 60), HĐ đã quá hạn, HĐ thử việc sắp hết hạn và nhân viên đã ký đủ 2 lần HĐ xác định thời hạn, kèm số ngày còn lại.

#### Scenario: Sắp hết hạn
- **WHEN** HĐ của nhân viên kết thúc sau 25 ngày và ngưỡng là 30 ngày
- **THEN** HĐ có trong danh sách với số ngày còn lại 25

#### Scenario: Đủ hai lần HĐ xác định thời hạn
- **WHEN** nhân viên đã ký 2 HĐ xác định thời hạn liên tiếp
- **THEN** danh sách cảnh báo lần ký tiếp theo phải là HĐ không xác định thời hạn

### Requirement: Cảnh báo không tự chấm dứt
Hệ thống MUST NOT tự thay đổi trạng thái HĐ hoặc nhân viên khi HĐ hết hạn; chỉ hiển thị cảnh báo.

#### Scenario: Quá hạn
- **WHEN** HĐ đã quá ngày kết thúc 3 ngày
- **THEN** HĐ vẫn giữ trạng thái hiện tại và xuất hiện trong nhóm đã quá hạn

