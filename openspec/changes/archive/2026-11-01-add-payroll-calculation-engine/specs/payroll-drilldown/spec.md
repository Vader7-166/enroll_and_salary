## ADDED Requirements

### Requirement: Giải trình từng dòng lương
Hệ thống SHALL cho KT mở một dòng lương và xem số tiền, công thức đã dùng, giá trị từng biến, tham số và phiên bản, dòng đầu vào nguồn và dữ liệu công gốc đến từng lượt quẹt, đọc từ vết đã lưu mà không tính lại.

#### Scenario: Dòng OT
- **WHEN** KT mở dòng tiền OT của một nhân viên
- **THEN** hệ thống hiển thị đơn giá giờ (tử số, mẫu số và nguồn), hệ số phân rã, số giờ từng bucket và ngày công cùng lượt quẹt gốc

#### Scenario: Dòng sản phẩm
- **WHEN** KT mở dòng lương sản phẩm
- **THEN** hệ thống hiển thị từng dòng đầu vào nguồn, phiên bản đơn giá theo ngày thực hiện và hash nguồn

### Requirement: Hiệu năng và quyền drill-down
Drill-down một dòng SHALL trả kết quả trong không quá 3 giây ở p95 và MUST áp cùng quyền phạm vi, exclusion và che trường như bảng lương.

#### Scenario: Ngoài phạm vi
- **WHEN** KT phạm vi Bắc Ninh mở dòng lương của nhân viên Nghệ An
- **THEN** hệ thống từ chối và ghi audit truy cập bị từ chối
