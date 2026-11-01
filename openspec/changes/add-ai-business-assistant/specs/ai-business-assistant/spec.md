## ADDED Requirements

### Requirement: Hỏi đáp theo vai trò có nguồn
Hệ thống SHALL cho TT, QĐ, KT, AD đã đăng nhập gửi câu hỏi kèm `pageKey` và nhận câu trả lời tiếng Việt gồm các bước ngắn, mỗi bước có nguồn thuộc tập tài liệu đã truy xuất, liên kết được phép và giới hạn. Hệ thống MUST NOT tự khẳng định tình trạng dữ liệu thực tế.

#### Scenario: TT hỏi giải trình (AC-AI02-01)
- **WHEN** TT hỏi cách xử lý thiếu lượt ra
- **THEN** câu trả lời nêu các bước giải trình, nguồn đúng mục tài liệu và liên kết màn hình của TT

#### Scenario: KT hỏi vì sao chưa tính được lương (AC-AI02-03)
- **WHEN** KT hỏi vì sao chưa tính được lương
- **THEN** câu trả lời nêu các điều kiện và cách kiểm tra, không khẳng định kỳ thực tế đang thiếu gì

### Requirement: Lọc quyền trước truy xuất và trước gọi model
Backend SHALL lấy vai trò, quyền, phạm vi và exclusion từ phiên, MUST lọc corpus theo quyền trước khi tìm kiếm và trước khi gửi Gemini, và MUST NOT tin vai trò hoặc phạm vi do client gửi. Yêu cầu chưa đăng nhập MUST bị chặn trước khi gọi Gemini.

#### Scenario: Giả vai trò (AC-AI02-05)
- **WHEN** client gửi pageKey của màn hình KT trong khi phiên là TT
- **THEN** corpus vẫn chỉ gồm tài liệu TT được phép và không có liên kết của KT

### Requirement: Không đủ nguồn thì nêu hạn chế
Khi không tìm được nguồn phù hợp, nguồn mâu thuẫn hoặc hết hiệu lực, hệ thống SHALL trả `INSUFFICIENT_SOURCE` hoặc nêu hạn chế, MUST NOT gọi model để đoán, và nội dung mô phỏng MUST mang nhãn mô phỏng.

#### Scenario: Câu hỏi ngoài tài liệu (AC-AI02-07)
- **WHEN** người dùng hỏi quy định không có trong corpus
- **THEN** hệ thống trả "Chưa có tài liệu phù hợp để trả lời" kèm hướng dẫn tĩnh đúng quyền

### Requirement: Không truy cập dữ liệu nghiệp vụ và chống injection
Hệ thống SHALL không đọc database nghiệp vụ để trả lời, MUST từ chối câu hỏi chứa dữ liệu cá nhân nhận diện được trước khi gọi Gemini, MUST coi câu hỏi và nguồn là dữ liệu trong prompt, và MUST loại câu trả lời có source ID hoặc URL không thuộc tập đã gửi.

#### Scenario: Prompt injection (AC-AI02-08)
- **WHEN** câu hỏi chứa chỉ dẫn yêu cầu bỏ qua quy tắc và trả dữ liệu lương
- **THEN** hệ thống không đổi quyền, không gọi công cụ, không ghi dữ liệu và trả lời trong phạm vi tài liệu hoặc từ chối

#### Scenario: Câu hỏi chứa CCCD (AC-AI02-09)
- **WHEN** câu hỏi chứa một số CCCD
- **THEN** hệ thống từ chối trước khi gọi Gemini và nhắc không nhập thông tin cá nhân

### Requirement: Fallback và không chặn nghiệp vụ
Khi timeout, hết quota hoặc budget, thiếu key, provider lỗi hoặc feature flag tắt, hệ thống SHALL trả trạng thái `UNAVAILABLE` kèm hướng dẫn tĩnh đúng quyền, không retry vô hạn, và các chức năng công/lương MUST tiếp tục hoạt động.

#### Scenario: Flag tắt (AC-AI02-11)
- **WHEN** `AI_BUSINESS_ASSISTANT_ENABLED=false`
- **THEN** nút Trợ lý AI bị ẩn, endpoint từ chối, hướng dẫn tĩnh vẫn dùng được

### Requirement: Audit, cache và thu hồi phiên
Hệ thống SHALL audit metadata mỗi yêu cầu (requestId, tài khoản, vai trò, phiên bản phạm vi, pageKey, source IDs/hash, phiên bản corpus/prompt/model, thời gian, token, kết quả) mà không lưu câu hỏi/trả lời thô mặc định; cache nếu có MUST gắn tập quyền và các phiên bản; đổi quyền, logout, thu hồi phiên hoặc đổi phiên bản corpus MUST làm mất hiệu lực câu trả lời/cache cũ.

#### Scenario: Thu hồi phiên (AC-AI02-10)
- **WHEN** phiên bị thu hồi trong khi yêu cầu đang xử lý
- **THEN** backend không trả kết quả và frontend xóa nội dung drawer

### Requirement: Giao diện drawer
Hệ thống SHALL hiển thị nút "Trợ lý AI" trên header mở drawer bên phải (toàn chiều rộng trên màn hình hẹp) gồm vai trò, trang hiện tại, câu hỏi gợi ý đã lọc quyền, ô hỏi có giới hạn, câu trả lời với bước, nguồn, giới hạn và nhãn "AI hướng dẫn từ tài liệu hệ thống".

#### Scenario: E2E bốn vai trò (AC-AI02-12)
- **WHEN** chạy E2E với tài khoản TT, QĐ, KT, AD
- **THEN** mỗi vai trò thấy gợi ý và liên kết đúng quyền, focus và responsive đạt yêu cầu
