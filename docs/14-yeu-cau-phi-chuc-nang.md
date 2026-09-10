# 14. Yêu cầu phi chức năng

Mỗi yêu cầu có mã `NFR-xx` và **cách đo** để nghiệm thu được.

---

## 1. Độ chính xác số học

| Mã | Yêu cầu | Cách đo |
|---|---|---|
| **NFR-01** | Mọi số tiền dùng kiểu **decimal** có độ chính xác xác định. **Cấm dùng float** | Quy tắc lint/test tự động chặn kiểu float trên cột và biến tiền tệ; chạy trong CI |
| **NFR-02** | Chính sách làm tròn khai báo tường minh: làm tròn ở bước nào, đến hàng nào | Cấu hình hiển thị được trên giao diện; test đối chiếu hai chiến lược (làm tròn từng thành phần vs làm tròn tổng) |
| **NFR-03** | Tính lương **idempotent**: chạy lại cùng dữ liệu đầu vào cho cùng kết quả tuyệt đối | UAT-12, TC-P06: chạy 2 lần, so khớp từng dòng `payroll_line` |
| **NFR-04** | Gross-up hội tụ với sai số ≤ **1 đồng** | TC-P03; kiểm thử với 50 mức NET khác nhau trải đủ 7 bậc thuế |
| **NFR-05** | Tra tham số theo **ngày nghiệp vụ**, không theo ngày chạy | TC-P05: chạy lại kỳ cũ ra tham số cũ |
| **NFR-06** | Hệ số OT là kết quả tính từ công thức, không phải hằng số | TC-O05: đổi tham số hệ số OT ngày → hệ số OT đêm tự đổi tương ứng |

---

## 2. Hiệu năng

| Mã | Yêu cầu | Ngưỡng | Cách đo |
|---|---|---|---|
| **NFR-07** | Tính lương toàn bộ nhân sự | ≤ 15 phút cho **1.000 nhân sự** | Đo trên bộ dữ liệu mô phỏng đầy đủ, từ **giai đoạn sớm** của dự án |
| **NFR-08** | Xử lý dữ liệu chấm công hằng ngày | ≤ 5 phút cho toàn bộ log một ngày (≈ 4.000 lượt quẹt) | Đo tự động sau mỗi lần đồng bộ |
| **NFR-09** | Truy vấn bảng công cá nhân trên ESS/kiosk | ≤ 2 giây | Đo p95 |
| **NFR-10** | Mở phiếu lương sau khi xác thực | ≤ 3 giây | Đo p95 |
| **NFR-11** | Drill-down một dòng lương | ≤ 3 giây | Đo p95 |
| **NFR-12** | Kết xuất báo cáo tháng toàn công ty | ≤ 2 phút | Đo trên dữ liệu 1.000 nhân sự |
| **NFR-13** | Đồng bộ dữ liệu quẹt thẻ từ thiết bị | Độ trễ ≤ 5 phút ở chế độ thời gian thực | Giám sát liên tục |

> **Rủi ro đã lường trước.** Formula engine khai báo bằng dữ liệu chậm hơn mã biên dịch. Biện
> pháp: cache tham số và định nghĩa công thức trong một lần chạy lô; đo hiệu năng với 1.000
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
| **NFR-28** | Snapshot kỳ đã chốt kèm mã băm; truy vấn kỳ cũ luôn trả về dữ liệu snapshot |

---

## 6. Bảo mật

| Mã | Yêu cầu |
|---|---|
| **NFR-29** | Mã hóa **AES-256** ở tầng CSDL cho: số CCCD, số tài khoản ngân hàng, mức lương đóng BH, mức lương thực nhận |
| **NFR-30** | Khóa mã hóa lưu tách biệt khỏi CSDL, có quy trình xoay khóa định kỳ |
| **NFR-31** | TLS cho mọi kênh truyền, kể cả kênh nội bộ tới dịch vụ nền chấm công |
| **NFR-32** | Kiểm soát truy cập hai trục (vai trò + phạm vi dữ liệu), áp cho **cả API và báo cáo** |
| **NFR-33** | Xác thực bổ sung khi xem phiếu lương (PIN / sinh trắc / OTP) |
| **NFR-34** | Thu hồi phiên tức thời, có hiệu lực ngay |
| **NFR-35** | Phiên kiosk tự đăng xuất sau 60 giây không thao tác |
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
| **NFR-42** | Mất kết nối máy chấm công **không làm mất dữ liệu** — thiết bị buffer, hệ thống đồng bộ bù | Kiểm chứng bằng UAT-16 |
| **NFR-43** | Lỗi tích hợp ngoại vi (ngân hàng, ERP, cổng BHXH) **không chặn** luồng chấm công – tính lương | Hàng đợi có thử lại và hàng đợi lỗi |

