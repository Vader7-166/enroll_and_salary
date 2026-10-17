# 16. Kế hoạch triển khai và rủi ro

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
 ├─ AD nhập tệp chấm công từng cơ sở, chạy xử lý công thật (TT, QĐ, KT thao tác trên hệ thống)
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
 GĐ 3 · HOÀN THIỆN
 ├─ Phúc lợi (phân hệ 9), quyết toán thuế năm (8.5), bộ báo cáo đầy đủ (phân hệ 10)
 └─ Đánh giá nhu cầu mở rộng ngoài BFD (ESS, kết nối thiết bị, ngân hàng, ERP, kê khai điện tử)
```

### 1.1. Giai đoạn 0 — Chuẩn bị dữ liệu nền

| Hạng mục | Nội dung | Tác nhân |
|---|---|---|
| Cây tổ chức | Công ty → **4 cơ sở** → Khối → Phòng ban / Phân xưởng → Tổ; gán cost center và **vùng lương cho từng cơ sở** — xem [03 §14](03-co-cau-to-chuc.md) | AD (lãnh đạo xác nhận) |
| Tài khoản, phân quyền | Tài khoản TT, QĐ, KT, AD kèm đơn vị phạm vi | AD |
| Chức danh | 8 cấp chức vụ, 6 ngạch lương, danh mục chức danh | KT |
| Danh mục | Loại HĐ, loại nghỉ, loại phụ cấp, ngân hàng, trình độ | AD, KT |
| Tham số pháp lý | Toàn bộ tham số 2025 – 2026 (gồm biểu thuế 5 bậc, giảm trừ 15,5 / 6,2 triệu), mỗi bản ghi kèm văn bản căn cứ | AD (KT xác nhận) |
| Định nghĩa ca, mẫu xoay ca | Ca A / B / C, ca hành chính, biên độ nhận diện, cờ qua nửa đêm | AD (QĐ cung cấp) |
| Lịch nghỉ lễ | Lịch năm, quy tắc nghỉ bù, hoán đổi ngày nghỉ Tết | AD |
| Chính sách theo cơ sở | Chế độ ca, ngày chốt công, dung sai, định dạng tệp chấm công | AD |
| Cơ cấu lương | Cấu phần thu nhập, 3 cờ mỗi cấu phần, công thức tính | KT |
| Dữ liệu nhân sự | Hồ sơ, hợp đồng, số dư phép đầu kỳ, người phụ thuộc | KT |

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
> Excel tính sai** (5 sai sót đã nêu ở [12 §9](12-tuan-thu-phap-ly.md)). Mỗi chênh lệch phải
> được phân loại: *lỗi hệ thống mới* hay *lỗi công thức Excel cũ*.

### 1.2b. Thứ tự triển khai theo địa điểm

Không cắt chuyển cả 4 địa điểm cùng lúc. Thứ tự đề xuất:

| Đợt | Địa điểm | Lý do |
|---|---|---|
| 1 | **NM Bắc Ninh** | Nhà máy chính, nghiệp vụ phức tạp nhất (3 ca, SMT, OT nhiều) — làm chuẩn cho các nơi còn lại |
| 2 | **Trụ sở Hà Nội** | Khối gián tiếp, nghiệp vụ đơn giản hơn; KT tập trung tại trụ sở |
| 3 | **NM Hà Nam** | Nhân bản cấu hình từ Bắc Ninh, chỉ khác vùng lương (Vùng II) |
| 4 | **NM Nghệ An** | Chế độ 2 ca, quy mô nhỏ nhất, Vùng III |

Mỗi đợt vẫn phải qua đủ tiêu chí chạy song song 2 kỳ của giai đoạn 1.

### 1.3. Giai đoạn 2 — Cắt chuyển

| Việc | Điều kiện |
|---|---|
| Hệ thống thành nguồn chính thức | Đã qua tiêu chí giai đoạn 1 |
| Bật cổng chặn `CP-01`…`CP-09` ở chế độ **CHẶN** | Doanh nghiệp đã xử lý xong các vi phạm tồn đọng phát hiện ở giai đoạn 1 |
| Excel chuyển sang chỉ tra cứu | Đã kết xuất và lưu trữ toàn bộ file lịch sử |

### 1.4. Giai đoạn 3 — Hoàn thiện

Phúc lợi (9.1 – 9.4) · Quyết toán thuế năm (8.5) · Bộ báo cáo đầy đủ (10.1 – 10.4). Các hạng mục
ngoài phạm vi BFD (ESS cho người lao động, kết nối máy chấm công, Bank Hub, ERP, kê khai điện
tử) chỉ xem xét khi doanh nghiệp có yêu cầu mới — xem [11 §6](11-tich-hop-he-thong.md).

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

Thứ tự phản ánh **phụ thuộc kỹ thuật**, đánh số theo phân hệ BFD:

```
 1. NỀN TẢNG (1)          tài khoản · phân quyền theo đơn vị · cây tổ chức · tham số · kỳ · nhật ký
        ↓
 2. DỮ LIỆU GỐC (2, 3.1, 6.1)  hồ sơ · hợp đồng · ca · mẫu xoay ca · lịch nghỉ lễ · loại nghỉ
        ↓
 3. CHẤM CÔNG (4)         nhập tệp · khử trùng · ghép cặp · ca đêm bắc cầu · ngoại lệ · xác nhận · chốt · khóa
        ↓
 4. CA, OT, NGHỈ (3, 5, 6)     xếp ca, duyệt lịch · đề xuất, duyệt OT · trần OT · hệ số · quỹ phép · đơn nghỉ
        ↓
 5. TÍNH LƯƠNG (7)        cơ cấu · formula engine · bảng nháp · cổng chặn · duyệt · khóa · hồi tố
        ↓
 6. BH & THUẾ (8)         mức đóng theo vùng · trích BH · báo tăng giảm · biểu 5 bậc · khấu trừ
        ↓
 7. PHIẾU LƯƠNG, FILE CHI (7.6)  phiếu lương PDF bảo vệ · file chi lương theo mẫu ngân hàng
        ↓
 8. PHÚC LỢI (9), QUYẾT TOÁN (8.5), BÁO CÁO (10)
        ↓
 9. NGHIỆM THU            bộ kiểm thử pháp lý · UAT · hiệu năng 3.000 nhân sự
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
| **R-02** | Formula engine chậm hoặc khó gỡ lỗi khi quy mô lớn | 🟠 Cao | Cache tham số và định nghĩa công thức trong một lần chạy lô; **đo hiệu năng với 3.000 nhân sự từ giai đoạn sớm**; bắt buộc có màn hình drill-down trước khi phát hành phân hệ lương |
| **R-03** | Tham số pháp lý bị cập nhật sai hoặc trễ | 🟠 Cao | Bắt buộc khai báo văn bản căn cứ; cảnh báo khi tham số sắp hết hiệu lực mà chưa có bản ghi kế tiếp; bằng chứng tuân thủ mỗi kỳ ghi tham số đang áp và ngày hiệu lực |
| **R-04** | Tệp chấm công không đủ chất lượng (mã NV không khớp, thiếu bản ghi, đồng hồ máy lệch giờ) | 🟠 Cao | Kiểm tra tệp khi nhập, từ chối lô lỗi kèm danh sách dòng lỗi (SQ-02); đối soát chéo `XC-01`…`XC-10` trước khi chốt xưởng; TT giải trình ngoại lệ; **cơ sở định kỳ đồng bộ giờ máy chấm công** |
| **R-05** | Mã hóa cột nhạy cảm làm chậm truy vấn và mất khả năng tìm kiếm | 🟡 Trung bình | Chỉ mã hóa tập trường thực sự nhạy cảm; giữ trường băm có muối nếu cần đối chiếu trùng CCCD; đánh chỉ mục trên trường không mã hóa |
| **R-06** | **Người dùng vẫn muốn chức năng trừ lương đi trễ** vì "quy chế công ty đang làm vậy" | 🟠 Cao | **Không cài đặt**; cung cấp thay thế bằng điểm chuyên cần ảnh hưởng khoản thưởng và quy trình kỷ luật 3 bước; nêu rõ khung phạt **40 – 80 triệu** trong tài liệu bàn giao và **trên màn hình cấu hình khấu trừ** |
| **R-07** | Chuyển đổi dữ liệu lịch sử từ Excel sai lệch | 🟠 Cao | Bắt buộc báo cáo đối chiếu tổng thu nhập / khấu trừ / thực lĩnh theo từng kỳ giữa nguồn và đích; **chạy song song ít nhất 2 kỳ** trước khi cắt chuyển |
| **R-08** | Chạy song song Excel và hệ thống mới gây tải kép cho KT | 🟡 Trung bình | Giới hạn chạy song song **đúng 2 kỳ**; ưu tiên hoàn thiện module chấm công + OT trước để giảm khối lượng thủ công nặng nhất ngay từ kỳ đầu |
| **R-09** | Tổ trưởng chưa quen thao tác thay công nhân trên hệ thống (đơn nghỉ, giải trình, đề xuất OT) | 🟡 Trung bình | Giao diện xưởng ≤ 3 bước cho thao tác chính; đào tạo theo xưởng; giữ biểu mẫu giấy đơn nghỉ / giải trình để TT nhập lại trong giai đoạn đầu |
| **R-10** | Chưa chốt hãng / model máy chấm công (PV5-01, PV5-03) | 🟢 Thấp | Hệ thống chỉ cần **tệp xuất** từ phần mềm máy chấm công; ánh xạ cột cấu hình theo cơ sở |
| **R-11** | Chưa chốt ERP và danh sách ngân hàng (PV5-10, PV2-22) | 🟢 Thấp | Chỉ xuất tệp: bảng phân bổ chi phí cho kế toán tổng hợp; file chi lương theo mẫu khai báo được cho từng ngân hàng |
| **R-12** | Chưa chốt on-premise hay cloud (PV5-14) | 🟢 Thấp | Kiến trúc không phụ thuộc hạ tầng cụ thể (NFR-48) |
| **R-14** | **Áp nhầm mức lương tối thiểu giữa 3 vùng** cho nhân sự các nhà máy tỉnh | 🔴 Rất cao | Vùng lương bắt buộc trên mọi cơ sở và kế thừa xuống dưới; `CP-01` chạy theo từng nhân sự; bộ test riêng cho cả 3 vùng; xem [03 §13 RO-01](03-co-cau-to-chuc.md) |
| **R-15** | Nhà máy tỉnh nhập tệp chấm công trễ, chậm chốt công toàn công ty | 🟠 Cao | Kỳ công mở và khóa theo từng cơ sở; theo dõi trạng thái nhập theo cơ sở; chốt công theo cơ sở rồi mới hợp nhất báo cáo |
| **R-16** | Điều chuyển liên tỉnh làm giảm lương xuống dưới mức đã thỏa thuận | 🟠 Cao | Cảnh báo khi lưu quyết định điều chuyển kèm giảm lương (BR-08, BR-68) |
| **R-17** | Khối lượng thao tác của tổ trưởng tăng vì làm thay công nhân | 🟡 Trung bình | Đề xuất OT cho nhiều công nhân trong một lần; ghi nhận đơn nghỉ nhanh; QĐ theo dõi tiến độ xác nhận công của các tổ |
| **R-18** | Điểm mở Q2 (quy đổi nghỉ bù) chưa chốt | 🟡 Trung bình | FR-5.5.1 để mức **S**; triển khai sau khi nhóm chốt; trong lúc chờ, giờ OT thực tế luôn được giữ để kiểm soát trần |
| **R-13** | Vi phạm tồn đọng bị phát hiện khi bật cổng chặn ở GĐ 2 | 🟠 Cao | Chạy cổng chặn ở chế độ **cảnh báo** suốt GĐ 1 để doanh nghiệp có thời gian xử lý trước khi chuyển sang chế độ chặn |

