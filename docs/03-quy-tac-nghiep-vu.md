# 03. Quy tắc nghiệp vụ

Tài liệu này tập hợp toàn bộ quy tắc nghiệp vụ (business rule) của hệ thống, mỗi quy tắc
có mã `BR-xx` để tham chiếu từ đặc tả chức năng, thuật toán và kịch bản kiểm thử.

**Quy ước mức độ:**

| Ký hiệu | Ý nghĩa |
|---|---|
| 🔴 **BẮT BUỘC PHÁP LÝ** | Vi phạm dẫn tới chế tài hành chính. Hệ thống phải chặn. |
| 🟡 **CHÍNH SÁCH** | Do doanh nghiệp quyết định, hệ thống phải cho cấu hình. |
| 🔵 **KỸ THUẬT** | Quy tắc nội tại bảo đảm tính nhất quán dữ liệu. |

---

## A. Kỳ và tham số

### BR-01 · Kỳ công và kỳ lương là hai thực thể độc lập 🔵

Kỳ công (`attendance_period`) và kỳ lương (`payroll_period`) có vòng trạng thái riêng.
Ràng buộc: **kỳ lương chỉ chạy được khi kỳ công tương ứng đã ở trạng thái `LOCKED`**.

| Kỳ | Chu kỳ mặc định | Trạng thái |
|---|---|---|
| Kỳ công | 26 tháng trước → 25 tháng hiện tại | `OPEN` → `PROCESSING` → `PENDING_APPROVAL` → `LOCKED` |
| Kỳ lương | Tính sau khi chốt công, chi ngày 10 tháng sau | `OPEN` → `CALCULATED` → `PENDING_APPROVAL` → `APPROVED` → `LOCKED` → `PAID` |

Ngày chốt công có thể khác nhau giữa khối trực tiếp và khối gián tiếp.

### BR-02 · Mọi giá trị pháp lý là tham số theo khoảng hiệu lực 🔴

Không giá trị pháp lý nào được viết cứng trong mã nguồn. Mỗi tham số có khóa
`(mã tham số, hiệu_lực_từ, hiệu_lực_đến)` và **không được chồng lấn khoảng hiệu lực**.

Danh mục tham số bắt buộc tối thiểu:

| Nhóm | Tham số |
|---|---|
| Lương tối thiểu | Mức tháng và mức giờ theo từng vùng I–IV |
| Bảo hiểm | Tỷ lệ BHXH / BHYT / BHTN hai phía, trần đóng, sàn đóng |
| Thuế TNCN | Giảm trừ bản thân, giảm trừ người phụ thuộc, 7 bậc thuế lũy tiến, thuế suất không cư trú, thuế suất khấu trừ 10% |
| Làm thêm giờ | Hệ số OT ngày thường / nghỉ tuần / lễ, phụ cấp đêm, hệ số cộng thêm OT đêm |
| Trần OT | Trần theo ngày / tháng / năm, cờ đăng ký 300h/năm |
| Công đoàn | Tỷ lệ KPCĐ, tỷ lệ đoàn phí, trần đoàn phí |
| Khác | Lãi suất chậm trả `LATE_PAYMENT_RATE`, định mức miễn thuế ăn ca / trang phục / điện thoại |

### BR-03 · Tra tham số theo ngày nghiệp vụ, không theo ngày chạy 🔴

Mọi phép tính tra tham số theo **ngày nghiệp vụ của giao dịch**. Chạy lại kỳ 12/2025 vào
tháng 02/2026 phải cho ra mức lương tối thiểu của năm 2025.

*Hệ quả:* bảo đảm tính idempotent và khả năng đối chiếu với hồ sơ đã nộp cho cơ quan quản lý.

### BR-04 · Mọi tham số phải khai báo văn bản căn cứ 🔴

Mỗi bản ghi tham số bắt buộc có trường trích dẫn văn bản pháp luật (số hiệu, ngày ban hành,
điều khoản). Hệ thống cảnh báo khi tham số sắp hết hiệu lực mà chưa có bản ghi kế tiếp.

