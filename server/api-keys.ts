import { z } from "zod";
import { type ApiKeyInfo } from "../shared/api-access";
import type { createAuthentication } from "./auth";
import { HttpError, type Store } from "./db";

type Auth = ReturnType<typeof createAuthentication>["auth"];
type KeyRow = {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  lastRequest: Date | null;
  enabled: boolean;
  updatedAt: Date;
};
const publicKey = (row: KeyRow): ApiKeyInfo => ({
  id: row.id,
  name: row.name ?? "API key",
  prefix: row.start ?? "jev_key_",
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt!.toISOString(),
  lastUsedAt: row.lastRequest?.toISOString() ?? null,
  revokedAt: row.enabled ? null : row.updatedAt.toISOString(),
});

export function createApiKeys(store: Store, auth: Auth) {
  return {
    async list(userId: string) {
      return (
        await store.all<KeyRow>(
          'SELECT * FROM apikey WHERE "referenceId"=? ORDER BY "createdAt" DESC LIMIT 100',
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
        const count = await store.one<{ count: number }>(
          'SELECT count(*) FROM apikey WHERE "referenceId"=? AND enabled=true AND "expiresAt">now()',
          userId,
        );
        if (Number(count?.count) >= 20)
          throw new HttpError(409, "Revoke a key before creating another.");
        const key = await auth.api.createApiKey({
          body: {
            userId,
            name: input.name,
            expiresIn: input.expiresInDays * 86400,
            permissions: { documents: ["read"], search: ["read"] },
          },
        });
        return { key: publicKey(key), token: key.key };
      });
    },
    async revoke(userId: string, keyId: string) {
      const key = await store.one<KeyRow>(
        'SELECT * FROM apikey WHERE id=? AND "referenceId"=?',
        z.string().uuid().parse(keyId),
        userId,
      );
      if (!key) throw new HttpError(404, "API key not found");
      if (key.enabled)
        await auth.api.updateApiKey({
          body: { userId, keyId, enabled: false },
        });
    },
    async authenticate(token: string) {
      if (!token.startsWith("jev_key_") || token.length > 256)
        throw new HttpError(401, "Invalid or expired API key");
      const result = await auth.api.verifyApiKey({ body: { key: token } });
      if (!result.valid || !result.key) {
        if (result.error?.code === "RATE_LIMITED")
          throw new HttpError(429, "API key rate limit reached");
        throw new HttpError(401, "Invalid or expired API key");
      }
      const key = result.key;
      if (
        !(await store.one(
          "SELECT id FROM users WHERE id=? AND email_verified=true",
          key.referenceId,
        ))
      )
        throw new HttpError(401, "Verified account required");
      const permissions =
        typeof key.permissions === "string"
          ? JSON.parse(key.permissions)
          : key.permissions;
      const scopes = ["documents", "search"]
        .filter((resource) => permissions?.[resource]?.includes("read"))
        .map((resource) => `${resource}:read`);
      return { userId: key.referenceId, scopes, credentialId: key.id };
    },
  };
}
