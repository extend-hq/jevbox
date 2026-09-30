import { createOrganization } from "./organization";
import { createIndexHandler } from "./indexing-jobs";
import { createProviders } from "./providers";
import { createChatRuntime } from "./chat";
import { authenticateToken } from "./sessions";
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
    fetcher?: typeof fetch;
    sendAuthEmail?: SendAuthEmail;
    chats?: ReturnType<typeof createChatRuntime>;
  },
) {
  const providers = createProviders(store, options.fetcher);
  const organization = createOrganization(store, options.fetcher);
  const chats =
    options.chats ??
    createChatRuntime(
      store,
      providers,
      async () => {
        throw new Error("Worker has no HTTP authentication");
      },
      (token) => authenticateToken(store, token),
    );
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
  const handlers: Record<QueueName, (job: BackgroundJob) => Promise<void>> = {
    [queues.index]: createIndexHandler(store, providers),
    [queues.filing]: organization.process,
    [queues.review]: organization.review,
    [queues.chat]: chats.process,
    [queues.email]: async (job) => {
      if (
        !job.data.encryptedEmail ||
        !job.data.expiresAt ||
        job.data.expiresAt <= Date.now()
      )
        return;
      const message = JSON.parse(
        store.decrypt(job.data.encryptedEmail),
      ) as AuthEmail;
      const recipient = await store.one<{ email_verified: boolean }>(
        "SELECT email_verified FROM users WHERE email=?",
        message.to,
      );
      if (
        !recipient ||
        (message.kind === "verification" && recipient.email_verified)
      )
        return;
      job.signal.throwIfAborted();
      await sender({ ...message, id: job.id });
      await store.jobs.complete(job, async () => {});
      await store.jobs.boss.deleteJob(queues.email, job);
    },
    [queues.cleanup]: async (job) =>
      store.jobs.complete(job, () => store.cleanupPermissions()),
    [queues.failed]: async (job) => {
      await store.jobs.complete(job, async () => {
        await failure(
          job,
          "Background processing could not be completed. Please retry.",
          job.sourceId ?? undefined,
          job.sourceName ?? undefined,
        );
      });
      if (job.sourceName === queues.email)
        await store.jobs.boss.deleteJob(queues.failed, job);
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
      for (const name of names) {
        if (started.has(name)) continue;
        await store.jobs.boss.work<JobData, JobResult[], WorkOptions & { includeMetadata: true; perJobResults: true }>(
          name,
          {
            batchSize: 1,
            includeMetadata: true,
            perJobResults: true,
            localConcurrency: concurrency[name],
            pollingIntervalSeconds: 1,
            notifyPollingIntervalSeconds: name === queues.index ? 3 : name === queues.failed ? 1 : 10,
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
    },
  };
}
