## ADDED Requirements

### Requirement: Phiếu lương từ bảng lương đã khóa
Hệ thống SHALL cho KT xuất phiếu lương từng nhân viên chỉ từ bảng lương đã khóa, dựng từ snapshot, gồm lương cứng, phụ cấp từng khoản, lương OT, phụ cấp ca đêm, thưởng, BH bắt buộc, thuế TNCN, khấu trừ, điều chỉnh có kỳ gốc, thực lĩnh, và đơn vị cùng số công từng đoạn.

#### Scenario: Kỳ chưa khóa (UAT-01)
- **WHEN** KT xuất phiếu lương của kỳ chưa khóa
- **THEN** hệ thống từ chối với lỗi kỳ chưa khóa

#### Scenario: Điều chuyển giữa kỳ (UAT-21)
- **WHEN** nhân viên có hai đoạn đơn vị trong kỳ
- **THEN** phiếu lương ghi rõ đơn vị và số công từng đoạn

### Requirement: Bảo mật phiếu lương
Mỗi phiếu lương PDF SHALL là một tệp riêng, được đặt mật khẩu mở tệp theo quy tắc cấu hình; hệ thống MUST NOT lưu mật khẩu và MUST ghi audit mỗi lần xuất.

#### Scenario: Xuất có mật khẩu (UAT-01)
- **WHEN** KT xuất phiếu lương kỳ 08/2026 đã khóa
- **THEN** mỗi người một PDF yêu cầu mật khẩu khi mở và audit ghi lần xuất

### Requirement: Xuất hàng loạt
Hệ thống SHALL xuất phiếu lương cho toàn bộ một cơ sở dưới dạng gói nén, hiển thị tiến độ, ghi lỗi từng tệp mà không hủy cả lô, và hoàn tất khoảng 1.100 tệp trong không quá 10 phút.

#### Scenario: Một tệp lỗi
- **WHEN** một nhân viên thiếu dữ liệu để tạo mật khẩu
- **THEN** tệp đó được ghi lỗi, các tệp khác vẫn có trong gói, dữ liệu nghiệp vụ không đổi
