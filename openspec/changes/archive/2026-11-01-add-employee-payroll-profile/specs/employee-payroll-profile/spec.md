## ADDED Requirements

### Requirement: Định danh và thông tin chi trả của nhân viên
Hệ thống SHALL cho KT trong phạm vi quản lý CCCD/số định danh hoặc hộ chiếu, mã số thuế, số sổ BHXH, tài khoản ngân hàng nhận lương, liên hệ khẩn cấp và tệp đính kèm của nhân viên. Hệ thống MUST chặn trùng mã số thuế và số sổ BHXH giữa hai nhân viên khác nhau.

#### Scenario: Trùng mã số thuế
- **WHEN** KT lưu MST đã thuộc nhân viên khác
- **THEN** hệ thống trả `DUPLICATE_TAX_CODE` và không lưu thay đổi

#### Scenario: Ngoài phạm vi
- **WHEN** KT có phạm vi Bắc Ninh cập nhật hồ sơ nhân viên Nghệ An
- **THEN** hệ thống từ chối theo quy tắc phạm vi và ghi audit

### Requirement: Mã hóa và che trường nhạy cảm
Hệ thống SHALL lưu CCCD và số tài khoản ngân hàng ở dạng mã hóa AES-256. API MUST trả giá trị đã che khi người gọi thiếu quyền xem trường nhạy cảm; AD MUST luôn nhận giá trị đã che. Mỗi lần đọc giá trị đầy đủ hoặc bị từ chối MUST ghi audit.

#### Scenario: AD xem hồ sơ
- **WHEN** AD mở chi tiết nhân viên
- **THEN** CCCD và số tài khoản hiển thị dạng che và có cờ `masked`

#### Scenario: Dữ liệu trong cơ sở dữ liệu
- **WHEN** đọc trực tiếp bảng lưu CCCD
- **THEN** cột chỉ chứa bản mã hóa và hash, không có giá trị rõ

### Requirement: Hồ sơ thuế theo hiệu lực
Hệ thống SHALL lưu hồ sơ thuế của nhân viên theo khoảng hiệu lực không chồng gồm trạng thái cư trú (RESIDENT/NON_RESIDENT), tham chiếu và phiên bản mẫu cam kết tạm không khấu trừ nếu có, và ủy quyền quyết toán. Trạng thái cư trú MUST độc lập với loại hợp đồng.

#### Scenario: Thêm hồ sơ mới
- **WHEN** KT thêm hồ sơ cư trú hiệu lực từ 01/07/2026 khi bản cũ còn mở
- **THEN** bản cũ được đóng đến 30/06/2026 trong cùng giao dịch và lịch sử không bị sửa

#### Scenario: Khoảng chồng
- **WHEN** KT thêm hồ sơ có hiệu lực chồng một bản đã đóng
- **THEN** hệ thống trả lỗi chỉ ra bản ghi bị chồng

### Requirement: Diện đặc thù theo hiệu lực
Hệ thống SHALL ghi nhận theo hiệu lực các diện người nước ngoài (giấy phép lao động và thời hạn), đã hưởng lương hưu, lao động chưa thành niên, lao động nữ và lao động đã qua đào tạo nghề, để phân hệ BH và thuế tra cứu tại ngày nghiệp vụ.

#### Scenario: Tra cứu diện tại ngày
- **WHEN** phân hệ BH hỏi diện của nhân viên tại ngày 15/09/2026
- **THEN** hệ thống trả đúng các diện có hiệu lực tại ngày đó
