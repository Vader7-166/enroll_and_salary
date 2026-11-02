## ADDED Requirements

### Requirement: Tính chênh lệch hồi tố theo kỳ gốc
Từ một ứng viên hồi tố, hệ thống SHALL tính lại từng kỳ lương đã khóa bị ảnh hưởng bằng công, OT và tham số lương/BH của kỳ gốc với nguồn đã thay đổi, rồi so với snapshot kỳ gốc để ra chênh lệch lương, BH và thuế từng kỳ. Snapshot kỳ gốc MUST NOT thay đổi.

#### Scenario: Tăng lương hồi tố hai kỳ (TC-P09)
- **WHEN** quyết định tăng lương hiệu lực quá khứ ảnh hưởng hai kỳ đã khóa
- **THEN** hệ thống hiển thị chênh lệch lương, BH, thuế từng kỳ, và dữ liệu hai kỳ đó không đổi

#### Scenario: Thiếu nguồn kỳ gốc
- **WHEN** snapshot kỳ gốc không chứa nguồn cần để tính lại
- **THEN** hệ thống trả `RETRO_SOURCE_UNAVAILABLE` và không ước lượng

### Requirement: Thuế khoản chi bổ sung theo thời điểm chi trả
Hệ thống SHALL tính thuế của khoản truy lĩnh theo ngày chi của kỳ đang mở nhận bút toán, tách khỏi việc sửa sai thuế đã khai, và MUST hiển thị kỳ thuế liên quan của kỳ gốc để tham chiếu.

#### Scenario: Chi bổ sung sang năm mới
- **WHEN** chênh lệch của kỳ 11/2026 được chi trong kỳ lương có ngày chi 01/2027
- **THEN** thuế khoản chi bổ sung dùng bộ quy tắc của kỳ thuế 01/2027

### Requirement: Xác nhận và ghi bút toán vào kỳ đang mở
Hệ thống SHALL cho KT xem bảng chênh lệch theo kỳ gốc, xác nhận sau khi xác thực lại để ghi bút toán truy lĩnh hoặc truy thu vào kỳ lương đang mở kèm thuyết minh kỳ gốc và audit; không xác nhận MUST hủy kết quả tính mà không đổi dữ liệu nào.

#### Scenario: Xác nhận hồi tố (UAT-11)
- **WHEN** quyết định tăng lương hiệu lực 01/08/2026 nhập ngày 05/10/2026, kỳ 08 và 09 đã khóa, KT xác nhận
- **THEN** bút toán truy lĩnh được ghi vào kỳ 10/2026 với thuyết minh kỳ 08 và 09, số liệu kỳ 08 và 09 không đổi

#### Scenario: Hủy
- **WHEN** KT chọn không xác nhận bảng chênh lệch
- **THEN** kết quả tính bị hủy và không có bút toán nào được tạo
