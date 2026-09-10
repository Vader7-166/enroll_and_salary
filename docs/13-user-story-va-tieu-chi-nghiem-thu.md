# 13. User story và tiêu chí nghiệm thu

## 1. Phương pháp

### 1.1. Cấu trúc user story

```
Là một [VAI TRÒ]
tôi muốn [HÀNH ĐỘNG / TÍNH NĂNG]
để [GIÁ TRỊ / LỢI ÍCH]
```

Mỗi story đi kèm **Tiêu chí chấp nhận (Acceptance Criteria — AC)** làm thước đo để QA viết
test case và người dùng cuối nghiệm thu (UAT).

### 1.2. Bốn bước xây dựng user story

| Bước | Phương pháp | Giá trị đạt được |
|---|---|---|
| **1. Phân tích tác nhân** | Liệt kê và phân loại toàn bộ vai trò tiếp xúc với hệ thống | C1 cần giao diện kiosk tối giản; B2 cần duyệt nhanh; A3/D2 cần bảng tính chi tiết; D4 cần biểu đồ trực quan |
| **2. Vẽ bản đồ hành trình** | Vẽ luồng liên tục từ đầu tháng đến cuối tháng | Phát hiện lỗ hổng tính năng dọc theo chu trình |
| **3. Áp bộ lọc INVEST** | Independent · Negotiable · Valuable · Estimable · Small · Testable | Bảo đảm story triển khai và kiểm thử được |
| **4. Hội ý Ba Bên** | Nghiệp vụ (HR/C&B/Kế toán) — Dev — QA họp trước khi viết mã | Phát hiện tình huống biên (nghỉ ốm giữa giờ, quên quẹt ca kíp, OT qua đêm trùng ngày lễ) |

### 1.3. Bản đồ hành trình tháng

```
Đầu tháng phân ca xoay kíp → Hằng ngày quẹt thẻ FaceID/vân tay → Đăng ký tăng ca OT
   → Khai báo nghỉ phép → Quản lý duyệt đơn → Cuối tháng khóa bảng công
      → Chạy tính lương, bảo hiểm, thuế → Phê duyệt bảng lương
         → Gửi phiếu lương Payslip xác thực OTP → Chuyển khoản lương qua Bank Hub
```

---

## 2. User story cốt lõi

### US-01 · Xem phiếu lương điện tử bảo mật (ESS)

> **Là một** Công nhân trực tiếp sản xuất (C1),
> **tôi muốn** xem phiếu lương chi tiết hằng tháng trên ứng dụng di động hoặc kiosk tại xưởng
> và phải xác thực danh tính trước khi xem,
> **để** tôi hiểu rõ các khoản thu nhập thực lĩnh và số giờ tăng ca ngày/đêm của mình, đồng
> thời bảo đảm thông tin thu nhập cá nhân không bị rò rỉ.

**Tiêu chí chấp nhận:**

| Mã | Tiêu chí |
|---|---|
| **AC 1.1** | Phiếu lương hiển thị rõ từng mục: lương cơ bản theo HĐLĐ · số ngày công thực tế · tổng giờ OT ban ngày · tổng giờ OT ca đêm · các khoản phụ cấp (chống độc, ca đêm, chuyên cần) · BHXH 8% / BHYT 1,5% / BHTN 1% · thuế TNCN bị khấu trừ · **số thực lĩnh** |
| **AC 1.2** | Khi bấm xem phiếu lương, hệ thống **bắt buộc** hiển thị màn hình khóa yêu cầu mã PIN, vân tay hoặc FaceID. Không hiển thị thông tin lương trên thông báo chung (NĐ 13/2023) |
| **AC 1.3** | Có nút **"Phản hồi sai lệch"**; bấm vào mở biểu mẫu nhập ý kiến và tự động tạo phiếu yêu cầu giải trình gửi thẳng tới tài khoản Chuyên viên tiền lương (A3) |
| **AC 1.4** | Trên kiosk dùng chung, phiên tự đăng xuất sau **60 giây** không thao tác |
| **AC 1.5** | Mọi lần mở phiếu lương ghi audit log: `VIEW_SENSITIVE`, thời điểm, IP, phương thức xác thực |

**Liên kết:** FR-13.4, FR-13.5, FR-13.6 · [09 §3.3](09-phan-quyen-va-bao-mat.md)

---

### US-02 · Phân ca và duyệt công ca đêm bắc cầu (MSS)

> **Là một** Quản lý phân xưởng (B2),
> **tôi muốn** hệ thống tự động nhận diện và gom dữ liệu quẹt thẻ của công nhân làm ca đêm
> bắc cầu qua ngày hôm sau về đúng ngày bắt đầu làm việc,
> **để** tôi duyệt bảng chấm công chính xác, nhanh chóng và không bị trùng lặp công.