### BR-05 · Cấu hình chính sách kế thừa theo cây tổ chức 🟡

Cấu hình (quy tắc OT, làm tròn, ngày chốt công, ngày công chuẩn, dung sai) phân giải theo
nguyên tắc **đơn vị con kế thừa cha, ghi đè từng khóa**. Giao diện luôn hiển thị nguồn gốc
của giá trị đang có hiệu lực.

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

Doanh nghiệp thuộc **Vùng I**, nhưng giá trị này vẫn là tham số theo BR-02.

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
| Ca C (đêm) | 22:00 – 06:00 hôm sau | 8h | 30 phút, tính vào giờ làm việc |
| Hành chính | 08:00 – 17:00, T2–T7 | 8h | Theo nội quy |

Khối trực tiếp xoay ca theo **chu kỳ tuần**; mỗi người phải làm đủ 3 loại ca trong tháng.

### BR-11 · Giới hạn thời giờ làm việc bình thường 🔴

Không quá **8 giờ/ngày** và **48 giờ/tuần** (khuyến khích 40 giờ/tuần).

### BR-12 · Khung giờ làm việc ban đêm 🔴

Thống nhất từ **22:00 hôm trước đến 06:00 hôm sau**. Đây là mốc tách đoạn giờ, áp dụng cho
mọi ca, không riêng ca C.

### BR-13 · Một ca = một ngày công, gán về ngày bắt đầu ca 🔵

Ca C bắt đầu 22:00 ngày T sinh **đúng một** bản ghi ngày công của ngày T, chứa cả phần giờ
rơi sang ngày T+1. Không tách thành hai ngày lẻ.

*Ngoại lệ cần xử lý riêng:* việc **phân loại ngày** để áp hệ số OT vẫn tách theo mốc 00:00,
vì một ca có thể vắt từ ngày thường sang ngày lễ. Xem **BR-24**
và [thuật toán 05](05-thuat-toan-cham-cong-va-tinh-luong.md).

### BR-14 · Ngày công chuẩn tháng 🟡

Cấu hình được: cố định 26 công hoặc theo ngày làm việc thực tế. Mặc định **26** cho khối
sản xuất. Giá trị này ảnh hưởng trực tiếp tới công thức đơn giá ngày và đơn giá giờ.

### BR-15 · Bẫy mẫu số khi tính lương giờ 🔴

Lương giờ thực trả = **lương tháng ÷ tổng số giờ làm việc thực tế trong tháng**, trong đó
**không tính** giờ nghỉ lễ / Tết có hưởng lương vào mẫu số.

> Đưa ngày lễ vào mẫu số làm "pha loãng" đơn giá → trả thiếu lương làm thêm giờ → vi phạm
> hành vi "trả không đủ lương".

### BR-16 · Nghỉ lễ trùng ngày nghỉ hằng tuần 🔴

Ngày lễ trùng ngày nghỉ hằng tuần thì được nghỉ bù vào ngày làm việc kế tiếp. Hệ thống phải
quản lý lịch nghỉ bù và cho phép khai báo hoán đổi ngày nghỉ dịp Tết.

---

## D. Dữ liệu chấm công

### BR-17 · Khử lượt quẹt trùng trong 5 phút 🔵

Nhiều lượt quẹt của cùng một nhân sự trong vòng **05 phút**: chỉ ghi nhận **lượt đầu tiên**
cho Check-In và **lượt cuối cùng** cho Check-Out.

### BR-18 · Ghép cặp Vào/Ra 🔵

Hệ thống tìm lượt quẹt **sớm nhất** trong khung giờ Vào và lượt quẹt **muộn nhất** trong
khung giờ Ra của ca đã phân bổ để tạo một cặp công hoàn chỉnh.

Thiếu một trong hai lượt → gán trạng thái ngoại lệ **`ERR` (Lỗi quẹt thẻ)**, gửi cảnh báo
về cổng ESS của người lao động để giải trình, đồng thời hiển thị cảnh báo trên màn hình
quản lý phân xưởng.

