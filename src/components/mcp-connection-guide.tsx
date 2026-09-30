import { useState, type ReactNode } from "react";
import { Button } from "./coss/button";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogPopup,
} from "./coss/dialog";
import { ScrollArea } from "./coss/scroll-area";
import { Tabs, TabsList, TabsTab, TabsPanel } from "./coss/tabs";
import { ProviderLogo } from "./provider-logo";
import { ArrowUpRight, Check, Code, Copy, PlugFilled } from "./icons";

type Client = "codex" | "claude" | "cursor" | "vscode" | "other";
type Screenshot = {
  src: string;
  alt: string;
  caption: string;
  source?: string;
};
type Step = { title: string; body: ReactNode };
type Guide = {
  id: Client;
  label: string;
  subtitle: string;
  docs: string;
  steps: Step[];
  snippet?: { label: string; text: string; description: string };
  screenshot?: Screenshot;
};

const screenshots = {
  claude: {
    src: "/guides/mcp/claude-connector.webp",
    alt: "Claude Add custom connector dialog with Name and MCP server URL fields.",
    caption: "Claude desktop · Add custom connector",
  },
  cursor: {
    src: "/guides/mcp/cursor-mcp.webp",
    alt: "Cursor New MCP Server menu with the User configuration option.",
    caption: "Cursor · Customize → MCPs → New MCP Server",
  },
  vscode: {
    src: "/guides/mcp/vscode-trust.webp",
    alt: "VS Code asks whether to trust and start an MCP server.",
    caption: "VS Code · Review the server trust prompt",
    source:
      "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
  },
} satisfies Record<string, Screenshot>;

function ClientLogo({ client, size = 18 }: { client: Client; size?: number }) {
  if (client === "codex" || client === "claude")
    return (
      <ProviderLogo
        provider={client === "codex" ? "openai" : "anthropic"}
        size={size}
      />
    );
  return client === "other" ? <PlugFilled size={size} /> : <Code size={size} />;
}

