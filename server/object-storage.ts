import { createHash, randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { HttpError } from "./errors";
import type { Readable } from "node:stream";

export function storageFailureDetails(operation: string, error: unknown) {
  const failure = error as {
    name?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown; requestId?: unknown };
    $response?: { headers?: Record<string, unknown> };
  } | null;
  const safeCode = (value: unknown) =>
    typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(value)
      ? value
      : undefined;
  const bucketRegion = failure?.$response?.headers?.["x-amz-bucket-region"];
  const requestId = failure?.$metadata?.requestId;
  const status = failure?.$metadata?.httpStatusCode;
  return {
    operation,
    code: safeCode(failure?.code) ?? safeCode(failure?.name) ?? "UnknownError",
    ...(typeof status === "number" && status >= 100 && status <= 599
      ? { status }
      : {}),
    ...(typeof bucketRegion === "string" &&
    /^[a-z0-9-]{3,32}$/.test(bucketRegion)
      ? { bucketRegion }
      : {}),
    ...(typeof requestId === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(requestId)
      ? { requestId }
      : {}),
  };
}

export type ObjectStorage = {
  bucket: string;
  prefix: string;
  put: (key: string, body: Buffer, mime: string) => Promise<void>;
  get: (bucket: string, key: string) => Promise<Buffer>;
  stream: (
    bucket: string,
    key: string,
    signal: AbortSignal,
  ) => Promise<Readable>;
  delete: (bucket: string, key: string) => Promise<void>;
  ready: () => Promise<void>;
  close: () => void;
};

export function createObjectStorage(
  env = process.env,
): ObjectStorage | undefined {
  const backend = env.FILE_STORAGE || (env.S3_BUCKET ? "s3" : "postgres");
  if (!["s3", "postgres"].includes(backend))
    throw new Error("FILE_STORAGE must be s3 or postgres");
  if (backend === "postgres") {
    if (env.S3_BUCKET) throw new Error("S3_BUCKET requires FILE_STORAGE=s3");
    return;
  }
  if (!env.S3_BUCKET || !env.AWS_REGION)
    throw new Error("S3_BUCKET and AWS_REGION are required for S3 storage");
  if (!!env.AWS_ACCESS_KEY_ID !== !!env.AWS_SECRET_ACCESS_KEY)
    throw new Error("Supply both AWS access key variables or use an IAM role");
  if (
    env.S3_FORCE_PATH_STYLE &&
    !["true", "false"].includes(env.S3_FORCE_PATH_STYLE)
  )
    throw new Error("S3_FORCE_PATH_STYLE must be true or false");
  if (env.S3_ENDPOINT) {
    const endpoint = new URL(env.S3_ENDPOINT);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error(
        "S3_ENDPOINT must be an HTTP or HTTPS endpoint without credentials",
      );
  }
  const prefix = (env.S3_PREFIX || "jevbox").replace(/^\/+|\/+$/g, "");
  if (!/^[a-zA-Z0-9/_-]+$/.test(prefix))
    throw new Error(
      "S3_PREFIX must contain letters, digits, slashes, underscores, or hyphens",
    );
  const bucket = env.S3_BUCKET;
  const client = new S3Client({
    region: env.AWS_REGION,
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    requestChecksumCalculation: "WHEN_REQUIRED",
    maxAttempts: 3,
  });
  function unavailable(operation: string, error: unknown) {
    console.error("File storage request failed", {
      ...storageFailureDetails(operation, error),
      bucket,
      region: env.AWS_REGION,
    });
    return new HttpError(503, "File storage is unavailable. Please retry.");
  }
  async function send(name: string, operation: () => Promise<unknown>) {
    try {
      return await operation();
    } catch (error) {
      throw unavailable(name, error);
    }
  }
  return {
    bucket,
    prefix,
    async put(key, body, mime) {
      await send("PutObject", () =>
        client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: mime,
          }),
          { abortSignal: AbortSignal.timeout(20_000) },
        ),
      );
    },
    async get(bucket, key) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(20_000) },
        );
        if (!result.Body) throw new Error("Empty storage response");
        return Buffer.from(await result.Body.transformToByteArray());
      } catch (error) {
        throw unavailable("GetObject", error);
      }
    },
    async stream(bucket, key, signal) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { abortSignal: signal },
        );
        if (!result.Body) throw new Error("Empty storage response");
        return result.Body as Readable;
      } catch (error) {
        throw unavailable("GetObject", error);
      }
    },
    async delete(bucket, key) {
      await send("DeleteObject", () =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: AbortSignal.timeout(20_000),
        }),
      );
    },
    async ready() {
      await send("HeadBucket", () =>
        client.send(new HeadBucketCommand({ Bucket: bucket }), {
          abortSignal: AbortSignal.timeout(20_000),
        }),
      );
    },
    close: () => client.destroy(),
  };
}

