# 02. Các bên liên quan và vai trò

## 1. Hai lớp đối tượng

Theo sơ đồ phân rã chức năng (BFD) và use case tổng quan, hệ thống phân biệt rõ hai lớp:

- **Tác nhân hệ thống** — người có tài khoản, đăng nhập và thao tác trên hệ thống. Chỉ có
  **bốn vai trò**: Tổ trưởng (**TT**), Quản đốc (**QĐ**), Kế toán (**KT**), Admin (**AD**).
  Hai chức năng 4.2 (ghép cặp vào/ra) và 5.4 (tính giờ OT theo hệ số) do **Hệ thống** tự
  thực hiện.
- **Các bên liên quan ngoài hệ thống** — không có tài khoản, chỉ nhận đầu ra (phiếu lương,
  file chi lương, danh sách báo tăng giảm BH, dự thảo quyết toán thuế, báo cáo) hoặc cung
  cấp đầu vào qua tác nhân hệ thống. **Công nhân thuộc lớp này**: họ là đối tượng dữ liệu
  (`NhanVien`), không phải người dùng.

Vị trí của từng vai trò trong cây tổ chức: xem [03. Cơ cấu tổ chức](03-co-cau-to-chuc.md).
Phân quyền chi tiết: xem [10](10-phan-quyen-va-bao-mat.md).

```
   Các bên ngoài hệ thống (không đăng nhập)
   ┌───────────────────────────────────────────────────────────────────────────┐
   │ Người lao động · Lãnh đạo, giám đốc nhà máy · Công đoàn · BHXH · Thuế · NH │
   └───────▲──────────────────────▲───────────────────────────▲────────────────┘
           │ phiếu lương           │ báo cáo                    │ danh sách BH, dự thảo
           │ file chi lương        │                            │ quyết toán, file chi lương
   ┌───────┴──────────────────────┴───────────────────────────┴────────────────┐
   │                    HỆ THỐNG CHẤM CÔNG & TIỀN LƯƠNG                         │
   │                                                                            │
   │  TT ── xếp ca, đổi ca, OT, đơn nghỉ, ngoại lệ, xác nhận công của tổ        │
   │   │                                                                        │
   │  QĐ ── duyệt lịch ca, duyệt OT cấp 2, trần OT, chốt công xưởng, vắng mặt   │
   │   │                                                                        │
   │  KT ── hồ sơ – HĐ, khóa kỳ công, lương, thưởng, BH, thuế, phúc lợi         │
   │                                                                            │
   │  AD ── tài khoản, tổ chức, tham số, chính sách, kỳ, ca, loại nghỉ,         │
   │        nhập dữ liệu chấm công, nhật ký kiểm toán                           │
   └────────────────────────────────────────────────────────────────────────────┘
```

## 2. Bốn tác nhân hệ thống

| Mã | Vai trò | Người đảm nhiệm | Chức năng BFD | Phạm vi dữ liệu | Tần suất |
|---|---|---|---|---|---|
| **TT** | Tổ trưởng | Tổ trưởng / chuyền trưởng sản xuất | 3.2, 3.3, 4.3, 4.4, 5.1, 6.3, 10.1 | Tổ mình phụ trách | Hằng ngày |
| **QĐ** | Quản đốc | Quản đốc phân xưởng | 3.4, 4.5 (chốt xưởng), 5.2, 5.3, 6.5, 10.1, 10.2 | Phân xưởng mình phụ trách | Hằng tuần |
| **KT** | Kế toán | Kế toán tiền lương và kế toán phụ trách hồ sơ – hợp đồng, BHXH – thuế | 1.5 (khóa kỳ), 2.1 – 2.5, 4.5 (khóa kỳ công), 5.5, 6.2, 6.4, 7.1 – 7.6, 8.1 – 8.5, 9.1 – 9.4, 10.3, 10.4 | Cơ sở / đơn vị được giao (có thể toàn công ty) | Theo kỳ |
| **AD** | Admin | Quản trị hệ thống; nhân sự được giao nhập dữ liệu chấm công tại từng cơ sở | 1.1 – 1.4, 1.5 (mở kỳ), 1.6, 3.1, 4.1, 6.1 | Cấu hình hệ thống; dữ liệu chấm công của cơ sở được giao | Hằng ngày (nhập công), theo đợt (cấu hình) |

