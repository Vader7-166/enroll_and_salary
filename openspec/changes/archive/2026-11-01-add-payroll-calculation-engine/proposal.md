## Why

Mọi nguồn cho bảng lương đã hoặc sắp có: công khóa có snapshot, giờ OT theo hệ số, phương án lương, đơn giá/công thức theo phiên bản, đầu vào lương CONFIRMED, quyết định lương, bộ tính BH và thuế. Nhưng chưa có engine ghép chúng thành **bảng lương nháp** có vết, cổng tuân thủ và chạy lô (FR-7.2.1…7.2.10; BR-15, 38…46; NFR-03, 07, 14…18, 24). Đây là phần còn thiếu lớn nhất của R1 và chặn phân hệ 7.5, 7.6, 8.3, 8.5, 10.3, 10.4.

## What Changes

- **Lần chạy tính lương** theo kỳ lương + cơ sở: chỉ chạy khi mọi kỳ công nguồn đã LOCKED (`PERIOD_NOT_LOCKED`, TC-K06); lưu `param_snapshot_hash`, tập phiên bản công thức/đơn giá/ruleset và hash nguồn (NFR-18).
- **Pipeline theo 06 §6.2:** kiểm tra đầu vào (MISSING / CONFIRMED_ZERO / NOT_APPLICABLE, chống trùng) → lương theo phương án (thời gian/sản phẩm/khoán/hoa hồng/3P, không cộng trùng) → tiền OT (đơn giá giờ BR-15) → phụ cấp đêm → phụ cấp/thưởng/phúc lợi đã xác nhận → tổng thu nhập → BH → bóc tách miễn thuế → thuế → khấu trừ khác (trần 30% NET) → điều chỉnh → thực lĩnh → làm tròn theo chính sách.
- **Đoạn trong kỳ:** tách theo timeline lương, đơn vị/vùng, phương án và đơn giá (vào/nghỉ giữa tháng, tăng lương giữa kỳ, điều chuyển, hai cơ sở; BR-40).
- **Bảng lương nháp** `payroll_sheet` → `payroll_employee` → `payroll_line` với `calculation_trace`, và `payroll_line_input` liên kết nguồn/version/hash; chạy lại cùng nguồn cho kết quả tuyệt đối giống (TC-P06).
- **Cổng tuân thủ CP-01…CP-09** lưu `compliance_check_result` theo lần chạy; BLOCKING chặn duyệt, CP-08 WARNING cần KT xác nhận (FR-7.2.8, 7.2.10).
- **Drill-down** từng dòng: số tiền → công thức → biến → tham số → công gốc → lượt quẹt (FR-7.2.9, NFR-24, NFR-11 ≤ 3 giây).
- **Chạy lô** chia theo đơn vị, hiển thị tiến độ, dừng an toàn, cô lập lỗi từng nhân viên, chạy lại một phần (NFR-14…17); mục tiêu ≤ 15 phút / 3.000 NV (NFR-07).
- Không cài đặt trừ lương do đi trễ/về sớm/KPI/kỷ luật (FR-7.2.5); điểm chuyên cần chỉ ảnh hưởng thưởng (FR-7.2.6).
- Màn hình KT: chạy tính, theo dõi tiến độ, xem bảng lương nháp, lỗi theo nhân viên, cổng CP và drill-down.

## Capabilities

### New Capabilities
- `payroll-calculation`: lần chạy, pipeline tính lương, đoạn trong kỳ, bảng lương nháp có vết, idempotent và chạy lô.
- `payroll-compliance-gates`: kiểm tra CP-01…CP-09, mức BLOCKING/WARNING và xác nhận cảnh báo.
- `payroll-drilldown`: giải trình từng dòng lương tới nguồn gốc.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** module mới `backend/src/payroll/` (orchestrator, pipeline stages, compliance, drilldown, batch runner); dùng `formula-engine.ts`, `employee-pay-plans`, `payroll-inputs`, `overtime-pay`, `social-insurance`, `personal-income-tax`, `salary-change-decisions`.
- **Database:** `payroll_run`, `payroll_sheet`, `payroll_employee`, `payroll_line`, `payroll_line_input`, `compliance_check_result`, `payroll_run_error`; ghi `insurance_contribution`, `tax_withholding` nháp.
- **API:** `/api/payroll/runs`, `/api/payroll/sheets/:id`, `/api/payroll/lines/:id/trace`, `/api/payroll/sheets/:id/compliance`.
- **Frontend:** khu "Bảng lương" cho KT.
- **Test:** `payroll-engine.test.cjs` (FIX-01…09, TC-I01…I12, TC-P01/01b/01c/02/05/06/07), `payroll-run.test.cjs`, benchmark 3.000 NV.
- **Phụ thuộc:** `add-overtime-pay`, `add-employee-payroll-profile`, `add-salary-change-decisions`, `add-social-insurance-calculation`, `add-personal-income-tax-withholding`.
