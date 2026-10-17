# 03. Cơ cấu tổ chức và hệ thống chức danh

> **Vì sao cơ cấu tổ chức là tài liệu nền.** Trong hệ thống này, cây tổ chức không chỉ để
> hiển thị sơ đồ. Nó là **trục dữ liệu** quyết định bốn thứ: (1) mức lương tối thiểu vùng áp
> cho từng nhân sự, (2) phạm vi dữ liệu mà mỗi tài khoản được truy cập, (3) trung tâm chi phí
> để hạch toán TK 622/642, và (4) người duyệt của từng nghiệp vụ (tổ trưởng theo tổ, quản đốc
> theo phân xưởng). Sai cây tổ chức là sai dây chuyền cả bốn.
>
> Trong biểu đồ lớp, cây đơn vị là lớp `DonViPhongBan` (tự tham chiếu, `CapDo` 1..5), địa điểm
> là lớp `CoSo` gắn `VungLuong`; Admin quản lý ở chức năng 1.2 (SQ-15).

---

## 1. Mô hình cây đơn vị

### 1.1. Năm cấp đơn vị

| Cấp | `unit_type` | Tên gọi | Vai trò trong hệ thống |
|---|---|---|---|
| 1 | `COMPANY` | Công ty | Gốc cây; nơi khai báo cấu hình chính sách mặc định |
| 2 | `SITE` | Địa điểm (trụ sở / nhà máy) — lớp `CoSo` | **Mang mã vùng lương tối thiểu**; đơn vị nhập dữ liệu chấm công (4.1) và mở kỳ công, kỳ lương (1.5); phạm vi dữ liệu `SITE` |
| 3 | `BLOCK` | Khối (trực tiếp / gián tiếp) | Ranh giới chế độ làm việc (ca kíp vs hành chính) và quy tắc OT |
| 4 | `DEPARTMENT` | Phòng ban / Phân xưởng | **Mang cost center**; phạm vi dữ liệu `DEPARTMENT` (gồm cả cây con) |
| 5 | `TEAM` | Tổ / Nhóm / Chuyền | Đơn vị xếp ca và xác nhận công; phạm vi dữ liệu `TEAM` |

Cây **không giới hạn cứng ở 5 cấp** — hệ thống hỗ trợ cây sâu tùy ý; 5 cấp là mô hình đang
áp dụng cho doanh nghiệp này.

### 1.2. Nguyên tắc cấu trúc

| # | Nguyên tắc |
|---|---|
| 1 | Mỗi đơn vị có **đúng một** đơn vị cha (trừ gốc). Hệ thống **chặn vòng lặp** với lỗi `ORG_CYCLE_DETECTED` |
| 2 | Thuộc tính **kế thừa xuống dưới**: vùng lương tối thiểu từ `SITE`, quy tắc OT từ `BLOCK`, có thể ghi đè từng khóa ở cấp thấp hơn |
| 3 | Mọi đơn vị có cặp `effective_from` / `effective_to`; thay đổi cấu trúc tạo **phiên bản mới**, không ghi đè |
| 4 | Cost center gắn ở cấp `DEPARTMENT`; đơn vị cấp `TEAM` kế thừa cost center của phòng ban/phân xưởng cha |
| 5 | Nhân sự được phân công vào cấp thấp nhất có thể (thường là `TEAM` với khối trực tiếp, `DEPARTMENT` với khối gián tiếp) |

---

## 2. Sơ đồ tổ chức tổng thể

Doanh nghiệp có **4 địa điểm trên 3 vùng lương tối thiểu**, tổng quy mô **1.500 – 3.000 lao động**.

```
                         ┌───────────────────────────────────────┐
                         │   CÔNG TY TNHH SX LINH KIỆN ĐIỆN TỬ    │  CTY
                         │            Ban Tổng Giám đốc           │
                         └───────────────────┬───────────────────┘
        ┌────────────────────┬───────────────┴────────┬────────────────────┐
        ▼                    ▼                        ▼                    ▼
┌───────────────┐   ┌────────────────┐      ┌────────────────┐   ┌────────────────┐
│ TRỤ SỞ HÀ NỘI │   │ NM BẮC NINH     │      │ NM HÀ NAM      │   │ NM NGHỆ AN     │
│ HQ-HN         │   │ NM-BN           │      │ NM-HNA         │   │ NM-NA          │
│ ⬤ Vùng I      │   │ ⬤ Vùng I        │      │ ⬤ Vùng II      │   │ ⬤ Vùng III     │
│ ~180 người    │   │ ~1.100 người    │      │ ~600 người     │   │ ~320 người     │
│ Hành chính    │   │ 3 ca 24/7       │      │ 3 ca 24/7      │   │ 2 ca           │
└───────┬───────┘   └────────┬───────┘      └───────┬────────┘   └───────┬────────┘
        │                    │                      │                    │
     KHỐI GT          ┌──────┴──────┐        ┌──────┴──────┐      ┌──────┴──────┐
        │             │             │        │             │      │             │
        ▼          KHỐI TT      KHỐI GT   KHỐI TT      KHỐI GT  KHỐI TT     KHỐI GT
   Phòng ban          │             │        │             │      │             │
   chức năng      Phân xưởng    Phòng ban  Phân xưởng  Phòng ban Phân xưởng  Bộ phận
        │             │             │        │             │      │             │
        ▼             ▼             ▼        ▼             ▼      ▼             ▼
      Tổ/Nhóm      Tổ/Chuyền      Tổ      Tổ/Chuyền       Tổ    Tổ/Chuyền      Tổ
```

