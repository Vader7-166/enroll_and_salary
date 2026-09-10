# 05. Thuật toán chấm công và tính lương

Tài liệu này đặc tả thuật toán ở mức đủ để lập trình viên cài đặt và kiểm thử viên viết
test case. Mọi thuật toán đều tra tham số theo **ngày nghiệp vụ** (BR-03).

> **Cảnh báo trọng yếu.** Mục §3 (ca đêm bắc cầu) và §4 (tách đoạn giờ) là hai điểm dễ cài
> đặt sai nhất của toàn hệ thống. Sai ở đây làm sai dây chuyền toàn bộ số ngày công, hệ số
> OT, phụ cấp đêm và cuối cùng là số tiền trả cho người lao động.

---

## 1. Chuẩn hóa dữ liệu quẹt thẻ thô

### 1.1. Đầu vào

Bản ghi `raw_punch` bất biến, thu từ máy chấm công qua API/SDK hoặc import file:

```
[Mã nhân viên], [Ngày quẹt YYYY-MM-DD], [Giờ quẹt HH:MM:SS], [Mã máy], [Hình thức: Vào/Ra/Tự động]
```

### 1.2. Thuật toán khử lượt quẹt trùng (BR-17)

Công nhân thường quẹt nhiều lần liên tiếp khi đi qua cổng xưởng.

```
HÀM khu_quet_trung(danh_sách_lượt_quẹt, cửa_sổ = 5 phút):
    sắp xếp danh sách theo thời gian tăng dần
    nhóm ← gom các lượt quẹt liên tiếp cách nhau ≤ cửa_sổ
    VỚI MỖI nhóm:
        NẾU nhóm nằm trong khung giờ VÀO của ca:
            giữ lượt quẹt ĐẦU TIÊN
        NGƯỢC LẠI (khung giờ RA):
            giữ lượt quẹt CUỐI CÙNG
        đánh dấu các lượt còn lại là SUPPRESSED (không xóa khỏi raw_punch)
    TRẢ VỀ danh sách đã lọc
```

**Lưu ý cài đặt:** các lượt bị loại **không bị xóa** khỏi `raw_punch`, chỉ được đánh dấu ở
tầng dẫn xuất — bảo đảm tính bất biến của dữ liệu gốc (BR-19).

### 1.3. Thuật toán ghép cặp Vào/Ra (BR-18)

```
HÀM ghep_cap(nhân_sự, ngày_công, ca_được_phân, lượt_quẹt_đã_lọc):
    khung_vào ← [ca.giờ_bắt_đầu − biên_độ_trước, ca.giờ_bắt_đầu + biên_độ_sau]
    khung_ra  ← [ca.giờ_kết_thúc − biên_độ_trước, ca.giờ_kết_thúc + biên_độ_sau]

    check_in  ← lượt quẹt SỚM NHẤT nằm trong khung_vào
    check_out ← lượt quẹt MUỘN NHẤT nằm trong khung_ra

    NẾU check_in = rỗng HOẶC check_out = rỗng:
        trạng_thái ← 'ERR'
        gửi cảnh báo tới ESS của nhân sự
        hiển thị cảnh báo màu cam trên màn hình quản lý phân xưởng
        TRẢ VỀ bản ghi ngày công trạng thái ERR
    NGƯỢC LẠI:
        TRẢ VỀ cặp (check_in, check_out), trạng_thái 'OK'
```

**Biên độ mặc định (cấu hình được):** ±30 phút quanh giờ ca. Với ca C, khung nhận diện là
21:30 – 22:15 cho Vào và 05:45 – 06:30 cho Ra.

---

## 2. Ba tầng dữ liệu chấm công

Thuật toán vận hành trên ba tầng lưu trữ tách biệt:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TẦNG 1 · raw_punch                                                      │
│ Bản ghi quẹt thẻ nguyên trạng. CHỈ GHI THÊM, không bao giờ sửa/xóa.     │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ tính lại được bất cứ lúc nào
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TẦNG 2 · daily_attendance (dẫn xuất)                                    │
│ Công quy đổi, giờ ngày, giờ đêm, đi muộn, về sớm, trạng thái.           │
│ = f(raw_punch, lịch ca, đơn từ đã duyệt, tham số)                       │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ khóa kỳ
                               ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TẦNG 3 · attendance_snapshot / payroll_snapshot                         │
