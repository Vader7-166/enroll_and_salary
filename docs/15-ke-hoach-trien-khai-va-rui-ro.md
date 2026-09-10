# 15. Kế hoạch triển khai và rủi ro

## 1. Lộ trình bốn giai đoạn

```
 GĐ 0 · CHUẨN BỊ DỮ LIỆU NỀN
 ├─ Khai báo cây tổ chức, danh mục dùng chung
 ├─ Nhập toàn bộ tham số pháp lý 2025–2026
 ├─ Định nghĩa ca, lịch nghỉ lễ, cấu trúc lương và công thức
 └─ Nhập hồ sơ nhân sự, hợp đồng, số dư phép đầu kỳ
                    │
                    ▼
 GĐ 1 · CHẤM CÔNG CHẠY THẬT — LƯƠNG CHẠY SONG SONG          ⏱ tối thiểu 2 kỳ
 ├─ Kết nối máy chấm công, chạy thu thập và xử lý công thật
 ├─ Bảng lương chạy ĐỒNG THỜI trên hệ thống và trên Excel
 ├─ Đối chiếu từng nhân sự, từng cấu phần
 ├─ Cổng chặn CP-01…CP-09 chạy ở chế độ CẢNH BÁO
 └─ Tiêu chí qua: chênh lệch = 0 hoặc giải thích được toàn bộ, trong 2 kỳ liên tiếp
                    │
                    ▼
 GĐ 2 · CẮT CHUYỂN
 ├─ Hệ thống trở thành NGUỒN DỮ LIỆU CHÍNH THỨC
 ├─ Excel chỉ còn để tra cứu lịch sử
 └─ Bật cổng chặn CP-01…CP-09 ở chế độ CHẶN
                    │
                    ▼
 GĐ 3 · MỞ RỘNG
 ├─ ESS/MSS ra toàn bộ người lao động, kiosk tại xưởng
 ├─ Tích hợp ngân hàng và ERP
 └─ Kết xuất BHXH và thuế
```

### 1.1. Giai đoạn 0 — Chuẩn bị dữ liệu nền

| Hạng mục | Nội dung | Vai trò |
|---|---|---|
| Cây tổ chức | Công ty → Địa điểm → Khối → Phòng ban/Phân xưởng → Tổ/Nhóm; gán cost center và địa bàn vùng | E2, A5 |
| Danh mục | Chức danh, ngạch bậc, loại HĐ, loại nghỉ, loại phụ cấp, ngân hàng, trình độ | E2, A2 |
| Tham số pháp lý | Toàn bộ tham số 2025–2026, mỗi bản ghi kèm văn bản căn cứ | E2, A4 |
| Định nghĩa ca | Ca A/B/C, ca hành chính, biên độ nhận diện, cờ qua nửa đêm | A1, B2 |
| Lịch nghỉ lễ | Lịch năm, quy tắc nghỉ bù, hoán đổi ngày nghỉ Tết | A5 |
| Cấu trúc lương | Cấu phần thu nhập, 3 cờ mỗi cấu phần, công thức tính | A3, A5 |
| Dữ liệu nhân sự | Hồ sơ, hợp đồng, số dư phép đầu kỳ, người phụ thuộc | A2, A4 |

### 1.2. Giai đoạn 1 — Chạy song song

**Ưu tiên triển khai:** hoàn thiện **module chấm công + OT trước** — đây là khối lượng thủ
công nặng nhất, giảm được ngay từ kỳ đầu.

| Tiêu chí qua giai đoạn | Ngưỡng |
|---|---|
| Chênh lệch tổng thu nhập giữa hệ thống và Excel | = 0 hoặc **giải thích được toàn bộ** |
| Chênh lệch tổng khấu trừ | = 0 hoặc giải thích được toàn bộ |
| Chênh lệch tổng thực lĩnh | = 0 hoặc giải thích được toàn bộ |
| Số kỳ đạt liên tiếp | **≥ 2 kỳ** |

> **Lưu ý.** Nhiều "chênh lệch" ở giai đoạn này thực chất là **hệ thống mới tính đúng còn
> Excel tính sai** (5 sai sót đã nêu ở [11 §9](11-tuan-thu-phap-ly.md)). Mỗi chênh lệch phải
> được phân loại: *lỗi hệ thống mới* hay *lỗi công thức Excel cũ*.

