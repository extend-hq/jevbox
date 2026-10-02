import { createChatRuntime } from "./chat";
import { createDownloadRouter } from "./downloads";
import { createLinkSharingRouter } from "./link-sharing";
import { createExternalAccess } from "./external-access";
import { createMcpRouter } from "./mcp";
import { createRuns } from "./runs";
import { apiScopes } from "../shared/api-access";
import { createUploads } from "./uploads";
import { uploadLimits } from "../shared/uploads";
import {
  isAuthPage,
  loginPath,
  loginRedirect,
} from "../shared/auth-navigation";
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { enqueueIndex } from "./indexing-jobs";
import { withLayoutSections } from "./indexing";
import { describeThumbnail, enqueueThumbnail } from "./thumbnails";
import { createWorkers } from "./workers";
import { queues, type QueueName } from "./jobs";
import { authenticateToken as tokenActor, sessionActor } from "./sessions";
import { asyncFilter, asyncEvery } from "./async";
import { extension } from "../shared/file-types";
import { availableChatModels, validateProviderURL } from "./ai";
import { providerCatalog } from "../shared/providers";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { createAuthentication } from "./auth";
import { isAPIError } from "better-auth/api";
import type { SendAuthEmail } from "./auth-email";
import multer from "multer";
import {
  createApiRateLimiter,
  createAnonymousRateLimiter,
} from "./rate-limits";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  createStore,
  HttpError,
  requireResource,
  resourceAccess,
  visibleResources,
  type Actor,
  type Resource,
} from "./db";
import {
  createProviders,
  getSettings,
  type Fetch,
  type Settings,
} from "./providers";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();
const name = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (s) => !/[\x00-\x1f/\\]/.test(s),
    "Use a name without slashes or control characters",
  );
