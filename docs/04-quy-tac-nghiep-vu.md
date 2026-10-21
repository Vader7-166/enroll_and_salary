# 04. Quy tắc nghiệp vụ

Tài liệu này tập hợp toàn bộ quy tắc nghiệp vụ (business rule) của hệ thống, mỗi quy tắc
có mã `BR-xx` để tham chiếu từ đặc tả chức năng, thuật toán và kịch bản kiểm thử. Chức năng
BFD liên quan (`1.1` … `10.4`) ghi ở bảng tra chéo cuối tài liệu. Tác nhân: TT – Tổ trưởng,
QĐ – Quản đốc, KT – Kế toán, AD – Admin.

**Quy ước mức độ:**

| Ký hiệu | Ý nghĩa |
|---|---|
| 🔴 **BẮT BUỘC PHÁP LÝ** | Vi phạm dẫn tới chế tài hành chính. Hệ thống phải chặn. |
| 🟡 **CHÍNH SÁCH** | Do doanh nghiệp quyết định, hệ thống phải cho cấu hình. |
| 🔵 **KỸ THUẬT** | Quy tắc nội tại bảo đảm tính nhất quán dữ liệu. |

---

## A. Kỳ và tham số

### BR-01 · Kỳ công và kỳ lương là hai kỳ nghiệp vụ độc lập 🔵

Kỳ công và kỳ lương là hai **kỳ nghiệp vụ** (lớp `KyNghiepVu`, chức năng 1.5) có loại, phạm vi
(cơ sở / đơn vị), khoảng ngày và vòng trạng thái riêng. Ràng buộc:

- **Không trùng kỳ**: cùng loại, cùng phạm vi không được chồng khoảng ngày.
- Được tạo/lập kế hoạch và mở kỳ sau khi kỳ trước còn đối soát. Chỉ khi **khóa kỳ sau**
  mới yêu cầu kỳ trước đã tồn tại cùng loại/phạm vi đã khóa; kỳ đầu xử lý theo khởi tạo.
- **Kỳ lương chỉ tính được khi kỳ công tương ứng đã khóa.**

| Đối tượng | Chu kỳ mặc định | Trạng thái | Người chuyển trạng thái |
|---|---|---|---|
| Kỳ công | 26 tháng trước → 25 tháng hiện tại, tính theo **ngày công của ca** | Lập kế hoạch → Mở → Đã chốt → Đã khóa | AD tạo/mở; hệ thống chốt toàn kỳ khi đủ xưởng; KT khóa (4.5) |
| Kỳ lương | Tính sau khi khóa các kỳ công nguồn, chi ngày 10 tháng sau | Lập kế hoạch → Mở → Đã chốt → Đã khóa | AD tạo/mở; KT duyệt và khóa (7.5) |
| Bảng chấm công tháng (theo xưởng) | Theo kỳ công | Nháp → Tổ đã xác nhận → Xưởng đã chốt → Đã khóa | TT xác nhận tổ (4.4) → QĐ chốt xưởng → KT khóa kỳ công (4.5) |
| Bảng lương (theo cơ sở) | Theo kỳ lương | Nháp → Đã duyệt → Đã khóa | KT (7.5) |

Ngày chốt công có thể khác nhau giữa các cơ sở và giữa khối trực tiếp / gián tiếp (chính sách
theo cơ sở, 1.4). Xuất file chi lương (7.6) **không** chuyển bảng lương sang trạng thái “đã
thanh toán”.

Đã chốt (`CLOSED`) được KT trả lại Mở có lý do **trước khóa**; sửa dữ liệu làm mất hiệu lực
xác nhận/chốt xưởng liên quan, phải duyệt lại. `LOCKED` không có đường quay lại. Ngày 25
không tự khóa: phải chờ cửa sổ Ra của mọi ca cuối kỳ (kể cả OT), xác nhận đủ nguồn, xử lý
hết tác vụ/ngoại lệ chặn trước chốt và khóa. Vòng đời, phân tuyến log muộn và lỗi nghiệp vụ
được quy định thống nhất tại [17](17-vong-doi-ky-cong-va-ca-qua-ngay-chot.md).

### BR-02 · Mọi giá trị pháp lý là tham số theo khoảng hiệu lực 🔴

Không giá trị pháp lý nào được viết cứng trong mã nguồn. Mỗi tham số có khóa
`(mã tham số, phạm_vi, đối_tượng, cơ_sở_áp_dụng, hiệu_lực_từ, hiệu_lực_đến)` và **không
được chồng lấn khoảng hiệu lực** trên cùng mã/phạm vi/đối tượng/cơ sở áp dụng. Tham số
không phân biệt đối tượng dùng giá trị chung; quy tắc phân giải phải trả về đúng một phiên bản.

Danh mục tham số bắt buộc tối thiểu:

| Nhóm | Tham số |
|---|---|
| Lương tối thiểu | Mức tháng và mức giờ theo từng vùng I–IV |
| Bảo hiểm | Tỷ lệ BHXH / BHYT / BHTN hai phía, trần đóng, sàn đóng |
| Thuế TNCN | Giảm trừ bản thân/người phụ thuộc; biểu thuế; chế độ miễn OT/đêm; thuế suất và ngưỡng khấu trừ mỗi lần trả; định mức ăn ca; tất cả theo đối tượng, thời điểm chi trả và phạm vi áp dụng của văn bản |
| Làm thêm giờ | Hệ số OT ngày thường / nghỉ tuần / lễ, phụ cấp đêm, hệ số cộng thêm OT đêm |
| Trần OT | Trần theo ngày / tháng / năm, cờ đăng ký 300h/năm |
| Công đoàn | Tỷ lệ KPCĐ, tỷ lệ đoàn phí, trần đoàn phí |
| Khác | Lãi suất chậm trả `LATE_PAYMENT_RATE`, định mức miễn thuế ăn ca / trang phục / điện thoại |

### BR-03 · Tra tham số theo ngày nghiệp vụ, không theo ngày chạy 🔴

Mọi phép tính tra tham số theo **ngày nghiệp vụ của giao dịch**. Chạy lại kỳ 12/2025 vào
tháng 02/2026 phải cho ra mức lương tối thiểu của năm 2025.

*Hệ quả:* bảo đảm tính idempotent và khả năng đối chiếu với hồ sơ đã nộp cho cơ quan quản lý.

