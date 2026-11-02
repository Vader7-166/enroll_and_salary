## ADDED Requirements

### Requirement: Tổng hợp theo năm chi trả
Hệ thống SHALL tổng hợp cho từng nhân viên theo năm của ngày chi trả thực tế: thu nhập chịu thuế, phần miễn, giảm trừ bản thân và NPT theo số tháng đủ điều kiện, BH được trừ, giảm trừ khác có trần năm và thuế đã khấu trừ thực tế. Hệ thống MUST NOT nhóm theo tên kỳ công.

#### Scenario: Công tháng 12 chi tháng 1
- **WHEN** lương công tháng 12/2025 được chi ngày 09/01/2026
- **THEN** khoản đó thuộc tổng hợp năm 2026

### Requirement: Thuế năm bằng biểu năm
Hệ thống SHALL tính thuế năm bằng biểu năm của bộ quy tắc hiệu lực cho năm thuế (ngưỡng tháng × 12), và tính chênh lệch nộp thừa hoặc thiếu so với tổng đã khấu trừ.

#### Scenario: Không áp bảng tháng lên tổng năm
- **WHEN** tổng thu nhập tính thuế năm 2026 là 540.000.000 đ
- **THEN** thuế năm tính theo các bậc năm (120/360/720/1.200 triệu), không áp một suất tháng lên toàn bộ

### Requirement: Chuyển tiếp hồ sơ 6 tháng đầu 2026
Hệ thống SHALL giữ nguyên số đã khấu trừ và đã khai của các lần chi từ 01/01 đến 30/06/2026 theo bộ cũ, tính nghĩa vụ năm 2026 theo bộ mới và ghi điều chỉnh chênh lệch tại quyết toán, MUST NOT sửa hồ sơ gốc.

#### Scenario: TC-T10
- **WHEN** hồ sơ tháng/quý 6 tháng đầu 2026 đã khai theo bộ cũ và lập quyết toán năm 2026
- **THEN** snapshot số đã khấu trừ được giữ, nghĩa vụ năm tính bằng ngưỡng năm và tháng giảm trừ đủ điều kiện, chênh lệch ghi ở quyết toán

### Requirement: Ủy quyền và kiểm tra dữ liệu
Hệ thống SHALL chỉ lập dự thảo cho nhân viên có ủy quyền quyết toán hợp lệ, liệt kê người không đủ điều kiện kèm lý do, và MUST chặn hoàn tất dự thảo khi còn lần chi dự kiến chưa có ngày thực tế hoặc còn cờ đổi ngữ cảnh thuế chưa xử lý.

#### Scenario: Còn khoản dự kiến
- **WHEN** năm 2026 còn một lần chi trạng thái dự kiến
- **THEN** dự thảo báo `PROJECTED_PAYMENT_IN_YEAR` và không chuyển sang hoàn tất

### Requirement: Xuất dự thảo hồ sơ
Hệ thống SHALL xuất dự thảo hồ sơ quyết toán gồm tờ khai tổng hợp và phụ lục theo người ra tệp Excel theo mẫu cấu hình; hệ thống MUST NOT kê khai điện tử trực tiếp.

#### Scenario: Xuất tệp
- **WHEN** KT xuất dự thảo năm 2026
- **THEN** tệp có tờ tổng hợp và phụ lục từng người, và audit ghi lần xuất
