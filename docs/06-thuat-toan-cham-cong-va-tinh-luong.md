# 06. Thuật toán chấm công và tính lương

Tài liệu này đặc tả thuật toán ở mức đủ để lập trình viên cài đặt và kiểm thử viên viết
test case. Mọi thuật toán đều tra tham số theo **ngày nghiệp vụ** (BR-03).

> **Cảnh báo trọng yếu.** Mục §3 (ca đêm bắc cầu) và §4 (tách đoạn giờ) là hai điểm dễ cài
> đặt sai nhất của toàn hệ thống. Sai ở đây làm sai dây chuyền toàn bộ số ngày công, hệ số
> OT, phụ cấp đêm và cuối cùng là số tiền trả cho người lao động.

---

## 1. Chuẩn hóa dữ liệu quẹt thẻ thô

### 1.1. Đầu vào

Bản ghi `raw_punch` (lớp `DuLieuChamCongTho`) bất biến, do **AD nhập theo lô từ tệp chấm công
của từng cơ sở** (chức năng 4.1, lớp `LoNhapChamCong`). Hệ thống không kết nối trực tiếp máy
chấm công; tệp sai cấu trúc hoặc sai mã nhân viên bị từ chối kèm danh sách dòng lỗi (SQ-02).
Định dạng một dòng:

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
    bắt_đầu ← timestamp(ngày_công, ca.giờ_bắt_đầu, múi_giờ_cơ_sở)
    ngày_kết_thúc ← ngày_công + (1 ngày nếu ca.CoQuaNgay, ngược lại 0)
    kết_thúc ← timestamp(ngày_kết_thúc, ca.giờ_kết_thúc, múi_giờ_cơ_sở)
    kết_thúc_kỳ_vọng ← cuối khoảng OT nối tiếp đã duyệt, nếu có; nếu không dùng kết_thúc
    khung_vào ← [bắt_đầu − biên_vào_trước, bắt_đầu + biên_vào_sau]
    khung_ra  ← [kết_thúc_kỳ_vọng − biên_ra_trước, kết_thúc_kỳ_vọng + biên_ra_sau]

    check_in  ← lượt quẹt SỚM NHẤT nằm trong khung_vào
    check_out ← lượt quẹt MUỘN NHẤT nằm trong khung_ra

    NẾU một lượt có nhiều ca ứng viên hoặc check_out ≤ check_in:
        TRẢ VỀ ngoại lệ cần giải trình; không ghép hoặc đếm trùng tùy ý

    NẾU check_in = rỗng HOẶC check_out = rỗng:
        trạng_thái ← 'ERR'
        đưa vào danh sách ngoại lệ của tổ để tổ trưởng giải trình (4.3)
        hiển thị cảnh báo màu cam trên màn hình tổ trưởng và quản đốc
        TRẢ VỀ bản ghi ngày công trạng thái ERR
    NGƯỢC LẠI:
        TRẢ VỀ cặp (check_in, check_out), trạng_thái 'OK'
```

**Biên độ cấu hình riêng theo chiều Vào/Ra:** với ca C không OT nối tiếp, Vào 21:30–22:15
ngày T và Ra 05:45–06:30 ngày T+1. Nếu OT nối tiếp được duyệt tới 08:00, biên Ra trước
15/sau 30 phút cho cửa sổ 07:45–08:30. Mở rộng ghép lượt không tự cấp tiền OT; lượt không
khớp đưa ngoại lệ, không bỏ log và không suy diễn giờ ra. Trước khi ghép, lấy các ca ứng
viên bằng lịch đã duyệt/cửa sổ, không gán `ngày_công` bằng ngày quẹt.

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
mất dữ liệu gốc; tầng 3 bảo đảm kỳ đã khóa không bao giờ thay đổi ngầm — điều kiện để bảng
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
HÀM gan_ca_dem_bac_cau(nhân_sự, cặp_quẹt, lịch_ca_đã_ghép):
    ca ← lịch_ca_đã_ghép                     # Phải là ca duy nhất đã xác minh.
    ngày_công ← ngày bắt đầu ca trong lịch   # Không lấy ngày lịch của check_in.
    kỳ_đích ← kỳ công cùng phạm vi chứa ngày_công

    thời_điểm_bắt_đầu  ← check_in
    thời_điểm_kết_thúc ← check_out               # có thể thuộc ngày T+1

    # Giờ OT nối tiếp sau ca cũng gán về CÙNG ngày công
    giờ_ot_thực_tế_nối_tiếp ← khoảng từ thời điểm kết thúc ca tới check_out (nếu dương)
    # Lưu giờ thực tế; giờ trả tiền còn đối chiếu khoảng OT đã duyệt.

    TRẢ VỀ bản ghi ngày công {
        ngày_công,                  # dùng để ĐẾM CÔNG và xác định ranh giới kỳ
        kỳ_đích,
        thời_điểm_bắt_đầu,
        thời_điểm_kết_thúc,
        giờ_ot_thực_tế_nối_tiếp
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

### 3.5. Phân tuyến qua ngày chốt và hàng rào chốt kỳ

Theo [17](17-vong-doi-ky-cong-va-ca-qua-ngay-chot.md), ngày công 25 đi kỳ cũ dù Ra sáng 26;
ca 00:00 ngày 26 vào sớm 23:45 ngày 25 đi kỳ mới. Các đoạn vẫn tách theo ngày lịch để áp
hệ số, không làm hai kỳ cùng đếm một ca.

```
HÀM phan_tuyen(log, kỳ_tham_chiếu):
    ứng_viên ← ca đã duyệt trong kỳ tham chiếu/liền kề có cửa sổ chứa log
    NẾU thiếu hoặc mơ_hồ(ứng_viên): ghi ngoại lệ chờ phân tuyến; TRẢ VỀ
    ngày_công ← ứng_viên.duy_nhất.ngày_bắt_đầu_ca
    kỳ_đích ← kỳ ATTENDANCE cùng phạm vi chứa ngày_công
    NẾU kỳ_đích = rỗng: ghi ngoại lệ thiếu kỳ; TRẢ VỀ
    NẾU kỳ_đích.status = OPEN:
        kiểm tra lại status/revision trong giao dịch ghi công
        ghép/tính lại; hủy xác nhận/chốt xưởng bị ảnh hưởng nếu dữ liệu đổi
    NẾU kỳ_đích.status = PLANNED: chờ AD mở, chưa sinh công
    NẾU kỳ_đích.status = CLOSED: chờ KT trả lại trước khóa
    NẾU kỳ_đích.status = LOCKED: tạo hồ sơ log muộn, không sửa snapshot

