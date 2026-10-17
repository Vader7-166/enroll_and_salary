# 09. Mô hình dữ liệu

Mô hình dữ liệu hiện thực hóa **biểu đồ lớp 54 lớp / 10 gói** (tài liệu
`diagrams/class/Biểu đồ lớp - Class diagram.docx`, sơ đồ `diagrams/class/CD-00` … `CD-10`).
Mỗi gói `G1` … `G10` tương ứng một phân hệ BFD; mỗi lớp ánh xạ sang một bảng vật lý (tên
`snake_case`). Một số **bảng phụ trợ** không có lớp riêng (đoạn giờ, snapshot, kết quả kiểm
tra) phục vụ yêu cầu kỹ thuật.

---

## 1. ERD tổng quan

![ERD tổng quan](../diagrams/class/ERD-tong-quan.png)

Mã nguồn: `diagrams/class/src/ERD-tong-quan.mmd`. Ký hiệu: `||` đúng một, `o|` không hoặc
một, `|{` một hoặc nhiều, `o{` không hoặc nhiều.

### 1.1. Ánh xạ lớp → bảng

| Gói | Lớp → bảng |
|---|---|
| G1 Quản trị hệ thống | `CoSo` → `site` · `VungLuong` → `wage_region` · `DonViPhongBan` → `org_unit` · `TaiKhoan` → `user_account` · `VaiTro` → `role` · `PhanQuyen` → `role_assignment` · `ChinhSachCoSo` → `site_policy` · `ThamSoPhapLy` → `legal_parameter` · `KyNghiepVu` → `business_period` · `NhatKyKiemToan` → `audit_log` |
| G2 Hồ sơ và hợp đồng | `NhanVien` → `employee` · `NguoiPhuThuoc` → `dependent` · `HopDongLaoDong` → `labor_contract` · `PhuLucHopDong` → `contract_annex` · `QuyetDinhThayDoiLuong` → `salary_decision` · `QuyetDinhChamDut` → `termination_decision` |
| G3 Ca làm việc | `CaLamViec` → `shift_definition` · `NgayNghiLe` → `holiday_calendar` · `MauXoayCa` → `rotation_pattern` · `LichPhanCa` → `shift_schedule` · `DeXuatDoiCa` → `shift_change_request` |
| G4 Chấm công | `LoNhapChamCong` → `punch_import_batch` · `DuLieuChamCongTho` → `raw_punch` · `ChiTietCongNgay` → `daily_attendance` · `GiaiTrinhNgoaiLe` → `attendance_exception` · `XacNhanCongTo` → `team_timesheet_confirmation` · `BangChamCongThang` → `monthly_timesheet` |
| G5 Làm thêm giờ | `DeXuatOT` → `ot_request` · `ChiTietDeXuatOT` → `ot_request_line` · `TranOT` → `ot_cap` · `GioOTThucTe` → `ot_actual` · `QuyDoiNghiBu` → `comp_time_conversion` |
| G6 Nghỉ phép và chế độ | `LoaiNghi` → `leave_type` · `QuyPhepNam` → `annual_leave_balance` · `DonNghi` → `leave_request` · `HoSoOmDauThaiSan` → `sickness_maternity_record` |
| G7 Tính lương và thưởng | `CoCauLuong` → `salary_structure` · `CongThucLuong` → `component_formula` · `KhoanThuong` → `bonus` · `BangLuongThang` → `payroll_sheet` · `ChiTietLuongNhanVien` → `payroll_employee` · `KhoanMucLuong` → `payroll_line` · `ButToanDieuChinh` → `payroll_adjustment` · `PhieuLuong` → `payslip` |
| G8 Bảo hiểm và thuế | `MucDongBH` → `insurance_rate` · `BangTrichBH` → `insurance_contribution` · `DanhSachBaoTangGiam` → `insurance_change_list` · `BacThueTNCN` → `pit_bracket` · `KhauTruThue` → `tax_withholding` · `QuyetToanThueNam` → `annual_tax_finalization` |
| G9 Phúc lợi | `DanhMucPhucLoi` → `benefit_catalog` · `CapPhatPhucLoi` → `benefit_allocation` · `TroCapThoiViec` → `severance_allowance` |
| G10 Báo cáo | `BaoCao` → `report_run` |

