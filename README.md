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
> HRTP hiện là **bản demo chạy local với API và PostgreSQL thật**, sử dụng dữ liệu doanh nghiệp mô phỏng. Đã triển khai nhân sự, hợp đồng, phân ca, nhập/ghép lượt quẹt, đăng ký/duyệt và đối chiếu OT thực tế, giải trình/điều chỉnh công có kiểm duyệt, nghỉ/quỹ phép, TT xác nhận, QĐ chốt xưởng, KT trả/khóa nguồn công bất biến, cấu phần lương, đơn giá/công thức theo phiên bản và chạy thử Decimal có vết; **chưa có tiền OT, engine tính bảng lương hoặc AI**. Đặc tả R1 là phạm vi mục tiêu, không phải tuyên bố sẵn sàng vận hành toàn sản phẩm.

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
| Xác thực & phân quyền | Đăng nhập/đăng xuất; Admin tạo/sửa tài khoản, quyền/loại trừ có hiệu lực, khóa/mở khóa, reset/đổi mật khẩu, lịch sử/hạn đổi và thu hồi phiên; kiểm tra vai trò, cây đơn vị và audit |
| Hồ sơ nhân sự | Tìm kiếm, lọc, xem chi tiết và tạo nhân sự trong phạm vi được cấp |
| Hợp đồng & điều chuyển | Hợp đồng, phụ lục mã hóa; lịch sử và điều chuyển theo ngày hiệu lực |
| Thiết lập & kỳ công | Tham số/chính sách hiệu lực; AD tạo/mở kỳ, KT trả trước khóa và khóa nguồn bất biến theo thứ tự kỳ |
| Ca & phân ca | Danh mục ca, lịch theo tổ/người/ngày; Tổ trưởng gửi, Quản đốc duyệt hoặc trả lại; lịch sử phiên bản |
| Nhập dữ liệu chấm công | CSV/TXT/XLSX, cấu hình cột, kiểm tra từng dòng, chống nhập trùng; lịch sử và nguồn dữ liệu |
| Xử lý chấm công | Ghép vào–ra theo lịch đã duyệt, ca qua ngày, nghỉ giữa ca, thiếu quẹt, đi muộn/về sớm |
| Bảng công & truy vết | Lọc theo kỳ, đơn vị, nhân viên; xem ngoại lệ, phân đoạn giờ làm và nguồn lượt quẹt |
| Đăng ký & duyệt OT | Tổ trưởng lập/sửa/gửi; Quản đốc duyệt/trả lại/từ chối; chứng từ đồng ý từng người, trần ngày/tháng/năm và lịch sử bất biến |
| Đối chiếu OT thực tế | Đề nghị/đã duyệt/thực tế/đủ điều kiện; ca đêm nối OT, tách ngày lịch/giờ ngày–đêm, ngoại lệ và nguồn quẹt; bảo vệ kỳ đóng/khóa |
| Giải trình & điều chỉnh | TT lập/gửi lý do và bằng chứng, QĐ duyệt/trả lại/từ chối; sự cố nhiều người, snapshot trước/sau, tính lại công/OT không sửa lượt quẹt gốc |
| Loại nghỉ & quỹ phép | Danh mục/chính sách hiệu lực; KT tính/chuyển/ứng/điều chỉnh; TT lập/gửi/duyệt một cấp; USE/REFUND bất biến, lịch lễ và ký hiệu nghỉ trên công, truy vết nguồn và chạy lại không mất hiệu lực |
| Xác nhận công tổ | Rà soát công/OT/nghỉ/giải trình, AD xác nhận đủ nguồn bằng file/chứng từ và khoảng bao phủ; TT xác nhận theo hash nguồn, lịch sử bất biến và phát hiện nguồn đổi |
| Chốt công phân xưởng | QĐ rà soát toàn bộ tổ và đối soát chéo, chốt/trả có lý do; bản lưu bất biến, bảo vệ nguồn, tự CLOSED khi mọi xưởng hợp lệ, không tự LOCKED |
| Khóa nguồn công | KT rà soát toàn kỳ, trả có lý do hoặc khóa không đảo ngược; lưu công/OT/nghỉ/giải trình và căn cứ, hash/lịch sử bất biến; đọc snapshot, không tính lại sau khóa |
 | Cấu phần lương | KT quản lý theo công ty/cơ sở, phân loại BH/thuế/OT/theo công độc lập, phiên bản hiệu lực, căn cứ/quyết định, lịch sử bất biến và chống ghi đè |
