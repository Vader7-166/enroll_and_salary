## ADDED Requirements

### Requirement: Sao lưu mã hóa định kỳ
Hệ thống SHALL sao lưu cơ sở dữ liệu theo lịch đáp ứng RPO không quá 1 giờ, bản sao lưu MUST được mã hóa bằng khóa lưu tách biệt khỏi cơ sở dữ liệu, và giữ theo chính sách lưu trữ tối thiểu 3 năm cho dữ liệu công và lương.

#### Scenario: Bản sao lưu theo giờ
- **WHEN** hệ thống chạy một ngày
- **THEN** có bản sao lưu mã hóa cho mỗi giờ và không đọc được nếu không có khóa

### Requirement: Khôi phục có kiểm chứng
Hệ thống SHALL có quy trình khôi phục vào cụm sạch đo thời gian đáp ứng RTO không quá 4 giờ, sau khôi phục MUST kiểm tra hash snapshot các kỳ đã khóa và chuỗi băm nhật ký, và diễn tập MUST được lập biên bản định kỳ 6 tháng.

#### Scenario: Diễn tập khôi phục
- **WHEN** khôi phục bản sao lưu gần nhất vào cụm sạch
- **THEN** hash snapshot kỳ khóa và chuỗi băm nhật ký hợp lệ, thời gian khôi phục được ghi vào biên bản

### Requirement: Xoay khóa mã hóa
Hệ thống SHALL hỗ trợ nhiều phiên bản khóa mã hóa với một khóa đang hoạt động, mã hóa lại dữ liệu theo lô sang khóa mới và tính lại blind index; khóa cũ MUST chỉ được gỡ khi không còn bản mã nào dùng nó.

#### Scenario: Xoay sang khóa mới
- **WHEN** quản trị chạy lệnh xoay khóa từ v1 sang v2
- **THEN** mọi bản mã chuyển sang v2, dữ liệu đọc ra không đổi, kiểm tra trùng MST vẫn hoạt động
