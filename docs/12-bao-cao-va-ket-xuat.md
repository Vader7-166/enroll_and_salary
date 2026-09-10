# 12. Báo cáo và kết xuất

Bốn nhóm đầu ra, phân theo mục đích sử dụng:

```
┌───────────────────┬───────────────────┬───────────────────┬───────────────────┐
│ 1. CHỨNG TỪ       │ 2. BÁO CÁO        │ 3. BÁO CÁO        │ 4. PHÂN TÍCH &    │
│    KẾ TOÁN         │    NGHIỆP VỤ      │    TUÂN THỦ       │    DASHBOARD      │
├───────────────────┼───────────────────┼───────────────────┼───────────────────┤
│ Bảng chấm công    │ OT theo bộ phận   │ Sổ QL lao động    │ Chi phí nhân sự   │
│ Bảng thanh toán   │ Đi muộn/về sớm    │ Tình hình sử dụng │ theo cost center  │
│ tiền lương        │ Nghỉ phép, số dư  │ lao động (Sở LĐ)  │ So sánh ngân sách │
│ Bảng thanh toán   │ Biến động nhân sự │ Báo cáo BHXH      │ Dashboard vai trò │
│ tiền thưởng       │ Tỷ lệ nghỉ việc   │ Báo cáo thuế TNCN │ Report builder    │
│ Bảng phân bổ      │                   │ Bằng chứng CP-xx  │                   │
│ chi phí lương     │                   │ Giờ làm theo tuần │                   │
│                   │                   │ (SMETA/BSCI/RBA)  │                   │
├───────────────────┼───────────────────┼───────────────────┼───────────────────┤
│ Người dùng:       │ Người dùng:       │ Người dùng:       │ Người dùng:       │
│ D1, D2, A3        │ A1, A5, B1, B2    │ A4, A5, E1        │ D3, D4, D2        │
└───────────────────┴───────────────────┴───────────────────┴───────────────────┘
```

---

## 1. Chứng từ theo mẫu kế toán

### 1.1. Bảng chấm công tháng

Kế thừa cấu trúc `mau-bang-cham-cong-thang-2026.xlsx`, bổ sung các cột thiếu.

| Nhóm cột | Nội dung |
|---|---|
| Định danh | Mã NV · Họ tên · Chức vụ · Phòng ban / Tổ |
| Chi tiết ngày | Ký hiệu công từng ngày trong kỳ (26/N-1 → 25/N) |
| Tổng hợp công | Công ngày `X` · Công đêm `Đ` · Phép `Ph` · Nghỉ lễ `L` · Nghỉ không lương `Kl` |
| Tổng hợp OT | **Số giờ OT ngày** · **Số giờ OT đêm** (tách theo loại ngày) |
| Kết quả | Tổng công quy đổi |

> **Khác biệt so với mẫu Excel hiện hành:** mẫu cũ chỉ đếm ký hiệu bằng `COUNTIF`, không tách
> được giờ OT theo loại ngày và không phân biệt ca đêm bắc cầu. Bảng công mới lấy số liệu từ
> `daily_attendance` và `attendance_hour_segment`.

**Ràng buộc:** sau khi kỳ công `LOCKED`, bảng công là **chỉ đọc**, mọi truy vấn trả về dữ
liệu từ snapshot kèm mã băm (BR-65).

### 1.2. Bảng thanh toán tiền lương

| Nhóm cột | Nội dung |
|---|---|
| Định danh | Mã NV · Họ tên · Phòng ban · Chức danh |
| Căn cứ | Lương hợp đồng · Ngày công chuẩn · Ngày công thực tế |
| Thu nhập | Lương thời gian/sản phẩm · Phụ cấp (từng khoản) · Lương OT ngày · Lương OT đêm · Phụ cấp ca đêm · Thưởng |
| Tổng thu nhập | |
| Khấu trừ | BHXH 8% · BHYT 1,5% · BHTN 1% · Đoàn phí · Thuế TNCN · Khấu trừ khác |
| Điều chỉnh | Truy lĩnh / truy thu (ghi rõ **kỳ gốc**) · Tiền đền bù chậm trả |
| **Thực lĩnh** | |

Mỗi ô số tiền hỗ trợ **drill-down**: bấm vào để xem công thức, giá trị từng biến, tham số đã
dùng và dữ liệu công gốc.

### 1.3. Bảng thanh toán tiền thưởng

