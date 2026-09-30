import assert from "node:assert/strict";
import { after, afterEach, beforeEach, test } from "node:test";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://app.test/",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "customElements",
  "ShadowRoot",
  "DOMRect",
  "DOMParser",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "DocumentFragment",
  "HTMLButtonElement",
  "HTMLDivElement",
  "HTMLImageElement",
  "Node",
  "Element",
  "HTMLElement",
  "SVGElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLFormElement",
  "HTMLTemplateElement",
  "HTMLStyleElement",
  "MutationObserver",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
  "FormData",
  "AbortController",
  "AbortSignal",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key],
    writable: true,
  });
}
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});
dom.window.ResizeObserver = globalThis.ResizeObserver;
dom.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => true,
});
dom.window.Element.prototype.getAnimations = () => [];

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

const { DocumentView } = await import("../src/components/document");
const { ChatView, Sources } = await import("../src/components/discovery");
const { Markdown } = await import("../src/components/common");
const { ChatThinking } = await import("../src/components/loading-state");
const { RetrievalTree } = await import("../src/components/retrieval-tree");
const { FileSystem } = await import("../src/components/extend/file-system");
const { ToastProvider } = await import("../src/components/coss/toast");
const { ParsedBlocks } = await import("../src/components/parsed-blocks");
const { IndexStatusBadge } =
  await import("../src/components/index-status-badge");
const { ChatAttachments } =
  await import("../src/components/chat-composer-tools");
const { useFinderView, useDocumentSidebarPreference } =
  await import("../src/lib/preferences");
