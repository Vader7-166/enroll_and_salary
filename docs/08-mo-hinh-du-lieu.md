# 08. Mô hình dữ liệu

## 1. Bản đồ miền dữ liệu

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│ TỔ CHỨC & THAM SỐ    │     │ NHÂN SỰ & HỢP ĐỒNG   │     │ CA & LỊCH            │
│ org_unit             │────►│ employee             │◄────│ shift_definition     │
│ org_assignment       │     │ dependent            │     │ shift_schedule       │
│ legal_parameter      │     │ employment_event     │     │ holiday_calendar     │
│ policy_config        │     │ labor_contract       │     │ shift_swap_request   │
│ role / permission    │     │ contract_annex       │     │                      │
└──────────┬──────────┘     └──────────┬──────────┘     └──────────┬──────────┘
           │                            │                           │
           └────────────────────────────┼───────────────────────────┘
                                        ▼
                        ┌───────────────────────────────┐
                        │ CHẤM CÔNG (3 tầng)             │
                        │ raw_punch          ← tầng 1    │
                        │ daily_attendance   ← tầng 2    │
                        │ attendance_snapshot← tầng 3    │
                        │ attendance_period              │
                        │ attendance_exception           │
                        └───────────────┬───────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│ OT & NGHỈ            │     │ TIỀN LƯƠNG           │     │ BHXH & THUẾ          │
│ ot_request           │────►│ payroll_period       │────►│ insurance_profile    │
│ ot_segment           │     │ salary_component     │     │ insurance_declaration│
│ comp_time_balance    │     │ component_formula    │     │ tax_profile          │
│ leave_type           │     │ employee_salary      │     │ tax_withholding      │
│ leave_request        │     │ payroll_run          │     │ union_fee            │
│ leave_balance        │     │ payroll_line         │     │                      │
│                      │     │ payroll_snapshot     │     │                      │
└─────────────────────┘     └──────────┬──────────┘     └─────────────────────┘
                                        │
                        ┌───────────────▼───────────────┐
                        │ XUYÊN SUỐT                     │
                        │ audit_log (append-only)        │
                        │ approval_workflow / instance   │
                        │ notification                   │
                        │ compliance_check_result        │
                        └───────────────────────────────┘