**Bảng phụ trợ:** `job_title`, `job_grade`, `reporting_line`, `org_assignment` (G1 – G2);
`salary_component`, `employee_salary` (G7); `tax_profile` (G8); `attendance_hour_segment`,
`attendance_snapshot`, `crosscheck_result`, `ot_quota_tracking` (G4 – G5); `payroll_snapshot`,
`compliance_check_result` (G7); `notification` (xuyên suốt).

**Không còn trong mô hình** so với phiên bản 1.x: `approval_workflow` / `workflow_instance` /
`workflow_step` (luồng duyệt cố định theo BFD, trạng thái nằm trên từng bảng); `position`,
`headcount_plan` (định biên ngoài phạm vi); vùng chờ `UNMATCHED` của `raw_punch` (tệp sai mã
nhân viên bị từ chối khi nhập); các trạng thái `UNLOCK` và `PAID`.

---

## 2. G1 — Quản trị hệ thống

### 2.1. `site`, `wage_region`, `org_unit` — Cơ sở, vùng lương, đơn vị

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `wage_region` | `code` (I – IV) · `name` | Mức lương tối thiểu tra từ `legal_parameter` theo vùng và ngày |
| `site` | `code` · `name` · `address` · `wage_region_code` | Đơn vị cấp `SITE`; đơn vị nhập dữ liệu chấm công và mở kỳ |
| `org_unit` | `code` · `name` · `parent_id` · `unit_type` (`COMPANY` / `SITE` / `BLOCK` / `DEPARTMENT` / `TEAM`) · `level` (1..5) · `site_id` · `cost_center_code` · `accounting_account` (622 / 642) · `effective_from` / `effective_to` | **Chặn vòng lặp**; mọi thay đổi cấu trúc tạo **phiên bản mới**; vùng lương kế thừa từ `site` |

Truy vấn cây tổ chức luôn nhận tham số ngày và trả về cấu trúc đúng tại ngày đó. Danh mục
`job_title` (`code`, `name`, `job_level` 1–8, `job_grade_id`) và `job_grade` (A–F, số bậc) là
bảng phụ trợ; `reporting_line` (`SOLID` / `DOTTED`) chỉ dùng cho quyền xem báo cáo.

### 2.2. `user_account`, `role`, `role_assignment` — Tài khoản và phân quyền theo đơn vị

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `user_account` | `username` · `password_hash` · `status` · `employee_id` (nullable) | Chỉ cấp cho TT, QĐ, KT, AD |
| `role` | `code` (`TT` / `QD` / `KT` / `AD`) · `name` · `function_permissions` (json) | Bốn vai trò cố định |
| `role_assignment` | `user_account_id` · `role_code` · `scope_org_unit_id` · `effective_from` / `effective_to` | Một tài khoản có thể có nhiều bản ghi; phạm vi suy ra động từ cây đơn vị |

### 2.3. `legal_parameter` — Tham số pháp lý theo khoảng hiệu lực

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `param_code` | string | Ví dụ `MIN_WAGE_MONTH_I`, `PIT_DEDUCTION_SELF`, `OT_RATE_HOLIDAY` |
| `scope_key` | string | Phạm vi áp dụng (toàn hệ thống / theo vùng / theo cơ sở) |
| `value` | decimal / json | Giá trị đơn hoặc cấu trúc |
| `unit` | string | %, đồng, giờ… |
| `effective_from` / `effective_to` | date | **Ràng buộc CSDL chống chồng lấn**; thêm bản mới thì đóng bản cũ (SQ-10) |
| `legal_basis` | string | Số hiệu văn bản, ngày ban hành, điều khoản — **bắt buộc** |
| `created_by` / `created_at` | | |

**Danh mục `param_code` tối thiểu:**

```
MIN_WAGE_MONTH_{REGION}     MIN_WAGE_HOUR_{REGION}
PIT_DEDUCTION_SELF          PIT_DEDUCTION_DEPENDENT   PIT_RATE_NON_RESIDENT   PIT_RATE_SEASONAL
OT_RATE_NORMAL              OT_RATE_WEEKLY_REST       OT_RATE_HOLIDAY
NIGHT_ALLOWANCE_RATE        OT_NIGHT_EXTRA_RATE
UNION_FEE_RATE              UNION_FEE_CAP             LATE_PAYMENT_RATE
MEAL_TAX_FREE_CAP           UNIFORM_TAX_FREE_CAP      PHONE_TAX_FREE_CAP     HOUSING_TAXABLE_RATIO_CAP
PROBATION_MIN_RATIO         DEDUCTION_MAX_RATIO
```