function makeGuides(url: string): Guide[] {
  const portableConfig = JSON.stringify(
    { mcpServers: { jevbox: { type: "http", url } } },
    null,
    2,
  );
  return [
    {
      id: "codex",
      label: "Codex",
      subtitle: "Give Codex access to your library in the app or terminal.",
      docs: "https://learn.chatgpt.com/docs/extend/mcp",
      steps: [
        {
          title: "Open MCP settings",
          body: (
            <>
              Open <strong>Settings → MCP servers</strong>, then choose{" "}
              <strong>Add server</strong>.
            </>
          ),
        },
        {
          title: "Add Jevbox",
          body: (
            <>
              Enter <strong>jevbox</strong> as the name, select{" "}
              <strong>Streamable HTTP</strong>, and paste the MCP URL above.
            </>
          ),
        },
        {
          title: "Sign in to your library",
          body: (
            <>
              Save, restart the connection, and select{" "}
              <strong>Authenticate</strong>. Sign in to Jevbox and approve
              search and document access.
            </>
          ),
        },
        {
          title: "Check the connection",
          body: (
            <>
              Type <code>/mcp</code> in a chat and check that Jevbox is
              connected. Then ask it to list your Jevbox organizations.
            </>
          ),
        },
      ],
      snippet: {
        label: "Or connect from the terminal",
        description:
          "Use a current Codex CLI. Its MCP configuration is shared with the desktop app.",
        text: `codex mcp add jevbox --url ${JSON.stringify(url)}\ncodex mcp login jevbox\ncodex mcp list`,
      },
    },
    {
      id: "claude",
      label: "Claude",
      subtitle:
        "Connect the Claude app, or use Claude Code for a local library.",
      docs: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
      screenshot: screenshots.claude,
      steps: [
        {
          title: "Open your connectors",
          body: (
            <>
              In Claude, open <strong>Customize → Connectors</strong>. Choose{" "}
              <strong>+ → Add custom connector</strong>.
            </>
          ),
        },
        {
          title: "Enter your server details",
          body: (
            <>
              Name it <strong>Jevbox</strong> and enter your deployed Jevbox
              HTTPS URL ending in <code>/mcp</code>. Claude desktop and web
              connect from the cloud.
            </>
          ),
        },
        {
          title: "Authorize Jevbox",
          body: (
            <>
              Continue through the connector setup, choose{" "}
              <strong>Connect</strong>, and sign in to Jevbox to approve read
              and search access.
            </>
          ),
        },
        {
          title: "Enable it in a conversation",
          body: (
            <>
              Open <strong>+ → Connectors</strong> in a chat, enable Jevbox, and
              ask Claude to list your Jevbox organizations.
            </>
          ),
        },
      ],
      snippet: {
        label: "Use Claude Code locally",
        description:
          "Run the command, start Claude Code, then use /mcp to select Jevbox and authenticate in your browser.",
        text: `claude mcp add --transport http --scope user jevbox ${JSON.stringify(url)}`,
      },
    },
    {
      id: "cursor",
      label: "Cursor",
      subtitle: "Bring document search and source passages into Cursor Agent.",
      docs: "https://cursor.com/help/customization/mcp",
      screenshot: screenshots.cursor,
      steps: [
        {
          title: "Open MCP customization",
          body: (
            <>
              Open <strong>Customize → MCPs → New MCP Server</strong>. Choose{" "}
              <strong>User</strong> for a personal connection across projects.
            </>
          ),
        },
        {
          title: "Add the configuration",
          body: (
            <>
              Add the configuration below to <code>~/.cursor/mcp.json</code>,
              merging it with any existing <code>mcpServers</code> entries.
            </>
          ),
        },
        {
          title: "Restart and authenticate",
          body: (
            <>
              Save and restart Cursor. Return to{" "}
              <strong>Customize → MCPs</strong>, enable Jevbox, and follow the
              sign-in prompt.
            </>
          ),
        },
        {
          title: "Use it in Agent",
          body: (
            <>
              Open an Agent chat, enable Jevbox’s tools, and ask it to list your
              Jevbox organizations.
            </>
          ),
        },
      ],
      snippet: {
        label: "~/.cursor/mcp.json",
        description:
          "This adds a URL-based server. Jevbox handles sign-in through OAuth.",
        text: JSON.stringify({ mcpServers: { jevbox: { url } } }, null, 2),
      },
    },
    {
      id: "vscode",
      label: "VS Code",
      subtitle: "Make your library available to agents in VS Code.",
      docs: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
      screenshot: screenshots.vscode,
      steps: [
        {
          title: "Open the server setup",
          body: (
            <>
              Open the Command Palette with <strong>⌘⇧P</strong> on Mac or{" "}
              <strong>Ctrl+Shift+P</strong>, and run{" "}
              <strong>MCP: Add Server</strong>.
            </>
          ),
        },
        {
          title: "Choose an HTTP server",
          body: (
            <>
              Select <strong>HTTP</strong>, enter the MCP URL above, and name
              the server <strong>jevbox</strong>. Choose{" "}
              <strong>.mcp.json</strong> for the workspace or{" "}
              <strong>Copilot Global</strong> for all projects.
            </>
          ),
        },
        {
          title: "Trust and sign in",
          body: (
            <>
              Review the configuration, trust the server, and complete the
              Jevbox sign-in flow. Use <strong>MCP: List Servers</strong> to
              check its status.
            </>
          ),
        },
        {
          title: "Enable the tools",
          body: (
            <>
              In an Agent chat, open <strong>Configure Tools</strong>, enable
              Jevbox’s tools, and ask it to list your Jevbox organizations.
            </>
          ),
        },
      ],
      snippet: {
        label: ".mcp.json · portable configuration",
        description:
          "Merge this server into the existing mcpServers object if the file already exists.",
        text: portableConfig,
      },
    },
    {
      id: "other",
      label: "Other clients",
      subtitle:
        "Use a client that supports Streamable HTTP and Jevbox’s MCP version.",
      docs: "https://modelcontextprotocol.io/docs/learn/architecture",
      steps: [
        {
          title: "Add a remote MCP server",
          body: (
            <>
              Find your client’s MCP or integrations settings and create a
              connection named <strong>Jevbox</strong>.
            </>
          ),
        },
        {
          title: "Choose Streamable HTTP",
          body: (
            <>
              Select <strong>Streamable HTTP</strong> and paste the MCP URL
              above. The client must support MCP <strong>2026-07-28</strong>.
            </>
          ),
        },
        {
          title: "Choose authentication",
          body: (
            <>
              Use <strong>OAuth</strong> to sign in to Jevbox. If your client
              only supports headers, create a personal API key above and add the
              header below.
            </>
          ),
        },
        {
          title: "Discover the tools",
          body: (
            <>
              Connect and refresh the tool list. Look for{" "}
              <code>list_organizations</code>, <code>search</code>, and{" "}
              <code>fetch</code>.
            </>
          ),
        },
      ],
      snippet: {
        label: "API-key authentication header",
        description:
          "Replace the placeholder with your personal Jevbox key in your client’s private settings.",
        text: "Authorization: Bearer <YOUR_JEVBOX_API_KEY>",
      },
    },
  ];
}

function SetupPreview({ client, url }: { client: Client; url: string }) {
  return (
    <figure className="mcp-preview">
      <div
        className="mcp-preview-window"
        aria-label="Illustrated MCP setup form"
      >
        <div className="mcp-preview-toolbar">
          <ClientLogo client={client} size={16} />
          <span>
            {client === "codex" ? "Settings / MCP servers" : "MCP connections"}
          </span>
        </div>
        <div className="mcp-preview-form">
          <h4>Add MCP server</h4>
          <dl>
            <div>
              <dt>Name</dt>
              <dd>jevbox</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>Streamable HTTP</dd>
            </div>
            <div>
              <dt>Server URL</dt>
              <dd className="mcp-preview-url">{url}</dd>
            </div>
          </dl>
          <div className="mcp-preview-auth">
            <Check size={13} />
            <span>Sign in with Jevbox</span>
          </div>
          <span className="mcp-preview-save">Save server</span>
        </div>
      </div>
      <figcaption>Illustrated setup · labels vary by client</figcaption>
    </figure>
  );
}