import type { IndexNode, Me, Resource } from "../src/lib/api";
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});
after(() => dom.window.close());
async function click(element: Element | null | undefined) {
  assert.ok(element);
  await act(async () =>
    element.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    ),
  );
}
test("parsed content renders Markdown and sanitized HTML tables with merged cells", async () => {
  await act(async () =>
    root.render(
      <ParsedBlocks
        blocks={[
          {
            id: "rich-content",
            type: "table",
            page: 1,
            content:
              '# Overview\n\n**Strong** and *emphasis*.\n\n| Name | Value |\n| --- | --- |\n| Ready | Yes |\n\n<table><thead><tr><th colspan="2" scope="colgroup">Details</th></tr></thead><tbody><tr><td rowspan="2"><strong>Group</strong></td><td>First</td></tr><tr><td>Second</td></tr></tbody></table>\n\n<script>unsafe()</script><a href="javascript:unsafe()" onclick="unsafe()">Unsafe link</a><iframe src="https://example.org"></iframe>',
          },
        ]}
        onSelect={() => {}}
      />,
    ),
  );
  assert.equal(host.querySelector("h1")?.textContent, "Overview");
  assert.equal(host.querySelector("em")?.textContent, "emphasis");
  assert.equal(host.querySelectorAll("table").length, 2);
  assert.equal(host.querySelectorAll(".markdown-table-scroll").length, 2);
  assert.equal(host.querySelector("th[colspan]")?.getAttribute("colspan"), "2");
  assert.equal(host.querySelector("td[rowspan]")?.getAttribute("rowspan"), "2");
  assert.equal(host.querySelector("td strong")?.textContent, "Group");
  assert.equal(
    host.querySelector("script, iframe, [onclick], a[href^='javascript:']"),
    null,
  );
});
function button(label: string, container: ParentNode = document) {
  return [...container.querySelectorAll("button")].find(
    (node) =>
      node.textContent?.trim() === label ||
      node.getAttribute("aria-label") === label,
  );
}
async function typeChatMessage(value: string) {
  const input = document.querySelector<HTMLElement>(
    '[role="textbox"][contenteditable="true"]',
  );
  assert.ok(input);
  await act(async () => {
    const paragraph = document.createElement("p");
    paragraph.textContent = value;
    input.replaceChildren(paragraph);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    input
      .closest("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
test("chat citations use document previews without changing code or unknown references", async () => {
  const source = {
    documentId: "doc",
    nodeId: "node",
    name: "Document",
    title: "Section",
    page: 2,
  };
  let selected: unknown;
  await act(async () =>
    root.render(
      <Markdown
        sources={[source]}
        onSourcePreview={(value) => {
          selected = value;
        }}
      >
        {"Evidence [1], unknown [9], and `[1]`.\n\n```text\n[1]\n```"}
      </Markdown>,
    ),
  );
  assert.equal(host.querySelectorAll(".chat-source-chip").length, 1);
  assert.equal(host.querySelectorAll("p div").length, 0);
  assert.equal(host.querySelector("pre")?.textContent?.trim(), "[1]");
  assert.ok(host.textContent?.includes("[9]"));
  await click(host.querySelector(".chat-source-chip"));
  assert.equal(selected, source);
});

test("citation thumbnails stay mounted when preview callbacks and source snapshots change", async () => {
  const source = {
    documentId: "doc",
    nodeId: "node",
    name: "Document.png",
    title: "Section",
    page: 1,
  };
  let selected: unknown;
  const render = async (title: string) => {
    await act(async () =>
      root.render(
        <Markdown
          sources={[{ ...source, title }]}
          onSourcePreview={(value) => {
            selected = value;
          }}
        >
          Evidence [1].
        </Markdown>,
      ),
    );
  };
  await render("Section");
  const chip = host.querySelector(".chat-source-chip");
  const image = chip?.querySelector("img");
  assert.ok(chip);
  assert.ok(image);
  assert.equal(image.getAttribute("src"), "/api/documents/doc/thumbnail");
  for (const title of ["Overview", "Details", "Passage"]) {
    await render(title);
    assert.equal(host.querySelector(".chat-source-chip"), chip);
    assert.equal(chip.querySelector("img"), image);
    assert.equal(chip.querySelector("svg"), null);
  }
  await click(chip);
  assert.equal((selected as typeof source).title, "Passage");
});

test("inline citations preview on hover and focus, cancel brief hovers, and clean up on unmount", async () => {
  const sources = [1, 2].map((page) => ({
    documentId: "doc",
    nodeId: "node",
    name: "Document.png",
    title: "Section",
    page,
    blockIds: [`block-${page}`],
  }));
  const selected: unknown[] = [];
  await act(async () =>
    root.render(
      <Markdown
        sources={sources}
        onSourcePreview={(source) => selected.push(source)}
      >
        Evidence [1] and [2].
      </Markdown>,
    ),
  );
  const [first, second] =
    host.querySelectorAll<HTMLAnchorElement>(".chat-source-chip");
  const enter = (element: Element) =>
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  const leave = (element: Element) =>
    element.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
  await act(async () => {
    enter(first);
    leave(first);
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
  assert.deepEqual(selected, []);
  await act(async () => {
    enter(second);
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
  assert.deepEqual(selected, [sources[1]]);
  await act(async () => first.focus());
  assert.deepEqual(selected, [sources[1], sources[0]]);
  await act(async () => {
    enter(second);
    root.render(<div />);
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 220)));
  assert.equal(selected.length, 2);
});

test("sources and retrieval paths collapse into bounded fading scroll areas", async () => {
  const source = {
    documentId: "doc",
    nodeId: "node",
    name: "Document",
    title: "Section",
    page: 1,
  };
  let previewed = false;
  await act(async () =>
    root.render(
      <>
        <Sources
          sources={[source]}
          onOpen={() => {}}
          onPreview={() => {
            previewed = true;
          }}
        />
        <RetrievalTree
          trace={Array.from({ length: 16 }, (_, index) => ({
            stage: "document" as const,
            resourceId: `doc-${index}`,
            label: `Document ${index}`,
          }))}
        />
      </>,
    ),
  );
  const trigger = host.querySelector(".sources-trigger");
  assert.equal(trigger?.getAttribute("aria-expanded"), "false");
  assert.ok(trigger?.querySelector("[data-resource-thumbnail]"));
  await click(trigger);
  await click(button("Preview source 1: Document", host));
  assert.equal(previewed, true);
  await click(host.querySelector(".retrieval-trace .retrieval-trigger"));
  const scrolls = host.querySelectorAll(
    '.retrieval-tree-panel [data-slot="scroll-area"]',
  );
  assert.equal(scrolls.length, 2);
  assert.ok(scrolls[0].classList.contains("max-h-32"));
  assert.ok(scrolls[1].classList.contains("max-h-[min(16rem,38vh)]"));
  for (const scroll of scrolls)
    assert.equal(scroll.getAttribute("data-scroll-fade"), "true");
});

test("loading steps follow observed response stages", async () => {
  await act(async () => root.render(<ChatThinking status="retrieving" />));
  assert.equal(host.querySelectorAll(".work-loader-grid > span").length, 9);
  await act(async () => root.render(<ChatThinking status="generating" />));
  await click(button("View response steps", host));
  assert.deepEqual(
    [...host.querySelectorAll(".chat-thinking-steps li")].map(
      (step) => step.textContent,
    ),
    ["Finding sources…", "Writing answer…"],
  );
  assert.equal(
    host.querySelector('[aria-current="step"]')?.textContent,
    "Writing answer…",
  );
});

test("regenerate menu sends the enabled model chosen from its provider group", async () => {
  const previousEventSource = globalThis.EventSource;
  globalThis.EventSource = class {
    addEventListener() {}
    close() {}
  } as unknown as typeof EventSource;
  let payload: any;
  const snapshot = {
    id: "chat",
    title: "Chat",
    messages: [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
    ],
    turns: [],
    blocked: false,
  };
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/chats")
      return Response.json([{ id: "chat", title: "Chat" }]);
    if (String(input) === "/api/chats/chat/regenerate") {
      payload = JSON.parse(String(init?.body));
      return Response.json({ id: payload.id }, { status: 202 });
    }
    return Response.json(snapshot);
  };
  try {
    await act(async () =>
      root.render(
        <ChatView
          me={
            {
              chatEnabled: true,
              chatModels: [
                {
                  provider: "openai",
                  providerLabel: "OpenAI",
                  model: "model-a",
                },
                {
                  provider: "anthropic",
                  providerLabel: "Anthropic",
                  model: "model-b",
                },
              ],
              defaultChatModel: { provider: "openai", model: "model-a" },
            } as Me
          }
          chatId="chat"
          onTitleChange={() => {}}
          onChatChange={() => {}}
          onOpen={() => {}}
          onSettings={() => {}}
        />,
      ),
    );
    await click(button("Regenerate answer", host));
    const menu = document.querySelector('[role="menu"]');
    assert.ok(menu?.textContent?.includes("OpenAI"));
    assert.ok(menu?.textContent?.includes("Anthropic"));
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent?.includes("model-b"),
    );
    await click(item);
    assert.deepEqual(payload.selectedModel, {
      provider: "anthropic",
      model: "model-b",
    });
    assert.match(payload.id, /^[0-9a-f-]{36}$/);
  } finally {
    globalThis.EventSource = previousEventSource;
  }
});

test("switching chats keeps a bottom composer and blank transcript until the selected history loads", async () => {
  const previousEventSource = globalThis.EventSource;
  globalThis.EventSource = class {
    addEventListener() {}
    close() {}
  } as unknown as typeof EventSource;
  const resolve = new Map<string, (response: Response) => void>();
  let branchIndex: number | undefined;
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/chats")
      return Response.json([
        { id: "first", title: "First" },
        { id: "second", title: "Second" },
      ]);
    if (path.endsWith("/branch")) {
      branchIndex = JSON.parse(String(init?.body)).messageIndex;
      return Response.json({ id: "branch" });
    }
    return new Promise<Response>((done) => resolve.set(path, done));
  };
  const render = (chatId: string | null) =>
    root.render(
      <ChatView
        me={{ chatEnabled: true } as Me}
        chatId={chatId}
        onTitleChange={() => {}}
        onChatChange={() => {}}
        onOpen={() => {}}
        onSettings={() => {}}
      />,
    );
  try {
    await act(async () => render("first"));
    assert.equal(host.querySelector(".chat-transcript"), null);
    assert.equal(host.querySelector(".chat-message"), null);
    assert.equal(host.querySelector(".chat-scroll")?.textContent?.trim(), "");
    assert.equal(host.querySelector(".new-chat"), null);
    assert.equal(host.querySelector(".chat-empty"), null);
    assert.ok(host.querySelector(".chat-compose"));
    await act(async () => render("second"));
    await act(async () =>
      resolve.get("/api/chats/first")!(
        Response.json({
          id: "first",
          title: "First",
          blocked: false,
          messages: [{ role: "user", content: "Stale question" }],
        }),
      ),
    );
    assert.equal(host.querySelector(".chat-transcript"), null);
    assert.equal(host.querySelector(".chat-message"), null);
    assert.equal(host.textContent?.includes("Stale question"), false);
    await act(async () =>
      resolve.get("/api/chats/second")!(
        Response.json({
          id: "second",
          title: "Second",
          blocked: false,
          messageCount: 102,
          nextCursor: 100,
          messages: [
            { position: 100, role: "user", content: "Latest question" },
            { position: 101, role: "assistant", content: "Latest answer" },
          ],
        }),
      ),
    );
    assert.ok(host.querySelector(".chat-transcript"));
    const question = host.querySelector('[data-message-id="100-user"]');
    assert.ok(question);
    await click(button("Load earlier messages"));
    await act(async () =>
      resolve.get("/api/chats/second?before=100")!(
        Response.json({
          id: "second",
          title: "Second",
          blocked: false,
          messageCount: 102,
          nextCursor: 98,
          messages: [
            { position: 98, role: "user", content: "Earlier question" },
            { position: 99, role: "assistant", content: "Earlier answer" },
          ],
        }),
      ),
    );
    assert.equal(host.querySelector('[data-message-id="100-user"]'), question);
    await click(
      host.querySelector(
        '[data-message-id="100-user"] button[aria-label="Branch into a new chat"]',
      ),
    );
    assert.equal(branchIndex, 100);
    await act(async () => render(null));
    assert.ok(host.querySelector(".new-chat .chat-empty"));
  } finally {
    globalThis.EventSource = previousEventSource;
  }
});

test("chat displays streamed snapshots, submits a durable queue, stops, and branches", async () => {
  const previousEventSource = globalThis.EventSource;
  const listeners = new Map<string, (event: { data: string }) => void>();
  class TestEventSource {
    onerror: (() => void) | null = null;
    addEventListener(
      type: string,
      listener: (event: { data: string }) => void,
    ) {
      listeners.set(type, listener);
    }
    close() {}
  }
  globalThis.EventSource = TestEventSource as unknown as typeof EventSource;
  const requests: string[] = [];
  let branched = "";
  let snapshot: any = {
    id: "chat",
    title: "Chat",
    messages: [],
    turns: [],
    blocked: false,
  };
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    if (path === "/api/chats")
      return Response.json([{ id: "chat", title: "Chat" }]);
    if (path === "/api/chats/chat") return Response.json(snapshot);
    if (path === "/api/chats/chat/turns") {
      const body = JSON.parse(String(init?.body));
      requests.push(body.content);
      snapshot.turns.push({
        id: body.id,
        content: body.content,
        status: requests.length === 1 ? "generating" : "queued",
        partialText: requests.length === 1 ? "First fragment" : "",
        selectedModel: body.selectedModel,
        attachments: [],
        error: null,
        regenerating: false,
      });
      return Response.json({ id: body.id }, { status: 202 });
    }
    if (
      path.startsWith("/api/chats/chat/turns/") &&
      init?.method === "DELETE"
    ) {
      snapshot.turns[0].status = "cancelled";
      return Response.json({ ok: true });
    }
    if (path === "/api/chats/chat/branch")
      return Response.json({ id: "branch" }, { status: 201 });
    throw new Error(`Unexpected request: ${path}`);
  };
  try {
    await act(async () =>
      root.render(
        <ChatView
          me={
            {
              chatEnabled: true,
              chatModels: [
                { provider: "openai", providerLabel: "OpenAI", model: "test" },
              ],
              defaultChatModel: { provider: "openai", model: "test" },
            } as Me
          }
          chatId="chat"
          onTitleChange={() => {}}
          onChatChange={(id) => {
            branched = id ?? "";
          }}
          onOpen={() => {}}
          onSettings={() => {}}
        />,
      ),
    );
    await typeChatMessage("First");
    assert.ok(document.body.textContent?.includes("First fragment"));
    assert.equal(document.querySelector('[data-slot="message-header"]'), null);
    assert.ok(document.querySelector('[data-slot="message-avatar"] svg'));
    await typeChatMessage("Second");
    assert.deepEqual(requests, ["First", "Second"]);
    assert.ok(
      document.querySelector(".chat-queue")?.textContent?.includes("Second"),
    );
    snapshot.turns[0].partialText = "First fragment, now extended";
    await act(async () => {
      listeners.get("snapshot")?.({ data: JSON.stringify(snapshot) });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    assert.ok(document.body.textContent?.includes("now extended"));
    await click(button("Stop answer"));
    assert.ok(
      document.querySelector(".chat-queue")?.textContent?.includes("Stopped"),
    );
    snapshot = {
      ...snapshot,
      turns: [],
      messages: [
        { role: "user", content: "First" },
        { role: "assistant", content: "Complete answer" },
      ],
    };
    await act(async () => {
      listeners.get("snapshot")?.({ data: JSON.stringify(snapshot) });
    });
    await click(button("Branch into a new chat"));
    assert.equal(branched, "branch");
  } finally {
    globalThis.EventSource = previousEventSource;
  }
});

test("stream completion retains the answer, Markdown nodes, and reserved controls", async () => {
  const previousEventSource = globalThis.EventSource;
  const listeners = new Map<string, (event: { data: string }) => void>();
  class TestEventSource {
    onerror = null;
    addEventListener(
      type: string,
      listener: (event: { data: string }) => void,
    ) {
      listeners.set(type, listener);
    }
    close() {}
  }
  globalThis.EventSource = TestEventSource as unknown as typeof EventSource;
  const content =
    "## Answer\n\nA **stable** answer.\n\n| Column | Value |\n| --- | --- |\n| First | Ready |\n\n```text\ncomplete\n```";
  const snapshot = {
    id: "chat",
    title: "Chat",
    blocked: false,
    messages: [
      { role: "user", content: "Question", turnId: "previous" },
      { role: "assistant", content: "Previous answer", turnId: "previous" },
    ] as any[],
    turns: [
      {
        id: "turn",
        content: "Question",
        status: "generating",
        partialText: content,
        attachments: [],
        selectedModel: null,
        error: null,
        regenerating: true,
      },
    ],
  };
  globalThis.fetch = async (input) =>
    String(input) === "/api/chats"
      ? Response.json([{ id: "chat", title: "Chat" }])
      : Response.json(snapshot);
  try {
    await act(async () =>
      root.render(
        <ChatView
          me={{ chatEnabled: true } as Me}
          chatId="chat"
          onTitleChange={() => {}}
          onChatChange={() => {}}
          onOpen={() => {}}
          onSettings={() => {}}
        />,
      ),
    );
    const question = host.querySelector('[data-message-id="0-user"]');
    assert.ok(question);
    const answer = host.querySelector('[data-message-id="turn-assistant"]');
    assert.ok(answer);
    const markdown = answer.querySelector(".markdown");
    const table = answer.querySelector("table");
    const code = answer.querySelector("pre");
    const details = answer.querySelector(".chat-answer-details");
    const footer = answer.querySelector('[data-slot="message-footer"]');
    assert.ok(answer.querySelector(".chat-stream-cursor"));
    assert.equal(details?.getAttribute("data-pending"), "true");
    assert.ok(footer);
    const extended = content + "\n\nMore context.";
    snapshot.turns[0].partialText = extended;
    await act(async () =>
      listeners.get("snapshot")?.({ data: JSON.stringify(snapshot) }),
    );
    assert.equal(answer.querySelector("table"), table);
    assert.equal(answer.querySelector("pre"), code);
    snapshot.messages = [
      { role: "user", content: "Question", turnId: "turn" },
      {
        role: "assistant",
        content: extended,
        turnId: "turn",
        sources: [
          {
            documentId: "doc",
            nodeId: "node",
            name: "Document",
            title: "Section",
            page: 1,
          },
        ],
        trace: [{ stage: "document", label: "Document", resourceId: "doc" }],
      },
    ];
    snapshot.turns = [];
    await act(async () =>
      listeners.get("snapshot")?.({ data: JSON.stringify(snapshot) }),
    );
    assert.equal(host.querySelector('[data-message-id="0-user"]'), question);
    assert.equal(
      host.querySelector('[data-message-id="turn-assistant"]'),
      answer,
    );
    assert.equal(answer.querySelector(".markdown"), markdown);
    assert.equal(answer.querySelector("table"), table);
    assert.equal(answer.querySelector("pre"), code);
    assert.equal(answer.querySelector(".chat-answer-details"), details);
    assert.equal(answer.querySelector('[data-slot="message-footer"]'), footer);
    assert.equal(details?.hasAttribute("data-pending"), true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    assert.equal(details?.hasAttribute("data-pending"), false);
    assert.equal(answer.querySelector(".chat-stream-cursor"), null);
    assert.ok(details?.textContent?.includes("Sources"));
    assert.ok(details?.textContent?.includes("View retrieval path"));
  } finally {
    globalThis.EventSource = previousEventSource;
  }
});

test("delete requires an alert confirmation and only successful deletion emits a success toast", async () => {
  let deletes = 0,
    fail = true,
    returned = false;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === "DELETE") {
      deletes++;
      return Response.json(fail ? { error: "Delete failed" } : { ok: true }, {
        status: fail ? 500 : 200,
      });
    }
    return Response.json({
      id: "doc",
      name: "Document",
      kind: "document",
      mime: "text/plain",
      size: 10,
      pages: 0,
      status: "failed",
      error: "Provider unavailable",
      access: "restricted",
      canShare: true,
      canWrite: true,
    });
  };
  await act(async () =>
    root.render(
      <ToastProvider>
        <DocumentView
          documentId="doc"
          initialTab="index"
          onNavigate={() => {}}
          onBack={() => {
            returned = true;
          }}
          onShare={() => {}}
          onChange={() => {}}
        />
      </ToastProvider>,
    ),
  );
  assert.equal(document.querySelector(".document-footer"), null);
  assert.ok(
    document
      .querySelector(".index-warning")
      ?.textContent?.includes("Provider unavailable"),
  );
  await click(button("Delete document"));
  assert.ok(document.querySelector('[role="alertdialog"]'));
  assert.equal(deletes, 0);
  await click(button("Cancel"));
  assert.equal(deletes, 0);
  await click(button("Delete document"));
  await click(
    button("Delete", document.querySelector('[role="alertdialog"]')!),
  );
  assert.equal(deletes, 1);
  assert.ok(
    document
      .querySelector('[role="alertdialog"]')
      ?.textContent?.includes("Delete failed"),
  );
  assert.equal(returned, false);
  assert.equal(document.body.textContent?.includes("Item deleted"), false);
  fail = false;
  await click(
    button("Delete", document.querySelector('[role="alertdialog"]')!),
  );
  assert.equal(returned, true);
  assert.ok(document.body.textContent?.includes("Item deleted"));
});

test("Finder context menu targets the clicked file and exposes its status in Information", async () => {
  const opened: string[] = [],
    shared: string[] = [],
    deleted: string[] = [],
    moved: string[] = [];
  await act(async () =>
    root.render(
      <FileSystem
        title=""
        items={[
          {
            kind: "file",
            path: "first.bin",
            key: "a",
            metadata: { Index: "failed" },
          },
          {
            kind: "file",
            path: "second.bin",
            key: "b",
            metadata: { Index: "ready" },
          },
        ]}
        onFileOpen={(file) => opened.push(file.key!)}
        onShare={(item) => shared.push(item.path)}
        onDelete={(item) => deleted.push(item.path)}
        onMove={(item, id) => moved.push(`${item.path}:${id}`)}
        getMoveDestinations={() => [
          { id: "destination", label: "Destination" },
        ]}
      />,
    ),
  );
  async function context(path: string) {
    const entry = document.querySelector(`[data-entry-path="${path}"]`);
    assert.ok(entry);
    await act(async () =>
      entry.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 50,
          clientY: 50,
        }),
      ),
    );
  }
  await context("first.bin");
  await click(
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === "Information",
    ),
  );
  assert.ok(
    document.querySelector('[role="dialog"]')?.textContent?.includes("failed"),
  );
  await click(button("Close"));
  await context("second.bin");
  await click(
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === "Share",
    ),
  );
  assert.deepEqual(shared, ["second.bin"]);
  await context("first.bin");
  await click(
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === "Open",
    ),
  );
  assert.deepEqual(opened, ["a"]);
  await context("first.bin");
  assert.ok(
    [...document.querySelectorAll('[role="menuitem"]')]
      .filter((el) => el.textContent?.trim())
      .every((el) => el.querySelector("svg")),
  );
  await click(
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === "Delete",
    ),
  );
  assert.deepEqual(deleted, ["first.bin"]);
  await context("second.bin");
  await click(
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === "Move to",
    ),
  );
  await click(
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === "Destination",
    ),
  );
  assert.deepEqual(moved, ["second.bin:destination"]);
});

