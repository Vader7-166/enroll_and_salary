# 07. Kiến trúc hệ thống

## 1. Nguyên tắc kiến trúc

| # | Nguyên tắc | Hệ quả thiết kế |
|---|---|---|
| NT-1 | **Dữ liệu gốc bất biến** | Log quẹt thẻ chỉ ghi thêm; mọi hiệu chỉnh diễn ra ở tầng dẫn xuất |
| NT-2 | **Tính lại được** | Tầng dẫn xuất là hàm thuần của tầng gốc + tham số + đơn từ đã duyệt |
| NT-3 | **Chốt kỳ là bất biến** | Snapshot kèm hash tại thời điểm khóa; kỳ đã chốt không thay đổi ngầm |
| NT-4 | **Cấu hình hơn lập trình** | Tham số pháp lý và công thức lương là dữ liệu, không phải mã |
| NT-5 | **Tuân thủ là cổng chặn** | Kiểm tra pháp lý chạy như điều kiện chặn, không phải báo cáo hậu kiểm |
| NT-6 | **Truy vết toàn phần** | Mỗi con số đi ngược được về công thức → tham số → lượt quẹt gốc |
| NT-7 | **Không phụ thuộc hạ tầng cụ thể** | Kiến trúc chạy được cả on-premise lẫn cloud (câu hỏi PV5-14 chưa chốt) |

---

## 2. Kiến trúc tổng thể

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              TẦNG TRÌNH BÀY                                       │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────────────┤
│  Web ESS     │  Web quản trị │  Mobile App  │  Kiosk xưởng │  Dashboard lãnh đạo │
│  (C2)        │  (A, D, E)    │  (C1, B)     │  (C1)        │  (D3, D4)           │
└──────┬───────┴───────┬──────┴──────┬───────┴──────┬───────┴──────────┬──────────┘
       └───────────────┴─────────────┴──────────────┴──────────────────┘
                                     │  HTTPS / REST + JSON
                       ┌─────────────▼──────────────┐
                       │      API GATEWAY            │
                       │  xác thực · phân quyền      │
                       │  rate limit · ghi audit     │
                       └─────────────┬──────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────────────┐
│                            TẦNG DỊCH VỤ NGHIỆP VỤ                                 │
├───────────────┬───────────────┬───────────────┬───────────────┬─────────────────┤
│ Nhân sự &     │ Chấm công &   │ Tính lương    │ BHXH & Thuế   │ Workflow &      │
│ Hợp đồng      │ Ca kíp        │ (Payroll)     │               │ Thông báo       │
│ FR-02, FR-03  │ FR-04, FR-05, │ FR-08, FR-11  │ FR-09, FR-10  │ FR-12           │
│               │ FR-06, FR-07  │               │               │                 │
└───────┬───────┴───────┬───────┴───────┬───────┴───────┬───────┴────────┬────────┘
        │               │               │               │                │
┌───────▼───────────────▼───────────────▼───────────────▼────────────────▼────────┐
│                          TẦNG NĂNG LỰC NỀN TẢNG                                  │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────────────┤
│ Formula      │ Tham số pháp │ Quản lý kỳ   │ RBAC +       │ Audit log          │
│ Engine       │ lý (hiệu lực)│ & khóa kỳ    │ Data Scope   │ append-only        │
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴────────┬───────────┘
       └──────────────┴──────────────┴──────────────┴────────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────────────┐
