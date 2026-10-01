import {
  scrypt as rawScrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { verifyPassword as verifyNativePassword } from "better-auth/crypto";

const scrypt = (
  password: string,
  salt: string,
  length: number,
  options: ScryptOptions,
) =>
  new Promise<Buffer>((resolve, reject) =>
    rawScrypt(password, salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
export async function verifyImportedPassword(password: string, hash: string) {
  if (!/^(legacy_scrypt|scrypt)\$/.test(hash))
    return verifyNativePassword({ password, hash });
  const [salt, expected] = hash.slice(hash.indexOf("$") + 1).split(":");
  if (!salt || !/^[a-f0-9]{128}$/i.test(expected ?? "")) return false;
  const actual = await scrypt(
    password,
    salt,
    64,
    hash.startsWith("legacy_scrypt$")
      ? {}
      : { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
  );
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