### 2.1. Tổ trưởng (TT)

- Lập lịch ca, xoay ca cho tổ theo mẫu xoay ca (3.2); đề xuất đổi ca khi lịch đã duyệt (3.3).
- Xem ngoại lệ công của tổ, nhập giải trình kèm lý do và chứng cứ, điều chỉnh công (4.3);
  xác nhận công thực tế của tổ (4.4).
- Lập đề xuất OT cho danh sách công nhân của tổ, kèm căn cứ đồng ý làm thêm (5.1).
- **Ghi nhận đơn nghỉ thay công nhân và duyệt** (6.3). Đây là **cấp duyệt duy nhất** của đơn
  nghỉ (SQ-05 gọi là “Duyệt cấp 1”); quản đốc không duyệt đơn nghỉ.
- Xem báo cáo công, OT của tổ (10.1).

### 2.2. Quản đốc (QĐ)

- Duyệt hoặc trả lại lịch ca toàn xưởng, duyệt đề xuất đổi ca (3.4).
- Duyệt OT cấp 2 (5.2) sau khi hệ thống kiểm soát trần OT ngày / tháng / năm (5.3).
- Đối chiếu công, OT, nghỉ của các tổ và chốt bảng công xưởng (4.5).
- Theo dõi tỷ lệ vắng mặt theo tổ, theo ngày (6.5); xem báo cáo công, OT và biến động nhân sự
  của xưởng (10.1, 10.2).

### 2.3. Kế toán (KT)

Mô hình không có bộ phận HR / C&B riêng trên hệ thống: **kế toán đảm nhiệm cả hồ sơ – hợp đồng**
(phân hệ 2) bên cạnh lương, bảo hiểm, thuế và phúc lợi.

- Hồ sơ nhân viên, người phụ thuộc, HĐLĐ, phụ lục, quyết định điều chuyển / thay đổi lương,
  cảnh báo hết hạn, chấm dứt hợp đồng (2.1 – 2.5).
- Kiểm tra và **khóa kỳ công** sau khi các xưởng đã chốt (4.5); khóa kỳ lương (1.5, 7.5).
- Quy đổi nghỉ bù (5.5); quản lý quỹ phép năm (6.2); theo dõi ốm đau, thai sản (6.4).
- Cấu hình cơ cấu lương, công thức; tính lương, thưởng; truy lĩnh, truy thu; duyệt và khóa
  bảng lương; xuất phiếu lương và file chi lương (7.1 – 7.6).
- Mức đóng BH theo vùng, tính BH và KPCĐ, báo tăng giảm, khấu trừ thuế, quyết toán thuế năm
  (8.1 – 8.5).
- Danh mục phúc lợi, cấp phát, trợ cấp thôi việc / mất việc, theo dõi chi phí (9.1 – 9.4).
- Báo cáo quỹ lương theo cơ sở, đơn vị; báo cáo BH, thuế (10.3, 10.4).

### 2.4. Admin (AD)

- Tài khoản, gán vai trò và đơn vị phạm vi (1.1); cơ cấu tổ chức đa cấp, đa cơ sở (1.2).
- Vùng lương và tham số pháp lý theo hiệu lực — thêm phiên bản mới, không sửa đè (1.3); chính
  sách theo cơ sở (1.4).
- Mở kỳ công, kỳ lương (1.5); tra cứu nhật ký kiểm toán (1.6).
- Danh mục ca, lịch nghỉ lễ (3.1); danh mục loại nghỉ (6.1).
- Nhập tệp dữ liệu chấm công của từng cơ sở (4.1).

