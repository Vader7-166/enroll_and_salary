# 24. Trợ lý AI hướng dẫn nghiệp vụ theo vai trò

**AI-02 — tính năng AI ưu tiên đã được chủ dự án xác nhận**, dùng **Google Gemini API**
cho TT/QĐ/KT/AD trên cùng website. Triển khai **NOT_IMPLEMENTED**, nghiệm thu
**NOT_EXECUTED**. Đây là phần mở rộng được quản lý riêng với 158 FR/152 M, 29 UAT và
60 NFR của [baseline lõi](19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md).
Danh mục máy đọc được: [hrtp-ai-features.json](config/hrtp-ai-features.json).

AI-02 thay AI-01 ở nhánh AI trong [roadmap 5 ngày](21-roadmap-trien-khai-5-ngay.md).
[AI-01 giải thích bảng lương](23-ai-giai-thich-bang-luong.md) giữ làm hướng mở rộng
sau sprint, chỉ KT đúng quyền; không phải task AI ngày 4–5 hiện tại.

## 1. Mục tiêu và ranh giới bản đầu

Hướng dẫn thao tác và trả lời câu hỏi quy trình từ tài liệu có kiểm soát, kèm nguồn
và liên kết màn hình đúng quyền. Bản đầu **không đọc hồ sơ nhân viên, bảng công/lương,
trạng thái kỳ thực tế hoặc truy vấn tự do database**; không tính tiền, tư vấn pháp lý
mở, duyệt, sửa dữ liệu, chốt/khóa kỳ hoặc thực hiện tác vụ thay người dùng.

Ví dụ “Vì sao chưa tính được lương?” được trả lời bằng các điều kiện và cách kiểm
tra, không khẳng định kỳ thực tế đang thiếu gì khi chưa đọc dữ liệu kỳ đó. Câu hỏi
“Tổ nào còn thiếu công?” chưa thuộc AI-02; hướng người dùng đến màn hình có quyền.

## 2. Người dùng và nội dung

| Vai trò | Ví dụ câu hỏi | Cách hỗ trợ |
|---|---|---|
| TT | Thiếu lượt ra xử lý thế nào? Lập OT cho nhiều người ở đâu? | Các bước giải trình/lập đề xuất, thông tin cần chuẩn bị, link trong phạm vi vai trò |
| QĐ | Trước chốt công xưởng cần kiểm tra gì? Duyệt lịch ca ở đâu? | Hướng dẫn đối soát/chốt xưởng và duyệt, phân biệt với KT khóa kỳ |
| KT | Điều kiện để tính lương là gì? Kỳ CLOSED khác LOCKED thế nào? | Điều kiện nguồn công, đầu vào xác nhận, quy trình lương/BH/thuế và truy vết |
| AD | Nhập lại tệp có trùng không? Mở kỳ mới khi kỳ trước chưa khóa được không? | Hướng dẫn nhập/kiểm tra lô, chống trùng, cấu hình và mở kỳ đúng quyền |

Cả bốn vai trò dùng cùng tính năng nhưng corpus, gợi ý và liên kết được lọc theo
quyền hiện hành. AD không được xem lương qua AI; công nhân không có tài khoản/ESS.

## 3. Yêu cầu bổ sung

| Mã | Yêu cầu |
|---|---|
| AI02-REQ-01 | TT/QĐ/KT/AD đã đăng nhập mở Trợ lý AI, nhận gợi ý theo vai trò/trang |
| AI02-REQ-02 | Backend xác định quyền, lọc tài liệu trước retrieval và trước gọi Gemini |
| AI02-REQ-03 | Trả lời tiếng Việt bằng bước ngắn, dẫn đoạn tài liệu/phiên bản và liên kết được phép |
| AI02-REQ-04 | Không có nguồn/ngoài phạm vi/mâu thuẫn thì nêu hạn chế, không bịa quy trình hoặc dữ liệu thực tế |
| AI02-REQ-05 | Không đọc/gửi dữ liệu nhân sự/lương/log thô và không thực hiện hành động nghiệp vụ |
| AI02-REQ-06 | Có pending, timeout, quota, lỗi và fallback tới hướng dẫn tĩnh đúng quyền |
| AI02-REQ-07 | Key chỉ ở server; chống prompt injection, kiểm tra nguồn/output, audit metadata và thu hồi phiên |
| AI02-REQ-08 | Có phiên bản corpus/prompt/model, feature flag và kiểm thử độc lập với baseline lõi |

