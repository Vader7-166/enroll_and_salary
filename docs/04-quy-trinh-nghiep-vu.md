# 04. Quy trình nghiệp vụ

Tài liệu mô tả các quy trình end-to-end của hệ thống. Mỗi quy trình chỉ rõ đầu vào, các
bước, vai trò thực hiện, điều kiện chuyển bước và đầu ra.

---

## 1. Chu trình tháng tổng thể

Đây là quy trình xương sống, các quy trình còn lại là chi tiết hóa từng chặng.

```
        Kỳ công N: 26/(N-1) ──────────────────────────────► 25/N          Chi lương: 10/(N+1)
             │                                               │                    │
 ┌───────────┴──────────┐                    ┌───────────────┴──────┐   ┌─────────┴────────┐
 │ GIAI ĐOẠN 1          │                    │ GIAI ĐOẠN 2          │   │ GIAI ĐOẠN 3      │
 │ Chuẩn bị & vận hành  │                    │ Chốt công            │   │ Tính & chi lương │
 └──────────────────────┘                    └──────────────────────┘   └──────────────────┘

 QT-01 Xếp lịch ca          B1,B2            QT-04 Xác nhận công tổ   B1   QT-06 Tính lương    A3
 QT-02 Thu thập chấm công   Hệ thống         QT-05 Chốt & khóa công  A1,A3  QT-07 Duyệt lương  A5,D2,D4
 QT-03 Xử lý ngoại lệ       C1,B1,A1                                        QT-08 Chi lương    D1,D2
       Đăng ký & duyệt OT   C1,B1,B2                                        QT-09 Payslip      A3
       Đơn nghỉ             C1,B1,A1                                        QT-10 BHXH & thuế  A4
```

### Lịch vận hành chuẩn theo ngày

| Thời điểm | Hoạt động | Vai trò |
|---|---|---|
| Trước ngày 20 tháng N-1 | Lập và duyệt lịch ca tháng N | B1 → B2 |
| Hằng ngày | Đồng bộ dữ liệu quẹt thẻ, xử lý ngoại lệ phát sinh | Hệ thống, A1 |
| Hằng ngày | Đăng ký / xác nhận OT, nộp đơn nghỉ | C1, B1, B2 |
| Ngày 25 tháng N | Cut-off kỳ công | Hệ thống |
| Ngày 25 – 27 | Tổ trưởng xác nhận công của tổ | B1 |
| Ngày 26 – 28 | Đối chiếu, xử lý hết ngoại lệ, chạy đối soát chéo | A1 |
| Ngày 28 | **Chốt và khóa kỳ công** | A3 |
| Ngày 28 – 02 tháng N+1 | Chạy dry-run, đối chiếu chênh lệch, hoàn thiện bảng lương | A3 |
| Ngày 02 – 06 | Duyệt bảng lương 3 cấp | A5 → D2 → D4 |
| Ngày 06 – 08 | Khóa kỳ lương, lập lệnh chi ngân hàng | A3, D1 |
| **Ngày 10 tháng N+1** | **Chi lương** | D1, D2 |
| Ngày 10 – 12 | Phát hành payslip, đẩy bút toán ERP | A3, D1 |
| Trước ngày 20 | Báo tăng/giảm BHXH, kê khai khấu trừ thuế | A4 |

---

## 2. QT-01 · Xếp lịch ca và phân ca xoay vòng

**Đầu vào:** kế hoạch sản lượng (B3), định biên nhân sự, lịch nghỉ lễ năm.
**Đầu ra:** lịch ca đã duyệt cho tháng N.

| Bước | Hoạt động | Vai trò | Điều kiện chuyển bước |
|---|---|---|---|
| 1 | Nhận kế hoạch sản lượng, xác định nhu cầu nhân lực theo ca | B3 → B2 | – |
| 2 | Lập lịch ca cho tổ theo chu kỳ xoay tuần; hệ thống hỗ trợ sao chép lịch tháng trước và phân ca hàng loạt | B1 | Mỗi người đủ 3 loại ca trong tháng |
| 3 | Hệ thống kiểm tra ràng buộc: nghỉ giữa hai ca, trần giờ tuần, trùng đơn nghỉ đã duyệt | Hệ thống | Không còn vi phạm `BLOCKING` |
| 4 | Duyệt lịch ca toàn xưởng | B2 | – |
| 5 | Công bố lịch ca lên ESS; thông báo tới người lao động | Hệ thống | – |

