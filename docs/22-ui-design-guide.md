# 22. UI design guide — HRTP

Mã **HRTP-UI-01**, dùng phong cách **Teal Enterprise** và bộ **Ant Design Outlined**
đã chốt: sidebar xanh đen, hành động teal, nền pastel theo phân hệ và bảng dữ liệu trắng.
Token được quản lý tập trung; React + Ant Design giữ nguyên kết nối và nghiệp vụ. Đã có đăng nhập, nhân sự, hợp đồng/
phụ lục và lịch sử điều chuyển; tham số/chính sách hiệu lực, tạo/mở kỳ công; danh mục ca,
phân ca theo tổ/người/ngày, TT gửi và QĐ duyệt/trả lại, lịch chính thức và snapshot; tổ chức,
tài khoản/thu hồi phiên và health nối API thật; nhập tệp/ghép quẹt, bảng công/ngoại lệ và truy vết nguồn; đăng ký/gửi/duyệt/trả lại/từ chối OT, hạn mức và snapshot; đối chiếu OT thực tế/đủ điều kiện và bằng chứng quẹt. Chưa tính tiền OT hoặc nghiệm thu toàn bộ UI/R1.
Ngày mặc định của màn hình nghiệp vụ mới dùng múi giờ Asia/Ho_Chi_Minh. Tab hợp đồng
chỉ dành cho KT; AD chỉ quản lý cấu hình/kỳ và không được đọc lương nhân sự.
Màn **Nghỉ & quỹ phép** có danh mục/chính sách theo hiệu lực và lịch sử cho các vai trò;
AD chỉ cấu hình trong quyền, không xem quỹ cá nhân. KT tính/điều chỉnh/chuyển/ứng quỹ;
TT/QĐ chỉ xem quỹ trong phạm vi. Tháng đủ điều kiện phải được chọn và xác nhận rõ ràng,
kể cả 0 tháng; không tự suy ra từ lượt quẹt. Ledger hiển thị số ngày có dấu,
người thao tác, tham chiếu/lý do, hạn dùng và đối soát. Tab Đơn nghỉ cho TT lập/sửa/gửi
và duyệt một cấp, trả lại/từ chối/hủy có lý do; trạng thái bằng chữ và màu, lịch sử
ghi người/thời điểm/phiên bản/lý do. Đơn trả lại được sửa/gửi lại; từ chối/đã hủy
không còn thao tác. QĐ/KT chỉ xem theo phạm vi. Modal quyết định và drawer chi tiết
phải thể hiện tác động quỹ/công: số USE/REFUND, ngày công và trạng thái chờ kỳ mở
hoặc xử lý; không gắn nhãn đã cập nhật khi chưa có nguồn công. Ngày lễ dùng L,
không trừ phép năm. Bảng công/drawer phân biệt phút nghỉ, công hưởng từ nghỉ và
phút làm thực tế, truy vết mã đơn/revision/loại nghỉ/lịch lễ; báo trùng giờ làm/nghỉ.
Vùng nguồn nghỉ có thể focus/cuộn bằng bàn phím; heading theo thứ bậc. Sổ quỹ dùng
đúng ngày chốt đang chọn. Hợp đồng local tại [20 §7.19](20-tech-stack-va-moi-truong-phat-trien.md#719-tích-hợp-đơn-nghỉ-với-quỹ-và-bảng-công).

Áp dụng cho stack [20](20-tech-stack-va-moi-truong-phat-trien.md), roadmap
[21](21-roadmap-trien-khai-5-ngay.md) và phạm vi [19](19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md).
Quyền/nghiệp vụ theo 07/10/17/18 được ưu tiên nếu có mâu thuẫn. Token máy đọc được tại
[hrtp-ui-tokens.json](config/hrtp-ui-tokens.json); đây là nguồn chuẩn cho giá trị theme,
spacing, kích thước và các cặp màu trong guide.

## 1. Nguyên tắc hình ảnh

**Phạm vi giao diện:** một website chạy trên trình duyệt, ưu tiên máy tính và tương
thích trình duyệt trên máy tính bảng tại xưởng. Các từ desktop/tablet/mobile trong
breakpoint chỉ kích thước viewport, không phải các ứng dụng riêng. Không thiết kế
native app, hybrid app, màn hình cài PWA hoặc chế độ offline trong phạm vi này.

- Giữ teal cho hành động chính; dùng mint, sky, vàng cát, hồng phấn và lavender
  cho tiêu đề, bộ lọc, tab và ngữ cảnh từng nhóm. Canvas cùng họ màu nhưng nhạt hơn.
  Bảng và ô nhập vẫn trắng; màu nền nhóm không biểu thị trạng thái nghiệp vụ.
- Sidebar và tiêu đề dùng sóng, mây và mặt trời vector tĩnh từ `HorizonArt`,
  màu từ token, `aria-hidden` và `pointer-events: none`; không đi vào bảng/form,
  không tạo tab stop.
- Riêng tiêu đề chính Chấm công và Bảng lương dùng `BusinessIllustration` thay
  `HorizonArt`, không chồng hai lớp hình: lịch/đồng hồ/thẻ nhân viên (sky–mint) và
  phiếu lương/máy tính/ký hiệu ₫ (vàng cát–mint). SVG tĩnh dùng token hiện có,
  `aria-hidden`, không focus/nhận pointer và không tải tài nguyên ngoài.
  Hình nằm trong khoảng trống bên phải, không tăng chiều cao tiêu đề. Dưới 1200px
  ẩn hình tiêu đề và hình nhỏ ở nhãn chỉ số; số liệu giữ nguyên diện tích.
  Chỉ tái sử dụng hình ở empty đã có kết quả API hoặc nhãn “Công ghi nhận”/
  “Thực lĩnh”, không làm watermark sau số tiền, bảng hay ô nhập.
- Riêng trang đăng nhập dùng `frontend/public/login-background.webp`, minh họa
  tĩnh theo ảnh mẫu người dùng: lịch/đồng hồ bên trái, bảng lương/biểu đồ bên phải,
  trời xanh nhạt và sóng mint. Ảnh nền đã loại bỏ form và thông tin đăng nhập trong
  mẫu; form thật cùng luồng xác thực không đổi. `.login-page-illustrated` căn giữa,
  phủ viewport bằng `cover`; màn hẹp cắt bớt hai bên để ưu tiên form, không cuộn ngang.
  Màn bắt buộc đổi mật khẩu không dùng minh họa này.
  Trên màn hình hẹp chỉ giữ nét sóng/mây nhẹ ở tiêu đề, tránh mảng màu cắt ngang chữ.
  Không gradient, blur/glassmorphism, phát sáng, parallax hoặc animation liên tục.
- Trang nghiệp vụ dành phần lớn diện tích cho bảng và thao tác. Bento phục vụ tổng
  quan; không chuyển từng dòng nhân viên/lương thành card riêng ở desktop.
- Một tiêu đề trang và một hành động chính tại mỗi vùng làm việc. Không lặp cùng bộ
  KPI lớn trên mọi trang; không thêm biểu đồ khi danh sách việc cần xử lý hữu ích hơn.
- Nhãn rõ: “Khóa kỳ công”, “Duyệt lịch ca”, “Xuất file chi lương”; không chỉ ghi “OK”.
- Không thêm chức năng ngoài R1 để lấp đầy bố cục; số liệu, ảnh và biểu đồ demo phải có nhãn.

## 2. Token và typography

| Nhóm | Quy định |
|---|---|
| Font | Be Vietnam Pro, fallback Segoe UI/sans-serif; khi triển khai tự lưu font có giấy phép phù hợp, không phụ thuộc tải mạng ngoài |
| Cỡ chữ | Tiêu đề trang 28px; nhóm 18px; nội dung/bảng 14px; chú thích 12px. Không thu nhỏ chữ theo ảnh tham chiếu để nhét thêm dữ liệu |
| Độ đậm | Nội dung 400; nhãn 500; tiêu đề/tổng số 600; line-height nội dung khoảng 1,5 |
| Tiền và số | Căn phải, chữ số có độ rộng đồng nhất bằng `font-variant-numeric: tabular-nums`; ID vẫn là chuỗi, không định dạng thành số tiền |
| Khoảng cách | Theo thang 4/8/12/16/24/32/48px trong JSON |
| Bo góc | Điều khiển 8px; bề mặt 12px; avatar 10px. Không dùng bo góc lớn cho mọi khối |
| Bề mặt | Viền phân chia nhẹ; bóng chỉ cần cho phần nổi như menu/modal/drawer |
| Màu | Token JSON quản lý màu primary/text/nền/trạng thái và `modules`; không thêm mã màu riêng vào component |

Nền bề mặt trắng `#FFFFFF`, canvas `#F3F8F8`, chữ `#172B35`, chữ phụ `#596B73`.
Sidebar xanh đen `#081D2B`; primary teal `#007F78`, hover `#00665F`, active `#00544E`.
Link dùng `#00665F`; thông tin vẫn xanh dương `#315A9C`, không đồng nhất với primary.
Mint `#E0F2EE` và mint đậm `#B8DED6` tạo điểm nhấn; bề mặt trung tính `#EDF2F4`.
Viền phân cách `#DCE7E7`; viền điều khiển `#7C9298`, focus teal. Không dùng divider
nhạt làm chỉ dấu duy nhất của ô nhập. Palette, cỡ icon và các cặp tương phản nằm trong JSON.

| Thành phần / nhóm | Màu chữ hoặc nhấn | Nền |
|---|---|---|
| Sidebar | `#CADBE0` | `#081D2B` |
| Menu được chọn | `#FFFFFF` | `#10545B`, chỉ dấu cạnh trái `#80D5C9`, chữ đậm |
| Nút phụ có nhấn (`action-secondary`) | `#00665F` | `#E0F2EE`; hủy/quay lại vẫn trung tính |
| Header bảng | `#40565F` | `#EDF3F4` |
| Dòng hover / được chọn | Giữ màu chữ | `#F0F9F6` / `#E0F2EE` |
| Nhân sự, tổ chức, hợp đồng | `#00665F` | Mint `#E0F2EE` |
| Kỳ công, ca, chấm công, OT | `#315A7A` | Sky `#E3EFFB` |
| Tiền lương, phúc lợi, báo cáo | `#765719` | Vàng cát `#F8EDCD` |
| Nghỉ & quỹ phép | `#8C4359` | Hồng phấn `#F8E6EA` |
| Quản trị và hệ thống | `#5E4A85` | Lavender `#ECE8F8` |

`App` gắn `data-module` cho shell và vùng nội dung; `theme.ts` xuất CSS variables
từ token JSON. Mỗi module có `text`, `background`, `canvas` và `ornament`; không
copy mã màu vào trang. Teal vẫn là nhận diện hành động chung; không tô mọi số tiền xanh lá.
Tag/Alert giữ semantic success/warning/error/info; chờ duyệt là warning, nháp và
nguồn bị thay thế là neutral. `status-locked` dùng chữ `#354B55` trên nền `#E3EBEE`.
CLOSED dùng nhãn “Đã chốt” + CheckCircleOutlined; LOCKED dùng “Đã khóa” + LockOutlined.
Không đổi icon hay trạng thái để gộp hai khái niệm này.

### 2.1. Bộ icon điều hướng đã chốt

`routeIcons` tại `frontend/src/App.tsx` là một bảng ánh xạ dùng cho sidebar, breadcrumb
và biểu tượng cạnh tiêu đề. Dùng package `@ant-design/icons` sẵn có, chỉ một họ Outlined.
Icon sidebar 20px, tiêu đề 24px trong vùng màu nhóm 44px, hành động 16px. Giữ cùng glyph khi
được chọn; không đổi sang Filled, không trộn thư viện. Nhãn chữ vẫn là thông tin chính.

| Mục | Icon |
|---|---|
| Nhân sự | TeamOutlined |
| Hợp đồng & chấm dứt | FileProtectOutlined |
| Tổ chức | ApartmentOutlined |
| Kỳ công | CalendarOutlined |
| Ca & phân ca | ScheduleOutlined |
| Chấm công | CheckSquareOutlined |
| Tăng ca (OT) | FieldTimeOutlined |
| Nghỉ & quỹ phép | CarryOutOutlined |
| Bảng lương | ReconciliationOutlined |
| Cấu phần lương | DollarCircleOutlined |
| Đơn giá & công thức | CalculatorOutlined |
| Kế hoạch trả lương | WalletOutlined |
| Đầu vào lương | FileAddOutlined |
| Phúc lợi | GiftOutlined |
| Báo cáo | BarChartOutlined |
| Tài khoản | UserOutlined |
| Thiết lập | SettingOutlined |
| Nhật ký kiểm toán | AuditOutlined |
| Hệ thống | CloudServerOutlined |

Thao tác xem dùng EyeOutlined; sửa dùng EditOutlined chỉ khi có chức năng/quyền,
thao tác khác MoreOutlined, lọc FilterOutlined, chọn cột TableOutlined nếu có chức năng,
tải lại ReloadOutlined. Hành động chính vẫn có icon + chữ; nút chỉ có icon cần tên
truy cập và tooltip. Icon trang trí có `aria-hidden`; sidebar thu gọn có nhãn tooltip.

## 3. Khung ứng dụng và responsive

Desktop: sidebar 240px, thu gọn 72px ở tablet; header tối thiểu 64px, padding nội dung
24px. Sidebar xanh đen, mục chọn teal đậm với chữ/icon sáng và chỉ dấu cạnh trái.
Menu chỉ hiện mục có quyền và cuộn riêng. Header trắng có breadcrumb, phạm vi thật,
thông báo và tài khoản; dưới 768px phạm vi chuyển xuống dải ngữ cảnh bên dưới header.
Không dựng ô tìm kiếm toàn cục, badge số hoặc cơ sở giả chỉ để giống ảnh tham chiếu.

Vùng ngữ cảnh nghiệp vụ bên dưới tiêu đề hiển thị **cơ sở/đơn vị, kỳ đang xem và trạng
thái kỳ**. Kỳ công/kỳ lương/ngày chi trả có nhãn riêng. Chuyển ngữ cảnh phải cảnh báo
nếu có thay đổi chưa lưu. Bộ chọn chỉ liệt kê phạm vi tài khoản được cấp.

| Chiều rộng | Hành vi |
|---|---|
| ≥1200px | Sidebar đầy đủ; filter cùng hàng nếu đủ chỗ; bảng sử dụng chiều rộng còn lại |
| 768–1199px | Sidebar thu gọn hoặc drawer; padding 16px; filter xuống hàng, điều khiển chính cao 44px |
| <768px | Sidebar drawer; padding 12px; biểu mẫu một cột; bảng rộng cuộn trong vùng bảng, không làm tràn toàn trang |

Kiểm tra tối thiểu 1440×900, 1280×800, 1024×768 và 768×1024; thêm 390×844 để kiểm tra
reflow cơ bản. Responsive không tạo ứng dụng di động/ESS mới. Bảng công ma trận có
cuộn ngang riêng, giữ mã/tên nhân viên; không thu nhỏ chữ để nhét cả tháng vào tablet.

Trang Nhân sự: icon + tiêu đề + hành động tạo theo quyền → một khối teal nhấn tổng
kết quả theo bộ lọc và hai chỉ số phụ nền sky/vàng cát (đơn vị/phân công thực từ ngữ cảnh tài khoản)
→ bộ lọc trạng thái nhanh → tìm kiếm/đơn vị → tag bộ lọc có nút bỏ bằng bàn phím
→ bảng và phân trang. Không lặp heading/KPI thừa, không đếm cơ cấu từ một trang API.
Chỉ có ACTIVE và TERMINATED theo contract; không thêm “Tạm nghỉ”, biểu đồ cơ cấu,
biến động theo tháng hay phần trăm tăng trưởng khi chưa có nguồn tổng hợp phù hợp.
Tên/mã cùng ô; có ngày vào làm, nút Eye + “Xem” mở drawer với các tab theo quyền.
Form tạo giữ mọi trường/validation; không thêm sửa/xóa/chọn hàng loạt từ ảnh tham chiếu.


## 4. Dashboard và điều hướng theo vai trò

Dashboard dùng lưới 12 cột desktop, 6 cột tablet, 1 cột khi hẹp. Vùng **Cần xử lý**
chiếm 8 cột, trạng thái kỳ/nguồn chiếm 4 cột; hàng phụ có tối đa bốn chỉ số cần thiết.
Không ép thành các ô vuông bằng nhau nếu nội dung cần đọc dài hơn.

| Vai trò | Nội dung ưu tiên | Giới hạn |
|---|---|---|
| TT | Ngoại lệ công của tổ, lập OT/nghỉ, trạng thái xác nhận tổ | Chỉ tổ/phạm vi được cấp; không duyệt chính yêu cầu của mình trái quy tắc |
| QĐ | Lịch ca/OT chờ duyệt, xưởng cần đối soát/chốt | Đúng phạm vi xưởng, không hiển thị tổng công ty ngoài quyền |
| KT | Kỳ cần khóa, đầu vào lương thiếu, lỗi tính lương, BH/thuế và báo cáo | Dữ liệu lương theo phạm vi được giao |
| AD | Tình trạng nhập tệp, cấu hình, tài khoản, kỳ và nhật ký theo quyền | Không hiển thị lương chi tiết hoặc KPI tổng lương để lộ dữ liệu |

Đây là cách gom nội dung hiện có, không thêm quyền hoặc quy trình duyệt. Sidebar nhóm
theo nghiệp vụ trong R1, chỉ hiện mục có quyền truy cập; URL/API vẫn cần kiểm tra backend.

## 5. Các mẫu màn hình

| Mẫu | Cấu trúc |
|---|---|
| Danh sách | Tiêu đề + mô tả ngắn → ngữ cảnh → filter → toolbar → bảng → phân trang |
| Hồ sơ chi tiết | Danh tính/trạng thái → thông tin chính → tab lịch sử/HĐ/phân công theo quyền |
| Tạo/sửa đơn | Ngữ cảnh + người liên quan → thông tin bắt buộc → kiểm tra lỗi → gửi/xác nhận |
| Tài khoản | Admin xem danh sách/trạng thái/phiên; tạo/sửa vai trò + cây phạm vi + hiệu lực và loại trừ; lý do, revision, lịch sử chỉ đọc; khóa/mở khóa/reset/thu hồi phiên. Chỉ danh tính nhân sự tối thiểu, không mở hồ sơ/lương cho AD |
| Đổi mật khẩu | Menu cá nhân cho người dùng; màn riêng không có điều hướng nghiệp vụ khi mật khẩu tạm/hết hạn; chính sách hiện hành + xác nhận, đổi xong đăng nhập lại |
| Bảng công | Kỳ/cơ sở/đơn vị/trạng thái → ngoại lệ cần xử lý → ma trận công → drawer chi tiết ca/log |
| OT thực tế | Trong Chấm công: kỳ/đơn vị/nhân viên/ngoại lệ → đề nghị/đã duyệt/thực tế/đủ điều kiện → drawer snapshot, ngày lịch/ngày–đêm, cặp ghép và nguồn lô/dòng; ghi rõ không phải giờ chi trả |
| Giải trình công | Tab trong Chấm công: kỳ/đơn vị/trạng thái → TT chọn ngày/người, lý do, tham chiếu hoặc tệp, khoảng hiệu lực; sự cố nhiều người phải có mã chung → QĐ xem trước/sau và lịch sử rồi duyệt/trả lại/từ chối. Chỉ trạng thái đã duyệt thay kết quả; luôn phân biệt quẹt gốc với giờ điều chỉnh. Drawer 390px xếp metadata và snapshot một cột, checkbox chọn người/chọn tất cả có nhãn |
| Nghỉ & quỹ phép | Loại nghỉ/chính sách: đơn vị/ngày hiệu lực → phiên bản → lịch sử; AD tạo phiên bản kế tiếp, không sửa nội dung cũ. Quỹ: năm/đơn vị/người/ngày xem → KT xác nhận tháng và điều kiện → quỹ/sổ phát sinh/snapshot. Tách phép năm, phép chuyển/hết hạn, ứng và nợ năm sau; mọi ghi có lý do/tham chiếu. Mobile xếp thanh thao tác xuống dòng; bảng cuộn riêng, focus được bằng bàn phím. |
| Bảng lương | Kỳ công nguồn/kỳ lương/ngày trả → tiến độ/cổng chặn → bảng lương → drawer giải thích |
| Duyệt | Tóm tắt người/phạm vi/khoảng thời gian → dữ liệu và thay đổi → duyệt hoặc từ chối kèm lý do theo quy trình |
| Tham số/công thức | Giá trị + khoảng hiệu lực + nguồn kế thừa → lịch sử phiên bản → chạy thử trước áp dụng |
| Báo cáo | Loại báo cáo + phạm vi + kỳ → xem kết quả → xuất tệp với trạng thái tác vụ |

Drawer dùng cho xem/giải thích mà cần giữ ngữ cảnh bảng; trang riêng cho biểu mẫu dài.
Modal chỉ dùng xác nhận ngắn hoặc tác vụ tập trung; tránh modal chứa modal.

Modal/drawer render qua portal nhận lớp `hrtp-overlay overlay-{module}` từ
`ConfigProvider` trong shell. `AntApp component={false}` cùng phạm vi giữ màu cho cả
`App.useApp().modal.confirm` mà không thêm wrapper DOM. Lớp này dùng token nhóm của
trang, không sao chép mã màu vào từng màn hình. Header, nhãn Descriptions và tiêu đề nhóm dùng
nền tint; body dùng canvas nhóm nhạt; nội dung bảng và ô nhập giữ trắng. Điều hướng
mobile vẫn nền xanh đen. Không thay đổi màu trạng thái, quyền hoặc hành động khi đổi màu.

Chi tiết ngày công: danh tính/ngày/ca/trạng thái → ba chỉ số công/làm việc/ban đêm
→ lịch và đối chiếu → nghỉ/lượt quẹt/phân đoạn/giải trình. Số liệu chỉ từ API ngày
công. Mỗi vùng có heading rõ; bảng nguồn cuộn riêng, focus được bằng bàn phím;
nguồn rỗng dùng một dòng giải thích thay vì bảng rỗng cao hàng trăm pixel.

## 6. Bảng, filter và thao tác hàng loạt

- Header rõ, sticky khi cần; cột mã/tên nhân viên cố định bên trái trên màn hình đủ rộng.
  Dưới 768px, bảng công chỉ giữ cột nhân viên cố định; các bảng khác bỏ cố định để
  không che các cột giữa. Hàng Nhân sự khoảng 52–64px, tự tăng theo nội dung;
  chế độ gọn giảm padding, không ép nhỏ chữ dưới cỡ body 14px. Tablet giữ hành động chính 44px.
  Vùng bảng nhận focus xử lý ←/→, Home/End tại shell chung để cuộn phần tử scroll
  của Ant Design; không chặn phím khi focus đang ở input hoặc nút bên trong.
- Tên/ngày/trạng thái căn trái; số tiền/số giờ/số công căn phải. Cột có đơn vị trong
  tiêu đề. Tiền VND hiển thị theo quy tắc làm tròn nghiệp vụ, không tự làm tròn lại ở UI.
- Dùng định dạng tiếng Việt: `1.250.000 ₫`, `7,5 giờ`, `25/10/2026`; thời điểm có múi
  giờ nếu cần đối soát. Lưu/phân giải thời gian theo contract, không đổi ngày công theo
  timezone máy người dùng. Chỉ phân tích/định dạng Decimal bằng công cụ không mất độ chính xác.
- Giá trị 0 khác thiếu dữ liệu: hiển thị `0` khi nguồn xác nhận bằng 0, `Chưa có dữ liệu`
  khi thiếu và `Không áp dụng` khi không thuộc trường hợp; không dùng một dấu gạch cho cả ba.
- Bộ lọc có nhãn, thao tác áp dụng/xóa và trạng thái đang áp dụng. Phân trang, sort,
  tìm kiếm dùng API khi dữ liệu lớn. Kết quả hiển thị phạm vi và tổng bản ghi.
- Khi chọn nhiều dòng, toolbar ghi số dòng/phạm vi được chọn; mặc định chỉ chọn trang
  hiện tại. Chọn toàn bộ kết quả phải là thao tác riêng có xác nhận phạm vi.
- Batch có dòng không đủ quyền/trạng thái phải báo rõ danh sách và kết quả từng dòng.
  Không tự bỏ qua lỗi rồi báo toàn bộ thành công. Quyết định atomic hay từng dòng theo API.
- Không cho sửa inline dữ liệu snapshot; cột bị che theo quyền không được gửi xuống UI.

### 6.1. Mật độ bảng công và xem thông tin theo lớp

Áp dụng hướng Data-Dense Dashboard/progressive disclosure từ `ui-ux-pro-max`;
không thay font Be Vietnam Pro, palette teal/pastel hay bộ Outlined đã duyệt bằng
font/palette khác do công cụ gợi ý.

- **Tóm tắt** mặc định: ngày công, nhân viên, đơn vị, ca, vào/ra, kết quả, ngoại lệ
  và nút Xem. Kết quả gộp công/giờ làm và ký hiệu nghỉ nếu có. Tên/mã cùng ô;
  thời điểm gọn vẫn có ngày/tháng để phân biệt ca đêm, đầy đủ giây ở chế độ Đầy đủ/drawer.
- **Đầy đủ** giữ công, nghỉ đã duyệt, giờ làm, giải trình và các thời điểm nguồn.
  Hai chế độ dùng cùng dữ liệu, bộ lọc, trang và API; không tính lại hay làm tròn công.
- Bảng có header/cột nhận diện cố định, vùng cuộn dọc giới hạn chiều cao và cuộn
  ngang riêng. Thanh công cụ giải thích chế độ, có nút trái/phải khi cần; ←/→,
  Home/End hoạt động khi vùng bảng được focus. Nút Xem mở drawer bằng bàn phím.
- Không ép toàn bộ cột vào điện thoại bằng `zoom`, scale hoặc font rất nhỏ.
  Kiểm tra cả 1568×755 theo ảnh review, 1440, 1280, 1024, 768 và 375/390px.


## 7. Biểu mẫu, nhập tệp và tác vụ nền

Form có label phía trên, required rõ, hướng dẫn đơn vị/định dạng; validate tại trường
và có tóm tắt liên kết tới lỗi khi dài. Giữ dữ liệu nhập khi API lỗi. Biểu mẫu nhạy cảm
không lưu tự động vào localStorage. Mất phiên phải ngăn lộ dữ liệu trên máy dùng chung.

Nghỉ theo giờ có bắt đầu/kết thúc; nửa ngày có buổi rõ; hiển thị số phép dự kiến và số
đã xác nhận. Hủy đơn cần phản ánh trạng thái/hoàn phép từ backend, không tự cộng ở UI.

Upload: chọn cơ sở/ngữ cảnh → xem ánh xạ/kiểm tra → kết quả lô. Hiển thị dòng lỗi,
trùng, xử lý thành công và log chờ kỳ/ngoại lệ theo contract; `ACCEPTED_WITH_EXCEPTIONS`
không bị tô thành thất bại toàn lô hoặc thành công tuyệt đối. Tệp lỗi cấu trúc không
hiển thị như đã nhập một phần. Không cho người dùng tự sửa raw log trực tiếp.

Tác vụ nền có mã lô, trạng thái, số bản ghi đã xử lý, lỗi và thao tác dừng an toàn nếu
backend hỗ trợ theo NFR. Không dựng phần trăm/tốc độ giả. Không khóa toàn ứng dụng khi
đang tính lương; tác vụ theo dõi được sau chuyển trang. Retry dùng cơ chế idempotency.

## 8. Trạng thái nghiệp vụ và hành động nhạy cảm

Màu luôn kèm chữ/icon; nhãn Việt là lớp trình bày của enum API, không tạo enum mới.

| Trạng thái | Nhãn | Cách thể hiện/hành động |
|---|---|---|
| PLANNED | Lập kế hoạch | Neutral; lập/duyệt ca theo quyền, chưa ghi kết quả chính thức |
| OPEN | Đang mở | Info; xử lý nghiệp vụ theo quyền và trạng thái xưởng |
| CLOSED | Đã chốt | Locked (trung tính đậm) + icon đã chốt; KT có thể trả lại có lý do trước khóa; không sửa trực tiếp |
| LOCKED | Đã khóa | Locked + icon khóa; chỉ đọc snapshot, điều chỉnh liên kết ở kỳ mở |
| Chờ duyệt | Chờ duyệt | Warning; có người/đơn vị chịu trách nhiệm |
| Đã duyệt | Đã duyệt | Success; vẫn phân biệt với khóa kỳ |
| Từ chối/lỗi | Từ chối hoặc Lỗi | Error; lý do và đường xử lý |
| BLOCKING | Chặn xử lý | Error; danh sách vi phạm, nguồn và liên kết sửa |
| WARNING | Cảnh báo | Warning; cơ chế xác nhận theo từng mã, không tự nâng/hạ mức |

CP-08 vẫn WARNING. “Chốt” và “Khóa” là hai hành động riêng; không có nút “Mở khóa”
cho kỳ LOCKED. Tính lương bị chặn nếu nguồn công chưa khóa. Thời điểm thu đủ log không
được giả định đã đến chỉ vì qua 00:00 ngày chốt.

Trước khóa kỳ/xuất file chi/hồi tố/thay tham số pháp lý: hiển thị đúng đối tượng,
phạm vi, kỳ, số người/số tiền được phép xem, tác động và xác thực bổ sung theo 10.
Backend xác nhận revision; nếu dữ liệu đổi trong lúc thao tác phải yêu cầu tải lại,
không tiếp tục trên số liệu cũ. Gửi yêu cầu có pending state, tránh bấm lặp.

Nghỉ quy đổi OT chưa kích hoạt: không có CTA chuyển giờ OT thành phép; nếu cần giải
thích trạng thái 5.5 thì ghi “Chưa kích hoạt trong cấu hình hiện tại”, không hiển thị
quỹ phép giả và không ảnh hưởng nghỉ bù lễ/phép năm. Cấu hình mô phỏng có nhãn ở môi
trường demo; không hiển thị thông báo như đã xác nhận chính sách doanh nghiệp.

## 9. Truy vết bảng lương

Truy vết lương dưới đây là chức năng thường, không phụ thuộc AI. AI-01 diễn giải
lương theo [23](23-ai-giai-thich-bang-luong.md) đã chuyển sang sau sprint, không tạo
nút AI-01 trong bản triển khai 5 ngày. Tính năng AI đang ưu tiên là trợ lý ở mục 9.1.

Drawer giải thích dòng lương hiển thị cấu phần, công thức phiên bản, biến đầu vào,
nguồn/version, tham số hiệu lực, các bước làm tròn và kết quả. Chỉ hiện thông tin
được phép xem. Cho mở nguồn công/đơn/đầu vào liên quan bằng liên kết có kiểm tra quyền.

Ngày công, kỳ lương, ngày chi trả và năm tính thuế có nhãn riêng. Dữ liệu ngày trả dự
kiến và thực tế phân biệt rõ. Snapshot lịch sử không đổi ngầm khi có tham số mới;
điều chỉnh có liên kết tới nguồn gốc, không nút sửa số trực tiếp trên bảng đã khóa.

### 9.1. AI-02 — Trợ lý hướng dẫn nghiệp vụ cho bốn vai trò

Theo [24](24-ai-tro-ly-nghiep-vu-theo-vai-tro.md), nút “Trợ lý AI” ở header mở drawer
bên phải cho TT/QĐ/KT/AD khi flag bật. Trên màn hình hẹp drawer chiếm chiều rộng;
focus/keyboard đúng, không che thao tác nghiệp vụ. Màu/token theo theme chung.

Hiển thị vai trò/trang đang dùng, gợi ý câu hỏi theo quyền, ô hỏi, hướng dẫn bằng bước,
nguồn/mục/phiên bản, liên kết màn hình và hạn chế. Nhãn “AI hướng dẫn từ tài liệu hệ
thống”; không ám chỉ AI đã kiểm tra dữ liệu kỳ thực tế. Không có dữ liệu người lao động
hoặc quyền mở bảng lương mới chỉ vì người dùng mở trợ lý.

Pending, thiếu nguồn, ngoài phạm vi, timeout/quota/lỗi có trạng thái rõ và hướng dẫn
tĩnh đúng quyền. Nguồn/link do backend kiểm tra; không render HTML/URL tùy ý từ model.
Đổi quyền/phiên/corpus version làm mất hiệu lực nội dung cũ tương ứng. Feature flag
tắt không chặn website. Giao diện chat không có nút thực hiện/duyệt/khóa thay người dùng.

## 10. Trạng thái UI, accessibility và chuyển động

| Trường hợp | Quy định |
|---|---|
| Loading | Skeleton/spinner đúng vùng, không hiển thị 0 giả; báo dữ liệu đang cập nhật |
| Empty | Phân biệt chưa có dữ liệu với filter không có kết quả; CTA chỉ khi có quyền |
| Error | Nguyên nhân, bản ghi, hướng xử lý, mã yêu cầu; lỗi tuân thủ có căn cứ do backend cung cấp |
| Forbidden | Thông báo không đủ quyền; không hiển thị lại dữ liệu nhạy cảm từ cache |
| Stale/conflict | Báo phiên bản thay đổi, tải lại và giữ phần nhập an toàn; không tự ghi đè |
| Session expired | Xóa/ẩn dữ liệu nhạy cảm, trở về đăng nhập; không giữ bảng lương trên màn hình |

Đặt mục tiêu kiểm tra WCAG 2.2 AA cho phần UI: chữ thường tương phản ít nhất 4,5:1;
trạng thái/focus/ranh giới điều khiển cần đủ rõ; hỗ trợ bàn phím, label, focus nhìn
thấy được, trả focus về vị trí hợp lý khi đóng modal/drawer. Dự án chọn vùng chạm
44×44px ở tablet; đây là lựa chọn UX, không gọi là ngưỡng tối thiểu WCAG AA.

Thông báo không chỉ là toast biến mất: lỗi chặn tồn tại trong vùng nội dung và có
liên kết tới trường/bản ghi. Dùng thông báo hỗ trợ trình đọc màn hình thích hợp;
không đọc lại toàn bảng sau mỗi cập nhật. Thử zoom 200% và kiểm tra focus không bị
header/footer cố định che khuất.

Token motion dùng chung: hover/focus 150ms (`fast`), xác nhận 180ms (`normal`),
drawer 220ms (`slow`). Hover chỉ đổi màu nền/viền/chữ/shadow, không scale/translate
làm xê dịch bố cục. Giữ animation mở/đóng drawer native của Ant Design; icon xác
nhận thành công chỉ fade opacity một lần sau phản hồi máy chủ, không chạy số tiền,
confetti hay chuyển động trang trí lặp. Spinner chỉ biểu thị request/job thực sự
đang chờ. Tiến độ tính lương chỉ hiện khi `progressTotal > 0`; chưa biết tổng dùng
nhãn đang xử lý, không giả 0%. RUNNING/FAILED/CANCELLED và COMPLETED có lỗi không
được dùng hiệu ứng xác nhận thành công. Empty minh họa không thay loading/error
và không xuất hiện trong lúc đang khởi chạy/tính lương.

Tôn trọng `prefers-reduced-motion`. Provider gốc theo dõi thay đổi lựa chọn này và
đặt token Ant Design `motion: false` khi cần giảm chuyển động.
CSS khi đó dùng `transition: none`, không ép thời lượng transition rất ngắn lên mọi
thuộc tính: `top`/`left` cần được đo đồng bộ để dropdown/popover không lệch khỏi màn hình.
Popover thông báo dùng vị trí có tự dịch ngang và chừa khoảng trống cho padding trên
màn hình hẹp. Không dùng parallax, animation liên tục, nền 3D hoặc hiệu ứng kéo rê
trang trí trên màn hình làm việc. Light theme là chuẩn; dark theme chưa thuộc sprint.

## 11. Hướng dẫn triển khai Ant Design và phối hợp agent

Khi khởi tạo frontend, dùng một `ConfigProvider` đọc `antd.token` từ JSON và locale
tiếng Việt tương ứng phiên bản Ant Design đã chọn. Bọc ứng dụng bằng cơ chế App/context
của thư viện để modal/message dùng chung theme. Token semantic và layout chuyển thành
CSS variables hoặc hằng số theme dùng chung; không copy màu vào từng trang.

Một đầu mối sở hữu JSON token, `frontend/src/theme.ts` và `frontend/src/styles.css`.
Ant Design và CSS variables dùng cùng nguồn; không mở thêm bảng màu ở từng phân hệ.
Mẫu dùng chung: `page-heading`, `panel`, `context-strip`, `workspace-filters`,
`table-panel`, `tab-stack`, `form-grid`, `action-secondary`. Trang chỉ thay đổi bố cục
trong TSX; khi chia song song chỉ chia nhóm trang sau khi phần chung ổn định.

Codex/Claude cung cấp contract cho quyền, state, lỗi, progress, Decimal, nguồn/hash;
không đưa logic tính lương vào component. Cache dữ liệu gồm phạm vi/quyền/kỳ; logout,
đổi tài khoản hoặc thu hồi phiên phải xóa dữ liệu tương ứng. Bảng nhiều dữ liệu cần
phân trang/virtualization có kiểm tra focus và trình đọc màn hình trên bản thực tế.

Trong roadmap 21: ngày 1 làm theme/AppShell/login/nhân sự; ngày 2 công/OT/nghỉ;
ngày 3 khóa công/lương/truy vết; ngày 4 báo cáo/đầu ra/trạng thái; ngày 5 kiểm tra
responsive, quyền và UAT trên build đã ghép.

## 12. Checklist review giao diện

- [ ] Theme dùng token chuẩn; tiếng Việt và dấu hiển thị đúng với font/fallback.
- [ ] Các viewport trong mục 3 không tràn trang; bảng cuộn riêng, cột chính còn đọc được.
- [ ] Mỗi trang có ngữ cảnh/phạm vi/kỳ đúng; không lộ lương qua dashboard/cache/tệp.
- [ ] Nhãn OPEN/CLOSED/LOCKED và hành động phù hợp API; không mở khóa snapshot.
- [ ] Tiền/giờ/công đúng đơn vị; missing khác zero; ngày trả khác ngày công.
- [ ] Loading/empty/error/forbidden/conflict/expired có thể tái hiện và xử lý.
- [ ] Bàn phím, focus, zoom, target size, tương phản và reduced motion được kiểm tra.
- [ ] NFR-49: thao tác chính ở xưởng ≤3 bước; NFR-51: duyệt ca/OT ≤2 thao tác theo quy trình.
- [ ] Xác thực bổ sung/lý do bắt buộc không bị bỏ qua bằng shortcut hoặc batch.
- [ ] Không có mock/số liệu giả trong bản nghiệm thu; bằng chứng ghi build, vai trò và viewport.
- [ ] AI-02 có gợi ý/câu trả lời/nguồn/link đúng quyền của cả TT/QĐ/KT/AD; fallback hoạt động, không có UI AI-01 trong sprint này.

Kiểm tra màu token không thay thế kiểm tra toàn bộ UI: hover, selected, disabled,
focus và màu do Ant Design sinh thêm phải kiểm tra trên frontend thực tế. Checklist
guide chưa được đánh đạt khi chưa có giao diện chạy.

### 12.1. Bằng chứng chuyển đổi Teal Enterprise

Kiểm tra trên frontend production qua Vite preview, nối backend và PostgreSQL thật
của bộ dữ liệu demo cục bộ; không thay API bằng dữ liệu trong ảnh tham chiếu.

- `npm run typecheck` và `npm run build`: đạt cho cả backend/frontend.
- Chromium: 19 route tại 1440×900, 1024×768 và 390×844; không tràn chiều ngang
  trang, icon sidebar/tiêu đề đúng bảng 19 mục. 32 tab phụ được mở bằng bàn phím
  tại 390px; không ghi nhận lỗi JavaScript trong smoke test.
- Nhân sự: 2.201 bản ghi thật; lọc trạng thái qua API, bỏ lọc bằng bàn phím,
  tìm kiếm rỗng, phân trang, validation bắt buộc và drawer hồ sơ năm tab.
- Bảng công: chọn địa điểm/kỳ qua dropdown, tải bảng 27.360 ngày công và mở chi
  tiết; bảng cuộn riêng trên màn hình hẹp, drawer không vượt chiều rộng viewport.
- Điều hướng mobile, focus rõ, cuộn bảng bằng ArrowLeft/Right/Home/End; popover
  thông báo nằm trong viewport tại cả ba kích thước với cả hai lựa chọn chuyển động.
- Loading không dựng hàng dữ liệu giả; lỗi mạng được chủ động mô phỏng, trạng thái
  rỗng được kiểm tra, phản hồi forbidden 403 được nhận từ API thật. Đăng nhập
  TT/QĐ không hiện menu bảng lương; KT và AD được dùng cho các route đúng quyền.
- 39 cặp màu chữ trong token, gồm màu nhóm và nền họa tiết, đạt tối thiểu 4,63:1;
  viền control trên trắng đạt 3,27:1. Đây không phải chứng nhận accessibility đầy đủ.

Ảnh và báo cáo smoke cục bộ nằm trong `.local/ui-redesign/`. Giới hạn: chưa kiểm
chứng bảng lương có dữ liệu vì danh sách kỳ lương hiện rỗng; không tạo kỳ hay chạy
tính lương để lấy ảnh. Build còn cảnh báo chunk lớn hơn 500 kB. Các bước trên không
thay thế UAT ghi dữ liệu, duyệt/chốt/khóa kỳ và nghiệm thu nghiệp vụ trong checklist.

### 12.2. Kiểm chứng pastel và họa tiết chân trời

Đợt bổ sung màu nhóm giữ bộ icon, API và dữ liệu hiện hành. Trên bản production,
19 route × 3 viewport tiếp tục không tràn ngang; nền tiêu đề/canvas đúng module,
bảng giữ trắng và họa tiết không nhận focus/click. Đã mở 32 tab phụ ở 390px,
thao tác nút tạo qua vùng tiêu đề trang trí, kiểm tra validation và drawer hồ sơ,
cuộn bảng bằng bàn phím, bảng công có dữ liệu thật và popover ở cả hai chế độ
chuyển động. Không ghi nhận lỗi JavaScript. Ảnh `color-*.png` và báo cáo
`color-report.json` trong `.local/ui-redesign/` ghi nhận lần kiểm tra này.

### 12.3. Kiểm chứng bảng dày và vùng chi tiết

Đã chạy `ui-ux-pro-max --design-system`, tìm thêm quy tắc bảng/accessibility và
hướng dẫn React context/portal. Chọn mật độ dữ liệu và xem thông tin theo lớp;
giữ font, palette và icon hiện hành, không áp dụng bố cục funnel/landing được gợi ý.

- Typecheck/build toàn workspace đạt; sau chỉnh chiều rộng cột thao tác và phạm vi
  holder, typecheck/build frontend cuối cùng cũng đạt. Cảnh báo chunk >500 kB còn tồn tại.
- Production với API/PostgreSQL thật: bảng công và drawer được thử ở 1568×755,
  1440×900, 1280×800, 1024×768, 768×1024, 390×844 và 375×812.
  Tóm tắt có đủ 8 cột ở desktop 1280px trở lên; Đầy đủ giữ 11 cột gồm nút Xem.
  Hai chế độ giữ nguyên danh sách bản ghi/trang; cuộn trái/phải, Home/End và cột
  nhân viên cố định được kiểm tra. Không tràn ngang toàn trang hoặc body drawer.
- Đã mở chi tiết bằng bàn phím, kiểm tra phân trang, điều hướng QĐ đúng quyền và
  19 route tại 1440/1024/390px. Header/body/nhãn bảng chi tiết nhận đủ năm màu nhóm.
  Validation tạo nhân sự còn hoạt động; hủy hộp xác nhận bỏ thay đổi vẫn giữ bản nháp.
- Hai lựa chọn chuyển động được thử trên drawer; không ghi nhận lỗi JavaScript.
  Bản ghi đi muộn thật hiển thị warning kèm chữ và giữ nguyên `0.994514` công.
- Bằng chứng: `.local/ui-redesign/density-*.png` và `density-detail-report.json`.
  Chạy kiểm tra ở cổng riêng 3002/5181, không dừng ứng dụng đang dùng ở 3001/5174.
  Không tạo bản ghi nghiệp vụ, chốt/khóa kỳ hay tính lương để kiểm tra giao diện.


## 13. Tài liệu tham khảo

- [Ant Design: theme bằng ConfigProvider và design token](https://ant.design/docs/react/customize-theme/).
- [Ant Design: định dạng và căn chỉnh dữ liệu](https://ant.design/docs/spec/data-format/).
- [W3C: tương phản chữ](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).
- [W3C: kích thước mục tiêu tương tác](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum).
