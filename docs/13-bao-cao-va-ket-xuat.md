# 13. Báo cáo và kết xuất

**R1:** báo cáo lõi ở đây, gồm công/OT theo tuần, phúc lợi, C12 và dự thảo quyết toán năm,
thuộc bản đầu theo [19](19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md); không chuyển sang
sau cắt chuyển. Không bao gồm chứng nhận SMETA/BSCI/RBA, nộp thuế/BHXH trực tuyến hoặc
đẩy ERP. Trạng thái mô phỏng/chính thức và quyền kết xuất phải hiển thị đúng.

Đầu ra của hệ thống gồm **báo cáo phân hệ 10** (10.1 – 10.4) và **tệp kết xuất nghiệp vụ** của
các phân hệ khác (phiếu lương, file chi lương, danh sách BH, dự thảo quyết toán, chi phí phúc
lợi). Mọi báo cáo đi qua luồng AD-10 / SQ-13: chọn loại, phạm vi, thời gian → kiểm tra quyền
xem theo vai trò và đơn vị → hiển thị kèm **trạng thái dữ liệu (nháp / chính thức)** → kiểm tra
quyền kết xuất → tạo tệp.

```
┌─────────────────────┬─────────────────────┬─────────────────────┬─────────────────────┐
│ 10.1 CÔNG, OT        │ 10.2 BIẾN ĐỘNG       │ 10.3 QUỸ LƯƠNG       │ 10.4 BH, THUẾ        │
│ theo tổ và xưởng     │ nhân sự              │ theo cơ sở, đơn vị   │                      │
├─────────────────────┼─────────────────────┼─────────────────────┼─────────────────────┤
│ Bảng chấm công tháng │ Vào làm, nghỉ việc   │ Bảng thanh toán lương│ Bảng trích BH        │
│ OT theo tổ / xưởng   │ Điều chuyển          │ Bảng thanh toán thưởng│ Danh sách tăng giảm  │
│ Lũy kế OT so trần    │ Tỷ lệ nghỉ việc      │ Phân bổ chi phí lương│ Thuế khấu trừ tháng  │
│ Đi muộn / về sớm     │                      │ (TK 622 / 642)       │ Tổng hợp quyết toán  │
│ Ngoại lệ chưa xử lý  │                      │                      │ Sử dụng lao động     │
├─────────────────────┼─────────────────────┼─────────────────────┼─────────────────────┤
│ TT: tổ · QĐ: xưởng   │ QĐ: xưởng            │ KT                   │ KT                   │
└─────────────────────┴─────────────────────┴─────────────────────┴─────────────────────┘
```

Người lao động, lãnh đạo, công đoàn, cơ quan nhà nước **không truy cập hệ thống**; họ nhận bản
kết xuất do TT, QĐ hoặc KT xuất theo quy chế nội bộ.

---

## 1. Công, OT theo tổ và xưởng (10.1) — TT, QĐ

### 1.1. Bảng chấm công tháng

Kế thừa cấu trúc `mau-bang-cham-cong-thang-2026.xlsx`, bổ sung các cột thiếu.

| Nhóm cột | Nội dung |
|---|---|
| Định danh | Mã NV · Họ tên · Chức vụ · Phòng ban / Tổ |
| Chi tiết ngày | Ký hiệu công từng ngày trong kỳ (26/N-1 → 25/N) |
| Tổng hợp công | Công ngày `X` · Công đêm `Đ` · Phép `Ph` · Nghỉ lễ `L` · Nghỉ không lương `Kl` |
| Tổng hợp OT | **Số giờ OT ngày** · **Số giờ OT đêm** (tách theo loại ngày) |
| Kết quả | Tổng công quy đổi · Trạng thái bảng công (Nháp / Tổ đã xác nhận / Xưởng đã chốt / Đã khóa) |

