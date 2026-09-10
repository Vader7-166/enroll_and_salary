# 09. Phân quyền và bảo mật

Dữ liệu tiền lương và thông tin nhân thân là **dữ liệu cá nhân nhạy cảm** theo NĐ 13/2023/NĐ-CP.
Tài liệu này đặc tả mô hình kiểm soát truy cập, bảo vệ dữ liệu và nhật ký kiểm toán.

---

## 1. Mô hình kiểm soát truy cập hai trục

Một hành động chỉ được thực hiện khi thỏa mãn **đồng thời** cả hai trục:

```
            TRỤC 1 · VAI TRÒ                       TRỤC 2 · PHẠM VI DỮ LIỆU
         "được làm hành động gì"                  "được làm trên tập nhân sự nào"
                    │                                        │
                    └────────────────┬───────────────────────┘
                                     ▼
                          ┌──────────────────────┐
                          │  CHO PHÉP / TỪ CHỐI   │
                          └──────────┬───────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
          ┌──────────────────┐            ┌──────────────────────┐
          │ EXCLUSION LIST    │            │ CHE TRƯỜNG NHẠY CẢM  │
          │ ẩn hồ sơ nhóm     │            │ theo quyền chi tiết  │
          │ đặc biệt          │            │                      │
          └──────────────────┘            └──────────────────────┘
```

### 1.1. Trục vai trò

| Vai trò | Actor | Mô tả |
|---|---|---|
| `SYSTEM_ADMIN` | E2 | Quản trị tài khoản, danh mục, tham số; **không có** quyền sửa/xóa audit log |
| `HR_MANAGER` | A5 | Duyệt chính sách, duyệt bảng lương cấp 1, xem toàn bộ báo cáo |
| `HR_PAYROLL` | A3 | Cấu hình lương, chạy tính lương, chốt kỳ, phát hành payslip |
| `HR_TIMEKEEPER` | A1 | Nạp và xử lý dữ liệu chấm công, xử lý ngoại lệ |
| `HR_RECORDS` | A2 | Hồ sơ nhân sự, hợp đồng |
| `HR_INSURANCE_TAX` | A4 | BHXH, thuế TNCN, người phụ thuộc |
| `LINE_LEADER` | B1 | Xếp ca tổ, xác nhận công, duyệt đơn cấp 1 |
| `WORKSHOP_MANAGER` | B2 | Duyệt lịch ca xưởng, duyệt OT cấp 2 |
| `PRODUCTION_PLANNER` | B3 | Xem dữ liệu tổng hợp phục vụ kế hoạch |
| `PAYROLL_ACCOUNTANT` | D1 | Đối chiếu chi phí, lập lệnh chi, đẩy bút toán |
| `CHIEF_ACCOUNTANT` | D2 | Duyệt bảng lương cấp 2, kiểm soát ngân sách |
| `PLANT_DIRECTOR` | D3 | Duyệt định biên, duyệt OT lớn, dashboard |
| `BOARD` | D4 | Phê duyệt cuối, báo cáo tổng hợp |
| `UNION_CHAIR` | E1 | Đoàn phí, giám sát OT và nghỉ phép |
| `IT_OPERATOR` | E3 | Vận hành job đồng bộ, xử lý sự cố tích hợp |
| `EMPLOYEE` | C1/C2/C3 | Dữ liệu của chính mình |

### 1.2. Trục phạm vi dữ liệu

| Phạm vi | Tập nhân sự truy cập được |
|---|---|
| `SELF` | Chỉ bản thân |
| `TEAM` | Tổ / nhóm trực thuộc |
| `DEPARTMENT` | Phòng ban / phân xưởng, **bao gồm toàn bộ cây con** |
| `SITE` | Toàn bộ một địa điểm (trụ sở hoặc nhà máy) |
| `ALL` | Toàn doanh nghiệp |

**Quy tắc bắt buộc:** `TEAM` và `DEPARTMENT` được **suy ra động từ cây tổ chức tại thời
điểm truy vấn**, không lưu cứng danh sách nhân sự. Nhân sự điều chuyển thì phạm vi tự thay đổi.

### 1.3. Exclusion list

Cho phép ẩn hồ sơ và dữ liệu lương của một nhóm nhân sự (ví dụ Ban Giám đốc) khỏi tầm nhìn
của các tài khoản HR cấp thấp, **kể cả khi phạm vi dữ liệu của họ là `ALL`**.

> **Quy tắc phản hồi:** trả về **kết quả rỗng**, không trả lỗi 403 — vì lỗi 403 tiết lộ sự
> tồn tại của bản ghi.

### 1.4. Che trường nhạy cảm

Khi vai trò không có quyền chi tiết tương ứng, hệ thống trả về hồ sơ nhưng **che trường**:

