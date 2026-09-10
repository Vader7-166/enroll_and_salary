# 01. Tổng quan và phạm vi dự án

## 1. Bối cảnh

Doanh nghiệp là nhà máy sản xuất linh kiện điện tử, quy mô 300 – 1.000 lao động, gồm
**một trụ sở văn phòng và một nhà máy**. Toàn bộ công tác chấm công và tính lương hiện
đang thực hiện thủ công trên Excel với ba biểu mẫu: bảng chấm công tháng, bảng lương tự
động và sổ quản lý lao động.

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
| P-03 | Thuế TNCN trên file mẫu chỉ có 3 bậc thay vì 7 | Sai quyết toán thuế cá nhân và pháp nhân |
| P-04 | Bảo hiểm tính trên lương HĐLĐ, không áp trần đóng | Sai số liệu nộp BHXH, phát sinh truy thu |
| P-05 | Phụ cấp ca đêm tính ước lượng `0,3 × 8 × (công ÷ 2)` | Không dựa trên giờ đêm thực tế, không giải trình được |
| P-06 | Không có nhật ký thay đổi | Không có bằng chứng khi thanh tra, không chống được gian lận nội bộ |
| P-07 | Người lao động không tự tra cứu được công – lương | Khiếu nại dồn về phòng nhân sự cuối mỗi kỳ |
| P-08 | Không kiểm soát được trần OT theo ngày/tháng/năm | Rủi ro phạt tới 150 triệu và đình chỉ hoạt động tăng ca |

## 3. Mục tiêu

### 3.1. Mục tiêu nghiệp vụ

1. Tự động hóa toàn chuỗi: **log quẹt thẻ thô → bảng công tháng → bảng lương → phiếu
   lương → lệnh chi ngân hàng → bút toán ERP**.
2. Rút ngắn thời gian chốt công – tính lương và loại bỏ thao tác nhập liệu lặp.
3. Cho phép người lao động tự tra cứu công, phép, phiếu lương và phản hồi sai lệch.
4. Cung cấp cho lãnh đạo số liệu chi phí nhân công theo trung tâm chi phí, theo thời gian thực.

### 3.2. Mục tiêu tuân thủ

1. Chặn vi phạm **ngay tại thời điểm thao tác**, không để phát hiện khi bị thanh tra.
2. Sinh tự động Sổ quản lý lao động điện tử đủ 20 tiêu chí theo Khoản 2 Điều 3 NĐ 145/2020.
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
| Quy mô lao động | 300 – 1.000 người |
| Địa điểm | 1 trụ sở văn phòng + 1 nhà máy |
| Cơ cấu lao động | Khối trực tiếp ~75% (công nhân sản xuất, làm ca kíp); khối gián tiếp ~25% (văn phòng, kỹ thuật, kho, bảo vệ, bếp) |
| Chế độ ca — khối trực tiếp | 3 ca × 8h: Ca A 06:00–14:00, Ca B 14:00–22:00, Ca C 22:00–06:00; xoay ca theo chu kỳ tuần, mỗi người làm đủ 3 loại ca trong tháng |
| Chế độ ca — khối gián tiếp | Hành chính 8h/ngày, T2–T7 |
| Vùng lương tối thiểu | Vùng I (tham số hóa, không hardcode) |
| Kỳ công | Cut-off ngày 26 tháng trước → 25 tháng hiện tại |
| Kỳ chi lương | Ngày 10 tháng sau |
| Hình thức trả lương | Văn phòng: lương thời gian + phụ cấp. Sản xuất: lương thời gian / sản phẩm theo KPI + phụ cấp |
| Loại HĐLĐ | Không xác định thời hạn, xác định thời hạn, thử việc/thực tập, thời vụ/mùa vụ |
| Nghỉ giữa ca | 30 phút, tính vào giờ làm việc |

### 4.2. Trong phạm vi (16 phân hệ)

| # | Phân hệ | Mô tả ngắn |
|---|---|---|
| 1 | Nền tảng hệ thống & danh mục | RBAC, cây tổ chức có lịch sử, tham số pháp lý, quản lý kỳ |
| 2 | Hồ sơ nhân sự | Hồ sơ, người phụ thuộc, quá trình công tác, Sổ quản lý lao động điện tử |
| 3 | Hợp đồng lao động | Vòng đời HĐ, phụ lục, cảnh báo pháp lý, chấm dứt HĐ |
| 4 | Ca làm việc & lịch làm việc | Định nghĩa ca, lịch xoay ca, lịch nghỉ lễ, đổi/hoán ca |
| 5 | Dữ liệu chấm công | Nạp log thô, chuẩn hóa, ghép cặp, ngoại lệ, chốt bảng công |
| 6 | Làm thêm giờ (OT) | Đăng ký – duyệt, phân loại hệ số, kiểm soát trần, nghỉ bù |
| 7 | Nghỉ phép & chế độ | Quỹ phép, đơn nghỉ, ốm đau – thai sản, thanh toán phép chưa nghỉ |
| 8 | Cơ cấu lương & tính lương | Cấu phần thu nhập, formula engine, dry-run, duyệt & khóa kỳ |
| 9 | Bảo hiểm bắt buộc & công đoàn | Lương đóng BH, sàn/trần, báo tăng giảm, KPCĐ – đoàn phí |
| 10 | Thuế thu nhập cá nhân | Giảm trừ, bóc tách thu nhập miễn thuế, khấu trừ tháng, quyết toán năm |
| 11 | Phúc lợi | Danh mục, điều kiện hưởng, phúc lợi linh hoạt, trợ cấp thôi việc |
| 12 | Quy trình phê duyệt | Workflow cấu hình dùng chung, ủy quyền, SLA, thông báo |
| 13 | Cổng ESS & MSS | Web / mobile / kiosk, phiếu lương bảo mật, phản hồi sai lệch |
| 14 | Báo cáo & phân tích | Chứng từ kế toán, báo cáo nghiệp vụ – tuân thủ, dashboard |
| 15 | Tích hợp | Máy chấm công, ngân hàng, ERP, cổng BHXH – thuế, SSO |
| 16 | Bảo mật & tuân thủ | Dữ liệu cá nhân, mã hóa, audit log, lưu trữ ≥ 3 năm |

