import { notifySuccess } from "@/lib/notifications";
import { Radio, RadioGroup } from "./coss/radio-group";
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
import { useEffect, useState } from "react";
import {
  Copy,
  Globe2,
  LockKeyhole,
  Plus,
  Search,
  Users,
  X,
} from "@/components/icons";
import { Button } from "@/components/coss/button";
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
export function Sharing({
  resource,
  onClose,
  onSaved,
}: {
  resource: Resource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [access, setAccess] = useState("restricted");
  const [owner, setOwner] = useState("");
  const [grants, setGrants] = useState<{ userId: string; role: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const action = useAction();
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [savedConfig, setSavedConfig] = useState("");
  const dirty = savedConfig !== JSON.stringify({ access, grants });
  const save = async () => {
    const result = await api(`/resources/${resource.id}/access`, {
      method: "PUT",
      body: JSON.stringify({ access, grants }),
    });
    setShareUrl(result.shareUrl);
    setSavedConfig(JSON.stringify({ access, grants }));
    onSaved();
    return result.shareUrl as string | null;
  };
  useEffect(() => {
    void action.run(async () => {
      const [m, a] = await Promise.all([
        api<Member[]>("/members"),
        api(`/resources/${resource.id}/access`),
      ]);
      setMembers(m);
      setOwner(a.ownerId);
      setAccess(a.access);
      setGrants(a.grants);
      setShareUrl(a.shareUrl);
      setSavedConfig(JSON.stringify({ access: a.access, grants: a.grants }));
      setLoaded(true);
    });
  }, [resource.id]);
  const eligible = members.filter(
    (m) => m.id !== owner && !grants.some((g) => g.userId === m.id),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="sharing-dialog sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share</DialogTitle>
          <DialogDescription>{resource.name}</DialogDescription>
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
                  disabled={!selected}
                  onClick={() => {
                    setGrants([
                      ...grants,
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
                {[owner, ...grants.map((g) => g.userId)].map((userId) => {
                  const member = members.find((m) => m.id === userId);
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
                              value={
                                grants.find((g) => g.userId === userId)!.role
                              }
                              onChange={(role) =>
                                setGrants((gs) =>
                                  gs.map((g) =>
                                    g.userId === userId ? { ...g, role } : g,
                                  ),
                                )
                              }
                              options={[
                                { value: "viewer", label: "Can view" },
                                { value: "editor", label: "Can edit" },
                              ]}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove access for ${member?.name ?? "member"}`}
                            onClick={() =>
                              setGrants((gs) =>
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
                <RadioGroup
                  aria-label="General access"
                  value={access}
                  onValueChange={(value) => {
                    setAccess(String(value));
                    setCopied(false);
                  }}
                >
                  {[
                    {
                      value: "restricted",
                      label: "Restricted",
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
                    ...(resource.parent_id
                      ? [
                          {
                            value: "inherit",
                            label: "Inherit folder access",
                            description:
                              "Uses the parent folder’s permissions.",
                            icon: Users,
                          },
                        ]
                      : []),
                  ].map((option) => (
                    <label className="share-access-card" key={option.value}>
                      <Radio value={option.value} />
                      <option.icon size={17} />
                      <span>
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
                {access === "link" && resource.kind === "folder" && (
                  <p className="share-inherited-note">
                    Contents set to inherit folder access are included.
                    Restricted contents stay private.
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
                const publicUrl = dirty ? await save() : shareUrl;
                const internalUrl = `${location.origin}${resource.kind === "folder" ? paths.library(resource.id) : paths.document(resource.id, undefined, "original", resource.parent_id)}`;
                await navigator.clipboard.writeText(
                  access === "link" ? publicUrl! : internalUrl,
                );
                notifySuccess("Link copied");
                setCopied(true);
              })
            }
          >
            <Copy size={14} />
            {copied ? "Copied" : dirty ? "Save & copy link" : "Copy link"}
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
