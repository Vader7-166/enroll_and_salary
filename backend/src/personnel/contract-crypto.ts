import { InternalServerErrorException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function cipherText(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function plainText(key: Buffer, ciphertext: string): string {
  const [version, ivValue, tagValue, value] = ciphertext.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !value)
    throw new InternalServerErrorException("Dữ liệu hợp đồng đã mã hóa không hợp lệ.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(value, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new InternalServerErrorException("Không thể giải mã dữ liệu hợp đồng.");
  }
}
