# payroll-compliance-gates Specification

## Purpose
TBD - created by archiving change add-payroll-calculation-engine. Update Purpose after archive.
## Requirements
### Requirement: Chạy cổng CP-01…CP-09
Sau mỗi lần tính, hệ thống SHALL chạy chín kiểm tra CP-01 (dưới lương tối thiểu vùng theo địa điểm từng đoạn), CP-02 (thử việc dưới 85%), CP-03 (vượt trần OT), CP-04 (khấu trừ vượt 30% NET), CP-05 (thực lĩnh âm), CP-06 (còn ngày công ERR), CP-07 (thuộc diện BH thiếu lương đóng), CP-08 (chênh lệch kỳ trước vượt ngưỡng), CP-09 (thu nhập sản phẩm dưới tối thiểu vùng), và MUST lưu kết quả từng mã kèm lần chạy, số vi phạm và danh sách nhân viên.

#### Scenario: Dưới tối thiểu vùng I (TC-P01, UAT-05)
- **WHEN** nhân viên NM Bắc Ninh (vùng I, 5.310.000 đ) có lương HĐ 5.000.000 đ
- **THEN** CP-01 báo vi phạm BLOCKING, đánh dấu đỏ và dẫn chiếu NĐ 293/2025

#### Scenario: Hợp lệ ở vùng II (TC-P01b, UAT-05b)
- **WHEN** nhân viên NM Hà Nam (vùng II, 4.730.000 đ) có lương HĐ 5.000.000 đ
- **THEN** CP-01 không báo vi phạm

#### Scenario: Khấu trừ vượt 30% (TC-P04, UAT-18)
- **WHEN** khoản bồi thường vượt 30% thực lĩnh
- **THEN** CP-04 báo BLOCKING và đề xuất giãn khấu trừ sang các kỳ sau

### Requirement: Mức chặn đúng từng mã
Hệ thống SHALL coi CP-01…CP-07 và CP-09 là BLOCKING, không cho duyệt bảng lương khi còn vi phạm; CP-08 MUST là WARNING và chỉ được bỏ qua khi KT xác nhận từng nhân viên kèm lý do. Hệ thống MUST NOT có cơ chế ghi đè BLOCKING.

#### Scenario: Cảnh báo chênh lệch
- **WHEN** ba nhân viên có tổng thu nhập chênh kỳ trước vượt ngưỡng
- **THEN** CP-08 hiển thị cảnh báo; sau khi KT xác nhận ba nhân viên, cảnh báo ghi trạng thái đã xác nhận với người và thời điểm

#### Scenario: Còn BLOCKING
- **WHEN** bảng lương còn một vi phạm CP-05
- **THEN** hành động duyệt bị từ chối và liệt kê vi phạm còn lại