### 1.3. Giai đoạn 2 — Cắt chuyển

| Việc | Điều kiện |
|---|---|
| Hệ thống thành nguồn chính thức | Đã qua tiêu chí giai đoạn 1 |
| Bật cổng chặn `CP-01`…`CP-09` ở chế độ **CHẶN** | Doanh nghiệp đã xử lý xong các vi phạm tồn đọng phát hiện ở giai đoạn 1 |
| Excel chuyển sang chỉ tra cứu | Đã kết xuất và lưu trữ toàn bộ file lịch sử |

### 1.4. Giai đoạn 3 — Mở rộng

ESS/MSS ra toàn bộ người lao động · Triển khai kiosk tại xưởng · Tích hợp Bank Hub · Đẩy bút
toán ERP · Kết xuất BHXH và thuế điện tử.

---

## 2. Chuyển đổi dữ liệu

### 2.1. Phạm vi chuyển đổi

| Nhóm dữ liệu | Nguồn | Ghi chú |
|---|---|---|
| Hồ sơ nhân sự | File Excel, hồ sơ giấy | Bắt buộc |
| Hợp đồng lao động | Hồ sơ giấy | Bắt buộc; cần số lần ký HĐ xác định thời hạn để cảnh báo lần 3 |
| Số dư phép đầu kỳ | `mau-bang-cham-cong-thang-2026.xlsx` | Bắt buộc |
| Lịch sử lương | `mau-bang-luong-tu-dong-2026.xlsx` | **12 tháng gần nhất** (giả định tạm — PV5-13 chưa chốt) |
| Người phụ thuộc | Hồ sơ đăng ký giảm trừ | Bắt buộc, kèm tháng hiệu lực |
| Lũy kế OT trong năm | Bảng theo dõi OT | Bắt buộc — cần để kiểm soát trần 200/300 giờ/năm |
| Sổ quản lý lao động | `mau-so-quan-ly-lao-dong-2026.xlsx` | Đối chiếu, hệ thống sẽ tự sinh lại |

### 2.2. Quy trình chuyển đổi

```
 1. TRÍCH XUẤT        từ file Excel và hồ sơ giấy
 2. LÀM SẠCH          chuẩn hóa mã NV, ngày tháng, số CCCD; xử lý trùng, thiếu
 3. NHẬP THỬ          import vào môi trường thử, xem trước và báo lỗi từng dòng
 4. ĐỐI CHIẾU         báo cáo so khớp tổng thu nhập / khấu trừ / thực lĩnh
                      theo TỪNG KỲ giữa nguồn và đích — BẮT BUỘC
 5. NGHIỆM THU        nghiệp vụ xác nhận từng nhóm dữ liệu
 6. NHẬP CHÍNH THỨC   kèm audit log ghi nguồn dữ liệu
```

**Ràng buộc bắt buộc:** báo cáo đối chiếu tổng thu nhập / tổng khấu trừ / tổng thực lĩnh
theo từng kỳ giữa nguồn và đích. Không có báo cáo này thì không được cắt chuyển.

---

## 3. Thứ tự triển khai theo phân hệ

Thứ tự phản ánh **phụ thuộc kỹ thuật**:

```
 1. NỀN TẢNG            RBAC · cây tổ chức · tham số pháp lý · quản lý kỳ · audit log
        ↓
 2. DỮ LIỆU GỐC         hồ sơ nhân sự · hợp đồng · ca làm việc · lịch nghỉ lễ
        ↓
 3. CHẤM CÔNG           tiếp nhận log · khử trùng · ghép cặp · ca đêm bắc cầu · ngoại lệ · chốt công
        ↓
 4. OT & NGHỈ PHÉP      đăng ký/duyệt OT · ma trận hệ số · trần OT · quỹ phép · đơn nghỉ
        ↓
 5. TÍNH LƯƠNG          cấu phần · formula engine · dry-run · cổng chặn · duyệt · khóa kỳ
        ↓
 6. BHXH & THUẾ         lương đóng BH · báo tăng giảm · giảm trừ · biểu 7 bậc · quyết toán
        ↓
 7. CỔNG NGƯỜI DÙNG     ESS web/mobile/kiosk · MSS · payslip bảo mật · phản hồi sai lệch
        ↓
 8. BÁO CÁO             chứng từ kế toán · báo cáo nghiệp vụ · báo cáo tuân thủ · dashboard
        ↓
 9. TÍCH HỢP            Bank Hub · ERP · cổng BHXH/thuế · SSO · thông báo
        ↓
10. NGHIỆM THU          bộ kiểm thử pháp lý · UAT · hiệu năng 1.000 nhân sự
```