type Kind = "document" | "thumbnail";
type StoredObject = {
  bucket: string;
  object_key: string;
  sha256: string;
  size: number;
};
type FileDatabase = {
  one: <T>(sql: string, ...args: any[]) => Promise<T | undefined>;
  all: <T>(sql: string, ...args: any[]) => Promise<T[]>;
  run: (sql: string, ...args: any[]) => Promise<unknown>;
  transaction: <T>(fn: () => Promise<T>) => Promise<T>;
  reserve: (object: StoredObject) => Promise<void>;
};
const hash = (body: Buffer) => createHash("sha256").update(body).digest("hex");

export function createFileStorage(db: FileDatabase, objects?: ObjectStorage) {
  async function read(kind: Kind, resourceId: string) {
    const table = kind === "document" ? "blobs" : "thumbnails";
    const row = await db.one<
      { body: Buffer | null; mime: string } & Partial<StoredObject>
    >(
      `SELECT b.body,${kind === "document" ? "r.mime" : "b.mime"},o.bucket,o.object_key,o.sha256,o.size FROM ${table} b JOIN resources r ON r.id=b.resource_id LEFT JOIN storage_objects o ON o.resource_id=b.resource_id AND o.kind=? WHERE b.resource_id=?`,
      kind,
      resourceId,
    );
    if (!row) return;
    if (row.object_key) {
      if (!objects)
        throw new HttpError(
          503,
          "S3 storage must be configured to read this file",
        );
      const body = await objects.get(row.bucket!, row.object_key);
      if (body.length !== row.size || hash(body) !== row.sha256)
        throw new HttpError(503, "Stored file integrity check failed");
      return { body, mime: row.mime };
    }
    if (row.body !== null) return { body: row.body, mime: row.mime };
    throw new HttpError(503, "Stored file reference is unavailable");
  }
  async function write(
    kind: Kind,
    resourceId: string,
    body: Buffer,
    mime: string,
  ) {
    const table = kind === "document" ? "blobs" : "thumbnails";
    await db.transaction(async () => {
      if (
        !objects &&
        (await db.one(
          "SELECT 1 FROM storage_objects WHERE resource_id=? AND kind=?",
          resourceId,
          kind,
        ))
      )
        throw new HttpError(
          503,
          "S3 storage must be configured to replace this file",
        );
      if (objects) {
        const object = {
          bucket: objects.bucket,
          object_key: `${objects.prefix}/${kind}/${resourceId}/${randomUUID()}`,
          sha256: hash(body),
          size: body.length,
        };
        await db.reserve(object);
        await objects.put(object.object_key, body, mime);
        await db.run(
          "UPDATE storage_objects SET resource_id=NULL WHERE resource_id=? AND kind=?",
          resourceId,
          kind,
        );
        await db.run(
          "UPDATE storage_objects SET resource_id=?,kind=? WHERE bucket=? AND object_key=?",
          resourceId,
          kind,
          object.bucket,
          object.object_key,
        );
      }
      if (kind === "document")
        await db.run(
          `INSERT INTO ${table}(resource_id,body) VALUES(?,?) ON CONFLICT(resource_id) DO UPDATE SET body=EXCLUDED.body`,
          resourceId,
          objects ? null : body,
        );
      else
        await db.run(
          `INSERT INTO ${table}(resource_id,body,mime) VALUES(?,?,?) ON CONFLICT(resource_id) DO UPDATE SET body=EXCLUDED.body,mime=EXCLUDED.mime`,
          resourceId,
          objects ? null : body,
          mime,
        );
    });
  }
  return {
    backend: objects ? "s3" : "postgres",
    async download(resourceId: string) {
      const row = await db.one<Partial<StoredObject> & { bytes: number }>(
        "SELECT o.bucket,o.object_key,o.sha256,o.size,COALESCE(o.size,OCTET_LENGTH(b.body)) AS bytes FROM blobs b LEFT JOIN storage_objects o ON o.resource_id=b.resource_id AND o.kind='document' WHERE b.resource_id=?",
        resourceId,
      );
      if (!row) throw new HttpError(404, "Content not found");
      if (!Number.isSafeInteger(row.bytes) || row.bytes < 0)
        throw new HttpError(503, "Stored file reference is unavailable");
      return {
        size: row.bytes,
        sha256: row.object_key ? row.sha256 : undefined,
        async *chunks(signal: AbortSignal): AsyncGenerator<Uint8Array> {
          if (row.object_key) {
            if (!objects)
              throw new HttpError(
                503,
                "S3 storage must be configured to read this file",
              );
            const stream = await objects.stream(
              row.bucket!,
              row.object_key,
              signal,
            );
            try {
              for await (const chunk of stream) {
                signal.throwIfAborted();
                yield chunk;
              }
            } finally {
              stream.destroy();
            }
          } else {
            for (let offset = 0; offset < row.bytes; offset += 1024 * 1024) {
              signal.throwIfAborted();
              const part = await db.one<{ body: Buffer | null }>(
                "SELECT substring(body FROM ? FOR ?) AS body FROM blobs WHERE resource_id=?",
                offset + 1,
                Math.min(1024 * 1024, row.bytes - offset),
                resourceId,
              );
              if (!part?.body?.length)
                throw new HttpError(503, "Stored file is unavailable");
              yield part.body;
            }
          }
        },
      };
    },
    read,
    write,
    async ready() {
      await objects?.ready();
    },
    async cleanup() {
      if (!objects) return;
      await db.transaction(async () => {
        const rows = await db.all<StoredObject>(
          "SELECT bucket,object_key FROM storage_objects WHERE resource_id IS NULL AND created < now() - interval '1 hour' ORDER BY created LIMIT 5 FOR UPDATE SKIP LOCKED",
        );
        for (const row of rows) {
          await objects.delete(row.bucket, row.object_key);
          await db.run(
            "DELETE FROM storage_objects WHERE bucket=? AND object_key=? AND resource_id IS NULL",
            row.bucket,
            row.object_key,
          );
        }
      });
    },
    async migrateBatch() {
      if (!objects) throw new Error("Configure S3 before migrating files");
      return db.transaction(async () => {
        const documents = await db.all<{
          resource_id: string;
          body: Buffer;
          mime: string;
        }>(
          "SELECT b.resource_id,b.body,r.mime FROM blobs b JOIN resources r ON r.id=b.resource_id WHERE b.body IS NOT NULL ORDER BY b.resource_id LIMIT 5 FOR UPDATE OF b",
        );
        const thumbnails = await db.all<{
          resource_id: string;
          body: Buffer;
          mime: string;
        }>(
          "SELECT resource_id,body,mime FROM thumbnails WHERE body IS NOT NULL ORDER BY resource_id LIMIT 5 FOR UPDATE",
        );
        for (const [kind, rows] of [
          ["document", documents],
          ["thumbnail", thumbnails],
        ] as const) {
          for (const row of rows) {
            await write(kind, row.resource_id, row.body, row.mime);
            const copy = await read(kind, row.resource_id);
            if (!copy || !copy.body.equals(row.body))
              throw new Error("Storage migration verification failed");
          }
        }
        return documents.length + thumbnails.length;
      });
    },
  };
}