│ Ảnh chụp BẤT BIẾN tại thời điểm khóa kỳ, kèm hash nội dung.            │
└────────────────────────────────────────────────────────────────────────┘
```

**Vì sao ba tầng.** Phát hiện lỗi thuật toán ở tầng 2 thì tính lại được từ tầng 1 mà không
mất dữ liệu gốc; tầng 3 bảo đảm kỳ đã chốt không bao giờ thay đổi ngầm — điều kiện để bảng
công được chấp nhận là chứng từ kế toán theo Điều 105 BLLĐ.

---

## 3. Thuật toán ca đêm bắc cầu qua ngày

### 3.1. Nguyên tắc

Một **ngày công** là đơn vị nghiệp vụ gắn với **ca**, không gắn với ngày lịch.

```
        Ngày T                                    Ngày T+1
        │                                         │
  ──────┼─────────────────────────────────────────┼──────────────────►
        │            22:00 ┃━━━━━━━━━━━━━━━━━━━━━━┃ 06:00
        │                  ┃      CA C — 8 giờ    ┃
        │                  ┗━━━━━━━━━━━━━━━━━━━━━━┛
        │                  └──────────────────────┘
        │                    Toàn bộ gán về NGÀY T
        │                    (1 bản ghi ngày công duy nhất)
```

**Nếu tách theo ngày lịch:** một ca thành hai ngày công lẻ → sai số ngày công, sai phân loại
ngày lễ, và ca cuối tháng bị cắt đôi giữa hai kỳ lương.

### 3.2. Thuật toán

```
HÀM gan_ca_dem_bac_cau(nhân_sự, cặp_quẹt):
    ca ← tra lịch phân ca của nhân sự

    NẾU ca.giờ_kết_thúc < ca.giờ_bắt_đầu:        # ca vắt qua nửa đêm
        ngày_công ← ngày của check_in            # = ngày T
    NGƯỢC LẠI:
        ngày_công ← ngày của check_in

    thời_điểm_bắt_đầu  ← check_in
    thời_điểm_kết_thúc ← check_out               # có thể thuộc ngày T+1

    # Giờ OT nối tiếp sau ca cũng gán về CÙNG ngày công
    giờ_ot_nối_tiếp ← khoảng từ ca.giờ_kết_thúc tới check_out (nếu dương)

    TRẢ VỀ bản ghi ngày công {
        ngày_công,                  # dùng để ĐẾM CÔNG và xác định ranh giới kỳ
        thời_điểm_bắt_đầu,
        thời_điểm_kết_thúc,
        giờ_ot_nối_tiếp
    }
```

### 3.3. Hệ quả phải xử lý riêng

| Khái niệm | Dùng cho | Cách xác định |
|---|---|---|
| **Ngày công** | Đếm công, xác định ranh giới kỳ lương, xác định "đã có OT ngày trước đó" | Gán về ngày T |
| **Đoạn giờ** | Áp hệ số OT và phụ cấp đêm | Tách theo mốc 22:00 / 06:00 / 00:00 |

Hai khái niệm này **phải tách bạch ngay từ mô hình dữ liệu**. Ca C bắt đầu 22:00 ngày thường
và kết thúc 06:00 ngày lễ vẫn là **một ngày công của ngày thường**, nhưng có đoạn giờ chịu
hệ số ngày lễ.

### 3.4. Sáu tình huống biên bắt buộc kiểm thử

| # | Tình huống | Kết quả kỳ vọng |
|---|---|---|
| 1 | Ca C bắt đầu 22:00 ngày 25 (cut-off), kết thúc 06:00 ngày 26 | Toàn bộ thuộc kỳ công cũ, không cắt đôi |
| 2 | Ca C vắt từ ngày thường sang ngày lễ | 1 ngày công ngày thường; đoạn sau 00:00 áp hệ số ngày lễ |
| 3 | Ca C vắt từ ngày nghỉ tuần sang ngày thường | 1 ngày công ngày nghỉ tuần; đoạn sau 00:00 áp hệ số ngày thường |
| 4 | Ca C có OT nối tiếp tới 08:00 | Giờ OT gán cùng ngày công T; đoạn 06:00–08:00 là OT ban ngày |
| 5 | Ca C thiếu lượt quẹt ra | Trạng thái `ERR`, không tự suy diễn giờ ra |
| 6 | Đổi ca giữa chừng (bắt đầu ca B, chuyển sang ca C) | Ghi nhận theo ca thực tế đã duyệt đổi, không theo lịch gốc |

---

## 4. Thuật toán tách đoạn giờ

### 4.1. Ba mốc tách

| Mốc | Ý nghĩa |
|---|---|
| **22:00** | Bắt đầu khung giờ đêm |
| **06:00** | Kết thúc khung giờ đêm |
| **00:00** | Ranh giới **loại ngày** (thường / nghỉ tuần / lễ) |

### 4.2. Thuật toán

```
HÀM tach_doan_gio(thời_điểm_bắt_đầu, thời_điểm_kết_thúc, lịch_nghỉ_lễ):
    mốc ← {}
    thêm vào mốc: mọi thời điểm 00:00, 06:00, 22:00 nằm trong khoảng
    thêm vào mốc: thời_điểm_bắt_đầu, thời_điểm_kết_thúc
    sắp xếp mốc tăng dần

    đoạn ← []
    VỚI MỖI cặp mốc liên tiếp (m1, m2):
        là_ban_đêm ← (m1 nằm trong [22:00, 06:00 hôm sau])
        loại_ngày  ← phân_loại_ngày(ngày lịch của m1, lịch_nghỉ_lễ)
                     # 'THUONG' | 'NGHI_TUAN' | 'LE_TET'
        đoạn.thêm({
            từ: m1, đến: m2,
            số_giờ: m2 − m1,
            là_ban_đêm,
            loại_ngày
        })
    TRẢ VỀ đoạn
