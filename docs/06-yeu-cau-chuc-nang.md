# 06. Yêu cầu chức năng

Hệ thống gồm **16 phân hệ**. Mỗi yêu cầu có mã `FR-xx.y` và mức ưu tiên:

| Mức | Ý nghĩa |
|---|---|
| **M** (Must) | Bắt buộc có ở bản phát hành đầu tiên |
| **S** (Should) | Cần có, có thể lùi sang giai đoạn 2 |
| **C** (Could) | Có thì tốt, không chặn nghiệm thu |

---

## FR-01. Nền tảng hệ thống và danh mục

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-01.1 | Phân quyền theo vai trò (16 vai trò) và theo phạm vi dữ liệu (`SELF`/`TEAM`/`DEPARTMENT`/`SITE`/`ALL`); một hành động chỉ thực hiện được khi thỏa mãn **đồng thời** cả hai trục | M | [09](09-phan-quyen-va-bao-mat.md) |
| FR-01.2 | Danh sách loại trừ (exclusion list) ẩn hồ sơ và dữ liệu lương của nhóm nhân sự đặc biệt khỏi tài khoản HR cấp thấp, kể cả khi phạm vi là `ALL`; trả kết quả rỗng thay vì lỗi 403 | M | – |
| FR-01.3 | Che trường nhạy cảm theo quyền (số tài khoản, CCCD, tiền lương) | M | – |
| FR-01.4 | Cây tổ chức nhiều cấp: Công ty → Địa điểm → Khối → Phòng ban/Phân xưởng → Tổ/Nhóm; mỗi đơn vị có mã cost center và địa bàn áp lương tối thiểu vùng | M | – |
| FR-01.5 | Cây tổ chức có **phiên bản theo thời gian**; truy vấn nhận tham số ngày và trả về cấu trúc đúng tại ngày đó; chặn tạo vòng lặp | M | – |
| FR-01.6 | Lịch sử phân công nhân sự ↔ đơn vị; hỗ trợ một nhân sự thuộc nhiều đơn vị trong cùng kỳ, phân bổ chi phí theo tỷ lệ ngày công | M | BR-40 |
| FR-01.7 | Bảng tham số pháp lý theo khoảng hiệu lực, ràng buộc chống chồng lấn ở tầng CSDL; bắt buộc khai báo văn bản căn cứ | M | BR-02, BR-04 |
| FR-01.8 | Cảnh báo khi tham số sắp hết hiệu lực mà chưa có bản ghi kế tiếp | M | BR-04 |
| FR-01.9 | Quản lý kỳ công và kỳ lương tách biệt, mỗi kỳ có vòng trạng thái riêng; kỳ lương chỉ chạy được khi kỳ công đã `LOCKED` | M | BR-01 |
| FR-01.10 | Mở khóa kỳ có kiểm soát: quyền riêng, lý do bắt buộc, lưu snapshot trước khi mở, ghi audit log mức cao nhất | M | BR-42 |
| FR-01.11 | Cấu hình chính sách theo đơn vị, kế thừa từ cây tổ chức, ghi đè từng khóa; giao diện hiển thị nguồn gốc giá trị đang có hiệu lực | M | BR-05 |
| FR-01.12 | Danh mục dùng chung: chức danh, ngạch bậc, loại hợp đồng, loại nghỉ, loại phụ cấp, ngân hàng, địa bàn, trình độ | M | – |

---

