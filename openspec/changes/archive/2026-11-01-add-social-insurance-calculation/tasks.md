## 1. Dữ liệu

- [x] 1.1 Migration `insurance_rate` (loại, vùng, tỷ lệ NLĐ/DN, chi tiết quỹ con JSON, sàn tham chiếu, trần, hiệu lực, căn cứ) với chống chồng và bất biến
- [x] 1.2 Migration `insurance_contribution` (payroll employee, tháng, lương đóng BH cipher, phần NLĐ/DN từng loại, KPCĐ, đoàn phí, vết) để engine ghi
- [x] 1.3 Seed mức đóng mô phỏng 4 vùng và tham số đoàn phí, addon đào tạo, ngưỡng ngày nghỉ không lương

## 2. Engine thuần

- [x] 2.1 `insuranceEligibility()` theo tháng với mã lý do
- [x] 2.2 `insurableSalary()` từ timeline lương và cờ `is_insurable`, áp sàn/trần
- [x] 2.3 `insuranceContribution()` trả NLĐ/DN, KPCĐ, đoàn phí, vết; làm tròn theo chính sách
- [x] 2.4 `checkCp07()` cho engine lương
- [x] 2.5 Unit test `backend/test/social-insurance-engine.test.cjs` theo BR-47…50 và các diện BR-49

## 3. Service, API, giao diện

- [x] 3.1 CRUD mức đóng cho KT (thêm phiên bản, xem lịch sử), audit
- [x] 3.2 `POST /api/social-insurance/preview` chạy thử cho một nhân viên/tháng
- [x] 3.3 Integration test quyền và chống chồng; script `verify:social-insurance`
- [x] 3.4 Màn hình "Mức đóng BH" và chạy thử; cập nhật README và docs/20
