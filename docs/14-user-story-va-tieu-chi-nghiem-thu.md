# 14. User story và tiêu chí nghiệm thu

## 1. Phương pháp

### 1.1. Cấu trúc user story

```
Là một [VAI TRÒ]
tôi muốn [HÀNH ĐỘNG / TÍNH NĂNG]
để [GIÁ TRỊ / LỢI ÍCH]
```

Mỗi story đi kèm **Tiêu chí chấp nhận (Acceptance Criteria — AC)** làm thước đo để QA viết
test case và người dùng nghiệp vụ nghiệm thu (UAT). Vai trò chỉ gồm bốn tác nhân của hệ thống:
**TT** (Tổ trưởng), **QĐ** (Quản đốc), **KT** (Kế toán), **AD** (Admin). Công nhân không phải
người dùng — nhu cầu của họ được phục vụ qua TT và KT.

### 1.2. Bốn bước xây dựng user story

| Bước | Phương pháp | Giá trị đạt được |
|---|---|---|
| **1. Phân tích tác nhân** | Bốn vai trò theo BFD và phạm vi dữ liệu của từng vai trò | TT cần thao tác nhanh tại xưởng cho cả tổ; QĐ cần nhìn toàn xưởng và trần OT; KT cần bảng tính chi tiết, drill-down; AD cần nhập tệp và cấu hình có hiệu lực |
| **2. Vẽ bản đồ hành trình** | Luồng liên tục từ đầu tháng đến cuối tháng theo AD-00 | Phát hiện lỗ hổng tính năng dọc theo chu trình |
| **3. Áp bộ lọc INVEST** | Independent · Negotiable · Valuable · Estimable · Small · Testable | Bảo đảm story triển khai và kiểm thử được |
| **4. Hội ý Ba Bên** | Nghiệp vụ (TT, QĐ, KT) — Dev — QA họp trước khi viết mã | Phát hiện tình huống biên (nghỉ ốm giữa giờ, quên quẹt ca kíp, OT qua đêm trùng ngày lễ, hồi tố qua hai kỳ đã khóa) |

### 1.3. Bản đồ hành trình tháng

```
AD cấu hình, mở kỳ công → KT cập nhật hồ sơ, hợp đồng, chính sách lương
   → TT lập lịch ca, QĐ duyệt → AD nhập tệp chấm công hằng ngày
      → TT đề xuất OT (QĐ duyệt trong trần) · TT ghi nhận và duyệt đơn nghỉ · TT giải trình ngoại lệ
         → TT xác nhận công tổ → QĐ chốt công xưởng → KT khóa kỳ công
            → KT tính lương, BH, thuế (bảng nháp) → KT duyệt, khóa kỳ lương
               → KT xuất phiếu lương và file chi lương → KT lập danh sách BH, thuế, báo cáo quỹ lương
```

---

## 2. User story cốt lõi

### US-01 · Phát hành phiếu lương bảo mật (KT)

> **Là một** Kế toán (KT),
> **tôi muốn** xuất phiếu lương chi tiết cho từng người lao động từ bảng lương đã khóa, được bảo
> vệ khi phát cho người lao động,
> **để** mỗi người hiểu rõ thu nhập thực lĩnh và giờ tăng ca của mình mà thông tin thu nhập
> không bị rò rỉ.

**Tiêu chí chấp nhận:**

| Mã | Tiêu chí |
|---|---|
| **AC 1.1** | Phiếu lương hiển thị rõ từng mục: lương cơ bản theo HĐLĐ · số ngày công thực tế · tổng giờ OT ban ngày · tổng giờ OT ca đêm · các khoản phụ cấp (chống độc, ca đêm, chuyên cần) · BHXH 8% / BHYT 1,5% / BHTN 1% · thuế TNCN bị khấu trừ · truy lĩnh / truy thu (ghi kỳ gốc) · **số thực lĩnh** |
| **AC 1.2** | Chỉ xuất được khi kỳ lương **Đã khóa**; mỗi người một tệp PDF **đặt mật khẩu mở tệp** theo quy tắc của doanh nghiệp, hoặc bản in theo từng người |
| **AC 1.3** | Không hiển thị con số lương nào trên thông báo trong ứng dụng (NĐ 13/2023) |
| **AC 1.4** | Mọi lần xuất phiếu lương ghi audit log: người xuất, thời điểm, IP, kỳ, số phiếu |
| **AC 1.5** | Người lao động phản ánh sai lệch qua TT (công) hoặc KT (lương); sai lệch ở kỳ đã khóa xử lý bằng bút toán điều chỉnh ở kỳ đang mở |