## FR-02. Hồ sơ nhân sự

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-02.1 | Hồ sơ cá nhân đầy đủ: CCCD/số định danh, MST cá nhân, số sổ BHXH, tài khoản ngân hàng, liên hệ khẩn cấp, tệp đính kèm | M | – |
| FR-02.2 | Hồ sơ người phụ thuộc kèm **tháng bắt đầu / kết thúc** được giảm trừ và chứng từ chứng minh | M | BR-53 |
| FR-02.3 | Quá trình công tác dạng lịch sử: tuyển dụng → thử việc → chính thức → điều chuyển → thăng chức → nghỉ việc | M | – |
| FR-02.4 | Quyết định nhân sự có **ngày hiệu lực**; xử lý được trường hợp hiệu lực rơi vào giữa kỳ lương | M | BR-40 |
| FR-02.5 | Quản lý nhân sự đặc thù: người nước ngoài (giấy phép lao động, tình trạng cư trú thuế), người đã hưởng hưu, lao động chưa thành niên, lao động nữ | M | BR-49 |
| FR-02.6 | **Sổ quản lý lao động điện tử tự sinh đủ 20 tiêu chí** theo Khoản 2 Điều 3 NĐ 145/2020, kết xuất được | M | [11](11-tuan-thu-phap-ly.md) |
| FR-02.7 | Cảnh báo tự động: hết hạn giấy tờ, đến hạn nâng lương, đến hạn đánh giá | S | – |
| FR-02.8 | Cảnh báo đỏ trên sổ quản lý lao động khi số giờ OT lũy kế năm vượt 200 hoặc 300 giờ | M | BR-27 |

**20 tiêu chí Sổ quản lý lao động điện tử:** họ tên · giới tính · ngày sinh · quốc tịch ·
nơi cư trú · số định danh cá nhân/CCCD/hộ chiếu · trình độ chuyên môn kỹ thuật · bậc kỹ
năng nghề · vị trí việc làm · chức danh công việc · loại HĐLĐ · thời điểm bắt đầu hiệu lực ·
thời điểm chấm dứt · mức lương thỏa thuận · mức lương đóng BHXH · tình hình tham gia
BHXH/BHYT/BHTN hằng tháng · số ngày nghỉ · số giờ làm thêm lũy kế trong năm · chế độ đào
tạo · kỷ luật và trách nhiệm vật chất · tai nạn lao động và bệnh nghề nghiệp · lý do chấm
dứt HĐLĐ.

---

## FR-03. Quản lý hợp đồng lao động

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-03.1 | Quản lý các loại HĐ: thử việc, xác định thời hạn, không xác định thời hạn, dưới 1 tháng, khoán việc, cộng tác viên/dịch vụ | M | BR-57 |
| FR-03.2 | Vòng đời hợp đồng: soạn → ký → hiệu lực → phụ lục → gia hạn → chấm dứt | M | – |
| FR-03.3 | Cảnh báo sắp hết hạn (30/60 ngày), hết hạn thử việc, đã ký đủ 2 lần HĐ xác định thời hạn | M | BR-58 |
| FR-03.4 | Kiểm tra lương thử việc ≥ 85% lương chính thức khi lưu hợp đồng | M | BR-09, `CP-02` |
| FR-03.5 | Liên kết HĐ ↔ cấu trúc lương ↔ diện đóng bảo hiểm, tự động xác định đối tượng tham gia BH theo loại HĐ | M | BR-49 |
| FR-03.6 | Mẫu hợp đồng động (merge field), in ấn, tùy chọn ký số | S | – |
| FR-03.7 | Quy trình chấm dứt HĐ: quyết định, bàn giao, trợ cấp thôi việc/mất việc, thanh toán phép chưa nghỉ, chốt sổ BHXH, quyết toán thuế cuối | M | BR-59 |

---

## FR-04. Ca làm việc và lịch làm việc

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-04.1 | Định nghĩa ca: giờ vào/ra, nghỉ giữa ca, biên độ cho phép, cờ ca đêm, **cờ ca qua nửa đêm**, ca gãy | M | BR-10 |
| FR-04.2 | Lịch hành chính, lịch ca xoay theo chu kỳ, phân ca hàng loạt, sao chép lịch tháng trước | M | – |
| FR-04.3 | Ràng buộc khi xếp ca: nghỉ giữa hai ca, trần giờ tuần, trùng đơn nghỉ đã duyệt | M | BR-11 |
| FR-04.4 | Lịch nghỉ lễ theo năm; xử lý nghỉ bù khi lễ trùng cuối tuần; khai báo hoán đổi ngày nghỉ Tết | M | BR-16 |
| FR-04.5 | Đăng ký ca, đổi ca, hoán ca giữa hai nhân viên có luồng duyệt | M | – |
| FR-04.6 | Cấu hình ngày công chuẩn tháng: cố định (26) hoặc theo ngày làm việc thực tế | M | BR-14 |
| FR-04.7 | Công bố lịch ca lên ESS, thông báo tới người lao động | M | – |

