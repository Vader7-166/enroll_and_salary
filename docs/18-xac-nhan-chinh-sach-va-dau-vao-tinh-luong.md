# 18. Xác nhận chính sách và đầu vào tính lương

Phạm vi bản đầu được chốt tại [19](19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md), giữ nguyên
DEC-01…03 và bộ mô phỏng dưới đây. R1 giữ đủ hình thức lương; không hiểu việc chuyển sáu
tiện ích sang backlog là cắt lương sản phẩm/khoán/hoa hồng/3P hoặc bỏ đầu vào tương ứng.

Ngày xác nhận: **17/10/2026**. Người xác nhận: **chủ dự án qua trao đổi trong phiên làm việc**.
Phạm vi xác nhận là **thiết kế/cấu hình mô phỏng cho đồ án**, không phải biên bản khảo sát
hay quy chế đã ban hành của một doanh nghiệp thực tế.

## 1. Ba quyết định đã được xác nhận

| Mã | Quyết định của chủ dự án | Hiệu lực trong thiết kế |
|---|---|---|
| DEC-01 | Tạm chưa bật quy đổi nghỉ bù; OT vẫn tính và trả tiền theo quy tắc đã chốt | `COMP_TIME_ENABLED = false`; không sinh quỹ, không trừ tiền/giờ OT; tỷ lệ 1:1,5 và hạn 3 tháng cũ được rút khỏi cấu hình đang dùng |
| DEC-02 | Giữ đủ thời gian/sản phẩm/khoán/hoa hồng/3P; xác định dữ liệu và công thức từng loại | Không cắt phạm vi FR-7.1.4; từng nhân viên được gán phương thức/công thức có hiệu lực, không cộng mọi hình thức mặc định |
| DEC-03 | Lập cấu hình mô phỏng cho đồ án, ghi rõ chưa phải chính sách doanh nghiệp | Các giá trị tại §2 có nhãn `SIMULATION`; khi triển khai thật phải thay bằng bản có căn cứ và người xác nhận nghiệp vụ |

**Phân biệt trạng thái:** `CONFIRMED_DESIGN` là quyết định thiết kế của chủ dự án;
`SIMULATION` là dữ liệu/chính sách dùng mô phỏng; `LEGAL_VERIFIED` là quy tắc pháp lý đã
đối chiếu; `EVIDENCE_REQUIRED` là mục chưa có chứng từ/dữ liệu thực tế. Xác nhận mô phỏng
không biến mục `EVIDENCE_REQUIRED` thành chính sách doanh nghiệp đã được phỏng vấn.

Mỗi bản cấu hình lưu `policy_code`, `version`, `scope`, `effective_from/to`, `status`,
`confirmed_by`, `confirmed_at`, `decision_reference` và `evidence_reference` nếu có.
Tài liệu này là nguồn chuẩn thay các giả định cũ ở [16 §6](16-ke-hoach-trien-khai-va-rui-ro.md).

Bộ cấu hình máy đọc được: [hrtp-simulation-policy.json](config/hrtp-simulation-policy.json).
Đây là cấu hình tham chiếu cho thiết kế/seed đồ án; kho hiện chưa có ứng dụng tự nạp file này.

## 2. Sổ xác nhận các giả định khảo sát

Mã PS-01…PS-24 giữ nguyên số thứ tự câu hỏi ở tài liệu 16 để truy vết.

