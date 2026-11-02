## ADDED Requirements

### Requirement: Danh mục phúc lợi theo hiệu lực
Hệ thống SHALL cho KT quản lý danh mục phúc lợi theo phiên bản hiệu lực, mỗi khoản có mức hưởng, cách xử lý thuế, cờ đưa vào bảng lương và điều kiện hưởng theo thâm niên, cấp bậc, loại HĐ và đơn vị.

#### Scenario: Khoản chịu thuế
- **WHEN** khoản quà sinh nhật được gắn cờ chịu thuế và đưa vào lương
- **THEN** khi cấp phát, khoản đó vào thu nhập chịu thuế của kỳ lương tương ứng

### Requirement: Danh sách dự kiến và xác nhận cấp phát
Hệ thống SHALL lọc nhân viên đủ điều kiện theo phúc lợi, kỳ và đối tượng thành danh sách dự kiến; KT được thêm/bớt và hệ thống MUST kiểm tra lại điều kiện; chỉ khi KT xác nhận mới ghi nhận cấp phát cho từng người. Danh sách chưa xác nhận MUST NOT ảnh hưởng bảng lương hay chi phí.

#### Scenario: Thêm người không đủ điều kiện
- **WHEN** KT thêm thủ công một nhân viên chưa đủ thâm niên
- **THEN** hệ thống cảnh báo và chỉ cho giữ khi có lý do

### Requirement: Chống cấp phát trùng
Khi xác nhận, hệ thống SHALL kiểm tra trùng theo phúc lợi, nhân viên và kỳ; dòng trùng MUST NOT được ghi nhận lần hai và phải được báo để KT kiểm tra lại.

#### Scenario: Quà Tết trùng (UAT-28)
- **WHEN** KT xác nhận cấp quà Tết cho nhân viên đã được cấp trong cùng kỳ
- **THEN** hệ thống báo dòng cần kiểm tra lại và không ghi nhận lần hai

### Requirement: Đưa phúc lợi vào kỳ lương
Hệ thống SHALL đưa các khoản phúc lợi đã xác nhận có cờ đưa vào lương vào kỳ lương được gắn, với phân loại thuế theo danh mục.

#### Scenario: Hỗ trợ nuôi con nhỏ
- **WHEN** khoản hỗ trợ nuôi con nhỏ đã xác nhận cho kỳ 10/2026
- **THEN** bảng lương kỳ 10/2026 có dòng khoản này với phân loại thuế đúng danh mục

### Requirement: Chi phí phúc lợi
Hệ thống SHALL tổng hợp chi phí phúc lợi đã xác nhận theo đơn vị/cost center, kỳ và loại, gồm cả trợ cấp thôi việc và mất việc, và cho xuất tệp.

#### Scenario: Gồm trợ cấp thôi việc
- **WHEN** trong kỳ có một khoản trợ cấp thôi việc đã xác nhận
- **THEN** báo cáo chi phí phúc lợi của kỳ có khoản đó ở loại trợ cấp
