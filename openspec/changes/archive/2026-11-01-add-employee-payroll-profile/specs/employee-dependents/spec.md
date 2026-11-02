## ADDED Requirements

### Requirement: Người phụ thuộc theo tháng giảm trừ
Hệ thống SHALL cho KT ghi nhận người phụ thuộc của nhân viên gồm họ tên, quan hệ, mã số thuế NPT nếu có, tháng bắt đầu và tháng kết thúc được giảm trừ (YYYY-MM, kết thúc có thể trống) và chứng từ đính kèm. Tháng kết thúc MUST không trước tháng bắt đầu.

#### Scenario: Ghi nhận NPT
- **WHEN** KT thêm NPT giảm trừ từ 2026-03 kèm chứng từ
- **THEN** NPT được tính đủ điều kiện cho mọi tháng từ 2026-03 trở đi

#### Scenario: Thiếu chứng từ
- **WHEN** KT lưu NPT không có chứng từ
- **THEN** hệ thống trả `DEPENDENT_EVIDENCE_REQUIRED`

### Requirement: Đếm số NPT đủ điều kiện theo tháng
Hệ thống SHALL cung cấp truy vấn số NPT đủ điều kiện của một nhân viên trong một tháng thuế, dùng cho bộ tính thuế TNCN và quyết toán năm.

#### Scenario: NPT kết thúc giữa năm
- **WHEN** NPT có khoảng 2026-01 đến 2026-06
- **THEN** truy vấn tháng 2026-06 trả 1 và tháng 2026-07 trả 0

### Requirement: Lịch sử NPT bất biến
Hệ thống SHALL lưu thay đổi NPT dưới dạng phiên bản mới có lý do; bản ghi đã dùng trong kỳ thuế đã khóa MUST NOT bị sửa hoặc xóa cứng.

#### Scenario: Sửa NPT đã dùng
- **WHEN** KT sửa tháng bắt đầu của NPT đã được dùng ở bảng lương đã khóa
- **THEN** hệ thống tạo phiên bản mới, giữ bản cũ và ghi audit với lý do