**Riêng TNCN tiền lương:** kỳ tính thuế xác định theo **thời điểm chi trả/nhận thu nhập**,
không lấy tháng công, ngày hiệu lực quyết định lương hoặc ngày chạy chương trình làm kỳ thuế.
Lương tháng 12/2025 đã trả trong 12/2025 dùng bộ thuế 2025 khi tái hiện; lương tháng 12/2025
trả vào 01/2026 dùng bộ thuế 2026 đối với cá nhân cư trú. Phần lương/công và BH vẫn tra theo
quy tắc thời gian riêng. Chi tiết ma trận hiệu lực và chuyển tiếp tại [12 §2.7](12-tuan-thu-phap-ly.md).
Tính nháp dùng ngày dự kiến trả và đánh dấu `PROJECTED`; khi trả thực tế phải đối chiếu lại.
Tái hiện số đã khấu trừ dùng snapshot đã lưu; tính nghĩa vụ đúng luật để quyết toán là một
kết quả riêng, không ghi đè hồ sơ tháng/quý đã nộp.

### BR-04 · Mọi tham số phải khai báo văn bản căn cứ 🔴

Mỗi bản ghi tham số bắt buộc có trường trích dẫn văn bản pháp luật (số hiệu, ngày ban hành,
điều khoản). Hệ thống cảnh báo khi tham số sắp hết hiệu lực mà chưa có bản ghi kế tiếp.

### BR-05 · Cấu hình chính sách kế thừa theo cây tổ chức 🟡

Cấu hình (quy tắc OT, làm tròn, ngày chốt công, ngày công chuẩn, dung sai) do AD khai báo
theo cơ sở (chính sách theo cơ sở, chức năng 1.4) và phân giải theo nguyên tắc **đơn vị con
kế thừa cha, ghi đè từng khóa**. Mỗi chính sách có ngày hiệu lực, thay đổi tạo phiên bản mới. Giao diện luôn hiển thị nguồn gốc
của giá trị đang có hiệu lực.

> **Quy tắc về cơ cấu tổ chức, chức danh và điều chuyển liên tỉnh** (`BR-66` … `BR-75`) nằm
> tại [03. Cơ cấu tổ chức §11](03-co-cau-to-chuc.md).

---

## B. Lương tối thiểu vùng

### BR-06 · Mức lương tối thiểu vùng 2026 🔴

Áp dụng từ 01/01/2026 theo NĐ 293/2025/NĐ-CP:

| Vùng | Mức tháng (VND) | Mức giờ (VND) |
|---|---|---|
| Vùng I | 5.310.000 | 25.500 |
| Vùng II | 4.730.000 | 22.700 |
| Vùng III | 4.140.000 | 20.000 |
| Vùng IV | 3.700.000 | 17.800 |

Doanh nghiệp vận hành trên **ba vùng khác nhau**: Vùng I (trụ sở Hà Nội, NM Bắc Ninh),
Vùng II (NM Hà Nam), Vùng III (NM Nghệ An). Mức áp cho từng nhân sự xác định theo **địa điểm
của đơn vị mà nhân sự thuộc về tại kỳ đó** — xem **BR-66** tại [03](03-co-cau-to-chuc.md).
Toàn bộ giá trị vẫn là tham số theo BR-02.

### BR-07 · Nguyên tắc áp dụng địa bàn 🔴

- Chi nhánh ở địa bàn nào áp dụng mức của địa bàn đó.
- Doanh nghiệp trong khu công nghiệp / khu chế xuất / khu công nghệ cao **giáp ranh nhiều
  vùng** thì áp dụng **mức cao nhất**.
- Địa bàn có thay đổi đơn vị hành chính (chia tách, sáp nhập, đổi tên) → áp dụng mức vùng
  cao nhất hiện hành cho tới khi có quy định mới (*cơ chế Safe Haven*).

### BR-08 · Lớp đệm an toàn: không được giảm lương do đổi phân vùng 🔴

Nếu điều chỉnh phân vùng làm mức tối thiểu mới thấp hơn mức doanh nghiệp đang áp dụng tại
31/12/2025, **tuyệt đối không được giảm lương** của lao động hiện hữu (Điều 5.5 NĐ 293/2025).

### BR-09 · Sàn lương thử việc 🔴

Lương thử việc tối thiểu bằng **85%** lương chính thức của vị trí, và vẫn không được thấp
hơn lương tối thiểu vùng.

---

## C. Ca làm việc và thời giờ làm việc

### BR-10 · Định nghĩa ca chuẩn 🟡

| Ca | Khung giờ | Giờ làm việc | Nghỉ giữa ca |
|---|---|---|---|
| Ca A (sáng) | 06:00 – 14:00 | 8h | 30 phút, **tính vào giờ làm việc** |
| Ca B (chiều) | 14:00 – 22:00 | 8h | 30 phút, tính vào giờ làm việc |
| Ca C (đêm) | 22:00 – 06:00 hôm sau | 8h | 45 phút, tính vào giờ làm việc |
| Hành chính | 08:00 – 17:00, T2–T7 | 8h | 60 phút không tính vào giờ làm việc |

Khối trực tiếp xoay ca theo **chu kỳ tuần**; mỗi người phải làm đủ 3 loại ca trong tháng.

### BR-11 · Giới hạn thời giờ làm việc bình thường 🔴

Không quá **8 giờ/ngày** và **48 giờ/tuần** (khuyến khích 40 giờ/tuần).
Nghỉ giữa hai ca ít nhất **12 giờ**; không xếp ca đêm rồi ngay ca sáng hôm sau.
Trong module local, tuần tính thứ Hai–Chủ nhật theo ngày bắt đầu ca; tham số cơ sở/vùng
có thể chặt hơn nhưng không được nới các giới hạn này. Nghỉ giữa ca làm từ 6 giờ
ít nhất 30 phút; làm ban đêm từ 6 giờ ít nhất 45 phút (Điều 109 BLLĐ 2019).

### BR-12 · Khung giờ làm việc ban đêm 🔴

Thống nhất từ **22:00 hôm trước đến 06:00 hôm sau**. Đây là mốc tách đoạn giờ, áp dụng cho
mọi ca, không riêng ca C.

### BR-13 · Một ca = một ngày công, gán về ngày bắt đầu ca 🔵

Ca C bắt đầu 22:00 ngày T sinh **đúng một** bản ghi ngày công của ngày T, chứa cả phần giờ
rơi sang ngày T+1. Không tách thành hai ngày lẻ.

Ngày T lấy từ **ngày bắt đầu ca trong lịch đã duyệt**, không lấy ngày lịch của lượt Vào.
Ca 00:00 ngày 26 có lượt vào sớm 23:45 ngày 25 vẫn thuộc ngày công 26. Kỳ công chứa ngày T
sở hữu toàn bộ ca và OT nối tiếp; cửa sổ thu log được đi qua ngày chốt, không cắt theo
timestamp ngày 25/26 ([17 §2–4](17-vong-doi-ky-cong-va-ca-qua-ngay-chot.md)).

*Ngoại lệ cần xử lý riêng:* việc **phân loại ngày** để áp hệ số OT vẫn tách theo mốc 00:00,
vì một ca có thể vắt từ ngày thường sang ngày lễ. Xem **BR-24**
và [thuật toán 06](06-thuat-toan-cham-cong-va-tinh-luong.md).

