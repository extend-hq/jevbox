import { toastManager } from "./components/coss/toast";
import { notifyUploads } from "./lib/notifications";
import { FinderDropZone } from "./components/finder-drop-zone";
import { XlsxThumbnailUrlGenerator } from "./components/xlsx-thumbnail-generator";
import { renderDocumentThumbnail } from "./lib/document-thumbnail-utils";
import {
  AlertDialog,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from "./components/coss/alert-dialog";
import { useFinderView } from "./lib/preferences";
import { SharedResourceView } from "./components/shared-resource";
import { ScrollArea } from "@/components/coss/scroll-area";
import {
  navigateTo,
  paths,
  useAppNavigation,
  useLibraryNavigation,
} from "@/lib/navigation";
import { RouteLink } from "./components/route-link";
import { PersonAvatar } from "./components/person-avatar";
import { ProviderLogo } from "./components/provider-logo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  TriangleAlert,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  GitBranch,
  Library,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquareFilled,
  FolderFilled,
  MessageSquareOutline,
  FolderOpenOutline,
  UsersOutline,
  UsersFilled,
  Plus,
  Search,
  Settings,
  Share2,
  Upload,
  X,
  Moon,
  Sun,
  KeyRound,
  Users,
} from "@/components/icons";
import { useTheme } from "@/components/theme";
import { Button } from "@/components/coss/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Input } from "@/components/coss/input";
import { Textarea } from "@/components/coss/textarea";
import { Form } from "@/components/coss/form";
import { Field, FieldLabel, FieldError } from "@/components/coss/field";
import { validateLength, validateName } from "@/lib/form-validation";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogPopup,
  DialogFooter,
} from "@/components/coss/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "./components/ui/dropdown-menu";
import { api, type Me, type Resource } from "@/lib/api";
import { Auth } from "@/components/auth";
import { Brand, Loading, useAction } from "@/components/common";
import { Sharing } from "@/components/sharing";
import { SettingsView } from "@/components/settings";
import { SearchView, ChatView } from "@/components/discovery";
import { DocumentView } from "@/components/document";
import {
  FileSystem as Finder,
  type FileSystemItem,
} from "@/components/extend/file-system";
import {
  extension,
  imageExtensions,
  textExtensions,
} from "../shared/file-types";
function FolderForm({
  parentId,
  onClose,
  onSaved,
}: {
  parentId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const action = useAction();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Set the folder name and description.
          </DialogDescription>
        </DialogHeader>
        <Form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (action.busy) return;
            const f = new FormData(e.currentTarget);
            void action.run(async () => {
              await api("/folders", {
                method: "POST",
                body: JSON.stringify({
                  name: f.get("name"),
                  description: f.get("description"),
                  parentId,
                }),
              });
              onSaved();
              onClose();
            });
          }}
        >
          <DialogPanel className="space-y-4">
            <Field
              name="name"
              validate={(value) => validateName(value, "a folder name")}
            >
              <FieldLabel>Name</FieldLabel>
              <Input
                name="name"
                type="text"
                placeholder="Folder name"
                required
                maxLength={160}
              />
              <FieldError />
            </Field>
            <Field
              name="description"
              validate={(value) => validateLength(value, 1000)}
            >
              <FieldLabel>Description</FieldLabel>
              <Textarea
                name="description"
                placeholder="What belongs here?"
                maxLength={1000}
              />
              <FieldError />
            </Field>
            <p className="field-note">
              <LockKeyhole size={12} /> Folders start private. Use Share to give
              others access.
            </p>
            {action.error && (
              <p className="error" role="alert">
                {action.error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={action.busy}>
              {action.busy ? "Creating…" : "Create folder"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogPopup>
    </Dialog>
  );
}
export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [finderView, setFinderView] = useFinderView(me?.user.id);
  const [loading, setLoading] = useState(true);
  const [chatTitle, setChatTitle] = useState("");
  const navigation = useAppNavigation();
  const libraryNavigation = useLibraryNavigation();
  const {
    page,
    settingsSection,
    folderId: directory,
    documentId,
    node,
    tab,
    chatId,
    query: searchQuery,
  } = navigation.route;
  useEffect(() => {
    document.title = me
      ? documentId
        ? "Document"
        : page === "search"
          ? "Search"
          : page === "chat"
            ? "Chats"
            : page === "settings"
              ? "Organization"
              : "Library"
      : "Sign in";
  }, [me, page, documentId]);
  const { dark, toggle } = useTheme();
  const [previews, setPreviews] = useState<
    Record<string, { urls?: string[]; pageCount: number; aspectRatio?: number }>
  >({});
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [deleting, setDeleting] = useState<Resource[] | null>(null);
  const deletion = useAction();
  const [sharing, setSharing] = useState<Resource | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [uploading, setUploading] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const authenticated = useRef(false);
  const action = useAction();
  const loadMe = useCallback(async () => {
    try {
      setMe(await api<Me>("/me"));
      authenticated.current = true;
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    try {
      setResources(await api<Resource[]>("/resources"));
    } catch (e) {
      setResources([]);
      action.setError((e as Error).message);
    } finally {
      setResourcesLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!navigation.route.shareToken) void loadMe();
    const expire = () => {
      if (authenticated.current) {
        authenticated.current = false;
        location.replace("/");
      }
      setMe(null);
      setResources([]);
    };
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, [loadMe, navigation.route.shareToken]);
  useEffect(() => {
    if (!me || navigation.route.shareToken) return;
    setResourcesLoading(true);
    void refresh();
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [me?.organization.id, refresh, navigation.route.shareToken]);
  const folders = resources.filter((r) => r.kind === "folder");
  const documents = resources.filter((r) => r.kind === "document");
  const currentFolder = folders.find((r) => r.id === directory);
  const selectedResource = resources.find((r) => r.id === selected);
  const pathFor = (r: Resource): string => {
    const parent = resources.find((p) => p.id === r.parent_id);
    const duplicate = resources.some(
      (p) => p.id !== r.id && p.parent_id === r.parent_id && p.name === r.name,
    );
    const label = duplicate
      ? r.name.replace(/(\.[^.]+)?$/, ` (${r.id.slice(0, 8)})$1`)
      : r.name;
    return `${parent ? pathFor(parent) : ""}${label}${r.kind === "folder" ? "/" : ""}`;
  };
  const items: FileSystemItem[] = resources.map((r) =>
    r.kind === "folder"
      ? { kind: "folder", path: pathFor(r) }
      : {
          kind: "file",
          key: r.id,
          path: pathFor(r),
          contentType: r.mime,
          size: r.size,
          metadata: { Index: r.status },
          createdAt: r.created,
          updatedAt: r.created,
          url: `/api/documents/${r.id}/content`,
          previewPageCount:
            previews[r.id]?.pageCount ??
            (textExtensions.includes(extension(r.name)) ||
            ["pdf", "docx", "pptx"].includes(extension(r.name))
              ? Math.max(r.pages || 1, 1)
              : undefined),
          previewImageUrls: previews[r.id]?.urls,
          previewAspectRatio:
            previews[r.id]?.aspectRatio ??
            (extension(r.name) === "pptx"
              ? 16 / 9
              : extension(r.name) === "xlsx"
                ? 1.6
                : undefined),
          previewImageUrl: imageExtensions.includes(extension(r.name))
            ? `/api/documents/${r.id}/content`
            : undefined,
        },
  );
  const loadPreviewImageUrl = useCallback(
    async (file: FileSystemItem, pageIndex: number) => {
      if (file.kind !== "file" || !file.url) return null;
      const thumbnail = await renderDocumentThumbnail(
        file.url,
        file.path,
        pageIndex,
      );
      if (thumbnail && file.key)
        setPreviews((current) => {
          const urls = [...(current[file.key!]?.urls ?? [])];
          urls[pageIndex] = thumbnail.url;
          return {
            ...current,
            [file.key!]: {
              ...current[file.key!],
              urls,
              pageCount: thumbnail.pageCount,
              aspectRatio:
                "aspectRatio" in thumbnail ? thumbnail.aspectRatio : undefined,
            },
          };
        });
      return thumbnail?.url ?? null;
    },
    [],
  );
  const loadDocumentStructure = useCallback(async (file: FileSystemItem) => {
    if (file.kind !== "file" || !file.key) return null;
    const { parsed } = await api<Resource>(`/resources/${file.key}`);
    return parsed
      ? { sections: parsed.nodes, blocks: parsed.blocks ?? [] }
      : null;
  }, []);
  const openDocument = (id: string, node?: string) =>
    navigateTo(
      paths.document(
        id,
        node,
        node ? "index" : "original",
        resources.find((r) => r.id === id)?.parent_id,
      ),
    );
  const pagePath = (next: string) =>
    next === "chat"
      ? paths.chat()
      : next === "settings"
        ? paths.settings()
        : next === "search"
          ? paths.search()
          : paths.library();
  const navigate = (next: string) => navigateTo(pagePath(next));
  useEffect(() => {
    setMobileNav(false);
    setSelected(null);
  }, [page, directory, documentId, settingsSection]);
  async function upload(files: FileList | File[]) {
    const errors: string[] = [];
    let completed = 0;
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const body = new FormData();
        body.append("file", file);
        if (currentFolder) body.append("parentId", currentFolder.id);
        await api("/documents", { method: "POST", body });
        completed++;
      } catch (error) {
        errors.push(`${file.name}: ${(error as Error).message}`);
      }
    }
    setUploading("");
    notifyUploads(completed);
    await refresh();
    if (errors.length) throw new Error(errors.join("\n"));
  }
  if (navigation.route.shareToken)
    return <SharedResourceView route={navigation.route} />;
  if (loading) return <Loading fullScreen />;
  if (!me || location.pathname === "/reset-password")
    return <Auth onLogin={() => void loadMe()} />;
  const currentDocument = resources.find((r) => r.id === documentId);
  const ancestors: Resource[] = [];
  let parentId = currentDocument?.parent_id ?? directory;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const folder = folders.find((r) => r.id === parentId);
    if (!folder) break;
    ancestors.unshift(folder);
    parentId = folder.parent_id;
  }
  const breadcrumbs =
    page === "chat"
      ? [
          { label: "Chats", href: paths.chat() },
          ...(chatId
            ? [{ label: chatTitle || "Conversation", href: paths.chat(chatId) }]
            : []),
        ]
      : page === "settings"
        ? [
            { label: "Organization", href: paths.settings() },
            {
              label:
                settingsSection === "connections" ? "Connections" : "Members",
              href: paths.settings(settingsSection),
            },
          ]
        : [
            { label: "Library", href: paths.library() },
            ...ancestors.map((folder) => ({
              label: folder.name,
              href: paths.library(folder.id),
            })),
            ...(documentId
              ? [
                  {
                    label: currentDocument?.name ?? "Document",
                    href: paths.document(
                      documentId,
                      node,
                      tab,
                      currentDocument?.parent_id,
                    ),
                  },
                ]
              : page === "search"
                ? [
                    {
                      label: searchQuery ? `Search: ${searchQuery}` : "Search",
                      href: paths.search(searchQuery),
                    },
                  ]
                : []),
          ];
  const sidebarFolders = (
    parentId: string | null,
    depth = 0,
  ): React.ReactNode =>
    folders
      .filter((f) => f.parent_id === parentId)
      .map((f) => (
        <div key={f.id}>
          <RouteLink
            href={paths.library(f.id)}
            className={`nav-folder ${directory === f.id && page === "library" ? "active" : ""}`}
            style={{ paddingLeft: 12 + depth * 12 }}
          >
            <Folder size={15} />
            <span>{f.name}</span>
            {f.access === "restricted" && <LockKeyhole size={11} />}
          </RouteLink>
          {sidebarFolders(f.id, depth + 1)}
        </div>
      ));
  return (
    <div
      className={`app-shell ${page === "chat" && !documentId ? "chat-shell" : page === "settings" && !documentId ? "settings-shell" : "library-shell"}`}
    >
      <TooltipProvider delay={350}>
        <nav className="app-rail" aria-label="Main navigation">
          {[
            {
              id: "chat",
              label: "Chats",
              icon: MessageSquareFilled,
              outline: MessageSquareOutline,
            },
            {
              id: "library",
              label: "Library",
              icon: FolderFilled,
              outline: FolderOpenOutline,
            },
            {
              id: "settings",
              label: "Organization",
              icon: UsersFilled,
              outline: UsersOutline,
            },
          ].map((item) => (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>
                <RouteLink
                  href={pagePath(item.id)}
                  aria-label={item.label}
                  className={`rail-item ${(documentId || page === "search" ? "library" : page) === item.id ? "active" : ""}`}
                  aria-current={
                    (documentId || page === "search" ? "library" : page) ===
                    item.id
                      ? "page"
                      : undefined
                  }
                >
                  {(documentId || page === "search" ? "library" : page) ===
                  item.id ? (
                    <item.icon size={20} aria-hidden="true" />
                  ) : (
                    <item.outline size={20} aria-hidden="true" />
                  )}
                </RouteLink>
              </TooltipTrigger>
              <TooltipPopup side="right" sideOffset={12}>
                {item.label}
              </TooltipPopup>
            </Tooltip>
          ))}
          <div className="rail-bottom">
            {uploading && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="rail-alert"
                    tabIndex={0}
                    role="status"
                    aria-label={`Uploading ${uploading}`}
                  >
                    <Upload size={22} />
                  </span>
                </TooltipTrigger>
                <TooltipPopup side="right">Uploading {uploading}</TooltipPopup>
              </Tooltip>
            )}
            {action.error && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="rail-alert"
                    aria-label={`${action.error} · Dismiss`}
                    onClick={() => action.setError("")}
                  >
                    <TriangleAlert size={24} className="micro-alert-icon" />
                    <X className="rail-alert-action" size={10} />
                  </button>
                </TooltipTrigger>
                <TooltipPopup side="right">{action.error}</TooltipPopup>
              </Tooltip>
            )}
            {[
              {
                provider: "extend",
                label: "Extend",
                connected: me.extendEnabled,
                issue: documents.some((d) => d.status === "failed"),
                size: 29,
              },
              {
                provider: "typesafe",
                label: "TypeSafe",
                connected: me.semanticEnabled,
                issue: false,
                size: 22,
              },
            ]
              .filter((connection) => !connection.connected)
              .map((connection) => (
                <Tooltip key={connection.provider}>
                  <TooltipTrigger asChild>
                    <RouteLink
                      className="rail-alert"
                      aria-label={`${connection.label}: ${!connection.connected ? "not connected" : connection.issue ? "indexing needs attention" : "connected"}`}
                      href={paths.settings("connections")}
                    >
                      <ProviderLogo
                        provider={connection.provider}
                        size={connection.size}
                      />
                      {(!connection.connected || connection.issue) && (
                        <TriangleAlert
                          className="rail-alert-action rail-connection-warning micro-alert-icon"
                          size={11}
                        />
                      )}
                    </RouteLink>
                  </TooltipTrigger>
                  <TooltipPopup side="right">
                    {connection.label} ·{" "}
                    {!connection.connected
                      ? "Not connected"
                      : connection.issue
                        ? "Indexing needs attention"
                        : "Connected"}
                  </TooltipPopup>
                </Tooltip>
              ))}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              aria-label={dark ? "Use light theme" : "Use dark theme"}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="rail-avatar" aria-label="Account menu">
                  <PersonAvatar name={me.user.name} identity={me.user.email} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" sideOffset={12}>
                <div className="account-menu-details">
                  <strong>{me.user.name}</strong>
                  <span>{me.user.email}</span>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                  <Users size={15} />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("settings")}>
                  <Settings size={15} />
                  Organization settings
                </DropdownMenuItem>
                {me.organizations.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    {me.organizations.map((org) => (
                      <DropdownMenuItem
                        key={org.id}
                        disabled={org.id === me.organization.id}
                        onClick={() =>
                          void action.run(async () => {
                            await api("/organization/switch", {
                              method: "POST",
                              body: JSON.stringify({ orgId: org.id }),
                            });
                            location.href = "/";
                          })
                        }
                      >
                        {org.name}
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    void action.run(async () => {
                      await api("/auth/revoke-other-sessions", {
                        method: "POST",
                        body: JSON.stringify({}),
                      });
                    })
                  }
                >
                  <LogOut size={15} />
                  Sign out other devices
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void action.run(async () => {
                      await api("/auth/logout", { method: "POST" });
                      location.replace("/");
                    })
                  }
                >
                  <LogOut size={15} />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>
      </TooltipProvider>
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <Button
            variant="ghost"
            size="icon"
            className="mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X size={18} />
          </Button>
        </div>
        <nav
          aria-label={
            page === "settings"
              ? "Organization navigation"
              : "Library navigation"
          }
        >
          {(page === "settings"
            ? [
                { id: "people", title: "Members", icon: Users },
                { id: "connections", title: "Connections", icon: KeyRound },
              ]
            : [
                { id: "library", title: "Library", icon: Library },
                { id: "search", title: "Search", icon: Search },
              ]
          ).map((item) => (
            <RouteLink
              key={item.id}
              href={
                page === "settings"
                  ? paths.settings(item.id)
                  : pagePath(item.id)
              }
              className={`nav-item ${(page === "settings" ? settingsSection : page) === item.id ? "active" : ""}`}
            >
              <item.icon size={17} />
              {item.title}
              {item.id === "library" && (
                <span className="nav-count">{documents.length}</span>
              )}
            </RouteLink>
          ))}
        </nav>
        {page !== "settings" && (
          <>
            <div className="sidebar-section">
              <span>FOLDERS</span>
              <button
                aria-label="Create folder"
                onClick={() => {
                  navigateTo(paths.library());
                  setFolderOpen(true);
                }}
              >
                <Plus size={14} />
              </button>
            </div>
            <ScrollArea className="folder-navigation" scrollFade>
              {sidebarFolders(null)}
              {!folders.length && (
                <p className="sidebar-hint">
                  No folders yet.
                  <button onClick={() => setFolderOpen(true)}>
                    Create a folder <ArrowRight size={12} />
                  </button>
                </p>
              )}
            </ScrollArea>
          </>
        )}
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Button
            variant="ghost"
            size="icon"
            className="mobile-toggle"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={18} />
          </Button>
          <nav className="app-breadcrumbs" aria-label="Breadcrumb">
            <ol>
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.href}-${index}`}>
                  {index > 0 && <ChevronRight size={12} />}
                  {index === breadcrumbs.length - 1 ? (
                    <span aria-current="page" title={crumb.label}>
                      {crumb.label}
                    </span>
                  ) : (
                    <RouteLink href={crumb.href}>{crumb.label}</RouteLink>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        </header>
        <main className="main-content">
          {documentId ? (
            <DocumentView
              key={documentId}
              documentId={documentId}
              initialResource={currentDocument}
              userId={me?.user.id}
              initialNode={node}
              initialTab={tab}
              onNavigate={(nextNode, nextTab) =>
                navigateTo(
                  paths.document(
                    documentId,
                    nextNode,
                    nextTab,
                    currentDocument?.parent_id,
                  ),
                )
              }
              onBack={() =>
                navigateTo(
                  paths.library(
                    resources.find((r) => r.id === documentId)?.parent_id,
                  ),
                )
              }
              onShare={setSharing}
              onChange={() => void refresh()}
            />
          ) : page === "settings" ? (
            <ScrollArea scrollFade>
              <SettingsView
                me={me}
                section={settingsSection}
                onSaved={() => void loadMe()}
              />
            </ScrollArea>
          ) : page === "search" ? (
            <ScrollArea scrollFade>
              <SearchView
                me={me}
                key={searchQuery}
                initialQuery={searchQuery}
                onSearch={(query) => navigateTo(paths.search(query))}
                onOpen={openDocument}
              />
            </ScrollArea>
          ) : page === "chat" ? (
            <ChatView
              me={me}
              chatId={chatId}
              onTitleChange={setChatTitle}
              onChatChange={(id, replace) =>
                navigateTo(paths.chat(id), { replace })
              }
              onOpen={openDocument}
              onSettings={() => navigateTo(paths.settings("connections"))}
            />
          ) : (
            <div className="library-page">
              {(!me.semanticEnabled || !me.extendEnabled) && (
                <div className="library-connection-prompt">
                  <span className="provider-logo-stack" aria-hidden="true">
                    <span>
                      <ProviderLogo provider="extend" size={24} />
                    </span>
                    <span>
                      <ProviderLogo provider="typesafe" size={22} />
                    </span>
                  </span>
                  <div>
                    <strong>Connect your document library</strong>
                    <p>
                      {!me.semanticEnabled && !me.extendEnabled
                        ? "Connect Extend to parse documents and TypeSafe to find the right sources."
                        : !me.extendEnabled
                          ? "Connect Extend to parse PDFs, Office documents, and images."
                          : "Connect TypeSafe to find sources across your document hierarchy."}
                    </p>
                  </div>
                  <Button
                    onClick={() => navigateTo(paths.settings("connections"))}
                  >
                    {me.role === "admin"
                      ? "Set up connections"
                      : "View connections"}
                    <ArrowRight size={14} />
                  </Button>
                </div>
              )}
              {documents
                .filter(
                  (r) =>
                    extension(r.name) === "xlsx" &&
                    r.parent_id === (directory ?? null) &&
                    !previews[r.id]?.urls,
                )
                .map((r) => (
                  <XlsxThumbnailUrlGenerator
                    key={r.id}
                    url={`/api/documents/${r.id}/content`}
                    fileName={r.name}
                    onUrls={(urls, pageCount) =>
                      setPreviews((current) => ({
                        ...current,
                        [r.id]: { urls, pageCount, aspectRatio: 1.6 },
                      }))
                    }
                  />
                ))}
              <input
                ref={uploadInput}
                className="sr-only"
                type="file"
                multiple
                aria-label="Upload documents"
                onChange={(e) => {
                  if (e.target.files)
                    void action.run(() => upload(e.target.files!));
                  e.target.value = "";
                }}
              />
              <FinderDropZone
                onFiles={(files) => {
                  void action.run(() => upload(files));
                }}
              >
                <div className="finder-wrap">
                  <Finder
                    items={items}
                    isLoading={resourcesLoading}
                    loadPreviewImageUrl={loadPreviewImageUrl}
                    loadDocumentStructure={loadDocumentStructure}
                    title=""
                    view={finderView}
                    onViewChange={setFinderView}
                    onShare={(item) => {
                      const resource = resources.find(
                        (r) => pathFor(r) === item.path,
                      );
                      if (resource) setSharing(resource);
                    }}
                    canShare={(item) =>
                      Boolean(
                        resources.find((r) => pathFor(r) === item.path)
                          ?.canShare,
                      )
                    }
                    canOrganize={(item) => {
                      const resource = resources.find(
                        (r) => pathFor(r) === item.path,
                      );
                      return Boolean(
                        !action.busy &&
                        me.semanticEnabled &&
                        resource?.kind === "document" &&
                        resource.canShare &&
                        resource.status === "ready" &&
                        resource.access === "restricted",
                      );
                    }}
                    onOrganizeItems={(selectedItems) =>
                      void action.run(async () => {
                        const ids = selectedItems.flatMap((item) => {
                          const resource = resources.find(
                            (r) => pathFor(r) === item.path,
                          );
                          return resource ? [resource.id] : [];
                        });
                        if (!ids.length) return;
                        await toastManager
                          .promise(
                            (async () => {
                              const result = await api<{
                                count: number;
                                completed: number;
                                failed: { id: string; error: string }[];
                              }>("/documents/organize", {
                                method: "POST",
                                body: JSON.stringify({ ids }),
                              });
                              await refresh();
                              if (result.failed.length)
                                throw new Error(
                                  `${result.completed} of ${result.count} documents organized. ${result.failed[0].error}`,
                                );
                              return result;
                            })(),
                            {
                              loading: {
                                title:
                                  ids.length === 1
                                    ? "Organizing document…"
                                    : `Organizing ${ids.length} documents…`,
                              },
                              success: (result) => ({
                                title:
                                  result.count === 1
                                    ? "Document organized"
                                    : `${result.count} documents organized`,
                              }),
                              error: (error) => ({
                                title: "Couldn't organize documents",
                                description:
                                  error instanceof Error
                                    ? error.message
                                    : "Try again.",
                                timeout: 10000,
                              }),
                            },
                          )
                          .catch(() => {});
                      })
                    }
                    onDeleteItems={(selectedItems) => {
                      deletion.setError("");
                      const matches = selectedItems.flatMap((item) => {
                        const resource = resources.find(
                          (resource) => pathFor(resource) === item.path,
                        );
                        return resource ? [resource] : [];
                      });
                      if (matches.length) setDeleting(matches);
                    }}
                    getMoveDestinations={(item) => {
                      const resource = resources.find(
                        (r) => pathFor(r) === item.path,
                      );
                      if (!resource?.canShare) return [];
                      return [
                        ...(resource.parent_id
                          ? [{ id: null, label: "Library" }]
                          : []),
                        ...folders
                          .filter(
                            (folder) =>
                              folder.canWrite &&
                              folder.id !== resource.parent_id &&
                              folder.id !== resource.id &&
                              !(
                                resource.kind === "folder" &&
                                pathFor(folder).startsWith(item.path)
                              ),
                          )
                          .map((folder) => ({
                            id: folder.id,
                            label: pathFor(folder)
                              .replace(/\/$/, "")
                              .split("/")
                              .join(" / "),
                          })),
                      ];
                    }}
                    onMove={(item, parentId) =>
                      void action.run(async () => {
                        const resource = resources.find(
                          (r) => pathFor(r) === item.path,
                        );
                        if (!resource) return;
                        await api(`/resources/${resource.id}/move`, {
                          method: "POST",
                          body: JSON.stringify({ parentId }),
                        });
                        await refresh();
                      })
                    }
                    onSearchSubmit={(query) => navigateTo(paths.search(query))}
                    headerActions={
                      <div className="finder-actions">
                        {currentFolder?.canShare && (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Share folder"
                                  onClick={() => setSharing(currentFolder)}
                                />
                              }
                            >
                              <Share2 size={15} />
                            </TooltipTrigger>
                            <TooltipPopup>Share folder</TooltipPopup>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="New folder"
                                disabled={Boolean(
                                  currentFolder && !currentFolder.canWrite,
                                )}
                                onClick={() => setFolderOpen(true)}
                              />
                            }
                          >
                            <Folder size={15} />
                          </TooltipTrigger>
                          <TooltipPopup>New folder</TooltipPopup>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Upload documents"
                                disabled={Boolean(
                                  uploading ||
                                  (currentFolder && !currentFolder.canWrite),
                                )}
                                onClick={() => uploadInput.current?.click()}
                              />
                            }
                          >
                            <Upload size={15} />
                          </TooltipTrigger>
                          <TooltipPopup>Upload documents</TooltipPopup>
                        </Tooltip>
                      </div>
                    }
                    defaultView="icons"
                    path={currentFolder ? pathFor(currentFolder) : ""}
                    navigation={libraryNavigation}
                    onPathChange={(path) =>
                      navigateTo(
                        paths.library(
                          folders.find((f) => pathFor(f) === path)?.id,
                        ),
                      )
                    }
                    onFileOpen={(file) => openDocument(file.key ?? "")}
                    onSelectionChange={(item) =>
                      setSelected(
                        item?.kind === "file"
                          ? (item.key ?? null)
                          : (resources.find((r) => pathFor(r) === item?.path)
                              ?.id ?? null),
                      )
                    }
                  />
                </div>
              </FinderDropZone>
            </div>
          )}
        </main>
      </div>
      <AlertDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open && !deletion.busy) setDeleting(null);
        }}
      >
        <AlertDialogPopup>
          <div className="flex flex-col gap-2 p-6">
            <AlertDialogTitle className="text-lg font-semibold">
              {deleting && deleting.length > 1
                ? `Delete ${deleting.length} items?`
                : `Delete ${deleting?.[0].kind === "folder" ? "folder" : "document"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              {deleting?.some((resource) => resource.kind === "folder")
                ? "This permanently deletes the selected items and all documents and subfolders inside them. "
                : deleting && deleting.length > 1
                  ? "This permanently deletes the selected documents and their indexes. "
                  : "This permanently deletes the document and its index. "}
              This action cannot be undone.
            </AlertDialogDescription>
            {deleting?.length === 1 && (
              <p className="text-sm">{deleting[0].name}</p>
            )}
            {deletion.error && (
              <p className="error" role="alert">
                {deletion.error}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 rounded-b-2xl border-t bg-muted/50 px-6 py-4">
            <AlertDialogClose
              render={<Button variant="outline" disabled={deletion.busy} />}
            >
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={deletion.busy}
              onClick={() =>
                void deletion.run(async () => {
                  if (!deleting) return;
                  await api("/resources/delete-batch", {
                    method: "POST",
                    body: JSON.stringify({
                      ids: deleting.map((resource) => resource.id),
                    }),
                  });
                  setDeleting(null);
                  setSelected(null);
                  await refresh();
                })
              }
            >
              {deletion.busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </AlertDialogPopup>
      </AlertDialog>
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>Account details</DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <dl className="profile-details">
              <dt>Name</dt>
              <dd>{me.user.name}</dd>
              <dt>Email</dt>
              <dd>{me.user.email}</dd>
              <dt>Organization role</dt>
              <dd>{me.role === "admin" ? "Admin" : "Member"}</dd>
            </dl>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
      {sharing && (
        <Sharing
          resource={sharing}
          onClose={() => setSharing(null)}
          onSaved={() => void refresh()}
        />
      )}{" "}
      {folderOpen && (
        <FolderForm
          parentId={directory}
          onClose={() => setFolderOpen(false)}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  );
}