| Đơn giá & công thức | KT khai báo giá tháng/ngày/giờ/sản phẩm/khoán/hoa hồng/P1–P3 và công thức Decimal, phiên bản hiệu lực, đồ thị không vòng, chạy thử có vết; chưa tính bảng lương |
| Kết nối hệ thống | Health endpoint kiểm tra truy vấn PostgreSQL thật và trạng thái kết nối trên giao diện |

**Chưa triển khai:** tiền OT, chế độ BHXH và thanh toán phép khi nghỉ việc, engine tính lương/BH/thuế, phúc lợi, quyết toán, báo cáo lương và trợ lý AI. Lịch lễ demo 2026 mang nhãn SIMULATION, cơ sở phải xác nhận lịch chính thức và ngày nghỉ bù; không xem là căn cứ pháp lý đã được duyệt. Nguồn công đã khóa chưa phải bảng lương hoặc kết quả thanh toán.

### Nguyên tắc xử lý chấm công

- Ghép công thường với **lịch APPROVED**; ghép OT theo khoảng **APPROVED**. Cặp IN–OUT chưa duyệt chỉ ghi nhận hiện diện ngoài duyệt, không cấp giờ đủ điều kiện. Không tự suy ra giờ ra khi thiếu lượt.
- Ca `22:00–06:00` thuộc ngày bắt đầu, dù dữ liệu ra nằm ở ngày kế tiếp.
- Lượt quẹt gốc bất biến; log trùng/bị loại vẫn có thể truy vết, không bị xóa để làm sạch kết quả.
- Tệp sai một dòng bị **từ chối toàn lô**; không âm thầm lưu phần hợp lệ.
- Chỉ kỳ **OPEN** được ghi kết quả công. Log chờ hoặc đến sau chốt được giữ kèm trạng thái/lý do; không sửa kết quả của kỳ CLOSED/LOCKED.
- Giờ đủ điều kiện OT là giao giữa thực tế ngoài ca và khoảng đã duyệt, không phải tiền OT; giờ ngoài ca/chưa duyệt không tự được trả. Cờ muộn/sớm không tự phát sinh khấu trừ lương.
- Điều chỉnh đã duyệt thay khoảng giờ hiện diện hiệu lực; không tạo lượt quẹt giả. Giải trình không tự miễn muộn/sớm quá ngưỡng chính sách; không tạo quyền OT hoặc tiền OT.

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
| Số thập phân | Decimal.js; bộ tính công thức khai báo và mô phỏng có vết, chưa có engine bảng lương |
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
| `tt.bn` | Tổ trưởng | Tổ SMT-1 Bắc Ninh; đọc nhân sự/công, lập/sửa/gửi lịch và đề nghị OT |
| `qd.bn` | Quản đốc | Phân xưởng SMT Bắc Ninh; đọc công, duyệt/trả lại lịch và OT, chốt/trả lại công xưởng khi kỳ đang mở |
| `kt.bn` | Kế toán cơ sở | Nhân sự, hợp đồng, điều chuyển và đọc công tại Bắc Ninh |
| `kt.all` | Kế toán công ty | Phạm vi toàn công ty, có áp dụng danh sách loại trừ |
| `ad.demo` | Admin | Tài khoản, tổ chức, thiết lập, kỳ công, danh mục ca; nhập/xử lý và xem công, không đọc hồ sơ nhân sự/lương |

**Mật khẩu được sinh ngẫu nhiên**, lưu tại `.local/demo-accounts.json` trên máy đã seed. Không có mật khẩu mặc định công khai; không đưa tệp này vào commit hoặc chia sẻ.

### Quản trị tài khoản

