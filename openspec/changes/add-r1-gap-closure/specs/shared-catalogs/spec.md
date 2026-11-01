## ADDED Requirements

### Requirement: Danh mục địa bàn và trình độ có hiệu lực
Hệ thống SHALL cho AD quản trị danh mục địa bàn (mã hành chính, tên, cấp) và trình độ (mã, tên, thứ tự) theo phiên bản hiệu lực không chồng lấn; mọi thay đổi MUST ghi nhật ký kiểm toán và hồ sơ nhân viên MUST tham chiếu mã danh mục.

#### Scenario: Đổi tên địa bàn sau sáp nhập
- **WHEN** AD tạo phiên bản tên mới cho một địa bàn từ ngày 01/07
- **THEN** tra cứu tại 30/06 trả tên cũ, tại 01/07 trả tên mới, và có bản ghi audit cho thay đổi

#### Scenario: Phiên bản chồng lấn
- **WHEN** AD tạo phiên bản có khoảng hiệu lực chồng phiên bản đang có cùng mã
- **THEN** hệ thống từ chối và không thay đổi danh mục