HÀM chot_ky_cong(kỳ):
    collection_until ← max(cuối cửa sổ Ra các ca có ngày_công thuộc kỳ)
    YÊU CẦU đã qua collection_until; nguồn được xác nhận đủ tới mốc này
    YÊU CẦU hết tác vụ ghi, hết ngoại lệ chặn, mọi tổ/xưởng đã xác nhận/chốt
    kiểm tra lại revision; chuyển OPEN → CLOSED

HÀM khoa_ky(kỳ, revision_kỳ_vọng):
    khóa phạm vi trong giao dịch; kiểm tra status = CLOSED, revision khớp
    kiểm tra lại đủ dữ liệu và không còn tác vụ ghi
    kiểm tra kỳ trước đã tồn tại cùng loại/phạm vi LOCKED (trừ kỳ khởi tạo)
    với kỳ lương: kiểm tra toàn bộ nguồn công đã LOCKED, bảng lương đã duyệt
    ghi snapshot + hash + nguồn + trạng thái LOCKED nguyên tử; ghi audit
```

Log thô hợp lệ được giữ ngay cả khi kết quả phải chờ/muộn; trạng thái kỳ đích chỉ điều
khiển ghi dữ liệu dẫn xuất. Tác vụ gặp `PERIOD_STATE_CONFLICT` phải đọc lại trạng thái và
phân tuyến lại, không thử ghi mù sau khi kỳ đã khóa. Lượt trùng không tạo lại hồ sơ muộn.

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
hệ số OT đêm ngày thường phải **tự động** thành **210%** khi chưa có OT ban ngày
(`160% + 30% + 20% × 100%`) hoặc **222%** khi đã có OT ban ngày
(`160% + 30% + 20% × 160%`). Trong ví dụ này, phụ cấp đêm giữ ở 30% và hệ số cộng giữ ở 20%.

### 5.2. Thuật toán

```
HÀM ty_le_ot(đoạn_giờ, ngày_công, tham_số):
    r_ngày ← tham_số.hệ_số_OT[đoạn_giờ.loại_ngày]
             # Ví dụ tham số chuẩn: THUONG → 1,50 · NGHI_TUAN → 2,00 · LE_TET → 3,00
             # THUONG có thể được cấu hình thành 1,60; không ghi cứng các giá trị này.

    NẾU KHÔNG đoạn_giờ.là_ban_đêm:
        TRẢ VỀ r_ngày

    # Xác định "tỷ lệ ban ngày của loại ngày tương ứng"
    NẾU đoạn_giờ.loại_ngày = 'THUONG':
        NẾU ngày_công.đã_có_OT_ban_ngày:
            r_ban_ngày ← r_ngày          # Lấy theo tham số: ví dụ 1,50 hoặc 1,60
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

**Tham số chuẩn:** OT ngày thường 150%, nghỉ hằng tuần 200%, lễ/Tết 300%; phụ cấp đêm 30%,
hệ số cộng OT đêm 20%.

| Loại ngày | Điều kiện | Phân rã | Kết quả |
|---|---|---|---|
| Ngày thường | Chưa có OT ban ngày | 150% + 30% + 20%×100% | **200%** |
| Ngày thường | Đã có OT ban ngày | 150% + 30% + 20%×150% | **210%** |
| Nghỉ hằng tuần | – | 200% + 30% + 20%×200% | **270%** |
| Lễ, Tết | – | 300% + 30% + 20%×300% | **390%** |

**Kiểm chứng khi chỉ đổi tham số OT ngày thường từ 150% lên 160%:**

| Loại ngày | Điều kiện | Phân rã | Kết quả |
|---|---|---|---|
| Ngày thường | OT ban ngày | Theo tham số OT ngày thường | **160%** |
| Ngày thường | OT ban đêm, chưa có OT ban ngày | 160% + 30% + 20%×100% | **210%** |
| Ngày thường | OT ban đêm, đã có OT ban ngày | 160% + 30% + 20%×160% | **222%** |
| Nghỉ hằng tuần | OT ban đêm | 200% + 30% + 20%×200% | **270%** (không đổi) |
| Lễ, Tết | OT ban đêm | 300% + 30% + 20%×300% | **390%** (không đổi) |

### 5.4. Phân biệt OT đêm ngày thường có và chưa có OT ban ngày

Với tham số OT ngày thường 150%, hai nhánh cho 200% / 210%; khi đổi lên 160%, hai nhánh
cho 210% / 222%. Không suy ra nhánh xử lý từ con số hệ số cuối cùng.

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
Đơn giá giờ OT (lương thời gian) = Tiền lương công việc đủ điều kiện
                                 ÷ Số giờ làm việc bình thường tương ứng
```

**Không đưa giờ OT, giờ nghỉ lễ/Tết hưởng lương vào mẫu số; không dùng 26 × 8 mặc định.**
Căn cứ tử/mẫu số theo Điều 55 NĐ 145/2020 và [18 §4.4](18-xac-nhan-chinh-sach-va-dau-vao-tinh-luong.md).

> **Bẫy mẫu số.** Tháng có 26 ngày công thực tế và 1 ngày lễ: chia cho 27 ngày để tính lương
> giờ OT là **hành vi trả thiếu lương làm thêm giờ**, bị xử phạt.

```
HÀM don_gia_gio(nhân_sự, kỳ, bộ_đầu_vào_đã_xác_nhận):
    YÊU CẦU phương án lương thời gian; hình thức khác tra công thức OT tương ứng
    lương_căn_cứ ← tổng cấu phần đủ điều kiện theo công việc, hồ sơ và hiệu lực
    số_giờ ← số giờ làm việc bình thường tương ứng có nguồn đã xác nhận
              # Loại giờ OT/nghỉ lễ theo quy tắc, không thay bằng công chuẩn mô phỏng.
    NẾU thiếu căn cứ hoặc số_giờ ≤ 0: BÁO LỖI 'PAYROLL_INPUT_MISSING'
    TRẢ VỀ lương_căn_cứ ÷ số_giờ