**Tiêu chí chấp nhận:**

| Mã | Tiêu chí |
|---|---|
| **AC 2.1** | Với ca C (22:00 ngày T → 06:00 ngày T+1): khi công nhân quẹt "Vào" trong khung **21:30 – 22:15 ngày T** và quẹt "Ra" trong khung **05:45 – 06:30 ngày T+1**, hệ thống tự động ghép cặp và ghi nhận **01 ngày công cho ngày T** — không ghi lẻ tẻ hai ngày, không báo lỗi |
| **AC 2.2** | Hệ thống tự động tách số giờ làm việc nằm trong khung **22:00 – 06:00** để tính phụ cấp ban đêm cộng thêm **ít nhất 30%** tiền lương ngày thường (Điều 98 BLLĐ 2019) |
| **AC 2.3** | Khi chỉ có một lượt quẹt (quên Vào hoặc quên Ra), hệ thống gán nhãn **"Lỗi quẹt thẻ" (`ERR`)** và hiển thị **cảnh báo màu cam** trên màn hình quản lý phân xưởng để duyệt công bổ sung sau khi công nhân nộp giải trình |
| **AC 2.4** | Ca C bắt đầu **22:00 ngày 25** (ngày cut-off) thuộc trọn kỳ công cũ, không bị cắt đôi giữa hai kỳ |
| **AC 2.5** | Ca C vắt từ ngày thường sang **ngày lễ**: vẫn là 1 ngày công của ngày thường, nhưng đoạn giờ sau 00:00 được áp hệ số ngày lễ |

**Liên kết:** FR-05.6, FR-05.7, BR-13, BR-24 · [05 §3, §4](05-thuat-toan-cham-cong-va-tinh-luong.md)

---

### US-03 · Tính lương tự động tích hợp đa tầng (HR)

> **Là một** Chuyên viên tiền lương C&B (A3),
> **tôi muốn** hệ thống tự động tính lương thời gian, phụ cấp ca kíp, áp ma trận hệ số tăng
> ca đêm đa tầng và mức lương tối thiểu vùng mới nhất,
> **để** tôi hoàn thành bảng lương cho hàng trăm lao động đúng hạn, chính xác tuyệt đối và
> loại bỏ rủi ro pháp lý cho doanh nghiệp.

**Tiêu chí chấp nhận:**

| Mã | Tiêu chí |
|---|---|
| **AC 3.1** | Khi chạy bảng lương, hệ thống tự động đối chiếu lương HĐLĐ và lương đóng BH của toàn bộ nhân sự với lương tối thiểu vùng I 2026 (**5.310.000 VND/tháng**). Phát hiện trường hợp thấp hơn → **chặn lại**, đánh dấu đỏ, dẫn chiếu NĐ 293/2025 và mức phạt tương ứng |
| **AC 3.2** | Hệ thống áp đúng ma trận hệ số OT ban đêm theo Điều 57 NĐ 145/2020: OT đêm ngày thường **200%** (chưa OT ngày) / **210%** (đã OT ngày) · nghỉ hằng tuần **270%** · lễ Tết **390%** |
| **AC 3.3** | Hệ thống tự động trích BHXH 8% / BHYT 1,5% / BHTN 1% trên mức lương đóng BH **đã áp trần**, rồi tính thuế TNCN theo giảm trừ gia cảnh (bản thân + người phụ thuộc) và **biểu lũy tiến 7 bậc** |
| **AC 3.4** | Hệ số OT là **kết quả tính** từ công thức 3 số hạng: nâng hệ số OT ngày thường lên 160% trong tham số thì hệ số OT đêm tự động thành **212%** |
| **AC 3.5** | Chạy tính lương hai lần trên cùng dữ liệu cho **kết quả trùng khớp tuyệt đối** (idempotent) |
| **AC 3.6** | Mỗi dòng lương drill-down được: số tiền → công thức → giá trị từng biến → tham số → dữ liệu công gốc |

**Liên kết:** FR-08.2, FR-08.15, FR-08.16, FR-06.4, FR-09.2, FR-10.5

---

### US-04 · Kiểm soát thay đổi và tuân thủ chậm trả lương (Kế toán trưởng)

> **Là một** Kế toán trưởng (D2),
> **tôi muốn** hệ thống ghi lại toàn bộ nhật ký chỉnh sửa công lương thủ công và tự động tính
> đền bù lãi suất khi doanh nghiệp trả chậm lương quá thời hạn,
> **để** tôi kiểm soát tính minh bạch của số liệu, ngăn trục lợi nội bộ và bảo đảm doanh
> nghiệp không bị xử lý hành chính theo NĐ 283/2026.

