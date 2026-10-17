# Hệ thống Quản lý Chấm công & Tiền lương — Công ty sản xuất linh kiện điện tử

Bộ tài liệu dự án, biên soạn trên cơ sở kết quả khảo sát và các tài liệu nghiệp vụ –
pháp lý gốc trong thư mục [`KhaoSat/`](KhaoSat).

| Hạng mục | Nội dung |
|---|---|
| Tên hệ thống | Hệ thống Quản lý Chấm công & Tiền lương (viết tắt: **HRTP**) |
| Đối tượng áp dụng | Công ty sản xuất linh kiện điện tử, **1.500 – 3.000 lao động** |
| Địa điểm | **4**: Trụ sở Hà Nội (Vùng I) · NM Bắc Ninh (Vùng I) · NM Hà Nam (Vùng II) · NM Nghệ An (Vùng III) |
| Phạm vi chức năng | **10 phân hệ / 49 chức năng** theo BFD ([`diagrams/BFD.png`](../diagrams/BFD.png)) |
| Tác nhân hệ thống | **4**: Tổ trưởng (TT) · Quản đốc (QĐ) · Kế toán (KT) · Admin (AD). Công nhân là đối tượng dữ liệu, không đăng nhập |
| Chuẩn pháp lý áp dụng | BLLĐ 2019; NĐ 145/2020/NĐ-CP; NĐ 293/2025/NĐ-CP; NĐ 283/2026/NĐ-CP; NĐ 13/2023/NĐ-CP; Luật Thuế TNCN 109/2025/QH15; NQ 110/2025/UBTVQH15 |
| Kỳ áp dụng | Từ kỳ lương 2026 |
| Phiên bản tài liệu | 2.0 |

## Chỉ mục tài liệu

### A. Bối cảnh và nghiệp vụ

| # | Tài liệu | Nội dung chính |
|---|---|---|
| 01 | [Tổng quan và phạm vi](01-tong-quan-va-pham-vi.md) | Bối cảnh, vấn đề, mục tiêu, phạm vi 10 phân hệ / 49 chức năng, ngoài phạm vi, thuật ngữ |
| 02 | [Các bên liên quan và vai trò](02-cac-ben-lien-quan-va-vai-tro.md) | 4 tác nhân TT / QĐ / KT / AD, các bên ngoài hệ thống, ánh xạ từ 16 vai trò cũ, ma trận RACI |
| 03 | [Cơ cấu tổ chức và hệ thống chức danh](03-co-cau-to-chuc.md) | Cây đơn vị 5 cấp, 4 cơ sở / 3 vùng lương, danh mục phòng ban – phân xưởng – tổ, 8 cấp chức vụ, 6 ngạch lương, người lập – người duyệt theo BFD, `BR-66`…`BR-75` |
| 04 | [Quy tắc nghiệp vụ](04-quy-tac-nghiep-vu.md) | Toàn bộ business rule `BR-01`…`BR-65`: kỳ, ca, công, OT, nghỉ, lương, BH, thuế |
| 05 | [Quy trình nghiệp vụ](05-quy-trinh-nghiep-vu.md) | 11 quy trình theo activity diagram AD-00…AD-10, đối soát `XC`, cổng chặn `CP`, trình tự tính lương |
| 06 | [Thuật toán chấm công và tính lương](06-thuat-toan-cham-cong-va-tinh-luong.md) | Khử trùng, ghép cặp, ca đêm bắc cầu, ma trận OT, gross-up, bộ dữ liệu kiểm thử |
| 07 | [Yêu cầu chức năng](07-yeu-cau-chuc-nang.md) | 10 phân hệ / 49 chức năng BFD, yêu cầu `FR-x.y.z`, ánh xạ SQ ↔ use case, bảng tra mã FR cũ |

### B. Kiến trúc và kỹ thuật