**Nhánh phụ — đổi ca / hoán ca:**

```
C1 đề xuất đổi ca ──► B1 duyệt ──► Hệ thống kiểm tra ràng buộc ──► Cập nhật lịch
                          │                    │
                     từ chối             vi phạm trần giờ ──► chặn, nêu lý do
```

---

## 3. QT-02 · Thu thập và xử lý dữ liệu chấm công

**Đầu vào:** log quẹt thẻ thô từ máy chấm công.
**Đầu ra:** bản ghi ngày công dẫn xuất (`daily_attendance`).

```
┌──────────────┐   TCP/IP    ┌──────────────┐    ┌────────────────────────────────┐
│ Máy chấm công │───────────►│ Dịch vụ nền   │───►│ raw_punch (bất biến, chỉ ghi thêm) │
│ vân tay/FaceID│  hoặc file │ đồng bộ       │    └────────────────┬───────────────┘
└──────────────┘   .csv/.txt └──────────────┘                     │
                                    ▲                              ▼
                          mất mạng → buffer          ┌────────────────────────────┐
                          khôi phục → đồng bộ bù     │ 1. Khử quẹt trùng 5 phút    │
                                                     │ 2. Ghép cặp Vào/Ra          │
                                                     │ 3. Gán ca (ca đêm → ngày T) │
                                                     │ 4. Tách đoạn giờ ngày/đêm   │
                                                     │ 5. Sinh dữ liệu dẫn xuất    │
                                                     └────────────┬───────────────┘
                                                                  ▼
                                              ┌───────────────────────────────────┐
                                              │ daily_attendance                   │
                                              │ trạng thái: OK | ERR | PENDING     │
                                              └───────────────────────────────────┘
```

| Bước | Hoạt động | Xử lý ngoại lệ |
|---|---|---|
| 1 | Dịch vụ nền kéo log theo lịch (thời gian thực hoặc định kỳ) | Mất kết nối → máy buffer nội bộ, khôi phục thì đồng bộ bù |
| 2 | Ghi `raw_punch` nguyên trạng | Mã NV không khớp → vùng chờ `UNMATCHED`, không chặn luồng |
| 3 | Khử quẹt trùng trong 5 phút (BR-17) | – |
| 4 | Ghép cặp Vào/Ra theo ca đã phân bổ (BR-18) | Thiếu một lượt → gán `ERR`, thông báo ESS |
| 5 | Gán ca đêm bắc cầu về ngày T (BR-13) | – |
| 6 | Sinh dữ liệu dẫn xuất: công quy đổi, giờ ngày, giờ đêm, đi muộn, về sớm | – |
| 7 | Đối chiếu với lịch ca và đơn từ đã duyệt | Sai lệch → sinh cảnh báo `XC-xx` |

Chi tiết thuật toán: [05](05-thuat-toan-cham-cong-va-tinh-luong.md).

---

## 4. QT-03 · Xử lý ngoại lệ công

**Kích hoạt:** bản ghi ngày công có trạng thái `ERR`, hoặc sự cố thiết bị.

```
                  ┌────────────────────────────────────────────┐
                  │ Nguồn phát sinh ngoại lệ                    │
                  ├────────────────────────────────────────────┤
                  │ • Quên quẹt vào / ra                        │
                  │ • Đi muộn / về sớm cần giải trình           │
                  │ • Công tác ngoài, làm việc từ xa            │
                  │ • Máy chấm công hỏng / mất điện cả ngày     │
                  └───────────────────┬────────────────────────┘
                                      ▼
      ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
      │ C1 nộp giải trình │───►│ B1 duyệt cấp 1   │───►│ A1 xác nhận      │
      │ trên ESS/kiosk    │    │ (tổ trưởng)      │    │ và sửa công      │
      └──────────────────┘    └────────┬─────────┘    └────────┬─────────┘
                                       │ vượt số lần cho phép   │
                                       ▼                        ▼
                              ┌──────────────────┐    ┌──────────────────┐
                              │ B2 duyệt cấp 2   │    │ Ghi audit log:   │
                              │ (quản đốc)       │    │ cũ→mới, lý do,IP │
                              └──────────────────┘    └──────────────────┘
```

