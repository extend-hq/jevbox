export type ThumbnailCandidate = {
  path: string;
  visible: boolean;
  focused: boolean;
  pixels: number;
  distance: number;
};

export function smallThumbnailCandidates(
  candidates: Omit<ThumbnailCandidate, "pixels">[],
  attempted: ReadonlySet<string>,
  pending: ReadonlySet<string>,
) {
  return candidates
    .filter((item) => !attempted.has(item.path) && !pending.has(item.path))
    .sort(
      (a, b) =>
        Number(b.focused) - Number(a.focused) ||
        Number(b.visible) - Number(a.visible) ||
        a.distance - b.distance,
    )
    .map((item) => item.path);
}

export function detailThumbnailCandidates(candidates: ThumbnailCandidate[]) {
  return candidates
    .filter((item) => item.visible && (item.focused || item.pixels >= 320))
    .sort(
      (a, b) =>
        Number(b.focused) - Number(a.focused) ||
        b.pixels - a.pixels ||
        a.distance - b.distance,
    )
    .slice(0, 3)
    .map((item) => item.path);
}

export function createDetailThumbnailQueue<T>({
  load,
  apply,
  dispose,
  capacity = 6,
  delay = 250,
}: {
  load: (path: string, signal: AbortSignal) => Promise<T | null>;
  apply: (path: string, value: T | null) => void;
  dispose: (value: T) => void;
  capacity?: number;
  delay?: number;
}) {
  const cache = new Map<string, T>();
  const failed = new Set<string>();
  let desired: string[] = [];
  let active: { path: string; controller: AbortController } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(pump, delay);
  }
  function pump() {
    if (closed || active) return;
    const path = desired.find((key) => !cache.has(key) && !failed.has(key));
    if (!path) return;
    const controller = new AbortController();
    active = { path, controller };
    void Promise.resolve()
      .then(() => load(path, controller.signal))
      .then((value) => {
        if (!value) {
          if (!controller.signal.aborted) failed.add(path);
          return;
        }
        if (closed || controller.signal.aborted || !desired.includes(path)) {
          dispose(value);
          return;
        }
        cache.set(path, value);
        apply(path, value);
        while (cache.size > capacity) {
          const oldest = [...cache.keys()].find(
            (key) => !desired.includes(key),
          );
          if (!oldest) break;
          const previous = cache.get(oldest)!;
          cache.delete(oldest);
          dispose(previous);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) failed.add(path);
      })
      .finally(() => {
        active = null;
        if (!closed) schedule();
      });
  }

  return {
    update(paths: string[]) {
      if (closed) return;
      const next = [...new Set(paths)].slice(0, capacity);
      if (next.join("\0") === desired.join("\0")) return;
      for (const path of desired) {
        if (!next.includes(path)) {
          apply(path, null);
          failed.delete(path);
        }
      }
      desired = next;
      if (active && !desired.includes(active.path)) active.controller.abort();
      for (const path of desired) {
        const value = cache.get(path);
        if (value) {
          cache.delete(path);
          cache.set(path, value);
          apply(path, value);
        }
      }
      schedule();
    },
    dispose() {
      closed = true;
      clearTimeout(timer);
      active?.controller.abort();
      for (const value of cache.values()) dispose(value);
      cache.clear();
    },
  };
}