### BR-14 · Ngày công chuẩn tháng 🟡

Cấu hình được: 26 công hoặc theo lịch làm việc. **26** là cấu hình mô phỏng khối sản xuất
được xác nhận theo DEC-03, không phải quy chế doanh nghiệp. Dùng cho lương thời gian/
phân bổ công; căn cứ và mẫu số OT xác định riêng theo BR-15, không tự lấy 26 × 8.

### BR-15 · Bẫy mẫu số khi tính lương giờ 🔴

Đối với lương theo thời gian, đơn giá giờ OT lấy **tiền lương công việc đủ điều kiện ÷ số
giờ làm việc bình thường tương ứng** theo Điều 55 NĐ 145/2020. Tách các khoản bị loại khỏi
tử số, loại giờ OT và giờ nghỉ lễ/Tết hưởng lương khỏi mẫu số; lưu căn cứ từng cấu phần.
Không mặc định tử số chỉ là lương cơ bản hoặc dùng công chuẩn 26 làm mẫu số cho mọi người.

> Đưa ngày lễ vào mẫu số làm "pha loãng" đơn giá → trả thiếu lương làm thêm giờ → vi phạm
> hành vi "trả không đủ lương".

### BR-16 · Nghỉ lễ trùng ngày nghỉ hằng tuần 🔴

Ngày lễ trùng ngày nghỉ hằng tuần thì được nghỉ bù vào ngày làm việc kế tiếp. Lịch nghỉ lễ,
ngày nghỉ bù và hoán đổi ngày nghỉ dịp Tết do AD khai báo (3.1).

---

## D. Dữ liệu chấm công

### BR-17 · Khử lượt quẹt trùng trong 5 phút 🔵

Nhiều lượt quẹt của cùng một nhân sự trong vòng **05 phút**: chỉ ghi nhận **lượt đầu tiên**
cho Check-In và **lượt cuối cùng** cho Check-Out.

### BR-18 · Ghép cặp Vào/Ra 🔵

Hệ thống tìm lượt quẹt **sớm nhất** trong khung giờ Vào và lượt quẹt **muộn nhất** trong
khung giờ Ra của ca đã phân bổ để tạo một cặp công hoàn chỉnh.

Cửa sổ là timestamp có ngày/múi giờ; giờ kết thúc kỳ vọng gồm OT nối tiếp đã duyệt. Ca C
OT đến 08:00 có cửa sổ Ra theo 08:00 (ví dụ 07:45–08:30), thay cho 05:45–06:30. Ghép được
lượt không tự duyệt OT; một lượt chỉ thuộc một ca, ứng viên chồng lấn phải giải trình.

Thiếu một trong hai lượt → gán trạng thái ngoại lệ **`ERR` (Lỗi quẹt thẻ)** và đưa vào danh
sách ngoại lệ của tổ để **tổ trưởng** nhập giải trình kèm lý do, chứng cứ (4.3). Công nhân
phản ánh qua tổ trưởng, không thao tác trực tiếp trên hệ thống.

### BR-19 · Dữ liệu thô là bất biến 🔵

Bản ghi chấm công nguyên trạng do AD nhập theo lô (`DuLieuChamCongTho`, chức năng 4.1) chỉ
được ghi thêm, **không bao giờ sửa hoặc xóa**. Mọi hiệu chỉnh diễn ra ở tầng dữ liệu dẫn xuất.

### BR-20 · Ký hiệu công trên bảng chấm công 🟡

| Ký hiệu | Ý nghĩa | Hưởng lương | Tính công |
|---|---|---|---|
| `X` | Công ngày | ✔ | ✔ |
| `Đ` | Công đêm | ✔ | ✔ |
| `Ph` | Phép năm | ✔ nguyên lương | ✔ |
| `L` | Nghỉ lễ, Tết | ✔ nguyên lương | ✔ |
| `Ô` | Nghỉ ốm đau | Chế độ BHXH 75% | – |
| `TS` | Nghỉ thai sản | Chế độ BHXH 100% | – |
| `Kl` | Nghỉ không lương | ✘ | ✘ |
| `ERR` | Lỗi quẹt thẻ, chờ giải trình | – | Chờ xử lý |
| `KP` | Vắng không phép | ✘ | ✘ |

### BR-21 · Dung sai đi muộn / về sớm 🟡

Đi muộn hoặc về sớm **dưới 15 phút** có lý do khách quan, được tổ trưởng nhập giải trình
(4.3) và xác nhận công (4.4) → hệ thống khôi phục ngày công tròn ca, **không trừ lương thời
gian**.

Vượt dung sai: ghi nhận vào dữ liệu công và báo cáo chuyên cần, **không trừ lương**
(xem **BR-45**).

### BR-22 · Điều chỉnh công thủ công phải có lý do 🔴

Mọi thao tác sửa dữ liệu công (do TT thực hiện ở 4.3) bắt buộc nhập lý do, chứng cứ và ghi
nhật ký kiểm toán gồm: người sửa, thời điểm, giá trị cũ, giá trị mới, địa chỉ IP, mã giải trình.

---

## E. Làm thêm giờ (OT)

### BR-23 · Ma trận hệ số làm thêm giờ 🔴

| Loại ngày | OT ban ngày | Làm việc ban đêm (ca kíp) | OT ban đêm |
|---|---|---|---|
| Ngày làm việc thường | **150%** | +30% | **200%** (không có OT ngày trước đó) · **210%** (có OT ngày trước đó) |
| Ngày nghỉ hằng tuần | **200%** | +30% | **270%** |
| Ngày nghỉ lễ, Tết, ngày nghỉ hưởng lương | **300%** | +30% | **390%** |

Các con số 200 / 210 / 270 / 390 là **kết quả tính**, không phải hằng số lưu trong hệ thống.
Công thức gốc theo Điều 57 NĐ 145/2020/NĐ-CP:

```
Tỷ lệ OT đêm = Tỷ lệ OT ngày (theo loại ngày)
             + 30%
             + 20% × Tỷ lệ ban ngày của loại ngày tương ứng
```

Kiểm chứng:

| Loại ngày | Phân rã | Kết quả |
|---|---|---|
| Ngày thường, chưa OT ngày | 150% + 30% + 20%×100% | **200%** |
| Ngày thường, đã OT ngày | 150% + 30% + 20%×150% | **210%** |
| Nghỉ hằng tuần | 200% + 30% + 20%×200% | **270%** |
| Lễ, Tết | 300% + 30% + 20%×300% | **390%** |

