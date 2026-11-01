## ADDED Requirements

### Requirement: Bảng thanh toán tiền lương và tiền thưởng
Hệ thống SHALL cung cấp cho KT bảng thanh toán tiền lương gồm căn cứ, từng khoản thu nhập, khấu trừ BH/đoàn phí/thuế/khác, điều chỉnh có kỳ gốc và thực lĩnh, với drill-down từng ô số tiền; và bảng thanh toán tiền thưởng riêng theo kỳ chi gồm loại, căn cứ, số tiền, phần chịu thuế, thuế khấu trừ, thực nhận.

#### Scenario: Truy lĩnh có kỳ gốc
- **WHEN** bảng lương kỳ 10/2026 có bút toán truy lĩnh từ kỳ 08
- **THEN** cột điều chỉnh ghi rõ kỳ gốc 08/2026

### Requirement: Quỹ lương và phân bổ chi phí
Hệ thống SHALL tổng hợp quỹ lương theo cơ sở và đơn vị và lập bảng phân bổ chi phí theo cost center và tài khoản 622/642 gồm chi phí lương, BH phần doanh nghiệp, KPCĐ và tổng chi phí; nhân sự nhiều đơn vị trong kỳ MUST được phân bổ theo tỷ lệ ngày công từng đoạn. Hệ thống MUST chỉ xuất tệp, không đẩy sang ERP.

#### Scenario: Hai cost center (UAT-21)
- **WHEN** nhân viên làm 9 ngày ở cost center A và 17 ngày ở cost center B
- **THEN** chi phí của nhân viên được chia theo tỷ lệ 9/26 và 17/26

### Requirement: Báo cáo BH và thuế
Hệ thống SHALL cung cấp bảng trích BH phần NLĐ, DN và KPCĐ, danh sách tăng/giảm/điều chỉnh, đối chiếu C12, bảng thuế TNCN khấu trừ hiển thị ngày chi, kỳ thuế, nhánh khấu trừ, bộ quy tắc và phần miễn/chịu theo khoản và phân biệt số dự kiến với số thực tế, tổng hợp quyết toán theo năm chi trả, báo cáo tình hình sử dụng lao động và số liệu OT 200–300 giờ/năm.

#### Scenario: Thuế theo năm chi
- **WHEN** KT xuất bảng thuế khấu trừ tháng 01/2026
- **THEN** khoản lương công tháng 12/2025 chi ngày 09/01/2026 nằm trong tháng 01/2026 với bộ quy tắc 2026

#### Scenario: Chuyển tiếp 2026
- **WHEN** KT xuất báo cáo thuế của 6 tháng đầu 2026
- **THEN** số đã khấu trừ/khai theo bộ cũ được giữ nguyên và điều chỉnh dẫn về hồ sơ gốc
