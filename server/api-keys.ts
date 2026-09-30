import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { apiScopes, type ApiKeyInfo } from "../shared/api-access";
import { HttpError, type Store } from "./db";

export const keyDigest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

type KeyRow = {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  created_at: Date;
  expires_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};
const publicKey = (row: KeyRow): ApiKeyInfo => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.created_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
  lastUsedAt: row.last_used_at?.toISOString() ?? null,
  revokedAt: row.revoked_at?.toISOString() ?? null,
});
const columns =
  "id,user_id,name,prefix,created_at,expires_at,last_used_at,revoked_at";

export function createApiKeys(store: Store) {
  return {
    async list(userId: string) {
      return (
        await store.all<KeyRow>(
          `SELECT ${columns} FROM api_keys WHERE user_id=? ORDER BY created_at DESC LIMIT 100`,
          userId,
        )
      ).map(publicKey);
    },
    async create(userId: string, body: unknown) {
      const input = z
        .object({
          name: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .regex(/^[^\x00-\x1f]+$/),
          expiresInDays: z.number().int().min(1).max(365).default(90),
        })
        .strict()
        .parse(body);
      return store.transaction(async () => {
        await store.one("SELECT id FROM users WHERE id=? FOR UPDATE", userId);
        const count = await store.one<{ count: string }>(
          "SELECT count(*) FROM api_keys WHERE user_id=? AND revoked_at IS NULL AND expires_at>now()",
          userId,
        );
        if (Number(count?.count) >= 20)
          throw new HttpError(409, "Revoke a key before creating another.");
        const token = `jev_key_${randomBytes(32).toString("base64url")}`;
        const keyId = randomUUID();
        await store.run(
          "INSERT INTO api_keys(id,user_id,name,prefix,token_hash,scopes,expires_at) VALUES(?,?,?,?,?,?,?)",
          keyId,
          userId,
          input.name,
          token.slice(0, 16),
          keyDigest(token),
          JSON.stringify(apiScopes),
          new Date(Date.now() + input.expiresInDays * 86400000),
        );
        const row = await store.one<KeyRow>(
          `SELECT ${columns} FROM api_keys WHERE id=?`,
          keyId,
        );
        return { key: publicKey(row!), token };
      });
    },
    async revoke(userId: string, keyId: string) {
      const result = await store.run(
        "UPDATE api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE id=? AND user_id=?",
        z.string().uuid().parse(keyId),
        userId,
      );
      if (!result.changes) throw new HttpError(404, "API key not found");
    },
    async authenticate(token: string) {
      if (!/^jev_key_[A-Za-z0-9_-]{43}$/.test(token))
        throw new HttpError(401, "Invalid or expired API key");
      const key = await store.one<KeyRow>(
        `SELECT ${columns
          .split(",")
          .map((column) => "k." + column)
          .join(
            ",",
          )} FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.token_hash=? AND k.revoked_at IS NULL AND k.expires_at>now() AND u.email_verified=true`,
        keyDigest(token),
      );
      if (!key) throw new HttpError(401, "Invalid or expired API key");
      await store.db.query(
        "UPDATE api_keys SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<now()-interval '1 minute')",
        [key.id],
      );
      return {
        userId: key.user_id,
        scopes: [...apiScopes],
        credentialId: key.id,
      };
    },
  };
}
