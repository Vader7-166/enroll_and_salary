## ADDED Requirements

### Requirement: Quá trình công tác hợp nhất
Hệ thống SHALL hiển thị quá trình công tác của nhân viên theo thời gian gồm tuyển dụng, thử việc, chính thức, điều chuyển, thay đổi lương và nghỉ việc, lấy từ dữ liệu nguồn hiện có; truy cập MUST tuân theo phạm vi đơn vị, danh sách loại trừ và quyền xem lương.

#### Scenario: Đủ các mốc
- **WHEN** KT xem nhân viên đã thử việc, ký HĐ chính thức, điều chuyển giữa tháng và nghỉ việc
- **THEN** dòng thời gian liệt kê đúng thứ tự từng mốc với ngày hiệu lực và đơn vị trước/sau

#### Scenario: Không có quyền xem lương
- **WHEN** tài khoản không có quyền xem lương mở quá trình công tác
- **THEN** mốc thay đổi lương hiển thị nhưng số tiền bị che
