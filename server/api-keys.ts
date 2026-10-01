import type { createAuthentication } from "./auth";
import { HttpError } from "./db";

type Auth = ReturnType<typeof createAuthentication>["auth"];

export function createApiKeys(auth: Auth) {
  return {
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
      const user = await (
        await auth.$context
      ).internalAdapter.findUserById(key.referenceId);
      if (!user?.emailVerified)
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
