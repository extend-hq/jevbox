import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { betterAuth } from "better-auth";
import { jwt, organization } from "better-auth/plugins";
import { adminAc, memberAc } from "better-auth/plugins/organization/access";
import { apiKey } from "@better-auth/api-key";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { apiScopes } from "../shared/api-access";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
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
  if (!options.sendAuthEmail) createAuthEmailSender(localDevelopment);
  const sendEmail: SendAuthEmail = (message) => store.jobs.email(message);
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
  async function keepAdministrator(member: {
    organizationId: string;
    role: string;
  }) {
    if (
      member.role === "admin" &&
      Number(
        (
          await store.one<{ count: number }>(
            "SELECT count(*) AS count FROM members WHERE org_id=? AND role='admin'",
            member.organizationId,
          )
        )?.count,
      ) <= 1
    )
      throw new APIError("BAD_REQUEST", {
        message: "Keep at least one organization admin",
      });
  }
  const auth = betterAuth({
    appName: "Jevbox",
    baseURL: options.origin,
    basePath: "/api/auth",
    secret,
    database: store.authPool,
    trustedOrigins: [options.origin],
    logger: { disabled: true },
    disabledPaths: [
      "/token",
      "/organization/create",
      "/organization/add-member",
      "/organization/delete",
      "/api-key/create",
      "/api-key/update",
      "/api-key/delete",
      "/api-key/list",
      "/api-key/get",
      "/oauth2/update-consent",
      "/oauth2/delete-consent",
    ],
    plugins: [
      jwt(),
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        creatorRole: "admin",
        roles: { admin: adminAc, member: memberAc },
        requireEmailVerificationOnInvitation: true,
        invitationExpiresIn: 7 * 86400,
        cancelPendingInvitationsOnReInvite: true,
        schema: {
          session: { fields: { activeOrganizationId: "org_id" } },
          organization: {
            modelName: "orgs",
            fields: { createdAt: "created_at" },
          },
          member: {
            modelName: "members",
            fields: {
              organizationId: "org_id",
              userId: "user_id",
              createdAt: "created_at",
            },
          },
          invitation: {
            modelName: "invites",
            fields: {
              organizationId: "org_id",
              inviterId: "inviter_id",
              expiresAt: "expires_at",
              createdAt: "created_at",
            },
          },
        },
        sendInvitationEmail: async ({ id, email, organization }) =>
          sendEmail({
            to: email,
            kind: "invitation",
            invitationId: id,
            organizationName: organization.name,
            url: `${options.origin}/?invite=${encodeURIComponent(id)}`,
          }),
        organizationHooks: {
          beforeUpdateMemberRole: async ({ member, newRole }) => {
            if (!["admin", "member"].includes(newRole))
              throw new APIError("BAD_REQUEST", { message: "Invalid role" });
            if (newRole !== "admin") await keepAdministrator(member);
          },
          beforeRemoveMember: async ({ member }) => keepAdministrator(member),
          afterRemoveMember: async ({ member }) => {
            await store.run(
              "DELETE FROM auth_sessions WHERE org_id=? AND user_id=?",
              member.organizationId,
              member.userId,
            );
            await store.run(
              "DELETE FROM grants WHERE user_id=? AND resource_id IN (SELECT id FROM resources WHERE org_id=?)",
              member.userId,
              member.organizationId,
            );
            await store.run(
              "UPDATE invites SET status='canceled' WHERE org_id=? AND inviter_id=? AND status='pending'",
              member.organizationId,
              member.userId,
            );
          },
          beforeAcceptInvitation: async ({ invitation }) => {
            const inviter = await store.one<{ role: string }>(
              "SELECT role FROM members WHERE org_id=? AND user_id=?",
              invitation.organizationId,
              invitation.inviterId,
            );
            if (
              !inviter ||
              !(await store.permission(
                {
                  orgId: invitation.organizationId,
                  userId: invitation.inviterId,
                  role: inviter.role,
                  token: "invitation",
                },
                "organization",
                invitation.organizationId,
                "manage",
              ))
            )
              throw new APIError("FORBIDDEN", {
                message: "Invitation is no longer authorized",
              });
          },
        },
      }),
      apiKey({
        defaultPrefix: "jev_key_",
        requireName: true,
        maximumNameLength: 80,
        enableSessionForAPIKeys: false,
        keyExpiration: {
          defaultExpiresIn: 90 * 86400,
          minExpiresIn: 1,
          maxExpiresIn: 365,
        },
        rateLimit: {
          enabled: options.rateLimits !== false,
          timeWindow: 60000,
          maxRequests: 180,
        },
        permissions: {
          defaultPermissions: { documents: ["read"], search: ["read"] },
        },
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      mcp({
        resource: `${options.origin}/mcp`,
        loginPage: "/oauth/sign-in",
        consentPage: "/oauth/consent",
        scopes: [...apiScopes, "offline_access"],
        grantTypes: ["authorization_code", "refresh_token"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        allowPublicClientPrelogin: true,
        clientPrivileges: () => false,
        resourcePrivileges: () => false,
        resources: [
          {
            identifier: `${options.origin}/mcp`,
            allowedScopes: [...apiScopes, "offline_access"],
            accessTokenTtl: 300,
          },
          {
            identifier: `${options.origin}/api/v1`,
            allowedScopes: [...apiScopes, "offline_access"],
            accessTokenTtl: 300,
          },
        ],
        clientRegistrationDefaultResources: [
          `${options.origin}/mcp`,
          `${options.origin}/api/v1`,
        ],
        clientRegistrationDefaultScopes: [...apiScopes, "offline_access"],
        accessTokenExpiresIn: 300,
        codeExpiresIn: 300,
        customAccessTokenClaims: async ({ user }) => {
          if (!user?.emailVerified)
            throw new APIError("FORBIDDEN", {
              message: "Verified account required",
            });
          return { jevbox_issued_at: Date.now() };
        },
      }),
    ],
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
          ctx.path.startsWith("/organization/") &&
          (ctx.request || ctx.headers)
        ) {
          const session = await getSessionFromCtx(ctx);
          if (!session?.user.emailVerified)
            throw new APIError("UNAUTHORIZED", {
              message: "Verified account required",
            });
          if (
            ![
              "/organization/accept-invitation",
              "/organization/reject-invitation",
              "/organization/list-user-invitations",
              "/organization/get-invitation",
            ].includes(ctx.path)
          ) {
            let orgId =
              ctx.body?.organizationId ??
              ctx.query?.organizationId ??
              (session.session as { activeOrganizationId?: string })
                .activeOrganizationId;
            if (ctx.body?.invitationId)
              orgId = (
                await store.one<{ org_id: string }>(
                  "SELECT org_id FROM invites WHERE id=?",
                  ctx.body.invitationId,
                )
              )?.org_id;
            if (ctx.body?.organizationSlug ?? ctx.query?.organizationSlug)
              orgId = (
                await store.one<{ id: string }>(
                  "SELECT id FROM orgs WHERE slug=?",
                  ctx.body?.organizationSlug ?? ctx.query?.organizationSlug,
                )
              )?.id;
            if (orgId) {
              const member = await store.one<{ role: string }>(
                "SELECT role FROM members WHERE org_id=? AND user_id=?",
                orgId,
                session.user.id,
              );
              const manages = [
                "/organization/invite-member",
                "/organization/cancel-invitation",
                "/organization/update-member-role",
                "/organization/remove-member",
                "/organization/update",
              ].includes(ctx.path);
              if (
                !member ||
                !(await store.permission(
                  {
                    orgId,
                    userId: session.user.id,
                    role: member.role,
                    token: session.session.id,
                  },
                  "organization",
                  orgId,
                  manages ? "manage" : "active_member",
                ))
              )
                throw new APIError("FORBIDDEN", {
                  message: "Organization access denied",
                });
            }
          }
          if (ctx.body?.role && !["admin", "member"].includes(ctx.body.role))
            throw new APIError("BAD_REQUEST", { message: "Invalid role" });
        }
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
            return {
              data: {
                ...session,
                activeOrganizationId: member?.org_id ?? null,
              },
            };
          },
        },
      },
    },
  });
  return { auth, consume };
}
