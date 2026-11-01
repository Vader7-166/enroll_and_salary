# parameter-expiry-warning Specification

## Purpose
TBD - created by archiving change add-audit-search-and-in-app-notifications. Update Purpose after archive.
## Requirements
### Requirement: Cảnh báo tham số sắp hết hiệu lực
Hệ thống SHALL liệt kê các tham số pháp lý có ngày hết hiệu lực trong số ngày cảnh báo cấu hình mà chưa có bản ghi kế tiếp cùng mã, phạm vi, đối tượng và căn cứ áp dụng bắt đầu ngay ngày sau, và gửi thông báo cho AD.

#### Scenario: Chưa có bản kế tiếp
- **WHEN** tham số lương tối thiểu vùng I hết hiệu lực sau 20 ngày, ngưỡng 30 ngày, chưa có bản mới
- **THEN** tham số xuất hiện trong danh sách cảnh báo và AD nhận thông báo

#### Scenario: Đã có bản kế tiếp
- **WHEN** đã có bản mới hiệu lực từ ngày sau ngày hết hạn
- **THEN** tham số không bị cảnh báo