| # | Tài liệu | Nội dung chính |
|---|---|---|
| 08 | [Kiến trúc hệ thống](08-kien-truc-he-thong.md) | Kiến trúc tổng thể theo 10 phân hệ, máy trạng thái duyệt, nhập / xuất tệp, 13 quyết định kiến trúc (ADR) |
| 09 | [Mô hình dữ liệu](09-mo-hinh-du-lieu.md) | ERD, ánh xạ 54 lớp → bảng theo 10 gói, ba tầng dữ liệu công, tham số theo hiệu lực, ràng buộc toàn vẹn |
| 10 | [Phân quyền và bảo mật](10-phan-quyen-va-bao-mat.md) | 4 vai trò × phân quyền theo đơn vị, ma trận quyền theo chức năng BFD, mã hóa, audit log bất biến, NĐ 13/2023 |
| 11 | [Tích hợp hệ thống](11-tich-hop-he-thong.md) | Giao diện dữ liệu vào / ra qua tệp: nhập tệp chấm công, file chi lương, số liệu kế toán, hồ sơ BH – thuế; hạng mục ngoài phạm vi |
| 15 | [Yêu cầu phi chức năng](15-yeu-cau-phi-chuc-nang.md) | `NFR-01`…`NFR-60`: hiệu năng, độ chính xác số học, sao lưu, khả dụng |

### C. Tuân thủ, đầu ra và triển khai

| # | Tài liệu | Nội dung chính |
|---|---|---|
| 12 | [Tuân thủ pháp lý](12-tuan-thu-phap-ly.md) | Ma trận quy định ↔ chức năng, khung chế tài, cổng chặn `CP-01`…`CP-09` |
| 13 | [Báo cáo và kết xuất](13-bao-cao-va-ket-xuat.md) | Báo cáo 10.1 – 10.4, phiếu lương, file chi lương, bằng chứng tuân thủ |
| 14 | [User story và tiêu chí nghiệm thu](14-user-story-va-tieu-chi-nghiem-thu.md) | User story theo 4 tác nhân, acceptance criteria, 28 kịch bản UAT |
| 16 | [Kế hoạch triển khai và rủi ro](16-ke-hoach-trien-khai-va-rui-ro.md) | Lộ trình 4 giai đoạn, thứ tự cắt chuyển theo cơ sở, rủi ro, câu hỏi còn mở, quyết định thiết kế đã chốt |

### D. Tài liệu thiết kế UML

Nằm tại [`../diagrams/`](../diagrams/). Mã nguồn Mermaid của các sơ đồ do nhóm bổ sung nằm trong
thư mục `src/` tương ứng.

| Tài liệu / sơ đồ | Vị trí | Nội dung |
|---|---|---|
| Sơ đồ phân rã chức năng (BFD) | `diagrams/BFD.png` | 10 phân hệ / 49 chức năng, tác nhân từng chức năng — **nguồn chuẩn** |
| Use case | `diagrams/usecase/` | Tổng quan + 10 phân hệ |
| **T1** — Biểu đồ lớp | `diagrams/class/Biểu đồ lớp - Class diagram.docx`, `CD-00`…`CD-10`, `ERD-tong-quan` | 54 lớp / 10 gói, tham số hóa, ba thách thức thiết kế, truy vết SQ → lớp |
| **T2** — Mô tả activity diagram | `diagrams/activity/MÔ  TẢ ACTIVITY DIAGRAM.docx`, `AD-00`…`AD-10` | 11 quy trình kèm chức năng BFD, sequence tương ứng |
| **T3** — Ánh xạ sequence ↔ use case | `diagrams/sequence/mô tả.docx`, `SQ1`…`SQ15` | 15 sequence, phủ 49/49 chức năng |
| Bản rà soát thiết kế v2 | `docs/Cap_nhat_tai_lieu_thiet_ke_v2.docx` | Căn cứ của lần đồng bộ phiên bản 2.0 |

## Cách đọc theo vai trò

| Bạn là | Đọc theo thứ tự |
|---|---|
| Ban lãnh đạo / chủ đầu tư | 01 → 03 → 12 → 16 |
| Nghiệp vụ (Kế toán, Quản đốc, Tổ trưởng) | 01 → 02 → 04 → 05 → 07 → 13 |
| Kiến trúc sư / lập trình viên | 01 → 07 → T1 (biểu đồ lớp) → 06 → 08 → 09 → 10 → 11 → 15 |
| Kiểm thử (QA) | 04 → 06 → 14 → 12 |
| Quản trị dự án | 01 → 03 → 07 → 16 |

## Nguyên tắc xuyên suốt của thiết kế

