# absence-rate Specification

## Purpose
TBD - created by archiving change add-sickness-maternity-and-absence-tracking. Update Purpose after archive.
## Requirements
### Requirement: Tỷ lệ vắng mặt theo xưởng
Hệ thống SHALL cho QĐ chọn xưởng trong phạm vi và khoảng thời gian, tổng hợp đơn nghỉ đã duyệt và ngày công vắng, và hiển thị tỷ lệ vắng theo tổ, theo ngày và theo loại nghỉ, dùng cấu trúc tổ chức tại kỳ.

#### Scenario: Chỉ thấy xưởng mình
- **WHEN** QĐ phân xưởng NM Hà Nam xem tỷ lệ vắng
- **THEN** chỉ có các tổ thuộc phân xưởng đó

#### Scenario: QĐ không duyệt đơn (UAT-25)
- **WHEN** TT đã duyệt đơn nghỉ 5 ngày
- **THEN** QĐ thấy các ngày nghỉ đó trong tỷ lệ vắng nhưng không có thao tác duyệt

### Requirement: Cảnh báo vượt ngưỡng
Hệ thống SHALL đánh dấu tổ hoặc ngày có tỷ lệ vắng vượt ngưỡng cấu hình.

#### Scenario: Vượt ngưỡng
- **WHEN** tỷ lệ vắng của một tổ trong ngày là 12% và ngưỡng là 10%
- **THEN** ô tương ứng được đánh dấu cảnh báo