---

## FR-05. Quản lý dữ liệu chấm công

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-05.1 | Tiếp nhận dữ liệu đa nguồn: API/SDK máy chấm công, import file (Excel/CSV/TXT), nhập tay, app di động | M | [10](10-tich-hop-he-thong.md) |
| FR-05.2 | Cấu hình ánh xạ (mapping) cột file cho từng loại máy chấm công | M | – |
| FR-05.3 | Lưu `raw_punch` bất biến, chỉ ghi thêm | M | BR-19 |
| FR-05.4 | Khử lượt quẹt trùng trong cửa sổ 5 phút | M | BR-17 |
| FR-05.5 | Ghép cặp Vào/Ra và gán bản ghi vào đúng ca | M | BR-18 |
| FR-05.6 | **Gán ca đêm bắc cầu về ngày bắt đầu ca (ngày T)** | M | BR-13 |
| FR-05.7 | Tách dải giờ 22:00–06:00 để áp phụ cấp đêm; tách theo mốc 00:00 để phân loại ngày | M | BR-24 |
| FR-05.8 | Sinh dữ liệu dẫn xuất: công thực tế, đi muộn, về sớm, thiếu lượt chấm, vắng không phép, số giờ làm thực, giờ ngày, giờ đêm | M | – |
| FR-05.9 | Vùng chờ `UNMATCHED` cho bản ghi có mã NV không khớp — không chặn luồng xử lý | M | – |
| FR-05.10 | Quản lý ngoại lệ có luồng duyệt: giải trình quên chấm công, công tác ngoài, làm việc từ xa, sự cố thiết bị | M | QT-03 |
| FR-05.11 | Nhập bù hàng loạt khi máy chấm công hỏng / mất điện cả ngày, kèm biên bản sự cố | M | – |
| FR-05.12 | Điều chỉnh công thủ công bắt buộc kèm lý do và ghi audit log đầy đủ | M | BR-22 |
| FR-05.13 | Chạy bộ đối soát chéo `XC-01`…`XC-10` trước khi cho phép chốt công | M | QT-06 |
| FR-05.14 | Cảnh báo bất thường: vượt trần pháp luật, quẹt tại hai địa điểm bất khả thi, công âm | M | – |
| FR-05.15 | Bảng công tổng hợp tháng theo mẫu, có ký hiệu công từng ngày và các cột tổng hợp | M | BR-20 |
| FR-05.16 | Quy trình chốt công 4 bước, lưu snapshot kèm hash; sau khóa bảng công là **chỉ đọc** | M | BR-65 |
| FR-05.17 | Giám sát thiết bị chấm công: trạng thái kết nối, lần đồng bộ cuối, cảnh báo lệch đồng hồ | S | [10](10-tich-hop-he-thong.md) |

---