> **Vì sao không lưu con số kết quả.** Nếu doanh nghiệp nâng hệ số OT ngày thường lên 160%
> (cao hơn luật, được phép), hệ số OT đêm ngày thường phải tự động thành **210%** khi chưa
> có OT ban ngày (`160% + 30% + 20% × 100%`) hoặc **222%** khi đã có OT ban ngày
> (`160% + 30% + 20% × 160%`). Chỉ thay tham số OT ngày thường; phụ cấp đêm vẫn là 30%
> và hệ số cộng vẫn là 20%. Lưu con số kết quả sẽ khiến hai chỗ lệch nhau.

### BR-24 · Tách đoạn giờ theo mốc thời gian và loại ngày 🔴

Một ca OT có thể vắt qua nhiều đoạn. Hệ thống tách theo các mốc **22:00**, **06:00** và
**00:00**, rồi áp hệ số cho từng đoạn:

- 22:00 / 06:00 → ranh giới ngày ↔ đêm.
- 00:00 → ranh giới loại ngày (thường / nghỉ tuần / lễ).

*Ví dụ:* ca OT từ 20:00 ngày thường đến 02:00 ngày lễ được tách thành 3 đoạn:
20:00–22:00 (OT ngày thường 150%), 22:00–24:00 (OT đêm ngày thường **210%**, đã có OT ban ngày từ 20:00–22:00),
00:00–02:00 (OT đêm ngày lễ 390%).

### BR-25 · Phân biệt OT đêm ngày thường có và chưa có OT ban ngày 🔴

Với tham số OT ngày thường 150%, hai nhánh cho 200% / 210%; nếu nâng tham số lên 160%
(giữ phụ cấp đêm 30%, hệ số cộng 20%), hai nhánh tương ứng cho 210% / 222%.

Mốc phân biệt là trạng thái **"đã có OT ban ngày trước đó trong cùng ngày công"** — đây là
thuộc tính của **ngày công**, không phải của đoạn giờ. Phải xác định ngày công trước, rồi
mới áp hệ số cho từng đoạn.

### BR-26 · Đối chiếu OT đăng ký với thực tế 🟡

Hệ thống so giờ OT trong đề xuất đã được QĐ duyệt với giờ chấm công thực tế và **lấy giá trị
nhỏ hơn** làm căn cứ tính lương (5.4). Phần lệch được chuyển sang xử lý ngoại lệ công (4.3,
AD-04).

### BR-27 · Trần làm thêm giờ 🔴

| Trần | Giá trị | Hành vi hệ thống |
|---|---|---|
| Theo ngày | ≤ 50% số giờ làm việc bình thường trong ngày | Cảnh báo và chặn |
| Theo tháng | ≤ **40 giờ** | Cảnh báo khi chạm ngưỡng, chặn khi vượt |
| Theo năm | ≤ **200 giờ** (≤ 300 giờ với ngành đặc thù đã thông báo Sở LĐ-TB&XH) | Chặn |

Trần là cấu hình theo cơ sở / ngành có hiệu lực (lớp `TranOT`). Hệ thống cộng dồn giờ OT theo
ngày, tháng, năm khi QĐ mở đề xuất để duyệt (5.3); **vượt trần → cảnh báo và không cho duyệt**,
QĐ từ chối hoặc trả lại để TT điều chỉnh (SQ-04). Cờ bật trần 300h/năm là tham số, chỉ được
bật khi doanh nghiệp đã gửi thông báo.

### BR-28 · OT phải có văn bản đồng ý của người lao động 🔴

Hệ thống **chặn huy động OT** khi chưa có căn cứ đồng ý làm thêm giờ của người lao động —
TT ghi căn cứ này khi lập đề xuất (5.1) và QĐ kiểm tra trước khi duyệt. Ép buộc tăng ca bị
phạt 40 – 50 triệu VND.

### BR-29 · Quy đổi OT sang nghỉ bù 🟡

**Đã chốt ngày 17/10/2026 — DEC-01:** chưa kích hoạt quy đổi, `COMP_TIME_ENABLED = false`.
OT vẫn tính/trả tiền theo quy tắc đã chốt; giữ giờ thực tế để kiểm soát trần. Không sinh quỹ,
không giảm tiền/giờ OT khi yêu cầu quy đổi; trả `COMP_TIME_DISABLED`. Tỷ lệ 1:1,5 và hạn
3 tháng cũ không còn là cấu hình đang áp dụng.

Không dùng nghỉ bù thay nghĩa vụ trả tiền OT. Nếu sau này cấp thêm quyền nghỉ, cần chính
sách riêng và quyết định kích hoạt mới; không làm giảm khoản OT. Nghỉ bù ngày lễ trùng nghỉ
hằng tuần (BR-16) và phép năm vẫn hoạt động độc lập. Xem [18 §3](18-xac-nhan-chinh-sach-va-dau-vao-tinh-luong.md).

### BR-30 · Luồng đề xuất và duyệt OT 🟡

```
TT lập đề xuất OT cho danh sách công nhân của tổ (5.1)
   → Hệ thống cộng dồn giờ OT và kiểm soát trần (5.3)
      → QĐ duyệt cấp 2 / từ chối / trả lại (5.2)
```

| Điều kiện | Kết quả |
|---|---|
| Trong trần, đủ căn cứ đồng ý làm thêm | QĐ duyệt → trạng thái Đã duyệt, thông báo TT |
| Vượt trần ngày / tháng / năm | Hệ thống cảnh báo, không cho duyệt; QĐ từ chối hoặc trả lại |
| Chưa được duyệt trước giờ bắt đầu OT | Không huy động; giờ làm thêm phát sinh không có đề xuất được xử lý như ngoại lệ công |

Không có cấp duyệt của phòng nhân sự hay lãnh đạo trên hệ thống.

---

## F. Nghỉ phép và chế độ

### BR-31 · Quỹ phép năm 🔴

| Đối tượng | Số ngày phép cơ bản |
|---|---|
| Điều kiện làm việc bình thường | 12 ngày |
| Công việc nặng nhọc, độc hại | 14 ngày |
| Công việc đặc biệt nặng nhọc, độc hại | 16 ngày |

Cộng thêm **+1 ngày cho mỗi 5 năm thâm niên**. Người vào làm hoặc nghỉ việc giữa năm được
tính **pro-rata** theo số tháng làm việc thực tế.

### BR-32 · Chuyển phép và ứng phép 🟡

- Cấu hình **mô phỏng đồ án** đã xác nhận theo DEC-03: chuyển tối đa **5 ngày**, hạn đến
  **31/03 năm sau**; phần vượt/hết hạn đưa đối soát, không tự xóa quyền lợi từ dữ liệu mẫu.
- Mô phỏng cho ứng tối đa **3 ngày** phép năm sau; dùng thực tế cần quy chế/căn cứ riêng
  ([18 PS-08/09](18-xac-nhan-chinh-sach-va-dau-vao-tinh-luong.md)).
