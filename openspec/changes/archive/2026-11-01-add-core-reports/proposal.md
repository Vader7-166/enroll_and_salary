## Why

Báo cáo lõi 10.x thuộc R1 và là nhóm nghiệm thu R1-AC-10 riêng, nhưng hiện chưa có báo cáo kết xuất nào: công/OT theo tổ và xưởng, giờ làm tuần, biến động nhân sự, quỹ lương và phân bổ chi phí theo cost center, báo cáo BH/thuế/sử dụng lao động (FR-10.0.1…10.4.1). Sổ quản lý lao động 20 tiêu chí (FR-2.1.5, 2.1.7) và bảng chấm công tháng theo mẫu (FR-4.5.5) cũng là đầu ra pháp lý bắt buộc.

## What Changes

- **Khung báo cáo chung**: kiểm tra quyền vai trò/phạm vi trước truy vấn và trước kết xuất; nhãn Nháp/Chính thức; kỳ khóa đọc snapshot; cây tổ chức theo kỳ báo cáo; che trường nhạy cảm cả trong tệp; ghi audit mỗi lần kết xuất có lương/dữ liệu cá nhân; tiêu đề ghi nguồn, kỳ, thời điểm, người xuất; cảnh báo khi vượt ngưỡng bản ghi; xuất Excel/PDF; lưu `report_run`.
- **10.1 (TT/QĐ)**: bảng chấm công tháng theo mẫu (ký hiệu từng ngày, tổng công, OT ngày/đêm theo loại ngày, trạng thái); OT theo tổ/xưởng so trần; lũy kế OT tháng/năm và số giờ còn huy động; đi muộn/về sớm (ghi rõ không dùng trừ lương); ngoại lệ chưa xử lý; giờ làm theo tuần (ghi rõ không phải chứng nhận SMETA/BSCI/RBA).
- **10.2 (QĐ)**: biến động vào làm/nghỉ việc/điều chuyển của xưởng; tỷ lệ nghỉ việc theo bộ phận, thâm niên, loại HĐ.
- **10.3 (KT)**: bảng thanh toán tiền lương (có drill-down), bảng thanh toán tiền thưởng, quỹ lương theo cơ sở/đơn vị, bảng phân bổ chi phí theo cost center và TK 622/642 gồm BH phần DN và KPCĐ (xuất tệp, không đẩy ERP).
- **10.4 (KT)**: bảng trích BH, danh sách tăng/giảm, đối chiếu C12, bảng thuế khấu trừ (ngày chi, kỳ thuế, nhánh, bộ quy tắc, miễn/chịu theo khoản, dự kiến/thực tế), tổng hợp quyết toán, tình hình sử dụng lao động, số liệu OT 200–300 giờ/năm.
- **Sổ quản lý lao động** 20 tiêu chí theo NĐ 145/2020, cảnh báo OT lũy kế năm vượt 200/300 giờ.

## Capabilities

### New Capabilities
- `report-framework`: quyền, nhãn trạng thái, snapshot, cây tổ chức theo kỳ, che trường, audit, Excel/PDF và lưu lần kết xuất.
- `attendance-workforce-reports`: báo cáo 10.1, 10.2, bảng chấm công tháng và sổ quản lý lao động.
- `payroll-tax-insurance-reports`: báo cáo 10.3 và 10.4.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** module mới `backend/src/reports/` (registry báo cáo, query, renderer Excel/PDF); đọc dữ liệu các phân hệ 2, 4, 5, 6, 7, 8, 9.
- **Database:** `report_run`; view/truy vấn tổng hợp; index phục vụ báo cáo.
- **API:** `/api/reports` (danh mục theo quyền), `/api/reports/:type/preview`, `/api/reports/:type/export`.
- **Frontend:** khu "Báo cáo" theo vai trò.
- **Phụ thuộc:** báo cáo 10.1/10.2 và sổ lao động làm được ngay; 10.3/10.4 cần các change lương, BH, thuế, quyết toán.
