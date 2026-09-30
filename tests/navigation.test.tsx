import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  navigateTo,
  paths,
  readRoute,
  useAppNavigation,
} from "../src/lib/navigation";
import { RouteLink } from "../src/components/route-link";

const dom = new JSDOM("<div id='root'></div>", {
  url: "https://app.test/library",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "Event",
  "MouseEvent",
] as const)
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
  });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
after(() => dom.window.close());
let latest: ReturnType<typeof useAppNavigation>;
function Harness() {
  latest = useAppNavigation();
  return (
    <>
      <output>{JSON.stringify(latest.route)}</output>
      <RouteLink href={paths.settings("connections")}>Connections</RouteLink>
    </>
  );
}
async function traverse(direction: "back" | "forward") {
  await act(async () => {
    const popped = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history[direction]();
    await popped;
  });
}

test("routes preserve folders, document sections, search queries, conversations and old links", () => {
  const read = (path: string) =>
    readRoute(new URL(path, window.location.origin));
  const route = read(paths.document("doc", "node&/one", "index", "folder"));
  assert.equal(route.documentId, "doc");
  assert.equal(route.folderId, "folder");
  assert.equal(route.node, "node&/one");
  assert.equal(route.tab, "index");
  assert.equal(read(paths.chat("chat")).chatId, "chat");
  assert.equal(read(paths.search("a & b / c")).query, "a & b / c");
  assert.equal(read(paths.settings("api-keys")).settingsSection, "api-keys");
  assert.equal(read("/?document=doc&node=section").tab, "index");
  assert.equal(read("/?folder=folder").folderId, "folder");
  assert.equal(read("/documents/doc").documentId, "doc");
  assert.equal(read(paths.shared("token", "doc")).sharedResourceId, "doc");
});

test("browser back and forward restore route state; new navigation branches and refresh preserves location", async () => {
  let root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<Harness />));
  const hrefs = [
    paths.library("folder"),
    paths.document("doc", "section", "index", "folder"),
    paths.settings("connections"),
    paths.chat("chat"),
    paths.search("query"),
  ];
  for (const href of hrefs) await act(async () => navigateTo(href));
  const length = window.history.length;
  await act(async () => navigateTo(paths.search("query")));
  assert.equal(window.history.length, length);
  for (const href of hrefs.slice(0, -1).reverse()) {
    await traverse("back");
    assert.equal(window.location.pathname + window.location.search, href);
    assert.deepEqual(latest.route, readRoute(new URL(window.location.href)));
    assert.equal(latest.canGoForward, true);
  }
  await traverse("forward");
  assert.equal(latest.route.documentId, "doc");
  await act(async () =>
    document
      .querySelector("a")!
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
      ),
  );
  assert.equal(latest.route.settingsSection, "connections");
  assert.equal(latest.canGoForward, false);
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<Harness />));
  assert.equal(latest.route.page, "settings");
  assert.equal(latest.route.settingsSection, "connections");
  const beforeReplace = window.history.length;
  await act(async () => navigateTo(paths.chat(), { replace: true }));
  assert.equal(window.history.length, beforeReplace);
  await traverse("back");
  assert.equal(latest.route.documentId, "doc");
  await act(async () => root.unmount());
});

test("Library back and forward skip other app tabs and branch within Library", async () => {
  const { useLibraryNavigation } = await import("../src/lib/navigation");
  let library: ReturnType<typeof useLibraryNavigation>;
  function LibraryHarness() {
    library = useLibraryNavigation();
    return null;
  }
  await act(async () => navigateTo(paths.library()));
  const root = createRoot(document.getElementById("root")!);
  await act(async () => root.render(<LibraryHarness />));
  assert.equal(library!.canGoBack, false);
  await act(async () => navigateTo(paths.chat()));
  await act(async () => navigateTo(paths.settings("connections")));
  await act(async () => navigateTo(paths.library("folder")));
  await act(async () => library!.back());
  assert.equal(window.location.pathname, paths.library());
  assert.equal(library!.canGoForward, true);
  await act(async () => library!.forward());
  assert.equal(window.location.pathname, paths.library("folder"));
  await act(async () => library!.back());
  await act(async () => navigateTo(paths.library("other")));
  assert.equal(library!.canGoForward, false);
  await act(async () => root.unmount());
});
