## Why

Thuế TNCN là bước 7–8 của bảng lương và là phần dễ sai nhất về pháp lý: kỳ thuế theo **ngày chi trả**, ba nhánh khấu trừ theo cư trú/HĐ, biểu 7 bậc (đến 2025) và 5 bậc (từ 2026), giảm trừ gia cảnh đổi mức, miễn thuế OT/đêm khác nhau giữa bộ 2025 và 2026 (FR-8.4.1…8.4.6; BR-52…56). Hiện chưa có gì. Cần bộ tính thuế độc lập, kiểm chứng đủ TC-T01…T13 trước khi ghép engine lương, cùng gross-up NET→GROSS (FR-8.4.5, BR-56, TC-P03).

## What Changes

- **Bộ quy tắc thuế theo hiệu lực** (`tax_ruleset`): biểu bậc (`pit_bracket` tháng/năm), giảm trừ bản thân/NPT, ngưỡng nhánh 10%, chế độ miễn OT/đêm (`PREMIUM_ONLY` cho bộ 2025, `ELIGIBLE_PAYMENT` cho bộ 2026 cư trú), định mức ăn ca và các khoản miễn khác, căn cứ pháp lý.
- **Chọn ngữ cảnh thuế** theo ngày chi trả thực tế hoặc dự kiến (`PROJECTED`), đối tượng cư trú và HĐ; chế độ `REPLAY_FILED` dùng snapshot gốc (06 §7.0). Thiếu/chồng phiên bản → `TAX_RULESET_INVALID`.
- **Ba nhánh khấu trừ:** lũy tiến từng phần cho cư trú HĐ ≥ 3 tháng; 10% theo ngưỡng mỗi lần trả và cam kết cho cư trú không HĐ/HĐ < 3 tháng; 20% cho không cư trú; không áp giảm trừ cho hai nhánh sau.
- **Bóc tách miễn thuế** theo khoản/đoạn không trùng nguồn; phần miễn + chịu thuế luôn bằng khoản thực trả; thiếu căn cứ → ngoại lệ chặn duyệt.
- **Giảm trừ**: bản thân, NPT đủ điều kiện theo tháng, BH bắt buộc phần NLĐ, hưu trí tự nguyện có trần, từ thiện; khoản y tế/giáo dục bộ 2026 có trần năm và số đã dùng.
- **Gross-up** NET→GROSS bằng chia đôi, sai số ≤ 1 đồng, lỗi `GROSS_UP_NOT_CONVERGED`.
- Bản ghi khấu trừ (`tax_withholding`) dùng chung với bảng lương, không khấu trừ hai lần; số đã khai/nộp không bị ghi đè.

## Capabilities

### New Capabilities
- `pit-rulesets`: bộ quy tắc thuế, biểu bậc, giảm trừ, chế độ miễn và định mức theo hiệu lực; chọn ngữ cảnh theo ngày chi trả.
- `pit-withholding`: tính thuế theo ba nhánh, bóc tách miễn thuế, giảm trừ, gross-up và bản ghi khấu trừ bất biến.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** module mới `backend/src/personal-income-tax/` (engine thuần, ruleset service, controller).
- **Database:** `tax_ruleset`, `pit_bracket`, `tax_deduction_usage` (trần năm), `tax_withholding`, `tax_exemption_line`.
- **Seed:** bộ 2025 và bộ 2026 mô phỏng có căn cứ (NQ 954/2020, Luật 109/2025, NQ 110/2025, NĐ 253/2026, TT 111/2013).
- **API:** `/api/pit/rulesets` (KT), `/api/pit/preview`, `/api/pit/gross-up-preview`.
- **Phụ thuộc:** `add-employee-payroll-profile` (cư trú, NPT, cam kết), `add-social-insurance-calculation` (BH được trừ), `add-overtime-pay` (khoản OT/đêm để bóc tách); dùng bởi engine lương và quyết toán năm.
