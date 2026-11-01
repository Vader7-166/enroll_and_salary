## ADDED Requirements

### Requirement: Không xóa cứng bản ghi nghiệp vụ
Hệ thống SHALL không xóa vật lý bản ghi nghiệp vụ; hủy bỏ MUST ghi trạng thái, ngày và lý do. Chỉ các bảng trong danh sách ngoại lệ đã ghi lý do (dòng nháp dựng lại, phiên đăng nhập, thông báo quá hạn lưu) được xóa vật lý, và lint MUST báo lỗi khi mã nguồn xóa bảng ngoài danh sách.

#### Scenario: Xóa trực tiếp bằng SQL
- **WHEN** một câu lệnh DELETE chạy trên bảng nghiệp vụ
- **THEN** trigger từ chối và dữ liệu không đổi

#### Scenario: Mã nguồn mới gọi xóa
- **WHEN** mã nguồn thêm `deleteMany` trên bảng không thuộc danh sách ngoại lệ
- **THEN** lint tuân thủ báo lỗi kèm vị trí