## 4. Nguồn tri thức và phân quyền

Tạo corpus hướng dẫn được duyệt từ 05/07/10/17/18 và nội dung liên quan của 04/06/12.
Không đưa toàn bộ repo hoặc tài liệu nội bộ kỹ thuật lên provider. Các đoạn về thuật
toán/chính sách phải có bản diễn giải phù hợp người dùng, nguồn cụ thể và nhãn mô phỏng;
ảnh/Word cũ không là nguồn ưu tiên thay cho Markdown đã cập nhật.

Mỗi chunk có `sourceId`, tiêu đề/mục, phiên bản/hash, trạng thái được duyệt, quyền
cần thiết, `effectiveFrom`/`effectiveTo` nếu có, nhãn SIMULATION/VERIFIED và danh sách
route hướng dẫn đã đăng ký. Không có metadata quyền thì mặc định không đưa vào corpus.
Thông tin chính sách không được diễn đạt thành quy định doanh nghiệp thật nếu còn mô phỏng.

Backend lấy role/permission/scope/exclusion từ phiên; không tin role hoặc scope do
client gửi. Lọc corpus theo quyền **trước tìm kiếm/xếp hạng** và **trước gửi Gemini**.
Nội dung dùng chung phải được đánh dấu cho từng nhóm rõ ràng. Quyền đọc tài liệu và
quyền mở màn hình là hai kiểm tra riêng; có quyền hỏi quy trình không tự cấp quyền thao tác.

Đầu sprint có thể dùng danh sách chunk tĩnh + tìm từ khóa/đề mục, không bắt buộc vector
database, embeddings hoặc framework agent. Mục tiêu là nguồn đúng và đủ cho bộ câu
hỏi cố định. Cập nhật corpus qua review/version, không cho người dùng tải tệp bất kỳ
để trở thành chỉ dẫn cho model trong bản đầu.

## 5. Luồng backend và contract dự kiến

1. Người dùng mở drawer, chọn gợi ý hoặc nhập câu hỏi. Frontend gửi `question`,
   `pageKey`, ngữ cảnh loại kỳ/nhóm chức năng tùy chọn; không gửi bảng/hồ sơ hoặc toàn DOM.
2. NestJS kiểm tra phiên/quyền/feature flag/quota/độ dài và lọc nội dung đầu vào.
   UI nhắc không nhập thông tin cá nhân; backend từ chối câu hỏi chứa dữ liệu cá nhân
   nhận diện được, không đọc thêm dữ liệu để trả lời. Bộ lọc không được coi là bảo đảm
   ẩn danh tuyệt đối; demo chỉ dùng câu hỏi và dữ liệu mô phỏng đã kiểm soát.
3. Lấy chunks đã duyệt theo quyền, trang và phiên bản/ngữ cảnh hiệu lực. Không tìm
   được nguồn phù hợp thì trả `INSUFFICIENT_SOURCE`, không gọi model để đoán.
4. Gửi câu hỏi đã kiểm tra và nguồn được phép tới Gemini qua adapter NestJS. Prompt
   coi câu hỏi/nguồn là dữ liệu, không cho tool/SQL/truy cập mạng hay hành động nghiệp vụ.
5. Gemini trả JSON theo schema. Backend kiểm tra source IDs thuộc tập đã gửi, step
   references, action keys và nội dung; dựng link từ route registry của backend,
   không dùng URL/HTML model tự sinh.
6. Kiểm tra lại phiên/quyền/corpus version trước trả. Nếu có thay đổi thì hủy kết quả
   cũ và yêu cầu tải lại. Cache nếu dùng vẫn phải qua cùng kiểm tra quyền.
7. UI hiển thị câu trả lời, nguồn và giới hạn; người dùng tự mở màn hình rồi thực hiện
   theo quy trình thông thường. AI không tự điền/gửi/duyệt dữ liệu.

Endpoint dự kiến `POST /api/ai/business-assistant/answers`. Input:
`question`, `pageKey`, `context` theo schema cho phép. `pageKey` chỉ là gợi ý ngữ cảnh,
không là quyền truy cập. Bản đầu mỗi câu hỏi là request độc lập; không tự gửi lịch sử
chat hoặc dùng nội dung từ phiên của người khác.