│                              TẦNG DỮ LIỆU                                         │
├───────────────────┬───────────────────┬───────────────────┬─────────────────────┤
│ CSDL quan hệ      │ Kho snapshot      │ Kho tệp đính kèm  │ Audit store         │
│ (decimal, mã hóa  │ (bất biến + hash) │ (hợp đồng, chứng  │ (chỉ INSERT/SELECT) │
│  cột AES-256)     │                   │  từ, biên bản)    │                     │
└───────────────────┴───────────────────┴───────────────────┴─────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────┐
│                            TẦNG TÍCH HỢP NGOẠI VI                                 │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────────────┤
│ Dịch vụ nền  │ Bank Hub     │ ERP / Kế toán│ Cổng BHXH &  │ SSO/LDAP           │
│ đồng bộ máy  │ (file chi    │ (bút toán    │ thuế điện tử │ Email/SMS gateway  │
│ chấm công    │  lương)      │  622/642)    │              │ Zalo/Teams/Slack   │
└──────────────┴──────────────┴──────────────┴──────────────┴────────────────────┘
```

---

## 3. Thành phần chính

### 3.1. Dịch vụ nền đồng bộ máy chấm công

Thành phần chạy độc lập, thường trú tại mạng nhà máy.

| Thuộc tính | Mô tả |
|---|---|
| Hình thái | Windows Service hoặc Linux Daemon |
| Giao thức | TCP/IP tới thiết bị, HTTPS tới máy chủ ứng dụng |
| Chế độ | Kéo dữ liệu thời gian thực + đồng bộ định kỳ dự phòng |
| Chống mất dữ liệu | Máy chấm công buffer nội bộ khi mất mạng; dịch vụ đồng bộ bù khoảng gián đoạn khi khôi phục |
| Idempotent | Bản ghi trùng được nhận diện theo khóa `(mã máy, mã NV, thời điểm)`, không tạo bản ghi trùng |
| Giám sát | Báo trạng thái kết nối, lần đồng bộ cuối, cảnh báo lệch đồng hồ thiết bị (yêu cầu đồng bộ NTP) |

### 3.2. Formula Engine

```
        Định nghĩa cấu phần lương (dữ liệu, có phiên bản theo hiệu lực)
                              │
                              ▼
              ┌───────────────────────────────┐
              │ 1. Nạp định nghĩa theo ngày   │
              │    nghiệp vụ của kỳ           │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │ 2. Dựng đồ thị phụ thuộc      │
              │    Phát hiện chu trình → LỖI  │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │ 3. Sắp xếp tô-pô              │
              └───────────────┬───────────────┘
                              ▼
              ┌───────────────────────────────┐
              │ 4. Đánh giá biểu thức theo    │
              │    thứ tự, ghi vết từng biến  │
              └───────────────┬───────────────┘
                              ▼
                  Kết quả + dấu vết drill-down
