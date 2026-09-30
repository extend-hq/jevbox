import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createStore, type Store } from "../server/db";
import { createWorkers } from "../server/workers";
import { enqueueIndex } from "../server/indexing-jobs";
import { queues, LostJobClaim, type BackgroundJob } from "../server/jobs";
import { testDatabase } from "./database";

let database: Awaited<ReturnType<typeof testDatabase>>;
let store: Store, second: Store;
let directory: string;
let user: string, org: string;
let workers: ReturnType<typeof createWorkers>,
  otherWorkers: ReturnType<typeof createWorkers>;
let mode = "ready",
  submits = 0,
  polls = 0,
  emailAttempts = 0;
let release: (() => void) | undefined;
let entered: (() => void) | undefined;
const delivered: string[] = [];
const fetcher: typeof fetch = async (url) => {
  if (String(url).endsWith("/files/upload"))
    return Response.json({ id: "uploaded" });
  if (String(url).endsWith("/parse_runs")) {
    submits++;
    if (mode === "ambiguous")
      throw new Error("Connection lost after acceptance");
    return Response.json({ id: "confirmed-run" });
  }
  if (String(url).includes("/parse_runs/")) {
    polls++;
    if (mode === "transient" && polls === 1)
      return new Response("", { status: 503 });
    if (mode === "pending") return Response.json({ status: "PROCESSING" });
    if (mode === "held") {
      entered?.();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return Response.json({
      status: "PROCESSED",
      output: { chunks: [{ content: "Indexed content" }] },
    });
  }
  throw new Error("Unexpected provider request");
};
async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  timeout = 10_000,
) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Background job did not reach the expected state");
}
async function document(mime = "text/plain") {
  const id = randomUUID();
  await store.transaction(async () => {
    await store.run(
      "INSERT INTO resources(id,org_id,owner_id,kind,name,mime,status,created) VALUES(?,?,?,'document','Document',?,'queued',?)",
      id,
      org,
      user,
      mime,
      new Date().toISOString(),
    );
    await store.run(
      "INSERT INTO blobs VALUES(?,?)",
      id,
      Buffer.from("Indexed content"),
    );
    await store.run("INSERT INTO document_filing(resource_id) VALUES(?)", id);
    await enqueueIndex(store, id);
  });
  return id;
}
const resource = (id: string) =>
  store.one<any>("SELECT * FROM resources WHERE id=?", id);
