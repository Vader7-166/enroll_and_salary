# 05. Quy trình nghiệp vụ

Tài liệu mô tả các quy trình end-to-end của hệ thống theo **11 activity diagram AD-00 …
AD-10** (ảnh tại [`diagrams/activity/`](../diagrams/activity/); bản mô tả dạng Word:
`diagrams/activity/MÔ  TẢ ACTIVITY DIAGRAM.docx`). Mỗi quy trình chỉ rõ tác nhân, chức năng
BFD, sequence diagram tương ứng, các bước, nhánh rẽ và đầu ra.

Tác nhân: **TT** – Tổ trưởng · **QĐ** – Quản đốc · **KT** – Kế toán · **AD** – Admin ·
**Hệ thống** – xử lý tự động. Công nhân không phải tác nhân: mọi thao tác thay công nhân do
tổ trưởng hoặc kế toán thực hiện.

> **Lưu ý chung.** Nhánh kết thúc ở trạng thái “chờ xử lý”, “trả lại” hoặc “nháp” chỉ kết
> thúc lượt thao tác hiện tại; hồ sơ chưa hoàn tất nghiệp vụ.

---

## 1. AD-00 · Chu trình tháng tổng thể

**Tác nhân:** AD, KT, TT, QĐ · **BFD:** toàn bộ · **Sequence:** SQ-01 … SQ-15 ·
**Sơ đồ:** [AD-00](../diagrams/activity/AD-00.png)

```
        Kỳ công N: 26/(N-1) ──────────────────────────────► 25/N          Chi lương: 10/(N+1)
             │                                               │                    │
 ┌───────────┴──────────┐                    ┌───────────────┴──────┐   ┌─────────┴────────┐
 │ GIAI ĐOẠN 1          │                    │ GIAI ĐOẠN 2          │   │ GIAI ĐOẠN 3      │
 │ Chuẩn bị & vận hành  │                    │ Chốt công            │   │ Tính & chi lương │
 └──────────────────────┘                    └──────────────────────┘   └──────────────────┘

 AD-01 Cấu hình, mở kỳ        AD          AD-04 Xác nhận công tổ    TT    AD-07 Tính lương  KT
 AD-02 Hồ sơ, hợp đồng        KT          AD-04 Chốt công xưởng     QĐ    AD-07 Duyệt, khóa KT
 AD-03 Lịch ca, đổi ca        TT → QĐ     AD-04 Khóa kỳ công        KT    AD-07 Phiếu lương,
 AD-04 Nhập công, ngoại lệ    AD, TT                                         file chi lương  KT
 AD-05 Đề xuất, duyệt OT      TT → QĐ                                       AD-08 BH, thuế    KT
 AD-06 Đơn nghỉ               TT                                            AD-09 Phúc lợi    KT
                                                                            AD-10 Báo cáo  TT/QĐ/KT
```

**Luồng theo sơ đồ AD-00** (bốn làn Admin – Kế toán – Tổ trưởng – Quản đốc):

| # | Hoạt động | Tác nhân | Nhánh |
|---|---|---|---|
| 1 | Chuẩn bị cấu hình và mở kỳ | AD | – |
| 2 | Cập nhật hồ sơ, hợp đồng và chính sách lương | KT | – |
| 3 | Lập lịch ca và gửi duyệt | TT | – |
| 4 | Xem xét lịch ca | QĐ | Không đồng ý → trả lịch về TT chỉnh sửa (kết thúc lượt) |
| 5 | Ghi nhận lịch đã duyệt | QĐ | – |
| 6 | Xử lý nghỉ, đề xuất OT khi phát sinh → QĐ duyệt OT khi có đề xuất | TT → QĐ | – |
| 7 | Tiếp nhận dữ liệu chấm công của công nhân (nhập tệp từ thiết bị của cơ sở) | AD | – |
| 8 | Xử lý ngoại lệ và xác nhận công của tổ | TT | – |
| 9 | Kiểm tra và chốt công xưởng | QĐ | – |
| 10 | Đối chiếu và khóa kỳ công | KT | Kỳ công chưa khóa → giữ kỳ chờ xử lý công |
| 11 | Tính lương, BH và thuế, đối chiếu kết quả | KT | – |
| 12 | Duyệt và khóa bảng lương → xuất phiếu lương, file chi lương và báo cáo | KT | Chưa đủ điều kiện khóa → giữ bảng lương nháp để xử lý sai lệch |

Kỳ công và kỳ lương được mở **theo từng cơ sở / đơn vị**; tham số pháp lý áp dụng theo vùng
lương và ngày hiệu lực. Bảng lương đạt yêu cầu được duyệt, khóa và kết xuất; dữ liệu chưa đầy
đủ hoặc còn sai lệch được giữ lại để xử lý trước khi hoàn tất. Các nhánh hồ sơ – hợp đồng,
phúc lợi và báo cáo được chi tiết tại AD-02, AD-09 và AD-10.

### Lịch vận hành chuẩn theo ngày