**Liên kết:** FR-7.6.1 · BR-62 · [10 §3.3](10-phan-quyen-va-bao-mat.md)

---

### US-02 · Ghép công ca đêm bắc cầu (TT, QĐ)

> **Là một** Tổ trưởng / Quản đốc,
> **tôi muốn** hệ thống tự nhận diện và gom dữ liệu chấm công của công nhân làm ca đêm bắc cầu
> qua ngày hôm sau về đúng ngày bắt đầu làm việc,
> **để** tôi xác nhận và chốt bảng công chính xác, nhanh chóng và không bị trùng lặp công.

**Tiêu chí chấp nhận:**

| Mã | Tiêu chí |
|---|---|
| **AC 2.1** | Với ca C (22:00 ngày T → 06:00 ngày T+1): lượt "Vào" trong khung **21:30 – 22:15 ngày T** và lượt "Ra" trong khung **05:45 – 06:30 ngày T+1** được ghép thành **01 ngày công cho ngày T** — không ghi lẻ hai ngày, không báo lỗi |
| **AC 2.2** | Hệ thống tự tách số giờ trong khung **22:00 – 06:00** để tính phụ cấp ban đêm **ít nhất 30%** (Điều 98 BLLĐ 2019) |
| **AC 2.3** | Chỉ có một lượt quẹt → gán **`ERR`**, hiển thị **cảnh báo màu cam** trên màn hình TT và QĐ; TT nhập giải trình kèm chứng cứ để bổ sung công |
| **AC 2.4** | Ca C bắt đầu **22:00 ngày 25** (cut-off) thuộc trọn kỳ công cũ |
| **AC 2.5** | Ca C vắt từ ngày thường sang **ngày lễ**: vẫn là 1 ngày công của ngày thường, đoạn giờ sau 00:00 áp hệ số ngày lễ |

**Liên kết:** FR-4.2.3, FR-4.2.4, FR-4.3.1 · BR-13, BR-24 · [06 §3, §4](06-thuat-toan-cham-cong-va-tinh-luong.md)

---

### US-03 · Tính lương tự động đa tầng (KT)

> **Là một** Kế toán (KT),
> **tôi muốn** hệ thống tự tính lương thời gian, phụ cấp ca kíp, áp ma trận hệ số tăng ca đêm
> đa tầng, lương tối thiểu vùng và biểu thuế đúng hiệu lực,
> **để** tôi hoàn thành bảng lương cho hàng nghìn lao động ở 4 cơ sở đúng hạn, chính xác và
> loại bỏ rủi ro pháp lý.

**Tiêu chí chấp nhận:**

| Mã | Tiêu chí |
|---|---|
| **AC 3.1** | Đối chiếu lương HĐLĐ và lương đóng BH của từng nhân sự với lương tối thiểu **của vùng tương ứng với cơ sở người đó thuộc về tại kỳ** (Vùng I 5.310.000 · Vùng II 4.730.000 · Vùng III 4.140.000). Thấp hơn → `CP-01` **chặn**, đánh dấu đỏ, dẫn chiếu NĐ 293/2025 |
| **AC 3.2** | Áp đúng hệ số OT ban đêm theo Điều 57 NĐ 145/2020: ngày thường **200%** (chưa OT ngày) / **210%** (đã OT ngày) · nghỉ hằng tuần **270%** · lễ Tết **390%** |
| **AC 3.3** | Trích BHXH 8% / BHYT 1,5% / BHTN 1% trên mức lương đóng BH **đã áp sàn, trần theo vùng**; tính thuế TNCN với giảm trừ **15,5 triệu + 6,2 triệu / người phụ thuộc** và **biểu lũy tiến 5 bậc** cho kỳ tính thuế 2026 (kỳ 2025 dùng 11 / 4,4 triệu và biểu 7 bậc) |
| **AC 3.4** | Hệ số OT là **kết quả tính** từ công thức 3 số hạng: nâng hệ số OT ngày thường lên 160% trong tham số thì hệ số OT đêm tự thành **212%** |
| **AC 3.5** | Tính lại hai lần trên cùng dữ liệu cho **kết quả trùng khớp tuyệt đối** |
| **AC 3.6** | Mỗi dòng lương drill-down được: số tiền → công thức → giá trị từng biến → tham số → dữ liệu công gốc |
| **AC 3.7** | Kỳ có thưởng → thưởng được tính trước khi tổng hợp thu nhập |

