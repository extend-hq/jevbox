export async function asyncFilter<T>(
  items: T[],
  predicate: (item: T, index: number) => Promise<unknown>,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < items.length; i++)
    if (await predicate(items[i], i)) results.push(items[i]);
  return results;
}
export async function asyncEvery<T>(
  items: T[],
  predicate: (item: T) => Promise<unknown>,
): Promise<boolean> {
  for (const item of items) if (!(await predicate(item))) return false;
  return true;
}
export async function asyncSome<T>(
  items: T[],
  predicate: (item: T) => Promise<unknown>,
): Promise<boolean> {
  for (const item of items) if (await predicate(item)) return true;
  return false;
}

export function createLimiter(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function limited<T>(
    task: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (running >= limit)
      await new Promise<void>((resolve, reject) => {
        const next = () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const index = waiting.indexOf(next);
          if (index !== -1) {
            waiting.splice(index, 1);
            reject(signal!.reason);
          }
        };
        waiting.push(next);
        signal?.addEventListener("abort", abort, { once: true });
      });
    else running++;
    try {
      signal?.throwIfAborted();
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}