export function McpConnectionGuide({
  origin,
  onCopy,
}: {
  origin: string;
  onCopy: (value: string) => void;
}) {
  const url = `${origin}/mcp`;
  const hostname = new URL(origin).hostname;
  const local =
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
    hostname.endsWith(".localhost");
  const guides = makeGuides(url);
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  return (
    <div className="mcp-guides">
      <div className="mcp-guides-heading">
        <h3>Connect your AI tools</h3>
        <span>Read-only access</span>
      </div>
      <Tabs defaultValue="codex" className="mcp-guide-tabs">
        <ScrollArea orientation="horizontal" className="mcp-guide-tab-scroll">
          <TabsList
            variant="underline"
            aria-label="MCP connection guides"
            className="mcp-guide-tab-list"
          >
            {guides.map((guide) => (
              <TabsTab key={guide.id} value={guide.id}>
                <ClientLogo client={guide.id} />
                {guide.label}
              </TabsTab>
            ))}
          </TabsList>
        </ScrollArea>
        {guides.map((guide) => (
          <TabsPanel
            key={guide.id}
            value={guide.id}
            className="mcp-guide-panel"
          >
            <header className="mcp-guide-intro">
              <h3>
                Connect to{" "}
                {guide.id === "other" ? "another MCP client" : guide.label}
              </h3>
              <p>{guide.subtitle}</p>
            </header>
            {guide.id === "claude" && (
              <p className="mcp-guide-note">
                {local
                  ? "Your Jevbox address is local. Use the Claude Code command below, or deploy Jevbox to a public HTTPS address for Claude desktop and web."
                  : "Claude desktop and web need a publicly reachable HTTPS address. Team and Enterprise owners add the connector before members can connect."}
              </p>
            )}
            <div className="mcp-guide-layout">
              <ol className="mcp-guide-steps">
                {guide.steps.map((step, index) => (
                  <li key={step.title}>
                    <span className="mcp-guide-step-number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h4>{step.title}</h4>
                      <p>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {guide.screenshot ? (
                <figure className="mcp-guide-screenshot">
                  <button
                    type="button"
                    onClick={() => setScreenshot(guide.screenshot!)}
                    aria-label={`Enlarge ${guide.label} setup screenshot`}
                  >
                    <img
                      src={guide.screenshot.src}
                      alt={guide.screenshot.alt}
                      loading="lazy"
                    />
                    <span className="mcp-screenshot-zoom">
                      <ArrowUpRight size={14} /> Enlarge
                    </span>
                  </button>
                  <figcaption>
                    {guide.screenshot.caption}
                    {guide.screenshot.source && (
                      <>
                        {" "}
                        ·{" "}
                        <a
                          href={guide.screenshot.source}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Source
                        </a>
                      </>
                    )}
                  </figcaption>
                </figure>
              ) : (
                <SetupPreview client={guide.id} url={url} />
              )}
            </div>
            {guide.snippet && (
              <div className="mcp-guide-code">
                <div className="mcp-guide-code-heading">
                  <span>{guide.snippet.label}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Copy ${guide.label} configuration`}
                    onClick={() => onCopy(guide.snippet!.text)}
                  >
                    <Copy size={13} />
                    Copy
                  </Button>
                </div>
                <pre>
                  <code>{guide.snippet.text}</code>
                </pre>
                <p>{guide.snippet.description}</p>
                {guide.id === "claude" && (
                  <a
                    href="https://code.claude.com/docs/en/mcp"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Claude Code documentation <ArrowUpRight size={12} />
                  </a>
                )}
              </div>
            )}
            <footer className="mcp-guide-footer">
              <span>
                <Check size={14} />
                Uses your current document permissions
              </span>
              <a href={guide.docs} target="_blank" rel="noreferrer">
                Official guide <ArrowUpRight size={13} />
              </a>
            </footer>
          </TabsPanel>
        ))}
      </Tabs>
      <details className="mcp-guide-help">
        <summary>Connection help</summary>
        <p>
          These are HTTP setup guides; compatibility with each client version
          has not been verified. Jevbox requires MCP 2026-07-28. If your client
          reports an unsupported protocol, update it or use a compatible client.
        </p>
        <p>
          For sign-in errors, authenticate again or check that your API key is
          active. Search also requires your organization’s TypeSafe connection
          and indexed documents. Revoke keys or disconnect OAuth apps on this
          page.
        </p>
      </details>
      <Dialog
        open={!!screenshot}
        onOpenChange={(open) => !open && setScreenshot(null)}
      >
        <DialogPopup className="mcp-screenshot-dialog sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{screenshot?.caption}</DialogTitle>
            <DialogDescription>
              Reference screenshot. Enter your own Jevbox URL when connecting.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {screenshot && <img src={screenshot.src} alt={screenshot.alt} />}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