**Liên kết:** FR-7.1.2, FR-7.2.1 – FR-7.2.10, FR-7.3.1, FR-5.4.2, FR-8.1.1, FR-8.4.4

---

### US-04 · Kiểm soát thay đổi và chậm trả lương (KT)

> **Là một** Kế toán (KT),
> **tôi muốn** hệ thống ghi lại toàn bộ nhật ký chỉnh sửa công, lương và tự tính đền bù khi
> doanh nghiệp trả chậm lương quá thời hạn,
> **để** tôi kiểm soát tính minh bạch của số liệu, ngăn trục lợi nội bộ và bảo đảm doanh nghiệp
> không bị xử phạt theo NĐ 283/2026.

**Tiêu chí chấp nhận:**

| Mã | Tiêu chí |
|---|---|
| **AC 4.1** | Mọi can thiệp thủ công vào dữ liệu công, hệ số lương, phụ cấp, thưởng **bắt buộc nhập lý do**; hệ thống ghi vết: người sửa · thời điểm · giá trị cũ · giá trị mới · IP · lý do |
| **AC 4.2** | Nhật ký kiểm toán **chỉ đọc**, **không ai sửa, xóa được kể cả Admin** — quyền UPDATE/DELETE bị thu hồi ở tầng CSDL, có chuỗi băm |
| **AC 4.3** | Màn hình KT hiển thị **cảnh báo** khi sắp đến hạn chi lương mà bảng lương chưa khóa |
| **AC 4.4** | Chậm trả lương quá **15 ngày** (theo ngày chi trả thực tế KT ghi nhận) → tự tính tiền đền bù cộng vào lương kỳ kế tiếp: `Lương chậm trả × Số ngày chậm × (Lãi suất không kỳ hạn cao nhất của 4 NHTM Nhà nước ÷ 365)` (Khoản 4 Điều 97 BLLĐ 2019) |
| **AC 4.5** | Chậm **dưới 15 ngày** không phát sinh đền bù, nhưng vẫn ghi nhận và cảnh báo |
| **AC 4.6** | Lãi suất lấy từ tham số `LATE_PAYMENT_RATE` theo khoảng hiệu lực, **không hardcode** |

**Liên kết:** FR-1.6.1, FR-1.6.2, FR-7.5.3, FR-7.5.4, FR-7.6.3 · [10 §4](10-phan-quyen-va-bao-mat.md)

---

## 3. User story bổ sung theo tác nhân

### Tổ trưởng (TT)

