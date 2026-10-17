# 08. Kiến trúc hệ thống

## 1. Nguyên tắc kiến trúc

| # | Nguyên tắc | Hệ quả thiết kế |
|---|---|---|
| NT-1 | **Dữ liệu gốc bất biến** | Log chấm công nhập từ tệp chỉ ghi thêm; mọi hiệu chỉnh diễn ra ở tầng dẫn xuất |
| NT-2 | **Tính lại được** | Tầng dẫn xuất là hàm thuần của tầng gốc + tham số + đơn từ đã duyệt |
| NT-3 | **Chốt kỳ là bất biến** | Snapshot kèm hash tại thời điểm khóa; kỳ đã chốt không thay đổi ngầm |
| NT-4 | **Cấu hình hơn lập trình** | Tham số pháp lý và công thức lương là dữ liệu, không phải mã |
| NT-5 | **Tuân thủ là cổng chặn** | Kiểm tra pháp lý chạy như điều kiện chặn, không phải báo cáo hậu kiểm |
| NT-6 | **Truy vết toàn phần** | Mỗi con số đi ngược được về công thức → tham số → lượt quẹt gốc |
| NT-7 | **Không phụ thuộc hạ tầng cụ thể** | Kiến trúc chạy được cả on-premise lẫn cloud (câu hỏi PV5-14 chưa chốt) |
| NT-8 | **Phạm vi theo BFD** | Bốn tác nhân TT / QĐ / KT / AD; hệ thống chỉ tiếp nhận tệp chấm công và xuất tệp — không kết nối thiết bị, ngân hàng, ERP, cổng BHXH / thuế |

---

## 2. Kiến trúc tổng thể

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                              TẦNG TRÌNH BÀY — ỨNG DỤNG WEB                        │
├────────────────────────┬────────────────────────┬────────────────────────────────┤
│  Giao diện xưởng        │  Giao diện kế toán      │  Giao diện quản trị            │
│  TT, QĐ (máy tính,      │  KT                     │  AD                            │
│  máy tính bảng)         │                         │                                │
└───────────┬────────────┴───────────┬────────────┴───────────────┬────────────────┘
            └────────────────────────┴────────────────────────────┘
                                     │  HTTPS / REST + JSON
                       ┌─────────────▼──────────────┐
                       │      API GATEWAY            │
                       │  xác thực · phân quyền      │
                       │  theo đơn vị · ghi audit    │
                       └─────────────┬──────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────────────┐
│                     TẦNG DỊCH VỤ NGHIỆP VỤ (theo 10 phân hệ BFD)                  │
├───────────────┬───────────────┬───────────────┬───────────────┬─────────────────┤
│ Hồ sơ & HĐ    │ Ca & Chấm công│ Tính lương    │ BH & Thuế     │ Phúc lợi &      │
│ phân hệ 2     │ & OT & Nghỉ   │ & thưởng      │ TNCN          │ Báo cáo         │
│               │ phân hệ 3–6   │ phân hệ 7     │ phân hệ 8     │ phân hệ 9, 10   │
└───────┬───────┴───────┬───────┴───────┬───────┴───────┬───────┴────────┬────────┘
        │               │               │               │                │
┌───────▼───────────────▼───────────────▼───────────────▼────────────────▼────────┐
│              TẦNG NĂNG LỰC NỀN TẢNG (phân hệ 1 — Quản trị hệ thống)              │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────────────┤
│ Formula      │ Tham số pháp │ Kỳ nghiệp vụ │ Phân quyền   │ Nhật ký kiểm toán  │
│ Engine       │ lý (hiệu lực)│ & khóa kỳ    │ theo đơn vị  │ append-only        │
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴────────┬───────────┘
       └──────────────┴──────────────┴──────────────┴────────────────┘
                                     │
