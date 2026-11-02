## Why

Bảng đối chiếu FR (`docs/acceptance/fr-coverage.md`, change `add-r1-acceptance-hardening` task 1.1) và benchmark ban đêm cho thấy còn bốn khoảng trống trước nghiệm thu R1:

- **FR-1.4.2** (PARTIAL): đã có ngân hàng, chức danh/ngạch, loại hợp đồng, khoản lương; **chưa có danh mục địa bàn và trình độ** quản trị được.
- **FR-2.1.3** (PARTIAL): dữ liệu tuyển dụng, hợp đồng thử việc/chính thức, điều chuyển, quyết định lương và chấm dứt đã có nhưng **chưa có quá trình công tác hợp nhất** theo thời gian.
- **FR-X.3** (PARTIAL): bản ghi nghiệp vụ không có API xóa cứng, nhưng một số dòng nháp/phụ vẫn xóa vật lý khi dựng lại; **chưa có danh sách ngoại lệ chính thức và kiểm tra tự động**.
- **NFR-13**: kiểm tra tệp 10.000 dòng trả kết quả trong 1,4 s, nhưng **nhập + ghép đầy đủ mất 81 s** (> 60 s) trên máy đo (i5-12450H, PostgreSQL 18).

## What Changes

- Danh mục **địa bàn** (tỉnh/thành, phường/xã theo mã hành chính, có hiệu lực) và **trình độ** (mã, tên, thứ tự, trạng thái); AD quản trị, có audit; hồ sơ nhân viên tham chiếu mã danh mục thay vì văn bản tự do.
- API và tab **Quá trình công tác**: dòng thời gian hợp nhất tuyển dụng → thử việc → chính thức → điều chuyển → thay đổi lương → nghỉ việc, tạo từ dữ liệu nguồn hiện có (không bảng ghi đè), tôn trọng phạm vi/loại trừ và che lương theo quyền.
- **Chính sách xóa mềm**: danh sách bảng được phép xóa vật lý (dòng nháp dựng lại, phiên đăng nhập, thông báo quá hạn lưu) có lý do; mọi bảng nghiệp vụ khác chặn DELETE bằng trigger hoặc có `deleted_at` + `delete_reason`; luật lint `hard-delete` quét `.delete(`/`.deleteMany(` ngoài danh sách.
- **Thông lượng nhập công**: chèn bản ghi thô theo lô, ghép theo nhóm nhân viên/ngày công trong một giao dịch ngắn, hoặc trả kết quả kiểm tra ngay và ghép nền có trạng thái tiến độ; mục tiêu tệp 10.000 dòng ≤ 60 s end-to-end trên máy đo chuẩn.

## Capabilities

### New Capabilities
- `shared-catalogs`: danh mục địa bàn và trình độ có hiệu lực.
- `employment-history`: quá trình công tác hợp nhất của nhân viên.
- `soft-delete-policy`: chính sách xóa mềm và ngoại lệ được phép.
- `attendance-import-throughput`: ngưỡng thông lượng nhập tệp chấm công.

### Modified Capabilities
<!-- Không sửa spec đã lưu trữ. -->

## Impact

- **Backend:** migration danh mục + khóa ngoại từ hồ sơ; module `employees` (timeline); trigger chặn DELETE cho bảng nghiệp vụ còn thiếu; `attendance` import theo lô.
- **Frontend:** màn hình danh mục trong Thiết lập; tab Quá trình công tác trong hồ sơ.
- **Kiểm thử:** test tích hợp mới cho từng mục; `benchmark:attendance` phải đạt NFR-13 trước khi đánh dấu task hiệu năng xong.
- **Không** đổi định dạng tệp chấm công, không đổi kết quả ghép đã có (so khớp bằng bộ test chấm công hiện tại).
