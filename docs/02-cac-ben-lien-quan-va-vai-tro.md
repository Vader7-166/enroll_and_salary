# 02. Các bên liên quan và vai trò

## 1. Bản đồ các bên liên quan

Hệ thống phục vụ **5 nhóm actor** với mức độ sử dụng và nhu cầu giao diện rất khác nhau.
Việc phân nhóm này quyết định thiết kế phân quyền ([09](09-phan-quyen-va-bao-mat.md)) và
thiết kế giao diện ESS/MSS ([FR-13 trong 06](06-yeu-cau-chuc-nang.md)).

```
                        ┌─────────────────────────────┐
                        │  D. Tài chính & Lãnh đạo     │  duyệt cuối, giám sát chi phí
                        │  D1 D2 D3 D4                 │
                        └──────────────┬──────────────┘
                                       │ duyệt cấp 2, 3
        ┌──────────────────────────────┴──────────────────────────────┐
        │                                                              │
┌───────┴────────────────┐                              ┌──────────────┴──────────┐
│ A. Vận hành nhân sự     │◄──── đối chiếu công ────────►│ B. Quản lý sản xuất      │
│ A1 A2 A3 A4 A5          │                              │ B1 B2 B3                 │
│ chốt công, tính lương   │                              │ xếp ca, đề xuất OT       │
└───────┬────────────────┘                              └──────────────┬──────────┘
        │ phát hành payslip                                            │ duyệt cấp 1
        │                                                              │
        └──────────────────────┬───────────────────────────────────────┘
                               ▼
                  ┌────────────────────────────┐      ┌─────────────────────────┐
                  │ C. Người lao động           │      │ E. Đại diện NLĐ & KT     │
                  │ C1 C2 C3                    │      │ E1 E2 E3                 │
                  │ ESS: xem công, phép, lương  │      │ giám sát, vận hành       │
                  └────────────────────────────┘      └─────────────────────────┘
```

## 2. Nhóm A — Vận hành nhân sự

| Mã | Vị trí | Chức năng chính sử dụng | Tần suất |
|---|---|---|---|
| **A1** | Nhân viên chấm công (thường trực tại nhà máy) | Nạp dữ liệu chấm công, xử lý ngoại lệ (quên quẹt, lỗi thiết bị), đối chiếu công với tổ trưởng, chốt bảng công tháng | Hằng ngày |
| **A2** | Chuyên viên hồ sơ & hợp đồng | Quản lý hồ sơ NV, ký/gia hạn HĐLĐ, phụ lục, quyết định điều động, theo dõi cảnh báo hết hạn | Hằng tuần |
| **A3** | Chuyên viên tiền lương (C&B) | Cấu hình cơ cấu lương, chạy tính lương, kiểm tra sai lệch, xử lý truy lĩnh, chốt & khóa kỳ lương, phát hành phiếu lương | Theo kỳ |
| **A4** | Chuyên viên BHXH & Thuế | Báo tăng/giảm BHXH, hồ sơ ốm đau – thai sản, đăng ký người phụ thuộc, khấu trừ & quyết toán thuế TNCN | Hằng tháng |
| **A5** | Trưởng phòng Nhân sự | Phê duyệt chính sách lương – phụ cấp, duyệt bảng lương cấp 1, xem toàn bộ báo cáo, giải quyết khiếu nại | Theo kỳ |

## 3. Nhóm B — Quản lý sản xuất

| Mã | Vị trí | Chức năng chính sử dụng | Tần suất |
|---|---|---|---|
| **B1** | Tổ trưởng / Chuyền trưởng | Xếp ca cho tổ, đề xuất OT, xác nhận công thực tế của công nhân, duyệt đơn nghỉ cấp 1, đề xuất đổi ca | Hằng ngày |
| **B2** | Quản đốc phân xưởng | Duyệt lịch ca toàn xưởng, duyệt OT cấp 2, kiểm soát trần OT, theo dõi tỷ lệ vắng mặt và biến động nhân sự | Hằng tuần |
| **B3** | Kế hoạch sản xuất | Cung cấp kế hoạch sản lượng làm cơ sở xác định nhu cầu nhân lực theo ca và nhu cầu OT | Hằng tháng |