```

### 6.2. Trình tự tính một bảng lương

```
ĐẦU VÀO: snapshot bảng công đã khóa, tham số lương/BH theo ngày nghiệp vụ,
         ngữ cảnh thuế theo thời điểm chi trả (dự kiến nếu chưa trả), hồ sơ cư trú/HĐ,
         phương án lương và bộ đầu vào CONFIRMED theo tài liệu 18

 0. KIỂM TRA ĐẦU VÀO
    chọn phương án theo nhân viên/đoạn hiệu lực; nạp đúng một bản hiệu lực của mỗi nguồn
    thiếu cấu phần bắt buộc → PAYROLL_INPUT_MISSING, không tự coi là 0
    CONFIRMED_ZERO và NOT_APPLICABLE phải có căn cứ riêng

 1. LƯƠNG THEO PHƯƠNG ÁN ĐƯỢC GÁN (không cộng mọi hình thức mặc định)
    thời_gian ← lương_tháng × (công_được_trả ÷ ngày_công_chuẩn) nếu phương án dùng lương tháng
    sản_phẩm ← Σ (sản_lượng_nghiệm_thu × đơn_giá_đúng_hiệu_lực) nếu áp dụng
    khoán / hoa_hồng / 3P ← công thức đã khai báo với nguồn đã xác nhận tương ứng
    lương_chính ← kết hợp khoản thay thế/cộng thêm đúng phương án, không tính trùng
    ─ Kiểm tra CP-09: thu nhập sản phẩm ≥ lương tối thiểu vùng

 2. LƯƠNG LÀM THÊM GIỜ
    lương thời gian: Σ đơn_giá_giờ × tỷ_lệ_ot(đoạn_giờ, ngày_công) × số_giờ_đoạn đủ căn cứ
    lương sản phẩm/hình thức khác: công thức OT và đầu vào được xác nhận theo phương án
    COMP_TIME_ENABLED=false: không quy đổi, không trừ khoản OT hoặc giờ thực tế

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
    ngữ_cảnh_thuế ← chon_bo_quy_tac_thue(hồ_sơ, thời_điểm_chi_trả, chế_độ_tính)
    khoản_thu_nhập ← phân bổ (1)..(4) thành các khoản/đoạn không trùng nhau
    (chịu_thuế_OT_đêm, miễn_thuế_OT_đêm) ← boc_tach_mien_thue(khoản_OT_đêm, ngữ_cảnh_thuế)
    miễn_thuế_khác ← tính theo điều kiện/định mức còn hiệu lực của từng khoản
    thu_nhập_chịu_thuế ← Σ phần chịu thuế của từng khoản sau phân loại đúng một lần

 8. THUẾ TNCN
    NẾU ngữ_cảnh_thuế.cách_khấu_trừ = 'PROGRESSIVE':
        giảm_trừ ← bản_thân + người_phụ_thuộc_đủ_điều_kiện + BH bắt buộc + khác hợp lệ
        thu_nhập_tính_thuế ← max(0, thu_nhập_chịu_thuế − giảm_trừ)
        thuế ← thue_luy_tien(thu_nhập_tính_thuế, ngữ_cảnh_thuế.bậc_thuế_tháng)
    NGƯỢC LẠI:
        thuế ← khấu_trừ_theo_đối_tượng(thu_nhập_chịu_thuế, ngữ_cảnh_thuế)
        # Nhánh 10% kiểm tra ngưỡng mỗi lần trả/cam kết; nhánh không cư trú 20%.
        # Không tự trừ giảm trừ gia cảnh hay áp biểu lũy tiến cho hai nhánh này.

 9. CÁC KHOẢN KHẤU TRỪ KHÁC
    tổng_khấu_trừ_khác ≤ 30% × (TỔNG THU NHẬP − BH − thuế)     ─ Kiểm tra CP-04

10. ĐIỀU CHỈNH
    + truy lĩnh / − truy thu từ kỳ trước
    + tiền đền bù chậm trả lương (nếu có)

11. THỰC LĨNH = (5) − BH − thuế − khấu trừ khác + điều chỉnh
    ─ Kiểm tra CP-05: thực lĩnh không được âm

12. LÀM TRÒN theo chính sách đã khai báo
```

Khoản truy lĩnh/thưởng/phúc lợi chi bổ sung phải đi qua phân loại thuế của **lần chi trả**
trước khi xác định thực lĩnh; bước 10 không phải đường cộng khoản chịu thuế để bỏ qua bước 7–8.
Nếu đã khấu trừ ở nơi khác trong cùng lần chi, đối soát và chỉ trừ chênh lệch, không trừ hai lần.
`is_taxable` là thuộc tính phân loại ban đầu, không thay thế quy tắc miễn thuế theo thời gian;
không vừa loại khoản khỏi tổng chịu thuế vừa trừ lại phần miễn của chính khoản đó.

### 6.3. Bộ máy công thức khai báo bằng dữ liệu

```
HÀM tinh_luong(nhân_sự, kỳ):
    bộ_đầu_vào ← nạp nguồn CONFIRMED, đúng version/phương án; kiểm tra thiếu/trùng
    công_thức ← nạp các định nghĩa cấu phần có hiệu lực tại ngày nghiệp vụ của kỳ
    đồ_thị    ← dựng đồ thị phụ thuộc giữa các cấu phần

    NẾU đồ_thị có chu trình:
        BÁO LỖI 'FORMULA_CYCLE_DETECTED', dừng, không ghi dữ liệu

    thứ_tự ← sắp xếp tô-pô(đồ_thị)
    ngữ_cảnh ← { dữ liệu công, tham số, hồ sơ nhân sự, hợp đồng, bộ_đầu_vào, hash_nguồn }

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