```

**Ràng buộc bảo mật của ngôn ngữ biểu thức:** tập hàm giới hạn, không vòng lặp, không truy
cập I/O, không gọi hệ thống. Đây là điều kiện để loại bỏ rủi ro thực thi mã tùy ý trên dữ
liệu lương.

**Tối ưu hiệu năng:** cache tham số và định nghĩa công thức trong phạm vi một lần chạy lô;
đo hiệu năng với 1.000 nhân sự từ giai đoạn sớm.

### 3.3. Dịch vụ quản lý kỳ và khóa kỳ

Chịu trách nhiệm vòng trạng thái của `attendance_period` và `payroll_period`, kiểm tra điều
kiện chuyển trạng thái, sinh snapshot kèm hash, và kiểm soát nghiệp vụ mở khóa.

### 3.4. Dịch vụ tham số pháp lý

Điểm truy cập duy nhất cho mọi giá trị pháp lý. API dạng
`get(mã_tham_số, ngày_nghiệp_vụ)` — **không có** biến thể lấy theo ngày hiện tại.

### 3.5. Bộ máy workflow

Một engine dùng chung cho mọi loại đơn. Định nghĩa luồng là dữ liệu: các cấp duyệt, điều
kiện rẽ nhánh, SLA, hành vi khi quá hạn, kênh thông báo.

---

## 4. Quyết định kiến trúc (ADR)

### ADR-01. Tách ba tầng dữ liệu: thô — dẫn xuất — chốt

**Quyết định.** Dữ liệu chấm công đi qua ba tầng lưu trữ riêng biệt: `raw_punch` (bất biến),
`daily_attendance` (dẫn xuất, tính lại được), `attendance_snapshot` / `payroll_snapshot`
(ảnh chụp bất biến kèm hash).

**Vì sao.** Cho phép tính lại tầng dẫn xuất khi phát hiện lỗi thuật toán mà không mất dữ liệu
gốc; tầng snapshot bảo đảm kỳ đã chốt không thay đổi ngầm — điều kiện tiên quyết để bảng
công được chấp nhận là chứng từ kế toán theo Điều 105 BLLĐ.

**Phương án loại bỏ.** Sửa trực tiếp trên một bảng duy nhất: không truy vết được, không tính
lại được, và mọi thay đổi thuật toán sẽ làm biến động số liệu kỳ cũ.

### ADR-02. Formula engine khai báo bằng dữ liệu thay vì viết cứng

**Quyết định.** Mọi thành phần lương định nghĩa bằng bản ghi có công thức dạng biểu thức;
engine dựng đồ thị phụ thuộc và tính theo thứ tự tô-pô. Mỗi công thức có phiên bản gắn
khoảng hiệu lực.

**Vì sao.** Quy chế lương của nhà máy thay đổi thường xuyên hơn nhiều so với chu kỳ phát
hành phần mềm; viết cứng thì mỗi lần đổi phụ cấp là một lần triển khai.

**Trade-off.** Chậm hơn mã biên dịch và khó gỡ lỗi hơn. Bù lại bằng: (a) công cụ chạy thử
công thức với dữ liệu mẫu, (b) màn hình drill-down hiển thị giá trị từng biến, (c) tính theo
lô có cache tham số trong một lần chạy.

**Phương án loại bỏ.** Nhúng ngôn ngữ script đầy đủ (JS/Python): mạnh hơn nhưng mở ra rủi ro
thực thi mã tùy ý trên dữ liệu lương.

### ADR-03. Ca đêm bắc cầu gán về ngày bắt đầu ca (ngày T)

**Quyết định.** Một "ngày công" là đơn vị nghiệp vụ gắn với **ca**, không phải với ngày lịch.
Ca C bắt đầu 22:00 ngày T sinh đúng một bản ghi ngày công của ngày T.

**Vì sao.** Tách theo ngày lịch làm một ca thành hai ngày công lẻ → sai số ngày công, sai
phân loại ngày lễ, ca cuối tháng bị cắt đôi giữa hai kỳ lương.

**Hệ quả cần xử lý riêng.** Phân loại ngày để áp hệ số OT vẫn tách theo mốc 00:00. Do đó
tách hai khái niệm: **ngày công** (gán về T) và **đoạn giờ** (tách theo 22:00 / 06:00 / 00:00).
Đây là điểm dễ cài đặt sai nhất của toàn hệ thống.

### ADR-04. Hệ số OT tính bằng biểu thức ba số hạng, không lưu con số kết quả

**Quyết định.** Cài đặt đúng công thức Điều 57 NĐ 145/2020:
`tỷ lệ OT đêm = tỷ_lệ_OT_ngày(loại_ngày) + 30% + 20% × tỷ_lệ_ban_ngày(loại_ngày)`.
Các con số 200 / 210 / 270 / 390% là **kết quả tính**.

**Vì sao.** Nếu doanh nghiệp nâng hệ số OT ngày thường lên 160%, hệ số OT đêm phải tự động
thành 212%. Lưu con số kết quả sẽ khiến hai chỗ lệch nhau. Cách này cũng làm bộ kiểm thử
pháp lý trở nên kiểm chứng được.

### ADR-05. Kỳ công và kỳ lương là hai thực thể riêng, khóa hai lớp

**Quyết định.** `attendance_period` và `payroll_period` là hai bảng riêng với vòng trạng thái
riêng; kỳ lương chỉ chạy được khi kỳ công tương ứng đã `LOCKED`.

**Vì sao.** Kỳ công cut-off ngày 25 nhưng chi lương ngày 10 tháng sau, và hai khối có thể
chốt công khác ngày. Khóa hai lớp cũng tạo ranh giới trách nhiệm rõ: sau lớp 1 nhân sự chấm
công hết trách nhiệm, sau lớp 2 kế toán hết trách nhiệm.

### ADR-06. Điều chỉnh sau chốt luôn chuyển sang kỳ kế tiếp

**Quyết định.** Mặc định, sai sót phát hiện sau khi kỳ đã khóa được xử lý bằng dòng truy
lĩnh/truy thu ở kỳ gần nhất chưa khóa. Mở khóa kỳ cũ là ngoại lệ có kiểm soát.

**Vì sao.** Sửa kỳ đã khóa làm lệch số liệu đã nộp cho BHXH, đã kê khai thuế và đã đẩy bút
toán ERP.

### ADR-07. Mọi giá trị pháp lý là tham số theo khoảng hiệu lực, tra theo ngày nghiệp vụ

**Quyết định.** Bảng `legal_parameter` với khóa `(mã tham số, hiệu_lực_từ, hiệu_lực_đến)`,
ràng buộc chống chồng lấn ở tầng CSDL. Tra theo **ngày nghiệp vụ của giao dịch**.

**Vì sao.** Chạy lại kỳ 12/2025 vào tháng 02/2026 phải cho ra mức lương tối thiểu cũ. Tra
theo ngày chạy sẽ phá vỡ tính idempotent và làm số liệu không đối chiếu được với hồ sơ đã nộp.

### ADR-08. Audit log append-only có chuỗi băm, thu quyền ở tầng cơ sở dữ liệu

**Quyết định.** Bảng audit log chỉ cấp quyền INSERT và SELECT cho tài khoản ứng dụng;
UPDATE/DELETE bị thu hồi ở tầng CSDL. Mỗi bản ghi lưu hash của bản ghi trước tạo thành chuỗi;
có tác vụ định kỳ kiểm tra toàn vẹn.

**Vì sao.** Yêu cầu nghiệp vụ nói rõ nhật ký "không thể bị sửa, xóa hay ghi đè bởi bất kỳ
quyền năng nào kể cả quản trị viên". Chỉ chặn ở tầng ứng dụng là không đủ — một
`SYSTEM_ADMIN` có quyền CSDL vẫn xóa được. Chuỗi băm không ngăn được xóa ở tầng hạ tầng
nhưng khiến việc đó **bị phát hiện**.

### ADR-09. Kiểm tra tuân thủ là cổng chặn (gate), không phải báo cáo

**Quyết định.** Bộ kiểm tra `CP-01`…`CP-09` chạy như điều kiện chặn trước khi chuyển bảng
lương sang duyệt; kết quả lưu kèm kỳ lương làm bằng chứng.

**Vì sao.** Mức phạt theo NĐ 283/2026 nhân theo quy mô lao động; với 301+ người, một lỗi
lương tối thiểu vùng là 150 triệu. Phát hiện sau khi đã chi lương thì thiệt hại đã phát sinh.

### ADR-10. Ba hình thái ESS dùng chung một API

**Quyết định.** Web, mobile và kiosk dùng chung backend và chung mô hình quyền; kiosk chỉ
khác ở giao diện tối giản và chính sách phiên ngắn (tự đăng xuất 60 giây).

**Vì sao.** 75% người dùng là công nhân trực tiếp truy cập qua kiosk/điện thoại. Tách backend
riêng cho kiosk sẽ nhân đôi chi phí bảo trì và tạo rủi ro lệch quyền giữa hai đường vào.

### ADR-11. Kiểu tiền tệ decimal, chính sách làm tròn khai báo tường minh

**Quyết định.** Mọi số tiền dùng decimal có độ chính xác xác định. Chính sách làm tròn là
cấu hình hai chiều: làm tròn ở bước nào và đến hàng nào.

**Vì sao.** Float gây sai lệch cộng dồn trên 1.000 nhân sự × 12 kỳ, và sai lệch tiền lương
dù nhỏ vẫn là hành vi "trả không đủ lương". Làm tròn phải tường minh vì làm tròn từng thành
phần rồi cộng ≠ cộng rồi làm tròn, và chênh lệch này phải giải thích được với người lao động.

### ADR-12. Gross-up giải bằng lặp có kiểm soát hội tụ

**Quyết định.** Quy đổi NET→GROSS giải bằng thuật toán lặp qua hàm hợp thành; điều kiện dừng
sai số ≤ 1 đồng.

**Vì sao.** Hàm này không nghịch đảo được ở dạng đóng vì có trần đóng bảo hiểm và biểu thuế
lũy tiến bậc thang — hàm liên tục từng khúc.

### ADR-13. Cấu hình theo đơn vị kế thừa từ cây tổ chức

**Quyết định.** Cấu hình chính sách phân giải theo nguyên tắc "đơn vị con kế thừa cha, ghi
đè từng khóa"; giao diện luôn hiển thị nguồn gốc giá trị đang có hiệu lực.

**Vì sao.** Khối trực tiếp và khối gián tiếp có ngày chốt công và quy tắc OT khác nhau nhưng
phần lớn cấu hình giống nhau. Kế thừa tránh nhân bản; hiển thị nguồn gốc tránh tình trạng
không ai biết giá trị đang áp đến từ đâu.

---

## 5. Luồng dữ liệu chính

```
 MÁY CHẤM CÔNG          DỊCH VỤ NỀN            LÕI CHẤM CÔNG           LÕI TÍNH LƯƠNG
      │                      │                       │                        │
      │ transaction log      │                       │                        │
      ├─────────────────────►│                       │                        │
      │                      │ ghi raw_punch         │                        │
      │                      ├──────────────────────►│                        │
      │                      │                       │ khử trùng              │
      │                      │                       │ ghép cặp               │
      │                      │                       │ gán ca (ngày T)        │
      │                      │                       │ tách đoạn giờ          │
      │                      │                       │ → daily_attendance     │
      │                      │                       │                        │
      │           ĐƠN TỪ (nghỉ, OT, giải trình) ─────►│                        │
      │                      │                       │ đối soát XC-01…XC-10   │
      │                      │                       │ CHỐT → snapshot+hash   │
      │                      │                       ├───────────────────────►│
      │                      │                       │                        │ formula engine
      │           THAM SỐ PHÁP LÝ (theo ngày NV) ────────────────────────────►│ tính lương
      │                      │                       │                        │ CP-01…CP-09
      │                      │                       │                        │ duyệt 3 cấp
      │                      │                       │                        │ KHÓA → snapshot
      │                      │                       │                        │
      │                      │        ┌──────────────┴────────────┬───────────┴──────────┐
      │                      │        ▼                           ▼                      ▼
      │                      │   Bank Hub file              Payslip (OTP)         Bút toán ERP
      │                      │   → chi lương                → ESS/mobile          → TK 622/642
