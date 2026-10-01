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
import { ArrowUpRight, Check, Copy, PlugFilled } from "./icons";
import { RouteLink } from "./route-link";
import { paths } from "../lib/navigation";

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
  screenshots?: Screenshot[];
};

const screenshots = {
  codexPlugins: {
    src: "/guides/mcp/codex-create-plugin.webp",
    alt: "Codex Plugins page with Add open and Create plugin in the menu.",
    caption: "Codex · Customize → Plugins → Add → Create plugin",
  },
  codexForm: {
    src: "/guides/mcp/codex-new-plugin.webp",
    alt: "Codex New Plugin dialog with Name, Server URL, OAuth authentication, a confirmation checkbox, and Create.",
    caption: "Codex · New Plugin → Server URL → OAuth",
  },
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
  if (client === "other") return <PlugFilled size={size} />;
  return (
    <img
      className={`provider-logo ${client === "cursor" ? "monochrome" : ""}`}
      src={`/logos/${client}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  );
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
      screenshots: [screenshots.codexPlugins, screenshots.codexForm],
      steps: [
        {
          title: "Create a plugin",
          body: (
            <>
              In Codex, open <strong>Customize → Plugins</strong>. Choose{" "}
              <strong>Add → Create plugin</strong>.
            </>
          ),
        },
        {
          title: "Add Jevbox",
          body: (
            <>
              Enter <strong>Jevbox</strong> as the name. Under{" "}
              <strong>Connection</strong>, choose <strong>Server URL</strong>{" "}
              and paste the MCP URL above. Set <strong>Authentication</strong>{" "}
              to <strong>OAuth</strong>.
            </>
          ),
        },
        {
          title: "Create the connection",
          body: (
            <>
              Leave <strong>Advanced OAuth settings</strong> at their discovered
              defaults. Review the connection, check{" "}
              <strong>I understand and want to continue</strong>, and select{" "}
              <strong>Create</strong>.
            </>
          ),
        },
        {
          title: "Sign in and use Jevbox",
          body: (
            <>
              Connect the Jevbox plugin and follow the sign-in prompt to approve
              search and document access. Enable it in a chat and ask Codex to
              list your Jevbox organizations.
            </>
          ),
        },
      ],
      snippet: {
        label: "Or connect from the terminal",
        description:
          "For the Codex CLI or IDE extension. Complete browser sign-in, then use /mcp in the CLI to check the connection.",
        text: `codex mcp add jevbox --url ${JSON.stringify(url)}\ncodex mcp login jevbox\ncodex mcp list`,
      },
    },
    {
      id: "claude",
      label: "Claude",
      subtitle:
        "Connect the Claude app, or use Claude Code for a local library.",
      docs: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
      screenshots: [screenshots.claude],
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
              Select <strong>Add</strong> to save the connector, then choose{" "}
              <strong>Connect</strong> and sign in to Jevbox to approve read and
              search access. Leave advanced OAuth fields empty.
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
      screenshots: [screenshots.cursor],
      steps: [
        {
          title: "Open your MCP configuration",
          body: (
            <>
              Open <code>~/.cursor/mcp.json</code> for a personal connection
              across projects. You can also open it from{" "}
              <strong>Customize → MCPs → New MCP Server → User</strong>.
            </>
          ),
        },
        {
          title: "Add the configuration",
          body: (
            <>
              Add the configuration below to <code>~/.cursor/mcp.json</code>,
              merging it with any existing <code>mcpServers</code> entries. Use{" "}
              <code>.cursor/mcp.json</code> in your project for a workspace
              connection instead.
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
      screenshots: [screenshots.vscode],
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
              Review the configuration, then use{" "}
              <strong>MCP: List Servers → jevbox → Start</strong>. Confirm trust
              if prompted and complete the Jevbox sign-in flow.
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
              only supports headers, create a personal key in{" "}
              <RouteLink href={paths.settings("api-keys")}>API keys</RouteLink>{" "}
              and add the header below.
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

function SetupPreview({ url }: { url: string }) {
  return (
    <figure className="mcp-preview">
      <div
        className="mcp-preview-window"
        aria-label="Illustrated MCP setup form"
      >
        <div className="mcp-preview-toolbar">
          <PlugFilled size={16} />
          <span>MCP connections</span>
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
                  : "Claude desktop and web need a publicly reachable HTTPS address."}{" "}
                For Team and Enterprise, an owner first adds it in{" "}
                <strong>
                  Organization settings → Connectors → Add → Custom → Web
                </strong>
                . Members then choose <strong>Connect</strong> under{" "}
                <strong>Customize → Connectors</strong>.
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
              {guide.screenshots ? (
                <div className="mcp-guide-screenshots">
                  {guide.screenshots.map((reference) => (
                    <figure
                      className="mcp-guide-screenshot"
                      key={reference.src}
                    >
                      <button
                        type="button"
                        onClick={() => setScreenshot(reference)}
                        aria-label={`Enlarge ${reference.caption} screenshot`}
                      >
                        <img
                          src={reference.src}
                          alt={reference.alt}
                          loading="lazy"
                        />
                        <span className="mcp-screenshot-zoom">
                          <ArrowUpRight size={14} /> Enlarge
                        </span>
                      </button>
                      <figcaption>
                        {reference.caption}
                        {reference.source && (
                          <>
                            {" "}
                            ·{" "}
                            <a
                              href={reference.source}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Source
                            </a>
                          </>
                        )}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <SetupPreview url={url} />
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
          and indexed documents. Manage keys in{" "}
          <RouteLink href={paths.settings("api-keys")}>API keys</RouteLink> or
          disconnect OAuth apps below.
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