Tách riêng khỏi bảng lương vì thưởng có **kỳ chi trả riêng** và ảnh hưởng thuế của tháng chi
trả. Gồm: loại thưởng · căn cứ · số tiền · phần chịu thuế · thuế khấu trừ · thực nhận.

### 1.4. Bảng phân bổ chi phí lương

| Cột | Nội dung |
|---|---|
| Cost center | Mã trung tâm chi phí |
| Tài khoản | **TK 622** (nhân công trực tiếp) / **TK 642** (quản lý doanh nghiệp) |
| Chi phí lương | |
| Trích BH phần doanh nghiệp | BHXH, BHYT, BHTN |
| KPCĐ 2% | |
| Tổng chi phí | |

Nhân sự thuộc nhiều đơn vị trong kỳ được phân bổ theo **tỷ lệ ngày công thực tế** của từng đoạn.

---

## 2. Báo cáo nghiệp vụ

| Báo cáo | Nội dung | Người dùng | Tần suất |
|---|---|---|---|
| **OT theo bộ phận** | Số giờ OT ngày/đêm, chi phí OT, so với ngân sách, so với trần luật | B2, A5, D3 | Hằng tuần / tháng |
| **Lũy kế OT theo nhân sự** | Giờ OT lũy kế tháng và năm, số giờ còn được huy động hợp pháp | B1, B2, A5 | Liên tục |
| **Đi muộn / về sớm** | Số lần, số phút, theo tổ và cá nhân — **phục vụ đánh giá chuyên cần, không dùng để trừ lương** | B1, B2 | Hằng tháng |
| **Tình hình nghỉ phép** | Số ngày nghỉ theo loại, tỷ lệ vắng mặt theo tổ | B1, B2, A5 | Hằng tháng |
| **Số dư phép cuối kỳ** | Số dư còn lại, phần chuyển sang năm sau, phần sắp hết hạn | A5, C1/C2 | Hằng quý |
| **Biến động nhân sự** | Tuyển mới, nghỉ việc, điều chuyển, thăng chức | A5, D3, D4 | Hằng tháng |
| **Tỷ lệ nghỉ việc** | Theo bộ phận, theo thâm niên, theo loại HĐ | A5, D4 | Hằng quý |
| **Ngoại lệ công chưa xử lý** | Danh sách ngày công `ERR`, đơn giải trình đang chờ | A1, B1, B2 | Hằng ngày |
| **Cảnh báo hợp đồng** | HĐ sắp hết hạn 30/60 ngày, hết hạn thử việc, đã ký 2 lần HĐ xác định thời hạn | A2, A5 | Hằng tuần |

---

## 3. Báo cáo tuân thủ

| Báo cáo | Cơ quan nhận | Tần suất | Căn cứ |
|---|---|---|---|
| **Sổ quản lý lao động điện tử** (20 tiêu chí) | Thanh tra lao động | Liên tục, kết xuất khi cần | Khoản 2 Điều 3 NĐ 145/2020 |
| **Tình hình sử dụng lao động** | Sở LĐ-TB&XH | 6 tháng | BLLĐ 2019 |
| **Thông báo huy động OT 200–300h/năm** | Sở LĐ-TB&XH | Hằng năm | Điều 59 NĐ 145/2020 |
| **Hồ sơ báo tăng / giảm / điều chỉnh BHXH** | Cơ quan BHXH | Hằng tháng | Luật BHXH |
| **Đối chiếu C12** | Nội bộ + cơ quan BHXH | Hằng tháng | – |
| **Tờ khai khấu trừ thuế TNCN** | Cơ quan Thuế | Tháng / quý | Luật Thuế TNCN |
| **Tờ khai quyết toán thuế TNCN năm** | Cơ quan Thuế | Hằng năm | Luật Thuế TNCN |
| **Chứng từ khấu trừ thuế TNCN** | Người lao động | Theo yêu cầu | Có quản lý số seri |
| **Bằng chứng kiểm tra tuân thủ `CP-01`…`CP-09`** | Thanh tra | Lưu kèm mỗi kỳ lương | Kết xuất PDF |
| **Báo cáo giờ làm việc theo tuần** | Đánh giá SMETA / BSCI / RBA | Theo kỳ đánh giá | Khách hàng yêu cầu (PV6 chưa chốt) |

### 3.1. Báo cáo bằng chứng tuân thủ

Kết xuất PDF cho từng kỳ lương, gồm:

