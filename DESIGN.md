# HRTP — UI design entry point

Đọc [UI design guide](docs/22-ui-design-guide.md) trước khi thiết kế hoặc viết frontend.
Token chuẩn: [hrtp-ui-tokens.json](docs/config/hrtp-ui-tokens.json).

- Teal Enterprise: sidebar xanh đen `#081D2B`, primary teal `#007F78`, mục chọn `#10545B`; nền pastel theo nhóm mint/sky/vàng cát/hồng phấn/lavender. Bảng và ô nhập giữ trắng. Cho phép sóng, mây và mặt trời dạng vector tĩnh ở sidebar, tiêu đề và đăng nhập; không gradient, glassmorphism, phát sáng, parallax hoặc card lồng nhau.
- Nền đăng nhập dùng minh họa tĩnh theo mẫu người dùng tại `frontend/public/login-background.webp` (đã loại form khỏi ảnh), căn giữa và phủ viewport; form thật giữ nguyên, nền không chặn tương tác. Sidebar/tiêu đề vẫn dùng `HorizonArt`.
- Riêng tiêu đề Chấm công/Bảng lương thay sóng bằng `BusinessIllustration`: lịch–đồng hồ–thẻ nhân viên và phiếu lương–máy tính–₫. SVG tĩnh dùng token sẵn có; chỉ thêm ở trạng thái rỗng đã xác nhận và nhãn chỉ số chọn lọc, không phủ lên số/bảng/form. Ẩn hình tiêu đề/nhãn chỉ số dưới 1200px.
- Motion dùng chung token 150ms hover/focus, 180ms xác nhận thành công và 220ms drawer; giảm chuyển động theo hệ thống. Thành công phải có phản hồi máy chủ; tiến độ chỉ hiển thị khi API biết tổng khối lượng, không giả phần trăm hay chạy số tiền.
- React + TypeScript + Ant Design; một theme và bộ component dùng chung.
- Chỉ làm website trên trình duyệt; không làm mobile/desktop/hybrid app hay PWA cài đặt/offline. Responsive là cùng website trên các kích thước màn hình.
- Bảng công/lương ưu tiên không gian, cột cố định, số căn phải và truy vết nguồn. Bảng công có Tóm tắt/Đầy đủ, giữ mọi trường qua chế độ đầy đủ và drawer; giảm padding thay vì thu nhỏ chữ toàn ứng dụng.
- Giao diện tiếng Việt; bốn tác nhân TT/QĐ/KT/AD, quyền theo đơn vị. Không có ESS.
- Ngày công, kỳ lương và ngày chi trả là các khái niệm riêng; không gộp nhãn.
- CLOSED khác LOCKED. Không có nút mở khóa kỳ LOCKED; nghỉ bù OT chưa kích hoạt.
- Màu trạng thái luôn đi kèm chữ; loading/empty/error/forbidden phải được thiết kế.
- Modal/drawer nhận màu nhóm qua ConfigProvider để portal không mất palette; nền canvas nhẹ, header/nhãn/phân vùng có màu, bảng và ô nhập trắng. Chi tiết ngày công có danh tính + chỉ số + nguồn; trạng thái rỗng gọn, không tạo khoảng trắng lớn.
- Sidebar và drawer điều hướng cùng nền xanh đen, mục chọn teal đậm với chữ/icon sáng và chỉ dấu cạnh trái. Một bộ Ant Design Outlined theo bảng 19 mục trong guide; `routeIcons` dùng chung cho menu, breadcrumb và tiêu đề. Màu trạng thái không bị thay bằng teal; CLOSED/LOCKED có nhãn và icon riêng.
- Không coi mock/stub hoặc ảnh giao diện là bằng chứng nghiệm thu chức năng.
- Nhân sự chỉ dùng số liệu API hiện có; không thêm biểu đồ tăng trưởng/cơ cấu, trạng thái “Tạm nghỉ”, tìm kiếm toàn cục hoặc hành động sửa/xóa để sao chép hình mẫu khi chưa có contract tương ứng.
- AI ưu tiên là [AI-02](docs/24-ai-tro-ly-nghiep-vu-theo-vai-tro.md): Google Gemini, nút Trợ lý AI/drawer cho TT/QĐ/KT/AD, gợi ý/hướng dẫn/nguồn/link lọc theo quyền, có fallback; không đọc dữ liệu nhân sự/lương hoặc thực hiện hành động.
- AI-01 giải thích lương ở tài liệu 23 chuyển sang sau sprint; không thêm nút đó vào lịch 5 ngày. Truy vết lương thông thường vẫn thuộc lõi.

Guide quy định giao diện, không thay đổi [phạm vi R1](docs/19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md)
hay [tech stack](docs/20-tech-stack-va-moi-truong-phat-trien.md).