### 7.0. Chọn ngữ cảnh thuế theo thời điểm chi trả

Áp dụng [BR-03, BR-52…55](04-quy-tac-nghiep-vu.md) và [ma trận 12 §2.7](12-tuan-thu-phap-ly.md).

```
HÀM chon_bo_quy_tac_thue(hồ_sơ, thời_điểm_chi_trả, chế_độ_tính):
    YÊU CẦU có ngày chi trả thực tế hoặc ngày dự kiến được đánh dấu 'PROJECTED'
    NẾU chế_độ_tính = 'REPLAY_FILED':
        TRẢ VỀ snapshot ngữ cảnh và số đã khấu trừ của hồ sơ gốc
    kỳ_thuế ← kỳ theo thời_điểm_chi_trả / thời điểm nhận thu nhập
    đối_tượng ← xác định cư trú và cách khấu trừ theo hồ sơ, HĐ và kỳ thuế
    bộ_quy_tắc ← tra theo đối_tượng, kỳ_thuế và phạm vi áp dụng của văn bản
    # Cư trú: bộ 2026 từ kỳ thuế 2026, không đợi 01/07/2026.
    # Không cư trú: quy tắc mới của NĐ 253 từ 01/07/2026.
    # Riêng định mức ăn ca mới: từ 01/07/2026 cho cả khi quyết toán năm.
    NẾU thiếu/chồng phiên bản tham số bắt buộc: BÁO LỖI 'TAX_RULESET_INVALID'
    TRẢ VỀ { kỳ_thuế, đối_tượng, bộ_quy_tắc, ngày_trả, trạng_thái_ngày_trả,
             phiên_bản, căn_cứ, chế_độ_tính }
```

Tính nháp chỉ dự báo khấu trừ. Đổi ngày trả qua năm phải chọn lại bộ thuế trước khi xác nhận
khoản chi; không mở khóa bảng lương cũ. Hồ sơ 01/01–30/06/2026 đã nộp theo bộ cũ được giữ
nguyên số khấu trừ thực tế và đối soát tại quyết toán theo khoản 2 Điều 70 NĐ 253/2026.
Không dùng số tính lại theo luật mới thay cho số đã nộp trong báo cáo lịch sử.

### 7.1. Biểu thuế lũy tiến từng phần

Biểu thuế là bảng tham số `BacThueTNCN` có hiệu lực; mỗi kỳ dùng biểu còn hiệu lực của kỳ tính
thuế tương ứng **của khoản chi trả**. Bảng sau dành cho **cá nhân cư trú, nhánh lũy tiến**,
không dùng cho nhánh khấu trừ 10% hoặc không cư trú 20%.

| Bậc | Từ kỳ tính thuế 2026 (Luật 109/2025/QH15) | Thuế suất | Đến hết 2025 | Thuế suất |
|---|---|---|---|---|
| 1 | Đến 10 triệu | 5% | Đến 5 triệu | 5% |
| 2 | Trên 10 đến 30 triệu | 10% | Trên 5 đến 10 triệu | 10% |
| 3 | Trên 30 đến 60 triệu | 20% | Trên 10 đến 18 triệu | 15% |
| 4 | Trên 60 đến 100 triệu | 30% | Trên 18 đến 32 triệu | 20% |
| 5 | Trên 100 triệu | 35% | Trên 32 đến 52 triệu | 25% |
| 6 | – | – | Trên 52 đến 80 triệu | 30% |
| 7 | – | – | Trên 80 triệu | 35% |

Thu nhập tính thuế theo tháng = thu nhập chịu thuế − giảm trừ bản thân − giảm trừ người phụ
thuộc − BH bắt buộc phần người lao động. Giảm trừ gia cảnh từ kỳ tính thuế 2026: 15,5 triệu /
6,2 triệu đồng mỗi tháng (NQ 110/2025/UBTVQH15); đến hết 2025: 11 triệu / 4,4 triệu.

```
HÀM thue_luy_tien(thu_nhập_tính_thuế, bậc_thuế):
    thuế ← 0
    cơ_sở ← max(0, thu_nhập_tính_thuế)     # Đã trừ giảm trừ; không trừ lần nữa.
    VỚI MỖI bậc TRONG bậc_thuế THEO thứ tự tăng dần:
        trần ← bậc.giới_hạn_trên hoặc +∞ nếu là bậc cuối
        phần_trong_bậc ← max(0, min(cơ_sở, trần) − bậc.giới_hạn_dưới)
        thuế ← thuế + phần_trong_bậc × bậc.thuế_suất
    TRẢ VỀ thuế
```

Các bậc và thuế suất lấy từ bảng tham số theo hiệu lực (BR-02), **không viết cứng**.

Quyết toán năm dùng ngưỡng năm (ngưỡng tháng × 12), giảm trừ theo số tháng đủ điều kiện;
không áp bảng tháng trực tiếp lên tổng thu nhập năm. Thu nhập tính thuế 45 triệu/tháng
cho thuế **5.500.000 đ** ở bộ 2026 và **8.000.000 đ** ở bộ 2025; không áp một thuế suất
20%/25% lên toàn bộ 45 triệu.

> **Điểm sai của file Excel hiện hành.** Công thức mẫu dùng
> `IF(S≤5tr; 5%; IF(S≤10tr; 10%−250k; 15%−750k))` — **chỉ 3 bậc**, không khớp biểu 7 bậc (đến
> 2025) lẫn biểu 5 bậc (từ 2026), và mặc định
> giảm trừ gia cảnh cứng 11.000.000 không tính người phụ thuộc. Hệ thống mới thay thế.

### 7.2. Bóc tách miễn thuế OT, làm đêm và ngày không nghỉ phép

