## ADDED Requirements

### Requirement: Phạm vi dữ liệu không tải lại cây tổ chức ở mỗi lần gọi
Hệ thống SHALL tính phạm vi dữ liệu (`ScopeService.load`) với một truy vấn phiên bản thay cho việc tải lại toàn bộ cây tổ chức và quyền vai trò khi các nhóm này không đổi, và SHALL trả cùng kết quả như khi không cache.

#### Scenario: Gọi lặp khi dữ liệu không đổi
- **WHEN** nhiều request tính phạm vi cho cùng ngày trong khi cây tổ chức và quyền vai trò không đổi
- **THEN** từ lần thứ hai, mỗi lần chỉ truy vấn phiên bản và nhận cùng kết quả

#### Scenario: Request kế tiếp thấy thay đổi ngay
- **WHEN** cây tổ chức hoặc quyền vai trò thay đổi rồi người dùng gửi request mới
- **THEN** request mới tính phạm vi theo dữ liệu đã đổi

### Requirement: Đọc trong giao dịch theo snapshot của giao dịch
Hệ thống SHALL kiểm tra phiên bản cache trong snapshot của chính giao dịch đang đọc, để dữ liệu đọc trong giao dịch luôn theo snapshot đó, kể cả sau khi giao dịch tự ghi.

#### Scenario: Dữ liệu đổi trong giao dịch
- **WHEN** một giao dịch ghi thay đổi tham số hoặc tổ chức rồi đọc lại trong cùng giao dịch
- **THEN** lần đọc lại thấy giá trị mới, không thấy giá trị đã cache trước khi giao dịch bắt đầu

### Requirement: Tra tham số pháp lý theo lô trong một giao dịch
Hệ thống SHALL tra tham số pháp lý cho nhiều đơn vị và ngày trong một giao dịch bằng một lần nạp dữ liệu, với cùng thứ tự ưu tiên (cơ sở → vùng → toàn quốc), cùng ngày hiệu lực và cùng lỗi như tra từng lần.

#### Scenario: Kết quả trùng tra từng lần
- **WHEN** tra 5 tham số ghép công cho mọi tổ và mọi ngày của hai kỳ công
- **THEN** mọi giá trị và mã tham số trùng với kết quả tra từng lần, và số truy vấn không tăng theo số tổ × ngày

#### Scenario: Ngày ngoài khoảng đã nạp
- **WHEN** cần tham số cho một ngày nằm ngoài khoảng đã nạp
- **THEN** hệ thống tra trực tiếp CSDL và trả kết quả đúng
