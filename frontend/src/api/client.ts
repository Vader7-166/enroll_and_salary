export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
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
    if (typeof value.message === "string" && value.message.trim()) {
      return {
        code: typeof value.code === "string" ? value.code : "REQUEST_FAILED",
        message: value.message,
      };
    }
  }
  return { code: "REQUEST_FAILED", message: fallback };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type"))
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
      "Yêu cầu không thành công (HTTP " + response.status + ").",
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
