## ADDED Requirements

### Requirement: Mẫu xoay ca
Hệ thống SHALL cho AD khai báo mẫu xoay ca theo cơ sở gồm chu kỳ số ngày, ca hoặc ngày nghỉ cho từng ngày trong chu kỳ, ràng buộc nghỉ tối thiểu giữa hai ca, và khoảng hiệu lực. Mẫu MUST chỉ dùng ca thuộc chính sách của cơ sở.

#### Scenario: Mẫu ba ca
- **WHEN** AD khai báo chu kỳ 6 ngày A-A-B-B-C-C
- **THEN** mẫu được lưu và có thể chọn khi lập lịch cho tổ của cơ sở đó

#### Scenario: Ca ngoài cơ sở (UAT-23)
- **WHEN** mẫu của NM Nghệ An (chế độ 2 ca) tham chiếu ca C
- **THEN** hệ thống từ chối vì ca không thuộc chính sách cơ sở

### Requirement: Lập lịch theo mẫu và phân ca hàng loạt
Hệ thống SHALL cho TT sinh lịch nháp cho tổ trong kỳ từ mẫu xoay ca với điểm bắt đầu chu kỳ từng nhân viên, và phân một ca cho nhiều nhân viên/nhiều ngày một lần; mọi lịch sinh ra MUST đi qua kiểm tra nghỉ giữa ca, trần giờ tuần, trùng đơn nghỉ đã duyệt và trạng thái công.

#### Scenario: Vi phạm nghỉ giữa ca
- **WHEN** lịch sinh ra có ca C ngày T rồi ca A ngày T+1 không đủ thời gian nghỉ tối thiểu
- **THEN** dòng vi phạm được đánh dấu và lịch không gửi duyệt được cho đến khi sửa

### Requirement: Sao chép lịch tháng trước
Hệ thống SHALL cho TT sao chép lịch đã duyệt của tháng trước sang kỳ mới theo thứ trong tuần hoặc theo chu kỳ, tạo lịch nháp và kiểm tra ràng buộc như lịch mới.

#### Scenario: Nhân viên đã nghỉ việc
- **WHEN** tháng trước có nhân viên đã nghỉ việc trước kỳ mới
- **THEN** lịch sao chép bỏ qua nhân viên đó và báo danh sách bị bỏ qua
