# 10. Phân quyền và bảo mật

**AI-02 mở rộng:** [24](24-ai-tro-ly-nghiep-vu-theo-vai-tro.md) phục vụ TT/QĐ/KT/AD;
backend lọc corpus theo quyền trước retrieval/Gemini và kiểm tra lại trước response/
cache. Không gửi hồ sơ/lương/log thô, không cấp tool/quyền ghi, không tin role/pageKey
từ client. Key Google Gemini ở server; model/tier/điều kiện dữ liệu chốt trước bật.
AI-01 giải thích lương chỉ KT tại 23 là hướng sau sprint, chưa mở rộng quyền lương.

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

Hệ thống chỉ có **bốn vai trò** (lớp `VaiTro`, chức năng 1.1). Công nhân không có tài khoản.

| Vai trò | Mã | Chức năng BFD | Mô tả |
|---|---|---|---|
| Tổ trưởng | `TT` | 3.2, 3.3, 4.3, 4.4, 5.1, 6.3, 10.1 | Xếp ca tổ, đổi ca, giải trình và xác nhận công tổ, đề xuất OT, ghi nhận và duyệt đơn nghỉ |
| Quản đốc | `QD` | 3.4, 4.5, 5.2, 5.3, 6.5, 10.1, 10.2 | Duyệt lịch ca, duyệt OT cấp 2, chốt công xưởng, xem vắng mặt và biến động nhân sự |
| Kế toán | `KT` | 1.5, 2.x, 4.5, 5.5, 6.2, 6.4, 7.x, 8.x, 9.x, 10.3, 10.4 | Hồ sơ – hợp đồng, khóa kỳ công, lương, BH, thuế, phúc lợi |
| Admin | `AD` | 1.1 – 1.6, 3.1, 4.1, 6.1 | Tài khoản, tổ chức, tham số, chính sách, mở kỳ, danh mục ca và loại nghỉ, nhập dữ liệu chấm công; **không** xem lương chi tiết, **không** sửa / xóa nhật ký |