┌────────────────────────────────────▼─────────────────────────────────────────────┐
│                              TẦNG DỮ LIỆU                                         │
├───────────────────┬───────────────────┬───────────────────┬─────────────────────┤
│ CSDL quan hệ      │ Kho snapshot      │ Kho tệp           │ Audit store         │
│ (decimal, mã hóa  │ (bất biến + hash) │ (tệp chấm công,   │ (chỉ INSERT/SELECT) │
│  cột AES-256)     │                   │  chứng từ, tệp xuất)│                     │
└───────────────────┴───────────────────┴───────────────────┴─────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────────┐
│                         TẦNG NHẬP / XUẤT TỆP (không kết nối trực tiếp)            │
├──────────────────────┬──────────────────────┬──────────────────────┬─────────────┤
│ NHẬP: tệp chấm công   │ XUẤT: file chi lương  │ XUẤT: danh sách báo   │ XUẤT: báo   │
│ từng cơ sở (4.1)      │ phiếu lương (7.6)     │ tăng giảm BH (8.3),   │ cáo Excel / │
│                       │                       │ dự thảo quyết toán    │ PDF (10.x)  │
│                       │                       │ thuế (8.5)            │             │
└──────────────────────┴──────────────────────┴──────────────────────┴─────────────┘
```

Mô hình miền chi tiết (54 lớp / 10 gói, mỗi gói tương ứng một phân hệ): biểu đồ lớp tại
[`diagrams/class/`](../diagrams/class/); mô hình dữ liệu: [09](09-mo-hinh-du-lieu.md).

---

## 3. Thành phần chính

### 3.1. Dịch vụ nhập dữ liệu chấm công

Tiếp nhận tệp dữ liệu chấm công do AD tải lên theo từng cơ sở và kỳ công (chức năng 4.1,
SQ-02). Hệ thống **không** kết nối trực tiếp máy chấm công.

| Thuộc tính | Mô tả |
|---|---|
| Đầu vào | Tệp Excel / CSV / TXT theo ánh xạ cột cấu hình cho từng cơ sở (chính sách 1.4) |
| Đơn vị xử lý | Lô nhập (`LoNhapChamCong`): người nhập, thời điểm, số bản ghi, số bản ghi lỗi |
| Kiểm tra | Cấu trúc tệp, mã nhân viên, khoảng thời gian thuộc kỳ; tệp lỗi → trả danh sách dòng lỗi, không ghi log gốc |
| Idempotent | Bản ghi trùng nhận diện theo khóa `(mã máy, mã NV, thời điểm)`; nhập lại cùng tệp không tạo bản ghi trùng |
| Sau khi nhập | Kích hoạt ghép cặp vào/ra theo lịch ca đã duyệt (4.2), đánh dấu ngoại lệ, trả kết quả cho AD |

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

Chịu trách nhiệm vòng trạng thái của kỳ nghiệp vụ (kỳ công, kỳ lương — `KyNghiepVu`): kiểm tra
không trùng kỳ, kỳ trước cùng loại và phạm vi đã khóa (AD mở kỳ), kiểm tra điều kiện khóa (KT
khóa kỳ), sinh snapshot kèm hash. **Không có nghiệp vụ mở khóa kỳ**; điều chỉnh sau khóa đi qua
bút toán điều chỉnh ở kỳ đang mở.

### 3.4. Dịch vụ tham số pháp lý

Điểm truy cập duy nhất cho mọi giá trị pháp lý. API dạng
`get(mã_tham_số, ngày_nghiệp_vụ)` — **không có** biến thể lấy theo ngày hiện tại.

### 3.5. Dịch vụ trạng thái và duyệt

Luồng duyệt **cố định theo BFD**, cài đặt bằng các máy trạng thái riêng cho từng đối tượng —
không có bộ máy workflow cấu hình, ủy quyền hay SLA:

| Đối tượng | Trạng thái | Người chuyển |
|---|---|---|
| Lịch phân ca | Dự thảo → Chờ duyệt → Đã duyệt / Trả lại | TT gửi, QĐ duyệt |
| Đề xuất đổi ca | Chờ duyệt → Đã duyệt / Từ chối | TT gửi, QĐ duyệt |
| Đề xuất OT | Chờ duyệt → Đã duyệt / Từ chối / Trả lại | TT gửi, QĐ duyệt cấp 2 |
| Đơn nghỉ | Chờ duyệt cấp 1 → Đã duyệt cấp 1 / Từ chối | TT ghi nhận và duyệt |
| Bảng chấm công tháng | Nháp → Tổ đã xác nhận → Xưởng đã chốt → Đã khóa | TT → QĐ → KT |
| Bảng lương | Nháp → Đã duyệt → Đã khóa | KT |
| Bút toán điều chỉnh | Nháp → Đã xác nhận (ghi vào kỳ mở) | KT |
| Cấp phát phúc lợi | Dự kiến → Đã xác nhận | KT |
| Quyết định chấm dứt HĐ | Nháp → Đã xác nhận | KT |

Mỗi lần chuyển trạng thái ghi nhật ký kiểm toán và gửi thông báo trong ứng dụng cho người liên
quan.

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
công — tổ trưởng, quản đốc — hết quyền sửa công, sau lớp 2 kế toán hết quyền sửa lương.

### ADR-06. Điều chỉnh sau chốt luôn chuyển sang kỳ kế tiếp

**Quyết định.** Sai sót hoặc quyết định có hiệu lực quá khứ phát hiện sau khi kỳ đã khóa được
xử lý bằng **bút toán điều chỉnh** (truy lĩnh / truy thu) ở kỳ đang mở, sau khi KT xác nhận.
**Không mở khóa kỳ cũ.**

**Vì sao.** Sửa kỳ đã khóa làm lệch số liệu đã nộp cho BHXH, đã kê khai thuế, đã chi theo file
chi lương và đã báo cáo quỹ lương.

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
quyền năng nào kể cả quản trị viên". Chỉ chặn ở tầng ứng dụng là không đủ — một người có
quyền CSDL vẫn xóa được. Chuỗi băm không ngăn được xóa ở tầng hạ tầng
nhưng khiến việc đó **bị phát hiện**.

### ADR-09. Kiểm tra tuân thủ là cổng chặn (gate), không phải báo cáo

**Quyết định.** Bộ kiểm tra `CP-01`…`CP-09` chạy như điều kiện chặn trước khi chuyển bảng
lương sang duyệt; kết quả lưu kèm kỳ lương làm bằng chứng.

**Vì sao.** Mức phạt theo NĐ 283/2026 nhân theo quy mô lao động; với 301+ người, một lỗi
lương tối thiểu vùng là 150 triệu. Phát hiện sau khi đã chi lương thì thiệt hại đã phát sinh.

### ADR-10. Một ứng dụng web cho bốn vai trò, không có cổng tự phục vụ

**Quyết định.** Hệ thống chỉ phục vụ bốn vai trò TT, QĐ, KT, AD qua một ứng dụng web có giao
diện tương thích máy tính bảng cho tổ trưởng, quản đốc tại xưởng. Không xây dựng cổng tự phục
vụ (ESS), kiosk hay ứng dụng di động cho người lao động.

**Vì sao.** Theo BFD, công nhân là đối tượng dữ liệu: tổ trưởng ghi nhận đơn nghỉ, giải trình
công và đề xuất OT thay công nhân; kế toán xuất phiếu lương. Bỏ ESS loại bỏ nhu cầu cấp và quản
lý hàng nghìn tài khoản công nhân, cơ chế OTP / PIN cho phiếu lương và hạ tầng kiosk.

**Phương án loại bỏ.** Ba hình thái ESS web / mobile / kiosk (phiên bản 1.x) — ngoài phạm vi
BFD; có thể xem xét ở giai đoạn sau như một phân hệ mới.

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
 TỆP CHẤM CÔNG (AD nhập)   LÕI CHẤM CÔNG                    LÕI TÍNH LƯƠNG
      │                         │                                  │
      │ lô nhập, kiểm tra tệp   │                                  │
      ├────────────────────────►│ ghi raw_punch                    │
      │                         │ khử trùng · ghép cặp              │
      │                         │ gán ca (ngày T) · tách đoạn giờ   │
      │                         │ → ngày công dẫn xuất              │
      │                         │                                  │
      │  LỊCH CA, ĐỀ XUẤT OT,   │                                  │
      │  ĐƠN NGHỈ (TT, QĐ) ────►│ ngoại lệ, giải trình (TT)        │
      │                         │ xác nhận tổ (TT) · chốt xưởng (QĐ)│
      │                         │ đối soát XC-01…XC-10              │
      │                         │ KT KHÓA KỲ CÔNG → snapshot+hash   │
      │                         ├─────────────────────────────────►│
      │                         │                                  │ formula engine
      │  THAM SỐ PHÁP LÝ (theo ngày NV) ──────────────────────────►│ tính lương, thưởng
      │                         │                                  │ BH, thuế · CP-01…CP-09
      │                         │                                  │ KT duyệt → KT KHÓA
      │                         │                                  │ → snapshot
      │                         │          ┌───────────────────────┼──────────────────┐
      │                         │          ▼                       ▼                  ▼
      │                         │   File chi lương          Phiếu lương         Báo cáo quỹ lương,
      │                         │   (xuất tệp)              (KT xuất, in)       BH, thuế (xuất tệp)
```

