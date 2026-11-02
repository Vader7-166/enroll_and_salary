## ADDED Requirements

### Requirement: Kiểm tra quyền trước truy vấn và kết xuất
Hệ thống SHALL kiểm tra quyền vai trò và phạm vi đơn vị trước khi truy vấn báo cáo và kiểm tra quyền kết xuất trước khi tạo tệp; báo cáo MUST áp exclusion list và MUST NOT là đường vòng để xem dữ liệu ngoài phạm vi.

#### Scenario: TT xem bảng công (UAT-14)
- **WHEN** TT Tổ SMT-1 mở bảng chấm công tháng
- **THEN** báo cáo chỉ gồm nhân sự Tổ SMT-1 tại kỳ đó

#### Scenario: QĐ toàn công ty (UAT-22)
- **WHEN** QĐ phân xưởng NM Hà Nam yêu cầu bảng công toàn công ty
- **THEN** báo cáo chỉ trả nhân sự phân xưởng của QĐ

### Requirement: Trạng thái dữ liệu và snapshot
Mọi báo cáo và tệp kết xuất SHALL hiển thị rõ trạng thái Nháp hoặc Chính thức; dữ liệu kỳ đã khóa MUST lấy từ snapshot, không tính lại.

#### Scenario: In lại kỳ đã khóa
- **WHEN** KT xuất lại bảng thanh toán lương kỳ đã khóa sau khi công thức thay đổi
- **THEN** số liệu khớp bản xuất trước và nhãn là Chính thức

### Requirement: Cấu trúc tổ chức theo kỳ báo cáo
Hệ thống SHALL nhóm và đặt tên đơn vị trong báo cáo theo cây tổ chức hiệu lực tại kỳ báo cáo.

#### Scenario: Đơn vị đổi tên
- **WHEN** một tổ đổi tên sau kỳ 09/2026
- **THEN** báo cáo kỳ 09/2026 hiển thị tên cũ

### Requirement: Che trường, audit và định dạng
Hệ thống SHALL che trường nhạy cảm theo quyền cả trong tệp kết xuất, ghi audit mỗi lần kết xuất báo cáo chứa lương hoặc dữ liệu cá nhân, ghi tiêu đề gồm nguồn, kỳ, thời điểm và người xuất, cảnh báo khi vượt ngưỡng số bản ghi, và hỗ trợ Excel và PDF.

#### Scenario: Kết xuất bảng lương
- **WHEN** KT xuất bảng thanh toán tiền lương ra Excel
- **THEN** tệp có tiêu đề nguồn/kỳ/người xuất và audit ghi lần kết xuất

#### Scenario: Hiệu năng
- **WHEN** KT xuất báo cáo tháng toàn công ty cho 3.000 nhân sự
- **THEN** tệp hoàn tất trong không quá 2 phút
