## ADDED Requirements

### Requirement: Quản lý đợt thưởng
Hệ thống SHALL cho KT tạo đợt thưởng thuộc loại tháng, quý, năm, KPI, lễ Tết, thâm niên hoặc đột xuất, gồm căn cứ/quyết định, kỳ hưởng, kỳ lương chi, đối tượng là nhân viên hoặc đơn vị, và số tiền cố định hoặc công thức. Mỗi nhân viên MUST chỉ nhận một lần trong một đợt thưởng.

#### Scenario: Thưởng KPI theo công thức (FIX-08)
- **WHEN** thưởng KPI mục tiêu 5.000.000 đ × tỷ lệ 80%, có quyết định độc lập
- **THEN** khoản thưởng là 4.000.000 đ và lương cố định không bị trừ

#### Scenario: Cấp trùng
- **WHEN** KT thêm lại nhân viên đã có trong cùng đợt thưởng
- **THEN** hệ thống từ chối với lỗi trùng

### Requirement: Thưởng chỉ tính khi kỳ có chi và trước tổng hợp
Hệ thống SHALL đưa khoản thưởng đã xác nhận vào bảng lương chỉ khi kỳ lương đang tính là kỳ chi của đợt thưởng, tính trước bước tổng hợp thu nhập, và MUST áp thuế theo ngày chi của kỳ đó.

#### Scenario: Kỳ không có chi thưởng
- **WHEN** đợt thưởng quý có kỳ chi là tháng 10 và KT tính lương tháng 09
- **THEN** bảng lương tháng 09 không có khoản thưởng đó

### Requirement: Điểm chuyên cần chỉ ảnh hưởng thưởng
Hệ thống SHALL cho công thức thưởng dùng điểm chuyên cần làm biến, và MUST NOT dùng điểm chuyên cần hoặc số lần đi muộn để trừ vào lương.

#### Scenario: Chuyên cần thấp
- **WHEN** nhân viên có điểm chuyên cần thấp trong kỳ
- **THEN** chỉ khoản thưởng chuyên cần giảm theo công thức, lương không có dòng trừ

### Requirement: Chống cộng trùng với P3
Hệ thống SHALL báo `BONUS_P3_DOUBLE_COUNT` khi đợt thưởng dùng cùng nguồn KPI đã được dùng làm P3 trong phương án lương của nhân viên mà không có quyết định độc lập.

#### Scenario: Cùng nguồn KPI (TC-I07)
- **WHEN** thưởng KPI và P3 tham chiếu cùng kết quả đánh giá, không có quyết định riêng
- **THEN** khoản thưởng chưa được xác nhận và hiển thị xung đột cộng trùng
