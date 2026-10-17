# 01. Tổng quan và phạm vi dự án

## 1. Bối cảnh

Doanh nghiệp là công ty sản xuất linh kiện điện tử, quy mô **1.500 – 3.000 lao động**, vận
hành trên **bốn địa điểm thuộc ba vùng lương tối thiểu**: trụ sở Hà Nội (Vùng I), nhà máy
Bắc Ninh (Vùng I), nhà máy Hà Nam (Vùng II) và nhà máy Nghệ An (Vùng III). Chi tiết cơ cấu:
xem [03. Cơ cấu tổ chức và hệ thống chức danh](03-co-cau-to-chuc.md).

Toàn bộ công tác chấm công và tính lương hiện đang thực hiện thủ công trên Excel với ba biểu
mẫu: bảng chấm công tháng, bảng lương tự động và sổ quản lý lao động — mỗi nhà máy giữ một
bộ file riêng, hợp nhất thủ công về trụ sở.

Đặc thù vận hành khiến quy trình thủ công không còn kiểm soát được:

| Đặc thù | Hệ quả với quy trình Excel |
|---|---|
| 3 ca xoay vòng 24/7, ca đêm bắc cầu qua ngày | Một ca bị tách thành hai ngày lẻ, sai số ngày công |
| OT lũy tiến đa tầng 200% / 210% / 270% / 390% | Công thức Excel hiện dùng cứng một hệ số 2.1 cho mọi loại ngày |
| Kỳ công 26 → 25 lệch với kỳ chi lương ngày 10 | Không mô hình hóa được hai kỳ độc lập trên cùng một bảng tính |
| Quy mô 301+ lao động | Mỗi sai sót công thức nhân lên theo đầu người |

Từ **10/09/2026**, Nghị định 283/2026/NĐ-CP nâng khung phạt hành chính lên tới
**150.000.000 VND** cho các lỗi trả dưới lương tối thiểu vùng, huy động OT quá trần, trả
chậm lương hoặc trừ lương thay kỷ luật. Bối cảnh này chuyển yêu cầu của hệ thống từ
*"tính đúng số"* sang *"chứng minh được là đúng"*.

## 2. Vấn đề cần giải quyết

| Mã | Vấn đề hiện tại | Tác động |
|---|---|---|
| P-01 | Ghép cặp quẹt thẻ và gán ca đêm bắc cầu làm thủ công | Sai ngày công, tranh chấp với người lao động |
| P-02 | Công thức OT không phản ánh ma trận hệ số theo loại ngày | Trả thiếu lương làm thêm giờ — hành vi bị xử phạt |
| P-03 | Thuế TNCN trên file mẫu chỉ có 3 bậc, không theo biểu lũy tiến hiện hành (7 bậc đến 2025, 5 bậc từ kỳ tính thuế 2026) | Sai quyết toán thuế cá nhân và pháp nhân |
| P-04 | Bảo hiểm tính trên lương HĐLĐ, không áp trần đóng | Sai số liệu nộp BHXH, phát sinh truy thu |
| P-05 | Phụ cấp ca đêm tính ước lượng `0,3 × 8 × (công ÷ 2)` | Không dựa trên giờ đêm thực tế, không giải trình được |
| P-06 | Không có nhật ký thay đổi | Không có bằng chứng khi thanh tra, không chống được gian lận nội bộ |
| P-07 | Tổ trưởng không có công cụ xác nhận công và giải trình ngoại lệ có lưu vết | Khiếu nại công dồn về kế toán cuối mỗi kỳ, không truy được ai sửa gì |
| P-08 | Không kiểm soát được trần OT theo ngày/tháng/năm | Rủi ro phạt tới 150 triệu và đình chỉ hoạt động tăng ca |
| P-09 | Mỗi nhà máy dùng một bộ file Excel riêng, hợp nhất thủ công về trụ sở | Số liệu ba nhà máy lệch nhau, không đối chiếu kịp trước hạn chi lương |
| P-10 | Áp mức lương tối thiểu vùng thủ công cho từng nhà máy | Nguy cơ áp nhầm vùng → trả dưới mức tối thiểu, phạt tới 150 triệu |