Tỷ lệ, sàn, trần bảo hiểm nằm ở `insurance_rate` (G8); biểu thuế ở `pit_bracket` (G8); trần OT
ở `ot_cap` (G5) — đều có khoảng hiệu lực theo cùng nguyên tắc.

### 2.4. `site_policy` — Chính sách theo cơ sở

`site_id` / `org_unit_id` · `policy_key` (`ROUNDING_RULE`, `CUTOFF_DAY`, `STANDARD_WORKDAYS`,
`LATE_TOLERANCE_MIN`, `OT_RULE_SET`, `SHIFT_MODE`, `PUNCH_FILE_MAPPING`) · `policy_value` (json) ·
`effective_from` / `effective_to`

Kế thừa theo cây, ghi đè từng khóa; khi phân giải trả về **cả giá trị và đơn vị nguồn**.

### 2.5. `business_period` — Kỳ nghiệp vụ

| Trường | Ghi chú |
|---|---|
| `code` | Ví dụ `CONG-NM-BN-2026-09`, `LUONG-NM-BN-2026-09` |
| `period_type` | `ATTENDANCE` (kỳ công) / `PAYROLL` (kỳ lương) |
| `scope_org_unit_id` | Cơ sở / đơn vị |
| `date_from` / `date_to` | Kỳ công mặc định 26/N-1 → 25/N |
| `status` | `OPEN` (Mở) / `CLOSED` (Đã chốt) / `LOCKED` (Đã khóa) |
| `opened_by` / `opened_at` · `locked_by` / `locked_at` | AD mở, KT khóa |
| `pay_date` · `actual_pay_date` | Với kỳ lương: ngày chi quy định và ngày chi thực tế KT ghi nhận (BR-61) |

Ràng buộc: không chồng khoảng ngày trên cùng `(period_type, scope_org_unit_id)`; chỉ mở được
khi kỳ trước cùng loại, cùng phạm vi đã `LOCKED`. **Không có trạng thái mở khóa.**

### 2.6. `audit_log` — APPEND-ONLY

| Trường | Ghi chú |
|---|---|
| `id` | Tăng dần |
| `entity_type` / `entity_id` | Đối tượng bị tác động (`DoiTuong`, `MaDoiTuong`) |
| `action` | `CREATE` / `UPDATE` / `DELETE_SOFT` / `CONFIRM` / `APPROVE` / `CLOSE` / `LOCK` / `VIEW_SENSITIVE` / `ACCESS_DENIED` |
| `actor_id` | Tài khoản thực hiện |
| `occurred_at` | |
| `old_value` / `new_value` | json |
| `reason` | **Bắt buộc** với thao tác sửa công, lương, tham số, hồi tố, chấm dứt HĐ |
| `ip_address` | |
| `reference_code` | Mã giải trình / quyết định / lô nhập liên quan |
| `prev_hash` / `record_hash` | **Chuỗi băm** |

**Ràng buộc tầng CSDL:** tài khoản ứng dụng chỉ có `INSERT` và `SELECT`; `UPDATE` và `DELETE`
bị **thu hồi**. Tác vụ định kỳ kiểm tra tính liên tục của chuỗi băm.

---

## 3. G2 — Hồ sơ và hợp đồng

### 3.1. `employee`

| Nhóm trường | Trường tiêu biểu | Mã hóa |
|---|---|---|
| Định danh | `code`, `full_name`, `gender`, `dob`, `nationality` | – |
| Giấy tờ | `national_id` (CCCD / hộ chiếu) | 🔒 AES-256 |
| Cư trú | `residence_address`, `permanent_address` | – |
| Thuế & BH | `tax_code` (MaSoThue), `social_insurance_no` (SoSoBHXH) | – |
| Ngân hàng | `bank_account_no`, `bank_code` | 🔒 AES-256 |
| Tổ chức | `org_unit_id` (đơn vị chính), `job_title_id` | – |
| Đặc thù | `is_foreigner`, `work_permit_no`, `tax_residency_status`, `is_retiree`, `is_minor` | – |
| Trạng thái | `status`, `hire_date` (NgayVaoLam), `termination_date` (NgayNghiViec), `termination_reason` | – |

