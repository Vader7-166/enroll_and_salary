## Context

`legal_parameter` có `applicationBasis` gồm `WORK_DATE`, `TAX_YEAR`, `PAYMENT_DATE`, nhưng chưa có tham số thuế. Docs 06 §7–8, 04 BR-52…56 và 12 §2.7 mô tả đầy đủ thuật toán và ma trận hiệu lực; TC-T01…T13 là bộ đối chứng bắt buộc. Kỳ thuế được xác định theo thời điểm chi trả, độc lập với kỳ công và kỳ lương.

## Goals / Non-Goals

**Goals:**
- Kết quả đúng toàn bộ TC-T01…T13 và TC-P03 bằng Decimal.
- Không hardcode mức giảm trừ, bậc, ngưỡng, định mức (NFR-20).
- Tái hiện khoản đã khai bằng snapshot, không tính lại theo luật mới.

**Non-Goals:**
- Không kê khai điện tử, không phát hành chứng từ khấu trừ.
- Không làm quyết toán năm (thuộc `add-annual-tax-finalization`), chỉ lưu dữ liệu nó cần.

## Decisions

1. **Ruleset là một đơn vị phiên bản.** `tax_ruleset(code, subject: RESIDENT_PROGRESSIVE|RESIDENT_FLAT_10|NON_RESIDENT, effective_from/to theo kỳ thuế hoặc ngày chi, exemption_mode, settings JSON, legal_basis)` + `pit_bracket(ruleset, basis MONTH|YEAR, bracket_no, from, to, rate)`. Gom theo ruleset giúp chọn một lần đúng toàn bộ thông số và lưu snapshot gọn. Phương án để từng tham số rời trong `legal_parameter` bị loại vì dễ chọn lệch phiên bản giữa các tham số.
2. **`selectTaxContext(profile, paymentDate, paymentDateStatus, mode)`** trả `{taxPeriod, subject, ruleset, paymentDate, status, version, basis, mode}`; mốc chuyển khác nhau theo đối tượng (cư trú từ kỳ thuế 2026; không cư trú từ 01/07/2026; ăn ca từ 01/07/2026) được biểu diễn bằng hiệu lực riêng của từng ruleset/định mức, không bằng `if` theo năm.
3. **Đầu vào là các khoản thu nhập đã phân loại**, không phải một con số tổng: `[{sourceRef, kind (SALARY_BASE, OT, NIGHT_REGULAR, NIGHT_BASE_PORTION, MEAL, UNUSED_LEAVE_PAY…), amountPaid, basePortion?, eligibleAmount?, evidenceRef?}]`. Bóc tách miễn thuế chạy trên từng khoản; lương gốc giờ đêm được tách khỏi lương thời gian một lần (TC-T06) để không đếm trùng.
4. **Ba nhánh là ba hàm** `progressive()`, `flat10()`, `nonResident20()`; chỉ `progressive()` dùng giảm trừ. `flat10()` so ngưỡng trên **số tiền mỗi lần trả**, kiểm tra cam kết/yêu cầu tự nguyện.
5. **`tax_withholding` bất biến sau khi bảng lương khóa.** Trạng thái `PROJECTED`/`ACTUAL` theo ngày chi; khoản đã khai có `filing_status` và không bị ghi đè; điều chỉnh tạo bản ghi mới liên kết `original_withholding_id`.
6. **Gross-up chia đôi** trên hàm `netFromGross` dùng cùng bộ tính BH và thuế; cận trên = NET × 2; tối đa 100 vòng; dừng khi |net − mục tiêu| ≤ 1 đồng.
7. **Trần năm khoản y tế/giáo dục** theo dõi bằng `tax_deduction_usage(employee, year, kind, used_amount)` cập nhật khi bảng lương khóa; tính nháp chỉ đọc.

## Risks / Trade-offs

- [Văn bản 2026 có thể thay đổi chi tiết] → mọi số nằm trong ruleset có căn cứ và nhãn SIMULATION/VERIFIED; đổi bằng phiên bản mới.
- [Xác định "đủ điều kiện Điều 26" cần chứng từ] → khoản thiếu `eligibleAmount`/chứng từ trả ngoại lệ `TAX_EXEMPTION_EVIDENCE_MISSING`, chặn duyệt nhưng không chặn tính nháp.
- [Gross-up chậm với 3.000 NV] → hàm thuần, cache ruleset trong một lần chạy lô; đo trong NFR-07.

## Migration Plan

Migration tạo bảng và seed hai bộ quy tắc mô phỏng. Không ảnh hưởng dữ liệu hiện có.

## Open Questions

- Mẫu cam kết tạm không khấu trừ theo bộ 2026: dùng mã mẫu nào trong dữ liệu mô phỏng? Lưu dạng tham chiếu văn bản cho đến khi có mẫu thật (PS ở docs 18).

> Đã chốt khi triển khai: định mức ăn ca dùng `legal_parameter` với căn cứ `PAYMENT_DATE` thay vì bảng riêng; cam kết tạm không khấu trừ lấy từ `tax_profile.commitment_reference`; bậc năm (YEAR) seed bằng bậc tháng × 12 cho quyết toán.