---

## 4. Phương án lùi

| Giai đoạn | Phương án lùi |
|---|---|
| **GĐ 1 và 2** | Quay lại quy trình Excel trong vòng **một kỳ**: dữ liệu công và lương luôn kết xuất được ra **đúng định dạng file mẫu hiện hành** |
| **Từ GĐ 3** | Khôi phục từ bản sao lưu theo chỉ tiêu **RPO ≤ 1 giờ / RTO ≤ 4 giờ** |

---

## 5. Rủi ro và biện pháp giảm thiểu

| # | Rủi ro | Mức | Biện pháp giảm thiểu |
|---|---|---|---|
| **R-01** | **Cài sai thuật toán ca đêm bắc cầu** | 🔴 Cao nhất | Tách rõ hai khái niệm *ngày công* và *đoạn giờ* ngay từ mô hình dữ liệu; bộ kiểm thử riêng cho **6 tình huống biên**: ca cuối tháng · ca vắt sang ngày lễ · ca vắt từ ngày nghỉ tuần sang ngày thường · ca có OT nối tiếp · ca thiếu lượt quẹt · ca bị đổi giữa chừng |
| **R-02** | Formula engine chậm hoặc khó gỡ lỗi khi quy mô lớn | 🟠 Cao | Cache tham số và định nghĩa công thức trong một lần chạy lô; **đo hiệu năng với 1.000 nhân sự từ giai đoạn sớm**; bắt buộc có màn hình drill-down trước khi phát hành module lương |
| **R-03** | Tham số pháp lý bị cập nhật sai hoặc trễ | 🟠 Cao | Bắt buộc khai báo văn bản căn cứ; cảnh báo khi tham số sắp hết hiệu lực mà chưa có bản ghi kế tiếp; dashboard tuân thủ hiển thị tham số đang áp và ngày hiệu lực |
| **R-04** | Dữ liệu máy chấm công không đủ chất lượng (mã NV không khớp, mất bản ghi, đồng hồ máy lệch giờ) | 🟠 Cao | Vùng chờ `UNMATCHED` không chặn luồng; đồng bộ bù bắt buộc; giám sát thiết bị có cảnh báo; đối soát chéo `XC-01`…`XC-10` trước khi chốt công; **bổ sung yêu cầu đồng bộ đồng hồ NTP khi khảo sát hiện trường** |
| **R-05** | Mã hóa cột nhạy cảm làm chậm truy vấn và mất khả năng tìm kiếm | 🟡 Trung bình | Chỉ mã hóa tập trường thực sự nhạy cảm; giữ trường băm có muối nếu cần đối chiếu trùng CCCD; đánh chỉ mục trên trường không mã hóa |
| **R-06** | **Người dùng vẫn muốn chức năng trừ lương đi trễ** vì "quy chế công ty đang làm vậy" | 🟠 Cao | **Không cài đặt**; cung cấp thay thế bằng điểm chuyên cần ảnh hưởng khoản thưởng và quy trình kỷ luật 3 bước; nêu rõ khung phạt **40 – 80 triệu** trong tài liệu bàn giao và **trên màn hình cấu hình khấu trừ** |
| **R-07** | Chuyển đổi dữ liệu lịch sử từ Excel sai lệch | 🟠 Cao | Bắt buộc báo cáo đối chiếu tổng thu nhập / khấu trừ / thực lĩnh theo từng kỳ giữa nguồn và đích; **chạy song song ít nhất 2 kỳ** trước khi cắt chuyển |
| **R-08** | Chạy song song Excel và hệ thống mới gây tải kép cho HR | 🟡 Trung bình | Giới hạn chạy song song **đúng 2 kỳ**; ưu tiên hoàn thiện module chấm công + OT trước để giảm khối lượng thủ công nặng nhất ngay từ kỳ đầu |
| **R-09** | Công nhân trực tiếp không quen dùng ESS/kiosk | 🟡 Trung bình | Giao diện kiosk ≤ 3 bước cho thao tác chính; đào tạo theo tổ; tổ trưởng làm đầu mối hỗ trợ; giữ kênh giấy song song trong giai đoạn đầu |
| **R-10** | Chưa chốt hãng/model máy chấm công (PV5-01, PV5-03) | 🟡 Trung bình | Hỗ trợ **cả hai đường**: SDK/API và import file theo mapping cấu hình được |
| **R-11** | Chưa chốt ERP và danh sách ngân hàng (PV5-10, PV2-22) | 🟡 Trung bình | Mặc định kết xuất tệp trung gian; mẫu tệp khai báo được cho từng ngân hàng |
| **R-12** | Chưa chốt on-premise hay cloud (PV5-14) | 🟢 Thấp | Kiến trúc không phụ thuộc hạ tầng cụ thể (NFR-48) |
| **R-13** | Vi phạm tồn đọng bị phát hiện khi bật cổng chặn ở GĐ 2 | 🟠 Cao | Chạy cổng chặn ở chế độ **cảnh báo** suốt GĐ 1 để doanh nghiệp có thời gian xử lý trước khi chuyển sang chế độ chặn |