```

---

## 6. Mô hình triển khai

Kiến trúc **không phụ thuộc vào lựa chọn on-premise hay cloud** (PV5-14 chưa chốt). Ràng
buộc chung cho cả hai phương án:

| Hạng mục | Yêu cầu |
|---|---|
| CSDL | Hỗ trợ mã hóa cột, kiểu decimal, ràng buộc chống chồng lấn khoảng hiệu lực, thu hồi quyền ở mức bảng |
| Dịch vụ nền chấm công | Bắt buộc đặt trong mạng nhà máy, có kết nối tới thiết bị và tới máy chủ ứng dụng |
| Kiosk | Thiết bị tại xưởng, mạng nội bộ, phiên ngắn |
| Sao lưu | RPO ≤ 1 giờ, RTO ≤ 4 giờ |
| Lưu trữ | ≥ 3 năm dữ liệu chấm công và tiền lương |

**Sơ đồ triển khai tham chiếu (on-premise):**

```
        MẠNG NHÀ MÁY                          TRUNG TÂM DỮ LIỆU
 ┌────────────────────────┐            ┌──────────────────────────────┐
 │ Máy chấm công (nhiều)  │            │  Máy chủ ứng dụng (n bản)     │
 │ Kiosk tại xưởng        │  HTTPS     │  ├─ API Gateway               │
 │ Dịch vụ nền đồng bộ ───┼───────────►│  ├─ Dịch vụ nghiệp vụ         │
 └────────────────────────┘            │  └─ Bộ xử lý lô (tính lương)  │
                                       ├──────────────────────────────┤
        MẠNG VĂN PHÒNG                 │  CSDL chính (mã hóa cột)      │
 ┌────────────────────────┐   HTTPS    │  CSDL bản sao (đọc/báo cáo)   │
 │ Máy trạm HR, Kế toán ──┼───────────►│  Kho snapshot + audit store   │
 └────────────────────────┘            │  Kho tệp đính kèm             │
                                       └──────────────┬───────────────┘
        INTERNET                                      │
 ┌────────────────────────┐                           │
 │ Mobile app (C1, B)   ──┼───────────► HTTPS ────────┘
 └────────────────────────┘                           │
                                                      ▼
                                        Bank Hub · ERP · Cổng BHXH/thuế
                                        SMS/Email gateway · SSO/LDAP