Nhân viên **không có tài khoản đăng nhập**. Phân công nhiều đơn vị trong kỳ lưu ở bảng phụ trợ
`org_assignment` (`employee_id`, `org_unit_id`, `is_primary`, `allocation_ratio`,
`salary_decision_id`, `effective_from` / `effective_to`) — tổng `allocation_ratio` trong một kỳ
= 100% (BR-70).

### 3.2. Các bảng còn lại của G2

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `dependent` | `employee_id` · `full_name` · `relationship` · `tax_code` · `national_id` (🔒) · `deduction_from_month` / `deduction_to_month` · `proof_document_id` | Giảm trừ theo **tháng hiệu lực đăng ký** |
| `labor_contract` | `contract_no` · `employee_id` · `contract_type` (`PROBATION` / `FIXED_TERM` / `INDEFINITE` / `UNDER_1M` / `PIECEWORK` / `SERVICE`) · `start_date` / `end_date` · `fixed_term_sequence` · `insurance_eligible` · `contract_salary` (🔒) · `status` · `termination_effective_date` | Cảnh báo khi `fixed_term_sequence` = 2; cảnh báo hết hạn không đổi `status` |
| `contract_annex` | `labor_contract_id` · `content` · `effective_date` | Composition của hợp đồng |
| `salary_decision` | `decision_no` · `employee_id` · `decision_type` (`TRANSFER` / `SALARY_CHANGE`) · `old_value` / `new_value` · `effective_date` · `entered_date` · `is_retroactive` (= `effective_date` < kỳ lương đang mở) | Lưu lịch sử hiệu lực; `is_retroactive` kích hoạt hồi tố (7.4) |
| `termination_decision` | `decision_no` · `labor_contract_id` · `employee_id` · `effective_date` · `reason` · `legal_basis` · `status` (`DRAFT` / `CONFIRMED`) | Xác nhận mới cập nhật HĐ, tạo `severance_allowance`, `insurance_change_list` |

**Sổ quản lý lao động** là view dẫn xuất từ `employee`, `labor_contract`, `insurance_contribution`,
`annual_leave_balance`, `ot_actual` và `salary_decision` — không nhập tay.

---

## 4. G3 — Ca làm việc

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `shift_definition` | `code` · `name` · `start_time` / `end_time` · `crosses_midnight` (**cờ then chốt**, CoQuaNgay) · `break_minutes` · `is_night_shift` · `check_in_window_before` / `after` · `check_out_window_before` / `after` | Ca vắt qua nửa đêm gán công về ngày bắt đầu ca |
| `holiday_calendar` | `date` · `holiday_type` (`PUBLIC_HOLIDAY` / `TET` / `COMPENSATORY_REST` / `WEEKLY_REST`) · `name` · `is_paid` · `substitute_for_date` · `site_id` (nullable) | Phân loại ngày khi tách đoạn giờ (BR-24) |
| `rotation_pattern` | `code` · `name` · `cycle_days` · `shift_sequence` (json) · `min_rest_hours` | Ràng buộc xoay ca |
| `shift_schedule` | `employee_id` · `team_org_unit_id` · `work_date` · `shift_id` · `rotation_pattern_id` · `status` (`DRAFT` / `PENDING` / `APPROVED` / `RETURNED`) · `return_reason` · `created_by` (TT) · `approved_by` (QĐ) | Chỉ `APPROVED` được dùng ghép công |
| `shift_change_request` | `shift_schedule_id` · `employee_id` · `old_shift_id` / `new_shift_id` · `reason` · `status` (`PENDING` / `APPROVED` / `REJECTED`) | Chưa duyệt → giữ lịch hiện hành |

---

## 5. G4 — Chấm công (ba tầng)

### 5.1. `punch_import_batch` và tầng 1 · `raw_punch` (BẤT BIẾN)

| Bảng | Trường chính |
|---|---|
| `punch_import_batch` | `site_id` · `attendance_period_id` · `file_name` · `file_hash` · `imported_by` (AD) · `imported_at` · `record_count` · `error_count` · `status` (`ACCEPTED` / `REJECTED`) · `error_detail` (json danh sách dòng lỗi) |
| `raw_punch` | `id` · `import_batch_id` · `employee_id` · `device_code` · `punch_at` · `punch_type` (`IN` / `OUT` / `AUTO`) · `is_duplicate` · `received_at` |

