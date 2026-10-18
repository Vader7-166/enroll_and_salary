# 23. AI giải thích bảng lương

**AI-01 — Hướng mở rộng SAU SPRINT, không còn là task AI trong lịch 5 ngày.**
Theo quyết định mới của chủ dự án, tính năng ưu tiên là
[AI-02 dùng Google Gemini cho TT/QĐ/KT/AD](24-ai-tro-ly-nghiep-vu-theo-vai-tro.md).
Đặc tả dưới đây giữ cho hướng giải thích lương sau này, chỉ KT đúng quyền. Triển khai:
**NOT_IMPLEMENTED**; kiểm thử: **NOT_EXECUTED**. Giữ nguyên 158 FR/152 M,
29 UAT và 60 NFR của [baseline lõi R1](19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md).
Các yêu cầu và tiêu chí AI được quản lý riêng dưới đây, không tự coi đã đạt theo R1.

## 1. Phạm vi và điều kiện bắt đầu

Chỉ làm **giải thích bảng lương và biến động so với kỳ trước**, cho KT có quyền xem
lương của nhân viên/phạm vi tương ứng. Không tự cấp quyền cho TT/QĐ/AD hoặc công nhân.
AI-01 không mở cho mọi vai trò. Trợ lý hướng dẫn chung theo quyền thuộc AI-02 riêng;
tra cứu pháp luật mở, OCR, xếp ca hoặc AI tóm tắt ngoại lệ vẫn chưa thuộc sprint.

Backend Decimal tính khoản lương/chênh lệch và xác lập nguồn. AI diễn đạt các facts
đã kiểm chứng bằng tiếng Việt; không tính thuế/lương, sửa dữ liệu, duyệt, khóa kỳ,
gọi SQL hoặc thực hiện hành động nghiệp vụ. Không suy đoán lý do nghỉ, hiệu suất,
kỷ luật hoặc đặc điểm cá nhân từ biến động tiền lương.

Gate bắt đầu tích hợp: công khóa → tính lương → truy vết đạt fixture, API nguồn có
phân quyền và snapshot/hash hoặc revision dự thảo rõ ràng. Feature flag
`AI_PAYROLL_EXPLANATION_ENABLED` mặc định tắt đến khi cấu hình và kiểm thử AI đạt.
Truy vết thông thường hoạt động khi flag tắt hoặc AI lỗi.

## 2. Yêu cầu bổ sung

| Mã | Yêu cầu |
|---|---|
| AI-REQ-01 | KT đúng quyền có nút AI giải thích trên bảng/chi tiết lương |
| AI-REQ-02 | Backend dựng facts đã tính, kiểm tra nguồn/revision và lọc trường trước khi gửi provider |
| AI-REQ-03 | Diễn giải cấu phần/chênh lệch có nguồn; số hiển thị lấy từ facts của backend |
| AI-REQ-04 | Thiếu kỳ trước, khác cơ sở so sánh, thiếu nguồn phải nói rõ; missing không thành 0 |
| AI-REQ-05 | Có pending/error/timeout/quota/fallback; lỗi AI không chặn nghiệp vụ lương |
| AI-REQ-06 | Có validator đầu ra, audit, giới hạn sử dụng và bảo vệ quyền/dữ liệu |

## 3. Luồng và contract dự kiến

1. Frontend gửi ID dòng/bảng lương và revision, ID kỳ so sánh tùy chọn; không gửi số
   lương tự tạo từ client để nhờ model xác nhận.
2. NestJS kiểm tra phiên/quyền lương theo đơn vị và exclusion trên cả kỳ hiện tại/kỳ
   so sánh trước khi đọc nguồn hoặc gọi provider. Không tiết lộ nhân viên ngoài quyền.
3. Nạp snapshot/hash khi khóa hoặc revision khi dự thảo; tính facts và chênh lệch bằng
   Decimal. Phân biệt kỳ công, kỳ lương, ngày chi trả, dự kiến/thực tế và điều chỉnh.
4. Bỏ tên, CCCD, tài khoản, liên hệ, dữ liệu sức khỏe và ghi chú tự do không cần thiết.
   Provider chỉ nhận mã tham chiếu vô danh, kỳ, cấu phần và dữ liệu tối thiểu cần diễn giải.
5. Model trả cấu trúc tiếng Việt tham chiếu facts. Không cấp tool, SQL hay quyền ghi.
6. Backend validate schema, fact/source ID, giá trị và nội dung; kiểm tra lại revision
   và quyền trước response. Không hiển thị đầu ra sai hoặc không xác minh được.
7. UI render số từ facts và liên kết nguồn do backend cấp; mở nguồn tiếp tục kiểm tra
   quyền. Không chèn HTML hoặc URL tùy ý từ output model.

Endpoint đề xuất: `POST /api/ai/payroll-explanations`. Input:
`payrollEmployeeId`, `revision`, `comparisonPayrollEmployeeId` tùy chọn. Response:
`status`, `sourceVersion`, `sourceHash`, kỳ so sánh, `facts`, `explanationSegments`,
`limitations` và request metadata. Đây là hợp đồng dự kiến, chưa tạo endpoint.

Fact do backend sở hữu: ID, mã cấu phần, giá trị hiện tại/trước/chênh lệch dạng chuỗi
Decimal, đơn vị, sourceRefs và trạng thái dữ liệu. Model ưu tiên trả segments gắn
fact ID; số tiền hiển thị lấy từ backend thay vì model tự viết lại. Không chấp nhận
số/khoản/căn cứ mới không có trong facts. Validator cấu trúc không thay thế review
ngữ nghĩa: tham chiếu đúng vẫn có thể diễn giải sai nguyên nhân.

