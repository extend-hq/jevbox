import { HttpError, resourceAccess, type Resource, type Store } from "./db";
import { createProviders } from "./providers";
import { queues, PermanentJobError, type BackgroundJob } from "./jobs";
import { checkStoredDocumentQuota } from "./upload-quotas";

export async function enqueueIndex(
  store: Store,
  resourceId: string,
  data = {},
  delay = 0,
) {
  return store.transaction(async () => {
    const id = await store.jobs.send(
      queues.index,
      { resourceId, ...data },
      resourceId,
      delay,
    );
    await store.run(
      "UPDATE resources SET index_job_id=? WHERE id=?",
      id,
      resourceId,
    );
    return id;
  });
}

export function createIndexHandler(
  store: Store,
  providers: ReturnType<typeof createProviders>,
) {
  return async (job: BackgroundJob) => {
    const document = await store.jobs.guard(job, async () => {
      const document = await store.one<Resource>(
        "SELECT * FROM resources WHERE id=? AND index_job_id=? AND status IN ('queued','processing')",
        job.data.resourceId,
        job.id,
      );
      if (document)
        await store.run(
          "UPDATE resources SET status='processing',error=NULL WHERE id=?",
          document.id,
        );
      return document;
    });
    if (!document) return;
    const check = async () => {
      job.signal.throwIfAborted();
      const member = await store.one<{ role: string }>(
        "SELECT role FROM members WHERE org_id=? AND user_id=?",
        document.org_id,
        document.owner_id,
      );
      const current = await store.one<Resource>(
        "SELECT * FROM resources WHERE id=?",
        document.id,
      );
      if (
        !member ||
        current?.index_job_id !== job.id ||
        current.status !== "processing" ||
        !(await resourceAccess(
          store,
          {
            userId: document.owner_id,
            orgId: document.org_id,
            role: member.role,
            token: "",
          },
          document.id,
        ))
      )
        throw new HttpError(
          409,
          "The document changed or its owner lost access. Indexing stopped.",
        );
    };
    if (document.parse_requested && !document.parse_run)
      throw new PermanentJobError(
        "The parsing request was interrupted before confirmation. Retry indexing to start a new request.",
      );
    await check();
    const parsed = await providers.processDocument(document, {
      signal: job.signal,
      check,
      checkpoint: (sql, ...values) =>
        store.jobs.guard(job, async () => {
          await check();
          await store.run(sql, ...values);
        }),
    });
    await store.jobs.complete(job, async () => {
      if (parsed) {
        await check();
        const serialized = JSON.stringify(parsed);
        try {
          await checkStoredDocumentQuota(
            store,
            document.owner_id,
            document.org_id,
            Math.max(
              0,
              Buffer.byteLength(serialized) -
                Buffer.byteLength(document.parsed ?? ""),
            ),
          );
        } catch (error) {
          if (error instanceof HttpError && error.status === 429)
            throw new PermanentJobError(
              "Document storage quota reached. Delete documents before retrying indexing.",
            );
          throw error;
        }
        await store.run(
          "UPDATE resources SET parsed=?,status='ready',error=NULL WHERE id=? AND index_job_id=?",
          serialized,
          document.id,
          job.id,
        );
        const filing = await store.one<{ job_id: string | null }>(
          "SELECT job_id FROM document_filing WHERE resource_id=? AND state='pending'",
          document.id,
        );
        if (filing && !filing.job_id) {
          const filingId = await store.jobs.send(
            queues.filing,
            { resourceId: document.id },
            document.id,
          );
          await store.run(
            "UPDATE document_filing SET job_id=? WHERE resource_id=?",
            filingId,
            document.id,
          );
        }
      } else {
        const current = await store.one<Resource>(
          "SELECT * FROM resources WHERE id=?",
          document.id,
        );
        if (current?.status === "processing") {
          const startedAt = job.data.startedAt ?? Date.now();
          if (Date.now() - startedAt >= 30 * 60_000)
            throw new PermanentJobError(
              "Parsing took too long. Retry indexing to resume the existing request.",
            );
          const poll = (job.data.poll ?? 0) + 1;
          await enqueueIndex(
            store,
            document.id,
            { startedAt, poll },
            Math.min(30, 3 * 2 ** Math.min(4, poll - 1)),
          );
        }
      }
    });
  };
}
