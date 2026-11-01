# salary-payment Specification

## Purpose
TBD - created by archiving change add-payslips-and-payment-files. Update Purpose after archive.
## Requirements
### Requirement: Mẫu file chi lương cấu hình theo ngân hàng
Hệ thống SHALL cho KT khai báo mẫu file chi theo ngân hàng gồm danh sách cột, thứ tự, định dạng và tùy chọn tách theo cơ sở; thêm ngân hàng mới MUST chỉ là khai báo cấu hình.

#### Scenario: Thêm ngân hàng
- **WHEN** KT thêm mẫu cho một ngân hàng mới
- **THEN** có thể xuất file chi theo mẫu đó mà không cần triển khai mã

### Requirement: Xuất file chi lương
Hệ thống SHALL cho KT, sau khi xác thực lại, xuất file chi từ bảng lương đã khóa với số tiền bằng đúng thực lĩnh, không trừ phí chuyển khoản; tệp tạm MUST được mã hóa và mỗi lần xuất MUST ghi audit. Xuất file MUST NOT đổi trạng thái thanh toán.

#### Scenario: Không trừ phí (BR-60)
- **WHEN** ngân hàng thu phí chuyển khoản
- **THEN** file ghi đúng thực lĩnh của từng người

#### Scenario: Xuất chưa đồng nghĩa đã trả (FR-7.6.3)
- **WHEN** KT xuất file chi
- **THEN** lô chi ở trạng thái đã xuất, chưa phải đã thanh toán

### Requirement: Ghi nhận ngày chi thực tế
Hệ thống SHALL cho KT ghi ngày chi thực tế cho lô chi; khi ghi MUST cập nhật bản ghi khấu trừ thuế sang trạng thái thực tế và MUST đánh dấu cần xử lý nếu năm thuế của ngày thực tế khác ngày dự kiến, không mở khóa bảng lương.

#### Scenario: Đổi năm thuế
- **WHEN** ngày chi dự kiến 31/12/2026 nhưng thực tế chi 05/01/2027
- **THEN** lô chi ghi nhận ngày thực tế và bản ghi thuế bị đánh dấu `TAX_CONTEXT_CHANGED`

### Requirement: Đền bù chậm trả lương
Khi ngày chi thực tế chậm hơn ngày chi quy định quá 15 ngày, hệ thống SHALL tính đền bù = số tiền chậm × số ngày chậm × lãi suất hiệu lực ÷ 365 và đưa vào kỳ lương mở kế tiếp thành dòng riêng có thuyết minh; chậm từ 15 ngày trở xuống MUST chỉ cảnh báo.

#### Scenario: Chậm 20 ngày
- **WHEN** lô chi 100.000.000 đ chậm 20 ngày, lãi suất tham số 0,5%/năm
- **THEN** đền bù tính theo công thức và xuất hiện ở kỳ lương kế tiếp với dòng riêng ghi kỳ gốc

#### Scenario: Chậm 10 ngày
- **WHEN** lô chi chậm 10 ngày
- **THEN** không phát sinh đền bù nhưng có cảnh báo chậm trả

