import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "better-auth/node";
import type { createAuthentication } from "./auth";
import { Router } from "express";
import { z } from "zod";
import { HttpError } from "./db";
import {
  fetchInput,
  searchInput,
  type createExternalAccess,
} from "./external-access";

export function createMcpRouter(
  access: ReturnType<typeof createExternalAccess>,
  auth: ReturnType<typeof createAuthentication>["auth"],
  origin: string,
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
                      "Search the accessible document hierarchy for relevant source passages. Returns document and passage IDs, citations, and URLs. Results are bounded; empty results do not prove a topic is absent.",
                    inputSchema: searchInput,
                    annotations,
                  },
                  (input, extra) =>
                    respond(() =>
                      access.search(
                        principal,
                        input,
                        revalidate,
                        extra.mcpReq.signal,
                      ),
                    ),
                );
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
