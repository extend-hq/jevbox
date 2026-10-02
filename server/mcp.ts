import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "better-auth/node";
import type { createAuthentication } from "./auth";
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "./db";
import { uploadInput, type createUploads } from "./uploads";
import {
  answerInput,
  runSearchInput,
  runInput,
  listRunsInput,
  type createRuns,
} from "./runs";
import { fetchInput, type createExternalAccess } from "./external-access";

export function createMcpRouter(
  access: ReturnType<typeof createExternalAccess>,
  auth: ReturnType<typeof createAuthentication>["auth"],
  origin: string,
  uploads: ReturnType<typeof createUploads>,
  runs: ReturnType<typeof createRuns>,
) {
  const router = Router();
  router.post("/", async (req, res, next) => {
    try {
      const handler = toNodeHandler(async (incoming) => {
        const request = new globalThis.Request(
          new URL(req.originalUrl, origin),
          incoming,
        );
        const serve = async (
          principal: Awaited<ReturnType<typeof access.authenticate>>,
          revalidate: () => Promise<typeof principal>,
        ) => {
          const protocol = createMcpHandler(
            () => {
              const server = new McpServer({
                name: "jevbox",
                version: "1.0.0",
              });
              const annotations = {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              };
              async function respond(work: () => Promise<object>) {
                try {
                  const result = await work();
                  return {
                    content: [
                      { type: "text" as const, text: JSON.stringify(result) },
                    ],
                    structuredContent: result as Record<string, unknown>,
                  };
                } catch (error) {
                  const message =
                    error instanceof HttpError
                      ? error.message
                      : error instanceof z.ZodError
                        ? "Invalid input"
                        : "The request could not be completed. Please retry.";
                  return {
                    isError: true,
                    content: [{ type: "text" as const, text: message }],
                  };
                }
              }
              server.registerTool(
                "list_organizations",
                {
                  description:
                    "List your accessible organizations. Use an organization ID with search and fetch.",
                  inputSchema: z.object({}),
                  annotations,
                },
                () =>
                  respond(async () => access.organizations(await revalidate())),
              );
              if (principal.scopes.includes("search:read"))
                server.registerTool(
                  "search",
                  {
                    description:
                      "Search the accessible document hierarchy for relevant source passages. Accepted searches continue after disconnects. Returns results when ready within waitSeconds (default 2, maximum 10), otherwise a runId to poll with get_run. Set waitSeconds to 0 to return immediately. Reuse a requestId UUID to retry admission safely. Results are bounded; empty results do not prove a topic is absent.",
                    inputSchema: runSearchInput,
                    annotations,
                  },
                  (input, extra) =>
                    respond(async () => {
                      const current = await revalidate();
                      const run = await runs.startSearch(
                        current,
                        input,
                        await access.delegate(current, req),
                      );
                      const state = await runs.wait(
                        current,
                        {
                          organizationId: input.organizationId,
                          runId: run.runId,
                        },
                        input.waitSeconds,
                        extra.mcpReq.signal,
                      );
                      return {
                        ...state,
                        ...(state.kind === "search" &&
                        state.result &&
                        "results" in state.result
                          ? state.result
                          : {}),
                      };
                    }),
                );
              if (principal.scopes.includes("search:read")) {
                for (const [name, description, schema, handler] of [
                  [
                    "get_run",
                    "Get the current status and saved output of one of your runs. Completed search runs include results; answer runs include partialText or the cited final answer. Recheck until a terminal status, respecting a short delay between calls.",
                    runInput,
                    runs.get,
                  ],
                  [
                    "list_runs",
                    "List your recent runs in an organization to recover run IDs after reconnecting or restarting. Results are retained for 24 hours; answer conversations remain available in web chat.",
                    listRunsInput,
                    runs.list,
                  ],
                  [
                    "cancel_run",
                    "Explicitly stop one of your runs. Disconnecting does not stop an accepted background run. Completed runs remain completed.",
                    runInput,
                    runs.cancel,
                  ],
                ] as const)
                  server.registerTool(
                    name,
                    {
                      description,
                      inputSchema: schema,
                      annotations: {
                        ...annotations,
                        readOnlyHint: name !== "cancel_run",
                      },
                    },
                    (input: unknown) =>
                      respond(async () => handler(await revalidate(), input)),
                  );
                if (principal.scopes.includes("documents:read"))
                  server.registerTool(
                    "answer",
                    {
                      description:
                        "Start a source-grounded answer using the organization's configured chat model. Returns a runId immediately; generation continues on the server after the client disconnects or closes. Poll get_run for partialText and the cited final answer, or open the returned web chat URL. Reuse a requestId UUID to retry admission safely. This uses the organization's provider credits and saves a private conversation.",
                      inputSchema: answerInput,
                      annotations: {
                        ...annotations,
                        readOnlyHint: false,
                        idempotentHint: false,
                      },
                    },
                    (input) =>
                      respond(async () => {
                        const current = await revalidate();
                        return runs.startAnswer(
                          current,
                          input,
                          await access.delegate(current, req),
                        );
                      }),
                  );
              }
              if (principal.scopes.includes("documents:read"))
                server.registerTool(
                  "fetch",
                  {
                    description:
                      "Read a document, section, or search result ID. Returns source text, page references, and the document tree. Follow nextOffset to read more text.",
                    inputSchema: fetchInput,
                    annotations,
                  },
                  (input) =>
                    respond(() => access.read(principal, input, revalidate)),
                );
              if (principal.scopes.includes("documents:write"))
                server.registerTool(
                  "upload_document",
                  {
                    description:
                      "Upload one file as a Private document in an organization you belong to. Provide the filename and standard padded base64 file bytes, up to 2 MiB decoded. Optional parentId must be a writable folder. Processing is asynchronous; queued documents are not searchable until ready. Use POST /api/v1/documents multipart uploads for files up to 30 MiB. Never fetch a URL or send local file contents without the user's authorization.",
                    inputSchema: uploadInput,
                    annotations: {
                      readOnlyHint: false,
                      destructiveHint: false,
                      idempotentHint: false,
                      openWorldHint: false,
                    },
                  },
                  (input) =>
                    respond(() =>
                      access.upload(
                        principal,
                        input,
                        revalidate,
                        uploads.lease(req)?.signal,
                      ),
                    ),
                );
              return server;
            },
            { legacy: "stateless" },
          );
          return protocol.fetch(request);
        };
        const principal = await access.authenticate(req, "/mcp");
        return serve(principal, () => access.authenticate(req, "/mcp"));
      });
      await handler(req, res);
    } catch (error) {
      if ([401, 403].includes(access.status(error))) {
        const header = access.challenge(req, error);
        if (header) res.set("WWW-Authenticate", header);
      }
      next(error);
    } finally {
      uploads.lease(req)?.release();
    }
  });
  router.all("/", (_req, res) =>
    res
      .status(405)
      .set("Allow", "POST")
      .json({ error: "Use POST for MCP requests" }),
  );
  return router;
}
