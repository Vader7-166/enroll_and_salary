## Why

KT phải lập danh sách báo tăng/giảm/điều chỉnh mức đóng BH hằng tháng từ biến động nhân sự để kê khai ngoài hệ thống, theo dõi truy thu/thoái thu khi báo muộn, và đối chiếu với thông báo kết quả đóng C12 của cơ quan BHXH (FR-8.3.1…8.3.3, BR-51; được đưa vào M vì US-21). Hiện chưa có chức năng nào.

## What Changes

- **Sinh danh sách biến động BH theo tháng** từ dữ liệu nguồn: vào làm/HĐ đủ điều kiện (tăng), nghỉ việc/chấm dứt HĐ, nghỉ không lương ≥ 14 ngày, thai sản (giảm), thay đổi lương đóng BH (điều chỉnh). Mỗi dòng có lý do, ngày hiệu lực, mức cũ/mới và nguồn.
- **Chốt danh sách** theo tháng để kê khai; xuất tệp Excel theo mẫu cấu hình; dòng đã chốt bất biến, phát sinh muộn sang tháng sau.
- **Theo dõi truy thu/thoái thu**: biến động có hiệu lực ở tháng đã chốt được ghi là báo muộn, tính số tháng và số tiền truy thu/thoái thu theo mức đóng của các tháng gốc.
- **Đối chiếu C12**: KT nhập tệp C12 (Excel/CSV theo mẫu ánh xạ cột), hệ thống so theo nhân sự với số đóng đã tính trong bảng lương khóa, liệt kê chênh lệch và phân loại.

## Capabilities

### New Capabilities
- `insurance-change-reporting`: sinh/chốt danh sách tăng-giảm-điều chỉnh BH, xuất tệp, theo dõi truy thu/thoái thu và đối chiếu C12.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** `backend/src/social-insurance/changes/`, `backend/src/social-insurance/c12/`.
- **Database:** `insurance_change_list`, `insurance_change_item`, `insurance_arrears`, `c12_import`, `c12_difference`.
- **API:** `/api/social-insurance/change-lists`, `/api/social-insurance/c12-imports`.
- **Phụ thuộc:** `add-social-insurance-calculation` (diện, mức đóng), `add-payroll-approval-and-lock` (số đóng đã khóa để đối chiếu C12). Được `add-contract-alerts-and-termination` dùng để xem trước danh sách báo giảm.
