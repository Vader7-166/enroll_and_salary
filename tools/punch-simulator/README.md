# Giả lập máy chấm công

Công cụ chỉ dùng cho môi trường demo local. Nó sinh lượt quẹt thẻ và gửi qua **API nhập tệp thật**
(`POST /api/attendance/imports`), nên mọi bước ghép công, ngoại lệ và kỳ công đều chạy như khi nhận dữ liệu
từ máy chấm công. Công cụ từ chối CSDL không phải local (`localhost`/`127.0.0.1`) hoặc host demo khai báo qua
`HRTP_SIM_DB_HOST` (Compose đặt sẵn là `db`).

Cần: API HRTP đang chạy (mặc định `http://127.0.0.1:3000/api`), `backend/.env` có `DATABASE_URL`, và một tài khoản
có quyền nhập chấm công, quản lý kỳ công và danh mục ca (Admin).

## Chạy cùng Docker Compose

Service `simulator` khởi động cùng dự án (`docker compose up -d --build`) và mở tại http://127.0.0.1:4100.
Container gọi API qua `http://backend:3000/api`, đọc CSDL `db` trong mạng Compose, và tự đăng nhập bằng
`ADMIN_USERNAME`/`ADMIN_PASSWORD` trong `.env`. Nếu Admin đã đổi mật khẩu, đặt `SIM_PASSWORD` hoặc đăng nhập trên trang.
Mặc định đồng hồ **không** tự chạy, nên bật dự án không ghi dữ liệu nào.

| Biến trong `.env` | Mặc định | Ý nghĩa |
|---|---|---|
| `SIM_PORT` | `4100` | Cổng trên máy (chỉ mở ở 127.0.0.1) |
| `SIM_USERNAME` / `SIM_PASSWORD` | Admin của seed | Tài khoản để nhập chấm công |
| `SIM_AUTOSTART` | `false` | `true`: đồng hồ tự chạy từ giờ hiện tại khi container khởi động |
| `SIM_SPEED` | `1` | Tốc độ khi tự chạy (`1` = đúng thời gian thực) |

```bash
docker compose exec simulator node history.cjs --dry-run   # sinh lịch sử ngay trong container
docker compose exec simulator node history.cjs             # (đã có mật khẩu từ .env)
docker compose stop simulator                               # tắt riêng công cụ
```

## Dữ liệu lịch sử

```bash
npm run sim:history -- --dry-run                     # chỉ xem phạm vi, không ghi gì
HRTP_SIM_PASSWORD='...' npm run sim:history          # 26/07/2026 → hôm qua, mọi cơ sở
HRTP_SIM_PASSWORD='...' npm run sim:history -- --from 2026-10-01 --to 2026-10-31 --sites NM-BN,HQ-HN
```

Lệnh này làm các bước sau:

1. Tạo 4 ca ở cấp công ty nếu chưa có: `HC` 08:00–17:00 (nghỉ 60 phút không lương), `CA-A` 06–14, `CA-B` 14–22,
   `CA-C` 22–06 (nghỉ giữa ca có lương).
2. Tạo và mở các kỳ công còn thiếu (chốt ngày 25).
3. Ghi kế hoạch ca ở trạng thái **APPROVED** trực tiếp vào CSDL. Khối trực tiếp xoay A→B→C theo tuần (Nghệ An chỉ A→B),
   khối gián tiếp làm hành chính T2–T7, nghỉ Chủ nhật và ngày 02/09. Ngày đã có lịch được giữ nguyên.
4. Sinh lượt quẹt rồi nhập theo từng tuần, mỗi tệp tối đa 8.000 dòng.

Phân phối lượt quẹt bám cửa sổ ghép công mặc định: vào từ −30 đến +15 phút, ra từ −15 đến +30 phút. Khoảng 96% ngày công
ra OK. Phần còn lại gồm khoảng 6% đi muộn, 2,5% về sớm (đều nằm trong cửa sổ nên ra cờ LATE/EARLY), 1,2% vắng,
2% quên quẹt và 1,5% quẹt trùng. Lượt quẹt được sinh xác định theo mã nhân viên và ngày, nên **chạy lại không nhân đôi
dữ liệu**: khóa duy nhất của `raw_punch` sẽ loại bản trùng.

Lịch sử không có OT thực tế. OT cần đề nghị đã duyệt, mà luồng đó thuộc Tổ trưởng/Quản đốc.

## Thời gian thực (web)

```bash
npm run sim:live                                     # mở http://127.0.0.1:4100
```

1. Đăng nhập trên trang. Có thể đặt sẵn `HRTP_SIM_PASSWORD` để server tự đăng nhập; mật khẩu chỉ nằm trong bộ nhớ.
2. Chọn thời điểm bắt đầu (giờ VN) và tốc độ (×1 … ×3600), rồi bấm **Bắt đầu**. Nếu ngày đó chưa có lịch ca,
   công cụ tự tạo lịch cho 14 ngày.
3. Mỗi giây, các lượt quẹt đã đến giờ giả lập được gom thành tệp CSV theo cơ sở/kỳ và gửi đi. Mở HRTP → **Chấm công**
   để xem bảng công cập nhật.
4. Các nút sự kiện tác động lên lượt vào/ra đang chờ: đi muộn (trong cửa sổ hoặc quá cửa sổ), về sớm,
   quên quẹt vào/ra, ở lại tăng ca, quẹt trùng, gửi tệp có mã lạ (cả tệp bị từ chối), và quẹt tay theo mã nhân viên.

Mỗi lần gửi mất vài giây (nhập + ghép trong một giao dịch). Ở tốc độ cao, đồng hồ có thể chạy trước việc gửi;
ô **Đến hạn, chưa gửi** cho biết phần tồn. Tạm dừng thì phần tồn vẫn được xả hết. Với cả 4 cơ sở, tốc độ ×60–×300
cho cảm giác "thời gian thực" rõ nhất.

Biến môi trường: `HRTP_SIM_USER` (mặc định `admin`), `HRTP_SIM_PASSWORD`, `HRTP_SIM_API`, `HRTP_SIM_PORT` (mặc định 4100).

## Kiểm thử

```bash
npm run verify:punch-simulator   # chạy trên CSDL cô lập, tự tạo rồi xóa
```