### 4.3. Ngoài phạm vi

| Hạng mục | Lý do |
|---|---|
| Xử lý dữ liệu sinh trắc học gốc (vân tay, khuôn mặt) | Hệ thống chỉ tiêu thụ sự kiện quẹt thẻ do thiết bị sinh ra |
| Module tuyển dụng, đánh giá KPI, quản lý sản xuất | Chỉ tích hợp nhận dữ liệu đầu vào |
| Phần mềm kế toán / ERP | Chỉ đẩy bút toán sang, không thay thế |
| Tự động nộp hồ sơ lên cổng BHXH / thuế | Chỉ kết xuất đúng định dạng và theo dõi trạng thái |
| **Chức năng trừ lương do đi trễ / vi phạm nội quy** | **Bị cấm bởi Điều 127 BLLĐ 2019 — xem [11](11-tuan-thu-phap-ly.md)** |
| Chấm công GPS cho nhân sự làm việc ngoài | Chưa có nhu cầu được xác nhận trong giai đoạn này |

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

### 5.2. Ràng buộc vận hành

- Công nhân trực tiếp ít dùng máy tính → truy cập qua **kiosk tại xưởng** hoặc **điện thoại**.
- Máy chấm công đặt tại xưởng và cổng nhà máy, có thời điểm mất kết nối mạng cục bộ.
- Kỳ công và kỳ lương lệch nhau, hai khối lao động có thể chốt công khác ngày.
- Giai đoạn chuyển đổi phải chạy song song với Excel tối thiểu 2 kỳ.

## 6. Thuật ngữ

| Thuật ngữ | Định nghĩa dùng trong toàn bộ tài liệu |
|---|---|
| **Ngày công** | Đơn vị nghiệp vụ gắn với **ca**, không gắn với ngày lịch. Một ca = một ngày công, gán về ngày bắt đầu ca |
| **Đoạn giờ** | Phần giờ làm việc sau khi tách theo mốc 22:00 / 06:00 / 00:00, dùng để áp hệ số |
| **Ngày T** | Ngày bắt đầu ca; ca C bắt đầu 22:00 ngày T kết thúc 06:00 ngày T+1 vẫn thuộc ngày T |
| **Kỳ công** (attendance period) | Chu kỳ chốt dữ liệu chấm công, ở đây 26 tháng trước → 25 tháng hiện tại |
| **Kỳ lương** (payroll period) | Chu kỳ tính và chi trả lương, chi ngày 10 tháng sau |
| **Cut-off** | Thời điểm khóa kỳ công, sau đó bảng công trở thành chỉ đọc |
| **Lương giờ thực trả** | Căn cứ tính OT và phụ cấp đêm; = lương tháng ÷ số giờ làm việc thực tế trong tháng |
| **Bẫy mẫu số** | Lỗi đưa ngày nghỉ lễ có hưởng lương vào mẫu số khi tính lương giờ, làm "pha loãng" đơn giá |
| **Gross-up** | Quy đổi ngược từ lương NET thỏa thuận sang lương GROSS |
| **Dry-run** | Chạy thử tính lương chưa ghi nhận chính thức, để đối chiếu trước khi chốt |
| **Snapshot** | Ảnh chụp bất biến của bảng công / bảng lương tại thời điểm khóa kỳ, kèm mã băm |
| **Formula engine** | Bộ máy tính toán theo công thức khai báo bằng dữ liệu, không viết cứng trong mã |
| **ESS / MSS** | Cổng tự phục vụ cho người lao động / cho quản lý |
| **Cost center** | Trung tâm chi phí, dùng để hạch toán chi phí nhân công (TK 622 / TK 642) |
| **Cổng chặn tuân thủ** | Bộ kiểm tra `CP-01`…`CP-09` chạy như điều kiện chặn trước khi duyệt bảng lương |
| **Đối soát chéo** | Bộ quy tắc `XC-01`…`XC-10` chạy trước khi chốt bảng công |
