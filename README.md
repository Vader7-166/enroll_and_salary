<div align="center">

<h1>HRTP</h1>

<h3>Hệ thống Quản lý Chấm công &amp; Tiền lương</h3>

<p>Quản lý nhân sự, lịch làm việc và dữ liệu chấm công cho doanh nghiệp sản xuất linh kiện điện tử.</p>

<p>Nhân sự &amp; Hợp đồng · Phân ca &amp; Phê duyệt · Chấm công &amp; Truy vết</p>

<p>
  <img src="https://img.shields.io/badge/version-0.1.0-7c3aed?style=flat-square" alt="Version 0.1.0">
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square" alt="Môi trường đã kiểm chứng: Windows">
  <img src="https://img.shields.io/badge/Node.js-22.16.0-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 22.16.0">
  <img src="https://img.shields.io/badge/TypeScript-5.9.3-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5.9.3">
  <br>
  <img src="https://img.shields.io/badge/React-19.3.1-149ECA?style=flat-square&logo=react&logoColor=white" alt="React 19.3.1">
  <img src="https://img.shields.io/badge/NestJS-11.2.7-E0234E?style=flat-square&logo=nestjs&logoColor=white" alt="NestJS 11.2.7">
  <img src="https://img.shields.io/badge/PostgreSQL-18.3-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 18.3">
  <img src="https://img.shields.io/badge/status-local_demo-d97706?style=flat-square" alt="Trạng thái: local demo">
</p>

<p>
  <a href="#tong-quan">Tổng quan</a> ·
  <a href="#tinh-nang">Tính năng</a> ·
  <a href="#kien-truc">Kiến trúc</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#demo">Demo</a> ·
  <a href="#api">API</a> ·
  <a href="#kiem-chung">Kiểm chứng</a> ·
  <a href="#tai-lieu">Tài liệu</a>
</p>

</div>

---

> [!IMPORTANT]
> HRTP hiện là **bản demo chạy local với API và PostgreSQL thật**, sử dụng dữ liệu doanh nghiệp mô phỏng. Đã triển khai nhân sự, hợp đồng, phân ca và nhập/ghép lượt quẹt; **chưa có engine tính lương, chốt công hoặc AI**. Tên dự án và đặc tả R1 thể hiện phạm vi mục tiêu, không phải tuyên bố đã hoàn thành toàn bộ sản phẩm hoặc sẵn sàng vận hành thực tế.

<a id="tong-quan"></a>
## Tổng quan

HRTP tập trung vào bài toán quản lý lao động nhiều cơ sở, nhiều cấp đơn vị và nhiều ca làm việc. Dữ liệu đi từ hồ sơ nhân sự, phân công có hiệu lực và lịch đã duyệt đến kết quả chấm công có thể truy ngược về từng lượt quẹt.

- **Bối cảnh nghiệp vụ:** doanh nghiệp sản xuất linh kiện điện tử, quy mô mục tiêu 1.500–3.000 lao động.
- **Cơ cấu:** công ty → cơ sở → khối → phòng/phân xưởng → tổ; bốn cơ sở tại Hà Nội, Bắc Ninh, Hà Nam và Nghệ An.
- **Người dùng:** Tổ trưởng, Quản đốc, Kế toán và Admin. Công nhân là đối tượng dữ liệu, không có tài khoản đăng nhập.
- **Nền tảng:** website responsive; không có ứng dụng mobile/desktop riêng hoặc chế độ offline.
- **Quy ước thời gian:** nghiệp vụ theo múi giờ `Asia/Ho_Chi_Minh`; ngày công của ca qua đêm là ngày bắt đầu ca.

Phạm vi thiết kế R1 gồm **10 phân hệ, 158 yêu cầu chức năng**, trong đó 152 thuộc R1 và 6 ở backlog. Chi tiết tại [phạm vi và ma trận nghiệm thu](docs/19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md).

<a id="tinh-nang"></a>
## Tính năng và trạng thái