```

### 4.3. Ví dụ minh họa

**Ca OT từ 20:00 thứ Bảy (ngày thường) đến 02:00 Chủ nhật:**

| Đoạn | Khoảng | Số giờ | Ban đêm? | Loại ngày | Hệ số áp dụng |
|---|---|---|---|---|---|
| 1 | 20:00 – 22:00 | 2,0 | Không | Ngày thường | OT ngày thường **150%** |
| 2 | 22:00 – 00:00 | 2,0 | Có | Ngày thường | OT đêm ngày thường **210%** (đã có OT ngày trước đó) |
| 3 | 00:00 – 02:00 | 2,0 | Có | Nghỉ hằng tuần | OT đêm nghỉ tuần **270%** |

**Ca C chuẩn 22:00 ngày thường → 06:00, không OT:**

| Đoạn | Khoảng | Số giờ | Ban đêm? | Xử lý |
|---|---|---|---|---|
| 1 | 22:00 – 00:00 | 2,0 | Có | Giờ làm việc bình thường + phụ cấp đêm 30% |
| 2 | 00:00 – 06:00 | 6,0 | Có | Giờ làm việc bình thường + phụ cấp đêm 30% |

→ Tổng 8 giờ công ngày T, trong đó **8 giờ đêm** được hưởng phụ cấp 30%.

> **Điểm sai của file Excel hiện hành.** Công thức mẫu tính phụ cấp đêm bằng
> `(lương ÷ công_chuẩn ÷ 8) × 0,3 × 8 × (công_thực_tế ÷ 2)`, tức **giả định nửa số công là
> ca đêm** thay vì dùng số giờ đêm thực tế đã tách. Hệ thống mới thay thế hoàn toàn.

---

## 5. Thuật toán tính hệ số làm thêm giờ

### 5.1. Công thức gốc (Điều 57 NĐ 145/2020/NĐ-CP)

```
Tỷ lệ OT ban đêm = Tỷ lệ OT ngày (theo loại ngày)
                 + 30%
                 + 20% × Tỷ lệ ban ngày của loại ngày tương ứng
```

**Nguyên tắc cài đặt:** các con số 200% / 210% / 270% / 390% là **kết quả tính**, không lưu
làm hằng số. Nếu doanh nghiệp nâng hệ số OT ngày thường lên 160% (cao hơn luật, được phép),
hệ số OT đêm phải **tự động** thành 212%.

### 5.2. Thuật toán

```
HÀM ty_le_ot(đoạn_giờ, ngày_công, tham_số):
    r_ngày ← tham_số.hệ_số_OT[đoạn_giờ.loại_ngày]
             # THUONG → 1,50 · NGHI_TUAN → 2,00 · LE_TET → 3,00

    NẾU KHÔNG đoạn_giờ.là_ban_đêm:
        TRẢ VỀ r_ngày

    # Xác định "tỷ lệ ban ngày của loại ngày tương ứng"
    NẾU đoạn_giờ.loại_ngày = 'THUONG':
        NẾU ngày_công.đã_có_OT_ban_ngày:
            r_ban_ngày ← r_ngày          # 1,50
        NGƯỢC LẠI:
            r_ban_ngày ← 1,00            # đơn giá giờ bình thường
    NGƯỢC LẠI:
        r_ban_ngày ← r_ngày              # 2,00 hoặc 3,00

    phụ_cấp_đêm ← tham_số.phụ_cấp_ban_đêm      # 0,30
    hệ_số_cộng  ← tham_số.hệ_số_cộng_OT_đêm    # 0,20

    TRẢ VỀ r_ngày + phụ_cấp_đêm + hệ_số_cộng × r_ban_ngày
