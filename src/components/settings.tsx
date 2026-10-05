import { authClient, authData, organizationMembers } from "@/lib/auth-client";
import { MessageSquareOutline } from "./icons";
import { ChatProviderSetup, type ProviderDraft } from "./chat-provider-setup";
import { notifySuccess } from "@/lib/notifications";
import { ProviderLogo } from "./provider-logo";
import { PersonAvatar } from "./person-avatar";
import { useEffect, useState } from "react";
import {
  CircleCheck,
  Copy,
  LockKeyhole,
  Plus,
  Trash2,
} from "@/components/icons";
import { Button } from "@/components/coss/button";
import { Input } from "@/components/coss/input";
import { Switch } from "@/components/ui/switch";
import { Form } from "@/components/coss/form";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/coss/tabs";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@/components/coss/field";
import { api, type Me, type Member } from "@/lib/api";
import {
  parseModelList,
  validateEmail,
  validateLength,
} from "@/lib/form-validation";
import { providerCatalog } from "../../shared/providers";
import type {
  CloudflareModel,
  DecisionProvider,
} from "../../shared/decision-model";
import { Choice, Loading, useAction } from "./common";
export function SettingsView({
  me,
  onSaved,
  section,
}: {
  me: Me;
  onSaved: () => void;
  section: string;
}) {
  const [settings, setSettings] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<ProviderDraft[]>([]);
  const [removedProviders, setRemovedProviders] = useState<string[]>([]);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [decisionProvider, setDecisionProvider] =
    useState<DecisionProvider>("typesafe");
  const [cloudflareAccountId, setCloudflareAccountId] = useState("");
  const [cloudflareModel, setCloudflareModel] =
    useState<CloudflareModel>("clef");
  const [autoFile, setAutoFile] = useState(true);
  const [folderModel, setFolderModel] = useState("");
  const [invitation, setInvitation] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [remove, setRemove] = useState("");
  const action = useAction();
  const isAdmin = me.role === "admin";
  const decisionConfigured = Boolean(
    decisionProvider === "typesafe"
      ? settings?.configured.jevKey
      : settings?.configured.cloudflareKey && settings?.cloudflareAccountId,
  );
  const refresh = async () => {
    const m = await organizationMembers(me.organization.id);
    setMembers(m);
    if (isAdmin) {
      const s = await api("/settings");
      setSettings(s);
      setDecisionProvider(s.decisionProvider ?? "typesafe");
      setCloudflareAccountId(s.cloudflareAccountId ?? "");
      setCloudflareModel(s.cloudflareModel ?? "clef");
      setAutoFile(s.organization?.enabled !== false);
      setFolderModel(
        s.organization?.model
          ? JSON.stringify([
              s.organization.model.provider,
              s.organization.model.model,
            ])
          : "",
      );
      setRemovedProviders([]);
      setProviderDrafts(
        providerCatalog
          .filter((item) => s.providers?.[item.id]?.configured)
          .map((item) => ({
            id: item.id,
            provider: item.id,
            enabled: s.providers[item.id].enabled !== false,
            model:
              s.providers[item.id].model ??
              (s.provider === item.id ? s.model : item.model),
            models: (s.providers[item.id].models ?? []).join("\n"),
            config: "",
            saved: true,
          })),
      );
    }
  };
  useEffect(() => {
    void action.run(refresh);
  }, []);
  const field = (
    key: string,
    label: string,
    configured: boolean,
    placeholder = "Paste your API key",
  ) => (
    <Field
      name={key}
      validate={(value) =>
        validateLength(value, key === "providerKey" ? 10000 : 1000)
      }
    >
      <FieldLabel>{label}</FieldLabel>
      <div className="key-input">
        <Input
          name={key}
          type="password"
          maxLength={key === "providerKey" ? 10000 : 1000}
          autoComplete="off"
          placeholder={
            configured ? "Configured · leave blank to keep" : placeholder
          }
          value={keys[key] ?? ""}
          onChange={(e) => {
            setSaved(false);
            setKeys({ ...keys, [key]: e.target.value });
          }}
        />
        {configured && <CircleCheck size={15} className="text-green-700" />}
      </div>
      <FieldError />
      {configured && (
        <button
          className="text-link"
          type="button"
          onClick={() => {
            setSaved(false);
            setKeys({ ...keys, [key]: "" });
          }}
        >
          Clear on save
        </button>
      )}
      {keys[key] === "" && (
        <FieldDescription>
          This key will be removed when you save.
        </FieldDescription>
      )}
    </Field>
  );
  return (
    <div className="settings-page">
      <header className="settings-heading">
        <h1>
          {section === "connections" ? "Connections" : "Members & permissions"}
        </h1>
        <p>
          {section === "connections"
            ? isAdmin
              ? "Configure document parsing, search, and chat providers."
              : "Document parsing, search, and chat are managed by your administrators."
            : isAdmin
              ? "Manage your organization’s members and invitations."
              : "View the members of your organization."}
        </p>
      </header>
      {section === "connections" && (
        <section aria-label="Connections">
          {!isAdmin ? (
            <div className="empty-inline">
              <LockKeyhole size={24} />
              <h3>Managed by your organization</h3>
              <p>
                Ask an organization administrator to configure parsing, search,
                and chat.
              </p>
            </div>
          ) : !settings ? (
            <Loading />
          ) : (
            <Form
              onSubmit={(e) => {
                e.preventDefault();
                if (action.busy) return;
                void action.run(async () => {
                  await api("/settings", {
                    method: "PUT",
                    body: JSON.stringify({
                      ...keys,
                      decisionProvider,
                      cloudflareAccountId,
                      cloudflareModel,
                      organization: {
                        enabled: autoFile,
                        ...(folderModel
                          ? {
                              model: {
                                provider: JSON.parse(folderModel)[0],
                                model: JSON.parse(folderModel)[1],
                              },
                            }
                          : {}),
                      },
                      removedProviders: removedProviders.filter(
                        (provider) =>
                          !providerDrafts.some(
                            (draft) => draft.provider === provider,
                          ),
                      ),
                      chatProviders: providerDrafts.map((draft) => ({
                        provider: draft.provider,
                        providerEnabled: draft.enabled,
                        model: draft.model,
                        models: parseModelList(draft.models),
                        ...(draft.key !== undefined
                          ? { providerKey: draft.key }
                          : {}),
                        ...(draft.config.trim()
                          ? { providerConfig: JSON.parse(draft.config) }
                          : {}),
                      })),
                    }),
                  });
                  setKeys({});
                  await refresh();
                  setSaved(true);
                  onSaved();
                });
              }}
            >
              <div className="settings-section">
                <div className="settings-section-title">
                  <span className="integration-mark">
                    <ProviderLogo provider="extend" size={32} />
                  </span>
                  <div>
                    <h2>Extend</h2>
                    <p>
                      Turn documents into structured pages, sections, and
                      tables.
                    </p>
                  </div>
                  <span
                    className={`connection-state ${settings.configured.extendKey ? "connected" : ""}`}
                  >
                    {settings.configured.extendKey
                      ? "Connected"
                      : "Not configured"}
                  </span>
                </div>
                {field(
                  "extendKey",
                  "Extend API key",
                  settings.configured.extendKey,
                )}
                <p className="field-note">
                  PDFs, Office documents, and images are parsed with Extend.
                  Plain text and Markdown are indexed locally.
                </p>
              </div>
              <div className="settings-section">
                <div className="settings-section-title">
                  <span
                    className={`integration-mark ${decisionProvider === "typesafe" ? "[&_.provider-logo]:scale-70" : ""}`}
                  >
                    <ProviderLogo provider={decisionProvider} size={22} />
                  </span>
                  <div>
                    <h2>Decision model</h2>
                    <p>Find relevant sources and organize your documents.</p>
                  </div>
                  <span
                    className={`connection-state ${decisionConfigured ? "connected" : ""}`}
                  >
                    {decisionConfigured ? "Connected" : "Not configured"}
                  </span>
                </div>
                <Tabs
                  value={decisionProvider}
                  onValueChange={(value) => {
                    if (value === "typesafe" || value === "cloudflare") {
                      setDecisionProvider(value);
                      setSaved(false);
                    }
                  }}
                >
                  <TabsList aria-label="Decision model provider">
                    <TabsTab
                      value="typesafe"
                      type="button"
                      className="[&_.provider-logo]:scale-70"
                    >
                      <ProviderLogo provider="typesafe" size={16} />
                      TypeSafe
                    </TabsTab>
                    <TabsTab value="cloudflare" type="button">
                      <ProviderLogo provider="cloudflare" size={16} />
                      Cloudflare
                    </TabsTab>
                  </TabsList>
                  <TabsPanel value="typesafe" className="space-y-4 pt-3">
                    {field(
                      "jevKey",
                      "TypeSafe API key",
                      settings.configured.jevKey,
                    )}
                  </TabsPanel>
                  <TabsPanel value="cloudflare" className="space-y-4 pt-3">
                    <Field
                      name="cloudflareAccountId"
                      validate={(value) =>
                        value && !/^[a-fA-F0-9]{32}$/.test(String(value).trim())
                          ? "Enter a 32-character Cloudflare account ID."
                          : null
                      }
                    >
                      <FieldLabel>Cloudflare account ID</FieldLabel>
                      <Input
                        name="cloudflareAccountId"
                        type="text"
                        autoComplete="off"
                        placeholder="Paste your account ID"
                        maxLength={32}
                        value={cloudflareAccountId}
                        onChange={(event) => {
                          setCloudflareAccountId(event.target.value.trim());
                          setSaved(false);
                        }}
                      />
                      <FieldError />
                    </Field>
                    {field(
                      "cloudflareKey",
                      "Cloudflare API token",
                      settings.configured.cloudflareKey,
                      "Paste your API token",
                    )}
                    <Field name="cloudflareModel">
                      <FieldLabel>Model</FieldLabel>
                      <Choice
                        label="Cloudflare decision model"
                        value={cloudflareModel}
                        onChange={(value) => {
                          if (value === "clef" || value === "clef-flash") {
                            setCloudflareModel(value);
                            setSaved(false);
                          }
                        }}
                        options={[
                          { value: "clef", label: "Clef" },
                          { value: "clef-flash", label: "Clef Flash" },
                        ]}
                      />
                    </Field>
                    <p className="field-note">
                      Use a Workers AI API token with Read and Edit permissions.
                      Get your token and account ID from the{" "}
                      <a
                        className="text-link"
                        href="https://dash.cloudflare.com/?to=/:account/ai/workers-ai"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Cloudflare dashboard
                      </a>
                      .
                    </p>
                  </TabsPanel>
                </Tabs>
                <p className="field-note">
                  Save to use this provider for search, evidence scoring, and
                  automatic filing across your organization. Both providers’
                  credentials are kept when you switch.
                </p>
              </div>
              <div className="settings-section">
                <div className="settings-section-title">
                  <span className="integration-mark chat-mark">
                    <MessageSquareOutline size={25} />
                  </span>
                  <div>
                    <h2>Chat providers</h2>
                    <p>Connect providers and choose their models in chat.</p>
                  </div>
                  <span className="optional">Optional</span>
                </div>
                <div className="chat-provider-setups">
                  {providerDrafts.map((draft) => (
                    <ChatProviderSetup
                      key={draft.id}
                      draft={draft}
                      usedProviders={providerDrafts.map(
                        (item) => item.provider,
                      )}
                      configured={Boolean(
                        settings.providers?.[draft.provider]?.configured,
                      )}
                      hasConfig={Boolean(
                        settings.providers?.[draft.provider]?.hasConfig,
                      )}
                      busy={action.busy}
                      onChange={(patch) => {
                        setSaved(false);
                        setProviderDrafts((items) =>
                          items.map((item) =>
                            item.id === draft.id ? { ...item, ...patch } : item,
                          ),
                        );
                      }}
                      onRemove={() => {
                        setSaved(false);
                        if (draft.saved)
                          setRemovedProviders((items) => [
                            ...items,
                            draft.provider,
                          ]);
                        setProviderDrafts((items) =>
                          items.filter((item) => item.id !== draft.id),
                        );
                      }}
                    />
                  ))}
                </div>
                <Button
                  variant="ghost"
                  className="add-chat-provider"
                  disabled={
                    action.busy ||
                    providerDrafts.length >= providerCatalog.length
                  }
                  onClick={() => {
                    const next = providerCatalog.find(
                      (item) =>
                        !providerDrafts.some(
                          (draft) => draft.provider === item.id,
                        ),
                    );
                    if (!next) return;
                    setSaved(false);
                    setProviderDrafts((items) => [
                      ...items,
                      {
                        id: crypto.randomUUID(),
                        provider: next.id,
                        model: next.model,
                        models: "",
                        config: "",
                        enabled: true,
                        saved: false,
                      },
                    ]);
                  }}
                >
                  <Plus size={15} /> Add provider
                </Button>
                <p className="field-note">
                  Each provider keeps its own credentials. Enabled models appear
                  in the chat picker.
                </p>
              </div>
              <div className="settings-section">
                <div className="settings-section-title">
                  <div>
                    <h2>Automatic filing</h2>
                    <p>Organize new uploads into folders and subfolders.</p>
                  </div>
                </div>
                <Field name="automatic-filing">
                  <div className="flex w-full items-center justify-between gap-4">
                    <FieldLabel htmlFor="automatic-filing">
                      File new uploads automatically
                    </FieldLabel>
                    <Switch
                      id="automatic-filing"
                      checked={autoFile}
                      disabled={action.busy}
                      onCheckedChange={(checked) => {
                        setAutoFile(checked);
                        setSaved(false);
                      }}
                    />
                  </div>
                  <FieldDescription>
                    Reuse existing folders. Uncertain documents stay in a
                    suitable parent. Uploads remain within the folder you chose.
                    Related documents may be reviewed after uploads; manual
                    placements stay fixed.
                  </FieldDescription>
                </Field>
                <Field name="folder-naming-model">
                  <FieldLabel>Folder naming model</FieldLabel>
                  <Choice
                    value={folderModel}
                    options={[
                      { value: "", label: "Use provider default" },
                      ...(settings.chatModels ?? []).map(
                        (model: {
                          provider: string;
                          providerLabel: string;
                          model: string;
                        }) => ({
                          value: JSON.stringify([model.provider, model.model]),
                          label: `${model.providerLabel} · ${model.model}`,
                        }),
                      ),
                    ]}
                    label="Folder naming model"
                    disabled={action.busy || !autoFile}
                    onChange={(value) => {
                      setFolderModel(value);
                      setSaved(false);
                    }}
                  />
                  <FieldDescription>
                    Choose an inexpensive model for occasional folder names and
                    descriptions. Document summaries are not generated.
                  </FieldDescription>
                </Field>
              </div>
              <div className="settings-save">
                <Button type="submit" disabled={action.busy}>
                  {saved ? (
                    <>
                      <CircleCheck size={14} />
                      Saved
                    </>
                  ) : action.busy ? (
                    "Saving…"
                  ) : (
                    "Save connections"
                  )}
                </Button>
              </div>
            </Form>
          )}
        </section>
      )}
      {section === "people" && (
        <section
          className="members-settings"
          aria-label="Members and permissions"
        >
          <div className="settings-section">
            <h2>
              Organization members{" "}
              <span className="count">{members.length}</span>
            </h2>
            <p className="muted">
              Membership does not grant access to private documents.
            </p>
            {members.map((m) => (
              <div className="person-row" key={m.id}>
                <PersonAvatar name={m.name} identity={m.email} />
                <div className="person-identity">
                  <strong>
                    {m.name}
                    {m.id === me.user.id ? " (you)" : ""}
                  </strong>
                  <span>{m.email}</span>
                </div>
                {isAdmin ? (
                  <div className="member-role">
                    <Choice
                      label={`Role for ${m.name}`}
                      value={m.role}
                      disabled={
                        action.busy ||
                        (m.role === "admin" &&
                          members.filter((p) => p.role === "admin").length ===
                            1)
                      }
                      options={[
                        { value: "admin", label: "Admin" },
                        { value: "member", label: "Member" },
                      ]}
                      onChange={(role) =>
                        void action.run(async () => {
                          authData(
                            await authClient.organization.updateMemberRole({
                              memberId: m.membershipId,
                              role,
                              organizationId: me.organization.id,
                            }),
                          );
                          setMembers(
                            await organizationMembers(me.organization.id),
                          );
                          onSaved();
                          notifySuccess("Role updated");
                        })
                      }
                    />
                  </div>
                ) : (
                  <span className="optional">
                    {m.role === "admin" ? "Admin" : "Member"}
                  </span>
                )}
                {isAdmin &&
                  m.id !== me.user.id &&
                  (remove === m.id ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemove("")}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() =>
                          void action.run(async () => {
                            authData(
                              await authClient.organization.removeMember({
                                memberIdOrEmail: m.membershipId,
                                organizationId: me.organization.id,
                              }),
                            );
                            setRemove("");
                            await refresh();
                            notifySuccess("Member removed");
                          })
                        }
                      >
                        Confirm removal
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${m.name}`}
                      onClick={() => setRemove(m.id)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  ))}
              </div>
            ))}
          </div>
          {isAdmin && (
            <div className="settings-section">
              <h2>Invite someone</h2>
              <p className="muted">
                Send an email invitation valid for seven days.
              </p>
              <Form
                className="invite-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (action.busy) return;
                  const form = new FormData(e.currentTarget);
                  void action.run(async () => {
                    const data = authData(
                      await authClient.organization.inviteMember({
                        email: String(form.get("email")),
                        role: "member",
                        organizationId: me.organization.id,
                        resend: true,
                      }),
                    );
                    setInvitation(
                      `${location.origin}/login?invite=${encodeURIComponent(data.id)}`,
                    );
                    setCopied(false);
                    notifySuccess("Invitation created");
                  });
                }}
              >
                <Field
                  name="email"
                  validate={validateEmail}
                  className="w-full flex-1"
                >
                  <FieldLabel className="sr-only">
                    Invite email address
                  </FieldLabel>
                  <Input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="colleague@company.com"
                  />
                  <FieldError />
                </Field>
                <Button type="submit" disabled={action.busy}>
                  <Plus size={14} />
                  Send invitation
                </Button>
              </Form>
              {invitation && (
                <div className="invitation">
                  <Input
                    aria-label="Invitation link"
                    value={invitation}
                    readOnly
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(invitation)
                        .then(() => {
                          setCopied(true);
                          notifySuccess("Invitation link copied");
                        });
                    }}
                  >
                    <Copy size={14} />
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {action.error && (
        <div className="error" role="alert">
          {action.error}
        </div>
      )}
    </div>
  );
}
