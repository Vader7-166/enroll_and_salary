## 1. Dữ liệu và seed

- [x] 1.1 Migration `tax_ruleset`, `pit_bracket`, `tax_deduction_usage`, `tax_withholding`, `tax_exemption_line` với chống chồng và bất biến sau khóa
- [x] 1.2 Seed bộ 2025 và bộ 2026 (cư trú lũy tiến, cư trú 10%, không cư trú) kèm căn cứ và nhãn SIMULATION; định mức ăn ca trước/từ 01/07/2026

## 2. Engine thuần

- [x] 2.1 `selectTaxContext()` theo ngày chi, trạng thái PROJECTED/ACTUAL, đối tượng và chế độ REPLAY_FILED; lỗi `TAX_RULESET_INVALID`
- [x] 2.2 `splitExemptions()` trên danh sách khoản đã phân loại cho PREMIUM_ONLY và ELIGIBLE_PAYMENT; tách lương gốc giờ đêm một lần
- [x] 2.3 `progressive()` với giảm trừ bản thân/NPT/BH/khác và trần năm y tế/giáo dục
- [x] 2.4 `flat10()` theo ngưỡng mỗi lần trả và cam kết; `nonResident20()`
- [x] 2.5 `grossUp()` chia đôi, sai số ≤ 1 đồng, `GROSS_UP_NOT_CONVERGED`
- [x] 2.6 Unit test `backend/test/pit-engine.test.cjs`: TC-T01…T13, TC-P03, 50 mức NET trải đủ bậc 2025/2026 (NFR-04)

## 3. Service, API, giao diện

- [x] 3.1 Quản lý ruleset cho KT (thêm phiên bản, xem lịch sử, căn cứ), audit
- [x] 3.2 `POST /api/pit/preview` và `POST /api/pit/gross-up-preview` cho KT
- [x] 3.3 Repository `tax_withholding`: upsert bản nháp theo lần chi, bản ghi điều chỉnh liên kết bản gốc
- [x] 3.4 Integration test quyền và chống chồng; script `verify:pit`
- [x] 3.5 Màn hình "Quy tắc thuế TNCN" và chạy thử; cập nhật README và docs/20