**Tiêu chí chấp nhận:**

| Mã | Tiêu chí |
|---|---|
| **AC 4.1** | Mọi can thiệp thủ công vào dữ liệu công, hệ số lương, phụ cấp hay thưởng đều **bắt buộc nhập "Lý do thay đổi"**. Hệ thống ghi vết: ID người sửa · thời điểm · giá trị cũ · giá trị mới · IP · lý do |
| **AC 4.2** | Nhật ký kiểm toán là **chỉ đọc**, **không thể bị sửa, xóa hay ghi đè bởi bất kỳ quyền năng nào kể cả quản trị viên hệ thống** — quyền UPDATE/DELETE bị thu hồi ở tầng CSDL, có chuỗi băm liên kết |
| **AC 4.3** | Dashboard hiển thị **cảnh báo đỏ** khi sắp đến hạn chi lương định kỳ mà bảng thanh toán chưa duyệt xong |
| **AC 4.4** | Chậm trả lương quá **15 ngày** → hệ thống tự tính tiền đền bù cộng trực tiếp vào lương: `Tiền đền bù = Lương chậm trả × Số ngày chậm × (Lãi suất không kỳ hạn cao nhất của 4 NHTM Nhà nước ÷ 365)` (Khoản 4 Điều 97 BLLĐ 2019) |
| **AC 4.5** | Chậm **dưới 15 ngày** không phát sinh đền bù, nhưng vẫn ghi nhận và cảnh báo |
| **AC 4.6** | Lãi suất lấy từ tham số `LATE_PAYMENT_RATE` theo khoảng hiệu lực, **không hardcode** |

**Liên kết:** FR-16.3, FR-16.4, FR-08.19, FR-08.20 · [09 §4](09-phan-quyen-va-bao-mat.md)

---

## 3. User story bổ sung theo actor

### Nhóm C — Người lao động

| Mã | User story | AC chính |
|---|---|---|
| US-05 | Là **C1**, tôi muốn xem bảng công cá nhân theo ngày trên kiosk, để đối chiếu trước khi chốt công | Hiển thị ký hiệu công từng ngày, giờ vào/ra, giờ OT; đánh dấu ngày `ERR` |
| US-06 | Là **C1**, tôi muốn nộp đơn giải trình quên chấm công ngay trên kiosk, để không bị mất công | Đơn tạo được trong ≤ 3 thao tác; theo dõi được trạng thái duyệt |
| US-07 | Là **C1**, tôi muốn xem số dư phép và nộp đơn nghỉ, để chủ động sắp xếp | Kiểm tra số dư khi nộp; cảnh báo nếu vượt tỷ lệ vắng đồng thời của tổ |
| US-08 | Là **C2**, tôi muốn đăng ký người phụ thuộc kèm chứng từ, để được giảm trừ gia cảnh | Đăng ký theo **tháng hiệu lực**; qua luồng duyệt của A4 |
| US-09 | Là **C2**, tôi muốn tải chứng từ khấu trừ thuế TNCN, để tự quyết toán | Chứng từ điện tử có số seri |

### Nhóm B — Quản lý sản xuất

| Mã | User story | AC chính |
|---|---|---|
| US-10 | Là **B1**, tôi muốn xếp ca cho tổ theo chu kỳ xoay tuần và sao chép lịch tháng trước, để không phải nhập lại | Mỗi người đủ 3 loại ca/tháng; hệ thống chặn vi phạm ràng buộc nghỉ giữa ca |
| US-11 | Là **B1**, tôi muốn xác nhận công thực tế của tổ trước khi chốt, để chịu trách nhiệm về số liệu | Không chốt được kỳ công khi còn tổ chưa xác nhận |
| US-12 | Là **B2**, tôi muốn thấy lũy kế OT của từng công nhân so với trần luật, để không huy động vượt phép | Cảnh báo khi chạm 90% trần tháng; **chặn** khi vượt |
| US-13 | Là **B2**, tôi muốn duyệt đơn OT ngay trên điện thoại tại xưởng, để không làm chậm sản xuất | Duyệt được trong ≤ 2 thao tác; đơn quá 12 giờ tự hủy |

### Nhóm A — Vận hành nhân sự