before(async () => {
  database = await testDatabase();
  directory = mkdtempSync(join(tmpdir(), "jevbox-jobs-"));
  store = await createStore(directory, database.url);
  second = await createStore(directory, database.url);
  assert.equal((await store.jobs.boss.getSchedules(queues.cleanup)).length, 1);
  await store.jobs.boss.unschedule(queues.cleanup);
  await store.jobs.boss.deleteQueuedJobs(queues.cleanup);
  user = randomUUID();
  org = randomUUID();
  await store.transaction(async () => {
    await store.run(
      "INSERT INTO users(id,email,name,email_verified) VALUES(?,'jobs@local.test','Account',true)",
      user,
    );
    await store.run(
      "INSERT INTO orgs(id,name,settings) VALUES(?,'Workspace',?)",
      org,
      store.encrypt(
        JSON.stringify({ extendKey: "test", organization: { enabled: false } }),
      ),
    );
    await store.run("INSERT INTO members VALUES(?,?,'admin')", org, user);
  });
  const sendAuthEmail = async (message: { id?: string }) => {
    emailAttempts++;
    if (emailAttempts === 1) throw new Error("SMTP is temporarily unavailable");
    delivered.push(message.id!);
  };
  workers = createWorkers(store, {
    origin: "http://localhost:4310",
    fetcher,
    sendAuthEmail,
  });
  otherWorkers = createWorkers(second, {
    origin: "http://localhost:4310",
    fetcher,
    sendAuthEmail,
  });
  await store.jobs.boss.updateQueue(queues.index, {
    retryDelay: 0,
    retryBackoff: false,
  });
  await store.jobs.boss.updateQueue(queues.email, {
    retryDelay: 0,
    retryBackoff: false,
  });
});
after(async () => {
  release?.();
  await workers?.close();
  await otherWorkers?.close();
  await second?.close();
  await database?.cleanup(store);
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("admission rolls back with domain changes", async () => {
  const id = randomUUID();
  await assert.rejects(
    store.transaction(async () => {
      await store.run(
        "INSERT INTO resources(id,org_id,owner_id,kind,name,status,created) VALUES(?,?,?,'document','Document','queued',?)",
        id,
        org,
        user,
        new Date().toISOString(),
      );
      await enqueueIndex(store, id);
      throw new Error("Rollback");
    }),
  );
  assert.equal(await resource(id), undefined);
  assert.equal(
    (await store.jobs.boss.findJobs(queues.index, { data: { resourceId: id } }))
      .length,
    0,
  );
});

test("separate consumers claim each document once and drain a backlog", async () => {
  const ids = await Promise.all(Array.from({ length: 16 }, () => document()));
  await workers.start([queues.index, queues.filing, queues.failed]);
  await otherWorkers.start([queues.index, queues.filing, queues.failed]);
  await waitFor(
    () =>
      store.all<{ id: string }>(
        "SELECT id FROM resources WHERE id=ANY(?::text[]) AND status='ready'",
        ids,
      ),
    (rows) => rows.length === ids.length,
  );
  const jobs = await store.jobs.boss.findJobs(queues.index);
  for (const id of ids) {
    const matching = jobs.filter(
      (job) => job.data && (job.data as any).resourceId === id,
    );
    assert.equal(matching.length, 1);
    assert.equal(matching[0].state, "completed");
    assert.equal(matching[0].retryCount, 0);
  }
  await workers.stop([queues.index]);
  await otherWorkers.stop([queues.index]);
});

test("an abruptly killed consumer is recovered and its old attempt cannot commit", async () => {
  const id = await document();
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import { PgBoss } from 'pg-boss';
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: process.env.JOB_SCHEMA, max: 2 });
    boss.on('error', () => {});
    await boss.start();
    await boss.supervise('document-index');
    await boss.work('document-index', { includeMetadata: true }, async ([job]) => {
      process.stdout.write(job.id + '\\n');
      await new Promise(() => {});
    });
  `,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: database.url,
        JOB_SCHEMA: store.jobs.schema,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  try {
    const jobId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Consumer did not claim the job")),
        10_000,
      );
      child.stdout.once("data", (chunk) => {
        clearTimeout(timer);
        resolve(String(chunk).trim());
      });
      child.once("error", reject);
    });
    const old = (
      await store.jobs.boss.findJobs(queues.index, { id: jobId })
    )[0] as BackgroundJob;
    assert.equal(old.retryDelay, 0);
    assert.equal(old.retryBackoff, false);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    await store.db.query(
      `UPDATE "${store.jobs.schema}".job SET started_on=now()-interval '1 hour',heartbeat_on=now()-interval '1 hour' WHERE name=$1 AND id=$2`,
      [queues.index, jobId],
    );
    await store.jobs.boss.supervise();
    await workers.start([queues.index]);
    await waitFor(
      () => resource(id),
      (row) => row.status === "ready",
      45_000,
    );
    const current = (
      await store.jobs.boss.findJobs(queues.index, { id: jobId })
    )[0];
    assert.equal(current.retryCount, 1);
    await assert.rejects(
      store.jobs.guard({ ...old, signal: new AbortController().signal }, () =>
        store.run("UPDATE resources SET error='stale' WHERE id=?", id),
      ),
      LostJobClaim,
    );
    assert.equal((await resource(id)).error, null);
  } finally {
    child.kill("SIGKILL");
    await workers.stop([queues.index]);
  }
});

test("transient polling failures resume the confirmed parse instead of submitting another", async () => {
  mode = "transient";
  submits = polls = 0;
  const id = await document("application/pdf");
  await workers.start([queues.index]);
  await waitFor(
    () => resource(id),
    (row) => row.status === "ready",
  );
  assert.equal(submits, 1);
  assert.equal(polls, 2);
  assert.equal((await resource(id)).parse_run, "confirmed-run");
  await workers.stop([queues.index]);
});

test("pending parses defer their next poll and release the worker", async () => {
  mode = "pending";
  submits = polls = 0;
  const id = await document("application/pdf");
  await workers.start([queues.index]);
  await waitFor(
    () => store.jobs.boss.findJobs(queues.index, { data: { resourceId: id } }),
    (jobs) =>
      jobs.some(
        (job) => job.state === "created" && job.startAfter > new Date(),
      ),
  );
  await workers.stop([queues.index]);
  assert.equal(submits, 1);
  assert.equal((await resource(id)).status, "processing");
  const jobs = await store.jobs.boss.findJobs(queues.index, {
    data: { resourceId: id },
  });
  assert.equal(
    jobs.some((job) => job.state === "active"),
    false,
  );
  mode = "ready";
  await workers.start([queues.index]);
  await waitFor(
    () => resource(id),
    (row) => row.status === "ready",
  );
  assert.equal(submits, 1);
  await workers.stop([queues.index]);
});

test("an ambiguous parse submission fails closed without another paid request", async () => {
  mode = "ambiguous";
  submits = polls = 0;
  const id = await document("application/pdf");
  await workers.start([queues.index]);
  await waitFor(
    () => resource(id),
    (row) => row.status === "failed",
  );
  assert.equal(submits, 1);
  assert.match((await resource(id)).error, /before confirmation/);
  await workers.stop([queues.index]);
});

test("domain publication and queue completion roll back together", async () => {
  const id = await document();
  const [fetched] = await store.jobs.boss.fetch(queues.index, {
    includeMetadata: true,
  });
  const job = {
    ...fetched,
    signal: new AbortController().signal,
  } as BackgroundJob;
  assert.equal(job.data.resourceId, id);
  await assert.rejects(
    store.jobs.complete(job, async () => {
      await store.run("UPDATE resources SET status='ready' WHERE id=?", id);
      throw new Error("Rollback completion");
    }),
  );
  assert.equal((await resource(id)).status, "queued");
  assert.equal(
    (await store.jobs.boss.findJobs(queues.index, { id: job.id }))[0].state,
    "active",
  );
  await store.jobs.complete(job, async () => {
    await store.run("UPDATE resources SET status='ready' WHERE id=?", id);
  });
  assert.equal(
    (await store.jobs.boss.findJobs(queues.index, { id: job.id }))[0].state,
    "completed",
  );
});

test("a cancelled provider attempt cannot overwrite its replacement", async () => {
  mode = "held";
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const id = await document("application/pdf");
  await workers.start([queues.index]);
  try {
    await Promise.race([
      waiting,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Provider did not start")),
          10_000,
        ).unref(),
      ),
    ]);
    const unblock = release!;
    const originalId = (await resource(id)).index_job_id;
    mode = "ready";
    const replacementId = await store.transaction(async () => {
      await store.jobs.cancel(queues.index, originalId);
      return enqueueIndex(store, id);
    });
    await waitFor(
      () => resource(id),
      (row) => row.status === "ready",
    );
    unblock();
    await workers.stop([queues.index]);
    const current = await resource(id);
    assert.equal(current.index_job_id, replacementId);
    assert.equal(current.error, null);
    assert.equal(
      (await store.jobs.boss.findJobs(queues.index, { id: originalId }))[0]
        .state,
      "cancelled",
    );
    assert.equal(
      (await store.jobs.boss.findJobs(queues.index, { id: replacementId }))[0]
        .state,
      "completed",
    );
  } finally {
    release?.();
    entered = release = undefined;
    await workers.stop([queues.index]);
  }
});

test("expiration during permission publication rolls back the entire completion", async () => {
  const id = await document();
  await store.jobs.cancel(queues.index, (await resource(id)).index_job_id);
  const jobId = await store.jobs.boss.send(
    queues.index,
    { resourceId: id },
    { singletonKey: id, expireInSeconds: 1 },
  );
  await store.run("UPDATE resources SET index_job_id=? WHERE id=?", jobId, id);
  const [fetched] = await store.jobs.boss.fetch(queues.index, {
    includeMetadata: true,
  });
  const job = {
    ...fetched,
    signal: new AbortController().signal,
  } as BackgroundJob;
  const publish = store.authorization.write;
  store.authorization.write = async (...args) => {
    await publish(...args);
    await new Promise((resolve) => setTimeout(resolve, 1100));
  };
  try {
    await assert.rejects(
      store.jobs.complete(job, async () => {
        await store.run(
          "UPDATE resources SET status='ready',access='organization' WHERE id=?",
          id,
        );
      }),
      LostJobClaim,
    );
    const current = await resource(id);
    assert.equal(current.status, "queued");
    assert.equal(current.access, "restricted");
    assert.notEqual(
      (await store.jobs.boss.findJobs(queues.index, { id: jobId! }))[0].state,
      "completed",
    );
  } finally {
    store.authorization.write = publish;
    await store.jobs.cancel(queues.index, jobId!);
  }
});

test("scheduled cleanup fails removed jobs without repeating external work", async () => {
  const id = await document("application/pdf");
  const jobId = (await resource(id)).index_job_id;
  await store.jobs.boss.deleteJob(queues.index, jobId);
  const requests = submits;
  const cleanupId = await store.jobs.send(queues.cleanup, {});
  await workers.start([queues.cleanup]);
  await waitFor(
    () => resource(id),
    (row) => row.status === "failed",
  );
  assert.match((await resource(id)).error, /no longer available/);
  assert.equal(submits, requests);
  await waitFor(
    () => store.jobs.boss.findJobs(queues.cleanup, { id: cleanupId }),
    (jobs) => jobs[0]?.state === "completed",
  );
  await workers.stop([queues.cleanup]);
});

test("revoked ownership access prevents provider submission", async () => {
  mode = "ready";
  submits = polls = 0;
  const id = await document("application/pdf");
  await store.run(
    "DELETE FROM members WHERE org_id=? AND user_id=?",
    org,
    user,
  );
  await workers.start([queues.index]);
  await waitFor(
    () => resource(id),
    (row) => row.status === "failed",
  );
  assert.equal(submits, 0);
  assert.equal(polls, 0);
  await workers.stop([queues.index]);
  await store.run("INSERT INTO members VALUES(?,?,'admin')", org, user);
});

test("encrypted email delivery survives retries, keeps its identity, and purges success", async () => {
  await store.jobs.email({
    to: "jobs@local.test",
    kind: "password-reset",
    url: "http://localhost:4310/reset-password?token=secret-token",
  });
  const queued = (await store.jobs.boss.findJobs(queues.email))[0];
  assert.ok(queued);
  assert.equal(JSON.stringify(queued.data).includes("secret-token"), false);
  await workers.start([queues.email]);
  await otherWorkers.start([queues.email]);
  await waitFor(
    async () => delivered,
    (ids) => ids.length === 1,
  );
  assert.equal(emailAttempts, 2);
  assert.equal(delivered[0], queued.id);
  await waitFor(
    () => store.jobs.boss.findJobs(queues.email, { id: queued.id }),
    (jobs) => jobs.length === 0,
  );
  await workers.stop([queues.email]);
  await otherWorkers.stop([queues.email]);
  const id = await store.jobs.send(queues.email, {
    encryptedEmail: store.encrypt(
      JSON.stringify({
        to: "jobs@local.test",
        kind: "password-reset",
        url: "expired",
      }),
    ),
    expiresAt: Date.now() - 1,
  });
  await workers.start([queues.email]);
  await waitFor(
    () => store.jobs.boss.findJobs(queues.email, { id }),
    (jobs) => jobs.length === 0,
  );
  assert.equal(emailAttempts, 2);
  await workers.stop([queues.email]);
});
