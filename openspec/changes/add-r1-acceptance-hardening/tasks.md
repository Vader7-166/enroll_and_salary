## 1. Rà soát khoảng trống

- [x] 1.1 Lập bảng đối chiếu 152 FR M → change/task/test/bằng chứng (ví dụ `docs/acceptance/fr-coverage.md`)
- [x] 1.2 Tạo change bổ sung cho FR còn thiếu phát hiện khi rà soát

## 2. CI và lint

- [x] 2.1 `.github/workflows/ci.yml`: PostgreSQL 18 service, npm ci, typecheck, build, migrate, seed, `verify:*`, `validate_release_scope.py`
- [x] 2.2 ESLint + rule cục bộ: tiền tệ không float, hằng số pháp lý nghi vấn, cấm `new Date()` khi tra tham số; bắt đầu warning rồi nâng error
- [x] 2.3 Chia job song song theo nhóm suite

## 3. Nghiệm thu tự động

- [x] 3.1 Bộ ca cố định TC-A…TC-L chạy mỗi build
- [x] 3.2 Runner UAT-01…28 + UAT-05b, xuất JSON kết quả có FR, build SHA, cấu hình
- [x] 3.3 Bộ sinh dữ liệu 3.000 NV/4 cơ sở và job benchmark nightly đo NFR-07…13, lưu kết quả

## 4. Sao lưu, khôi phục, khóa

- [x] 4.1 Service backup trong docker-compose: `pg_dump` theo giờ, mã hóa bằng khóa tách biệt, chính sách giữ
- [x] 4.2 Script khôi phục vào cụm sạch, đo RTO, kiểm tra hash snapshot và chuỗi audit; mẫu biên bản diễn tập
- [x] 4.3 Hỗ trợ `HR_DATA_KEYS`/`HR_DATA_KEY_ACTIVE`, tiền tố phiên bản bản mã, lệnh `keys:rotate` mã hóa lại và tính lại blind index

## 5. Bảo mật triển khai

- [x] 5.1 Cấu hình nginx TLS tùy chọn trong compose, `COOKIE_SECURE=true` khi bật TLS; tài liệu hóa
- [x] 5.2 Xác thực lại cho thay đổi tham số pháp lý (NFR-33)

## 6. Nghiệm thu

- [ ] 6.1 Chạy đối soát hai kỳ lương liên tiếp, phân loại chênh lệch, biên bản
- [x] 6.2 Script cập nhật `verification_status` trong manifest từ kết quả thật; cập nhật docs 15/16/19/20