```

---

## 2. Nhóm Tổ chức và tham số

### 2.1. `org_unit` — Đơn vị tổ chức có phiên bản theo thời gian

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `id` | ID | |
| `code` | string | Mã đơn vị |
| `name` | string | |
| `parent_id` | ID | Đơn vị cha; **chặn vòng lặp** |
| `unit_type` | enum | `COMPANY` / `SITE` / `BLOCK` / `DEPARTMENT` / `TEAM` |
| `cost_center_code` | string | Dùng hạch toán TK 622 / 642 |
| `region_code` | enum | Địa bàn áp lương tối thiểu vùng (I–IV) |
| `effective_from` / `effective_to` | date | Mọi thay đổi cấu trúc tạo **phiên bản mới**, không ghi đè |

Truy vấn cây tổ chức luôn nhận tham số ngày và trả về cấu trúc đúng tại ngày đó.

### 2.2. `org_assignment` — Lịch sử phân công nhân sự ↔ đơn vị

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `employee_id` / `org_unit_id` | ID | |
| `effective_from` / `effective_to` | date | Cho phép nhiều phân công trong cùng kỳ lương |
| `allocation_ratio` | decimal | Tỷ lệ phân bổ chi phí khi thuộc nhiều đơn vị |

### 2.3. `legal_parameter` — Tham số pháp lý theo khoảng hiệu lực

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `param_code` | string | Ví dụ `MIN_WAGE_REGION_I`, `PIT_BRACKET`, `OT_RATE_HOLIDAY` |
| `scope_key` | string | Phạm vi áp dụng (toàn hệ thống / theo đơn vị / theo vùng) |
| `value` | decimal / json | Giá trị đơn hoặc cấu trúc (ví dụ 7 bậc thuế) |
| `effective_from` / `effective_to` | date | **Ràng buộc CSDL chống chồng lấn** |
| `legal_basis` | string | Số hiệu văn bản, ngày ban hành, điều khoản — **bắt buộc** |
| `created_by` / `created_at` | | |

**Danh mục `param_code` tối thiểu:**

```
MIN_WAGE_MONTH_{REGION}     MIN_WAGE_HOUR_{REGION}
SI_RATE_EMPLOYEE            SI_RATE_EMPLOYER          SI_CAP        SI_FLOOR
HI_RATE_EMPLOYEE            HI_RATE_EMPLOYER          UI_RATE_*
PIT_DEDUCTION_SELF          PIT_DEDUCTION_DEPENDENT   PIT_BRACKET
PIT_RATE_NON_RESIDENT       PIT_RATE_SEASONAL
OT_RATE_NORMAL              OT_RATE_WEEKLY_REST       OT_RATE_HOLIDAY
NIGHT_ALLOWANCE_RATE        OT_NIGHT_EXTRA_RATE
OT_CAP_DAY                  OT_CAP_MONTH              OT_CAP_YEAR   OT_CAP_YEAR_REGISTERED
UNION_FUND_RATE             UNION_FEE_RATE            UNION_FEE_CAP
LATE_PAYMENT_RATE           MEAL_TAX_FREE_CAP         UNIFORM_TAX_FREE_CAP
PHONE_TAX_FREE_CAP          HOUSING_TAXABLE_RATIO_CAP
PROBATION_MIN_RATIO         DEDUCTION_MAX_RATIO
```

### 2.4. `policy_config` — Cấu hình chính sách theo đơn vị

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `org_unit_id` | ID | Kế thừa từ cha, ghi đè từng khóa |
| `config_key` | string | `ROUNDING_RULE`, `CUTOFF_DAY`, `STANDARD_WORKDAYS`, `LATE_TOLERANCE_MIN`, `OT_RULE_SET` |
| `config_value` | json | |
| `effective_from` / `effective_to` | date | |

Khi phân giải, hệ thống trả về **cả giá trị và đơn vị nguồn** để giao diện hiển thị nguồn gốc.

---

## 3. Nhóm Nhân sự và hợp đồng

### 3.1. `employee`

| Nhóm trường | Trường tiêu biểu | Mã hóa |
|---|---|---|
| Định danh | `code`, `full_name`, `gender`, `dob`, `nationality` | – |
| Giấy tờ | `national_id` (CCCD / hộ chiếu) | 🔒 AES-256 |
| Cư trú | `residence_address`, `permanent_address` | – |
| Thuế & BH | `tax_code`, `social_insurance_no` | – |
| Ngân hàng | `bank_account_no`, `bank_code` | 🔒 AES-256 |
| Chuyên môn | `education_level`, `skill_grade`, `job_title`, `position` | – |
| Đặc thù | `is_foreigner`, `work_permit_no`, `tax_residency_status`, `is_retiree`, `is_minor` | – |
| Trạng thái | `status`, `hire_date`, `termination_date`, `termination_reason` | – |
| Liên hệ | `phone`, `email`, `emergency_contact` | – |

### 3.2. `dependent` — Người phụ thuộc

`employee_id` · `full_name` · `relationship` · `national_id` (🔒) · `deduction_from_month` ·
`deduction_to_month` · `proof_document_id` · `status`

Giảm trừ được tính **theo tháng hiệu lực đăng ký**, không theo ngày.

### 3.3. `employment_event` — Quá trình công tác

`employee_id` · `event_type` (`HIRE`/`PROBATION`/`OFFICIAL`/`TRANSFER`/`PROMOTION`/
`SALARY_CHANGE`/`DISCIPLINE`/`TERMINATE`) · `effective_date` · `decision_no` ·
`from_value` / `to_value` · `attachment_id`

**Mọi sự kiện có ngày hiệu lực riêng** — hệ thống phải xử lý ngày hiệu lực rơi giữa kỳ lương.

### 3.4. `labor_contract` và `contract_annex`

| Trường | Ghi chú |
|---|---|
| `contract_no`, `contract_type` | `PROBATION` / `FIXED_TERM` / `INDEFINITE` / `UNDER_1M` / `PIECEWORK` / `SERVICE` |
| `sign_date`, `effective_from`, `effective_to` | |
| `fixed_term_sequence` | Đếm số lần ký HĐ xác định thời hạn — cảnh báo khi = 2 |
| `salary_structure_id` | Liên kết cấu trúc lương |
| `insurance_eligible` | Diện đóng BH, suy ra từ loại HĐ |
| `contract_salary` | 🔒 AES-256 |
| `status` | `DRAFT` / `SIGNED` / `ACTIVE` / `EXPIRED` / `TERMINATED` |

`contract_annex` lưu phụ lục thay đổi lương / vị trí, có ngày hiệu lực riêng.

### 3.5. `labor_book_entry` — Sổ quản lý lao động điện tử

Bảng dẫn xuất tự sinh, tổng hợp đủ **20 tiêu chí** từ `employee`, `labor_contract`,
`insurance_profile`, `leave_balance`, `ot_segment` và `employment_event`. Không nhập tay.

---

## 4. Nhóm Ca và lịch

### 4.1. `shift_definition`

| Trường | Ghi chú |
|---|---|
| `code`, `name` | Ca A / B / C / Hành chính |
| `start_time`, `end_time` | |
| `crosses_midnight` | **Cờ then chốt**: `end_time < start_time` |
| `break_minutes`, `break_paid` | 30 phút, tính vào giờ làm việc |
| `is_night_shift` | |
| `check_in_window_before` / `after` | Biên độ nhận diện lượt quẹt |
| `check_out_window_before` / `after` | |
| `late_tolerance_minutes` | |

### 4.2. `shift_schedule`

`employee_id` · `work_date` · `shift_id` · `source` (`ROTATION`/`MANUAL`/`SWAP`) ·
`swap_request_id` · `status`

### 4.3. `holiday_calendar`

`date` · `holiday_type` (`PUBLIC_HOLIDAY` / `TET` / `COMPENSATORY_REST` / `WEEKLY_REST`) ·
`name` · `is_paid` · `substitute_for_date`

Dùng để phân loại ngày khi tách đoạn giờ (BR-24).

---

## 5. Nhóm Chấm công — ba tầng

### 5.1. Tầng 1 · `raw_punch` (BẤT BIẾN)

| Trường | Ghi chú |
|---|---|
| `id` | |
| `device_code` | Mã máy chấm công |
| `employee_code` | Mã trên thiết bị — có thể chưa khớp với `employee` |
| `punch_at` | Thời điểm quẹt (timestamp) |
| `punch_type` | `IN` / `OUT` / `AUTO` |
| `source` | `DEVICE_API` / `FILE_IMPORT` / `MANUAL` / `MOBILE` |
| `import_batch_id` | |
| `received_at` | Thời điểm hệ thống nhận |
| `match_status` | `MATCHED` / `UNMATCHED` — bản ghi `UNMATCHED` **không chặn luồng** |

**Ràng buộc:** chỉ INSERT và SELECT. Khóa chống trùng
`(device_code, employee_code, punch_at)` bảo đảm đồng bộ bù là idempotent.

### 5.2. Tầng 2 · `daily_attendance` (DẪN XUẤT)

| Trường | Ghi chú |
|---|---|
| `employee_id` | |
| `work_date` | **Ngày công** — ca đêm gán về ngày T (BR-13) |
| `shift_id` | |
| `day_type` | `NORMAL` / `WEEKLY_REST` / `HOLIDAY` |
| `check_in_at` / `check_out_at` | Từ cặp quẹt đã ghép |
| `worked_hours` | decimal |
| `day_hours` / `night_hours` | Tách theo mốc 22:00 / 06:00 |
| `ot_day_hours` / `ot_night_hours` | |
| `had_daytime_ot` | **Cờ quyết định 200% vs 210%** (BR-25) |
| `late_minutes` / `early_leave_minutes` | Ghi nhận, **không dùng để trừ lương** |
| `attendance_symbol` | `X` / `Đ` / `Ph` / `L` / `Ô` / `TS` / `Kl` / `ERR` / `KP` |
| `status` | `OK` / `ERR` / `PENDING_EXPLANATION` / `ADJUSTED` |
| `converted_workday` | Công quy đổi (decimal) |
| `calc_version` | Phiên bản thuật toán đã sinh bản ghi này |

**Tính chất:** `daily_attendance = f(raw_punch, shift_schedule, đơn từ đã duyệt, legal_parameter)`
— luôn tính lại được từ tầng 1.

### 5.3. `attendance_hour_segment` — Đoạn giờ

| Trường | Ghi chú |
|---|---|
| `daily_attendance_id` | |
| `segment_from` / `segment_to` | Sau khi tách theo mốc 22:00 / 06:00 / 00:00 |
| `hours` | decimal |
| `is_night` | |
| `day_type` | Loại ngày của đoạn — **có thể khác** `day_type` của ngày công |
| `is_overtime` | |
| `applied_rate` | Hệ số đã áp, là **kết quả tính** từ công thức 3 số hạng |
| `rate_breakdown` | json: từng số hạng của công thức, phục vụ drill-down |

> Bảng này là hiện thực hóa của việc **tách bạch "ngày công" và "đoạn giờ"** (ADR-03).

### 5.4. Tầng 3 · `attendance_snapshot`

`attendance_period_id` · `content` (json toàn bộ bảng công) · `content_hash` ·
`locked_at` · `locked_by`

Sau khi khóa, mọi truy vấn bảng công của kỳ đó **trả về dữ liệu từ snapshot**.

### 5.5. `attendance_period`

`code` (ví dụ `2026-09`) · `org_scope` · `date_from` (26/N-1) · `date_to` (25/N) ·
`status` (`OPEN`/`PROCESSING`/`PENDING_APPROVAL`/`LOCKED`) · `locked_at` / `locked_by` ·
`unlock_reason` / `unlocked_by`

### 5.6. `attendance_exception`

`daily_attendance_id` · `exception_type` (`MISSING_PUNCH`/`LATE`/`EARLY_LEAVE`/
`FIELD_WORK`/`DEVICE_FAILURE`) · `explanation` · `attachment_id` ·
`workflow_instance_id` · `resolution` · `resolved_by`

---

## 6. Nhóm OT và nghỉ phép

### 6.1. `ot_request` / `ot_segment`

| Bảng | Trường chính |
|---|---|
| `ot_request` | `employee_id` · `work_date` · `planned_from` / `planned_to` · `planned_hours` · `reason` · `consent_document_id` (**bắt buộc**) · `workflow_instance_id` · `status` |
| `ot_segment` | `daily_attendance_id` · `segment_from` / `segment_to` · `hours` · `is_night` · `day_type` · `applied_rate` · `amount` · `taxable_amount` · `tax_free_amount` |

`ot_segment.hours` = **min**(giờ đăng ký đã duyệt, giờ chấm công thực tế) (BR-26).

### 6.2. `ot_quota_tracking` — Theo dõi trần OT

`employee_id` · `period_type` (`DAY`/`MONTH`/`YEAR`) · `period_key` ·
`accumulated_hours` · `cap_hours` · `warning_threshold` · `override_approval_id`

### 6.3. `leave_type`

`code` · `name` · `is_paid` · `counts_as_workday` · `deducts_annual_quota` ·
`requires_document` · `max_days` · `approval_workflow_id` · `attendance_symbol`

### 6.4. `leave_request` / `leave_balance`

| Bảng | Trường chính |
|---|---|
| `leave_request` | `employee_id` · `leave_type_id` · `date_from` / `date_to` · `unit` (`DAY`/`HALF_DAY`/`HOUR`) · `quantity` · `reason` · `attachment_id` · `workflow_instance_id` · `status` |
| `leave_balance` | `employee_id` · `year` · `entitled_days` · `carried_over_days` · `carry_over_expiry` · `used_days` · `advance_days` · `remaining_days` |

### 6.5. `comp_time_balance` — Quỹ nghỉ bù từ OT

`employee_id` · `source_ot_segment_id` · `granted_hours` · `conversion_ratio` ·
`expiry_date` · `used_hours` · `remaining_hours`

---

## 7. Nhóm Tiền lương

### 7.1. `salary_component` — Định nghĩa cấu phần thu nhập

| Trường | Ghi chú |
|---|---|
| `code`, `name` | |
| `component_type` | `EARNING` / `DEDUCTION` / `EMPLOYER_COST` |
| `is_insurable` | **Cờ 1** — có tính vào lương đóng BH |
| `is_taxable` | **Cờ 2** — có tính vào thu nhập chịu thuế |
| `is_prorated` | **Cờ 3** — có tính theo tỷ lệ ngày công |
| `is_ot_base` | Có dùng làm căn cứ tính lương giờ OT |
| `display_order` | Thứ tự trên phiếu lương |

### 7.2. `component_formula` — Công thức có phiên bản

`salary_component_id` · `expression` · `depends_on` (danh sách mã cấu phần) ·
`effective_from` / `effective_to` · `version` · `created_by` · `legal_basis`

### 7.3. `employee_salary` — Cấu trúc lương của từng nhân sự

`employee_id` · `salary_component_id` · `amount` (🔒) · `effective_from` / `effective_to` ·
`decision_no`

Tăng lương giữa kỳ tạo bản ghi mới có `effective_from` giữa tháng → engine tự tách hai đoạn
đơn giá (BR-40).

### 7.4. `payroll_period` / `payroll_run`

| Bảng | Trường chính |
|---|---|
| `payroll_period` | `code` · `attendance_period_id` · `pay_date` (ngày 10 tháng sau) · `status` (`OPEN`/`CALCULATED`/`PENDING_APPROVAL`/`APPROVED`/`LOCKED`/`PAID`) · `actual_pay_date` |
| `payroll_run` | `payroll_period_id` · `run_type` (`DRY_RUN`/`OFFICIAL`) · `started_at` · `finished_at` · `run_by` · `param_snapshot_hash` · `formula_version_set` |

`param_snapshot_hash` ghi lại tập tham số đã dùng — bảo đảm tính idempotent kiểm chứng được.

### 7.5. `payroll_line` — Chi tiết từng dòng lương

`payroll_run_id` · `employee_id` · `salary_component_id` · `amount` (🔒) ·
`calculation_trace` (json: biểu thức, giá trị từng biến, tham số đã dùng) ·
`source_reference` (liên kết ngược tới `daily_attendance` / `ot_segment`)

> `calculation_trace` là hiện thực hóa của yêu cầu **drill-down**: từ số tiền đi ngược về
> công thức, tham số và lượt quẹt gốc.

### 7.6. `payroll_adjustment` — Truy lĩnh / truy thu

`payroll_period_id` (kỳ ghi nhận) · `origin_period_id` (**kỳ gốc**) · `employee_id` ·
`adjustment_type` (`RETRO_PAY`/`RETRO_DEDUCT`/`LATE_PAYMENT_COMPENSATION`) · `amount` ·
`reason` · `approved_by`

### 7.7. `payroll_snapshot`

`payroll_period_id` · `content` · `content_hash` · `locked_at` · `locked_by` ·
`compliance_result_id`

---

## 8. Nhóm BHXH và thuế

### 8.1. `insurance_profile`

`employee_id` · `insurance_salary` (🔒) · `is_trained_worker` (quyết định sàn +7%) ·
`si_eligible` / `hi_eligible` / `ui_eligible` · `effective_from` / `effective_to` ·
`exemption_reason`

### 8.2. `insurance_declaration`

`period_code` · `employee_id` · `declaration_type` (`INCREASE`/`DECREASE`/`ADJUST`/
`RETRO_COLLECT`/`REFUND`) · `old_salary` / `new_salary` · `submitted_at` · `status` ·
`c12_reconciled` · `c12_difference`

### 8.3. `tax_profile` / `tax_withholding`

| Bảng | Trường chính |
|---|---|
| `tax_profile` | `employee_id` · `tax_status` (`RESIDENT`/`NON_RESIDENT`/`SEASONAL`) · `commitment_02ck` · `authorization_for_finalization` |
| `tax_withholding` | `payroll_period_id` · `employee_id` · `taxable_income` · `tax_free_income` · `deductions` · `assessable_income` · `tax_amount` · `bracket_breakdown` (json) · `certificate_serial` |

### 8.4. `union_fee`

`employee_id` · `period_code` · `union_fund_amount` (2% doanh nghiệp) ·
`member_fee_amount` (1% có trần) · `is_member` · `reconciled_with_union`

---

## 9. Nhóm xuyên suốt

### 9.1. `audit_log` — APPEND-ONLY

| Trường | Ghi chú |
|---|---|
| `id` | Tăng dần |
| `entity_type` / `entity_id` | Đối tượng bị tác động |
| `action` | `CREATE` / `UPDATE` / `DELETE_SOFT` / `LOCK` / `UNLOCK` / `APPROVE` / `VIEW_SENSITIVE` |
| `actor_id` | Người thực hiện |
| `occurred_at` | |
| `old_value` / `new_value` | json |
| `reason` | **Bắt buộc** với thao tác sửa công, lương, tham số |
| `ip_address` | |
| `reference_code` | Mã đơn / quyết định liên quan |
| `prev_hash` | Hash của bản ghi trước |
| `record_hash` | Hash của bản ghi này → tạo **chuỗi băm** |

**Ràng buộc tầng CSDL:** tài khoản ứng dụng chỉ có `INSERT` và `SELECT`; `UPDATE` và `DELETE`
bị **thu hồi**. Tác vụ định kỳ kiểm tra tính liên tục của chuỗi băm.

### 9.2. `approval_workflow` / `workflow_instance` / `workflow_step`

| Bảng | Trường chính |
|---|---|
| `approval_workflow` | `code` · `entity_type` · `definition` (json: các cấp, điều kiện rẽ nhánh, SLA, hành vi quá hạn) · `version` |
| `workflow_instance` | `workflow_id` · `entity_type` / `entity_id` · `current_step` · `status` · `started_at` · `sla_deadline` |
| `workflow_step` | `instance_id` · `step_no` · `approver_id` · `delegated_from` · `decision` · `comment` · `decided_at` · `amount_snapshot` |

`amount_snapshot` ở bước duyệt bảng lương: nếu tổng tiền thay đổi sau khi duyệt → **hủy toàn
bộ phê duyệt** (BR-43).

### 9.3. `compliance_check_result`

`payroll_period_id` · `check_code` (`CP-01`…`CP-09`) · `severity` (`BLOCKING`/`WARNING`) ·
`violation_count` · `detail` (json danh sách nhân sự vi phạm) · `checked_at` ·
`acknowledged_by` (với mức WARNING)

Lưu kèm kỳ lương làm **bằng chứng tuân thủ khi thanh tra**, kết xuất được ra PDF.

### 9.4. `crosscheck_result`

`attendance_period_id` · `check_code` (`XC-01`…`XC-10`) · `severity` ·
`violation_count` · `detail` · `checked_at` · `acknowledged_by`

---

## 10. Quy ước chung cho mọi bảng

| Quy ước | Áp dụng |
|---|---|
| Kiểu tiền tệ | `decimal` với độ chính xác xác định. **Cấm dùng float** — có lint/test chặn |
| Kiểu giờ công | `decimal`, tối thiểu 2 chữ số thập phân |
| Xóa dữ liệu | **Xóa mềm**: `deleted_at`, `deleted_by`, `delete_reason`. Không xóa cứng (BR-63) |
| Trường hệ thống | `created_at`, `created_by`, `updated_at`, `updated_by` trên mọi bảng nghiệp vụ |
| Khoảng hiệu lực | Cặp `effective_from` / `effective_to`; `effective_to = NULL` nghĩa là còn hiệu lực |
| Mã hóa | Trường đánh dấu 🔒 mã hóa AES-256 ở tầng CSDL |
| Chỉ mục | Đánh chỉ mục trên các trường **không mã hóa**; nếu cần đối chiếu trùng CCCD thì dùng trường băm có muối |

---

## 11. Ràng buộc toàn vẹn then chốt

| # | Ràng buộc | Cấp thực thi |
|---|---|---|
| 1 | `legal_parameter` không chồng lấn khoảng hiệu lực trên cùng `(param_code, scope_key)` | CSDL |
| 2 | `raw_punch` chỉ INSERT/SELECT | CSDL |
| 3 | `audit_log` thu hồi UPDATE/DELETE | CSDL |
| 4 | `org_unit.parent_id` không tạo chu trình | Ứng dụng + kiểm tra định kỳ |
| 5 | `payroll_period` chỉ chạy khi `attendance_period.status = LOCKED` | Ứng dụng |
| 6 | Không ghi dữ liệu nghiệp vụ vào kỳ đã `LOCKED` | Ứng dụng + CSDL |
| 7 | `component_formula` không có phụ thuộc vòng | Formula engine |
| 8 | `daily_attendance` duy nhất theo `(employee_id, work_date)` | CSDL |
| 9 | `raw_punch` duy nhất theo `(device_code, employee_code, punch_at)` | CSDL |
| 10 | Tổng khấu trừ ≤ 30% NET | Cổng chặn `CP-04` |

---

## 12. Chiến lược lưu trữ và phân vùng

| Nhóm dữ liệu | Khối lượng ước tính (1.000 NV) | Chiến lược |
|---|---|---|
| `raw_punch` | ~ 4 lượt/người/ngày ≈ 1,5 triệu bản ghi/năm | Phân vùng theo tháng; nén dữ liệu cũ; giữ tối thiểu 3 năm |
| `daily_attendance` | ~ 365.000 bản ghi/năm | Phân vùng theo kỳ công |
| `attendance_hour_segment` | ~ 2–4 đoạn/ngày công ≈ 1 triệu/năm | Phân vùng theo kỳ công |
| `payroll_line` | ~ 20 dòng/người/kỳ ≈ 240.000/năm | Phân vùng theo kỳ lương |
| `audit_log` | Tăng liên tục | Phân vùng theo tháng; **không xóa**, chỉ chuyển sang lưu trữ nguội |
| Snapshot | 12 bản/năm mỗi loại | Lưu nguyên vẹn, không nén mất mát |
