## ADDED Requirements

### Requirement: Cache dữ liệu tham chiếu có phiên bản
Hệ thống SHALL chỉ cache giữa các request các nhóm dữ liệu tham chiếu: cây tổ chức theo phiên bản, quyền vai trò, tham số pháp lý, chính sách cơ sở và danh mục ca. Mỗi nhóm SHALL có số phiên bản trong CSDL tăng trong cùng giao dịch với mọi thao tác ghi bảng nguồn của nhóm.

#### Scenario: Ghi bảng nguồn tăng phiên bản
- **WHEN** bất kỳ câu lệnh INSERT, UPDATE hoặc DELETE nào thành công trên một bảng nguồn của nhóm
- **THEN** phiên bản của nhóm tăng và được commit cùng dữ liệu

#### Scenario: Ghi ngoài ứng dụng
- **WHEN** seed, migration hoặc lệnh SQL tay sửa một tham số pháp lý
- **THEN** phiên bản nhóm tham số tăng và request kế tiếp dùng giá trị mới

### Requirement: Chỉ dùng cache khi phiên bản khớp snapshot
Hệ thống SHALL đọc phiên bản các nhóm trong cùng snapshot với dữ liệu nghiệp vụ của request hoặc giao dịch, và SHALL chỉ dùng mục cache có phiên bản bằng phiên bản đó; lệch thì tải lại.

#### Scenario: Nhiều instance backend
- **WHEN** instance A sửa chính sách cơ sở và instance B nhận request ngay sau khi giao dịch của A commit
- **THEN** instance B tải lại nhóm chính sách và trả giá trị mới

#### Scenario: Tính lương sau khi đổi tham số
- **WHEN** KT đổi mức lương tối thiểu vùng hiệu lực từ một ngày rồi chạy bảng lương
- **THEN** bảng lương dùng mức mới cho các ngày từ ngày hiệu lực và mức cũ cho các ngày trước đó

### Requirement: Không cache dữ liệu nhạy cảm
Hệ thống SHALL NOT lưu vào cache dùng chung dữ liệu nhân sự, hợp đồng, lương, chấm công, OT, phiếu lương, phiên đăng nhập hoặc kết quả báo cáo, và mọi phản hồi API SHALL giữ `Cache-Control: no-store`.

#### Scenario: Phản hồi API
- **WHEN** bất kỳ endpoint `/api` nào trả kết quả
- **THEN** phản hồi có `Cache-Control: no-store`

#### Scenario: Thu hồi phiên
- **WHEN** Admin thu hồi phiên hoặc khóa một tài khoản
- **THEN** request kế tiếp của phiên đó bị từ chối

### Requirement: Tắt cache dùng chung bằng cấu hình
Hệ thống SHALL cho phép tắt cache dùng chung bằng `CACHE_REFERENCE_ENABLED=false` mà mọi kết quả nghiệp vụ không đổi.

#### Scenario: Bộ kiểm thử với cache tắt và bật
- **WHEN** chạy toàn bộ kiểm thử nghiệp vụ với cache dùng chung tắt rồi bật
- **THEN** cả hai lần đều đạt như nhau

### Requirement: Chỉ số cache
Hệ thống SHALL ghi log có cấu trúc số lần trúng, trượt và tải lại theo nhóm, và ở chế độ đo SHALL ghi số truy vấn CSDL cùng thời gian theo route.

#### Scenario: Chế độ đo
- **WHEN** bật `QUERY_METRICS=true` và gọi một route đọc nhiều
- **THEN** log có số truy vấn, tổng thời gian truy vấn và tỷ lệ trúng cache của request