> **Khác biệt so với mẫu Excel hiện hành:** mẫu cũ chỉ đếm ký hiệu bằng `COUNTIF`, không tách
> được giờ OT theo loại ngày và không phân biệt ca đêm bắc cầu. Bảng công mới lấy số liệu từ
> `daily_attendance` và `attendance_hour_segment`.

**Ràng buộc:** sau khi KT khóa kỳ công, bảng công là **chỉ đọc**, mọi truy vấn trả về dữ liệu
từ snapshot kèm mã băm (BR-65).

### 1.2. Báo cáo công, OT khác

| Báo cáo | Nội dung | Phạm vi | Tần suất |
|---|---|---|---|
| **OT theo tổ / xưởng** | Số giờ OT ngày / đêm theo loại ngày, so với trần luật | TT: tổ · QĐ: xưởng | Hằng tuần / tháng |
| **Lũy kế OT theo nhân sự** | Giờ OT lũy kế tháng và năm, số giờ còn được huy động hợp pháp | TT, QĐ | Liên tục |
| **Đi muộn / về sớm** | Số lần, số phút theo tổ và cá nhân — **phục vụ đánh giá chuyên cần, không dùng để trừ lương** | TT, QĐ | Hằng tháng |
| **Ngoại lệ công chưa xử lý** | Ngày công `ERR`, giải trình đang thiếu căn cứ | TT, QĐ | Hằng ngày |
| **Tỷ lệ vắng mặt** (6.5) | Số ngày nghỉ theo loại, tỷ lệ vắng theo tổ, theo ngày | QĐ | Hằng tuần |
| **Giờ làm việc theo tuần** | Phục vụ đánh giá SMETA / BSCI / RBA (Could) | QĐ | Theo kỳ đánh giá |

---

## 2. Biến động nhân sự (10.2) — QĐ

| Báo cáo | Nội dung | Phạm vi | Tần suất |
|---|---|---|---|
| **Biến động nhân sự** | Vào làm, nghỉ việc, điều chuyển trong / ngoài xưởng | QĐ: xưởng | Hằng tháng |
| **Tỷ lệ nghỉ việc** | Theo bộ phận, theo thâm niên, theo loại HĐ | QĐ: xưởng | Hằng quý |

Theo BFD, use case PhanHe10 và SQ-13, báo cáo 10.2 chỉ dành cho **QĐ**. KT nắm biến động nhân
sự trực tiếp qua phân hệ 2 (hồ sơ, hợp đồng, quyết định); các danh sách KT dùng như cảnh báo hợp
đồng (2.4) và số dư phép (6.2) là đầu ra của phân hệ tương ứng, liệt kê ở §5.

---

## 3. Quỹ lương theo cơ sở, đơn vị (10.3) — KT

### 3.1. Bảng thanh toán tiền lương

| Nhóm cột | Nội dung |
|---|---|
| Định danh | Mã NV · Họ tên · Phòng ban · Chức danh |
| Căn cứ | Lương hợp đồng · Ngày công chuẩn · Ngày công thực tế |
| Thu nhập | Lương thời gian / sản phẩm · Phụ cấp (từng khoản) · Lương OT ngày · Lương OT đêm · Phụ cấp ca đêm · Thưởng |
| Tổng thu nhập | |
| Khấu trừ | BHXH 8% · BHYT 1,5% · BHTN 1% · Đoàn phí · Thuế TNCN · Khấu trừ khác |
| Điều chỉnh | Truy lĩnh / truy thu (ghi rõ **kỳ gốc**) · Tiền đền bù chậm trả |
| **Thực lĩnh** | |

Mỗi ô số tiền hỗ trợ **drill-down**: xem công thức, giá trị từng biến, tham số đã dùng và dữ
liệu công gốc. Bản kết xuất dùng để lãnh đạo ký duyệt ngoài hệ thống (nếu quy chế yêu cầu).

### 3.2. Bảng thanh toán tiền thưởng

