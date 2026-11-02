## Context

Có sẵn: `PayrollPeriod` (site, khoảng ngày, ngày chi dự kiến, OPEN/LOCKED) và lô đầu vào CONFIRMED đọc qua `/api/payroll-inputs/confirmed`; `formula-engine.ts` (biểu thức giới hạn, đồ thị tô-pô, Decimal, làm tròn theo phiên bản); phương án lương nhân viên với dòng BASE/ADDITIONAL/NOT_APPLICABLE và nguồn; khóa kỳ công có snapshot + hash. Các change trước cung cấp bucket OT, timeline lương, bộ tính BH, bộ tính thuế. Docs 09 §8 đã định nghĩa các bảng bảng lương.

## Goals / Non-Goals

**Goals:**
- Kết quả đúng FIX-01…09 và các TC lương; idempotent tuyệt đối.
- Mọi số tiền có vết tới nguồn; drill-down ≤ 3 giây.
- 3.000 nhân viên ≤ 15 phút trên dữ liệu mô phỏng.

**Non-Goals:**
- Không duyệt/khóa bảng lương, phiếu lương, file chi (các change sau).
- Không tính thưởng định kỳ/hồi tố (change 7.3/7.4 thêm stage riêng); engine chỉ chừa điểm cắm.
- Không xây hàng đợi phân tán; worker chạy trong tiến trình NestJS.

## Decisions

1. **Pipeline stage thuần.** Mỗi bước là hàm `(ctx) => ctx'` thuần trên dữ liệu đã nạp (input loader tách riêng). Thứ tự cố định theo 06 §6.2 và khai báo trong mã; stage thưởng/hồi tố/phúc lợi cắm vào bước 4 và 10 bằng registry. Lợi ích: test từng stage bằng fixture, giữ idempotent.
2. **Nạp nguồn một lần cho cả lô.** Loader đọc snapshot công khóa, bucket OT LOCKED, phương án/đơn giá/công thức theo ngày, lô đầu vào CONFIRMED, ruleset thuế, mức BH; cache trong lần chạy (06 §6.3). Hash toàn bộ nguồn đã chuẩn hóa thành `source_hash`; cùng hash ⇒ cùng kết quả.
3. **Đoạn (segment) là đơn vị tính trung gian.** Mỗi nhân viên được cắt thành các đoạn bất biến theo các mốc: timeline lương, đơn vị/vùng, phương án, đơn giá, vào/nghỉ việc. Lương thời gian, CP-01 và phân bổ cost center tính theo đoạn; BH và thuế tính theo tháng/lần chi trên tổng.
4. **Đơn giá giờ OT (BR-15):** tử số = tổng cấu phần `is_ot_base` của đoạn; mẫu số = giờ làm việc bình thường tương ứng từ snapshot công, loại giờ OT và giờ nghỉ lễ hưởng lương; thiếu một trong hai → `PAYROLL_INPUT_MISSING`. Lưu tử/mẫu số trong vết (TC-I10).
5. **Lưu trữ:** `payroll_run` (mỗi lần chạy) → `payroll_sheet` (một bảng nháp hiện hành mỗi kỳ+cơ sở, `calc_count` tăng) → `payroll_employee` → `payroll_line(line_type, quantity, rate, amount, param_code, calculation_trace, source_reference)` → `payroll_line_input`. Tính lại thay thế toàn bộ dòng của nhân viên trong bảng nháp trong một giao dịch theo nhân viên; số tiền nhạy cảm (`net_pay`, lương đóng BH) mã hóa (FR-X.1).
6. **Cô lập lỗi:** lỗi của một nhân viên ghi `payroll_run_error(code, detail)` và đánh dấu nhân viên `ERROR`; nhân viên khác vẫn hoàn tất. Bảng có nhân viên ERROR không được duyệt.
7. **Chạy lô:** worker trong tiến trình xử lý theo lô đơn vị (mặc định 200 NV), cập nhật tiến độ vào `payroll_run`; dừng an toàn bằng cờ `cancel_requested` kiểm tra giữa các lô; chạy lại một phần theo danh sách nhân viên/đơn vị.
8. **Cổng CP:** chạy sau pipeline trên toàn bảng; mỗi mã lưu một dòng `compliance_check_result` với số vi phạm, chi tiết, mức. CP-08 so tổng thu nhập với kỳ trước, ngưỡng là tham số; KT xác nhận từng nhân viên vượt ngưỡng.
9. **Drill-down** đọc `calculation_trace` (biểu thức, giá trị biến, tham số/phiên bản, nguồn) và tham chiếu đến `daily_attendance`/`raw_punch` qua id trong snapshot; không tính lại.

## Risks / Trade-offs

- [Hiệu năng 3.000 NV] → nạp nguồn theo lô bằng truy vấn tập hợp, cache công thức đã biên dịch, ghi `createMany`; benchmark từ sớm (NFR-59).
- [Vết tính phình to] → lưu vết dạng JSON nén theo dòng, chỉ id tham chiếu tới nguồn thay vì sao chép.
- [Nhiều change phụ thuộc chưa xong] → stage nào thiếu nguồn trả lỗi `STAGE_NOT_AVAILABLE` rõ ràng thay vì mặc định 0.

## Migration Plan

Migration thêm các bảng bảng lương. Không đổi dữ liệu nguồn. Kỳ lương cũ chưa có bảng lương vẫn hoạt động như nhận đầu vào.

## Open Questions

- Ngưỡng CP-08 mặc định cho dữ liệu mô phỏng (ví dụ ±20% tổng thu nhập)? Đặt tham số `PAYROLL_VARIANCE_THRESHOLD` có nhãn SIMULATION.

> Đã chốt khi triển khai: `PAYROLL_VARIANCE_THRESHOLD` = 0,2 (SIMULATION); dòng TIME/ALLOWANCE của phương án không có nguồn CONFIRMED được tính từ dòng thời gian lương và công đã khóa; phương án đổi vai trò cấu phần giữa kỳ trả `PAY_PLAN_SEGMENTED`; benchmark 5.4 đo engine thuần, phép đo có DB thuộc change nghiệm thu.
