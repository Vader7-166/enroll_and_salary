## Context

Kiểm thử hiện là `node --test` trên `backend/test/*.test.cjs` gọi qua các script `verify:*`, cần database thật và seed. `scripts/validate_release_scope.py` chỉ kiểm tra nhất quán tài liệu. Repo trên GitHub, chưa có `.github/`. Docker compose (nhánh `hung`) chạy db/backend/frontend. Mã hóa dùng một khóa `HR_DATA_KEY`.

## Goals / Non-Goals

**Goals:**
- Mọi push chạy đủ kiểm thử trên PostgreSQL 18 sạch.
- Bằng chứng nghiệm thu truy được tới build, cấu hình, test và người nghiệm thu.
- Khôi phục được đo bằng diễn tập thật, không chỉ tài liệu.

**Non-Goals:**
- Không chứng nhận kiểm toán bên ngoài (ngoài R1).
- Không triển khai hạ tầng production thật (on-prem/cloud chưa chốt, NFR-48).

## Decisions

1. **GitHub Actions** với service `postgres:18.3-alpine`; job: `npm ci` → `typecheck` → `build` → `db:deploy` → seed (`SEED_ALLOW_ISOLATED`) → chạy tuần tự các `verify:*` (một số dùng `--test-concurrency=1`) → `python scripts/validate_release_scope.py` → lint. Benchmark chạy theo lịch (nightly) vì tốn thời gian.
2. **Lint tùy chỉnh** bằng ESLint rule cục bộ: (a) cấm `parseFloat`/`Number()`/toán tử số học trên định danh khớp mẫu tiền tệ trong thư mục lương/BH/thuế, yêu cầu `Decimal`; (b) danh sách hằng số nghi vấn; (c) cấm `new Date()` làm ngày tra tham số trong service tính toán (yêu cầu tham số ngày nghiệp vụ). Có cơ chế ngoại lệ có chú thích lý do.
3. **Runner UAT** là bộ test `backend/test/uat/*.test.cjs` ánh xạ 1-1 với UAT-01…28 + UAT-05b; kết quả xuất JSON (UAT, FR, build SHA, cấu hình, thời gian, kết quả) để đính kèm bằng chứng. Bước người nghiệm thu ký xác nhận vẫn ngoài hệ thống.
4. **Sao lưu**: service `backup` trong compose chạy `pg_dump -Fc` theo giờ, mã hóa bằng `age`/`openssl` với khóa tách biệt khỏi DB, giữ theo chính sách; khôi phục bằng script đo thời gian vào cụm sạch rồi chạy kiểm tra hash snapshot kỳ khóa. WAL archiving là phương án nâng cấp nếu cần RPO thấp hơn.
5. **Xoay khóa**: `HR_DATA_KEYS` dạng `v1:...,v2:...` + `HR_DATA_KEY_ACTIVE=v2`; bản mã lưu tiền tố phiên bản; lệnh `npm run keys:rotate` mã hóa lại theo lô và tính lại blind index; khóa cũ chỉ gỡ khi không còn bản mã dùng nó.
6. **Manifest nghiệm thu** chỉ đổi `verification_status` qua script đọc kết quả test thật + tham chiếu bằng chứng; không sửa tay thành PASS.

## Risks / Trade-offs

- [CI chậm do nhiều suite cần DB] → chia job song song theo nhóm suite, mỗi job một database.
- [Lint tiền tệ báo sai] → bắt đầu ở mức warning, nâng lên error sau khi làm sạch.
- [Benchmark trên máy CI không đại diện] → ghi cấu hình máy cùng kết quả; đo chính thức trên môi trường nghiệm thu.

## Migration Plan

Thay đổi chủ yếu ngoài ứng dụng. Xoay khóa cần migration hỗ trợ tiền tố phiên bản trên các cột cipher (tương thích ngược: bản mã không tiền tố = v1).

## Open Questions

- Môi trường nghiệm thu (máy, cấu hình) để đo NFR chính thức chưa xác định.