| Mã | User story | AC chính |
|---|---|---|
| US-05 | Là **TT**, tôi muốn lập lịch ca cho tổ theo mẫu xoay ca và sao chép lịch tháng trước, để không phải nhập lại | Hệ thống kiểm tra ràng buộc xoay ca, nghỉ giữa hai ca, trùng đơn nghỉ; xung đột → báo để sửa; gửi duyệt → Chờ duyệt |
| US-06 | Là **TT**, tôi muốn đề xuất đổi ca cho một công nhân sau khi lịch đã duyệt, để đáp ứng phát sinh | Kiểm tra ràng buộc ca mới; chưa được QĐ duyệt thì lịch hiện hành vẫn áp dụng |
| US-07 | Là **TT**, tôi muốn nhập giải trình quên chấm công cho công nhân kèm chứng cứ, để công nhân không bị mất công | Lưu giá trị cũ – mới – người sửa; không ghi đè log gốc; ghi nhật ký |
| US-08 | Là **TT**, tôi muốn xác nhận công thực tế của tổ, để chịu trách nhiệm về số liệu trước khi xưởng chốt | Chưa đủ căn cứ → giữ chờ bổ sung; xác nhận xong → Tổ đã xác nhận |
| US-09 | Là **TT**, tôi muốn lập một đề xuất OT cho nhiều công nhân của tổ kèm căn cứ đồng ý làm thêm, để huy động nhanh và hợp pháp | Thiếu căn cứ đồng ý → chặn; gửi xong thông báo QĐ |
| US-10 | Là **TT**, tôi muốn ghi nhận đơn nghỉ thay công nhân và duyệt ngay, để công nhân không phải thao tác trên hệ thống | Kiểm tra loại nghỉ, lịch, số dư; duyệt là cấp duy nhất; trừ quỹ phép năm, ngày lễ xen giữa không trừ |

### Quản đốc (QĐ)

| Mã | User story | AC chính |
|---|---|---|
| US-11 | Là **QĐ**, tôi muốn duyệt hoặc trả lại lịch ca của các tổ kèm lý do, để bảo đảm nhân lực toàn xưởng | Chỉ lịch Đã duyệt có hiệu lực; trả lại thông báo TT |
| US-12 | Là **QĐ**, tôi muốn thấy lũy kế OT từng công nhân so với trần khi duyệt đề xuất, để không huy động vượt luật | Cảnh báo khi chạm 90% trần tháng; vượt trần → **không cho duyệt** |
| US-13 | Là **QĐ**, tôi muốn tổng hợp và chốt bảng công xưởng sau khi các tổ đã xác nhận, để chuyển kế toán khóa | Còn tổ chưa xác nhận hoặc `XC` BLOCKING → không cho chốt |
| US-14 | Là **QĐ**, tôi muốn xem tỷ lệ vắng mặt theo tổ, theo ngày và biến động nhân sự của xưởng, để điều phối sản xuất | Chỉ thấy dữ liệu xưởng mình; cảnh báo khi vượt ngưỡng |

### Kế toán (KT)

| Mã | User story | AC chính |
|---|---|---|
| US-15 | Là **KT**, tôi muốn nhận cảnh báo hợp đồng sắp hết hạn và đã ký đủ 2 lần HĐ xác định thời hạn, để không vi phạm luật | Cảnh báo 30 / 60 ngày; cảnh báo không tự chấm dứt HĐ |
| US-16 | Là **KT**, tôi muốn lập quyết định điều chuyển liên tỉnh có ngày hiệu lực, để hệ thống tự xử lý đúng vùng lương và cost center | Bắt buộc số quyết định và ngày hiệu lực; cảnh báo nếu kèm giảm lương; hiệu lực quá khứ → cảnh báo hồi tố |
| US-17 | Là **KT**, tôi muốn kiểm tra và khóa kỳ công sau khi các xưởng đã chốt, để có dữ liệu bất biến cho tính lương | Chưa đủ điều kiện → nêu điều kiện còn thiếu; khóa → snapshot + hash |
| US-18 | Là **KT**, tôi muốn tính bảng lương nháp và so sánh chênh lệch với kỳ trước, để phát hiện bất thường trước khi duyệt | Liệt kê nhân sự biến động vượt ngưỡng; mỗi dòng phải được xác nhận |
| US-19 | Là **KT**, tôi muốn xử lý truy lĩnh / truy thu cho quyết định có hiệu lực quá khứ, để không phải sửa kỳ đã khóa | Bảng chênh lệch lương, BH, thuế từng kỳ; xác nhận → bút toán ở kỳ mở; kỳ cũ giữ nguyên |
| US-20 | Là **KT**, tôi muốn lập quyết định chấm dứt HĐ và xem ngay trợ cấp, tiền phép chưa nghỉ, danh sách báo giảm BH, để hoàn tất thủ tục một lần | Chưa xác nhận → không thay đổi dữ liệu; trợ cấp hiển thị ở chi phí phúc lợi, không ghi hai lần |
| US-21 | Là **KT**, tôi muốn đối chiếu số liệu BHXH với thông báo C12 và lập danh sách báo tăng giảm, để kê khai đúng hạn | Liệt kê chênh lệch theo nhân sự; chênh lệch → bút toán kỳ mở |
| US-22 | Là **KT**, tôi muốn lập dự thảo quyết toán thuế năm 2026 với tham số đúng năm, để giảm sai sót | Dùng biểu 5 bậc và giảm trừ 15,5 / 6,2 triệu; tính nộp thừa / thiếu từng người |
| US-23 | Là **KT**, tôi muốn lập danh sách cấp phát phúc lợi dự kiến, điều chỉnh rồi xác nhận, để không cấp trùng | Danh sách chưa xác nhận vẫn là dự kiến; trùng cấp → báo khoản cần kiểm tra |
| US-24 | Là **KT**, tôi muốn xuất file chi lương đúng mẫu ngân hàng, để chi lương không phải nhập tay | Chặn khi tổng tệp ≠ tổng bảng lương hoặc thiếu số tài khoản; xuất file không chuyển trạng thái đã thanh toán |
| US-25 | Là **KT**, tôi muốn xem quỹ lương hợp nhất của cả 4 cơ sở, để báo cáo lãnh đạo | Bảng so sánh theo cơ sở: số lao động, quỹ lương, tỷ trọng OT, chi phí bình quân; xuất Excel / PDF |

