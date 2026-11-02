## Context

`employee` có mã, họ tên, giới tính, ngày sinh, quốc tịch, ngày vào/nghỉ. Hợp đồng đã mã hóa lương bằng `contract-crypto.ts` (AES-256-GCM với `HR_DATA_KEY`). Quyền dữ liệu đi theo role + scope + exclusion; AD không được xem lương chi tiết.

## Goals / Non-Goals

**Goals:**
- Đủ dữ liệu hồ sơ cho BH, thuế, chi lương với lịch sử hiệu lực.
- Trường nhạy cảm mã hóa khi lưu, che khi trả về nếu thiếu quyền.
- Kiểm tra trùng MST/số sổ BHXH dù giá trị được mã hóa.

**Non-Goals:**
- Không xây quy trình tuyển dụng hay ESS cho công nhân.
- Không kiểm tra MST với cơ quan thuế (không tích hợp ngoài, theo 19 §2).
- Không làm cảnh báo giấy tờ hết hạn (FR-2.1.6 thuộc backlog S).

## Decisions

1. **Bảng riêng thay vì thêm cột vào `employee`.** Định danh/ngân hàng/thuế có lịch sử hiệu lực và quyền riêng; tách bảng giúp áp quyền đọc theo bảng và tránh select nhầm trường nhạy cảm ở danh sách nhân viên.
2. **Mã hóa + blind index.** Lưu `*_cipher` (AES-256-GCM) cho CCCD và số tài khoản; lưu `*_hash` = HMAC-SHA256(giá trị chuẩn hóa, khóa dẫn xuất từ `HR_DATA_KEY`) để kiểm tra trùng và tìm kiếm chính xác. MST và số sổ BHXH không thuộc FR-X.1 nhưng vẫn lưu hash unique để chặn trùng.
3. **Hiệu lực không chồng.** `tax_profile`, `employee_special_status`, `employee_bank_account` dùng `effective_from/effective_to`; bản mới đóng bản cũ trong cùng giao dịch, giống mẫu phương án lương; DB trigger chặn sửa/xóa lịch sử.
4. **NPT theo tháng.** `employee_dependent` lưu `deduction_from_month` và `deduction_to_month` (YYYY-MM), mã số thuế NPT, quan hệ, chứng từ. Bộ tính thuế đếm số NPT đủ điều kiện theo tháng của kỳ thuế.
5. **Che trường theo quyền.** Service trả `masked: true` và giá trị che (vd `******1234`) khi người gọi thiếu quyền `employee.sensitive.read`; AD luôn bị che. Mỗi lần đọc giá trị đầy đủ ghi audit (NFR-36).

## Risks / Trade-offs

- [Xoay `HR_DATA_KEY` làm hỏng blind index] → dẫn xuất khóa HMAC có `keyVersion`; quy trình xoay khóa (FR-X.2) nằm trong `add-r1-acceptance-hardening`.
- [Nhập liệu nhiều trường làm chậm KT] → hỗ trợ nhập CSV cho định danh/ngân hàng ở đợt sau nếu cần; R1 tối thiểu là biểu mẫu.

## Migration Plan

Migration thêm bảng mới; nhân viên cũ chưa có dữ liệu sẽ bị engine lương/BH/thuế báo thiếu (`PAYROLL_PROFILE_MISSING`) thay vì mặc định. Seed bổ sung dữ liệu mô phỏng cho nhân viên demo.

## Open Questions

- Danh mục ngân hàng (FR-1.4.2) đã có chưa? Nếu chưa, thêm danh mục tối thiểu trong change này.

> Đã chốt khi triển khai: chưa có danh mục ngân hàng nên thêm bảng `bank` tối thiểu (SIMULATION). MST và số sổ BHXH cũng được mã hóa để đồng nhất cách lưu.