**Chú thích:** KHỐI TT = khối trực tiếp (sản xuất, làm ca kíp) · KHỐI GT = khối gián tiếp
(văn phòng, kỹ thuật, kho, bảo vệ, bếp — làm hành chính).

---

## 3. Danh mục địa điểm

| Mã | Tên địa điểm | Địa bàn | **Vùng** | Chế độ ca | Lao động (ước tính) | Chức năng chính |
|---|---|---|---|---|---|---|
| `HQ-HN` | Trụ sở chính Hà Nội | Hà Nội | **I** | Hành chính T2–T7 | ~180 | Điều hành, tài chính, kinh doanh, nhân sự tập trung |
| `NM-BN` | Nhà máy Bắc Ninh | Bắc Ninh | **I** | 3 ca × 8h, 24/7 | ~1.100 | Nhà máy chính: SMT, lắp ráp, kiểm tra, đóng gói |
| `NM-HNA` | Nhà máy Hà Nam | Hà Nam | **II** | 3 ca × 8h, 24/7 | ~600 | Cuộn dây, linh kiện thụ động, lắp ráp mô-đun |
| `NM-NA` | Nhà máy Nghệ An | Nghệ An | **III** | 2 ca × 8h | ~320 | Gia công cơ khí chính xác, hoàn thiện, đóng gói |

> ⚠ **Hệ quả pháp lý quan trọng.** Bốn địa điểm nằm trên **ba vùng lương tối thiểu khác
> nhau** (5.310.000 / 4.730.000 / 4.140.000 VND). Cổng chặn `CP-01` **không** so với một mức
> chung mà so với mức của **vùng tương ứng với đơn vị mà nhân sự thuộc về tại kỳ đó**. Xem
> **BR-66**.

**Phân bổ lao động theo khối:**

| Địa điểm | Khối trực tiếp | Khối gián tiếp | Tổng |
|---|---|---|---|
| `HQ-HN` | – | ~180 | ~180 |
| `NM-BN` | ~900 | ~200 | ~1.100 |
| `NM-HNA` | ~500 | ~100 | ~600 |
| `NM-NA` | ~270 | ~50 | ~320 |
| **Tổng** | **~1.670 (76%)** | **~530 (24%)** | **~2.200** |

---

## 4. Danh mục phòng ban và phân xưởng

### 4.1. Trụ sở Hà Nội — `HQ-HN` (khối gián tiếp)

| Mã đơn vị | Phòng ban | Cost center | TK | Tổ / Nhóm trực thuộc |
|---|---|---|---|---|
| `HN-BOD` | Ban Tổng Giám đốc | `CC-HN-BOD` | 642 | – |
| `HN-HR` | Phòng Nhân sự | `CC-HN-HR` | 642 | Tổ Tiền lương & C&B · Tổ Hồ sơ & HĐLĐ · Tổ BHXH & Thuế · Tổ Tuyển dụng & Đào tạo |
| `HN-FIN` | Phòng Tài chính – Kế toán | `CC-HN-FIN` | 642 | Tổ Kế toán tiền lương · Tổ Kế toán tổng hợp |
| `HN-PLAN` | Phòng Kế hoạch – Vật tư | `CC-HN-PLAN` | 642 | Tổ Kế hoạch sản xuất · Tổ Mua hàng |
| `HN-SALE` | Phòng Kinh doanh – XNK | `CC-HN-SALE` | 642 | Tổ Kinh doanh · Tổ Xuất nhập khẩu |
| `HN-IT` | Phòng Công nghệ thông tin | `CC-HN-IT` | 642 | Tổ Hạ tầng · Tổ Ứng dụng |
| `HN-ADM` | Phòng Hành chính – Pháp chế | `CC-HN-ADM` | 642 | Tổ Hành chính · Tổ Pháp chế |

### 4.2. Nhà máy Bắc Ninh — `NM-BN`

**Khối trực tiếp** (ca kíp, hạch toán **TK 622**):

| Mã đơn vị | Phân xưởng | Cost center | Tổ / Chuyền trực thuộc | Lao động |
|---|---|---|---|---|
| `BN-PX-SMT` | PX Công nghệ dán bề mặt (SMT) | `CC-BN-SMT` | Tổ SMT-1 · Tổ SMT-2 · Tổ SMT-3 · Tổ In kem hàn · Tổ AOI | ~300 |
| `BN-PX-ASM` | PX Lắp ráp | `CC-BN-ASM` | Tổ Lắp ráp 1 · Tổ Lắp ráp 2 · Tổ Lắp ráp 3 · Tổ Hàn | ~320 |
| `BN-PX-QC` | PX Kiểm tra chất lượng | `CC-BN-QC` | Tổ ICT · Tổ FCT · Tổ Kiểm tra ngoại quan | ~160 |
| `BN-PX-PKG` | PX Đóng gói | `CC-BN-PKG` | Tổ Đóng gói 1 · Tổ Đóng gói 2 | ~120 |

