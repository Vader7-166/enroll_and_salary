## Why

AI-02 là tính năng AI ưu tiên đã được chủ dự án xác nhận (docs 24, manifest `hrtp-ai-features.json`): trợ lý hướng dẫn nghiệp vụ theo vai trò cho TT/QĐ/KT/AD dùng Google Gemini, chỉ trả lời từ tài liệu có kiểm soát kèm nguồn và liên kết đúng quyền. Hiện `NOT_IMPLEMENTED`. Tính năng quản lý riêng, không thay đổi baseline 158 FR / 152 M.

## What Changes

- **Corpus hướng dẫn đã duyệt** có phiên bản: chunk từ docs 05/07/10/17/18 và phần liên quan 04/06/12, mỗi chunk có `sourceId`, mục, hash, quyền cần thiết, hiệu lực, nhãn SIMULATION/VERIFIED, route liên quan; không có metadata quyền thì không vào corpus.
- **Endpoint** `POST /api/ai/business-assistant/answers`: kiểm tra phiên/quyền/feature flag/quota/độ dài, chặn câu hỏi chứa dữ liệu cá nhân nhận diện được, lọc corpus theo quyền **trước** tìm kiếm và **trước** gọi Gemini, không nguồn → `INSUFFICIENT_SOURCE` không gọi model.
- **Adapter `GeminiProvider`** với structured output JSON; backend kiểm tra source IDs thuộc tập đã gửi, action keys thuộc route registry, dựng link từ registry; kiểm tra lại phiên/quyền/corpus version trước khi trả.
- **Bảo mật**: key chỉ ở server; không đọc database nghiệp vụ, không gửi hồ sơ/lương/log; chống prompt injection; audit metadata (không lưu câu hỏi/trả lời thô mặc định); cache gắn tập quyền/version.
- **Fallback** khi timeout/quota/budget/thiếu key/lỗi provider/flag tắt: hướng dẫn tĩnh đúng quyền; công/lương không bị ảnh hưởng.
- **UI**: nút "Trợ lý AI" ở header mở drawer, gợi ý theo vai trò/trang, câu trả lời có bước, nguồn, giới hạn; nhãn "AI hướng dẫn từ tài liệu hệ thống".
- **Bộ Q&A cố định ≥ 22 câu** và 12 tiêu chí AC-AI02-01…12.
- Mặc định `AI_BUSINESS_ASSISTANT_ENABLED=false`.

## Capabilities

### New Capabilities
- `ai-guidance-corpus`: corpus tài liệu đã duyệt có phiên bản, metadata quyền/hiệu lực/nhãn và route registry.
- `ai-business-assistant`: endpoint hỏi đáp theo quyền với Gemini, kiểm tra đầu vào/đầu ra, fallback, audit và giao diện drawer.

### Modified Capabilities
<!-- Chưa có spec nào trong openspec/specs/. -->

## Impact

- **Backend:** module mới `backend/src/ai-business-assistant/` (corpus loader, retriever theo quyền, PII filter, GeminiProvider, validator, route registry).
- **Dependency:** SDK Google Gen AI cho Node (ghim phiên bản khi triển khai); cấu hình `GEMINI_API_KEY`, `GEMINI_MODEL`, timeout, giới hạn token, rate limit, budget.
- **Dữ liệu:** thư mục corpus có manifest (ví dụ `docs/ai-corpus/`), không đưa toàn repo lên provider.
- **Frontend:** nút header + drawer; trang hướng dẫn tĩnh dùng khi fallback.
- **Docker/env:** thêm biến môi trường vào `.env.example` và `docker-compose.yml`.
- **Phụ thuộc:** nền quyền và navigation hiện có; không cần engine lương.