| Thời điểm | Hoạt động | Tác nhân |
|---|---|---|
| Trước ngày 20 tháng N-1 | Mở kỳ công tháng N (kỳ trước phải đã khóa); lập và duyệt lịch ca tháng N | AD; TT → QĐ |
| Hằng ngày | Nhập tệp chấm công từng cơ sở; ghép cặp vào/ra; xử lý ngoại lệ phát sinh | AD, Hệ thống, TT |
| Hằng ngày | Đề xuất và duyệt OT; ghi nhận và duyệt đơn nghỉ | TT, QĐ |
| Ngày 25 tháng N | Cut-off kỳ công | – |
| Ngày 25 – 27 | Tổ trưởng xác nhận công thực tế của tổ | TT |
| Ngày 26 – 28 | Đối chiếu công, OT, nghỉ các tổ; chạy đối soát chéo; chốt bảng công xưởng | QĐ, Hệ thống |
| Ngày 28 | **Kiểm tra và khóa kỳ công** | KT |
| Ngày 28 – 02 tháng N+1 | Mở kỳ lương; tính lương (bảng nháp), đối chiếu chênh lệch, cổng chặn tuân thủ | AD, KT |
| Ngày 02 – 06 | Ký duyệt nội bộ trên bản kết xuất (nếu quy chế yêu cầu, ngoài hệ thống); duyệt bảng lương | KT |
| Ngày 06 – 08 | Khóa kỳ lương, xuất file chi lương | KT |
| **Ngày 10 tháng N+1** | **Chi lương** theo file (ngân hàng thực hiện, ngoài hệ thống) | – |
| Ngày 10 – 12 | Xuất phiếu lương phát cho người lao động; báo cáo quỹ lương | KT |
| Trước ngày 20 | Lập danh sách báo tăng / giảm BH; khấu trừ thuế tháng | KT |

---

## 2. AD-01 · Quản trị hệ thống và mở kỳ

**Tác nhân:** AD, Hệ thống (KT tham gia 1.5 ở bước khóa kỳ — AD-04, AD-07) · **BFD:** 1.1 – 1.6 ·
**Sequence:** SQ-10, SQ-11, SQ-15 · **Sơ đồ:** [AD-01](../diagrams/activity/AD-01.png)

Admin chọn một trong ba tác vụ:

| Tác vụ | Bước | Kết quả / nhánh |
|---|---|---|
| **Cập nhật cấu hình** | Nhập thay đổi tài khoản và phân quyền theo đơn vị (1.1), cơ cấu tổ chức (1.2), vùng lương và tham số pháp lý (1.3), chính sách theo cơ sở (1.4) → hệ thống kiểm tra dữ liệu, phạm vi, khoảng hiệu lực | Hợp lệ → lưu, giữ phiên bản theo hiệu lực, ghi nhật ký. Không hợp lệ → trả lỗi để Admin sửa |
| **Mở kỳ** (1.5) | Chọn loại kỳ (công / lương), cơ sở, khoảng thời gian → hệ thống kiểm tra kỳ trùng và trạng thái kỳ trước cùng loại, cùng phạm vi | Kỳ trước đã khóa → tạo kỳ trạng thái Mở, ghi nhật ký. Chưa khóa → thông báo lý do, không mở. Kỳ đầu tiên xử lý theo trường hợp khởi tạo |
| **Xem nhật ký** (1.6) | Chọn phạm vi và điều kiện lọc | Hiển thị nhật ký được phép xem |

**Quy tắc then chốt:** tham số pháp lý được **thêm phiên bản mới** có hiệu lực, đóng hiệu lực
bản cũ (ngày hết hiệu lực = ngày trước hiệu lực mới), **không ghi đè**; chồng lấn hiệu lực → báo
lỗi và chỉ ra bản ghi bị chồng lấn (SQ-10). Kỳ chưa khóa tính theo tham số mới, kỳ đã khóa giữ
tham số cũ. Việc chốt, khóa công và lương thực hiện tại AD-04 và AD-07.

---

## 3. AD-02 · Quản lý hồ sơ và hợp đồng

**Tác nhân:** KT, Hệ thống · **BFD:** 2.1 – 2.5 (kèm 9.3 khi chấm dứt) · **Sequence:** SQ-14,
SQ-07 (quyết định), SQ-09 · **Sơ đồ:** [AD-02](../diagrams/activity/AD-02.png)

Kế toán chọn nhân sự và một trong ba tác vụ:

| Tác vụ | Bước | Kết quả |
|---|---|---|
| **Cập nhật hồ sơ** | Cập nhật hồ sơ, người phụ thuộc (2.1), hợp đồng / phụ lục (2.2), quyết định điều chuyển / thay đổi lương (2.3) → kiểm tra dữ liệu và hiệu lực | Lưu hồ sơ và lịch sử thay đổi. Quyết định có **hiệu lực quá khứ** → xác định nhu cầu hồi tố, chuyển sang AD-07 |
| **Theo dõi hạn hợp đồng** (2.4) | Lọc hợp đồng sắp hết hạn hoặc đã hết hạn | Hiển thị danh sách cảnh báo. **Cảnh báo không tự chấm dứt hợp đồng** |
| **Chấm dứt hợp đồng** (2.5) | Nhập quyết định và ngày nghỉ việc → hệ thống kiểm tra hợp đồng và căn cứ → xác định trợ cấp thôi việc / mất việc (9.3), phép chưa nghỉ (6.2), thông tin báo giảm BH (8.3) → KT đối chiếu khoản thanh toán và chứng từ | Xác nhận → cập nhật trạng thái hợp đồng theo ngày hiệu lực, ghi khoản vào kỳ lương mở, lập danh sách báo giảm, ghi nhật ký. Chưa xác nhận → giữ hồ sơ chờ xử lý |

