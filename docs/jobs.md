# Background jobs

pg-boss 12.35.0 owns delivery, claiming, heartbeats, retries, expiration, scheduling, and queue maintenance. Domain tables retain user-visible indexing, filing, review, chat, and external run state. There are no application timers scanning those tables for runnable jobs.

## Admission and completion

Uploads, retries, filing requests, review events, and chat edits enqueue work through the current PostgreSQL transaction. A rolled-back mutation cannot leave a runnable job. Queue payloads contain identifiers, not document bytes, prompts, provider credentials, or session tokens. Authentication email payloads are encrypted with the application encryption key.

Workers use `work()` with one job per batch, explicit local concurrency, automatic heartbeats, and the job's abort signal. External requests happen outside transactions. Short checkpoint and completion transactions lock the queue row and verify its attempt number, active state, and deadline. Completion and domain changes commit together. A stale or cancelled attempt cannot publish a result. These transactions also retain the application's mandatory SpiceDB checks.

The singleton policy serializes active jobs for each document or conversation across worker processes. Chat jobs wake a conversation; the handler reads its current ordered turns. This preserves queued editing, drag reordering, failed-turn blocking, and cancellation. A generation interrupted by process loss becomes a visible failure requiring explicit retry. Queue recovery does not silently repeat a started model answer.

MCP searches use the `external-search` queue; MCP answers use `chat-answer` and save ordinary private conversations. Run admission, encrypted authorization references, and job creation commit together. A caller-provided request UUID deduplicates admission for 24 hours. Client disconnect signals affect only waiting for a reply, while worker execution follows its job claim and explicit cancellation. Workers recheck live credentials or OAuth consent, membership, and source access; result reads also enforce current permissions. See [durable MCP work](api-access.md#durable-search-and-answers).

## Retries and external effects

Transient failures retry with jittered exponential backoff, a five-second initial delay, and a five-minute cap. Permanent validation, access, and provider configuration failures go directly to the dead-letter queue. A dead-letter consumer reconciles domain failures after a crash or exhausted retries. Scheduled cleanup marks unfinished domain records as failed if their jobs were removed or expired while queued; it does not silently restart paid work. Queue errors and persisted job outputs omit provider bodies, credentials, and email links.

Remote parsing checkpoints the confirmed run ID. Pending runs enqueue a deferred poll and release their worker slot, with a thirty-minute overall polling bound. A marker commits before starting a remote parse. If the process loses confirmation after submission, recovery fails closed and asks for an explicit retry instead of automatically submitting another paid run. A confirmed pending run resumes on retry. Provider uploads or requests can still have uncertain external outcomes; PostgreSQL transactions do not make remote effects exactly once.

SMTP delivery has six retries with a one-hour link deadline. Verified accounts do not receive queued verification mail. Successful and obsolete email jobs are deleted, and failure copies are purged by the dead-letter consumer; encrypted originals expire after one hour. A stable Message-ID is reused on retries, but SMTP can deliver a duplicate after an ambiguous acceptance. Never claim exactly-once email delivery.

## Capacity and operations

Per worker process: indexing 2, thumbnails 1, filing 3, reviews 1, chat 3, external search 3, email 2, cleanup 1, and dead-letter reconciliation 1. These are local limits; adding replicas increases total provider traffic. Singleton keys provide entity serialization, not an organization-wide spend limit.

Thumbnail jobs are admitted in the upload transaction and run independently of indexing. Starting a thumbnail consumer queues existing documents whose thumbnail state is pending. Covers for PDF, DOCX, PPTX, and XLSX render in Chromium's headless shell; images, bounded text previews, and ZIP directory previews use sharp. The worker stores WebP bytes and dimensions in PostgreSQL, with a maximum dimension of 256 pixels and a 128 KiB output limit. Native images are auto-oriented and use only the first frame. Failed generation retains the original document and does not change its indexing state.

One browser is reused within each worker process. Each document gets a fresh browser context, external network and WebSocket requests are blocked, and rendering has a sixty-second timeout. The browser closes after sixty seconds without document rendering. Publication verifies the current job claim and the owner's permission again. Thumbnail endpoints require current document access before returning either image bytes or a conditional 304 response; private caches must revalidate.

Application transactions already serialize under the permission-publication advisory lock. Each process queues those transactions before checking out a connection, so waiting mutations do not occupy every pool slot and starve reads. Pool limits remain small; provider calls do not hold database connections.

LISTEN/NOTIFY wakes consumers after commit; polling remains a recovery mechanism and dispatches deferred jobs. After settlement, consumers wake their queue to drain existing backlogs without waiting for the idle interval. Permission cleanup is scheduled once per minute through pg-boss. pg-boss coordinates supervision and prunes stored jobs; completed document jobs are retained for one day. Its index and vacuum monitoring remain enabled.

Queue monitors run every fifteen seconds and workers refresh thirty-second heartbeats every five seconds. Crash recovery waits for the heartbeat or execution deadline, the next monitor pass, and the configured retry delay; it is not instantaneous. Monitoring and pruning remain coordinated across processes.

Use `pnpm worker` for a production worker. `pnpm dev` embeds consumers. All instances must share the same encryption key and database. Shut down consumers before database pools; allow thirty seconds to drain and a forty-second process cap. The API continues to use a single replica because its general request limits are still in memory.

The implementation follows the official [worker lifecycle and transaction guidance](https://pgboss.io/api/workers), [queue policies, heartbeat, and expiration guidance](https://pgboss.io/api/queues), and [transaction adapters and job APIs](https://pgboss.io/api/jobs). The optional pg-boss dashboard is not exposed by the application; queue operators can use the library APIs against the private database.
