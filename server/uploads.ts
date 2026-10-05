import { randomUUID } from "node:crypto";
import type { Request, Response, RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { fileMime } from "../shared/file-types";
import { uploadLimits } from "../shared/uploads";
import { HttpError, requireResource, type Actor, type Store } from "./db";
import { enqueueIndex } from "./indexing-jobs";
import { enqueueThumbnail } from "./thumbnails";
import { hasPinnedFolders } from "./folder-pinning";
import { checkStoredDocumentQuota, uploadScopes } from "./upload-quotas";
import { createLimiter } from "./async";
import {
  uploadAdmissionLimits,
  type UploadAdmissionLimits,
} from "./upload-limits";

const uploadName = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) => !/[\x00-\x1f\x7f/\\:]/.test(value) && !value.startsWith("."),
    "Use a filename without paths, control characters, or a leading dot",
  );
export const uploadInput = z
  .object({
    organizationId: z.string().uuid(),
    filename: uploadName,
    contentBase64: z.string().max(4 * Math.ceil(uploadLimits.fileBytes / 3)),
    parentId: z.string().uuid().optional(),
  })
  .strict();
export async function validateUpload(
  filename: string,
  body: Buffer,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  uploadName.parse(filename);
  if (body.length > uploadLimits.fileBytes)
    throw new HttpError(413, "Files must be at most 250 MB");
  return fileMime(filename);
}

export function decodeUpload(content: string) {
  if (content.length > 4 * Math.ceil(uploadLimits.fileBytes / 3))
    throw new HttpError(413, "Files must be at most 250 MB");
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content))
    throw new HttpError(
      400,
      "Provide standard padded base64 without a data URL prefix",
    );
  const body = Buffer.from(content, "base64");
  if (body.length > uploadLimits.fileBytes)
    throw new HttpError(413, "Files must be at most 250 MB");
  if (body.toString("base64") !== content)
    throw new HttpError(400, "Invalid base64");
  return body;
}