const id = z.string().uuid();
type AuthedRequest = Request & {
  actor: Actor;
};
type Chat = {
  id: string;
  title: string;
  messages: string;
  dependencies: string;
  updated: string;
};
export async function createApp(options: {
  directory: string;
  databaseUrl?: string;
  origin: string;
  fetcher?: Fetch;
  rateLimits?: boolean;
  sendAuthEmail?: SendAuthEmail;
  workers?: QueueName[];
}) {
  const store = await createStore(options.directory, options.databaseUrl);
  let authentication: ReturnType<typeof createAuthentication>;
  try {
    authentication = createAuthentication(store, options);
  } catch (error) {
    await store.close();
    throw error;
  }
  const { auth } = authentication;
  const providers = createProviders(store, options.fetcher);
  const uploads = createUploads(store, { rateLimits: options.rateLimits });
  const external = createExternalAccess(
    store,
    auth,
    providers,
    options.origin,
    authentication.validateOAuthToken,
    options.rateLimits,
    uploads,
  );
  const app = express();
  const chats = createChatRuntime(
    store,
    providers,
    authenticate,
    (token) => tokenActor(store, auth, token),
    external.delegatedActor,
  );
  const runs = createRuns(store, external, chats, options.origin);
  app.disable("x-powered-by");
  const trustedProxies = process.env.TRUST_PROXY_CIDRS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (trustedProxies?.length) app.set("trust proxy", trustedProxies);
  app.get("/health/live", (_req, res) => res.json({ ok: true }));
  app.get("/health/ready", async (_req, res) => {
    try {
      await store.one("SELECT 1");
      await store.authorization.ready();
      await store.jobs.ready();
      await store.files.ready();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.use((req, res, next) => {
    req.headers["x-jevbox-client-ip"] = req.ip ?? "127.0.0.1";
    res.set({
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "SAMEORIGIN",
    });
    const externalRequest =
      req.path === "/mcp" ||
      req.path === "/mcp/" ||
      req.path.startsWith("/api/v1/") ||
      req.path === "/api/v1";
    const oauthProtocol = ["token", "register", "introspect", "revoke"].some(
      (endpoint) => req.path === `/api/auth/oauth2/${endpoint}`,
    );
    if (
      externalRequest &&
      req.headers.origin &&
      req.headers.origin !== options.origin &&
      !process.env.MCP_ALLOWED_ORIGINS?.split(",")
        .map((value) => value.trim())
        .includes(req.headers.origin)
    )
      return res.status(403).json({ error: "Request origin rejected" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !req.path.startsWith("/api/auth/") &&
      !externalRequest &&
      !oauthProtocol &&
      (req.headers.origin !== options.origin ||
        req.headers["x-jevbox-request"] !== "1")
    )
      return res.status(403).json({ error: "Request origin rejected" });
    next();
  });
  const anonymousLimit =
    options.rateLimits !== false ? createAnonymousRateLimiter() : null;
  const externalUsers = new WeakMap<Request, string>();
  const apiLimit =
    options.rateLimits !== false
      ? createApiRateLimiter(
          (req) => externalUsers.get(req) ?? actor(req).userId,
        )
      : null;
  if (anonymousLimit) app.use(["/api/auth", "/api/shared"], anonymousLimit);
  const audit = async (
    actor: Actor,
    action: string,
    resourceId: string | null = null,
  ) =>
    await store.run(
      "INSERT INTO audit(org_id,user_id,action,resource_id,created) VALUES(?,?,?,?,?)",
      actor.orgId,
      actor.userId,
      action,
      resourceId,
      now(),
    );
  async function authenticate(req: Request): Promise<Actor> {
    const authenticated = (req as Partial<AuthedRequest>).actor;
    if (authenticated) return authenticateToken(authenticated.token);
    return sessionActor(store, auth, fromNodeHeaders(req.headers));
  }
  const authenticateToken = (token: string) => tokenActor(store, auth, token);
  async function enqueueFiling(resourceId: string) {
    const previous = await store.one<{ job_id: string | null }>(
      "SELECT job_id FROM document_filing WHERE resource_id=?",
      resourceId,
    );
    if (previous?.job_id)
      await store.jobs.cancel(queues.filing, previous.job_id);
    const jobId = await store.jobs.send(
      queues.filing,
      { resourceId },
      resourceId,
    );
    await store.run(
      "UPDATE document_filing SET job_id=? WHERE resource_id=?",
      jobId,
      resourceId,
    );
  }
  function mutation(
    handler: (
      req: Request,
      res: Response,
    ) => Promise<{ status: number; body: unknown }>,
    anonymous = false,
  ) {
    return async (req: Request, res: Response) => {
      const result = await store.transaction(async () => {
        if (!anonymous) (req as AuthedRequest).actor = await authenticate(req);
        return handler(req, res);
      });
      res.status(result.status).json(result.body);
    };
  }
  const authHandler = toNodeHandler(async (request) => {
    const path = new URL(request.url).pathname;
    const writesApplicationState =
      path === "/api/auth/sign-up/email" ||
      path.startsWith("/api/auth/organization/") ||
      path.startsWith("/api/auth/api-key/") ||
      path === "/api/auth/oauth2/delete-consent";
    if (["GET", "HEAD"].includes(request.method) || !writesApplicationState)
      return auth.handler(request);
    let rejected: globalThis.Response | undefined;
    try {
      return await store.transaction(async () => {
        const response = await auth.handler(request);
        if (response.status >= 400) {
          rejected = response;
          throw new Error("Authentication operation rejected");
        }
        return response;
      });
    } catch (error) {
      if (rejected) return rejected;
      throw error;
    }
  });
  const authMetadata = oauthProviderAuthServerMetadata(auth);
  app.get(
    "/.well-known/oauth-authorization-server/api/auth",
    async (req, res) => {
      const response = await authMetadata(
        new globalThis.Request(new URL(req.originalUrl, options.origin)),
      );
      res
        .status(response.status)
        .type("json")
        .send(await response.text());
    },
  );
  app.get(
    [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ],
    authHandler,
  );
  for (const resource of ["api/v1"])
    app.get(`/.well-known/oauth-protected-resource/${resource}`, (_req, res) =>
      res.json({
        resource: `${options.origin}/${resource}`,
        authorization_servers: [`${options.origin}/api/auth`],
        scopes_supported: [...apiScopes],
        bearer_methods_supported: ["header"],
        resource_name: "Jevbox",
      }),
    );
  app.all("/api/auth/{*path}", authHandler);
  app.use(["/api/v1", "/mcp"], async (req, res, next) => {
    if (req.baseUrl === "/mcp" && req.method !== "POST")
      return anonymousLimit ? anonymousLimit(req, res, next) : next();
    try {
      const principal = await external.authenticate(
        req,
        req.baseUrl === "/mcp" ? "/mcp" : "/api/v1",
      );
      externalUsers.set(req, principal.userId);
      if (apiLimit) return apiLimit(req, res, next);
      next();
    } catch (error) {
      if (external.status(error) === 401) {
        const header = external.challenge(req, error);
        if (header) res.set("WWW-Authenticate", header);
      }
      if (anonymousLimit) return anonymousLimit(req, res, () => next(error));
      next(error);
    }
  });
  app.use("/mcp", async (req, res, next) => {
    if (req.method !== "POST") return next();
    try {
      const principal = await external.authenticate(req, "/mcp");
      const lease = uploads.reserve(
        req,
        res,
        principal.userId,
        uploadLimits.mcpRequestBytes,
      );
      express.json({ limit: uploadLimits.mcpRequestBytes, inflate: false })(
        req,
        res,
        (error) => {
          if (error) lease.release();
          else if (
            req.body?.method === "tools/call" &&
            req.body?.params?.name === "upload_document"
          )
            lease.retain();
          else lease.release();
          next(error);
        },
      );
    } catch (error) {
      const header = external.challenge(req, error);
      if (header && external.status(error) === 401)
        res.set("WWW-Authenticate", header);
      next(error);
    }
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/v1", external.router);
  app.use(
    "/mcp",
    createMcpRouter(external, auth, options.origin, uploads, runs),
  );
  app.use("/api/shared", createLinkSharingRouter(store));
  app.use("/api", async (req, res, next) => {
    try {
      (req as AuthedRequest).actor = await authenticate(req);
      next();
    } catch (error) {
      if (anonymousLimit) return anonymousLimit(req, res, () => next(error));
      next(error);
    }
  });
  const actor = (req: Request) => (req as AuthedRequest).actor;
  if (apiLimit) app.use("/api", apiLimit);
  async function admin(req: Request) {
    const a = await authenticate(req);
    if (!(await store.permission(a, "organization", a.orgId, "manage")))
      throw new HttpError(403, "Organization administrator required");
    return a;
  }

  app.get("/api/me", async (req, res) => {
    const a = actor(req);
    const settings = await getSettings(store, a.orgId);
    const headers = fromNodeHeaders(req.headers);
    const current = await auth.api.getSession({
      headers,
      query: { disableCookieCache: true },
    });
    if (!current) throw new HttpError(401, "Please sign in");
    const organizations = (await auth.api.listOrganizations({ headers })).map(
      ({ id, name }) => ({ id, name }),
    );
    res.json({
      user: {
        id: current.user.id,
        email: current.user.email,
        name: current.user.name,
      },
      organization: organizations.find(({ id }) => id === a.orgId),
      role: a.role,
      organizations,
      chatEnabled: availableChatModels(settings).length > 0,
      chatModels: availableChatModels(settings),
      defaultChatModel:
        availableChatModels(settings).find(
          (model) =>
            model.provider === settings.provider &&
            model.model === settings.model,
        ) ?? availableChatModels(settings)[0],
      semanticEnabled: Boolean(settings.jevKey),
      extendEnabled: Boolean(settings.extendKey),
    });
  });
  app.get("/api/settings", async (req, res) => {
    const a = await admin(req);
    const s = await getSettings(store, a.orgId);
    res.json({
      provider: s.provider ?? "openai",
      model: s.model ?? "gpt-6-luna",
      organization: {
        enabled: s.organization?.enabled !== false,
        model: s.organization?.model ?? null,
      },
      chatModels: availableChatModels(s),
      configured: {
        extendKey: Boolean(s.extendKey),
        jevKey: Boolean(s.jevKey),
      },
      providers: Object.fromEntries(
        Object.entries(s.credentials ?? {}).map(([key, value]) => [
          key,
          {
            configured: Boolean(value.apiKey || value.config),
            enabled: value.enabled !== false,
            model: value.model,
            models: value.models ?? [],
            hasConfig: Boolean(
              value.config && Object.keys(value.config).length,
            ),
          },
        ]),
      ),
    });
  });
  app.patch(
    "/api/settings/providers/:provider",
    mutation(async (req) => {
      const a = await admin(req);
      const { enabled } = z
        .object({ enabled: z.boolean() })
        .strict()
        .parse(req.body);
      const provider = z
        .string()
        .refine((id) => providerCatalog.some((item) => item.id === id))
        .parse(req.params.provider);
      const settings = await getSettings(store, a.orgId);
      const credential = settings.credentials?.[provider];
      if (!credential)
        throw new HttpError(404, "Configure this provider first.");
      credential.enabled = enabled;
      if (
        enabled &&
        !availableChatModels(settings).some(
          (model) => model.provider === provider,
        )
      )
        throw new HttpError(
          400,
          "Add credentials and at least one model before enabling this provider.",
        );
      await store.run(
        "UPDATE orgs SET settings=? WHERE id=?",
        store.encrypt(JSON.stringify(settings)),
        a.orgId,
      );
      await audit(a, "settings.provider.update");
      return { status: 200, body: { ok: true } };
    }),
  );
  app.put(
    "/api/settings",
    mutation(async (req, res) => {
      const a = await admin(req);
      const providerSetup = z.object({
        providerKey: z.string().max(10000).optional(),
        providerEnabled: z.boolean().optional(),
        providerConfig: z.record(z.string(), z.unknown()).optional(),
        provider: z
          .string()
          .refine((p) => providerCatalog.some((c) => c.id === p)),
        model: z.string().trim().max(150),
        models: z.array(z.string().trim().min(1).max(150)).max(30).optional(),
      });
      const common = {
        extendKey: z.string().max(1000).optional(),
        jevKey: z.string().max(1000).optional(),
        organization: z
          .object({
            enabled: z.boolean(),
            model: z
              .object({
                provider: z.string(),
                model: z.string().trim().min(1).max(150),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
      };
      const input = z
        .union([
          providerSetup.extend(common).strict(),
          z
            .object({
              ...common,
              removedProviders: z
                .array(
                  z
                    .string()
                    .refine((id) =>
                      providerCatalog.some((item) => item.id === id),
                    ),
                )
                .max(providerCatalog.length)
                .optional(),
              chatProviders: z
                .array(providerSetup.strict())
                .max(providerCatalog.length)
                .refine(
                  (items) =>
                    new Set(items.map((item) => item.provider)).size ===
                    items.length,
                  "Each provider can only be configured once.",
                ),
            })
            .strict(),
        ])
        .parse(req.body);
      const setups = "chatProviders" in input ? input.chatProviders : [input];
      for (const setup of setups) {
        if (setup.providerConfig) {
          const allowed = new Set([
            "baseURL",
            "resourceName",
            "region",
            "project",
            "location",
            "accessKeyId",
            "secretAccessKey",
            "sessionToken",
            "googleAuthOptions",
            "headers",
            "extension",
          ]);
          if (Object.keys(setup.providerConfig).some((k) => !allowed.has(k)))
            throw new HttpError(
              400,
              "Unsupported provider configuration field",
            );
          if (setup.providerConfig.baseURL)
            validateProviderURL(z.string().parse(setup.providerConfig.baseURL));
          if (setup.providerConfig.googleAuthOptions) {
            const auth = z
              .object({
                credentials: z
                  .object({ client_email: z.string(), private_key: z.string() })
                  .strict(),
              })
              .strict()
              .parse(setup.providerConfig.googleAuthOptions);
            setup.providerConfig.googleAuthOptions = auth;
          }
        }
      }
      const s = await getSettings(store, a.orgId);
      if (input.extendKey !== undefined) s.extendKey = input.extendKey.trim();
      if (input.jevKey !== undefined) s.jevKey = input.jevKey.trim();
      s.credentials ??= {};
      if ("removedProviders" in input) {
        for (const provider of input.removedProviders ?? []) {
          if (setups.some((setup) => setup.provider === provider))
            throw new HttpError(
              400,
              "A provider cannot be saved and removed together.",
            );
          delete s.credentials[provider];
        }
      }
      for (const setup of setups) {
        const credential = (s.credentials[setup.provider] ??= {});
        credential.model = setup.model;
        if (setup.providerEnabled !== undefined)
          credential.enabled = setup.providerEnabled;
        if (setup.models) credential.models = [...new Set(setup.models)];
        if (setup.providerKey !== undefined)
          credential.apiKey = setup.providerKey.trim();
        if (setup.providerConfig !== undefined)
          credential.config = setup.providerConfig;
      }
      if (!("chatProviders" in input)) {
        s.provider = input.provider;
        s.model = input.model;
      } else {
        const defaultModel =
          availableChatModels(s).find(
            (model) => model.provider === s.provider,
          ) ?? availableChatModels(s)[0];
        if (defaultModel) {
          s.provider = defaultModel.provider;
          s.model =
            s.credentials[defaultModel.provider]?.model || defaultModel.model;
        }
      }
      if (input.organization) {
        const selection = input.organization.model;
        if (
          selection &&
          !availableChatModels(s).some(
            (model) =>
              model.provider === selection.provider &&
              model.model === selection.model,
          )
        )
          throw new HttpError(
            400,
            "Choose an enabled model for folder naming.",
          );
        s.organization = input.organization;
      }
      await store.run(
        "UPDATE orgs SET settings=? WHERE id=?",
        store.encrypt(JSON.stringify(s)),
        a.orgId,
      );
      const awaitingDocuments = await store.all<{ id: string }>(
        "SELECT id FROM resources WHERE org_id=? AND status='awaiting_key'",
        a.orgId,
      );
      const awaitingFiling = await store.all<{ resource_id: string }>(
        "SELECT resource_id FROM document_filing WHERE state='awaiting_key' AND resource_id IN (SELECT id FROM resources WHERE org_id=?)",
        a.orgId,
      );
      const awaitingReviews = await store.all<{ id: string }>(
        "SELECT id FROM organization_reviews WHERE state='awaiting_key' AND org_id=?",
        a.orgId,
      );
      await store.run(
        "UPDATE resources SET status='queued',error=NULL WHERE org_id=? AND status='awaiting_key'",
        a.orgId,
      );
      await store.run(
        "UPDATE document_filing SET state='pending',error=NULL WHERE state='awaiting_key' AND resource_id IN (SELECT id FROM resources WHERE org_id=?)",
        a.orgId,
      );
      await store.run(
        "UPDATE organization_reviews SET state='pending',error=NULL WHERE state='awaiting_key' AND org_id=?",
        a.orgId,
      );
      for (const document of awaitingDocuments)
        await enqueueIndex(store, document.id);
      for (const filing of awaitingFiling)
        await enqueueFiling(filing.resource_id);
      for (const review of awaitingReviews) {
        const jobId = await store.jobs.send(
          queues.review,
          { reviewId: review.id },
          review.id,
        );
        await store.run(
          "UPDATE organization_reviews SET job_id=? WHERE id=?",
          jobId,
          review.id,
        );
      }
      await audit(a, "settings.update");
      return {
        status: 200,
        body: { ok: true },
      };
    }),
  );
  async function publicResource(r: Resource, a: Actor) {
    const {
      parsed,
      parse_run,
      org_id,
      thumbnail_job_id,
      thumbnail_key,
      thumbnail_width,
      thumbnail_height,
      thumbnail_pages,
      ...rest
    } = r;
    const filing =
      r.kind === "document"
        ? await store.one<{
            state: string;
            error: string | null;
            reason: string | null;
          }>(
            "SELECT state,error,outcome->>'reason' AS reason FROM document_filing WHERE resource_id=?",
            r.id,
          )
        : undefined;
    return {
      ...rest,
      thumbnail: describeThumbnail(r),
      filing,
      canWrite: await resourceAccess(store, a, r.id, "write"),
      canShare: await resourceAccess(store, a, r.id, "share"),
      pages: parsed ? JSON.parse(parsed).pages : 0,
    };
  }
  app.get("/api/resources", async (req, res) =>
    res.json(
      await Promise.all(
        (await visibleResources(store, actor(req))).map(
          async (r) => await publicResource(r, actor(req)),
        ),
      ),
    ),
  );
  app.post(
    "/api/folders",
    mutation(async (req, res) => {
      const a = actor(req);
      const input = z
        .object({
          name,
          description: z.string().max(1000).default(""),
          parentId: id.nullable().default(null),
        })
        .parse(req.body);
      if (
        input.parentId &&
        (await requireResource(store, a, input.parentId, "write")).kind !==
          "folder"
      )
        throw new HttpError(400, "Invalid parent");
      const rid = randomUUID();
      await store.run(
        "INSERT INTO resources(id,org_id,owner_id,parent_id,kind,name,description,created) VALUES(?,?,?,?,'folder',?,?,?)",
        rid,
        a.orgId,
        a.userId,
        input.parentId,
        input.name,
        input.description,
        now(),
      );
      await audit(a, "folder.create", rid);
      return {
        status: 201,
        body: { id: rid },
      };
    }),
  );
  app.post(
    "/api/documents",
    uploads.multipart(authenticate),
    async (req, res) => {
      try {
        if (!req.file) throw new HttpError(400, "Choose a document");
        const parentId = req.body.parentId ? id.parse(req.body.parentId) : null;
        const result = await uploads.save(
          await authenticate(req),
          req.file.originalname,
          req.file.buffer,
          parentId,
          () => authenticate(req),
          uploads.lease(req)?.signal,
        );
        res.status(201).json({ id: result.id });
      } finally {
        uploads.lease(req)?.release();
      }
    },
  );
  app.get("/api/resources/:id", async (req, res) => {
    const a = actor(req);
    const r = await requireResource(store, a, id.parse(req.params.id));
    res.json({
      ...(await publicResource(r, a)),
      parsed: r.parsed ? withLayoutSections(JSON.parse(r.parsed)) : null,
    });
  });
  app.get("/api/documents/:id/thumbnail", async (req, res) => {
    const a = actor(req);
    const resource = await requireResource(store, a, id.parse(req.params.id));
    if (resource.kind !== "document")
      throw new HttpError(404, "Thumbnail unavailable");
    const thumbnail = await store.files.read("thumbnail", resource.id);
    if (!thumbnail || resource.thumbnail_status !== "ready") {
      res.set("Retry-After", "4");
      return res.status(204).end();
    }
    await requireResource(store, a, resource.id);
    res.set({
      "Content-Type": thumbnail.mime,
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-cache",
      ETag: `"${resource.thumbnail_key}"`,
    });
    if (
      req
        .get("If-None-Match")
        ?.split(",")
        .some(
          (tag) =>
            tag.trim().replace(/^W\//, "") === `"${resource.thumbnail_key}"` ||
            tag.trim() === "*",
        )
    )
      return res.status(304).end();
    res.send(thumbnail.body);
  });
  app.use("/api/resources", createDownloadRouter(store, actor));
  app.get("/api/documents/:id/content", async (req, res) => {
    const r = await requireResource(store, actor(req), id.parse(req.params.id));
    const body = await store.files.read("document", r.id);
    if (!body) throw new HttpError(404, "Content not found");
    res.set({
      "Content-Type": r.mime,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `${["text/html", "text/xml", "image/svg+xml", "application/octet-stream"].includes(r.mime) ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(r.name)}`,
    });
    await requireResource(store, actor(req), r.id);
    const content = Buffer.from(body.body);
    res.set("Accept-Ranges", "bytes");
    const range = req.range(content.length);
    if (
      range === -1 ||
      (Array.isArray(range) && range.type === "bytes" && range.length !== 1)
    ) {
      res.status(416).set("Content-Range", `bytes */${content.length}`).end();
      return;
    }
    if (Array.isArray(range) && range.type === "bytes") {
      const { start, end } = range[0];
      res
        .status(206)
        .set("Content-Range", `bytes ${start}-${end}/${content.length}`)
        .send(content.subarray(start, end + 1));
      return;
    }
    res.send(content);
  });
  app.post(
    "/api/documents/:id/filing/retry",
    mutation(async (req) => {
      const r = await requireResource(
        store,
        actor(req),
        id.parse(req.params.id),
        "share",
      );
      if (r.kind !== "document" || r.status !== "ready")
        throw new HttpError(409, "Wait for indexing before retrying filing.");
      await store.run(
        "INSERT INTO document_filing(resource_id,scope_id,outcome) VALUES(?,?,?) ON CONFLICT(resource_id) DO UPDATE SET scope_id=excluded.scope_id,state='pending',is_review=false,outcome=excluded.outcome,error=NULL,attempt_id=NULL",
        r.id,
        r.parent_id,
        JSON.stringify({ requested: true }),
      );
      await enqueueFiling(r.id);
      return { status: 200, body: { ok: true } };
    }),
  );
  app.post("/api/documents/organize", async (req, res) => {
    const a = actor(req);
    const { ids } = z
      .object({ ids: z.array(id).min(1).max(100) })
      .strict()
      .parse(req.body);
    const claims = await store.transaction(async () => {
      const documents: Resource[] = [];
      for (const resourceId of new Set<string>(ids)) {
        const document = await requireResource(store, a, resourceId, "share");
        if (
          document.kind !== "document" ||
          document.status !== "ready" ||
          !document.parsed
        )
          throw new HttpError(409, "Select indexed documents to organize.");
        if (
          document.access !== "restricted" ||
          (await store.one(
            "SELECT 1 FROM grants WHERE resource_id=? LIMIT 1",
            document.id,
          ))
        )
          throw new HttpError(
            409,
            "Only private documents without sharing grants can be organized automatically.",
          );
        documents.push(document);
      }
      if (!(await getSettings(store, a.orgId)).jevKey)
        throw new HttpError(
          409,
          "Connect TypeSafe in organization settings to organize documents.",
        );
      const claims = [];
      for (const document of documents) {
        await store.run(
          "INSERT INTO document_filing(resource_id,scope_id,state,outcome) VALUES(?,NULL,'pending',?) ON CONFLICT(resource_id) DO UPDATE SET scope_id=NULL,state='pending',is_review=false,outcome=excluded.outcome,error=NULL,attempt_id=NULL",
          document.id,
          JSON.stringify({ requested: true }),
        );
        await enqueueFiling(document.id);
        await audit(a, "document.organize", document.id);
        claims.push(document.id);
      }
      return claims;
    });
    res.status(202).json({ count: claims.length });
  });
  app.post(
    "/api/documents/:id/retry",
    mutation(async (req, res) => {
      const r = await requireResource(
        store,
        actor(req),
        id.parse(req.params.id),
        "write",
      );
      if (r.kind !== "document" || ["queued", "processing"].includes(r.status))
        throw new HttpError(409, "Document is already processing");
      await store.run(
        "UPDATE resources SET status='queued',error=NULL,parse_requested=(parse_run IS NOT NULL) WHERE id=?",
        r.id,
      );
      await enqueueIndex(store, r.id);
      return {
        status: 200,
        body: { ok: true },
      };
    }),
  );
  app.patch(
    "/api/resources/:id",
    mutation(async (req, res) => {
      const a = actor(req);
      const r = await requireResource(
        store,
        a,
        id.parse(req.params.id),
        "write",
      );
      const input = z
        .object({ name, description: z.string().max(1000).default("") })
        .parse(req.body);
      await store.run(
        "UPDATE resources SET name=?,description=? WHERE id=?",
        input.name,
        input.description,
        r.id,
      );
      await audit(a, "resource.update", r.id);
      return {
        status: 200,
        body: { ok: true },
      };
    }),
  );
  app.post(
    "/api/resources/:id/move",
    mutation(async (req) => {
      const a = actor(req);
      const resource = await requireResource(
        store,
        a,
        id.parse(req.params.id),
        "share",
      );
      const { parentId } = z
        .object({ parentId: id.nullable() })
        .strict()
        .parse(req.body);
      await store.run(
        "UPDATE document_filing SET state='completed',outcome=?,attempt_id=NULL,error=NULL WHERE resource_id=?",
        JSON.stringify({ reason: "manual", parentId }),
        resource.id,
      );
      if (parentId === resource.parent_id)
        return { status: 200, body: { ok: true } };
      if (parentId) {
        const destination = await requireResource(store, a, parentId, "write");
        if (destination.kind !== "folder")
          throw new HttpError(400, "Choose a folder as the destination");
        let ancestor: string | null = parentId;
        const seen = new Set<string>();
        while (ancestor) {
          if (ancestor === resource.id || seen.has(ancestor))
            throw new HttpError(
              400,
              "A folder cannot be moved into itself or its descendants",
            );
          seen.add(ancestor);
          const parent: { parent_id: string | null } | undefined =
            await store.one(
              "SELECT parent_id FROM resources WHERE id=? AND org_id=?",
              ancestor,
              a.orgId,
            );
          ancestor = parent?.parent_id ?? null;
        }
      }
      await store.run(
        "UPDATE resources SET parent_id=?,access=CASE WHEN ?::text IS NULL AND access='inherit' THEN 'restricted' ELSE access END WHERE id=?",
        parentId,
        parentId,
        resource.id,
      );
      await audit(a, "resource.move", resource.id);
      return { status: 200, body: { ok: true } };
    }),
  );
  async function deleteResources(a: Actor, selectedIds: string[]) {
    for (const resourceId of selectedIds)
      await requireResource(store, a, resourceId, "share");
    const descendants = await store.all<{ id: string }>(
      `WITH RECURSIVE subtree AS (
        SELECT id FROM resources WHERE org_id=? AND id=ANY(?::text[])
        UNION
        SELECT r.id FROM resources r JOIN subtree s ON r.parent_id=s.id WHERE r.org_id=?
      ) SELECT id FROM subtree`,
      a.orgId,
      selectedIds,
      a.orgId,
    );
    const resourceIds = descendants.map((resource) => resource.id);
    for (const resourceId of resourceIds)
      if (!selectedIds.includes(resourceId))
        await requireResource(store, a, resourceId, "share");
    await store.run(
      "DELETE FROM resources WHERE org_id=? AND id=ANY(?::text[])",
      a.orgId,
      resourceIds,
    );
    for (const resourceId of resourceIds)
      await audit(a, "resource.delete", resourceId);
    return resourceIds.length;
  }
  app.post(
    "/api/resources/delete-batch",
    mutation(async (req) => {
      const a = actor(req);
      const { ids } = z
        .object({ ids: z.array(id).min(1).max(100) })
        .strict()
        .parse(req.body);
      const count = await deleteResources(a, [...new Set(ids)]);
      return { status: 200, body: { ok: true, count } };
    }),
  );
  app.delete(
    "/api/resources/:id",
    mutation(async (req, res) => {
      const a = actor(req);
      await deleteResources(a, [id.parse(req.params.id)]);
      return {
        status: 200,
        body: { ok: true },
      };
    }),
  );
  async function shareUrl(resourceId: string) {
    const link = await store.one<{ encrypted_token: string }>(
      "SELECT encrypted_token FROM share_links WHERE resource_id=?",
      resourceId,
    );
    return link
      ? `${options.origin}/s/${store.decrypt(link.encrypted_token)}`
      : null;
  }
  const accessInput = z
    .object({
      access: z.enum(["restricted", "organization", "inherit", "link"]),
      grants: z
        .array(
          z.object({ userId: id, role: z.enum(["viewer", "editor"]) }).strict(),
        )
        .max(200)
        .refine(
          (grants) =>
            new Set(grants.map((grant) => grant.userId)).size === grants.length,
          "Duplicate organization member",
        ),
    })
    .strict();
  const accessBatchInput = z
    .object({
      items: z
        .array(accessInput.extend({ resourceId: id }))
        .min(1)
        .max(1000),
    })
    .strict()
    .refine(
      (input) =>
        new Set(input.items.map((item) => item.resourceId)).size ===
        input.items.length,
      "Duplicate resource",
    );
  type SharingResource = Pick<
    Resource,
    "id" | "access" | "owner_id" | "parent_id"
  >;
  async function requireShareResources(a: Actor, resourceIds: string[]) {
    const resources = await store.all<SharingResource>(
      "SELECT id,access,owner_id,parent_id FROM resources WHERE org_id=? AND id=ANY(?::text[])",
      a.orgId,
      resourceIds,
    );
    if (resources.length !== resourceIds.length)
      throw new HttpError(404, "Resource not found");
    const allowed = await store.permissions(
      a,
      "resource",
      resourceIds,
      "share",
    );
    if (allowed.some((value) => !value))
      throw new HttpError(404, "Resource not found");
    const byId = new Map(resources.map((resource) => [resource.id, resource]));
    return resourceIds.map((resourceId) => byId.get(resourceId)!);
  }
  async function accessSettings(resources: SharingResource[]) {
    const resourceIds = resources.map((resource) => resource.id);
    const [grants, links] = await Promise.all([
      store.all<{ resource_id: string; userId: string; role: string }>(
        'SELECT resource_id,user_id AS "userId",role FROM grants WHERE resource_id=ANY(?::text[])',
        resourceIds,
      ),
      store.all<{ resource_id: string; encrypted_token: string }>(
        "SELECT resource_id,encrypted_token FROM share_links WHERE resource_id=ANY(?::text[])",
        resourceIds,
      ),
    ]);
    const urls = new Map(
      links.map((link) => [
        link.resource_id,
        `${options.origin}/s/${store.decrypt(link.encrypted_token)}`,
      ]),
    );
    const byResource = new Map<string, { userId: string; role: string }[]>();
    for (const { resource_id, ...grant } of grants) {
      const current = byResource.get(resource_id) ?? [];
      current.push(grant);
      byResource.set(resource_id, current);
    }
    return resources.map((resource) => ({
      resourceId: resource.id,
      access: resource.access,
      ownerId: resource.owner_id,
      parentId: resource.parent_id,
      shareUrl: urls.get(resource.id) ?? null,
      grants: byResource.get(resource.id) ?? [],
    }));
  }
  async function updateAccess(
    a: Actor,
    resources: SharingResource[],
    items: z.infer<typeof accessBatchInput>["items"],
  ) {
    const userIds = [
      ...new Set(
        items.flatMap((input) => input.grants.map((grant) => grant.userId)),
      ),
    ];
    const members = new Set(
      (
        await store.all<{ user_id: string }>(
          "SELECT user_id FROM members WHERE org_id=? AND user_id=ANY(?::text[])",
          a.orgId,
          userIds,
        )
      ).map((member) => member.user_id),
    );
    for (const [index, input] of items.entries()) {
      const resource = resources[index];
      if (input.access === "inherit" && !resource.parent_id)
        throw new HttpError(400, "A parent category is required");
      if (
        input.grants.some(
          (grant) =>
            grant.userId === resource.owner_id || !members.has(grant.userId),
        )
      )
        throw new HttpError(400, "Invalid organization member");
    }
    const resourceIds = resources.map((resource) => resource.id);
    await store.run(
      'UPDATE resources r SET access=input.access FROM jsonb_to_recordset(?::jsonb) AS input("resourceId" text,access text) WHERE r.id=input."resourceId" AND r.org_id=?',
      JSON.stringify(items),
      a.orgId,
    );
    await store.run(
      "DELETE FROM share_links WHERE resource_id=ANY(?::text[])",
      items
        .filter((input) => input.access !== "link")
        .map((input) => input.resourceId),
    );
    const existingLinks = new Set(
      (
        await store.all<{ resource_id: string }>(
          "SELECT resource_id FROM share_links WHERE resource_id=ANY(?::text[])",
          resourceIds,
        )
      ).map((link) => link.resource_id),
    );
    const links = items
      .filter(
        (input) =>
          input.access === "link" && !existingLinks.has(input.resourceId),
      )
      .map((input) => {
        const token = randomBytes(32).toString("hex");
        return {
          resource_id: input.resourceId,
          token_hash: digest(token),
          encrypted_token: store.encrypt(token),
        };
      });
    if (links.length)
      await store.run(
        "INSERT INTO share_links(resource_id,org_id,token_hash,encrypted_token) SELECT resource_id,?,token_hash,encrypted_token FROM jsonb_to_recordset(?::jsonb) AS input(resource_id text,token_hash text,encrypted_token text)",
        a.orgId,
        JSON.stringify(links),
      );
    await store.run(
      "DELETE FROM grants WHERE resource_id=ANY(?::text[])",
      resourceIds,
    );
    const grants = items.flatMap((input) =>
      input.grants.map((grant) => ({
        resource_id: input.resourceId,
        user_id: grant.userId,
        role: grant.role,
      })),
    );
    if (grants.length)
      await store.run(
        "INSERT INTO grants SELECT resource_id,user_id,role FROM jsonb_to_recordset(?::jsonb) AS input(resource_id text,user_id text,role text)",
        JSON.stringify(grants),
      );
    await store.run(
      "INSERT INTO audit(org_id,user_id,action,resource_id,created) SELECT ?,?,'resource.share',resource_id,? FROM unnest(?::text[]) AS resource_id",
      a.orgId,
      a.userId,
      now(),
      resourceIds,
    );
  }
  app.post("/api/resources/access-batch", async (req, res) => {
    const { ids } = z
      .object({ ids: z.array(id).min(1).max(1000) })
      .strict()
      .parse(req.body);
    const resources = await requireShareResources(actor(req), [
      ...new Set(ids),
    ]);
    res.json({ items: await accessSettings(resources) });
  });
  app.put(
    "/api/resources/access-batch",
    mutation(async (req) => {
      const a = actor(req);
      const { items } = accessBatchInput.parse(req.body);
      const resources = await requireShareResources(
        a,
        items.map((input) => input.resourceId),
      );
      await updateAccess(a, resources, items);
      return {
        status: 200,
        body: {
          ok: true,
          items: await accessSettings(
            resources.map((resource, index) => ({
              ...resource,
              access: items[index].access,
            })),
          ),
        },
      };
    }),
  );
  app.get("/api/resources/:id/access", async (req, res) => {
    const a = actor(req);
    const r = await requireResource(store, a, id.parse(req.params.id), "share");
    res.json({
      access: r.access,
      ownerId: r.owner_id,
      parentId: r.parent_id,
      shareUrl: await shareUrl(r.id),
      grants: await store.all(
        'SELECT user_id AS "userId",role FROM grants WHERE resource_id=?',
        r.id,
      ),
    });
  });
  app.put(
    "/api/resources/:id/access",
    mutation(async (req, res) => {
      const a = actor(req);
      const r = await requireResource(
        store,
        a,
        id.parse(req.params.id),
        "share",
      );
      const input = accessInput.parse(req.body);
      await updateAccess(a, [r], [{ ...input, resourceId: r.id }]);
      return {
        status: 200,
        body: { ok: true, shareUrl: await shareUrl(r.id) },
      };
    }),
  );
  app.post("/api/search", async (req, res) => {
    const a = actor(req);
    const query = z.string().trim().min(1).max(2000).parse(req.body.query);
    const result = await providers.retrieve(a, query);
    await authenticate(req);
    result.results = await asyncFilter(
      result.results,
      async (s) => await resourceAccess(store, a, s.documentId),
    );
    result.trace = await asyncFilter(
      result.trace,
      async (t) =>
        !t.resourceId || (await resourceAccess(store, a, t.resourceId)),
    );
    res.json(result);
  });
  app.use("/api/chats", chats.router);
  app.get("/api/audit", async (req, res) => {
    const a = await admin(req);
    res.json(
      await store.all(
        "SELECT action,created,user_id FROM audit WHERE org_id=? ORDER BY id DESC LIMIT 100",
        a.orgId,
      ),
    );
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(async (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method)) return next();
    const url = new URL(req.originalUrl, options.origin);
    if (
      req.path === "/oauth/sign-in" ||
      req.path === "/login/" ||
      (req.path === "/" &&
        ["invite", "verified", "error"].some((parameter) =>
          url.searchParams.has(parameter),
        ))
    )
      return res.redirect(302, loginRedirect(url));
    if (isAuthPage(req.path) || /^\/s\/[^/]+(?:\/|$)/.test(req.path))
      return next();
    const pageRequest =
      req.path === "/" ||
      /^\/(?:library|documents|chats|search|settings|oauth|loader)(?:\/|$)/.test(
        req.path,
      ) ||
      req.headers["sec-fetch-dest"] === "document" ||
      req.headers.accept?.includes("text/html");
    if (!pageRequest) return next();
    try {
      await authenticate(req);
    } catch (error) {
      if (error instanceof HttpError && error.status === 401)
        return res.redirect(302, loginRedirect(url));
      throw error;
    }
    next();
  });
  app.use(
    (error: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (res.headersSent) return next(error);
      if (error instanceof z.ZodError)
        return res
          .status(400)
          .json({ error: error.issues[0]?.message ?? "Invalid input" });
      if (error instanceof multer.MulterError)
        return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
          error:
            "Upload must contain one file at most 250 MB and valid metadata",
        });
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.too.large"
      )
        return res
          .status(413)
          .json({ error: "Request body exceeds its size limit" });
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "encoding.unsupported"
      )
        return res
          .status(415)
          .json({ error: "Compressed request bodies are not supported" });
      if (isAPIError(error))
        return res.status(error.statusCode).json({
          error: error.body?.message ?? "Authentication request rejected",
        });
      if (error instanceof HttpError) {
        if (error.status === 429)
          res.set("Retry-After", String(error.retryAfter ?? 60));
        return res.status(error.status).json({ error: error.message });
      }
      res
        .status(500)
        .json({ error: "The request could not be completed. Please retry." });
    },
  );
  const workers = createWorkers(store, { ...options, chats, runs, external });
  try {
    await workers.start(options.workers ?? []);
  } catch (error) {
    await workers.close();
    await store.close();
    throw error;
  }
  return {
    app,
    store,
    auth,
    providers,
    workers,
    runs,
    closeChats: chats.close,
    closeStreams: chats.closeStreams,
    async close() {
      await workers.close();
      await store.close();
    },
  };
}