**Khối gián tiếp tại nhà máy** (hành chính, hạch toán **TK 642**):

| Mã đơn vị | Phòng ban | Cost center | Ghi chú |
|---|---|---|---|
| `BN-ENG` | Phòng Kỹ thuật sản xuất | `CC-BN-ENG` | Kỹ sư trực ca hỗ trợ sản xuất |
| `BN-QA` | Phòng Đảm bảo chất lượng | `CC-BN-QA` | Khác với PX Kiểm tra (khối trực tiếp) |
| `BN-WH` | Phòng Kho vận | `CC-BN-WH` | Tổ Kho NVL · Tổ Kho thành phẩm |
| `BN-HSE` | Phòng An toàn – Môi trường | `CC-BN-HSE` | |
| `BN-HRS` | Bộ phận Nhân sự nhà máy | `CC-BN-HRS` | Nhân sự được cấp vai trò **AD** phạm vi `NM-BN` để nhập dữ liệu chấm công |
| `BN-GA` | Bộ phận Hành chính nhà máy | `CC-BN-GA` | Tổ Bảo vệ · Tổ Bếp · Tổ Y tế |

### 4.3. Nhà máy Hà Nam — `NM-HNA`

| Mã đơn vị | Đơn vị | Khối | Cost center | Tổ trực thuộc |
|---|---|---|---|---|
| `HNA-PX-COIL` | PX Cuộn dây & Linh kiện thụ động | TT | `CC-HNA-COIL` | Tổ Quấn dây 1 · Tổ Quấn dây 2 · Tổ Ép nhựa |
| `HNA-PX-MOD` | PX Lắp ráp mô-đun | TT | `CC-HNA-MOD` | Tổ Lắp ráp A · Tổ Lắp ráp B |
| `HNA-PX-TPK` | PX Kiểm tra – Đóng gói | TT | `CC-HNA-TPK` | Tổ Test · Tổ Đóng gói |
| `HNA-ENG` | Phòng Kỹ thuật | GT | `CC-HNA-ENG` | – |
| `HNA-QA` | Bộ phận Đảm bảo chất lượng | GT | `CC-HNA-QA` | – |
| `HNA-WH` | Bộ phận Kho vận | GT | `CC-HNA-WH` | – |
| `HNA-HRS` | Bộ phận Hành chính – Nhân sự nhà máy | GT | `CC-HNA-HRS` | Tổ Bảo vệ · Tổ Bếp |

### 4.4. Nhà máy Nghệ An — `NM-NA`

| Mã đơn vị | Đơn vị | Khối | Cost center | Tổ trực thuộc |
|---|---|---|---|---|
| `NA-PX-MECH` | PX Gia công cơ khí chính xác | TT | `CC-NA-MECH` | Tổ Dập · Tổ Tiện–Phay CNC |
| `NA-PX-FIN` | PX Hoàn thiện & Đóng gói | TT | `CC-NA-FIN` | Tổ Sơn tĩnh điện · Tổ Đóng gói |
| `NA-ENG` | Bộ phận Kỹ thuật | GT | `CC-NA-ENG` | – |
| `NA-QA` | Bộ phận Đảm bảo chất lượng | GT | `CC-NA-QA` | – |
| `NA-HRS` | Bộ phận Hành chính – Nhân sự nhà máy | GT | `CC-NA-HRS` | Tổ Bảo vệ · Tổ Kho |

---

## 5. Quy ước mã hóa

| Đối tượng | Quy ước | Ví dụ |
|---|---|---|
| Mã địa điểm | `HQ-<tỉnh>` hoặc `NM-<tỉnh>` | `NM-BN`, `NM-HNA` |
| Mã phòng ban / phân xưởng | `<tỉnh>-<PX\|viết tắt>-<mã chức năng>` | `BN-PX-SMT`, `HN-HR` |
| Mã tổ / nhóm | `<mã đơn vị cha>-T<số>` | `BN-PX-SMT-T01` |
| Cost center | `CC-<tỉnh>-<mã chức năng>` | `CC-BN-SMT` |
| Mã nhân viên | `<mã site><số thứ tự 5 chữ số>` | `BN01427` |
| Mã chức danh | `<ngạch><cấp>-<viết tắt>` | `C5-TOTRUONG`, `D6-CVTL` |

**Ràng buộc:** mã đơn vị **không tái sử dụng** sau khi đơn vị bị giải thể — cần cho việc
truy vấn cấu trúc tổ chức tại thời điểm quá khứ.

---

## 6. Cây phân cấp chức vụ

### 6.1. Tám cấp chức vụ

