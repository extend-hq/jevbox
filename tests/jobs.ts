import type { createApp } from "../server/app";
import { queues, type QueueName } from "../server/jobs";

type Runtime = Awaited<ReturnType<typeof createApp>>;
const documents = [queues.index, queues.filing, queues.review, queues.failed];
export async function waitForJobs(
  runtime: Runtime,
  names: QueueName[],
  timeout = 30_000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await runtime.store.db.query(
      `SELECT id FROM "${runtime.store.jobs.schema}".job WHERE name=ANY($1::text[]) AND state IN ('created','retry','active') LIMIT 1`,
      [names],
    );
    if (!result.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for background jobs");
}
export async function runJobs(
  runtime: Runtime,
  names: QueueName[] = documents,
) {
  await runtime.workers.start(names);
  try {
    await waitForJobs(runtime, names);
  } finally {
    await runtime.workers.stop(names);
  }
}
