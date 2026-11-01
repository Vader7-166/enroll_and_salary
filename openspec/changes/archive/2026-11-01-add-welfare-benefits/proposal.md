## Why

Phúc lợi 9.x thuộc nghiệm thu R1 (19 §1, R1-AC-09) nhưng chưa có: danh mục và điều kiện hưởng (FR-9.1.1…9.1.3), cấp phát có danh sách dự kiến và chống trùng (FR-9.2.1, 9.2.2, UAT-28), và theo dõi chi phí phúc lợi gồm cả trợ cấp thôi việc/mất việc (FR-9.4.1).

## What Changes

- **Danh mục phúc lợi** theo hiệu lực: bảo hiểm sức khỏe tự nguyện, khám sức khỏe, ăn ca, xe đưa đón, điện thoại, đồng phục, quà lễ Tết/sinh nhật, hiếu hỉ, du lịch, đào tạo, hỗ trợ nhà ở, nuôi con nhỏ; mỗi khoản có mức hưởng, cờ tính thuế/miễn theo định mức, cờ đưa vào bảng lương.
- **Điều kiện hưởng** khai báo bằng dữ liệu: thâm niên, cấp bậc/chức danh, loại HĐ, đơn vị.
- **Cấp phát**: chọn phúc lợi, kỳ, đối tượng → lọc nhân viên đủ điều kiện → danh sách dự kiến; KT thêm/bớt, hệ thống kiểm tra lại; xác nhận → kiểm tra trùng `(phúc lợi, nhân viên, kỳ)` và ghi nhận từng người; khoản liên quan lương đưa vào kỳ lương; danh sách chưa xác nhận vẫn là dự kiến.
- **Chi phí phúc lợi** tổng hợp theo đơn vị/cost center, kỳ, loại, gồm trợ cấp thôi việc/mất việc; xuất tệp.

## Capabilities

### New Capabilities
- `welfare-benefits`: danh mục và điều kiện hưởng theo hiệu lực, cấp phát dự kiến/xác nhận chống trùng, đưa vào lương và báo cáo chi phí phúc lợi.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** module mới `backend/src/welfare/`; stage engine đọc phúc lợi đã xác nhận gắn kỳ lương.
- **Database:** `benefit_catalog`, `benefit_catalog_version`, `benefit_allocation_batch`, `benefit_allocation` (unique catalog+employee+period).
- **API:** `/api/welfare/catalog`, `/api/welfare/allocations`, `/api/welfare/costs`.
- **Phụ thuộc:** `add-payroll-calculation-engine` (đưa vào lương), `add-contract-alerts-and-termination` (trợ cấp vào chi phí).