**Vòng đời nhân sự trên hệ thống:** tạo hồ sơ và mã nhân viên → gán đơn vị → ký HĐ thử việc
(lương ≥ 85% lương chính thức, `CP-02`) → ký HĐLĐ chính thức, đăng ký người phụ thuộc, đưa vào
danh sách báo tăng BH → các sự kiện giữa vòng đời (điều chuyển, tăng lương, gia hạn, phụ lục —
đều có ngày hiệu lực, xử lý được trường hợp hiệu lực giữa kỳ lương, BR-40) → chấm dứt. Hồ sơ lưu
đủ thông tin để kết xuất Sổ quản lý lao động (20 tiêu chí, Khoản 2 Điều 3 NĐ 145/2020).

---

## 4. AD-03 · Xếp ca, duyệt lịch và đổi ca

**Tác nhân:** TT, QĐ, Hệ thống (AD chuẩn bị danh mục ca, lịch nghỉ lễ — 3.1) · **BFD:** 3.1 –
3.4 · **Sequence:** SQ-01 · **Sơ đồ:** [AD-03](../diagrams/activity/AD-03.png)

| Bước | Hoạt động | Tác nhân | Điều kiện / nhánh |
|---|---|---|---|
| 1 | Lập lịch ca của tổ (3.2) hoặc đề xuất đổi ca (3.3): chọn tổ, kỳ và mẫu xoay ca; hệ thống lấy danh mục ca, lịch nghỉ lễ, nhân viên của tổ và sinh lịch dự thảo (SQ-01 bước 1–5) | TT | – |
| 2 | Hệ thống kiểm tra nhân sự, trùng lịch, thời gian nghỉ giữa hai ca, ràng buộc xoay ca và trạng thái công liên quan | Hệ thống | Không hợp lệ → thông báo xung đột để TT chỉnh sửa (kết thúc lượt) |
| 3 | Đề xuất hợp lệ → TT gửi duyệt, hệ thống lưu trạng thái **Chờ duyệt**, thông báo QĐ | TT, Hệ thống | – |
| 4 | Xem lịch đề xuất và nhu cầu của xưởng, lịch ca toàn xưởng (3.4) | QĐ | Kế hoạch sản xuất cung cấp nhu cầu nhân lực ngoài hệ thống |
| 5a | Đồng ý → hệ thống ghi nhận lịch đã duyệt, áp dụng lịch mới hoặc lịch thay thế, lưu lịch sử thay đổi, thông báo kết quả cho TT | QĐ, Hệ thống | Chỉ lịch **Đã duyệt** mới có hiệu lực |
| 5b | Không đồng ý → QĐ nhập lý do trả lại; hệ thống ghi trạng thái **Trả lại** và thông báo TT | QĐ, Hệ thống | – |

**Nhánh đổi ca (3.3):** TT đề xuất đổi ca (nhân viên, ca cũ, ca mới, lý do) → hệ thống kiểm tra
ràng buộc ca mới → QĐ duyệt → cập nhật lịch, thông báo TT. **Khi đề xuất chưa được duyệt, lịch
hiện hành tiếp tục được sử dụng.**

---

## 5. AD-04 · Chấm công, xử lý ngoại lệ và chốt công

**Tác nhân:** AD, Hệ thống, TT, QĐ, KT · **BFD:** 4.1 – 4.5 · **Sequence:** SQ-02, SQ-03 ·
**Sơ đồ:** [AD-04](../diagrams/activity/AD-04.png)

Trạng thái bảng công đi qua bốn mức: **Nháp → Tổ đã xác nhận → Xưởng đã chốt → Đã khóa**.

```
 AD nhập tệp chấm công của cơ sở (4.1)
   │  Hệ thống kiểm tra cấu trúc tệp, mã nhân viên
   │    ├─ Lỗi → báo lỗi kèm danh sách dòng lỗi, dừng
   │    └─ Hợp lệ → lưu log gốc (bất biến), nhận diện bản ghi trùng
   ▼
 Hệ thống ghép vào/ra theo lịch ca đã duyệt (4.2), gán ca đêm về ngày T, tách đoạn giờ,
 đánh dấu ngày thiếu lượt quẹt → ngoại lệ
   ▼
 TT xem công và ngoại lệ của tổ → nhập giải trình, chứng cứ, điều chỉnh công (4.3)
   │  Hệ thống lưu lịch sử (giá trị cũ – mới – người sửa), tính lại công, ghi nhật ký
   │  Công tổ chưa đủ căn cứ → giữ chờ bổ sung
   ▼
 TT xác nhận công thực tế của tổ (4.4) ─────────────────────► Tổ đã xác nhận
   ▼
 QĐ tổng hợp, đối chiếu công, OT, nghỉ các tổ (4.5); hệ thống chạy đối soát XC-01…XC-10
   │  Còn tổ chưa xác nhận / còn sai lệch → cảnh báo, không cho chốt; trả lại phần cần xử lý
   ▼
 QĐ chốt bảng công xưởng ───────────────────────────────────► Xưởng đã chốt
   ▼
 KT kiểm tra các bảng công trong phạm vi kỳ
   │  Chưa đủ điều kiện → yêu cầu bổ sung hoặc đối chiếu lại
   ▼
 KT khóa kỳ công, ghi nhật ký; lưu snapshot + mã băm ──────► Đã khóa → chuyển sang tính lương
```