export function createUploads(
  store: Store,
  {
    rateLimits = true,
    limits = uploadAdmissionLimits(),
  }: {
    rateLimits?: boolean;
    limits?: UploadAdmissionLimits;
  } = {},
) {
  const active = new Map<string, number>();
  let activeRequests = 0;
  let activeBytes = 0;
  const waiting = new Set<() => boolean>();
  const drain = () => {
    for (const start of waiting) if (start()) waiting.delete(start);
  };
  const validate = createLimiter(limits.validation);
  const leases = new WeakMap<
    Request,
    {
      ready: Promise<void>;
      retain: () => void;
      release: () => void;
      signal: AbortSignal;
    }
  >();
  function reserve(
    req: Request,
    res: Response,
    userId: string,
    maxBytes: number,
  ) {
    const length = req.get("Content-Length");
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
      throw new HttpError(413, "Upload request exceeds its size limit");
    if (
      req.get("Content-Encoding") &&
      req.get("Content-Encoding") !== "identity"
    )
      throw new HttpError(415, "Compressed request bodies are not supported");
    const bytes = length ? Number(length) : maxBytes;
    let released = false;
    let retained = false;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    void ready.catch(() => {});
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      clearTimeout(waitTimer);
      waiting.delete(start);
      if (started) {
        const remaining = (active.get(userId) ?? 1) - 1;
        if (remaining) active.set(userId, remaining);
        else active.delete(userId);
        activeRequests--;
        activeBytes -= bytes;
      } else {
        controller.abort();
        rejectReady(new HttpError(499, "Upload cancelled"));
      }
      drain();
    };
    const start = () => {
      if (released) return true;
      if (
        (active.get(userId) ?? 0) >= limits.activePerUser ||
        activeRequests >= limits.active ||
        (activeRequests > 0 && activeBytes + bytes > limits.activeBytes)
      )
        return false;
      clearTimeout(waitTimer);
      started = true;
      active.set(userId, (active.get(userId) ?? 0) + 1);
      activeRequests++;
      activeBytes += bytes;
      timer = setTimeout(() => {
        controller.abort();
        if (!res.headersSent)
          res.status(408).json({ error: "Upload timed out" });
        req.destroy();
        if (!retained) release();
      }, limits.receiveMs);
      timer.unref();
      resolveReady();
      return true;
    };
    res.once("finish", () => {
      if (!retained) release();
    });
    res.once("close", () => {
      if (!res.writableEnded) controller.abort();
      if (!retained) release();
    });
    const lease = {
      ready,
      retain: () => {
        retained = true;
      },
      release,
      signal: controller.signal,
    };
    leases.set(req, lease);
    if (!start()) {
      if (waiting.size >= limits.waiting) {
        release();
        throw new HttpError(
          429,
          "Upload queue is busy. Try again shortly.",
          10,
        );
      }
      waiting.add(start);
      waitTimer = setTimeout(() => {
        rejectReady(
          new HttpError(429, "Upload queue is busy. Try again shortly.", 10),
        );
        release();
      }, limits.waitMs);
      waitTimer.unref();
    }
    return lease;
  }
  async function checkParent(a: Actor, parentId: string | null) {
    if (!(await store.permission(a, "organization", a.orgId, "active_member")))
      throw new HttpError(404, "Organization not found");
    if (
      parentId &&
      (await requireResource(store, a, parentId, "write")).kind !== "folder"
    )
      throw new HttpError(404, "Writable folder not found");
  }
  const subjects = (a: Actor) =>
    uploadScopes(a.userId, a.orgId).map((scope) => scope.subject);
  async function capacity(a: Actor, bytes: number) {
    await checkStoredDocumentQuota(store, a.userId, a.orgId, bytes, 1, limits);
    for (const scope of uploadScopes(a.userId, a.orgId)) {
      const row = await store.one<{ pending: string }>(
        `SELECT COUNT(*)::text AS pending FROM resources r WHERE kind='document' AND ${scope.where} AND (status IN ('queued','processing','awaiting_key') OR thumbnail_status IN ('queued','processing') OR EXISTS (SELECT 1 FROM document_filing f WHERE f.resource_id=r.id AND f.state IN ('pending','working')))`,
        ...scope.args,
      );
      if (Number(row?.pending ?? 0) >= limits.pending[scope.key])
        throw new HttpError(
          429,
          "Document processing queue is full. Wait for existing uploads to finish.",
          10,
        );
    }
  }
  async function admit(a: Actor) {
    await store.transaction(async () => {
      await capacity(a, 0);
      if (!rateLimits) return;
      const time = Date.now();
      await store.run("DELETE FROM upload_usage WHERE expires_at<now()");
      for (const [period, allowances] of [
        [
          60_000,
          [
            limits.attemptsPerMinute.user,
            limits.attemptsPerMinute.organization,
            limits.attemptsPerMinute.deployment,
          ],
        ],
        [
          3_600_000,
          [
            limits.attemptsPerHour.user,
            limits.attemptsPerHour.organization,
            limits.attemptsPerHour.deployment,
          ],
        ],
      ] as const) {
        const bucket = Math.floor(time / period);
        const current = subjects(a);
        for (let i = 0; i < current.length; i++) {
          const row = await store.one<{ attempts: number }>(
            "SELECT attempts FROM upload_usage WHERE subject=? AND bucket=? AND period=?",
            current[i],
            bucket,
            period,
          );
          if ((row?.attempts ?? 0) >= allowances[i])
            throw new HttpError(
              429,
              "Upload rate limit reached. Retry later.",
              Math.ceil(((bucket + 1) * period - time) / 1000),
            );
        }
        for (const subject of current)
          await store.run(
            "INSERT INTO upload_usage(subject,bucket,period,attempts,expires_at) VALUES(?,?,?,1,?) ON CONFLICT(subject,bucket,period) DO UPDATE SET attempts=upload_usage.attempts+1",
            subject,
            bucket,
            period,
            new Date((bucket + 2) * period).toISOString(),
          );
      }
    });
  }
  const receive = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: uploadLimits.fileBytes,
      files: 1,
      fields: 1,
      parts: 2,
      fieldSize: 160,
      fieldNameSize: 32,
      headerPairs: 20,
    },
    fileFilter: (_req, file, callback) => {
      try {
        uploadName.parse(file.originalname);
        callback(null, true);
      } catch {
        callback(new HttpError(400, "Invalid filename"));
      }
    },
  }).single("file");
  function multipart(
    resolveActor: (req: Request) => Promise<Actor>,
  ): RequestHandler {
    return async (req, res, next) => {
      try {
        const a = await resolveActor(req);
        const lease = reserve(
          req,
          res,
          a.userId,
          uploadLimits.fileBytes + 16 * 1024,
        );
        await admit(a);
        await lease.ready;
        lease.signal.throwIfAborted();
        receive(req, res, (error) => {
          if (error) lease.release();
          else lease.retain();
          next(error);
        });
      } catch (error) {
        next(error);
      }
    };
  }
  async function save(
    a: Actor,
    filename: string,
    body: Buffer,
    parentId: string | null,
    revalidate: () => Promise<Actor>,
    signal?: AbortSignal,
  ) {
    await checkParent(a, parentId);
    filename = uploadName.parse(filename);
    const mime = await validate(
      () => validateUpload(filename, body, signal),
      signal,
    );
    return store.transaction(async () => {
      signal?.throwIfAborted();
      const current = await revalidate();
      if (current.userId !== a.userId || current.orgId !== a.orgId)
        throw new HttpError(403, "Upload identity changed");
      await checkParent(current, parentId);
      await capacity(current, body.length);
      const period = 86_400_000,
        bucket = Math.floor(Date.now() / period);
      const allowances = [
        limits.dailyBytes.user,
        limits.dailyBytes.organization,
        limits.dailyBytes.deployment,
      ];
      const currentSubjects = subjects(current);
      for (let i = 0; i < currentSubjects.length; i++) {
        const row = await store.one<{ bytes: string }>(
          "SELECT bytes FROM upload_usage WHERE subject=? AND bucket=? AND period=?",
          currentSubjects[i],
          bucket,
          period,
        );
        if (Number(row?.bytes ?? 0) + body.length > allowances[i])
          throw new HttpError(
            429,
            "Daily upload byte quota reached",
            Math.ceil(((bucket + 1) * period - Date.now()) / 1000),
          );
      }
      for (const subject of currentSubjects)
        await store.run(
          "INSERT INTO upload_usage(subject,bucket,period,bytes,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(subject,bucket,period) DO UPDATE SET bytes=upload_usage.bytes+EXCLUDED.bytes",
          subject,
          bucket,
          period,
          body.length,
          new Date((bucket + 2) * period).toISOString(),
        );
      const id = randomUUID(),
        status = "queued";
      await store.run(
        "INSERT INTO resources(id,org_id,owner_id,parent_id,kind,name,mime,size,status,access,created) VALUES(?,?,?,?,'document',?,?,?,?,'restricted',?)",
        id,
        current.orgId,
        current.userId,
        parentId,
        filename,
        mime,
        body.length,
        status,
        new Date().toISOString(),
      );
      await store.files.write("document", id, body, mime);
      signal?.throwIfAborted();
      await enqueueThumbnail(store, id);
      const pinned = await hasPinnedFolders(store, current.orgId, [parentId]);
      await store.run(
        "INSERT INTO document_filing(resource_id,scope_id,state,outcome) VALUES(?,?,?,?)",
        id,
        parentId,
        pinned ? "disabled" : "pending",
        JSON.stringify(pinned ? { reason: "pinned" } : {}),
      );
      await enqueueIndex(store, id);
      await store.run(
        "INSERT INTO audit(org_id,user_id,action,resource_id,created) VALUES(?,?,'document.upload',?,?)",
        current.orgId,
        current.userId,
        id,
        new Date().toISOString(),
      );
      signal?.throwIfAborted();
      await checkParent(await revalidate(), parentId);
      return {
        id,
        name: filename,
        size: body.length,
        mime,
        status,
        access: "private" as const,
      };
    });
  }
  return {
    reserve,
    admit,
    checkParent,
    multipart,
    save,
    lease: (req: Request) => leases.get(req),
  };
}