---

## 6. Mô hình triển khai

Kiến trúc **không phụ thuộc vào lựa chọn on-premise hay cloud** (PV5-14 chưa chốt). Ràng
buộc chung cho cả hai phương án:

| Hạng mục | Yêu cầu |
|---|---|
| CSDL | Hỗ trợ mã hóa cột, kiểu decimal, ràng buộc chống chồng lấn khoảng hiệu lực, thu hồi quyền ở mức bảng |
| Máy trạm tại xưởng | Trình duyệt trên máy tính / máy tính bảng của TT, QĐ; kết nối mạng nội bộ hoặc VPN tới máy chủ ứng dụng |
| Nhập dữ liệu chấm công | AD tại từng cơ sở tải tệp lên qua trình duyệt; không cần cài dịch vụ tại mạng nhà máy |
| Sao lưu | RPO ≤ 1 giờ, RTO ≤ 4 giờ |
| Lưu trữ | ≥ 3 năm dữ liệu chấm công và tiền lương |

**Sơ đồ triển khai tham chiếu (on-premise):**

```
        MẠNG NHÀ MÁY (từng cơ sở)               TRUNG TÂM DỮ LIỆU
 ┌──────────────────────────────┐        ┌──────────────────────────────┐
 │ Máy trạm TT, QĐ (trình duyệt) │        │  Máy chủ ứng dụng (n bản)     │
 │ Máy trạm AD nhập tệp chấm công│ HTTPS  │  ├─ API Gateway               │
 │ (tệp xuất từ máy chấm công)   ├───────►│  ├─ Dịch vụ nghiệp vụ         │
 └──────────────────────────────┘        │  └─ Bộ xử lý lô (tính lương)  │
                                         ├──────────────────────────────┤
        MẠNG VĂN PHÒNG (trụ sở)           │  CSDL chính (mã hóa cột)      │
 ┌──────────────────────────────┐ HTTPS  │  CSDL bản sao (đọc/báo cáo)   │
 │ Máy trạm KT, AD               ├───────►│  Kho snapshot + audit store   │
 └──────────────────────────────┘        │  Kho tệp                      │
                                         └──────────────┬───────────────┘
                                                        │ tệp xuất (tải về)
                                                        ▼
                                  File chi lương · Danh sách BH · Dự thảo quyết toán
                                  (KT gửi ngân hàng, cơ quan BHXH / thuế ngoài hệ thống)
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
| Bảng lương nháp | Kết quả tính chưa duyệt, tính lại được nhiều lần để đối chiếu |

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
| `PERIOD_OVERLAP` | Mở kỳ trùng khoảng ngày với kỳ cùng loại, cùng phạm vi | Dịch vụ kỳ |
| `PREV_PERIOD_NOT_LOCKED` | Mở kỳ khi kỳ trước cùng loại, cùng phạm vi chưa khóa | Dịch vụ kỳ |
| `IMPORT_FILE_INVALID` | Tệp chấm công sai cấu trúc hoặc mã nhân viên không khớp | Dịch vụ nhập chấm công |
| `COMPLIANCE_BLOCKED` | Vi phạm cổng chặn `CP-xx` | Lõi tính lương |
| `CROSSCHECK_BLOCKED` | Vi phạm đối soát `XC-xx` mức BLOCKING | Lõi chấm công |
| `GROSS_UP_NOT_CONVERGED` | Gross-up không hội tụ trong số vòng lặp cho phép | Lõi tính lương |
| `OT_CONSENT_MISSING` | Đề xuất OT khi chưa có căn cứ đồng ý làm thêm | Dịch vụ OT |
| `OT_LIMIT_EXCEEDED` | Vượt trần OT ngày/tháng/năm — không cho QĐ duyệt | Dịch vụ OT |
| `TIMESHEET_NOT_CONFIRMED` | Chốt xưởng khi còn tổ chưa xác nhận công | Lõi chấm công |

Mọi lỗi mức BLOCKING phải trả về kèm: danh sách bản ghi vi phạm, liên kết tới màn hình xử
lý, và dẫn chiếu điều khoản pháp luật tương ứng (nếu là lỗi tuân thủ).