```

---

## 7. Xử lý theo lô

Tính lương cho 1.000 nhân sự là tác vụ lô, không phải yêu cầu đồng bộ.

| Yêu cầu | Mô tả |
|---|---|
| Chia lô | Theo đơn vị tổ chức hoặc theo dải mã nhân viên |
| Tiến độ | Hiển thị tiến độ theo thời gian thực, cho phép dừng an toàn |
| Idempotent | Chạy lại toàn bộ hoặc một phần đều cho cùng kết quả |
| Cô lập lỗi | Lỗi ở một nhân sự không làm hỏng cả lô; ghi nhận vào danh sách cần xử lý |
| Cache | Tham số và định nghĩa công thức nạp một lần cho cả lô |
| Dry-run | Chạy thử không ghi nhận chính thức, sinh kết quả để đối chiếu |

---

## 8. Xử lý lỗi và mã lỗi nghiệp vụ

| Mã lỗi | Ý nghĩa | Nơi phát sinh |
|---|---|---|
| `SCOPE_VIOLATION` | Truy cập ngoài phạm vi dữ liệu được cấp | API Gateway |
| `ORG_CYCLE_DETECTED` | Gán đơn vị cha tạo vòng lặp trong cây tổ chức | Dịch vụ tổ chức |
| `PARAM_OVERLAP` | Khoảng hiệu lực tham số chồng lấn | Dịch vụ tham số |
| `PARAM_NOT_FOUND` | Không có tham số hiệu lực tại ngày nghiệp vụ | Dịch vụ tham số |
| `FORMULA_CYCLE_DETECTED` | Công thức có phụ thuộc vòng | Formula engine |
| `PERIOD_NOT_LOCKED` | Chạy lương khi kỳ công chưa khóa | Dịch vụ kỳ |
| `PERIOD_LOCKED` | Ghi dữ liệu vào kỳ đã khóa | Dịch vụ kỳ |
| `COMPLIANCE_BLOCKED` | Vi phạm cổng chặn `CP-xx` | Lõi tính lương |
| `CROSSCHECK_BLOCKED` | Vi phạm đối soát `XC-xx` mức BLOCKING | Lõi chấm công |
| `GROSS_UP_NOT_CONVERGED` | Gross-up không hội tụ trong số vòng lặp cho phép | Lõi tính lương |
| `OT_CONSENT_MISSING` | Huy động OT khi chưa có văn bản đồng ý | Dịch vụ OT |
| `OT_LIMIT_EXCEEDED` | Vượt trần OT ngày/tháng/năm | Dịch vụ OT |

Mọi lỗi mức BLOCKING phải trả về kèm: danh sách bản ghi vi phạm, liên kết tới màn hình xử
lý, và dẫn chiếu điều khoản pháp luật tương ứng (nếu là lỗi tuân thủ).