| Mã | Nội dung / cấu hình đồ án | Trạng thái và căn cứ | Khi dùng thực tế cần |
|---|---|---|---|
| PS-01 | Công chuẩn lương thời gian: 26 công/tháng cho sản xuất; đơn vị khác chọn lịch thực tế theo cấu hình | SIMULATION · DEC-03 | Quy chế trả lương, lịch làm việc, cách tính ngày có/không hưởng lương |
| PS-02 | Dung sai chuyên cần 15 phút; ghi nhận phút thực tế, không phạt/trừ lương vì vi phạm | SIMULATION · DEC-03 | Chính sách chuyên cần/thưởng; dung sai này tách khỏi cửa sổ ghép lượt |
| PS-03 | Xoay ca theo tuần, thứ tự ca theo cấu hình từng cơ sở | SIMULATION · DEC-03 | Lịch tổ/kíp thật; không suy ra đã xác nhận mô hình 3 kíp hay 4 kíp |
| PS-04 | Căn cứ OT là danh sách cấu phần được phân loại theo công việc và căn cứ pháp luật, không mặc định chỉ lương cơ bản | LEGAL_VERIFIED về cách xác định; danh sách mẫu ở §5 là SIMULATION | HĐ/phụ lục và quy chế từng cấu phần; KT đối chiếu trước áp dụng |
| PS-05 | Căn cứ BH dùng phân loại cấu phần theo hiệu lực, độc lập với cờ OT/thuế/ngày công | SIMULATION về dữ liệu cấu phần, áp quy tắc BH của hồ sơ | Danh sách khoản đóng/không đóng và chứng từ tương ứng; không coi cờ do người nhập chọn là căn cứ pháp luật |
| PS-06 | Miễn/không tính thuế theo bộ quy tắc đã đối chiếu tại 12 §2.7; mẫu tiền ăn/đồng phục/điện thoại phải phân loại riêng | LEGAL_VERIFIED về quy tắc; dữ liệu chi là SIMULATION | Quy chế, hình thức chi, chứng từ; không tự miễn mọi phụ cấp |
| PS-07 | Cảnh báo sau 3 lần giải trình quên quẹt/tháng, không tự bác bỏ giải trình tiếp theo hoặc thêm cấp duyệt | SIMULATION · DEC-03 | Ngưỡng kiểm soát nội bộ; chứng cứ vẫn bắt buộc |
| PS-08 | Mẫu chuyển phép tối đa 5 ngày, hạn 31/03 năm sau | SIMULATION · DEC-03 | Thỏa thuận/quy chế phép; phần vượt/hết hạn được đưa đối soát, không tự xóa quyền lợi chỉ từ cấu hình mẫu |
| PS-09 | Mẫu cho ứng tối đa 3 ngày phép năm sau | SIMULATION · DEC-03 | Quy chế, điều kiện, số dư và cách xử lý khi nghỉ việc |
| PS-10 | Không kích hoạt quỹ nghỉ quy đổi OT; tỷ lệ/hạn dùng để trống, không lấy 1:1,5/3 tháng làm mặc định | CONFIRMED_DESIGN · DEC-01 | Nếu đề nghị mở lại: quyết định riêng và cách trả lương ngày nghỉ; không thay tiền OT |
| PS-11 | Bộ mô phỏng dùng trần OT năm 200 giờ; khả năng dùng 300 giờ chưa bật | SIMULATION; chưa xác nhận hồ sơ doanh nghiệp | Điều kiện áp dụng và hồ sơ thông báo/căn cứ trước khi bật cấu hình cao hơn |
| PS-12 | Mẫu xuất ngân hàng chỉ ở mức dữ liệu minh họa, chưa xác nhận ngân hàng/mẫu thật | EVIDENCE_REQUIRED | Mẫu file và quy tắc kiểm tra do ngân hàng cung cấp; không dùng file demo để chi thật |
| PS-13 | Chỉ xuất phân bổ chi phí, không tích hợp API ERP; mẫu minh họa | CONFIRMED_DESIGN về phạm vi; EVIDENCE_REQUIRED về mẫu thật | Danh mục tài khoản/cost center và mẫu nhập của phần mềm kế toán |
| PS-14 | Dùng file log chuẩn trong 11 §1 cho đồ án, không chọn hãng máy giả làm kết quả khảo sát | SIMULATION về file; EVIDENCE_REQUIRED về thiết bị | File xuất thật của từng cơ sở, mapping cột/mã nhân viên/thời gian |
| PS-15 | Thiết kế chạy độc lập môi trường; đồ án dùng môi trường phát triển, chưa chọn hạ tầng vận hành thật | EVIDENCE_REQUIRED | Quyết định on-prem/cloud, kết nối, sao lưu và nguồn lực vận hành |
| PS-16 | Mẫu chuyển đổi 12 tháng lịch sử gần nhất, gắn nhãn dữ liệu mô phỏng | SIMULATION · DEC-03 | Thời gian chuyển đổi, nguồn và số liệu đối soát đã được duyệt |
| PS-17 | Có báo cáo giờ làm theo tuần, không tuyên bố đã đạt SMETA/BSCI/RBA | CONFIRMED_DESIGN về báo cáo; EVIDENCE_REQUIRED về chuẩn kiểm toán | Phiên bản tiêu chuẩn, yêu cầu kiểm toán và cách tính từng chỉ số |
| PS-18 | Nhân viên làm hai cơ sở trong kỳ: tách đoạn và phân bổ cost center theo BR-67 | CONFIRMED_DESIGN đã có trong v2 | Quyết định điều chuyển và thời gian thực tế; áp thuế theo thời điểm chi trả |
| PS-19 | Mẫu bốn cơ sở cùng chốt ngày công 25, cấu hình theo SITE; ca qua ngày chốt theo tài liệu 17 | SIMULATION · DEC-03; vòng đời CONFIRMED_DESIGN | Lịch chốt riêng từng cơ sở nếu khác |
| PS-20 | Phụ cấp điều chuyển/nhà ở chỉ phát sinh khi có quyết định đầu vào cụ thể; không tự thêm khoản cho mọi điều chuyển | SIMULATION về bộ dữ liệu; EVIDENCE_REQUIRED về quy chế thật | Đối tượng, mức tiền, thời hạn, cờ thuế/BH/OT theo căn cứ |
| PS-21 | Mẫu NM Nghệ An dùng 2 ca, chưa thêm ca 3; mở rộng bằng cấu hình | SIMULATION · DEC-03 | Kế hoạch ca và nhân lực thực tế |
| PS-22 | Q2: giờ OT thực tế luôn giữ để kiểm soát trần; không quy đổi để giảm tiền OT | LEGAL_VERIFIED về nghĩa vụ tiền OT; CONFIRMED_DESIGN · DEC-01 | Không còn câu hỏi cho phép bỏ tiền OT; chỉ còn việc có cấp thêm phúc lợi nghỉ trong tương lai |
| PS-23 | Đơn/giải trình của tổ trưởng do tài khoản TT khác có phạm vi tổ đó xử lý, chặn tự duyệt | CONFIRMED_DESIGN cho đồ án · DEC-03 | Bảng phân công thay thế có hiệu lực và tài khoản gắn nhân viên |
| PS-24 | Mẫu KT tập trung với phạm vi ALL; vẫn hỗ trợ cấp SITE và exclusion list | SIMULATION · DEC-03 | Phân công nghiệp vụ và quyền dữ liệu thực tế |

