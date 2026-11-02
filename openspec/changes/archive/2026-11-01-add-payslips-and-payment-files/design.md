## Context

Bảng lương khóa có `payroll_snapshot`. Tài khoản ngân hàng mã hóa nằm ở `employee_bank_account`. Docs 10 §3.3 yêu cầu PDF đặt mật khẩu, không gửi mật khẩu cùng kênh; docs 11 §2 mô tả trường tối thiểu của file chi và cấu hình mẫu theo ngân hàng; mẫu ngân hàng thật chưa có nên dùng mẫu mô phỏng có nhãn.

## Goals / Non-Goals

**Goals:**
- Đầu ra chỉ dựng từ snapshot đã khóa, in lại sau nhiều tháng vẫn khớp.
- Lỗi khi tạo tệp không làm đổi dữ liệu nghiệp vụ (NFR-43).

**Non-Goals:**
- Không gửi email/SMS phiếu lương (email ngoài R1).
- Không gọi API ngân hàng; không đối soát sao kê tự động.

## Decisions

1. **Mật khẩu PDF theo quy tắc cấu hình** (`PAYSLIP_PASSWORD_RULE`, ví dụ ghép mã NV + 4 số cuối CCCD + ngày sinh); hệ thống không lưu mật khẩu, chỉ tính khi tạo tệp. Quy tắc mô phỏng có nhãn SIMULATION.
2. **Xuất hàng loạt bất đồng bộ**: job tạo từng PDF trong thư mục tạm mã hóa, nén zip, trả link tải một lần; tiến độ hiển thị. Lỗi một tệp ghi lại, không hủy cả lô; tạo lại được.
3. **Mẫu file chi là dữ liệu**: `bank_file_template(bank_code, version, columns JSON [field, header, format], split_by_site, file_type)`; field lấy từ tập trường cho phép (mã NV, tên thụ hưởng, số tài khoản, mã ngân hàng, số tiền, nội dung). Thêm ngân hàng chỉ thêm bản ghi.
4. **Lô chi lương** (`salary_payment_batch`) gom các dòng thực lĩnh từ một hoặc nhiều bảng lương khóa, trạng thái EXPORTED → PAID (khi KT ghi ngày chi thực tế). Một nhân viên của một kỳ chỉ thuộc một lô chi hiệu lực.
5. **Đền bù chậm trả** tính khi ghi ngày chi thực tế: `số tiền chậm × số ngày chậm × LATE_PAYMENT_RATE / 365` nếu số ngày chậm so với ngày chi quy định > 15; tạo khoản `LATE_PAYMENT_COMPENSATION` chờ vào kỳ lương mở kế tiếp qua registry stage điều chỉnh của engine.
6. **Ngày chi thực tế và thuế**: cập nhật `tax_withholding.payment_date_status = ACTUAL`; nếu năm thuế của ngày thực tế khác ngày dự kiến, đánh dấu `TAX_CONTEXT_CHANGED` để KT xử lý bằng điều chỉnh, không sửa bảng đã khóa.

## Risks / Trade-offs

- [Thư viện PDF mã hóa yếu] → chọn thư viện hỗ trợ AES-128/256 cho PDF; ghi rõ mức mã hóa trong docs.
- [Đền bù dùng lãi suất thay đổi] → tham số theo hiệu lực tại thời điểm trả (BR-61).

## Migration Plan

Migration bảng mới và seed một mẫu ngân hàng mô phỏng. Không đổi dữ liệu bảng lương.

## Open Questions

- Danh sách ngân hàng chi trả thật (PV2-22) chưa chốt; R1 dùng mẫu mô phỏng.