- Cả hai đều là tham số cấu hình.

### BR-33 · Đơn nghỉ và kiểm soát số dư 🔵

Tổ trưởng **ghi nhận đơn nghỉ thay công nhân** và **duyệt** — đây là cấp duyệt duy nhất (6.3;
SQ-05 gọi là “Duyệt cấp 1”). Quản đốc không duyệt đơn nghỉ, chỉ theo dõi tỷ lệ vắng mặt
(6.5). Đơn nghỉ hỗ trợ đơn vị **ngày / nửa ngày / theo giờ**. Hệ thống kiểm tra loại nghỉ (danh
mục do AD quản lý, 6.1), lịch và số dư tại thời điểm ghi nhận; cho phép ghi nhận sau với nghỉ
đột xuất; hủy đơn thì hoàn lại số dư.

### BR-34 · Nghỉ phép có ngày lễ xen giữa 🔴

Ngày lễ nằm trong kỳ nghỉ phép **không bị trừ vào quỹ phép năm**, được ghi nhận là `L`.

### BR-35 · Chế độ ốm đau – thai sản do BHXH chi trả 🔴

| Chế độ | Mức hưởng | Căn cứ |
|---|---|---|
| Ốm đau | **75%** mức tiền lương đóng BHXH | Số ngày hưởng theo thâm niên đóng BH |
| Thai sản | **100%** mức bình quân tiền lương đóng BHXH 6 tháng liền kề | Theo quy định BHXH |

KT nhập chứng từ; hệ thống tính số ngày và mức hưởng dự tính để theo dõi (6.4). Hồ sơ đề nghị
nộp cơ quan BHXH qua kênh của cơ quan — hệ thống không kê khai trực tiếp.

### BR-36 · Thanh toán phép chưa nghỉ khi chấm dứt HĐ 🔴

Khi chấm dứt hợp đồng, số ngày phép năm chưa nghỉ được thanh toán bằng tiền theo đơn giá
ngày công tại thời điểm chấm dứt. Hệ thống tính tự động khi KT lập quyết định chấm dứt (6.2,
SQ-09).

---

## G. Cơ cấu lương và tính lương

### BR-37 · Mỗi cấu phần thu nhập có ba thuộc tính độc lập 🔵

| Thuộc tính | Ý nghĩa |
|---|---|
| `is_insurable` | Có tính vào lương đóng bảo hiểm bắt buộc không |
| `is_taxable` | Có tính vào thu nhập chịu thuế TNCN không |
| `is_prorated` | Có tính theo tỷ lệ ngày công thực tế không |

Ba thuộc tính này độc lập với nhau — một khoản có thể chịu thuế nhưng không đóng bảo hiểm.

### BR-38 · Hình thức trả lương được hỗ trợ 🟡

Lương thời gian (tháng / ngày / giờ); lương sản phẩm – khoán sản phẩm; lương khoán việc;
lương theo doanh số – hoa hồng; mô hình 3P.

Khối văn phòng: lương thời gian + phụ cấp. Khối sản xuất: lương thời gian / sản phẩm theo
KPI + phụ cấp.

**Đã chốt DEC-02:** giữ đủ các hình thức trên. Mỗi nhân viên/đoạn hiệu lực có phương án
lương xác định khoản thay thế và khoản cộng thêm; không tự cộng tất cả hình thức. Sản lượng,
khoán, hoa hồng và P1/P2/P3 phải có nguồn/công thức/đơn giá và xác nhận tương ứng. Thiếu
dữ liệu khác với 0 hợp lệ, không được mặc định 0 rồi duyệt lương. Hợp đồng đầu vào và mẫu
đối chứng tại [18 §4–5](18-xac-nhan-chinh-sach-va-dau-vao-tinh-luong.md).

### BR-39 · Công thức tính là dữ liệu, không phải mã nguồn 🔵

Mọi thành phần lương được định nghĩa bằng bản ghi có công thức dạng biểu thức. Engine dựng
đồ thị phụ thuộc, sắp thứ tự tô-pô, phát hiện phụ thuộc vòng rồi tính theo thứ tự. Mỗi công
thức có phiên bản gắn khoảng hiệu lực.

Biểu thức chỉ dùng tập hàm giới hạn, **không có vòng lặp, không truy cập I/O**.

Bộ tính công thức local (Task 2.2) chỉ nhận số thập phân, biến viết hoa,
`+ - * /`, dấu ngoặc, so sánh `< <= > >= == !=` và `MIN`, `MAX`, `ABS`,
`IF`, `ROUND`. `IF` chỉ tính nhánh được chọn; không gọi hàm hệ thống, truy cập
thuộc tính, gán biến hay chạy mã JavaScript. Mỗi biến khai báo nguồn, mã tham
chiếu, đơn vị và miền min/max nếu có; dữ liệu thiếu không tự biến thành 0.
Số đầu vào dùng chuỗi thập phân, không ép float hoặc ký pháp khoa học.
Biểu thức tối đa 2.000 ký tự, 32 biến, 256 nút và 32 cấp lồng; kết quả tối đa
30 chữ số phần nguyên. Đây là phép chạy thử, không sinh bảng lương.

### BR-40 · Các tình huống tính lương bắt buộc xử lý được 🔵

| Tình huống | Quy tắc |
|---|---|
| Vào làm / nghỉ việc giữa tháng | Tính theo tỷ lệ ngày công thực tế trong kỳ |
| Tăng lương hiệu lực từ giữa tháng | Tách hai đoạn đơn giá trong cùng kỳ |
| Chuyển bộ phận giữa tháng, phụ cấp khác nhau | Tách theo đoạn thời gian, phân bổ chi phí về hai cost center theo tỷ lệ ngày công |
| Quyết định có hiệu lực rơi vào kỳ đã khóa | Hệ thống tính chênh lệch từng kỳ; KT xác nhận rồi ghi bút toán truy lĩnh / truy thu vào kỳ đang mở, có thuyết minh kỳ gốc (7.4, SQ-07) |
| Lương thỏa thuận NET | Gross-up bằng thuật toán lặp, sai số ≤ 1 đồng |
| Nghỉ dài ngày vắt qua hai kỳ lương | Tách phần thuộc mỗi kỳ theo ngày nghiệp vụ |
| Làm việc tại 2 chi nhánh trong cùng tháng | Phân bổ theo đoạn thời gian, áp mức tối thiểu vùng theo từng đoạn |

### BR-41 · Chính sách làm tròn phải khai báo tường minh 🔵

Cấu hình hai chiều: **làm tròn ở bước nào** và **đến hàng nào**. Làm tròn từng thành phần
rồi cộng ≠ cộng rồi làm tròn; chênh lệch này phải giải thích được với người lao động.

