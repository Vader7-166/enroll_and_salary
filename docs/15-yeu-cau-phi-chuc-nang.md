# 15. Yêu cầu phi chức năng

Mỗi yêu cầu có mã `NFR-xx` và **cách đo** để nghiệm thu được.

R1 áp dụng **60 NFR** dưới đây theo [19](19-pham-vi-ban-dau-va-ma-tran-nghiem-thu.md), gồm
đo hiệu năng và kiểm chứng khôi phục trước nghiệm thu, không đợi giai đoạn sau. Nội dung
tùy chọn chỉ áp dụng khi có yêu cầu tương ứng; R1 dùng tiếng Việt, thông báo trong ứng dụng,
không mặc định bổ sung email/đa ngôn ngữ hoặc tích hợp ngoài để đạt một NFR có điều kiện.

---

## 1. Độ chính xác số học

| Mã | Yêu cầu | Cách đo |
|---|---|---|
| **NFR-01** | Mọi số tiền dùng kiểu **decimal** có độ chính xác xác định. **Cấm dùng float** | Quy tắc lint/test tự động chặn kiểu float trên cột và biến tiền tệ; chạy trong CI |
| **NFR-02** | Chính sách làm tròn khai báo tường minh: làm tròn ở bước nào, đến hàng nào | Cấu hình hiển thị được trên giao diện; test đối chiếu hai chiến lược (làm tròn từng thành phần vs làm tròn tổng) |
| **NFR-03** | Tính lương idempotent theo bộ nguồn CONFIRMED/hash/phương án; nhập lại không cộng tiền hai lần, thiếu dữ liệu không tự thành 0 | UAT-12, TC-P06, TC-I01…TC-I12; so từng dòng payroll_line, version nguồn và kết quả 9 fixture trong 18 |
| **NFR-04** | Gross-up hội tụ với sai số ≤ **1 đồng** | TC-P03; kiểm thử với 50 mức NET khác nhau trải đủ các bậc của biểu 5 bậc (2026) và 7 bậc (2025) |
| **NFR-05** | Tra tham số theo thời gian nghiệp vụ của từng loại: lương/BH theo kỳ gốc, TNCN theo thời điểm chi trả và bộ quy tắc tương ứng; tái hiện hồ sơ đã khai dùng snapshot | TC-P05, TC-T04/05/09/10: qua năm chi trả, mốc 01/07 ăn ca và chuyển tiếp không ghi đè hồ sơ lịch sử |
| **NFR-06** | Hệ số OT là kết quả tính từ công thức, không phải hằng số | TC-O05 / TC-O05b: đổi riêng OT ngày thường lên 160% → OT đêm **222%** khi đã có OT ban ngày, **210%** khi chưa có; TC-O05c: OT ban ngày thường **160%**, OT đêm nghỉ hằng tuần / lễ Tết vẫn **270% / 390%** |

---

## 2. Hiệu năng

| Mã | Yêu cầu | Ngưỡng | Cách đo |
|---|---|---|---|
| **NFR-07** | Tính lương toàn bộ nhân sự | ≤ 15 phút cho **3.000 nhân sự** (quy mô tối đa, 4 cơ sở) | Đo trên bộ dữ liệu mô phỏng đầy đủ, từ **giai đoạn sớm** của dự án |
| **NFR-08** | Ghép cặp, tách đoạn giờ sau khi nhập tệp chấm công | ≤ 5 phút cho tệp một ngày của cơ sở lớn nhất (≈ 4.500 lượt quẹt) | Đo tự động sau mỗi lần nhập |
| **NFR-09** | Truy vấn bảng công của tổ (TT) / xưởng (QĐ) | ≤ 2 giây (tổ) · ≤ 4 giây (xưởng) | Đo p95 |
| **NFR-10** | Xuất phiếu lương PDF cho toàn bộ một cơ sở (≈ 1.100 tệp) | ≤ 10 phút | Đo trên dữ liệu mô phỏng |
| **NFR-11** | Drill-down một dòng lương | ≤ 3 giây | Đo p95 |
| **NFR-12** | Kết xuất báo cáo tháng toàn công ty | ≤ 2 phút | Đo trên dữ liệu 3.000 nhân sự |
| **NFR-13** | Kiểm tra và trả kết quả nhập tệp chấm công | ≤ 1 phút cho tệp 10.000 dòng | Đo p95 |

> **Rủi ro đã lường trước.** Formula engine khai báo bằng dữ liệu chậm hơn mã biên dịch. Biện
> pháp: cache tham số và định nghĩa công thức trong một lần chạy lô; đo hiệu năng với 3.000
> nhân sự **từ giai đoạn sớm**, không để tới khi nghiệm thu mới phát hiện.

---

## 3. Xử lý theo lô

