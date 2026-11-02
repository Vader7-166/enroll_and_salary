## ADDED Requirements

### Requirement: Corpus đã duyệt có metadata quyền
Hệ thống SHALL chỉ đưa vào corpus các chunk tài liệu đã duyệt có `sourceId`, tiêu đề/mục, hash, quyền hoặc vai trò cần thiết, hiệu lực nếu có, nhãn SIMULATION/VERIFIED và route liên quan; chunk thiếu metadata quyền MUST bị loại khỏi corpus.

#### Scenario: Thiếu quyền
- **WHEN** bước build corpus gặp chunk không khai báo quyền
- **THEN** chunk bị loại và build báo cảnh báo

#### Scenario: Phiên bản corpus
- **WHEN** nội dung một chunk thay đổi
- **THEN** hash chunk và phiên bản corpus thay đổi

### Requirement: Route registry do backend sở hữu
Hệ thống SHALL duy trì route registry ánh xạ `actionKey` tới màn hình và quyền cần thiết; mọi liên kết trong câu trả lời MUST được dựng từ registry và MUST chỉ hiển thị khi người dùng có quyền mở màn hình đó.

#### Scenario: Không có quyền mở
- **WHEN** câu trả lời cho TT chứa actionKey màn hình khóa kỳ của KT
- **THEN** liên kết đó bị loại khỏi câu trả lời