| Trường | Quyền yêu cầu |
|---|---|
| Số tài khoản ngân hàng | `employee.view_bank` |
| Số CCCD / định danh cá nhân | `employee.view_national_id` |
| Mức lương, phụ cấp, cấu phần thu nhập | `payroll.view_detail` |
| Mức lương đóng bảo hiểm | `insurance.view_detail` |

Truy cập che trường được ghi audit log với kết quả `PARTIAL_MASKED`.

---

## 2. Ma trận quyền theo hành động

**✔** = toàn quyền · **◐** = chỉ phạm vi được cấp · **👁** = chỉ xem · **–** = không có quyền

| Hành động | ADMIN | HR_MGR | HR_PAY | HR_TIME | HR_REC | HR_INS | LINE | WKSHOP | ACC | CH_ACC | DIR | BOARD | UNION | EMP |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Quản lý tài khoản, phân quyền | ✔ | – | – | – | – | – | – | – | – | – | – | – | – | – |
| Cấu hình tham số pháp lý | ✔ | 👁 | 👁 | – | – | 👁 | – | – | – | 👁 | – | – | – | – |
| Cấu hình cây tổ chức | ✔ | ✔ | – | – | – | – | – | – | – | – | 👁 | 👁 | – | – |
| Xem hồ sơ nhân sự | 👁 | ✔ | ◐ | ◐ | ✔ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | 👁 | 👁 | ◐ SELF |
| Sửa hồ sơ nhân sự | – | ✔ | – | – | ✔ | – | – | – | – | – | – | – | – | ◐ có duyệt |
| Xem số CCCD, tài khoản NH | – | ✔ | ✔ | – | ✔ | ✔ | – | – | ✔ | ✔ | – | – | – | ◐ SELF |
| Quản lý hợp đồng lao động | – | ✔ | 👁 | – | ✔ | 👁 | – | – | – | – | 👁 | 👁 | 👁 | 👁 SELF |
| Xếp lịch ca | – | 👁 | – | ◐ | – | – | ◐ | ◐ | – | – | 👁 | – | – | 👁 SELF |
| Nạp / sửa dữ liệu chấm công | – | 👁 | ◐ | ✔ | – | – | 👁 ◐ | 👁 ◐ | – | – | – | – | – | 👁 SELF |
| Xác nhận công của tổ | – | 👁 | 👁 | ◐ | – | – | ✔ ◐ | ✔ ◐ | – | – | – | – | – | – |
| Chốt & khóa kỳ công | – | 👁 | ✔ | ◐ | – | – | – | – | – | – | – | – | – | – |
| Duyệt OT | – | ✔ cấp 2 | 👁 | 👁 | – | – | ✔ đề xuất | ✔ cấp 1 | – | – | ✔ lớn | – | 👁 | – |
| Duyệt đơn nghỉ | – | ✔ cấp 2 | 👁 | 👁 | – | 👁 | ✔ cấp 1 | ✔ cấp 1 | – | – | – | – | 👁 | – |
| Cấu hình cấu phần lương, công thức | – | ✔ | ✔ | – | – | – | – | – | – | 👁 | – | – | – | – |
| Chạy tính lương (dry-run) | – | 👁 | ✔ | – | – | – | – | – | 👁 | 👁 | – | – | – | – |
| Xem chi tiết bảng lương | – | ✔ | ✔ | – | – | ◐ | – | – | ✔ | ✔ | 👁 tổng hợp | 👁 tổng hợp | – | ◐ SELF |
| Duyệt bảng lương | – | ✔ cấp 1 | – | – | – | – | – | – | – | ✔ cấp 2 | – | ✔ cuối | – | – |
| Khóa kỳ lương | – | 👁 | ✔ | – | – | – | – | – | – | 👁 | – | – | – | – |
| Mở khóa kỳ đã chốt | – | ✔ + lý do | – | – | – | – | – | – | – | 👁 | – | 👁 | – | – |
| Lập lệnh chi ngân hàng | – | 👁 | 👁 | – | – | – | – | – | ✔ | ✔ | – | – | – | – |
| Đẩy bút toán ERP | – | – | 👁 | – | – | – | – | – | ✔ | ✔ | – | – | – | – |
| Hồ sơ BHXH, thuế | – | ✔ | 👁 | – | – | ✔ | – | – | 👁 | 👁 | – | – | 👁 đoàn phí | 👁 SELF |
| Xem nhật ký kiểm toán | 👁 | 👁 | 👁 ◐ | – | – | – | – | – | – | 👁 | – | 👁 | 👁 ◐ | – |
| Vận hành job đồng bộ | ✔ | – | – | 👁 | – | – | – | – | – | – | – | – | – | ✔ |

---

## 3. Bảo vệ dữ liệu cá nhân (NĐ 13/2023/NĐ-CP)