| Loại ngoại lệ | Cách xử lý | Người duyệt |
|---|---|---|
| Quên chấm công | Giải trình trực tuyến kèm xác nhận của tổ trưởng | B1 (vượt 3 lần/tháng → nâng cấp B2) |
| Đi muộn / về sớm < 15 phút | Giải trình, được duyệt thì khôi phục công tròn ca, không trừ lương | B2 |
| Công tác ngoài / làm việc từ xa | Đơn khai báo trước, đính kèm chứng từ | B1 → A1 |
| Sự cố máy chấm công cả ngày | A1 nhập bù hàng loạt cho toàn tổ, kèm biên bản sự cố của E3 | A1 + xác nhận B2 |
| Điều chỉnh công thủ công khác | Bắt buộc nhập lý do, ghi audit log | A1, có phê duyệt A3 |

---

## 5. QT-04 · Đăng ký và phê duyệt làm thêm giờ

**Đầu vào:** nhu cầu OT từ kế hoạch sản xuất hoặc đề xuất của tổ trưởng.
**Đầu ra:** bản ghi OT đã duyệt, là căn cứ đối chiếu với chấm công thực tế.

```
                    ┌────────────────────────────────┐
                    │ Kiểm tra trước khi cho đăng ký  │
                    ├────────────────────────────────┤
                    │ ✓ Có văn bản đồng ý OT (BR-28)  │
                    │ ✓ Chưa chạm trần ngày/tháng/năm │
                    │ ✓ Trong ngân sách OT bộ phận    │
                    └───────────────┬────────────────┘
                                    ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │              Rẽ nhánh theo mức độ (BR-30)                        │
     ├──────────────────────────┬──────────────────────────────────────┤
     │ OT < 2 giờ/ngày          │ OT > 3 giờ/ngày hoặc ngày nghỉ tuần   │
     │        ▼                 │        ▼                              │
     │  B2 duyệt (1 cấp)        │  B2 duyệt cấp 1 → A5 duyệt cấp 2      │
     └──────────────────────────┴──────────────────────────────────────┘
                                    ▼
                    ┌────────────────────────────────┐
                    │ Quá 12 giờ chưa duyệt           │
                    │ → tự động hủy + thông báo       │
                    └────────────────────────────────┘
                                    ▼
              Sau kỳ: đối chiếu giờ đăng ký ↔ giờ chấm công thực tế
                      → lấy giá trị NHỎ HƠN làm căn cứ tính lương
```

**Quy tắc chặn:**

| Điều kiện | Hành vi |
|---|---|
| Chưa có văn bản đồng ý OT của người lao động | **Chặn** đăng ký |
| Vượt trần 50% giờ làm bình thường trong ngày | **Chặn** |
| Chạm 90% trần tháng (36/40 giờ) | Cảnh báo tới B1, B2, A5 |
| Vượt trần 40 giờ/tháng hoặc 200 giờ/năm | **Chặn**, cần phê duyệt ghi đè có căn cứ |
| Vượt ngân sách OT của bộ phận | Cảnh báo, cần D3 duyệt |

---

## 6. QT-05 · Đơn nghỉ phép và chế độ

```
C1 nộp đơn trên ESS
   │
   ├─► Hệ thống kiểm tra số dư phép, trùng lịch ca, tỷ lệ vắng đồng thời của tổ
   │      │ không đủ số dư / vượt tỷ lệ vắng → cảnh báo, cho nộp kèm giải trình
   │      ▼
   ├─► Rẽ nhánh theo số ngày nghỉ:
   │      • ≤ 3 ngày   → B1 duyệt (1 cấp)
   │      • > 3 ngày   → B1 duyệt cấp 1 → A5 duyệt cấp 2
   │      • Nghỉ dài ngày / thai sản → thêm A4 xử lý hồ sơ BHXH
   │      ▼
   ├─► Duyệt xong → tự động điền ký hiệu công (Ph / L / Ô / TS / Kl) vào bảng công
   │                trừ quỹ phép tương ứng (ngày lễ xen giữa không trừ — BR-34)
   │      ▼
   └─► Đồng bộ sang bảng lương kỳ tương ứng
```