## 4. Nhóm C — Người lao động

| Mã | Đối tượng | Đặc điểm truy cập | Chức năng chính |
|---|---|---|---|
| **C1** | Công nhân trực tiếp (~75% nhân sự) | Ít dùng máy tính → **kiosk tại xưởng** hoặc **điện thoại** | Xem công, xem phiếu lương, xem số dư phép, nộp đơn nghỉ, khiếu nại công |
| **C2** | Nhân viên văn phòng | Web trên máy tính | Như C1, thêm: đăng ký người phụ thuộc, xem chứng từ thuế |
| **C3** | Nhân viên thử việc / thời vụ | Quyền hạn chế | Xem công, phiếu lương (áp cơ chế thuế / BH khác) |

> **Ràng buộc thiết kế.** C1 chiếm đa số nhân sự nhưng có điều kiện truy cập hạn chế nhất.
> Giao diện kiosk phải tối giản, phiên đăng nhập ngắn (tự đăng xuất sau 60 giây), thao tác
> hoàn thành trong ít bước nhất.

## 5. Nhóm D — Tài chính và lãnh đạo

| Mã | Vị trí | Chức năng chính sử dụng |
|---|---|---|
| **D1** | Kế toán tiền lương | Đối chiếu chi phí lương, nhận bút toán, lập file chi lương ngân hàng |
| **D2** | Kế toán trưởng | Duyệt bảng lương cấp 2, kiểm soát ngân sách quỹ lương, xác nhận nghĩa vụ thuế – BH |
| **D3** | Giám đốc nhà máy | Duyệt định biên, duyệt kế hoạch OT lớn, xem dashboard chi phí lao động theo xưởng |
| **D4** | Tổng Giám đốc / Ban lãnh đạo | Phê duyệt cuối bảng lương và chính sách thưởng, xem báo cáo tổng hợp |

## 6. Nhóm E — Đại diện người lao động và kỹ thuật

| Mã | Vị trí | Chức năng chính sử dụng |
|---|---|---|
| **E1** | Chủ tịch Công đoàn cơ sở | Đối chiếu danh sách đoàn viên và đoàn phí, giám sát việc thực hiện OT / nghỉ phép đúng luật, tham gia giải quyết khiếu nại |
| **E2** | Quản trị hệ thống (System Admin) | Quản lý tài khoản, phân quyền, cấu hình danh mục và tham số pháp lý, sao lưu – phục hồi, xem nhật ký kiểm toán |
| **E3** | Nhân viên IT vận hành | Vận hành job đồng bộ dữ liệu chấm công, xử lý sự cố tích hợp |

