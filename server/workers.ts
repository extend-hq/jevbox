import { createOrganization } from "./organization";
import { createIndexHandler } from "./indexing-jobs";
import { createThumbnailJobs, enqueueMissingThumbnails } from "./thumbnails";
import { createProviders } from "./providers";
import { createChatRuntime } from "./chat";
import { authenticateToken } from "./sessions";
import { createAuthentication } from "./auth";
import { resolve } from "node:path";
import {
  createAuthEmailSender,
  type SendAuthEmail,
  type AuthEmail,
} from "./auth-email";
import type { Store } from "./db";
import {
  queues,
  jobError,
  permanent,
  LostJobClaim,
  type BackgroundJob,
  type QueueName,
  type JobData,
} from "./jobs";
import type { JobResult, WorkOptions } from "pg-boss";

export function createWorkers(
  store: Store,
  options: {
    origin: string;
    directory?: string;
    fetcher?: typeof fetch;
    sendAuthEmail?: SendAuthEmail;
    chats?: ReturnType<typeof createChatRuntime>;
  },
) {
  const providers = createProviders(store, options.fetcher);
  const thumbnails = createThumbnailJobs(store);
  const organization = createOrganization(store, options.fetcher);
  const chats =
    options.chats ??
    (() => {
      const auth = createAuthentication(store, {
        ...options,
        directory: resolve(
          options.directory ?? process.env.DATA_DIR ?? ".data",
        ),
      }).auth;
      return createChatRuntime(
        store,
        providers,
        async () => {
          throw new Error("Worker has no HTTP authentication");
        },
        (token) => authenticateToken(store, auth, token),
      );
    })();
  const localDevelopment =
    process.env.AUTH_LOCAL_DEVELOPMENT === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(options.origin).hostname,
    );
  const sender =
    options.sendAuthEmail ?? createAuthEmailSender(localDevelopment);
  async function failure(
    job: BackgroundJob,
    message: string,
    sourceId = job.id,
    sourceName = job.name,
  ) {
    if (sourceName === queues.thumbnail)
      await store.run(
        "UPDATE resources SET thumbnail_status='failed' WHERE id=? AND thumbnail_job_id=? AND thumbnail_status IN ('queued','processing')",
        job.data.resourceId,
        sourceId,
      );
    if (sourceName === queues.index)
      await store.run(
        "UPDATE resources SET status='failed',error=? WHERE id=? AND index_job_id=? AND status IN ('queued','processing')",
        message,
        job.data.resourceId,
        sourceId,
      );
    if (sourceName === queues.filing)
      await store.run(
        "UPDATE document_filing SET state='failed',error=?,attempt_id=NULL WHERE resource_id=? AND job_id=? AND state IN ('pending','working')",
        message,
        job.data.resourceId,
        sourceId,
      );
    if (sourceName === queues.review)
      await store.run(
        "UPDATE organization_reviews SET state='failed',error=?,attempt_id=NULL WHERE id=? AND job_id=? AND state IN ('pending','working')",
        message,
        job.data.reviewId,
        sourceId,
      );
    if (sourceName === queues.chat)
      await store.run(
        "UPDATE chat_turns SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'failed' END,error=?,error_status=503,attempt_id=NULL WHERE chat_id=? AND job_id=? AND status IN ('retrieving','generating','cancelling')",
        message,
        job.data.chatId,
        sourceId,
      );
  }
  async function reconcile() {
    const schema = store.jobs.schema;
    const message = "The background job is no longer available. Please retry.";
    await store.run(
      `UPDATE resources SET thumbnail_status='failed' WHERE kind='document' AND thumbnail_status IN ('queued','processing') AND NOT EXISTS (SELECT 1 FROM "${schema}".job j WHERE j.name=? AND j.id=resources.thumbnail_job_id AND j.state IN ('created','retry','active'))`,
      queues.thumbnail,
    );
    await store.run(
      `UPDATE resources SET status='failed',error=? WHERE id IN (SELECT r.id FROM resources r WHERE r.status IN ('queued','processing') AND NOT EXISTS (SELECT 1 FROM "${schema}".job j WHERE j.name=? AND j.id=r.index_job_id AND j.state IN ('created','retry','active')) LIMIT 100)`,
      message,
      queues.index,
    );
    await store.run(
      `UPDATE document_filing SET state='failed',error=?,attempt_id=NULL WHERE resource_id IN (SELECT f.resource_id FROM document_filing f JOIN resources r ON r.id=f.resource_id WHERE f.state IN ('pending','working') AND r.status='ready' AND NOT EXISTS (SELECT 1 FROM "${schema}".job j WHERE j.name=? AND j.id=f.job_id AND j.state IN ('created','retry','active')) LIMIT 100)`,
      message,
      queues.filing,
    );
    await store.run(
      `UPDATE organization_reviews SET state='failed',error=?,attempt_id=NULL WHERE id IN (SELECT r.id FROM organization_reviews r WHERE r.state IN ('pending','working') AND NOT EXISTS (SELECT 1 FROM "${schema}".job j WHERE j.name=? AND j.id=r.job_id AND j.state IN ('created','retry','active')) LIMIT 100)`,
      message,
      queues.review,
    );
    await store.run(
      `UPDATE chat_turns SET status=CASE WHEN status='cancelling' THEN 'cancelled' ELSE 'failed' END,error=?,error_status=503,attempt_id=NULL WHERE id IN (SELECT t.id FROM chat_turns t WHERE t.status IN ('retrieving','generating','cancelling') AND NOT EXISTS (SELECT 1 FROM "${schema}".job j WHERE j.name=? AND j.id=t.job_id AND j.state IN ('created','retry','active')) LIMIT 100)`,
      message,
      queues.chat,
    );
    await store.run(
      `UPDATE chat_turns SET status='failed',error=?,error_status=503 WHERE id IN (SELECT t.id FROM chat_turns t WHERE t.status='queued' AND NOT EXISTS (SELECT 1 FROM chat_turns earlier WHERE earlier.chat_id=t.chat_id AND earlier.position<t.position AND earlier.status IN ('failed','cancelled','retrieving','generating','cancelling')) AND NOT EXISTS (SELECT 1 FROM "${schema}".job j WHERE j.name=? AND j.singleton_key=t.chat_id AND j.state IN ('created','retry','active')) LIMIT 100)`,
      message,
      queues.chat,
    );
  }
  const handlers: Record<QueueName, (job: BackgroundJob) => Promise<void>> = {
    [queues.thumbnail]: (job) => thumbnails.process(job),
    [queues.index]: createIndexHandler(store, providers),
    [queues.filing]: organization.process,
    [queues.review]: organization.review,
    [queues.chat]: chats.process,
    [queues.email]: async (job) => {
      if (
        !job.data.encryptedEmail ||
        !job.data.expiresAt ||
        job.data.expiresAt <= Date.now()
      ) {
        await store.jobs.remove(job);
        return;
      }
      const message = JSON.parse(
        store.decrypt(job.data.encryptedEmail),
      ) as AuthEmail;
      const recipient = await store.one<{ email_verified: boolean }>(
        "SELECT email_verified FROM users WHERE email=?",
        message.to,
      );
      if (
        message.kind === "invitation"
          ? !(await store.one(
              "SELECT id FROM invites WHERE id=? AND email=? AND status='pending' AND expires_at>now()",
              message.invitationId,
              message.to,
            ))
          : !recipient ||
            (message.kind === "verification" && recipient.email_verified)
      ) {
        await store.jobs.remove(job);
        return;
      }
      job.signal.throwIfAborted();
      await sender({ ...message, id: job.id });
      await store.jobs.remove(job);
    },
    [queues.cleanup]: async (job) => {
      await store.files.cleanup();
      await store.jobs.complete(job, async () => {
        await store.cleanupPermissions();
        await reconcile();
      });
    },
    [queues.failed]: async (job) => {
      if (job.sourceName === queues.email) {
        await store.jobs.remove(job);
        return;
      }
      await store.jobs.complete(job, async () => {
        await failure(
          job,
          "Background processing could not be completed. Please retry.",
          job.sourceId ?? undefined,
          job.sourceName ?? undefined,
        );
      });
    },
  };
  async function handle(job: BackgroundJob): Promise<JobResult[]> {
    try {
      await handlers[job.name as QueueName](job);
      return [{ id: job.id, status: "completed" }];
    } catch (error) {
      if (error instanceof LostJobClaim)
        return [{ id: job.id, status: "completed" }];
      const message = jobError(error);
      const terminal = permanent(error) || job.retryCount >= job.retryLimit;
      if (terminal && !job.signal.aborted)
        await store.jobs.guard(job, () => failure(job, message));
      return [
        {
          id: job.id,
          status: terminal ? "deadletter" : "failed",
          output: { message },
        },
      ];
    }
  }
  const concurrency: Record<QueueName, number> = {
    [queues.thumbnail]: 1,
    [queues.index]: 2,
    [queues.filing]: 3,
    [queues.review]: 1,
    [queues.chat]: 3,
    [queues.email]: 2,
    [queues.cleanup]: 1,
    [queues.failed]: 1,
  };
  const started = new Set<QueueName>();
  return {
    handle,
    async start(names: QueueName[] = Object.values(queues)) {
      if (names.length) await store.files.ready();
      if (names.includes(queues.thumbnail))
        await enqueueMissingThumbnails(store);
      for (const name of names) {
        if (started.has(name)) continue;
        await store.jobs.boss.work<
          JobData,
          JobResult[],
          WorkOptions & { includeMetadata: true; perJobResults: true }
        >(
          name,
          {
            batchSize: 1,
            includeMetadata: true,
            perJobResults: true,
            localConcurrency: concurrency[name],
            pollingIntervalSeconds: 1,
            notifyPollingIntervalSeconds:
              name === queues.index ? 3 : name === queues.failed ? 1 : 10,
            heartbeatRefreshSeconds: 5,
          },
          async ([job]) => {
            const results = await handle(job);
            for (const worker of store.jobs.boss.getWipData())
              if (worker.name === name) store.jobs.boss.notifyWorker(worker.id);
            return results;
          },
        );
        started.add(name);
      }
    },
    async stop(names: QueueName[]) {
      for (const name of names) {
        await store.jobs.boss.offWork(name);
        started.delete(name);
      }
    },
    async close() {
      await store.jobs.close();
      await chats.close();
      await thumbnails.close();
    },
  };
}