### 3.1. Phân loại dữ liệu

| Mức | Dữ liệu | Biện pháp |
|---|---|---|
| **Nhạy cảm** | Số CCCD/định danh, số tài khoản ngân hàng, mức lương đóng BH, mức lương thực nhận | Mã hóa AES-256 tầng CSDL + che trường + audit log truy cập |
| **Cá nhân cơ bản** | Họ tên, ngày sinh, địa chỉ, số điện thoại, email | Kiểm soát phạm vi truy cập + audit log |
| **Nghiệp vụ** | Dữ liệu công, ca làm việc, đơn từ | Kiểm soát phạm vi truy cập |
| **Tham chiếu** | Danh mục, tham số pháp lý | Công khai trong hệ thống |

### 3.2. Mã hóa

| Yêu cầu | Đặc tả |
|---|---|
| Thuật toán | **AES-256** ở tầng cơ sở dữ liệu (Database Encryption) |
| Phạm vi | Các trường đánh dấu 🔒 trong [08](08-mo-hinh-du-lieu.md) |
| Quản lý khóa | Khóa mã hóa lưu **tách biệt** khỏi CSDL, có quy trình xoay khóa định kỳ |
| Truyền tải | HTTPS/TLS cho mọi kênh, kể cả kênh nội bộ tới dịch vụ nền chấm công |
| Đối chiếu trùng | Nếu cần kiểm tra trùng CCCD: dùng trường **băm có muối**, không giải mã hàng loạt |
| Chỉ mục | Chỉ đánh chỉ mục trên trường không mã hóa — tránh mất khả năng tìm kiếm |

> **Trade-off đã cân nhắc.** Mã hóa cột làm chậm truy vấn và mất khả năng tìm kiếm trực tiếp.
> Giải pháp: chỉ mã hóa tập trường thực sự nhạy cảm, giữ trường băm cho nhu cầu đối chiếu.

### 3.3. Bảo mật khi xem phiếu lương

```
   Thông báo đẩy "Phiếu lương tháng 09/2026 đã sẵn sàng"
   ⚠ KHÔNG hiển thị bất kỳ con số lương nào trên thông báo
                        │
                        ▼
   Người lao động bấm xem
                        │
                        ▼
   ┌─────────────────────────────────────────────┐
   │  MÀN HÌNH KHÓA BẮT BUỘC — chọn một trong:    │
   │  • Mã PIN cá nhân                            │
   │  • Vân tay / FaceID trên thiết bị            │
   │  • OTP gửi SMS / email đã đăng ký            │
   └────────────────────┬────────────────────────┘
                        │ xác thực thành công
                        ▼
   Hiển thị chi tiết phiếu lương
   Ghi audit log: VIEW_SENSITIVE + thời điểm + IP + phương thức xác thực
```

**Ràng buộc bổ sung:**

- Trên **kiosk dùng chung**: bắt buộc OTP hoặc PIN, tự đăng xuất sau **60 giây** không thao tác.
- Không cho phép chụp màn hình trên ứng dụng di động (nếu nền tảng hỗ trợ).
- Phiếu lương kết xuất PDF phải đặt mật khẩu mở tệp.

### 3.4. Quyền của chủ thể dữ liệu

| Quyền | Cài đặt trong hệ thống |
|---|---|
| Được biết | ESS hiển thị các loại dữ liệu hệ thống lưu về mình |
| Truy cập | ESS cho phép xem và tải hồ sơ cá nhân |
| Chỉnh sửa | Đề nghị cập nhật thông tin cá nhân qua luồng duyệt |
| Phản đối / khiếu nại | Nút "Phản hồi sai lệch" trên phiếu lương và bảng công |
| Được thông báo vi phạm | Quy trình thông báo khi phát hiện sự cố dữ liệu |

---

## 4. Nhật ký kiểm toán bất biến

### 4.1. Yêu cầu gốc

> Nhật ký kiểm toán là **chỉ đọc**, "không thể bị sửa, xóa hay ghi đè bởi bất kỳ quyền năng
> nào **kể cả quản trị viên hệ thống**".

### 4.2. Cài đặt ba lớp

```
LỚP 1 · ỨNG DỤNG
  Không cung cấp bất kỳ API nào cho phép sửa hoặc xóa audit log

LỚP 2 · CƠ SỞ DỮ LIỆU               ◄── lớp quyết định
  Tài khoản ứng dụng chỉ có INSERT và SELECT trên bảng audit_log
  Quyền UPDATE và DELETE bị THU HỒI ở tầng CSDL

LỚP 3 · CHUỖI BĂM
  Mỗi bản ghi lưu prev_hash = hash(bản ghi trước)
  Tác vụ định kỳ kiểm tra tính liên tục của chuỗi
  → không ngăn được xóa ở tầng hạ tầng, nhưng khiến việc đó BỊ PHÁT HIỆN
```

