# HRTP — UI design entry point

Đọc [UI design guide](docs/22-ui-design-guide.md) trước khi thiết kế hoặc viết frontend.
Token chuẩn: [hrtp-ui-tokens.json](docs/config/hrtp-ui-tokens.json).

- Minimalism làm nền; Bento chỉ dùng ở dashboard để ưu tiên công việc cần xử lý.
- React + TypeScript + Ant Design; một theme và bộ component dùng chung.
- Chỉ làm website trên trình duyệt; không làm mobile/desktop/hybrid app hay PWA cài đặt/offline. Responsive là cùng website trên các kích thước màn hình.
- Bảng công/lương ưu tiên không gian, cột cố định, số căn phải và truy vết nguồn.
- Giao diện tiếng Việt; bốn tác nhân TT/QĐ/KT/AD, quyền theo đơn vị. Không có ESS.
- Ngày công, kỳ lương và ngày chi trả là các khái niệm riêng; không gộp nhãn.
- CLOSED khác LOCKED. Không có nút mở khóa kỳ LOCKED; nghỉ bù OT chưa kích hoạt.
- Màu trạng thái luôn đi kèm chữ; loading/empty/error/forbidden phải được thiết kế.
- Không coi mock/stub hoặc ảnh giao diện là bằng chứng nghiệm thu chức năng.
- AI ưu tiên là [AI-02](docs/24-ai-tro-ly-nghiep-vu-theo-vai-tro.md): Google Gemini, nút Trợ lý AI/drawer cho TT/QĐ/KT/AD, gợi ý/hướng dẫn/nguồn/link lọc theo quyền, có fallback; không đọc dữ liệu nhân sự/lương hoặc thực hiện hành động.
- AI-01 giải thích lương ở tài liệu 23 chuyển sang sau sprint; không thêm nút đó vào lịch 5 ngày. Truy vết lương thông thường vẫn thuộc lõi.

Guide quy định giao diện, không thay đổi [phạm vi R1](docs/19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md)
hay [tech stack](docs/20-tech-stack-va-moi-truong-phat-trien.md).
