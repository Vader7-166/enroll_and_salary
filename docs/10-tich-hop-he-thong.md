# 10. Tích hợp hệ thống

```
                        ┌──────────────────────────────────┐
                        │   HỆ THỐNG CHẤM CÔNG & TIỀN LƯƠNG │
                        └───┬────────┬────────┬────────┬───┘
          ĐẦU VÀO           │        │        │        │           ĐẦU RA
   ┌──────────────────┐     │        │        │        │    ┌──────────────────┐
   │ Máy chấm công     │────►│        │        │        │───►│ Bank Hub          │
   │ vân tay / FaceID  │     │        │        │        │    │ (lệnh chi lương)  │
   └──────────────────┘     │        │        │        │    └──────────────────┘
   ┌──────────────────┐     │        │        │        │    ┌──────────────────┐
   │ SSO / LDAP        │────►│        │        │        │───►│ ERP / Kế toán     │
   └──────────────────┘     │        │        │        │    │ (TK 622 / 642)    │
   ┌──────────────────┐     │        │        │        │    └──────────────────┘
   │ Hệ thống KPI      │────►│        │        │        │    ┌──────────────────┐
   │ / tuyển dụng      │     │        │        │        │───►│ Cổng BHXH & thuế  │
   └──────────────────┘     │        │        │        │    │ điện tử (ký số)   │
                            │        │        │        │    └──────────────────┘
                            │        │        │        │    ┌──────────────────┐
                            │        │        │        │───►│ Email / SMS / Zalo│
                            │        │        │        │    │ Teams / Slack     │
                            └────────┴────────┴────────┘    └──────────────────┘
```

---

## 1. Tích hợp máy chấm công

### 1.1. Hai đường tiếp nhận dữ liệu

Doanh nghiệp **chưa chốt hãng và model máy chấm công** (PV5-01, PV5-03), nên hệ thống hỗ trợ
đồng thời cả hai đường:

| Đường | Áp dụng cho | Cơ chế |
|---|---|---|
| **A. API / SDK phần cứng** | Máy đời mới có SDK | Dịch vụ nền chạy ngầm liên tục, kéo transaction log qua TCP/IP về máy chủ |
| **B. Import file** | Máy đời cũ | Nhập thủ công tệp `.csv` / `.txt` theo cấu trúc chuẩn hóa |

### 1.2. Dịch vụ nền đồng bộ

| Thuộc tính | Đặc tả |
|---|---|
| Hình thái | Windows Service hoặc Linux Daemon, chạy trong mạng nhà máy |
| Giao thức | TCP/IP tới thiết bị · HTTPS tới máy chủ ứng dụng |
| Chế độ | Kéo thời gian thực + đồng bộ định kỳ dự phòng |
| **Đồng bộ bù** | Mất kết nối → máy chấm công buffer nội bộ; khôi phục → tự đồng bộ bù toàn bộ khoảng gián đoạn, **bảo đảm không bỏ sót** |
| Idempotent | Khóa chống trùng `(mã máy, mã NV, thời điểm quẹt)` — đồng bộ bù nhiều lần không tạo bản ghi trùng |
| Bảo mật | Xác thực dịch vụ bằng chứng chỉ hoặc khóa API riêng, không dùng tài khoản người dùng |

### 1.3. Định dạng tệp log chuẩn

```
[Mã nhân viên],[Ngày quẹt YYYY-MM-DD],[Giờ quẹt HH:MM:SS],[Mã máy chấm công],[Hình thức: Vào/Ra/Tự động]
```

Ví dụ:

```
NV0142,2026-09-15,21:58:03,MAY-XUONG-01,Vào
NV0142,2026-09-16,06:12:47,MAY-XUONG-01,Ra
```

**Cấu hình ánh xạ (mapping):** hệ thống cho phép khai báo ánh xạ cột cho từng loại máy —
thứ tự cột, định dạng ngày giờ, bảng mã ký tự, ký tự phân tách, số dòng tiêu đề bỏ qua.

### 1.4. Giám sát thiết bị

| Chỉ số theo dõi | Ngưỡng cảnh báo |
|---|---|
| Trạng thái kết nối | Mất kết nối > 15 phút |
| Lần đồng bộ cuối | Không có dữ liệu mới > 2 giờ trong ca đang chạy |
| **Lệch đồng hồ thiết bị** | Lệch > 60 giây so với máy chủ → **yêu cầu đồng bộ NTP** |
| Bản ghi `UNMATCHED` | Vượt ngưỡng cấu hình → cảnh báo tới A1 và E3 |
| Dung lượng buffer thiết bị | Gần đầy → cảnh báo nguy cơ mất dữ liệu |