## 3. Mục tiêu

### 3.1. Mục tiêu nghiệp vụ

1. Tự động hóa toàn chuỗi: **dữ liệu chấm công nhập từ các cơ sở → bảng công tháng (tổ xác
   nhận, xưởng chốt, kế toán khóa) → bảng lương → phiếu lương và file chi lương → báo cáo**.
2. Rút ngắn thời gian chốt công – tính lương và loại bỏ thao tác nhập liệu lặp.
3. Đưa nghiệp vụ tại xưởng lên hệ thống: tổ trưởng xếp ca, đề xuất OT, ghi nhận đơn nghỉ và
   giải trình công cho công nhân của tổ; quản đốc duyệt lịch, duyệt OT và chốt công xưởng.
4. Cung cấp báo cáo quỹ lương, chi phí nhân công và phúc lợi theo cơ sở, đơn vị (10.3, 9.4).

### 3.2. Mục tiêu tuân thủ

1. Chặn vi phạm **ngay tại thời điểm thao tác**, không để phát hiện khi bị thanh tra.
2. Hồ sơ nhân viên (2.1) lưu đủ thông tin để kết xuất Sổ quản lý lao động theo Khoản 2 Điều 3
   NĐ 145/2020.
3. Lưu nhật ký kiểm toán bất biến cho mọi thay đổi công và lương.
4. Bảo vệ dữ liệu cá nhân theo NĐ 13/2023/NĐ-CP.

### 3.3. Mục tiêu kỹ thuật

1. Tham số hóa toàn bộ giá trị pháp lý theo khoảng hiệu lực — đổi chính sách không sửa mã.
2. Bộ máy công thức khai báo bằng dữ liệu cho cấu phần lương.
3. Tính lương **idempotent**: chạy lại cùng dữ liệu đầu vào cho cùng kết quả.
4. Truy vết ngược từ mỗi con số về công thức, tham số và lượt quẹt gốc.

## 4. Phạm vi

### 4.1. Đặc điểm doanh nghiệp đã chốt

| Tiêu chí | Giá trị |
|---|---|
| Loại hình | Công ty sản xuất linh kiện điện tử |
| Quy mô lao động | **1.500 – 3.000 người** (hiện tại ~2.200) |
| Địa điểm | **4**: trụ sở Hà Nội + 3 nhà máy (Bắc Ninh, Hà Nam, Nghệ An) — xem [03](03-co-cau-to-chuc.md) |
| Cơ cấu lao động | Khối trực tiếp ~75% (công nhân sản xuất, làm ca kíp); khối gián tiếp ~25% (văn phòng, kỹ thuật, kho, bảo vệ, bếp) |
| Chế độ ca — khối trực tiếp | NM Bắc Ninh và NM Hà Nam: 3 ca × 8h (A 06:00–14:00, B 14:00–22:00, C 22:00–06:00), xoay ca theo chu kỳ tuần. NM Nghệ An: 2 ca (A, B). Khai báo theo từng địa điểm |
| Chế độ ca — khối gián tiếp | Hành chính 8h/ngày, T2–T7 |
| Vùng lương tối thiểu | **3 vùng khác nhau**: Vùng I (Hà Nội, Bắc Ninh), Vùng II (Hà Nam), Vùng III (Nghệ An) — tham số hóa theo từng địa điểm, không hardcode |
| Kỳ công | Cut-off ngày 26 tháng trước → 25 tháng hiện tại |
| Kỳ chi lương | Ngày 10 tháng sau |
| Hình thức trả lương | Văn phòng: lương thời gian + phụ cấp. Sản xuất: lương thời gian / sản phẩm theo KPI + phụ cấp |
| Loại HĐLĐ | Không xác định thời hạn, xác định thời hạn, thử việc/thực tập, thời vụ/mùa vụ |
| Nghỉ giữa ca | 30 phút, tính vào giờ làm việc |

### 4.2. Trong phạm vi (10 phân hệ / 49 chức năng)