**Ràng buộc:** `raw_punch` chỉ INSERT và SELECT. Khóa chống trùng
`(device_code, employee_id, punch_at)` bảo đảm nhập lại tệp là idempotent. Lô bị `REJECTED`
không ghi bản ghi nào vào `raw_punch`.

### 5.2. Tầng 2 · `daily_attendance` (DẪN XUẤT)

| Trường | Ghi chú |
|---|---|
| `monthly_timesheet_id` · `employee_id` | |
| `work_date` | **Ngày công** — ca đêm gán về ngày T (BR-13) |
| `shift_id` | Từ lịch ca đã duyệt |
| `day_type` | `NORMAL` / `WEEKLY_REST` / `HOLIDAY` |
| `check_in_at` / `check_out_at` | Từ cặp quẹt đã ghép |
| `worked_hours` · `day_hours` / `night_hours` | Tách theo mốc 22:00 / 06:00 |
| `had_daytime_ot` | **Cờ quyết định 200% vs 210%** (BR-25) |
| `late_minutes` / `early_leave_minutes` | Ghi nhận, **không dùng để trừ lương** |
| `attendance_symbol` | `X` / `Đ` / `Ph` / `L` / `Ô` / `TS` / `Kl` / `ERR` / `KP` |
| `status` | `OK` / `EXCEPTION` / `ADJUSTED` |
| `converted_workday` | Công quy đổi (decimal) |
| `calc_version` | Phiên bản thuật toán đã sinh bản ghi |

**Tính chất:** `daily_attendance = f(raw_punch, shift_schedule đã duyệt, đơn nghỉ và OT đã duyệt,
giải trình, legal_parameter)` — luôn tính lại được từ tầng 1.

Bảng phụ trợ **`attendance_hour_segment`** (`daily_attendance_id`, `segment_from` / `segment_to`,
`hours`, `is_night`, `day_type` của đoạn — có thể khác ngày công, `is_overtime`, `applied_rate`,
`rate_breakdown` json) hiện thực hóa việc **tách bạch "ngày công" và "đoạn giờ"** (ADR-03).

### 5.3. Ngoại lệ, xác nhận và bảng công tháng

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `attendance_exception` | `daily_attendance_id` · `exception_type` (`MISSING_PUNCH` / `LATE` / `EARLY_LEAVE` / `FIELD_WORK` / `DEVICE_FAILURE` / `OT_MISMATCH`) · `reason` · `evidence_attachment_id` · `old_value` / `new_value` · `entered_by` (TT) · `entered_at` | Mỗi điều chỉnh ghi `audit_log` |
| `team_timesheet_confirmation` | `monthly_timesheet_id` · `team_org_unit_id` · `confirmed_by` (TT) · `confirmed_at` · `status` | Chức năng 4.4 |
| `monthly_timesheet` | `attendance_period_id` · `workshop_org_unit_id` · `total_workdays` · `total_ot_hours` · `status` (`DRAFT` / `TEAM_CONFIRMED` / `WORKSHOP_CLOSED` / `LOCKED`) · `closed_by` (QĐ) · `locked_by` (KT) | Bốn trạng thái |

Tầng 3 **`attendance_snapshot`** (`attendance_period_id`, `content` json, `content_hash`,
`locked_at`, `locked_by`): sau khi KT khóa kỳ công, mọi truy vấn bảng công của kỳ trả về từ
snapshot. **`crosscheck_result`** (`monthly_timesheet_id`, `check_code` `XC-01`…`XC-10`,
`severity`, `violation_count`, `detail`, `acknowledged_by`) lưu kết quả đối soát khi QĐ chốt.

---

## 6. G5 — Làm thêm giờ

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `ot_request` | `team_org_unit_id` · `ot_date` · `planned_from` / `planned_to` · `reason` · `consent_reference` (**bắt buộc**) · `proposed_by` (TT) · `approved_by` (QĐ) · `status` (`PENDING` / `APPROVED` / `REJECTED` / `RETURNED`) · `decision_reason` | Đề xuất cho cả tổ |
| `ot_request_line` | `ot_request_id` · `employee_id` · `planned_hours` | Danh sách nhân viên |
| `ot_cap` | `scope` (cơ sở / ngành) · `cap_day` · `cap_month` · `cap_year` · `effective_from` / `effective_to` | Cấu hình, không ghi cứng |
| `ot_actual` | `daily_attendance_id` · `employee_id` · `work_date` · `day_type` · `is_night` · `hours` · `rate_code` · `applied_rate` · `ot_request_id` (nullable) · `match_status` (`MATCHED` / `MISMATCH`) · `amount` · `taxable_amount` · `tax_free_amount` | `hours` = **min**(giờ đề xuất đã duyệt, giờ thực tế) (BR-26) |
| `comp_time_conversion` | `employee_id` · `ot_actual_id` · `converted_hours` · `conversion_ratio` · `expiry_date` · `used_hours` · `performed_by` (KT) · `performed_at` | *Điểm mở Q2*: cách trả tiền phần đã quy đổi |