Hệ thống **chỉ tiếp nhận** tệp dữ liệu chấm công, không bao gồm cơ chế thu thập tại thiết bị.
Mọi điều chỉnh giữ lịch sử và **không ghi đè log gốc**. Thuật toán chi tiết:
[06](06-thuat-toan-cham-cong-va-tinh-luong.md).

**Các loại ngoại lệ:**

| Loại ngoại lệ | Cách xử lý | Tác nhân |
|---|---|---|
| Quên chấm công vào / ra | TT nhập giải trình kèm chứng cứ, điều chỉnh giờ vào / ra | TT |
| Đi muộn / về sớm < 15 phút có lý do khách quan | TT nhập giải trình; khôi phục công tròn ca, không trừ lương (BR-21) | TT |
| Công tác ngoài / làm việc từ xa | TT nhập giải trình đính kèm chứng từ | TT |
| Sự cố máy chấm công cả ngày | TT điều chỉnh công cho các thành viên của tổ kèm biên bản sự cố; QĐ đối chiếu khi chốt xưởng | TT, QĐ |
| Giờ OT thực tế lệch đề xuất đã duyệt | Chuyển từ AD-05 sang danh sách ngoại lệ để TT giải trình | TT |
| Tệp chấm công sai định dạng, mã NV không khớp | AD nhập lại tệp sau khi sửa nguồn; bản ghi lỗi không vào log gốc | AD |

**Bộ đối soát chéo `XC-01` … `XC-10`** (chạy khi QĐ tổng hợp bảng công xưởng):

| Mã | Quy tắc đối soát | Mức mặc định |
|---|---|---|
| `XC-01` | Ngày có đơn nghỉ đã duyệt nhưng vẫn có dữ liệu chấm công | WARNING |
| `XC-02` | OT đã duyệt nhưng không có dữ liệu ra vào tương ứng | WARNING |
| `XC-03` | Có dữ liệu chấm công nhưng không có lịch phân ca | WARNING |
| `XC-04` | Giờ làm việc trong ngày vượt trần pháp luật | WARNING |
| `XC-05` | Một nhân sự có dữ liệu tại hai cơ sở trong khoảng thời gian không thể di chuyển kịp | WARNING |
| `XC-06` | Công quy đổi âm hoặc vượt số ngày của kỳ | **BLOCKING** |
| `XC-07` | Nhân sự đã nghỉ việc nhưng vẫn phát sinh dữ liệu công | **BLOCKING** |
| `XC-08` | Nhân sự có hợp đồng hết hạn nhưng vẫn phát sinh dữ liệu công | WARNING |
| `XC-09` | Ngày công `ERR` chưa được giải trình | **BLOCKING** |
| `XC-10` | Số giờ OT lũy kế tháng / năm chạm hoặc vượt trần | WARNING |

BLOCKING → chặn chốt xưởng, liệt kê bản ghi vi phạm. WARNING → cho phép chốt kèm xác nhận của
QĐ, ghi nhận người xác nhận.

---

## 6. AD-05 · Đề xuất, duyệt và ghi nhận OT

**Tác nhân:** TT, QĐ, KT, Hệ thống · **BFD:** 5.1 – 5.5 · **Sequence:** SQ-04 ·
**Sơ đồ:** [AD-05](../diagrams/activity/AD-05.png)

| Bước | Hoạt động | Tác nhân | Điều kiện / nhánh |
|---|---|---|---|
| 1 | Lập đề xuất OT: tổ, ngày, giờ, **danh sách nhân viên**, lý do, căn cứ đồng ý làm thêm (5.1) → Chờ duyệt, thông báo QĐ | TT | Thiếu căn cứ đồng ý → chặn (BR-28) |
| 2 | Mở đề xuất để duyệt cấp 2 (5.2); hệ thống lấy giờ OT lũy kế theo ngày, tháng, năm và kiểm soát trần (5.3) | QĐ, Hệ thống | – |
| 3a | Vượt trần → cảnh báo, **không cho duyệt**; QĐ từ chối hoặc yêu cầu điều chỉnh, thông báo TT | QĐ | Lưu kết quả, kết thúc lượt |
| 3b | Trong trần, đủ điều kiện → QĐ duyệt → Đã duyệt, thông báo TT | QĐ | – |
| 4 | Khi có dữ liệu chấm công: hệ thống đối chiếu OT thực tế với đề xuất, phân loại ngày, đêm, tính giờ OT theo hệ số (5.4) | Hệ thống | Còn giờ cần giải trình → chuyển sang ngoại lệ công AD-04 |
| 5 | Nếu có yêu cầu quy đổi nghỉ bù (5.5): hệ thống kiểm tra căn cứ và điều kiện | KT, Hệ thống | Không đủ → giữ nguyên kết quả OT |
| 6 | Cập nhật kết quả OT cho công và lương | Hệ thống | – |

