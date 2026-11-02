## ADDED Requirements

### Requirement: Thuế lũy tiến từng phần cho cá nhân cư trú
Với cá nhân cư trú có HĐ từ 3 tháng, hệ thống SHALL tính thu nhập tính thuế = max(0, thu nhập chịu thuế − giảm trừ bản thân − giảm trừ NPT đủ điều kiện trong tháng − BH bắt buộc phần NLĐ − các giảm trừ hợp lệ khác), rồi tính thuế theo từng bậc của biểu tháng. Giảm trừ MUST NOT bị trừ hai lần.

#### Scenario: Cùng thu nhập, hai năm chi (TC-T01)
- **WHEN** thu nhập tính thuế sau giảm trừ là 45.000.000 đ, chi trong 12/2025 rồi trong 01/2026
- **THEN** thuế là 8.000.000 đ theo bộ 2025 và 5.500.000 đ theo bộ 2026

#### Scenario: Giảm trừ có NPT (TC-T03, UAT-26)
- **WHEN** chi trong 2026, thu nhập chịu thuế sau miễn 70.000.000 đ, BH được trừ 3.300.000 đ, 1 NPT đủ điều kiện
- **THEN** giảm trừ gia cảnh là 21.700.000 đ, thu nhập tính thuế 45.000.000 đ, thuế 5.500.000 đ

#### Scenario: Ranh giới bậc (TC-T11)
- **WHEN** thu nhập tính thuế tháng lần lượt 0 / 10 / 30 / 60 / 100 triệu theo bộ 2026
- **THEN** thuế lần lượt 0 / 500.000 / 2.500.000 / 8.500.000 / 20.500.000 đ, và phần 1 đồng vượt mỗi mốc chịu suất bậc kế tiếp

### Requirement: Khấu trừ 10% và 20%
Hệ thống SHALL khấu trừ 10% cho cá nhân cư trú không HĐ hoặc HĐ dưới 3 tháng theo ngưỡng của mỗi lần trả và cam kết hợp lệ theo bộ quy tắc, và 20% cho cá nhân không cư trú; hai nhánh này MUST NOT áp giảm trừ gia cảnh hoặc biểu lũy tiến.

#### Scenario: Ngưỡng mỗi lần trả (TC-T08)
- **WHEN** khoản 3 triệu/lần không cam kết, không yêu cầu tự nguyện được trả trong 2025 và trong bộ 2026, và thêm một lần trả đúng 5 triệu ở bộ 2026
- **THEN** bộ 2025 khấu trừ 300.000 đ, bộ 2026 lần 3 triệu khấu trừ 0 đ, lần 5 triệu khấu trừ 500.000 đ

#### Scenario: Không cư trú (TC-T12)
- **WHEN** cá nhân không cư trú có thu nhập chịu thuế 20.000.000 đ và có hồ sơ NPT
- **THEN** thuế là 4.000.000 đ và không trừ gia cảnh

### Requirement: Bóc tách thu nhập miễn thuế không trùng
Hệ thống SHALL bóc tách miễn thuế trên từng khoản/đoạn thu nhập không trùng nguồn theo chế độ miễn của ngữ cảnh: `PREMIUM_ONLY` miễn phần chênh lệch so với tiền giờ bình thường tương ứng; `ELIGIBLE_PAYMENT` miễn tối đa số tiền đủ điều kiện có căn cứ. Tổng phần miễn và phần chịu thuế MUST bằng số thực trả; khoản thiếu căn cứ MUST tạo ngoại lệ chặn duyệt.

#### Scenario: OT lễ hai năm (TC-T02)
- **WHEN** OT lễ 2 giờ × 100.000 đ × 300% = 600.000 đ đủ điều kiện, chi trong 2025 và trong 2026
- **THEN** bộ 2025 chịu 200.000 đ, miễn 400.000 đ; bộ 2026 chịu 0 đ, miễn 600.000 đ

#### Scenario: Ca đêm không đếm trùng (TC-T06)
- **WHEN** ca đêm bình thường 8 giờ × 100.000 đ cộng phụ cấp 30% = 240.000 đ, tổng 1.040.000 đ
- **THEN** bộ 2025 chịu 800.000 đ, miễn 240.000 đ; bộ 2026 chịu 0 đ, miễn 1.040.000 đ; 800.000 đ không bị cộng lại trong lương thời gian

#### Scenario: Chỉ một phần đủ điều kiện (TC-T07)
- **WHEN** bộ 2026, tiền OT thực trả 600.000 đ nhưng chỉ xác minh được 450.000 đ đủ điều kiện
- **THEN** miễn 450.000 đ, chịu 150.000 đ

#### Scenario: Tiền phép chưa nghỉ khi thôi việc (TC-T13)
- **WHEN** bộ 2026, tiền ngày không nghỉ phép 2.000.000 đ có đủ căn cứ khoản 3 Điều 113 BLLĐ và khoản 2 Điều 26 NĐ 253
- **THEN** miễn 2.000.000 đ; khoản thiếu chứng từ tạo ngoại lệ

### Requirement: Gross-up lương NET
Hệ thống SHALL tìm thu nhập GROSS cho thỏa thuận NET bằng phương pháp lặp chia đôi dùng cùng bộ tính BH và thuế, với sai số không quá 1 đồng; không hội tụ sau 100 vòng MUST trả `GROSS_UP_NOT_CONVERGED`.

#### Scenario: NET 20 triệu (UAT-13, TC-P03)
- **WHEN** nhân viên thỏa thuận NET 20.000.000 đ
- **THEN** GROSS tìm được cho thực lĩnh lệch NET không quá 1 đồng

### Requirement: Bản ghi khấu trừ dùng chung và bất biến
Hệ thống SHALL lưu kết quả khấu trừ theo người, lần chi và kỳ thuế gồm ngày chi, trạng thái dự kiến/thực tế, nhánh khấu trừ, snapshot quy tắc, thu nhập chịu thuế, miễn thuế, từng giảm trừ, thu nhập tính thuế, thuế và phân rã bậc. Bảng lương MUST dùng chính bản ghi này; khoản đã khai/nộp MUST NOT bị ghi đè và điều chỉnh MUST tạo bản ghi mới liên kết bản gốc.

#### Scenario: Không khấu trừ hai lần
- **WHEN** cùng một lần chi đã có bản ghi khấu trừ và bảng lương được tính lại
- **THEN** hệ thống cập nhật bản ghi nháp của lần chi đó thay vì tạo bản ghi thứ hai

#### Scenario: Điều chỉnh khoản đã khai
- **WHEN** KT điều chỉnh thuế của lần chi đã có trạng thái đã khai
- **THEN** bản ghi gốc giữ nguyên và một bản ghi điều chỉnh mới tham chiếu bản gốc được tạo
