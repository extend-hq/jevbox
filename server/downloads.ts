import { Router, type Request } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Zip, ZipPassThrough } from "fflate";
import { z } from "zod";
import { createLimiter } from "./async";
import {
  HttpError,
  requireResource,
  resourceAccess,
  type Actor,
  type Resource,
  type Store,
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
) {
  const router = Router();
  router.post("/download", async (req, res) => {
    const a = actor(req);
    const { ids } = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(1000) })
      .strict()
      .parse(req.body);
    const selected = await Promise.all(
      [...new Set(ids)].map((id) => requireResource(store, a, id)),
    );
    const rows = await store.all<Resource>(
      "SELECT * FROM resources WHERE org_id=? ORDER BY name,id",
      a.orgId,
    );
    const candidates = archiveEntries(
      rows,
      selected.map((resource) => resource.id),
    );
    const limited = createLimiter(8);
    const readable = await Promise.all(
      candidates.map(({ resource }) =>
        limited(async () =>
          (await resourceAccess(store, a, resource.id)) ? resource : null,
        ),
      ),
    );
    const entries = archiveEntries(
      readable.flatMap((resource) => (resource ? [resource] : [])),
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
    async function* archive() {
      const chunks: Uint8Array[] = [];
      const zip = new Zip((error, data) => {
        if (error) throw error;
        chunks.push(data);
      });
      try {
        for (const { resource, path } of entries) {
          await requireResource(store, a, resource.id);
          const file = new ZipPassThrough(path);
          zip.add(file);
          if (resource.kind === "folder") file.push(new Uint8Array(), true);
          else {
            const blob = await store.files.read("document", resource.id);
            if (!blob)
              throw new HttpError(404, "An original file is unavailable.");
            await requireResource(store, a, resource.id);
            for (let offset = 0; offset < blob.body.length; offset += 65536) {
              file.push(blob.body.subarray(offset, offset + 65536));
              while (chunks.length) yield chunks.shift()!;
            }
            file.push(new Uint8Array(), true);
          }
          while (chunks.length) yield chunks.shift()!;
        }
        zip.end();
        while (chunks.length) yield chunks.shift()!;
      } finally {
        zip.terminate();
      }
    }
    await pipeline(Readable.from(archive()), res);
  });
  return router;
}