**Vì sao cần lớp 2 và 3.** Chỉ chặn ở tầng ứng dụng là không đủ: một tài khoản
`SYSTEM_ADMIN` có quyền cơ sở dữ liệu vẫn xóa được bản ghi.

### 4.3. Nội dung bắt buộc của mỗi bản ghi

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| Mã người thực hiện | ✔ | |
| Thời điểm thay đổi | ✔ | |
| Đối tượng bị tác động | ✔ | Loại thực thể + id |
| Hành động | ✔ | `CREATE`/`UPDATE`/`DELETE_SOFT`/`LOCK`/`UNLOCK`/`APPROVE`/`VIEW_SENSITIVE` |
| **Giá trị cũ** | ✔ | |
| **Giá trị mới** | ✔ | |
| **Địa chỉ IP** | ✔ | |
| **Lý do thay đổi** | ✔ với thao tác sửa công, lương, tham số | |
| Mã tham chiếu đơn / quyết định | Khi có | |
| `prev_hash` / `record_hash` | ✔ | |

### 4.4. Các thao tác bắt buộc ghi audit log

- Sửa dữ liệu chấm công sau khi đã sinh (kể cả trước khi chốt).
- Thay đổi hệ số lương, cấu phần thu nhập, công thức.
- Thay đổi tham số pháp lý.
- Điều chỉnh khoản khấu trừ, thưởng.
- Chốt / mở khóa kỳ công và kỳ lương.
- Mọi bước phê duyệt.
- Truy cập dữ liệu nhạy cảm (`VIEW_SENSITIVE`), **kể cả truy cập bị từ chối**.
- Đăng nhập, đăng nhập thất bại, thu hồi phiên.
- Xuất dữ liệu ra tệp (export, kết xuất báo cáo chứa dữ liệu lương).

---

## 5. Xác thực và quản lý phiên

| Hạng mục | Yêu cầu |
|---|---|
| Phương thức | Tài khoản nội bộ + hook SSO/LDAP |
| Chính sách mật khẩu | Độ dài tối thiểu, độ phức tạp, lịch sử mật khẩu, hạn đổi — cấu hình được |
| Khóa tài khoản | Sau số lần đăng nhập sai cấu hình được |
| Phiên web/mobile | Thời hạn cấu hình, gia hạn khi có hoạt động |
| **Phiên kiosk** | **Tự đăng xuất sau 60 giây** không thao tác |
| Thu hồi phiên | Quản trị viên thu hồi phiên **tức thời**, có hiệu lực ngay |
| Xác thực bổ sung | Bắt buộc với: xem phiếu lương, mở khóa kỳ, thay đổi tham số pháp lý |
| Nhân sự nghỉ việc | Vô hiệu hóa tài khoản tự động theo ngày chấm dứt HĐ |

---

## 6. Lưu trữ, sao lưu và phục hồi

| Hạng mục | Yêu cầu |
|---|---|
| Thời hạn lưu trữ | **≥ 3 năm** với dữ liệu chấm công và tiền lương |
| Sao lưu | Định kỳ, có mã hóa bản sao lưu |
| RPO | ≤ 1 giờ |
| RTO | ≤ 4 giờ |
| Kiểm chứng phục hồi | Diễn tập phục hồi định kỳ, có biên bản |
| Audit log | **Không xóa**; chuyển sang lưu trữ nguội khi cũ, vẫn truy vấn được |
| Snapshot kỳ | Lưu nguyên vẹn, không nén mất mát |

---

## 7. Kiểm soát rủi ro nội bộ

| Rủi ro | Biện pháp |
|---|---|
| HR tự sửa lương của chính mình | Tách quyền: người có `payroll.edit` không được thao tác trên hồ sơ của chính mình; thao tác bị chặn và ghi audit |
| Quản trị viên xem dữ liệu lương | `SYSTEM_ADMIN` không có `payroll.view_detail`; muốn cấp phải qua quyết định có phê duyệt |
| Sửa dữ liệu sau khi đã duyệt | Mọi thay đổi làm đổi tổng số tiền → hủy toàn bộ phê duyệt, yêu cầu duyệt lại |
| Xuất dữ liệu hàng loạt | Ghi audit log mọi lần export; giới hạn số bản ghi mỗi lần; cảnh báo khi vượt ngưỡng |
| Gian lận giờ công | Đối soát chéo `XC-01`…`XC-10`; phát hiện quẹt hai địa điểm bất khả thi (`XC-05`) |
| Tài khoản dùng chung trên kiosk | Phiên ngắn 60 giây; bắt buộc xác thực lại cho mọi thao tác nhạy cảm |
