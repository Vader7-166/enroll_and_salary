## 1. Corpus và route registry

- [x] 1.1 Biên soạn chunk hướng dẫn từ docs 05/07/10/17/18 và phần liên quan 04/06/12, diễn giải cho người dùng, gắn nhãn mô phỏng
- [x] 1.2 `manifest.json` với sourceId, mục, hash, quyền/vai trò, hiệu lực, nhãn, routes; script build kiểm tra metadata và tính version corpus
- [x] 1.3 Route registry backend (actionKey → màn hình + quyền)
- [x] 1.4 Bộ Q&A cố định ≥ 22 câu (12 hợp lệ, 4 vượt quyền, 2 thiếu nguồn, 2 injection, 2 nhầm mô phỏng/hiệu lực) có expected và nguồn

## 2. Backend

- [x] 2.1 Cấu hình `AI_BUSINESS_ASSISTANT_ENABLED` (false), `GEMINI_API_KEY`, `GEMINI_MODEL`, timeout, max token, rate limit, budget; thêm vào `.env.example` và `docker-compose.yml`
- [x] 2.2 Endpoint `POST /api/ai/business-assistant/answers`: phiên, flag, quota, độ dài, PII filter
- [x] 2.3 Retriever từ khóa/đề mục trên corpus đã lọc quyền, ưu tiên pageKey, ngưỡng điểm, `INSUFFICIENT_SOURCE`
- [x] 2.4 `GeminiProvider` structured output, prompt coi đầu vào là dữ liệu, timeout
- [x] 2.5 Validator: source IDs, action keys, loại URL/HTML, bước không nguồn; kiểm tra lại phiên/quyền/corpus version
- [x] 2.6 Fallback hướng dẫn tĩnh; audit metadata; cache gắn quyền/version
- [x] 2.7 Test với stub provider: quyền, injection, PII, lỗi/quota/flag (AC-AI02-05, 08, 09, 10, 11); script `verify:ai-assistant`

## 3. Giao diện

- [x] 3.1 Nút header + drawer, gợi ý theo vai trò/trang, trạng thái pending/lỗi/fallback, nguồn và giới hạn
- [x] 3.2 Xóa nội dung khi logout/đổi tài khoản/đổi quyền

## 4. Nghiệm thu

- [ ] 4.1 Chạy bộ Q&A với Gemini thật trên dữ liệu mô phỏng, review ngữ nghĩa từng câu, lưu build/corpus/prompt/model/tier
- [ ] 4.2 E2E bốn vai trò, đo token/latency (AC-AI02-12); cập nhật manifest AI và docs 24 theo kết quả thật
