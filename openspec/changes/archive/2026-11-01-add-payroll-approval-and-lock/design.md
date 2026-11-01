## Context

Mẫu khóa nguyên tử đã có ở kỳ công (`period-lock.service.ts`): kiểm tra revision trong giao dịch, snapshot JSON chuẩn hóa (`canonical()`), hash SHA-256, sự kiện bất biến. `PayrollPeriod` có trạng thái OPEN/LOCKED và ngày chi dự kiến. Engine ghi `payroll_sheet` với `source_hash`.

## Goals / Non-Goals

**Goals:**
- Khóa là thao tác một chiều, nguyên tử, kiểm chứng được bằng hash.
- Mọi thay đổi nguồn sau duyệt đều đưa bảng về nháp, không bỏ sót.

**Non-Goals:**
- Không ký duyệt lãnh đạo trong hệ thống (thực hiện ngoài trên bản kết xuất, BR-43).
- Không mở khóa lại kỳ đã khóa (FR-1.5.3); điều chỉnh sau khóa thuộc 7.4.

## Decisions

1. **Phát hiện nguồn đổi bằng hash thay vì chỉ sự kiện.** Khi duyệt, lưu `approved_source_hash`. Khi khóa và khi xem bảng, loader tính lại hash nguồn; khác hash ⇒ về DRAFT. Thêm sự kiện từ service nguồn (đầu vào lương, phương án, quyết định lương, mức BH, ruleset) để về nháp ngay và thông báo; hash là lưới an toàn nếu bỏ sót sự kiện.
2. **Tái dùng mẫu khóa kỳ công.** `canonical()` + SHA-256 cho `payroll_snapshot.content`; khóa hàng `payroll_sheet` và `payroll_period` `FOR UPDATE`, kiểm tra revision, ghi snapshot, cập nhật trạng thái, ghi audit trong một giao dịch.
3. **Bất biến bằng trigger.** Sau LOCKED, trigger chặn UPDATE/DELETE trên `payroll_line`, `payroll_employee`, `payroll_line_input`, `insurance_contribution`, `tax_withholding` thuộc bảng đã khóa (giống bảng phiên bản hiện có).
4. **Xác thực lại** bằng endpoint xác minh mật khẩu trả token ngắn hạn (5 phút) gắn phiên; thao tác khóa yêu cầu token này.
5. **Cảnh báo hạn chi** tính khi đọc danh sách kỳ lương và trong thông báo ứng dụng (khi `add-audit-search-and-in-app-notifications` có): số ngày còn lại ≤ tham số `PAYROLL_DUE_WARNING_DAYS`.
6. **PDF bằng chứng tuân thủ** dựng từ snapshot (không tính lại), gồm thời điểm/người khóa, hash, kết quả từng CP và tham số pháp lý đã áp dụng.

## Risks / Trade-offs

- [Tính hash nguồn tốn thời gian khi xem bảng lớn] → cache hash theo `source_version` của từng nguồn; tính đầy đủ chỉ khi duyệt/khóa.
- [Kỳ khởi tạo không có kỳ trước] → cờ `is_initial` trên kỳ lương đầu tiên của cơ sở, chỉ AD/KT đặt khi tạo.

## Migration Plan

Migration thêm bảng/cột và trigger. Kỳ lương chưa có bảng lương không bị ảnh hưởng.

## Open Questions

- Có cần cho phép khóa từng phần (theo đơn vị) trong một cơ sở không? Đề xuất: không, khóa theo kỳ + cơ sở như docs 09.