**Ngưỡng cảnh báo:** chạm 90% trần tháng (36/40 giờ) → cảnh báo tới TT và QĐ. Giá trị trần là
cấu hình theo cơ sở / ngành (BR-27).

> **Điểm mở Q2 (chờ nhóm chốt).** SQ-04 bước 19 ghi “trừ giờ OT trả tiền, cộng quỹ nghỉ bù”;
> AD-05 ghi “ghi nhận nghỉ bù và ảnh hưởng chi trả theo chính sách hợp lệ, giữ nguyên giờ OT
> thực tế”. Hai điểm thống nhất: giờ OT thực tế vẫn giữ để kiểm soát trần, quy đổi chỉ thực
> hiện khi có căn cứ. Điểm chưa thống nhất: phần giờ đã quy đổi có còn được trả tiền hay không.

---

## 7. AD-06 · Nghỉ phép và chế độ

**Tác nhân:** TT, KT, QĐ, Hệ thống (AD quản lý danh mục loại nghỉ — 6.1) · **BFD:** 6.1 – 6.5 ·
**Sequence:** SQ-05 · **Sơ đồ:** [AD-06](../diagrams/activity/AD-06.png)

Ba nhánh độc lập, hệ thống tiếp nhận tác vụ theo quyền:

```
 Nhánh 1 — Đơn nghỉ (6.3)
   TT nhập yêu cầu nghỉ của công nhân (nhân viên, loại nghỉ, từ ngày, đến ngày)
     → Hệ thống kiểm tra loại nghỉ, lịch, số dư phép nếu áp dụng
         ├─ Không hợp lệ → thông báo nội dung cần chỉnh sửa
         └─ Hợp lệ → lưu đơn chờ duyệt cấp 1
     → TT xem xét và duyệt / từ chối (nhập lý do)
     → Duyệt: ghi nhận đơn, trừ quỹ phép nếu là phép năm (ngày lễ xen giữa không trừ — BR-34),
       chuyển ký hiệu công (Ph / L / Ô / TS / Kl) vào bảng công

 Nhánh 2 — Quỹ phép, ốm đau – thai sản (6.2, 6.4)
   KT nhập căn cứ cập nhật quỹ hoặc chứng từ ốm đau, thai sản
     → Hệ thống kiểm tra chứng từ và chính sách
         ├─ Thiếu căn cứ → thông báo cần bổ sung hồ sơ
         └─ Đủ → cập nhật quỹ, hoặc số ngày hưởng và mức hưởng dự tính

 Nhánh 3 — Tỷ lệ vắng mặt (6.5)
   QĐ chọn xưởng và khoảng thời gian → hệ thống tổng hợp công, nghỉ, hiển thị tỷ lệ vắng
   theo tổ và theo ngày, cảnh báo nếu vượt ngưỡng
```

**Đơn nghỉ chỉ có một cấp duyệt do tổ trưởng thực hiện** (ghi nhận là “Duyệt cấp 1” trong
SQ-05); quản đốc không duyệt đơn nghỉ mà chỉ theo dõi tỷ lệ vắng mặt.

**Nhánh nghỉ đột xuất:** TT ghi nhận sau khi công nhân đã nghỉ, trong thời hạn cấu hình; đơn
phải được duyệt trước khi tổ xác nhận công. **Hủy đơn:** hoàn lại số dư phép, xóa ký hiệu công
tương ứng, ghi nhật ký.

---

## 8. AD-07 · Tính lương, khóa lương và hồi tố

**Tác nhân:** KT, Hệ thống · **BFD:** 7.1 – 7.6 (kèm 2.3, 1.5) · **Sequence:** SQ-06, SQ-07,
SQ-11 · **Sơ đồ:** [AD-07](../diagrams/activity/AD-07.png)

### 8.1. Tính lương kỳ

**Điều kiện tiên quyết:** kỳ công tương ứng **Đã khóa**; kỳ lương đã được AD mở.