1. **Không hardcode giá trị pháp lý.** Mọi mức lương tối thiểu, tỷ lệ đóng, hệ số OT, bậc
   thuế đều là dữ liệu tham số có khoảng hiệu lực. Với 4 địa điểm trên 3 vùng, mức áp còn
   phụ thuộc **địa điểm của từng nhân sự** (xem [03](03-co-cau-to-chuc.md), [04](04-quy-tac-nghiep-vu.md)).
2. **Cây tổ chức là trục dữ liệu, không phải sơ đồ trang trí.** Nó quyết định vùng lương tối
   thiểu, phạm vi truy cập, trung tâm chi phí và người duyệt ([03](03-co-cau-to-chuc.md)).
3. **Chứng minh được là đúng, không chỉ tính đúng.** Mọi con số truy vết ngược tới công thức,
   tham số và lượt quẹt gốc ([08](08-kien-truc-he-thong.md), [10](10-phan-quyen-va-bao-mat.md)).
4. **Tuân thủ là cổng chặn, không phải báo cáo.** Vi phạm bị chặn tại thời điểm thao tác,
   không để phát hiện khi thanh tra ([12](12-tuan-thu-phap-ly.md)).
5. **Cấu hình hơn lập trình.** Chính sách thay đổi thì sửa dữ liệu, không sửa mã nguồn.
6. **Bám BFD.** Bốn tác nhân, 49 chức năng; kỳ đã khóa bất biến, điều chỉnh sau khóa là bút
   toán ở kỳ đang mở; hệ thống chỉ nhập / xuất tệp, không kết nối thiết bị hay hệ thống ngoài.

## Hệ thống mã tham chiếu

| Tiền tố | Ý nghĩa | Tài liệu định nghĩa |
|---|---|---|
| `BR-01`…`BR-65` | Quy tắc nghiệp vụ chung | [04](04-quy-tac-nghiep-vu.md) |
| `BR-66`…`BR-75` | Quy tắc về cơ cấu tổ chức | [03](03-co-cau-to-chuc.md) |
| `1.1`…`10.4` | Chức năng BFD (49 chức năng) | [07](07-yeu-cau-chuc-nang.md), `diagrams/BFD.png` |
| `AD-00`…`AD-10` | Activity diagram / quy trình nghiệp vụ | [05](05-quy-trinh-nghiep-vu.md), `diagrams/activity/` |
| `SQ-01`…`SQ-15` | Sequence diagram | [07 §12](07-yeu-cau-chuc-nang.md), `diagrams/sequence/` |
| `G1`…`G10` | Gói biểu đồ lớp (tương ứng 10 phân hệ) | [09](09-mo-hinh-du-lieu.md), `diagrams/class/` |
| `TC-xx` | Kịch bản kiểm thử thuật toán | [06](06-thuat-toan-cham-cong-va-tinh-luong.md) |
| `FR-x.y.z`, `FR-X.n` | Yêu cầu chức năng theo chức năng BFD / yêu cầu xuyên suốt | [07](07-yeu-cau-chuc-nang.md) |
| `ADR-01`…`ADR-13` | Quyết định kiến trúc | [08](08-kien-truc-he-thong.md) |
| `CP-01`…`CP-09` | Cổng chặn tuân thủ trước khi duyệt lương | [12](12-tuan-thu-phap-ly.md) |
| `XC-01`…`XC-10` | Đối soát chéo trước khi chốt công xưởng | [05](05-quy-trinh-nghiep-vu.md) |
| `US-xx` / `UAT-xx` | User story và kịch bản nghiệm thu | [14](14-user-story-va-tieu-chi-nghiem-thu.md) |
| `NFR-01`…`NFR-60` | Yêu cầu phi chức năng | [15](15-yeu-cau-phi-chuc-nang.md) |
| `R-xx` / `RO-xx` | Rủi ro dự án / rủi ro mô hình nhiều địa điểm | [16](16-ke-hoach-trien-khai-va-rui-ro.md), [03](03-co-cau-to-chuc.md) |

## Tài liệu gốc

Thư mục [`KhaoSat/`](KhaoSat) lưu nguyên trạng các tài liệu đầu vào đã dùng để biên soạn
bộ tài liệu này:

| Tệp gốc | Được sử dụng cho |
|---|---|
| `Phạm vi và các bên liên quan.docx` | Tài liệu 01, 02, 03 |
| `Kế hoạch khảo sát và bộ câu hỏi.docx` | Tài liệu 01, 16 (câu hỏi còn mở, ngoại lệ) |
| `Tính năng Quản lý chấm công, tiền lương.docx` | Tài liệu 07, 15 |
| `User story/user stroy và tiêu chí chấp nhận được_.docx` | Tài liệu 14 |
| `Tài liệu liên quan/Đặc tả kỹ thuật phần mềm/BRD - YÊU CẦU NGHIỆP VỤ HỆ THỐNG.docx` | Tài liệu 01, 03, 04, 07 |
| `Tài liệu liên quan/Đặc tả kỹ thuật phần mềm/FSD- THUẬT TOÁN CHẤM CÔNG VÀ TÍNH OT_.docx` | Tài liệu 06 |
| `Tài liệu liên quan/Đặc tả kỹ thuật phần mềm/SPECS - HỆ THỐNG TÍCH HỢP VÀ AN TOÀN DẦU RA 2026.docx` | Tài liệu 08, 10, 11 |
| `Tài liệu liên quan/Pháp lý và chính sách/*.docx` | Tài liệu 12 |
| `Tài liệu liên quan/Mẫu biểu và dữ liệu mẫu/*.xlsx` | Tài liệu 13, 16 (đối chiếu chuyển đổi) |

## Lịch sử thay đổi

| Phiên bản | Nội dung |
|---|---|
| 1.0 | Bộ tài liệu đầu tiên, 15 tài liệu. Phạm vi: 1 trụ sở + 1 nhà máy, 300 – 1.000 lao động, Vùng I |
| 1.1 | Bổ sung **[03. Cơ cấu tổ chức và hệ thống chức danh](03-co-cau-to-chuc.md)**. Mở rộng phạm vi thành **4 địa điểm trên 3 vùng lương**, quy mô **1.500 – 3.000 lao động**. Cập nhật dây chuyền: `CP-01` kiểm theo vùng của từng địa điểm, phạm vi `SITE` lặp theo nhà máy, cụm thiết bị chấm công riêng từng nơi, bút toán theo cost center từng nhà máy |
| **2.0** | **Đồng bộ toàn bộ tài liệu 01 – 16 theo BFD 10 phân hệ / 49 chức năng và 4 tác nhân TT / QĐ / KT / AD** (căn cứ bản rà soát `Cap_nhat_tai_lieu_thiet_ke_v2.docx`). Công nhân không đăng nhập; bỏ ESS / kiosk / mobile, bộ máy workflow, kết nối máy chấm công, Bank Hub, ERP, kê khai điện tử; luồng duyệt cố định (QĐ duyệt lịch ca, OT; TT duyệt đơn nghỉ; KT duyệt, khóa bảng lương); kỳ nghiệp vụ không mở khóa, hồi tố qua bút toán điều chỉnh. Thuế TNCN 2026: biểu 5 bậc, giảm trừ 15,5 / 6,2 triệu. Viết lại 07 theo 49 chức năng (mã `FR-x.y.z`), 05 theo AD-00…AD-10, 09 theo 54 lớp / 10 gói kèm ERD. Cập nhật T1 (biểu đồ lớp v2.0), T2, T3; bổ sung SQ-14, SQ-15 |
| 2.1 | Rà soát lại tài liệu theo ảnh sơ đồ trong `diagrams/` (BFD, use case, AD-00…AD-10, SQ-01…SQ-15, CD-00…CD-10). 05: thêm luồng AD-00 theo bốn làn, viết lại các bước AD-03 theo nhánh hợp lệ / trả lại, bổ sung nhánh “không đủ căn cứ” của hồi tố (AD-07) và “thiếu dữ liệu” của BH – thuế tháng (AD-08). 10, 13: quyền báo cáo bám đúng tác nhân BFD — 10.1 cho TT, QĐ; 10.2 chỉ QĐ; 10.3, 10.4 cho KT; cảnh báo hợp đồng (2.4) và số dư phép (6.2) chuyển về đầu ra của phân hệ gốc. 14: bản đồ hành trình tháng thêm bước KT cập nhật hồ sơ, hợp đồng, chính sách lương |