Các mục PS-12…PS-17 có dữ liệu thực tế còn thiếu không chặn dùng dữ liệu minh họa trong đồ án,
nhưng không được ghi “đã khảo sát/xác nhận doanh nghiệp”. Quy tắc pháp luật không cho thay
bằng giá trị mô phỏng trái luật; mọi giá trị mẫu đều cần tách khỏi bộ cấu hình vận hành.

## 3. Nghỉ bù: ranh giới đã chốt

Phân biệt ba loại, không dùng chung một số dư:

| Loại | Cách xử lý |
|---|---|
| Nghỉ bù ngày lễ trùng nghỉ hằng tuần | Lịch nghỉ theo BR-16; vẫn thuộc phạm vi, không phụ thuộc `COMP_TIME_ENABLED` |
| Quy đổi/cấp thêm quỹ nghỉ từ OT | FR-5.5.1 vẫn giữ trong thiết kế, trạng thái chưa kích hoạt theo DEC-01 |
| Phép năm và nghỉ riêng | Quỹ/đơn nghỉ theo phân hệ 6, không bị vô hiệu hóa bởi quyết định về nghỉ quy đổi OT |

Với `COMP_TIME_ENABLED = false`: yêu cầu tạo quy đổi trả `COMP_TIME_DISABLED`; không sinh
số dư, không trừ tiền OT, không giảm giờ OT thực tế, không tạo thêm dòng lương vì “quy đổi”.
Nếu có dữ liệu quỹ cũ khi chuyển đổi thực tế, đưa về đối soát riêng, không tự hủy hoặc biến
thành quyền lợi mới. Ví dụ 2 giờ OT ngày thường × 100.000 đ/giờ × 150% = **300.000 đ**;
yêu cầu nghỉ bù bị từ chối không thay đổi khoản này.