test("Finder Gallery uses lazy thumbnails in its information header and has a resize handle", async () => {
  const loads: number[] = [];
  await act(async () =>
    root.render(
      <FileSystem
        defaultView="gallery"
        items={[
          {
            kind: "file",
            path: "document.bin",
            previewPageCount: 1,
            metadata: { Index: "failed" },
          },
        ]}
        loadPreviewImageUrl={async (_file, page) => {
          loads.push(page);
          return "https://app.test/preview.png";
        }}
      />,
    ),
  );
  const pane = document.querySelector('[data-panel][id="gallery-information"]');
  assert.ok(pane);
  assert.ok(pane.querySelector('img[src="https://app.test/preview.png"]'));
  assert.ok(
    document.querySelector(
      '[role="separator"][aria-label="Resize information panel"]',
    ),
  );
  assert.ok(loads.includes(0));
  assert.ok(pane.textContent?.includes("failed"));
});

test("library and chat indexing badges share status labels, icons, and color classes", async () => {
  for (const status of [
    "ready",
    "failed",
    "awaiting_key",
    "queued",
    "processing",
    "stored",
  ]) {
    await act(async () =>
      root.render(
        <>
          <FileSystem
            defaultView="gallery"
            items={[
              {
                kind: "file",
                path: "Document.bin",
                metadata: { Index: status.replaceAll("_", " ") },
              },
            ]}
          />
          <IndexStatusBadge status={status} />
          <ChatAttachments
            attachments={[
              {
                id: "doc",
                name: "Document.bin",
                mime: "application/octet-stream",
                status,
              } as Resource,
            ]}
            disabled={false}
            onRemove={() => {}}
          />
        </>,
      ),
    );
    const badges = [
      ...host.querySelectorAll<HTMLElement>("[data-index-status]"),
    ];
    assert.equal(badges.length, status === "ready" ? 2 : 3);
    for (const badge of badges) {
      assert.equal(badge.dataset.indexStatus, status);
      assert.ok(badge.classList.contains("status-chip"));
      assert.ok(badge.classList.contains(status));
      assert.equal(
        badge.textContent,
        status === "ready" ? "Indexed" : status.replaceAll("_", " "),
      );
      assert.equal(
        badge.querySelectorAll("svg").length,
        ["ready", "failed", "awaiting_key"].includes(status) ? 1 : 0,
      );
      assert.equal(badge.innerHTML, badges[0].innerHTML);
    }
  }
});

