# shift-swap Specification

## Purpose
TBD - created by archiving change add-shift-rotation-and-swap. Update Purpose after archive.
## Requirements
### Requirement: Đề xuất đổi ca sau khi lịch đã duyệt
Hệ thống SHALL cho TT lập đề xuất đổi ca cho lịch đã duyệt gồm nhân viên, ngày, ca cũ, ca mới và lý do, kiểm tra ràng buộc của ca mới, và đặt trạng thái chờ duyệt. Khi chưa được duyệt, lịch hiện hành MUST giữ nguyên và tiếp tục được dùng để ghép công.

#### Scenario: Chưa duyệt
- **WHEN** TT gửi đề xuất đổi ca B sang ca C cho ngày 15 và QĐ chưa duyệt
- **THEN** ghép công ngày 15 vẫn dùng ca B

#### Scenario: Ca mới vi phạm ràng buộc
- **WHEN** ca mới làm vượt trần giờ tuần
- **THEN** đề xuất bị từ chối tạo với lỗi ràng buộc cụ thể

### Requirement: QĐ duyệt đề xuất đổi ca
Hệ thống SHALL cho QĐ duyệt, trả lại hoặc từ chối đề xuất đổi ca kèm lý do; duyệt MUST cập nhật lịch đã duyệt thành phiên bản mới có lịch sử trước/sau, tính lại công của ngày bị ảnh hưởng nếu kỳ công còn mở, và thông báo TT. Ngày thuộc kỳ công đã đóng hoặc khóa MUST bị chặn.

#### Scenario: Đổi ca giữa chừng (06 §3.4 tình huống 6)
- **WHEN** QĐ duyệt đổi từ ca B sang ca C cho ngày công còn mở
- **THEN** công ngày đó được ghép lại theo ca C và lịch sử lưu ca cũ và ca mới

#### Scenario: Kỳ đã khóa
- **WHEN** QĐ duyệt đề xuất cho ngày thuộc kỳ công đã khóa
- **THEN** hệ thống trả `PERIOD_STATE_CONFLICT` và lịch không đổi

