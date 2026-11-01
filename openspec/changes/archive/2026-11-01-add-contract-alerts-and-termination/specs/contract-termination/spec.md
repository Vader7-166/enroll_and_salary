## ADDED Requirements

### Requirement: Lập quyết định chấm dứt và xem trước
Hệ thống SHALL cho KT lập quyết định chấm dứt gồm nhân viên, ngày hiệu lực, lý do và căn cứ, và hiển thị xem trước gồm HĐ hiệu lực, thâm niên, trợ cấp thôi việc hoặc mất việc, số ngày phép chưa nghỉ và tiền thanh toán, danh sách báo giảm BH. Khi quyết định chưa được xác nhận, hệ thống MUST NOT thay đổi HĐ, nhân viên, bảng lương hay BH.

#### Scenario: Chưa xác nhận (UAT-27)
- **WHEN** KT lập quyết định chấm dứt nhưng chưa xác nhận
- **THEN** màn hình hiển thị trợ cấp, tiền phép chưa nghỉ và danh sách báo giảm, còn dữ liệu HĐ không đổi

### Requirement: Xác nhận chấm dứt
Khi KT xác nhận sau xác thực lại, hệ thống SHALL trong một giao dịch cập nhật trạng thái HĐ và ngày nghỉ việc, tạo khoản trợ cấp và tiền phép chưa nghỉ vào kỳ lương mở gần nhất của cơ sở, và ghi audit. Mỗi khoản MUST chỉ được ghi nhận một lần cho một quyết định.

#### Scenario: Xác nhận (UAT-27)
- **WHEN** KT xác nhận quyết định chấm dứt
- **THEN** trợ cấp vào kỳ lương gần nhất một lần duy nhất và HĐ chuyển trạng thái đã chấm dứt

#### Scenario: Xác nhận lặp
- **WHEN** lệnh xác nhận được gửi hai lần cho cùng quyết định
- **THEN** lần hai bị từ chối và không có khoản trợ cấp thứ hai

### Requirement: Tính trợ cấp thôi việc và mất việc
Hệ thống SHALL tính trợ cấp bằng số tháng lương mỗi năm làm việc theo tham số loại trợ cấp × thời gian làm việc tính trợ cấp × lương bình quân theo HĐ của số tháng cấu hình trước khi nghỉ; thời gian tính trợ cấp MUST trừ thời gian tham gia BHTN và thời gian đã được chi trả trợ cấp; trợ cấp mất việc MUST không thấp hơn mức tối thiểu cấu hình.

#### Scenario: Thời gian đã tham gia BHTN
- **WHEN** nhân viên làm việc 6 năm, trong đó 4 năm đã tham gia BHTN, nghỉ theo diện thôi việc
- **THEN** thời gian tính trợ cấp là 2 năm

#### Scenario: Mất việc ngắn hạn
- **WHEN** trợ cấp mất việc tính theo năm thấp hơn mức tối thiểu
- **THEN** trợ cấp bằng mức tối thiểu cấu hình

### Requirement: Tiền phép chưa nghỉ
Hệ thống SHALL tính số ngày phép năm chưa nghỉ tại ngày chấm dứt từ quỹ phép và thanh toán theo đơn giá ngày công tại thời điểm chấm dứt; khoản này MUST được gắn loại để bộ thuế xét điều kiện miễn.

#### Scenario: Còn 3 ngày phép
- **WHEN** nhân viên còn 3 ngày phép chưa nghỉ khi chấm dứt
- **THEN** xem trước hiển thị 3 ngày × đơn giá ngày công và khoản được gắn loại tiền phép chưa nghỉ
