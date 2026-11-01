## ADDED Requirements

### Requirement: Bộ quy tắc thuế theo hiệu lực
Hệ thống SHALL lưu bộ quy tắc thuế theo đối tượng (cư trú lũy tiến, cư trú khấu trừ 10%, không cư trú) và khoảng hiệu lực, gồm biểu bậc tháng và năm, giảm trừ bản thân và người phụ thuộc, ngưỡng khấu trừ 10% mỗi lần trả, chế độ miễn thuế OT/đêm, định mức các khoản miễn khác và văn bản căn cứ. Mọi giá trị MUST NOT được ghi cứng trong mã nguồn.

#### Scenario: Bộ 2026 cư trú
- **WHEN** KT xem bộ quy tắc cư trú lũy tiến hiệu lực kỳ thuế 2026
- **THEN** biểu có 5 bậc (10/30/60/100 triệu, suất 5/10/20/30/35%), giảm trừ 15.500.000 đ và 6.200.000 đ mỗi NPT, chế độ miễn `ELIGIBLE_PAYMENT`

#### Scenario: Bộ 2025
- **WHEN** KT xem bộ quy tắc cư trú lũy tiến đến hết 2025
- **THEN** biểu có 7 bậc, giảm trừ 11.000.000 đ và 4.400.000 đ, chế độ miễn `PREMIUM_ONLY`

### Requirement: Chọn ngữ cảnh thuế theo ngày chi trả
Hệ thống SHALL chọn bộ quy tắc theo kỳ thuế của ngày chi trả thực tế, hoặc ngày dự kiến được đánh dấu `PROJECTED`, và theo đối tượng thuế của nhân viên; MUST NOT chọn theo ngày chạy hoặc tên kỳ công. Thiếu hoặc chồng phiên bản bắt buộc MUST trả `TAX_RULESET_INVALID`.

#### Scenario: Công tháng 12/2025 chi tháng 01/2026 (TC-T04)
- **WHEN** lương công tháng 12/2025 của cá nhân cư trú được chi ngày 09/01/2026
- **THEN** ngữ cảnh là kỳ thuế 01/2026 với biểu 5 bậc, giảm trừ 15,5/6,2 triệu và chế độ miễn 2026

#### Scenario: Tái hiện khoản đã chi (TC-T05)
- **WHEN** chạy lại khoản chi ngày 31/12/2025 trong năm 2026 ở chế độ `REPLAY_FILED`
- **THEN** hệ thống dùng snapshot ngữ cảnh và số đã khấu trừ gốc, không đổi sang bộ 2026

### Requirement: Định mức miễn theo hiệu lực riêng
Hệ thống SHALL áp định mức từng khoản miễn theo hiệu lực riêng của khoản đó, độc lập với hiệu lực biểu thuế.

#### Scenario: Tiền ăn ca qua mốc 01/07/2026 (TC-T09)
- **WHEN** tiền ăn ca bằng tiền 1.500.000 đ được trả ngày 30/06/2026 và ngày 01/07/2026
- **THEN** lần tháng 6 dùng định mức lịch sử có căn cứ, lần tháng 7 không tính thuế 1.200.000 đ và chịu thuế 300.000 đ