> **Giới hạn của AD.** Admin có quyền cấu hình nhưng **không** xem dữ liệu lương chi tiết và
> **không** sửa hoặc xóa nhật ký kiểm toán — quyền UPDATE/DELETE trên bảng nhật ký bị thu hồi
> ở tầng cơ sở dữ liệu. Xem [10 §4](10-phan-quyen-va-bao-mat.md#4-nhật-ký-kiểm-toán-bất-biến).

## 3. Các bên liên quan ngoài hệ thống

| Bên liên quan | Quan hệ với hệ thống | Đầu vào / đầu ra |
|---|---|---|
| **Người lao động** (công nhân trực tiếp ~75%, nhân viên văn phòng, thử việc / thời vụ) | Đối tượng dữ liệu, không đăng nhập | Đơn nghỉ, giải trình công nộp cho tổ trưởng; nhận phiếu lương do KT xuất (7.6) |
| Ban lãnh đạo, Giám đốc nhà máy | Không đăng nhập | Phê duyệt chính sách lương, thưởng ngoài hệ thống; nhận báo cáo quỹ lương, chi phí do KT xuất (10.3, 9.4) |
| Trưởng phòng Nhân sự, Kế toán trưởng | Không đăng nhập (nếu cần thao tác thì được cấp vai trò KT) | Ký duyệt bảng lương, chứng từ trên bản kết xuất theo quy chế nội bộ |
| Kế hoạch sản xuất | Không đăng nhập | Cung cấp nhu cầu nhân lực, OT cho TT, QĐ làm căn cứ xếp ca, đề xuất OT |
| Công đoàn cơ sở | Không đăng nhập | Nhận báo cáo OT, nghỉ phép, KPCĐ để giám sát |
| Cơ quan BHXH | Bên ngoài | Nhận danh sách báo tăng, giảm do KT lập (8.3) và kê khai qua kênh của cơ quan |
| Cơ quan thuế | Bên ngoài | Nhận hồ sơ quyết toán do KT hoàn thiện từ dự thảo (8.5) |
| Ngân hàng | Bên ngoài | Nhận file chi lương do KT xuất (7.6); xuất file không đồng nghĩa đã thanh toán |

## 4. Ánh xạ từ mô hình 16 vai trò trước đây

Bộ tài liệu phiên bản 1.x dùng 5 nhóm actor và 16 vai trò. Bảng dưới cho biết mỗi actor cũ
được xử lý thế nào trong mô hình 4 tác nhân:

| Actor cũ | Vai trò cũ | Trong mô hình hiện tại |
|---|---|---|
| A1 · Nhân viên chấm công | `HR_TIMEKEEPER` | Nhập dữ liệu chấm công → **AD** (phạm vi cơ sở); xử lý ngoại lệ → **TT**; khóa kỳ công → **KT** |
| A2 · Chuyên viên hồ sơ & hợp đồng | `HR_RECORDS` | **KT** (phân hệ 2) |
| A3 · Chuyên viên tiền lương | `HR_PAYROLL` | **KT** (phân hệ 7) |
| A4 · Chuyên viên BHXH & thuế | `HR_INSURANCE_TAX` | **KT** (phân hệ 8, 6.4) |
| A5 · Trưởng phòng Nhân sự | `HR_MANAGER` | Bên ngoài hệ thống — phê duyệt chính sách trên bản kết xuất |
| B1 · Tổ trưởng | `LINE_LEADER` | **TT** |
| B2 · Quản đốc | `WORKSHOP_MANAGER` | **QĐ** |
| B3 · Kế hoạch sản xuất | `PRODUCTION_PLANNER` | Bên ngoài hệ thống |
| C1 – C3 · Người lao động | `EMPLOYEE` | Đối tượng dữ liệu — không có tài khoản, không có ESS |
| D1 · Kế toán tiền lương | `PAYROLL_ACCOUNTANT` | **KT** |
| D2 · Kế toán trưởng | `CHIEF_ACCOUNTANT` | Bên ngoài hệ thống (hoặc cấp vai trò KT nếu cần thao tác) |
| D3, D4 · Giám đốc nhà máy, Ban lãnh đạo | `PLANT_DIRECTOR`, `BOARD` | Bên ngoài hệ thống — nhận báo cáo |
| E1 · Chủ tịch Công đoàn | `UNION_CHAIR` | Bên ngoài hệ thống — nhận báo cáo |
| E2 · Quản trị hệ thống | `SYSTEM_ADMIN` | **AD** |
| E3 · IT vận hành | `IT_OPERATOR` | Không có vai trò nghiệp vụ; vận hành hạ tầng ngoài ứng dụng |

> **Mô hình nhiều địa điểm.** Các vai trò được cấp **lặp lại ở từng nhà máy** khi cần, mỗi
> tài khoản có phạm vi giới hạn bằng bản ghi phân quyền (tài khoản, vai trò, đơn vị phạm vi,
> hiệu lực): TT theo tổ, QĐ theo phân xưởng, AD nhập công theo cơ sở; KT tập trung tại trụ sở
> có thể được giao phạm vi cả 4 địa điểm.

## 5. Ma trận RACI theo quy trình

**R** = Thực hiện · **A** = Chịu trách nhiệm cuối · **C** = Được hỏi ý kiến · **I** = Được
thông báo. Quy trình tương ứng activity diagram tại [05](05-quy-trinh-nghiep-vu.md).

| Quy trình (AD) | TT | QĐ | KT | AD | Ngoài hệ thống |
|---|---|---|---|---|---|
| Cấu hình, tham số, mở kỳ (AD-01) | – | – | C | **R/A** | – |
| Hồ sơ, hợp đồng, chấm dứt HĐ (AD-02) | – | I | **R/A** | – | NLĐ: I |
| Xếp ca, duyệt lịch, đổi ca (AD-03) | **R** | **A** | – | C (danh mục ca) | Kế hoạch SX: C |
| Nhập dữ liệu chấm công (AD-04) | I | I | I | **R/A** | – |
| Xử lý ngoại lệ, xác nhận công tổ (AD-04) | **R/A** | I | – | – | NLĐ: C |
| Chốt công xưởng (AD-04) | C | **R/A** | I | – | – |
| Khóa kỳ công (AD-04) | – | C | **R/A** | – | – |
| Đề xuất và duyệt OT (AD-05) | **R** | **A** | I | – | NLĐ: C (đồng ý làm thêm) |
| Quy đổi nghỉ bù (AD-05) | I | I | **R/A** | – | – |
| Ghi nhận và duyệt đơn nghỉ (AD-06) | **R/A** | I | I | – | NLĐ: C |
| Quỹ phép, ốm đau – thai sản (AD-06) | – | – | **R/A** | – | – |
| Tính, duyệt, khóa bảng lương (AD-07) | – | – | **R/A** | – | Lãnh đạo: I |
| Truy lĩnh, truy thu (AD-07) | – | – | **R/A** | – | – |
| Phiếu lương, file chi lương (AD-07) | – | – | **R/A** | – | NLĐ, ngân hàng: I |
| BH, thuế, quyết toán năm (AD-08) | – | – | **R/A** | – | BHXH, thuế: I |
| Cấp phát phúc lợi (AD-09) | – | – | **R/A** | – | Lãnh đạo: C |
| Báo cáo (AD-10) | **R** (tổ) | **R** (xưởng) | **R** (cơ sở) | – | Lãnh đạo, công đoàn: I |

## 6. Kênh truy cập

| Tác nhân | Kênh | Ghi chú |
|---|---|---|
| TT, QĐ | Ứng dụng web trên máy tính tại văn phòng xưởng; giao diện tương thích máy tính bảng | Không phát triển ứng dụng di động riêng |
| KT | Ứng dụng web trên máy tính | Bảng biểu chi tiết, thao tác hàng loạt, kết xuất tệp |
| AD | Ứng dụng web trên máy tính | Nhập tệp chấm công, cấu hình |
| Người lao động | Không truy cập | Nhận phiếu lương bản in hoặc tệp do KT xuất; phản ánh sai lệch công qua tổ trưởng |