**Nhánh nghỉ đột xuất:** cho phép khai báo sau khi đã nghỉ, trong thời hạn cấu hình; đơn
vẫn phải qua đủ cấp duyệt trước khi chốt công.

**Nhánh hủy đơn:** hoàn lại số dư phép và xóa ký hiệu công tương ứng, ghi audit log.

---

## 7. QT-06 · Chốt và khóa kỳ công

**Điều kiện tiên quyết:** đã qua ngày cut-off (25 hằng tháng).

```
 Bước 1  B1 xác nhận công của tổ
         └─► Chặn nếu còn tổ chưa xác nhận
 Bước 2  A1 đối chiếu và xử lý hết ngoại lệ
         └─► Chặn nếu còn ngày công ERR chưa giải trình (XC-09)
 Bước 3  Hệ thống chạy bộ đối soát chéo XC-01…XC-10
         ├─► BLOCKING → chặn chốt, liệt kê bản ghi vi phạm kèm liên kết xử lý
         └─► WARNING  → cho phép chốt kèm xác nhận có ghi nhận người xác nhận
 Bước 4  A3 chốt và khóa kỳ công
         └─► Hệ thống lưu SNAPSHOT bảng công + mã băm nội dung
 Bước 5  Bảng công chuyển sang CHỈ ĐỌC, là đầu vào duy nhất cho tính lương
```

**Bộ đối soát chéo `XC-01` … `XC-10`:**

| Mã | Quy tắc đối soát | Mức mặc định |
|---|---|---|
| `XC-01` | Ngày có đơn nghỉ đã duyệt nhưng vẫn có dữ liệu chấm công | WARNING |
| `XC-02` | OT đã duyệt nhưng không có dữ liệu ra vào tương ứng | WARNING |
| `XC-03` | Có dữ liệu chấm công nhưng không có lịch phân ca | WARNING |
| `XC-04` | Giờ làm việc trong ngày vượt trần pháp luật | WARNING |
| `XC-05` | Một nhân sự quẹt tại hai địa điểm trong khoảng thời gian không thể di chuyển kịp | WARNING |
| `XC-06` | Công quy đổi âm hoặc vượt số ngày của kỳ | **BLOCKING** |
| `XC-07` | Nhân sự đã nghỉ việc nhưng vẫn phát sinh dữ liệu công | **BLOCKING** |
| `XC-08` | Nhân sự có hợp đồng hết hạn nhưng vẫn phát sinh dữ liệu công | WARNING |
| `XC-09` | Ngày công `ERR` chưa được giải trình | **BLOCKING** |
| `XC-10` | Số giờ OT lũy kế tháng/năm chạm hoặc vượt trần | WARNING |

---

## 8. QT-07 · Tính lương

**Điều kiện tiên quyết:** kỳ công tương ứng ở trạng thái `LOCKED`.

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Bước 1 · CHẠY THỬ (DRY-RUN)                                          │
 │   Không ghi nhận chính thức, sinh kết quả để đối chiếu               │
 └───────────────────────────────┬─────────────────────────────────────┘
                                 ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Bước 2 · SO SÁNH CHÊNH LỆCH VỚI KỲ TRƯỚC                             │
 │   Liệt kê nhân sự có biến động thu nhập vượt ngưỡng cấu hình         │
 │   Mỗi dòng bất thường phải được A3 xác nhận hoặc xử lý               │
 └───────────────────────────────┬─────────────────────────────────────┘
                                 ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Bước 3 · GIẢI TRÌNH TỪNG DÒNG (DRILL-DOWN)                           │
 │   Từ số tiền → công thức → giá trị từng biến → tham số → công gốc    │
 └───────────────────────────────┬─────────────────────────────────────┘
                                 ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ Bước 4 · CỔNG CHẶN TUÂN THỦ CP-01 … CP-09                            │
 │   BLOCKING → không cho chuyển sang duyệt                             │
 │   Kết quả kiểm tra LƯU KÈM KỲ LƯƠNG làm bằng chứng thanh tra         │
 └───────────────────────────────┬─────────────────────────────────────┘
                                 ▼
                        Chuyển sang QT-08 Duyệt
