import { queues } from "../server/jobs";
import { hashPassword } from "../server/auth-passwords";
import { testDatabase } from "../tests/database";
import { createApp } from "../server/app";
import { createServer } from "vite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import { buildIndex } from "../server/indexing";
import { searchToolResponse, choiceResponse } from "../tests/model-tools";
const port = Number(process.env.FIXTURE_PORT ?? 4312);
const origin = `http://localhost:${port}`;
const fetcher: typeof fetch = async (url, init) => {
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
  if (String(url).includes("typesafe")) {
    if (body.questions.usefulness)
      return Response.json({
        answers: { usefulness: { type: "score", score: 3 } },
      });
    return choiceResponse(body);
  }
  if (String(url).includes("openai") && body.stream) {
    const toolResponse = searchToolResponse(body);
    if (toolResponse) return toolResponse;
    const text =
      "The library organizes knowledge into **categories, documents, sections, and pages** [1]. Access is restricted by default and every answer links back to its source [1].";
    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setTimeout>;
    return new Response(
      new ReadableStream({
        start(controller) {
          const words = text.split(/(?<= )/);
          let index = 0;
          let closed = false;
          const abort = () => {
            clearTimeout(timer);
            if (!closed) {
              closed = true;
              controller.error(new Error("Stopped"));
            }
          };
          init?.signal?.addEventListener("abort", abort, { once: true });
          const write = () => {
            if (closed) return;
            const done = index >= words.length;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: done ? {} : { content: words[index++] }, finish_reason: done ? "stop" : null }] })}\n\n`,
              ),
            );
            if (done) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              closed = true;
              controller.close();
              init?.signal?.removeEventListener("abort", abort);
            } else
              timer = setTimeout(
                write,
                Number(process.env.FIXTURE_CHAT_DELAY_MS ?? 180),
              );
          };
          write();
        },
        cancel() {
          clearTimeout(timer);
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }
  if (String(url).includes("openai"))
    return Response.json({
      id: "fixture",
      object: "chat.completion",
      created: 1,
      model: "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content:
              "The library organizes knowledge into **categories, documents, sections, and pages** [1]. Access is restricted by default and every answer links back to its source [1].",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
  throw new Error("Unexpected provider request");
};
const database = await testDatabase();
const runtime = await createApp({
  workers: Object.values(queues),
  databaseUrl: database.url,
  directory: mkdtempSync(join(tmpdir(), "jevbox-browser-")),
  origin,
  fetcher,
  rateLimits: false,
});
const user = randomUUID(),
  org = randomUUID(),
  folder = randomUUID(),
  colleague = randomUUID();
const password = "Local-verification-2026!";
for (const [uid, email, displayName] of [
  [user, "review@jevbox.test", "Review User"],
  [colleague, "colleague@jevbox.test", "Teammate"],
])
  await runtime.store.run(
    "INSERT INTO users(id,email,name,email_verified) VALUES(?,?,?,true)",
    uid,
    email,
    displayName,
  );
for (const uid of [user, colleague])
  await runtime.store.run(
    "INSERT INTO auth_accounts(id,account_id,provider_id,user_id,password) VALUES(?,?,'credential',?,?)",
    randomUUID(),
    uid,
    uid,
    await hashPassword(password),
  );
await runtime.store.run(
  "INSERT INTO orgs(id,name,settings) VALUES(?,?,?)",
  org,
  "Organization",
  runtime.store.encrypt(
    JSON.stringify({
      jevKey: "fixture-key",
      provider: "openai",
      model: "gpt-4.1-mini",
      credentials: {
        openai: {
          apiKey: "fixture-key",
          model: "gpt-4.1-mini",
          models: ["gpt-4.1"],
        },
      },
    }),
  ),
);
await runtime.store.run("INSERT INTO members VALUES(?,?,'admin')", org, user);
await runtime.store.run(
  "INSERT INTO members VALUES(?,?,'member')",
  org,
  colleague,
);
await runtime.store.run(
  "INSERT INTO resources(id,org_id,owner_id,kind,name,description,created) VALUES(?,?,?,'folder','Getting started','A guide to organizing and exploring the workspace.',?)",
  folder,
  org,
  user,
  new Date().toISOString(),
);
const markdown =
  "# A home for your knowledge\n\nJevbox organizes knowledge into categories, documents, sections, and pages.\n\n## Your library\n\nUse the Finder to browse documents. Create categories to keep related ideas together.\n\n### Permission-aware by design\n\nDocuments start restricted. Sharing applies to every page, search result, and chat citation.\n\n## Explore the connections\n\nEach document has an index, parsed output, and source links.\n\n| Surface | Purpose |\n| --- | --- |\n| Document | View the original |\n| Index | Navigate sections and pages |\n| Parsed output | Read structured content |\n\n## Further reading\n\n[Extend documentation](https://docs.extend.ai)\n\n[AI SDK documentation](https://ai-sdk.dev)";
const pdf = await PDFDocument.create();
const page = pdf.addPage([612, 792]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText("A home for your knowledge", {
  x: 60,
  y: 690,
  size: 24,
  font,
  color: rgb(0.2, 0.3, 0.4),
});
page.drawText("Categories. Documents. Sections. Pages.", {
  x: 60,
  y: 645,
  size: 13,
  font,
});
const files = [
  [
    "Workspace.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    readFileSync(new URL("../tests/fixtures/Workspace.docx", import.meta.url)),
  ],
  [
    "Workspace.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    readFileSync(new URL("../tests/fixtures/Workspace.xlsx", import.meta.url)),
  ],
  [
    "Workspace.pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    readFileSync(new URL("../tests/fixtures/Workspace.pptx", import.meta.url)),
  ],
  [
    "Configuration.ts",
    "text/plain",
    strToU8(
      "export interface Workspace {\n  id: string;\n  name: string;\n  restricted: boolean;\n}\n\nexport function canRead(workspace: Workspace) {\n  return !workspace.restricted;\n}\n",
    ),
  ],
  ["Workspace guide.md", "text/markdown", strToU8(markdown)],
  ["Workspace overview.pdf", "application/pdf", await pdf.save()],
  [
    "Project list.csv",
    "text/csv",
    strToU8(
      "Project,Status,Owner\nKnowledge library,Active,Team\nDocument index,Ready,Team\n",
    ),
  ],
  [
    "Configuration.json",
    "application/json",
    strToU8(
      JSON.stringify(
        {
          workspace: { title: "Studio", restrictedByDefault: true },
          hierarchy: ["category", "document", "section", "page"],
        },
        null,
        2,
      ),
    ),
  ],
  [
    "Preview.html",
    "text/html",
    strToU8(
      '<h1>Knowledge, connected.</h1><p>This document renders in a sandbox.</p><script>document.body.innerHTML="UNSAFE"</script><img src="https://example.org/track">',
    ),
  ],
  [
    "Diagram.svg",
    "image/svg+xml",
    strToU8(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#edf3f5"/><rect x="60" y="75" width="160" height="100" rx="12" fill="#abc1c9"/><path d="M220 125h120" stroke="#718fa0" stroke-width="3"/><rect x="340" y="75" width="180" height="100" rx="12" fill="#cedbdd"/><text x="88" y="130" font-family="sans-serif" fill="#345">Documents</text><text x="385" y="130" font-family="sans-serif" fill="#345">Answers</text></svg>',
    ),
  ],
  [
    "Source bundle.zip",
    "application/zip",
    zipSync({
      "readme.md": strToU8(markdown),
      "data.json": strToU8('{"ready":true}'),
    }),
  ],
];
for (const [name, mime, content] of files) {
  const rid = randomUUID();
  const bytes = content as Uint8Array;
  const stored = String(mime).includes("zip") || String(mime).includes("svg");
  const parsed = stored
    ? null
    : JSON.stringify(
        buildIndex(
          [
            {
              content:
                String(mime) === "application/pdf" ||
                String(mime).includes("openxmlformats")
                  ? "# A home for your knowledge\n\nCategories. Documents. Sections. Pages."
                  : new TextDecoder().decode(bytes),
              metadata: { pageRange: { start: 1, end: 1 } },
              ...(String(mime) === "application/pdf"
                ? {
                    blocks: [
                      {
                        id: "title",
                        type: "heading",
                        content: "A home for your knowledge",
                        metadata: {
                          page: { number: 1, width: 612, height: 792 },
                        },
                        boundingBox: {
                          left: 60,
                          top: 78,
                          right: 367,
                          bottom: 108,
                        },
                      },
                      {
                        id: "body",
                        type: "paragraph",
                        content: "Categories. Documents. Sections. Pages.",
                        metadata: {
                          page: { number: 1, width: 612, height: 792 },
                        },
                        boundingBox: {
                          left: 60,
                          top: 133,
                          right: 298,
                          bottom: 151,
                        },
                      },
                    ],
                  }
                : {}),
            },
          ],
          "text",
        ),
      );
  await runtime.store.run(
    "INSERT INTO resources(id,org_id,owner_id,parent_id,kind,name,mime,size,status,parsed,created) VALUES(?,?,?,?,'document',?,?,?,?,?,?)",
    rid,
    org,
    user,
    folder,
    String(name),
    String(mime),
    bytes.byteLength,
    stored ? "stored" : "ready",
    parsed,
    new Date().toISOString(),
  );
  await runtime.store.run("INSERT INTO blobs VALUES(?,?)", rid, bytes);
}
const vite = await createServer({
  cacheDir: `node_modules/.vite/fixture-${port}`,
  server: {
    middlewareMode: true,
    hmr: { port: Number(process.env.FIXTURE_HMR_PORT ?? 24679) },
  },
  appType: "spa",
});
runtime.app.use(vite.middlewares);
const server = runtime.app.listen(port, "127.0.0.1", () =>
  console.log(
    `Verification workspace: ${origin} · review@jevbox.test · Local-verification-2026!`,
  ),
);

let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void runtime.closeChats();
    server.close(
      () =>
        void (async () => {
          await vite.close();
          await runtime.close();
          await database.cleanup();
          process.exit(0);
        })(),
    );
  });
