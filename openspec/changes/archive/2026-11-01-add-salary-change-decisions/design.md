## Context

`employment_contract` lưu lương hợp đồng mã hóa (`salary_cipher`), `contract_annex` lưu nội dung phụ lục mã hóa, `personnel_transfer` lưu điều chuyển đơn vị theo ngày hiệu lực. Cấu phần lương (`salary_component`) và phương án lương nhân viên đã có theo hiệu lực. Docs 09 §8 dự kiến bảng `employee_salary` gắn `salary_decision_id`.

## Goals / Non-Goals

**Goals:**
- Một nguồn lương theo cấu phần và hiệu lực, engine tách đoạn được.
- Phát hiện kỳ lương khóa bị ảnh hưởng ngay khi lưu quyết định.

**Non-Goals:**
- Không tính chênh lệch truy lĩnh (thuộc `add-bonus-and-retroactive-adjustments`).
- Không làm thang/ngạch/bậc nâng cao (FR-7.1.5, backlog).

## Decisions

1. **Quyết định → dòng lương.** Mỗi `salary_decision` sinh một hoặc nhiều `employee_salary(component, amount_cipher, effective_from, effective_to)`. Dòng mới đóng dòng cũ cùng cấu phần trong cùng giao dịch; lịch sử bất biến (trigger như các bảng phiên bản hiện có).
2. **Khởi tạo từ hợp đồng.** Khi nhân viên chưa có `employee_salary`, timeline dùng lương hợp đồng/phụ lục đang hiệu lực làm đoạn gốc với nguồn `CONTRACT`; không sao chép hàng loạt để tránh hai nguồn sự thật.
3. **Phát hiện hồi tố khi lưu.** Nếu `effective_from` ≤ `date_to` của bất kỳ kỳ lương LOCKED của cơ sở nhân viên, tạo `retro_candidate(decision, payroll_period, status=PENDING)`. Trước khi có bảng lương khóa (change engine chưa xong), truy vấn trả rỗng; không chặn lưu quyết định.
4. **BR-08 khi điều chuyển.** Khi lưu điều chuyển đổi cơ sở sang vùng có mức tối thiểu thấp hơn và có quyết định lương cùng ngày làm giảm tổng lương, trả cảnh báo `CROSS_REGION_SALARY_DECREASE`; KT phải xác nhận kèm lý do để lưu, audit ghi lại.
5. **Đoạn đơn vị cho phân bổ.** Timeline trả cả đoạn đơn vị (từ `org_assignment`/`personnel_transfer`) với cost center kế thừa từ phòng/phân xưởng (FR-1.2.1) để engine phân bổ chi phí.

## Risks / Trade-offs

- [Lương hợp đồng và quyết định lệch nhau] → quyết định mới luôn được ưu tiên từ ngày hiệu lực; timeline ghi rõ nguồn từng đoạn.
- [Nhiều quyết định cùng ngày hiệu lực] → unique (employee, component, effective_from); quyết định sau phải chọn ngày khác hoặc thay thế có liên kết.

## Migration Plan

Migration thêm bảng; dữ liệu cũ không cần chuyển vì timeline đọc hợp đồng làm đoạn gốc.

## Open Questions

- Ngưỡng "giảm lương" so sánh theo tổng cấu phần insurable hay tổng lương thỏa thuận? Đề xuất: tổng lương thỏa thuận theo hợp đồng.

> Đã chốt khi triển khai: so sánh BR-08 theo lương thỏa thuận (dòng không gắn cấu phần), đặt module riêng `salary-decisions` và API dưới `/api/employees/:id/...`.
