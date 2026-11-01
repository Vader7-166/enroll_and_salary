## Context

Các khoảng trống được phát hiện tự động: `node scripts/fr-coverage.cjs` (trạng thái PARTIAL lấy từ `docs/acceptance/function-map.json` → `gaps`) và `npm run benchmark:attendance` (NFR-13). Change này đóng chúng mà không đổi hành vi đã nghiệm thu bằng test.

## Goals / Non-Goals

**Goals:** đưa FR-1.4.2, FR-2.1.3, FR-X.3 về MAPPED có test; NFR-13 đạt trên máy đo chuẩn.

**Non-Goals:** đồng bộ danh mục hành chính từ nguồn ngoài; sửa lịch sử đã khóa; đổi thuật toán ghép công.

## Decisions

1. **Danh mục có hiệu lực** theo mẫu `*_version` hiện có (effective_from/to, không chồng); mã hành chính lưu nguyên văn, tên theo phiên bản để báo cáo kỳ cũ hiển thị đúng tên tại kỳ.
2. **Quá trình công tác là view đọc**, ghép từ `employee` (ngày vào), `employment_contract` (loại, ngày), `org_assignment` (điều chuyển), `salary_change_decision` (chỉ hiện số tiền khi có quyền xem lương), `termination_decision`. Không thêm bảng ghi riêng để tránh hai nguồn sự thật.
3. **Xóa mềm**: danh sách cho phép nằm trong `scripts/lint-compliance.cjs` (luật `hard-delete`) kèm lý do; bảng nghiệp vụ dùng trigger `prevent_delete()` dùng chung. Dòng nháp dựng lại vẫn được xóa vì nguồn sự thật là bản nháp cha có audit.
4. **Nhập công**: tách hai pha trong cùng request — (a) kiểm tra + `INSERT … SELECT unnest(...)` bản ghi thô một lần; (b) ghép theo lô 500 nhân viên-ngày với một truy vấn lịch/ngày công mỗi lô thay vì mỗi lượt. Nếu vẫn vượt ngưỡng, chuyển (b) sang tác vụ nền có trạng thái `PROCESSING` và API trả tiến độ; NFR-13 đo tới lúc trả kết quả kiểm tra + nhận tệp.

## Risks / Trade-offs

- Ghép theo lô có thể đổi thứ tự xử lý lượt trùng → giữ quy tắc “lượt đầu IN, lượt cuối OUT” theo timestamp, chạy lại toàn bộ `verify:attendance`, `verify:corrections`, `verify:team-confirmation`.
- Trigger chặn DELETE trên bảng có job dọn dữ liệu → job phải dùng đánh dấu mềm.
