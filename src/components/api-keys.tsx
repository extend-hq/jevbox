import { authClient, authData } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { type Me } from "@/lib/api";
import { notifySuccess } from "@/lib/notifications";
import { type ApiKeyInfo } from "../../shared/api-access";
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
import { Copy, Plus, UserKey } from "./icons";
import { Choice, Loading, useAction } from "./common";
import { ApiUsageGuide } from "./api-usage-guide";

export function ApiKeysView({ me }: { me: Me }) {
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  const action = useAction();
  const form = useAction();
  async function refresh() {
    const result = authData(
      await authClient.apiKey.list({
        query: { limit: 100, sortBy: "createdAt", sortDirection: "desc" },
      }),
    );
    setKeys(
      result.apiKeys.map((key) => ({
        id: key.id,
        name: key.name ?? "API key",
        prefix: key.start ?? "jev_key_",
        expiresAt: new Date(key.expiresAt!).toISOString(),
        createdAt: new Date(key.createdAt).toISOString(),
        lastUsedAt: key.lastRequest
          ? new Date(key.lastRequest).toISOString()
          : null,
        revokedAt: key.enabled ? null : new Date(key.updatedAt).toISOString(),
      })),
    );
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
                          authData(
                            await authClient.apiKey.update({
                              keyId: key.id,
                              enabled: false,
                            }),
                          );
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
      <ApiUsageGuide
        origin={location.origin}
        onCopy={(value) => void copy(value)}
      />
      {form.error && !open && (
        <p className="error" role="alert">
          {form.error}
        </p>
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
                  const created = authData(
                    await authClient.apiKey.create({
                      name,
                      expiresIn: Number(expiry) * 86400,
                    }),
                  );
                  setToken(created.key);
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
