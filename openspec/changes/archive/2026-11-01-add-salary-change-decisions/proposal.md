## Why

Lương hiện chỉ nằm trong hợp đồng/phụ lục mã hóa; chưa có quyết định thay đổi lương có ngày hiệu lực để engine tách đoạn đơn giá giữa kỳ (FR-2.3.1, BR-40, TC-P02), chưa phát hiện quyết định hiệu lực quá khứ ảnh hưởng kỳ lương đã khóa (FR-2.3.3) và chưa cảnh báo điều chuyển liên vùng kèm giảm lương (FR-2.3.4, BR-08, TC-P08). Engine lương cần một nguồn lương theo hiệu lực duy nhất.

## What Changes

- Thêm **quyết định thay đổi lương** (`salary_decision`) có số/ngày quyết định, ngày hiệu lực, lý do, căn cứ; mỗi quyết định sinh các dòng **lương theo cấu phần có hiệu lực** (`employee_salary`) mã hóa số tiền.
- Truy vấn **dòng thời gian lương** của nhân viên trong khoảng ngày, trả các đoạn đơn giá không chồng; nguồn khởi tạo lấy từ hợp đồng/phụ lục đang hiệu lực.
- **Phân bổ theo đơn vị** khi nhân viên thuộc nhiều đơn vị trong kỳ (FR-2.3.2): trả các đoạn đơn vị/cost center với số ngày để phân bổ theo tỷ lệ ngày công.
- **Cảnh báo hồi tố**: quyết định có ngày hiệu lực rơi vào kỳ lương đã khóa sinh `retro_candidate` liệt kê kỳ bị ảnh hưởng, chờ xử lý ở 7.4.
- **Cảnh báo BR-08**: điều chuyển sang cơ sở vùng thấp hơn kèm giảm lương bị cảnh báo, yêu cầu xác nhận có lý do.
- Màn hình KT lập/xem quyết định và dòng thời gian lương.

## Capabilities

### New Capabilities
- `salary-change-decisions`: quyết định thay đổi lương có hiệu lực, dòng thời gian lương theo đoạn, phân bổ đơn vị trong kỳ, phát hiện hồi tố và cảnh báo giảm lương liên vùng.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** mở rộng `backend/src/personnel/` (quyết định lương cạnh điều chuyển); helper mã hóa dùng chung.
- **Database:** bảng `salary_decision`, `employee_salary`, `retro_candidate`.
- **API:** `/api/personnel/:employeeId/salary-decisions`, `/api/personnel/:employeeId/salary-timeline`, `/api/personnel/retro-candidates`.
- **Frontend:** mục "Quyết định lương" trong chi tiết nhân viên.
- **Phụ thuộc:** dùng cấu phần lương đã có; cung cấp dữ liệu cho `add-payroll-calculation-engine` và `add-bonus-and-retroactive-adjustments`.