## FR-06. Làm thêm giờ (OT)

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-06.1 | Đăng ký OT trước hoặc xác nhận OT sau, duyệt nhiều cấp theo mức độ | M | BR-30 |
| FR-06.2 | **Chặn huy động OT khi chưa có văn bản đồng ý của người lao động** | M | BR-28 |
| FR-06.3 | Đối chiếu giờ đăng ký với giờ chấm công thực tế, lấy giá trị nhỏ hơn | M | BR-26 |
| FR-06.4 | Tự động phân loại giờ OT theo hệ số, tính bằng công thức ba số hạng | M | BR-23 |
| FR-06.5 | Tách giờ theo khung khi ca OT vắt qua nửa đêm hoặc bắc cầu sang ngày lễ | M | BR-24 |
| FR-06.6 | Phân biệt 200% / 210% theo cờ "đã có OT ban ngày trong cùng ngày công" | M | BR-25 |
| FR-06.7 | Kiểm soát trần: ≤ 50% giờ bình thường/ngày, ≤ 40h/tháng, ≤ 200h/năm (300h nếu đã đăng ký) — cảnh báo và chặn | M | BR-27 |
| FR-06.8 | Cảnh báo khi chạm ngưỡng trần tháng, hiển thị số giờ còn có thể huy động hợp pháp | M | – |
| FR-06.9 | Quy đổi OT thành nghỉ bù, sinh quỹ nghỉ bù có tỷ lệ quy đổi và hạn sử dụng | S | BR-29 |
| FR-06.10 | Ngân sách OT theo bộ phận, cảnh báo khi vượt, báo cáo chi phí OT | S | – |
| FR-06.11 | Tự động hủy đơn OT quá 12 giờ chưa được duyệt và thông báo để đăng ký lại | M | BR-30 |

---

## FR-07. Nghỉ phép, ốm đau, chế độ

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-07.1 | Danh mục loại nghỉ cấu hình được; mỗi loại khai báo: hưởng lương?, tính công?, trừ quỹ phép?, cần chứng từ?, giới hạn ngày, người duyệt | M | – |
| FR-07.2 | Hỗ trợ đủ các loại: phép năm, không lương, nghỉ bù, ốm đau, con ốm, thai sản, khám thai, dưỡng sức, tai nạn lao động, kết hôn, tang, chế độ riêng công ty | M | – |
| FR-07.3 | Tính quỹ phép năm: 12/14/16 ngày + 1 ngày mỗi 5 năm thâm niên, pro-rata cho người vào/nghỉ giữa năm | M | BR-31 |
| FR-07.4 | Chuyển phép sang năm sau có trần và hạn sử dụng; cấu hình cho phép ứng phép trước | M | BR-32 |
| FR-07.5 | Đơn nghỉ theo ngày / nửa ngày / theo giờ; kiểm tra số dư khi nộp; nghỉ đột xuất khai báo sau; hủy đơn hoàn lại số dư | M | BR-33 |
| FR-07.6 | Ngày lễ xen giữa kỳ nghỉ phép không bị trừ quỹ phép | M | BR-34 |
| FR-07.7 | Đối chiếu tự động đơn nghỉ ↔ bảng công ↔ bảng lương | M | `XC-01` |
| FR-07.8 | Chế độ ốm đau – thai sản: theo dõi số ngày hưởng theo thâm niên đóng BH, tính mức hưởng, lập hồ sơ đề nghị BHXH, theo dõi tiền chi trả về | M | BR-35 |
| FR-07.9 | Lịch nghỉ của nhóm và kiểm soát tỷ lệ vắng đồng thời tối đa | S | – |
| FR-07.10 | Thanh toán tiền phép chưa nghỉ khi chấm dứt HĐ | M | BR-36 |

---