Bảng phụ trợ **`ot_quota_tracking`** (`employee_id`, `period_type` `DAY` / `MONTH` / `YEAR`,
`period_key`, `accumulated_hours`, `cap_hours`, `warning_threshold`) phục vụ kiểm soát trần (5.3).

---

## 7. G6 — Nghỉ phép và chế độ

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `leave_type` | `code` · `name` · `is_paid` · `counts_as_workday` · `deducts_annual_quota` · `si_paid` · `requires_document` · `max_days` · `attendance_symbol` | AD quản lý (6.1) |
| `annual_leave_balance` | `employee_id` · `year` · `entitled_days` · `carried_over_days` · `carry_over_expiry` · `used_days` · `advance_days` | KT quản lý (6.2); số dư = cấp + chuyển sang − đã nghỉ |
| `leave_request` | `employee_id` · `leave_type_id` · `date_from` / `date_to` · `unit` (`DAY` / `HALF_DAY` / `HOUR`) · `quantity` · `reason` · `attachment_id` · `recorded_by` (TT) · `status` (`PENDING_L1` / `APPROVED_L1` / `REJECTED`) · `decided_by` (TT) | Một cấp duyệt duy nhất |
| `sickness_maternity_record` | `employee_id` · `benefit_type` · `document_no` · `date_from` / `date_to` · `entitled_days` · `benefit_amount_estimate` · `si_paid_amount` | KT theo dõi (6.4) |

Tỷ lệ vắng mặt (6.5) là truy vấn tổng hợp từ `leave_request` và `daily_attendance`, không có
bảng riêng.

---

## 8. G7 — Tính lương và thưởng

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `salary_structure` | `code` · `name` · `effective_from` / `effective_to` | Cơ cấu lương (7.1) |
| `salary_component` *(phụ trợ)* | `code` · `name` · `component_type` (`EARNING` / `DEDUCTION` / `EMPLOYER_COST`) · `is_insurable` · `is_taxable` · `is_prorated` · `is_ot_base` · `display_order` | 3 cờ độc lập (BR-37) |
| `component_formula` | `salary_structure_id` · `salary_component_id` · `expression` (tham chiếu mã tham số) · `depends_on` · `version` · `effective_from` / `effective_to` | Không phụ thuộc vòng |
| `employee_salary` *(phụ trợ)* | `employee_id` · `salary_component_id` · `amount` (🔒) · `effective_from` / `effective_to` · `salary_decision_id` | Tăng lương giữa kỳ → engine tách hai đoạn đơn giá |
| `bonus` | `bonus_type` · `employee_id` / `org_unit_id` · `amount` · `payroll_period_id` · `status` | Chỉ tính khi kỳ có thưởng (7.3) |
| `payroll_sheet` | `payroll_period_id` · `site_id` · `wage_region_code` · `total_fund` · `status` (`DRAFT` / `APPROVED` / `LOCKED`) · `calc_count` · `param_snapshot_hash` · `formula_version_set` · `approved_by` / `locked_by` | Tính lại cùng đầu vào cho cùng kết quả |
| `payroll_employee` | `payroll_sheet_id` · `employee_id` · `base_salary` · `actual_workdays` · `gross_income` · `employee_insurance` · `pit` · `net_pay` (🔒) | Một dòng mỗi nhân viên |
| `payroll_line` | `payroll_employee_id` · `line_type` (`LUONG_NGAY`, `OT_NGAY_THUONG`, `OT_DEM`, `PC_CA_DEM`, `THUONG`, `TRUY_LINH`, `TRUY_THU`…) · `quantity` · `rate` · `amount` (🔒) · `param_code` · `calculation_trace` (json) · `source_reference` | Thay các cột 150% / 210% / 270% / 390% cố định; `calculation_trace` hiện thực drill-down |
| `payroll_adjustment` | `salary_decision_id` · `origin_period_id` (**kỳ gốc**) · `target_period_id` (kỳ mở nhận) · `employee_id` · `adjustment_type` (`RETRO_PAY` / `RETRO_DEDUCT` / `LATE_PAYMENT_COMPENSATION`) · `diff_salary` · `diff_insurance` · `diff_tax` · `status` (`DRAFT` / `CONFIRMED`) · `confirmed_by` (KT) | Kỳ gốc giữ nguyên |
| `payslip` | `payroll_employee_id` · `issued_at` · `issued_by` (KT) · `file_id` · `status` | Không có OTP / PIN |

