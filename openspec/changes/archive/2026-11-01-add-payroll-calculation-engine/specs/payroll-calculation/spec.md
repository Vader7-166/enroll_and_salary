## ADDED Requirements

### Requirement: Chỉ tính khi nguồn công đã khóa
Hệ thống SHALL chỉ cho KT chạy tính lương cho một kỳ lương và cơ sở khi mọi kỳ công nguồn giao với kỳ lương đã LOCKED, và MUST dùng tham số còn hiệu lực theo ngày nghiệp vụ của kỳ gốc.

#### Scenario: Một nguồn chưa khóa (TC-K06)
- **WHEN** kỳ lương tham chiếu hai kỳ công và một kỳ chưa khóa
- **THEN** hệ thống trả `PERIOD_NOT_LOCKED` và không tạo dòng lương

#### Scenario: Chạy lại kỳ cũ (TC-P05)
- **WHEN** chạy lại kỳ 12/2025 vào tháng 02/2026
- **THEN** lương tối thiểu vùng dùng mức của năm 2025

### Requirement: Kiểm tra đầu vào trước khi tính
Hệ thống SHALL chỉ dùng đầu vào CONFIRMED, đúng một phiên bản hiệu lực cho mỗi nguồn và đúng phương án lương của đoạn. Khoản bắt buộc ở trạng thái MISSING MUST tạo lỗi `PAYROLL_INPUT_MISSING` cho nhân viên đó; CONFIRMED_ZERO và NOT_APPLICABLE MUST có căn cứ riêng; hai phương án chồng hiệu lực hoặc nguồn cộng trùng MUST bị báo xung đột.

#### Scenario: Ba trạng thái giá trị (TC-I02)
- **WHEN** khoản sản lượng bắt buộc lần lượt là MISSING, CONFIRMED_ZERO, NOT_APPLICABLE
- **THEN** MISSING chặn nhân viên, CONFIRMED_ZERO tính 0 có nguồn, NOT_APPLICABLE chỉ hợp lệ khi khớp phương án

#### Scenario: Nguồn chưa xác nhận (TC-I06)
- **WHEN** nguồn sản phẩm thuộc lô DRAFT, VALIDATED hoặc RETURNED
- **THEN** nguồn không được dùng cho bảng lương chính thức

### Requirement: Lương theo phương án không cộng trùng
Hệ thống SHALL tính lương chính theo khoản BASE và ADDITIONAL của phương án lương có hiệu lực, MUST NOT tự cộng mọi hình thức, và MUST phân bổ khoán/sản phẩm tổ theo bảng phân bổ đã xác nhận.

#### Scenario: Chín fixture đối chứng (TC-I01)
- **WHEN** tính riêng FIX-01…FIX-09 trước BH/thuế
- **THEN** kết quả lần lượt 12.000.000 / 500.000 / 1.000.000 / 450.000 / 4.000.000 / 1.800.000 / 12.400.000 / 4.000.000 / 300.000 đ

#### Scenario: Khoán tổ (TC-I08)
- **WHEN** giá khoán tổ 4.000.000 đ có phân bổ NV-A 2.500.000 và NV-B 1.500.000
- **THEN** tổng trả là 4.000.000 đ; nếu thiếu bảng phân bổ thì giữ chờ, không chia đều

### Requirement: Đơn giá giờ OT theo giờ bình thường tương ứng
Hệ thống SHALL tính đơn giá giờ OT của lương thời gian bằng tiền lương công việc đủ điều kiện chia cho số giờ làm việc bình thường tương ứng có nguồn đã xác nhận, MUST loại giờ OT và giờ nghỉ lễ hưởng lương khỏi mẫu số, và MUST NOT dùng mặc định 26 × 8.

#### Scenario: Mẫu số đúng (TC-I10)
- **WHEN** tiền công việc đủ căn cứ 10.000.000 đ, giờ bình thường đã xác nhận 100 giờ, có thêm 10 giờ OT
- **THEN** đơn giá là 100.000 đ/giờ, không chia 110

### Requirement: Tách đoạn trong kỳ
Hệ thống SHALL cắt mỗi nhân viên thành các đoạn theo thay đổi lương, đơn vị/vùng, phương án, đơn giá và ngày vào/nghỉ việc, tính lương thời gian và lương tối thiểu theo từng đoạn, và phân bổ chi phí về cost center theo tỷ lệ ngày công.

#### Scenario: Điều chuyển liên vùng giữa kỳ (TC-P07, UAT-21)
- **WHEN** nhân viên chuyển từ NM Bắc Ninh sang NM Nghệ An ngày 10
- **THEN** bảng lương có hai đoạn, đoạn 1 so vùng I, đoạn 2 so vùng III, chi phí chia hai cost center theo ngày công

### Requirement: Trình tự tổng hợp và thực lĩnh
Hệ thống SHALL tổng hợp theo thứ tự: lương theo phương án, tiền OT, phụ cấp ca đêm, phụ cấp/thưởng/phúc lợi, tổng thu nhập, BH bắt buộc, bóc tách miễn thuế, thuế TNCN, khấu trừ khác, điều chỉnh, thực lĩnh, làm tròn theo chính sách khai báo. Khấu trừ khác MUST NOT vượt 30% của tổng thu nhập trừ BH và thuế. Hệ thống MUST NOT có khoản trừ do đi trễ, về sớm, KPI hoặc vi phạm nội quy.

#### Scenario: Không có loại khấu trừ kỷ luật
- **WHEN** KT tìm loại khấu trừ cho đi muộn trong cấu hình
- **THEN** hệ thống không cung cấp loại khấu trừ đó

### Requirement: Bảng lương nháp idempotent có vết
Hệ thống SHALL lưu mỗi lần chạy với hash nguồn, hash tham số và tập phiên bản công thức/đơn giá/quy tắc thuế; mỗi dòng lương MUST có vết tính và liên kết tới các dòng nguồn/version/hash đã dùng. Chạy lại với cùng nguồn MUST cho kết quả trùng tuyệt đối.

#### Scenario: Chạy hai lần (TC-P06)
- **WHEN** KT chạy tính lương hai lần với cùng dữ liệu
- **THEN** mọi dòng lương và tổng trùng khớp tuyệt đối và hash nguồn giống nhau

#### Scenario: Nhập lại nguồn (TC-I03)
- **WHEN** cùng nguồn được nhập hai lần
- **THEN** bảng lương không cộng tiền hai lần

### Requirement: Chạy lô có tiến độ và cô lập lỗi
Hệ thống SHALL chạy tính lương theo lô đơn vị, hiển thị tiến độ, cho dừng an toàn giữa các lô, ghi lỗi từng nhân viên mà không làm hỏng nhân viên khác, và cho chạy lại một phần cho cùng kết quả.

#### Scenario: Một nhân viên lỗi
- **WHEN** một nhân viên thiếu đầu vào bắt buộc
- **THEN** nhân viên đó ở trạng thái lỗi với mã cụ thể, các nhân viên khác được tính xong

#### Scenario: Hiệu năng
- **WHEN** chạy tính cho 3.000 nhân viên mô phỏng trên 4 cơ sở
- **THEN** lần chạy hoàn tất trong không quá 15 phút
