import { authClient, authData } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { type Me } from "../lib/api";
import { notifySuccess } from "../lib/notifications";
import {
  scopeLabels,
  type ApiScope,
  type ConnectedApp,
} from "../../shared/api-access";
import { Button } from "./coss/button";
import { Copy } from "./icons";
import { McpIcon } from "./mcp-icon";
import { Loading, useAction } from "./common";
import { McpConnectionGuide } from "./mcp-connection-guide";

export function McpView({ me }: { me: Me }) {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const action = useAction();
  const clipboard = useAction();
  const url = `${location.origin}/mcp`;
  async function refresh() {
    const consents = authData(await authClient.oauth2.getConsents());
    setApps(
      await Promise.all(
        consents.map(async (consent) => {
          const client = authData(
            await authClient.oauth2.publicClient({
              query: { client_id: consent.clientId },
            }),
          );
          return {
            id: consent.id,
            name: client.client_name ?? "Connected application",
            scopes: consent.scopes,
            createdAt: new Date(consent.createdAt).toISOString(),
          };
        }),
      ),
    );
  }
  useEffect(() => {
    void action.run(refresh);
  }, [me.user.id]);
  const copy = (value: string) =>
    clipboard.run(async () => {
      await navigator.clipboard.writeText(value);
      notifySuccess("Copied");
    });
  return (
    <div className="settings-page">
      <header className="settings-heading">
        <h1>MCP</h1>
        <p>Connect your AI tools to your library.</p>
      </header>
      <section className="settings-section" aria-label="MCP connection">
        <h2>Server URL</h2>
        <div className="api-endpoint">
          <span>
            <McpIcon size={18} />
            MCP
          </span>
          <code>{url}</code>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Copy MCP URL"
            onClick={() => void copy(url)}
          >
            <Copy size={14} />
          </Button>
        </div>
        <McpConnectionGuide
          origin={location.origin}
          onCopy={(value) => void copy(value)}
        />
        {clipboard.error && (
          <p className="error" role="alert">
            {clipboard.error}
          </p>
        )}
      </section>
      <section className="settings-section api-docs" aria-label="MCP tools">
        <h2>Tools and uploads</h2>
        <p>
          <code>list_organizations</code> lists your workspaces.{" "}
          <code>search</code>
          finds accessible source passages, and <code>fetch</code> reads
          documents and sections. <code>upload_document</code> adds a new
          Private document when your key or OAuth grant has{" "}
          <code>documents:write</code> access.
        </p>
        <p>
          <code>answer</code> starts a cited answer and saves a private chat.
          Accepted searches and answers keep running when you disconnect or
          close your client. Use <code>get_run</code> for saved progress and
          results,
          <code>list_runs</code> to recover recent requests, and
          <code>cancel_run</code> to stop work. Answers also appear in Chats.
          Run handles are available for 24 hours; saved chats remain available.
        </p>
        <pre className="api-docs-code">
          <code>
            {JSON.stringify(
              {
                organizationId: "<ORGANIZATION_ID>",
                filename: "note.txt",
                contentBase64: "SGVsbG8K",
              },
              null,
              2,
            )}
          </code>
        </pre>
        <p>
          Supply <code>organizationId</code>, <code>filename</code>, and
          standard padded <code>contentBase64</code> containing the file bytes.
          Optional
          <code>parentId</code> must identify a writable folder. Ask your client
          to upload only files you authorize it to send. Local paths and URLs
          are not accepted as file content.
        </p>
        <p>
          Inline MCP uploads support files up to 2 MiB decoded. Use the
          multipart upload documented under API keys for files up to 30 MiB. The
          result includes the document ID, URL, and processing status; indexing
          runs in the background. Uploads start Private and cannot change
          sharing or edit existing documents. Repeated uploads create separate
          documents.
        </p>
        <p>
          Read-only grants do not expose the upload tool. Reconnect and consent
          to upload access, or create a new API key. Existing grants and older
          keys keep their current permissions.
        </p>
        <p className="muted">
          API, MCP, and browser uploads share quotas across your keys: 5
          attempts per minute, 20 per hour, 150 MiB per UTC day, 512 MiB stored,
          and 10 documents awaiting processing. Organization and deployment caps
          also apply, including a total cap of 1,000 documents per user.
          Oversized or malformed documents are rejected. MCP reports tool
          failures with isError; wait before retrying a quota error.
        </p>
      </section>
      <section className="settings-section" aria-label="Connected applications">
        <h2>Connected apps</h2>
        {apps === null ? (
          action.error ? null : (
            <Loading inline />
          )
        ) : apps.length === 0 ? (
          <p className="muted">No connected apps.</p>
        ) : (
          apps.map((app) => (
            <div className="api-key-row" key={app.id}>
              <div className="api-key-details">
                <strong>{app.name}</strong>
                <span>
                  {app.scopes
                    .filter((scope) => scope !== "offline_access")
                    .map((scope) => scopeLabels[scope as ApiScope] ?? scope)
                    .join(" · ")}
                </span>
              </div>
              <Button
                variant="outline"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    authData(
                      await authClient.oauth2.deleteConsent({ id: app.id }),
                    );
                    await refresh();
                    notifySuccess("Application disconnected");
                  })
                }
              >
                Disconnect
              </Button>
            </div>
          ))
        )}
        {action.error && (
          <p className="error" role="alert">
            {action.error}
          </p>
        )}
      </section>
    </div>
  );
}
