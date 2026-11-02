## Context

HRTP là một backend NestJS + Prisma trên PostgreSQL 18, chạy một hoặc nhiều instance sau nginx. Mọi nghiệp vụ ghi dùng giao dịch `Serializable`, nhiều chỗ kèm `pg_advisory_xact_lock`. Dữ liệu tham chiếu (cây tổ chức có phiên bản theo ngày hiệu lực, tham số pháp lý theo vùng/cơ sở/ngày, chính sách cơ sở, quyền vai trò, danh mục ca) được đọc lại từ CSDL ở gần như mọi request:

- `ScopeService.load` (78 chỗ gọi) mỗi lần tải toàn bộ `org_unit_version` hiệu lực tại ngày kèm `org_unit`, `site`, và `role`. Tám service tự viết `Map` để không gọi lại theo ngày trong cùng request.
- `SettingsService.resolveLegalParameter` tốn 3 truy vấn cho mỗi tham số × đơn vị × ngày. Nhập công 1.100 người gọi 244 bộ quy tắc × 5 tham số ≈ 3.660 truy vấn (13–18 s) trước khi có `legalParameterResolver` theo giao dịch.
- Số đo nhập công (lịch ca cả hai kỳ, 67.100 lịch): trước 131 s (hủy do timeout 90 s); sau bản vá 35 s (lần ổn định) / 57 s (lần đầu ghi ~40.000 ngày vắng).

Ràng buộc: dữ liệu ảnh hưởng tiền lương, BHXH, thuế phải đúng theo ngày hiệu lực; kỳ công khóa là bất biến; không được lộ dữ liệu nhân sự qua cache dùng chung hoặc HTTP; vận hành tối giản (Docker Compose, chưa có Redis).

## Goals / Non-Goals

**Goals:**
- Loại truy vấn lặp trong một request/giao dịch mà không có bất kỳ độ trễ cập nhật nào.
- Cache dữ liệu tham chiếu giữa các request, vô hiệu hóa đúng ngay trong giao dịch ghi, đúng khi chạy nhiều instance.
- Có số đo trước/sau và benchmark chặn hồi quy (nhập công với lịch ca cả kỳ, số truy vấn mỗi request).
- Tắt được cache dùng chung bằng cấu hình mà hành vi nghiệp vụ không đổi.

**Non-Goals:**
- Cache dữ liệu nhân sự, hợp đồng, lương, chấm công, OT, phiếu lương, báo cáo.
- Cache phiên đăng nhập: thu hồi phiên, khóa tài khoản, đổi quyền phải có hiệu lực ở request kế tiếp (đã có kiểm thử).
- Cache HTTP/CDN cho API (giữ `Cache-Control: no-store`); cache trình duyệt cho tài nguyên tĩnh đã do nginx xử lý.
- Thêm Redis hoặc dịch vụ cache ngoài.

## Decisions

### 1. Một cơ chế phiên bản cho cả hai phạm vi (đã chỉnh khi triển khai)
- **Phạm vi giao dịch:** `SettingsService.legalParameterResolver` nạp tham số, đơn vị, vùng một lần cho cả giao dịch nhập công rồi tra trong bộ nhớ; hết giao dịch là hết.
- **Dữ liệu tham chiếu dùng chung:** `ReferenceCacheService` trong process, theo **nhóm** (`org`, `roles`, `legal-parameters`, `site-policies`, `shifts`). Mỗi mục lưu **toàn bộ** hàng của nhóm cần cho một khóa (mọi khoảng `effective_from/to`), tính kết quả tại `asOf` trong bộ nhớ, nên khóa ít phụ thuộc ngày.
- Mỗi lần đọc chỉ tốn **một truy vấn nhỏ** đọc phiên bản trong snapshot của caller. Trong cùng giao dịch, một lần ghi bảng nguồn tăng phiên bản ngay (trigger), nên lần đọc sau trong giao dịch tự thấy dữ liệu mới.
- *Bỏ phương án memo theo request bằng `AsyncLocalStorage`:* memo không biết giao dịch đã ghi gì, nên vi phạm yêu cầu "đổi trong giao dịch rồi đọc lại thấy giá trị mới" nếu không tự phát hiện mọi lệnh ghi; truy vấn phiên bản rẻ hơn nhiều so với lợi ích còn lại. Các `Map` theo ngày trong service vẫn giữ (chúng tránh cả truy vấn phiên bản trong vòng lặp lớn).
- *Phương án khác:* chỉ cache theo TTL (có thể trả tham số cũ khi tính lương: không chấp nhận).

### 2. Vô hiệu hóa bằng phiên bản lấy từ sequence PostgreSQL
- Bảng `cache_version(name, version)`; trigger `AFTER … FOR EACH STATEMENT` (cả `TRUNCATE`) trên bảng nguồn đặt `version = nextval('cache_version_seq')` **trong cùng giao dịch ghi**.
- Dùng sequence thay cho bộ đếm `+1`: giá trị của giao dịch bị rollback không bao giờ được cấp lại, nên mục cache dựng trong giao dịch đó không thể trùng một trạng thái đã commit. Mỗi nhóm giữ 4 phiên bản gần nhất; mục mồ côi tự bị đẩy ra.
- Đọc ngoài giao dịch (mỗi câu một snapshot): sau khi nạp, đọc lại phiên bản; chỉ lưu nếu không đổi, để dữ liệu của commit mới không bị lưu dưới phiên bản cũ.
- Đúng với nhiều instance vì nguồn sự thật là CSDL; trong giao dịch `Serializable`, ghi đồng thời làm tăng phiên bản sẽ bị phát hiện xung đột như dữ liệu thường.
- Danh sách bảng nguồn khai báo ở `CACHE_SOURCE_TABLES`; kiểm thử so khớp chính xác với trigger trong CSDL.
- *Phương án khác:* `LISTEN/NOTIFY` (không gắn snapshot, mất thông báo khi rớt kết nối); Redis + khóa phiên bản (thêm dịch vụ, vẫn phải gắn giao dịch); xóa cache trong service ghi (sót seed, migration, SQL tay).