| Nhóm | Đã triển khai trong bản local |
|---|---|
| Xác thực & phân quyền | Đăng nhập/đăng xuất, quản lý phiên, thu hồi phiên; kiểm tra vai trò, cây đơn vị, hiệu lực và danh sách loại trừ |
| Hồ sơ nhân sự | Tìm kiếm, lọc, xem chi tiết và tạo nhân sự trong phạm vi được cấp |
| Hợp đồng & điều chuyển | Hợp đồng, phụ lục mã hóa; lịch sử và điều chuyển theo ngày hiệu lực |
| Thiết lập & kỳ công | Tham số/chính sách theo phiên bản và hiệu lực; tạo, mở kỳ công |
| Ca & phân ca | Danh mục ca, lịch theo tổ/người/ngày; Tổ trưởng gửi, Quản đốc duyệt hoặc trả lại; lịch sử phiên bản |
| Nhập dữ liệu chấm công | CSV/TXT/XLSX, cấu hình cột, kiểm tra từng dòng, chống nhập trùng; lịch sử và nguồn dữ liệu |
| Xử lý chấm công | Ghép vào–ra theo lịch đã duyệt, ca qua ngày, nghỉ giữa ca, thiếu quẹt, đi muộn/về sớm |
| Bảng công & truy vết | Lọc theo kỳ, đơn vị, nhân viên; xem ngoại lệ, phân đoạn giờ làm và nguồn lượt quẹt |
| Kết nối hệ thống | Health endpoint kiểm tra truy vấn PostgreSQL thật và trạng thái kết nối trên giao diện |

**Chưa triển khai:** đăng ký/duyệt OT, nghỉ phép và giải trình, xác nhận/chốt công, API chốt/khóa kỳ, tính lương/BH/thuế, phúc lợi, quyết toán, báo cáo lương và trợ lý AI. Các nội dung này nằm trong thiết kế hoặc kế hoạch, không được xem là chức năng đang hoạt động.

### Nguyên tắc xử lý chấm công

- Chỉ ghép lượt quẹt với **lịch APPROVED**; không tự suy ra giờ ra khi thiếu lượt.
- Ca `22:00–06:00` thuộc ngày bắt đầu, dù dữ liệu ra nằm ở ngày kế tiếp.
- Lượt quẹt gốc bất biến; log trùng/bị loại vẫn có thể truy vết, không bị xóa để làm sạch kết quả.
- Tệp sai một dòng bị **từ chối toàn lô**; không âm thầm lưu phần hợp lệ.
- Chỉ kỳ **OPEN** được ghi kết quả công. Log chờ hoặc đến sau chốt được giữ kèm trạng thái/lý do; không sửa kết quả của kỳ CLOSED/LOCKED.
- Giờ làm ngoài ca không tự chuyển thành OT; cờ muộn/sớm không tự phát sinh khấu trừ lương.

<a id="kien-truc"></a>
## Kiến trúc & công nghệ

Kiến trúc **modular monolith**, tổ chức bằng npm workspaces. Frontend và backend là hai thành phần của cùng website.

```text
Trình duyệt
    │
    ▼
React + Ant Design + TanStack Query
    │ /api — Vite proxy khi chạy local
    ▼
NestJS — xác thực, phạm vi truy cập, nghiệp vụ, audit
    │
    ▼
Prisma → PostgreSQL
```

| Thành phần | Công nghệ |
|---|---|
| Frontend | React 19.3.1, TypeScript 5.9.3, Vite 7.3.7 |
| UI & dữ liệu phía client | Ant Design 5.29.3, TanStack Query 5.104.3, Be Vietnam Pro |
| Backend | NestJS 11.2.7, class-validator, class-transformer |
| Database & ORM | PostgreSQL 18.3, Prisma 6.19.3 |
| Nhập tệp | ExcelJS, csv-parse, iconv-lite |
| Số thập phân | Decimal.js; đã cài, chưa có engine tính lương |
| Kiểm chứng | Node.js test runner; các bài tích hợp chạy HTTP và PostgreSQL thật |

### Cấu trúc thư mục

```text
.
├── backend/
│   ├── prisma/           # Schema, migration và seed dữ liệu
│   ├── src/              # Auth, nhân sự, thiết lập, phân ca, chấm công...
│   └── test/             # Parser, engine và kiểm chứng tích hợp
├── frontend/
│   ├── public/           # Tài nguyên tĩnh
│   └── src/              # Giao diện, API client và theme
├── scripts/              # Quản lý PostgreSQL local, kiểm tra đặc tả
├── docs/                 # Yêu cầu, nghiệp vụ, thiết kế và hướng dẫn vận hành
├── diagrams/             # Sơ đồ nghiệp vụ, kiến trúc và phạm vi R1
├── DESIGN.md             # Điểm vào quy chuẩn giao diện
└── package.json          # Workspaces và lệnh dùng chung
```

<a id="quick-start"></a>
## Quick start

### 1. Chuẩn bị

Môi trường đã kiểm chứng: **Windows x64**, **Node.js 22.16.0**, **npm 10.9.2**, **PostgreSQL 18.3**. Dự án yêu cầu Node `>=22.16.0 <23` và npm `>=10.9.2 <11`.