Không suy ra chế độ miễn thuế từ ngày chạy hoặc tên kỳ công. Bộ 2025 miễn phần chênh lệch
(điểm i khoản 1 Điều 3 TT 111/2013). Bộ 2026 của cá nhân cư trú miễn khoản trả đủ điều kiện
theo Điều 26 NĐ 253/2026, gồm cả phần lương gốc tương ứng giờ OT/đêm; phần vượt mức chịu thuế.
Việc miễn của cá nhân không cư trú chọn theo ma trận hiệu lực riêng tại 12 §2.7.

```
HÀM boc_tach_mien_thue(các_khoản_OT_đêm, ngữ_cảnh_thuế):
    chịu_thuế ← 0
    miễn_thuế ← 0
    VỚI MỖI khoản không trùng nguồn/đoạn:
        tiền_thực_trả ← khoản.số_tiền
        NẾU thiếu chứng từ/phân bổ/căn cứ miễn: BÁO NGOẠI LỆ, chưa cho duyệt kết quả
        NẾU ngữ_cảnh_thuế.chế_độ_miễn = 'PREMIUM_ONLY':
            phần_gốc ← tiền giờ làm bình thường tương ứng
            phần_miễn ← max(0, tiền_thực_trả − phần_gốc) theo căn cứ bộ lịch sử
        NGƯỢC LẠI NẾU ngữ_cảnh_thuế.chế_độ_miễn = 'ELIGIBLE_PAYMENT':
            phần_miễn ← min(tiền_thực_trả, số_tiền_đủ_điều_kiện_Điều_26)
            # Số đủ điều kiện được xác định từ thời gian/mức/căn cứ pháp luật và chứng từ.
            # Không tự miễn toàn bộ chỉ vì có nhãn OT hoặc cờ đã duyệt.
        miễn_thuế ← miễn_thuế + phần_miễn
        chịu_thuế ← chịu_thuế + (tiền_thực_trả − phần_miễn)
    TRẢ VỀ (chịu_thuế, miễn_thuế)
```

| Khoản trả | Bộ 2025: chịu / miễn | Bộ 2026 cư trú: chịu / miễn, khi đủ điều kiện |
|---|---|---|
| OT ngày thường 150% | 100% / 50% | 0% / 150% |
| OT nghỉ tuần 200% | 100% / 100% | 0% / 200% |
| OT lễ Tết 300% | 100% / 200% | 0% / 300% |
| OT đêm ngày thường 210% | 100% / 110% | 0% / 210% |
| OT đêm lễ Tết 390% | 100% / 290% | 0% / 390% |
| Làm đêm bình thường 130% | 100% / 30% | 0% / 130% |

**Phân bổ không trùng:** ca đêm 8 giờ, đơn giá 100.000 đ/giờ gồm lương gốc 800.000 đ trong
lương thời gian và phụ cấp 240.000 đ. Bộ 2025 miễn 240.000 đ; bộ 2026 đủ điều kiện miễn
1.040.000 đ. Chỉ tách 800.000 đ thuộc giờ đêm khỏi lương thời gian, không miễn toàn bộ lương
tháng hoặc cộng lại lương gốc vào tổng thu nhập. Tiền ngày không nghỉ phép là khoản riêng,
xác minh điều kiện khoản 2 Điều 26 trước khi phân loại, không đưa thành giờ làm thực tế.

Nhánh khấu trừ 10% tra ngưỡng theo **lần trả** và điều kiện cam kết; không dùng thu nhập
đã trừ gia cảnh để so ngưỡng. Bộ 2026: mức từ 5.000.000 đ/lần, dưới ngưỡng chỉ khấu trừ nếu
cá nhân yêu cầu; nhánh không cư trú áp 20% trên thu nhập chịu thuế thuộc Việt Nam, không
giảm trừ gia cảnh. Các khoản miễn đã phân loại không được trừ hai lần.

---

## 8. Gross-up: NET → GROSS

### 8.1. Vì sao phải giải bằng lặp

Hàm `gross → net` **không nghịch đảo được ở dạng đóng** vì có trần đóng bảo hiểm và biểu
thuế lũy tiến bậc thang — đây là hàm liên tục **từng khúc**. Giải lặp là cách duy nhất
chính xác.

### 8.2. Thuật toán

