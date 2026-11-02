## 1. Bản vá hiệu năng nhập công (đã làm, chờ commit)

- [x] 1.1 Benchmark `scripts/benchmark-attendance-month.cjs` (1.100 nhân viên, lịch ca hai kỳ, ngưỡng 60 s); số nền: 131 s, quá timeout
- [x] 1.2 Thay `schedules.find` theo từng ngày bằng `Map` trong `AttendanceService.processRows`
- [x] 1.3 `SettingsService.legalParameterResolver`: nạp đơn vị, vùng, tham số một lần cho giao dịch; `AttendanceService.rules` nhận hàm tra cứu
- [x] 1.4 Chỉ tải lịch ca và đề nghị OT của đơn vị thuộc cơ sở đang nhập
- [x] 1.5 Ghi `daily_attendance` và `overtime_actual` theo diff (`IS DISTINCT FROM`, ép scale `numeric`), OT thực tế ghi theo lô
- [x] 1.6 Chạy lại 18 bộ kiểm thử chấm công/OT/nghỉ/khóa kỳ/lương (199 test đạt); số sau: 57 s lần đầu, 35 s lần hai
- [x] 1.7 Kiểm thử: nhập lại cùng dữ liệu không cập nhật dòng nào (`xmin` không đổi); một ngày đổi chỉ cập nhật đúng dòng đó
- [x] 1.8 Đổi nhãn giao diện "Lần xử lý gần nhất"/"Lần đối chiếu gần nhất" thành "Kết quả cập nhật lúc"
- [x] 1.9 Thêm `benchmark-attendance-month` vào `scripts/benchmark-nightly.cjs`

## 1b. Cửa sổ kỳ đầy lượt quẹt (phát hiện khi nạp dữ liệu demo)

- [x] 1b.1 `benchmark-attendance-month --with-history` (74.800 lượt quẹt sẵn trong cửa sổ); số nền > 300 s
- [x] 1b.2 Engine OT thực tế: gom lượt quẹt theo nhân viên thay vì lọc toàn bộ cho từng nhóm (119 s → 11 s)
- [x] 1b.3 Memo `periodParents(unit, day)`; bỏ sao chép sâu bằng JSON của bằng chứng OT thực tế
- [x] 1b.4 Tải lượt quẹt của cửa sổ bằng một truy vấn JOIN cùng dạng dữ liệu (17 s → 8,7 s); ghi `punch_processing` theo diff; lô 2.000 dòng
- [x] 1b.5 `ATTENDANCE_TRANSACTION_TIMEOUT_MS` (mặc định 90 s) cho lần nạp bù demo; số sau: 63,8 s lần đầu, 52,8 s lần sau

## 2. Đo lường

- [x] 2.1 Chế độ `QUERY_METRICS=true`: đếm truy vấn và thời gian truy vấn theo route bằng Prisma query event, log có cấu trúc
- [x] 2.2 `scripts/benchmark-read-routes.cjs`: p50/p95, số và thời gian truy vấn cho 5 route (ngữ cảnh tổ chức, nhân sự, bảng công, kỳ lương, báo cáo), cache tắt và bật

## 3. Phạm vi giao dịch (đã chỉnh khi triển khai, xem design §1)

- [x] 3.1 Không dùng memo `AsyncLocalStorage`: vi phạm yêu cầu đọc lại trong giao dịch; thay bằng kiểm tra phiên bản mỗi lần đọc (một truy vấn nhỏ)
- [x] 3.2 `ScopeService.load` đọc cây tổ chức và quyền vai trò qua cache phiên bản; giữ nguyên đường truy vấn cũ khi tắt cache
- [x] 3.3 Giữ các `Map` theo ngày trong service (tránh cả truy vấn phiên bản trong vòng lặp lớn)
- [x] 3.4 Kiểm thử: SQL tay đổi tên đơn vị thấy ngay ở request kế tiếp trên hai instance; giao dịch rollback không để lại phiên bản dùng lại

## 4. Tầng 2 – cache dữ liệu tham chiếu có phiên bản

- [x] 4.1 Migration `cache_version(group, version)` và trigger mức câu lệnh trên `org_unit`, `org_unit_version`, `site`, `role`, `legal_parameter`, `site_policy`, `shift_definition`
- [x] 4.2 `backend/src/common/cache/reference-cache.ts`: đọc phiên bản một lần trong snapshot, tải lại khi lệch, đóng băng giá trị, cờ `CACHE_REFERENCE_ENABLED`, log hit/miss/reload
- [x] 4.3 Chuyển `ScopeService` (cây tổ chức, quyền vai trò), `SettingsService` (tham số pháp lý, chính sách cơ sở, `legalParameterResolver`) và danh mục ca sang tầng 2
- [x] 4.4 Kiểm thử: mỗi bảng nguồn tăng đúng nhóm của nó (và không nhóm khác); trigger trong CSDL khớp chính xác `CACHE_SOURCE_TABLES`
- [x] 4.5 Kiểm thử hai instance: A tạo phiên bản chính sách, B trả giá trị mới ngay; ngày trước hiệu lực giữ giá trị cũ
- [x] 4.6 Kiểm thử không cache dữ liệu nhạy cảm: phản hồi `/api` có `no-store`; thu hồi phiên có hiệu lực ngay

## 5. Xác nhận và tài liệu

- [x] 5.1 Chạy toàn bộ bộ kiểm thử backend (456 test, gồm mọi tệp của acceptance map) hai lần: `CACHE_REFERENCE_ENABLED=false` và `true` — đều 456/456 đạt
- [x] 5.2 So sánh số đo trước/sau (benchmark nhập công, p95 + số truy vấn 5 route) và ghi vào `docs/acceptance`
- [x] 5.3 Cập nhật `docs/08-kien-truc-he-thong.md` (tầng cache, nhóm, cách vô hiệu hóa) và `docs/15-yeu-cau-phi-chuc-nang.md` (ngưỡng mới)