```
 CẤP 1  ██████████  BAN TỔNG GIÁM ĐỐC                  Tổng GĐ · Phó Tổng GĐ
   │
 CẤP 2  █████████   GIÁM ĐỐC KHỐI / NHÀ MÁY            GĐ Nhà máy · GĐ Tài chính · GĐ Nhân sự
   │
 CẤP 3  ████████    TRƯỞNG PHÒNG / QUẢN ĐỐC            Trưởng phòng · Quản đốc phân xưởng
   │
 CẤP 4  ███████     PHÓ PHÒNG / PHÓ QUẢN ĐỐC           Phó phòng · Phó quản đốc
   │
 CẤP 5  ██████      TỔ TRƯỞNG / GIÁM SÁT               Tổ trưởng · Chuyền trưởng · Trưởng nhóm
   │
 CẤP 6  █████       CHUYÊN VIÊN / KỸ SƯ                Chuyên viên · Kỹ sư · NV nghiệp vụ
   │
 CẤP 7  ████        NHÂN VIÊN KỸ THUẬT                 KTV · Công nhân bậc cao · Tổ phó
   │
 CẤP 8  ███         CÔNG NHÂN SẢN XUẤT                 Công nhân · Lao động phổ thông
```

### 6.2. Ánh xạ cấp chức vụ ↔ ngạch lương

| Cấp | Ngạch | Tên ngạch | Số bậc | Chế độ làm việc | Hình thức trả lương |
|---|---|---|---|---|---|
| 1 | **A** | Quản lý cấp cao | 3 | Hành chính | Lương thời gian + thưởng hiệu quả |
| 2 | **A** | Quản lý cấp cao | 3 | Hành chính | Lương thời gian + thưởng hiệu quả |
| 3 | **B** | Quản lý cấp trung | 5 | Hành chính / trực ca | Lương thời gian + phụ cấp chức vụ |
| 4 | **B** | Quản lý cấp trung | 5 | Hành chính / trực ca | Lương thời gian + phụ cấp chức vụ |
| 5 | **C** | Giám sát | 6 | **Theo ca** | Lương thời gian + phụ cấp trách nhiệm |
| 6 | **D** | Chuyên môn nghiệp vụ | 8 | Hành chính | Lương thời gian + phụ cấp |
| 7 | **E** | Kỹ thuật | 8 | **Theo ca** | Lương thời gian + phụ cấp tay nghề |
| 8 | **F** | Công nhân sản xuất | 6 | **Theo ca** | Lương thời gian / sản phẩm KPI + phụ cấp |

> Ngạch – bậc được khai báo trong cơ cấu lương (chức năng 7.1, [07](07-yeu-cau-chuc-nang.md)).
> Mỗi bậc trong ngạch là một bản ghi có khoảng hiệu lực, không phải hằng số.

### 6.3. Danh mục chức danh tiêu biểu

Cột **Vai trò hệ thống** dùng bốn vai trò của BFD; “–” nghĩa là chức danh không có tài khoản
(đối tượng dữ liệu hoặc bên liên quan ngoài hệ thống, xem [02](02-cac-ben-lien-quan-va-vai-tro.md)).

| Mã chức danh | Chức danh | Cấp | Ngạch | Đơn vị áp dụng | Vai trò hệ thống |
|---|---|---|---|---|---|
| `A1-TGD` | Tổng Giám đốc | 1 | A | `HN-BOD` | – (nhận báo cáo) |
| `A2-GDNM` | Giám đốc Nhà máy | 2 | A | `NM-BN` / `NM-HNA` / `NM-NA` | – (nhận báo cáo) |
| `A2-GDTC` | Giám đốc Tài chính | 2 | A | `HN-FIN` | – (nhận báo cáo) |
| `B3-TPNS` | Trưởng phòng Nhân sự | 3 | B | `HN-HR` | – (phê duyệt ngoài hệ thống) |
| `B3-KTT` | Kế toán trưởng | 3 | B | `HN-FIN` | – hoặc **KT** nếu cần thao tác |
| `B3-QDPX` | Quản đốc phân xưởng | 3 | B | Các `*-PX-*` | **QĐ** |
| `B4-PQD` | Phó Quản đốc | 4 | B | Các `*-PX-*` | **QĐ** (khi được giao) |
| `C5-TOTRUONG` | Tổ trưởng sản xuất | 5 | C | Các `TEAM` khối TT | **TT** |
| `C5-CHUYENTRUONG` | Chuyền trưởng | 5 | C | Các chuyền lắp ráp | **TT** |
| `D6-CVTL` | Chuyên viên Tiền lương (C&B) | 6 | D | `HN-HR` | **KT** |
| `D6-CVHS` | Chuyên viên Hồ sơ & Hợp đồng | 6 | D | `HN-HR` | **KT** |
| `D6-CVBH` | Chuyên viên BHXH & Thuế | 6 | D | `HN-HR` | **KT** |
| `D6-NVCC` | Nhân viên chấm công | 6 | D | `*-HRS` tại từng nhà máy | **AD** (phạm vi cơ sở, chỉ nhập dữ liệu chấm công) |
| `D6-KTTL` | Kế toán tiền lương | 6 | D | `HN-FIN` | **KT** |
| `D6-CVKH` | Chuyên viên Kế hoạch sản xuất | 6 | D | `HN-PLAN` | – |
| `D6-QTHT` | Quản trị hệ thống | 6 | D | `HN-IT` | **AD** |
| `E7-KTV` | Kỹ thuật viên bảo trì | 7 | E | `*-ENG` | – (đối tượng dữ liệu) |
| `E7-CNBC` | Công nhân bậc cao | 7 | E | Các `TEAM` khối TT | – (đối tượng dữ liệu) |
| `F8-CNSX` | Công nhân sản xuất | 8 | F | Các `TEAM` khối TT | – (đối tượng dữ liệu) |
| `–` | Chủ tịch Công đoàn cơ sở | — | — | Kiêm nhiệm | – (nhận báo cáo) |

