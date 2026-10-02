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
import { McpUsageGuide } from "./mcp-usage-guide";

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
      <McpUsageGuide onCopy={(value) => void copy(value)} />
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
