# Background jobs

pg-boss 12.35.0 owns delivery, claiming, heartbeats, retries, expiration, scheduling, and queue maintenance. Domain tables retain user-visible indexing, filing, review, and chat state. There are no application timers scanning those tables for runnable jobs.

## Admission and completion

Uploads, retries, filing requests, review events, and chat edits enqueue work through the current PostgreSQL transaction. A rolled-back mutation cannot leave a runnable job. Queue payloads contain identifiers, not document bytes, prompts, provider credentials, or session tokens. Authentication email payloads are encrypted with the application encryption key.

Workers use `work()` with one job per batch, explicit local concurrency, automatic heartbeats, and the job's abort signal. External requests happen outside transactions. Short checkpoint and completion transactions lock the queue row and verify its attempt number, active state, and deadline. Completion and domain changes commit together. A stale or cancelled attempt cannot publish a result. These transactions also retain the application's mandatory SpiceDB checks.

The singleton policy serializes active jobs for each document or conversation across worker processes. Chat jobs wake a conversation; the handler reads its current ordered turns. This preserves queued editing, drag reordering, failed-turn blocking, and cancellation. A generation interrupted by process loss becomes a visible failure requiring explicit retry. Queue recovery does not silently repeat a started model answer.

## Retries and external effects

Transient failures retry with jittered exponential backoff, a five-second initial delay, and a five-minute cap. Permanent validation, access, and provider configuration failures go directly to the dead-letter queue. A dead-letter consumer reconciles domain failures after a crash or exhausted retries. Queue errors and persisted job outputs omit provider bodies, credentials, and email links.

Remote parsing checkpoints the confirmed run ID. Pending runs enqueue a deferred poll and release their worker slot, with a thirty-minute overall polling bound. A marker commits before starting a remote parse. If the process loses confirmation after submission, recovery fails closed and asks for an explicit retry instead of automatically submitting another paid run. A confirmed pending run resumes on retry. Provider uploads or requests can still have uncertain external outcomes; PostgreSQL transactions do not make remote effects exactly once.

SMTP delivery retries until the one-hour link deadline. Verified accounts do not receive queued verification mail. Successful email jobs are deleted, and failure copies are purged by the dead-letter consumer; encrypted originals expire after one hour. A stable Message-ID is reused on retries, but SMTP can deliver a duplicate after an ambiguous acceptance. Never claim exactly-once email delivery.

## Capacity and operations

Per worker process: indexing 2, filing 3, reviews 1, chat 3, email 2, cleanup 1, and dead-letter reconciliation 1. These are local limits; adding replicas increases total provider traffic. Singleton keys provide entity serialization, not an organization-wide spend limit.

LISTEN/NOTIFY wakes consumers after commit; polling remains a recovery mechanism and dispatches deferred jobs. After settlement, consumers wake their queue to drain existing backlogs without waiting for the idle interval. Permission cleanup is scheduled once per minute through pg-boss. pg-boss coordinates supervision and prunes stored jobs; completed document jobs are retained for one day. Its index and vacuum monitoring remain enabled.

Use `pnpm worker` for a production worker. `pnpm dev` embeds consumers. All instances must share the same encryption key and database. Shut down consumers before database pools; allow thirty seconds to drain and a forty-second process cap. The API continues to use a single replica because its general request limits are still in memory.

The implementation follows the official [worker lifecycle and transaction guidance](https://pgboss.io/api/workers), [queue policies, heartbeat, and expiration guidance](https://pgboss.io/api/queues), and [transaction adapters and job APIs](https://pgboss.io/api/jobs). The optional pg-boss dashboard is not exposed by the application; queue operators can use the library APIs against the private database.