Phạm vi chức năng bám theo sơ đồ phân rã chức năng (BFD) tại
[`diagrams/BFD.png`](../diagrams/BFD.png). Hệ thống có **bốn tác nhân**: Tổ trưởng (**TT**),
Quản đốc (**QĐ**), Kế toán (**KT**), Admin (**AD**); hai chức năng 4.2 và 5.4 do hệ thống tự
thực hiện. **Công nhân không đăng nhập hệ thống** — họ là đối tượng dữ liệu (xem
[02](02-cac-ben-lien-quan-va-vai-tro.md)).

| # | Phân hệ | Chức năng (tác nhân) |
|---|---|---|
| 1 | Quản trị hệ thống | 1.1 Tài khoản, phân quyền theo đơn vị (AD) · 1.2 Cơ cấu tổ chức đa cấp, đa cơ sở (AD) · 1.3 Vùng lương, tham số pháp lý theo hiệu lực (AD) · 1.4 Cấu hình chính sách theo cơ sở (AD) · 1.5 Quản lý kỳ công, kỳ lương (AD, KT) · 1.6 Nhật ký kiểm toán (AD) |
| 2 | Hồ sơ và hợp đồng | 2.1 Hồ sơ nhân viên, người phụ thuộc · 2.2 Quản lý HĐLĐ và phụ lục · 2.3 Quyết định điều chuyển, thay đổi lương · 2.4 Cảnh báo hết hạn hợp đồng · 2.5 Chấm dứt hợp đồng (đều do KT) |
| 3 | Ca làm việc | 3.1 Định nghĩa ca, lịch nghỉ lễ (AD) · 3.2 Xếp ca, xoay ca cho tổ (TT) · 3.3 Đề xuất đổi ca (TT) · 3.4 Duyệt lịch ca toàn xưởng (QĐ) |
| 4 | Chấm công | 4.1 Tiếp nhận dữ liệu chấm công các cơ sở (AD) · 4.2 Ghép cặp vào/ra theo ca (Hệ thống) · 4.3 Xử lý ngoại lệ, giải trình công (TT) · 4.4 Xác nhận công thực tế (TT) · 4.5 Tổng hợp và chốt bảng công (QĐ, KT) |
| 5 | Làm thêm giờ | 5.1 Đề xuất OT (TT) · 5.2 Duyệt OT cấp 2 (QĐ) · 5.3 Kiểm soát trần OT (QĐ) · 5.4 Tính giờ OT theo hệ số (Hệ thống) · 5.5 Quy đổi nghỉ bù (KT) |
| 6 | Nghỉ phép và chế độ | 6.1 Danh mục loại nghỉ (AD) · 6.2 Quản lý quỹ phép năm (KT) · 6.3 Ghi nhận, duyệt đơn nghỉ cấp 1 (TT) · 6.4 Theo dõi ốm đau, thai sản (KT) · 6.5 Theo dõi tỷ lệ vắng mặt (QĐ) |
| 7 | Tính lương và thưởng | 7.1 Cấu hình cơ cấu lương, công thức · 7.2 Tính lương theo vùng, cơ sở · 7.3 Tính thưởng · 7.4 Truy lĩnh, truy thu · 7.5 Duyệt và khóa bảng lương · 7.6 Phiếu lương, file chi lương (đều do KT) |
| 8 | Bảo hiểm và thuế TNCN | 8.1 Mức đóng BH theo vùng (sàn, trần) · 8.2 Tính BHXH, BHYT, BHTN, KPCĐ · 8.3 Báo tăng, giảm BH · 8.4 Khấu trừ thuế TNCN · 8.5 Quyết toán thuế năm (đều do KT) |
| 9 | Phúc lợi | 9.1 Danh mục, điều kiện hưởng · 9.2 Cấp phát phúc lợi · 9.3 Trợ cấp thôi việc, mất việc · 9.4 Theo dõi chi phí phúc lợi (đều do KT) |
| 10 | Báo cáo, thống kê | 10.1 Công, OT theo tổ và xưởng (TT, QĐ) · 10.2 Biến động nhân sự (QĐ) · 10.3 Quỹ lương theo cơ sở, đơn vị (KT) · 10.4 Báo cáo BH, thuế (KT) |