### BR-19 · Dữ liệu thô là bất biến 🔵

Bản ghi quẹt thẻ nguyên trạng (`raw_punch`) chỉ được ghi thêm, **không bao giờ sửa hoặc xóa**.
Mọi hiệu chỉnh diễn ra ở tầng dữ liệu dẫn xuất.

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

Đi muộn hoặc về sớm **dưới 15 phút** có lý do khách quan và được quản lý xưởng phê duyệt
đơn giải trình trực tuyến → hệ thống khôi phục ngày công tròn ca, **không trừ lương thời gian**.

Vượt dung sai: ghi nhận vào dữ liệu công và báo cáo chuyên cần, **không trừ lương**
(xem **BR-45**).

### BR-22 · Điều chỉnh công thủ công phải có lý do 🔴

Mọi thao tác sửa dữ liệu công bắt buộc nhập lý do và ghi audit log gồm: người sửa, thời
điểm, giá trị cũ, giá trị mới, địa chỉ IP, mã tham chiếu đơn.

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
> (cao hơn luật, được phép), hệ số OT đêm phải tự động thành 212%. Lưu con số kết quả sẽ
> khiến hai chỗ lệch nhau.

### BR-24 · Tách đoạn giờ theo mốc thời gian và loại ngày 🔴

Một ca OT có thể vắt qua nhiều đoạn. Hệ thống tách theo các mốc **22:00**, **06:00** và
**00:00**, rồi áp hệ số cho từng đoạn:

- 22:00 / 06:00 → ranh giới ngày ↔ đêm.
- 00:00 → ranh giới loại ngày (thường / nghỉ tuần / lễ).

*Ví dụ:* ca OT từ 20:00 ngày thường đến 02:00 ngày lễ được tách thành 3 đoạn:
20:00–22:00 (OT ngày thường 150%), 22:00–24:00 (OT đêm ngày thường 200/210%),
00:00–02:00 (OT đêm ngày lễ 390%).

### BR-25 · Phân biệt 200% và 210% 🔴

Mốc phân biệt là trạng thái **"đã có OT ban ngày trước đó trong cùng ngày công"** — đây là
thuộc tính của **ngày công**, không phải của đoạn giờ. Phải xác định ngày công trước, rồi
mới áp hệ số cho từng đoạn.

### BR-26 · Đối chiếu OT đăng ký với thực tế 🟡

Hệ thống so giờ OT đã đăng ký/phê duyệt với giờ chấm công thực tế và **lấy giá trị nhỏ hơn**
làm căn cứ tính lương.

### BR-27 · Trần làm thêm giờ 🔴

| Trần | Giá trị | Hành vi hệ thống |
|---|---|---|
| Theo ngày | ≤ 50% số giờ làm việc bình thường trong ngày | Cảnh báo và chặn |
| Theo tháng | ≤ **40 giờ** | Cảnh báo khi chạm ngưỡng, chặn khi vượt |
| Theo năm | ≤ **200 giờ** (≤ 300 giờ với ngành đặc thù đã thông báo Sở LĐ-TB&XH) | Chặn, cần phê duyệt ghi đè có căn cứ |

Cờ bật trần 300h/năm là tham số, chỉ được bật khi doanh nghiệp đã gửi thông báo.

### BR-28 · OT phải có văn bản đồng ý của người lao động 🔴

Hệ thống **chặn huy động OT** khi chưa có bản ghi thỏa thuận đồng ý làm thêm giờ của người
lao động. Ép buộc tăng ca bị phạt 40 – 50 triệu VND.

### BR-29 · Quy đổi OT sang nghỉ bù 🟡

Cho phép chọn trả tiền hoặc quy đổi nghỉ bù. Quỹ nghỉ bù sinh ra có **tỷ lệ quy đổi** và
**hạn sử dụng** cấu hình được (giả định tạm: 1 : 1,5 — hạn 3 tháng).