```

**Trình tự tính bên trong một lần chạy:**

```
1. Lấy dữ liệu công đã chốt từ snapshot kỳ công
2. Tra tham số theo ngày nghiệp vụ của kỳ (BR-03)
3. Dựng đồ thị phụ thuộc công thức, sắp thứ tự tô-pô
4. Tính lương thời gian / sản phẩm theo ngày công thực tế
5. Tính OT theo từng đoạn giờ đã tách, áp hệ số theo loại ngày
6. Tính phụ cấp ca đêm trên số giờ đêm thực tế
7. Cộng các khoản phụ cấp, thưởng, phúc lợi chịu thuế
   → TỔNG THU NHẬP
8. Xác định lương đóng BH (sàn / trần) → tính BHXH, BHYT, BHTN, đoàn phí
9. Bóc tách thu nhập miễn thuế (phần chênh lệch OT/đêm, ăn ca, trang phục…)
10. Trừ giảm trừ gia cảnh → thu nhập tính thuế → biểu 7 bậc → thuế TNCN
11. Áp các khoản khấu trừ khác (trần 30% NET — BR-44)
12. Cộng khoản truy lĩnh/truy thu từ kỳ trước, tiền đền bù chậm trả nếu có
    → THỰC LĨNH
13. Áp chính sách làm tròn đã khai báo (BR-41)
```

**Cổng chặn tuân thủ `CP-01` … `CP-09`:**

| Mã | Kiểm tra | Mức |
|---|---|---|
| `CP-01` | Lương hợp đồng hoặc lương đóng BH thấp hơn lương tối thiểu vùng có hiệu lực | **BLOCKING** |
| `CP-02` | Lương thử việc dưới 85% lương chính thức | **BLOCKING** |
| `CP-03` | Số giờ OT vượt trần ngày/tháng/năm chưa có phê duyệt ghi đè | **BLOCKING** |
| `CP-04` | Tổng khấu trừ vượt 30% lương thực trả | **BLOCKING** |
| `CP-05` | Số thực lĩnh âm | **BLOCKING** |
| `CP-06` | Còn ngày công `ERR` chưa xử lý trong kỳ | **BLOCKING** |
| `CP-07` | Nhân sự thuộc diện đóng BH nhưng chưa có mức lương đóng BH | **BLOCKING** |
| `CP-08` | Chênh lệch thu nhập so với kỳ trước vượt ngưỡng chưa được xác nhận | WARNING |
| `CP-09` | Thu nhập theo sản phẩm thấp hơn lương tối thiểu vùng | **BLOCKING** |

---

## 9. QT-08 · Duyệt, khóa kỳ lương và chi trả

```
 A3 lập bảng lương
     ▼
 A5 Trưởng phòng Nhân sự — duyệt cấp 1
     ▼                        ┌──────────────────────────────────────┐
 D2 Kế toán trưởng — cấp 2 ◄──┤ Dữ liệu thay đổi sau khi đã duyệt?    │
     ▼                        │ → HỦY toàn bộ phê duyệt, duyệt lại    │
 D4 Ban Giám đốc — phê duyệt cuối └──────────────────────────────────┘
     ▼
 KHÓA KỲ LƯƠNG (LOCKED) + lưu snapshot + lưu kết quả CP-01…CP-09
     ▼
 ┌──────────────────────┬────────────────────────┬─────────────────────┐
 │ D1 lập file Bank Hub  │ A3 phát hành payslip   │ D1 đẩy bút toán ERP │
 │ → chi lương ngày 10   │ → ESS, bảo vệ OTP/PIN  │ → TK 622 / TK 642   │
 └──────────────────────┴────────────────────────┴─────────────────────┘
