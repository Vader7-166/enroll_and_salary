## Why

R1 phải quản lý thưởng tháng/quý/năm/KPI/lễ Tết/thâm niên/đột xuất (FR-7.3.1) và xử lý quyết định hiệu lực quá khứ ảnh hưởng kỳ lương đã khóa bằng bút toán truy lĩnh/truy thu vào kỳ đang mở (FR-7.4.1, 7.4.2, BR-42, UAT-11, TC-P09). `add-salary-change-decisions` đã tạo ứng viên hồi tố; cần phần tính chênh lệch và ghi bút toán. Điểm chuyên cần chỉ được ảnh hưởng thưởng, không trừ lương (FR-7.2.6, BR-45).

## What Changes

- **Thưởng**: KT tạo đợt thưởng (loại, căn cứ/quyết định, kỳ hưởng, kỳ chi, đối tượng nhân viên hoặc đơn vị, số tiền hoặc công thức như mục tiêu × tỷ lệ KPI/điểm chuyên cần); chỉ tính khi kỳ lương có chi thưởng; tính **trước** tổng hợp thu nhập; thuế theo tháng chi trả. Chống trùng với P3 của phương án khi dùng chung nguồn mà không có quyết định độc lập (TC-I07).
- **Hồi tố**: từ ứng viên hồi tố, tính lại từng kỳ đã khóa bị ảnh hưởng bằng công, OT, tham số lương/BH của **kỳ gốc**, so với snapshot kỳ gốc để ra chênh lệch lương, BH, thuế; thuế khoản chi bổ sung theo thời điểm chi trả, tách khỏi sửa sai thuế đã khai.
- **Bảng chênh lệch** theo kỳ gốc để KT xem; KT xác nhận → ghi `payroll_adjustment` (RETRO_PAY/RETRO_DEDUCT) vào kỳ lương đang mở; không xác nhận → hủy kết quả, không đổi dữ liệu. Kỳ đã khóa giữ nguyên.
- Stage engine "thưởng" (bước 4) và "điều chỉnh" (bước 10) đọc thưởng đã xác nhận và bút toán đã xác nhận.

## Capabilities

### New Capabilities
- `payroll-bonuses`: đợt thưởng, điều kiện chi trong kỳ, công thức thưởng, điểm chuyên cần và chống trùng với P3.
- `payroll-retro-adjustments`: tính chênh lệch hồi tố theo kỳ gốc, bảng chênh lệch, xác nhận và ghi bút toán vào kỳ đang mở.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** `backend/src/payroll/bonus/`, `backend/src/payroll/retro/`; stage mới đăng ký vào registry của engine.
- **Database:** `bonus_plan`, `bonus_allocation`, `payroll_adjustment`, `retro_calculation`.
- **API:** `/api/payroll/bonuses`, `/api/payroll/retro-candidates/:id/calculate`, `/api/payroll/adjustments/:id/confirm`.
- **Phụ thuộc:** `add-payroll-approval-and-lock` (snapshot kỳ gốc), `add-salary-change-decisions` (ứng viên hồi tố).
