import { useCallback, useSyncExternalStore } from "react";
const sessionPreferences = new Map<string, FinderView | boolean | number>();
export type FinderView = "icons" | "list" | "columns" | "gallery" | "spatial";
export function useFinderView(userId?: string) {
  const key = `jevbox:${userId ?? "guest"}:finder-view`;
  const read = useCallback((): FinderView => {
    try {
      const value = sessionPreferences.get(key) ?? localStorage.getItem(key);
      if (
        value === "icons" ||
        value === "list" ||
        value === "columns" ||
        value === "gallery" ||
        value === "spatial"
      )
        return value;
    } catch {}
    return "icons";
  }, [key]);
  const subscribe = useCallback((listener: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key) sessionPreferences.delete(event.key);
      else sessionPreferences.clear();
      listener();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("finder-preference", listener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("finder-preference", listener);
    };
  }, []);
  const view = useSyncExternalStore(
    subscribe,
    read,
    () => "icons" as FinderView,
  );
  const setView = useCallback(
    (value: FinderView) => {
      sessionPreferences.set(key, value);
      try {
        localStorage.setItem(key, value);
      } catch {}
      window.dispatchEvent(new Event("finder-preference"));
    },
    [key],
  );
  return [view, setView] as const;
}

export function useDocumentSidebarPreference(
  userId: string | undefined,
  side: "left" | "right",
) {
  const key = `jevbox:${userId ?? "guest"}:document-${side}-sidebar`;
  const read = useCallback(() => {
    const cached = sessionPreferences.get(key);
    if (typeof cached === "boolean") return cached;
    try {
      return localStorage.getItem(key) !== "false";
    } catch {
      return true;
    }
  }, [key]);
  const subscribe = useCallback((listener: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key) sessionPreferences.delete(event.key);
      else sessionPreferences.clear();
      listener();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("document-sidebar-preference", listener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("document-sidebar-preference", listener);
    };
  }, []);
  const open = useSyncExternalStore(subscribe, read, () => true);
  const setOpen = useCallback(
    (value: boolean) => {
      sessionPreferences.set(key, value);
      try {
        localStorage.setItem(key, String(value));
      } catch {}
      window.dispatchEvent(new Event("document-sidebar-preference"));
    },
    [key],
  );
  return [open, setOpen] as const;
}

export function useDocumentSidebarWidthPreference(
  userId: string | undefined,
  side: "left" | "right",
) {
  const key = `jevbox:${userId ?? "guest"}:document-${side}-sidebar-width`;
  const read = useCallback(() => {
    try {
      const value = Number(
        sessionPreferences.get(key) ?? localStorage.getItem(key),
      );
      if (Number.isFinite(value) && value >= 180 && value <= 10000)
        return value;
    } catch {}
    return undefined;
  }, [key]);
  const subscribe = useCallback((listener: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key) sessionPreferences.delete(event.key);
      else sessionPreferences.clear();
      listener();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("document-sidebar-width-preference", listener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("document-sidebar-width-preference", listener);
    };
  }, []);
  const width = useSyncExternalStore(subscribe, read, () => undefined);
  const setWidth = useCallback(
    (value: number) => {
      if (!Number.isFinite(value) || value < 180 || value > 10000) return;
      const rounded = Math.round(value);
      sessionPreferences.set(key, rounded);
      try {
        localStorage.setItem(key, String(rounded));
      } catch {}
      window.dispatchEvent(new Event("document-sidebar-width-preference"));
    },
    [key],
  );
  return [width, setWidth] as const;
}
