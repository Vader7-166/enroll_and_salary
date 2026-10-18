# 22. UI design guide — HRTP

Mã **HRTP-UI-01**, dựa trên hướng chủ dự án đã chọn: **Minimalism**, kết hợp **Bento
grid ở dashboard**. Các token cụ thể bên dưới là chuẩn đề xuất để triển khai nhất quán,
có thể điều chỉnh tập trung khi review giao diện. Đã có đăng nhập, nhân sự, hợp đồng/
phụ lục và lịch sử điều chuyển; tham số/chính sách hiệu lực, tạo/mở kỳ công; danh mục ca,
phân ca theo tổ/người/ngày, TT gửi và QĐ duyệt/trả lại, lịch chính thức và snapshot; tổ chức,
tài khoản/thu hồi phiên và health nối API thật; nhập tệp/ghép quẹt, bảng công/ngoại lệ và truy vết nguồn; đăng ký/gửi/duyệt/trả lại/từ chối OT, hạn mức và snapshot; đối chiếu OT thực tế/đủ điều kiện và bằng chứng quẹt. Chưa tính tiền OT hoặc nghiệm thu toàn bộ UI/R1.
Ngày mặc định của màn hình nghiệp vụ mới dùng múi giờ Asia/Ho_Chi_Minh. Tab hợp đồng
chỉ dành cho KT; AD chỉ quản lý cấu hình/kỳ và không được đọc lương nhân sự.

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

- Sáng, rõ, tiết chế; nền xám nhẹ, nội dung trắng, xanh navy cho nhận diện và xanh dương
  cho hành động. Không dùng blur, kính trong suốt hoặc hiệu ứng nổi/chìm trên dữ liệu.
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
| Cỡ chữ | Tiêu đề trang 24px; nhóm 18px; nội dung/bảng 14px; chú thích 12px, không dùng cỡ nhỏ cho thông tin quan trọng |
| Độ đậm | Nội dung 400; nhãn 500; tiêu đề/tổng số 600; line-height nội dung khoảng 1,5 |
| Tiền và số | Căn phải, chữ số có độ rộng đồng nhất bằng `font-variant-numeric: tabular-nums`; ID vẫn là chuỗi, không định dạng thành số tiền |
| Khoảng cách | Theo thang 4/8/12/16/24/32/48px trong JSON |
| Bo góc | Điều khiển và bề mặt chuẩn 8px; badge dạng pill; không dùng bo góc lớn cho tất cả các khối |
| Bề mặt | Viền phân chia nhẹ; bóng chỉ cần cho phần nổi như menu/modal/drawer |
| Màu | Token JSON quản lý màu primary/text/nền/trạng thái; không tự thêm màu riêng cho từng module |

Nền bề mặt trắng `#FFFFFF`, canvas `#F5F7FA`, chữ `#182230`, nhận diện navy `#172554`,
primary `#1D4ED8`. Viền phân cách trang trí dùng divider; ranh giới điều khiển có ý
nghĩa dùng colorBorder/focus đủ rõ. Không dùng divider nhạt làm chỉ dấu duy nhất của ô nhập.

## 3. Khung ứng dụng và responsive

Desktop: sidebar 240px, thu gọn 72px; header 64px; padding nội dung 24px. Sidebar nền
trắng, logo/chữ nhận diện navy, mục đang chọn có nền info và nhãn rõ. Header có vị trí
trang, thông báo trong ứng dụng và tài khoản; không làm header thành vùng KPI.

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
| Bảng công | Kỳ/cơ sở/đơn vị/trạng thái → ngoại lệ cần xử lý → ma trận công → drawer chi tiết ca/log |
| OT thực tế | Trong Chấm công: kỳ/đơn vị/nhân viên/ngoại lệ → đề nghị/đã duyệt/thực tế/đủ điều kiện → drawer snapshot, ngày lịch/ngày–đêm, cặp ghép và nguồn lô/dòng; ghi rõ không phải giờ chi trả |
| Bảng lương | Kỳ công nguồn/kỳ lương/ngày trả → tiến độ/cổng chặn → bảng lương → drawer giải thích |
| Duyệt | Tóm tắt người/phạm vi/khoảng thời gian → dữ liệu và thay đổi → duyệt hoặc từ chối kèm lý do theo quy trình |
| Tham số/công thức | Giá trị + khoảng hiệu lực + nguồn kế thừa → lịch sử phiên bản → chạy thử trước áp dụng |
| Báo cáo | Loại báo cáo + phạm vi + kỳ → xem kết quả → xuất tệp với trạng thái tác vụ |

Drawer dùng cho xem/giải thích mà cần giữ ngữ cảnh bảng; trang riêng cho biểu mẫu dài.
Modal chỉ dùng xác nhận ngắn hoặc tác vụ tập trung; tránh modal chứa modal.

## 6. Bảng, filter và thao tác hàng loạt

- Header rõ, sticky khi cần; cột mã/tên nhân viên cố định bên trái trên màn hình đủ rộng,
  bỏ cố định ở 390px để không che các cột giữa. Bảng mặc định dòng 48px, chế độ gọn
  40px ở desktop; tablet giữ vùng chạm 44px cho hành động. Vùng cuộn có focus bàn phím.
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
| CLOSED | Đã chốt | Warning; KT có thể trả lại có lý do trước khóa; không sửa trực tiếp |
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

Chuyển động 120–180ms; tôn trọng `prefers-reduced-motion`. Không dùng parallax,
animation liên tục, nền 3D hoặc hiệu ứng kéo rê trang trí trên màn hình làm việc.
Light theme là chuẩn bản đầu; dark theme chưa phải đầu việc bắt buộc của sprint.

## 11. Hướng dẫn triển khai Ant Design và phối hợp agent

Khi khởi tạo frontend, dùng một `ConfigProvider` đọc `antd.token` từ JSON và locale
tiếng Việt tương ứng phiên bản Ant Design đã chọn. Bọc ứng dụng bằng cơ chế App/context
của thư viện để modal/message dùng chung theme. Token semantic và layout chuyển thành
CSS variables hoặc hằng số theme dùng chung; không copy màu vào từng trang.

Antigravity sở hữu frontend, theme và các component dùng lại. Các tên sau là quy ước
đề xuất khi triển khai, chưa phải file/module đang tồn tại:
`AppShell`, `PageHeader`, `PeriodContextBar`, `FilterBar`, `DataTable`, `StatusTag`,
`ApprovalActions`, `JobProgress`, `PayrollTraceDrawer`, `SensitiveActionConfirm`.

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

## 13. Tài liệu tham khảo

- [Ant Design: theme bằng ConfigProvider và design token](https://ant.design/docs/react/customize-theme/).
- [Ant Design: định dạng và căn chỉnh dữ liệu](https://ant.design/docs/spec/data-format/).
- [W3C: tương phản chữ](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).
- [W3C: kích thước mục tiêu tương tác](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum).