---

## 6. Câu hỏi còn mở

Các câu hỏi sau **chưa có đáp án từ khảo sát**. Mỗi mục ghi kèm **giả định tạm** đang dùng để
không chặn tiến độ. Cần xác nhận tại **buổi walkthrough** với HR + Kế toán + Quản lý bộ phận.

| # | Câu hỏi | Nguồn | Giả định tạm đang dùng | Ảnh hưởng nếu sai |
|---|---|---|---|---|
| 1 | Ngày công chuẩn tháng: cố định 26 hay theo thực tế? | PV1-32, PV1-33 | Cấu hình được; mặc định **26** cho khối sản xuất | Sai toàn bộ đơn giá giờ và ngày |
| 2 | Dung sai đi muộn/về sớm bao nhiêu phút, xử lý khi vượt? | PV3-07 | **15 phút**; vượt thì ghi nhận nhưng không trừ lương | Ảnh hưởng số công và báo cáo chuyên cần |
| 3 | Chu kỳ xoay ca cụ thể (3 ca 3 kíp hay 3 ca 4 kíp)? | PV3-03 | Chu kỳ tuần, khai báo được | Ảnh hưởng module xếp ca |
| 4 | Tập cấu phần cấu thành "lương làm căn cứ tính OT" | PV1-29 | Lương cơ bản theo HĐLĐ; cấu hình được | Sai toàn bộ tiền OT |
| 5 | Tập cấu phần cấu thành "lương đóng bảo hiểm" | PV2-01 | Các cấu phần có `is_insurable = true` | Sai số liệu nộp BHXH |
| 6 | Định mức miễn thuế ăn ca / đồng phục / điện thoại | PV2-09 | Theo định mức pháp luật, tham số hóa | Sai thuế TNCN |
| 7 | Số lần giải trình quên chấm công tối đa mỗi tháng | PV3-09 | **3 lần**, vượt thì nâng cấp duyệt | Ảnh hưởng luồng duyệt |
| 8 | Chính sách phép dư cuối năm: chuyển / hủy / thanh toán | PV1-18 | Chuyển tối đa **5 ngày**, hạn dùng **31/03** năm sau | Sai số dư phép |
| 9 | Có cho ứng phép trước của năm sau không, tối đa mấy ngày | PV1-17 | Cho phép, tối đa **3 ngày** | Ảnh hưởng kiểm tra số dư |
| 10 | Tỷ lệ quy đổi OT sang nghỉ bù và hạn sử dụng | PV3-21 | **1 : 1,5**, hạn **3 tháng** | Ảnh hưởng quỹ nghỉ bù |
| 11 | Doanh nghiệp đã đăng ký trần OT 300 giờ/năm chưa? | Checklist tuân thủ | **Chưa**; áp trần 200 giờ, có cờ bật | Rủi ro phạt 150 triệu nếu áp sai |
| 12 | Danh sách ngân hàng chi lương và định dạng từng ngân hàng | PV2-22 | Cấu hình mẫu tệp, chưa có mẫu cụ thể | Chậm tích hợp Bank Hub |
| 13 | Phần mềm kế toán/ERP đang dùng và cách kết nối | PV5-10 | Kết xuất tệp trung gian + API tùy chọn | Chậm tích hợp ERP |
| 14 | Hãng và model máy chấm công, có SDK/API không | PV5-01, PV5-03 | Hỗ trợ **cả hai đường**: SDK và import file | Chậm giai đoạn 1 |
| 15 | Triển khai on-premise hay cloud | PV5-14 | Chưa chốt; kiến trúc không phụ thuộc | Ảnh hưởng kế hoạch hạ tầng |
| 16 | Dữ liệu lịch sử cần chuyển đổi từ năm nào | PV5-13 | **12 tháng gần nhất** | Ảnh hưởng khối lượng chuyển đổi |
| 17 | Có yêu cầu báo cáo theo tiêu chuẩn SMETA/BSCI/RBA không | PV6-01 → PV6-06 | Có hỗ trợ báo cáo giờ làm việc theo tuần | Ảnh hưởng phạm vi báo cáo |
| 18 | Nhân sự làm việc tại 2 chi nhánh trong cùng tháng xử lý thế nào | Ngoại lệ #15 | Phân bổ theo đoạn thời gian, áp mức tối thiểu vùng theo từng đoạn | Sai lương và cost center |

