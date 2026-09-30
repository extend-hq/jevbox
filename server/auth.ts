import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { hashPassword, verifyPassword } from "./auth-passwords";
import { createAuthEmailSender, type SendAuthEmail } from "./auth-email";
import type { Store } from "./db";

export const registrationContext = new AsyncLocalStorage<{
  passwordHash: string;
}>();
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function createAuthentication(
  store: Store,
  options: {
    directory: string;
    origin: string;
    rateLimits?: boolean;
    sendAuthEmail?: SendAuthEmail;
  },
) {
  const localDevelopment =
    process.env.AUTH_LOCAL_DEVELOPMENT === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(options.origin).hostname,
    );
  if (
    process.env.NODE_ENV === "production" &&
    !localDevelopment &&
    !options.origin.startsWith("https://")
  )
    throw new Error("APP_ORIGIN must use HTTPS in production");
  let secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production")
    throw new Error("BETTER_AUTH_SECRET is required in production");
  if (!secret) {
    const path = resolve(options.directory, "auth.secret");
    if (!existsSync(path))
      writeFileSync(path, randomBytes(32).toString("hex"), {
        mode: 0o600,
        flag: "wx",
      });
    secret = readFileSync(path, "utf8").trim();
  }
  if (secret.length < 32)
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const sender =
    options.sendAuthEmail ?? createAuthEmailSender(localDevelopment);
  const sendEmail: SendAuthEmail = async (message) => {
    try {
      await sender(message);
    } catch {
      console.error("Authentication email delivery failed");
    }
  };
  async function consume(key: string, rule: { window: number; max: number }) {
    const now = Date.now();
    const result = await store.authDb.query<{
      count: number;
      window_started: number;
    }>(
      `INSERT INTO auth_throttle(key,count,window_started) VALUES($1,1,$2)
       ON CONFLICT(key) DO UPDATE SET
       count=CASE WHEN auth_throttle.window_started <= $3 THEN 1 ELSE auth_throttle.count+1 END,
       window_started=CASE WHEN auth_throttle.window_started <= $3 THEN $2 ELSE auth_throttle.window_started END
       RETURNING count,window_started`,
      [digest(key), now, now - rule.window * 1000],
    );
    const row = result.rows[0];
    return {
      allowed: row.count <= rule.max,
      retryAfter: Math.max(
        1,
        Math.ceil((row.window_started + rule.window * 1000 - now) / 1000),
      ),
    };
  }
  const auth = betterAuth({
    appName: "Jevbox",
    baseURL: options.origin,
    basePath: "/api/auth",
    secret,
    database: store.authDb,
    trustedOrigins: [options.origin],
    logger: { disabled: true },
    user: {
      modelName: "users",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      accountLinking: { enabled: false },
    },
    session: {
      modelName: "auth_sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
      },
      additionalFields: {
        orgId: {
          type: "string",
          required: false,
          input: false,
          fieldName: "org_id",
        },
      },
      expiresIn: 86400,
      freshAge: 900,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    verification: {
      modelName: "auth_verifications",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      storeIdentifier: "hashed",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      password: {
        hash: async (password) =>
          registrationContext.getStore()?.passwordHash ??
          hashPassword(password),
        verify: async ({ password, hash }) => {
          const valid = await verifyPassword(password, hash);
          if (valid && hash.startsWith("legacy_scrypt$"))
            await store.authDb.query(
              "UPDATE auth_accounts SET password=$1,updated_at=now() WHERE password=$2 AND provider_id='credential'",
              [await hashPassword(password), hash],
            );
          return valid;
        },
      },
      sendResetPassword: async ({ user, url }) =>
        sendEmail({ to: user.email, kind: "password-reset", url }),
    },
    emailVerification: {
      sendOnSignUp: false,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user, url }) =>
        sendEmail({ to: user.email, kind: "verification", url }),
    },
    advanced: {
      backgroundTasks: { handler: (task) => void task.catch(() => {}) },
      database: { generateId: () => randomUUID() },
      useSecureCookies: options.origin.startsWith("https://"),
      cookiePrefix: "jevbox",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      },
      ipAddress: { ipAddressHeaders: ["x-jevbox-client-ip"] },
    },
    rateLimit: {
      enabled: options.rateLimits !== false,
      window: 60,
      max: 100,
      customStorage: { consume },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && !registrationContext.getStore())
          throw new APIError("FORBIDDEN", {
            message: "Use the organization registration flow",
          });
        if (
          options.rateLimits !== false &&
          [
            "/sign-in/email",
            "/request-password-reset",
            "/send-verification-email",
          ].includes(ctx.path)
        ) {
          const address = String(ctx.body?.email ?? "")
            .trim()
            .toLowerCase();
          const limit = await consume(`${ctx.path}:${address}`, {
            window: 900,
            max: ctx.path === "/sign-in/email" ? 10 : 5,
          });
          if (!limit.allowed)
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many attempts. Try again later.",
            });
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const member = await store.one<{ org_id: string }>(
              "SELECT org_id FROM members WHERE user_id=? ORDER BY org_id LIMIT 1",
              session.userId,
            );
            if (!member)
              throw new APIError("FORBIDDEN", {
                message: "No organization membership",
              });
            return { data: { ...session, orgId: member.org_id } };
          },
        },
      },
    },
  });
  return { auth, consume };
}
