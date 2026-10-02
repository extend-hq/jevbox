import { Router, type Request } from "express";
import {
  createInsufficientScopeError,
  DPOP_SIGNING_ALGORITHMS,
  createDpopReplayStore,
  enforceDpopBinding,
  isDpopBindingError,
  parseAccessTokenAuthorization,
} from "better-auth/oauth2";
import { APIError, isAPIError } from "better-auth/api";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { MemoryStore } from "express-rate-limit";
import { z } from "zod";
import { apiScopes, type ApiScope } from "../shared/api-access";
import { createApiKeys } from "./api-keys";
import type { createAuthentication } from "./auth";
import {
  HttpError,
  requireResource,
  resourceAccess,
  visibleResources,
  type Actor,
  type Store,
} from "./db";
import { flatten, withLayoutSections, type ParsedDocument } from "./indexing";
import type { createProviders } from "./providers";
import { uploadInput, decodeUpload, type createUploads } from "./uploads";

type Auth = ReturnType<typeof createAuthentication>["auth"];
export type Principal = {
  userId: string;
  scopes: readonly string[];
  credentialId: string;
};
const delegationSchema = z.object({
  principal: z.object({
    userId: z.string(),
    scopes: z.array(z.string()),
    credentialId: z.string(),
  }),
  oauth: z.object({ clientId: z.string(), consentId: z.string() }).optional(),
});
const documentPath = (id: string, nodeId?: string) =>
  `/library/documents/${encodeURIComponent(id)}${nodeId ? `?${new URLSearchParams({ node: nodeId, tab: "index" })}` : ""}`;
const organizationId = z.string().uuid();
export const searchInput = z
  .object({
    organizationId,
    query: z.string().trim().min(1).max(2000),
    documentIds: z.array(z.string().uuid()).max(50).default([]),
    folderId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(12).default(12),
  })
  .strict();
export const fetchInput = z
  .object({
    organizationId,
    id: z.string().min(1).max(300),
    nodeId: z.string().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(10000000).default(0),
    limit: z.number().int().min(1).max(24000).default(12000),
  })
  .strict();