---

## 7. 15 tình huống ngoại lệ cần xác minh

Danh mục dùng ở cuối mỗi buổi phỏng vấn với câu hỏi: *"Trường hợp này công ty xử lý như thế
nào?"* — đây là nguồn phát hiện quy tắc nghiệp vụ ẩn hiệu quả nhất.

| # | Tình huống | Đối tượng cần hỏi | Trạng thái xử lý trong tài liệu |
|---|---|---|---|
| 1 | Nhân viên vào làm ngày 20, nghỉ việc ngày 10 tháng sau | HR + Kế toán | ✔ BR-40 (pro-rata theo ngày công thực tế) |
| 2 | Ca đêm bắt đầu 22h ngày cuối tháng, kết thúc 6h ngày đầu tháng sau | QL bộ phận + IT | ✔ BR-13, TC-A04 (thuộc trọn kỳ cũ) |
| 3 | Làm thêm giờ vào ngày lễ trùng Chủ nhật | HR + QL bộ phận | ⚠ Cần xác nhận: áp hệ số ngày lễ (390%) |
| 4 | Nghỉ phép 5 ngày, trong đó có 1 ngày lễ | HR + QL bộ phận | ✔ BR-34 (ngày lễ không trừ quỹ phép) |
| 5 | Quên chấm công vào, đúng hôm đó lại có làm thêm giờ | QL bộ phận | ✔ Trạng thái `ERR`, giải trình rồi mới tính OT |
| 6 | Đơn nghỉ được duyệt sau khi đã chốt công | HR + Kế toán + QL | ✔ BR-42 (chuyển điều chỉnh sang kỳ sau) |
| 7 | Quyết định tăng lương hiệu lực từ ngày 15 giữa tháng | HR + Kế toán | ✔ BR-40 (tách hai đoạn đơn giá) |
| 8 | Nghỉ ốm dài ngày vắt qua hai kỳ lương | HR + Kế toán | ✔ BR-40 (tách theo ngày nghiệp vụ) |
| 9 | Chuyển bộ phận giữa tháng, hai bộ phận có phụ cấp khác nhau | HR + Kế toán | ✔ BR-40 (tách đoạn, phân bổ 2 cost center) |
| 10 | Nhân viên nữ nghỉ thai sản: đóng BH và tính lương ra sao | HR + Kế toán | ✔ BR-35, BR-49 |
| 11 | Nhân viên bị kỷ luật hoặc tạm đình chỉ công tác | HR | ⚠ Cần xác nhận quy chế; **không được trừ lương thay kỷ luật** (BR-45) |
| 12 | Lương thực lĩnh ra số âm do khấu trừ lớn hơn thu nhập | Kế toán | ✔ `CP-05` chặn, giãn khấu trừ sang kỳ sau |
| 13 | Máy chấm công hỏng hoặc mất điện cả ngày | QL bộ phận + IT | ✔ FR-05.11 (nhập bù hàng loạt kèm biên bản) |
| 14 | Ngày lễ trùng ngày nghỉ hằng tuần, có được nghỉ bù không | HR + QL bộ phận | ✔ BR-16 (nghỉ bù ngày làm việc kế tiếp) |
| 15 | Nhân viên làm việc tại 2 chi nhánh trong cùng một tháng | HR + IT | ⚠ Giả định tạm: phân bổ theo đoạn, áp mức vùng theo từng đoạn |