### BR-30 · Luồng duyệt OT phân nhánh theo mức độ 🟡

| Điều kiện | Luồng duyệt |
|---|---|
| OT thường ngày < 2 giờ/ngày | 1 cấp: Quản lý phân xưởng |
| OT > 3 giờ/ngày hoặc vào ngày nghỉ hằng tuần | 2 cấp: Quản lý phân xưởng → Trưởng phòng Nhân sự |
| Quá 12 giờ không được duyệt | Đơn **tự động hủy**, thông báo để đăng ký lại |

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

- Phép dư cuối năm: chuyển tối đa **5 ngày**, hạn sử dụng đến **31/03 năm sau** (giả định tạm).
- Ứng phép trước của năm sau: cho phép tối đa **3 ngày** (giả định tạm).
- Cả hai đều là tham số cấu hình.

### BR-33 · Đơn nghỉ và kiểm soát số dư 🔵

Đơn nghỉ hỗ trợ đơn vị **ngày / nửa ngày / theo giờ**. Hệ thống kiểm tra số dư tại thời
điểm nộp; cho phép khai báo sau với nghỉ đột xuất; hủy đơn thì hoàn lại số dư.

### BR-34 · Nghỉ phép có ngày lễ xen giữa 🔴

Ngày lễ nằm trong kỳ nghỉ phép **không bị trừ vào quỹ phép năm**, được ghi nhận là `L`.

### BR-35 · Chế độ ốm đau – thai sản do BHXH chi trả 🔴

| Chế độ | Mức hưởng | Căn cứ |
|---|---|---|
| Ốm đau | **75%** mức tiền lương đóng BHXH | Số ngày hưởng theo thâm niên đóng BH |
| Thai sản | **100%** mức bình quân tiền lương đóng BHXH 6 tháng liền kề | Theo quy định BHXH |

Hệ thống lập hồ sơ đề nghị cơ quan BHXH và theo dõi tiền BHXH chi trả về cho người lao động.

### BR-36 · Thanh toán phép chưa nghỉ khi chấm dứt HĐ 🔴

Khi chấm dứt hợp đồng, số ngày phép năm chưa nghỉ được thanh toán bằng tiền theo đơn giá
ngày công tại thời điểm chấm dứt.

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

### BR-39 · Công thức tính là dữ liệu, không phải mã nguồn 🔵

Mọi thành phần lương được định nghĩa bằng bản ghi có công thức dạng biểu thức. Engine dựng
đồ thị phụ thuộc, sắp thứ tự tô-pô, phát hiện phụ thuộc vòng rồi tính theo thứ tự. Mỗi công
thức có phiên bản gắn khoảng hiệu lực.

Biểu thức chỉ dùng tập hàm giới hạn, **không có vòng lặp, không truy cập I/O**.

### BR-40 · Các tình huống tính lương bắt buộc xử lý được 🔵

| Tình huống | Quy tắc |
|---|---|
| Vào làm / nghỉ việc giữa tháng | Tính theo tỷ lệ ngày công thực tế trong kỳ |
| Tăng lương hiệu lực từ giữa tháng | Tách hai đoạn đơn giá trong cùng kỳ |
| Chuyển bộ phận giữa tháng, phụ cấp khác nhau | Tách theo đoạn thời gian, phân bổ chi phí về hai cost center theo tỷ lệ ngày công |
| Quyết định ban hành sau khi kỳ đã chốt | Sinh dòng truy lĩnh / truy thu ở kỳ gần nhất chưa khóa, có thuyết minh kỳ gốc |
| Lương thỏa thuận NET | Gross-up bằng thuật toán lặp, sai số ≤ 1 đồng |
| Nghỉ dài ngày vắt qua hai kỳ lương | Tách phần thuộc mỗi kỳ theo ngày nghiệp vụ |
| Làm việc tại 2 chi nhánh trong cùng tháng | Phân bổ theo đoạn thời gian, áp mức tối thiểu vùng theo từng đoạn |

### BR-41 · Chính sách làm tròn phải khai báo tường minh 🔵

