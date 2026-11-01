import { api, ApiError } from "./client";

export interface AuditRecord {
  id: string; occurredAt: string; actor: { id: string; username: string; displayName: string } | null;
  entityType: string; entityId: string; action: string; result: string; ipAddress: string | null; scopeOrgUnitId: string | null;
  oldValue: unknown; newValue: unknown;
}
export interface AuditFilter { from?: string; to?: string; actor?: string; action?: string; entityType?: string; entityId?: string; result?: string; cursor?: string; pageSize?: string }
export interface IntegrityCheck {
  id: string; trigger: "SCHEDULED" | "MANUAL"; status: "VALID" | "BROKEN"; fromId: string | null; toId: string | null; checkedCount: number;
  firstBrokenId: string | null; failureReason: string | null; startedAt: string; finishedAt: string; triggeredBy?: string | null;
}
export interface AppNotification { id: string; type: string; title: string; linkKey: string; payload: Record<string, unknown>; createdAt: string; readAt: string | null }

function query(filter: object): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== "") parameters.set(key, String(value));
  return parameters.size ? `?${parameters.toString()}` : "";
}

export const auditApi = {
  logs: (filter: AuditFilter) => api<{ items: AuditRecord[]; nextCursor: string | null }>("/api/audit/logs" + query(filter)),
  facets: () => api<{ actions: string[]; entityTypes: string[]; results: string[] }>("/api/audit/facets"),
  export: async (filter: AuditFilter) => {
    let response: Response;
    try { response = await fetch("/api/audit/logs/export" + query({ ...filter, cursor: undefined, pageSize: undefined }), { credentials: "same-origin", cache: "no-store" }); }
    catch { throw new ApiError(0, "NETWORK_ERROR", "Không thể kết nối máy chủ. Vui lòng kiểm tra lại kết nối."); }
    if (!response.ok) {
      let body: { code?: string; message?: string } | undefined;
      try { body = await response.json() as { code?: string; message?: string }; } catch { /* no JSON body */ }
      throw new ApiError(response.status, body?.code ?? "DOWNLOAD_FAILED", body?.message ?? "Không xuất được nhật ký.");
    }
    return response.blob();
  },
  checks: () => api<{ items: IntegrityCheck[] }>("/api/audit/integrity-checks"),
  runCheck: () => api<IntegrityCheck>("/api/audit/integrity-checks", { method: "POST", body: "{}" }),
};

export const notificationsApi = {
  list: (unreadOnly = false) => api<{ items: AppNotification[]; unread: number }>("/api/notifications" + (unreadOnly ? "?unreadOnly=true" : "")),
  unreadCount: () => api<{ unread: number }>("/api/notifications/unread-count"),
  read: (body: { ids?: string[]; all?: boolean }) => api<{ updated: number; unread: number }>("/api/notifications/read", { method: "POST", body: JSON.stringify(body) }),
};