```

### 5.3. Bảng kiểm chứng bắt buộc

Bộ kiểm thử pháp lý phải so kết quả tính với bảng dưới đây:

| Loại ngày | Điều kiện | Phân rã | Kết quả |
|---|---|---|---|
| Ngày thường | Chưa có OT ban ngày | 150% + 30% + 20%×100% | **200%** |
| Ngày thường | Đã có OT ban ngày | 150% + 30% + 20%×150% | **210%** |
| Nghỉ hằng tuần | – | 200% + 30% + 20%×200% | **270%** |
| Lễ, Tết | – | 300% + 30% + 20%×300% | **390%** |

### 5.4. Điểm phân biệt 200% và 210%

Cờ `đã_có_OT_ban_ngày` là thuộc tính của **ngày công**, không phải của đoạn giờ. Trình tự
bắt buộc:

```
1. Dựng bản ghi ngày công (gán ca đêm về ngày T)
2. Xác định cờ đã_có_OT_ban_ngày cho ngày công đó
3. Tách đoạn giờ
4. MỚI áp hệ số cho từng đoạn
```

Đảo thứ tự 2 và 4 sẽ cho kết quả sai ở mọi ca đêm có OT ban ngày trước đó.

---

## 6. Thuật toán tính lương

### 6.1. Đơn giá giờ thực trả (BR-15)

```
Lương giờ thực trả = Lương tháng ÷ Tổng số giờ làm việc THỰC TẾ trong tháng
```

**Không đưa giờ nghỉ lễ / Tết có hưởng lương vào mẫu số.**

> **Bẫy mẫu số.** Tháng có 26 ngày công thực tế và 1 ngày lễ: chia cho 27 ngày để tính lương
> giờ OT là **hành vi trả thiếu lương làm thêm giờ**, bị xử phạt.

```
HÀM don_gia_gio(nhân_sự, kỳ, cấu_hình_đơn_vị):
    lương_căn_cứ ← tổng các cấu phần có cờ dùng_làm_căn_cứ_tính_OT
                   # mặc định: lương cơ bản theo HĐLĐ, cấu hình được

    NẾU cấu_hình_đơn_vị.ngày_công_chuẩn = 'CỐ_ĐỊNH':
        số_ngày ← cấu_hình_đơn_vị.giá_trị      # ví dụ 26
    NGƯỢC LẠI:
        số_ngày ← số ngày làm việc thực tế của kỳ, KHÔNG tính ngày lễ hưởng lương

    số_giờ ← số_ngày × giờ_chuẩn_mỗi_ngày      # 8
    TRẢ VỀ lương_căn_cứ ÷ số_giờ