| Bước | Hoạt động | Nhánh |
|---|---|---|
| 1 | KT chọn kỳ lương, cơ sở, vùng lương; kiểm tra cơ cấu lương, công thức (7.1) và các khoản phát sinh | – |
| 2 | Hệ thống lấy công đã khóa, giờ OT, ngày nghỉ, hồ sơ, chính sách và tham số đúng hiệu lực | Thiếu dữ liệu → thông báo dữ liệu còn thiếu |
| 3 | Kỳ có chi thưởng → tính thưởng (7.3) **trước** khi tổng hợp thu nhập | – |
| 4 | Tính thu nhập theo vùng, cơ sở (7.2); tính BH, thuế theo AD-08; xác định thực lĩnh | – |
| 5 | Lưu **bảng lương nháp**; KT rà soát, điều chỉnh dữ liệu đầu vào và tính lại khi cần | Tính lại cùng đầu vào cho cùng kết quả |
| 6 | Hệ thống chạy **cổng chặn tuân thủ** `CP-01` … `CP-09`; kết quả lưu kèm kỳ lương | BLOCKING → không cho duyệt |
| 7 | KT đối chiếu và **duyệt** bảng lương (7.5) → Đã duyệt | Chưa đạt → ghi nhận sai lệch, giữ nháp |
| 8 | KT **khóa kỳ lương** → Đã khóa, ghi nhật ký kiểm toán, lưu snapshot | – |
| 9 | KT xuất **phiếu lương** và **file chi lương** (7.6) | Xuất file không đồng nghĩa đã thanh toán |

**Trình tự tính bên trong một lần chạy:**

```
1. Lấy dữ liệu công đã khóa từ snapshot kỳ công
2. Tra tham số theo ngày nghiệp vụ của kỳ (BR-03)
3. Dựng đồ thị phụ thuộc công thức, sắp thứ tự tô-pô
4. Tính lương thời gian / sản phẩm theo ngày công thực tế
5. Tính OT theo từng đoạn giờ đã tách, áp hệ số theo loại ngày
6. Tính phụ cấp ca đêm trên số giờ đêm thực tế
7. Tính thưởng nếu kỳ có thưởng; cộng phụ cấp, thưởng, phúc lợi chịu thuế → TỔNG THU NHẬP
8. Xác định lương đóng BH (sàn / trần theo vùng) → BHXH, BHYT, BHTN phần NLĐ; KPCĐ phần DN
9. Bóc tách thu nhập miễn thuế (phần chênh lệch OT / đêm, ăn ca, trang phục…)
10. Trừ giảm trừ gia cảnh còn hiệu lực → thu nhập tính thuế → biểu lũy tiến theo hiệu lực
    (5 bậc từ kỳ tính thuế 2026) → thuế TNCN
11. Áp các khoản khấu trừ khác (trần 30% NET — BR-44)
12. Cộng bút toán truy lĩnh / truy thu đã xác nhận, tiền đền bù chậm trả nếu có → THỰC LĨNH
13. Áp chính sách làm tròn đã khai báo (BR-41)
```

**Cổng chặn tuân thủ `CP-01` … `CP-09`:**

| Mã | Kiểm tra | Mức |
|---|---|---|
| `CP-01` | Lương hợp đồng hoặc lương đóng BH thấp hơn lương tối thiểu vùng có hiệu lực | **BLOCKING** |
| `CP-02` | Lương thử việc dưới 85% lương chính thức | **BLOCKING** |
| `CP-03` | Số giờ OT vượt trần ngày / tháng / năm | **BLOCKING** |
| `CP-04` | Tổng khấu trừ vượt 30% lương thực trả | **BLOCKING** |
| `CP-05` | Số thực lĩnh âm | **BLOCKING** |
| `CP-06` | Còn ngày công `ERR` chưa xử lý trong kỳ | **BLOCKING** |
| `CP-07` | Nhân sự thuộc diện đóng BH nhưng chưa có mức lương đóng BH | **BLOCKING** |
| `CP-08` | Chênh lệch thu nhập so với kỳ trước vượt ngưỡng chưa được KT xác nhận | WARNING |
| `CP-09` | Thu nhập theo sản phẩm thấp hơn lương tối thiểu vùng | **BLOCKING** |

**Cảnh báo hạn chi lương:** khi còn ít ngày tới ngày chi lương mà bảng lương chưa khóa, màn hình
của KT hiển thị cảnh báo. Chậm quá 15 ngày → tính tiền đền bù theo BR-61 dựa trên ngày chi trả
thực tế do KT ghi nhận.

### 8.2. Hồi tố — truy lĩnh, truy thu (7.4)

```
 KT chọn quyết định điều chỉnh (hiệu lực quá khứ, từ AD-02) và kỳ lương mở nhận chênh lệch
   → Hệ thống kiểm tra quyết định, kỳ nhận và kết quả các kỳ bị ảnh hưởng
       └─ Không đủ căn cứ → thông báo dữ liệu cần bổ sung, kết thúc lượt
   → Hệ thống tìm các kỳ lương đã khóa bị ảnh hưởng
   → Với mỗi kỳ: lấy công, OT và tham số còn hiệu lực của kỳ đó, tính lại lương, so với số đã chi
   → Tính chênh lệch lương, BH, thuế TNCN; loại phần đã được điều chỉnh trước đó
   → Bảng chênh lệch theo từng kỳ cho KT đối chiếu
       ├─ KT xác nhận → ghi bút toán điều chỉnh vào kỳ đang mở, ghi nhật ký
       │                (KỲ ĐÃ KHÓA GIỮ NGUYÊN SỐ LIỆU)
       └─ Chưa xác nhận → giữ điều chỉnh nháp / hủy kết quả tính, không thay đổi dữ liệu
```

