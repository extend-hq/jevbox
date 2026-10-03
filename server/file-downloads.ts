import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import {
  HttpError,
  resourceAccessBatch,
  type Actor,
  type PermissionCache,
  type Resource,
  type Store,
} from "./db";

export const downloadResourceColumns =
  "id,org_id,owner_id,parent_id,kind,name,description,mime,size,status,access,created,thumbnail_status,thumbnail_key";

export async function requireDownloadResource(
  store: Store,
  actor: Actor,
  id: string,
  cache?: PermissionCache,
) {
  if (!(await resourceAccessBatch(store, actor, [id], "read", cache)).has(id))
    throw new HttpError(404, "Resource not found");
  const resource = await store.one<Resource>(
    `SELECT ${downloadResourceColumns} FROM resources WHERE id=? AND org_id=?`,
    id,
    actor.orgId,
  );
  if (!resource) throw new HttpError(404, "Resource not found");
  return resource;
}

export const downloadLimits = {
  active: 8,
  activePerUser: 4,
  tempBytes: 512 * 1024 * 1024,
  timeoutMs: 120_000,
};

export function createFileDownloads(store: Store, limits = downloadLimits) {
  const {
    active: maximum,
    activePerUser: perUser,
    tempBytes: diskBudget,
    timeoutMs: timeout,
  } = limits;
  const active = new Map<string, number>();
  let count = 0;
  let bytes = 0;
  function acquire(subject: string) {
    if (count >= maximum || (active.get(subject) ?? 0) >= perUser)
      throw new HttpError(
        429,
        "Too many active downloads. Try again shortly.",
        5,
      );
    count++;
    active.set(subject, (active.get(subject) ?? 0) + 1);
    return () => {
      count--;
      const remaining = active.get(subject)! - 1;
      if (remaining) active.set(subject, remaining);
      else active.delete(subject);
    };
  }
  async function stage(resourceId: string, signal: AbortSignal) {
    const source = await store.files.download(resourceId);
    if (source.size > diskBudget - bytes)
      throw new HttpError(
        429,
        "Download capacity is busy. Try again shortly.",
        5,
      );
    bytes += source.size;
    let directory: string | undefined;
    const dispose = async () => {
      try {
        if (directory) await rm(directory, { recursive: true, force: true });
      } finally {
        bytes -= source.size;
      }
    };
    try {
      signal.throwIfAborted();
      directory = await mkdtemp(join(tmpdir(), "jevbox-download-"));
      const path = join(directory, "content");
      const digest = createHash("sha256");
      let received = 0;
      async function* checked() {
        for await (const chunk of source.chunks(signal)) {
          received += chunk.byteLength;
          if (received > source.size)
            throw new HttpError(503, "Stored file integrity check failed");
          digest.update(chunk);
          yield chunk;
        }
        if (
          received !== source.size ||
          (source.sha256 && digest.digest("hex") !== source.sha256)
        )
          throw new HttpError(503, "Stored file integrity check failed");
      }
      await pipeline(
        checked(),
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
        { signal },
      );
      return { path, size: source.size, dispose };
    } catch (error) {
      await dispose();
      throw error;
    }
  }
  async function run<T>(
    req: Request,
    res: Response,
    subject: string,
    task: (signal: AbortSignal) => Promise<T>,
  ) {
    const release = acquire(subject);
    const controller = new AbortController();
    const close = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once("close", close);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(timeout),
    ]);
    try {
      return await task(signal);
    } finally {
      res.off("close", close);
      release();
    }
  }
  return {
    run,
    stage,
    async send(
      req: Request,
      res: Response,
      resource: Resource,
      check: () => Promise<unknown>,
      userId?: string,
    ) {
      const subject = userId
        ? `user:${userId}`
        : `ip:${ipKeyGenerator(req.ip ?? "127.0.0.1")}`;
      await run(req, res, subject, async (signal) => {
        const source = await store.files.download(resource.id);
        const headers = {
          "Content-Type": resource.mime,
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Content-Disposition": `${["text/html", "text/xml", "image/svg+xml", "application/octet-stream"].includes(resource.mime) ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(resource.name)}`,
          "Accept-Ranges": "bytes",
        };
        const range = req.range(source.size);
        if (
          range === -1 ||
          (Array.isArray(range) && range.type === "bytes" && range.length !== 1)
        ) {
          res
            .set(headers)
            .status(416)
            .set("Content-Range", `bytes */${source.size}`)
            .end();
          return;
        }
        const selected =
          Array.isArray(range) && range.type === "bytes" ? range[0] : undefined;
        if (req.method === "HEAD") {
          await check();
          res.set(headers).set("Content-Length", String(source.size)).end();
          return;
        }
        const staged = await stage(resource.id, signal);
        try {
          await check();
          signal.throwIfAborted();
          res.set(headers);
          if (selected)
            res
              .status(206)
              .set(
                "Content-Range",
                `bytes ${selected.start}-${selected.end}/${staged.size}`,
              );
          res.set(
            "Content-Length",
            String(selected ? selected.end - selected.start + 1 : staged.size),
          );
          await pipeline(createReadStream(staged.path, selected), res, {
            signal,
          });
        } finally {
          await staged.dispose();
        }
      });
    },
  };
}