### Admin (AD)

| Mã | User story | AC chính |
|---|---|---|
| US-26 | Là **AD**, tôi muốn thêm tham số pháp lý mới có ngày hiệu lực, để kỳ sau tự áp mức mới mà kỳ đã khóa không đổi | Đóng hiệu lực bản cũ; chồng lấn → báo lỗi chỉ ra bản ghi; ghi nhật ký |
| US-27 | Là **AD**, tôi muốn mở kỳ công, kỳ lương cho từng cơ sở, để các bộ phận bắt đầu nhập liệu | Kỳ trước cùng loại, cùng phạm vi chưa khóa → không cho mở; không trùng kỳ |
| US-28 | Là **AD**, tôi muốn tải tệp chấm công của cơ sở và nhận ngay kết quả kiểm tra, để sửa lỗi sớm | Tệp lỗi → danh sách dòng lỗi, không ghi dữ liệu; hợp lệ → số bản ghi, số ngày ngoại lệ |
| US-29 | Là **AD**, tôi muốn cấp tài khoản và gán vai trò kèm đơn vị phạm vi, để mỗi người chỉ thấy dữ liệu mình phụ trách | Vai trò ∈ {TT, QĐ, KT, AD}; phạm vi phù hợp vai trò; ghi nhật ký |
| US-30 | Là **AD**, tôi muốn xem nhật ký kiểm toán nhưng không sửa được, để phục vụ điều tra nội bộ | Giao diện chỉ đọc; thao tác sửa / xóa không tồn tại; AD không xem được lương chi tiết |

---

## 4. Ma trận kiểm thử chấp nhận (UAT)

