# Biên bản diễn tập khôi phục dữ liệu HRTP

> Sinh bởi `node scripts/restore-drill.cjs` (FR-X.4, BR-64). Diễn tập định kỳ **6 tháng/lần** và sau mỗi thay đổi hạ tầng CSDL; lưu biên bản cùng tệp JSON kết quả.

| Mục | Giá trị |
|---|---|
| Kết luận | **{{status}}** |
| Thời điểm | {{performedAt}} |
| Người thực hiện | {{operator}} |
| Build (git SHA) | `{{build}}` |
| Bản sao lưu | `{{backupFile}}` ({{backupBytes}} byte) |
| SHA-256 bản sao lưu | `{{backupSha}}` |
| Môi trường | {{machine}} |

## Thời gian khôi phục (RTO ≤ 4 giờ)

| Bước | Giây |
|---|---|
| Giải mã | {{decrypt}} |
| Khôi phục vào CSDL sạch | {{restore}} |
| Kiểm tra | {{verify}} |
| **Tổng RTO đo được** | **{{rto}}** |

RPO thiết kế: ≤ 1 giờ (service `backup` sao lưu mỗi giờ).

## Kiểm tra sau khôi phục

| Kiểm tra | Kết quả | Chi tiết |
|---|---|---|
{{checks}}

## Số bản ghi đã khôi phục

| Bảng | Số dòng |
|---|---|
{{counts}}

## Xác nhận

- Người diễn tập: {{operator}} — ký: ……………
- Người kiểm tra (AD/KT): …………… — ký: ……………
- Ghi chú/sự cố phát sinh: ……………