**Căn cứ đã đối chiếu:** [giải đáp Bộ LĐTBXH về không dùng nghỉ bù thay trả lương OT](https://chinhsachonline.chinhphu.vn/lam-ngoai-thoi-gio-hanh-chinh-duoc-tra-luong-the-nao-68468.htm),
[BLLĐ 45/2019/QH14](https://chinhphu.vn/?docid=198540&pageid=27160), Điều 98.
Tỷ lệ/hạn dùng nghỉ bổ sung không phải hệ số luật định được suy từ các mức 150/200/300%.

Nguồn [SQ-04](../diagrams/sequence/src/SQ4.mmd) và [CD-05](../diagrams/class/src/CD-05-lam-them-gio.mmd)
đã cập nhật. PNG/Word SQ-04, AD-05, CD-05 cũ chỉ tham khảo lịch sử; câu “trừ giờ OT trả tiền”
hoặc “Q2 chờ chốt” trong đó không còn là yêu cầu hiện hành.

## 4. Hợp đồng dữ liệu đầu vào tính lương

Đây là hợp đồng nghiệp vụ cho nhập liệu/file, không bổ sung kết nối API máy, ERP hay hệ
thống sản xuất. TT/QĐ chuẩn bị và xác nhận dữ liệu sản xuất/KPI ngoài hệ thống; **KT** tiếp
nhận/nhập và kiểm tra trong phân hệ 7 theo quyền hiện có. Không tự cấp TT/QĐ quyền sửa lương.

**Trạng thái local:** Task 1 đã triển khai tiếp nhận/xác nhận tại `#/payroll-inputs`,
API `/api/payroll-inputs`; hướng dẫn và bằng chứng tại [20 §7.28](20-tech-stack-va-moi-truong-phat-trien.md#728-tiếp-nhận-và-xác-nhận-đầu-vào-lương-task-1).
Kỳ nhận dùng `PayrollPeriod` riêng với kỳ công; chỉ nguồn CONFIRMED hoạt động được
đọc cho consumer. Chưa có engine/bảng lương nháp, duyệt/khóa bảng lương hoặc AI;
không xem xác nhận nguồn là đã trả lương hay tự đặt lại bảng lương chưa tồn tại.

### 4.1. Thông tin chung của mỗi lô/dòng

| Nhóm | Dữ liệu bắt buộc |
|---|---|
| Định danh | `source_system`, `source_document_no`, `source_line_id`, `source_version`, `employee_code`, `site_code`, `payroll_period_id` |
| Thời gian | Khoảng phát sinh công việc, ngày hiệu lực đơn giá/quyết định; thời điểm chi trả dự kiến/thực tế lưu riêng cho thuế |
| Nội dung | `input_type`, mã cấu phần, số lượng, đơn vị, mã/phiên bản đơn giá hoặc công thức; khoản tiền trực tiếp phải có căn cứ |
| Xác nhận nguồn | Người lập, người xác nhận nghiệp vụ nguồn, ngày xác nhận, chứng từ/bảng nghiệm thu đính kèm |
| Trạng thái | `DRAFT → VALIDATED → CONFIRMED`; bị trả `RETURNED`, bản thay thế `SUPERSEDED`; chỉ CONFIRMED được dùng chính thức |
| Truy vết | Mã lô, người nhập, ngày nhập, hash file/nội dung, phiên bản mapping và cấu hình; liên kết dòng lương đầu ra |

`source_line_id` là định danh ổn định từ nguồn, không dùng số thứ tự dòng trong file làm
khóa duy nhất. Khóa nhập lại là `(source_system, source_document_no, source_line_id, source_version)`.
Cùng khóa/cùng nội dung thì bỏ qua; cùng khóa/khác nội dung trả `PAYROLL_INPUT_CONFLICT`.
Bản sửa phải có version mới và liên kết bản cũ; chỉ một phiên bản hiệu lực được tính.

### 4.2. Đầu vào theo hình thức trả lương

| Hình thức | Đầu vào cần có | Công thức/điều kiện phải khai báo | Xác nhận nguồn |
|---|---|---|---|
| Thời gian tháng/ngày/giờ | HĐ/quyết định lương có hiệu lực; loại đơn giá; snapshot công khóa; ngày/giờ được trả; công chuẩn/chính sách phân bổ | Mẫu tháng: lương tháng × công được trả / công chuẩn; phân biệt công làm thật, nghỉ hưởng lương, nghỉ không lương; không cộng hai lần ngày nghỉ hưởng lương | KT đối chiếu hồ sơ; TT/QĐ xác nhận công theo luồng phân hệ 4 |
| Sản phẩm | Nhân viên/tổ, ngày thực hiện, mã sản phẩm/công đoạn, số lượng **được nghiệm thu**, đơn vị, đơn giá hiệu lực | Σ sản lượng nghiệm thu × đơn giá; hàng lỗi/hủy/hoàn xử lý bằng bản điều chỉnh có nguồn; OT sản phẩm tách căn cứ riêng | QĐ xác nhận nghiệm thu ngoài hệ thống; KT tiếp nhận |
| Khoán sản phẩm/khoán việc | Mã giao khoán, giá trị, kỳ, khối lượng/mốc nghiệm thu, tỷ lệ hoàn thành, phần đã thanh toán | Theo mốc/khối lượng đã nghiệm thu; không vừa trả toàn bộ giá khoán vừa trả lại cùng mốc; khoán tổ có bảng phân bổ | QĐ/bộ phận giao việc xác nhận nguồn; KT tiếp nhận |
| Doanh số–hoa hồng | Mã giao dịch, nhân viên, doanh số/thu tiền đủ điều kiện, tỷ lệ theo bậc, ngày phát sinh/quyền hưởng, hàng hoàn/hủy | Công thức nêu rõ tính theo bán hàng hay thu tiền, bậc lũy tiến hay một suất toàn bộ; hoàn/hủy gắn giao dịch gốc | Bộ phận sở hữu số liệu xác nhận ngoài hệ thống; KT tiếp nhận, không thêm vai trò đăng nhập |
| 3P | P1 vị trí, P2 năng lực và quyết định hiệu lực, P3/KPI đã xác nhận, thang điểm/đơn vị, trọng số, mức mục tiêu | Công thức khai báo cách kết hợp P1/P2/P3, khoản cố định có phân bổ công hay không; không cộng lương thời gian vào P1 lần nữa | Quyết định và kết quả đánh giá được xác nhận ngoài hệ thống; KT tiếp nhận |
| Thưởng/KPI bổ sung | Mã quyết định, nhân viên/đơn vị, kỳ hưởng, kỳ chi, mức thưởng hoặc điểm/tỷ lệ, công thức | Chỉ là khoản cộng thêm khi phương án lương quy định; không vừa tính P3 vừa thêm thưởng từ cùng kết quả nếu không có quyết định riêng | Chủ sở hữu quyết định xác nhận nguồn; KT kiểm tra |
| Phụ cấp/phúc lợi | Mã khoản, điều kiện, mức tiền, ngày hiệu lực, số lượng nếu có | Phân bổ theo công/giờ hay trả cố định phải tường minh; cờ BH/thuế/OT tách riêng | KT đối chiếu quyết định/chứng từ |
| Tạm ứng/khấu trừ/điều chỉnh | Chứng từ, kỳ gốc, kỳ nhận, số tiền, căn cứ và số đã xử lý | Không coi dữ liệu thiếu là khoản 0; không tạo lại khoản đã xử lý; giới hạn/điều kiện theo BR-44/42 | KT xác nhận |

Một nhân viên có một **phương án lương hiệu lực** trên mỗi đoạn thời gian. Phương án nêu
rõ khoản thay thế nhau và khoản cộng thêm; không tự cộng lương thời gian, toàn bộ sản phẩm,
giá khoán, hoa hồng và P1/P2/P3. Đơn giá thay giữa kỳ thì tách theo ngày thực hiện; không
dùng đơn giá mới cho toàn bộ sản lượng cũ. Đổi phương án cũng phải tách đoạn và chống chồng.

Khoán/sản phẩm theo tổ phải có dòng phân bổ đến nhân viên, tổng phần phân bổ bằng giá trị
được nghiệm thu (xử lý chênh lệch làm tròn theo chính sách), không mặc định chia đều. Chưa
có bảng phân bổ thì giữ chờ, không tính cùng một giá trị cho mọi thành viên tổ.

### 4.3. Thiếu dữ liệu khác với số 0 hợp lệ

- Chưa có dữ liệu nguồn/đơn giá/nghiệm thu: `MISSING`, chặn xác nhận lương người bị ảnh
  hưởng với mã `PAYROLL_INPUT_MISSING`; không mặc định sản lượng/KPI/hoa hồng bằng 0.
- Nguồn xác nhận không có sản lượng/doanh số: `CONFIRMED_ZERO`, lưu người/lý do/chứng từ;
  giá trị 0 được phép tính theo phương án lương, vẫn kiểm tra bảo đảm lương nếu áp dụng.
- Khoản không áp dụng cho nhân viên: `NOT_APPLICABLE`, theo phương án có hiệu lực; không
  bắt nhập đủ cả năm hình thức cho mọi nhân viên.
- Sai đơn vị, âm ngoài luồng điều chỉnh, mã nhân viên/cơ sở không hợp lệ, kỳ khóa, đơn giá
  chồng hiệu lực, tỷ lệ/điểm ngoài miền công thức: trả lỗi cụ thể, không ghi chính thức.
- Dòng đang nháp chưa dùng để duyệt/khóa lương. Cho phép xem tính thử với nhãn mô phỏng,
  nhưng kết quả đó không thay đầu vào CONFIRMED.
- Sửa dữ liệu sau duyệt nhưng trước khóa làm lương về Nháp và phải duyệt lại. Sau khóa
  không ghi đè: tạo bản điều chỉnh vào kỳ mở, giữ nguồn/snapshot cũ.

### 4.4. Ngày/giờ và tiền dùng cho OT

Công chuẩn 26 của PS-01 phục vụ mẫu **lương thời gian**, không tự làm mẫu số OT trong mọi
trường hợp. Căn cứ OT phải xác định cấu phần tiền lương công việc tương ứng và số giờ làm
việc bình thường tương ứng theo Điều 55 NĐ 145/2020; loại giờ OT khỏi mẫu số. Lưu được tử
số, mẫu số và nguồn chứng minh; thiếu một trong hai thì chưa duyệt phép tính.

Giờ OT **thực tế**, giờ đã duyệt và giờ dùng tính tiền là các giá trị riêng. Giờ thực tế
không giảm vì nghỉ bù, lệch duyệt hoặc điều chỉnh trả tiền. Khoảng OT không khớp chuyển
ngoại lệ để xác minh; không biến thiếu dữ liệu phê duyệt thành kết luận tự động không
phải trả lương. OT trả theo sản phẩm cần đơn giá/số lượng ngoài giờ được xác nhận và công
thức riêng, không dùng thẳng đơn giá giờ của lương thời gian cho mọi hình thức.

Nguồn: [giải đáp cơ quan lao động về Điều 55 và các khoản loại khỏi căn cứ OT](https://chinhsachonline.chinhphu.vn/huong-dan-tinh-tien-luong-lam-them-gio-79734.htm).

## 5. Bộ dữ liệu mô phỏng và kết quả đối chứng

Tất cả số dưới đây là **fixture đồ án**, không phải mức lương/chính sách doanh nghiệp đã
khảo sát. Mỗi dòng dùng riêng phương án lương được nêu; không cộng các dòng của các phương
án khác nhau. Kết quả là cấu phần thu nhập trước BH/thuế, trừ khi ghi rõ.

| Mã | Đầu vào mô phỏng đã xác nhận trong fixture | Kết quả mong đợi |
|---|---|---|
| FIX-01 | Lương tháng 13.000.000 đ, công chuẩn 26; công được trả gồm 23 ngày làm + 1 phép hưởng lương = 24 | Lương thời gian **12.000.000 đ**; ngày phép không cộng lương lần hai |
| FIX-02 | Khoản phụ cấp 1.000.000 đ được cấu hình có phân bổ công; công được trả 13/26 | Phụ cấp **500.000 đ**; nếu cấu hình khoản cố định không phân bổ thì áp công thức riêng |
| FIX-03 | 500 sản phẩm nghiệm thu × đơn giá 2.000 đ; 30 sản phẩm lỗi chưa nghiệm thu | Lương sản phẩm **1.000.000 đ**; không dùng 530 sản phẩm |
| FIX-04 | 100 sản phẩm trước mốc đơn giá 2.000 đ, 100 sau mốc đơn giá 2.500 đ | **450.000 đ**, lưu hai phiên bản đơn giá |
| FIX-05 | Giá khoán 10.000.000 đ; mốc nghiệm thu được thanh toán 40%, chưa trả mốc này | **4.000.000 đ**; nhập lại cùng mốc không phát sinh tiền lần hai |
| FIX-06 | Giao dịch đủ điều kiện tính hoa hồng 100.000.000 đ × 2%; hoàn đã xác nhận 10.000.000 đ cùng cơ sở tỷ lệ | Hoa hồng **1.800.000 đ**, gắn giao dịch/hoàn gốc |
| FIX-07 | P1 = 8.000.000 đ, P2 = 2.000.000 đ, P3 mục tiêu 3.000.000 đ × 80%; fixture làm đủ công, công thức P1+P2+P3 | **12.400.000 đ**; không cộng thêm một khoản lương thời gian 10 triệu từ cùng P1/P2 |
| FIX-08 | Thưởng KPI mục tiêu 5.000.000 đ × tỷ lệ 80%; là thưởng bổ sung độc lập có quyết định, không đồng thời là P3 của FIX-07 | Thưởng **4.000.000 đ**; không tự trừ lương cố định khi chưa đạt 100% |
| FIX-09 | Hai giờ OT đủ căn cứ, đơn giá giờ 100.000 đ, hệ số 150%; COMP_TIME_ENABLED=false | Tiền OT **300.000 đ**, không sinh nghỉ bù và không trừ giờ thực tế |

**Tập cấu phần minh họa**: lương công việc, phụ cấp chức vụ và các khoản khác phải có các
cột `is_insurable`, `tax_classification`, `is_ot_base`, `is_prorated`, căn cứ và khoảng hiệu
lực độc lập. Fixture OT có thể cấp trực tiếp đơn giá 100.000 đ đã kiểm chứng, nhưng khi
kiểm thử thuật toán dựng đơn giá phải có riêng danh sách cấu phần và tổng giờ nguồn.

## 6. Hoàn tất xác nhận và chuyển sang sử dụng thật

Các quyết định DEC-01…03 đã được chủ dự án xác nhận; không cần hỏi lại ba lựa chọn này.
Danh sách PS là sổ kiểm soát phạm vi dữ liệu, không phải danh sách ba quyết định còn chờ.
Khi có quy chế thật, KT/QĐ/TT xác nhận theo nghiệp vụ, AD nạp phiên bản có hiệu lực và lưu
căn cứ. Cấu hình/chứng từ thay đổi không sửa kết quả kỳ đã khóa.

Trước mỗi lần tính: chọn phương án lương → kiểm tra đầu vào áp dụng và phiên bản → đối
chiếu người/đơn vị/thời gian → xác nhận nguồn → đóng bộ đầu vào/hash → tính nháp → duyệt/
khóa theo 17. Chỉ những mục còn thiếu **ảnh hưởng phép tính hoặc đầu ra thật đang dùng**
mới chặn phần đó; thiếu mẫu ngân hàng không chặn mô phỏng tính lương, nhưng chặn file chi thật.