## FR-08. Cơ cấu lương và tính lương

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-08.1 | Cấu trúc thu nhập nhiều thành phần, mỗi thành phần gắn 3 cờ độc lập: `is_insurable`, `is_taxable`, `is_prorated` | M | BR-37 |
| FR-08.2 | **Bộ máy công thức khai báo bằng dữ liệu**: đồ thị phụ thuộc, sắp thứ tự tô-pô, phát hiện phụ thuộc vòng, phiên bản theo hiệu lực | M | BR-39 |
| FR-08.3 | Công cụ chạy thử công thức với dữ liệu mẫu | M | – |
| FR-08.4 | Hỗ trợ các hình thức trả lương: thời gian (tháng/ngày/giờ), sản phẩm/khoán sản phẩm, khoán việc, doanh số – hoa hồng, 3P | M | BR-38 |
| FR-08.5 | Tính đơn giá giờ thực trả không đưa ngày lễ vào mẫu số | M | BR-15 |
| FR-08.6 | Thang bảng lương, ngạch – bậc, quy trình nâng lương định kỳ | S | – |
| FR-08.7 | Xử lý được: vào/nghỉ giữa tháng, tăng lương hiệu lực giữa kỳ, chuyển bộ phận giữa tháng, truy lĩnh/truy thu, gross-up, nghỉ dài ngày vắt hai kỳ, làm việc 2 chi nhánh | M | BR-40 |
| FR-08.8 | Chính sách làm tròn khai báo tường minh (bước nào, hàng nào) | M | BR-41 |
| FR-08.9 | Quản lý thưởng: tháng/quý/năm, KPI, lễ Tết, thâm niên, đột xuất — có kỳ chi trả riêng và ảnh hưởng thuế của tháng chi trả | M | – |
| FR-08.10 | Quản lý các khoản khấu trừ: BH phần NLĐ, thuế TNCN, đoàn phí, tạm ứng lương, bồi thường vật chất | M | BR-44 |
| FR-08.11 | **Không cài đặt chức năng trừ lương do đi trễ / về sớm / không đạt KPI / vi phạm nội quy** | M | BR-45 |
| FR-08.12 | Cơ chế thay thế: điểm chuyên cần ảnh hưởng khoản thưởng; quy trình kỷ luật 3 bước | M | BR-45 |
| FR-08.13 | Chạy thử (dry-run) không ghi nhận chính thức | M | QT-07 |
| FR-08.14 | So sánh chênh lệch với kỳ trước, liệt kê biến động vượt ngưỡng để xác nhận | M | `CP-08` |
| FR-08.15 | Giải trình từng dòng lương (drill-down): số tiền → công thức → giá trị từng biến → tham số → dữ liệu công gốc | M | – |
| FR-08.16 | Chạy bộ cổng chặn tuân thủ `CP-01`…`CP-09` trước khi chuyển sang duyệt; lưu kết quả kèm kỳ lương | M | [11](11-tuan-thu-phap-ly.md) |
| FR-08.17 | Duyệt bảng lương nhiều cấp; dữ liệu thay đổi sau khi duyệt thì hủy phê duyệt, yêu cầu duyệt lại | M | BR-43 |
| FR-08.18 | Khóa kỳ lương, lưu snapshot; điều chỉnh sau chốt chuyển sang kỳ kế tiếp có thuyết minh kỳ gốc | M | BR-42 |
| FR-08.19 | Cảnh báo đỏ trên dashboard khi sắp đến hạn chi lương mà chưa duyệt xong | M | BR-61 |
| FR-08.20 | Tự động tính tiền đền bù khi chậm trả lương quá 15 ngày, cộng vào lương thành dòng riêng | M | BR-61 |

---

## FR-09. Bảo hiểm bắt buộc và công đoàn

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-09.1 | Quản lý mức lương đóng BH riêng với lương thực trả | M | BR-47 |
| FR-09.2 | Kiểm soát sàn (≥ lương tối thiểu vùng, +7% với lao động qua đào tạo) và trần đóng | M | BR-47 |
| FR-09.3 | Tỷ lệ đóng hai phía lấy từ bảng tham số theo hiệu lực | M | BR-48 |
| FR-09.4 | Tự động xác định đối tượng tham gia theo loại HĐ và tình trạng nhân sự; xử lý ngoại lệ (người nước ngoài, đã hưởng hưu, nghỉ không lương ≥ 14 ngày/tháng) | M | BR-49 |
| FR-09.5 | Hồ sơ báo tăng / báo giảm / điều chỉnh mức đóng, kết xuất theo mẫu kê khai điện tử | M | – |
| FR-09.6 | Xử lý truy thu – thoái thu khi báo tăng/giảm muộn | M | – |
| FR-09.7 | Theo dõi thẻ BHYT: nơi khám chữa bệnh ban đầu, hạn thẻ | S | – |
| FR-09.8 | Kinh phí công đoàn 2% và đoàn phí 1% có mức trần | M | BR-50 |
| FR-09.9 | Đối chiếu số liệu với thông báo kết quả đóng BH (C12) hằng tháng, liệt kê chênh lệch theo nhân sự | M | BR-51 |

