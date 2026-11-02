## ADDED Requirements

### Requirement: Thời gian xử lý nhập công khi lịch ca đã duyệt cả kỳ
Hệ thống SHALL nhập và ghép một ngày lượt quẹt của cơ sở 1.100 nhân viên trong không quá 60 giây trên máy đo chuẩn khi lịch ca đã duyệt cho cả kỳ hiện tại và kỳ sau, kể cả lần nhập đầu tiên của kỳ.

#### Scenario: Benchmark lịch ca cả kỳ
- **WHEN** chạy `scripts/benchmark-attendance-month.cjs 1100` với 67.100 lịch ca đã duyệt
- **THEN** lần nhập đầu và lần nhập thứ hai đều ≤ 60 giây và mọi lượt quẹt được ghép

#### Scenario: Chỉ tải lịch ca của cơ sở đang nhập
- **WHEN** nhập tệp cho một cơ sở trong khi các cơ sở khác cũng có lịch ca cả kỳ
- **THEN** thời gian xử lý không phụ thuộc số lịch ca của cơ sở khác

### Requirement: Chỉ ghi kết quả công thay đổi
Hệ thống SHALL chỉ ghi dòng ngày công và OT thực tế có nội dung khác kết quả đã lưu khi xử lý lại kỳ công, và kết quả lưu sau xử lý SHALL giống hệt kết quả khi ghi lại toàn bộ.

#### Scenario: Nhập lại cùng dữ liệu
- **WHEN** nhập lại hoặc xử lý lại một kỳ mà lượt quẹt, lịch ca, điều chỉnh và nghỉ không đổi
- **THEN** không dòng ngày công hoặc OT thực tế nào bị ghi lại và trigger kiểm tra kỳ/phân xưởng không chạy cho các dòng đó

#### Scenario: Một ngày thay đổi
- **WHEN** nhập thêm lượt quẹt làm đổi kết quả của một ngày công
- **THEN** chỉ dòng của ngày đó được cập nhật, với đầy đủ cột như khi ghi lại toàn bộ
