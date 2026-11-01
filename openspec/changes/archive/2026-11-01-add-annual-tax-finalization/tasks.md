## 1. Dữ liệu

- [x] 1.1 Migration `annual_tax_finalization` (năm, nhân viên, tổng thu nhập, giảm trừ, đã khấu trừ, phải nộp, chênh lệch, status, phiên bản) và `annual_tax_finalization_line`
- [x] 1.2 Seed biểu năm cho bộ 2025 và 2026 nếu chưa có

## 2. Backend

- [x] 2.1 Tổng hợp theo năm chi trả từ `tax_withholding` ACTUAL; đếm tháng giảm trừ bản thân/NPT; trần năm khoản khác
- [x] 2.2 Tính thuế năm theo biểu năm và chênh lệch
- [x] 2.3 Dòng chuyển tiếp giữ số đã khấu trừ gốc 6 tháng đầu 2026
- [x] 2.4 Lọc ủy quyền, liệt kê người không đủ điều kiện; kiểm tra khoản dự kiến và `TAX_CONTEXT_CHANGED`
- [x] 2.5 Xuất Excel tờ tổng hợp + phụ lục theo mẫu cấu hình, audit
- [x] 2.6 Integration test `backend/test/tax-finalization.test.cjs` (TC-T10, nhóm theo năm chi, khoản dự kiến chặn); script `verify:tax-finalization`

## 3. Giao diện và tài liệu

- [x] 3.1 Màn hình quyết toán năm: tổng hợp, danh sách lỗi dữ liệu, xuất
- [x] 3.2 Cập nhật README và docs/20
