import { createHmac, timingSafeEqual } from "node:crypto";

/** Short-lived proof that the current session re-entered its password (NFR-33). Bound to the session id. */
export const REAUTH_TTL_MS = 5 * 60_000;

export function reauthKey(hrDataKeyBase64: string): Buffer {
  return createHmac("sha256", Buffer.from(hrDataKeyBase64, "base64")).update("hrtp-reauth:v1").digest();
}
export function issueReauthToken(key: Buffer, sessionId: string, expiresAt: number): string {
  return expiresAt + "." + createHmac("sha256", key).update(sessionId + ":" + expiresAt).digest("base64url");
}
export function verifyReauthToken(key: Buffer, sessionId: string, token: string | undefined, now = Date.now()): boolean {
  const [expiry, signature] = (token ?? "").split(".");
  const expiresAt = Number(expiry);
  if (!signature || !Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + REAUTH_TTL_MS) return false;
  const expected = Buffer.from(issueReauthToken(key, sessionId, expiresAt).split(".")[1]);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
