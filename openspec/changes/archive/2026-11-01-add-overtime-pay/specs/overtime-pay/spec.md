## ADDED Requirements

### Requirement: Hệ số OT tính từ tham số ba số hạng
Hệ thống SHALL tính hệ số OT ban đêm bằng `r_ngày + phụ_cấp_đêm + hệ_số_cộng × r_ban_ngày`, trong đó `r_ngày` theo loại ngày, `r_ban_ngày` bằng 1,00 cho OT đêm ngày thường chưa có OT ban ngày và bằng `r_ngày` trong các trường hợp còn lại. Mọi giá trị MUST lấy từ `legal_parameter` có hiệu lực tại ngày công; hệ thống MUST NOT lưu 200%/210%/270%/390% làm hằng số.

#### Scenario: Tham số chuẩn
- **WHEN** tham số OT ngày thường 150%, nghỉ tuần 200%, lễ 300%, phụ cấp đêm 30%, hệ số cộng 20%
- **THEN** OT đêm ngày thường chưa có OT ban ngày là 200%, đã có là 210%, OT đêm nghỉ tuần là 270%, OT đêm lễ là 390%

#### Scenario: Chỉ đổi OT ngày thường lên 160% (TC-O05, O05b, O05c)
- **WHEN** chỉ tham số OT ngày thường đổi thành 160%
- **THEN** OT ban ngày thường là 160%, OT đêm ngày thường là 222% khi đã có OT ban ngày và 210% khi chưa có, OT đêm nghỉ tuần và lễ vẫn là 270% và 390%

#### Scenario: Thiếu tham số
- **WHEN** không có tham số hệ số OT hiệu lực tại ngày công của cơ sở
- **THEN** hệ thống trả `OT_RATE_PARAMETER_MISSING` kèm mã tham số và không sinh bucket cho ngày công đó

### Requirement: Tách đoạn giờ và phân loại loại ngày
Hệ thống SHALL tách mỗi khoảng OT tại các mốc 00:00, 06:00, 22:00 và gán cho mỗi đoạn cờ ban đêm (22:00–06:00) và loại ngày THUONG / NGHI_TUAN / LE_TET theo ngày lịch của đầu đoạn, lịch lễ có hiệu lực và ngày nghỉ hằng tuần của cơ sở.

#### Scenario: OT qua nửa đêm sang ngày nghỉ tuần (TC-O04, UAT-06)
- **WHEN** OT từ 20:00 thứ Bảy (ngày thường) đến 02:00 Chủ nhật (nghỉ hằng tuần) với tham số chuẩn
- **THEN** hệ thống tạo ba đoạn 20:00–22:00 hệ số 150%, 22:00–00:00 hệ số 210%, 00:00–02:00 hệ số 270%

#### Scenario: Ca vắt sang ngày lễ
- **WHEN** ca C bắt đầu 22:00 ngày thường, kết thúc 06:00 ngày lễ
- **THEN** ngày công vẫn là ngày thường, còn đoạn 00:00–06:00 mang loại ngày LE_TET

### Requirement: Cờ đã có OT ban ngày là thuộc tính ngày công
Hệ thống SHALL xác định cờ "đã có OT ban ngày trong cùng ngày công" trên bản ghi ngày công trước khi áp hệ số cho bất kỳ đoạn nào, và MUST dùng cùng một giá trị cờ cho mọi đoạn đêm ngày thường của ngày công đó.

#### Scenario: OT ngày rồi OT đêm (TC-O02)
- **WHEN** ngày công thường có 2 giờ OT ban ngày rồi 2 giờ OT ban đêm
- **THEN** đoạn ngày áp 150% và đoạn đêm áp 210%

#### Scenario: Chỉ OT đêm (TC-O03)
- **WHEN** ngày công thường chỉ có OT ban đêm
- **THEN** đoạn đêm áp 200%

