# in-app-notifications Specification

## Purpose
TBD - created by archiving change add-audit-search-and-in-app-notifications. Update Purpose after archive.
## Requirements
### Requirement: Thông báo theo vai trò và phạm vi
Hệ thống SHALL tạo thông báo trong ứng dụng cho người dùng có vai trò và phạm vi liên quan khi xảy ra các sự kiện: lịch ca chờ duyệt hoặc bị trả lại, OT chờ duyệt hoặc có kết quả, đề xuất đổi ca, xưởng đã chốt, kỳ công bị trả lại hoặc đã khóa, bảng lương về nháp, sắp đến hạn chi lương, tham số sắp hết hiệu lực. Hệ thống MUST NOT gửi email.

#### Scenario: OT chờ duyệt
- **WHEN** TT gửi đề xuất OT của tổ
- **THEN** QĐ của xưởng chứa tổ nhận thông báo kèm liên kết tới đề xuất

#### Scenario: Xưởng đã chốt
- **WHEN** QĐ chốt bảng công xưởng
- **THEN** KT có phạm vi chứa xưởng nhận thông báo

### Requirement: Hộp thông báo và quyền khi mở
Hệ thống SHALL hiển thị số thông báo chưa đọc trên header, cho đánh dấu đã đọc, và MUST kiểm tra lại quyền hiện hành khi người dùng mở liên kết của thông báo.

#### Scenario: Quyền đã bị thu hồi
- **WHEN** người dùng mở thông báo cũ sau khi bị thu hồi phạm vi
- **THEN** màn hình đích từ chối truy cập theo quyền hiện hành

### Requirement: Lỗi thông báo không ảnh hưởng nghiệp vụ
Việc tạo thông báo SHALL diễn ra sau khi giao dịch nghiệp vụ hoàn tất; lỗi khi tạo thông báo MUST NOT làm hỏng hay hoàn tác thao tác nghiệp vụ.

#### Scenario: Lỗi khi phát
- **WHEN** tạo thông báo thất bại sau khi QĐ duyệt OT
- **THEN** đề xuất OT vẫn ở trạng thái đã duyệt và lỗi được ghi log

