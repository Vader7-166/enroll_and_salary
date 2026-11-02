## Why

Đo trên CSDL cô lập (1.100 nhân viên một cơ sở, lịch ca đã duyệt cho hai kỳ = 67.100 lịch), mỗi lần nhập tệp chấm công mất **131 s**, vượt timeout giao dịch 90 s nên bị hủy; dữ liệu lịch sử của Bắc Ninh, Hà Nam, Trụ sở không nhập được. Bốn nguyên nhân: tra lịch ca O(n²) (61 s), tra tham số ghép công 3 truy vấn × 5 tham số × mỗi đơn vị–ngày (≈ 3.660 truy vấn, 13–18 s), ghi lại mọi ngày công không đổi qua trigger theo dòng (36–80 s) và tải lịch ca của mọi cơ sở. Bản vá ngay (Map, cache tham số theo phạm vi giao dịch, ghi theo diff, lọc theo cơ sở) đưa về **35 s / 57 s**, nhưng cùng kiểu truy vấn lặp còn ở nhiều nơi khác: `ScopeService.load` được gọi ở 78 chỗ và mỗi lần tải toàn bộ `org_unit_version` + vai trò; `resolveLegalParameter` dùng ở 5 module; mỗi request đọc lại phiên đăng nhập. Cần một cách cache **thống nhất, đúng tuyệt đối với dữ liệu ảnh hưởng lương** thay cho các bản vá rời rạc.

## What Changes

- **Cache theo phạm vi request/giao dịch** (không bao giờ cũ): memo `ScopeService.load(user, permission, asOf)` và tra tham số pháp lý/chính sách cơ sở trong suốt một request hoặc giao dịch, dùng chung một tiện ích thay cho các `Map` tự viết trong từng service (`attendance`, `team-confirmation`, `period-lock`).
- **Cache dữ liệu tham chiếu dùng chung giữa các request** cho dữ liệu đọc nhiều – ghi hiếm: cây tổ chức theo phiên bản, quyền của vai trò, tham số pháp lý và chính sách cơ sở, danh mục ca. Mỗi nhóm có **số phiên bản trong PostgreSQL** do trigger tăng khi ghi; cache chỉ dùng khi phiên bản khớp, nên đúng cả khi chạy nhiều instance backend và không cần Redis.
- **Không cache** dữ liệu nhân sự, lương, chấm công, kỳ công đang mở/đã khóa ở tầng chia sẻ; giữ `Cache-Control: no-store` cho mọi phản hồi API.
- **Benchmark và chỉ số**: `scripts/benchmark-attendance-month.cjs` (lịch ca cả kỳ) vào benchmark ban đêm; đếm truy vấn mỗi request ở chế độ đo; tỷ lệ trúng cache ghi log có cấu trúc.
- Chuẩn hóa bản vá hiệu năng nhập công hiện tại (cache tham số theo giao dịch, ghi ngày công/OT thực tế theo diff) thành yêu cầu có kiểm thử.

## Capabilities

### New Capabilities
- `request-scoped-cache`: memo theo request/giao dịch cho phạm vi dữ liệu và tra tham số, không có độ trễ cập nhật.
- `reference-data-cache`: cache dữ liệu tham chiếu dùng chung, vô hiệu hóa bằng số phiên bản trong CSDL, an toàn khi nhiều instance.
- `attendance-processing-performance`: ngưỡng thời gian xử lý nhập công khi lịch ca đã duyệt cả kỳ và yêu cầu chỉ ghi ngày công/OT thực tế thay đổi.

### Modified Capabilities
<!-- Không đổi hành vi nghiệp vụ của spec đã lưu trữ; ngưỡng NFR-13 nằm trong change add-r1-gap-closure. -->

## Impact

- **Backend:** tiện ích cache mới (`backend/src/common/cache`), `ScopeService`, `SettingsService` (tham số pháp lý, chính sách cơ sở), `AuthService` (quyền vai trò), `AttendanceService`/`TeamConfirmationService`/`PeriodLockService` (bỏ cache tự viết), các service ghi tổ chức/tham số/ca (không đổi API).
- **CSDL:** migration bảng `cache_version` + trigger tăng phiên bản trên `org_unit_version`, `org_unit`, `role`, `legal_parameter`, `site_policy`, `site`, `shift_definition`.
- **Vận hành:** không thêm dịch vụ (không Redis); thêm biến `CACHE_REFERENCE_ENABLED` để tắt nhanh; benchmark ban đêm thêm kịch bản lịch ca cả kỳ.
- **Frontend / API:** không đổi; phản hồi API vẫn `no-store`.