| Mã | Yêu cầu |
|---|---|
| **NFR-14** | Tính lương chạy theo lô, chia lô theo đơn vị tổ chức hoặc dải mã nhân viên |
| **NFR-15** | Hiển thị tiến độ theo thời gian thực; cho phép dừng an toàn giữa chừng |
| **NFR-16** | **Cô lập lỗi**: lỗi ở một nhân sự không làm hỏng cả lô; ghi vào danh sách cần xử lý |
| **NFR-17** | Chạy lại toàn bộ hoặc một phần lô đều cho cùng kết quả |
| **NFR-18** | Ghi lại `param_snapshot_hash` và tập phiên bản công thức đã dùng cho mỗi lần chạy |

---

## 4. Khả năng cấu hình

| Mã | Yêu cầu | Kiểm chứng |
|---|---|---|
| **NFR-19** | **Ưu tiên cấu hình hơn lập trình**: chính sách thay đổi thì sửa tham số, không sửa mã | Thay đổi lương tối thiểu vùng, tỷ lệ BH, bậc thuế, hệ số OT đều thực hiện qua giao diện |
| **NFR-20** | Không hardcode bất kỳ giá trị pháp lý nào trong mã nguồn | Rà soát mã nguồn tự động tìm hằng số nghi vấn (5310000, 0.08, 0.015, 150%, …) |
| **NFR-21** | Thêm ngân hàng mới, thêm loại máy chấm công mới là khai báo cấu hình | Kiểm chứng bằng thao tác thực tế, không triển khai mã |
| **NFR-22** | Công thức lương sửa được qua giao diện, có phiên bản theo hiệu lực và công cụ chạy thử | Sửa công thức phụ cấp → chạy thử → áp dụng, không cần triển khai |
| **NFR-23** | Cấu hình chính sách kế thừa theo cây tổ chức, hiển thị nguồn gốc giá trị đang có hiệu lực | Giao diện chỉ rõ giá trị đến từ đơn vị nào |

---

## 5. Khả năng truy vết

| Mã | Yêu cầu |
|---|---|
| **NFR-24** | Mỗi con số trên bảng lương truy vết ngược được tới: công thức → giá trị từng biến → tham số đã dùng → dữ liệu công gốc → lượt quẹt thẻ |
| **NFR-25** | Mọi thay đổi dữ liệu nghiệp vụ ghi audit log đủ trường bắt buộc (người, thời điểm, cũ, mới, IP, lý do) |
| **NFR-26** | Audit log không thể sửa/xóa kể cả bởi quản trị viên; có chuỗi băm và tác vụ kiểm tra toàn vẹn định kỳ |
| **NFR-27** | Không xóa cứng dữ liệu; xóa mềm có ngày và lý do |
| **NFR-28** | Snapshot kỳ đã **khóa** bất biến kèm hash; khóa nguyên tử theo revision. Log qua ngày chốt gán theo ca, log muộn không đổi snapshot/không sinh trùng; kiểm chứng TC-A04…TC-A04f và TC-K01…TC-K08 |

---

## 6. Bảo mật

| Mã | Yêu cầu |
|---|---|
| **NFR-29** | Mã hóa **AES-256** ở tầng CSDL cho: số CCCD, số tài khoản ngân hàng, mức lương đóng BH, mức lương thực nhận |
| **NFR-30** | Khóa mã hóa lưu tách biệt khỏi CSDL, có quy trình xoay khóa định kỳ |
| **NFR-31** | TLS cho mọi kênh truyền, kể cả mạng nội bộ nhà máy |
| **NFR-32** | Kiểm soát truy cập hai trục (vai trò TT / QĐ / KT / AD + đơn vị phạm vi), áp cho **cả API, báo cáo và tệp kết xuất** |
| **NFR-33** | Xác thực bổ sung với thao tác nhạy cảm: thay đổi tham số pháp lý, khóa kỳ, xác nhận hồi tố, xuất file chi lương; phiếu lương PDF đặt mật khẩu |
| **NFR-34** | Thu hồi phiên tức thời, có hiệu lực ngay |
| **NFR-35** | Phiên trên máy trạm dùng chung tại xưởng tự hết hạn sau 15 phút không thao tác (cấu hình được) |
| **NFR-36** | Ghi audit log mọi truy cập dữ liệu nhạy cảm, **kể cả truy cập bị từ chối** |

---

## 7. Khả dụng và phục hồi

