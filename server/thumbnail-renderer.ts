import express from "express";
import { resolve } from "node:path";
import { createServer as createHttpServer, type Server } from "node:http";
import { chromium, type Browser } from "playwright";
import type { ViteDevServer } from "vite";

export function createThumbnailRenderer() {
  let browser: Browser | undefined;
  let server: Server | undefined;
  let vite: ViteDevServer | undefined;
  let origin: string | undefined;
  let starting: Promise<void> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  async function start() {
    if (!server) {
      const app = express();
      const listener = createHttpServer(app);
      app.disable("x-powered-by");
      if (process.env.NODE_ENV === "production") {
        app.use(express.static(resolve("dist")));
      } else {
        const { createServer } = await import("vite");
        vite = await createServer({
          cacheDir: resolve(`node_modules/.vite/thumbnails-${process.pid}`),
          server: { middlewareMode: true, hmr: { server: listener }, watch: null },
          appType: "mpa",
        });
        app.use(vite.middlewares);
      }
      server = listener.listen(0, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        server!.once("listening", resolve);
        server!.once("error", reject);
      });
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Renderer unavailable");
      origin = `http://127.0.0.1:${address.port}`;
    }
    if (!browser?.isConnected()) {
      browser = await chromium.launch({
        headless: true,
        chromiumSandbox: process.env.THUMBNAIL_CHROMIUM_SANDBOX === "true",
        timeout: 30_000,
      });
    }
  }
  return {
    async render(
      body: Buffer,
      name: string,
      mime: string,
      signal: AbortSignal,
    ) {
      signal.throwIfAborted();
      clearTimeout(idle);
      starting ??= start().finally(() => {
        starting = undefined;
      });
      await starting;
      signal.throwIfAborted();
      const context = await browser!.newContext({
        viewport: { width: 1024, height: 1024 },
        deviceScaleFactor: 1,
        serviceWorkers: "block",
      });
      const abort = () => {
        void context.close();
      };
      const timeout = setTimeout(abort, 60_000);
      signal.addEventListener("abort", abort, { once: true });
      try {
        await context.routeWebSocket("**/*", (socket) => socket.close());
        await context.route("**/*", (route) => {
          const url = new URL(route.request().url());
          return url.origin === origin ||
            ["blob:", "data:"].includes(url.protocol)
            ? route.continue()
            : route.abort();
        });
        const page = await context.newPage();
        await page.goto(`${origin}/thumbnail-renderer.html`, {
          timeout: 30_000,
        });
        await page.waitForFunction(
          () => typeof window.renderThumbnail === "function",
          undefined,
          { timeout: 30_000 },
        );
        const result = await page.evaluate(
          (input) => window.renderThumbnail(input),
          {
            base64: body.toString("base64"),
            name,
            mime,
          },
        );
        signal.throwIfAborted();
        if (!/^data:image\/(png|webp);base64,/.test(result.dataUrl))
          throw new Error("Invalid thumbnail");
        return {
          body: Buffer.from(result.dataUrl.split(",")[1], "base64"),
          pageCount: result.pageCount,
        };
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        await context.close();
        idle = setTimeout(() => {
          void browser?.close();
          browser = undefined;
        }, 60_000);
        idle.unref();
      }
    },
    async close() {
      clearTimeout(idle);
      await starting?.catch(() => {});
      await browser?.close();
      await vite?.close();
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
    },
  };
}
