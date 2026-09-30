import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
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
) {
  const router = Router();
  router.post("/", async (req, res, next) => {
    try {
      const principal = await access.authenticate(req, "/mcp");
      const revalidate = () => access.authenticate(req, "/mcp");
      const server = new McpServer({ name: "jevbox", version: "1.0.0" });
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
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
          inputSchema: {},
          annotations,
        },
        () => respond(async () => access.organizations(await revalidate())),
      );
      if (principal.scopes.includes("search:read"))
        server.registerTool(
          "search",
          {
            description:
              "Search the accessible document hierarchy for relevant source passages. Returns document and passage IDs, citations, and URLs. Results are bounded; empty results do not prove a topic is absent.",
            inputSchema: searchInput.shape,
            annotations,
          },
          (input, extra) =>
            respond(() =>
              access.search(principal, input, revalidate, extra.signal),
            ),
        );
      if (principal.scopes.includes("documents:read"))
        server.registerTool(
          "fetch",
          {
            description:
              "Read a document, section, or search result ID. Returns source text, page references, and the document tree. Follow nextOffset to read more text.",
            inputSchema: fetchInput.shape,
            annotations,
          },
          (input) => respond(() => access.read(principal, input, revalidate)),
        );
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => {
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (error instanceof HttpError && [401, 403].includes(error.status))
        res.set("WWW-Authenticate", access.challenge(req, error));
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