Response đề xuất: `status` (`ANSWERED`, `INSUFFICIENT_SOURCE`, `OUT_OF_SCOPE`,
`UNAVAILABLE`), `requestId`, `answer`, `steps`, `citations`, `actions`, `limitations`,
`corpusVersion`, `promptVersion`, `model`. Mỗi bước/khẳng định nghiệp vụ có source ID;
citations cuối do backend ánh xạ thành tiêu đề/mục/phiên bản đã kiểm tra. Schema chỉ
kiểm tra cấu trúc; reviewer vẫn phải đối chiếu xem nội dung được nguồn hỗ trợ thật.

Mã HTTP cho unauthenticated/forbidden/validation/rate-limit theo contract chung;
không gửi Gemini khi đã từ chối. Các endpoint trên chưa được triển khai.

## 6. Google Gemini và cấu hình vận hành

**Provider đã chọn: Google Gemini API.** Chưa ghim model, API version, tier, giá hoặc
SDK version; chọn model hỗ trợ structured output và đo trên câu hỏi tiếng Việt khi
triển khai. Không suy ra quyền API từ tài khoản Antigravity hay công cụ lập trình.

Module NestJS `ai-business-assistant`, adapter `GeminiProvider`; frontend chỉ gọi
backend. Cấu hình `AI_BUSINESS_ASSISTANT_ENABLED=false` mặc định, `GEMINI_MODEL`,
timeout, max input/output, rate limit và budget trước bật; API key chỉ trong secret
server, không Git/frontend/log. Flag bật cho cả bốn nhóm nhưng vẫn lọc quyền từng request.

Demo chỉ dùng tài liệu/câu hỏi mô phỏng được kiểm soát. Tier, quota và điều kiện dữ
liệu phải được đối chiếu lúc kích hoạt. Không dùng Google Search grounding, tự tra luật
mới hoặc truyền dữ liệu lương thật trong tính năng này. Tài liệu hiệu lực/mô phỏng
được ghi nhãn theo nguồn; không hứa câu trả lời là tư vấn pháp lý đã xác nhận.

Audit request ID, tài khoản/role/scope version, pageKey, source IDs/hash, corpus/prompt/
model version, thời gian, token/chi phí nếu có và outcome. Không ghi question/response
thô mặc định, không lưu lịch sử chat bắt buộc. Nếu lưu cache thì gắn tập quyền/phạm
vi/exclusion, source/corpus/prompt/model version; không trả cache khi quyền thay đổi.

Timeout/quota/hết budget/key lỗi trả fallback có hướng dẫn tĩnh, không retry vô hạn
hoặc chặn nghiệp vụ lõi. Thu hồi phiên/logout xóa/ẩn nội dung và cache phía client.

## 7. Thiết kế giao diện website

Nút **Trợ lý AI** ở header mở drawer bên phải; màn hình hẹp dùng drawer toàn chiều
rộng. Giữ nhãn chữ, focus/keyboard/scroll phù hợp guide 22; không che nút lưu/duyệt.

Drawer có vai trò đang dùng, trang hiện tại, câu hỏi gợi ý đã lọc quyền, ô hỏi có giới
hạn, phần trả lời/bước/nguồn/giới hạn. Đặt nhãn “AI hướng dẫn từ tài liệu hệ thống”.
Không hiển thị ô nhập như một trợ lý có thể thực hiện mọi yêu cầu.

Mỗi câu trả lời giữ version nguồn. Không có nguồn thì nói “Chưa có tài liệu phù hợp
để trả lời” và hiện hướng dẫn tĩnh có quyền. Lỗi AI báo “Trợ lý AI hiện chưa khả dụng”.
Đổi tài khoản/quyền/trang làm mất hiệu lực gợi ý hoặc câu trả lời cũ tương ứng. AI
flag tắt thì nút AI ẩn, các hướng dẫn tĩnh vẫn có thể dùng độc lập.

## 8. Phân công theo roadmap

| Ngày | Codex | Claude Code | Antigravity |
|---|---|---|---|
| 1–2 | Contract/quyền/page registry; cấu trúc manifest corpus | Biên soạn bộ câu hỏi, chunks có nguồn/quyền, expected và output schema | Thiết kế entry/drawer/gợi ý theo vai trò; không mock thành tính năng hoàn thành |
| 3 | Xác nhận auth/scope/version, route và quota contract dùng được | Review corpus, query không có nguồn và prompt injection | Nối hướng dẫn tĩnh, kiểm tra cả bốn role |
| 4 | Gemini adapter, endpoint, flag, audit/timeout/quota | Retrieval theo quyền, prompt/validator và review câu trả lời | Nối API thật, source links, pending/error/fallback |
| 5 | Kiểm tra quyền/thu hồi/cache và không ghi dữ liệu | Đối chiếu bộ Q&A/nguồn, lỗi ngữ nghĩa, mâu thuẫn và hiệu lực | E2E bốn role, tablet/desktop và demo |