---

## 6. Câu hỏi còn mở

Các câu hỏi sau **chưa có đáp án từ khảo sát**. Mỗi mục ghi kèm **giả định tạm** đang dùng để
không chặn tiến độ. Cần xác nhận tại **buổi walkthrough** với Kế toán + Quản đốc + Tổ trưởng.

| # | Câu hỏi | Nguồn | Giả định tạm đang dùng | Ảnh hưởng nếu sai |
|---|---|---|---|---|
| 1 | Ngày công chuẩn tháng: cố định 26 hay theo thực tế? | PV1-32, PV1-33 | Cấu hình được; mặc định **26** cho khối sản xuất | Sai toàn bộ đơn giá giờ và ngày |
| 2 | Dung sai đi muộn/về sớm bao nhiêu phút, xử lý khi vượt? | PV3-07 | **15 phút**; vượt thì ghi nhận nhưng không trừ lương | Ảnh hưởng số công và báo cáo chuyên cần |
| 3 | Chu kỳ xoay ca cụ thể (3 ca 3 kíp hay 3 ca 4 kíp)? | PV3-03 | Chu kỳ tuần, khai báo được | Ảnh hưởng module xếp ca |
| 4 | Tập cấu phần cấu thành "lương làm căn cứ tính OT" | PV1-29 | Lương cơ bản theo HĐLĐ; cấu hình được | Sai toàn bộ tiền OT |
| 5 | Tập cấu phần cấu thành "lương đóng bảo hiểm" | PV2-01 | Các cấu phần có `is_insurable = true` | Sai số liệu nộp BHXH |
| 6 | Định mức miễn thuế ăn ca / đồng phục / điện thoại | PV2-09 | Theo định mức pháp luật, tham số hóa | Sai thuế TNCN |
| 7 | Số lần giải trình quên chấm công tối đa mỗi tháng | PV3-09 | **3 lần**; vượt thì cảnh báo QĐ khi chốt xưởng (không thêm cấp duyệt) | Ảnh hưởng kiểm soát ngoại lệ |
| 8 | Chính sách phép dư cuối năm: chuyển / hủy / thanh toán | PV1-18 | Chuyển tối đa **5 ngày**, hạn dùng **31/03** năm sau | Sai số dư phép |
| 9 | Có cho ứng phép trước của năm sau không, tối đa mấy ngày | PV1-17 | Cho phép, tối đa **3 ngày** | Ảnh hưởng kiểm tra số dư |
| 10 | Tỷ lệ quy đổi OT sang nghỉ bù và hạn sử dụng | PV3-21 | **1 : 1,5**, hạn **3 tháng** (gắn với điểm mở Q2) | Ảnh hưởng quỹ nghỉ bù |
| 11 | Doanh nghiệp đã đăng ký trần OT 300 giờ/năm chưa? | Checklist tuân thủ | **Chưa**; áp trần 200 giờ, có cờ bật | Rủi ro phạt 150 triệu nếu áp sai |
| 12 | Danh sách ngân hàng chi lương và định dạng từng ngân hàng | PV2-22 | Cấu hình mẫu tệp, chưa có mẫu cụ thể | Chậm xuất file chi lương |
| 13 | Phần mềm kế toán / ERP đang dùng | PV5-10 | Chỉ xuất bảng phân bổ chi phí lương; kế toán tổng hợp nhập vào phần mềm | Mẫu bảng phân bổ cần khớp phần mềm kế toán |
| 14 | Hãng và model máy chấm công, định dạng tệp xuất | PV5-01, PV5-03 | Chỉ nhập tệp; ánh xạ cột theo cơ sở | Cần mẫu tệp thật của từng cơ sở trước GĐ 1 |
| 15 | Triển khai on-premise hay cloud | PV5-14 | Chưa chốt; kiến trúc không phụ thuộc | Ảnh hưởng kế hoạch hạ tầng |
| 16 | Dữ liệu lịch sử cần chuyển đổi từ năm nào | PV5-13 | **12 tháng gần nhất** | Ảnh hưởng khối lượng chuyển đổi |
| 17 | Có yêu cầu báo cáo theo tiêu chuẩn SMETA/BSCI/RBA không | PV6-01 → PV6-06 | Có hỗ trợ báo cáo giờ làm việc theo tuần | Ảnh hưởng phạm vi báo cáo |
| 18 | ~~Nhân sự làm việc tại 2 chi nhánh trong cùng tháng~~ | Ngoại lệ #15 | ✔ **Đã chốt**: BR-67 — tách đoạn, áp mức vùng theo từng đoạn, phân bổ cost center theo tỷ lệ ngày công | – |
| 19 | Ngày chốt công có khác nhau giữa 3 nhà máy không? | Mới phát sinh | Giả định tạm: **thống nhất ngày 25** cho cả 4 địa điểm; `CUTOFF_DAY` cấu hình được theo `SITE` | Lệch ranh giới kỳ giữa các nhà máy |
| 20 | Điều chuyển liên tỉnh có kèm phụ cấp thu hút / hỗ trợ nhà ở không? | Mới phát sinh | Giả định tạm: **có**, khai báo thành cấu phần lương riêng có cờ chịu thuế | Sai thu nhập chịu thuế |
| 21 | NM Nghệ An chạy 2 ca — có kế hoạch mở ca 3 không? | Mới phát sinh | Giả định tạm: **chưa**; chế độ ca khai báo theo `SITE` nên mở thêm ca không cần sửa mã | Ảnh hưởng kế hoạch nhân lực |
| 22 | **Q2 – Quy đổi nghỉ bù:** phần giờ OT đã quy đổi có còn được trả tiền không, trần OT tính trên giờ nào? (SQ-04 ghi “trừ giờ OT trả tiền, cộng quỹ nghỉ bù”; AD-05 ghi giờ thực tế vẫn giữ để kiểm soát trần) | Bản cập nhật thiết kế v2 | Giờ OT thực tế luôn giữ để kiểm soát trần; quy đổi chỉ khi có căn cứ | Cách lưu `comp_time_conversion` / `ot_actual`, câu chữ AD-05 và SQ-04 |
| 23 | Ai ghi nhận đơn nghỉ, giải trình công của **chính tổ trưởng**? | Mới phát sinh (đồng bộ BFD) | Người được cấp vai trò TT khác cho tổ đó (ví dụ tổ phó); hệ thống chặn tự duyệt | Kiểm soát nội bộ ([10 §7](10-phan-quyen-va-bao-mat.md)) |
| 24 | KT tập trung tại trụ sở hay có KT tại từng nhà máy? | Mới phát sinh (đồng bộ BFD) | KT tập trung, phạm vi `ALL`; có thể cấp thêm KT phạm vi `SITE` | Phân quyền và phân công khóa kỳ |