> **Một người, nhiều phân quyền.** Một tài khoản có thể có nhiều bản ghi phân quyền (vai trò ×
> đơn vị phạm vi × hiệu lực) — ví dụ phó quản đốc được giao quyền QĐ trong thời gian quản đốc
> vắng. Quyền là hợp của các bản ghi còn hiệu lực, phạm vi dữ liệu áp riêng cho từng bản ghi.

---

## 7. Quan hệ báo cáo

Với mô hình nhiều địa điểm, mỗi bộ phận chức năng tại nhà máy có **hai tuyến báo cáo**:

```
          TUYẾN TRỰC TUYẾN (solid line)          TUYẾN CHỨC NĂNG (dotted line)
          quản lý hằng ngày, duyệt đơn từ         chuẩn nghiệp vụ, chuyên môn
                        │                                     │
   ┌────────────────────┴─────────────┐      ┌────────────────┴──────────────┐
   │  Giám đốc Nhà máy Bắc Ninh       │      │  Trưởng phòng Nhân sự (HQ)     │
   └────────────────────┬─────────────┘      └────────────────┬──────────────┘
                        │                                     │
                        ▼                                     ▼
              ┌─────────────────────────────────────────────────────┐
              │  Bộ phận Nhân sự nhà máy Bắc Ninh  (BN-HRS)          │
              │  • Nhân viên nhập dữ liệu chấm công (vai trò AD)     │
              └─────────────────────────────────────────────────────┘
                 ▲ duyệt nghỉ phép, đánh giá         ▲ quy trình chấm công,
                   xếp lịch làm việc                    chuẩn dữ liệu, báo cáo
```

| Bộ phận tại nhà máy | Báo cáo trực tuyến | Báo cáo chức năng |
|---|---|---|
| Bộ phận Nhân sự nhà máy (`*-HRS`) | Giám đốc Nhà máy | Trưởng phòng Nhân sự (HQ) |
| Phòng/Bộ phận Đảm bảo chất lượng (`*-QA`) | Giám đốc Nhà máy | Giám đốc Chất lượng (HQ) |
| Phòng/Bộ phận Kỹ thuật (`*-ENG`) | Giám đốc Nhà máy | Giám đốc Kỹ thuật (HQ) |
| Bộ phận Kho vận (`*-WH`) | Giám đốc Nhà máy | Phòng Kế hoạch – Vật tư (HQ) |
| Phân xưởng sản xuất (`*-PX-*`) | Giám đốc Nhà máy | – |

**Quy tắc trong hệ thống:** quyền duyệt gắn với **phạm vi trực tiếp** của vai trò — tổ trưởng
duyệt đơn nghỉ của tổ mình, quản đốc duyệt lịch ca và OT của phân xưởng mình. Tuyến chức năng
không cấp quyền duyệt trên hệ thống. Xem **BR-74**.

---

## 8. Ánh xạ tổ chức ↔ phân quyền ↔ phê duyệt

### 8.1. Phạm vi dữ liệu suy ra từ vị trí trong cây

| Chức danh | Vai trò | Phạm vi | Tập dữ liệu thực tế |
|---|---|---|---|
| Tổ trưởng Tổ SMT-1 | **TT** | `TEAM` | Chỉ nhân sự Tổ SMT-1 tại kỳ đó |
| Quản đốc PX SMT | **QĐ** | `DEPARTMENT` | Toàn bộ 5 tổ thuộc PX SMT |
| Nhân viên chấm công NM Bắc Ninh | **AD** | `SITE` | Nhập dữ liệu chấm công của `NM-BN`; không xem lương |
| Kế toán tiền lương (HQ) | **KT** | `ALL` hoặc danh sách `SITE` được giao | Hồ sơ, công đã khóa, lương, BH, thuế, phúc lợi của phạm vi |
| Quản trị hệ thống (HQ) | **AD** | `ALL` | Cấu hình, danh mục, tham số, nhật ký; không xem lương chi tiết |

> **Điểm then chốt.** Mỗi tài khoản có các bản ghi phân quyền (tài khoản, vai trò, **đơn vị
> phạm vi**, hiệu lực — lớp `PhanQuyen`, chức năng 1.1). Tập nhân sự thuộc đơn vị phạm vi được
> **suy ra động từ cây tổ chức tại thời điểm truy vấn**, không lưu cứng danh sách. Điều chuyển
> một công nhân từ Tổ SMT-1 sang Tổ Lắp ráp 2 thì dữ liệu hai tổ trưởng nhìn thấy tự thay đổi.

### 8.2. Người lập và người duyệt theo BFD

Luồng duyệt **cố định theo BFD**, không có bộ máy workflow cấu hình hay ủy quyền:

| Nghiệp vụ | Người lập | Người duyệt / chốt | Chức năng |
|---|---|---|---|
| Lịch ca tháng của tổ | TT | QĐ duyệt hoặc trả lại | 3.2, 3.4 |
| Đề xuất đổi ca | TT | QĐ | 3.3, 3.4 |
| Giải trình, điều chỉnh công | TT (kèm lý do, chứng cứ) | TT xác nhận công tổ → QĐ chốt xưởng | 4.3 – 4.5 |
| Bảng công tháng | Hệ thống tổng hợp | TT xác nhận tổ → QĐ chốt xưởng → KT khóa kỳ công | 4.4, 4.5 |
| Đề xuất OT | TT | QĐ duyệt cấp 2 sau kiểm soát trần | 5.1 – 5.3 |
| Đơn nghỉ | TT ghi nhận thay công nhân | **TT** — cấp duyệt duy nhất | 6.3 |
| Bảng lương | KT | KT duyệt và khóa | 7.5 |
| Truy lĩnh, truy thu | Hệ thống tính chênh lệch | KT xác nhận | 7.4 |
| Chấm dứt hợp đồng | KT | KT xác nhận | 2.5 |
| Cấp phát phúc lợi | Hệ thống lập danh sách dự kiến | KT xác nhận | 9.2 |

> Phê duyệt nội bộ của lãnh đạo (chính sách lương – thưởng, kế hoạch OT lớn, ký bảng lương)
> thực hiện **ngoài hệ thống** trên bản kết xuất theo quy chế của doanh nghiệp. Hệ thống không
> mô hình hóa các cấp duyệt này.

---

## 9. Chức danh và phân công

| Khái niệm | Định nghĩa | Ví dụ |
|---|---|---|
| **Chức danh** (job title) | Tên gọi chuẩn hóa của công việc, gắn cấp và ngạch | "Tổ trưởng sản xuất" |
| **Phân công** | Gán một nhân sự vào một đơn vị, có ngày hiệu lực; thay đổi phân công là quyết định điều chuyển (2.3) | NV `BN01427` → Tổ SMT-1, từ 01/03/2026 |

> **Định biên** (số vị trí được duyệt theo đơn vị × chức danh) **không thuộc phạm vi BFD** hiện
> tại. Nếu cần, có thể bổ sung ở giai đoạn sau như một báo cáo của phân hệ 10.

---

## 10. Thay đổi cơ cấu tổ chức theo thời gian

### 10.1. Các loại thay đổi

| Loại | Mô tả | Xử lý trong hệ thống |
|---|---|---|
| **Thành lập** | Mở đơn vị mới | Tạo bản ghi mới với `effective_from` |
| **Đổi tên** | Giữ nguyên vị trí trong cây | Tạo **phiên bản mới**, giữ nguyên mã đơn vị |
| **Tách** | Một đơn vị thành nhiều | Đóng phiên bản cũ, tạo các đơn vị mới; nhân sự được phân công lại có ngày hiệu lực |
| **Gộp** | Nhiều đơn vị thành một | Đóng các đơn vị cũ, chuyển nhân sự sang đơn vị đích |
| **Đổi đơn vị cha** | Chuyển nhánh trong cây | Tạo phiên bản mới; **kiểm tra chống vòng lặp** |
| **Giải thể** | Đóng đơn vị | Đặt `effective_to`; **không xóa**; mã đơn vị không tái sử dụng |

### 10.2. Nguyên tắc bất biến của dữ liệu lịch sử

```
   Kỳ 09/2026                        01/11/2026                    Kỳ 11/2026
   ───────────────────────────────────────┼────────────────────────────────────►
   Tổ Lắp ráp 1 (150 người)               │   Tổ Lắp ráp 1 (80 người)
                                          │   Tổ Lắp ráp 2 (70 người)  ← mới tách
                                          │
   Báo cáo kỳ 09/2026 hiển thị:           │   Báo cáo kỳ 11/2026 hiển thị:
   ✔ Tổ Lắp ráp 1 với 150 người           │   ✔ Cả hai tổ
   ✘ KHÔNG hiển thị Tổ Lắp ráp 2          │
```

**Quy tắc:** mọi báo cáo của một kỳ dùng **cấu trúc tổ chức tại kỳ đó**, không dùng cấu trúc
hiện hành. Điều này bảo đảm in lại báo cáo kỳ cũ sau nhiều tháng vẫn khớp số liệu đã nộp.
Xem **BR-72**.

### 10.3. Điều chuyển nhân sự

| Tình huống | Xử lý |
|---|---|
| Điều chuyển **trong cùng địa điểm** | KT nhập quyết định điều chuyển có ngày hiệu lực (2.3); chi phí phân bổ về hai cost center theo tỷ lệ ngày công |
| Điều chuyển **liên tỉnh** (khác vùng lương) | Như trên, **cộng thêm**: áp mức lương tối thiểu vùng theo từng đoạn thời gian; kiểm tra lương HĐLĐ không bị giảm; ký phụ lục HĐLĐ |
| Biệt phái ngắn hạn | Giữ đơn vị chính, thêm phân công phụ có tỷ lệ phân bổ |
| Điều chuyển hiệu lực giữa kỳ | Tách hai đoạn đơn giá và hai cost center trong cùng kỳ lương |