Mọi số tiền dùng kiểu **decimal**, tuyệt đối không dùng float.

Trong cấu hình công thức local, mỗi phiên bản ghi rõ chế độ `NONE`, `HALF_UP`,
`HALF_EVEN`, `DOWN`, `UP`, `FLOOR` hoặc `CEIL` và 0–6 chữ số thập phân cho
kết quả cấu phần. `NONE` giữ kết quả Decimal chưa làm tròn. Hàm
`ROUND(giá_trị, hàng)` là bước làm tròn nửa lên tường minh bên trong biểu thức;
`hàng` nguyên từ -6 đến 6 (âm là hàng chục/trăm…). Không làm tròn ngầm mỗi
phép cộng/nhân; phải phân biệt vết giá trị thô với giá trị sau chính sách.

### BR-42 · Điều chỉnh sau khóa kỳ ghi vào kỳ đang mở 🔵

Kỳ đã khóa **giữ nguyên số liệu, không mở khóa lại**. Sai sót hoặc quyết định có hiệu lực quá
khứ phát hiện sau khi kỳ đã khóa được xử lý bằng **bút toán điều chỉnh** (truy lĩnh / truy thu)
ghi vào kỳ đang mở, sau khi KT xác nhận (7.4; SQ-07; [17 §3](17-vong-doi-ky-cong-va-ca-qua-ngay-chot.md)). Không xác nhận thì
không thay đổi dữ liệu. Mọi bút toán ghi nhật ký kiểm toán.

### BR-43 · Duyệt và khóa bảng lương 🟡

```
KT tính lương kỳ → Bảng lương Nháp (tính lại được nhiều lần)
   → KT đối chiếu, duyệt → Đã duyệt
      → KT khóa kỳ lương → Đã khóa, ghi nhật ký kiểm toán
         → KT xuất phiếu lương và file chi lương (7.6)
```

Duyệt và khóa bảng lương là chức năng 7.5 của KT. Mỗi lần duyệt, khóa ghi nhận người thực hiện,
thời điểm và tổng số tiền. **Dữ liệu đầu vào thay đổi sau khi đã duyệt → bảng lương quay về
Nháp, phải duyệt lại.** Việc ký duyệt nội bộ của lãnh đạo (nếu quy chế yêu cầu) thực hiện ngoài
hệ thống trên bản kết xuất, trước khi KT khóa kỳ.

---

## H. Khấu trừ lương

### BR-44 · Khấu trừ hợp pháp và mức trần 30% 🔴

Chỉ được khấu trừ lương để bồi thường thiệt hại do làm hư hỏng dụng cụ, thiết bị
(Điều 102, 129 BLLĐ 2019). Người lao động phải được thảo luận và biết rõ lý do.

**Mức trần: không quá 30% tiền lương thực trả hằng tháng, tính SAU khi đã trừ bảo hiểm bắt
buộc và thuế TNCN** (tức 30% trên NET). Khấu trừ trên GROSS là vi phạm nghiêm trọng.

### BR-45 · Cấm trừ lương thay kỷ luật 🔴

**Hệ thống không cài đặt chức năng trừ lương do đi trễ, về sớm, không đạt KPI hay vi phạm
nội quy** (Điều 127 BLLĐ 2019). Mức phạt: 40 – 80 triệu VND.

Cơ chế thay thế được cài đặt:

1. **Điểm chuyên cần** — ảnh hưởng tới khoản thưởng, không trừ vào lương.
2. **Quy trình kỷ luật hợp pháp 3 bước**: khiển trách bằng văn bản → kéo dài thời hạn nâng
   lương không quá 06 tháng (hoặc cách chức) → sa thải.

### BR-46 · Không cho phép thực lĩnh âm 🔵

Nếu tổng khấu trừ lớn hơn thu nhập, hệ thống chặn chốt lương (`CP-05`) và yêu cầu điều
chỉnh kế hoạch khấu trừ sang các kỳ sau.

---

## I. Bảo hiểm bắt buộc và công đoàn

### BR-47 · Mức lương đóng bảo hiểm 🔴

Lương đóng BH quản lý **riêng biệt** với lương thực trả, gồm các cấu phần có
`is_insurable = true`. Ràng buộc:

- **Sàn**: ≥ lương tối thiểu vùng; **+7%** đối với lao động đã qua đào tạo nghề.
- **Trần**: theo tham số trần đóng, áp riêng cho từng loại bảo hiểm.

### BR-48 · Tỷ lệ đóng hai phía 🔴

| Loại | Người lao động | Doanh nghiệp |
|---|---|---|
| BHXH | 8% | Theo tham số |
| BHYT | 1,5% | Theo tham số |
| BHTN | 1% | Theo tham số |

Toàn bộ tỷ lệ, sàn, trần lấy từ mức đóng theo vùng có hiệu lực do KT cập nhật (8.1; BR-02).

### BR-49 · Xác định đối tượng tham gia 🔴

| Trường hợp | Diện đóng BH |
|---|---|
| HĐLĐ ≥ 1 tháng | Đóng đầy đủ |
| HĐLĐ < 1 tháng | Không đóng |
| Thử việc không ký HĐLĐ ≥ 1 tháng | Không đóng |
| Nghỉ không lương ≥ 14 ngày trong tháng | Không đóng tháng đó |
| Người đã hưởng lương hưu | Không đóng, trả thêm khoản tương ứng vào lương |
| Người nước ngoài | Theo quy định riêng, cấu hình được |

### BR-50 · Kinh phí công đoàn và đoàn phí 🔴

- **KPCĐ 2%** do doanh nghiệp đóng, tính trên quỹ tiền lương làm căn cứ đóng BHXH.
- **Đoàn phí 1%** do đoàn viên đóng, có **mức trần** theo quy định.

### BR-51 · Đối chiếu C12 hằng tháng 🟡

Đối chiếu số liệu hệ thống với Thông báo kết quả đóng bảo hiểm (mẫu C12) của cơ quan BHXH,
liệt kê chênh lệch theo từng nhân sự (dùng báo cáo BH 10.4).

---

## J. Thuế thu nhập cá nhân

### BR-52 · Phân loại đối tượng tính thuế 🔴

| Đối tượng | Cách tính |
|---|---|
| Cá nhân cư trú, HĐLĐ ≥ 3 tháng | Biểu lũy tiến từng phần theo hiệu lực: **5 bậc** từ kỳ tính thuế 2026 (Luật 109/2025/QH15), 7 bậc đến hết 2025 |
| Cá nhân không cư trú | **20%** trên thu nhập chịu thuế |
| Cá nhân cư trú không ký HĐ / HĐ < 3 tháng | Khấu trừ **10%** theo ngưỡng mỗi lần trả: bộ cũ 2 triệu; bộ 2026 là **5 triệu** theo khoản 2 Điều 50 NĐ 253/2026; dưới 5 triệu chỉ khấu trừ khi cá nhân yêu cầu. Cam kết tạm không khấu trừ phải đúng điều kiện và mẫu theo hiệu lực |

