# 11. Tích hợp hệ thống — giao diện dữ liệu vào / ra

Theo phạm vi BFD, hệ thống **không kết nối trực tiếp** với thiết bị hay hệ thống bên ngoài.
Mọi trao đổi dữ liệu đi qua **tệp**: AD nhập tệp chấm công vào; KT xuất tệp ra rồi gửi cho
ngân hàng, cơ quan BHXH, cơ quan thuế, bộ phận kế toán tổng hợp theo kênh của doanh nghiệp.

```
          ĐẦU VÀO (nhập tệp)                                    ĐẦU RA (xuất tệp)
   ┌──────────────────────────┐   ┌──────────────────────┐   ┌──────────────────────────────┐
   │ Tệp chấm công từng cơ sở  │──►│                      │──►│ File chi lương (7.6)          │──► Ngân hàng
   │ (AD, 4.1)                 │   │  HỆ THỐNG CHẤM CÔNG  │   │ Phiếu lương (7.6)             │──► Người lao động
   └──────────────────────────┘   │  & TIỀN LƯƠNG        │   │ Danh sách báo tăng giảm (8.3) │──► Cơ quan BHXH
   ┌──────────────────────────┐   │                      │   │ Dự thảo quyết toán thuế (8.5) │──► Cơ quan thuế
   │ Tệp dữ liệu khởi tạo      │──►│                      │──►│ Bảng phân bổ chi phí lương,   │──► Kế toán tổng hợp
   │ (hồ sơ, HĐ, số dư phép)   │   │                      │   │ quỹ lương (10.3)              │    / ERP
   └──────────────────────────┘   └──────────────────────┘   │ Báo cáo BH, thuế, lao động    │──► Lãnh đạo, Sở LĐ-TB&XH
                                                             │ (10.4)                        │
                                                             └──────────────────────────────┘
```

---

## 1. Nhập dữ liệu chấm công (4.1)

### 1.1. Cách tiếp nhận

Doanh nghiệp **chưa chốt hãng và model máy chấm công** (PV5-01, PV5-03). Hệ thống chỉ cần tệp
xuất từ phần mềm của máy chấm công, nên không phụ thuộc hãng máy:

| Bước | Nội dung | Tác nhân |
|---|---|---|
| 1 | Xuất tệp log từ phần mềm máy chấm công của cơ sở | AD tại cơ sở (ngoài hệ thống) |
| 2 | Chọn cơ sở, kỳ công và tải tệp lên hệ thống | AD |
| 3 | Kiểm tra định dạng, cấu trúc, mã nhân viên; tệp lỗi → trả danh sách dòng lỗi, không ghi dữ liệu | Hệ thống |
| 4 | Tệp hợp lệ → ghi lô nhập và bản ghi thô bất biến, ghép cặp vào/ra (4.2), trả kết quả (số bản ghi, số ngày ngoại lệ) | Hệ thống |

Tần suất nhập do từng cơ sở quyết định (hằng ngày khuyến nghị). Mỗi lô ghi `audit_log`.

### 1.2. Định dạng tệp log chuẩn

```
[Mã nhân viên],[Ngày quẹt YYYY-MM-DD],[Giờ quẹt HH:MM:SS],[Mã máy chấm công],[Hình thức: Vào/Ra/Tự động]
```

Ví dụ:

```
NV0142,2026-09-15,21:58:03,MAY-XUONG-01,Vào
NV0142,2026-09-16,06:12:47,MAY-XUONG-01,Ra
```

**Cấu hình ánh xạ (mapping):** khai báo theo cơ sở / loại máy trong chính sách theo cơ sở
(1.4) — thứ tự cột, định dạng ngày giờ, bảng mã ký tự, ký tự phân tách, số dòng tiêu đề bỏ
qua. Thêm loại máy mới là khai báo cấu hình, không sửa mã.

### 1.3. Kiểm tra khi nhập

| Kiểm tra | Hành vi |
|---|---|
| Sai cấu trúc tệp / sai định dạng ngày giờ | Từ chối lô, liệt kê dòng lỗi |
| Mã nhân viên không tồn tại hoặc không thuộc cơ sở | Từ chối lô, liệt kê dòng lỗi |
| Thời điểm quẹt ngoài khoảng kỳ công đã chọn | Từ chối lô, liệt kê dòng lỗi |
| Bản ghi trùng `(mã máy, mã NV, thời điểm)` với dữ liệu đã có | Bỏ qua, không tạo bản ghi trùng — nhập lại cùng tệp là idempotent |
| Kỳ công đã khóa | **Chặn** (`PERIOD_LOCKED`) |

