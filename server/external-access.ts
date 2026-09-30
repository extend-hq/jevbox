import { Router, type Request } from "express";
import { createLocalJWKSet, jwtVerify, type JWTPayload } from "jose";
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
import { flatten, type ParsedDocument } from "./indexing";
import type { createProviders } from "./providers";

type Auth = ReturnType<typeof createAuthentication>["auth"];
export type Principal = {
  userId: string;
  scopes: readonly string[];
  credentialId: string;
};
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
  consume: ReturnType<typeof createAuthentication>["consume"],
  rateLimits = true,
) {
  const keys = createApiKeys(store, auth);
  async function authenticate(
    req: Request,
    audience: "/mcp" | "/api/v1",
  ): Promise<Principal> {
    const match = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match || match[1].length > 16000)
      throw new HttpError(401, "Bearer credential required");
    const token = match[1];
    if (token.startsWith("jev_key_")) return keys.authenticate(token);
    let payload;
    try {
      const verified = await jwtVerify(
        token,
        createLocalJWKSet(await auth.api.getJwks()),
        {
          issuer: `${origin}/api/auth`,
          audience: `${origin}${audience}`,
          typ: "at+jwt",
        },
      );
      payload = verified.payload;
    } catch {
      throw new HttpError(401, "Invalid or expired access token");
    }
    if (payload.cnf)
      throw new HttpError(
        401,
        "Sender-constrained token requires MCP authentication",
      );
    return principalFromClaims(payload, audience);
  }
  async function principalFromClaims(
    payload: JWTPayload,
    audience: "/mcp" | "/api/v1",
  ): Promise<Principal> {
    if (
      typeof payload.exp !== "number" ||
      payload.exp <= Date.now() / 1000 ||
      typeof payload.sub !== "string" ||
      typeof payload.azp !== "string" ||
      typeof payload.scope !== "string" ||
      typeof payload.jevbox_issued_at !== "number"
    )
      throw new HttpError(401, "Invalid access token");
    const user = await store.one(
      "SELECT id FROM users WHERE id=? AND email_verified=true",
      payload.sub,
    );
    const consent = await store.one<{ scopes: string; resources: string }>(
      'SELECT c.scopes,c.resources FROM "oauthConsent" c JOIN "oauthClient" a ON a."clientId"=c."clientId" WHERE c."userId"=? AND c."clientId"=? AND COALESCE(a.disabled,false)=false',
      payload.sub,
      payload.azp,
    );
    const revocation = await store.one<{ revoked_at: string }>(
      "SELECT revoked_at FROM oauth_revocations WHERE user_id=? AND client_id=?",
      payload.sub,
      payload.azp,
    );
    const scopes = payload.scope.split(" ").filter(Boolean);
    if (
      !user ||
      !consent ||
      (revocation &&
        Number(revocation.revoked_at) >= payload.jevbox_issued_at) ||
      !scopes.every((scope) => JSON.parse(consent.scopes).includes(scope)) ||
      !JSON.parse(consent.resources || "[]").includes(`${origin}${audience}`)
    )
      throw new HttpError(401, "Authorization was revoked");
    if (
      typeof payload.sid === "string" &&
      !(await store.one(
        "SELECT id FROM auth_sessions WHERE id=? AND user_id=? AND expires_at>now()",
        payload.sid,
        payload.sub,
      ))
    )
      throw new HttpError(401, "Authorization session expired");
    return {
      userId: payload.sub,
      scopes,
      credentialId: `oauth:${payload.azp}:${payload.sub}`,
    };
  }
  function requireScope(principal: Principal, scope: ApiScope) {
    if (!principal.scopes.includes(scope))
      throw new HttpError(403, `Required scope: ${scope}`);
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
  async function limitSearch(principal: Principal, orgId: string) {
    if (!rateLimits) return;
    for (const [key, max] of [
      [`search:key:${principal.credentialId}`, 20],
      [`search:org:${orgId}`, 100],
    ] as const) {
      if (!(await consume(key, { window: 60, max })).allowed)
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
  async function search(
    principal: Principal,
    body: unknown,
    revalidate: () => Promise<Principal>,
    signal?: AbortSignal,
  ) {
    requireScope(principal, "search:read");
    const input = searchInput.parse(body);
    const a = await actor(principal, input.organizationId);
    await limitSearch(principal, a.orgId);
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
    const parsed: ParsedDocument = JSON.parse(doc.parsed);
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
  function challenge(req: Request, error: HttpError) {
    const resource =
      req.originalUrl.split("?")[0].replace(/\/$/, "") === "/mcp"
        ? "mcp"
        : "api/v1";
    const scope =
      error.status === 403 ? `, scope="${apiScopes.join(" ")}"` : "";
    return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/${resource}", error="${error.status === 403 ? "insufficient_scope" : "invalid_token"}"${scope}`;
  }
  const router = Router();
  router.use(async (req, res, next) => {
    try {
      await authenticate(req, "/api/v1");
      next();
    } catch (error) {
      if (error instanceof HttpError && error.status === 401)
        res.set("WWW-Authenticate", challenge(req, error));
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
      if (error instanceof HttpError && [401, 403].includes(error.status))
        res.set("WWW-Authenticate", challenge(req, error));
      if (error instanceof HttpError && error.status === 429)
        res.set("Retry-After", "60");
      next(error);
    },
  );
  return {
    keys,
    authenticate,
    principalFromClaims,
    organizations,
    search,
    read,
    router,
    challenge,
  };
}