test("Finder preference survives remounts and remains scoped to the signed-in user", async () => {
  let setView: (
    view: "icons" | "list" | "columns" | "gallery" | "spatial",
  ) => void;
  function Preference({ user }: { user: string }) {
    const [view, update] = useFinderView(user);
    setView = update;
    return <output>{view}</output>;
  }
  await act(async () => root.render(<Preference user="one" />));
  await act(async () => setView("gallery"));
  assert.equal(host.textContent, "gallery");
  await act(async () => root.render(<Preference user="two" />));
  assert.equal(host.textContent, "icons");
  await act(async () => root.render(<Preference user="one" />));
  assert.equal(host.textContent, "gallery");
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<Preference user="one" />));
  assert.equal(host.textContent, "gallery");
  assert.equal(localStorage.getItem("jevbox:one:finder-view"), "gallery");
  await act(async () => setView("spatial"));
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<Preference user="one" />));
  assert.equal(host.textContent, "spatial");
  assert.equal(localStorage.getItem("jevbox:one:finder-view"), "spatial");
});

test("document sidebar preferences persist independently across document remounts and users", async () => {
  const { DocumentNavigationContext, useDocumentSidebarOpen } =
    await import("../src/components/extend/document-viewer-sidebar");
  function Navigation() {
    const [open, setOpen] = useDocumentSidebarOpen();
    return (
      <button
        aria-label="Left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      />
    );
  }
  function Preference({
    user,
    documentId,
  }: {
    user: string;
    documentId: string;
  }) {
    const [left, setLeft] = useDocumentSidebarPreference(user, "left");
    const [right, setRight] = useDocumentSidebarPreference(user, "right");
    return (
      <DocumentNavigationContext.Provider
        value={{
          index: null,
          navigationOpen: left,
          onNavigationOpenChange: setLeft,
        }}
      >
        <Navigation key={documentId} />
        <button
          aria-label="Right"
          aria-expanded={right}
          onClick={() => setRight(!right)}
        />
      </DocumentNavigationContext.Provider>
    );
  }
  const state = () =>
    [...host.querySelectorAll("button")].map((b) =>
      b.getAttribute("aria-expanded"),
    );
  await act(async () =>
    root.render(<Preference user="sidebar-one" documentId="first" />),
  );
  assert.deepEqual(state(), ["true", "true"]);
  await click(host.querySelector('[aria-label="Left"]'));
  assert.deepEqual(state(), ["false", "true"]);
  await click(host.querySelector('[aria-label="Right"]'));
  await act(async () =>
    root.render(<Preference user="sidebar-one" documentId="second" />),
  );
  assert.deepEqual(state(), ["false", "false"]);
  await act(async () =>
    root.render(<Preference user="sidebar-two" documentId="second" />),
  );
  assert.deepEqual(state(), ["true", "true"]);
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () =>
    root.render(<Preference user="sidebar-one" documentId="third" />),
  );
  assert.deepEqual(state(), ["false", "false"]);
  assert.equal(
    localStorage.getItem("jevbox:sidebar-one:document-left-sidebar"),
    "false",
  );
  assert.equal(
    localStorage.getItem("jevbox:sidebar-one:document-right-sidebar"),
    "false",
  );
});