Bảng phụ trợ **`payroll_snapshot`** (`payroll_sheet_id`, `content`, `content_hash`, `locked_at`,
`locked_by`, `compliance_result_id`) và **`compliance_check_result`** (`payroll_sheet_id`,
`check_code` `CP-01`…`CP-09`, `severity`, `violation_count`, `detail`, `acknowledged_by`) lưu
bằng chứng tuân thủ kèm kỳ lương.

---

## 9. G8 — Bảo hiểm và thuế TNCN

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `insurance_rate` | `wage_region_code` · `insurance_type` (`BHXH` / `BHYT` / `BHTN` / `KPCD`) · `employee_rate` · `employer_rate` · `floor_amount` · `cap_amount` · `effective_from` / `effective_to` | KT cập nhật (8.1) |
| `insurance_contribution` | `payroll_employee_id` · `period_code` · `employee_id` · `insurable_salary` (🔒) · `bhxh_nld` / `bhxh_dn` · `bhyt_nld` / `bhyt_dn` · `bhtn_nld` / `bhtn_dn` · `kpcd_dn` · `union_fee` | Tách NLĐ / DN (8.2) |
| `insurance_change_list` | `period_code` · `employee_id` · `change_type` (`INCREASE` / `DECREASE` / `ADJUST`) · `reason` · `effective_date` · `old_salary` / `new_salary` · `c12_difference` | Danh sách để kê khai (8.3) |
| `pit_bracket` | `bracket_no` · `from_amount` / `to_amount` · `rate` · `effective_from` / `effective_to` | 5 bậc từ 2026; 7 bậc đến hết 2025 |
| `tax_profile` *(phụ trợ)* | `employee_id` · `tax_status` (`RESIDENT` / `NON_RESIDENT` / `SEASONAL`) · `commitment_02ck` · `authorization_for_finalization` | |
| `tax_withholding` | `payroll_employee_id` · `period_code` · `employee_id` · `taxable_income` · `tax_free_income` · `self_deduction` · `dependent_deduction` · `insurance_deduction` · `assessable_income` · `tax_amount` · `bracket_breakdown` (json) | Dùng chung với bảng lương |
| `annual_tax_finalization` | `year` · `employee_id` · `total_income` · `total_deduction` · `tax_withheld` · `tax_due` · `difference` · `status` (`DRAFT` / `DONE`) | Dự thảo hồ sơ (8.5) |

---

## 10. G9 — Phúc lợi và G10 — Báo cáo

| Bảng | Trường chính | Ghi chú |
|---|---|---|
| `benefit_catalog` | `code` · `name` · `eligibility_rule` (json) · `benefit_amount` · `is_taxable` · `effective_from` | 9.1 |
| `benefit_allocation` | `benefit_catalog_id` · `employee_id` · `period_code` · `amount` · `cost_org_unit_id` · `payroll_period_id` (nullable) · `status` (`PLANNED` / `CONFIRMED`) | Khóa chống trùng `(benefit_catalog_id, employee_id, period_code)` |
| `severance_allowance` | `termination_decision_id` · `allowance_type` (`SEVERANCE` / `JOB_LOSS`) · `service_years` · `amount` · `payroll_period_id` | Tạo khi xác nhận chấm dứt; hiển thị ở chi phí 9.4 |
| `report_run` | `report_type` · `scope_org_unit_id` · `period_code` · `data_status` (`DRAFT` / `OFFICIAL`) · `requested_by` · `requested_at` · `export_format` · `file_id` | Báo cáo là truy vấn; bảng chỉ lưu lần kết xuất và quyền đã kiểm tra |