```

### 6.2. Trình tự tính một bảng lương

```
ĐẦU VÀO: snapshot bảng công đã khóa, tham số theo ngày nghiệp vụ của kỳ

 1. LƯƠNG THEO THỜI GIAN / SẢN PHẨM
    lương_thời_gian ← lương_tháng × (công_thực_tế ÷ ngày_công_chuẩn)
    lương_sản_phẩm  ← Σ (sản_lượng × đơn_giá) hoặc theo KPI
    ─ Kiểm tra CP-09: thu nhập sản phẩm ≥ lương tối thiểu vùng

 2. LƯƠNG LÀM THÊM GIỜ
    VỚI MỖI đoạn_giờ OT:
        tiền_OT += đơn_giá_giờ × tỷ_lệ_ot(đoạn_giờ, ngày_công) × số_giờ_đoạn

 3. PHỤ CẤP CA ĐÊM (giờ làm việc bình thường trong khung đêm)
    phụ_cấp_đêm ← đơn_giá_giờ × 0,30 × tổng_giờ_đêm_KHÔNG_phải_OT

 4. PHỤ CẤP KHÁC, THƯỞNG, PHÚC LỢI
    theo công thức khai báo; mỗi khoản mang 3 cờ: is_insurable / is_taxable / is_prorated

 5. TỔNG THU NHẬP = (1) + (2) + (3) + (4)

 6. BẢO HIỂM BẮT BUỘC
    lương_đóng_BH ← Σ cấu phần có is_insurable = true
    lương_đóng_BH ← kẹp trong [sàn_vùng (+7% nếu qua đào tạo), trần_đóng]
    BHXH ← lương_đóng_BH × 8%      BHYT ← × 1,5%      BHTN ← × 1%
    đoàn_phí ← min(lương_đóng_BH × 1%, trần_đoàn_phí)

 7. BÓC TÁCH THU NHẬP MIỄN THUẾ
    miễn_thuế_OT ← Σ (tiền_OT_đoạn − đơn_giá_giờ × 100% × số_giờ_đoạn)
    miễn_thuế_khác ← ăn ca / trang phục / điện thoại / công tác phí trong định mức
    thu_nhập_chịu_thuế ← Σ cấu phần is_taxable − miễn_thuế_OT − miễn_thuế_khác

 8. THUẾ TNCN
    giảm_trừ ← bản_thân + (số_người_phụ_thuộc × mức_giảm_trừ) + BH bắt buộc + khác
    thu_nhập_tính_thuế ← max(0, thu_nhập_chịu_thuế − giảm_trừ)
    thuế ← biểu_luy_tien_7_bac(thu_nhập_tính_thuế)

 9. CÁC KHOẢN KHẤU TRỪ KHÁC
    tổng_khấu_trừ_khác ≤ 30% × (TỔNG THU NHẬP − BH − thuế)     ─ Kiểm tra CP-04

10. ĐIỀU CHỈNH
    + truy lĩnh / − truy thu từ kỳ trước
    + tiền đền bù chậm trả lương (nếu có)

11. THỰC LĨNH = (5) − BH − thuế − khấu trừ khác + điều chỉnh
    ─ Kiểm tra CP-05: thực lĩnh không được âm

12. LÀM TRÒN theo chính sách đã khai báo
```

### 6.3. Bộ máy công thức khai báo bằng dữ liệu

```
HÀM tinh_luong(nhân_sự, kỳ):
    công_thức ← nạp các định nghĩa cấu phần có hiệu lực tại ngày nghiệp vụ của kỳ
    đồ_thị    ← dựng đồ thị phụ thuộc giữa các cấu phần

    NẾU đồ_thị có chu trình:
        BÁO LỖI 'FORMULA_CYCLE_DETECTED', dừng, không ghi dữ liệu

    thứ_tự ← sắp xếp tô-pô(đồ_thị)
    ngữ_cảnh ← { dữ liệu công, tham số, hồ sơ nhân sự, hợp đồng }

    VỚI MỖI cấu_phần THEO thứ_tự:
        giá_trị ← đánh_giá_biểu_thức(cấu_phần.công_thức, ngữ_cảnh)
        ngữ_cảnh[cấu_phần.mã] ← giá_trị
        ghi vết: biểu thức, giá trị từng biến, tham số đã dùng   # phục vụ drill-down

    TRẢ VỀ ngữ_cảnh
```

**Ràng buộc của ngôn ngữ biểu thức:** tập hàm giới hạn, **không vòng lặp, không truy cập
I/O, không gọi hệ thống**. Mục đích là loại bỏ rủi ro thực thi mã tùy ý trên dữ liệu lương.

**Bù cho chi phí hiệu năng:** cache tham số và định nghĩa công thức trong một lần chạy lô;
màn hình drill-down bắt buộc có trước khi phát hành module lương.

---

## 7. Thuật toán thuế TNCN

### 7.1. Biểu thuế lũy tiến từng phần 7 bậc

```
HÀM thue_luy_tien(thu_nhập_tính_thuế, bậc_thuế):
    thuế ← 0
    còn_lại ← thu_nhập_tính_thuế
    VỚI MỖI bậc THEO thứ tự tăng dần:
        phần_trong_bậc ← min(còn_lại, bậc.giới_hạn_trên − bậc.giới_hạn_dưới)
        NẾU phần_trong_bậc ≤ 0: DỪNG
        thuế ← thuế + phần_trong_bậc × bậc.thuế_suất
        còn_lại ← còn_lại − phần_trong_bậc
    TRẢ VỀ thuế
