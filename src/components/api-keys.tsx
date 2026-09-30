import { useEffect, useState } from "react";
import { api, type Me } from "@/lib/api";
import { notifySuccess } from "@/lib/notifications";
import {
  scopeLabels,
  type ApiKeyInfo,
  type ApiScope,
  type ConnectedApp,
} from "../../shared/api-access";
import { Button } from "./coss/button";
import { Input } from "./coss/input";
import { Form } from "./coss/form";
import { Field, FieldLabel, FieldError } from "./coss/field";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "./coss/dialog";
import { Copy, Plus, UserKey, Code, PlugFilled } from "./icons";
import { Choice, Loading, useAction } from "./common";
import { McpConnectionGuide } from "./mcp-connection-guide";

export function ApiKeysView({ me }: { me: Me }) {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  const action = useAction();
  const form = useAction();
  async function refresh() {
    const [nextKeys, nextApps] = await Promise.all([
      api<ApiKeyInfo[]>("/api-keys"),
      api<ConnectedApp[]>("/connected-apps"),
    ]);
    setKeys(nextKeys);
    setApps(nextApps);
  }
  useEffect(() => {
    void action.run(refresh);
  }, [me.user.id]);
  const copy = (value: string) =>
    form.run(async () => {
      await navigator.clipboard.writeText(value);
      notifySuccess("Copied");
    });
  function changeOpen(value: boolean) {
    setOpen(value);
    setToken("");
    setName("");
    setExpiry("90");
    form.setError("");
  }
  return (
    <div className="settings-page">
      <header className="settings-heading api-keys-heading">
        <div>
          <h1>API keys</h1>
          <p>Your keys use your current document permissions.</p>
        </div>
        <Button onClick={() => changeOpen(true)}>
          <Plus size={15} />
          Create key
        </Button>
      </header>
      <section aria-label="Your API keys" className="settings-section">
        {!keys ? (
          action.error ? null : (
            <Loading inline />
          )
        ) : !keys.length ? (
          <div className="empty-inline">
            <UserKey size={24} />
            <h3>No API keys</h3>
          </div>
        ) : (
          keys.map((key) => {
            const status = key.revokedAt
              ? "Revoked"
              : new Date(key.expiresAt).getTime() <= Date.now()
                ? "Expired"
                : "Active";
            return (
              <div className="api-key-row" key={key.id}>
                <div className="api-key-details">
                  <strong>{key.name}</strong>
                  <code>{key.prefix}…</code>
                  <span>
                    Expires {new Date(key.expiresAt).toLocaleDateString()}
                    {key.lastUsedAt
                      ? ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                      : " · Never used"}
                  </span>
                </div>
                <div className="api-key-actions">
                  <span className="muted">{status}</span>
                  {status === "Active" && (
                    <Button
                      variant="outline"
                      disabled={action.busy}
                      onClick={() =>
                        void action.run(async () => {
                          await api(`/api-keys/${key.id}`, {
                            method: "DELETE",
                          });
                          await refresh();
                          notifySuccess("API key revoked");
                        })
                      }
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
        {action.error && (
          <p className="error" role="alert">
            {action.error}
          </p>
        )}
      </section>
      <section className="settings-section" aria-label="API and MCP endpoints">
        <h2>Connect</h2>
        {[
          { label: "API", url: `${location.origin}/api/v1`, icon: Code },
          { label: "MCP", url: `${location.origin}/mcp`, icon: PlugFilled },
        ].map((endpoint) => (
          <div className="api-endpoint" key={endpoint.label}>
            <span>
              <endpoint.icon size={18} />
              {endpoint.label}
            </span>
            <code>{endpoint.url}</code>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Copy ${endpoint.label} URL`}
              onClick={() => void copy(endpoint.url)}
            >
              <Copy size={14} />
            </Button>
          </div>
        ))}
        <McpConnectionGuide
          origin={location.origin}
          onCopy={(value) => void copy(value)}
        />
        {form.error && !open && (
          <p className="error" role="alert">
            {form.error}
          </p>
        )}
      </section>
      {!!apps.length && (
        <section
          className="settings-section"
          aria-label="Connected applications"
        >
          <h2>Connected apps</h2>
          {apps.map((app) => (
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
                    await api(`/connected-apps/${encodeURIComponent(app.id)}`, {
                      method: "DELETE",
                    });
                    await refresh();
                    notifySuccess("Application disconnected");
                  })
                }
              >
                Disconnect
              </Button>
            </div>
          ))}
        </section>
      )}
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              {token ? "API key created" : "Create API key"}
            </DialogTitle>
            <DialogDescription>
              {token
                ? "Copy this key now. It won’t be shown again."
                : "Choose a name and expiration."}
            </DialogDescription>
          </DialogHeader>
          {token ? (
            <>
              <DialogPanel>
                <div className="flex gap-2">
                  <Input
                    aria-label="New API key"
                    value={token}
                    readOnly
                    className="font-mono"
                  />
                  <Button
                    variant="outline"
                    aria-label="Copy API key"
                    onClick={() => void copy(token)}
                  >
                    <Copy size={15} />
                  </Button>
                </div>
                {form.error && (
                  <p className="error" role="alert">
                    {form.error}
                  </p>
                )}
              </DialogPanel>
              <DialogFooter>
                <Button onClick={() => changeOpen(false)}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <Form
              className="contents"
              onSubmit={(event) => {
                event.preventDefault();
                if (form.busy) return;
                void form.run(async () => {
                  const created = await api<{ key: ApiKeyInfo; token: string }>(
                    "/api-keys",
                    {
                      method: "POST",
                      body: JSON.stringify({
                        name,
                        expiresInDays: Number(expiry),
                      }),
                    },
                  );
                  setToken(created.token);
                  await refresh();
                });
              }}
            >
              <DialogPanel className="space-y-4">
                <Field name="name">
                  <FieldLabel>Name</FieldLabel>
                  <Input
                    name="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={80}
                    autoComplete="off"
                  />
                  <FieldError />
                </Field>
                <Field name="expiration">
                  <FieldLabel>Expiration</FieldLabel>
                  <Choice
                    label="Expiration"
                    value={expiry}
                    onChange={setExpiry}
                    options={[7, 30, 90, 365].map((days) => ({
                      value: String(days),
                      label: `${days} days`,
                    }))}
                  />
                </Field>
                {form.error && (
                  <p className="error" role="alert">
                    {form.error}
                  </p>
                )}
              </DialogPanel>
              <DialogFooter>
                <Button variant="ghost" onClick={() => changeOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={form.busy}>
                  Create key
                </Button>
              </DialogFooter>
            </Form>
          )}
        </DialogPopup>
      </Dialog>
    </div>
  );
}
