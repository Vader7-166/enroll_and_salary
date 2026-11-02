import { InternalServerErrorException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

/**
 * Key ring (FR-X.2). `HR_DATA_KEY` is always key `v1`; `HR_DATA_KEYS=v2:<base64>,v3:…` adds keys and
 * `HR_DATA_KEY_ACTIVE` picks the one new ciphertexts use. Without them everything stays on v1 exactly as before.
 */
export interface KeyRing { active: string; keys: Map<string, Buffer> }
let ring: KeyRing | null = null;
export function keyRing(env: NodeJS.ProcessEnv = process.env): KeyRing {
  if (ring) return ring;
  const keys = new Map<string, Buffer>();
  if (env.HR_DATA_KEY) keys.set("v1", Buffer.from(env.HR_DATA_KEY, "base64"));
  for (const entry of (env.HR_DATA_KEYS ?? "").split(",").map(item => item.trim()).filter(Boolean)) {
    const [id, value] = entry.split(":");
    const key = Buffer.from(value ?? "", "base64");
    if (!/^v\d+$/.test(id) || key.length !== 32) throw new Error("HR_DATA_KEYS entries must look like v2:<base64 32-byte key>.");
    keys.set(id, key);
  }
  const active = env.HR_DATA_KEY_ACTIVE?.trim() || "v1";
  if (!keys.has(active)) throw new Error("HR_DATA_KEY_ACTIVE " + active + " is not in the key ring.");
  ring = { active, keys };
  return ring;
}
/** Tests and the rotation command load a different ring in the same process. */
export function resetKeyRing(next?: KeyRing) { ring = next ?? null; }

/**
 * AES-256-GCM. Format: v1.<iv>.<tag>.<ciphertext> (key v1, unchanged) or k<keyId>.v1.<iv>.<tag>.<ciphertext> for any other
 * active key. The `key` argument is the v1 key callers already hold; the active ring key wins when it is not v1.
 */
export function cipherText(key: Buffer, plaintext: string): string {
  const { active, keys } = keyRing();
  const useKey = active === "v1" ? key : keys.get(active)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", useKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${active === "v1" ? "" : "k" + active + "."}v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

/** Key id a ciphertext was written with (`v1` for the legacy format). */
export function cipherKeyId(ciphertext: string) { return ciphertext.startsWith("k") ? ciphertext.slice(1, ciphertext.indexOf(".")) : "v1"; }

export function plainText(key: Buffer, ciphertext: string, label = "hợp đồng"): string {
  const keyId = cipherKeyId(ciphertext);
  const body = keyId === "v1" ? ciphertext : ciphertext.slice(ciphertext.indexOf(".") + 1);
  const useKey = keyId === "v1" ? key : keyRing().keys.get(keyId);
  if (!useKey) throw new InternalServerErrorException(`Không có khóa ${keyId} để giải mã dữ liệu ${label}.`);
  const [version, ivValue, tagValue, value] = body.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !value)
    throw new InternalServerErrorException(`Dữ liệu ${label} đã mã hóa không hợp lệ.`);
  try {
    const decipher = createDecipheriv("aes-256-gcm", useKey, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(value, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new InternalServerErrorException(`Không thể giải mã dữ liệu ${label}.`);
  }
}

export const BLIND_INDEX_KEY_VERSION = 1;

/**
 * Deterministic HMAC-SHA256 over a normalized value so encrypted identifiers can still be
 * checked for duplicates. The HMAC key is derived from HR_DATA_KEY and versioned; key
 * rotation (FR-X.2) recomputes every index under the new version.
 */
export function blindIndex(key: Buffer, kind: string, normalized: string, keyVersion?: number): string {
  // The active ring key also drives the index; `keys:rotate` recomputes every stored index under it.
  const { active, keys } = keyRing();
  const version = keyVersion ?? (active === "v1" ? BLIND_INDEX_KEY_VERSION : Number(active.slice(1)));
  const base = version === BLIND_INDEX_KEY_VERSION ? key : keys.get("v" + version) ?? key;
  const derived = createHmac("sha256", base).update("hrtp-blind-index:v" + version).digest();
  return `b${version}.` + createHmac("sha256", derived).update(kind + "\u0000" + normalized).digest("hex");
}

/** Keeps the last visible characters; everything else becomes "*". */
export function maskValue(value: string, visible = 4): string {
  if (value.length <= visible) return "*".repeat(value.length);
  return "*".repeat(value.length - visible) + value.slice(-visible);
}

const SEAL_MAGIC = Buffer.from("HRK1");

/** Binary AES-256-GCM for files: legacy `[iv 12][tag 16][ct]` (key v1) or `HRK1 <len><keyId> [iv][tag][ct]` for other keys. */
export function sealBuffer(key: Buffer, data: Buffer): Buffer {
  const { active, keys } = keyRing();
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", active === "v1" ? key : keys.get(active)!, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  const header = active === "v1" ? Buffer.alloc(0) : Buffer.concat([SEAL_MAGIC, Buffer.from([active.length]), Buffer.from(active)]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), body]);
}

export function openBuffer(key: Buffer, data: Buffer): Buffer {
  let useKey: Buffer | undefined = key, body = data;
  if (data.subarray(0, 4).equals(SEAL_MAGIC)) {
    const length = data[4], keyId = data.subarray(5, 5 + length).toString();
    useKey = keyRing().keys.get(keyId);
    if (!useKey) throw new InternalServerErrorException(`Không có khóa ${keyId} để mở tệp lưu trữ.`);
    body = data.subarray(5 + length);
  }
  const decipher = createDecipheriv("aes-256-gcm", useKey, body.subarray(0, 12));
  decipher.setAuthTag(body.subarray(12, 28));
  return Buffer.concat([decipher.update(body.subarray(28)), decipher.final()]);
}