### 6.1. Quyết định thiết kế đã chốt (bản cập nhật v2, 02/10/2026)

| # | Nội dung | Quyết định |
|---|---|---|
| Q1 | `CaLamViec.CoBacCau`, `tinhGioDemBacCau()` | Gỡ khỏi lớp; ca vắt qua nửa đêm thể hiện bằng `CoQuaNgay` + `tinhSoGioCaDem()` (BR-13) |
| Q3 | Không có tác nhân HR / C&B | KT đảm nhiệm hồ sơ và hợp đồng (phân hệ 2) |
| Q4 | Trợ cấp thôi việc, mất việc (9.3) | Tính khi KT xác nhận chấm dứt HĐ (2.5, SQ-09); theo dõi chi phí tại 9.4 |
| Q5 | Sequence cho 1.2, 1.4, 2.1, 2.2, 2.4 | Bổ sung SQ-14, SQ-15 — phủ 49/49 chức năng |
| Q6 | Đối chiếu repo | Bộ sơ đồ trong repo trùng với tệp nhóm tải lên; đã đồng bộ tài liệu 01 – 16 theo BFD |

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
| 6 | Đơn nghỉ được duyệt sau khi đã khóa công | Kế toán + Tổ trưởng | ✔ BR-42 (bút toán điều chỉnh ở kỳ đang mở) |
| 7 | Quyết định tăng lương hiệu lực từ ngày 15 giữa tháng | HR + Kế toán | ✔ BR-40 (tách hai đoạn đơn giá) |
| 8 | Nghỉ ốm dài ngày vắt qua hai kỳ lương | HR + Kế toán | ✔ BR-40 (tách theo ngày nghiệp vụ) |
| 9 | Chuyển bộ phận giữa tháng, hai bộ phận có phụ cấp khác nhau | HR + Kế toán | ✔ BR-40 (tách đoạn, phân bổ 2 cost center) |
| 10 | Nhân viên nữ nghỉ thai sản: đóng BH và tính lương ra sao | HR + Kế toán | ✔ BR-35, BR-49 |
| 11 | Nhân viên bị kỷ luật hoặc tạm đình chỉ công tác | HR | ⚠ Cần xác nhận quy chế; **không được trừ lương thay kỷ luật** (BR-45) |
| 12 | Lương thực lĩnh ra số âm do khấu trừ lớn hơn thu nhập | Kế toán | ✔ `CP-05` chặn, giãn khấu trừ sang kỳ sau |
| 13 | Máy chấm công hỏng hoặc mất điện cả ngày | Quản đốc + Tổ trưởng | ✔ FR-4.3.3 (TT điều chỉnh công cho cả tổ kèm biên bản sự cố) |
| 14 | Ngày lễ trùng ngày nghỉ hằng tuần, có được nghỉ bù không | HR + QL bộ phận | ✔ BR-16 (nghỉ bù ngày làm việc kế tiếp) |
| 15 | Nhân viên làm việc tại 2 chi nhánh trong cùng một tháng | HR + IT | ✔ **BR-67** — tách đoạn, áp mức vùng từng đoạn, phân bổ 2 cost center |

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
| ☐ | Chốt danh sách ngân hàng chi lương và định dạng tệp | Điều kiện xuất file chi lương |
| ☐ | **Xác nhận vùng lương của cả 4 cơ sở** theo NĐ 293/2025 | `CP-01` so sai vùng là rủi ro phạt 150 triệu |
| ☐ | **Ban hành sơ đồ tổ chức và danh mục chức danh chính thức** | Điều kiện khai báo cây tổ chức và phân quyền |
| ☐ | Cung cấp mẫu tệp xuất từ máy chấm công của từng cơ sở | Điều kiện cấu hình ánh xạ trước giai đoạn 1 |
| ☐ | Chốt mẫu bảng phân bổ chi phí lương cho kế toán tổng hợp | Điều kiện báo cáo 10.3 |
| ☐ | Danh sách tổ trưởng, quản đốc, kế toán, admin kèm đơn vị phụ trách | Điều kiện cấp tài khoản và phân quyền |
| ☐ | Cử đầu mối nghiệp vụ cho từng phân hệ | Điều kiện nghiệm thu UAT |
| ☐ | Bố trí máy trạm / máy tính bảng tại xưởng cho TT, QĐ | Điều kiện thao tác tại xưởng |
| ☐ | Thông báo cho người lao động cách nhận phiếu lương và kênh phản ánh qua TT / KT | Người lao động không truy cập hệ thống |