> **Lưu ý về E2.** System Admin có toàn quyền cấu hình nhưng **không** có quyền sửa hoặc
> xóa nhật ký kiểm toán — quyền UPDATE/DELETE trên bảng audit log bị thu hồi ở tầng cơ sở
> dữ liệu. Xem [09](09-phan-quyen-va-bao-mat.md#4-nhật-ký-kiểm-toán-bất-biến).

## 7. Ánh xạ actor sang vai trò hệ thống

Mỗi actor nghiệp vụ được ánh xạ sang một vai trò kỹ thuật (role) trong mô hình RBAC:

| Actor | Vai trò hệ thống | Phạm vi dữ liệu mặc định |
|---|---|---|
| E2 | `SYSTEM_ADMIN` | `ALL` (loại trừ dữ liệu lương chi tiết) |
| A5 | `HR_MANAGER` | `ALL` |
| A3 | `HR_PAYROLL` | `ALL` |
| A1 | `HR_TIMEKEEPER` | `SITE` |
| A2 | `HR_RECORDS` | `ALL` (áp exclusion list) |
| A4 | `HR_INSURANCE_TAX` | `ALL` |
| B1 | `LINE_LEADER` | `TEAM` |
| B2 | `WORKSHOP_MANAGER` | `DEPARTMENT` |
| B3 | `PRODUCTION_PLANNER` | `SITE` (chỉ dữ liệu tổng hợp) |
| D1 | `PAYROLL_ACCOUNTANT` | `ALL` |
| D2 | `CHIEF_ACCOUNTANT` | `ALL` |
| D3 | `PLANT_DIRECTOR` | `SITE` |
| D4 | `BOARD` | `ALL` |
| E1 | `UNION_CHAIR` | `ALL` (chỉ dữ liệu đoàn phí, OT, nghỉ phép) |
| E3 | `IT_OPERATOR` | Không có phạm vi dữ liệu nhân sự |
| C1 / C2 / C3 | `EMPLOYEE` | `SELF` |

Chi tiết ma trận quyền theo hành động: xem [09](09-phan-quyen-va-bao-mat.md).

## 8. Ma trận RACI theo quy trình chính

**R** = Thực hiện · **A** = Chịu trách nhiệm cuối · **C** = Được hỏi ý kiến · **I** = Được thông báo

| Quy trình | A1 | A3 | A5 | B1 | B2 | D1 | D2 | D4 | E1 |
|---|---|---|---|---|---|---|---|---|---|
| Xếp lịch ca tháng | I | – | I | **R** | **A** | – | – | – | C |
| Xử lý ngoại lệ công | **R** | C | I | C | **A** | – | – | – | – |
| Xác nhận công của tổ | C | I | – | **R** | **A** | – | – | – | – |
| Chốt & khóa kỳ công | **R** | **A** | I | C | C | – | – | – | – |
| Đăng ký & duyệt OT | I | I | C | **R** | **A** | – | – | I | C |
| Duyệt đơn nghỉ | I | I | C | **R** | **A** | – | – | – | – |
| Chạy tính lương (dry-run) | C | **R** | **A** | – | – | I | I | – | – |
| Duyệt bảng lương | – | **R** | **A** cấp 1 | – | – | C | **A** cấp 2 | **A** cuối | I |
| Khóa kỳ lương & phát hành payslip | – | **R** | **A** | – | – | I | I | I | – |
| Lập lệnh chi ngân hàng | – | C | I | – | – | **R** | **A** | I | – |
| Đẩy bút toán ERP | – | I | – | – | – | **R** | **A** | – | – |
| Báo tăng/giảm BHXH | – | C | **A** | – | – | I | I | – | C |
| Đối chiếu đoàn phí | – | C | C | – | – | I | I | – | **R/A** |
| Giải quyết khiếu nại công – lương | **R** | **R** | **A** | C | C | – | – | I | C |

## 9. Kênh truy cập theo nhóm

| Nhóm | Web | Mobile | Kiosk | Ghi chú |
|---|---|---|---|---|
| A — Vận hành nhân sự | ✔ chính | ✔ | – | Cần bảng biểu chi tiết, thao tác hàng loạt |
| B — Quản lý sản xuất | ✔ | ✔ chính | – | Duyệt nhanh trên điện thoại tại xưởng |
| C1 — Công nhân trực tiếp | – | ✔ | ✔ chính | Giao diện tối giản, phiên ngắn |
| C2 — Văn phòng | ✔ chính | ✔ | – | |
| D — Tài chính, lãnh đạo | ✔ chính | ✔ dashboard | – | |
| E — Đại diện NLĐ, kỹ thuật | ✔ chính | – | – | |

Ba hình thái ESS (web / mobile / kiosk) **dùng chung một backend và một mô hình quyền**,
chỉ khác ở lớp trình bày — xem quyết định kiến trúc [ADR-10](07-kien-truc-he-thong.md#adr-10-ba-hình-thái-ess-dùng-chung-một-api).
