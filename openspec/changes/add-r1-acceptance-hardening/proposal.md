## Why

Nghiệm thu R1 (19 §5.1) yêu cầu 152/152 FR M đạt, 29 UAT, các TC, 60 NFR, hiệu năng, khôi phục và đối soát hai kỳ liên tiếp — tất cả đang `NOT_EXECUTED`. Một số yêu cầu xuyên suốt chưa có: xoay khóa mã hóa (FR-X.2), sao lưu/khôi phục có kiểm chứng (FR-X.4, NFR-38…41), kiểm thử tự động trong CI (FR-X.6, NFR-55, 56), quy tắc lint chặn float/hardcode/tra tham số theo ngày hiện tại (NFR-01, 20, 60), benchmark 3.000 nhân sự (NFR-07…13, 59), TLS (NFR-31). Change này gom phần làm cứng và quy trình thu bằng chứng nghiệm thu.

## What Changes

- **Rà soát khoảng trống**: đối chiếu 152 FR M trong manifest với code/test, lập bảng FR → change/task/test/bằng chứng; tạo change bổ sung cho FR còn thiếu.
- **CI GitHub Actions**: typecheck, build, migrate trên PostgreSQL 18 dịch vụ, seed, toàn bộ `verify:*`, `validate_release_scope.py`, lint; chạy mỗi push/PR.
- **Lint tuân thủ**: chặn `number`/`parseFloat` cho tiền tệ ở module lương/BH/thuế, phát hiện hằng số pháp lý nghi vấn (5310000, 0.08, 0.015, 1.5…), chặn tra tham số bằng `new Date()` thay ngày nghiệp vụ.
- **Bộ dữ liệu nghiệm thu cố định** TC-A…TC-L chạy mỗi build; **runner UAT** 29 dòng (gồm UAT-05b) trên build cố định, xuất kết quả có FR/build/cấu hình/người nghiệm thu.
- **Hiệu năng**: bộ sinh dữ liệu 3.000 NV/4 cơ sở; đo NFR-07…13 định kỳ, lưu kết quả.
- **Sao lưu/khôi phục**: script `pg_dump` mã hóa theo lịch (RPO ≤ 1 giờ bằng WAL archiving hoặc dump theo giờ), quy trình khôi phục đo RTO ≤ 4 giờ, biên bản diễn tập; service backup trong docker-compose.
- **Xoay khóa** `HR_DATA_KEY`: hỗ trợ nhiều phiên bản khóa, lệnh mã hóa lại dữ liệu, blind index theo `keyVersion`.
- **TLS**: reverse proxy nginx có cấu hình TLS cho triển khai; tài liệu hóa.
- **Xác thực bổ sung** cho thao tác nhạy cảm còn thiếu (đổi tham số pháp lý) theo NFR-33.
- **Đối soát hai kỳ liên tiếp** và cập nhật `verification_status` trong manifest chỉ khi có bằng chứng thật.

## Capabilities

### New Capabilities
- `release-quality-gates`: CI, lint tuân thủ, bộ dữ liệu nghiệm thu, runner UAT và benchmark hiệu năng.
- `backup-and-key-management`: sao lưu mã hóa, khôi phục có đo RPO/RTO, diễn tập, và xoay khóa mã hóa.
- `acceptance-evidence`: rà soát FR, đối soát hai kỳ và ghi bằng chứng nghiệm thu vào manifest.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Repo:** `.github/workflows/ci.yml`, cấu hình lint (ESLint + rule tùy chỉnh), `scripts/` (benchmark data generator, backup/restore, key rotation, UAT runner), `docker-compose.yml` (service backup, TLS proxy tùy chọn).
- **Docs:** cập nhật 15/16/19/20, manifest `hrtp-release-r1.json` (chỉ khi có bằng chứng).
- **Phụ thuộc:** chạy sau cùng cho phần nghiệm thu; CI, lint, backup và xoay khóa có thể làm sớm song song.
