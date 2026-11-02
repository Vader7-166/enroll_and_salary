## ADDED Requirements

### Requirement: Duyệt bảng lương
Hệ thống SHALL cho KT trong phạm vi duyệt bảng lương DRAFT thành APPROVED khi không còn vi phạm BLOCKING, không còn nhân viên lỗi và mọi cảnh báo CP-08 đã được xác nhận; mỗi lần duyệt MUST ghi người, thời điểm, tổng quỹ và hash nguồn.

#### Scenario: Đủ điều kiện
- **WHEN** bảng lương không còn BLOCKING và CP-08 đã xác nhận hết
- **THEN** bảng chuyển APPROVED và lịch sử ghi người duyệt, tổng tiền, hash nguồn

#### Scenario: Còn nhân viên lỗi
- **WHEN** bảng có nhân viên ở trạng thái lỗi `PAYROLL_INPUT_MISSING`
- **THEN** duyệt bị từ chối và liệt kê nhân viên lỗi

### Requirement: Về nháp khi nguồn thay đổi
Khi bất kỳ nguồn nào của bảng lương APPROVED thay đổi trước khi khóa, hệ thống SHALL đưa bảng về DRAFT, ghi audit nguồn thay đổi và yêu cầu tính lại và duyệt lại.

#### Scenario: Sửa phụ cấp sau duyệt (UAT-10)
- **WHEN** KT đã duyệt bảng lương rồi sửa một khoản phụ cấp đầu vào
- **THEN** bảng lương về Nháp, phải duyệt lại và nhật ký ghi thay đổi

#### Scenario: Lưới an toàn bằng hash
- **WHEN** nguồn đổi nhưng không phát sự kiện và KT bấm khóa
- **THEN** hệ thống phát hiện hash nguồn khác, đưa bảng về DRAFT và từ chối khóa

### Requirement: Khóa kỳ lương nguyên tử
Hệ thống SHALL cho KT khóa bảng lương APPROVED sau khi xác thực lại, kiểm tra lại trong cùng giao dịch: revision khớp, mọi kỳ công nguồn LOCKED, hash nguồn khớp lúc duyệt, kỳ lương trước cùng cơ sở đã khóa (trừ kỳ khởi tạo). Khóa MUST ghi snapshot kèm hash, chuyển kỳ lương sang LOCKED và ghi audit; kỳ đã khóa MUST NOT bị sửa hoặc mở khóa lại.

#### Scenario: Kỳ trước chưa khóa
- **WHEN** KT khóa kỳ 10 khi kỳ 09 cùng cơ sở đã tồn tại nhưng chưa khóa
- **THEN** hệ thống trả `PREV_PERIOD_NOT_LOCKED`

#### Scenario: Thiếu xác thực lại
- **WHEN** KT gửi lệnh khóa không kèm token xác thực lại còn hạn
- **THEN** hệ thống từ chối và yêu cầu nhập lại mật khẩu

#### Scenario: Sửa sau khóa
- **WHEN** có lệnh cập nhật dòng lương thuộc bảng đã khóa
- **THEN** cơ sở dữ liệu từ chối thay đổi và snapshot giữ nguyên hash

### Requirement: Cảnh báo hạn chi lương
Hệ thống SHALL cảnh báo KT khi kỳ lương còn số ngày đến ngày chi dự kiến không quá ngưỡng cấu hình mà bảng lương chưa khóa.

#### Scenario: Sắp đến hạn
- **WHEN** còn 2 ngày đến ngày chi dự kiến, ngưỡng 3 ngày, bảng chưa khóa
- **THEN** danh sách kỳ lương hiển thị cảnh báo kèm số ngày còn lại

### Requirement: Báo cáo bằng chứng tuân thủ
Khi khóa, hệ thống SHALL lưu kết quả CP-01…CP-09 cùng snapshot và cho KT xuất PDF gồm thời điểm khóa, người khóa, hash snapshot, kết quả và số vi phạm từng mã, và các tham số pháp lý đã áp dụng, dựng từ snapshot.

#### Scenario: Xuất bằng chứng (UAT-20)
- **WHEN** KT khóa kỳ lương 09/2026 rồi xuất báo cáo tuân thủ
- **THEN** PDF liệt kê đủ chín mã với kết quả, CP-08 hiển thị số cảnh báo đã xác nhận, và mã băm khớp snapshot