---

## 9. Tiêu chí nghiệm thu tổng thể

| Nhóm | Tiêu chí |
|---|---|
| **Chức năng** | 100% yêu cầu mức **M** (Must) trong [07](07-yeu-cau-chuc-nang.md) đã cài đặt và nghiệm thu |
| **Nghiệp vụ** | 28 kịch bản UAT trong [14 §4](14-user-story-va-tieu-chi-nghiem-thu.md) đều đạt |
| **Thiết kế** | Luồng cài đặt khớp activity AD-00 … AD-10 và sequence SQ-01 … SQ-15; mô hình dữ liệu khớp biểu đồ lớp 54 lớp / 10 gói |
| **Thuật toán** | Bộ dữ liệu kiểm thử TC-A01…TC-L02 trong [06 §11](06-thuat-toan-cham-cong-va-tinh-luong.md) đều đạt |
| **Tuân thủ** | Cổng chặn `CP-01`…`CP-09` và đối soát `XC-01`…`XC-10` hoạt động đúng mức đã định nghĩa |
| **Phi chức năng** | Đạt ngưỡng NFR-01 → NFR-60 trong [15](15-yeu-cau-phi-chuc-nang.md) |
| **Chuyển đổi** | Báo cáo đối chiếu 2 kỳ liên tiếp: chênh lệch = 0 hoặc giải thích được toàn bộ |
| **Đào tạo** | Toàn bộ TT, QĐ, KT, AD đã được đào tạo; người lao động được thông báo kênh nhận phiếu lương và phản ánh |
| **Tài liệu** | Tài liệu hướng dẫn sử dụng theo vai trò, tài liệu vận hành, tài liệu bàn giao |