| Mã | User story | AC chính |
|---|---|---|
| US-14 | Là **A1**, tôi muốn nhập bù công hàng loạt khi máy chấm công hỏng cả ngày, để không phải sửa từng người | Nhập theo tổ, kèm biên bản sự cố, ghi audit log từng bản ghi |
| US-15 | Là **A1**, tôi muốn hệ thống liệt kê toàn bộ vi phạm đối soát chéo trước khi chốt công, để xử lý hết ngoại lệ | Hiển thị `XC-01`…`XC-10` kèm liên kết xử lý từng bản ghi |
| US-16 | Là **A2**, tôi muốn nhận cảnh báo hợp đồng sắp hết hạn và đã ký đủ 2 lần HĐ xác định thời hạn, để không vi phạm luật | Cảnh báo 30/60 ngày; cảnh báo lần ký thứ 3 buộc chuyển HĐ không xác định thời hạn |
| US-17 | Là **A3**, tôi muốn chạy dry-run và so sánh chênh lệch với kỳ trước, để phát hiện bất thường trước khi chốt | Liệt kê nhân sự biến động vượt ngưỡng; mỗi dòng phải được xác nhận |
| US-18 | Là **A4**, tôi muốn đối chiếu số liệu BHXH với thông báo C12, để phát hiện chênh lệch sớm | Liệt kê chênh lệch theo từng nhân sự; sinh khoản điều chỉnh kỳ sau |

### Nhóm D, E

| Mã | User story | AC chính |
|---|---|---|
| US-19 | Là **D1**, tôi muốn kết xuất tệp Bank Hub đúng định dạng ngân hàng, để chi lương không phải nhập tay | Chặn kết xuất khi tổng tệp ≠ tổng bảng lương hoặc thiếu số tài khoản |
| US-20 | Là **D3**, tôi muốn xem dashboard chi phí lao động theo xưởng, để kiểm soát giá thành | Chi phí theo cost center, so ngân sách, xu hướng 12 kỳ |
| US-21 | Là **E1**, tôi muốn đối chiếu danh sách đoàn viên và đoàn phí, để bảo đảm thu đúng | Danh sách đoàn viên, đoàn phí 1% có trần, so với số đã trích |
| US-22 | Là **E2**, tôi muốn xem nhật ký kiểm toán nhưng không sửa được, để phục vụ điều tra nội bộ | Giao diện chỉ đọc; thao tác sửa/xóa không tồn tại trong hệ thống |

---

## 4. Ma trận kiểm thử chấp nhận (UAT)