> ⚠ **Rủi ro điều chuyển từ vùng cao sang vùng thấp.** Chuyển một công nhân từ NM Bắc Ninh
> (Vùng I) sang NM Nghệ An (Vùng III) **không cho phép giảm lương** theo thỏa thuận đã ký —
> áp dụng nguyên tắc bảo toàn tại **BR-08**. Hệ thống cảnh báo khi lưu quyết định điều chuyển
> kèm điều chỉnh lương giảm.

---

## 11. Quy tắc nghiệp vụ về cơ cấu tổ chức

Tiếp nối hệ mã `BR-xx` của [04. Quy tắc nghiệp vụ](04-quy-tac-nghiep-vu.md).

### BR-66 · Vùng lương tối thiểu xác định theo địa điểm của đơn vị 🔴

Mỗi đơn vị cấp `SITE` mang một `region_code`; các đơn vị con **kế thừa** giá trị này. Cổng
chặn `CP-01` so lương hợp đồng và lương đóng bảo hiểm của từng nhân sự với mức tối thiểu của
**vùng tương ứng với đơn vị mà nhân sự thuộc về tại kỳ đó**, không dùng một mức chung toàn
công ty.

*Trường hợp đặc biệt:* đơn vị nằm trong khu công nghiệp giáp ranh nhiều vùng → áp **mức cao
nhất** (BR-07).

### BR-67 · Nhân sự làm việc nhiều địa điểm trong cùng kỳ 🔴

Khi một nhân sự thuộc hai địa điểm khác vùng trong cùng một kỳ lương, hệ thống PHẢI:

1. Tách kỳ thành các **đoạn thời gian** theo ngày hiệu lực của từng phân công.
2. Áp mức lương tối thiểu vùng **của từng đoạn** khi kiểm tra `CP-01`.
3. Phân bổ chi phí về **cost center của từng đơn vị** theo tỷ lệ ngày công thực tế.
4. Ghi rõ trên phiếu lương số ngày công và đơn vị tương ứng của từng đoạn.

### BR-68 · Điều chuyển phải có quyết định và ngày hiệu lực 🟡

Mọi thay đổi phân công đơn vị phải gắn với một quyết định nhân sự có số hiệu và ngày hiệu
lực (chức năng 2.3). Quyết định có hiệu lực rơi vào kỳ đã khóa được xử lý **hồi tố** (7.4,
SQ-07): kỳ đã khóa giữ nguyên, chênh lệch ghi thành bút toán điều chỉnh ở kỳ đang mở (BR-42).

### BR-69 · Mỗi đơn vị có đúng một cost center 🔵

Cost center gắn ở cấp `DEPARTMENT`; `TEAM` kế thừa từ cha. Loại đơn vị quyết định tài khoản
hạch toán: khối trực tiếp → **TK 622**, khối gián tiếp → **TK 642**.

### BR-70 · Một đơn vị chính, nhiều phân công phụ 🔵

Tại mỗi thời điểm, một nhân sự có **đúng một** đơn vị chính (`is_primary = true`) dùng cho
phân quyền và xếp ca. Có thể có thêm phân công phụ với `allocation_ratio` dùng cho phân bổ
chi phí. Tổng tỷ lệ phân bổ của một nhân sự trong một kỳ phải bằng **100%**.

### BR-71 · Người duyệt xác định theo vai trò và phạm vi 🟡

Người duyệt của mỗi nghiệp vụ cố định theo BFD (§8.2): QĐ duyệt lịch ca, đổi ca và OT của
xưởng; TT duyệt đơn nghỉ của tổ; KT duyệt và khóa bảng lương. Không có cấu hình workflow theo
đơn vị và **không được bỏ bước** chốt xưởng của QĐ trước khi KT khóa kỳ công.

### BR-72 · Báo cáo dùng cấu trúc tổ chức của kỳ báo cáo 🔵

Mọi báo cáo và phân bổ chi phí của một kỳ sử dụng cây tổ chức **tại kỳ đó**. Thay đổi cơ cấu
sau kỳ không làm thay đổi số liệu báo cáo kỳ cũ.

### BR-73 · *(Tạm ngưng)* Định biên

Định biên không thuộc phạm vi BFD hiện tại (§9). Mã quy tắc giữ lại để không đánh số lại.

### BR-74 · Phê duyệt đi theo tuyến trực tuyến 🟡

Quyền duyệt chỉ áp trong **đơn vị phạm vi** của bản ghi phân quyền: TT trong tổ, QĐ trong
phân xưởng. Tuyến báo cáo chức năng không cấp quyền duyệt trên hệ thống.

### BR-75 · Mỗi địa điểm có cấu hình vận hành riêng 🟡

Các khóa cấu hình sau khai báo được ở cấp `SITE` và kế thừa xuống dưới: chế độ ca (2 ca / 3
ca / hành chính), ngày chốt công, ngày công chuẩn tháng, dung sai đi muộn, quy tắc OT, định
dạng tệp chấm công của cơ sở. Đây là **chính sách theo cơ sở** (chức năng 1.4, lớp
`ChinhSachCoSo`, có hiệu lực). Giao diện luôn hiển thị **nguồn gốc** của giá trị đang có hiệu
lực (BR-05).

