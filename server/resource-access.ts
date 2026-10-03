import {
  resourceAccessBatch,
  type Actor,
  type Store,
  type PermissionCache,
} from "./db";
import { createLimiter } from "./async";
import { retrievalLimits } from "./jev";
import { bulkPermissionBatchSize } from "./authorization";

const authorizationSlot = createLimiter(
  retrievalLimits.authorizationConcurrency,
);

export function createResourceAccessReader(
  store: Store,
  actor: Actor,
  signal?: AbortSignal,
  cache: PermissionCache = { values: new Map() },
) {
  const pending = new Map<string, Promise<boolean>>();
  const queued = new Map<
    string,
    { resolve: (allowed: boolean) => void; reject: (error: unknown) => void }
  >();

  function flush() {
    const entries = [...queued.entries()];
    queued.clear();
    for (
      let start = 0;
      start < entries.length;
      start += bulkPermissionBatchSize
    ) {
      const batch = entries.slice(start, start + bulkPermissionBatchSize);
      void authorizationSlot(async () => {
        signal?.throwIfAborted();
        const allowed = await resourceAccessBatch(
          store,
          actor,
          batch.map(([id]) => id),
          "read",
          cache,
        );
        signal?.throwIfAborted();
        return allowed;
      }, signal).then(
        (allowed) => {
          for (const [id, { resolve }] of batch) resolve(allowed.has(id));
        },
        (error) => {
          for (const [, { reject }] of batch) reject(error);
        },
      );
    }
  }

  return function canRead(id: string) {
    const existing = pending.get(id);
    if (existing) return existing;
    const check = new Promise<boolean>((resolve, reject) => {
      if (!queued.size) queueMicrotask(flush);
      queued.set(id, { resolve, reject });
    }).finally(() => pending.delete(id));
    pending.set(id, check);
    return check;
  };
}
