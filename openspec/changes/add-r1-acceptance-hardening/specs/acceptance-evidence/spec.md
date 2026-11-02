## ADDED Requirements

### Requirement: Rà soát khoảng trống FR
Dự án SHALL duy trì bảng đối chiếu 152 FR M trong manifest với change, task, test và bằng chứng; FR chưa có cài đặt hoặc test MUST được liệt kê và gắn change xử lý.

#### Scenario: FR chưa có test
- **WHEN** rà soát phát hiện FR-1.1.4 chưa có test che trường
- **THEN** bảng đối chiếu ghi FR-1.1.4 thiếu test và tham chiếu change xử lý

### Requirement: Đối soát hai kỳ liên tiếp
Trước nghiệm thu, dự án SHALL chạy đối soát tối thiểu hai kỳ lương liên tiếp trên dữ liệu mô phỏng; mỗi chênh lệch MUST được phân loại, có kết quả đúng đã kiểm chứng và xác nhận xử lý, và MUST NOT lấy công thức Excel cũ sai làm chuẩn.

#### Scenario: Chênh lệch do Excel cũ
- **WHEN** chênh lệch phụ cấp đêm do Excel cũ giả định nửa số công là ca đêm
- **THEN** chênh lệch được phân loại lỗi nguồn đối chứng và kết quả hệ thống theo giờ đêm thực tế được giữ

### Requirement: Ghi bằng chứng nghiệm thu
Trạng thái nghiệm thu của từng FR trong manifest SHALL chỉ được đổi khỏi `NOT_EXECUTED` khi có bằng chứng gồm FR, phiên bản build/cấu hình/nguồn, test đã chạy, kết quả, lỗi và người nghiệm thu; việc đổi trạng thái MUST đi qua script đọc kết quả thật, không sửa tay.

#### Scenario: Không có bằng chứng
- **WHEN** có yêu cầu đánh dấu FR-7.2.1 đạt nhưng chưa có tệp kết quả test
- **THEN** script từ chối cập nhật và giữ `NOT_EXECUTED`