> **Ghi chú khảo sát.** Yêu cầu đồng bộ đồng hồ thiết bị qua NTP cần được bổ sung khi khảo
> sát hiện trường — đây là nguồn sai lệch dữ liệu khó phát hiện.

### 1.5. Ranh giới trách nhiệm

Hệ thống **chỉ tiêu thụ sự kiện quẹt thẻ** do thiết bị sinh ra. **Không** xử lý, lưu trữ hay
truyền tải dữ liệu sinh trắc học gốc (mẫu vân tay, mẫu khuôn mặt) — đây là ngoài phạm vi.

---

## 2. Tích hợp ngân hàng (Bank Hub)

### 2.1. Kết xuất lệnh chi lương

| Hạng mục | Đặc tả |
|---|---|
| Thời điểm | Sau khi kỳ lương ở trạng thái `LOCKED` |
| Định dạng | Tệp Excel có mã hóa, cấu trúc cột cố định theo từng ngân hàng |
| Cấu hình | Mẫu tệp khai báo được cho từng ngân hàng (danh sách ngân hàng chưa chốt — PV2-22) |

**Cấu trúc cột chuẩn:**

| Cột | Nội dung |
|---|---|
| Số tài khoản thụ hưởng | Giải mã từ trường 🔒 tại thời điểm kết xuất |
| Tên người thụ hưởng | Đúng tên trên tài khoản ngân hàng |
| Số tiền thực nhận (NET) | decimal, đã làm tròn theo chính sách |
| Mã ngân hàng nhận | |
| Nội dung chi trả | `[Mã nhân viên] Chuyển tiền lương tháng MM/YYYY` |

### 2.2. Quy tắc phí chuyển khoản

**Cấu hình mặc định: doanh nghiệp chịu mọi khoản phí chuyển tiền**; người lao động nhận
trọn vẹn số tiền thực lĩnh — theo Khoản 2 Điều 96 BLLĐ 2019 (BR-60).

### 2.3. Kiểm soát trước khi kết xuất

| Kiểm tra | Hành vi |
|---|---|
| Nhân sự thiếu số tài khoản | Chặn kết xuất, liệt kê danh sách |
| Số tài khoản trùng giữa hai nhân sự | Cảnh báo, yêu cầu xác nhận |
| Tổng tiền tệp ≠ tổng thực lĩnh bảng lương | **Chặn** |
| Kỳ lương chưa `LOCKED` | **Chặn** |
| Ghi audit log | Mọi lần kết xuất tệp chi lương |

---

## 3. Tích hợp ERP / kế toán

### 3.1. Đẩy bút toán chi phí lương

Sau khi Kế toán trưởng và Ban Giám đốc duyệt khóa bảng lương, hệ thống kết xuất và đẩy dữ
liệu hạch toán sang phần mềm kế toán/ERP (MISA, SAP, Oracle — chưa chốt, PV5-10).

### 3.2. Hạch toán theo trung tâm chi phí

| Đối tượng | Tài khoản | Ghi chú |
|---|---|---|
| Công nhân sản xuất tại xưởng | **Nợ TK 622** — Chi phí nhân công trực tiếp | Phục vụ tính giá thành sản phẩm |
| Khối văn phòng | **Nợ TK 642** — Chi phí quản lý doanh nghiệp | |

Việc phân loại dựa trên `cost_center_code` của đơn vị tổ chức mà nhân sự thuộc về **tại kỳ
lương đó**. Nhân sự chuyển bộ phận giữa tháng được phân bổ về hai cost center theo tỷ lệ
ngày công thực tế (BR-40).

### 3.3. Nhóm bút toán kết xuất

| Nhóm | Nội dung |
|---|---|
| Chi phí lương | Lương thời gian, lương sản phẩm, phụ cấp, OT, thưởng |
| Trích bảo hiểm phần doanh nghiệp | BHXH, BHYT, BHTN, KPCĐ 2% |
| Khấu trừ phần người lao động | BHXH 8%, BHYT 1,5%, BHTN 1%, đoàn phí 1% |
| Thuế TNCN khấu trừ | Phải nộp Nhà nước |
| Phải trả người lao động | Số thực lĩnh |

### 3.4. Phương án kết nối

| Phương án | Khi nào dùng |
|---|---|
| API trực tiếp | Khi ERP có API và đã chốt phương thức xác thực |
| Kết xuất tệp trung gian | Phương án mặc định khi chưa chốt ERP (giả định tạm) |

