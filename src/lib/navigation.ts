import { useEffect, useState, useSyncExternalStore } from "react";

export type AppRoute = {
  shareToken: string | null;
  sharedResourceId: string | null;
  page: "library" | "search" | "chat" | "settings";
  folderId: string | null;
  documentId: string | null;
  node?: string;
  tab: string;
  chatId: string | null;
  query: string;
  settingsSection: "people" | "connections";
};

export const paths = {
  library: (folderId?: string | null) =>
    folderId ? `/library/folders/${encodeURIComponent(folderId)}` : "/library",
  document: (
    id: string,
    node?: string,
    tab = node ? "index" : "original",
    folderId?: string | null,
  ) => {
    const query = new URLSearchParams();
    if (node) query.set("node", node);
    if (tab !== "original") query.set("tab", tab);
    return `${paths.library(folderId)}/documents/${encodeURIComponent(id)}${query.size ? `?${query}` : ""}`;
  },
  shared: (
    token: string,
    resourceId?: string | null,
    node?: string,
    tab = node ? "index" : "original",
  ) => {
    const query = new URLSearchParams();
    if (node) query.set("node", node);
    if (tab !== "original") query.set("tab", tab);
    return `/s/${encodeURIComponent(token)}${resourceId ? `/resources/${encodeURIComponent(resourceId)}` : ""}${query.size ? `?${query}` : ""}`;
  },
  chat: (id?: string | null) =>
    id ? `/chats/${encodeURIComponent(id)}` : "/chats",
  search: (query = "") =>
    query ? `/search?${new URLSearchParams({ q: query })}` : "/search",
  settings: (section = "people") =>
    section === "connections" ? "/settings/connections" : "/settings/members",
};

export function readRoute(url: URL): AppRoute {
  const segments = url.pathname.split("/").filter(Boolean);
  const decode = (value?: string) => {
    try {
      return value ? decodeURIComponent(value) : null;
    } catch {
      return null;
    }
  };
  const legacy = segments.length === 0;
  const documentIndex = segments.indexOf("documents");
  const documentId =
    documentIndex >= 0
      ? decode(segments[documentIndex + 1])
      : legacy
        ? url.searchParams.get("document")
        : null;
  const node = url.searchParams.get("node") ?? undefined;
  const requestedTab = url.searchParams.get("tab");
  return {
    shareToken: segments[0] === "s" ? decode(segments[1]) : null,
    sharedResourceId:
      segments[0] === "s" && segments[2] === "resources"
        ? decode(segments[3])
        : null,
    page:
      segments[0] === "chats"
        ? "chat"
        : segments[0] === "settings"
          ? "settings"
          : segments[0] === "search"
            ? "search"
            : "library",
    folderId:
      segments[0] === "library" && segments[1] === "folders"
        ? decode(segments[2])
        : legacy
          ? url.searchParams.get("folder")
          : null,
    documentId,
    node,
    tab:
      requestedTab &&
      ["original", "index", "parsed", "links"].includes(requestedTab)
        ? requestedTab
        : node
          ? "index"
          : "original",
    chatId: segments[0] === "chats" ? decode(segments[1]) : null,
    query: url.searchParams.get("q") ?? "",
    settingsSection: segments[1] === "connections" ? "connections" : "people",
  };
}

const navigationEvent = "app-navigation";
let furthestIndex = 0;
function savedFurthestIndex() {
  try {
    return (
      Number(window.sessionStorage.getItem("jevbox:history-end") ?? 0) || 0
    );
  } catch {
    return 0;
  }
}
function saveFurthestIndex() {
  try {
    window.sessionStorage.setItem("jevbox:history-end", String(furthestIndex));
  } catch {}
}
const currentIndex = () => {
  if (!Number.isInteger(window.history.state?.navigationIndex)) {
    furthestIndex = 0;
    saveFurthestIndex();
    window.history.replaceState(
      { ...window.history.state, navigationIndex: 0 },
      "",
    );
  }
  return Number(window.history.state.navigationIndex);
};

export function navigateTo(href: string, options: { replace?: boolean } = {}) {
  const url = new URL(href, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (url.href === window.location.href) return;
  const index = currentIndex() + (options.replace ? 0 : 1);
  if (options.replace) {
    window.history.replaceState(
      { ...window.history.state, navigationIndex: index },
      "",
      url,
    );
  } else {
    window.history.pushState({ navigationIndex: index }, "", url);
    furthestIndex = index;
    saveFurthestIndex();
  }
  window.dispatchEvent(new Event(navigationEvent));
}

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(navigationEvent, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(navigationEvent, onChange);
  };
}

function snapshot() {
  const index = currentIndex();
  furthestIndex = Math.max(furthestIndex, index, savedFurthestIndex());
  return JSON.stringify([window.location.href, index, furthestIndex]);
}

export function useAppNavigation() {
  const [href, index, lastIndex] = JSON.parse(
    useSyncExternalStore(subscribe, snapshot),
  );
  return {
    route: readRoute(new URL(href)),
    canGoBack: index > 0,
    canGoForward: index < lastIndex,
    back: () => window.history.back(),
    forward: () => window.history.forward(),
  };
}

export function useLibraryNavigation() {
  const [href] = JSON.parse(useSyncExternalStore(subscribe, snapshot));
  const [history, setHistory] = useState<{ entries: string[]; index: number }>({
    entries: [],
    index: -1,
  });
  useEffect(() => {
    const url = new URL(href);
    if (!url.pathname.startsWith("/library")) return;
    const location = `${url.pathname}${url.search}`;
    setHistory((previous) =>
      previous.entries[previous.index] === location
        ? previous
        : {
            entries: [
              ...previous.entries.slice(0, previous.index + 1),
              location,
            ],
            index: previous.index + 1,
          },
    );
  }, [href]);
  const move = (offset: number) => {
    const next = history.index + offset;
    const location = history.entries[next];
    if (!location) return;
    setHistory({ ...history, index: next });
    navigateTo(location);
  };
  return {
    canGoBack: history.index > 0,
    canGoForward: history.index + 1 < history.entries.length,
    back: () => move(-1),
    forward: () => move(1),
  };
}