Đặc tả chức năng chi tiết: [07](07-yeu-cau-chuc-nang.md). Tài liệu thiết kế UML: biểu đồ lớp
(`diagrams/class/`), activity diagram (`diagrams/activity/`), sequence diagram
(`diagrams/sequence/`), use case (`diagrams/usecase/`).

### 4.3. Ngoài phạm vi

| Hạng mục | Lý do |
|---|---|
| Cơ chế thu thập dữ liệu chấm công tại thiết bị (kết nối máy chấm công, sinh trắc học, GPS) | Hệ thống chỉ **tiếp nhận và xử lý** tệp dữ liệu chấm công do Admin nhập theo từng cơ sở (4.1) |
| Cổng tự phục vụ cho người lao động (ESS), kiosk, ứng dụng di động riêng | Công nhân không phải tác nhân của hệ thống; tổ trưởng thao tác thay, kế toán phát hành phiếu lương (7.6) |
| Thanh toán lương trực tiếp qua ngân hàng (Bank Hub, API ngân hàng) | Chỉ **xuất file chi lương** (7.6); xuất file không đồng nghĩa đã thanh toán |
| Phần mềm kế toán / ERP | Không thay thế, không kết nối trực tiếp; số liệu quỹ lương xuất qua báo cáo (10.3) |
| Kê khai điện tử trực tiếp lên cổng BHXH / thuế | Chỉ lập danh sách báo tăng, giảm (8.3) và dự thảo hồ sơ quyết toán thuế (8.5) |
| Bộ máy quy trình phê duyệt cấu hình tùy biến, ủy quyền, SLA | Luồng duyệt cố định theo BFD: QĐ duyệt lịch ca và OT, TT duyệt đơn nghỉ, KT duyệt và khóa bảng lương |
| Module tuyển dụng, đánh giá KPI, quản lý sản xuất | Chỉ nhận dữ liệu đầu vào cần cho tính lương |
| **Chức năng trừ lương do đi trễ / vi phạm nội quy** | **Bị cấm bởi Điều 127 BLLĐ 2019 — xem [12](12-tuan-thu-phap-ly.md)** |

## 5. Ràng buộc

### 5.1. Ràng buộc pháp lý

| Văn bản | Nội dung ràng buộc chính |
|---|---|
| Bộ luật Lao động 2019 (Luật 45/2019/QH14) | Điều 96 (nguyên tắc trả lương), 97 (kỳ hạn trả lương và lãi chậm trả), 98 (OT và làm đêm), 102 (khấu trừ lương), 105 (thời giờ làm việc), 127 (cấm phạt tiền thay kỷ luật), 129 (bồi thường thiệt hại) |
| NĐ 145/2020/NĐ-CP | Khoản 2 Điều 3 (20 tiêu chí sổ quản lý lao động), Điều 57 (công thức OT ban đêm), Điều 59 (trần giờ làm thêm) |
| NĐ 293/2025/NĐ-CP | Lương tối thiểu vùng 2026, hiệu lực 01/01/2026 |
| NĐ 283/2026/NĐ-CP | Xử phạt vi phạm hành chính lao động, hiệu lực 10/09/2026 |
| NĐ 13/2023/NĐ-CP | Bảo vệ dữ liệu cá nhân |
| NĐ 320/2025/NĐ-CP | Miễn thuế TNCN phần thu nhập chênh lệch do làm thêm giờ / làm đêm |
| Luật Thuế TNCN 109/2025/QH15 | Biểu thuế lũy tiến 5 bậc (5% – 35%) với thu nhập từ tiền lương, áp dụng từ kỳ tính thuế 2026 |
| NQ 110/2025/UBTVQH15 | Giảm trừ gia cảnh 15,5 triệu đồng/tháng (bản thân) và 6,2 triệu đồng/tháng (mỗi người phụ thuộc) từ kỳ tính thuế 2026 |

### 5.2. Ràng buộc vận hành

- **Công nhân không sử dụng hệ thống.** Mọi thao tác liên quan đến công nhân (ghi nhận đơn
  nghỉ, giải trình công, đề xuất OT) do tổ trưởng thực hiện; phiếu lương do kế toán xuất.