**Chú thích:** ✔ đã có quy tắc rõ ràng · ⚠ còn giả định tạm, cần xác nhận tại walkthrough.

---

## 8. Điều kiện tiên quyết từ phía doanh nghiệp

Trước khi vận hành chính thức, doanh nghiệp phải hoàn thành:

| ☐ | Việc cần làm | Vì sao |
|---|---|---|
| ☐ | **Rà soát và bỏ** điều khoản trừ lương đi trễ, về sớm, không đạt KPI trong nội quy và quy chế lương thưởng | Điều 127 BLLĐ 2019; hệ thống không cài đặt chức năng này |
| ☐ | **Ký biên bản thỏa thuận đồng ý làm thêm giờ** với toàn bộ người lao động | Hệ thống **chặn** OT không có văn bản đồng ý |
| ☐ | Đăng ký nội quy lao động với Sở LĐ-TB&XH | Điều kiện áp dụng kỷ luật hợp pháp |
| ☐ | Rà soát lương HĐLĐ so với lương tối thiểu vùng 2026 | `CP-01` sẽ chặn khi cắt chuyển |
| ☐ | Quyết định có đăng ký trần OT 300 giờ/năm hay không | Ảnh hưởng tham số `OT_CAP_YEAR_REGISTERED` |
| ☐ | Chốt danh sách ngân hàng chi lương và định dạng tệp | Điều kiện tích hợp Bank Hub |
| ☐ | Chốt hãng/model máy chấm công và phương thức kết nối | Điều kiện triển khai giai đoạn 1 |
| ☐ | Chốt phần mềm kế toán/ERP và phương thức kết nối | Điều kiện tích hợp giai đoạn 3 |
| ☐ | Cử đầu mối nghiệp vụ cho từng phân hệ | Điều kiện nghiệm thu UAT |
| ☐ | Bố trí thiết bị kiosk tại xưởng | Điều kiện triển khai ESS cho C1 |

---

## 9. Tiêu chí nghiệm thu tổng thể

| Nhóm | Tiêu chí |
|---|---|
| **Chức năng** | 100% yêu cầu mức **M** (Must) trong [06](06-yeu-cau-chuc-nang.md) đã cài đặt và nghiệm thu |
| **Nghiệp vụ** | 20 kịch bản UAT trong [13 §4](13-user-story-va-tieu-chi-nghiem-thu.md) đều đạt |
| **Thuật toán** | Bộ dữ liệu kiểm thử TC-A01…TC-L02 trong [05 §11](05-thuat-toan-cham-cong-va-tinh-luong.md) đều đạt |
| **Tuân thủ** | Cổng chặn `CP-01`…`CP-09` và đối soát `XC-01`…`XC-10` hoạt động đúng mức đã định nghĩa |
| **Phi chức năng** | Đạt ngưỡng NFR-01 → NFR-60 trong [14](14-yeu-cau-phi-chuc-nang.md) |
| **Chuyển đổi** | Báo cáo đối chiếu 2 kỳ liên tiếp: chênh lệch = 0 hoặc giải thích được toàn bộ |
| **Đào tạo** | Toàn bộ vai trò A, B, D, E đã được đào tạo; C1 đã được hướng dẫn theo tổ |
| **Tài liệu** | Tài liệu hướng dẫn sử dụng theo vai trò, tài liệu vận hành, tài liệu bàn giao |