```
HÀM gross_up(net_mục_tiêu, hồ_sơ, tham_số, ngữ_cảnh_thuế, sai_số_cho_phép = 1 đồng):
    HÀM net_từ_gross(g):
        lương_đóng_BH ← kẹp(g theo quy tắc cấu phần, [sàn, trần])
        bảo_hiểm ← lương_đóng_BH × (8% + 1,5% + 1%)
        giảm_trừ ← bản_thân + người_phụ_thuộc + bảo_hiểm
        miễn_thuế ← phân loại các cấu phần của g theo ngữ_cảnh_thuế (§7.2)
        thu_nhập_tính_thuế ← max(0, g − miễn_thuế − giảm_trừ)
        thuế ← khấu trừ theo ngữ_cảnh_thuế; nhánh lũy tiến dùng thue_luy_tien
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

Các ca TC-O01–TC-O04 dùng bộ tham số chuẩn tại §5.3. TC-O05, TC-O05b và TC-O05c chỉ đổi
tham số OT ngày thường lên 160%; các tham số khác giữ nguyên.

| Mã | Kịch bản | Kiểm chứng |
|---|---|---|
| TC-A01 | Quẹt 4 lần trong 3 phút lúc vào ca | Chỉ ghi nhận lượt đầu tiên |
| TC-A02 | Ca C vào 21:40 ngày T, ra 06:15 ngày T+1 | 1 công ngày T, 8 giờ đêm hưởng phụ cấp 30% |
| TC-A03 | Ca C thiếu lượt quẹt ra | Trạng thái `ERR`, vào danh sách ngoại lệ của tổ trưởng |
| TC-A04 | Ca C ngày 25/09/2026, Vào 21:58, Ra 26/09 06:10; kỳ 09 còn OPEN, kỳ 10 đã OPEN | Một bản ghi công ngày 25 trong kỳ 09; nhận cả lượt Ra ngày 26; 8 giờ ca đêm theo quy tắc ca, không tự trả OT trong biên Ra |
| TC-A04b | Ca C ngày 25, OT nối tiếp đã duyệt đến 26 08:00; quẹt Ra 08:00, biên Ra trước 15/sau 30 phút | Cửa sổ Ra 07:45–08:30; cùng ngày công 25/kỳ cũ; đoạn 06:00–08:00 là OT ban ngày, giờ trả tiền còn đối chiếu thực tế/duyệt |
| TC-A04c | Ca bắt đầu 26 00:00, Vào 25 23:45, Ra 26 08:00; cửa sổ ca cho phép | Thuộc ngày công 26/kỳ mới; không gán theo ngày lịch của lượt Vào |
| TC-A04d | Cùng file có lượt Ra ca C ngày 25 lúc 26 06:10 và Vào ca ngày 26 lúc 07:55; hai nhân viên/lịch xác định rõ | Phân tuyến kỳ cũ/mới theo ca; một lượt không được dùng hai lần; nhập lại không sinh thêm công |
| TC-A04e | Kỳ cũ LOCKED; nhập file TC-A04d | Ra ca cũ thành một hồ sơ muộn ngoài snapshot, Vào ca mới vẫn xử lý ở kỳ OPEN; nhập lại không tạo thêm hồ sơ; hash kỳ cũ giữ nguyên |
| TC-A04f | Một lượt AUTO nằm trong cửa sổ của hai ca hoặc không có lịch duyệt | Ngoại lệ chờ phân tuyến; không chọn ca tùy ý, không chốt khi còn dòng có thể ảnh hưởng kỳ |
| TC-K01 | Trước ngày 20, kỳ cũ OPEN; tạo kỳ tiếp theo PLANNED, lập/duyệt ca rồi AD mở | Thành công dù kỳ trước chưa khóa; log PLANNED chỉ chờ, không tự sinh công hoặc tự mở kỳ |
| TC-K02 | Tạo kỳ cùng loại/phạm vi có ngày công chồng kỳ đã tồn tại | `PERIOD_OVERLAP`; các trạng thái PLANNED/OPEN/CLOSED/LOCKED đều tính chống chồng |
| TC-K03 | Ca C cuối kỳ không OT, cửa sổ Ra kết thúc 26 06:30; thử chốt lúc 06:15; với OT đến 08:00 thử lúc 08:15 | `COLLECTION_INCOMPLETE`; đủ nguồn/xác nhận/ngoại lệ và sau 06:30 hoặc 08:30 tương ứng mới cho chốt; không tự khóa lúc hết ngày 25 |
| TC-K04 | Kỳ CLOSED chưa khóa; KT trả OPEN có lý do, QĐ trả xưởng cần sửa; thêm/sửa công rồi chốt lại | Có audit; xác nhận/chốt bị ảnh hưởng mất hiệu lực, phải xác nhận và đối soát lại; LOCKED không được trả lại |
| TC-K05 | Khóa kỳ sau CLOSED khi kỳ trước đã tồn tại cùng loại/phạm vi chưa khóa | `PREV_PERIOD_NOT_LOCKED` chỉ tại khóa; sau khóa kỳ trước và đủ điều kiện, cho khóa kỳ sau |
| TC-K06 | Kỳ lương tham chiếu hai kỳ công, một nguồn chưa khóa | `PERIOD_NOT_LOCKED`; khi cả hai khóa mới tính và lưu hai snapshot/hash nguồn; không chọn nguồn theo tên tháng |
| TC-K07 | Import/ghép công đang chạy đồng thời KT khóa, revision thay đổi | Chờ tác vụ hoặc `PERIOD_STATE_CONFLICT`/`COLLECTION_INCOMPLETE`; không có ghi công sau snapshot. Log đến sau khóa thành hồ sơ muộn |
| TC-K08 | Qua cửa sổ Ra nhưng chưa xác nhận đủ file/nguồn hoặc thiếu một lượt Ra | Không chốt; max timestamp file không chứng minh đủ nguồn; giải trình có chứng từ và xử lý ngoại lệ trước chốt |
| TC-B01 | COMP_TIME_ENABLED=false; 2 giờ OT đủ căn cứ × 100.000 đ × 150%; KT yêu cầu quy đổi | COMP_TIME_DISABLED; vẫn **300.000 đ** tiền OT, giữ 2 giờ thực tế, không sinh quỹ; tỷ lệ/hạn quy đổi null |
| TC-B02 | Tắt quy đổi OT nhưng có nghỉ bù lễ trùng ngày nghỉ tuần hoặc đơn phép năm | Lịch nghỉ/quỹ phép vẫn xử lý độc lập; không vô hiệu hóa mọi loại nghỉ có tên “bù” |
| TC-B03 | Dữ liệu nhập chuyển đổi có số dư quỹ nghỉ cũ khi chức năng quy đổi chưa bật | Giữ hồ sơ đối soát, không tự xóa/chuyển thành tiền/cấp mới, không giảm tiền OT |
| TC-I01 | Tính riêng các fixture FIX-01…FIX-09 trong tài liệu 18 theo đúng phương án, trước BH/thuế | Lần lượt **12.000.000 / 500.000 / 1.000.000 / 450.000 / 4.000.000 / 1.800.000 / 12.400.000 / 4.000.000 / 300.000 đ** |
| TC-I02 | Khoản sản lượng bắt buộc lần lượt MISSING, CONFIRMED_ZERO, NOT_APPLICABLE | MISSING chặn xác nhận nhân viên; 0 chỉ hợp lệ có nguồn xác nhận; NOT_APPLICABLE phải khớp phương án, không tự gán hàng loạt |
| TC-I03 | Nhập cùng nguồn/chứng từ/dòng/version hai lần; lần ba đổi nội dung nhưng giữ khóa | Lần hai bỏ qua; lần ba PAYROLL_INPUT_CONFLICT; không thêm tiền hoặc ghi đè nguồn cũ |
| TC-I04 | Hai version đơn giá sản phẩm có hiệu lực nối tiếp, sau đó thử nhập bản chồng khoảng cùng mã/đơn vị/phạm vi | Tách sản lượng theo ngày thực hiện như FIX-04; bản chồng bị từ chối, không chọn giá mới nhất cho toàn kỳ |
| TC-I05 | Dòng có sai đơn vị, sản lượng âm không phải điều chỉnh, điểm KPI ngoài miền hoặc không rõ công thức hoa hồng | Trả lỗi cụ thể trước CONFIRMED; không ép kiểu/đơn vị hoặc ngầm chọn công thức |
| TC-I06 | Nguồn sản phẩm chưa nghiệm thu, lô DRAFT/VALIDATED hoặc bị RETURNED | Không dùng cho lương chính thức; tính thử phải gắn nhãn, không cho duyệt như CONFIRMED |
| TC-I07 | Một nhân viên có hai phương án lương chồng hiệu lực, hoặc P3 và thưởng tham chiếu cùng nguồn không có quyết định độc lập | Báo xung đột/cộng trùng, chưa xác nhận; một phương án phải chỉ rõ khoản thay thế và cộng thêm |
| TC-I08 | Giá khoán tổ 4.000.000 đ; phân bổ xác nhận NV-A 2.500.000, NV-B 1.500.000; thử bỏ bảng phân bổ | Đủ bảng: tổng **4.000.000 đ**, không trả 4 triệu cho mỗi người; thiếu bảng giữ chờ, không tự chia đều |
| TC-I09 | Sửa đầu vào sau duyệt trước khóa, sau đó thử sửa nguồn đã dùng trong kỳ khóa | Trước khóa về Nháp và phải duyệt lại; sau khóa tạo bản điều chỉnh có liên kết, không ghi đè snapshot; không dùng đồng thời hai version nguồn |
| TC-I10 | Dựng đơn giá OT lương thời gian: tiền công việc đủ căn cứ 10.000.000 đ, giờ bình thường tương ứng đã xác nhận 100; có thêm 10 giờ OT không tính mẫu số | Đơn giá **100.000 đ/giờ**, không chia 110 hoặc mặc định 26 × 8; thiếu nguồn giờ/tiền chặn tính; lương sản phẩm chọn công thức OT riêng |
| TC-I11 | TT/QĐ cố sửa dòng đầu vào lương trong phân hệ 7; KT nhập nguồn có xác nhận ngoài hệ thống | TT/QĐ bị chặn theo quyền; KT có quyền tiếp nhận và lưu chứng từ; không sinh vai trò hệ thống sản xuất/KPI mới |
| TC-I12 | Nạp bộ HRTP-SIM-2026-V1 để mô phỏng rồi yêu cầu coi các chính sách/mẫu ngân hàng là đã khảo sát thật | Giữ SIMULATION/production_ready=false, không tự đổi BUSINESS_CONFIRMED; thiếu mẫu thực tế chỉ chặn đầu ra thật liên quan, không chặn đồ án dùng fixture |
| TC-O01 | OT 2 giờ ban đêm ngày Chủ nhật được cấu hình là ngày nghỉ hằng tuần; tham số chuẩn | Hệ số **270%** |
| TC-O02 | OT ngày thường 2 giờ ban ngày + 2 giờ ban đêm | Đoạn ngày 150%, đoạn đêm **210%** |
| TC-O03 | OT đêm ngày thường không có OT ban ngày | Hệ số **200%** |
| TC-O04 | OT từ 20:00 thứ Bảy (ngày thường) đến 02:00 Chủ nhật (nghỉ hằng tuần); tham số chuẩn | Tách 3 đoạn: 20:00–22:00 **150%** / 22:00–00:00 **210%** (đã có OT ban ngày) / 00:00–02:00 **270%** |
| TC-O05 | Chỉ nâng hệ số OT ngày thường lên 160%; phụ cấp đêm 30%, hệ số cộng 20%; đã có OT ban ngày | Hệ số OT đêm ngày thường tự động thành **222%** = 160% + 30% + 20%×160% |
| TC-O05b | Cùng tham số như TC-O05 nhưng chưa có OT ban ngày | Hệ số OT đêm ngày thường tự động thành **210%** = 160% + 30% + 20%×100% |
| TC-O05c | Cùng tham số như TC-O05; kiểm tra OT ban ngày và OT đêm của các loại ngày khác | OT ban ngày thường **160%**; OT đêm nghỉ hằng tuần **270%**, lễ/Tết **390%** (không đổi) |
| TC-O06 | Nhân sự đạt 39/40 giờ OT tháng | Cảnh báo tới TT, QĐ kèm số giờ còn lại; đề xuất vượt trần không duyệt được |
| TC-P01 | Lương HĐLĐ 5.000.000 tại NM Bắc Ninh (Vùng I, mức 5.310.000) | `CP-01` chặn chốt lương, đánh dấu đỏ |
| TC-P01b | Lương HĐLĐ 5.000.000 tại NM Hà Nam (Vùng II, mức 4.730.000) | `CP-01` **không** chặn — hợp lệ với vùng II |
| TC-P01c | Lương HĐLĐ 4.000.000 tại NM Nghệ An (Vùng III, mức 4.140.000) | `CP-01` chặn, dẫn chiếu mức vùng III |
| TC-P07 | Nhân sự chuyển từ NM Bắc Ninh sang NM Nghệ An ngày 10 giữa kỳ | Tách 2 đoạn: đoạn 1 so vùng I, đoạn 2 so vùng III; chi phí phân bổ 2 cost center theo tỷ lệ ngày công |
| TC-P08 | Quyết định điều chuyển liên tỉnh kèm giảm lương | Hệ thống cảnh báo vi phạm nguyên tắc bảo toàn (BR-08) |
| TC-P02 | Tăng lương hiệu lực ngày 15 giữa kỳ | Tách hai đoạn đơn giá trong cùng kỳ |
| TC-P03 | Thỏa thuận NET, gross-up | Sai số ≤ 1 đồng |
| TC-P04 | Khấu trừ vượt 30% NET | `CP-04` chặn |
| TC-P05 | Chạy lại kỳ 12/2025 vào tháng 02/2026 | Ra mức lương tối thiểu **của năm 2025** |
| TC-P06 | Chạy tính lương 2 lần cùng dữ liệu | Kết quả trùng khớp tuyệt đối |
| TC-P09 | Quyết định tăng lương hiệu lực quá khứ, ảnh hưởng 2 kỳ đã khóa | Kỳ đã khóa giữ nguyên; chênh lệch lương, BH, thuế từng kỳ ghi bút toán vào kỳ mở sau khi KT xác nhận (SQ-07) |
| TC-T01 | Cư trú, nhánh lũy tiến; thu nhập **tính thuế sau giảm trừ** 45.000.000 đ/tháng; lần lượt chi trong 12/2025 và 01/2026 | Thuế bộ 2025 **8.000.000 đ**, bộ 2026 **5.500.000 đ**; tính từng bậc, không trừ gia cảnh lần nữa |
| TC-T02 | OT lễ 2 giờ × 100.000 đ/giờ × 300% = 600.000 đ; cư trú; khoản đủ điều kiện miễn; chi lần lượt trong 2025/2026 | Bộ 2025 chịu **200.000 đ**, miễn **400.000 đ**; bộ 2026 chịu **0 đ**, miễn **600.000 đ**; tổng hai phần luôn 600.000 đ |
| TC-T03 | Cư trú, nhánh lũy tiến; chi trong 2026: thu nhập chịu thuế sau miễn 70.000.000 đ, BH bắt buộc được trừ 3.300.000 đ, 1 NPT đủ điều kiện tháng, không giảm trừ khác | Gia cảnh **21.700.000 đ**; thu nhập tính thuế **45.000.000 đ**; thuế **5.500.000 đ** |
| TC-T04 | Lương và OT tháng công 12/2025 chi ngày 09/01/2026 cho cá nhân cư trú; chạy lại trong 2027 | Lương/công theo kỳ gốc; TNCN theo kỳ 01/2026: 5 bậc, giảm trừ 15,5 / 6,2 triệu, OT đủ điều kiện dùng chế độ miễn 2026 |
| TC-T05 | Tái hiện khoản chi 31/12/2025 khi chạy trong 2026 | Dùng ngữ cảnh/số đã khấu trừ gốc; không đổi sang bộ 2026 vì ngày chạy mới |
| TC-T06 | Cư trú: ca đêm bình thường 8 giờ × 100.000 đ, phụ cấp 30% = 240.000 đ; khoản đủ điều kiện; chi lần lượt trong 2025/2026 | Tổng 1.040.000 đ: bộ 2025 chịu **800.000**, miễn **240.000**; bộ 2026 chịu **0**, miễn **1.040.000**; không cộng trùng 800.000 đ trong lương thời gian |
| TC-T07 | Bộ 2026: tiền OT thực trả 600.000 đ; đã xác minh chỉ 450.000 đ đủ điều kiện Điều 26 | Miễn **450.000 đ**, chịu **150.000 đ**; thiếu căn cứ xác định phần đủ điều kiện thì đưa ngoại lệ, chưa duyệt |
| TC-T08 | Cư trú không HĐ/HĐ < 3 tháng; khoản thuộc cơ sở khấu trừ, không cam kết, không yêu cầu tự nguyện: chi 3 triệu/lần trong 2025 và trong bộ 2026; thêm lần trả đúng 5 triệu ở bộ 2026 | Bộ 2025 khấu trừ **300.000 đ**; bộ 2026 trả 3 triệu: **0 đ**, trả 5 triệu: **500.000 đ**; không trừ gia cảnh. Cam kết hợp lệ hoặc yêu cầu khấu trừ dưới ngưỡng kiểm tra theo BR-52 |
| TC-T09 | Tiền ăn ca bằng tiền 1.500.000 đ/tháng; lần trả 30/06/2026 và 01/07/2026 | Lần tháng 6 dùng định mức lịch sử có căn cứ, không tự dùng 1,2 triệu; lần tháng 7 không tính thuế **1.200.000 đ**, chịu **300.000 đ** |
| TC-T10 | Hồ sơ tháng/quý 6 tháng đầu 2026 đã khai/nộp theo bộ cũ; quyết toán năm 2026 theo bộ mới | Giữ snapshot số đã khấu trừ/nộp; tính nghĩa vụ năm bằng ngưỡng năm và tháng giảm trừ đủ điều kiện; điều chỉnh chênh lệch tại quyết toán, không sửa hồ sơ gốc |
| TC-T11 | Bộ 2026 lũy tiến, thu nhập tính thuế tháng lần lượt 0 / 10 / 30 / 60 / 100 triệu; kiểm tra thêm 1 đồng trên mỗi mốc | Thuế lần lượt **0 / 500.000 / 2.500.000 / 8.500.000 / 20.500.000 đ**; phần 1 đồng vượt mốc chịu suất bậc kế tiếp trước làm tròn |
| TC-T12 | Cá nhân không cư trú: thu nhập chịu thuế thuộc Việt Nam 20.000.000 đ, không khoản miễn; có hồ sơ NPT | Thuế **4.000.000 đ**; không trừ gia cảnh/BH theo nhánh cư trú, không dùng biểu 5 bậc |
| TC-T13 | Bộ 2026: tiền ngày không nghỉ phép 2.000.000 đ khi thôi việc, đầy đủ căn cứ khoản 3 Điều 113 BLLĐ và khoản 2 Điều 26 NĐ 253 | Miễn **2.000.000 đ**; khoản trả khác không đủ điều kiện không tự miễn; thiếu chứng từ đưa ngoại lệ |
| TC-L01 | Nghỉ phép 5 ngày có 1 ngày lễ xen giữa | Trừ 4 ngày phép, ngày lễ ghi `L` |
| TC-L02 | Vào làm tháng 7 | Quỹ phép pro-rata đúng 6/12 |