```

**Cảnh báo hạn chi lương:** dashboard của D2 và A5 hiển thị cảnh báo đỏ khi còn ít ngày tới
ngày chi lương mà bảng lương chưa duyệt xong. Chậm quá 15 ngày → hệ thống tự tính tiền đền
bù theo BR-61.

**Điều chỉnh sau khóa kỳ:**

```
Phát hiện sai sót ở kỳ đã khóa
   │
   ├─► MẶC ĐỊNH: sinh dòng truy lĩnh/truy thu ở kỳ gần nhất chưa khóa
   │             payslip kỳ mới hiển thị dòng riêng ghi rõ kỳ gốc và lý do
   │
   └─► NGOẠI LỆ: mở khóa kỳ cũ
                 • cần quyền riêng biệt
                 • bắt buộc nhập lý do
                 • lưu snapshot TRƯỚC khi mở
                 • ghi audit log mức cao nhất
```

---

## 10. QT-09 · Phát hành và tra cứu phiếu lương

```
 A3 phát hành payslip kỳ N
      ▼
 Thông báo đẩy tới ESS/mobile — KHÔNG hiển thị số tiền trên thông báo
      ▼
 C1/C2 mở phiếu lương
      ▼
 ┌─────────────────────────────────────────┐
 │ MÀN HÌNH KHÓA BẮT BUỘC (NĐ 13/2023)      │
 │ • Mã PIN cá nhân, hoặc                   │
 │ • Vân tay / FaceID trên thiết bị, hoặc   │
 │ • OTP gửi SMS / email đã đăng ký         │
 └────────────────┬────────────────────────┘
                  ▼
 Hiển thị chi tiết: lương cơ bản, ngày công thực tế, giờ OT ngày, giờ OT đêm,
 phụ cấp (ca đêm, chống độc, chuyên cần), BHXH 8% / BHYT 1,5% / BHTN 1%,
 thuế TNCN, các khoản khấu trừ, THỰC LĨNH
                  ▼
 ┌─────────────────────────────────────────┐
 │ Nút "PHẢN HỒI SAI LỆCH"                  │
 │ → tạo phiếu yêu cầu giải trình           │
 │ → gửi thẳng tới A3, có SLA xử lý         │
 └─────────────────────────────────────────┘
```

**Quy trình xử lý phản hồi sai lệch:**

| Bước | Hoạt động | Vai trò | SLA |
|---|---|---|---|
| 1 | Tiếp nhận phiếu phản hồi | A3 | Ngay |
| 2 | Truy vết drill-down về công thức và dữ liệu công gốc | A3 | 2 ngày làm việc |
| 3 | Trả lời người lao động qua ESS | A3 | 3 ngày làm việc |
| 4 | Nếu đúng có sai sót → sinh khoản điều chỉnh kỳ kế tiếp | A3 → A5 duyệt | Kỳ kế tiếp |
| 5 | Nếu không thống nhất → chuyển A5 và E1 (Công đoàn) | A5, E1 | 7 ngày làm việc |

---

## 11. QT-10 · Nghiệp vụ bảo hiểm và thuế sau kỳ lương

```
 Kỳ lương LOCKED
      ▼
 ┌────────────────────────────────┬────────────────────────────────┐
 │ BẢO HIỂM (A4)                   │ THUẾ TNCN (A4)                  │
 ├────────────────────────────────┼────────────────────────────────┤
 │ 1. Lập hồ sơ báo tăng/giảm      │ 1. Kết xuất tờ khai khấu trừ    │
 │ 2. Kết xuất mẫu kê khai điện tử │    tháng/quý                    │
 │ 3. Theo dõi truy thu/thoái thu  │ 2. Cấp chứng từ khấu trừ        │
 │ 4. Đối chiếu C12 tháng trước    │    (quản lý số seri)            │
 │ 5. Lập hồ sơ ốm đau/thai sản    │ 3. Cuối năm: quyết toán, xử lý  │
 │ 6. Đối chiếu đoàn phí với E1    │    nộp thừa/thiếu, ủy quyền     │
 └────────────────────────────────┴────────────────────────────────┘
      ▼
 Chênh lệch phát hiện khi đối chiếu → khoản điều chỉnh kỳ kế tiếp (BR-42)
