## Context

`tax_withholding` lưu từng lần chi với ngày chi, trạng thái PROJECTED/ACTUAL, snapshot quy tắc, thu nhập, miễn, giảm trừ, thuế và `filing_status`. `pit_bracket` có biểu `basis = YEAR`. `tax_deduction_usage` theo dõi trần năm. Hồ sơ thuế có cờ ủy quyền quyết toán.

## Goals / Non-Goals

**Goals:**
- Kết quả năm đúng TC-T10 và dùng ngưỡng năm.
- Không sửa bất kỳ bản ghi khấu trừ/khai lịch sử nào.

**Non-Goals:**
- Không nộp tờ khai, không phát hành chứng từ khấu trừ.
- Không quyết toán cho cá nhân tự quyết toán (chỉ liệt kê).

## Decisions

1. **Nhóm theo năm của `payment_date` ACTUAL**; bản ghi PROJECTED chặn hoàn tất dự thảo (cảnh báo `PROJECTED_PAYMENT_IN_YEAR`).
2. **Thuế năm** = biểu năm của bộ quy tắc hiệu lực cho năm thuế áp lên (Σ chịu thuế − Σ giảm trừ năm), giảm trừ bản thân × số tháng đủ điều kiện theo bộ quy tắc, NPT theo tháng; không áp bảng tháng lên tổng năm.
3. **Chuyển tiếp** biểu diễn bằng dòng `annual_tax_finalization_line(kind=WITHHELD_ORIGINAL)` tham chiếu bản ghi gốc với số đã khấu trừ thực tế; chênh lệch = thuế năm − Σ đã khấu trừ.
4. **Dự thảo bất biến khi DONE**; tính lại tạo phiên bản mới.
5. **Xuất** bằng `exceljs` theo mẫu cấu hình (tờ khai tổng hợp + phụ lục theo người).

## Risks / Trade-offs

- [Nhân viên làm nhiều nơi] → chỉ lập cho người đủ điều kiện ủy quyền theo hồ sơ thuế; người khác liệt kê lý do.
- [Mẫu tờ khai thay đổi] → mẫu cột cấu hình theo phiên bản.

## Migration Plan

Migration bảng mới. Không đổi dữ liệu khấu trừ.

## Open Questions

- Điều kiện ủy quyền chi tiết theo bộ 2026 cần xác nhận; R1 dùng cờ ủy quyền trong hồ sơ thuế kèm tham chiếu văn bản.