- **Mỗi nhà máy có máy chấm công riêng**, đặt tại xưởng và cổng nhà máy. Dữ liệu được Admin
  nhập vào hệ thống theo từng cơ sở dưới dạng tệp (4.1); hệ thống không kết nối trực tiếp
  với thiết bị.
- **Ba nhà máy nằm trên ba vùng lương tối thiểu khác nhau** — mức so sánh khi kiểm tra tuân
  thủ phải theo địa điểm của từng nhân sự, không dùng một mức chung.
- Điều chuyển nhân sự giữa các nhà máy khác tỉnh là nghiệp vụ thường xuyên, kéo theo thay đổi
  vùng lương tối thiểu và trung tâm chi phí giữa kỳ.
- Kỳ công và kỳ lương lệch nhau, các khối và các địa điểm có thể chốt công khác ngày.
- Giai đoạn chuyển đổi phải chạy song song với Excel tối thiểu 2 kỳ.

## 6. Thuật ngữ

| Thuật ngữ | Định nghĩa dùng trong toàn bộ tài liệu |
|---|---|
| **Ngày công** | Đơn vị nghiệp vụ gắn với **ca**, không gắn với ngày lịch. Một ca = một ngày công, gán về ngày bắt đầu ca |
| **Đoạn giờ** | Phần giờ làm việc sau khi tách theo mốc 22:00 / 06:00 / 00:00, dùng để áp hệ số |
| **Ngày T** | Ngày bắt đầu ca; ca C bắt đầu 22:00 ngày T kết thúc 06:00 ngày T+1 vẫn thuộc ngày T |
| **TT / QĐ / KT / AD** | Bốn tác nhân của hệ thống: Tổ trưởng, Quản đốc, Kế toán, Admin |
| **BFD** | Sơ đồ phân rã chức năng 10 phân hệ / 49 chức năng; mã chức năng dạng `1.1` … `10.4` dùng xuyên suốt tài liệu |
| **Kỳ nghiệp vụ** | Kỳ công hoặc kỳ lương của một phạm vi (cơ sở / đơn vị), trạng thái Mở → Đã chốt → Đã khóa; kỳ trước cùng loại, cùng phạm vi phải đã khóa mới mở được kỳ sau |
| **Kỳ công** (attendance period) | Chu kỳ chốt dữ liệu chấm công, ở đây 26 tháng trước → 25 tháng hiện tại |
| **Kỳ lương** (payroll period) | Chu kỳ tính và chi trả lương, chi ngày 10 tháng sau |
| **Cut-off** | Thời điểm khóa kỳ công, sau đó bảng công trở thành chỉ đọc |
| **Lương giờ thực trả** | Căn cứ tính OT và phụ cấp đêm; = lương tháng ÷ số giờ làm việc thực tế trong tháng |
| **Bẫy mẫu số** | Lỗi đưa ngày nghỉ lễ có hưởng lương vào mẫu số khi tính lương giờ, làm "pha loãng" đơn giá |
| **Gross-up** | Quy đổi ngược từ lương NET thỏa thuận sang lương GROSS |
| **Bảng lương nháp** | Kết quả tính lương chưa duyệt, có thể tính lại nhiều lần để đối chiếu trước khi KT duyệt và khóa |
| **Bút toán điều chỉnh** | Khoản truy lĩnh / truy thu phát sinh sau khi kỳ đã khóa, ghi vào kỳ đang mở; kỳ đã khóa giữ nguyên số liệu |
| **Snapshot** | Ảnh chụp bất biến của bảng công / bảng lương tại thời điểm khóa kỳ, kèm mã băm |
| **Formula engine** | Bộ máy tính toán theo công thức khai báo bằng dữ liệu, không viết cứng trong mã |
| **Cost center** | Trung tâm chi phí, dùng để hạch toán chi phí nhân công (TK 622 / TK 642) |
| **Cổng chặn tuân thủ** | Bộ kiểm tra `CP-01`…`CP-09` chạy như điều kiện chặn trước khi duyệt bảng lương |
| **Đối soát chéo** | Bộ quy tắc `XC-01`…`XC-10` chạy trước khi chốt bảng công |