```

---

## 12. QT-11 · Vòng đời nhân sự

```
 TUYỂN DỤNG          THỬ VIỆC              CHÍNH THỨC           CHẤM DỨT
     │                   │                     │                    │
     ▼                   ▼                     ▼                    ▼
 Tạo hồ sơ         Ký HĐ thử việc       Ký HĐLĐ chính thức    Quyết định thôi việc
 Cấp mã NV         ≤ 60 ngày (KT cao)   Báo tăng BHXH          Bàn giao
 Gán đơn vị        ≤ 30 ngày (CN)       Đăng ký người phụ thuộc Tính trợ cấp thôi việc
 Đăng ký vân tay   Lương ≥ 85% chính    Kích hoạt ESS          Thanh toán phép chưa nghỉ
 Cấp tài khoản     thức (CP-02)                                Chốt sổ BHXH
                                                               Quyết toán thuế cuối
     │                   │                     │                    │
     └───────────────────┴─────────────────────┴────────────────────┘
                                   ▼
              Đồng bộ tự động sang SỔ QUẢN LÝ LAO ĐỘNG ĐIỆN TỬ (20 tiêu chí)
```

**Sự kiện giữa vòng đời cần xử lý:** điều chuyển bộ phận, thăng chức, tăng lương, thay đổi
diện đóng BH, gia hạn hợp đồng, ký phụ lục. Mọi quyết định đều có **ngày hiệu lực**, và hệ
thống phải xử lý được trường hợp ngày hiệu lực rơi vào giữa kỳ lương (BR-40).

---

## 13. Bộ máy phê duyệt dùng chung

Tất cả các luồng duyệt trên (đơn nghỉ, OT, giải trình công, đổi ca, tạm ứng lương, bảng
lương) chạy trên **một bộ máy workflow cấu hình được**.

| Năng lực | Mô tả |
|---|---|
| Duyệt nhiều cấp | Cấu hình số cấp và người duyệt theo từng loại đơn |
| Duyệt song song | Nhiều người duyệt cùng cấp, cấu hình điều kiện đủ (tất cả / bất kỳ) |
| Rẽ nhánh theo điều kiện | Theo số ngày nghỉ, số giờ OT, giá trị tiền, loại ngày |
| Ủy quyền | Khi người duyệt đi vắng, tự chuyển cho người được ủy quyền |
| Auto-escalate | Quá SLA thì tự chuyển lên cấp trên |
| Auto-cancel | Quá hạn cấu hình (ví dụ 12 giờ với đơn OT) thì tự hủy |
| Thông báo đa kênh | Trong ứng dụng, email, push, tích hợp Zalo / Teams / Slack |
| Truy vết | Toàn bộ lịch sử thao tác trên đơn, không xóa được |

---

## 14. Bảng tổng hợp quy trình

| Mã | Quy trình | Vai trò chính | Tần suất | Đầu ra |
|---|---|---|---|---|
| QT-01 | Xếp lịch ca | B1, B2 | Hằng tháng | Lịch ca đã duyệt |
| QT-02 | Thu thập & xử lý chấm công | Hệ thống, A1 | Hằng ngày | `daily_attendance` |
| QT-03 | Xử lý ngoại lệ công | C1, B1, A1 | Hằng ngày | Công đã hiệu chỉnh có audit log |
| QT-04 | Đăng ký & duyệt OT | C1, B1, B2, A5 | Hằng ngày | Bản ghi OT đã duyệt |
| QT-05 | Đơn nghỉ phép & chế độ | C1, B1, A5, A4 | Hằng ngày | Ký hiệu công + trừ quỹ phép |
| QT-06 | Chốt & khóa kỳ công | B1, A1, A3 | Hằng tháng | Snapshot bảng công |
| QT-07 | Tính lương | A3 | Hằng tháng | Bảng lương + kết quả CP-01…09 |
| QT-08 | Duyệt, khóa kỳ lương, chi trả | A5, D2, D4, D1 | Hằng tháng | Lệnh chi + bút toán ERP |
| QT-09 | Phát hành & tra cứu payslip | A3, C1, C2 | Hằng tháng | Payslip bảo mật |
| QT-10 | Nghiệp vụ BHXH & thuế | A4 | Hằng tháng / năm | Hồ sơ kê khai điện tử |
| QT-11 | Vòng đời nhân sự | A2, A4 | Theo sự kiện | Sổ quản lý lao động điện tử |
