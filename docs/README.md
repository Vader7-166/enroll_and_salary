# Hệ thống Quản lý Chấm công & Tiền lương — Nhà máy sản xuất linh kiện điện tử

Bộ tài liệu dự án, biên soạn trên cơ sở kết quả khảo sát và các tài liệu nghiệp vụ –
pháp lý gốc trong thư mục [`KhaoSat/`](KhaoSat).

| Hạng mục | Nội dung |
|---|---|
| Tên hệ thống | Hệ thống Quản lý Chấm công & Tiền lương (viết tắt: **HRTP**) |
| Đối tượng áp dụng | Nhà máy sản xuất linh kiện điện tử, quy mô 300 – 1.000 lao động |
| Chuẩn pháp lý áp dụng | BLLĐ 2019; NĐ 145/2020/NĐ-CP; NĐ 293/2025/NĐ-CP; NĐ 283/2026/NĐ-CP; NĐ 13/2023/NĐ-CP |
| Kỳ áp dụng | Từ kỳ lương 2026 |
| Phiên bản tài liệu | 1.0 |

## Chỉ mục tài liệu

### A. Bối cảnh và nghiệp vụ

| # | Tài liệu | Nội dung chính |
|---|---|---|
| 01 | [Tổng quan và phạm vi](01-tong-quan-va-pham-vi.md) | Bối cảnh, vấn đề, mục tiêu, phạm vi trong/ngoài, thuật ngữ |
| 02 | [Các bên liên quan và vai trò](02-cac-ben-lien-quan-va-vai-tro.md) | 5 nhóm actor, 16 vai trò hệ thống, ma trận RACI |
| 03 | [Quy tắc nghiệp vụ](03-quy-tac-nghiep-vu.md) | Toàn bộ business rule có mã BR-xx: kỳ, ca, công, OT, nghỉ, lương, BH, thuế |
| 04 | [Quy trình nghiệp vụ](04-quy-trinh-nghiep-vu.md) | Chu trình tháng end-to-end, quy trình chốt công, chốt lương, luồng duyệt |
| 05 | [Thuật toán chấm công và tính lương](05-thuat-toan-cham-cong-va-tinh-luong.md) | Đặc tả thuật toán: khử trùng, ghép cặp, ca đêm bắc cầu, ma trận OT, gross-up |
| 06 | [Yêu cầu chức năng](06-yeu-cau-chuc-nang.md) | 16 phân hệ, yêu cầu chức năng có mã FR-xx |

### B. Kiến trúc và kỹ thuật

| # | Tài liệu | Nội dung chính |
|---|---|---|
| 07 | [Kiến trúc hệ thống](07-kien-truc-he-thong.md) | Kiến trúc tổng thể, phân tầng, thành phần, quyết định kiến trúc (ADR) |
| 08 | [Mô hình dữ liệu](08-mo-hinh-du-lieu.md) | Thực thể chính, quan hệ, ba tầng dữ liệu công, tham số theo hiệu lực |
| 09 | [Phân quyền và bảo mật](09-phan-quyen-va-bao-mat.md) | RBAC + data scope, mã hóa, audit log bất biến, NĐ 13/2023 |
| 10 | [Tích hợp hệ thống](10-tich-hop-he-thong.md) | Máy chấm công, Bank Hub, ERP, cổng BHXH/thuế, SSO, thông báo |
| 14 | [Yêu cầu phi chức năng](14-yeu-cau-phi-chuc-nang.md) | Hiệu năng, độ chính xác số học, sao lưu, khả dụng, khả năng cấu hình |

### C. Tuân thủ, đầu ra và triển khai