test("document inspector keeps the viewer mounted while tabs change and labels the indexing badge", async () => {
  const { useState } = await import("react");
  globalThis.fetch = async () =>
    Response.json({
      id: "doc",
      name: "Document.bin",
      kind: "document",
      mime: "application/octet-stream",
      size: 10,
      pages: 1,
      status: "ready",
      access: "restricted",
      canShare: true,
      canWrite: true,
      parsed: {
        source: "extend",
        pages: 1,
        indexedAt: new Date().toISOString(),
        markdown: "Content",
        blocks: [
          {
            id: "b1",
            type: "paragraph",
            content: "Content",
            page: 1,
            pageWidth: 100,
            pageHeight: 200,
            boundingBox: { left: 10, top: 20, right: 40, bottom: 60 },
          },
        ],
        nodes: [
          {
            id: "n1",
            title: "Section",
            summary: "Content",
            content: "Content",
            page: 1,
            endPage: 1,
            links: [],
            blocks: [],
            children: [],
          },
        ],
      },
    });
  function Harness() {
    const [tab, setTab] = useState("original");
    const [node, setNode] = useState<string>();
    return (
      <DocumentView
        documentId="doc"
        initialTab={tab}
        initialNode={node}
        onNavigate={(nextNode, nextTab) => {
          setNode(nextNode);
          setTab(nextTab);
        }}
        onBack={() => {}}
        onShare={() => {}}
        onChange={() => {}}
      />
    );
  }
  await act(async () => root.render(<Harness />));
  const viewer = document.querySelector('[aria-label="Document viewer"]');
  assert.ok(viewer);
  const inspector = document.querySelector(
    'aside[aria-label="Document details"]',
  );
  assert.ok(inspector);
  assert.deepEqual(
    [
      ...inspector.querySelectorAll(
        '[role="tablist"][aria-label="Document details"] > [role="tab"]',
      ),
    ].map((tab) => tab.textContent?.trim()),
    ["Parsed output", "Section", "Links 0"],
  );
  assert.equal(document.querySelector(".document-tabbar"), null);
  const indexBadge = document.querySelector(
    '.document-header [data-index-status="ready"]',
  );
  assert.equal(indexBadge?.textContent, "Indexed");
  assert.ok(indexBadge?.querySelector("svg"));
  assert.match(
    document
      .querySelector(".document-header .status-chip[aria-label]")
      ?.getAttribute("aria-label") ?? "",
    /Index: complete/,
  );
  assert.ok(
    button("Delete document")?.className.includes(
      "text-destructive-foreground",
    ),
  );
  await click(button("Show paragraph on page 1"));
  assert.equal(
    document.querySelector('.parsed-block[data-selected="true"]'),
    null,
  );
  await click(button("Section", inspector));
  assert.equal(
    document.querySelector('[aria-label="Document viewer"]'),
    viewer,
  );
  assert.ok(inspector.querySelector('[aria-label="Section view"]'));
  await click(document.querySelector(".index-node") as HTMLButtonElement);
  assert.equal(
    button("Section", inspector)?.getAttribute("aria-selected"),
    "true",
  );
  await click(button("0 blocks", inspector));
  assert.ok(inspector.querySelector('.parsed-block[data-selected="true"]'));
  await click(button("0 links", inspector));
  assert.ok(inspector.textContent?.includes("No links in this section"));
  await click(button("Links 0", inspector));
  assert.equal(
    document.querySelector('[aria-label="Document viewer"]'),
    viewer,
  );
  assert.ok(inspector.textContent?.includes("No external links"));
});

test("Finder renders its toolbar and preserves the selected view while folder content loads", async () => {
  await act(async () =>
    root.render(<FileSystem items={[]} isLoading defaultView="gallery" />),
  );
  assert.ok(document.querySelector('[aria-label="View"]'));
  assert.ok(
    document.querySelector('input[placeholder="Search"]') ||
      document.querySelector('input[type="search"]') ||
      document.querySelector("input"),
  );
  assert.ok(document.querySelector('[role="status"]'));
  const gallery = document.querySelector('[aria-label="View"]');
  await act(async () =>
    root.render(
      <FileSystem
        items={[{ kind: "file", path: "Item.bin" }]}
        isLoading={false}
        defaultView="gallery"
      />,
    ),
  );
  assert.equal(document.querySelector('[aria-label="View"]'), gallery);
  assert.ok(!document.body.textContent?.includes("Opening folder"));
  assert.ok(document.body.textContent?.includes("Item.bin"));
});

test("Finder Grid requests and renders the first PDF thumbnail", async () => {
  const loaded: number[] = [];
  await act(async () =>
    root.render(
      <FileSystem
        items={[{ kind: "file", path: "Document.pdf", previewPageCount: 1 }]}
        defaultView="icons"
        loadPreviewImageUrl={async (_file, page) => {
          loaded.push(page);
          return "data:image/png;base64,cHJldmlldw==";
        }}
      />,
    ),
  );
  assert.deepEqual(loaded, [0]);
  assert.ok(
    document.querySelector(
      '[role="option"] img[src="data:image/png;base64,cHJldmlldw=="]',
    ),
  );
});

test("Finder uses a stored cover without invoking document thumbnail generation", async () => {
  const loaded: number[] = [];
  for (const view of ["icons", "columns"] as const) {
    await act(async () => root.render(
      <FileSystem
        items={[{ kind: "file", path: "Document.pdf", url: "/original", previewImageUrl: "/small-thumbnail.webp", previewPageCount: 2 }]}
        view={view}
        loadPreviewImageUrl={async (_file, page) => { loaded.push(page); return null; }}
      />,
    ));
    assert.ok(host.querySelector('img[src="/small-thumbnail.webp"]'));
    assert.deepEqual(loaded, []);
    assert.equal(host.querySelector('img[src="/original"]'), null);
  }
});

test("Finder Columns loads a row thumbnail and reuses it when switching to Grid", async () => {
  const loaded: number[] = [];
  const items = [
    { kind: "file" as const, path: "Document.pdf", previewPageCount: 2 },
  ];
  const loadPreviewImageUrl = async (_file: unknown, page: number) => {
    loaded.push(page);
    return "data:image/png;base64,cHJldmlldw==";
  };
  await act(async () =>
    root.render(
      <FileSystem
        items={items}
        view="columns"
        loadPreviewImageUrl={loadPreviewImageUrl}
      />,
    ),
  );
  assert.deepEqual(loaded, [0]);
  assert.ok(
    host.querySelector(
      '[role="option"] img[src="data:image/png;base64,cHJldmlldw=="]',
    ),
  );
  await act(async () =>
    root.render(
      <FileSystem
        items={items}
        view="icons"
        loadPreviewImageUrl={loadPreviewImageUrl}
      />,
    ),
  );
  assert.deepEqual(loaded, [0]);
  assert.ok(
    host.querySelector(
      '[role="option"] img[src="data:image/png;base64,cHJldmlldw=="]',
    ),
  );
});

test("Finder List loads mounted file covers without opening or loading collapsed folders", async () => {
  const loaded: string[] = [];
  await act(async () =>
    root.render(
      <FileSystem
        view="list"
        items={[
          { kind: "file", path: "Document.pdf", previewPageCount: 1 },
          { kind: "file", path: "Folder/Hidden.pdf", previewPageCount: 1 },
        ]}
        loadPreviewImageUrl={async (file) => {
          loaded.push(file.path);
          return "data:image/png;base64,cHJldmlldw==";
        }}
      />,
    ),
  );
  for (let attempt = 0; loaded.length === 0 && attempt < 40; attempt++) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  const shadow = host.querySelector("file-tree-container")?.shadowRoot;
  assert.deepEqual(loaded, ["Document.pdf"]);
  assert.ok(
    shadow?.querySelector(
      'symbol image[href="data:image/png;base64,cHJldmlldw=="]',
    ),
  );
  assert.ok(shadow?.querySelector('[data-item-path="Folder/"]'));
  assert.equal(
    shadow?.querySelector('[data-item-path="Folder/Hidden.pdf"]'),
    null,
  );
});