AI-02 phụ thuộc nền quyền, corpus và navigation; không cần chờ payroll engine để làm
hướng dẫn tĩnh. Ngày 4 chỉ tích hợp khi các phụ thuộc này đạt, tránh cản tiến độ R1.
Nếu trễ ghi rõ AI chưa xong; AI-01 không còn task trong sprint này.

## 9. Bộ nghiệm thu AI-02

| Mã | Điều kiện kiểm tra | Trạng thái |
|---|---|---|
| AC-AI02-01 | TT nhận hướng dẫn giải trình/lập OT đúng nguồn và route của TT | NOT_EXECUTED |
| AC-AI02-02 | QĐ nhận hướng dẫn duyệt/chốt xưởng đúng, không lẫn quyền KT khóa kỳ | NOT_EXECUTED |
| AC-AI02-03 | KT nhận điều kiện tính lương/quy trình, không bịa tình trạng kỳ thực tế | NOT_EXECUTED |
| AC-AI02-04 | AD nhận hướng dẫn nhập/mở kỳ, không nhận dữ liệu lương hoặc quyền mới | NOT_EXECUTED |
| AC-AI02-05 | Trái role/scope/exclusion hoặc giả role/pageKey không vượt lọc corpus/route; chưa đăng nhập bị chặn trước Gemini | NOT_EXECUTED |
| AC-AI02-06 | Từng bước/khẳng định có nguồn đúng tập retrieval và đúng version; model bịa source/URL bị loại | NOT_EXECUTED |
| AC-AI02-07 | Không có/mâu thuẫn/hết hiệu lực nguồn thì báo hạn chế; mô phỏng có nhãn; không tự tra luật hoặc suy diễn dữ liệu | NOT_EXECUTED |
| AC-AI02-08 | Input/nguồn chứa chỉ dẫn độc hại không đổi quyền/gọi tool/ghi dữ liệu; kiểm tra semantic ngoài schema | NOT_EXECUTED |
| AC-AI02-09 | Không đọc database nghiệp vụ để trả lời; payload không chứa hồ sơ/lương/log/ghi chú; PII nhập vào bị chặn theo bộ test, key/log an toàn | NOT_EXECUTED |
| AC-AI02-10 | Đổi quyền/exclusion/logout/thu hồi phiên/corpus version không dùng response hoặc cache cũ | NOT_EXECUTED |
| AC-AI02-11 | Timeout/quota/budget/thiếu key/provider lỗi/flag tắt có fallback; công/lương vẫn hoạt động | NOT_EXECUTED |
| AC-AI02-12 | E2E cả bốn role, focus/responsive, nguồn và link; đo token/latency, lưu build/corpus/prompt/model/tier và người review | NOT_EXECUTED |

Chuẩn bị ít nhất 3 câu hỏi hợp lệ/role (12), 4 câu vượt quyền, 2 câu thiếu nguồn,
2 câu prompt injection và 2 câu nhầm mô phỏng/hiệu lực: tối thiểu **22 câu Q&A cố
định** có expected/nguồn trước khi chạy model. Test lỗi/quota/thu hồi phiên bổ sung
ngoài Q&A. Dùng stub để thử lỗi; nghiệm thu tích hợp phải chạy Gemini thật trên dữ
liệu mô phỏng. Lưu kết quả từng câu, không lấy PASS schema làm PASS ngữ nghĩa.

## 10. Sơ đồ và tham khảo

Sơ đồ nguồn: [AI-02 business assistant](../diagrams/release/AI02-business-assistant.mmd).
Kiểm tra riêng AI không thay 29 UAT/60 NFR và kiểm thử từng FR lõi. Các tài liệu kế
hoạch/thống kê phải phân biệt R1 lõi, AI-02 ưu tiên và AI-01 sau sprint.

- [Gemini: structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).
- [Gemini: điều kiện sử dụng dữ liệu](https://ai.google.dev/gemini-api/terms).
