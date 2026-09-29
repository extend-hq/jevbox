import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";

let env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
for (const line of readFileSync(".env.example", "utf8").trim().split("\n")) {
  const key = line.split("=")[0];
  if (!new RegExp(`^${key}=`, "m").test(env)) env += `\n${line}`;
}
if (!/^ENCRYPTION_KEY=\S+/m.test(env)) {
  const key = existsSync(".data/encryption.key")
    ? readFileSync(".data/encryption.key")
    : randomBytes(32);
  if (key.length !== 32) throw new Error("Invalid local encryption key");
  env = env.replace(/^ENCRYPTION_KEY=.*$/m, "");
  env += `\nENCRYPTION_KEY=${key.toString("hex")}\n`;
}
writeFileSync(".env", env.trim() + "\n", { mode: 0o600 });
chmodSync(".env", 0o600);
console.log(
  "Local configuration is ready. Run pnpm services:up, then pnpm dev.",
);
