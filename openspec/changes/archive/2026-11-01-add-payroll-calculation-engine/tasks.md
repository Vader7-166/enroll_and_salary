## 1. Dữ liệu

- [x] 1.1 Migration `payroll_run` (kỳ, cơ sở, trạng thái, tiến độ, cancel flag, source hash, param snapshot hash, version set), `payroll_run_error`
- [x] 1.2 Migration `payroll_sheet`, `payroll_employee` (net pay và lương đóng BH mã hóa), `payroll_line` (line type, quantity, rate, amount, param code, calculation trace, source reference), `payroll_line_input`
- [x] 1.3 Migration `compliance_check_result` (run/sheet, mã CP, mức, số vi phạm, chi tiết, xác nhận)
- [x] 1.4 Tham số `PAYROLL_VARIANCE_THRESHOLD`, `DEDUCTION_MAX_NET_RATIO` trong seed mô phỏng

## 2. Nạp nguồn và đoạn

- [x] 2.1 Loader nạp theo lô: snapshot công khóa, bucket OT LOCKED, phương án, đơn giá/công thức theo ngày, đầu vào CONFIRMED, timeline lương, đơn vị, mức BH, ruleset thuế; tính `source_hash`
- [x] 2.2 Kiểm tra kỳ công nguồn LOCKED (`PERIOD_NOT_LOCKED`)
- [x] 2.3 Cắt đoạn theo lương, đơn vị/vùng, phương án, đơn giá, vào/nghỉ việc

## 3. Pipeline stage

- [x] 3.1 Stage kiểm tra đầu vào (MISSING/CONFIRMED_ZERO/NOT_APPLICABLE, xung đột phương án, cộng trùng)
- [x] 3.2 Stage lương theo phương án cho thời gian/sản phẩm/khoán/hoa hồng/3P qua `formula-engine`
- [x] 3.3 Stage đơn giá giờ OT (BR-15) và tiền OT qua `otPay()`; stage phụ cấp ca đêm
- [x] 3.4 Stage phụ cấp/khoản cộng thêm và registry cắm stage thưởng/phúc lợi/hồi tố
- [x] 3.5 Stage BH qua bộ tính BH, ghi `insurance_contribution` nháp
- [x] 3.6 Stage phân loại khoản thu nhập + bộ tính thuế, ghi `tax_withholding` nháp theo ngày chi dự kiến
- [x] 3.7 Stage khấu trừ khác (trần 30% NET), điều chỉnh, thực lĩnh, làm tròn theo chính sách
- [x] 3.8 Unit test `backend/test/payroll-engine.test.cjs`: FIX-01…09, TC-I01…I12, TC-P01/01b/01c/02/05/06/07

## 4. Cổng tuân thủ và drill-down

- [x] 4.1 Kiểm tra CP-01…CP-09 và lưu kết quả; xác nhận CP-08 theo nhân viên
- [x] 4.2 API drill-down đọc vết, liên kết công gốc và lượt quẹt; kiểm tra quyền

## 5. Chạy lô, API, giao diện

- [x] 5.1 Batch runner theo lô đơn vị, tiến độ, dừng an toàn, cô lập lỗi, chạy lại một phần
- [x] 5.2 API `/api/payroll/runs`, `/api/payroll/sheets/:id`, `/api/payroll/lines/:id/trace`, `/api/payroll/sheets/:id/compliance`
- [x] 5.3 Integration test `backend/test/payroll-run.test.cjs` (quyền, idempotent, lỗi cô lập, PERIOD_NOT_LOCKED); script `verify:payroll`
- [x] 5.4 Benchmark 3.000 nhân viên mô phỏng, ghi kết quả đo (NFR-07)
- [x] 5.5 Khu "Bảng lương": chạy tính, tiến độ, bảng nháp, lỗi, cổng CP, drill-down
- [x] 5.6 Cập nhật README, docs/20 và docs/09 (trạng thái đã triển khai)