---

## 11. Quy ước chung cho mọi bảng

| Quy ước | Áp dụng |
|---|---|
| Kiểu tiền tệ | `decimal` với độ chính xác xác định. **Cấm dùng float** — có lint/test chặn |
| Kiểu giờ công | `decimal`, tối thiểu 2 chữ số thập phân |
| Xóa dữ liệu | **Xóa mềm**: `deleted_at`, `deleted_by`, `delete_reason`. Không xóa cứng (BR-63) |
| Trường hệ thống | `created_at`, `created_by`, `updated_at`, `updated_by` trên mọi bảng nghiệp vụ |
| Khoảng hiệu lực | Cặp `effective_from` / `effective_to`; `effective_to = NULL` nghĩa là còn hiệu lực |
| Trạng thái | Mỗi bảng có luồng duyệt lưu `status` + người / thời điểm chuyển trạng thái; mọi chuyển trạng thái ghi `audit_log` |
| Mã hóa | Trường đánh dấu 🔒 mã hóa AES-256 ở tầng CSDL |
| Chỉ mục | Đánh chỉ mục trên các trường **không mã hóa**; đối chiếu trùng CCCD dùng trường băm có muối |

---

## 12. Ràng buộc toàn vẹn then chốt

| # | Ràng buộc | Cấp thực thi |
|---|---|---|
| 1 | `legal_parameter`, `insurance_rate`, `pit_bracket`, `ot_cap`, `site_policy` không chồng lấn khoảng hiệu lực trên cùng khóa phạm vi | CSDL |
| 2 | `raw_punch` chỉ INSERT/SELECT; duy nhất theo `(device_code, employee_id, punch_at)` | CSDL |
| 3 | `audit_log` thu hồi UPDATE/DELETE | CSDL |
| 4 | `org_unit.parent_id` không tạo chu trình; `level` ≤ 5 | Ứng dụng + kiểm tra định kỳ |
| 5 | `business_period` không chồng khoảng ngày trên cùng `(period_type, scope_org_unit_id)`; mở kỳ khi kỳ trước đã `LOCKED` | CSDL + ứng dụng |
| 6 | `payroll_sheet` chỉ tính khi kỳ công tương ứng `LOCKED` | Ứng dụng |
| 7 | Không ghi dữ liệu nghiệp vụ vào kỳ đã `LOCKED` (trừ `payroll_adjustment` ghi vào kỳ đang mở) | Ứng dụng + CSDL |
| 8 | `monthly_timesheet` chỉ chuyển `WORKSHOP_CLOSED` khi mọi tổ đã xác nhận và không còn `XC` mức BLOCKING | Ứng dụng |
| 9 | `component_formula` không có phụ thuộc vòng | Formula engine |
| 10 | `daily_attendance` duy nhất theo `(employee_id, work_date)` | CSDL |
| 11 | `role_assignment.role_code` ∈ {TT, QD, KT, AD} | CSDL |
| 12 | `tax_withholding` duy nhất theo `(employee_id, period_code)` — không khấu trừ hai lần | CSDL |
| 13 | `severance_allowance` duy nhất theo `termination_decision_id` | CSDL |
| 14 | Tổng khấu trừ ≤ 30% NET | Cổng chặn `CP-04` |

---

## 13. Chiến lược lưu trữ và phân vùng

| Nhóm dữ liệu | Khối lượng ước tính (~2.200 NV, 4 cơ sở) | Chiến lược |
|---|---|---|
| `raw_punch` | ~ 4 lượt/người/ngày ≈ 3,2 triệu bản ghi/năm | Phân vùng theo tháng và cơ sở; nén dữ liệu cũ; giữ tối thiểu 3 năm |
| `daily_attendance` | ~ 800.000 bản ghi/năm | Phân vùng theo kỳ công |
| `attendance_hour_segment` | ~ 2–4 đoạn/ngày công ≈ 2,4 triệu/năm | Phân vùng theo kỳ công |
| `payroll_line` | ~ 20 dòng/người/kỳ ≈ 530.000/năm | Phân vùng theo kỳ lương |
| `audit_log` | Tăng liên tục | Phân vùng theo tháng; **không xóa**, chỉ chuyển sang lưu trữ nguội |
| Snapshot | 12 bản/năm mỗi loại × 4 cơ sở | Lưu nguyên vẹn, không nén mất mát |
