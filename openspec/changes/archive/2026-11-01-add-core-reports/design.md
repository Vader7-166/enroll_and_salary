## Context

Docs 13 liệt kê mẫu biểu và 9 quy tắc chung (§6). Dữ liệu kỳ khóa nằm trong snapshot (công, lương). `exceljs` đã có; PDF dùng thư viện chung với phiếu lương. Quyền theo role + scope + exclusion; AD không xem lương chi tiết.

## Goals / Non-Goals

**Goals:**
- Một khung báo cáo dùng chung, mỗi báo cáo chỉ khai báo truy vấn + cột.
- Kỳ khóa in lại sau nhiều tháng vẫn khớp số (đọc snapshot).
- Báo cáo tháng toàn công ty ≤ 2 phút (NFR-12).

**Non-Goals:**
- Không có trình tạo báo cáo tùy biến hay dashboard lãnh đạo (docs 13 §6 quy tắc 9).
- Không đẩy dữ liệu sang ERP/cơ quan.

## Decisions

1. **Registry báo cáo**: mỗi báo cáo là `ReportDefinition { type, roles, permission, scopeKind, params schema, query(ctx), columns, sensitiveColumns }`. Khung xử lý quyền, phạm vi, exclusion, che cột, nhãn trạng thái, audit, renderer; báo cáo chỉ viết truy vấn.
2. **Nguồn dữ liệu theo trạng thái kỳ**: kỳ LOCKED → snapshot (`attendance_period_lock_event`, `payroll_snapshot`) và nhãn Chính thức; kỳ chưa khóa → dữ liệu hiện hành và nhãn Nháp. Không trộn hai nguồn trong một báo cáo mà không ghi rõ.
3. **Cây tổ chức theo kỳ**: truy vấn `org_unit_version` hiệu lực tại ngày cuối kỳ báo cáo (FR-1.2.2) để nhóm và gán tên.
4. **Kết xuất lớn chạy nền**: tạo `report_run` trạng thái RUNNING, render ra tệp tạm, trả link tải; cảnh báo và ghi log khi vượt `REPORT_ROW_WARNING_THRESHOLD`.
5. **Sổ quản lý lao động** ánh xạ 20 tiêu chí tới nguồn dữ liệu cụ thể; tiêu chí chưa có dữ liệu (đào tạo, kỷ luật, TNLĐ) để trống có ghi chú nguồn thay vì bịa.

## Risks / Trade-offs

- [Truy vấn snapshot JSON chậm] → trích bảng phẳng phục vụ báo cáo khi khóa kỳ (materialize), vẫn giữ snapshot làm nguồn sự thật.
- [Nhiều báo cáo phụ thuộc change chưa xong] → registry ẩn báo cáo khi nguồn chưa có, không trả số 0.

## Migration Plan

Migration `report_run` và index. Báo cáo được bật dần theo change nguồn.

## Open Questions

- Mẫu "tình hình sử dụng lao động" 6 tháng theo biểu mẫu hiện hành nào? Dùng mẫu cấu hình cột, xác nhận sau.