```

Các bậc và thuế suất lấy từ bảng tham số theo hiệu lực (BR-02), **không viết cứng**.

> **Điểm sai của file Excel hiện hành.** Công thức mẫu dùng
> `IF(S≤5tr; 5%; IF(S≤10tr; 10%−250k; 15%−750k))` — **chỉ 3 bậc thay vì 7**, và mặc định
> giảm trừ gia cảnh cứng 11.000.000 không tính người phụ thuộc. Hệ thống mới thay thế.

### 7.2. Bóc tách thu nhập miễn thuế do làm thêm giờ

Chỉ **phần chênh lệch** so với đơn giá giờ làm việc bình thường được miễn thuế:

```
HÀM boc_tach_mien_thue(các_đoạn_OT, đơn_giá_giờ):
    chịu_thuế ← 0
    miễn_thuế ← 0
    VỚI MỖI đoạn:
        tiền_thực_trả ← đơn_giá_giờ × tỷ_lệ(đoạn) × số_giờ(đoạn)
        phần_gốc      ← đơn_giá_giờ × 1,00        × số_giờ(đoạn)
        chịu_thuế ← chịu_thuế + phần_gốc
        miễn_thuế ← miễn_thuế + (tiền_thực_trả − phần_gốc)
    TRẢ VỀ (chịu_thuế, miễn_thuế)
```

| Khoản OT | Phần chịu thuế | Phần miễn thuế |
|---|---|---|
| OT ngày thường 150% | 100% | 50% |
| OT nghỉ tuần 200% | 100% | 100% |
| OT lễ Tết 300% | 100% | 200% |
| OT đêm ngày thường 210% | 100% | 110% |
| OT đêm lễ Tết 390% | 100% | 290% |

---

## 8. Gross-up: NET → GROSS

### 8.1. Vì sao phải giải bằng lặp

Hàm `gross → net` **không nghịch đảo được ở dạng đóng** vì có trần đóng bảo hiểm và biểu
thuế lũy tiến bậc thang — đây là hàm liên tục **từng khúc**. Giải lặp là cách duy nhất
chính xác.

### 8.2. Thuật toán

```
HÀM gross_up(net_mục_tiêu, hồ_sơ, tham_số, sai_số_cho_phép = 1 đồng):
    HÀM net_từ_gross(g):
        lương_đóng_BH ← kẹp(g theo quy tắc cấu phần, [sàn, trần])
        bảo_hiểm ← lương_đóng_BH × (8% + 1,5% + 1%)
        giảm_trừ ← bản_thân + người_phụ_thuộc + bảo_hiểm
        thu_nhập_tính_thuế ← max(0, g − miễn_thuế − giảm_trừ)
        thuế ← thue_luy_tien(thu_nhập_tính_thuế, tham_số.bậc_thuế)
        TRẢ VỀ g − bảo_hiểm − thuế

    cận_dưới ← net_mục_tiêu
    cận_trên ← net_mục_tiêu × 2                 # đủ rộng cho bậc thuế cao nhất
    LẶP tối đa 100 lần:
        giữa ← (cận_dưới + cận_trên) ÷ 2
        net_thử ← net_từ_gross(giữa)
        NẾU |net_thử − net_mục_tiêu| ≤ sai_số_cho_phép:
            TRẢ VỀ giữa
        NẾU net_thử < net_mục_tiêu: cận_dưới ← giữa
        NGƯỢC LẠI:                  cận_trên ← giữa
    BÁO LỖI 'GROSS_UP_NOT_CONVERGED'
```

**Điều kiện dừng: sai số ≤ 1 đồng** — để số thực lĩnh khớp đúng thỏa thuận NET.

---

## 9. Thuật toán tính quỹ phép năm

```
HÀM quy_phep_nam(nhân_sự, năm):
    cơ_bản ← 12                                    # điều kiện bình thường
    NẾU công việc nặng nhọc, độc hại:      cơ_bản ← 14
    NẾU công việc đặc biệt nặng nhọc:      cơ_bản ← 16

    thâm_niên ← số năm làm việc đủ tại doanh nghiệp
    cộng_thêm ← FLOOR(thâm_niên ÷ 5)               # +1 ngày mỗi 5 năm

    tổng ← cơ_bản + cộng_thêm

    # Pro-rata cho người vào/nghỉ giữa năm
    NẾU vào làm hoặc nghỉ việc trong năm:
        số_tháng ← số tháng làm việc thực tế trong năm
        tổng ← LÀM_TRÒN(tổng × số_tháng ÷ 12, quy tắc cấu hình)

    chuyển_từ_năm_trước ← min(số dư năm trước, trần_chuyển)   # mặc định 5 ngày
    # hạn dùng phần chuyển: 31/03 năm sau

    TRẢ VỀ tổng + chuyển_từ_năm_trước