> **Ghi chú vận hành.** Đồng hồ máy chấm công lệch giờ là nguồn sai lệch khó phát hiện; cơ sở
> cần định kỳ đồng bộ giờ thiết bị. Hệ thống không giám sát thiết bị.

### 1.4. Ranh giới trách nhiệm

Hệ thống **chỉ tiếp nhận và xử lý** dữ liệu chấm công dạng tệp. **Không** kết nối thiết bị qua
API / SDK, không chạy dịch vụ đồng bộ tại nhà máy, không xử lý dữ liệu sinh trắc học gốc.

---

## 2. File chi lương (7.6)

### 2.1. Kết xuất

| Hạng mục | Đặc tả |
|---|---|
| Thời điểm | Sau khi kỳ lương **Đã khóa** |
| Định dạng | Tệp Excel có mã hóa, cấu trúc cột theo mẫu của từng ngân hàng chi trả |
| Cấu hình | Mẫu tệp khai báo được cho từng ngân hàng (danh sách ngân hàng chưa chốt — PV2-22) |
| Ý nghĩa | **Xuất file không đồng nghĩa đã thanh toán**; KT ghi nhận ngày chi trả thực tế (BR-61) |

**Cấu trúc cột chuẩn:**

| Cột | Nội dung |
|---|---|
| Mã cơ sở | Tách tệp chi lương theo nhà máy nếu ngân hàng yêu cầu |
| Số tài khoản thụ hưởng | Giải mã từ trường 🔒 tại thời điểm kết xuất |
| Tên người thụ hưởng | Đúng tên trên tài khoản ngân hàng |
| Số tiền thực nhận (NET) | decimal, đã làm tròn theo chính sách |
| Mã ngân hàng nhận | |
| Nội dung chi trả | `[Mã nhân viên] Chuyển tiền lương tháng MM/YYYY` |

**Phí chuyển khoản:** doanh nghiệp chịu mọi khoản phí; người lao động nhận trọn vẹn số tiền
thực lĩnh — Khoản 2 Điều 96 BLLĐ 2019 (BR-60).

### 2.2. Kiểm soát trước khi kết xuất

| Kiểm tra | Hành vi |
|---|---|
| Nhân sự thiếu số tài khoản | Chặn kết xuất, liệt kê danh sách |
| Số tài khoản trùng giữa hai nhân sự | Cảnh báo, yêu cầu KT xác nhận |
| Tổng tiền tệp ≠ tổng thực lĩnh bảng lương | **Chặn** |
| Kỳ lương chưa khóa | **Chặn** |
| Ghi audit log | Mọi lần kết xuất tệp chi lương |

---

## 3. Số liệu cho kế toán tổng hợp (10.3)

Hệ thống **không đẩy bút toán trực tiếp** sang phần mềm kế toán / ERP (MISA, SAP, Oracle — chưa
chốt, PV5-10). KT xuất **bảng phân bổ chi phí lương** và báo cáo quỹ lương theo cơ sở, đơn vị;
kế toán tổng hợp nhập vào phần mềm kế toán.

| Đối tượng | Tài khoản | Ghi chú |
|---|---|---|
| Công nhân sản xuất tại xưởng | **Nợ TK 622** — Chi phí nhân công trực tiếp | Phục vụ tính giá thành |
| Khối văn phòng | **Nợ TK 642** — Chi phí quản lý doanh nghiệp | |

Số liệu tách theo **cost center của từng cơ sở** (`CC-BN-*`, `CC-HNA-*`, `CC-NA-*`, `CC-HN-*`),
theo đơn vị mà nhân sự thuộc về **tại kỳ lương đó**; nhân sự chuyển bộ phận giữa tháng được
phân bổ theo tỷ lệ ngày công thực tế (BR-40, BR-70).

| Nhóm số liệu | Nội dung |
|---|---|
| Chi phí lương | Lương thời gian, lương sản phẩm, phụ cấp, OT, thưởng |
| Trích bảo hiểm phần doanh nghiệp | BHXH, BHYT, BHTN, KPCĐ 2% |
| Khấu trừ phần người lao động | BHXH 8%, BHYT 1,5%, BHTN 1%, đoàn phí 1% |
| Thuế TNCN khấu trừ | Phải nộp Nhà nước |
| Phải trả người lao động | Số thực lĩnh |
| Truy lĩnh / truy thu | Theo bút toán điều chỉnh, ghi rõ kỳ gốc |

