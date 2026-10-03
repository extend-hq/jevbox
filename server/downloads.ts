import { createReadStream } from "node:fs";
import {
  createFileDownloads,
  requireDownloadResource,
  downloadResourceColumns,
} from "./file-downloads";
import { Router, type Request } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Zip, ZipPassThrough } from "fflate";
import { z } from "zod";
import {
  HttpError,
  resourceAccessBatch,
  type Actor,
  type Resource,
  type Store,
  type PermissionCache,
} from "./db";

export function archiveEntries(resources: Resource[], selectedIds: string[]) {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const selected = new Set(selectedIds);
  const usedPaths = new Set<string>();
  const visited = new Set<string>();
  const entries: { resource: Resource; path: string }[] = [];
  function walk(resource: Resource, parentPath: string) {
    if (visited.has(resource.id)) return;
    visited.add(resource.id);
    const baseName =
      resource.name
        .replace(/[\x00-\x1f/\\]/g, "_")
        .replace(/^\.{1,2}$/, "untitled") || "untitled";
    let name = baseName;
    let suffix = 1;
    while (usedPaths.has(`${parentPath}${name}`)) {
      const dot = resource.kind === "document" ? baseName.lastIndexOf(".") : -1;
      name =
        dot > 0
          ? `${baseName.slice(0, dot)} (${++suffix})${baseName.slice(dot)}`
          : `${baseName} (${++suffix})`;
    }
    usedPaths.add(`${parentPath}${name}`);
    const path = `${parentPath}${name}${resource.kind === "folder" ? "/" : ""}`;
    entries.push({ resource, path });
    if (resource.kind === "folder")
      for (const child of resources.filter(
        (item) => item.parent_id === resource.id,
      ))
        walk(child, path);
  }
  for (const id of selectedIds) {
    const resource = byId.get(id);
    if (!resource) continue;
    let parent = resource.parent_id;
    const ancestors = new Set<string>();
    while (parent && !selected.has(parent) && !ancestors.has(parent)) {
      ancestors.add(parent);
      parent = byId.get(parent)?.parent_id ?? null;
    }
    if (!parent || !selected.has(parent)) walk(resource, "");
  }
  return entries;
}

export function createDownloadRouter(
  store: Store,
  actor: (req: Request) => Actor,
  downloads = createFileDownloads(store),
) {
  const router = Router();
  router.post("/download", async (req, res) => {
    const a = actor(req);
    const { ids } = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(1000) })
      .strict()
      .parse(req.body);
    const permissionCache: PermissionCache = { values: new Map() };
    const uniqueIds = [...new Set(ids)];
    if (
      (await resourceAccessBatch(store, a, uniqueIds, "read", permissionCache))
        .size !== uniqueIds.length
    )
      throw new HttpError(404, "Resource not found");
    const rows = await store.all<Resource>(
      `SELECT ${downloadResourceColumns} FROM resources WHERE org_id=? ORDER BY name,id`,
      a.orgId,
    );
    const byId = new Map(rows.map((resource) => [resource.id, resource]));
    const selected = uniqueIds.map((id) => {
      const resource = byId.get(id);
      if (!resource) throw new HttpError(404, "Resource not found");
      return resource;
    });
    const candidates = archiveEntries(
      rows,
      selected.map((resource) => resource.id),
    );
    const allowed = await resourceAccessBatch(
      store,
      a,
      candidates.map(({ resource }) => resource.id),
      "read",
      permissionCache,
    );
    const entries = archiveEntries(
      candidates.flatMap(({ resource }) =>
        allowed.has(resource.id) ? [resource] : [],
      ),
      selected.map((resource) => resource.id),
    );
    const documents = entries.filter(
      ({ resource }) => resource.kind === "document",
    );
    const blobs = documents.length
      ? await store.all<{ resource_id: string }>(
          "SELECT resource_id FROM blobs WHERE resource_id=ANY(?::text[])",
          documents.map(({ resource }) => resource.id),
        )
      : [];
    if (blobs.length !== documents.length)
      throw new HttpError(404, "An original file is unavailable.");
    const filename =
      selected.length === 1
        ? `${selected[0].name.replace(/[\x00-\x1f/\\]/g, "_")}.zip`
        : "Library.zip";
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    });
    await downloads.run(req, res, `user:${a.userId}`, async (signal) => {
      async function* archive() {
        const chunks: Uint8Array[] = [];
        const zip = new Zip((error, data) => {
          if (error) throw error;
          chunks.push(data);
        });
        try {
          for (const { resource, path } of entries) {
            await requireDownloadResource(
              store,
              a,
              resource.id,
              permissionCache,
            );
            const file = new ZipPassThrough(path);
            zip.add(file);
            if (resource.kind === "folder") file.push(new Uint8Array(), true);
            else {
              const staged = await downloads.stage(resource.id, signal);
              try {
                await requireDownloadResource(
                  store,
                  a,
                  resource.id,
                  permissionCache,
                );
                for await (const chunk of createReadStream(staged.path, {
                  signal,
                })) {
                  file.push(chunk);
                  while (chunks.length) yield chunks.shift()!;
                }
                file.push(new Uint8Array(), true);
              } finally {
                await staged.dispose();
              }
            }
            while (chunks.length) yield chunks.shift()!;
          }
          zip.end();
          while (chunks.length) yield chunks.shift()!;
        } finally {
          zip.terminate();
        }
      }
      await pipeline(Readable.from(archive()), res, { signal });
    });
  });
  return router;
}