### 3. Điểm dùng cache
- `ScopeService.load`: cây tổ chức tại ngày (`org`, khóa theo `asOf`) và quyền vai trò (`roles`) — 78 chỗ gọi không phải sửa.
- `SettingsService.resolveLegalParameter`: đơn vị–cơ sở, vùng của cơ sở (`org`) và mọi phiên bản của mã tham số (`legal-parameters`).
- `SettingsService.resolvePolicy`: cây cha–con (`org`) và mọi phiên bản của khóa chính sách (`site-policies`).
- Nhóm `shifts` đã có trigger nhưng chưa có điểm đọc nóng; để sẵn cho danh mục ca.
- `CACHE_REFERENCE_ENABLED=false` chạy đúng đường truy vấn cũ.

### 4. Ghi theo diff cho kết quả tính lại
- Xử lý nhập công tính lại mọi lịch ca của kỳ liền kề; chỉ đề xuất ghi dòng `daily_attendance`/`overtime_actual` có nội dung khác (so sánh trong SQL, `IS DISTINCT FROM`, ép kiểu `numeric` đúng scale cột) để không chạy trigger kiểm tra kỳ/phân xưởng theo dòng cho dữ liệu không đổi.
- `processed_at` mang nghĩa "lần gần nhất kết quả thay đổi"; nhãn giao diện "Lần xử lý gần nhất" đổi thành "Kết quả cập nhật lúc".

### 5. Đo lường trước, bật sau
- Chế độ đo (`QUERY_METRICS=true`) dùng Prisma query event để đếm truy vấn và thời gian theo route; log có cấu trúc `cache.hit/miss/reload` theo nhóm.
- Benchmark: `benchmark-attendance-month` (ngưỡng 60 s = 2/3 timeout) vào benchmark ban đêm; thêm benchmark p95 của 5 route đọc nhiều (bảng công, danh sách nhân sự, bảng lương, báo cáo, ngữ cảnh tổ chức) với số truy vấn mỗi request.
- `CACHE_REFERENCE_ENABLED=false` tắt tầng 2 (tầng 1 luôn bật vì không có độ trễ).

## Risks / Trade-offs

- [Trigger tăng phiên bản sót bảng nguồn → cache cũ] → Danh sách nhóm ↔ bảng khai báo một chỗ; kiểm thử sinh tự động: với mỗi bảng nguồn, ghi một dòng rồi khẳng định phiên bản nhóm tăng; lint chặn bảng tham chiếu mới chưa đăng ký.
- [Dữ liệu cache bị sửa đổi do tham chiếu dùng chung] → Đóng băng (`Object.freeze` sâu) giá trị tầng 2; trả về bản sao khi caller cần sửa.
- [Bộ nhớ tăng khi cây tổ chức lớn] → Mỗi nhóm một mục, ước tính < 5 MB với 10.000 phiên bản đơn vị; giới hạn kích thước và log cảnh báo.
- [Đọc `cache_version` trong giao dịch Serializable tăng xung đột khi cấu hình đổi] → Ghi cấu hình hiếm; xung đột trả 409/thử lại như hiện tại; đo số lần thử lại.
- [Ghi theo diff giữ `processed_at` cũ] → Đổi nhãn giao diện; nếu cần thời điểm xử lý gần nhất, lưu ở mức lô nhập (`attendance_import.created_at`).
- [Tầng 1 sai phạm vi giao dịch: dùng kết quả ngoài giao dịch bên trong giao dịch] → Khóa tầng 1 có tiền tố giao dịch; kiểm thử: đổi dữ liệu trong giao dịch rồi đọc lại phải thấy dữ liệu mới.

## Migration Plan

1. Thêm `cache_version` + trigger (migration thuần thêm, không đổi dữ liệu).
2. Bật chế độ đo, ghi số liệu nền cho benchmark và route.
3. Cache tham chiếu sau cờ `CACHE_REFERENCE_ENABLED` (mặc định bật ở dev, tắt ở production cho đến khi đo xong một kỳ lương).
4. Rollback: đặt cờ về `false` (không cần deploy); migration có thể giữ nguyên vì trigger chỉ tăng bộ đếm.

## Open Questions

- Có cần cache bản đồ phạm vi theo người dùng (tập đơn vị được phép) ở tầng 2, hay chỉ cây tổ chức? Phụ thuộc số đo `ScopeService.load` sau tầng 1.
- Ngưỡng p95 mục tiêu cho từng route đọc nhiều (NFR-09 hiện chỉ cho bảng công).
- Nhập công lần đầu cho cả kỳ (57 s) vẫn chủ yếu là trigger theo dòng khi chèn ngày vắng; có chuyển trigger kiểm tra kỳ/phân xưởng sang mức câu lệnh (transition table) trong change này hay change riêng?
