import { createFileDownloads, downloadResourceColumns } from "./file-downloads";
import { createHash } from "node:crypto";
import { Router } from "express";
import {
  HttpError,
  type Resource,
  type Store,
  type PermissionCache,
} from "./db";
import { describeThumbnail } from "./thumbnails";

export function createLinkSharingRouter(
  store: Store,
  downloads = createFileDownloads(store),
) {
  const router = Router();
  const missing = () =>
    new HttpError(404, "This link is unavailable or access has been removed.");

  async function resolve(
    token: string,
    resourceId?: string,
    cache: PermissionCache = { values: new Map() },
    metadataOnly = false,
  ) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw missing();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const link = await store.one<{ resource_id: string; org_id: string }>(
      "SELECT l.resource_id,l.org_id FROM share_links l JOIN resources r ON r.id=l.resource_id WHERE l.token_hash=? AND r.access='link'",
      tokenHash,
    );
    if (!link) throw missing();
    const actor = {
      orgId: link.org_id,
      userId: tokenHash,
      role: "viewer",
      token: "",
    };
    const allowed = (ids: string[]) =>
      store.permissions(actor, "resource", ids, "link_read", "link", cache);
    const resource = await store.one<Resource>(
      `SELECT ${metadataOnly ? downloadResourceColumns : "*"} FROM resources WHERE id=? AND org_id=?`,
      resourceId ?? link.resource_id,
      link.org_id,
    );
    if (
      !resource ||
      (await allowed([...new Set([link.resource_id, resource.id])])).some(
        (value) => !value,
      )
    )
      throw missing();
    return { resource, rootId: link.resource_id, allowed };
  }

  function describe(
    resource: Resource,
    rootId: string,
    includeParsed = false,
    token?: string,
  ) {
    const parsed = resource.parsed ? JSON.parse(resource.parsed) : null;
    return {
      id: resource.id,
      name: resource.name,
      description: resource.description,
      kind: resource.kind,
      pinned: resource.pinned,
      mime: resource.mime,
      size: resource.size,
      created: resource.created,
      status: resource.status,
      parent_id: resource.id === rootId ? null : resource.parent_id,
      access: "link",
      canWrite: false,
      canShare: false,
      pages: parsed?.pages ?? 0,
      thumbnail: token
        ? describeThumbnail(
            resource,
            `/api/shared/${token}/resources/${resource.id}`,
          )
        : null,
      ...(includeParsed ? { parsed } : {}),
    };
  }

  router.get(["/:token", "/:token/resources/:resourceId"], async (req, res) => {
    const token = String(req.params.token);
    const resourceId = req.params.resourceId
      ? String(req.params.resourceId)
      : undefined;
    const permissionCache: PermissionCache = { values: new Map() };
    const { resource, rootId, allowed } = await resolve(
      token,
      resourceId,
      permissionCache,
    );
    const children = [];
    if (resource.kind === "folder") {
      const rows = await store.all<Resource>(
        "SELECT * FROM resources WHERE parent_id=? AND org_id=? ORDER BY kind,name",
        resource.id,
        resource.org_id,
      );
      const access = await allowed(rows.map((child) => child.id));
      children.push(
        ...rows
          .filter((_child, index) => access[index])
          .map((child) => describe(child, rootId, false, token)),
      );
    }
    await resolve(token, resourceId, permissionCache);
    res.json({ ...describe(resource, rootId, true, token), rootId, children });
  });

  router.get("/:token/resources/:resourceId/thumbnail", async (req, res) => {
    const token = String(req.params.token),
      resourceId = String(req.params.resourceId);
    const permissionCache: PermissionCache = { values: new Map() };
    const { resource } = await resolve(token, resourceId, permissionCache);
    if (resource.kind !== "document") throw missing();
    const thumbnail = await store.files.read("thumbnail", resource.id);
    await resolve(token, resourceId, permissionCache);
    if (!thumbnail || resource.thumbnail_status !== "ready")
      return res.status(204).end();
    res.set({
      "Content-Type": thumbnail.mime,
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

  router.get("/:token/resources/:resourceId/content", async (req, res) => {
    const token = String(req.params.token),
      resourceId = String(req.params.resourceId);
    const permissionCache: PermissionCache = { values: new Map() };
    const { resource } = await resolve(
      token,
      resourceId,
      permissionCache,
      true,
    );
    if (resource.kind !== "document") throw missing();
    await downloads.send(req, res, resource, () =>
      resolve(token, resourceId, permissionCache, true),
    );
  });
  return router;
}
