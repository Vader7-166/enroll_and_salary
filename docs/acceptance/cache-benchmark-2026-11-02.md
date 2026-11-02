# Số đo hiệu năng — change `add-caching-layer` (02/11/2026)

Máy phát triển (i5-12450H 12 nhân, Node 26, PostgreSQL 18 trong Docker), CSDL cô lập, dữ liệu mô phỏng. **Chưa phải nghiệm thu**
trên môi trường đích. Tái lập: `npm run benchmark:attendance-month`, `node scripts/benchmark-read-routes.cjs 30`.

## 1. Nhập công khi lịch ca đã duyệt cả hai kỳ (NFR-08b)

1.100 nhân viên một cơ sở, 67.100 lịch ca (26/09 → 25/11), nhập một ngày (2.200 lượt quẹt); timeout giao dịch 90 s.

| Giai đoạn | Trước | Sau |
|---|---|---|
| Tra lịch ca cho từng ngày công (`schedules.find`, O(n²)) | 61,2 s | 0,1 s |
| Tra tham số ghép công (244 bộ quy tắc × 5 tham số × 3 truy vấn) | 13,5–18,5 s | một lần nạp |
| Ghi ngày công (trigger kiểm tra kỳ/phân xưởng theo dòng) | 36,2 s (lần 1) · 80,2 s (lần 2) | chỉ dòng thay đổi |
| Ghi OT thực tế (upsert từng dòng) | 11,7–19,9 s | theo lô, chỉ dòng thay đổi |
| **Tổng lần nhập đầu / lần nhập sau** | **> 90 s (hủy) / 131 s (đo với timeout nới)** | **56,7 s / 35,3 s** |

Lần nhập đầu vẫn ghi ~40.000 ngày vắng đã qua lần đầu tiên qua trigger theo dòng; vận hành hằng ngày chỉ thêm ~1.100 dòng/lần.

## 2. Route đọc nhiều — cache tham chiếu tắt / bật

30 lần tuần tự mỗi route sau 3 lần làm nóng, tài khoản `kt.all`, bộ dữ liệu foundation (cây tổ chức nhỏ hơn dữ liệu thật).
"Truy vấn" là số và tổng thời gian truy vấn CSDL trong một request (`QUERY_METRICS=true`).

| Route | Tắt: p50 / p95 · truy vấn | Bật: p50 / p95 · truy vấn |
|---|---|---|
| `GET /organization/context` | 46 / 66 ms · 15 (22 ms) | 36 / 47 ms · 12 (14 ms) |
| `GET /employees?pageSize=50` | 134 / 160 ms · 26 (75 ms) | 71 / 91 ms · 23 (29 ms) |
| `GET /attendance/board` | 118 / 164 ms · 30 (101 ms) | 49 / 77 ms · 21 (28 ms) |
| `GET /payroll/periods` | 74 / 87 ms · 16 (43 ms) | 36 / 41 ms · 13 (14 ms) |
| `GET /reports` | 44 / 56 ms · 10 (23 ms) | 27 / 30 ms · 10 (12 ms) |

Số truy vấn giảm ít vì mỗi request vẫn xác thực phiên (cố ý không cache) và đọc phiên bản cache; phần giảm chính là
các truy vấn nặng nạp toàn bộ `org_unit_version`, vai trò, tham số và chính sách.
