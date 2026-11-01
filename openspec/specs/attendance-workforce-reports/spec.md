# attendance-workforce-reports Specification

## Purpose
TBD - created by archiving change add-core-reports. Update Purpose after archive.
## Requirements
### Requirement: Bảng chấm công tháng theo mẫu
Hệ thống SHALL kết xuất bảng chấm công tháng gồm định danh, ký hiệu công từng ngày trong kỳ, tổng công ngày/đêm/phép/lễ/không lương, giờ OT ngày và đêm tách theo loại ngày, tổng công quy đổi và trạng thái bảng công.

#### Scenario: Kỳ đã khóa
- **WHEN** QĐ xuất bảng chấm công kỳ đã khóa
- **THEN** số liệu lấy từ snapshot kèm mã băm và trạng thái Đã khóa

### Requirement: Báo cáo công và OT
Hệ thống SHALL cung cấp cho TT (tổ) và QĐ (xưởng) báo cáo OT theo loại ngày so với trần, lũy kế OT tháng/năm và số giờ còn huy động hợp pháp, đi muộn/về sớm (ghi rõ không dùng để trừ lương), ngoại lệ công chưa xử lý, và giờ làm theo tuần (ghi rõ không đồng nghĩa chứng nhận SMETA/BSCI/RBA).

#### Scenario: Báo cáo tuần
- **WHEN** QĐ xuất báo cáo giờ làm theo tuần
- **THEN** tệp có ghi chú không phải chứng nhận SMETA/BSCI/RBA

### Requirement: Biến động nhân sự cho QĐ
Hệ thống SHALL cung cấp cho QĐ báo cáo vào làm, nghỉ việc, điều chuyển trong/ngoài xưởng và tỷ lệ nghỉ việc theo bộ phận, thâm niên, loại HĐ trong phạm vi xưởng.

#### Scenario: Điều chuyển ra khỏi xưởng
- **WHEN** nhân viên chuyển từ xưởng của QĐ sang xưởng khác trong tháng
- **THEN** báo cáo tháng ghi nhân viên ở mục điều chuyển ra

### Requirement: Sổ quản lý lao động
Hệ thống SHALL kết xuất sổ quản lý lao động đủ 20 tiêu chí theo khoản 2 Điều 3 NĐ 145/2020, và MUST cảnh báo trên sổ khi giờ OT lũy kế năm của nhân viên vượt 200 hoặc 300 giờ theo trần áp dụng; tiêu chí chưa có dữ liệu MUST để trống có ghi chú, không tự điền.

#### Scenario: OT lũy kế vượt 200 giờ
- **WHEN** nhân viên có 205 giờ OT lũy kế trong năm ở cơ sở trần 200 giờ
- **THEN** dòng của nhân viên trên sổ có cảnh báo

