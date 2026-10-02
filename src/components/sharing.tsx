import { organizationMembers } from "@/lib/auth-client";
import { notifySuccess } from "@/lib/notifications";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./coss/select";
import { paths } from "@/lib/navigation";
import { PersonAvatar } from "./person-avatar";
import {
  Combobox,
  ComboboxInput,
  ComboboxPopup,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "./coss/combobox";
import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Folder,
  Globe2,
  LockKeyhole,
  Search,
  Users,
  X,
} from "@/components/icons";
import { Button, buttonVariants } from "@/components/coss/button";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "@/components/coss/dialog";
import { api, type Member, type Resource } from "@/lib/api";
import { Choice, Loading, useAction } from "./common";
type Grant = { userId: string; role: "viewer" | "editor" };
type AccessSettings = {
  access: Resource["access"];
  ownerId: string;
  grants: Grant[];
  shareUrl: string | null;
};
type ResourceAccess = AccessSettings & { resourceId: string };
const configKey = ({ access, grants }: AccessSettings) =>
  JSON.stringify({ access, grants });

export function Sharing({
  resource,
  onClose,
  onSaved,
}: {
  resource: Resource | Resource[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const resources = useMemo(
    () => [
      ...new Map(
        (Array.isArray(resource) ? resource : [resource]).map((r) => [r.id, r]),
      ).values(),
    ],
    [resource],
  );
  const multiple = resources.length > 1;
  const [settings, setSettings] = useState<ResourceAccess[]>([]);
  const [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const action = useAction();
  const [savedConfigs, setSavedConfigs] = useState<Record<string, string>>({});
  const access = settings.every((s) => s.access === settings[0]?.access)
    ? (settings[0]?.access ?? "")
    : "";
  const owner = settings[0]?.ownerId ?? "";
  const grants = [
    ...new Set(settings.flatMap((s) => s.grants.map((g) => g.userId))),
  ];
  const dirty = settings.some(
    (s) => savedConfigs[s.resourceId] !== configKey(s),
  );
  const updateGrants = (update: (grants: Grant[]) => Grant[]) => {
    setSettings((current) =>
      current.map((s) => ({ ...s, grants: update(s.grants) })),
    );
    setCopied(false);
  };
  const save = async (notify = true) => {
    const changes = settings.filter(
      (s) => savedConfigs[s.resourceId] !== configKey(s),
    );
    if (!changes.length) return settings;
    const results = multiple
      ? (
          await api<{ items: ResourceAccess[] }>("/resources/access-batch", {
            method: "PUT",
            body: JSON.stringify({
              items: changes.map(({ resourceId, access, grants }) => ({
                resourceId,
                access,
                grants,
              })),
            }),
            notify: false,
          })
        ).items
      : [
          {
            ...changes[0],
            ...(await api<{ shareUrl: string | null }>(
              `/resources/${changes[0].resourceId}/access`,
              {
                method: "PUT",
                body: JSON.stringify({
                  access: changes[0].access,
                  grants: changes[0].grants,
                }),
                notify: false,
              },
            )),
          },
        ];
    const byId = new Map(results.map((result) => [result.resourceId, result]));
    const updated = settings.map((config) =>
      byId.has(config.resourceId)
        ? { ...config, shareUrl: byId.get(config.resourceId)!.shareUrl }
        : config,
    );
    setSettings(updated);
    setSavedConfigs(
      Object.fromEntries(
        updated.map((config) => [config.resourceId, configKey(config)]),
      ),
    );
    onSaved();
    if (notify) notifySuccess("Sharing updated");
    return updated;
  };
  useEffect(() => {
    let active = true;
    setLoaded(false);
    void action.run(async () => {
      const [m, configs] = await Promise.all([
        organizationMembers(),
        multiple
          ? api<{ items: ResourceAccess[] }>("/resources/access-batch", {
              method: "POST",
              body: JSON.stringify({ ids: resources.map((r) => r.id) }),
            }).then((result) => result.items)
          : Promise.all(
              resources.map(async (r) => ({
                ...(await api<AccessSettings>(`/resources/${r.id}/access`)),
                resourceId: r.id,
              })),
            ),
      ]);
      if (!active) return;
      setMembers(m);
      setSettings(configs);
      setSavedConfigs(
        Object.fromEntries(configs.map((s) => [s.resourceId, configKey(s)])),
      );
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [resources]);
  const eligible = members.filter(
    (m) => m.id !== owner && !grants.includes(m.id),
  );
  const accessOptions = [
    {
      value: "restricted",
      label: "Private",
      description: "Only people added above can access.",
      icon: LockKeyhole,
    },
    {
      value: "organization",
      label: "Organization members",
      description:
        "Members can view and search, subject to parent folder access.",
      icon: Users,
    },
    {
      value: "link",
      label: "Link Sharing Enabled",
      description:
        "Anyone with the link can view and download. No sign-in required.",
      icon: Globe2,
    },
    ...(resources.every((r) => r.parent_id)
      ? [
          {
            value: "inherit",
            label: "Inherit folder access",
            description: "Uses the parent folder’s permissions.",
            icon: Folder,
          },
        ]
      : []),
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sharing-dialog sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>
            {multiple
              ? `${resources.length} ${resources.every((r) => r.kind === "document") ? "files" : "items"}`
              : resources[0].name}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {!loaded ? (
            <Loading />
          ) : (
            <div className="share-body">
              <div className="share-add">
                <div className="share-member-search">
                  <Combobox
                    items={eligible}
                    value={eligible.find((m) => m.id === selected) ?? null}
                    onValueChange={(member) => setSelected(member?.id ?? "")}
                    itemToStringLabel={(member) =>
                      member ? `${member.name} ${member.email}` : ""
                    }
                  >
                    <ComboboxInput
                      aria-label="Add a person"
                      placeholder="Find a person by name or email"
                      showTrigger={false}
                      startAddon={<Search size={16} />}
                    />
                    <ComboboxPopup>
                      <ComboboxEmpty>No matching members</ComboboxEmpty>
                      <ComboboxList>
                        {(member: Member) => (
                          <ComboboxItem
                            key={member.id}
                            value={member}
                            className="share-member-option"
                          >
                            <PersonAvatar
                              name={member.name}
                              identity={member.email}
                            />
                            <span className="member-option">
                              <strong>{member.name}</strong>
                              <small>{member.email}</small>
                            </span>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxPopup>
                  </Combobox>
                </div>
                <Button
                  disabled={!selected || action.busy}
                  onClick={() => {
                    updateGrants((gs) => [
                      ...gs,
                      { userId: selected, role: "viewer" },
                    ]);
                    setSelected("");
                  }}
                >
                  Add
                </Button>
              </div>
              <section className="share-people">
                <h3>People with access</h3>
                {[owner, ...grants].map((userId) => {
                  const member = members.find((m) => m.id === userId);
                  const roles = settings.map(
                    (s) => s.grants.find((g) => g.userId === userId)?.role,
                  );
                  const role = roles.every((r) => r === roles[0])
                    ? roles[0]
                    : "mixed";
                  return (
                    <div className="person-row" key={userId}>
                      <PersonAvatar
                        name={member?.name ?? "Former member"}
                        identity={member?.email ?? userId}
                      />
                      <div className="person-identity">
                        <strong>{member?.name ?? "Former member"}</strong>
                        <span>{member?.email}</span>
                      </div>
                      {userId === owner ? (
                        <span className="owner-label">Owner</span>
                      ) : (
                        <>
                          <div className="share-role">
                            <Choice
                              label={`Permission for ${member?.name ?? "member"}`}
                              value={role ?? "mixed"}
                              disabled={action.busy}
                              onChange={(role) => {
                                if (role !== "viewer" && role !== "editor")
                                  return;
                                updateGrants((gs) => [
                                  ...gs.filter((g) => g.userId !== userId),
                                  { userId, role },
                                ]);
                              }}
                              options={[
                                ...(role === "mixed"
                                  ? [{ value: "mixed", label: "Mixed" }]
                                  : []),
                                { value: "viewer", label: "Can view" },
                                { value: "editor", label: "Can edit" },
                              ]}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove access for ${member?.name ?? "member"}`}
                            disabled={action.busy}
                            onClick={() =>
                              updateGrants((gs) =>
                                gs.filter((g) => g.userId !== userId),
                              )
                            }
                          >
                            <X size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })}
              </section>
              <section className="share-general">
                <h3>General access</h3>
                <Select
                  items={accessOptions}
                  value={access || null}
                  disabled={action.busy}
                  onValueChange={(value) => {
                    if (value === null) return;
                    setSettings((current) =>
                      current.map((s) => ({
                        ...s,
                        access: value as Resource["access"],
                      })),
                    );
                    setCopied(false);
                  }}
                >
                  <SelectTrigger
                    aria-label="General access"
                    className={buttonVariants({ variant: "outline" })}
                  >
                    <SelectValue>
                      {(value) => {
                        const option = accessOptions.find(
                          (o) => o.value === value,
                        );
                        return option ? (
                          <span className="inline-flex items-center gap-2">
                            <option.icon size={17} />
                            <span>{option.label}</span>
                          </span>
                        ) : (
                          "Mixed access"
                        );
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup className="w-[min(22rem,calc(100vw-2rem))]">
                    {accessOptions.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className="py-2"
                      >
                        <span className="flex items-start gap-3">
                          <option.icon className="mt-0.5" size={17} />
                          <span className="flex min-w-0 flex-col gap-1">
                            <span className="font-medium">{option.label}</span>
                            <span className="text-xs leading-relaxed text-muted-foreground">
                              {option.description}
                            </span>
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {access === "link" &&
                  resources.some((r) => r.kind === "folder") && (
                    <p className="share-inherited-note">
                      Contents set to inherit folder access are included.
                      Private contents stay private.
                    </p>
                  )}
              </section>
            </div>
          )}
          {action.error && (
            <p className="error" role="alert">
              {action.error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!loaded || action.busy}
            onClick={() =>
              void action.run(async () => {
                const configs = dirty ? await save(false) : settings;
                const links = resources.map((r) => {
                  const config = configs.find((s) => s.resourceId === r.id)!;
                  if (config.access === "link") {
                    if (!config.shareUrl)
                      throw new Error(
                        "A share link is unavailable. Try again.",
                      );
                    return config.shareUrl;
                  }
                  return `${location.origin}${r.kind === "folder" ? paths.library(r.id) : paths.document(r.id, undefined, "original", r.parent_id)}`;
                });
                await navigator.clipboard.writeText(links.join("\n"));
                notifySuccess(
                  dirty
                    ? multiple
                      ? "Sharing updated and links copied"
                      : "Sharing updated and link copied"
                    : multiple
                      ? "Links copied"
                      : "Link copied",
                );
                setCopied(true);
              })
            }
          >
            <Copy size={14} />
            {copied
              ? "Copied"
              : dirty
                ? multiple
                  ? "Save & copy links"
                  : "Save & copy link"
                : multiple
                  ? "Copy links"
                  : "Copy link"}
          </Button>
          <Button
            disabled={!loaded || action.busy}
            onClick={() =>
              void action.run(async () => {
                await save();
                onClose();
              })
            }
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
