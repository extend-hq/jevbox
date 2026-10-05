import { randomBytes, randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { betterAuth } from "better-auth";
import { admin, bearer, organization } from "better-auth/plugins";
import { getOAuthProviderApi } from "@better-auth/oauth-provider";
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
  isAPIError,
} from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { verifyImportedPassword } from "./password-migration";
import { createAuthEmailSender, type SendAuthEmail } from "./auth-email";
import type { Store } from "./db";
import { z } from "zod";
import { verificationDestination } from "../shared/auth-navigation";

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
  const ownerUserId = process.env.OWNER_USER_ID?.trim();
  const isOwner = (userId: string) =>
    Boolean(ownerUserId && userId === ownerUserId);
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
  async function keepAdministrator(member: {
    organizationId: string;
    role: string;
  }) {
    if (
      member.role === "admin" &&
      (await (
        await auth.$context
      ).adapter.count({
        model: "member",
        where: [
          { field: "organizationId", value: member.organizationId },
          { field: "role", value: "admin" },
        ],
      })) <= 1
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
      "/oauth2/update-consent",
    ],
    plugins: [
      bearer(),
      admin({
        adminUserIds: ownerUserId ? [ownerUserId] : [],
        schema: {
          user: {
            fields: { banReason: "ban_reason", banExpires: "ban_expires" },
          },
          session: { fields: { impersonatedBy: "impersonated_by" } },
        },
      }),
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
            url: `${options.origin}/login?invite=${encodeURIComponent(id)}`,
          }),
        organizationHooks: {
          beforeUpdateMemberRole: async ({ member, newRole }) => {
            if (!["admin", "member"].includes(newRole))
              throw new APIError("BAD_REQUEST", { message: "Invalid role" });
            if (newRole !== "admin") await keepAdministrator(member);
          },
          beforeRemoveMember: async ({ member }) => keepAdministrator(member),
          afterRemoveMember: async ({ member }) => {
            const { internalAdapter, adapter } = await auth.$context;
            const sessions = (await internalAdapter.listSessions(member.userId))
              .filter(
                (session) =>
                  (
                    session as typeof session & {
                      activeOrganizationId?: string;
                    }
                  ).activeOrganizationId === member.organizationId,
              )
              .map((session) => session.token);
            if (sessions.length) await internalAdapter.deleteSessions(sessions);
            await store.run(
              "DELETE FROM grants WHERE user_id=? AND resource_id IN (SELECT id FROM resources WHERE org_id=?)",
              member.userId,
              member.organizationId,
            );
            await adapter.updateMany({
              model: "invitation",
              where: [
                { field: "organizationId", value: member.organizationId },
                { field: "inviterId", value: member.userId },
                { field: "status", value: "pending" },
              ],
              update: { status: "canceled" },
            });
          },
          beforeAcceptInvitation: async ({ invitation }) => {
            const inviter = await (
              await auth.$context
            ).adapter.findOne<{ role: string }>({
              model: "member",
              where: [
                { field: "organizationId", value: invitation.organizationId },
                { field: "userId", value: invitation.inviterId },
              ],
            });
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
          maxRequests: 600,
        },
        permissions: {
          defaultPermissions: {
            documents: ["read", "write"],
            search: ["read"],
          },
        },
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
      mcp({
        disableJwtPlugin: true,
        resource: `${options.origin}/mcp`,
        loginPage: "/login",
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
          return {};
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
      customSyntheticUser: ({ coreFields, additionalFields, id }) => ({
        ...coreFields,
        role: "user",
        banned: false,
        banReason: null,
        banExpires: null,
        ...additionalFields,
        id,
      }),
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      password: {
        verify: ({ password, hash }) => verifyImportedPassword(password, hash),
      },
      sendResetPassword: async ({ user, url }) =>
        sendEmail({ to: user.email, kind: "password-reset", url }),
      onExistingUserSignUp: async ({ user }, request) => {
        if (user.emailVerified) return;
        const body = await request?.json();
        await auth.api.sendVerificationEmail({
          body: { email: user.email, callbackURL: body?.callbackURL },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
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
      storage: "database",
      customRules: {
        "/api-key/create": { window: 3600, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path.startsWith("/admin/")) {
          const session = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
          });
          if (!session)
            throw new APIError("UNAUTHORIZED", { message: "Please sign in" });
          if (!session.user.emailVerified || !isOwner(session.user.id))
            throw new APIError("FORBIDDEN", {
              message: "Deployment owner access required",
            });
          if (ctx.path !== "/admin/list-users")
            throw new APIError("FORBIDDEN", {
              message: "User administration is read-only",
            });
        }
        if (
          ctx.path === "/oauth2/register" &&
          ctx.body?.application_type === undefined &&
          ctx.body?.token_endpoint_auth_method === "none"
        ) {
          const redirects = z
            .array(z.string())
            .nonempty()
            .safeParse(ctx.body.redirect_uris);
          if (
            redirects.success &&
            redirects.data.every((uri) => {
              try {
                const url = new URL(uri);
                return (
                  url.protocol === "http:" &&
                  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
                );
              } catch {
                return false;
              }
            })
          )
            return {
              context: { body: { ...ctx.body, application_type: "native" } },
            };
        }
        if (ctx.path === "/sign-up/email") {
          const label = z
            .string()
            .trim()
            .min(1)
            .max(160)
            .refine((value) => !/[\x00-\x1f/\\]/.test(value));
          const input = z
            .object({
              email: z
                .string()
                .trim()
                .email()
                .max(254)
                .transform((value) => value.toLowerCase()),
              name: label,
              organization: label.optional(),
              invite: z.string().min(1).max(256).optional(),
              bootstrapToken: z.string().max(256).optional(),
            })
            .safeParse(ctx.body);
          if (!input.success)
            throw new APIError("BAD_REQUEST", {
              message: "Invalid registration details",
            });
          const invitation = input.data.invite
            ? await (
                await auth.$context
              ).adapter.findOne<{ email: string }>({
                model: "invitation",
                where: [
                  { field: "id", value: input.data.invite },
                  { field: "status", value: "pending" },
                  { field: "expiresAt", operator: "gt", value: new Date() },
                ],
              })
            : undefined;
          if (input.data.invite && invitation?.email !== input.data.email)
            throw new APIError("BAD_REQUEST", {
              message: "Invitation is invalid or expired",
            });
          if (!invitation) {
            if (!input.data.organization)
              throw new APIError("FORBIDDEN", {
                message: "An organization or invitation is required",
              });
            if (
              process.env.NODE_ENV === "production" &&
              process.env.ALLOW_SIGNUP !== "true"
            ) {
              const approved =
                process.env.BOOTSTRAP_TOKEN &&
                input.data.bootstrapToken &&
                digest(process.env.BOOTSTRAP_TOKEN) ===
                  digest(input.data.bootstrapToken);
              if (
                !approved ||
                (await (await auth.$context).internalAdapter.listUsers(1))
                  .length > 0
              )
                throw new APIError("FORBIDDEN", {
                  message:
                    "An invitation is required. First-time setup requires the deployment bootstrap token.",
                });
            }
          }
          return {
            context: {
              body: {
                ...ctx.body,
                ...input.data,
                callbackURL:
                  ctx.body.callbackURL ??
                  verificationDestination(
                    new URL(options.origin),
                    input.data.invite,
                  ),
              },
            },
          };
        }
        if (ctx.path === "/sign-in/email")
          ctx.body.callbackURL ??= verificationDestination(
            new URL(options.origin),
          );
        if (
          ctx.path.startsWith("/organization/") &&
          (ctx.request || ctx.headers)
        ) {
          const session = await auth.api.getSession({
            headers: ctx.headers ?? ctx.request?.headers ?? new Headers(),
            query: { disableCookieCache: true },
          });
          ctx.context.session = session;
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
                await (
                  await auth.$context
                ).adapter.findOne<{ organizationId: string }>({
                  model: "invitation",
                  where: [{ field: "id", value: ctx.body.invitationId }],
                })
              )?.organizationId;
            if (ctx.body?.organizationSlug ?? ctx.query?.organizationSlug)
              orgId = (
                await (
                  await auth.$context
                ).adapter.findOne<{ id: string }>({
                  model: "organization",
                  where: [
                    {
                      field: "slug",
                      value:
                        ctx.body?.organizationSlug ??
                        ctx.query?.organizationSlug,
                    },
                  ],
                })
              )?.id;
            if (orgId) {
              const member = await (
                await auth.$context
              ).adapter.findOne<{ role: string }>({
                model: "member",
                where: [
                  { field: "organizationId", value: orgId },
                  { field: "userId", value: session.user.id },
                ],
              });
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
        if (ctx.path === "/oauth2/delete-consent") {
          const consent = await auth.api.getOAuthConsent({
            headers: ctx.headers,
            query: { id: ctx.body.id },
          });
          const { adapter } = await auth.$context;
          for (const model of ["oauthAccessToken", "oauthRefreshToken"])
            await adapter.deleteMany({
              model,
              where: [
                { field: "userId", value: consent.userId },
                { field: "clientId", value: consent.clientId },
              ],
            });
        }
        if (ctx.path.startsWith("/api-key/") && (ctx.request || ctx.headers)) {
          const session = await auth.api.getSession({
            headers: ctx.headers ?? ctx.request?.headers ?? new Headers(),
            query: { disableCookieCache: true },
          });
          ctx.context.session = session;
          if (!session?.user.emailVerified)
            throw new APIError("UNAUTHORIZED", {
              message: "Verified account required",
            });
          if (ctx.path === "/api-key/create") {
            const input = z
              .object({
                name: z
                  .string()
                  .trim()
                  .min(1)
                  .max(80)
                  .regex(/^[^\x00-\x1f]+$/),
                expiresIn: z
                  .number()
                  .int()
                  .min(86400)
                  .max(365 * 86400)
                  .optional(),
              })
              .strict()
              .safeParse(ctx.body);
            if (!input.success)
              throw new APIError("BAD_REQUEST", {
                message: "Invalid API key details",
              });
            const keys = await auth.api.listApiKeys({
              headers: ctx.headers,
              query: { limit: 100 },
            });
            if (
              keys.apiKeys.filter(
                (key) =>
                  key.enabled && key.expiresAt && key.expiresAt > new Date(),
              ).length >= 20
            )
              throw new APIError("CONFLICT", {
                message: "Revoke a key before creating another.",
              });
          }
          if (
            ctx.path === "/api-key/update" &&
            !z
              .object({ keyId: z.string(), enabled: z.literal(false) })
              .strict()
              .safeParse(ctx.body).success
          )
            throw new APIError("BAD_REQUEST", {
              message: "Only key revocation is permitted",
            });
          if (
            ctx.path === "/api-key/delete" &&
            !z.object({ keyId: z.string() }).strict().safeParse(ctx.body)
              .success
          )
            throw new APIError("BAD_REQUEST", {
              message: "Invalid API key details",
            });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (isAPIError(ctx.context.returned)) return;
        if (ctx.path === "/sign-in/email" && ctx.context.newSession) {
          const { internalAdapter } = await auth.$context;
          const found = await internalAdapter.findUserByEmail(ctx.body.email);
          if (found) {
            const account = await internalAdapter.findCredentialAccount(
              found.user.id,
            );
            if (
              account?.password &&
              /^(legacy_scrypt|scrypt)\$/.test(account.password)
            )
              await internalAdapter.updatePassword(
                found.user.id,
                await hashPassword(ctx.body.password),
              );
          }
        }
        const actions: Record<string, string> = {
          "/organization/invite-member": "invite.create",
          "/organization/cancel-invitation": "invite.cancel",
          "/organization/update-member-role": "member.role",
          "/organization/remove-member": "member.remove",
          "/api-key/create": "api-key.create",
          "/api-key/update": "api-key.revoke",
          "/api-key/delete": "api-key.revoke",
          "/oauth2/delete-consent": "oauth.disconnect",
        };
        const action = actions[ctx.path];
        if (!action) return;
        const session = await getSessionFromCtx(ctx);
        if (session?.session.activeOrganizationId)
          await store.run(
            "INSERT INTO audit(org_id,user_id,action,created) VALUES(?,?,?,?)",
            session.session.activeOrganizationId,
            session.user.id,
            action,
            new Date().toISOString(),
          );
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user, ctx) => {
            if (ctx?.path !== "/sign-up/email" || ctx.body?.invite) return;
            await auth.api.createOrganization({
              body: {
                name: ctx.body.organization,
                slug: randomUUID(),
                userId: user.id,
              },
            });
          },
        },
      },
      session: {
        delete: {
          before: async (session) => {
            const { adapter } = await auth.$context;
            for (const model of ["oauthAccessToken", "oauthRefreshToken"])
              await adapter.deleteMany({
                model,
                where: [{ field: "sessionId", value: session.id }],
              });
          },
        },
        create: {
          before: async (
            session,
          ): Promise<{
            data: typeof session & { activeOrganizationId: string | null };
          }> => {
            const [member] = await (
              await auth.$context
            ).adapter.findMany<{ organizationId: string }>({
              model: "member",
              where: [{ field: "userId", value: session.userId }],
              sortBy: { field: "organizationId", direction: "asc" },
              limit: 1,
            });
            return {
              data: {
                ...session,
                activeOrganizationId: member?.organizationId ?? null,
              },
            };
          },
        },
      },
    },
  });
  async function validateOAuthToken(token: string) {
    const context = await auth.$context;
    const plugin = auth.options.plugins.find(
      (plugin) => plugin.id === "oauth-provider",
    )!;
    return getOAuthProviderApi(
      { context } as Parameters<typeof getOAuthProviderApi>[0],
      plugin.options as Parameters<typeof getOAuthProviderApi>[1],
    ).requireActiveAccessToken(token);
  }
  return { auth, validateOAuthToken, isOwner };
}