---

## FR-10. Thuế thu nhập cá nhân

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-10.1 | Phân loại đối tượng tính thuế: cư trú (7 bậc), không cư trú (20%), thời vụ (khấu trừ 10%), hỗ trợ cam kết 02/CK-TNCN | M | BR-52 |
| FR-10.2 | Quản lý các khoản giảm trừ: bản thân, người phụ thuộc theo tháng hiệu lực, BH bắt buộc, quỹ hưu trí tự nguyện có trần, từ thiện | M | BR-53 |
| FR-10.3 | **Bóc tách thu nhập miễn thuế**: phần chênh lệch OT/làm đêm, ăn giữa ca, trang phục, công tác phí khoán, điện thoại khoán trong định mức | M | BR-54 |
| FR-10.4 | Khống chế tiền thuê nhà do công ty trả không quá 15% tổng thu nhập chịu thuế (chưa gồm tiền nhà) | M | BR-54 |
| FR-10.5 | Biểu thuế lũy tiến từng phần 7 bậc, các bậc lấy từ tham số | M | BR-52 |
| FR-10.6 | Khấu trừ theo tháng → quyết toán năm; xử lý nộp thừa/thiếu; quản lý ủy quyền quyết toán | M | BR-55 |
| FR-10.7 | Kết xuất tờ khai khấu trừ tháng/quý và tờ khai quyết toán năm kèm phụ lục | M | – |
| FR-10.8 | Cấp chứng từ khấu trừ thuế TNCN bản điện tử, quản lý số seri | M | – |
| FR-10.9 | Xử lý thuế do công ty chịu thay (thu nhập NET), liên kết module gross-up | M | BR-56 |

---

## FR-11. Phúc lợi

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-11.1 | Danh mục phúc lợi: bảo hiểm sức khỏe tự nguyện, khám sức khỏe định kỳ, ăn ca, xe đưa đón, phụ cấp điện thoại, đồng phục, quà lễ Tết/sinh nhật, hiếu hỉ, du lịch, đào tạo, hỗ trợ nhà ở, trợ cấp nuôi con nhỏ | M | – |
| FR-11.2 | Điều kiện hưởng theo thâm niên, cấp bậc, loại hợp đồng, kết quả đánh giá | M | – |
| FR-11.3 | Phúc lợi linh hoạt: nhân viên tự chọn trong hạn mức điểm/ngân sách; đăng ký cho người thân | C | – |
| FR-11.4 | Theo dõi nhà cung cấp, hợp đồng bảo hiểm sức khỏe, danh sách tham gia, chi phí thực tế, hạn mức đã dùng | S | – |
| FR-11.5 | **Gắn cờ tính thuế cho từng khoản phúc lợi**, tự động đẩy vào thu nhập chịu thuế nếu thuộc diện | M | BR-37 |
| FR-11.6 | Trợ cấp thôi việc, trợ cấp mất việc làm, trợ cấp khác khi chấm dứt HĐ | M | BR-59 |

---

## FR-12. Quy trình phê duyệt (workflow)

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-12.1 | Bộ máy workflow cấu hình dùng chung cho: đơn nghỉ, đăng ký OT, giải trình công, đổi ca, tạm ứng lương, duyệt bảng lương | M | QT-13 |
| FR-12.2 | Duyệt nhiều cấp và duyệt song song, cấu hình điều kiện đủ (tất cả / bất kỳ) | M | – |
| FR-12.3 | Rẽ nhánh theo điều kiện: số ngày nghỉ, số giờ OT, giá trị tiền, loại ngày | M | BR-30 |
| FR-12.4 | Ủy quyền phê duyệt khi người duyệt đi vắng | M | – |
| FR-12.5 | Auto-escalate khi quá SLA; auto-cancel khi quá hạn cấu hình | M | BR-30 |
| FR-12.6 | Thông báo đa kênh: trong ứng dụng, email, push, Zalo/Teams/Slack | S | [10](10-tich-hop-he-thong.md) |
| FR-12.7 | Truy vết toàn bộ lịch sử thao tác trên đơn, không xóa được | M | – |