Phân loại cư trú độc lập với loại hợp đồng: không dùng “thời vụ” làm trạng thái cư trú.
Ngưỡng 10%, mẫu cam kết và điều kiện áp dụng được tra theo bộ quy tắc thuế; xử lý hồ sơ
đã nộp trước 01/07/2026 theo khoản 2 Điều 70 NĐ 253/2026 ([12 §2.7](12-tuan-thu-phap-ly.md)).

### BR-53 · Các khoản giảm trừ 🔴

Giảm trừ bản thân; giảm trừ người phụ thuộc **theo tháng hiệu lực đăng ký**; bảo hiểm bắt
buộc; quỹ hưu trí tự nguyện có trần; đóng góp từ thiện – nhân đạo.

| Kỳ tính thuế | Giảm trừ bản thân | Mỗi người phụ thuộc | Căn cứ |
|---|---|---|---|
| Đến hết 2025 | 11.000.000 đ/tháng | 4.400.000 đ/tháng | NQ 954/2020/UBTVQH14 |
| Từ 2026 | **15.500.000 đ/tháng** | **6.200.000 đ/tháng** | NQ 110/2025/UBTVQH15 |

Tất cả mức giảm trừ là tham số theo BR-02.

Các giảm trừ khác chọn đúng bộ quy tắc, điều kiện và chứng từ. Với bộ 2026, khoản y tế và
giáo dục–đào tạo theo Điều 46 NĐ 253/2026 có trần năm riêng (23 triệu và 24 triệu), không
tự nhân thành trần tháng hoặc trừ khoản đã được đơn vị khác/bảo hiểm tài trợ. Phải lưu số
đã sử dụng trong năm, không trừ lặp khi khấu trừ và quyết toán.

### BR-54 · Bóc tách thu nhập miễn thuế 🔴

Chế độ miễn thuế lấy theo **kỳ thuế và đối tượng**, không áp một công thức cho mọi năm:

| Khoản thu nhập | Bộ 2025: chịu / miễn | Bộ 2026 của cá nhân cư trú: chịu / miễn |
|---|---|---|
| OT ngày thường 150% | 100% / 50% | 0% / 150% |
| OT nghỉ tuần 200% | 100% / 100% | 0% / 200% |
| OT lễ Tết 300% | 100% / 200% | 0% / 300% |
| OT đêm lễ 390% | 100% / 290% | 0% / 390% |
| Giờ làm đêm bình thường 130% | 100% / 30% | 0% / 130% |

Bộ 2025 căn cứ điểm i khoản 1 Điều 3 TT 111/2013/TT-BTC. Bộ 2026 căn cứ khoản 8 Điều 4,
khoản 2 Điều 29 Luật 109/2025/QH15 và Điều 26, 69 NĐ 253/2026/NĐ-CP. Các ví dụ bộ 2026
giả định khoản trả **đủ điều kiện, thời gian, mức được miễn và có chứng từ**. Phần vượt
mức quy định tính vào thu nhập chịu thuế; không suy ra được miễn chỉ từ hệ số OT.
Tiền trả ngày không nghỉ phép chỉ miễn khi đủ điều kiện khoản 2 Điều 26 (trong doanh nghiệp:
khoản 3 Điều 113 BLLĐ); không mặc định mọi khoản thanh toán phép đều miễn.

Với lương ca đêm, phải phân bổ cả lương giờ bình thường trong khung đêm và phụ cấp đêm;
không chỉ miễn phụ cấp 30%, không đếm trùng với OT. Phần miễn và chịu thuế phải cộng lại
đúng khoản thực trả. Hồ sơ thiếu căn cứ đưa về ngoại lệ để KT xác minh trước khi duyệt.

Các khoản miễn / không tính thuế khác cần bóc tách: ăn giữa ca trong định mức, trang phục
trong định mức, công tác phí khoán, điện thoại khoán, tiền thuê nhà do công ty trả (khống
chế **không quá 15%** tổng thu nhập chịu thuế chưa gồm tiền nhà). Mỗi khoản có quy tắc và
định mức theo hiệu lực; tiền ăn trả bằng tiền có mức không tính thuế **1.200.000 đ/người/tháng
từ 01/07/2026**, không áp ngược mức này cho sáu tháng đầu năm. Bữa ăn do doanh nghiệp tổ
chức/nấu/mua suất/cấp phiếu xử lý riêng theo điểm g khoản 2 Điều 8 NĐ 253/2026.

### BR-55 · Khấu trừ tháng và quyết toán năm 🔴

Khấu trừ theo tháng (8.4) → quyết toán năm (8.5) ở dạng **dự thảo hồ sơ**; xử lý nộp thừa /
nộp thiếu; quản lý ủy quyền quyết toán. Kết quả khấu trừ tháng dùng chung với bảng lương —
không khấu trừ hai lần (AD-08). Kê khai điện tử và phát hành chứng từ khấu trừ thực hiện ngoài
hệ thống.

Quyết toán năm tổng hợp theo năm **chi trả**, tra biểu năm (ngưỡng tháng × 12), số tháng
giảm trừ đủ điều kiện và số đã khấu trừ thực tế. Khoản đã khai/nộp trong 01/01–30/06/2026
theo bộ cũ được đối chiếu và điều chỉnh ở quyết toán 2026 theo khoản 2 Điều 70 NĐ 253/2026;
không tự sửa/xóa snapshot khấu trừ hoặc nộp lại hồ sơ tháng/quý chỉ vì chuyển tiếp này.

### BR-56 · Thuế do doanh nghiệp chịu thay 🟡

Với thỏa thuận lương NET, phần thuế doanh nghiệp nộp thay được quy đổi vào thu nhập chịu
thuế thông qua module gross-up (xem [06 §8](06-thuat-toan-cham-cong-va-tinh-luong.md)).

---

## K. Hợp đồng lao động

### BR-57 · Loại hợp đồng và thời hạn 🔴

| Loại | Thời hạn |
|---|---|
| HĐLĐ không xác định thời hạn | Không xác định thời điểm chấm dứt |
| HĐLĐ xác định thời hạn | 12 – 36 tháng |
| Hợp đồng thử việc | Tối đa **60 ngày** với lao động chuyên môn kỹ thuật cao; tối đa **30 ngày** với công nhân kỹ thuật trực tiếp |
| HĐ dưới 1 tháng, khoán việc, cộng tác viên | Theo thỏa thuận |

### BR-58 · Cảnh báo ràng buộc pháp lý về hợp đồng 🔴