Xuất lại cùng kỳ cho cùng số liệu (kỳ đã khóa bất biến).

---

## 4. Hồ sơ BHXH và thuế (8.3, 8.5)

Hệ thống **không kê khai điện tử trực tiếp** lên cổng BHXH / thuế và không ký số. Phạm vi là
lập dữ liệu đúng để KT kê khai qua phần mềm / cổng của cơ quan:

| Nhóm | Đầu ra | Chức năng |
|---|---|---|
| BHXH | Danh sách báo tăng, báo giảm, điều chỉnh mức đóng; bảng trích BH theo kỳ | 8.2, 8.3 |
| Thuế TNCN | Bảng thuế khấu trừ theo tháng; **dự thảo hồ sơ quyết toán năm** kèm phụ lục | 8.4, 8.5 |
| Lao động | Báo cáo tình hình sử dụng lao động (định kỳ 6 tháng) | 10.4 |
| Làm thêm giờ | Số liệu giờ OT lũy kế phục vụ thông báo huy động OT 200 – 300 giờ/năm | 10.1 |

**Đối chiếu C12:** KT đối chiếu bảng trích BH với Thông báo kết quả đóng bảo hiểm (mẫu C12);
chênh lệch → bút toán điều chỉnh ở kỳ đang mở (BR-42, BR-51).

---

## 5. Nhập dữ liệu khởi tạo

| Dữ liệu | Định dạng | Tác nhân |
|---|---|---|
| Cây tổ chức, cơ sở, cost center | Tệp mẫu Excel, có bước xem trước và báo lỗi từng dòng | AD |
| Hồ sơ nhân viên, người phụ thuộc | Như trên | KT |
| Hợp đồng, phụ lục, lịch sử lương | Như trên | KT |
| Số dư phép năm đầu kỳ | Như trên | KT |
| Tài khoản TT, QĐ, KT, AD và phân quyền | Như trên | AD |

Mọi lần nhập khởi tạo ghi `audit_log`; dữ liệu nhập phải đối chiếu với Excel hiện hành trong
giai đoạn chạy song song ([16](16-ke-hoach-trien-khai-va-rui-ro.md)).

---

## 6. Ngoài phạm vi (có thể xem xét ở giai đoạn sau)

| Hạng mục | Lý do |
|---|---|
| Kết nối máy chấm công qua API / SDK, dịch vụ đồng bộ bù, giám sát thiết bị | BFD chỉ có “tiếp nhận dữ liệu” (4.1) |
| Bank Hub / API ngân hàng | Chỉ xuất file chi lương (7.6) |
| API ERP / đẩy bút toán tự động | Chỉ xuất bảng phân bổ (10.3) |
| Kê khai điện tử, ký số hồ sơ BHXH / thuế | Chỉ lập danh sách, dự thảo (8.3, 8.5) |
| SSO / LDAP | Tài khoản nội bộ cho 4 vai trò |
| SMS / OTP, Zalo / Teams / Slack | Không có ESS; thông báo trong ứng dụng |
| Hệ thống KPI, tuyển dụng, kế hoạch sản xuất | Dữ liệu đầu vào cung cấp qua TT, QĐ, KT |
| API mở cho bên thứ ba | Không có nhu cầu trong BFD |

---

## 7. Nguyên tắc chung cho nhập / xuất tệp

| # | Nguyên tắc |
|---|---|
| 1 | **Idempotent**: nhập lại cùng tệp không tạo bản ghi trùng; xuất lại cùng kỳ đã khóa cho cùng số liệu |
| 2 | **Ghi vết đầy đủ**: mọi lần nhập / xuất ghi `audit_log` kèm mã lô, người thực hiện, kết quả |
| 3 | **Tệp lỗi không làm hỏng dữ liệu**: lô lỗi bị từ chối toàn bộ, không ghi một phần |
| 4 | **Cấu hình hơn lập trình**: thêm ngân hàng mới, thêm loại máy chấm công mới là khai báo cấu hình |
| 5 | **Bảo mật tệp**: tệp chứa lương, tài khoản ngân hàng được mã hóa / đặt mật khẩu; kiểm tra quyền kết xuất |
| 6 | **Ranh giới rõ**: hệ thống không thay thế ERP, không thay thế phần mềm kê khai — chỉ cung cấp dữ liệu đúng định dạng |