Cả hai phương án đều phải **idempotent**: đẩy lại cùng kỳ không tạo bút toán trùng.

---

## 4. Tích hợp cổng BHXH và thuế điện tử

### 4.1. Phạm vi

Hệ thống **không tự động nộp hồ sơ** lên cổng BHXH/thuế. Phạm vi là:

1. Kết xuất hồ sơ theo **định dạng tương thích** với phần mềm kê khai điện tử.
2. Hỗ trợ **ký số** trên hồ sơ kết xuất.
3. **Theo dõi trạng thái** hồ sơ đã nộp và kết quả trả về.

### 4.2. Bộ hồ sơ kết xuất

| Nhóm | Hồ sơ |
|---|---|
| BHXH | Báo tăng, báo giảm, điều chỉnh mức đóng, truy thu – thoái thu, hồ sơ ốm đau – thai sản |
| Thuế TNCN | Tờ khai khấu trừ tháng/quý, tờ khai quyết toán năm kèm phụ lục, chứng từ khấu trừ điện tử |
| Lao động | Báo cáo tình hình sử dụng lao động nộp Sở LĐ-TB&XH (định kỳ 6 tháng) |
| Làm thêm giờ | Thông báo huy động OT 200–300 giờ/năm gửi Sở LĐ-TB&XH |

### 4.3. Đối chiếu C12

Hằng tháng, đối chiếu số liệu hệ thống với Thông báo kết quả đóng bảo hiểm (mẫu C12) của cơ
quan BHXH; liệt kê chênh lệch theo từng nhân sự và sinh khoản điều chỉnh ở kỳ kế tiếp.

---

## 5. Tích hợp hệ thống nội bộ

| Hệ thống | Chiều | Nội dung | Mức |
|---|---|---|---|
| SSO / LDAP | Vào | Xác thực người dùng, đồng bộ tài khoản | S |
| Email gateway | Ra | Thông báo, payslip, OTP | M |
| SMS gateway | Ra | **OTP xem phiếu lương**, cảnh báo khẩn | M |
| Zalo / Teams / Slack | Ra | Thông báo đơn cần duyệt, cảnh báo trần OT | S |
| Hệ thống đánh giá KPI | Vào | Kết quả KPI làm đầu vào tính lương sản phẩm, thưởng | C |
| Hệ thống tuyển dụng | Vào | Hồ sơ ứng viên trúng tuyển → tạo hồ sơ nhân sự | C |
| Hệ thống kế hoạch sản xuất | Vào | Kế hoạch sản lượng → nhu cầu nhân lực theo ca, nhu cầu OT | C |

---

## 6. API mở và nhập liệu hàng loạt

| Năng lực | Đặc tả | Mức |
|---|---|---|
| API đọc dữ liệu công, lương | REST + JSON, xác thực bằng khóa API riêng, áp đủ hai trục phân quyền | S |
| API đẩy dữ liệu chấm công | Cho phép nguồn thứ ba đẩy lượt quẹt, có khóa chống trùng | M |
| Nhập liệu hàng loạt | Import hồ sơ nhân sự, hợp đồng, số dư phép, lịch sử lương — có bước xem trước và báo cáo lỗi từng dòng | M |
| Kết xuất hàng loạt | Export theo bộ lọc, ghi audit log, giới hạn số bản ghi mỗi lần | M |
| Rate limit | Áp cho mọi API mở | S |

---

## 7. Nguyên tắc chung cho mọi tích hợp

| # | Nguyên tắc |
|---|---|
| 1 | **Idempotent**: gọi lại cùng dữ liệu không tạo bản ghi trùng hoặc bút toán trùng |
| 2 | **Ghi vết đầy đủ**: mọi lần gửi/nhận ghi audit log kèm mã tham chiếu, trạng thái, thông điệp lỗi |
| 3 | **Không chặn luồng chính**: lỗi tích hợp ngoại vi không được làm dừng nghiệp vụ chấm công – tính lương |
| 4 | **Hàng đợi có thử lại**: tác vụ gửi ra ngoài đưa vào hàng đợi, thử lại theo cấp số nhân, có hàng đợi lỗi |
| 5 | **Cấu hình hơn lập trình**: thêm ngân hàng mới, thêm loại máy chấm công mới là khai báo cấu hình, không sửa mã |
| 6 | **Bảo mật kênh**: TLS cho mọi kênh; xác thực bằng khóa dịch vụ riêng, không dùng tài khoản người dùng |
| 7 | **Ranh giới rõ**: hệ thống không thay thế ERP, không thay thế phần mềm kê khai — chỉ cung cấp dữ liệu đúng định dạng |
