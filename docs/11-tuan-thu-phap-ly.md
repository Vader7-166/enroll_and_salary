# 11. Tuân thủ pháp lý

> **Nguyên tắc nền tảng.** Tuân thủ trong hệ thống này là **cổng chặn (gate)**, không phải
> báo cáo hậu kiểm. Vi phạm bị chặn ngay tại thời điểm thao tác, không để phát hiện khi bị
> thanh tra. Xem [ADR-09](07-kien-truc-he-thong.md#adr-09-kiểm-tra-tuân-thủ-là-cổng-chặn-gate-không-phải-báo-cáo).

---

## 1. Cơ sở pháp lý áp dụng

| Văn bản | Hiệu lực | Nội dung liên quan |
|---|---|---|
| **Bộ luật Lao động 2019** (Luật 45/2019/QH14) | 01/01/2021 | Điều 96, 97, 98, 102, 105, 127, 129 |
| **NĐ 145/2020/NĐ-CP** | 01/02/2021 | Khoản 2 Điều 3 (sổ quản lý lao động), Điều 57 (OT ban đêm), Điều 59 (trần OT) |
| **NĐ 293/2025/NĐ-CP** | 01/01/2026 | Lương tối thiểu vùng 2026 |
| **NĐ 283/2026/NĐ-CP** | **10/09/2026** | Xử phạt vi phạm hành chính lĩnh vực lao động, BHXH |
| **NĐ 13/2023/NĐ-CP** | 01/07/2023 | Bảo vệ dữ liệu cá nhân |
| **NĐ 320/2025/NĐ-CP** | 2025 | Miễn thuế TNCN phần thu nhập chênh lệch OT / làm đêm |

---

## 2. Ma trận quy định ↔ chức năng hệ thống

### 2.1. Bộ luật Lao động 2019

| Điều | Nội dung quy định | Chức năng cài đặt | Cổng chặn |
|---|---|---|---|
| **Điều 96** | Nguyên tắc trả lương; người sử dụng lao động chịu phí chuyển khoản | FR-15.5 · [10 §2.2](10-tich-hop-he-thong.md) | – |
| **Điều 97** | Kỳ hạn trả lương; đền bù lãi khi chậm trả quá 15 ngày | FR-08.19, FR-08.20 · BR-61 | Cảnh báo dashboard |
| **Điều 98** | Lương làm thêm giờ; phụ cấp làm việc ban đêm ≥ 30% | FR-06.4, FR-05.7 · BR-23 | `CP-03` |
| **Điều 102** | Chỉ được khấu trừ để bồi thường thiệt hại; trần 30% lương thực trả | FR-08.10 · BR-44 | `CP-04` |
| **Điều 105** | Thời giờ làm việc; bảng chấm công là chứng từ | FR-05.15, FR-05.16 · BR-11, BR-65 | `XC-04` |
| **Điều 127** | **Nghiêm cấm phạt tiền, cắt lương thay kỷ luật** | FR-08.11, FR-08.12 · BR-45 | Không cài đặt chức năng |
| **Điều 129** | Bồi thường thiệt hại do làm hư hỏng dụng cụ, thiết bị | FR-08.10 · BR-44 | – |

### 2.2. NĐ 145/2020/NĐ-CP

| Điều khoản | Nội dung | Chức năng cài đặt | Cổng chặn |
|---|---|---|---|
| **Khoản 2 Điều 3** | Sổ quản lý lao động đủ 20 tiêu chí | FR-02.6 (tự sinh, không nhập tay) | – |
| **Điều 57** | Công thức OT ban đêm ba số hạng | FR-06.4 · [05 §5](05-thuat-toan-cham-cong-va-tinh-luong.md) | – |
| **Điều 59** | Trần giờ làm thêm ngày / tháng / năm | FR-06.7, FR-06.8 · BR-27 | `CP-03`, `XC-10` |

### 2.3. NĐ 293/2025/NĐ-CP — Lương tối thiểu vùng 2026

| Nội dung | Chức năng cài đặt | Cổng chặn |
|---|---|---|
| Mức lương tối thiểu 4 vùng, áp dụng từ 01/01/2026 | FR-01.7 (tham số theo hiệu lực) · BR-06 | `CP-01` |
| KCN giáp ranh nhiều vùng → áp mức cao nhất | Trường `region_code` trên `org_unit` · BR-07 | `CP-01` |
| Cơ chế Safe Haven khi thay đổi đơn vị hành chính | BR-07 | `CP-01` |
| Điều 5.5 — không được giảm lương do đổi phân vùng | BR-08 | Cảnh báo khi lưu điều chỉnh lương |
| Lương thử việc ≥ 85% lương chính thức | FR-03.4 · BR-09 | `CP-02` |

### 2.4. NĐ 13/2023/NĐ-CP — Bảo vệ dữ liệu cá nhân

| Yêu cầu | Chức năng cài đặt |
|---|---|
| Mã hóa dữ liệu cá nhân nhạy cảm | FR-16.1 — AES-256 tầng CSDL cho CCCD, tài khoản NH, lương đóng BH, lương thực nhận |
| Kiểm soát truy cập | FR-01.1, FR-01.2, FR-01.3 — hai trục quyền + exclusion list + che trường |
| Xác thực khi xem phiếu lương | FR-13.4 — PIN / vân tay / FaceID / OTP |
| Ghi vết truy cập dữ liệu nhạy cảm | FR-16.8 — kể cả truy cập bị từ chối |
| Quyền của chủ thể dữ liệu | [09 §3.4](09-phan-quyen-va-bao-mat.md) |

### 2.5. NĐ 320/2025/NĐ-CP — Miễn thuế TNCN phần OT chênh lệch

| Yêu cầu | Chức năng cài đặt |
|---|---|
| Bóc tách phần thu nhập chênh lệch do OT / làm đêm | FR-10.3 · BR-54 · [05 §7.2](05-thuat-toan-cham-cong-va-tinh-luong.md) |
| Phần 100% gốc vẫn chịu thuế | Cùng thuật toán bóc tách |

---

## 3. Khung chế tài (NĐ 283/2026/NĐ-CP, hiệu lực 10/09/2026)

> Mức phạt đối với **tổ chức bằng 02 lần** mức phạt đối với cá nhân. Bảng dưới là mức áp
> dụng cho doanh nghiệp.

### 3.1. Khung phạt theo hành vi và quy mô lao động

| Hành vi vi phạm | Quy mô lao động | Mức phạt (VND) |
|---|---|---|
| Vi phạm thang bảng lương (không xây dựng / không công bố); không gửi bảng kê lương hằng tháng | Toàn doanh nghiệp | 10.000.000 – 20.000.000 |
| Trả lương không đúng hạn / trả thiếu / khấu trừ sai | 01 – 10 | 10.000.000 – 20.000.000 |
| | 11 – 50 | 20.000.000 – 40.000.000 |
| | 51 – 100 | 40.000.000 – 60.000.000 |
| | 101 – 300 | 60.000.000 – 80.000.000 |
| | **Trên 301** | **80.000.000 – 100.000.000** |
| **Trả thấp hơn lương tối thiểu vùng** | Trên 51 | **100.000.000 – 150.000.000** |
| **Huy động OT quá giới hạn** (ngày / tháng / năm) | **Trên 301** | **120.000.000 – 150.000.000** + đình chỉ hoạt động tăng ca 1–3 tháng |
| Ép buộc tăng ca / huy động OT không có văn bản đồng ý / giữ giấy tờ tùy thân | Toàn doanh nghiệp | 40.000.000 – 50.000.000 |
| **Phạt tiền / cắt lương thay kỷ luật** | Toàn doanh nghiệp | **40.000.000 – 80.000.000** |
| Không lập sổ quản lý lao động | Toàn doanh nghiệp | 10.000.000 – 20.000.000 |

### 3.2. Rủi ro theo quy mô của doanh nghiệp này

Doanh nghiệp có **300 – 1.000 lao động**, tức nằm ở nhóm quy mô chịu **mức phạt cao nhất**
trong hầu hết các khung. Ba rủi ro lớn nhất:

| # | Rủi ro | Mức phạt tối đa |
|---|---|---|
| 1 | Trả thấp hơn lương tối thiểu vùng | **150.000.000 VND** |
| 2 | Huy động OT quá trần | **150.000.000 VND** + đình chỉ tăng ca 1–3 tháng |
| 3 | Trả chậm / trả thiếu / khấu trừ sai | **100.000.000 VND** |

### 3.3. Biện pháp khắc phục hậu quả — hiệu ứng "lãi kép"

Ngoài mức phạt hành chính, doanh nghiệp **buộc phải**:

1. Trả đủ tiền lương gốc còn thiếu.
2. Cộng **tiền lãi** tính theo mức lãi suất tiền gửi không kỳ hạn **cao nhất của nhóm ngân
   hàng thương mại nhà nước** (Vietcombank, BIDV, Agribank, VietinBank) tại thời điểm xử phạt.

Hệ thống lưu lãi suất này ở tham số `LATE_PAYMENT_RATE` theo khoảng hiệu lực (BR-61).

---

## 4. Cổng chặn tuân thủ `CP-01` … `CP-09`

Chạy **trước khi** cho phép chuyển bảng lương sang trạng thái duyệt.

| Mã | Kiểm tra | Mức | Căn cứ pháp lý | Rủi ro nếu bỏ qua |
|---|---|---|---|---|
| `CP-01` | Lương hợp đồng hoặc lương đóng BH thấp hơn lương tối thiểu vùng có hiệu lực | **BLOCKING** | NĐ 293/2025 | 150 triệu |
| `CP-02` | Lương thử việc dưới 85% lương chính thức | **BLOCKING** | BLLĐ 2019 | 100 triệu |
| `CP-03` | Số giờ OT vượt trần ngày/tháng/năm chưa có phê duyệt ghi đè | **BLOCKING** | Điều 59 NĐ 145/2020 | 150 triệu + đình chỉ tăng ca |
| `CP-04` | Tổng khấu trừ vượt 30% lương thực trả (NET) | **BLOCKING** | Điều 102 BLLĐ | 100 triệu |
| `CP-05` | Số thực lĩnh âm | **BLOCKING** | Điều 96, 102 BLLĐ | 100 triệu |
| `CP-06` | Còn ngày công `ERR` chưa xử lý trong kỳ | **BLOCKING** | Điều 105 BLLĐ | Bảng công không hợp lệ |
| `CP-07` | Nhân sự thuộc diện đóng BH nhưng chưa có mức lương đóng BH | **BLOCKING** | Luật BHXH | Truy thu + phạt |
| `CP-08` | Chênh lệch thu nhập so với kỳ trước vượt ngưỡng chưa được xác nhận | WARNING | – | Phát hiện sai sót sớm |
| `CP-09` | Thu nhập theo sản phẩm thấp hơn lương tối thiểu vùng | **BLOCKING** | NĐ 293/2025 | 150 triệu |

**Yêu cầu lưu bằng chứng.** Kết quả toàn bộ 9 kiểm tra tại thời điểm khóa kỳ được lưu kèm
kỳ lương (`compliance_check_result`) và **kết xuất được ra PDF phục vụ thanh tra**.

**Thông điệp khi chặn** phải gồm: danh sách nhân sự vi phạm, giá trị hiện tại so với ngưỡng,
**dẫn chiếu điều khoản pháp luật**, và **mức phạt tương ứng theo quy mô lao động**.

---

## 5. Đối soát chéo `XC-01` … `XC-10`

Chạy **trước khi** cho phép chốt bảng công. Chi tiết bảng: [04 §7](04-quy-trinh-nghiep-vu.md).

Mức mặc định `BLOCKING`: `XC-06` (công âm hoặc vượt số ngày kỳ), `XC-07` (nhân sự đã nghỉ
việc vẫn phát sinh công), `XC-09` (ngày công `ERR` chưa giải trình).

---

## 6. Các chức năng KHÔNG được cài đặt

| Chức năng | Lý do | Thay thế |
|---|---|---|
| **Trừ lương do đi trễ / về sớm** | Điều 127 BLLĐ 2019 nghiêm cấm phạt tiền thay kỷ luật | Điểm chuyên cần ảnh hưởng khoản **thưởng** |
| **Trừ lương do không đạt KPI** | Như trên | Cơ chế thưởng theo KPI, không trừ vào lương |
| **Trừ lương do vi phạm nội quy** | Như trên | Quy trình kỷ luật hợp pháp 3 bước |
| **Khấu trừ trên lương GROSS** | Điều 102 — trần 30% tính trên NET | Chỉ khấu trừ trên NET, có `CP-04` chặn |

### 6.1. Quy trình kỷ luật hợp pháp thay thế

```
   Vi phạm nội quy / đi trễ / không đạt KPI
                    │
                    ▼
   ┌────────────────────────────────────────────┐
   │ BƯỚC 1 · Khiển trách bằng văn bản          │
   └────────────────────┬───────────────────────┘
                        ▼
   ┌────────────────────────────────────────────┐
   │ BƯỚC 2 · Kéo dài thời hạn nâng lương       │
   │          KHÔNG QUÁ 06 THÁNG                 │
   │          hoặc cách chức                     │
   └────────────────────┬───────────────────────┘
                        ▼
   ┌────────────────────────────────────────────┐
   │ BƯỚC 3 · Sa thải                            │
   │  (chỉ với hành vi nghiêm trọng theo nội quy │
   │   lao động đã đăng ký với Sở LĐ-TB&XH)      │
   └────────────────────────────────────────────┘
```

### 6.2. Yêu cầu với doanh nghiệp trước khi vận hành

> **Rủi ro đã lường trước.** Người dùng có thể vẫn muốn chức năng trừ lương đi trễ vì "quy
> chế công ty đang làm vậy". Hệ thống **không cài đặt**. Trên màn hình cấu hình khấu trừ
> hiển thị rõ khung phạt 40 – 80 triệu VND, và tài liệu bàn giao nêu rõ điều này.

Doanh nghiệp phải:

1. **Rà soát và bỏ** mọi điều khoản trừ lương đi trễ, về sớm, không đạt KPI trong nội quy và
   quy chế lương thưởng.
2. **Ký biên bản thỏa thuận đồng ý làm thêm giờ** với người lao động trước khi huy động OT —
   hệ thống **chặn** OT không có văn bản đồng ý (BR-28).
3. Đăng ký nội quy lao động với Sở LĐ-TB&XH.

---

## 7. Lịch tuân thủ 2026

| Thời điểm | Việc phải làm | Chức năng hỗ trợ |
|---|---|---|
| **Trước 01/01/2026** | Rà soát và ký phụ lục HĐLĐ cập nhật lương tối thiểu vùng theo NĐ 293/2025 | FR-03.3, cảnh báo hàng loạt |
| **Hằng tháng** | Đối soát bảng công thực tế | `XC-01`…`XC-10` |
| **Hằng tháng** | Tách phần lương OT miễn thuế TNCN | FR-10.3 |
| **Hằng tháng** | Gửi bảng kê lương (payslip) cho từng người lao động | FR-13.4 · BR-62 |
| **Hằng tháng** | Sao lưu dữ liệu chấm công (lưu trữ ≥ 3 năm) | FR-16.7 |
| **Hằng tháng** | Đối chiếu C12 với cơ quan BHXH | FR-09.9 |
| **Định kỳ 6 tháng** | Báo cáo tình hình sử dụng lao động nộp Sở LĐ-TB&XH | FR-14.3 |
| **Định kỳ 6 tháng** | Rà soát giới hạn giờ làm thêm (≤ 40h/tháng) | FR-06.7 |
| **Hằng năm** | Thông báo huy động OT 200 – 300 giờ đến Sở LĐ-TB&XH | FR-14.3 |
| **Hằng năm** | Quyết toán thuế TNCN | FR-10.6 |
| **Liên tục** | Cập nhật Sổ quản lý lao động điện tử 20 tiêu chí | FR-02.6 (tự động) |

---

## 8. Checklist tuân thủ cho Ban Giám đốc và HR

| ☐ | Hạng mục | Chức năng kiểm chứng |
|---|---|---|
| ☐ | Không có nhân sự nào (kể cả thử việc) có lương thấp hơn lương tối thiểu vùng 2026 | `CP-01`, `CP-02` |
| ☐ | Sổ quản lý lao động điện tử đủ 20 tiêu chí cho toàn bộ nhân sự đang làm việc | FR-02.6 |
| ☐ | Bảng chấm công tự động, có cơ chế ghép cặp Vào/Ra làm căn cứ tính OT hợp lệ | FR-05.4 → FR-05.8 |
| ☐ | Đã bãi bỏ toàn bộ chế tài trừ tiền lương đi trễ trong nội quy và quy chế | FR-08.11 (không cài đặt) |
| ☐ | Gửi bảng kê lương (payslip) hằng tháng cho từng người lao động | FR-13.4 |
| ☐ | Đã ký văn bản thỏa thuận tăng ca với người lao động | FR-06.2 (chặn nếu thiếu) |
| ☐ | Số giờ OT không vượt 40h/tháng và 200h/năm | FR-06.7, `XC-10` |
| ☐ | Nếu huy động OT 200–300h/năm: đã gửi thông báo tới Sở LĐ-TB&XH | Cờ tham số `OT_CAP_YEAR_REGISTERED` |
| ☐ | Khấu trừ lương không vượt 30% NET và chỉ với lý do hợp pháp | `CP-04` |
| ☐ | Trả lương đúng ngày 10 hằng tháng | FR-08.19 |
| ☐ | Dữ liệu chấm công và lương lưu trữ tối thiểu 3 năm, có sao lưu | FR-16.7 |
| ☐ | Dữ liệu cá nhân nhạy cảm được mã hóa AES-256 | FR-16.1 |
| ☐ | Nhật ký kiểm toán không thể sửa/xóa, kể cả bởi quản trị viên | FR-16.3 |
| ☐ | Thang bảng lương đã xây dựng và công bố | FR-08.6 |

---

## 9. Sai sót trong quy trình Excel hiện hành cần loại bỏ

Rà soát tệp `mau-bang-luong-tu-dong-2026.xlsx` phát hiện **5 sai sót**, mỗi sai sót đều dẫn
tới rủi ro pháp lý:

| # | Sai sót trong công thức Excel | Hệ quả pháp lý | Cách hệ thống mới xử lý |
|---|---|---|---|
| 1 | Thuế TNCN: `IF(S≤5tr;5%;IF(S≤10tr;10%−250k;15%−750k))` — **chỉ 3 bậc thay vì 7** | Sai quyết toán thuế cá nhân và pháp nhân | Biểu 7 bậc lấy từ tham số ([05 §7.1](05-thuat-toan-cham-cong-va-tinh-luong.md)) |
| 2 | Phụ cấp ca đêm: `(D/E/8)×0,3×8×(F/2)` — **giả định nửa số công là ca đêm** | Trả sai phụ cấp đêm, không giải trình được | Tính trên **số giờ đêm thực tế** đã tách đoạn |
| 3 | Bảo hiểm: `D×0,08` trên lương HĐLĐ — **không áp trần đóng** | Sai số liệu nộp BHXH, phát sinh truy thu | Lương đóng BH riêng, kẹp sàn/trần (BR-47) |
| 4 | OT đêm: **cứng hệ số 2.1 cho mọi loại ngày** | Trả thiếu OT ngày nghỉ tuần (270%) và ngày lễ (390%) → hành vi trả thiếu lương | Công thức 3 số hạng theo loại ngày (BR-23) |
| 5 | Giảm trừ gia cảnh: **cứng 11.000.000**, không tính người phụ thuộc | Sai thuế TNCN với nhân sự có người phụ thuộc | Tham số + bảng `dependent` theo tháng hiệu lực |

Ngoài ra, `mau-bang-cham-cong-thang-2026.xlsx` đếm công bằng `COUNTIF` trên ký hiệu — không
phân biệt được ca đêm bắc cầu và không tách được đoạn giờ.