test("embedded source preview omits full inspector chrome and shows only cited blocks", async () => {
  const block = {
    id: "cited",
    type: "paragraph",
    content: "Cited evidence",
    page: 1,
  };
  globalThis.fetch = async () =>
    Response.json({
      id: "source",
      name: "Document.bin",
      kind: "document",
      mime: "application/octet-stream",
      size: 10,
      pages: 1,
      status: "ready",
      access: "restricted",
      canWrite: false,
      parsed: {
        source: "extend",
        pages: 1,
        markdown: "Cited evidence",
        blocks: [
          block,
          { ...block, id: "unrelated", content: "Other evidence" },
        ],
        nodes: [
          {
            id: "section",
            title: "Section",
            summary: "",
            content: "Cited evidence",
            page: 1,
            endPage: 1,
            links: [],
            blocks: [block],
            children: [],
          },
        ],
      },
    });
  await act(async () =>
    root.render(
      <DocumentView
        documentId="source"
        initialNode="section"
        initialTab="parsed"
        focusBlockIds={["cited"]}
        embedded
        onNavigate={() => {}}
        onBack={() => {}}
        onShare={() => {}}
        onChange={() => {}}
      />,
    ),
  );
  assert.equal(document.querySelector('[aria-label="Document details"]'), null);
  assert.equal(document.querySelector(".document-header"), null);
  assert.ok(document.querySelector('[aria-label="Source preview view"]'));
  await click(button("Source blocks 1"));
  assert.equal(document.querySelectorAll(".parsed-block").length, 1);
  assert.match(
    document.querySelector(".parsed-block")?.textContent ?? "",
    /Cited evidence/,
  );
  assert.equal(document.querySelector(".source-document-heading"), null);
});

test("embedded preview keeps its tabs mounted while switching and loading documents", async () => {
  const pending = new Map<string, (response: Response) => void>();
  globalThis.fetch = async (input) =>
    new Promise<Response>((resolve) => pending.set(String(input), resolve));
  const render = async (documentId: string) =>
    act(async () =>
      root.render(
        <DocumentView
          documentId={documentId}
          initialTab="parsed"
          embedded
          onNavigate={() => {}}
          onBack={() => {}}
          onShare={() => {}}
          onChange={() => {}}
        />,
      ),
    );
  const resolve = async (id: string) =>
    act(async () =>
      pending.get(`/api/resources/${id}`)?.(
        Response.json({
          id,
          name: "Document.bin",
          kind: "document",
          mime: "application/octet-stream",
          size: 10,
          status: "ready",
          parsed: {
            source: "text",
            nodes: [],
            blocks: [],
            pages: 1,
            markdown: "",
          },
        }),
      ),
    );
  await render("first");
  const tabs = host.querySelector('[aria-label="Source preview view"]');
  const preview = button("Preview");
  assert.ok(tabs);
  assert.ok(preview);
  assert.equal(button("Toggle document navigation"), undefined);
  await resolve("first");
  assert.equal(host.querySelector('[aria-label="Source preview view"]'), tabs);
  assert.equal(button("Preview"), preview);
  await render("second");
  assert.equal(host.querySelector('[aria-label="Source preview view"]'), tabs);
  assert.equal(button("Preview"), preview);
  assert.equal(button("Toggle document navigation"), undefined);
  assert.ok(host.querySelector('[aria-busy="true"]'));
  await resolve("second");
  assert.equal(host.querySelector('[aria-label="Source preview view"]'), tabs);
  assert.equal(button("Preview"), preview);
  assert.equal(button("Toggle document navigation"), undefined);
});

