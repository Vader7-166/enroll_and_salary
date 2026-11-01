# audit-search Specification

## Purpose
TBD - created by archiving change add-audit-search-and-in-app-notifications. Update Purpose after archive.
## Requirements
### Requirement: AD tra cứu nhật ký theo phạm vi
Hệ thống SHALL cho AD tra cứu nhật ký kiểm toán trong phạm vi được cấp theo khoảng thời gian, người thực hiện, hành động, loại và mã đối tượng, kết quả (gồm truy cập bị từ chối), xem giá trị cũ, mới, lý do và IP; giá trị lương MUST bị che với AD. Mỗi lần xuất tệp nhật ký MUST được ghi audit.

#### Scenario: Lọc truy cập bị từ chối
- **WHEN** AD lọc kết quả "bị từ chối" trong tuần qua
- **THEN** hệ thống trả các lần truy cập dữ liệu nhạy cảm bị từ chối trong phạm vi của AD

#### Scenario: Ngoài phạm vi
- **WHEN** AD phạm vi NM Hà Nam tra cứu
- **THEN** không thấy bản ghi của đối tượng thuộc NM Bắc Ninh

### Requirement: Kiểm tra toàn vẹn chuỗi băm
Hệ thống SHALL kiểm tra toàn vẹn chuỗi băm nhật ký định kỳ hằng ngày và khi AD yêu cầu, lưu kết quả kiểm tra, và cảnh báo AD khi phát hiện bản ghi sai băm hoặc đứt chuỗi kèm mã bản ghi đầu tiên bị lỗi.

#### Scenario: Chuỗi nguyên vẹn
- **WHEN** chạy kiểm tra trên nhật ký không bị can thiệp
- **THEN** kết quả là hợp lệ cho toàn bộ khoảng đã kiểm

#### Scenario: Bị can thiệp ngoài ứng dụng
- **WHEN** một bản ghi bị sửa trực tiếp bằng quyền quản trị cơ sở dữ liệu sau khi vô hiệu trigger
- **THEN** kiểm tra báo lỗi tại bản ghi đó và AD nhận cảnh báo

