## ADDED Requirements

### Requirement: Mức đóng BH theo hiệu lực
Hệ thống SHALL cho KT quản lý mức đóng theo loại BHXH, BHYT, BHTN, KPCĐ gồm tỷ lệ NLĐ, tỷ lệ DN, sàn, trần, vùng áp dụng, ngày hiệu lực và văn bản căn cứ. Thêm bản mới MUST đóng bản cũ cùng loại/vùng đến ngày trước hiệu lực mới; khoảng chồng MUST bị từ chối kèm bản ghi chồng.

#### Scenario: Thêm mức mới
- **WHEN** KT thêm tỷ lệ BHXH mới hiệu lực 01/01/2027 khi bản 2026 còn mở
- **THEN** bản 2026 được đóng đến 31/12/2026 và bản mới có hiệu lực từ 01/01/2027

#### Scenario: Thiếu căn cứ
- **WHEN** KT lưu mức đóng không có văn bản căn cứ
- **THEN** hệ thống từ chối với lỗi thiếu căn cứ

### Requirement: Xác định diện tham gia theo tháng
Hệ thống SHALL xác định nhân viên có thuộc diện đóng BH trong một tháng hay không theo loại và thời hạn HĐ, thử việc, số ngày nghỉ không lương, diện đã hưởng lương hưu và người nước ngoài, kèm mã lý do.

#### Scenario: HĐ dưới 1 tháng
- **WHEN** nhân viên chỉ có HĐ dưới 1 tháng
- **THEN** kết quả là không thuộc diện với lý do `CONTRACT_UNDER_1_MONTH`

#### Scenario: Nghỉ không lương 14 ngày
- **WHEN** nhân viên nghỉ không lương từ 14 ngày làm việc trở lên trong tháng
- **THEN** tháng đó không thuộc diện với lý do `UNPAID_LEAVE_14_DAYS`

#### Scenario: Đã hưởng lương hưu
- **WHEN** nhân viên có diện đã hưởng lương hưu hiệu lực trong tháng
- **THEN** không thuộc diện đóng BHXH bắt buộc với lý do `RETIREE`

### Requirement: Lương đóng BH có sàn và trần
Hệ thống SHALL tính lương đóng BH bằng tổng các cấu phần có cờ tính BH, riêng biệt với lương thực trả, rồi kẹp trong khoảng [sàn, trần]; sàn MUST là lương tối thiểu vùng tại địa điểm làm việc, cộng thêm tỷ lệ cấu hình nếu lao động đã qua đào tạo nghề; trần MUST áp riêng cho từng loại BH.

#### Scenario: Dưới sàn
- **WHEN** tổng cấu phần tính BH thấp hơn lương tối thiểu vùng của cơ sở
- **THEN** lương đóng BH bằng sàn và vết ghi giá trị trước và sau kẹp

#### Scenario: Cấu phần không tính BH
- **WHEN** nhân viên có phụ cấp không gắn cờ tính BH
- **THEN** phụ cấp đó không vào lương đóng BH

### Requirement: Tính BH hai phía, KPCĐ và đoàn phí
Hệ thống SHALL tính phần NLĐ và phần DN của BHXH, BHYT, BHTN theo tỷ lệ hiệu lực, KPCĐ phần DN trên quỹ lương đóng BHXH, và đoàn phí NLĐ theo tỷ lệ có trần, bằng Decimal kèm vết mã/phiên bản tham số.

#### Scenario: Tỷ lệ chuẩn
- **WHEN** lương đóng BH 10.000.000 đ, tỷ lệ NLĐ 8% / 1,5% / 1%
- **THEN** phần NLĐ là 800.000 / 150.000 / 100.000 đ

#### Scenario: Đoàn phí vượt trần
- **WHEN** 1% lương đóng BH lớn hơn trần đoàn phí
- **THEN** đoàn phí bằng trần

### Requirement: Kiểm tra CP-07
Hệ thống SHALL trả vi phạm `CP-07` mức BLOCKING cho nhân viên thuộc diện đóng BH trong tháng nhưng chưa có mức lương đóng BH hợp lệ.

#### Scenario: Thiếu lương đóng BH
- **WHEN** nhân viên thuộc diện nhưng không có cấu phần tính BH nào trong tháng
- **THEN** kiểm tra trả `CP-07` cho nhân viên đó
