## ADDED Requirements

### Requirement: Quyết định thay đổi lương có hiệu lực
Hệ thống SHALL cho KT lập quyết định thay đổi lương gồm số, ngày quyết định, ngày hiệu lực, lý do, căn cứ và mức mới theo từng cấu phần. Lưu quyết định MUST đóng dòng lương cùng cấu phần trước đó đến ngày trước hiệu lực mới, trong cùng giao dịch; lịch sử MUST NOT bị sửa hoặc xóa cứng.

#### Scenario: Tăng lương giữa kỳ (TC-P02)
- **WHEN** quyết định tăng lương có hiệu lực ngày 15 trong kỳ
- **THEN** dòng thời gian lương của kỳ có hai đoạn đơn giá: trước ngày 15 và từ ngày 15

#### Scenario: Trùng ngày hiệu lực
- **WHEN** KT lập quyết định thứ hai cùng cấu phần cùng ngày hiệu lực
- **THEN** hệ thống trả lỗi chỉ ra quyết định đã tồn tại

### Requirement: Dòng thời gian lương theo đoạn
Hệ thống SHALL trả dòng thời gian lương của nhân viên trong một khoảng ngày gồm các đoạn không chồng, mỗi đoạn có cấu phần, số tiền, nguồn (CONTRACT hoặc DECISION) và mã quyết định. Khi chưa có quyết định, đoạn gốc MUST lấy từ hợp đồng/phụ lục đang hiệu lực.

#### Scenario: Chưa có quyết định
- **WHEN** nhân viên chỉ có hợp đồng lương 8.000.000 đ
- **THEN** timeline trả một đoạn nguồn CONTRACT 8.000.000 đ cho toàn khoảng hợp đồng hiệu lực

### Requirement: Đoạn đơn vị để phân bổ chi phí
Hệ thống SHALL trả các đoạn đơn vị công tác của nhân viên trong kỳ kèm cơ sở, vùng lương và cost center để phân bổ chi phí theo tỷ lệ ngày công.

#### Scenario: Điều chuyển giữa kỳ (TC-P07)
- **WHEN** nhân viên chuyển từ NM Bắc Ninh sang NM Nghệ An ngày 10
- **THEN** hệ thống trả hai đoạn với vùng I và vùng III và cost center tương ứng

### Requirement: Phát hiện quyết định hồi tố
Khi quyết định có ngày hiệu lực rơi vào kỳ lương đã khóa, hệ thống SHALL tạo ứng viên hồi tố liệt kê từng kỳ bị ảnh hưởng ở trạng thái chờ xử lý và cảnh báo KT. Kỳ đã khóa MUST NOT bị thay đổi.

#### Scenario: Hai kỳ đã khóa (UAT-11)
- **WHEN** quyết định tăng lương hiệu lực 01/08/2026 được nhập ngày 05/10/2026 khi kỳ 08 và 09 đã khóa
- **THEN** hệ thống tạo ứng viên hồi tố cho kỳ 08 và 09 và hiển thị cảnh báo hồi tố

### Requirement: Cảnh báo giảm lương khi điều chuyển liên vùng
Hệ thống SHALL cảnh báo `CROSS_REGION_SALARY_DECREASE` khi điều chuyển sang cơ sở có vùng lương thấp hơn đi kèm giảm lương thỏa thuận, và MUST yêu cầu KT xác nhận có lý do trước khi lưu.

#### Scenario: Điều chuyển kèm giảm lương (TC-P08)
- **WHEN** KT lưu điều chuyển từ vùng I sang vùng III kèm quyết định giảm lương cùng ngày
- **THEN** hệ thống hiển thị cảnh báo BR-08 và chỉ lưu khi có lý do xác nhận, ghi audit