- Cảnh báo trước **30 / 60 ngày** khi HĐ sắp hết hạn.
- Cảnh báo hết hạn thử việc.
- Cảnh báo khi đã ký đủ **2 lần** HĐ xác định thời hạn — lần thứ 3 buộc chuyển sang HĐ
  không xác định thời hạn.

### BR-59 · Quy trình chấm dứt hợp đồng 🔴

KT lập quyết định chấm dứt (ngày hiệu lực, lý do, căn cứ) → hệ thống lấy hợp đồng và thâm
niên, tính **trợ cấp thôi việc / mất việc** (9.3), **phép chưa nghỉ** (6.2), lập **danh sách báo
giảm BH** (8.3) → KT đối chiếu và xác nhận → cập nhật trạng thái hợp đồng và ngày nghỉ việc,
đưa các khoản vào kỳ lương gần nhất (7.2), ghi nhật ký (SQ-09). Chưa xác nhận thì không thay đổi
dữ liệu. Trợ cấp được hiển thị trong theo dõi chi phí phúc lợi (9.4), không ghi nhận hai lần.

---

## L. Trả lương và chậm trả

### BR-60 · Người sử dụng lao động chịu phí chuyển khoản 🔴

Theo Khoản 2 Điều 96 BLLĐ 2019, mọi khoản phí chuyển tiền khi chi lương qua ngân hàng do
doanh nghiệp chịu; người lao động nhận trọn vẹn số tiền thực lĩnh. File chi lương (7.6) ghi
đúng số thực lĩnh, không trừ phí.

### BR-61 · Tiền đền bù chậm trả lương 🔴

Chậm trả quá **15 ngày** so với ngày chi lương quy định → hệ thống tự động tính khoản đền bù
theo Khoản 4 Điều 97 BLLĐ 2019:

```
Tiền đền bù = Số tiền lương chậm trả
            × Số ngày chậm trả
            × (Lãi suất tiền gửi không kỳ hạn cao nhất của nhóm ngân hàng
               thương mại nhà nước công bố tại thời điểm trả ÷ 365)
```

Lãi suất lấy từ tham số `LATE_PAYMENT_RATE`. Vì xuất file chi lương không đồng nghĩa đã thanh
toán, KT ghi nhận **ngày chi trả thực tế** để hệ thống xác định số ngày chậm. Khoản đền bù cộng
vào lương kỳ kế tiếp thành một dòng riêng có thuyết minh. Chậm dưới 15 ngày không phát sinh đền
bù nhưng vẫn cảnh báo.

### BR-62 · Bảng kê lương hằng tháng là bắt buộc 🔴

Mỗi kỳ chi trả phải gửi cho từng người lao động bảng kê chi tiết: lương cứng, phụ cấp,
lương làm thêm giờ, các khoản bảo hiểm bắt buộc và thuế bị khấu trừ. KT xuất **phiếu lương**
cho từng người sau khi khóa kỳ (7.6) để phát bản in hoặc gửi tệp. Không gửi payslip bị phạt
10 – 20 triệu VND.

---

## M. Dữ liệu và lưu trữ

### BR-63 · Không xóa cứng dữ liệu 🔴

Toàn bộ thực thể nghiệp vụ áp dụng xóa mềm có ngày và lý do.

### BR-64 · Thời hạn lưu trữ 🔴

Dữ liệu chấm công và tiền lương lưu trữ tối thiểu **3 năm**; sao lưu định kỳ.

### BR-65 · Bảng chấm công là chứng từ kế toán – pháp lý 🔴

Theo Điều 105 BLLĐ 2019 và NĐ 145/2020, bảng chấm công là căn cứ để cơ quan Thuế chấp nhận
quỹ lương là chi phí hợp lý. Sau khi khóa, bảng công trở thành **chỉ đọc** và có snapshot
kèm mã băm nội dung.

---

## Bảng tra chéo quy tắc ↔ tài liệu

| Nhóm quy tắc | Chức năng BFD | Đặc tả thuật toán | Yêu cầu chức năng | Tuân thủ |
|---|---|---|---|---|
| A. Kỳ và tham số | 1.3, 1.4, 1.5 | – | [07 §1](07-yeu-cau-chuc-nang.md) | [12 §2](12-tuan-thu-phap-ly.md) |
| B. Lương tối thiểu | 1.3, 7.2 | – | [07 §1, §7](07-yeu-cau-chuc-nang.md) | `CP-01` |
| C. Ca làm việc | 3.1 – 3.4 | [06 §2](06-thuat-toan-cham-cong-va-tinh-luong.md) | [07 §3](07-yeu-cau-chuc-nang.md) | – |
| D. Dữ liệu chấm công | 4.1 – 4.5 | [06 §1, §3](06-thuat-toan-cham-cong-va-tinh-luong.md) | [07 §4](07-yeu-cau-chuc-nang.md) | `XC-01`…`XC-10` |
| E. Làm thêm giờ | 5.1 – 5.5 | [06 §4, §5](06-thuat-toan-cham-cong-va-tinh-luong.md) | [07 §5](07-yeu-cau-chuc-nang.md) | `CP-03` |
| F. Nghỉ phép | 6.1 – 6.5 | [06 §9](06-thuat-toan-cham-cong-va-tinh-luong.md) | [07 §6](07-yeu-cau-chuc-nang.md) | – |
| G. Tính lương | 7.1 – 7.5 | [06 §6](06-thuat-toan-cham-cong-va-tinh-luong.md) | [07 §7](07-yeu-cau-chuc-nang.md) | `CP-08` |
| H. Khấu trừ | 7.2 | – | [07 §7](07-yeu-cau-chuc-nang.md) | `CP-04`, `CP-05` |
| I. Bảo hiểm | 8.1 – 8.3 | – | [07 §8](07-yeu-cau-chuc-nang.md) | `CP-07` |
| J. Thuế TNCN | 8.4, 8.5 | [06 §7](06-thuat-toan-cham-cong-va-tinh-luong.md) | [07 §8](07-yeu-cau-chuc-nang.md) | – |
| K. Hợp đồng | 2.2, 2.4, 2.5, 9.3 | – | [07 §2](07-yeu-cau-chuc-nang.md) | `CP-02` |
| L. Trả lương | 7.6 | – | [07 §7](07-yeu-cau-chuc-nang.md) | [12 §3](12-tuan-thu-phap-ly.md) |
| M. Dữ liệu | 1.6 | – | [07 §1](07-yeu-cau-chuc-nang.md) | [10](10-phan-quyen-va-bao-mat.md) |
| N. Cơ cấu tổ chức (`BR-66`…`BR-75`) | 1.1, 1.2, 1.4, 2.3 | – | [07 §1](07-yeu-cau-chuc-nang.md) | `CP-01` theo vùng — xem [03](03-co-cau-to-chuc.md) |
