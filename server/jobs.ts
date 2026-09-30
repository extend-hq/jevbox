import { randomUUID } from "node:crypto";
import { PgBoss, type Db, type JobWithMetadata, type Queue } from "pg-boss";
import { HttpError } from "./errors";
import type { AuthEmail } from "./auth-email";

export const queues = {
  index: "document-index",
  filing: "document-filing",
  review: "organization-review",
  chat: "chat-answer",
  email: "auth-email",
  cleanup: "permission-cleanup",
  failed: "jobs-failed",
} as const;
export type QueueName = (typeof queues)[keyof typeof queues];
export type JobData = {
  resourceId?: string;
  reviewId?: string;
  chatId?: string;
  encryptedEmail?: string;
  expiresAt?: number;
  startedAt?: number;
  poll?: number;
};
export type BackgroundJob = JobWithMetadata<JobData>;
export class PermanentJobError extends Error {}
export class LostJobClaim extends Error {}
export function jobError(error: unknown) {
  return error instanceof HttpError || error instanceof PermanentJobError
    ? error.message
    : "Background processing was interrupted. Please retry.";
}
export function permanent(error: unknown) {
  return (
    error instanceof PermanentJobError ||
    (error instanceof HttpError && "retryable" in error && error.retryable === false) ||
    (error instanceof HttpError && error.status < 500 && error.status !== 429)
  );
}

export async function createJobs(options: {
  databaseUrl: string;
  schema: string;
  db: Db;
  transaction: <T>(fn: () => Promise<T>) => Promise<T>;
  encrypt: (text: string) => string;
}) {
  const schema =
    options.schema === "public" ? "pgboss" : `${options.schema}_jobs`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw new Error("Invalid job schema");
  const boss = new PgBoss({
    connectionString: options.databaseUrl,
    schema,
    max: 3,
    connectionTimeoutMillis: 5000,
    application_name: "jevbox-jobs",
    useListenNotify: true,
    superviseIntervalSeconds: 5,
    persistWarnings: true,
    warningRetentionDays: 7,
  });
  boss.on("error", () => console.error("Background queue is unavailable"));
  boss.on("warning", () =>
    console.warn("Background queue maintenance warning"),
  );
  try {
    await boss.start();
    const defaults = {
      retryLimit: 4,
      retryDelay: 5,
      retryBackoff: true,
      retryDelayMax: 300,
      heartbeatSeconds: 30,
      expireInSeconds: 120,
      retentionSeconds: 86400,
      deleteAfterSeconds: 86400,
      notify: true,
    };
    const configurations: Record<QueueName, Omit<Queue, "name">> = {
      [queues.failed]: { ...defaults, retryLimit: 10, expireInSeconds: 60 },
      [queues.index]: {
        ...defaults,
        policy: "singleton",
        expireInSeconds: 180,
        deadLetter: queues.failed,
      },
      [queues.filing]: {
        ...defaults,
        policy: "singleton",
        deadLetter: queues.failed,
      },
      [queues.review]: {
        ...defaults,
        policy: "singleton",
        deadLetter: queues.failed,
      },
      [queues.chat]: {
        ...defaults,
        policy: "singleton",
        retryLimit: 2,
        expireInSeconds: 300,
        deadLetter: queues.failed,
      },
      [queues.email]: {
        ...defaults,
        retryLimit: 6,
        expireInSeconds: 90,
        retentionSeconds: 3600,
        deleteAfterSeconds: 3600,
        deadLetter: queues.failed,
      },
      [queues.cleanup]: {
        ...defaults,
        policy: "exclusive",
        expireInSeconds: 120,
      },
    };
    for (const [name, configuration] of Object.entries(configurations)) {
      await boss.createQueue(name, configuration);
      const { policy: _policy, ...settings } = configuration;
      await boss.updateQueue(name, settings);
    }
    await boss.schedule(queues.cleanup, "* * * * *", {}, { tz: "UTC" });
  } catch (error) {
    await boss.stop({ graceful: false }).catch(() => {});
    throw error;
  }
  async function send(name: QueueName, data: JobData, key?: string, delay = 0) {
    return options.transaction(async () => {
      const id = await boss.send(name, data, {
        id: randomUUID(),
        ...(key ? { singletonKey: key } : {}),
        startAfter: delay,
        db: options.db,
      });
      if (!id) throw new Error("Background job could not be queued");
      return id;
    });
  }
  async function guard<T>(job: BackgroundJob, fn: () => Promise<T>) {
    return options.transaction(async () => {
      job.signal.throwIfAborted();
      const result = await options.db.executeSql(
        `SELECT id FROM "${schema}".job WHERE name=$1 AND id=$2 AND state='active' AND retry_count=$3 AND started_on + make_interval(secs => expire_seconds) > clock_timestamp() FOR UPDATE`,
        [job.name, job.id, job.retryCount],
      );
      if (!result.rows.length) throw new LostJobClaim("Job claim expired");
      return fn();
    });
  }
  return {
    boss,
    schema,
    send,
    guard,
    async complete(job: BackgroundJob, fn: () => Promise<void>) {
      await guard(job, async () => {
        await fn();
        await boss.complete(job.name, job, undefined, { db: options.db });
      });
    },
    async cancel(name: QueueName, id: string) {
      await options.transaction(() =>
        boss.cancel(name, id, { db: options.db }),
      );
    },
    async email(message: AuthEmail) {
      await send(queues.email, {
        encryptedEmail: options.encrypt(JSON.stringify(message)),
        expiresAt: Date.now() + 3600_000,
      });
    },
    async ready() {
      await boss.getQueue(queues.index);
    },
    close: () => boss.stop({ graceful: true, timeout: 30_000 }),
  };
}
export type Jobs = Awaited<ReturnType<typeof createJobs>>;