Tách riêng khỏi bảng lương vì thưởng có **kỳ chi trả riêng** và ảnh hưởng thuế của tháng chi
trả. Gồm: loại thưởng · căn cứ · số tiền · phần chịu thuế · thuế khấu trừ · thực nhận.

### 3.3. Bảng phân bổ chi phí lương và quỹ lương

| Cột | Nội dung |
|---|---|
| Cơ sở · Cost center | Mã trung tâm chi phí |
| Tài khoản | **TK 622** (nhân công trực tiếp) / **TK 642** (quản lý doanh nghiệp) |
| Chi phí lương | |
| Trích BH phần doanh nghiệp | BHXH, BHYT, BHTN |
| KPCĐ 2% | |
| Tổng chi phí | |

Nhân sự thuộc nhiều đơn vị trong kỳ được phân bổ theo **tỷ lệ ngày công thực tế** của từng đoạn.
Bảng này là đầu vào cho kế toán tổng hợp / ERP ([11 §3](11-tich-hop-he-thong.md)).

---

## 4. Báo cáo BH, thuế (10.4) — KT

| Báo cáo / tệp | Cơ quan / người nhận | Tần suất | Chức năng |
|---|---|---|---|
| **Bảng trích BH** (NLĐ, DN, KPCĐ) | Nội bộ | Hằng tháng | 8.2 |
| **Danh sách báo tăng / giảm / điều chỉnh BH** | Cơ quan BHXH (KT kê khai ngoài hệ thống) | Hằng tháng | 8.3 |
| **Đối chiếu C12** | Nội bộ | Hằng tháng | 8.3 |
| **Bảng thuế TNCN khấu trừ** | Cơ quan Thuế (KT kê khai ngoài hệ thống) | Tháng / quý | 8.4 |
| **Dự thảo hồ sơ quyết toán thuế năm** | Cơ quan Thuế | Hằng năm | 8.5 |
| **Tình hình sử dụng lao động** | Sở LĐ-TB&XH | 6 tháng | 10.4 |
| **Số liệu OT 200 – 300 giờ / năm** | Sở LĐ-TB&XH | Hằng năm | 10.4 (lũy kế từ 5.3) |
| **Sổ quản lý lao động** (20 tiêu chí) | Thanh tra lao động | Kết xuất khi cần | 2.1 |

Báo cáo thuế hiển thị **ngày chi trả, kỳ thuế, cách khấu trừ, bộ quy tắc/căn cứ**, phần miễn
và chịu thuế theo khoản. Phân biệt số dự kiến, số đã khấu trừ/khai/nộp và số tính lại nghĩa vụ;
quyết toán nhóm theo năm chi trả, không theo tên kỳ công. Điều chỉnh chuyển tiếp 6 tháng đầu
2026 phải dẫn về hồ sơ gốc và không làm đổi số liệu lịch sử ([12 §2.7](12-tuan-thu-phap-ly.md)).

---

## 5. Tệp kết xuất nghiệp vụ khác

| Đầu ra | Chức năng | Tác nhân | Ghi chú |
|---|---|---|---|
| **Phiếu lương** từng người | 7.6 | KT | PDF đặt mật khẩu hoặc bản in phát kín ([10 §3.3](10-phan-quyen-va-bao-mat.md)) |
| **File chi lương** | 7.6 | KT | Theo mẫu ngân hàng; không đồng nghĩa đã thanh toán ([11 §2](11-tich-hop-he-thong.md)) |
| **Bảng chênh lệch truy lĩnh / truy thu** theo kỳ | 7.4 | KT | Trước khi xác nhận bút toán |
| **Chi phí phúc lợi** theo đơn vị, kỳ, loại | 9.4 | KT | Gồm trợ cấp thôi việc / mất việc |
| **Lịch ca đã duyệt** của tổ | 3.4 | TT, QĐ | In để phổ biến cho công nhân |
| **Cảnh báo hợp đồng** | 2.4 | KT | HĐ hết hạn trong 30 / 60 ngày hoặc đã quá hạn, hết hạn thử việc, đã ký 2 lần HĐ xác định thời hạn; kèm số ngày còn lại (SQ-14) |
| **Số dư phép cuối kỳ** | 6.2 | KT | Số dư còn lại, phần chuyển sang năm sau, phần sắp hết hạn; TT xem số dư của tổ |
| **Bằng chứng kiểm tra tuân thủ `CP-01`…`CP-09`** | 7.2 | KT | Lưu kèm mỗi kỳ lương, kết xuất PDF |