| Mã | Yêu cầu | Ngưỡng |
|---|---|---|
| **NFR-37** | Thời gian hoạt động trong giờ làm việc | ≥ 99,5% |
| **NFR-38** | **RPO** (Recovery Point Objective) | ≤ 1 giờ |
| **NFR-39** | **RTO** (Recovery Time Objective) | ≤ 4 giờ |
| **NFR-40** | Sao lưu định kỳ, bản sao lưu được mã hóa | Hằng ngày |
| **NFR-41** | Diễn tập phục hồi có biên bản | Định kỳ 6 tháng |
| **NFR-42** | Nhập tệp chấm công lỗi **không làm hỏng dữ liệu**: lô lỗi bị từ chối toàn bộ; nhập lại cùng tệp không tạo bản ghi trùng | Kiểm chứng bằng UAT-16 |
| **NFR-43** | Lỗi khi tạo tệp kết xuất (file chi lương, danh sách BH, báo cáo) **không làm thay đổi** dữ liệu nghiệp vụ; kết xuất lại được | Kiểm thử lỗi giữa chừng |

---

## 8. Lưu trữ và mở rộng

| Mã | Yêu cầu |
|---|---|
| **NFR-44** | Lưu trữ dữ liệu chấm công và tiền lương **≥ 3 năm** |
| **NFR-45** | Audit log không xóa; chuyển sang lưu trữ nguội khi cũ, vẫn truy vấn được |
| **NFR-46** | Phân vùng dữ liệu theo kỳ để giữ hiệu năng khi khối lượng tăng |
| **NFR-47** | Kiến trúc đáp ứng quy mô **1.500 – 3.000 nhân sự trên 4 cơ sở** và dự phòng tăng trưởng 3 năm (PV5-16) |
| **NFR-48** | Kiến trúc **không phụ thuộc** vào lựa chọn on-premise hay cloud (PV5-14 chưa chốt) |

---

## 9. Khả dụng cho người dùng

| Mã | Yêu cầu | Đối tượng |
|---|---|---|
| **NFR-49** | Giao diện xưởng: thao tác chính (giải trình công, ghi nhận đơn nghỉ, đề xuất OT cho nhiều công nhân) hoàn thành trong ≤ **3 bước** | TT |
| **NFR-50** | Ứng dụng web tương thích máy tính bảng tại xưởng; không có ứng dụng di động riêng | TT, QĐ |
| **NFR-51** | Duyệt lịch ca, đề xuất OT trong ≤ **2 thao tác** | QĐ |
| **NFR-52** | Thông báo lỗi nghiệp vụ nêu rõ: nguyên nhân, danh sách bản ghi vi phạm, liên kết xử lý, và dẫn chiếu điều khoản pháp luật (với lỗi tuân thủ) | Toàn bộ |
| **NFR-53** | Giao diện tiếng Việt; hỗ trợ đa ngôn ngữ nếu có nhu cầu (PV5-20 chưa chốt) | Toàn bộ |
| **NFR-54** | Bảng biểu hỗ trợ thao tác hàng loạt, nhập / xuất tệp | KT, AD |

---

## 10. Chất lượng mã và kiểm thử

| Mã | Yêu cầu |
|---|---|
| **NFR-55** | Bộ kiểm thử tuân thủ chạy tự động trong CI, đối chiếu kết quả tính với **bảng quy đổi trong văn bản pháp luật** |
| **NFR-56** | Bộ dữ liệu nghiệm thu cố định (TC-A01…TC-L02, xem [06 §11](06-thuat-toan-cham-cong-va-tinh-luong.md)) chạy mỗi lần build |
| **NFR-57** | Kiểm thử riêng cho **6 tình huống biên của ca đêm bắc cầu** |
| **NFR-58** | Kiểm thử phân quyền: TT chỉ thấy tổ mình, QĐ chỉ thấy xưởng mình, KT theo phạm vi được giao, AD không xem lương chi tiết, exclusion list hoạt động |
| **NFR-59** | Kiểm thử hiệu năng với 3.000 nhân sự chạy định kỳ, không chỉ trước nghiệm thu |
| **NFR-60** | Quy tắc lint chặn: dùng float cho tiền, hardcode giá trị pháp lý, tra tham số theo ngày hiện tại |

---

## 11. Tổng hợp ngưỡng nghiệm thu

| Nhóm | Ngưỡng then chốt |
|---|---|
| Độ chính xác | Gross-up sai số ≤ 1 đồng · Tính lương idempotent 100% · Không dùng float |
| Hiệu năng | Tính lương 3.000 NV ≤ 15 phút · Xem bảng công tổ ≤ 2s · Drill-down ≤ 3s |
| Khả dụng | Uptime ≥ 99,5% · RPO ≤ 1h · RTO ≤ 4h |
| Bảo mật | AES-256 trường nhạy cảm · Audit log bất biến · Phiếu lương PDF có mật khẩu |
| Lưu trữ | ≥ 3 năm · Audit log không xóa |
| Tuân thủ | 100% bộ kiểm thử pháp lý đạt · Cổng chặn `CP-01`…`CP-09` hoạt động |
