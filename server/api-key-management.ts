import { Router, type Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { z } from "zod";
import { apiScopes } from "../shared/api-access";
import type { createAuthentication } from "./auth";
import type { createExternalAccess } from "./external-access";
import { HttpError, type Actor, type Store } from "./db";

export function createKeyManagement(
  store: Store,
  authentication: ReturnType<typeof createAuthentication>,
  access: ReturnType<typeof createExternalAccess>,
  authenticate: (req: Request) => Promise<Actor>,
  audit: (actor: Actor, action: string) => Promise<unknown>,
) {
  const router = Router();
  router.get("/api-keys", async (req, res) =>
    res.json(await access.keys.list((await authenticate(req)).userId)),
  );
  router.post("/api-keys", async (req, res) => {
    const a = await authenticate(req);
    const limit = await authentication.consume(`api-key:create:${a.userId}`, {
      window: 3600,
      max: 20,
    });
    if (!limit.allowed)
      throw new HttpError(429, "Too many keys created. Try again later.");
    const created = await access.keys.create(a.userId, req.body);
    await audit(a, "api-key.create");
    res.status(201).json(created);
  });
  router.delete("/api-keys/:id", async (req, res) => {
    const a = await authenticate(req);
    await access.keys.revoke(a.userId, String(req.params.id));
    await audit(a, "api-key.revoke");
    res.json({ ok: true });
  });
  router.get("/connected-apps", async (req, res) => {
    const rows = await store.all<{
      id: string;
      name: string;
      scopes: string;
      createdAt: Date;
    }>(
      'SELECT c.id,COALESCE(a.name,\'Connected application\') AS name,c.scopes,c."createdAt" FROM "oauthConsent" c JOIN "oauthClient" a ON a."clientId"=c."clientId" WHERE c."userId"=? ORDER BY c."createdAt" DESC',
      (await authenticate(req)).userId,
    );
    res.json(
      rows.map((row) => ({
        ...row,
        scopes: JSON.parse(row.scopes),
        createdAt: row.createdAt.toISOString(),
      })),
    );
  });
  router.delete("/connected-apps/:id", async (req, res) => {
    const a = await authenticate(req);
    await store.transaction(async () => {
      const consent = await store.one<{ clientId: string }>(
        'SELECT "clientId" FROM "oauthConsent" WHERE id=? AND "userId"=?',
        String(req.params.id),
        a.userId,
      );
      if (!consent) throw new HttpError(404, "Connected application not found");
      await store.run(
        "INSERT INTO oauth_revocations VALUES(?,?,?) ON CONFLICT(user_id,client_id) DO UPDATE SET revoked_at=EXCLUDED.revoked_at",
        a.userId,
        consent.clientId,
        Date.now(),
      );
      await store.run(
        'DELETE FROM "oauthAccessToken" WHERE "userId"=? AND "clientId"=?',
        a.userId,
        consent.clientId,
      );
      await store.run(
        'DELETE FROM "oauthRefreshToken" WHERE "userId"=? AND "clientId"=?',
        a.userId,
        consent.clientId,
      );
      await store.run(
        'DELETE FROM "oauthConsent" WHERE id=?',
        String(req.params.id),
      );
      await audit(a, "oauth.disconnect");
    });
    res.json({ ok: true });
  });
  router.post("/oauth/consent-request", async (req, res) => {
    const query = z.string().max(16000).parse(req.body.oauthQuery);
    const params = new URLSearchParams(query);
    const clientId = z.string().min(1).parse(params.get("client_id"));
    const client = await authentication.auth.api
      .getOAuthClientPublicPrelogin({
        headers: fromNodeHeaders(req.headers),
        body: { client_id: clientId, oauth_query: query },
      })
      .catch(() => {
        throw new HttpError(400, "Authorization request is invalid or expired");
      });
    const scopes = (params.get("scope") ?? "").split(" ").filter(Boolean);
    if (
      !scopes.length ||
      !scopes.every((scope) =>
        [...apiScopes, "offline_access"].includes(
          scope as (typeof apiScopes)[number],
        ),
      )
    )
      throw new HttpError(400, "Invalid authorization scopes");
    res.json({ name: client.client_name ?? "Connected application", scopes });
  });
  return router;
}
