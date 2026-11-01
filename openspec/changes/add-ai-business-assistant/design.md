## Context

Docs 24 đặc tả đầy đủ mục tiêu, ranh giới, contract, cấu hình Gemini, UI và bộ nghiệm thu. Manifest AI ghi `business_data_access=false`, `write_actions=false`, `google_search_grounding=false`, model/tier chưa ghim. Phiên đăng nhập cung cấp role/permission/scope/exclusion; frontend có hệ thống route theo quyền.

## Goals / Non-Goals

**Goals:**
- Câu trả lời chỉ dựa trên nguồn được phép, mỗi bước có nguồn, link do backend dựng.
- Không có đường nào để dữ liệu nghiệp vụ đi tới provider.
- Lỗi AI không ảnh hưởng nghiệp vụ lõi.

**Non-Goals:**
- Không đọc trạng thái kỳ/hồ sơ/lương thực tế (AI-01 để sau).
- Không vector database, embeddings hay agent framework ở bản đầu.
- Không lịch sử hội thoại; mỗi câu hỏi độc lập.

## Decisions

1. **Corpus tĩnh có manifest**: tệp Markdown chunk + `manifest.json` (sourceId, title, section, hash, requiredPermissions, roles, effectiveFrom/To, label, routes). Build bước kiểm tra: chunk thiếu quyền bị loại; hash khớp nội dung; version corpus = hash manifest.
2. **Retrieval từ khóa/đề mục** trên tập chunk **đã lọc quyền**: chuẩn hóa tiếng Việt (bỏ dấu khi so khớp), chấm điểm theo tiêu đề/mục/từ khóa + ưu tiên `pageKey`; lấy top-k có ngưỡng. Đủ cho bộ câu hỏi cố định và dễ kiểm chứng.
3. **Prompt coi câu hỏi và nguồn là dữ liệu**, yêu cầu JSON theo schema `{status, answer, steps[{text, sourceIds}], actions[actionKey], limitations}`; không tool, không SQL, không mạng.
4. **Validator sau model**: mọi `sourceIds` thuộc tập đã gửi; `actionKey` thuộc route registry và người dùng có quyền mở; loại HTML/URL tự sinh; bước không có nguồn bị loại; nếu còn rỗng → `INSUFFICIENT_SOURCE`. Kiểm tra ngữ nghĩa thực hiện bằng bộ Q&A có expected, không chỉ schema.
5. **PII filter đầu vào**: regex cho CCCD/MST/số tài khoản/điện thoại/email và đối chiếu mã NV dạng mã hóa; phát hiện → từ chối trước khi gọi Gemini; UI nhắc không nhập thông tin cá nhân. Không xem là bảo đảm ẩn danh tuyệt đối.
6. **Fallback** = nội dung hướng dẫn tĩnh lọc quyền theo `pageKey`, trả `UNAVAILABLE` + fallback; không retry vô hạn.
7. **Audit metadata**: requestId, user/role/scope version, pageKey, source IDs/hash, corpus/prompt/model version, latency, token, outcome; không ghi câu hỏi/trả lời thô mặc định.
8. **Thu hồi phiên/đổi quyền**: response mang `scopeVersion`; frontend xóa cache drawer khi logout/đổi tài khoản; backend kiểm tra lại phiên trước khi trả.

## Risks / Trade-offs

- [Model bịa nội dung dù có nguồn] → validator + bộ Q&A ngữ nghĩa có người review; nhãn "AI hướng dẫn" và giới hạn.
- [Chi phí/quota] → rate limit theo người dùng, budget ngày, timeout ngắn; flag tắt mặc định.
- [Retrieval từ khóa bỏ sót] → bộ Q&A đo recall; bổ sung từ khóa/đồng nghĩa trong manifest.

## Migration Plan

Không migration DB bắt buộc (audit dùng `audit_log`). Thêm biến môi trường; flag tắt mặc định nên an toàn khi triển khai.

## Open Questions

- Model Gemini, API version, tier và giá chưa ghim (docs 24 §6); chọn khi triển khai sau khi đo trên câu hỏi tiếng Việt.