### Requirement: Giờ OT tính tiền lấy giá trị nhỏ hơn giữa thực tế và đã duyệt
Hệ thống SHALL lấy giờ OT đủ điều kiện tính tiền bằng phần giao giữa giờ thực tế và khoảng đã duyệt; phần lệch MUST tiếp tục đi luồng ngoại lệ công, và giờ thực tế MUST NOT bị giảm.

#### Scenario: Thực tế ít hơn duyệt
- **WHEN** duyệt 17:00–20:00 nhưng thực tế 17:00–19:50
- **THEN** bucket ghi 170 phút đủ điều kiện, giờ thực tế giữ 170 phút, 10 phút thiếu nằm trong ngoại lệ

#### Scenario: Làm thêm không có đề xuất duyệt
- **WHEN** có giờ làm ngoài ca không thuộc khoảng OT đã duyệt
- **THEN** giờ đó không vào bucket tính tiền và vẫn hiển thị trong ngoại lệ công

### Requirement: Bucket chính thức chỉ từ nguồn công đã khóa
Hệ thống SHALL sinh bucket giờ OT và giờ đêm không OT theo (nhân viên, ngày công, loại ngày, ban đêm, cờ OT ban ngày) kèm hash nguồn. Bucket từ kỳ công chưa LOCKED MUST mang trạng thái `DRAFT`; bucket từ kỳ LOCKED MUST đọc từ snapshot khóa và không tính lại từ dữ liệu sống.

#### Scenario: Kỳ đã khóa
- **WHEN** kỳ công đã LOCKED và thuật toán ghép công thay đổi sau đó
- **THEN** bucket của kỳ vẫn khớp snapshot và cùng hash nguồn

#### Scenario: Kỳ đang mở
- **WHEN** KT xem bucket của kỳ công OPEN
- **THEN** bucket hiển thị nhãn Nháp và engine lương chính thức không chấp nhận chúng

### Requirement: Giờ đêm không phải OT
Hệ thống SHALL tính tổng giờ làm việc bình thường nằm trong khung 22:00–06:00, không gồm giờ OT, để engine lương áp phụ cấp ca đêm.

#### Scenario: Ca C chuẩn (TC-A02)
- **WHEN** ca C vào 21:40 ngày T, ra 06:15 ngày T+1, không OT
- **THEN** ghi 8 giờ đêm không OT cho ngày công T và không có bucket OT

### Requirement: Tính tiền OT có vết
Hệ thống SHALL cung cấp hàm tính tiền OT = Σ đơn giá giờ × hệ số × số giờ bucket bằng Decimal, trả vết gồm đơn giá, hệ số phân rã, mã/phiên bản tham số và số giờ từng bucket.

#### Scenario: Fixture FIX-09 / TC-B01
- **WHEN** 2 giờ OT ngày thường đủ căn cứ, đơn giá giờ 100.000 đ, hệ số 150%
- **THEN** tiền OT là 300.000 đ và vết ghi đủ ba thành phần

### Requirement: Quy đổi nghỉ bù chưa kích hoạt
Khi `COMP_TIME_ENABLED=false`, hệ thống SHALL trả `COMP_TIME_DISABLED` cho mọi yêu cầu quy đổi OT sang nghỉ bù, MUST NOT sinh quỹ nghỉ, và MUST NOT giảm tiền OT hoặc giờ OT thực tế. Nghỉ bù lễ và phép năm MUST tiếp tục hoạt động độc lập.

#### Scenario: KT yêu cầu quy đổi (TC-B01)
- **WHEN** KT gửi yêu cầu quy đổi 2 giờ OT đủ căn cứ
- **THEN** hệ thống trả `COMP_TIME_DISABLED`, giữ 2 giờ thực tế, tiền OT vẫn 300.000 đ, tỷ lệ và hạn quy đổi là null

#### Scenario: Nghỉ bù lễ vẫn hoạt động (TC-B02)
- **WHEN** quy đổi OT đang tắt và có ngày nghỉ bù lễ trùng nghỉ tuần hoặc đơn phép năm
- **THEN** lịch nghỉ và quỹ phép vẫn được xử lý bình thường