Phiếu lương kỳ nhận hiển thị dòng truy lĩnh / truy thu riêng, ghi rõ kỳ gốc và lý do. **Không mở
khóa kỳ cũ** (BR-42).

### 8.3. Phiếu lương và phản ánh sai lệch

KT xuất phiếu lương cho từng người sau khi khóa kỳ (bản in hoặc tệp), gồm: lương cơ bản, ngày công
thực tế, giờ OT ngày, giờ OT đêm, phụ cấp, BHXH 8% / BHYT 1,5% / BHTN 1%, thuế TNCN, các khoản
khấu trừ, truy lĩnh / truy thu, thực lĩnh (BR-62). Người lao động **không truy cập hệ thống**:

| Bước | Hoạt động | Tác nhân |
|---|---|---|
| 1 | Người lao động phản ánh sai lệch với tổ trưởng (công, OT, nghỉ) hoặc kế toán (lương, BH, thuế) | Ngoài hệ thống |
| 2 | Truy vết từ số tiền về công thức, tham số và dữ liệu công gốc | KT |
| 3 | Sai sót về công → TT lập giải trình ở kỳ đang mở; sai sót về lương → KT xử lý | TT, KT |
| 4 | Có chênh lệch ở kỳ đã khóa → bút toán điều chỉnh ở kỳ đang mở (8.2) | KT |
| 5 | Không thống nhất → chuyển lãnh đạo và Công đoàn theo quy chế (ngoài hệ thống) | – |

---

## 9. AD-08 · Bảo hiểm và thuế

**Tác nhân:** KT, Hệ thống · **BFD:** 8.1 – 8.5 · **Sequence:** SQ-08 ·
**Sơ đồ:** [AD-08](../diagrams/activity/AD-08.png)

```
 ┌──────────────────────────────────────────┬───────────────────────────────────────┐
 │ XỬ LÝ THÁNG                               │ QUYẾT TOÁN NĂM (8.5)                   │
 ├──────────────────────────────────────────┼───────────────────────────────────────┤
 │ 1. KT chọn kỳ, cơ sở; kiểm tra căn cứ      │ 1. KT chọn năm và đối tượng quyết toán │
 │    đóng BH và hồ sơ thuế                  │ 2. Tổng hợp thu nhập, giảm trừ và số   │
 │ 2. Lấy thu nhập, đối tượng, tham số đúng  │    thuế đã khấu trừ cả năm             │
 │    hiệu lực → thiếu dữ liệu thì thông báo │ 3. Kiểm tra đối tượng, tính đầy đủ     │
 │    dữ liệu cần bổ sung                    │    dữ liệu → thiếu thì liệt kê         │
 │ 3. Tính BHXH, BHYT, BHTN, KPCĐ, tách phần │ 4. Tính nghĩa vụ thuế năm và chênh     │
 │    NLĐ và DN (8.2)                        │    lệch nộp thừa / nộp thiếu           │
 │ 4. Có biến động (vào làm, nghỉ việc, đổi  │ 5. Lập DỰ THẢO hồ sơ quyết toán         │
 │    lương) → lập danh sách báo tăng, giảm  │                                        │
 │    để kê khai (8.3)                       │                                        │
 │ 5. Tính thuế khấu trừ tháng theo đối      │                                        │
 │    tượng, biểu thuế, giảm trừ bản thân và │                                        │
 │    người phụ thuộc còn hiệu lực (8.4)     │                                        │
 │ 6. Lưu kết quả theo người, theo kỳ để      │                                        │
 │    dùng chung với bảng lương              │                                        │
 └──────────────────────────────────────────┴───────────────────────────────────────┘
```

Mức đóng, sàn, trần BH theo vùng (8.1) được KT cập nhật theo hiệu lực trước khi chạy tính tháng
(SQ-08 bước 1–2); lần tính chỉ đọc phiên bản còn hiệu lực trong kỳ.

Kết quả tháng **dùng chung với AD-07**, không tạo thêm một lần khấu trừ khi KT mở phân hệ này.
Kê khai điện tử lên cổng BHXH / thuế và phát hành chứng từ khấu trừ thực hiện **ngoài hệ
thống**, dựa trên danh sách và dự thảo hệ thống lập. Chênh lệch phát hiện khi đối chiếu (ví dụ
với thông báo C12) → bút toán điều chỉnh ở kỳ đang mở (BR-42).

---

## 10. AD-09 · Cấp phát phúc lợi và theo dõi chi phí

**Tác nhân:** KT, Hệ thống · **BFD:** 9.1 – 9.4 · **Sequence:** SQ-12 (9.3: SQ-09) ·
**Sơ đồ:** [AD-09](../diagrams/activity/AD-09.png)