test("hovering retrieval paths narrows an open preview without opening a closed sidebar", async () => {
  const previousEventSource = globalThis.EventSource;
  globalThis.EventSource = class {
    addEventListener() {}
    close() {}
  } as unknown as typeof EventSource;
  const blocks = Array.from({ length: 4 }, (_, i) => ({
    id: `block-${i}`,
    type: "paragraph",
    content: `Evidence ${i}`,
    page: i + 1,
  }));
  const section = (id: string, index: number, children: IndexNode[] = []) => ({
    id,
    title: id,
    summary: "",
    content: blocks[index].content,
    page: index + 1,
    endPage: Math.max(index + 1, 3),
    links: [],
    blocks: [blocks[index]],
    children,
  });
  const trace = [
    { stage: "document", resourceId: "source", label: "Document" },
    {
      stage: "section",
      resourceId: "source",
      nodeId: "overview",
      label: "Overview",
      page: 1,
    },
    {
      stage: "section",
      resourceId: "source",
      nodeId: "details",
      parentNodeId: "overview",
      label: "Details",
      page: 2,
    },
    {
      stage: "section",
      resourceId: "source",
      nodeId: "passage",
      parentNodeId: "details",
      label: "Passage",
      page: 3,
    },
  ];
  const resource = {
    id: "source",
    name: "Document.bin",
    kind: "document",
    mime: "application/octet-stream",
    status: "ready",
    pages: 4,
    parsed: {
      blocks,
      nodes: [
        section("overview", 0, [
          section("details", 1, [section("passage", 2)]),
        ]),
        section("other", 3),
      ],
    },
  };
  globalThis.fetch = async (input) => {
    const path = String(input);
    if (path === "/api/chats")
      return Response.json([{ id: "chat", title: "Chat" }]);
    if (path === "/api/chats/chat")
      return Response.json({
        id: "chat",
        title: "Chat",
        blocked: false,
        turns: [],
        messages: [
          {
            role: "assistant",
            content: "Answer [1]",
            trace,
            sources: [
              {
                documentId: "source",
                nodeId: "passage",
                name: "Document.bin",
                title: "Passage",
                page: 3,
                blockIds: ["block-2"],
              },
            ],
          },
        ],
      });
    return Response.json(resource);
  };
  const row = (scope: Element, label: string) => {
    const element = [
      ...scope.querySelectorAll<HTMLButtonElement>("button.retrieval-node"),
    ].find((e) => e.querySelector("span")?.textContent === label);
    assert.ok(element);
    return element;
  };
  const hover = async (element: Element) => {
    const event = new MouseEvent("mousemove", { bubbles: true });
    Object.defineProperty(event, "movementX", { value: 1 });
    await act(async () => element.dispatchEvent(event));
  };
  try {
    await act(async () =>
      root.render(
        <ChatView
          me={{ chatEnabled: true } as Me}
          chatId="chat"
          onTitleChange={() => {}}
          onChatChange={() => {}}
          onOpen={() => {}}
          onSettings={() => {}}
        />,
      ),
    );
    const messageTree = host.querySelector(
      ".chat-answer-details .retrieval-trace",
    );
    assert.ok(messageTree);
    await click(messageTree.querySelector(".retrieval-trigger"));
    await hover(row(messageTree, "Passage"));
    assert.equal(host.querySelector(".chat-source-panel"), null);
    await click(row(messageTree, "Document"));
    const sidebar = host.querySelector(".chat-source-panel");
    assert.ok(sidebar);
    const sidebarTree = sidebar.querySelector(".retrieval-trace");
    assert.ok(sidebarTree);
    assert.equal(
      sidebarTree
        .querySelector(".retrieval-trigger")
        ?.getAttribute("aria-expanded"),
      "true",
    );
    assert.ok(button("Source blocks 4", sidebar));
    const openDocument = sidebar.querySelector<HTMLAnchorElement>(
      '.source-preview-heading a[aria-label="Open full document"]',
    );
    assert.ok(openDocument);
    assert.equal(
      openDocument.getAttribute("href"),
      "/library/documents/source?tab=index",
    );
    assert.equal(openDocument.target, "_blank");
    assert.equal(sidebar.querySelector(".source-document-heading"), null);
    for (const [label, count] of [
      ["Overview", 3],
      ["Details", 2],
      ["Passage", 1],
    ] as const) {
      await hover(row(sidebarTree, label));
      assert.ok(button(`Source blocks ${count}`, sidebar));
      assert.equal(row(sidebarTree, label).getAttribute("data-active"), "true");
      assert.equal(
        openDocument.getAttribute("href"),
        `/library/documents/source?node=${label.toLowerCase()}&tab=index`,
      );
    }
    await act(async () => row(sidebarTree, "Document").focus());
    assert.ok(button("Source blocks 4", sidebar));
    await click(sidebarTree.querySelector(".retrieval-trigger"));
    assert.equal(
      sidebarTree
        .querySelector(".retrieval-trigger")
        ?.getAttribute("aria-expanded"),
      "false",
    );
    await click(button("Close source preview", sidebar));
    await hover(row(messageTree, "Overview"));
    assert.equal(host.querySelector(".chat-source-panel"), null);
    const citation = host.querySelector(".chat-source-chip");
    assert.ok(citation);
    await act(async () => {
      citation.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    const citationPreview = host.querySelector(".chat-source-panel");
    assert.ok(citationPreview);
    await click(button("Source blocks 1", citationPreview));
    assert.equal(citationPreview.querySelectorAll(".parsed-block").length, 1);
    assert.equal(
      citationPreview
        .querySelector(".parsed-block")
        ?.getAttribute("data-block-id"),
      "block-2",
    );
    await act(async () => {
      citation.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      citation.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    assert.equal(host.querySelector(".chat-source-panel"), citationPreview);
    assert.equal(
      button("Preview", citationPreview)?.getAttribute("aria-selected"),
      "true",
    );
  } finally {
    globalThis.EventSource = previousEventSource;
  }
});

test("index tree supports roving focus, expansion, selection, and typeahead", async () => {
  const { DocumentIndexTree } =
    await import("../src/components/document-index-tree");
  const makeNode = (
    id: string,
    title: string,
    children: import("../src/lib/api").IndexNode[] = [],
  ): import("../src/lib/api").IndexNode => ({
    id,
    title,
    children,
    page: 1,
    endPage: 1,
    summary: "",
    content: "",
    blocks: [],
    links: [],
  });
  const nodes = [
    makeNode("a", "Alpha", [makeNode("b", "Beta"), makeNode("c", "Charlie")]),
    makeNode("d", "Delta"),
  ];
  const selected: string[] = [];
  const render = (selection: string) =>
    root.render(
      <DocumentIndexTree
        nodes={nodes}
        selected={selection}
        onSelect={(node) => selected.push(node.id)}
      />,
    );
  await act(async () => render("a"));
  const item = (name: string) =>
    host.querySelector<HTMLElement>(
      `[role="treeitem"][aria-label="${name}, page 1"]`,
    )!;
  const press = async (key: string) =>
    act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });
  await act(async () => item("Alpha").focus());
  assert.equal(
    host.querySelectorAll('[role="treeitem"][tabindex="0"]').length,
    1,
  );
  assert.equal(item("Beta").parentElement?.getAttribute("role"), "group");
  await press("ArrowRight");
  assert.equal(document.activeElement, item("Beta"));
  await press("ArrowDown");
  assert.equal(document.activeElement, item("Charlie"));
  await press("ArrowLeft");
  assert.equal(document.activeElement, item("Alpha"));
  await press("ArrowLeft");
  assert.equal(item("Alpha").getAttribute("aria-expanded"), "false");
  assert.equal(host.querySelectorAll('[role="treeitem"]').length, 2);
  await press("ArrowDown");
  assert.equal(document.activeElement, item("Delta"));
  await press("Home");
  await press("ArrowRight");
  assert.equal(item("Alpha").getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, item("Alpha"));
  await press("End");
  await press("b");
  assert.equal(document.activeElement, item("Beta"));
  assert.deepEqual(selected, []);
  await press("Enter");
  await press(" ");
  assert.deepEqual(selected, ["b", "b"]);
  await press("ArrowLeft");
  await press("ArrowLeft");
  await act(async () => render("c"));
  assert.equal(item("Alpha").getAttribute("aria-expanded"), "true");
  assert.equal(item("Charlie").getAttribute("aria-selected"), "true");
  assert.equal(item("Charlie").tabIndex, 0);
  assert.equal(document.activeElement, item("Alpha"));
});

test("upload notifications are summarized once for a completed batch", async () => {
  const { mutationSuccessMessage, notifyUploads } =
    await import("../src/lib/notifications");
  const messages: string[] = [];
  const listener = (event: Event) =>
    messages.push((event as CustomEvent<string>).detail);
  window.addEventListener("app-success", listener);
  try {
    assert.equal(mutationSuccessMessage("/documents", "POST"), undefined);
    notifyUploads(0);
    notifyUploads(3);
    assert.deepEqual(messages, ["3 documents uploaded"]);
  } finally {
    window.removeEventListener("app-success", listener);
  }
});

test("Finder grid marquee selects intersecting files, adds to selection, and restores selection on cancellation", async () => {
  await act(async () =>
    root.render(
      <FileSystem
        defaultView="icons"
        items={[
          { kind: "file", path: "Alpha.txt" },
          { kind: "file", path: "Beta.txt" },
          { kind: "file", path: "Gamma.txt" },
        ]}
      />,
    ),
  );
  const viewport = host
    .querySelector('[role="listbox"]')!
    .closest('[data-slot="scroll-area-viewport"]')!;
  assert.ok(viewport);
  Object.defineProperties(viewport, {
    clientWidth: { value: 350 },
    clientHeight: { value: 400 },
  });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 350, 400);
  const pointer = async (
    type: string,
    x: number,
    y: number,
    modifiers = {},
  ) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      ...modifiers,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: "mouse" },
    });
    await act(async () => viewport.dispatchEvent(event));
  };
  const selected = () =>
    [...host.querySelectorAll('[data-entry-path][aria-selected="true"]')].map(
      (e) => e.getAttribute("data-entry-path"),
    );
  await pointer("pointerdown", 2, 2);
  await pointer("pointermove", 150, 220);
  assert.deepEqual(selected(), ["Alpha.txt", "Beta.txt"]);
  assert.ok(host.querySelector('[data-slot="selection-marquee"]'));
  await pointer("pointerup", 150, 220);
  assert.equal(host.querySelector('[data-slot="selection-marquee"]'), null);
  await pointer("pointerdown", 2, 245, { metaKey: true });
  await pointer("pointermove", 150, 310);
  assert.deepEqual(selected(), ["Alpha.txt", "Beta.txt", "Gamma.txt"]);
  await pointer("pointercancel", 150, 310);
  assert.deepEqual(selected(), ["Alpha.txt", "Beta.txt"]);
});

for (const view of ["icons", "columns", "gallery"] as const) {
  test(`Finder ${view} supports toggle and range selection and preserves it for bulk deletion`, async () => {
    let deleted: string[] = [];
    await act(async () =>
      root.render(
        <FileSystem
          defaultView={view}
          items={[
            { kind: "file", path: "Alpha.txt" },
            { kind: "file", path: "Beta.txt" },
            { kind: "file", path: "Gamma.txt" },
          ]}
          onDeleteItems={(items) => {
            deleted = items.map((item) => item.path);
          }}
        />,
      ),
    );
    const item = (name: string) =>
      host.querySelector(`[data-entry-path="${name}.txt"]`)!;
    const choose = async (name: string, modifiers = {}) =>
      act(async () =>
        item(name).dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            ...modifiers,
          }),
        ),
      );
    await choose("Alpha");
    await choose("Gamma", { metaKey: true });
    assert.equal(host.querySelectorAll('[aria-selected="true"]').length, 2);
    await choose("Gamma", { metaKey: true });
    assert.equal(host.querySelectorAll('[aria-selected="true"]').length, 1);
    await choose("Alpha");
    await choose("Gamma", { shiftKey: true });
    assert.equal(host.querySelectorAll('[aria-selected="true"]').length, 3);
    await act(async () =>
      item("Beta").dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
        }),
      ),
    );
    assert.equal(host.querySelectorAll('[aria-selected="true"]').length, 3);
    const remove = [...document.querySelectorAll('[role="menuitem"]')].find(
      (element) => element.textContent?.includes("Delete 3 items"),
    );
    assert.ok(remove);
    await click(remove);
    assert.deepEqual(deleted.sort(), ["Alpha.txt", "Beta.txt", "Gamma.txt"]);
  });
}

