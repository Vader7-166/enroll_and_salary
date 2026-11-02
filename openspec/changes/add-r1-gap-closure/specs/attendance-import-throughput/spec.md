## ADDED Requirements

### Requirement: Thông lượng nhập tệp chấm công
Hệ thống SHALL kiểm tra và trả kết quả nhập một tệp 10.000 dòng hợp lệ trong không quá 1 phút trên máy đo chuẩn, đồng thời giữ nguyên kết quả ghép công so với cách xử lý hiện tại.

#### Scenario: Tệp 10.000 dòng
- **WHEN** AD nhập tệp 10.000 lượt quẹt hợp lệ của 2.500 nhân viên trong hai ngày
- **THEN** API trả kết quả trong ≤ 60 giây và benchmark ban đêm ghi NFR-13 đạt

#### Scenario: Kết quả ghép không đổi
- **WHEN** chạy bộ kiểm thử chấm công sau khi đổi cách xử lý theo lô
- **THEN** mọi ca kiểm thử chấm công hiện có vẫn đạt
