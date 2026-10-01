import { createHash } from "node:crypto";
import sharp from "sharp";
import Papa from "papaparse";
import {
  extension,
  imageExtensions,
  textExtensions,
} from "../shared/file-types";
import { THUMBNAIL_SIZE, type Thumbnail } from "../shared/thumbnails";
import { prepareCodePreview } from "../shared/code-thumbnail-content";
import { HttpError, resourceAccess, type Resource, type Store } from "./db";
import { queues, PermanentJobError, type BackgroundJob } from "./jobs";
import { createThumbnailRenderer } from "./thumbnail-renderer";

export const supportsThumbnail = (name: string) =>
  [
    ...imageExtensions,
    ...textExtensions,
    "pdf",
    "pptx",
    "docx",
    "xlsx",
    "zip",
  ].includes(extension(name));

export function describeThumbnail(
  resource: Resource,
  base = `/api/documents/${resource.id}`,
): Thumbnail | null {
  return resource.thumbnail_status === "ready" &&
    resource.thumbnail_key &&
    resource.thumbnail_width &&
    resource.thumbnail_height
    ? {
        url: `${base}/thumbnail?v=${resource.thumbnail_key}`,
        width: resource.thumbnail_width,
        height: resource.thumbnail_height,
        pageCount: resource.thumbnail_pages ?? 1,
      }
    : null;
}

export async function enqueueThumbnail(store: Store, resourceId: string) {
  return store.transaction(async () => {
    const resource = await store.one<Resource>(
      "SELECT * FROM resources WHERE id=? AND kind='document'",
      resourceId,
    );
    if (
      !resource ||
      ["ready", "queued", "processing", "unsupported"].includes(
        resource.thumbnail_status,
      )
    )
      return;
    if (!supportsThumbnail(resource.name)) {
      await store.run(
        "UPDATE resources SET thumbnail_status='unsupported' WHERE id=?",
        resourceId,
      );
      return;
    }
    const jobId = await store.jobs.send(
      queues.thumbnail,
      { resourceId },
      resourceId,
    );
    await store.run(
      "UPDATE resources SET thumbnail_status='queued',thumbnail_job_id=? WHERE id=?",
      jobId,
      resourceId,
    );
    return jobId;
  });
}

export async function enqueueMissingThumbnails(store: Store) {
  for (;;) {
    const count = await store.transaction(async () => {
      const rows = await store.all<{ id: string }>(
        "SELECT id FROM resources WHERE kind='document' AND thumbnail_status='pending' ORDER BY id LIMIT 50",
      );
      for (const row of rows) await enqueueThumbnail(store, row.id);
      return rows.length;
    });
    if (count < 50) return;
  }
}

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );

function archivePreview(body: Buffer) {
  for (let i = body.length - 22; i >= Math.max(0, body.length - 65557); i--) {
    if (body.readUInt32LE(i) !== 0x06054b50) continue;
    const directory = body.readUInt32LE(i + 16);
    const size = body.readUInt32LE(i + 12);
    if (directory + size > i) break;
    const names: string[] = [];
    let offset = directory;
    while (
      names.length < 24 &&
      offset + 46 <= body.length &&
      body.readUInt32LE(offset) === 0x02014b50
    ) {
      const length = body.readUInt16LE(offset + 28);
      if (offset + 46 + length > body.length) break;
      names.push(
        body.subarray(offset + 46, offset + 46 + length).toString("utf8"),
      );
      offset +=
        46 +
        length +
        body.readUInt16LE(offset + 30) +
        body.readUInt16LE(offset + 32);
    }
    if (names.length) return names.join("\n");
    break;
  }
  throw new PermanentJobError("Archive preview unavailable");
}