| Bước | Hoạt động | Tác nhân | Nhánh |
|---|---|---|---|
| 1 | Kiểm tra danh mục phúc lợi và điều kiện hưởng (9.1); chọn phúc lợi, kỳ, phạm vi đối tượng | KT | – |
| 2 | Lọc nhân viên đủ điều kiện, lập **danh sách dự kiến** | Hệ thống | – |
| 3 | Đối chiếu danh sách và mức hưởng; điều chỉnh đối tượng hoặc mức hưởng nếu cần → hệ thống kiểm tra lại điều kiện | KT, Hệ thống | Lặp đến khi không cần điều chỉnh |
| 4 | Xác nhận cấp phát (9.2) | KT | Chưa xác nhận → **giữ danh sách dự kiến** |
| 5 | Kiểm tra điều kiện và trùng cấp phát → ghi nhận cấp phát và chi phí, ghi phần liên quan vào kỳ lương nếu áp dụng, cập nhật báo cáo chi phí (9.4) | Hệ thống | Không hợp lệ → thông báo khoản cần kiểm tra lại |

**Trợ cấp thôi việc, mất việc (9.3)** được tính khi KT xác nhận chấm dứt hợp đồng tại AD-02 và
hiển thị trong theo dõi chi phí phúc lợi (9.4) — **không ghi nhận hai lần**.

---

## 11. AD-10 · Tra cứu và kết xuất báo cáo

**Tác nhân:** TT, QĐ, KT (người dùng được phân quyền), Hệ thống · **BFD:** 10.1 – 10.4 (kiểm tra
quyền theo 1.1) · **Sequence:** SQ-13 · **Sơ đồ:** [AD-10](../diagrams/activity/AD-10.png)

| Bước | Hoạt động | Nhánh |
|---|---|---|
| 1 | Người dùng chọn loại báo cáo, phạm vi và thời gian | – |
| 2 | Hệ thống kiểm tra quyền theo vai trò và đơn vị được quản lý | Không được xem → thông báo không có quyền |
| 3 | Truy vấn, tổng hợp trong phạm vi được phép; hiển thị báo cáo và **trạng thái dữ liệu** (nháp / chính thức) | – |
| 4 | Yêu cầu kết xuất → chọn định dạng → hệ thống kiểm tra quyền kết xuất | Không được xuất → thông báo |
| 5 | Tạo tệp từ phạm vi đã kiểm tra, cung cấp tải xuống | – |

Phạm vi: TT xem công, OT của tổ (10.1); QĐ xem công, OT, biến động nhân sự của xưởng (10.1,
10.2); KT xem quỹ lương theo cơ sở, đơn vị (10.3) và báo cáo BH, thuế (10.4) theo quyền được
giao. Danh mục báo cáo: [13](13-bao-cao-va-ket-xuat.md).

---

## 12. Bảng tổng hợp quy trình

| AD | Quy trình | Tác nhân | Chức năng BFD | Sequence | Tần suất | Đầu ra |
|---|---|---|---|---|---|---|
| AD-00 | Chu trình tháng tổng thể | AD, KT, TT, QĐ | Toàn bộ | SQ-01 … SQ-15 | Hằng tháng | Bảng lương đã khóa, kết xuất |
| AD-01 | Quản trị hệ thống và mở kỳ | AD | 1.1 – 1.6 | SQ-10, SQ-11, SQ-15 | Theo đợt / hằng tháng | Cấu hình có phiên bản, kỳ đã mở |
| AD-02 | Hồ sơ và hợp đồng | KT | 2.1 – 2.5, 9.3 | SQ-14, SQ-07, SQ-09 | Theo sự kiện | Hồ sơ, HĐ, quyết định chấm dứt |
| AD-03 | Xếp ca, duyệt lịch, đổi ca | TT, QĐ | 3.1 – 3.4 | SQ-01 | Hằng tháng | Lịch ca đã duyệt |
| AD-04 | Chấm công, ngoại lệ, chốt công | AD, TT, QĐ, KT | 4.1 – 4.5 | SQ-02, SQ-03 | Hằng ngày / hằng tháng | Bảng công đã khóa + snapshot |
| AD-05 | Đề xuất, duyệt, ghi nhận OT | TT, QĐ, KT | 5.1 – 5.5 | SQ-04 | Hằng ngày | Giờ OT đã quy hệ số |
| AD-06 | Nghỉ phép và chế độ | TT, KT, QĐ | 6.1 – 6.5 | SQ-05 | Hằng ngày | Đơn nghỉ đã duyệt, quỹ phép |
| AD-07 | Tính lương, khóa lương, hồi tố | KT | 7.1 – 7.6, 2.3 | SQ-06, SQ-07, SQ-11 | Hằng tháng | Bảng lương, phiếu lương, file chi lương |
| AD-08 | Bảo hiểm và thuế | KT | 8.1 – 8.5 | SQ-08 | Hằng tháng / năm | Bảng trích BH, danh sách tăng giảm, dự thảo quyết toán |
| AD-09 | Phúc lợi | KT | 9.1 – 9.4 | SQ-12, SQ-09 | Theo đợt | Cấp phát đã xác nhận, chi phí phúc lợi |
| AD-10 | Báo cáo | TT, QĐ, KT | 10.1 – 10.4 | SQ-13 | Theo nhu cầu | Báo cáo đúng phạm vi |