---

## 12. Ảnh hưởng của cơ cấu tổ chức tới các nghiệp vụ khác

| Nghiệp vụ | Phụ thuộc vào cơ cấu tổ chức như thế nào | Tài liệu |
|---|---|---|
| **Lương tối thiểu vùng** | `region_code` của `SITE` quyết định mức so sánh trong `CP-01` | [04 §B](04-quy-tac-nghiep-vu.md), [12](12-tuan-thu-phap-ly.md) |
| **Phân quyền dữ liệu** | `TEAM`/`DEPARTMENT`/`SITE` suy ra động từ cây tại thời điểm truy vấn | [10](10-phan-quyen-va-bao-mat.md) |
| **Hạch toán chi phí** | Cost center của đơn vị quyết định TK 622 / TK 642 trên báo cáo quỹ lương (10.3) | [13](13-bao-cao-va-ket-xuat.md) |
| **Xếp ca và chấm công** | Chế độ ca khai báo ở `SITE`; tổ là đơn vị xếp ca và xác nhận công | [05 §4, §5](05-quy-trinh-nghiep-vu.md) |
| **Dữ liệu chấm công** | AD nhập tệp chấm công theo từng `SITE` (4.1) | [11 §1](11-tich-hop-he-thong.md) |
| **Luồng duyệt** | TT, QĐ duyệt trong phạm vi tổ, xưởng; KT khóa kỳ | §8.2, [05](05-quy-trinh-nghiep-vu.md) |
| **Cấu hình chính sách** | Kế thừa theo cây, ghi đè từng khóa | BR-05, BR-75 |
| **Báo cáo** | Dùng cấu trúc tổ chức của kỳ báo cáo | [13 §6](13-bao-cao-va-ket-xuat.md) |
| **Sổ quản lý lao động** | Vị trí việc làm và chức danh công việc là 2 trong 20 tiêu chí bắt buộc | [07 – 2.1](07-yeu-cau-chuc-nang.md) |

---

## 13. Rủi ro đặc thù của mô hình nhiều địa điểm

| # | Rủi ro | Biện pháp |
|---|---|---|
| **RO-01** | Áp nhầm mức lương tối thiểu của vùng khác cho nhân sự ở nhà máy tỉnh | `region_code` bắt buộc trên mọi `SITE`; `CP-01` chạy theo từng nhân sự, không theo mức chung; test riêng cho 3 vùng |
| **RO-02** | Điều chuyển liên tỉnh làm giảm lương xuống dưới mức đã thỏa thuận | Cảnh báo khi lưu quyết định điều chuyển có giảm lương (BR-08) |
| **RO-03** | Tệp chấm công của nhà máy tỉnh nhập trễ hoặc sai định dạng làm chậm chốt công | Kiểm tra định dạng khi nhập, báo danh sách dòng lỗi (SQ-02); theo dõi trạng thái nhập theo từng `SITE` |
| **RO-04** | Cấu hình ca của nhà máy này bị áp nhầm cho nhà máy khác | Cấu hình khai báo ở cấp `SITE`; giao diện hiển thị nguồn gốc giá trị (BR-75) |
| **RO-05** | Chi phí nhân công phân bổ sai cost center khi nhân sự thuộc hai đơn vị | Tổng `allocation_ratio` phải bằng 100% (BR-70); báo cáo đối chiếu theo cost center |
| **RO-06** | Người ngoài phạm vi duyệt nhầm đơn của tổ / xưởng khác | Quyền duyệt kiểm tra theo đơn vị phạm vi (BR-74); test phân quyền riêng |
| **RO-07** | Cây tổ chức của kỳ cũ bị thay đổi làm lệch báo cáo đã nộp | Đơn vị có phiên bản theo thời gian; báo cáo dùng cấu trúc của kỳ (BR-72) |

---

## 14. Danh mục cần khai báo trước khi vận hành

| ☐ | Danh mục | Cấp khai báo | Phụ trách |
|---|---|---|---|
| ☐ | 4 địa điểm kèm vùng lương và địa bàn | `SITE` | AD (lãnh đạo xác nhận) |
| ☐ | 2 khối (trực tiếp / gián tiếp) tại mỗi địa điểm | `BLOCK` | AD |
| ☐ | Toàn bộ phòng ban và phân xưởng kèm cost center | `DEPARTMENT` | AD (KT cung cấp cost center) |
| ☐ | Toàn bộ tổ / chuyền | `TEAM` | AD (QĐ cung cấp danh sách) |
| ☐ | 8 cấp chức vụ và 6 ngạch lương kèm số bậc | Công ty | KT (cơ cấu lương 7.1) |
| ☐ | Danh mục chức danh | Công ty | KT |
| ☐ | Tài khoản TT, QĐ, KT, AD kèm đơn vị phạm vi | Từng tài khoản | AD |
| ☐ | Chính sách theo `SITE` (ca, chốt công, dung sai, quy tắc OT, định dạng tệp chấm công) | `SITE` | AD |
| ☐ | Phân công nhân sự vào đơn vị kèm ngày hiệu lực | Từng nhân sự | KT |