Admin có quyền **Tài khoản → Tạo tài khoản**: nhập thông tin, mật khẩu tạm, vai trò
+ đơn vị/ngày hiệu lực, loại trừ nếu cần và lý do. Không có tự đăng ký; không hardcode
username Admin. Người dùng mới/reset phải đổi mật khẩu trước khi làm nghiệp vụ; sau
đổi phải đăng nhập lại. Sửa quyền, khóa/mở khóa, reset đều thu hồi phiên hiện có.
Người dùng bình thường đổi mật khẩu qua menu tên người dùng. Admin không tự sửa quyền
hoặc khóa mình; bản sửa cũ bị chặn bằng revision. Xem [quy tắc và API §7.14](docs/20-tech-stack-va-moi-truong-phat-trien.md#714-admin-tài-khoản-và-phân-quyền).

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

### Thử luồng đăng ký và duyệt OT

1. Đăng nhập `tt.bn` → **Tăng ca (OT)** → **Lập đề nghị OT**.
2. Chọn tổ, ngày, khoảng bắt đầu/kết thúc **giờ Việt Nam**, nhân sự và mã tham chiếu chứng từ đồng ý của từng người; lưu nháp rồi gửi duyệt trước giờ bắt đầu.
3. Đăng nhập `qd.bn` → mở chi tiết → kiểm tra hạn mức → duyệt; hoặc trả lại/từ chối có lý do. Đề nghị trả lại cho phép TT sửa rồi gửi lại.
4. Xem **Lịch sử** và **Xem bản ghi** để đối chiếu snapshot từng lần; reload vẫn giữ dữ liệu. KT chỉ xem trong phạm vi, AD không có quyền OT.

Mẫu đã chạy trên UI: BN00004, ngày `2026-10-25`, `17:00–20:00`, Tổ SMT-1; trạng thái **Đã duyệt**. Khi thử đề nghị mới, chọn khoảng tương lai không trùng lịch/OT hiện có. Đây là giờ **đăng ký**; phần đối chiếu thực tế nằm ở Chấm công, không tính tiền OT. Chi tiết [20 §7.12](docs/20-tech-stack-va-moi-truong-phat-trien.md#712-đăng-ký-và-duyệt-ot).

### Thử đối chiếu OT thực tế

AD nhập quẹt hoặc xử lý lại log → **Chấm công → OT thực tế**. Chọn kỳ/đơn vị, tìm nhân viên hoặc chỉ ngoại lệ; **Chi tiết** hiển thị đăng ký, phân đoạn ngày lịch/ngày–đêm, cặp ghép, lô/dòng gốc và quy tắc. TT/QĐ/KT chỉ đọc trong phạm vi. Kết quả lưu PostgreSQL; đổi lịch/đăng ký cần AD xử lý lại, không tính lại khi GET.

Ví dụ UI đã nhập cho BN00004: `25/10/2026 17:00–19:50`, so với duyệt `17:00–20:00` → **180 phút đề nghị/duyệt, 170 phút thực tế/đủ điều kiện, thiếu 10 phút**. Thiếu quẹt không tự bù giờ ra; chưa duyệt thì đủ điều kiện bằng 0. Ca qua ngày giữ ngày công nhưng tách ngày lịch; kỳ đóng/khóa không bị ghi đè. Đây vẫn là dữ liệu mô phỏng, **không phải tiền OT**. Xem [20 §7.13](docs/20-tech-stack-va-moi-truong-phat-trien.md#713-đối-chiếu-ot-thực-tế).

<a id="api"></a>
## API

Prefix chung: `/api`. Ngoại trừ đăng nhập và health, các endpoint bên dưới yêu cầu phiên hợp lệ; quyền và phạm vi tiếp tục được kiểm tra tại backend.

| Phương thức | Endpoint | Mục đích |
|---|---|---|
| `GET` | `/api/health` | Kiểm tra truy vấn PostgreSQL; HTTP 200 khi kết nối được, 503 khi database lỗi |
| `POST` | `/api/auth/login` | Đăng nhập bằng `username`, `password`; thiết lập cookie phiên |
| `GET` | `/api/auth/me` | Thông tin người dùng hiện tại |
| `POST` | `/api/auth/logout` | Kết thúc phiên |
| GET/POST | /api/auth/accounts | Danh sách / tạo tài khoản nội bộ theo quyền quản trị |
| GET | /api/auth/accounts/context | Cây phạm vi, vai trò, danh tính tối thiểu và chính sách mật khẩu |
| POST | /api/auth/accounts/:id/update, status, password, revoke | Sửa quyền/loại trừ, khóa/mở khóa, reset mật khẩu và thu hồi phiên |
| GET/POST | /api/auth/password-policy, /api/auth/change-password | Đọc chính sách / đổi mật khẩu cá nhân; đổi xong kết thúc mọi phiên |
| `GET` | `/api/attendance/context` | Cơ sở, đơn vị, kỳ và cấu hình được phép |
| `POST` | `/api/attendance/profiles` | Lưu cấu hình cột mới |
| `POST` | `/api/attendance/imports` | Nhập tệp multipart: `file`, `siteId`, `referencePeriodId`, `profileId` tùy chọn |
| `POST` | `/api/attendance/process` | Xử lý lại log chờ theo cơ sở/kỳ tham chiếu |
| `GET` | `/api/attendance/board` | Bảng công, bộ lọc và tổng hợp trong phạm vi |
| `GET` | `/api/attendance/days/:id` | Chi tiết ngày công và các lượt ghép |
| `GET` | `/api/attendance/overtime-actuals`, `/api/attendance/overtime-actuals/:id` | Danh sách/tổng OT theo bộ lọc và chi tiết nguồn đối chiếu |
| `GET` | `/api/attendance/imports` | Lịch sử nhập theo cơ sở |
| `GET` | `/api/attendance/imports/:id` | Chi tiết lô nhập |
| `GET` | `/api/attendance/punches` | Lượt quẹt gốc và trạng thái xử lý |
| `GET` | `/api/overtime/context`, `/api/overtime/members` | Phạm vi OT và nhân sự theo tổ/ngày |
| `GET` | `/api/overtime/requests`, `/api/overtime/requests/:id` | Lọc đề nghị; chi tiết, hạn mức và lịch sử |
| `POST` | `/api/overtime/requests`, `/api/overtime/requests/:id/update` | Tạo/sửa nháp |
| `POST` | `/api/overtime/requests/:id/submit`, `approve`, `return`, `reject`, `cancel` | Chuyển trạng thái kèm revision, lý do theo thao tác |
| `GET` | `/api/attendance/corrections`, `/targets`, `/:id` | Lọc giải trình, chọn ngày công trong phạm vi, xem bằng chứng/snapshot/lịch sử |
| `POST` | `/api/attendance/corrections`, `/:id/update`, `/:id/submit`, `/:id/approve`, `/:id/return`, `/:id/reject` | Lập/sửa/gửi và quyết định theo revision |
| `POST` / `GET` | `/api/attendance/corrections/:id/evidence`, `/:id/evidence/:evidenceId` | Đính kèm / tải bằng chứng có kiểm tra quyền |
| `GET` | `/api/leave/context`, `/api/leave/types`, `/api/leave/policies` | Ngữ cảnh, danh mục và lịch sử chính sách nghỉ |
| `POST` | `/api/leave/types`, `/api/leave/policies`, `/:id/versions` dưới từng nhóm | Tạo danh mục/chính sách và phiên bản kế tiếp theo quyền AD |
| `GET` | `/api/leave/employees`, `/api/leave/balances`, `/api/leave/balances/:employeeId/:year` | Chọn nhân sự, quỹ theo năm/ngày xem và sổ phát sinh trong phạm vi |
| `POST` | `/api/leave/balances/:employeeId/:year/recalculate`, `/adjust`, `/carry`, `/advance` | KT tính lại, điều chỉnh, chuyển và ứng; revision hai năm và requestId chống trùng |
| `GET` | `/api/leave/requests`, `/api/leave/requests/:id` | Danh sách, chi tiết và lịch sử đơn trong phạm vi hiện tại/từng ngày nghỉ |
| `POST` | `/api/leave/requests/preview`, `/api/leave/requests` | Kiểm tra đơn mới / lưu nháp; TT có quyền leave.request |
| `POST` | `/api/leave/requests/:id/update`, `/api/leave/requests/:id/submit` | Sửa nháp/đơn trả lại và gửi với revision; kiểm tra lại lịch, loại nghỉ, chứng từ, quỹ và kỳ chốt/khóa |
| `POST` | `/api/leave/requests/:id/approve`, `/:id/return`, `/:id/reject`, `/:id/cancel` dưới cùng nhóm | TT duyệt một cấp; revision/scope/chống tự xử lý; duyệt và hủy đã duyệt ghi USE/REFUND cùng cập nhật công nguyên tử |
| `GET` | `/api/attendance/workshop-closures/workshops`, `/review` | Xưởng thuộc kỳ/phạm vi; tổng hợp tổ, điều kiện chốt, cảnh báo và lịch sử bất biến |
| `POST` | `/api/attendance/workshop-closures`, `/api/attendance/workshop-closures/return` | QĐ chốt theo revision/hash hoặc trả lại có lý do khi kỳ OPEN |
| `GET` | `/api/attendance/period-locks/review?periodId=…` | KT rà soát toàn kỳ hoặc đọc nguồn/sự kiện đã khóa, kiểm tra lại quyền toàn bộ nguồn |
| `POST` | `/api/attendance/period-locks`, `/api/attendance/period-locks/return` | KT khóa bất biến hoặc trả kỳ trước khóa theo revision/hash; không có unlock |
 | `GET` | `/api/salary-components/context`, `/api/salary-components`, `/api/salary-components/:id` | Phạm vi KT, lọc đơn vị/ngày/tên/mã, phân loại hiệu lực và lịch sử |
 | `POST` | `/api/salary-components`, `/api/salary-components/:id/versions` | Tạo cấu phần hoặc phiên bản tương lai theo revision; không sửa/xóa bản cũ |
| `GET` | `/api/payroll-configuration/context`, `/api/payroll-configuration`, `/api/payroll-configuration/:id` | Phạm vi KT, lọc/ngày hiệu lực và lịch sử đơn giá/công thức |
| `POST` | `/api/payroll-configuration`, `/api/payroll-configuration/:id/versions` | Tạo cấu hình hoặc phiên bản tương lai theo revision, kiểm tra đồ thị và nguồn theo ngày |
| `GET`, `POST` | `/api/payroll-configuration/preview-context`, `/api/payroll-configuration/preview` | Dữ liệu mẫu bắt buộc, chạy thử Decimal theo đơn vị/ngày, thứ tự topo và vết phiên bản; không ghi bảng lương |

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
npm run verify:overtime
npm run verify:overtime-actual
npm run verify:accounts
npm run verify:corrections
npm run verify:leave
npm run verify:team-confirmation
npm run verify:workshop-closure
npm run verify:period-lock
 npm run verify:salary-components
npm run verify:payroll-configuration
```

Các lệnh tích hợp tự tạo database local cách ly, migrate/seed, khởi chạy HTTP server thật và dọn database đã tạo. Tài khoản kết nối cần quyền tạo/xóa database; không trỏ bộ kiểm chứng vào môi trường vận hành. Chạy lần lượt, không chạy đồng thời với compiler dev/watch.

| Bộ kiểm chứng | Phạm vi | Mốc kết quả đã ghi nhận |
|---|---|---|
| `verify:foundation` | Phiên, phân quyền, nhân sự và tính bền vững của dữ liệu nền | 13/13 |
| `verify:hr` | Hợp đồng, điều chuyển, tham số/chính sách và kỳ công | 16/16 |
| `verify:shifts` | Danh mục ca, lập/gửi/duyệt lịch và ràng buộc liên phân hệ | 14/14 |
| `verify:attendance` | Parser, engine, nhập trùng, log bất biến, ca đêm và phân quyền | 21/21 |
| `verify:overtime` | Chứng từ, quyền, vòng đời, cạnh tranh duyệt, trùng giờ, trần 200/300 giờ, qua năm và khóa kỳ | 7/7 |
| `verify:overtime-actual` | Giao giờ duyệt/thực tế, ca đêm, thiếu/chưa duyệt, không dùng trùng quẹt, qua năm, phạm vi và khóa kỳ nguồn | 20/20 |
| verify:accounts | Tạo/sửa, phạm vi/hiệu lực, phiên bản cũ, mật khẩu tạm/hết hạn/lịch sử, khóa/mở khóa/thu hồi và audit không chứa bí mật | 11/11 |
| `verify:corrections` | Quyền/phạm vi/loại trừ, bằng chứng, khóa kỳ/ca đêm, bulk nguyên tử, trả lại/từ chối, duyệt cạnh tranh, nguồn đổi, công/OT và log gốc | 7/7 |
| `verify:leave` | Danh mục/chính sách có hiệu lực, quyền theo khoảng, tính quỹ/0 tháng/thâm niên, idempotency/revision, chuyển/hết hạn/ứng phép, ledger và seed bất biến | 20/20 |
| `verify:leave-requests` | Vòng đời/quyền/ca đêm; USE/REFUND theo nguồn/hạn; 5 ngày có 1 lễ chỉ trừ 4; nửa ca và quẹt chiều; chạy lại; chờ kỳ mở; hủy riêng một nguồn; tranh số dư và kỳ chốt | 19/19 |
| `verify:team-confirmation` | Đủ nguồn AD, ca đêm, quyền TT, cảnh báo, snapshot bất biến, cạnh tranh, loại trừ/ngày nguồn, nguồn đổi và kỳ đóng/khóa | 8/8 |
| `verify:workshop-closure` | Tổng hợp nhiều tổ, trần OT năm/ngày hiệu lực, quyền/phạm vi/loại trừ, cạnh tranh, bất biến, chặn ghi, trả lại, raw muộn và tự chốt kỳ | 6/6 |
| `verify:period-lock` | Quyền KT/phạm vi/loại trừ, CLOSED→OPEN, thứ tự kỳ, hash nguồn đầy đủ, cạnh tranh, bất biến SQL/HTTP, nguồn đổi/raw muộn và giữ xưởng không đổi | 7/7 |
 | `verify:salary-components` | Quyền KT/phạm vi/ngày hiệu lực, phân loại độc lập, bất biến SQL/HTTP, mã trùng, ngày sai, tranh phiên bản và audit nguyên tử | 9/9 |
| `verify:payroll-configuration` | Giá/công thức, quyền, lịch sử/revision, đồ thị theo hiệu lực, kế thừa cơ sở, đơn vị/biên, dữ liệu thiếu/0, lazy IF và độ chính xác NONE | 20/20 |

Hồi quy toàn backend sau Task 2.2 đạt **204/204**, chạy `node --test --test-concurrency=1 backend/test/*.test.cjs` sau build. Typecheck hai workspace và build backend/frontend đạt. Build frontend còn cảnh báo chunk UI lớn hơn 500 kB, không chặn build.

Browser đã chạy AD tạo loại nghỉ/chính sách và phiên bản kế tiếp; KT tính quỹ, điều chỉnh, ứng trước và xem ledger. Drawer desktop/390px không tràn trang; cuộn bảng bằng bàn phím hoạt động, axe không phát hiện lỗi tự động trên các drawer đã kiểm tra (vẫn có mục cần đánh giá thủ công). Đây là kết quả local, **không phải CI hoặc chứng nhận UAT toàn R1**. Xem [20 §7.16](docs/20-tech-stack-va-moi-truong-phat-trien.md#716-loại-nghỉ-chính-sách-và-quỹ-phép-năm).

**Đơn nghỉ:** vào `#/leave` → **Đơn nghỉ**, đăng nhập `tt.bn` → lập/lưu nháp → gửi → duyệt một cấp, trả lại, từ chối hoặc hủy. Duyệt ghi USE khi loại nghỉ trừ quỹ, ngày lễ L không trừ phép năm; hủy đã duyệt hoàn đúng nguồn/hạn và tính lại công. Drawer hiện số bút toán, ngày công và trạng thái chờ kỳ mở/xử lý; bảng công có ký hiệu, thời lượng và nguồn đơn/phiên bản/lịch lễ. Browser đã chạy BN00004 ca đêm 18/10, 120 phút/0,25 ngày, duyệt → xem quỹ/công → hủy; giữ 480 phút làm thực tế, báo trùng giờ làm/nghỉ rồi gỡ riêng ảnh hưởng đơn. Desktop/390px có 0 lỗi axe tự động trên drawer đã kiểm tra, còn mục cần đánh giá thủ công. Xem [20 §7.19](docs/20-tech-stack-va-moi-truong-phat-trien.md#719-tích-hợp-đơn-nghỉ-với-quỹ-và-bảng-công).

**Xác nhận công tổ:** vào `#/attendance` → chọn địa điểm/kỳ → **Xác nhận tổ** → chọn tổ. AD đối chiếu cửa sổ thu log, lô tệp/chứng từ và ghi **Xác nhận đủ nguồn**; TT rà soát công, OT, nghỉ, giải trình và cảnh báo rồi xác nhận theo hash hiện hành. Lưu người, thời điểm, revision và snapshot bất biến; nguồn đổi chuyển **Đã lỗi thời**, giữ lịch sử và yêu cầu rà soát lại. QĐ chỉ đọc trên màn hình xác nhận tổ; quyết định chốt thuộc màn hình riêng bên dưới. Xem [20 §7.20](docs/20-tech-stack-va-moi-truong-phat-trien.md#720-xác-nhận-công-tổ).

**QĐ chốt công phân xưởng:** vào `#/attendance` → chọn địa điểm/kỳ → **Chốt phân xưởng**. Rà soát toàn bộ tổ, công/OT/nghỉ/giải trình/cảnh báo; chỉ QĐ đủ quyền/phạm vi được chốt hoặc trả lại xưởng có lý do. Giữ bản lưu và bảo vệ nguồn; mọi xưởng hợp lệ thì tự chuyển kỳ Đã chốt, không tự khóa. Xem [20 §7.22](docs/20-tech-stack-va-moi-truong-phat-trien.md#722-chốt-công-phân-xưởng).

**KT khóa nguồn công:** vào `#/attendance` → chọn địa điểm/kỳ → **Khóa kỳ công**. KT có `attendance.lock` được trả kỳ Đã chốt về Mở với lý do, hoặc rà soát và khóa nguồn toàn kỳ không đảo ngược. Giữ chốt xưởng cũ khi trả; nguồn đổi cần TT xác nhận và QĐ chốt lại. Bản khóa lưu công từng người/ngày, OT/nghỉ/giải trình/căn cứ, hash và lịch sử; raw muộn không đổi snapshot. Xem nguồn/bản lưu chỉ đọc, không có mở khóa. Xem [20 §7.23](docs/20-tech-stack-va-moi-truong-phat-trien.md#723-kế-toán-trả-kỳ-trước-khóa-và-lưu-nguồn-công-bất-biến).
 
 **Cấu phần lương:** đăng nhập KT → `#/salary-components` → **Tạo cấu phần**. Chọn công ty/cơ sở, loại khoản và các phân loại BH, thuế, căn cứ OT, theo công; ghi căn cứ, quyết định/chứng từ, lý do và hiệu lực. **Phiên bản kế tiếp** chỉ từ ngày mai trở đi; không sửa phân loại đã lưu, bản trước chỉ đóng khoảng hiệu lực nếu có bản kế tiếp. Lọc **Ngày xem hiệu lực**, mở **Lịch sử** để đối chiếu. KT chỉ có quyền đọc không thấy nút ghi; xung đột 409 giữ biểu mẫu và yêu cầu tải lại. Browser đã chạy tạo/phiên bản/lịch sử/xung đột và cuộn ngang bằng bàn phím ở 390px; không phát sinh khoản tiền bảng lương. Xem [20 §7.24](docs/20-tech-stack-va-moi-truong-phat-trien.md#724-danh-mục-cấu-phần-lương-và-phiên-bản-hiệu-lực).

**Đơn giá & công thức:** KT → `#/payroll-configuration` → tạo đơn giá hoặc công thức gắn cấu phần. Khai báo biến/nguồn/đơn vị và làm tròn; chọn đơn vị đích, ngày, công thức rồi nhập dữ liệu mẫu để **Chạy mô phỏng**. Vết hiển thị nguồn/phiên bản, biểu thức, giá trị thô và kết quả; không ghi lương. Lịch sử/phiên bản tương lai và giữ biểu mẫu khi 409 giống cấu phần. Xem [20 §7.25](docs/20-tech-stack-va-moi-truong-phat-trien.md#725-đơn-giá-công-thức-và-chạy-thử-theo-phiên-bản-task-22).

**Giao diện nghiệp vụ:** xác nhận tổ hiển thị việc cần xử lý, người phụ trách, nhân viên/ngày công và liên kết tra cứu; UUID, hash, mã lỗi và dữ liệu gốc nằm trong mục **Chi tiết kỹ thuật** mặc định đóng. Chi tiết ngày công/lượt quẹt hiện tên tệp và dòng nguồn; OT có bảng quy tắc và liên kết công/lượt quẹt/giải trình. Quỹ phép có bảng cách tính theo tháng và tên nghiệp vụ sổ quỹ. Thiết lập dùng tên tham số, tên cơ sở/vùng và trường số/ngày/văn bản/danh sách ngày nghỉ; JSON chỉ thuộc thiết lập nâng cao. Kỳ công dùng Đang mở/Chưa mở/Đã chốt/Đã khóa; lịch sử OT dùng Bản lưu lịch sử/Phiên bản. Lỗi lưu hiện ngay trong biểu mẫu bằng tiếng Việt, giữ thông điệp gốc trong phần kỹ thuật. Xem [20 §7.21](docs/20-tech-stack-va-moi-truong-phat-trien.md#721-chuẩn-hóa-giao-diện-nghiệp-vụ).

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
| AUTH_* | Thời hạn phiên, giới hạn sai mật khẩu và thời gian khóa; AUTH_PASSWORD_* cấu hình độ dài, độ phức tạp, lịch sử và hạn đổi (mặc định 12 ký tự/5 mật khẩu/90 ngày) |
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
