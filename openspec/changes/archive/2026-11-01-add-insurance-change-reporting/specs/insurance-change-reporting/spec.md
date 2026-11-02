## ADDED Requirements

### Requirement: Sinh danh sách biến động BH theo tháng
Hệ thống SHALL sinh cho từng cơ sở và tháng danh sách báo tăng, báo giảm và điều chỉnh mức đóng BH bằng cách so diện tham gia và lương đóng BH của tháng với tháng trước; mỗi dòng MUST có loại, lý do, ngày hiệu lực, mức cũ, mức mới và nguồn dữ liệu.

#### Scenario: Nghỉ việc
- **WHEN** nhân viên có ngày nghỉ việc trong tháng 09/2026
- **THEN** danh sách tháng 09/2026 có dòng báo giảm với lý do nghỉ việc và ngày hiệu lực

#### Scenario: Tăng lương đóng BH
- **WHEN** lương đóng BH của nhân viên tăng từ tháng 10/2026
- **THEN** danh sách tháng 10/2026 có dòng điều chỉnh với mức cũ và mức mới

### Requirement: Chốt và xuất danh sách
Hệ thống SHALL cho KT chốt danh sách tháng và xuất tệp theo mẫu cấu hình; danh sách đã chốt MUST NOT thay đổi, và biến động phát hiện sau khi chốt MUST được ghi vào danh sách tháng đang mở với cờ báo muộn và tham chiếu tháng gốc.

#### Scenario: Phát sinh sau chốt
- **WHEN** tháng 09 đã chốt và KT nhập quyết định nghỉ việc hiệu lực 20/09
- **THEN** dòng báo giảm xuất hiện ở danh sách tháng hiện hành, gắn cờ báo muộn, tham chiếu tháng 09

### Requirement: Theo dõi truy thu và thoái thu
Với mỗi dòng báo muộn, hệ thống SHALL tính số tháng và số tiền truy thu hoặc thoái thu theo từng loại BH, dùng mức đóng hiệu lực của từng tháng gốc.

#### Scenario: Báo tăng muộn hai tháng
- **WHEN** nhân viên thuộc diện từ tháng 08 nhưng được báo tăng ở tháng 10
- **THEN** hệ thống ghi truy thu cho tháng 08 và 09 theo mức đóng của hai tháng đó

### Requirement: Đối chiếu C12
Hệ thống SHALL cho KT nhập thông báo kết quả đóng BH C12 theo mẫu ánh xạ cột, ghép theo số sổ BHXH và liệt kê chênh lệch theo nhân sự với phân loại thiếu trong C12, thiếu trong hệ thống, lệch số tiền, lệch mức lương đóng.

#### Scenario: Lệch số tiền
- **WHEN** C12 ghi số đóng của nhân viên khác số trong bảng lương đã khóa của tháng
- **THEN** danh sách chênh lệch có dòng `AMOUNT_DIFF` với hai giá trị và chênh lệch

#### Scenario: Không ghép được
- **WHEN** dòng C12 có số sổ BHXH không thuộc nhân viên nào
- **THEN** dòng được liệt kê là `MISSING_IN_SYSTEM` và không bị tự ghép
