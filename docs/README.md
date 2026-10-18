# Hệ thống Quản lý Chấm công & Tiền lương — Công ty sản xuất linh kiện điện tử

Bộ tài liệu dự án, biên soạn trên cơ sở kết quả khảo sát và các tài liệu nghiệp vụ –
pháp lý gốc trong thư mục [`KhaoSat/`](KhaoSat).

| Hạng mục | Nội dung |
|---|---|
| Tên hệ thống | Hệ thống Quản lý Chấm công & Tiền lương (viết tắt: **HRTP**) |
| Đối tượng áp dụng | Công ty sản xuất linh kiện điện tử, **1.500 – 3.000 lao động** |
| Địa điểm | **4**: Trụ sở Hà Nội (Vùng I) · NM Bắc Ninh (Vùng I) · NM Hà Nam (Vùng II) · NM Nghệ An (Vùng III) |
| Phạm vi chức năng | R1: **10 phân hệ / 49 ô BFD**, 48 hoạt động + kiểm tra 5.5 chưa kích hoạt; [BFD R1](../diagrams/release/R1-bfd.mmd) |
| Tác nhân hệ thống | **4**: Tổ trưởng (TT) · Quản đốc (QĐ) · Kế toán (KT) · Admin (AD). Công nhân là đối tượng dữ liệu, không đăng nhập |
| Chuẩn pháp lý áp dụng | BLLĐ 2019; NĐ 145/2020/NĐ-CP; NĐ 293/2025/NĐ-CP; NĐ 283/2026/NĐ-CP; NĐ 13/2023/NĐ-CP; Luật Thuế TNCN 109/2025/QH15; NQ 110/2025/UBTVQH15; NĐ 253/2026/NĐ-CP; TT 111/2013 và NQ 954/2020 cho bộ thuế lịch sử 2025 |
| Kỳ áp dụng | Từ kỳ lương 2026 |
| Phiên bản tài liệu | 2.19 |

**Tech stack đã chốt (TECH-01):** React + TypeScript + Vite, Ant Design, TanStack Query;
NestJS + TypeScript; PostgreSQL + Prisma; Decimal.js. Kiến trúc modular monolith,
phát triển trên VS Code. Xem [20 — Tech stack và môi trường phát triển](20-tech-stack-va-moi-truong-phat-trien.md).