| Mã | Kịch bản kiểm thử | Dữ liệu thử nghiệm | Kết quả kỳ vọng |
|---|---|---|---|
| **UAT-01** | Phát hành phiếu lương bảo mật | KT xuất phiếu lương kỳ 08/2026 đã khóa | Mỗi người một PDF có mật khẩu; kỳ chưa khóa → không xuất được; audit log ghi lần xuất |
| **UAT-02** | Ghép cặp ca đêm bắc cầu và phụ cấp đêm 30% | Log ca C: Vào 21:40 ngày T · Ra 06:15 ngày T+1 | **1 công ngày T**; cộng thêm 30% đơn giá cho 8 giờ đêm 22:00–06:00 |
| **UAT-03** | OT ca đêm ngày nghỉ tuần 270% | Ca C vào Chủ nhật, 2 giờ OT | Áp hệ số **270%**; cảnh báo đỏ nếu lương HĐLĐ < 5.310.000 (Vùng I) |
| **UAT-04** | Ghi vết sửa dữ liệu công | TT sửa giờ ra của công nhân, giờ OT từ 4 xuống 2 | Bắt buộc lý do, chứng cứ; lưu vết người sửa, thời điểm, 4h → 2h; **không ai sửa / xóa được nhật ký** |
| **UAT-05** | Chặn duyệt lương dưới lương tối thiểu vùng | 2 nhân sự NM Bắc Ninh lương HĐLĐ 5.000.000 | `CP-01` chặn duyệt, đánh dấu đỏ 2 dòng, dẫn chiếu NĐ 293/2025 |
| **UAT-05b** | Không chặn nhầm khi khác vùng | 1 nhân sự NM Hà Nam lương HĐLĐ 5.000.000 (Vùng II) | `CP-01` **không** chặn |
| **UAT-06** | Tách đoạn giờ OT qua nửa đêm và loại ngày | OT từ 20:00 thứ Bảy đến 02:00 Chủ nhật | Tách 3 đoạn: 150% / 210% / 270% |
| **UAT-07** | Chặn chốt xưởng khi còn ngày `ERR` | Kỳ công 09/2026 còn 12 ngày công `ERR` | `XC-09` chặn QĐ chốt, hiển thị 12 bản ghi |
| **UAT-08** | Chặn OT thiếu căn cứ đồng ý | TT đề xuất OT cho nhân sự chưa ký thỏa thuận | Chặn với `OT_CONSENT_MISSING`, nêu mức phạt 40–50 triệu |
| **UAT-09** | Vượt trần OT không duyệt được | Công nhân đã có 39 giờ OT trong tháng, đề xuất thêm 3 giờ | Cảnh báo ở 36h trở lên; QĐ **không duyệt được** đề xuất làm tổng vượt 40h |
| **UAT-10** | Bảng lương về nháp khi dữ liệu thay đổi | KT đã duyệt bảng lương, sau đó sửa một khoản phụ cấp | Bảng lương về **Nháp**, phải duyệt lại; ghi nhật ký |
| **UAT-11** | Hồi tố sau khi kỳ đã khóa | Quyết định tăng lương hiệu lực 01/08/2026 nhập ngày 05/10/2026; kỳ 08, 09 đã khóa | Bảng chênh lệch kỳ 08, 09; KT xác nhận → bút toán truy lĩnh vào kỳ 10/2026; số liệu kỳ 08, 09 **không đổi** |
| **UAT-12** | Tính lại kỳ cũ với tham số cũ | Chạy lại kỳ 12/2025 vào tháng 02/2026 | Ra mức lương tối thiểu và biểu thuế **của năm 2025** |
| **UAT-13** | Gross-up lương NET | Nhân sự thỏa thuận NET 20.000.000 | Thực lĩnh khớp NET với sai số ≤ **1 đồng** |
| **UAT-14** | Phân quyền theo tổ | Tài khoản TT Tổ SMT-1 truy vấn bảng công tháng | Chỉ trả về nhân sự Tổ SMT-1 tại kỳ đó |
| **UAT-15** | Exclusion list | Tài khoản KT phạm vi `ALL` bị áp exclusion list tìm hồ sơ Ban Giám đốc | Trả về **kết quả rỗng**, không trả lỗi 403 |
| **UAT-16** | Nhập tệp chấm công | (a) Tệp có 3 dòng sai mã NV; (b) nhập lại cùng một tệp hợp lệ hai lần | (a) Từ chối lô, liệt kê 3 dòng lỗi, không ghi dữ liệu; (b) không tạo bản ghi trùng |
| **UAT-17** | Nghỉ phép có ngày lễ xen giữa | TT ghi nhận đơn nghỉ 5 ngày có 1 ngày lễ | Trừ **4 ngày** quỹ phép; ngày lễ ghi `L` |
| **UAT-18** | Chặn khấu trừ vượt 30% NET | Nhân sự có khoản bồi thường vượt 30% thực lĩnh | `CP-04` chặn, đề xuất giãn khấu trừ sang các kỳ sau |
| **UAT-19** | Snapshot bất biến | Khóa kỳ công 09/2026 rồi truy vấn lại sau khi đổi thuật toán | Trả về dữ liệu từ **snapshot**, mã băm không đổi |
| **UAT-20** | Bằng chứng tuân thủ | Khóa kỳ lương 09/2026 | Lưu kết quả 9 kiểm tra `CP-01`…`CP-09`; kết xuất PDF |
| **UAT-21** | Điều chuyển liên tỉnh giữa kỳ | NV chuyển từ NM Bắc Ninh (Vùng I) sang NM Nghệ An (Vùng III) ngày 10 | Tách 2 đoạn, mỗi đoạn so mức vùng riêng; chi phí phân bổ 2 cost center; phiếu lương ghi rõ đơn vị và số công từng đoạn |
| **UAT-22** | Phân quyền theo cơ sở | Tài khoản QĐ phân xưởng NM Hà Nam truy vấn bảng công toàn công ty | Chỉ trả về nhân sự phân xưởng mình; không thấy Bắc Ninh hay Nghệ An |
| **UAT-23** | Cấu hình ca riêng theo cơ sở | TT xếp ca cho tổ ở NM Nghệ An (chế độ 2 ca) | Chỉ hiển thị ca A và B; giao diện chỉ rõ chính sách đến từ cơ sở NM-NA |
| **UAT-24** | Mở kỳ khi kỳ trước chưa khóa | AD mở kỳ công 10/2026 khi kỳ 09/2026 cùng cơ sở chưa khóa | Từ chối với `PREV_PERIOD_NOT_LOCKED` |
| **UAT-25** | Đơn nghỉ một cấp duyệt | TT duyệt đơn nghỉ 5 ngày | Đơn Đã duyệt cấp 1, không chuyển QĐ; QĐ chỉ thấy trong tỷ lệ vắng mặt |
| **UAT-26** | Thuế TNCN kỳ 2026 | Thu nhập tính thuế 45 triệu/tháng, 1 người phụ thuộc | Giảm trừ 15,5 + 6,2 triệu; áp bậc 3 (20%) của biểu 5 bậc |
| **UAT-27** | Chấm dứt hợp đồng | KT lập quyết định chấm dứt, chưa xác nhận | Hiển thị trợ cấp, tiền phép chưa nghỉ, danh sách báo giảm; chưa xác nhận → dữ liệu HĐ không đổi; xác nhận → trợ cấp vào kỳ lương gần nhất, một lần duy nhất |
| **UAT-28** | Cấp phát phúc lợi trùng | Xác nhận cấp quà Tết cho nhân viên đã được cấp cùng kỳ | Báo khoản cần kiểm tra lại, không ghi nhận lần hai |

