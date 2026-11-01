## 1. Khung báo cáo

- [x] 1.1 Migration `report_run` (loại, phạm vi, kỳ, data status, người/thời điểm, định dạng, tệp, trạng thái) và index phục vụ báo cáo
- [x] 1.2 Registry `ReportDefinition`, kiểm tra quyền/phạm vi/exclusion, che cột, nhãn Nháp/Chính thức
- [x] 1.3 Nguồn theo trạng thái kỳ (snapshot khi LOCKED), cây tổ chức theo kỳ
- [x] 1.4 Renderer Excel (`exceljs`) và PDF, tiêu đề nguồn/kỳ/người xuất, chạy nền, ngưỡng số bản ghi, audit
- [x] 1.5 Integration test UAT-14, UAT-22, in lại kỳ khóa khớp số; script `verify:reports`

## 2. Báo cáo công và nhân sự

- [x] 2.1 Bảng chấm công tháng theo mẫu (FR-4.5.5)
- [x] 2.2 OT theo tổ/xưởng so trần, lũy kế OT, đi muộn/về sớm, ngoại lệ chưa xử lý, giờ làm theo tuần
- [x] 2.3 Biến động nhân sự và tỷ lệ nghỉ việc (QĐ)
- [x] 2.4 Sổ quản lý lao động 20 tiêu chí và cảnh báo OT 200/300 giờ

## 3. Báo cáo lương, BH, thuế

- [x] 3.1 Bảng thanh toán tiền lương (drill-down) và tiền thưởng
- [x] 3.2 Quỹ lương theo cơ sở/đơn vị, phân bổ chi phí cost center TK 622/642
- [x] 3.3 Bảng trích BH, danh sách tăng/giảm, đối chiếu C12
- [x] 3.4 Bảng thuế khấu trừ, tổng hợp quyết toán, sử dụng lao động, OT 200–300 giờ/năm
- [x] 3.5 Đo báo cáo tháng toàn công ty 3.000 nhân sự (NFR-12)

## 4. Giao diện và tài liệu

- [x] 4.1 Khu "Báo cáo": danh mục theo quyền, tham số, xem trước, kết xuất, lịch sử kết xuất
- [x] 4.2 Cập nhật README và docs/20
