import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

const scrypt = (
  password: string,
  salt: string,
  length: number,
  options: ScryptOptions = {},
) =>
  new Promise<Buffer>((resolve, reject) =>
    rawScrypt(password, salt, length, options, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64, parameters)) as Buffer;
  return `scrypt$${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string) {
  const legacy = hash.startsWith("legacy_scrypt$");
  if (!legacy && !hash.startsWith("scrypt$")) return false;
  const [salt, expected] = hash.slice(hash.indexOf("$") + 1).split(":");
  if (!salt || !/^[a-f0-9]{128}$/i.test(expected ?? "")) return false;
  const actual = (
    legacy
      ? await scrypt(password, salt, 64)
      : await scrypt(password, salt, 64, parameters)
  ) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