Không có kỳ trước phù hợp thì chỉ giải thích kỳ hiện tại và nêu hạn chế. Đối soát
tổng với từng khoản trước khi gọi AI; phần chưa phân loại không tự bịa nguyên nhân.
Không trộn snapshot với khoản điều chỉnh hoặc xem số dự thảo như đã chi trả.

## 4. Kỹ thuật và dữ liệu

Module `ai-payroll-explanation` thuộc NestJS, adapter gọi provider ở backend. Không
đổi stack TECH-01, không cần vector database/RAG hoặc hệ thống agent tự chủ. Provider
chung đã chọn Google Gemini cho AI-02; model/tier và điều kiện gửi facts lương của
AI-01 cần xác nhận khi thực hiện phần mở rộng này, không tự dùng cấu hình demo tài liệu.
Tài khoản công cụ lập trình không mặc nhiên cung cấp API model cho website.

Không thêm bảng AI thành điều kiện schema bắt buộc của R1. Audit hiện có lưu request
ID, người gọi, đối tượng nội bộ, version/hash nguồn, phiên bản prompt/model, thời gian,
token/chi phí nếu có và trạng thái. Không ghi payload lương/prompt/response thô vào
application log mặc định. Cache nếu có phải gắn nguồn/version/hash và prompt/model;
mỗi lần đọc vẫn kiểm tra quyền. Logout/thu hồi phiên phải ẩn/xóa dữ liệu tương ứng.

Trước bật cấu hình timeout, max token/request, quota người dùng/ngày và ngân sách;
giá trị chốt theo provider/phép đo. Hết quota/thiếu key/lỗi có fallback, không retry
vô hạn. Key chỉ ở server, không frontend/Git. Dữ liệu nguồn là dữ liệu không đáng tin,
không là chỉ dẫn để model thay quyền hoặc gọi hành động nghiệp vụ.

## 5. Giao diện website

Thêm **AI giải thích** vào drawer truy vết theo [22](22-ui-design-guide.md) cho KT đủ
quyền khi flag bật. Giữ nguyên công thức/nguồn thường; thêm nhãn “AI hỗ trợ diễn giải”,
tóm tắt, các khoản biến động, nguồn đối chiếu và dữ liệu thiếu. Không thêm ESS/chatbot.

Có pending/error/timeout/quota/thử lại trong giới hạn; provider lỗi báo “AI hiện chưa
khả dụng”, vẫn xem truy vết. Nguồn đổi thì đánh dấu diễn giải hết hiệu lực và tạo lại.
Không hứa hủy chi phí provider khi người dùng đóng drawer sau khi request đã gửi.

## 6. Điều kiện triển khai sau sprint

Chưa đặt ngày triển khai AI-01. Khi đưa trở lại kế hoạch: Codex phụ trách endpoint,
adapter/quyền/audit; Claude Code phụ trách facts Decimal/validator; Antigravity làm
drawer và E2E cho KT. Chỉ bắt đầu khi pipeline lương/truy vết đạt và chính sách dữ liệu
provider được xác nhận. Không tạo nút AI-01 trong sprint hiện tại; lịch AI ngày 4–5
dành cho AI-02 theo tài liệu 24.

## 7. Nghiệm thu riêng phần AI

| Mã | Kiểm tra | Trạng thái |
|---|---|---|
| AC-AI-01 | KT đúng quyền được xem; ngoài quyền bị chặn trước provider kể cả đoán ID | NOT_EXECUTED |
| AC-AI-02 | Khoản/chênh lệch/tổng khớp fixture backend; không có số hay nguyên nhân bịa | NOT_EXECUTED |
| AC-AI-03 | Missing, zero, không áp dụng và thiếu kỳ trước được phân biệt; không suy đoán hiệu suất/lý do nghỉ | NOT_EXECUTED |
| AC-AI-04 | Fact/source/version hợp lệ; không URL/HTML/căn cứ tự sinh | NOT_EXECUTED |
| AC-AI-05 | Payload/log không có tên/CCCD/tài khoản/liên hệ/sức khỏe; key không ở frontend/Git | NOT_EXECUTED |
| AC-AI-06 | Prompt injection trong nguồn không gây lộ dữ liệu/ghi database/hành động; output sai bị loại | NOT_EXECUTED |
| AC-AI-07 | Timeout/quota/thiếu key/lỗi/flag tắt không chặn công thức, bảng lương và truy vết | NOT_EXECUTED |
| AC-AI-08 | Đổi revision/quyền/exclusion/hết phiên không trả response hoặc cache không hợp lệ | NOT_EXECUTED |
| AC-AI-09 | Gọi AI không đổi lương/trạng thái kỳ/snapshot/hash; audit đủ metadata | NOT_EXECUTED |
| AC-AI-10 | E2E drawer có nhãn AI, nguồn, pending/error/fallback; đo thời gian/token và cấu hình giới hạn | NOT_EXECUTED |

Test validator/fallback bằng provider stub; nghiệm thu tích hợp phải chạy thêm provider
thật trên dữ liệu mô phỏng. Lưu build/seed/prompt/model version, kết quả và reviewer.
10 AC này bổ sung riêng, không gọi 29 UAT cũ là đã bao phủ AI. Các phần chưa kiểm tra
vẫn NOT_EXECUTED; không lấy PASS kiểm tra tài liệu làm PASS tính năng.

## 8. Ranh giới thay đổi

Nếu muốn chuyển AI thành FR bắt buộc của baseline lõi, cập nhật đồng bộ 07/09/14,
manifest và công cụ kiểm tra theo 19. Hiện AI-01 là hướng sau sprint, còn AI-02 là
tính năng AI ưu tiên trong kế hoạch. Hai bộ tiêu chí khác nhau; PASS AI-02 không tự
chuyển các AC của AI-01 thành đạt.