function textPreview(body: Buffer, name: string) {
  const ext = extension(name);
  const source =
    ext === "zip"
      ? archivePreview(body)
      : body.subarray(0, 16384).toString("utf8");
  if (source.includes("\u0000"))
    throw new PermanentJobError("Text preview unavailable");
  if (["csv", "tsv"].includes(ext)) {
    const rows = Papa.parse<string[]>(source, {
      preview: 14,
      delimiter: ext === "tsv" ? "\t" : ",",
      skipEmptyLines: true,
    }).data;
    const columns = Math.max(
      1,
      Math.min(5, Math.max(...rows.map((row) => row.length))),
    );
    const columnWidth = 256 / columns;
    const cells = rows
      .map((row, rowIndex) =>
        row
          .slice(0, columns)
          .map((value, columnIndex) => {
            const x = columnIndex * columnWidth,
              y = rowIndex * 24;
            return `<rect x="${x}" y="${y}" width="${columnWidth}" height="24" fill="${rowIndex === 0 ? "#e2e8f0" : rowIndex % 2 ? "#ffffff" : "#f8fafc"}" stroke="#cbd5e1" stroke-width="0.5"/><text x="${x + 5}" y="${y + 15}" font-family="sans-serif" font-size="9" font-weight="${rowIndex === 0 ? "bold" : "normal"}" fill="#334155">${escapeXml(String(value).slice(0, Math.floor(columnWidth / 6)))}</text>`;
          })
          .join(""),
      )
      .join("");
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="${Math.max(96, rows.length * 24)}"><rect width="256" height="100%" fill="white"/>${cells}</svg>`,
    );
  }
  const lines = prepareCodePreview(
    source,
    ext === "json" ? "json" : "text",
  ).split("\n");
  const rows = lines
    .map(
      (line, index) =>
        `<text x="24" y="${58 + index * 13}" fill="#9aa3b0" text-anchor="end">${index + 1}</text><text x="34" y="${58 + index * 13}" fill="#334155">${escapeXml(line)}</text>`,
    )
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="328"><rect width="256" height="328" fill="white"/><rect width="256" height="32" fill="#f1f5f9"/><text x="14" y="21" font-family="sans-serif" font-size="10" font-weight="bold" fill="#64748b">${escapeXml(ext.toUpperCase())}</text><g font-family="monospace" font-size="8" xml:space="preserve">${rows}</g></svg>`,
  );
}

export async function compressThumbnail(body: Buffer) {
  const { data, info } = await sharp(body, {
    limitInputPixels: 40_000_000,
    pages: 1,
  })
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 82, effort: 4, smartSubsample: true })
    .timeout({ seconds: 20 })
    .toBuffer({ resolveWithObject: true });
  if (!data.length || data.length > 128 * 1024)
    throw new PermanentJobError("Thumbnail exceeds its size limit");
  return { body: data, width: info.width, height: info.height };
}

export function createThumbnailJobs(store: Store) {
  const renderer = createThumbnailRenderer();
  return {
    async generate(
      body: Buffer,
      name: string,
      mime: string,
      signal: AbortSignal,
    ) {
      signal.throwIfAborted();
      let pageCount = 1;
      let raster: Buffer;
      if (
        imageExtensions.includes(extension(name)) &&
        extension(name) !== "bmp"
      ) {
        raster = body;
      } else if (
        textExtensions.includes(extension(name)) ||
        extension(name) === "zip"
      ) {
        raster = textPreview(body, name);
      } else {
        const result = await renderer.render(body, name, mime, signal);
        raster = result.body;
        pageCount = result.pageCount;
      }
      const result = await compressThumbnail(raster);
      signal.throwIfAborted();
      return { ...result, pageCount };
    },
    async process(job: BackgroundJob) {
      const resource = await store.jobs.guard(job, async () => {
        const resource = await store.one<Resource>(
          "SELECT * FROM resources WHERE id=? AND thumbnail_job_id=? AND thumbnail_status IN ('queued','processing')",
          job.data.resourceId,
          job.id,
        );
        if (resource)
          await store.run(
            "UPDATE resources SET thumbnail_status='processing' WHERE id=?",
            resource.id,
          );
        return resource;
      });
      if (!resource) return;
      async function check() {
        job.signal.throwIfAborted();
        const current = await store.one<Resource>(
          "SELECT * FROM resources WHERE id=?",
          resource!.id,
        );
        const member = await store.one<{ role: string }>(
          "SELECT role FROM members WHERE org_id=? AND user_id=?",
          resource!.org_id,
          resource!.owner_id,
        );
        if (
          !member ||
          current?.thumbnail_job_id !== job.id ||
          current.thumbnail_status !== "processing" ||
          !(await resourceAccess(
            store,
            {
              userId: resource!.owner_id,
              orgId: resource!.org_id,
              role: member.role,
              token: "",
            },
            resource!.id,
          ))
        )
          throw new HttpError(
            409,
            "Thumbnail generation stopped because access changed",
          );
      }
      await check();
      const source = await store.files.read("document", resource.id);
      if (!source) throw new PermanentJobError("Content unavailable");
      const result = await this.generate(
        source.body,
        resource.name,
        resource.mime,
        job.signal,
      );
      await store.jobs.complete(job, async () => {
        await check();
        await store.files.write("thumbnail", resource.id, result.body, "image/webp");
        await store.run(
          "UPDATE resources SET thumbnail_status='ready',thumbnail_key=?,thumbnail_width=?,thumbnail_height=?,thumbnail_pages=? WHERE id=? AND thumbnail_job_id=?",
          createHash("sha256").update(result.body).digest("hex").slice(0, 24),
          result.width,
          result.height,
          result.pageCount,
          resource.id,
          job.id,
        );
      });
    },
    close: renderer.close,
  };
}