**Luồng local đã chạy:** migration/seed, đăng nhập/phiên và phạm vi đơn vị; nhân sự,
hợp đồng/phụ lục mã hóa, điều chuyển theo ngày hiệu lực; tham số/chính sách phiên bản,
tạo/mở kỳ công, danh mục ca/phân ca/gửi duyệt/QĐ duyệt và lịch sử; quản trị phiên và
nhập tệp/ghép lượt quẹt, bảng công/ngoại lệ và nguồn gốc lượt quẹt; đăng ký/gửi/duyệt OT,
trả lại/từ chối/hủy, hạn mức và snapshot lịch sử; health PostgreSQL thật. Hướng dẫn
cài/chạy, bảo vệ khóa mã hóa và tài khoản demo tại [20 §7](20-tech-stack-va-moi-truong-phat-trien.md#7-chạy-môi-trường-demo-local).
Chưa có đối chiếu/tiền OT, nghỉ/giải trình, xác nhận/chốt công, tính lương, chốt/khóa kỳ hoặc AI; không đổi nghiệm thu lõi,
không commit/đổi nhánh.
**Dữ liệu local:** bộ doanh nghiệp giả lập 2.200 nhân sự theo cơ cấu bốn cơ sở;
có chức danh, hợp đồng/lương mã hóa, phụ lục và điều chuyển. Giữ hồ sơ đã nhập,
không dùng thông tin cá nhân thật; xem [20 §7.9](20-tech-stack-va-moi-truong-phat-trien.md).


**UI design guide:** [22](22-ui-design-guide.md), hướng Minimalism + Bento ở dashboard;
[token chuẩn](config/hrtp-ui-tokens.json) và [điểm vào cho agent](../DESIGN.md).

**AI ưu tiên: AI-02 — [Trợ lý nghiệp vụ theo vai trò](24-ai-tro-ly-nghiep-vu-theo-vai-tro.md)**,
dùng Google Gemini cho TT/QĐ/KT/AD. Hỏi đáp tài liệu có nguồn và link đúng quyền,
không đọc dữ liệu nhân sự/lương hoặc thực hiện thao tác. Chuẩn bị ngày 1–3, tích hợp
ngày 4–5, 12 AC riêng; [manifest AI](config/hrtp-ai-features.json). AI-01 giải thích
lương ở tài liệu 23 chuyển sang hướng sau sprint. Baseline lõi giữ nguyên.

**Nền tảng:** chỉ làm website truy cập bằng trình duyệt; React và NestJS là các thành
phần của cùng website. Không có ứng dụng cài riêng cho mobile/desktop/hybrid hoặc PWA
cài đặt/offline. Responsive trên máy tính bảng vẫn thuộc cùng website.

**Bản đầu đã chốt:** [19 — phạm vi R1 và nghiệm thu](19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md),
[manifest](config/hrtp-release-r1.json): **152/158 FR** thuộc R1, sáu FR sau R1. Giữ đủ hình
thức lương, phúc lợi, quyết toán năm và báo cáo; nghỉ quy đổi OT chưa kích hoạt. Phạm vi
đã đặc tả không có nghĩa phần mềm đã được cài đặt/nghiệm thu. Kiểm tra đồng bộ bằng
`python scripts/validate_release_scope.py` từ thư mục gốc.

**Cập nhật thuế ngày 17/10/2026:** bộ quy tắc hiện hành và ma trận áp dụng nằm ở
[12 §2.7](12-tuan-thu-phap-ly.md). TNCN tiền lương theo thời điểm chi trả; bộ 2025 và 2026
khác nhau về biểu, giảm trừ và miễn OT/đêm. Riêng mức ăn ca mới từ 01/07/2026. Word/Excel
trong `KhaoSat/` là nguồn khảo sát lịch sử, có nội dung đã được sửa trong bộ Markdown;
không dùng tham chiếu NĐ 320/2025 về TNCN hoặc kết quả Excel cũ làm chuẩn nghiệm thu.

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
| 08 | [Kiến trúc hệ thống](08-kien-truc-he-thong.md) | Kiến trúc tổng thể theo 10 phân hệ, máy trạng thái duyệt, nhập / xuất tệp, 14 quyết định kiến trúc (ADR), TECH-01 |
| 09 | [Mô hình dữ liệu](09-mo-hinh-du-lieu.md) | ERD, ánh xạ 54 lớp → bảng theo 10 gói, ba tầng dữ liệu công, tham số theo hiệu lực, ràng buộc toàn vẹn |
| 10 | [Phân quyền và bảo mật](10-phan-quyen-va-bao-mat.md) | 4 vai trò × phân quyền theo đơn vị, ma trận quyền theo chức năng BFD, mã hóa, audit log bất biến, NĐ 13/2023 |
| 11 | [Tích hợp hệ thống](11-tich-hop-he-thong.md) | Giao diện dữ liệu vào / ra qua tệp: nhập tệp chấm công, file chi lương, số liệu kế toán, hồ sơ BH – thuế; hạng mục ngoài phạm vi |
| 15 | [Yêu cầu phi chức năng](15-yeu-cau-phi-chuc-nang.md) | `NFR-01`…`NFR-60`: hiệu năng, độ chính xác số học, sao lưu, khả dụng |
| 20 | [Tech stack và môi trường phát triển](20-tech-stack-va-moi-truong-phat-trien.md) | TECH-01: React/TypeScript, NestJS, PostgreSQL/Prisma, Decimal.js, modular monolith và VS Code |
| 22 | [UI design guide](22-ui-design-guide.md) | HRTP-UI-01: token, layout, dashboard, bảng/form, trạng thái nghiệp vụ, responsive, accessibility và checklist cho agent |
| 23 | [AI giải thích bảng lương — sau sprint](23-ai-giai-thich-bang-luong.md) | AI-01 dự trữ cho KT đúng quyền, chưa giao task trong sprint 5 ngày |
| 24 | [Trợ lý AI nghiệp vụ theo vai trò](24-ai-tro-ly-nghiep-vu-theo-vai-tro.md) | AI-02 ưu tiên: Google Gemini, TT/QĐ/KT/AD, 8 yêu cầu/12 AC, corpus/nguồn/quyền, drawer, 22 câu Q&A và fallback |

### C. Tuân thủ, đầu ra và triển khai

| # | Tài liệu | Nội dung chính |
|---|---|---|
| 12 | [Tuân thủ pháp lý](12-tuan-thu-phap-ly.md) | Ma trận quy định ↔ chức năng, khung chế tài, cổng chặn `CP-01`…`CP-09` |
| 13 | [Báo cáo và kết xuất](13-bao-cao-va-ket-xuat.md) | Báo cáo 10.1 – 10.4, phiếu lương, file chi lương, bằng chứng tuân thủ |
| 14 | [User story và tiêu chí nghiệm thu](14-user-story-va-tieu-chi-nghiem-thu.md) | User story theo 4 tác nhân, acceptance criteria, 29 dòng UAT (gồm UAT-05b) |
| 16 | [Kế hoạch triển khai và rủi ro](16-ke-hoach-trien-khai-va-rui-ro.md) | Lộ trình 4 giai đoạn, thứ tự cắt chuyển theo cơ sở, rủi ro, câu hỏi còn mở, quyết định thiết kế đã chốt |
| 17 | [Vòng đời kỳ công và ca qua ngày chốt](17-vong-doi-ky-cong-va-ca-qua-ngay-chot.md) | PLANNED/OPEN/CLOSED/LOCKED, mở kỳ song song, nhận log qua ngày chốt, đủ nguồn, log muộn và khóa nguyên tử |
| 18 | [Xác nhận chính sách và đầu vào tính lương](18-xac-nhan-chinh-sach-va-dau-vao-tinh-luong.md) | DEC-01…03 đã xác nhận; 24 mục chính sách, chưa bật nghỉ bù OT, đủ hình thức lương, hợp đồng dữ liệu/9 fixture và [cấu hình mô phỏng](config/hrtp-simulation-policy.json) |
| 19 | [Phạm vi bản đầu và ma trận nghiệm thu](19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md) | 152 M / 6 FR backlog; 49 ô BFD; sơ đồ phạm vi/dữ liệu; 12 nhóm nghiệm thu và manifest từng FR |
| 21 | [Roadmap triển khai 5 ngày](21-roadmap-trien-khai-5-ngay.md) | Phân công Codex/Claude Code/Antigravity, đầu ra từng ngày, phụ thuộc, cổng kiểm thử và mẫu giao việc |

### D. Tài liệu thiết kế UML

Nằm tại [`../diagrams/`](../diagrams/). Mã nguồn Mermaid của các sơ đồ do nhóm bổ sung nằm trong
thư mục `src/` tương ứng.

**Sơ đồ theo baseline R1:** [BFD đủ 49 chức năng](../diagrams/release/R1-bfd.mmd),
[phạm vi/phụ thuộc](../diagrams/release/R1-scope.mmd), [dữ liệu bổ sung](../diagrams/release/R1-data.mmd).
Mermaid phạm vi hiển thị trực tiếp trong tài liệu 19. PNG/Word tổng quan gốc dùng để tham
khảo toàn hệ thống; manifest và nhãn R1 quyết định chức năng đang hoạt động, chưa kích
hoạt hoặc sau R1. Nguồn ERD tổng quan cũng đã cập nhật quan hệ nguồn và giới hạn R1.

**Vòng đời kỳ cập nhật:** dùng [17](17-vong-doi-ky-cong-va-ca-qua-ngay-chot.md), nguồn
[SQ-02](../diagrams/sequence/src/SQ2.mmd), [SQ-03](../diagrams/sequence/src/SQ3.mmd),
[SQ-11](../diagrams/sequence/src/SQ11.mmd) và [CD-01](../diagrams/class/src/CD-01-quan-tri-he-thong.mmd).
PNG/Word cũ của các luồng này lưu để tham khảo lịch sử; không dùng yêu cầu “khóa kỳ trước
mới mở kỳ sau” hoặc chặn lượt Ra sáng 26 trong ảnh để nghiệm thu. Mermaid trong 17 mô tả
vòng trạng thái hiện hành và hiển thị trực tiếp khi đọc trên GitHub.

**Chính sách đã xác nhận 17/10/2026:** [18](18-xac-nhan-chinh-sach-va-dau-vao-tinh-luong.md)
là nguồn chuẩn cho DEC-01…03. Chưa bật quy đổi OT, không dùng nghỉ bù thay tiền OT; giữ đủ
hình thức lương và dùng cấu hình mô phỏng đồ án. Nguồn [SQ-04](../diagrams/sequence/src/SQ4.mmd)
và [CD-05](../diagrams/class/src/CD-05-lam-them-gio.mmd) đã sửa; PNG/Word cũ ghi “Q2 chờ chốt”
hoặc “trừ giờ OT trả tiền” chỉ là lịch sử, không dùng để nghiệm thu.

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
| 2.19 | Hoàn thành subtask đăng ký/duyệt OT: migration/API/UI, TT lập/sửa/gửi/hủy, QĐ duyệt/trả lại/từ chối; chứng từ từng người, phạm vi hiện tại/theo ngày, chống trùng, trần 200/300 giờ, khóa kỳ, cạnh tranh duyệt và snapshot bất biến. Sửa lệch UTC khi mở sửa; UI desktop/390px và HTTP/PostgreSQL thật. OT 7/7, hồi quy 71/71; chưa đối chiếu OT thực tế hoặc tiền OT. Xem 20 §7.12 |
| 2.18 | Triển khai nhập CSV/TXT/XLSX, cấu hình cột, nguồn lượt quẹt bất biến, chống nhập trùng, ghép ca đã duyệt và ca đêm/nghỉ giữa ca; bảng công/ngoại lệ theo phạm vi hiện tại và ngày công. Log chờ/kỳ kề/log muộn không sửa công kỳ đóng/khóa. Kiểm chứng 21/21 và UI thật; xem 20 §7.11 |
| 2.17 | Triển khai danh mục ca hành chính/ngày/đêm, phân ca theo tổ hoặc người/ngày, TT gửi và QĐ duyệt/trả lại; lịch chính thức chỉ APPROVED và snapshot lịch sử append-only. Bảo vệ phạm vi hiện tại/theo ngày, nghỉ chuyển ca 12 giờ, trần 8/48 giờ, khóa kỳ và cạnh tranh ghi. Kiểm chứng API PostgreSQL cách ly 14/14 và UI thật; xem 20 §7.10 |
| 2.16 | Nâng seed local thành bộ doanh nghiệp giả lập 2.200 nhân sự, 29 phòng ban/phân xưởng, hợp đồng/lương mã hóa, phụ lục, điều chuyển và kỳ công tháng 10–11. Giữ dữ liệu nhập qua UI, mật khẩu, phân quyền, khóa và phiên bản chính sách; sao lưu trước nhập, kiểm chứng seed lặp lại và API/UI thật. Không dựng kết quả công/lương chưa triển khai; xem 20 §7.9 |
| 2.15 | Sửa bốn lỗi biên HR: điều chuyển bảo vệ toàn khoảng ảnh hưởng kỳ đóng/khóa và cây cha theo ngày; tham số chặn đúng phạm vi/khoảng (kể cả đuôi phiên bản bị cắt); tạo/mở kỳ tùy chỉnh kiểm tra xuyên suốt hiệu lực/quyền; ngày quyết định sau hiệu lực trả 400. Bổ sung hồi quy PostgreSQL/HTTP và smoke tách biệt, giữ nguyên dữ liệu nghiệp vụ demo; xem 20 §7.8 |
| 2.14 | Bổ sung migration/API/UI hợp đồng và phụ lục mã hóa, điều chuyển có lịch sử hiệu lực, tham số/chính sách phiên bản và tạo/mở kỳ công. Kiểm chứng PostgreSQL sạch, phân quyền, cạnh tranh ghi và UI thật; bổ sung hướng dẫn khóa dữ liệu/nâng cấp tại 20 §7.8. Chưa triển khai engine công/lương hoặc AI, không đổi nghiệm thu lõi |
| 2.13 | Triển khai luồng nền Ngày 1: Prisma migrations/seed bốn cơ sở và bốn vai trò; phiên cookie HttpOnly, phân quyền đơn vị/hiệu lực/exclusion; xem/tạo nhân sự; cơ cấu tổ chức, Admin thu hồi phiên và audit append-only. Kiểm chứng API với database sạch và UI thật; cập nhật 20 §7. Chưa nghiệm thu toàn bộ R1 hoặc triển khai AI |
| 2.12 | Khởi tạo npm workspaces, React/Vite/Ant Design/TanStack Query và NestJS/Prisma; ghim runtime/dependency, cụm PostgreSQL demo riêng, health thật 200/503 và trang kiểm tra kết nối; thêm hướng dẫn local ở 20 §7. Chưa triển khai nghiệp vụ hoặc AI; giữ nguyên nghiệm thu lõi |
| 2.11 | Chủ dự án chọn Google Gemini và AI-02 trợ lý nghiệp vụ cho bốn vai trò. Thêm 24, manifest AI, sơ đồ; đồng bộ roadmap/quyền/kiến trúc/UI. AI-01 chuyển sang sau sprint; giữ nguyên 152 M lõi |
| 2.10 | Đưa AI-01 giải thích bảng lương vào kế hoạch ngày 4–5 sau gate lõi; thêm 23, 6 AI-REQ/10 AC, phân công, contract, quyền/nguồn/fallback; chưa chọn provider, không đổi 152 M lõi |
| 2.9 | Làm rõ chỉ triển khai website trên trình duyệt; không có ứng dụng cài riêng mobile/desktop/hybrid hoặc PWA/offline. Đồng bộ phạm vi, tech stack, roadmap và UI guide; giữ responsive cho cùng website |
| 2.8 | Thêm UI guide 22, token JSON và DESIGN.md: Minimalism/Bento, theme Ant Design, bảng công/lương, trạng thái, responsive, truy vết/quyền và checklist; chưa có frontend nghiệm thu |
| 2.7 | Thêm roadmap 5 ngày với ba luồng Codex/Claude Code/Antigravity, owner schema và contract, cổng ghép/kiểm thử mỗi ngày, nghiệm thu theo bằng chứng; giữ nguyên 152 M và baseline R1 |
| 2.6 | Chủ dự án chốt TECH-01: React + TypeScript + Vite, Ant Design, TanStack Query; NestJS + TypeScript; PostgreSQL + Prisma; Decimal.js; modular monolith, phát triển trên VS Code. Thêm tài liệu 20 và ADR-14, liên kết baseline R1; giữ nguyên phạm vi và trạng thái chưa triển khai |
| 1.0 | Bộ tài liệu đầu tiên, 15 tài liệu. Phạm vi: 1 trụ sở + 1 nhà máy, 300 – 1.000 lao động, Vùng I |
| 1.1 | Bổ sung **[03. Cơ cấu tổ chức và hệ thống chức danh](03-co-cau-to-chuc.md)**. Mở rộng phạm vi thành **4 địa điểm trên 3 vùng lương**, quy mô **1.500 – 3.000 lao động**. Cập nhật dây chuyền: `CP-01` kiểm theo vùng của từng địa điểm, phạm vi `SITE` lặp theo nhà máy, cụm thiết bị chấm công riêng từng nơi, bút toán theo cost center từng nhà máy |
| **2.0** | **Đồng bộ toàn bộ tài liệu 01 – 16 theo BFD 10 phân hệ / 49 chức năng và 4 tác nhân TT / QĐ / KT / AD** (căn cứ bản rà soát `Cap_nhat_tai_lieu_thiet_ke_v2.docx`). Công nhân không đăng nhập; bỏ ESS / kiosk / mobile, bộ máy workflow, kết nối máy chấm công, Bank Hub, ERP, kê khai điện tử; luồng duyệt cố định (QĐ duyệt lịch ca, OT; TT duyệt đơn nghỉ; KT duyệt, khóa bảng lương); kỳ nghiệp vụ không mở khóa, hồi tố qua bút toán điều chỉnh. Thuế TNCN 2026: biểu 5 bậc, giảm trừ 15,5 / 6,2 triệu. Viết lại 07 theo 49 chức năng (mã `FR-x.y.z`), 05 theo AD-00…AD-10, 09 theo 54 lớp / 10 gói kèm ERD. Cập nhật T1 (biểu đồ lớp v2.0), T2, T3; bổ sung SQ-14, SQ-15 |
| 2.1 | Rà soát lại tài liệu theo ảnh sơ đồ trong `diagrams/` (BFD, use case, AD-00…AD-10, SQ-01…SQ-15, CD-00…CD-10). 05: thêm luồng AD-00 theo bốn làn, viết lại các bước AD-03 theo nhánh hợp lệ / trả lại, bổ sung nhánh “không đủ căn cứ” của hồi tố (AD-07) và “thiếu dữ liệu” của BH – thuế tháng (AD-08). 10, 13: quyền báo cáo bám đúng tác nhân BFD — 10.1 cho TT, QĐ; 10.2 chỉ QĐ; 10.3, 10.4 cho KT; cảnh báo hợp đồng (2.4) và số dư phép (6.2) chuyển về đầu ra của phân hệ gốc. 14: bản đồ hành trình tháng thêm bước KT cập nhật hồ sơ, hợp đồng, chính sách lương |
| 2.2 | Sửa ví dụ OT khi đổi hệ số ngày thường lên 160%: OT đêm 210% / 222% theo điều kiện; đồng bộ TC-O05/05b/05c. Sửa căn cứ TNCN và quy tắc theo thời điểm chi trả, bộ 2025/2026, Điều 26/50/69/70 NĐ 253/2026; bổ sung TC-T01…TC-T13, cập nhật UAT-12/26 và dữ liệu truy vết thuế |
| 2.3 | Thêm 17; mở kỳ mới khi kỳ trước còn đối soát, chỉ khóa theo thứ tự; ca theo ngày lịch đã duyệt, nhận log qua ngày chốt, cửa sổ Ra gồm OT, chốt sau thu đủ nguồn; log muộn không sửa snapshot; thống nhất business_period và nguồn công của kỳ lương. Cập nhật nguồn SQ-02/03/11, CD-01, TC-A04…TC-A04f, TC-K01…TC-K08 và UAT-24 |
| 2.4 | Chủ dự án xác nhận DEC-01…03: chưa bật quy đổi nghỉ bù, vẫn trả OT; giữ đủ hình thức lương; dùng chính sách mô phỏng. Thêm 18, sổ PS-01…PS-24, cấu hình JSON, hợp đồng đầu vào/9 fixture, TC-B01…03 và TC-I01…12; đồng bộ Q2, nguồn SQ-04/CD-05 và căn cứ đơn giá OT |
| 2.5 | Chốt HRTP-R1-2026-10-17: 158 FR được ánh xạ từng mã, 152 M thuộc R1 (151 hoạt động + 1 kiểm tra chưa kích hoạt), 6 FR backlog; 48 chức năng hoạt động + 5.5 chưa kích hoạt. Thêm 19, manifest, BFD/phạm vi/dữ liệu R1 và script kiểm tra đồng bộ. Phúc lợi/quyết toán/báo cáo trước nghiệm thu; sửa phụ thuộc triển khai và mức CP/XC; thống nhất cây R1 tối đa 5 cấp |
