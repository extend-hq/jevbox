import { randomUUID } from "node:crypto";
import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import type { Request, Response, RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import sharp from "sharp";
import {
  extension,
  fileMime,
  mimeTypes,
  textExtensions,
  supportsIndex,
} from "../shared/file-types";
import { uploadLimits } from "../shared/uploads";
import { HttpError, requireResource, type Actor, type Store } from "./db";
import { enqueueIndex } from "./indexing-jobs";
import { enqueueThumbnail } from "./thumbnails";

export const uploadName = z
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
    contentBase64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(uploadLimits.mcpBytes / 3)),
    parentId: z.string().uuid().optional(),
  })
  .strict();
const inflate = promisify(inflateRaw);

async function validateOffice(body: Buffer, ext: string) {
  const fail = () => {
    throw new HttpError(400, "Invalid or excessively expanded Office document");
  };
  let end = -1;
  for (let i = body.length - 22; i >= Math.max(0, body.length - 65557); i--)
    if (
      body.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + body.readUInt16LE(i + 20) === body.length
    ) {
      end = i;
      break;
    }
  if (end < 0 || body.readUInt16LE(end + 4) || body.readUInt16LE(end + 6))
    return fail();
  const count = body.readUInt16LE(end + 10);
  const directorySize = body.readUInt32LE(end + 12);
  let offset = body.readUInt32LE(end + 16);
  const directoryEnd = offset + directorySize;
  if (!count || count > 2000 || directoryEnd !== end) return fail();
  const names = new Set<string>();
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || body.readUInt32LE(offset) !== 0x02014b50)
      return fail();
    const flags = body.readUInt16LE(offset + 8),
      method = body.readUInt16LE(offset + 10);
    const compressed = body.readUInt32LE(offset + 20),
      size = body.readUInt32LE(offset + 24);
    const length = body.readUInt16LE(offset + 28);
    const next =
      offset +
      46 +
      length +
      body.readUInt16LE(offset + 30) +
      body.readUInt16LE(offset + 32);
    const local = body.readUInt32LE(offset + 42);
    if (
      next > end ||
      local + 30 > body.readUInt32LE(end + 16) ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      size > 8 * 1024 * 1024 ||
      size > Math.max(1024 * 1024, compressed * 200)
    )
      return fail();
    const filename = body
      .subarray(offset + 46, offset + 46 + length)
      .toString("utf8");
    if (
      names.has(filename) ||
      filename.startsWith("/") ||
      filename.includes("\\") ||
      filename.split("/").includes("..") ||
      /[\x00-\x1f]/.test(filename)
    )
      return fail();
    names.add(filename);
    expanded += size;
    if (
      expanded > 32 * 1024 * 1024 ||
      body.readUInt32LE(local) !== 0x04034b50 ||
      body.readUInt16LE(local + 8) !== method
    )
      return fail();
    const localLength = body.readUInt16LE(local + 26);
    const start = local + 30 + localLength + body.readUInt16LE(local + 28);
    if (
      start + compressed > body.readUInt32LE(end + 16) ||
      body.subarray(local + 30, local + 30 + localLength).toString("utf8") !==
        filename
    )
      return fail();
    try {
      const decoded =
        method === 0
          ? body.subarray(start, start + compressed)
          : await inflate(body.subarray(start, start + compressed), {
              maxOutputLength: Math.max(1, size),
            });
      if (decoded.length !== size) return fail();
    } catch {
      return fail();
    }
    offset = next;
  }
  const main = {
    docx: "word/document.xml",
    xlsx: "xl/workbook.xml",
    pptx: "ppt/presentation.xml",
  }[ext];
  if (
    offset !== directoryEnd ||
    !names.has("[Content_Types].xml") ||
    !main ||
    !names.has(main)
  )
    return fail();
}

export async function validateUpload(filename: string, body: Buffer) {
  uploadName.parse(filename);
  if (!body.length) throw new HttpError(400, "The document is empty");
  if (body.length > uploadLimits.fileBytes)
    throw new HttpError(413, "Files must be at most 30 MiB");
  const ext = extension(filename);
  if (!textExtensions.includes(ext) && !mimeTypes[ext])
    throw new HttpError(415, "This file type is not supported");
  if (textExtensions.includes(ext) || ext === "svg") {
    if (body.length > uploadLimits.textBytes)
      throw new HttpError(413, "Text documents must be at most 2 MiB");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      throw new HttpError(400, "Text documents must contain valid UTF-8");
    }
    if (body.includes(0))
      throw new HttpError(400, "Text documents cannot contain null bytes");
  }
  if (ext === "pdf" && !body.subarray(0, 1024).includes(Buffer.from("%PDF-")))
    throw new HttpError(400, "Invalid PDF document");
  if (["docx", "xlsx", "pptx"].includes(ext)) await validateOffice(body, ext);
  if (["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp"].includes(ext)) {
    try {
      const metadata = await sharp(body, {
        limitInputPixels: 40_000_000,
        pages: 1,
      }).metadata();
      const expected = ext === "jpg" ? "jpeg" : ext === "avif" ? "heif" : ext;
      if (
        metadata.format !== expected ||
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > 40_000_000
      )
        throw new Error();
    } catch {
      throw new HttpError(
        400,
        "Invalid image or image exceeds 40 million pixels",
      );
    }
  }
  return fileMime(filename);
}