| # | Tài liệu | Nội dung chính |
|---|---|---|
| 11 | [Tuân thủ pháp lý](11-tuan-thu-phap-ly.md) | Ma trận quy định ↔ chức năng, khung chế tài, cổng chặn tuân thủ CP-01…CP-09 |
| 12 | [Báo cáo và kết xuất](12-bao-cao-va-ket-xuat.md) | Chứng từ kế toán, báo cáo nghiệp vụ, báo cáo tuân thủ, dashboard |
| 13 | [User story và tiêu chí nghiệm thu](13-user-story-va-tieu-chi-nghiem-thu.md) | User story theo actor, acceptance criteria, ma trận UAT |
| 15 | [Kế hoạch triển khai và rủi ro](15-ke-hoach-trien-khai-va-rui-ro.md) | Lộ trình 4 giai đoạn, chuyển đổi dữ liệu, rủi ro, câu hỏi còn mở |

## Cách đọc theo vai trò

| Bạn là | Đọc theo thứ tự |
|---|---|
| Ban lãnh đạo / chủ đầu tư | 01 → 11 → 15 |
| Nghiệp vụ (HR, C&B, Kế toán) | 01 → 03 → 04 → 06 → 12 |
| Kiến trúc sư / lập trình viên | 01 → 05 → 07 → 08 → 09 → 10 → 14 |
| Kiểm thử (QA) | 03 → 05 → 13 → 11 |
| Quản trị dự án | 01 → 06 → 15 |

## Nguyên tắc xuyên suốt của thiết kế

1. **Không hardcode giá trị pháp lý.** Mọi mức lương tối thiểu, tỷ lệ đóng, hệ số OT,
   bậc thuế đều là dữ liệu tham số có khoảng hiệu lực (xem [03](03-quy-tac-nghiep-vu.md), [08](08-mo-hinh-du-lieu.md)).
2. **Chứng minh được là đúng, không chỉ tính đúng.** Mọi con số truy vết ngược tới công
   thức, tham số và lượt quẹt gốc (xem [07](07-kien-truc-he-thong.md), [09](09-phan-quyen-va-bao-mat.md)).
3. **Tuân thủ là cổng chặn, không phải báo cáo.** Vi phạm bị chặn tại thời điểm thao tác,
   không để phát hiện khi thanh tra (xem [11](11-tuan-thu-phap-ly.md)).
4. **Cấu hình hơn lập trình.** Chính sách thay đổi thì sửa dữ liệu, không sửa mã nguồn.

## Tài liệu gốc

Thư mục [`KhaoSat/`](KhaoSat) lưu nguyên trạng các tài liệu đầu vào đã dùng để biên soạn
bộ tài liệu này:

| Tệp gốc | Được sử dụng cho |
|---|---|
| `Phạm vi và các bên liên quan.docx` | Tài liệu 01, 02 |
| `Kế hoạch khảo sát và bộ câu hỏi.docx` | Tài liệu 01, 15 (câu hỏi còn mở, ngoại lệ) |
| `Tính năng Quản lý chấm công, tiền lương.docx` | Tài liệu 06, 14 |
| `User story/user stroy và tiêu chí chấp nhận được_.docx` | Tài liệu 13 |
| `Tài liệu liên quan/Đặc tả kỹ thuật phần mềm/BRD - YÊU CẦU NGHIỆP VỤ HỆ THỐNG.docx` | Tài liệu 01, 03, 06 |
| `Tài liệu liên quan/Đặc tả kỹ thuật phần mềm/FSD- THUẬT TOÁN CHẤM CÔNG VÀ TÍNH OT_.docx` | Tài liệu 05 |
| `Tài liệu liên quan/Đặc tả kỹ thuật phần mềm/SPECS - HỆ THỐNG TÍCH HỢP VÀ AN TOÀN DẦU RA 2026.docx` | Tài liệu 07, 09, 10 |
| `Tài liệu liên quan/Pháp lý và chính sách/*.docx` | Tài liệu 11 |
| `Tài liệu liên quan/Mẫu biểu và dữ liệu mẫu/*.xlsx` | Tài liệu 12, 15 (đối chiếu chuyển đổi) |
