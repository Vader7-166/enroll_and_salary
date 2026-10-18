import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
const KEY_LENGTH = 64;
const N = 16_384;
const R = 8;
const P = 1;
const MAXMEM = 64 * 1024 * 1024;
const FORMAT = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must not be empty.');
  }

  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return [FORMAT, N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;

  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== FORMAT) return false;

  const [_, nText, rText, pText, saltText, keyText] = parts;
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!isSafeScryptParameters(n, r, p)) return false;

  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(keyText, 'base64url');
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return false;
    const actual = await derive(password, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function isSafeScryptParameters(n: number, r: number, p: number): boolean {
  return (
    Number.isInteger(n) &&
    Number.isInteger(r) &&
    Number.isInteger(p) &&
    n >= 2 &&
    (n & (n - 1)) === 0 &&
    n <= N &&
    r >= 1 &&
    r <= R &&
    p >= 1 &&
    p <= P
  );
}

async function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, { N: n, r, p, maxmem: MAXMEM }, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}