test("Finder Organize targets the full selection and is disabled for folders or ineligible documents", async () => {
  let organized: string[] = [];
  await act(async () =>
    root.render(
      <FileSystem
        defaultView="columns"
        items={[
          { kind: "file", path: "Alpha.txt" },
          { kind: "file", path: "Beta.txt" },
          { kind: "file", path: "Unavailable.txt" },
          { kind: "folder", path: "Folder/" },
        ]}
        onOrganizeItems={(items) => {
          organized = items.map(({ path }) => path);
        }}
        canOrganize={(item) => item.path !== "Unavailable.txt"}
      />,
    ),
  );
  const entry = (path: string) =>
    host.querySelector(`[data-entry-path="${path}"]`)!;
  const context = (path: string) =>
    act(async () =>
      entry(path).dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
        }),
      ),
    );
  await click(entry("Alpha.txt"));
  await act(async () =>
    entry("Beta.txt").dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    ),
  );
  await context("Beta.txt");
  const organize = () =>
    [...document.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Organize",
    )!;
  assert.ok(organize());
  await click(organize());
  assert.deepEqual(organized, ["Alpha.txt", "Beta.txt"]);
  await context("Unavailable.txt");
  assert.equal(organize().getAttribute("aria-disabled"), "true");
  await act(async () =>
    organize().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  await context("Folder/");
  assert.equal(organize().getAttribute("aria-disabled"), "true");
});

test("coss toasts stack with filled status icons and support downward swipe dismissal", async () => {
  const { toastManager } = await import("../src/components/coss/toast");
  await act(async () => root.render(<ToastProvider>{null}</ToastProvider>));
  let first = "";
  let second = "";
  await act(async () => {
    first = toastManager.add({
      title: "First notification",
      type: "success",
      timeout: 0,
    });
    second = toastManager.add({
      title: "Second notification",
      type: "success",
      timeout: 0,
    });
  });
  const toasts = document.querySelectorAll<HTMLElement>(
    '[data-slot="toast-root"]',
  );
  assert.equal(toasts.length, 2);
  assert.ok(toasts[0].querySelector('svg path[fill="currentColor"]'));
  const pointer = (type: string, clientY: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 200,
      clientY,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: "mouse" },
    });
    return event;
  };
  await act(async () => {
    toasts[0].dispatchEvent(pointer("pointerdown", 200));
  });
  await act(async () => {
    toasts[0].dispatchEvent(pointer("pointermove", 204));
  });
  await act(async () => {
    toasts[0].dispatchEvent(pointer("pointermove", 280));
  });
  await act(async () => {
    toasts[0].dispatchEvent(pointer("pointerup", 280));
  });
  assert.ok(toasts[0].hasAttribute("data-ending-style"), toasts[0].outerHTML);
  await act(async () => {
    toastManager.close(first);
    toastManager.close(second);
  });
});

test("attachment picker searches document contents on Enter and keeps attachment badges and preview slots", async () => {
  const { ChatComposerTools, ChatAttachments } =
    await import("../src/components/chat-composer-tools");
  const { useState } = await import("react");
  const resources = ["Alpha", "Beta"].map((name) => ({
    id: name.toLowerCase(),
    name: `${name}.bin`,
    kind: "document",
    status: "ready",
    mime: "application/octet-stream",
  })) as import("../src/lib/api").Resource[];
  const searches: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "/api/resources") return Response.json(resources);
    if (String(input) === "/api/search") {
      searches.push(JSON.parse(String(init?.body)).query);
      return Response.json({
        results: [{ documentId: "beta", title: "Matched section" }],
      });
    }
    throw new Error("Unexpected request");
  };
  function Picker() {
    const [attachments, setAttachments] = useState<
      import("../src/lib/api").Resource[]
    >([]);
    return (
      <>
        <ChatAttachments
          attachments={attachments}
          disabled={false}
          onRemove={() => {}}
        />
        <ChatComposerTools
          me={{ chatModels: [] } as unknown as Me}
          attachments={attachments}
          setAttachments={setAttachments}
          selectedModel=""
          onModelChange={() => {}}
          onSettings={() => {}}
          disabled={false}
          onBusyChange={() => {}}
          mentionQuery={null}
          onMentionClose={() => {}}
          onMentionAttach={() => {}}
        />
      </>
    );
  }
  await act(async () => root.render(<Picker />));
  await click(button("Attach documents"));
  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Find a document to attach"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "content query");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(document.querySelectorAll('[role="option"]').length, 0);
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  assert.deepEqual(searches, ["content query"]);
  const option = document.querySelector('[role="option"]')!;
  assert.ok(option.textContent?.includes("Beta.bin"));
  assert.equal(option.querySelectorAll('[data-slot="badge"]').length, 2);
  assert.ok(option.querySelector("[data-resource-thumbnail]"));
  await click(option);
  assert.ok(
    document.querySelector(".chat-attachment [data-resource-thumbnail]"),
  );
  assert.ok(
    document
      .querySelector(".chat-attachment")
      ?.textContent?.includes("Beta.bin"),
  );
});

test("promise toasts keep their identity while changing from loading to success or a visible error", async () => {
  const { toastManager } = await import("../src/components/coss/toast");
  await act(async () => root.render(<ToastProvider>{null}</ToastProvider>));
  let resolve!: (value: number) => void;
  const pending = new Promise<number>((done) => {
    resolve = done;
  });
  let result!: Promise<number>;
  await act(async () => {
    result = toastManager.promise(pending, {
      loading: "Organizing…",
      success: (count) => `${count} documents organized`,
      error: "Failed",
    });
  });
  const toast = document.querySelector<HTMLElement>(
    '[data-slot="toast-root"]',
  )!;
  assert.ok(
    toast.textContent?.includes("Organizing…"),
    "Loading message should be visible",
  );
  assert.equal(toast.getAttribute("data-type"), "loading");
  assert.ok(
    toast.querySelector("svg .loader-lines"),
    "Loading toast should have an activity indicator",
  );
  await act(async () => {
    resolve(2);
    await result;
  });
  assert.ok(
    document.querySelector('[data-slot="toast-root"]') === toast,
    "The promise toast should update in place",
  );
  assert.ok(toast.textContent?.includes("2 documents organized"));
  assert.equal(toast.getAttribute("data-type"), "success");
  await act(async () => {
    toastManager.close();
  });
  let reject!: (error: Error) => void;
  const failing = new Promise<void>((_done, fail) => {
    reject = fail;
  });
  let failure!: Promise<void>;
  await act(async () => {
    failure = toastManager.promise(failing, {
      loading: "Organizing…",
      success: "Done",
      error: (error) => ({
        title: "Couldn't organize documents",
        description: error.message,
      }),
    });
  });
  await act(async () => {
    reject(new Error("Connect TypeSafe to continue."));
    await assert.rejects(failure, /Connect TypeSafe/);
  });
  const errorToast = [
    ...document.querySelectorAll('[data-slot="toast-root"]'),
  ].find((node) => node.textContent?.includes("Couldn't organize documents"));
  assert.ok(errorToast?.textContent?.includes("Connect TypeSafe to continue."));
  assert.ok(errorToast?.querySelector("svg.text-destructive"));
  await act(async () => {
    toastManager.close();
  });
});

test("API rate-limit errors remain readable when a server returns plain text", async () => {
  const { api, ApiError } = await import("../src/lib/api");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("Too many requests, please try again later.", {
        status: 429,
      });
    await assert.rejects(
      api("/documents/organize", { method: "POST" }),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 429 &&
        error.message === "Too many requests. Wait a moment and try again.",
    );
    globalThis.fetch = async () =>
      Response.json(
        { error: "Too many requests. Wait a moment and try again." },
        { status: 429 },
      );
    await assert.rejects(
      api("/documents/organize", { method: "POST" }),
      /Too many requests/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
