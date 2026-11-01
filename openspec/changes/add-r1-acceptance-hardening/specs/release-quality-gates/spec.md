## ADDED Requirements

### Requirement: CI chạy toàn bộ kiểm thử
Hệ thống SHALL có pipeline CI chạy trên mỗi push và pull request gồm typecheck, build, migrate trên PostgreSQL 18 sạch, seed, toàn bộ bộ `verify:*`, kiểm tra phạm vi phát hành và lint; bất kỳ bước nào thất bại MUST làm pipeline thất bại.

#### Scenario: Test lương thất bại
- **WHEN** một thay đổi làm sai kết quả TC-T01
- **THEN** pipeline thất bại ở bước `verify:pit`

### Requirement: Lint tuân thủ
Hệ thống SHALL có quy tắc lint chặn dùng số dấu phẩy động cho tiền tệ trong các module lương, BH, thuế; phát hiện hằng số pháp lý nghi vấn trong mã nguồn; và chặn tra tham số theo ngày hiện tại thay vì ngày nghiệp vụ.

#### Scenario: Hardcode tỷ lệ BH
- **WHEN** mã nguồn module BH chứa hằng số `0.08` làm tỷ lệ
- **THEN** lint báo lỗi và chỉ ra vị trí

### Requirement: Bộ dữ liệu nghiệm thu và runner UAT
Hệ thống SHALL chạy bộ ca kiểm thử cố định TC-A…TC-L mỗi lần build, và cung cấp runner cho 29 dòng UAT xuất kết quả gồm mã UAT, FR liên quan, mã build, cấu hình và kết quả.

#### Scenario: Xuất kết quả UAT
- **WHEN** chạy runner UAT trên một build cố định
- **THEN** tệp kết quả liệt kê đủ 29 dòng với trạng thái từng dòng và mã build

### Requirement: Benchmark hiệu năng định kỳ
Hệ thống SHALL có bộ sinh dữ liệu mô phỏng 3.000 nhân sự trên 4 cơ sở và chạy định kỳ đo các ngưỡng NFR-07 đến NFR-13, lưu kết quả kèm cấu hình máy.

#### Scenario: Vượt ngưỡng
- **WHEN** tính lương 3.000 nhân sự mất hơn 15 phút trong lần đo
- **THEN** báo cáo benchmark đánh dấu NFR-07 không đạt
