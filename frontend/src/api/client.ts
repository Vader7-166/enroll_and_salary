const requestFailure: Record<number, string> = {
  400: "Thông tin gửi lên chưa hợp lệ. Kiểm tra lại biểu mẫu.",
  401: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  403: "Bạn không có quyền thực hiện thao tác này trong phạm vi đã chọn.",
  404: "Không tìm thấy dữ liệu. Tải lại danh sách để kiểm tra.",
  409: "Dữ liệu đã thay đổi hoặc bị trùng. Tải lại trước khi thực hiện.",
  413: "Tệp gửi lên vượt dung lượng cho phép. Chọn tệp nhỏ hơn.",
  429: "Bạn thao tác quá nhanh. Vui lòng chờ rồi thử lại.",
  500: "Máy chủ chưa xử lý được yêu cầu. Vui lòng thử lại.",
  502: "Chưa kết nối được dịch vụ xử lý. Vui lòng thử lại sau.",
  503: "Dịch vụ tạm thời chưa sẵn sàng. Vui lòng thử lại sau.",
};
const fieldLabels: Record<string, string> = {
  username: "Tên đăng nhập", password: "Mật khẩu", code: "Mã", name: "Tên", fullName: "Họ tên", displayName: "Tên hiển thị",
  email: "Email", phone: "Số điện thoại", gender: "Giới tính", dob: "Ngày sinh", hireDate: "Ngày vào làm",
  paramCode: "Tham số", scopeKey: "Phạm vi áp dụng", subjectType: "Đối tượng áp dụng", applicationBasis: "Căn cứ áp dụng", value: "Giá trị", unit: "Đơn vị tính",
  effectiveFrom: "Ngày bắt đầu hiệu lực", effectiveTo: "Ngày kết thúc hiệu lực", effectiveDate: "Ngày hiệu lực", documentEffectiveDate: "Ngày hiệu lực văn bản", legalBasis: "Căn cứ pháp lý",
  periodId: "Kỳ công", referencePeriodId: "Kỳ tham chiếu", employeeId: "Nhân viên", orgUnitId: "Đơn vị", teamOrgUnitId: "Tổ", siteId: "Cơ sở", scopeOrgUnitId: "Đơn vị áp dụng",
  startAt: "Giờ bắt đầu", endAt: "Giờ kết thúc", workDate: "Ngày công", dateFrom: "Từ ngày", dateTo: "Đến ngày", revision: "Phiên bản dữ liệu", sourceHash: "Dữ liệu đang rà soát",
  coveredFrom: "Thời điểm bắt đầu nhận dữ liệu", coveredUntil: "Thời điểm kết thúc nhận dữ liệu", reference: "Chứng từ / tham chiếu", reason: "Lý do", note: "Ghi chú",
  reviewed: "Xác nhận đã rà soát", acknowledgeWarnings: "Xác nhận đã đọc cảnh báo", batchIds: "Lô dữ liệu", title: "Tiêu đề", items: "Danh sách chi tiết", members: "Danh sách nhân sự",
};
function userFacingMessage(status: number, code: string, message: string): string {
  if (code === "AUTH_INVALID") return "Tên đăng nhập hoặc mật khẩu không chính xác.";
  if (code === "AUTH_REQUIRED") return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
  if (code === "ACCOUNT_UNAVAILABLE") return "Tài khoản hiện không khả dụng. Liên hệ quản trị viên.";
  if (code === "ORIGIN_FORBIDDEN") return "Địa chỉ website chưa được phép gửi yêu cầu. Liên hệ quản trị viên để kiểm tra cấu hình truy cập.";
  if (/^(Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Internal Server Error|Service Unavailable)$/i.test(message.trim())) return requestFailure[status] ?? "Yêu cầu chưa thực hiện được. Vui lòng thử lại.";
  if (code !== "VALIDATION_ERROR" || !/\b(must|should)\b/.test(message)) return message;
  return message.split(/;\s*/).map(part => {
    if (!/\b(must|should)\b/.test(part)) return part;
    const field = /^(?:each value in )?([\w.]+)/.exec(part)?.[1] ?? "";
    const label = fieldLabels[field] ?? "Thông tin trong biểu mẫu";
    if (/should not exist/.test(part)) return "Biểu mẫu có thông tin không được hỗ trợ. Tải lại trang trước khi nhập lại.";
    if (/must be a UUID/.test(part)) return label + ": vui lòng chọn một giá trị hợp lệ.";
    if (/must be an integer/.test(part)) return label + ": phải là số nguyên.";
    if (/must be a (number|positive number)/.test(part)) return label + ": phải là số hợp lệ" + (/positive/.test(part) ? " lớn hơn 0." : ".");
    if (/should not be empty|must be defined|must not be less than 1 elements/.test(part)) return label + ": không được để trống.";
    if (/must be a boolean/.test(part)) return label + ": vui lòng chọn hoặc bỏ chọn đúng yêu cầu.";
    const maximum = /must be (?:shorter than or equal to|no more than) (\d+) characters/.exec(part);
    if (maximum) return label + ": tối đa " + maximum[1] + " ký tự.";
    const bound = /must not be (less|greater) than ([-\d.]+)/.exec(part);
    if (bound) return label + (bound[1] === "less" ? ": tối thiểu " : ": tối đa ") + bound[2] + ".";
    if (/must be an array/.test(part)) return label + ": cần là một danh sách.";
    if (/unique/.test(part)) return label + ": có mục bị trùng, vui lòng kiểm tra lại.";
    return label + ": chưa đúng định dạng hoặc giá trị cho phép. Kiểm tra lại trường này.";
  }).join(" ");
}
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly rawMessage: string;

  constructor(status: number, code: string, message: string) {
    super(userFacingMessage(status, code, message));
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.rawMessage = message;
  }
}

let onUnauthorized: (() => void) | undefined;

export function setUnauthorizedHandler(
  handler: (() => void) | undefined,
): void {
  onUnauthorized = handler;
}

function messageFrom(
  body: unknown,
  fallback: string,
): { code: string; message: string } {
  if (body && typeof body === "object") {
    const value = body as { code?: unknown; message?: unknown };
    const message = Array.isArray(value.message) ? value.message.filter((item): item is string => typeof item === "string").join("; ") : value.message;
    if (typeof message === "string" && message.trim()) {
      return {
        code: typeof value.code === "string" ? value.code : "REQUEST_FAILED",
        message,
      };
    }
  }
  return { code: "REQUEST_FAILED", message: fallback };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Không thể kết nối máy chủ. Vui lòng kiểm tra lại kết nối.",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    if (response.status === 401) onUnauthorized?.();
    const detail = messageFrom(
      body,
      requestFailure[response.status] ?? "Yêu cầu chưa thực hiện được. Vui lòng thử lại.",
    );
    throw new ApiError(response.status, detail.code, detail.message);
  }
  return body as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error
    ? error.message
    : "Đã xảy ra lỗi không xác định.";
}