Cấu hình hai chiều: **làm tròn ở bước nào** và **đến hàng nào**. Làm tròn từng thành phần
rồi cộng ≠ cộng rồi làm tròn; chênh lệch này phải giải thích được với người lao động.

Mọi số tiền dùng kiểu **decimal**, tuyệt đối không dùng float.

### BR-42 · Điều chỉnh sau chốt chuyển sang kỳ kế tiếp 🔵

Mặc định, sai sót phát hiện sau khi kỳ đã khóa được xử lý bằng dòng truy lĩnh / truy thu ở
kỳ gần nhất chưa khóa. Mở khóa kỳ cũ là **ngoại lệ**: cần quyền riêng, lý do bắt buộc, và
luôn lưu snapshot trước khi mở.

### BR-43 · Luồng duyệt bảng lương 4 bước 🟡

```
A3 Chuyên viên tiền lương lập
   → A5 Trưởng phòng Nhân sự duyệt cấp 1
      → D2 Kế toán trưởng duyệt cấp 2
         → D4 Ban Giám đốc phê duyệt cuối → LOCKED
```

Mỗi cấp duyệt ghi nhận người duyệt, thời điểm, ý kiến và snapshot tổng số tiền. **Dữ liệu
thay đổi sau khi đã duyệt → hủy toàn bộ phê duyệt đã có, yêu cầu duyệt lại.**

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

Toàn bộ tỷ lệ lấy từ bảng tham số theo hiệu lực (BR-02).

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
liệt kê chênh lệch theo từng nhân sự.

---

## J. Thuế thu nhập cá nhân

### BR-52 · Phân loại đối tượng tính thuế 🔴

| Đối tượng | Cách tính |
|---|---|
| Cá nhân cư trú, HĐLĐ ≥ 3 tháng | Biểu lũy tiến từng phần **7 bậc** |
| Cá nhân không cư trú | **20%** trên thu nhập chịu thuế |
| Lao động thời vụ / HĐ < 3 tháng | Khấu trừ **10%** trên thu nhập từ ngưỡng quy định; hỗ trợ cam kết 02/CK-TNCN |

### BR-53 · Các khoản giảm trừ 🔴

Giảm trừ bản thân; giảm trừ người phụ thuộc **theo tháng hiệu lực đăng ký**; bảo hiểm bắt
buộc; quỹ hưu trí tự nguyện có trần; đóng góp từ thiện – nhân đạo.

Tất cả mức giảm trừ là tham số theo BR-02.

### BR-54 · Bóc tách thu nhập miễn thuế 🔴

Chỉ **phần thu nhập chênh lệch** do làm thêm giờ / làm đêm mới được miễn thuế; phần 100%
gốc vẫn chịu thuế bình thường.

| Khoản OT | Phần chịu thuế | Phần miễn thuế |
|---|---|---|
| OT ngày thường 150% | 100% | 50% |
| OT nghỉ tuần 200% | 100% | 100% |
| OT lễ Tết 300% | 100% | 200% |
| OT đêm lễ 390% | 100% | 290% |

Các khoản miễn / không tính thuế khác cần bóc tách: ăn giữa ca trong định mức, trang phục
trong định mức, công tác phí khoán, điện thoại khoán, tiền thuê nhà do công ty trả (khống
chế **không quá 15%** tổng thu nhập chịu thuế chưa gồm tiền nhà).

### BR-55 · Khấu trừ tháng và quyết toán năm 🔴

Khấu trừ theo tháng → quyết toán năm; xử lý nộp thừa / nộp thiếu; quản lý ủy quyền quyết
toán; cấp chứng từ khấu trừ thuế TNCN bản điện tử có quản lý số seri.

### BR-56 · Thuế do doanh nghiệp chịu thay 🟡

Với thỏa thuận lương NET, phần thuế doanh nghiệp nộp thay được quy đổi vào thu nhập chịu
thuế thông qua module gross-up (xem [05 §8](05-thuat-toan-cham-cong-va-tinh-luong.md)).

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