export function decodeUpload(content: string) {
  if (content.length > 4 * Math.ceil(uploadLimits.mcpBytes / 3))
    throw new HttpError(
      413,
      "MCP uploads must be at most 2 MiB; use the REST API for larger files",
    );
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      content,
    )
  )
    throw new HttpError(
      400,
      "Provide standard padded base64 without a data URL prefix",
    );
  const body = Buffer.from(content, "base64");
  if (
    !body.length ||
    body.length > uploadLimits.mcpBytes ||
    body.toString("base64") !== content
  )
    throw new HttpError(400, "Invalid base64 or decoded file size");
  return body;
}

export function createUploads(store: Store) {
  const active = new Set<string>();
  function reserve(
    req: Request,
    res: Response,
    userId: string,
    maxBytes: number,
  ) {
    if (active.has(userId) || active.size >= uploadLimits.active)
      throw new HttpError(429, "Uploads are busy. Retry shortly.");
    const length = req.get("Content-Length");
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes))
      throw new HttpError(413, "Upload request exceeds its size limit");
    if (
      req.get("Content-Encoding") &&
      req.get("Content-Encoding") !== "identity"
    )
      throw new HttpError(415, "Compressed request bodies are not supported");
    active.add(userId);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active.delete(userId);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(408).json({ error: "Upload timed out" });
      req.destroy();
      release();
    }, uploadLimits.receiveMs);
    timer.unref();
    res.once("finish", release);
    res.once("close", release);
    return release;
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
  const subjects = (a: Actor) => [
    `user:${a.userId}`,
    `org:${a.orgId}`,
    "deployment",
  ];
  async function capacity(a: Actor, bytes: number) {
    const rows = await store.all<{
      subject: string;
      size: string;
      pending: string;
    }>(
      "SELECT subject,COALESCE(SUM(size),0)::text AS size,COUNT(*) FILTER (WHERE status IN ('queued','processing') OR thumbnail_status IN ('queued','processing') OR EXISTS (SELECT 1 FROM document_filing f WHERE f.resource_id=r.id AND f.state IN ('pending','working')))::text AS pending FROM resources r CROSS JOIN LATERAL (VALUES ('deployment'),(CASE WHEN owner_id=? THEN 'user' END),(CASE WHEN org_id=? THEN 'organization' END)) s(subject) WHERE kind='document' AND subject IS NOT NULL GROUP BY subject",
      a.userId,
      a.orgId,
    );
    for (const row of rows) {
      const scope = row.subject as keyof typeof uploadLimits.pending;
      if (Number(row.pending) >= uploadLimits.pending[scope])
        throw new HttpError(
          429,
          "Document processing queue is full. Wait for existing uploads to finish.",
        );
      if (Number(row.size) + bytes > uploadLimits.storedBytes[scope])
        throw new HttpError(429, "Document storage quota reached");
    }
  }
  async function admit(a: Actor) {
    await store.transaction(async () => {
      await capacity(a, 0);
      const time = Date.now();
      await store.run("DELETE FROM upload_usage WHERE expires_at<now()");
      for (const [period, limits] of [
        [60_000, [5, 20, 60]],
        [3_600_000, [20, 100, 300]],
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
          if ((row?.attempts ?? 0) >= limits[i])
            throw new HttpError(429, "Upload rate limit reached. Retry later.");
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
        reserve(req, res, a.userId, uploadLimits.fileBytes + 16 * 1024);
        await admit(a);
        receive(req, res, next);
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
  ) {
    await checkParent(a, parentId);
    const mime = await validateUpload(filename, body);
    return store.transaction(async () => {
      const current = await revalidate();
      if (current.userId !== a.userId || current.orgId !== a.orgId)
        throw new HttpError(403, "Upload identity changed");
      await checkParent(current, parentId);
      await capacity(current, body.length);
      const period = 86_400_000,
        bucket = Math.floor(Date.now() / period);
      const limits = Object.values(uploadLimits.dailyBytes);
      const currentSubjects = subjects(current);
      for (let i = 0; i < currentSubjects.length; i++) {
        const row = await store.one<{ bytes: string }>(
          "SELECT bytes FROM upload_usage WHERE subject=? AND bucket=? AND period=?",
          currentSubjects[i],
          bucket,
          period,
        );
        if (Number(row?.bytes ?? 0) + body.length > limits[i])
          throw new HttpError(429, "Daily upload byte quota reached");
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
        status = supportsIndex(filename) ? "queued" : "stored";
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
      await enqueueThumbnail(store, id);
      if (supportsIndex(filename)) {
        await store.run(
          "INSERT INTO document_filing(resource_id,scope_id) VALUES(?,?)",
          id,
          parentId,
        );
        await enqueueIndex(store, id);
      }
      await store.run(
        "INSERT INTO audit(org_id,user_id,action,resource_id,created) VALUES(?,?,'document.upload',?,?)",
        current.orgId,
        current.userId,
        id,
        new Date().toISOString(),
      );
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
  return { reserve, admit, checkParent, multipart, save };
}