---

## 5. Định nghĩa Hoàn thành (Definition of Done)

Một user story chỉ được coi là hoàn thành khi đủ **tất cả** các điều kiện:

| ☐ | Điều kiện |
|---|---|
| ☐ | Toàn bộ AC được cài đặt và kiểm chứng |
| ☐ | Có unit test và integration test cho mọi nhánh nghiệp vụ, kể cả tình huống biên |
| ☐ | Với story liên quan tính toán: có test đối chiếu với **bảng quy đổi trong văn bản pháp luật** |
| ☐ | Mọi thao tác ghi dữ liệu đã có audit log đầy đủ trường bắt buộc |
| ☐ | Đã kiểm tra phân quyền theo vai trò và đơn vị phạm vi |
| ☐ | Không dùng float cho bất kỳ giá trị tiền tệ nào |
| ☐ | Không hardcode giá trị pháp lý |
| ☐ | Màn hình drill-down hoạt động (với story thuộc phân hệ 7) |
| ☐ | Luồng khớp activity diagram và sequence diagram tương ứng |
| ☐ | UAT đã được nghiệm thu bởi người dùng nghiệp vụ tương ứng (TT, QĐ, KT hoặc AD) |
| ☐ | Tài liệu hướng dẫn sử dụng đã cập nhật |