### 5.1. Báo cáo bằng chứng tuân thủ

Kết xuất PDF cho từng kỳ lương, gồm:

```
┌──────────────────────────────────────────────────────────────┐
│ BÁO CÁO KIỂM TRA TUÂN THỦ — KỲ LƯƠNG 09/2026 — NM BẮC NINH    │
├──────────────────────────────────────────────────────────────┤
│ Thời điểm khóa kỳ:  28/09/2026 16:42                          │
│ Người khóa kỳ:      [KT – Kế toán tiền lương]                  │
│ Mã băm snapshot:    a3f8…                                     │
├──────────────────────────────────────────────────────────────┤
│ Mã     Kiểm tra                          Kết quả   Vi phạm    │
│ CP-01  Lương tối thiểu vùng               ĐẠT       0          │
│ CP-02  Lương thử việc ≥ 85%               ĐẠT       0          │
│ CP-03  Trần làm thêm giờ                  ĐẠT       0          │
│ CP-04  Khấu trừ ≤ 30% NET                 ĐẠT       0          │
│ CP-05  Thực lĩnh không âm                 ĐẠT       0          │
│ CP-06  Ngày công ERR đã xử lý hết         ĐẠT       0          │
│ CP-07  Lương đóng BH đầy đủ               ĐẠT       0          │
│ CP-08  Chênh lệch kỳ trước       CẢNH BÁO — 3 (đã xác nhận)   │
│ CP-09  Thu nhập sản phẩm ≥ tối thiểu      ĐẠT       0          │
├──────────────────────────────────────────────────────────────┤
│ Tham số pháp lý đã áp dụng:                                   │
│   MIN_WAGE_MONTH_I    = 5.310.000 (NĐ 293/2025, từ 01/01/2026) │
│   OT_RATE_NORMAL      = 150%      (Điều 98 BLLĐ 2019)          │
│   PIT_DEDUCTION_SELF  = 15.500.000 (NQ 110/2025/UBTVQH15)      │
│   …                                                            │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Quy tắc chung cho mọi báo cáo

| # | Quy tắc |
|---|---|
| 1 | **Kiểm tra quyền theo vai trò và đơn vị** trước khi truy vấn và trước khi kết xuất; báo cáo không được là đường vòng để xem dữ liệu ngoài phạm vi |
| 2 | **Hiển thị trạng thái dữ liệu** nháp / chính thức trên báo cáo và tệp kết xuất |
| 3 | **Che trường nhạy cảm** theo quyền chi tiết, kể cả trong tệp kết xuất |
| 4 | **Dữ liệu kỳ đã khóa lấy từ snapshot**, không tính lại — báo cáo in lại sau nhiều tháng vẫn khớp số cũ |
| 5 | **Cấu trúc tổ chức theo thời điểm**: báo cáo kỳ 09/2026 hiển thị theo cây tổ chức tại kỳ đó |
| 6 | **Ghi audit log** mọi lần kết xuất báo cáo chứa dữ liệu lương hoặc dữ liệu cá nhân |
| 7 | **Ghi rõ nguồn và thời điểm**: tiêu đề, kỳ dữ liệu, thời điểm kết xuất, người kết xuất |
| 8 | **Giới hạn khối lượng**: cảnh báo và ghi log khi kết xuất vượt ngưỡng số bản ghi |
| 9 | **Định dạng**: Excel / PDF. Không có trình tạo báo cáo tùy biến hay dashboard lãnh đạo trong phạm vi hiện tại |