| Mã | Kịch bản kiểm thử | Dữ liệu thử nghiệm | Kết quả kỳ vọng |
|---|---|---|---|
| **UAT-01** | Mở phiếu lương bảo mật (NĐ 13/2023) | Tài khoản công nhân bấm xem phiếu lương tháng 08/2026 | Hiển thị màn hình khóa yêu cầu FaceID/vân tay hoặc PIN. Chỉ khi xác thực đúng mới hiển thị bảng phân tách lương chi tiết |
| **UAT-02** | Ghép cặp ca đêm bắc cầu và phụ cấp đêm 30% | Log ca C: Vào 21:40 ngày T · Ra 06:15 ngày T+1 | Ghép thành **1 công ngày T** hoàn chỉnh; cộng thêm 30% đơn giá cho 8 giờ làm việc đêm 22:00–06:00 |
| **UAT-03** | OT ca đêm ngày nghỉ tuần lũy tiến 270% | Công nhân tăng ca đêm ca C vào Chủ nhật, 2 giờ | Áp hệ số **270%** lương giờ ngày thường cho 2 giờ; cảnh báo đỏ nếu lương HĐLĐ < 5.310.000 |
| **UAT-04** | Ghi vết audit log sửa dữ liệu công thủ công | HR sửa giờ OT của công nhân từ 4 giờ xuống 2 giờ | Bắt buộc nhập lý do; lưu vết (người sửa, giờ sửa, 4h → 2h, lý do); **không ai sửa/xóa được nhật ký này** |
| **UAT-05** | Chặn chốt lương khi dưới lương tối thiểu vùng | 2 nhân sự lương HĐLĐ 5.000.000 tại vùng I | `CP-01` chặn chuyển sang duyệt, đánh dấu đỏ 2 dòng, hiển thị dẫn chiếu NĐ 293/2025 và mức phạt theo quy mô |
| **UAT-06** | Tách đoạn giờ OT qua nửa đêm và qua loại ngày | OT từ 20:00 thứ Bảy đến 02:00 Chủ nhật | Tách 3 đoạn: 150% / 210% / 270% |
| **UAT-07** | Chặn chốt công khi còn ngày `ERR` | Kỳ công 09/2026 còn 12 ngày công `ERR` | `XC-09` chặn chốt, hiển thị danh sách 12 bản ghi kèm liên kết xử lý |
| **UAT-08** | Chặn OT không có văn bản đồng ý | Đăng ký OT cho nhân sự chưa ký thỏa thuận | Chặn với mã `OT_CONSENT_MISSING`, nêu mức phạt 40–50 triệu |
| **UAT-09** | Cảnh báo và chặn vượt trần OT | Công nhân đã có 39 giờ OT trong tháng, đăng ký thêm 3 giờ | Cảnh báo tại 39h; **chặn** khi tổng vượt 40h, yêu cầu phê duyệt ghi đè |
| **UAT-10** | Hủy phê duyệt khi dữ liệu thay đổi | A5 đã duyệt cấp 1, A3 sửa một khoản phụ cấp làm đổi tổng tiền | Hệ thống hủy phê duyệt cấp 1, đưa về chờ duyệt lại, thông báo tới người đã duyệt kèm nội dung thay đổi |
| **UAT-11** | Điều chỉnh sau khi kỳ đã khóa | Phát hiện tính thiếu 500.000 VND ở kỳ 09/2026 đã chi trả | Tạo khoản truy lĩnh 500.000 vào kỳ 10/2026; payslip kỳ 10 có dòng riêng ghi rõ **kỳ gốc và lý do** |
| **UAT-12** | Tính lại kỳ cũ với tham số cũ | Chạy lại kỳ 12/2025 vào tháng 02/2026 | Ra mức lương tối thiểu **của năm 2025**, không phải 2026 |
| **UAT-13** | Gross-up lương NET | Nhân sự thỏa thuận NET 20.000.000 | Thực lĩnh khớp NET với sai số ≤ **1 đồng** |
| **UAT-14** | Phân quyền theo phạm vi dữ liệu | Tài khoản `LINE_LEADER` Tổ SMT truy vấn bảng công tháng | Chỉ trả về nhân sự Tổ SMT tại kỳ đó; không trả bản ghi tổ khác kể cả cùng phân xưởng |
| **UAT-15** | Exclusion list | Tài khoản `HR_RECORDS` phạm vi `ALL` bị áp exclusion list tìm hồ sơ thành viên Ban Giám đốc | Trả về **kết quả rỗng**, không trả lỗi 403 |
| **UAT-16** | Đồng bộ bù sau mất kết nối | Ngắt mạng máy chấm công 4 giờ rồi khôi phục | Toàn bộ lượt quẹt trong 4 giờ được đồng bộ bù, không bỏ sót, không tạo bản ghi trùng |
| **UAT-17** | Nghỉ phép có ngày lễ xen giữa | Đơn nghỉ 5 ngày, trong đó có 1 ngày lễ | Trừ **4 ngày** quỹ phép; ngày lễ ghi ký hiệu `L` |
| **UAT-18** | Chặn khấu trừ vượt 30% NET | Nhân sự có khoản bồi thường vượt 30% thực lĩnh | `CP-04` chặn, đề xuất giãn khấu trừ sang các kỳ sau |
| **UAT-19** | Kiểm chứng snapshot bất biến | Khóa kỳ công 09/2026 rồi truy vấn lại sau khi thay đổi thuật toán | Truy vấn trả về dữ liệu từ **snapshot**, mã băm không đổi |
| **UAT-20** | Kết xuất bằng chứng tuân thủ | Khóa kỳ lương 09/2026 | Lưu kết quả toàn bộ 9 kiểm tra `CP-01`…`CP-09` tại thời điểm khóa; kết xuất được ra PDF |

---

## 5. Định nghĩa Hoàn thành (Definition of Done)

Một user story chỉ được coi là hoàn thành khi đủ **tất cả** các điều kiện:

| ☐ | Điều kiện |
|---|---|
| ☐ | Toàn bộ AC được cài đặt và kiểm chứng |
| ☐ | Có unit test và integration test cho mọi nhánh nghiệp vụ, kể cả tình huống biên |
| ☐ | Với story liên quan tính toán: có test đối chiếu với **bảng quy đổi trong văn bản pháp luật** |
| ☐ | Mọi thao tác ghi dữ liệu đã có audit log đầy đủ trường bắt buộc |
| ☐ | Đã áp đủ hai trục phân quyền (vai trò + phạm vi dữ liệu) |
| ☐ | Không dùng float cho bất kỳ giá trị tiền tệ nào |
| ☐ | Không hardcode giá trị pháp lý |
| ☐ | Màn hình drill-down hoạt động (với story thuộc module lương) |
| ☐ | UAT đã được nghiệm thu bởi người dùng nghiệp vụ tương ứng |
| ☐ | Tài liệu hướng dẫn sử dụng đã cập nhật |
