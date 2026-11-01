## Why

R1 yêu cầu cảnh báo hợp đồng sắp/đã hết hạn, hết thử việc và đã ký đủ 2 lần HĐ xác định thời hạn (FR-2.4.1, 2.4.2, BR-58), và quy trình chấm dứt HĐ liên phân hệ: tính trợ cấp thôi việc/mất việc (FR-9.3.1), tiền phép chưa nghỉ (FR-6.2.3, BR-36), danh sách báo giảm BH (8.3), chỉ đổi dữ liệu khi KT xác nhận (FR-2.5.1, 2.5.2, BR-59, UAT-27, SQ-09). Hiện chưa có.

## What Changes

- **Danh sách cảnh báo hợp đồng** trong phạm vi KT: hết hạn trong 30/60 ngày (tham số), đã quá hạn, hết hạn thử việc, đã ký đủ 2 HĐ xác định thời hạn; hiển thị số ngày còn lại; không tự chấm dứt.
- **Quyết định chấm dứt** DRAFT: nhân viên, ngày hiệu lực, lý do (phân loại thôi việc/mất việc/khác), căn cứ. Khi lập, hệ thống tính xem trước: HĐ hiệu lực, thâm niên, trợ cấp thôi việc hoặc mất việc, số ngày phép chưa nghỉ và tiền thanh toán, danh sách báo giảm BH. Chưa xác nhận → không đổi dữ liệu nào.
- **Xác nhận chấm dứt** (xác thực lại): cập nhật trạng thái HĐ và ngày nghỉ việc, tạo khoản trợ cấp và tiền phép vào kỳ lương mở gần nhất **một lần duy nhất**, ghi audit. Hủy quyết định DRAFT không để lại dấu vết dữ liệu nghiệp vụ.
- **Trợ cấp** tính theo tham số có căn cứ (BLLĐ 2019 Điều 46, 47): tháng lương mỗi năm, mức tối thiểu cho mất việc, lương bình quân 6 tháng theo HĐ, thời gian làm việc trừ thời gian tham gia BHTN và thời gian đã được chi trả; hiển thị trong chi phí phúc lợi 9.4.

## Capabilities

### New Capabilities
- `contract-expiry-alerts`: cảnh báo HĐ hết hạn, quá hạn, hết thử việc, đủ 2 lần HĐ xác định thời hạn.
- `contract-termination`: quyết định chấm dứt nháp/xác nhận, trợ cấp thôi việc/mất việc, tiền phép chưa nghỉ, báo giảm BH và đưa khoản vào kỳ lương một lần.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** mở rộng `backend/src/personnel/` (alerts, termination); dùng `leave-funds` (số dư phép), bộ sinh biến động BH, timeline lương; stage engine đọc khoản chấm dứt.
- **Database:** `termination_decision`, `severance_allowance`, `termination_payment_item`; tham số `CONTRACT_EXPIRY_WARNING_DAYS`, `SEVERANCE_MONTHS_PER_YEAR`, `JOB_LOSS_MONTHS_PER_YEAR`, `JOB_LOSS_MIN_MONTHS`, `SEVERANCE_SALARY_AVERAGE_MONTHS`.
- **API:** `/api/personnel/contract-alerts`, `/api/personnel/terminations`.
- **Phụ thuộc:** `add-payroll-calculation-engine` (khoản vào kỳ lương), `add-insurance-change-reporting` (báo giảm), `add-salary-change-decisions` (lương bình quân).