---

## FR-13. Cổng ESS và MSS

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-13.1 | ESS cho người lao động: xem bảng công cá nhân theo ngày, số dư phép, lịch sử OT, phiếu lương, nộp và theo dõi đơn từ, cập nhật thông tin cá nhân (có duyệt), đăng ký người phụ thuộc, tra cứu HĐ và phúc lợi | M | – |
| FR-13.2 | Ba hình thái web / mobile / kiosk dùng chung một backend và một mô hình quyền | M | ADR-10 |
| FR-13.3 | Kiosk: giao diện tối giản, tự đăng xuất sau 60 giây | M | – |
| FR-13.4 | **Phiếu lương bảo vệ bằng màn hình khóa**: mã PIN, vân tay/FaceID trên thiết bị, hoặc OTP gửi SMS/email | M | [09](09-phan-quyen-va-bao-mat.md) |
| FR-13.5 | Không hiển thị thông tin lương trên thông báo đẩy | M | – |
| FR-13.6 | Nút "Phản hồi sai lệch" trên phiếu lương, tạo phiếu yêu cầu giải trình gửi thẳng tới A3, có SLA xử lý | M | QT-09 |
| FR-13.7 | MSS cho quản lý: duyệt đơn, xem lịch nghỉ và bảng công của nhóm, xem chi phí nhân sự bộ phận, phê duyệt bảng công trước khi chuyển kế toán | M | – |
| FR-13.8 | Ứng dụng di động hỗ trợ đầy đủ thao tác ESS và duyệt đơn của MSS | M | – |
| FR-13.9 | Hiển thị cảnh báo màu cam cho ngày công `ERR` trên màn hình quản lý phân xưởng | M | BR-18 |

---

## FR-14. Báo cáo và phân tích

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-14.1 | Chứng từ theo mẫu kế toán: bảng chấm công, bảng thanh toán tiền lương, bảng thanh toán tiền thưởng, bảng phân bổ chi phí lương | M | [12](12-bao-cao-va-ket-xuat.md) |
| FR-14.2 | Báo cáo nghiệp vụ: OT theo bộ phận, đi muộn/về sớm, tình hình nghỉ phép, số dư phép cuối kỳ, biến động nhân sự, tỷ lệ nghỉ việc | M | – |
| FR-14.3 | Báo cáo tuân thủ: tình hình sử dụng lao động nộp Sở LĐ-TB&XH, báo cáo BHXH, báo cáo thuế | M | – |
| FR-14.4 | Phân tích chi phí nhân sự theo phòng ban / dự án / cost center, so sánh với ngân sách | M | – |
| FR-14.5 | Dashboard điều hành theo vai trò | M | – |
| FR-14.6 | Trình tạo báo cáo tùy biến, xuất Excel/PDF | S | – |
| FR-14.7 | Báo cáo giờ làm việc theo tuần phục vụ đánh giá SMETA/BSCI/RBA | S | – |

---

## FR-15. Tích hợp

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-15.1 | Kết nối máy chấm công qua API/SDK bằng dịch vụ nền chạy liên tục (Windows Service / Linux Daemon) qua TCP/IP | M | [10](10-tich-hop-he-thong.md) |
| FR-15.2 | Đồng bộ bù tự động sau khi khôi phục kết nối, bảo đảm không bỏ sót dữ liệu | M | – |
| FR-15.3 | Import file thủ công (.csv/.txt) theo cấu trúc chuẩn hóa cho máy đời cũ | M | – |
| FR-15.4 | Kết xuất file lệnh chi lương theo định dạng Bank Hub của từng ngân hàng | M | – |
| FR-15.5 | Cấu hình mặc định: **doanh nghiệp chịu phí chuyển khoản**, người lao động nhận trọn vẹn NET | M | BR-60 |
| FR-15.6 | Đẩy bút toán chi phí lương sang ERP/kế toán qua API, phân loại **Nợ TK 622** (công nhân sản xuất) và **Nợ TK 642** (khối văn phòng) theo cost center | M | – |
| FR-15.7 | Kết xuất hồ sơ tương thích cổng BHXH điện tử và thuế điện tử, hỗ trợ ký số | M | – |
| FR-15.8 | Tích hợp SSO/LDAP, email/SMS gateway | S | – |
| FR-15.9 | Đồng bộ với hệ thống tuyển dụng và đánh giá KPI | C | – |
| FR-15.10 | API mở và nhập liệu hàng loạt có xác thực | S | – |