```

**Quy tắc trừ phép:** ngày lễ nằm trong kỳ nghỉ phép **không bị trừ** vào quỹ phép (BR-34),
được ghi ký hiệu `L`.

---

## 10. Quy tắc số học và làm tròn

| Quy tắc | Yêu cầu |
|---|---|
| Kiểu dữ liệu tiền tệ | **decimal** có độ chính xác xác định. Tuyệt đối không dùng float |
| Kiểu dữ liệu giờ công | decimal, đơn vị giờ, tối thiểu 2 chữ số thập phân |
| Chính sách làm tròn | Cấu hình **hai chiều**: làm tròn ở bước nào, đến hàng nào |
| Tính idempotent | Chạy lại cùng dữ liệu đầu vào phải cho cùng kết quả tuyệt đối |
| Thứ tự cộng | Cố định và khai báo được — làm tròn từng thành phần rồi cộng ≠ cộng rồi làm tròn |

> Float gây sai lệch cộng dồn trên 1.000 nhân sự × 12 kỳ. Sai lệch tiền lương dù nhỏ vẫn là
> hành vi "trả không đủ lương" theo chế tài.

---

## 11. Bộ dữ liệu kiểm thử bắt buộc

| Mã | Kịch bản | Kiểm chứng |
|---|---|---|
| TC-A01 | Quẹt 4 lần trong 3 phút lúc vào ca | Chỉ ghi nhận lượt đầu tiên |
| TC-A02 | Ca C vào 21:40 ngày T, ra 06:15 ngày T+1 | 1 công ngày T, 8 giờ đêm hưởng phụ cấp 30% |
| TC-A03 | Ca C thiếu lượt quẹt ra | Trạng thái `ERR`, cảnh báo tới ESS và MSS |
| TC-A04 | Ca C bắt đầu 22:00 ngày 25 (cut-off) | Thuộc trọn kỳ công cũ |
| TC-O01 | OT 2 giờ ban đêm ngày Chủ nhật | Hệ số **270%** |
| TC-O02 | OT ngày thường 2 giờ ban ngày + 2 giờ ban đêm | Đoạn ngày 150%, đoạn đêm **210%** |
| TC-O03 | OT đêm ngày thường không có OT ban ngày | Hệ số **200%** |
| TC-O04 | OT từ 20:00 thứ Bảy đến 02:00 Chủ nhật | Tách 3 đoạn: 150% / 210% / 270% |
| TC-O05 | Nâng hệ số OT ngày thường lên 160% trong tham số | Hệ số OT đêm tự động thành **212%** |
| TC-O06 | Nhân sự đạt 39/40 giờ OT tháng | Cảnh báo tới B1, B2, A5 kèm số giờ còn lại |
| TC-P01 | Lương HĐLĐ 5.000.000 tại vùng I | `CP-01` chặn chốt lương, đánh dấu đỏ |
| TC-P02 | Tăng lương hiệu lực ngày 15 giữa kỳ | Tách hai đoạn đơn giá trong cùng kỳ |
| TC-P03 | Thỏa thuận NET, gross-up | Sai số ≤ 1 đồng |
| TC-P04 | Khấu trừ vượt 30% NET | `CP-04` chặn |
| TC-P05 | Chạy lại kỳ 12/2025 vào tháng 02/2026 | Ra mức lương tối thiểu **của năm 2025** |
| TC-P06 | Chạy tính lương 2 lần cùng dữ liệu | Kết quả trùng khớp tuyệt đối |
| TC-T01 | Thu nhập tính thuế rơi vào bậc 5 | Khớp biểu lũy tiến 7 bậc |
| TC-T02 | OT lễ 300% | Miễn thuế đúng phần 200%, chịu thuế phần 100% |
| TC-L01 | Nghỉ phép 5 ngày có 1 ngày lễ xen giữa | Trừ 4 ngày phép, ngày lễ ghi `L` |
| TC-L02 | Vào làm tháng 7 | Quỹ phép pro-rata đúng 6/12 |
