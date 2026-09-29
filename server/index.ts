import { createApp } from "./app";
import { resolve } from "node:path";
import express from "express";
const port = Number(process.env.PORT ?? 4310);
const origin = process.env.APP_ORIGIN ?? `http://localhost:${port}`;
const runtime = await createApp({
  directory: resolve(process.env.DATA_DIR ?? ".data"),
  origin,
  secure: origin.startsWith("https://"),
});
if (process.env.NODE_ENV === "production") {
  runtime.app.use(express.static(resolve("dist"), { index: false }));
  runtime.app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    cacheDir: resolve(`node_modules/.vite/jevbox-${port}`),
    server: { middlewareMode: true },
    appType: "spa",
  });
  runtime.app.use(vite.middlewares);
}
const server = runtime.app.listen(port, process.env.HOST ?? "127.0.0.1", () =>
  console.log(`Jevbox is running at ${origin}`),
);
const tick = () =>
  runtime
    .tick()
    .catch(() => console.error("Indexing worker is temporarily unavailable"));
const interval = setInterval(() => void tick(), 3000);
const chatInterval = setInterval(
  () => void runtime.tickChats().catch(() => {}),
  1000,
);
void runtime.tickChats();
const cleanup = setInterval(
  () =>
    void runtime.store
      .cleanupPermissions()
      .catch(() =>
        console.error("Permission cleanup is temporarily unavailable"),
      ),
  60000,
);
void tick();
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    clearInterval(interval);
    clearInterval(chatInterval);
    clearInterval(cleanup);
    void runtime.closeChats().then(() => {
      server.close(
        () => void runtime.store.close().then(() => process.exit(0)),
      );
    });
  });