---

## FR-16. Bảo mật và tuân thủ

| Mã | Yêu cầu | Mức | Quy tắc |
|---|---|---|---|
| FR-16.1 | Mã hóa AES-256 ở tầng CSDL cho: số CCCD, số tài khoản ngân hàng, mức lương đóng BH, mức lương thực nhận | M | [09](09-phan-quyen-va-bao-mat.md) |
| FR-16.2 | Quản lý khóa mã hóa tách biệt, có quy trình xoay khóa | M | – |
| FR-16.3 | **Audit log append-only**: thu hồi quyền UPDATE/DELETE ở tầng CSDL, chuỗi băm liên kết, tác vụ kiểm tra toàn vẹn định kỳ | M | – |
| FR-16.4 | Mỗi bản ghi audit log lưu: người thực hiện, thời điểm, giá trị cũ, giá trị mới, địa chỉ IP, lý do thay đổi, mã tham chiếu đơn | M | BR-22 |
| FR-16.5 | Không xóa cứng: xóa mềm có ngày và lý do cho toàn bộ thực thể nghiệp vụ | M | BR-63 |
| FR-16.6 | Xác thực: tài khoản nội bộ + hook SSO/LDAP, chính sách mật khẩu, khóa tài khoản, quản lý phiên và thu hồi phiên tức thời | M | – |
| FR-16.7 | Lưu trữ dữ liệu chấm công và tiền lương tối thiểu 3 năm; sao lưu định kỳ có kiểm chứng phục hồi | M | BR-64 |
| FR-16.8 | Ghi nhật ký truy cập dữ liệu nhạy cảm, kể cả truy cập bị từ chối | M | – |
| FR-16.9 | Bộ kiểm thử tuân thủ và bộ dữ liệu nghiệm thu chạy tự động trong CI | M | [05 §11](05-thuat-toan-cham-cong-va-tinh-luong.md) |

---

## Bảng tổng hợp mức ưu tiên

| Phân hệ | Must | Should | Could | Ghi chú |
|---|---|---|---|---|
| FR-01 Nền tảng | 12 | 0 | 0 | Nền tảng của mọi phân hệ khác |
| FR-02 Hồ sơ nhân sự | 7 | 1 | 0 | |
| FR-03 Hợp đồng | 6 | 1 | 0 | |
| FR-04 Ca làm việc | 7 | 0 | 0 | |
| FR-05 Dữ liệu chấm công | 16 | 1 | 0 | **Ưu tiên cao nhất giai đoạn 1** |
| FR-06 Làm thêm giờ | 9 | 2 | 0 | **Ưu tiên cao nhất giai đoạn 1** |
| FR-07 Nghỉ phép | 9 | 1 | 0 | |
| FR-08 Tính lương | 20 | 1 | 0 | |
| FR-09 Bảo hiểm | 8 | 1 | 0 | |
| FR-10 Thuế TNCN | 9 | 0 | 0 | |
| FR-11 Phúc lợi | 4 | 1 | 1 | |
| FR-12 Workflow | 6 | 1 | 0 | |
| FR-13 ESS/MSS | 9 | 0 | 0 | |
| FR-14 Báo cáo | 5 | 2 | 0 | |
| FR-15 Tích hợp | 7 | 2 | 1 | |
| FR-16 Bảo mật | 9 | 0 | 0 | |