---

## 8. Lưu trữ và mở rộng

| Mã | Yêu cầu |
|---|---|
| **NFR-44** | Lưu trữ dữ liệu chấm công và tiền lương **≥ 3 năm** |
| **NFR-45** | Audit log không xóa; chuyển sang lưu trữ nguội khi cũ, vẫn truy vấn được |
| **NFR-46** | Phân vùng dữ liệu theo kỳ để giữ hiệu năng khi khối lượng tăng |
| **NFR-47** | Kiến trúc đáp ứng quy mô hiện tại **1.000 nhân sự** và dự phòng tăng trưởng 3 năm (PV5-16) |
| **NFR-48** | Kiến trúc **không phụ thuộc** vào lựa chọn on-premise hay cloud (PV5-14 chưa chốt) |

---

## 9. Khả dụng cho người dùng

| Mã | Yêu cầu | Đối tượng |
|---|---|---|
| **NFR-49** | Giao diện kiosk tối giản: thao tác chính hoàn thành trong ≤ **3 bước** | C1 — công nhân trực tiếp, ít dùng máy tính |
| **NFR-50** | Ứng dụng di động hỗ trợ đầy đủ thao tác ESS và duyệt đơn MSS | C1, B1, B2 |
| **NFR-51** | Duyệt đơn trên di động trong ≤ **2 thao tác** | B1, B2 |
| **NFR-52** | Thông báo lỗi nghiệp vụ nêu rõ: nguyên nhân, danh sách bản ghi vi phạm, liên kết xử lý, và dẫn chiếu điều khoản pháp luật (với lỗi tuân thủ) | Toàn bộ |
| **NFR-53** | Giao diện tiếng Việt; hỗ trợ đa ngôn ngữ nếu có nhu cầu (PV5-20 chưa chốt) | Toàn bộ |
| **NFR-54** | Bảng biểu hỗ trợ thao tác hàng loạt cho vai trò vận hành | A1, A3, A2 |

---

## 10. Chất lượng mã và kiểm thử

| Mã | Yêu cầu |
|---|---|
| **NFR-55** | Bộ kiểm thử tuân thủ chạy tự động trong CI, đối chiếu kết quả tính với **bảng quy đổi trong văn bản pháp luật** |
| **NFR-56** | Bộ dữ liệu nghiệm thu cố định (TC-A01…TC-L02, xem [05 §11](05-thuat-toan-cham-cong-va-tinh-luong.md)) chạy mỗi lần build |
| **NFR-57** | Kiểm thử riêng cho **6 tình huống biên của ca đêm bắc cầu** |
| **NFR-58** | Kiểm thử phân quyền: trưởng bộ phận chỉ thấy nhân sự phòng mình, nhân viên chỉ thấy dữ liệu của mình, exclusion list hoạt động |
| **NFR-59** | Kiểm thử hiệu năng với 1.000 nhân sự chạy định kỳ, không chỉ trước nghiệm thu |
| **NFR-60** | Quy tắc lint chặn: dùng float cho tiền, hardcode giá trị pháp lý, tra tham số theo ngày hiện tại |

---

## 11. Tổng hợp ngưỡng nghiệm thu

| Nhóm | Ngưỡng then chốt |
|---|---|
| Độ chính xác | Gross-up sai số ≤ 1 đồng · Tính lương idempotent 100% · Không dùng float |
| Hiệu năng | Tính lương 1.000 NV ≤ 15 phút · Xem bảng công ≤ 2s · Drill-down ≤ 3s |
| Khả dụng | Uptime ≥ 99,5% · RPO ≤ 1h · RTO ≤ 4h |
| Bảo mật | AES-256 trường nhạy cảm · Audit log bất biến · Xác thực khi xem payslip |
| Lưu trữ | ≥ 3 năm · Audit log không xóa |
| Tuân thủ | 100% bộ kiểm thử pháp lý đạt · Cổng chặn `CP-01`…`CP-09` hoạt động |