**Quyền API đơn nghỉ local:** `leave.request` cấp cho TT, dùng cho lập/sửa/gửi và
duyệt một cấp/trả lại/từ chối/hủy; `leave.read` chỉ cho đọc trong phạm vi. Kiểm tra
vai trò, cây đơn vị, phân công và loại trừ tại hiện tại lẫn từng ngày nghỉ.
Chống tự xử lý dựa trên `user_account.employee_id`, không so người lập: TT được
duyệt đơn mình đã ghi nhận **thay công nhân khác**, không xử lý đơn của chính mình.
Người xử lý/lý do/trạng thái trước–sau/phiên bản được giữ trong lịch sử bất biến.
Duyệt/hủy đã duyệt cập nhật trạng thái, ledger, công và audit trong một transaction; lỗi bất kỳ rollback toàn bộ, không cần cấp quyền quản lý quỹ cho TT. CLOSED/LOCKED và nguồn giải trình ngoài quyền vẫn được bảo vệ. Hợp đồng tại [20 §7.19](20-tech-stack-va-moi-truong-phat-trien.md#719-tích-hợp-đơn-nghỉ-với-quỹ-và-bảng-công).

**Quyền API ca đã triển khai:** mọi vai trò có `shift.read` theo đơn vị được cấp;
AD có `shift.manage`, TT có `shift.plan`, QĐ có `shift.approve`; KT chỉ đọc lịch.
Đọc kế thừa danh mục cấp cha không cấp quyền đọc hồ sơ nhân sự cấp cha cho AD/TT.
Chỉ người lập được sửa/gửi/hủy lịch chưa duyệt; người lập không tự duyệt/trả lại,
kể cả tài khoản nhiều vai trò. Mỗi lượt/phiên bản cũ đều chịu phạm vi hiện tại và
theo ngày công, exclusion; không trả lương/hợp đồng trong API ca. Xem 20 §7.10.

**Quyền API xác nhận tổ local:** `attendance.read` đọc rà soát và lịch sử; chỉ TT
có `attendance.confirm` được xác nhận; chỉ AD có `attendance.import` được ghi căn
cứ đủ nguồn. Kiểm tra quyền/phân công/loại trừ hiện tại, mọi ngày công và ngày
nguồn qua đêm; một phần nguồn không đọc được thì từ chối toàn tổ, không xác nhận
trên tập bị lọc. Ghi trong transaction serializable, kiểm tra hash và revision,
audit cùng giao dịch. QĐ/KT chỉ đọc ở bước xác nhận tổ; chốt xưởng và khóa kỳ có quyền riêng.
Hợp đồng tại [20 §7.20](20-tech-stack-va-moi-truong-phat-trien.md#720-xác-nhận-công-tổ).

**Quyền API KT khóa kỳ local:** KT + `attendance.read` đọc rà soát toàn kỳ và
nguồn đã khóa; LOCK/RETURN cần thêm `attendance.lock` (migration/seed chỉ cấp
cho KT). AD/TT/QĐ không được thực hiện quyết định KT. Kiểm tra toàn phạm vi
kỳ, phân công/loại trừ hiện tại, từng ngày công/ngày nguồn và manifest bản lưu.
Thiếu một phần quyền trả 404 cho toàn bản, không lộ tập bị lọc hay lịch sử.
Ghi Serializable có khóa nguồn/phân quyền; revision/hash cũ trả 409. Sự kiện
append-only, chỉ một LOCK mỗi kỳ; không có mở khóa kể cả qua cập nhật SQL trực
tiếp. Raw muộn không đổi nguồn đã khóa. Hợp đồng tại [20 §7.23](20-tech-stack-va-moi-truong-phat-trien.md#723-kế-toán-trả-kỳ-trước-khóa-và-lưu-nguồn-công-bất-biến).
 
 **Quyền API cấu phần lương local:** chỉ KT với `payroll.components.read` được đọc; tạo và thêm phiên bản cần `payroll.components.manage`. AD/TT/QĐ không có quyền này. Phạm vi công ty/cơ sở theo cây đơn vị có hiệu lực; đọc giao phạm vi hiện tại với ngày xem, KT cơ sở được đọc cấu phần công ty/cơ sở tổ tiên nhưng không sửa cấu phần ngoài phạm vi. Ghi phải đủ quyền trên toàn khoảng hiệu lực, kể cả phần khoảng cũ bị đóng khi có bản kế tiếp. Revision cũ trả 409; không có API sửa/xóa phiên bản. Audit và thay đổi dữ liệu cùng giao dịch Serializable, không cấp truy cập lương nhân viên qua danh mục. Xem [20 §7.24](20-tech-stack-va-moi-truong-phat-trien.md#724-danh-mục-cấu-phần-lương-và-phiên-bản-hiệu-lực).

**Đơn giá/công thức local (Task 2.2):** dùng cùng quyền KT `payroll.components.read/manage` và phạm vi có hiệu lực như cấu phần. Chạy thử chỉ đọc, không truy cập lương cá nhân hoặc ghi bảng lương. Tra nguồn công ty/cơ sở và tham số pháp lý theo ngày đích; không dùng quyền đọc tổ tiên để ghi lên tổ tiên. Thay cấu hình kiểm tra mọi cơ sở phụ thuộc và mốc hiệu lực bị ảnh hưởng trong giao dịch; chu kỳ/nguồn thiếu/khác đơn vị không để lại phiên bản hay audit ghi dở. Hợp đồng tại [20 §7.25](20-tech-stack-va-moi-truong-phat-trien.md#725-đơn-giá-công-thức-và-chạy-thử-theo-phiên-bản-task-22).

### 1.2. Trục phạm vi dữ liệu

Phạm vi lưu trong bản ghi phân quyền (tài khoản, vai trò, **đơn vị phạm vi**, hiệu lực — lớp
`PhanQuyen`). Một tài khoản có thể có nhiều bản ghi.

| Phạm vi | Tập dữ liệu truy cập được | Vai trò điển hình |
|---|---|---|
| `TEAM` | Tổ / chuyền được giao | TT |
| `DEPARTMENT` | Phân xưởng / phòng ban, **bao gồm toàn bộ cây con** | QĐ |
| `SITE` | Toàn bộ một cơ sở. Doanh nghiệp có **4 cơ sở** nên vai trò gắn `SITE` được cấp lặp lại ở từng nơi | AD nhập công; KT nhà máy (nếu có) |
| `ALL` | Toàn doanh nghiệp | KT tại trụ sở; AD cấu hình |

**Quy tắc bắt buộc:** tập nhân sự của `TEAM`, `DEPARTMENT` và `SITE` được **suy ra động từ cây
tổ chức tại thời điểm truy vấn**, không lưu cứng danh sách nhân sự. Nhân sự điều chuyển — kể cả
điều chuyển liên tỉnh — thì dữ liệu các tài khoản liên quan nhìn thấy tự thay đổi. Khi cấp
quyền, hệ thống kiểm tra phạm vi phù hợp vai trò (TT – tổ, QĐ – xưởng) (SQ-15). Ánh xạ chức danh
→ vai trò → phạm vi: xem [03 §8](03-co-cau-to-chuc.md).

### 1.3. Exclusion list

Cho phép ẩn hồ sơ và dữ liệu lương của một nhóm nhân sự (ví dụ Ban Giám đốc) khỏi tầm nhìn
của các tài khoản KT được chỉ định, **kể cả khi phạm vi dữ liệu của họ là `ALL`**.

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

**✔** = thực hiện trong phạm vi được cấp · **👁** = chỉ xem trong phạm vi · **–** = không có quyền

| Hành động | Chức năng | TT | QĐ | KT | AD |
|---|---|---|---|---|---|
| Quản lý tài khoản, phân quyền | 1.1 | – | – | – | ✔ |
| Cấu hình cây tổ chức, cơ sở | 1.2 | – | 👁 | 👁 | ✔ |
| Vùng lương, tham số pháp lý | 1.3 | – | – | 👁 | ✔ |
| Chính sách theo cơ sở | 1.4 | – | 👁 | 👁 | ✔ |
| Tạo kỳ Lập kế hoạch, mở kỳ công/kỳ lương | 1.5 | – | – | 👁 | ✔ |
| Trả kỳ CLOSED về OPEN trước khóa, bắt buộc lý do | 1.5 | – | – | ✔ | – |
| Khóa kỳ công, kỳ lương | 1.5, 4.5, 7.5 | – | – | ✔ | – |
| Tra cứu nhật ký kiểm toán | 1.6 | – | – | 👁 (đối tượng thuộc phạm vi) | ✔ |
| Hồ sơ, người phụ thuộc, hợp đồng, quyết định | 2.1 – 2.4 | 👁 (tổ, không gồm lương) | 👁 (xưởng, không gồm lương) | ✔ | – |
| Chấm dứt hợp đồng | 2.5 | – | – | ✔ | – |
| Xem số CCCD, tài khoản ngân hàng | – | – | – | ✔ | – |
| Danh mục ca, lịch nghỉ lễ, mẫu xoay ca | 3.1 | 👁 | 👁 | 👁 | ✔ |
| Lập lịch ca, đề xuất đổi ca | 3.2, 3.3 | ✔ | 👁 | – | – |
| Duyệt lịch ca, đổi ca | 3.4 | – | ✔ | – | – |
| Nhập tệp dữ liệu chấm công | 4.1 | – | – | – | ✔ (cơ sở) |
| Xem công, ngoại lệ | 4.2 – 4.3 | ✔ (tổ) | 👁 (xưởng) | 👁 | 👁 (kết quả nhập) |
| Giải trình, điều chỉnh công | 4.3 | ✔ | – | – | – |
| Xác nhận công tổ | 4.4 | ✔ | – | – | – |
| Chốt bảng công xưởng | 4.5 | – | ✔ | – | – |
| Trả bảng công xưởng về nháp trước khóa, bắt buộc lý do | 4.5 | – | ✔ | – | – |
| Xác nhận đã nhập đủ nguồn tới mốc thu log | 4.1 | – | – | 👁 | ✔ (cơ sở) |
| Đề xuất OT | 5.1 | ✔ | 👁 | 👁 | – |
| Duyệt OT cấp 2 (kiểm soát trần) | 5.2, 5.3 | – | ✔ | 👁 | – |
| Yêu cầu quy đổi nghỉ bù (chưa kích hoạt DEC-01, trả COMP_TIME_DISABLED) | 5.5 | – | – | ✔ | – |
| Danh mục loại nghỉ | 6.1 | 👁 | 👁 | 👁 | ✔ |
| Quỹ phép năm, ốm đau – thai sản | 6.2, 6.4 | 👁 (số dư của tổ) | – | ✔ | – |
| Ghi nhận, duyệt đơn nghỉ | 6.3 | ✔ | 👁 | 👁 | – |
| Tỷ lệ vắng mặt | 6.5 | 👁 (tổ) | ✔ | 👁 | – |
| Cơ cấu lương, công thức | 7.1 | – | – | ✔ | – |
| Tính lương, thưởng, truy lĩnh / truy thu | 7.2 – 7.4 | – | – | ✔ | – |
| Xem chi tiết bảng lương | 7.x | – | – | ✔ | – |
| Duyệt và khóa bảng lương | 7.5 | – | – | ✔ | – |
| Xuất phiếu lương, file chi lương | 7.6 | – | – | ✔ | – |
| BH, thuế, quyết toán | 8.1 – 8.5 | – | – | ✔ | – |
| Phúc lợi | 9.1 – 9.4 | – | – | ✔ | – |
| Báo cáo công, OT | 10.1 | 👁 (tổ) | 👁 (xưởng) | – | – |
| Báo cáo biến động nhân sự | 10.2 | – | 👁 (xưởng) | – | – |
| Báo cáo quỹ lương, BH, thuế | 10.3, 10.4 | – | – | 👁 | – |

Quyền báo cáo bám đúng tác nhân của BFD, use case PhanHe10 và SQ-13: 10.1 cho TT, QĐ; 10.2 cho
QĐ; 10.3, 10.4 cho KT. KT vẫn xem dữ liệu công, OT trong phạm vi kỳ khi kiểm tra và khóa kỳ công
(4.5) và xem hồ sơ, biến động nhân sự qua phân hệ 2 — không cần quyền báo cáo 10.1, 10.2.

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
| Phạm vi | Các trường đánh dấu 🔒 trong [09](09-mo-hinh-du-lieu.md) |
| Quản lý khóa | Khóa mã hóa lưu **tách biệt** khỏi CSDL, có quy trình xoay khóa định kỳ |
| Truyền tải | HTTPS/TLS cho mọi kênh, kể cả mạng nội bộ nhà máy |
| Đối chiếu trùng | Nếu cần kiểm tra trùng CCCD: dùng trường **băm có muối**, không giải mã hàng loạt |
| Chỉ mục | Chỉ đánh chỉ mục trên trường không mã hóa — tránh mất khả năng tìm kiếm |

> **Trade-off đã cân nhắc.** Mã hóa cột làm chậm truy vấn và mất khả năng tìm kiếm trực tiếp.
> Giải pháp: chỉ mã hóa tập trường thực sự nhạy cảm, giữ trường băm cho nhu cầu đối chiếu.

### 3.3. Bảo mật phiếu lương và tệp xuất

Người lao động không truy cập hệ thống; phiếu lương do **KT xuất** sau khi khóa kỳ (7.6).

| Yêu cầu | Đặc tả |
|---|---|
| Phiếu lương PDF | Mỗi người một tệp, **đặt mật khẩu mở tệp** theo quy tắc riêng của doanh nghiệp; không gửi mật khẩu cùng kênh với tệp |
| Phiếu lương in | In theo từng người, phát trong phong bì dán kín |
| File chi lương | Chỉ KT xuất; tệp mã hóa khi lưu tạm; ghi `audit_log` mỗi lần xuất |
| Báo cáo chứa lương | Kiểm tra quyền kết xuất trước khi tạo tệp (AD-10); ghi `audit_log` |
| Thông báo trong ứng dụng | Không hiển thị bất kỳ con số lương nào |

### 3.4. Quyền của chủ thể dữ liệu

| Quyền | Cài đặt trong hệ thống |
|---|---|
| Được biết | Doanh nghiệp công bố danh mục dữ liệu hệ thống lưu về người lao động |
| Truy cập | Người lao động yêu cầu bằng văn bản; KT kết xuất hồ sơ cá nhân, bảng công, phiếu lương |
| Chỉnh sửa | KT cập nhật hồ sơ theo đề nghị có chứng từ; ghi nhật ký |
| Phản đối / khiếu nại | Phản ánh sai lệch công qua tổ trưởng (giải trình 4.3), sai lệch lương qua kế toán |
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

**Vì sao cần lớp 2 và 3.** Chỉ chặn ở tầng ứng dụng là không đủ: một người có quyền cơ sở dữ
liệu (kể cả quản trị hạ tầng) vẫn xóa được bản ghi.

### 4.3. Nội dung bắt buộc của mỗi bản ghi

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| Mã người thực hiện | ✔ | |
| Thời điểm thay đổi | ✔ | |
| Đối tượng bị tác động | ✔ | Loại thực thể + id |
| Hành động | ✔ | `CREATE`/`UPDATE`/`DELETE_SOFT`/`CONFIRM`/`APPROVE`/`CLOSE`/`LOCK`/`VIEW_SENSITIVE`/`ACCESS_DENIED` |
| **Giá trị cũ** | ✔ | |
| **Giá trị mới** | ✔ | |
| **Địa chỉ IP** | ✔ | |
| **Lý do thay đổi** | ✔ với thao tác sửa công, lương, tham số | |
| Mã tham chiếu đơn / quyết định | Khi có | |
| `prev_hash` / `record_hash` | ✔ | |

### 4.4. Các thao tác bắt buộc ghi audit log

- Nhập lô dữ liệu chấm công (kể cả lô bị từ chối).
- Sửa dữ liệu chấm công sau khi đã sinh (kể cả trước khi chốt).
- Thay đổi hệ số lương, cấu phần thu nhập, công thức.
- Thay đổi tham số pháp lý, chính sách theo cơ sở, phân quyền.
- Điều chỉnh khoản khấu trừ, thưởng; xác nhận truy lĩnh / truy thu.
- Mở / chốt / khóa kỳ công và kỳ lương.
- Mọi bước duyệt, xác nhận (lịch ca, OT, đơn nghỉ, bảng công, bảng lương, chấm dứt HĐ, cấp phát
  phúc lợi).
- Truy cập dữ liệu nhạy cảm (`VIEW_SENSITIVE`), **kể cả truy cập bị từ chối**.
- Đăng nhập, đăng nhập thất bại, thu hồi phiên.
- Xuất dữ liệu ra tệp (export, kết xuất báo cáo chứa dữ liệu lương).

---

## 5. Xác thực và quản lý phiên

| Hạng mục | Yêu cầu |
|---|---|
| Phương thức | Tài khoản nội bộ cho TT, QĐ, KT, AD (không tích hợp SSO / LDAP trong phạm vi hiện tại) |
| Chính sách mật khẩu | Độ dài tối thiểu, độ phức tạp, lịch sử mật khẩu, hạn đổi — cấu hình được |
| Khóa tài khoản | Sau số lần đăng nhập sai cấu hình được; AD khóa / mở khóa |
| Phiên web | Thời hạn cấu hình, gia hạn khi có hoạt động; máy trạm dùng chung tại xưởng tự hết phiên sau 15 phút không thao tác (cấu hình được) |
| Thu hồi phiên | AD thu hồi phiên **tức thời**, có hiệu lực ngay |
| Xác thực bổ sung | Bắt buộc với: thay đổi tham số pháp lý, khóa kỳ, xác nhận hồi tố, xuất file chi lương |
| Người dùng nghỉ việc / chuyển vị trí | Bản ghi phân quyền hết hiệu lực theo ngày chấm dứt HĐ hoặc ngày điều chuyển |

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
| KT tự sửa lương của chính mình | Tách quyền: tài khoản KT không được thao tác trên hồ sơ, bảng lương của chính mình; thao tác bị chặn và ghi audit |
| TT tự giải trình công, tự duyệt đơn nghỉ của chính mình | Chặn thao tác trên dữ liệu của chính người dùng; dữ liệu của tổ trưởng do người được cấp vai trò TT khác cho tổ đó (ví dụ tổ phó) xử lý — xem câu hỏi mở tại [16](16-ke-hoach-trien-khai-va-rui-ro.md) |
| AD xem dữ liệu lương | AD không có quyền xem lương chi tiết; muốn cấp phải qua quyết định có phê duyệt |
| Sửa dữ liệu sau khi đã duyệt | Mọi thay đổi đầu vào làm bảng lương quay về Nháp, phải duyệt lại (BR-43) |
| Xuất dữ liệu hàng loạt | Ghi audit log mọi lần export; giới hạn số bản ghi mỗi lần; cảnh báo khi vượt ngưỡng |
| Gian lận giờ công | Đối soát chéo `XC-01`…`XC-10`; phát hiện dữ liệu hai cơ sở bất khả thi (`XC-05`); mọi điều chỉnh công có lý do, chứng cứ |
| Quản đốc nhà máy này xem dữ liệu nhà máy khác | Phạm vi suy ra từ cây tổ chức; kiểm thử riêng cho từng cơ sở |
| Dùng chung tài khoản trên máy trạm tại xưởng | Cấm dùng chung tài khoản; phiên tự hết hạn; xác thực lại cho thao tác nhạy cảm |