Quyết định thôi việc → bàn giao → tính trợ cấp thôi việc / mất việc → thanh toán ngày phép
chưa nghỉ → chốt sổ BHXH → quyết toán thuế cuối cùng.

---

## L. Trả lương và chậm trả

### BR-60 · Người sử dụng lao động chịu phí chuyển khoản 🔴

Theo Khoản 2 Điều 96 BLLĐ 2019, mọi khoản phí chuyển tiền khi chi lương qua ngân hàng do
doanh nghiệp chịu; người lao động nhận trọn vẹn số tiền thực lĩnh.

### BR-61 · Tiền đền bù chậm trả lương 🔴

Chậm trả quá **15 ngày** so với ngày chi lương quy định → hệ thống tự động tính khoản đền bù
theo Khoản 4 Điều 97 BLLĐ 2019:

```
Tiền đền bù = Số tiền lương chậm trả
            × Số ngày chậm trả
            × (Lãi suất tiền gửi không kỳ hạn cao nhất của nhóm ngân hàng
               thương mại nhà nước công bố tại thời điểm trả ÷ 365)
```

Lãi suất lấy từ tham số `LATE_PAYMENT_RATE`. Khoản đền bù cộng trực tiếp vào lương thành
một dòng riêng có thuyết minh. Chậm dưới 15 ngày không phát sinh đền bù nhưng vẫn cảnh báo.

### BR-62 · Bảng kê lương hằng tháng là bắt buộc 🔴

Mỗi kỳ chi trả phải gửi cho từng người lao động bảng kê chi tiết: lương cứng, phụ cấp,
lương làm thêm giờ, các khoản bảo hiểm bắt buộc và thuế bị khấu trừ. Không gửi payslip bị
phạt 10 – 20 triệu VND.

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

| Nhóm quy tắc | Đặc tả thuật toán | Yêu cầu chức năng | Tuân thủ |
|---|---|---|---|
| A. Kỳ và tham số | – | [FR-01](06-yeu-cau-chuc-nang.md) | [11 §2](11-tuan-thu-phap-ly.md) |
| B. Lương tối thiểu | – | [FR-08](06-yeu-cau-chuc-nang.md) | `CP-01` |
| C. Ca làm việc | [05 §2](05-thuat-toan-cham-cong-va-tinh-luong.md) | [FR-04](06-yeu-cau-chuc-nang.md) | – |
| D. Dữ liệu chấm công | [05 §1, §3](05-thuat-toan-cham-cong-va-tinh-luong.md) | [FR-05](06-yeu-cau-chuc-nang.md) | `XC-01`…`XC-10` |
| E. Làm thêm giờ | [05 §4, §5](05-thuat-toan-cham-cong-va-tinh-luong.md) | [FR-06](06-yeu-cau-chuc-nang.md) | `CP-03` |
| F. Nghỉ phép | – | [FR-07](06-yeu-cau-chuc-nang.md) | – |
| G. Tính lương | [05 §6](05-thuat-toan-cham-cong-va-tinh-luong.md) | [FR-08](06-yeu-cau-chuc-nang.md) | `CP-08` |
| H. Khấu trừ | – | [FR-08](06-yeu-cau-chuc-nang.md) | `CP-04`, `CP-05` |
| I. Bảo hiểm | – | [FR-09](06-yeu-cau-chuc-nang.md) | `CP-07` |
| J. Thuế TNCN | [05 §7](05-thuat-toan-cham-cong-va-tinh-luong.md) | [FR-10](06-yeu-cau-chuc-nang.md) | – |
| K. Hợp đồng | – | [FR-03](06-yeu-cau-chuc-nang.md) | `CP-02` |
| L. Trả lương | – | [FR-08](06-yeu-cau-chuc-nang.md) | [11 §3](11-tuan-thu-phap-ly.md) |
| M. Dữ liệu | – | [FR-16](06-yeu-cau-chuc-nang.md) | [09](09-phan-quyen-va-bao-mat.md) |