Cài PostgreSQL 18 cùng các binary `postgres`, `initdb`, `pg_ctl`, `psql`, `createdb`. Không cần Docker cho quy trình local dưới đây. Chạy các lệnh từ **thư mục gốc dự án**.

### 2. Thiết lập lần đầu

```powershell
# Thay đường dẫn bằng thư mục bin PostgreSQL 18 trên máy của bạn.
npm run db:setup -- --bin "D:/PostgreSQL/bin"

npm ci
npm run db:deploy
npm run db:seed
npm run dev
```

`db:setup` tạo cụm database riêng tại `.local/pgdata`, lắng nghe `127.0.0.1:5433`, sinh mật khẩu và khóa mã hóa vào `backend/.env`. Lệnh này không phụ thuộc npm packages nên chạy được trước `npm ci`. Có thể thay `--bin` bằng biến môi trường `PG_BIN` hoặc các binary trên `PATH`.

> [!WARNING]
> Cụm demo sử dụng tài khoản PostgreSQL superuser **chỉ dành cho local**. Script không thay đổi service PostgreSQL có sẵn ở cổng 5432 và từ chối ghi đè `.env` không do nó quản lý. Không dùng cấu hình hoặc seed demo cho môi trường vận hành.

| Địa chỉ | Chức năng |
|---|---|
| [127.0.0.1:5173](http://127.0.0.1:5173) | Website khi chạy dev |
| [127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health) | Kiểm tra API và PostgreSQL |

### 3. Chạy lại và dừng

```powershell
npm run db:start
npm run dev
```

Dừng frontend/backend bằng `Ctrl+C` tại terminal chạy dev. Quản lý riêng database bằng:

```powershell
npm run db:status
npm run db:stop
```

Không xóa `.local/pgdata` khi server đang chạy. Dữ liệu được giữ qua các lần stop/start.

### 4. Kiểm tra và chạy bản build

Dừng tiến trình dev/watch trước khi build để tránh nhiều compiler cùng ghi `backend/dist`.

```powershell
npm run typecheck
npm run build
npm run db:validate --workspace backend
```

Sau đó mở **hai terminal riêng**:

```powershell
# Terminal 1 — API
npm run start --workspace backend
```

```powershell
# Terminal 2 — website preview
npm run preview --workspace frontend
```

Website preview chạy tại [127.0.0.1:4173](http://127.0.0.1:4173). Vite preview phục vụ kiểm tra bản build local, **không phải máy chủ production**.

<a id="demo"></a>
## Tài khoản & trải nghiệm demo

Seed mặc định tạo bộ **2.200 hồ sơ nhân sự mô phỏng** theo cơ cấu bốn cơ sở, cùng năm tài khoản thuộc bốn vai trò. Chạy lại seed không reset mật khẩu hoặc dữ liệu người dùng đã chỉnh sửa.

| Tài khoản | Vai trò | Phạm vi chính |
|---|---|---|
| `tt.bn` | Tổ trưởng | Đọc nhân sự, lịch sử và công trong Tổ 1 / Phân xưởng 1 Bắc Ninh; lập/gửi lịch theo quyền |
| `qd.bn` | Quản đốc | Phân xưởng 1 Bắc Ninh; xem công, duyệt/trả lại lịch trong phạm vi |
| `kt.bn` | Kế toán cơ sở | Nhân sự, hợp đồng, điều chuyển và đọc công tại Bắc Ninh |
| `kt.all` | Kế toán công ty | Phạm vi toàn công ty, có áp dụng danh sách loại trừ |
| `ad.demo` | Admin | Tài khoản, tổ chức, thiết lập, kỳ công, danh mục ca; nhập/xử lý và xem công, không đọc hồ sơ nhân sự/lương |

**Mật khẩu được sinh ngẫu nhiên**, lưu tại `.local/demo-accounts.json` trên máy đã seed. Không có mật khẩu mặc định công khai; không đưa tệp này vào commit hoặc chia sẻ.

### Thử luồng chấm công

1. Tạo/mở kỳ công bằng tài khoản có quyền quản lý kỳ; chuẩn bị phân công nhân sự còn hiệu lực.
2. Tổ trưởng lập lịch và gửi duyệt; Quản đốc duyệt để lịch thành **APPROVED**.
3. Đăng nhập `ad.demo` → **Chấm công** → chọn cơ sở, kỳ tham chiếu → **Nhập tệp**.
4. Tải mẫu 5 cột trên giao diện hoặc chuẩn bị CSV không có dòng tiêu đề:

   ```csv
   BN00004,2026-10-18,21:58:00,MAY01,IN
   BN00004,2026-10-19,06:04:00,MAY01,OUT
   ```

5. Bấm **Nhập và xử lý**; xem **Bảng công**, **Ngoại lệ**, **Lịch sử nhập** và **Lượt quẹt gốc**. Bấm dòng để xem chi tiết nguồn.
6. Đăng nhập `tt.bn` để đối chiếu góc nhìn giới hạn trong tổ, không có chức năng nhập tệp của Admin.

Ví dụ trên cần kỳ **OPEN** bao phủ ngày `2026-10-18` và lịch ca `22:00–06:00` đã duyệt của BN00004. Với nghỉ giữa ca có tính giờ, kết quả là **8 giờ đêm, 1 công**, thuộc ngày công `2026-10-18`. Tệp không tự tạo lịch hoặc mở kỳ; thay nhân viên/ngày cho phù hợp dữ liệu của bạn. Giới hạn nhập: **10 MiB/tệp, 20.000 dòng**, định dạng CSV/TXT/XLSX.

<a id="api"></a>
## API

Prefix chung: `/api`. Ngoại trừ đăng nhập và health, các endpoint bên dưới yêu cầu phiên hợp lệ; quyền và phạm vi tiếp tục được kiểm tra tại backend.

| Phương thức | Endpoint | Mục đích |
|---|---|---|
| `GET` | `/api/health` | Kiểm tra truy vấn PostgreSQL; HTTP 200 khi kết nối được, 503 khi database lỗi |
| `POST` | `/api/auth/login` | Đăng nhập bằng `username`, `password`; thiết lập cookie phiên |
| `GET` | `/api/auth/me` | Thông tin người dùng hiện tại |
| `POST` | `/api/auth/logout` | Kết thúc phiên |
| `GET` | `/api/attendance/context` | Cơ sở, đơn vị, kỳ và cấu hình được phép |
| `POST` | `/api/attendance/profiles` | Lưu cấu hình cột mới |
| `POST` | `/api/attendance/imports` | Nhập tệp multipart: `file`, `siteId`, `referencePeriodId`, `profileId` tùy chọn |
| `POST` | `/api/attendance/process` | Xử lý lại log chờ theo cơ sở/kỳ tham chiếu |
| `GET` | `/api/attendance/board` | Bảng công, bộ lọc và tổng hợp trong phạm vi |
| `GET` | `/api/attendance/days/:id` | Chi tiết ngày công và các lượt ghép |
| `GET` | `/api/attendance/imports` | Lịch sử nhập theo cơ sở |
| `GET` | `/api/attendance/imports/:id` | Chi tiết lô nhập |
| `GET` | `/api/attendance/punches` | Lượt quẹt gốc và trạng thái xử lý |

Kiểm tra nhanh khi API đang chạy:

```powershell
curl.exe http://127.0.0.1:3000/api/health
```

Chi tiết bộ lọc, phân trang và định dạng nhập: [hướng dẫn chấm công §7.11](docs/20-tech-stack-va-moi-truong-phat-trien.md#711-nhập-tệp-ghép-lượt-quẹt-và-bảng-công).

<a id="kiem-chung"></a>
## Kiểm chứng

Chạy từ thư mục gốc sau khi cài dependencies và khởi động database local:

```powershell
npm run typecheck
npm run verify:foundation
npm run verify:hr
npm run verify:shifts
npm run verify:attendance
```

Các lệnh tích hợp tự tạo database local cách ly, migrate/seed, khởi chạy HTTP server thật và dọn database đã tạo. Tài khoản kết nối cần quyền tạo/xóa database; không trỏ bộ kiểm chứng vào môi trường vận hành. Chạy lần lượt, không chạy đồng thời với compiler dev/watch.

| Bộ kiểm chứng | Phạm vi | Mốc kết quả đã ghi nhận |
|---|---|---|
| `verify:foundation` | Phiên, phân quyền, nhân sự và tính bền vững của dữ liệu nền | 13/13 |
| `verify:hr` | Hợp đồng, điều chuyển, tham số/chính sách và kỳ công | 16/16 |
| `verify:shifts` | Danh mục ca, lập/gửi/duyệt lịch và ràng buộc liên phân hệ | 14/14 |
| `verify:attendance` | Parser, engine, nhập trùng, log bất biến, ca đêm và phân quyền | 21/21 |

Đây là kết quả local được ghi trong [hướng dẫn vận hành](docs/20-tech-stack-va-moi-truong-phat-trien.md), **không phải badge CI hoặc chứng nhận UAT toàn bộ R1**. Kiểm chứng trình duyệt đã bao phủ nhập/nhập lại tệp, từ chối lô lỗi, truy vết, phạm vi Tổ trưởng và màn hình 390px.

Kiểm tra tính nhất quán của **đặc tả** độc lập với kiểm thử ứng dụng; cần Python 3:

```powershell
python scripts/validate_release_scope.py
```

<a id="cau-hinh"></a>
## Cấu hình & bảo vệ dữ liệu

| Biến | Ý nghĩa |
|---|---|
| `DATABASE_URL` | Kết nối PostgreSQL phía backend |
| `HOST`, `PORT` | Địa chỉ lắng nghe API; mặc định local `127.0.0.1:3000` |
| `HR_DATA_KEY` | Khóa 32 byte dạng Base64 dùng mã hóa dữ liệu hợp đồng |
| `WEB_ORIGINS` | Origin được phép cho các request ghi |
| `COOKIE_SECURE` | Bật `true` khi triển khai qua HTTPS |
| `AUTH_*` | Thời hạn phiên, giới hạn sai mật khẩu và thời gian khóa |
| `API_PROXY_TARGET` | Đích proxy API của Vite, mặc định `http://127.0.0.1:3000` |

Mẫu cấu hình: [backend/.env.example](backend/.env.example) và [frontend/.env.example](frontend/.env.example). Nếu tự quản lý database, tạo `.env` theo mẫu thay vì chạy script quản lý cụm demo.

- Sao lưu **khóa `HR_DATA_KEY` cùng database** ở nơi an toàn. Không sinh khóa mới thay trực tiếp khi đã có dữ liệu mã hóa.
- Không đưa `.env`, `.local/`, tài khoản demo hoặc bản sao lưu lên kho mã; các đường dẫn nhạy cảm đã nằm trong `.gitignore`.
- Phiên dùng cookie `HttpOnly`, `SameSite=Strict`; database chỉ lưu digest token. Admin không mặc nhiên có quyền đọc lương.
- Nhập chấm công qua tệp, **không kết nối trực tiếp máy chấm công, ngân hàng hoặc hệ thống BHXH/thuế**.
- Vite proxy phục vụ local; môi trường vận hành cần reverse proxy cùng origin cho `/api`, HTTPS và cấu hình bảo mật riêng. Không đưa bí mật backend vào biến frontend.

<a id="tai-lieu"></a>
## Tài liệu dự án

| Tài liệu | Nội dung |
|---|---|
| [Chỉ mục tài liệu](docs/README.md) | Điểm vào toàn bộ đặc tả và lịch sử cập nhật |
| [Tổng quan & phạm vi](docs/01-tong-quan-va-pham-vi.md) | Bối cảnh, mục tiêu và ranh giới hệ thống |
| [Quy tắc nghiệp vụ](docs/04-quy-tac-nghiep-vu.md) | Các nguyên tắc xử lý và ràng buộc nghiệp vụ |
| [Thuật toán chấm công & tính lương](docs/06-thuat-toan-cham-cong-va-tinh-luong.md) | Thiết kế thuật toán, gồm cả phần chưa triển khai |
| [Kiến trúc hệ thống](docs/08-kien-truc-he-thong.md) | Phân hệ và quan hệ giữa các thành phần |
| [Mô hình dữ liệu](docs/09-mo-hinh-du-lieu.md) | Thực thể, quan hệ và ràng buộc |
| [Phân quyền & bảo mật](docs/10-phan-quyen-va-bao-mat.md) | Vai trò, phạm vi và bảo vệ dữ liệu |
| [Phạm vi R1 & nghiệm thu](docs/19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md) | Baseline, yêu cầu và tiêu chí chấp nhận |
| [Cài đặt & vận hành local](docs/20-tech-stack-va-moi-truong-phat-trien.md) | Thiết lập, tài khoản, khóa mã hóa và luồng demo |
| [Quy chuẩn giao diện](DESIGN.md) | Hướng thiết kế và liên kết tới UI guide |
| [Trợ lý nghiệp vụ AI theo vai trò](docs/24-ai-tro-ly-nghiep-vu-theo-vai-tro.md) | Thiết kế AI-02, chưa tích hợp trong bản hiện tại |

---

**HRTP** · Website quản lý chấm công & tiền lương cho doanh nghiệp sản xuất · Bản demo local sử dụng dữ liệu mô phỏng.