```
┌──────────────────────────────────────────────────────────────┐
│ BÁO CÁO KIỂM TRA TUÂN THỦ — KỲ LƯƠNG 09/2026                 │
├──────────────────────────────────────────────────────────────┤
│ Thời điểm khóa kỳ:  28/09/2026 16:42                          │
│ Người khóa kỳ:      [A3 – Chuyên viên tiền lương]             │
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
│   MIN_WAGE_MONTH_I = 5.310.000 (NĐ 293/2025, từ 01/01/2026)   │
│   OT_RATE_NORMAL   = 150%      (Điều 98 BLLĐ 2019)            │
│   …                                                            │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Phân tích và dashboard

### 4.1. Phân tích chi phí nhân sự

| Chiều phân tích | Nội dung |
|---|---|
| Theo cost center | Chi phí lương, BH, KPCĐ; so sánh với ngân sách |
| Theo phòng ban / phân xưởng / tổ | Chi phí và số lao động |
| Theo cấu phần | Tỷ trọng lương cơ bản / phụ cấp / OT / thưởng |
| Theo thời gian | Xu hướng 12 kỳ gần nhất, so cùng kỳ năm trước |
| Chi phí OT | Tỷ trọng OT trong tổng quỹ lương, cảnh báo khi vượt ngưỡng |

### 4.2. Dashboard theo vai trò

| Vai trò | Chỉ số hiển thị |
|---|---|
| **A1 — Chấm công** | Ngày công `ERR` chưa xử lý · Đơn giải trình chờ duyệt · Trạng thái thiết bị chấm công · Tiến độ chốt công theo tổ |
| **A3 — Tiền lương** | Tiến độ kỳ lương · Kết quả `CP-01`…`CP-09` · Số dòng chênh lệch chờ xác nhận · **Cảnh báo đỏ hạn chi lương** · Phản hồi sai lệch chờ xử lý |
| **A5 — Trưởng phòng NS** | Đơn chờ duyệt · Cảnh báo hợp đồng · Lũy kế OT toàn công ty · Tỷ lệ nghỉ việc |
| **B1 / B2 — Quản lý sản xuất** | Ngày công `ERR` của tổ · Đơn chờ duyệt · **Lũy kế OT so với trần** · Tỷ lệ vắng mặt · Lịch ca tuần tới |
| **D2 — Kế toán trưởng** | Quỹ lương so ngân sách · Bảng lương chờ duyệt · **Cảnh báo hạn chi lương** · Nghĩa vụ BH và thuế phải nộp |
| **D3 / D4 — Lãnh đạo** | Chi phí lao động theo xưởng · Xu hướng chi phí · Định biên · Tỷ trọng OT · Cảnh báo tuân thủ mức cao |
| **E1 — Công đoàn** | Đoàn phí đối chiếu · Nhân sự chạm trần OT · Đơn nghỉ bị từ chối · Khiếu nại đang xử lý |

### 4.3. Trình tạo báo cáo tùy biến

| Năng lực | Mô tả |
|---|---|
| Chọn nguồn dữ liệu | Trong phạm vi quyền của người dùng |
| Chọn cột, bộ lọc, nhóm | Không cần lập trình |
| Lưu mẫu báo cáo | Dùng lại và chia sẻ trong phạm vi cho phép |
| Lên lịch gửi tự động | Email định kỳ |
| Xuất Excel / PDF | Ghi audit log mỗi lần xuất |

---

## 5. Quy tắc chung cho mọi báo cáo

| # | Quy tắc |
|---|---|
| 1 | **Áp đủ hai trục phân quyền**: vai trò + phạm vi dữ liệu; báo cáo không được là đường vòng để xem dữ liệu ngoài phạm vi |
| 2 | **Che trường nhạy cảm** theo quyền chi tiết, kể cả trong tệp kết xuất |
| 3 | **Dữ liệu kỳ đã chốt lấy từ snapshot**, không tính lại — bảo đảm báo cáo in lại sau nhiều tháng vẫn khớp số cũ |
| 4 | **Cấu trúc tổ chức theo thời điểm**: báo cáo kỳ 09/2026 hiển thị theo cây tổ chức tại kỳ đó, không theo cấu trúc hiện tại |
| 5 | **Ghi audit log** mọi lần kết xuất báo cáo chứa dữ liệu lương hoặc dữ liệu cá nhân |
| 6 | **Ghi rõ nguồn và thời điểm**: mỗi báo cáo có tiêu đề, kỳ dữ liệu, thời điểm kết xuất, người kết xuất |
| 7 | **Giới hạn khối lượng**: cảnh báo và ghi log khi kết xuất vượt ngưỡng số bản ghi |