export function createExternalAccess(
  store: Store,
  auth: Auth,
  providers: ReturnType<typeof createProviders>,
  origin: string,
  validateOAuthToken: ReturnType<
    typeof createAuthentication
  >["validateOAuthToken"],
  rateLimits = true,
  uploads: ReturnType<typeof createUploads>,
) {
  const keys = createApiKeys(auth);
  const verifiedRequests = new WeakSet<Request>();
  const keyRequests = new WeakMap<Request, Principal>();
  const searchLimits = new MemoryStore();
  searchLimits.init({ windowMs: 60000 } as Parameters<MemoryStore["init"]>[0]);
  async function authenticate(
    req: Request,
    audience: "/mcp" | "/api/v1",
  ): Promise<Principal> {
    const authorization = parseAccessTokenAuthorization(
      req.headers.authorization,
    );
    if (
      !authorization?.token ||
      authorization.token.length > 16000 ||
      authorization.scheme === "Unknown"
    )
      throw new HttpError(401, "Bearer credential required");
    if (
      authorization.scheme === "Bearer" &&
      authorization.token.startsWith("jev_key_")
    ) {
      const existing = keyRequests.get(req);
      if (existing)
        return delegatedPrincipal(JSON.stringify({ principal: existing }));
      const principal = await keys.authenticate(authorization.token);
      keyRequests.set(req, principal);
      return principal;
    }
    try {
      const payload = await validateOAuthToken(authorization.token);
      const audiences = Array.isArray(payload.aud)
        ? payload.aud
        : [payload.aud];
      if (!audiences.includes(`${origin}${audience}`))
        throw new HttpError(401, "Access token is for another resource");
      if (!verifiedRequests.has(req))
        await enforceDpopBinding({
          payload,
          authorization,
          proofJwt: req.get("DPoP"),
          method: req.method,
          url: new URL(req.originalUrl, origin).href,
          replayStore: createDpopReplayStore(
            (await auth.$context).internalAdapter,
          ),
        });
      verifiedRequests.add(req);
      if (
        typeof payload.sub !== "string" ||
        typeof payload.azp !== "string" ||
        typeof payload.scope !== "string"
      )
        throw new HttpError(401, "Invalid access token");
      return {
        userId: payload.sub,
        scopes: payload.scope.split(" ").filter(Boolean),
        credentialId: `oauth:${payload.azp}:${payload.sub}`,
      };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new APIError("UNAUTHORIZED", {
        message: isDpopBindingError(error)
          ? error.message
          : "Invalid or expired access token",
        error: isDpopBindingError(error) ? error.code : "invalid_token",
      });
    }
  }
  function requireScope(principal: Principal, scope: ApiScope) {
    if (!principal.scopes.includes(scope))
      throw createInsufficientScopeError([scope]);
  }
  async function actor(principal: Principal, orgId: string): Promise<Actor> {
    const member = await store.one<{ role: string }>(
      "SELECT m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.user_id=? AND m.org_id=? AND u.email_verified=true",
      principal.userId,
      orgId,
    );
    const result = {
      userId: principal.userId,
      orgId,
      role: member?.role ?? "member",
      token: principal.credentialId,
    };
    if (
      !member ||
      !(await store.permission(result, "organization", orgId, "active_member"))
    )
      throw new HttpError(404, "Organization not found");
    return result;
  }
  async function delegate(principal: Principal, req: Request) {
    let oauth: { clientId: string; consentId: string } | undefined;
    if (principal.credentialId.startsWith("oauth:")) {
      const payload = await validateOAuthToken(
        parseAccessTokenAuthorization(req.headers.authorization)!.token,
      );
      if (typeof payload.azp !== "string")
        throw new HttpError(401, "Invalid access token");
      const consent = await (
        await auth.$context
      ).adapter.findOne<{ id: string }>({
        model: "oauthConsent",
        where: [
          { field: "clientId", value: payload.azp },
          { field: "userId", value: principal.userId },
        ],
      });
      if (!consent)
        throw new HttpError(401, "Authorization is no longer available");
      oauth = { clientId: payload.azp, consentId: consent.id };
    }
    return JSON.stringify({
      principal,
      ...(oauth ? { oauth } : {}),
    });
  }
  async function delegatedPrincipal(value: string): Promise<Principal> {
    const accepted = delegationSchema.parse(JSON.parse(value));
    const context = await auth.$context;
    let scopes: string[];
    if (accepted.oauth) {
      const consent = await context.adapter.findOne<{
        userId: string;
        clientId: string;
        scopes: string[];
        resources?: string[];
      }>({
        model: "oauthConsent",
        where: [{ field: "id", value: accepted.oauth.consentId }],
      });
      const client = await context.adapter.findOne<{ disabled?: boolean }>({
        model: "oauthClient",
        where: [{ field: "clientId", value: accepted.oauth.clientId }],
      });
      if (
        !client ||
        client.disabled ||
        !consent ||
        consent.userId !== accepted.principal.userId ||
        consent.clientId !== accepted.oauth.clientId ||
        (consent.resources?.length &&
          !consent.resources.includes(`${origin}/mcp`)) ||
        `oauth:${consent.clientId}:${consent.userId}` !==
          accepted.principal.credentialId ||
        !Array.isArray(consent.scopes)
      )
        throw new HttpError(401, "Authorization is no longer available");
      scopes = consent.scopes;
    } else {
      const key = await context.adapter.findOne<{
        referenceId: string;
        enabled: boolean;
        expiresAt: Date | null;
        permissions: string | Record<string, string[]> | null;
      }>({
        model: "apikey",
        where: [{ field: "id", value: accepted.principal.credentialId }],
      });
      if (
        !key?.enabled ||
        key.referenceId !== accepted.principal.userId ||
        (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now())
      )
        throw new HttpError(401, "Authorization is no longer available");
      const permissions =
        typeof key.permissions === "string"
          ? JSON.parse(key.permissions)
          : key.permissions;
      scopes = ["documents", "search"].flatMap((resource) =>
        ["read", "write"]
          .filter((operation) => permissions?.[resource]?.includes(operation))
          .map((operation) => `${resource}:${operation}`),
      );
    }
    const user = await context.internalAdapter.findUserById(
      accepted.principal.userId,
    );
    if (!user?.emailVerified)
      throw new HttpError(401, "Verified account required");
    return {
      ...accepted.principal,
      scopes: scopes.filter((scope) =>
        accepted.principal.scopes.includes(scope),
      ),
    };
  }
  async function delegatedActor(value: string, orgId: string) {
    const principal = await delegatedPrincipal(value);
    requireScope(principal, "search:read");
    requireScope(principal, "documents:read");
    return actor(principal, orgId);
  }
  async function limitSearch(principal: Principal, orgId: string) {
    if (!rateLimits) return;
    for (const [key, max] of [
      [`search:key:${principal.credentialId}`, 20],
      [`search:org:${orgId}`, 100],
    ] as const) {
      if ((await searchLimits.increment(key)).totalHits > max)
        throw new HttpError(
          429,
          "Search limit reached. Try again in a minute.",
        );
    }
  }
  async function audit(
    principal: Principal,
    orgId: string,
    action: string,
    resourceId: string | null = null,
  ) {
    await store.db.query(
      "INSERT INTO audit(org_id,user_id,action,resource_id,created) VALUES($1,$2,$3,$4,$5)",
      [orgId, principal.userId, action, resourceId, new Date().toISOString()],
    );
  }
  async function organizations(principal: Principal) {
    const rows = await store.all<{ id: string; name: string }>(
      "SELECT o.id,o.name FROM orgs o JOIN members m ON m.org_id=o.id WHERE m.user_id=? ORDER BY o.name",
      principal.userId,
    );
    const result = [];
    for (const row of rows) {
      try {
        await actor(principal, row.id);
        result.push(row);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404) throw error;
      }
    }
    return { organizations: result };
  }
  async function upload(
    principal: Principal,
    body: unknown,
    revalidate: () => Promise<Principal>,
    signal?: AbortSignal,
  ) {
    requireScope(principal, "documents:write");
    const input = uploadInput.parse(body);
    const a = await actor(principal, input.organizationId);
    await uploads.checkParent(a, input.parentId ?? null);
    await uploads.admit(a);
    const result = await uploads.save(
      a,
      input.filename,
      decodeUpload(input.contentBase64),
      input.parentId ?? null,
      async () => {
        const current = await revalidate();
        requireScope(current, "documents:write");
        return actor(current, a.orgId);
      },
      signal,
    );
    return { ...result, url: `${origin}${documentPath(result.id)}` };
  }
  async function search(
    principal: Principal,
    body: unknown,
    revalidate: () => Promise<Principal>,
    signal?: AbortSignal,
    admitted = false,
  ) {
    requireScope(principal, "search:read");
    const input = searchInput.parse(body);
    const a = await actor(principal, input.organizationId);
    if (!admitted) await limitSearch(principal, a.orgId);
    let documentIds = input.documentIds;
    for (const id of documentIds) {
      if ((await requireResource(store, a, id)).kind !== "document")
        throw new HttpError(404, "Document not found");
    }
    if (input.folderId) {
      if ((await requireResource(store, a, input.folderId)).kind !== "folder")
        throw new HttpError(404, "Folder not found");
      const resources = await visibleResources(store, a);
      const descendants = new Set([input.folderId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of resources)
          if (
            r.parent_id &&
            descendants.has(r.parent_id) &&
            !descendants.has(r.id)
          ) {
            descendants.add(r.id);
            changed = true;
          }
      }
      documentIds = resources
        .filter(
          (r) =>
            r.kind === "document" &&
            descendants.has(r.id) &&
            (!input.documentIds.length || input.documentIds.includes(r.id)),
        )
        .map((r) => r.id);
    }
    const retrieved =
      input.folderId && !documentIds.length
        ? { results: [] }
        : await providers.retrieve(a, input.query, documentIds, signal);
    await audit(principal, a.orgId, "api.search");
    const current = await revalidate();
    requireScope(current, "search:read");
    await actor(current, a.orgId);
    const results = [];
    for (const source of retrieved.results.slice(0, input.limit)) {
      if (await resourceAccess(store, a, source.documentId))
        results.push({
          ...source,
          id: `${source.documentId}:${source.passageId}`,
          title: `${source.name} · ${source.title}`,
          url: `${origin}${documentPath(source.documentId, source.nodeId)}`,
        });
    }
    await actor(await revalidate(), a.orgId);
    return { results };
  }
  async function read(
    principal: Principal,
    body: unknown,
    revalidate: () => Promise<Principal>,
  ) {
    requireScope(principal, "documents:read");
    const input = fetchInput.parse(body);
    const [documentId, passageId, ...extra] = input.id.split(":");
    if (extra.length) throw new HttpError(400, "Invalid document reference");
    z.string().uuid().parse(documentId);
    const a = await actor(principal, input.organizationId);
    const doc = await requireResource(store, a, documentId);
    if (doc.kind !== "document") throw new HttpError(404, "Document not found");
    if (doc.status !== "ready" || !doc.parsed)
      throw new HttpError(409, "Document is not indexed yet");
    const parsed: ParsedDocument = withLayoutSections(JSON.parse(doc.parsed));
    const nodes = flatten(parsed.nodes);
    const node = input.nodeId
      ? nodes.find((n) => n.id === input.nodeId)
      : passageId
        ? nodes.find((n) => n.passages?.some((p) => p.id === passageId))
        : undefined;
    if ((input.nodeId || passageId) && !node)
      throw new HttpError(404, "Section not found");
    const passage = passageId
      ? node?.passages?.find((p) => p.id === passageId)
      : undefined;
    if (passageId && !passage) throw new HttpError(404, "Passage not found");
    const content = passage?.content ?? node?.content ?? parsed.markdown;
    await audit(principal, a.orgId, "api.document.read", documentId);
    const current = await revalidate();
    requireScope(current, "documents:read");
    await actor(current, a.orgId);
    await requireResource(store, a, documentId);
    const nextOffset =
      input.offset + input.limit < content.length
        ? input.offset + input.limit
        : null;
    return {
      id: input.id,
      documentId,
      title: node ? `${doc.name} · ${node.title}` : doc.name,
      url: `${origin}${documentPath(doc.id, node?.id)}`,
      text: content.slice(input.offset, input.offset + input.limit),
      page: passage?.page ?? node?.page ?? 1,
      endPage: passage?.endPage ?? node?.endPage ?? parsed.pages,
      blockIds: passage?.blockIds ?? node?.blocks.map((b) => b.id) ?? [],
      nextOffset,
      tree: parsed.nodes.map(outline),
    };
  }
  function outline(node: ParsedDocument["nodes"][number]): unknown {
    return {
      id: node.id,
      title: node.title,
      page: node.page,
      endPage: node.endPage,
      children: node.children.map(outline),
    };
  }
  function status(error: unknown) {
    return error instanceof HttpError
      ? error.status
      : isAPIError(error)
        ? error.statusCode
        : 500;
  }
  function challenge(req: Request, error: unknown) {
    const resource =
      req.originalUrl.split("?")[0].replace(/\/$/, "") === "/mcp"
        ? "mcp"
        : "api/v1";
    const nativeError =
      error instanceof HttpError
        ? new APIError("UNAUTHORIZED", { message: error.message })
        : error;
    return new Headers(
      createResourceServerChallenge(nativeError, `${origin}/${resource}`, {
        challengeScopes: apiScopes,
        dpopSigningAlgorithms: DPOP_SIGNING_ALGORITHMS,
      })?.headers,
    ).get("WWW-Authenticate");
  }
  const router = Router();
  router.use(async (req, res, next) => {
    try {
      await authenticate(req, "/api/v1");
      next();
    } catch (error) {
      if (status(error) === 401) {
        const header = challenge(req, error);
        if (header) res.set("WWW-Authenticate", header);
      }
      next(error);
    }
  });
  router.get("/organizations", async (req, res) =>
    res.json(await organizations(await authenticate(req, "/api/v1"))),
  );
  router.post("/search", async (req, res) => {
    const controller = new AbortController();
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", cancel);
    try {
      res.json(
        await search(
          await authenticate(req, "/api/v1"),
          req.body,
          () => authenticate(req, "/api/v1"),
          controller.signal,
        ),
      );
    } finally {
      res.off("close", cancel);
    }
  });
  async function uploadActor(req: Request) {
    const principal = await authenticate(req, "/api/v1");
    requireScope(principal, "documents:write");
    const orgId = organizationId.parse(req.query.organizationId);
    const parentId = z.string().uuid().optional().parse(req.query.parentId);
    const a = await actor(principal, orgId);
    await uploads.checkParent(a, parentId ?? null);
    return a;
  }
  router.post(
    "/documents",
    uploads.multipart(uploadActor),
    async (req, res) => {
      try {
        if (!req.file) throw new HttpError(400, "Choose a document");
        const result = await uploads.save(
          await uploadActor(req),
          req.file.originalname,
          req.file.buffer,
          z.string().uuid().optional().parse(req.query.parentId) ?? null,
          () => uploadActor(req),
          uploads.lease(req)?.signal,
        );
        res
          .status(201)
          .json({ ...result, url: `${origin}${documentPath(result.id)}` });
      } finally {
        uploads.lease(req)?.release();
      }
    },
  );
  router.get("/documents/:id", async (req, res) =>
    res.json(
      await read(
        await authenticate(req, "/api/v1"),
        {
          organizationId: req.query.organizationId,
          id: req.params.id,
          ...(req.query.nodeId ? { nodeId: req.query.nodeId } : {}),
          ...(req.query.offset !== undefined
            ? { offset: Number(req.query.offset) }
            : {}),
          ...(req.query.limit !== undefined
            ? { limit: Number(req.query.limit) }
            : {}),
        },
        () => authenticate(req, "/api/v1"),
      ),
    ),
  );
  router.use((_req, res) => res.status(404).json({ error: "Not found" }));
  router.use(
    (
      error: unknown,
      req: Request,
      res: import("express").Response,
      next: import("express").NextFunction,
    ) => {
      if ([401, 403].includes(status(error))) {
        const header = challenge(req, error);
        if (header) res.set("WWW-Authenticate", header);
      }
      if (error instanceof HttpError && error.status === 429)
        res.set("Retry-After", "60");
      next(error);
    },
  );
  return {
    keys,
    authenticate,
    actor,
    requireScope,
    limitSearch,
    delegate,
    delegatedPrincipal,
    delegatedActor,
    organizations,
    search,
    read,
    upload,
    router,
    challenge,
    status,
  };
}
