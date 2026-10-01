import { notifyUploads } from "@/lib/notifications";
import { SearchInput } from "@/components/search-input";
import { ScrollArea } from "@/components/coss/scroll-area";
import { ProviderLogo } from "./provider-logo";
import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
  type RefObject,
} from "react";
import { Check, Paperclip, Upload } from "./icons";
import { Button } from "./coss/button";
import { Popover, PopoverTrigger, PopoverPopup } from "./ui/popover";
import { CursorTooltip } from "./cursor-tooltip";
import { Choice } from "./common";
import { Badge } from "./coss/badge";
import { IndexStatusBadge } from "./index-status-badge";
import { ResourceThumbnail } from "./resource-thumbnail";
import { api, type Me, type Resource, type Source } from "@/lib/api";

export type ChatComposerToolsHandle = {
  handleMentionKey: (event: KeyboardEvent) => boolean;
};
type Props = {
  ref?: Ref<ChatComposerToolsHandle>;
  composerAnchor: RefObject<HTMLFormElement | null>;
  mentionQuery: string | null;
  onMentionClose: () => void;
  onMentionAttach: (document: Resource) => void;
  me: Me;
  attachments: Resource[];
  setAttachments: React.Dispatch<React.SetStateAction<Resource[]>>;
  selectedModel: string;
  onModelChange: (value: string) => void;
  onSettings: () => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
};
export function ChatComposerTools({
  ref,
  composerAnchor,
  mentionQuery,
  onMentionClose,
  onMentionAttach,
  me,
  attachments,
  setAttachments,
  selectedModel,
  onModelChange,
  onSettings,
  disabled,
  onBusyChange,
}: Props) {
  const [manualOpen, setOpen] = useState(false);
  const open = manualOpen || mentionQuery !== null;
  const [documents, setDocuments] = useState<Resource[]>([]);
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<{
    query: string;
    sources: Source[];
  } | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRequest = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const mentionOrigin = useRef(false);
  const mentionPicker = mentionQuery !== null || mentionOrigin.current;
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentKey = attachments.map((a) => a.id).join(",");
  useEffect(() => {
    if (!open && !attachmentKey) return;
    let active = true;
    const refresh = async () => {
      try {
        const resources = await api<Resource[]>("/resources");
        if (!active) return;
        setError("");
        setDocuments(resources.filter((r) => r.kind === "document"));
        setAttachments((current) =>
          current.flatMap((item) => {
            const fresh = resources.find((r) => r.id === item.id);
            return fresh ? [fresh] : [];
          }),
        );
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoadingDocuments(false);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, attachmentKey, setAttachments]);
  const effectiveQuery = mentionQuery ?? query;
  const matchedSources =
    searchResult?.query === effectiveQuery.trim() ? searchResult.sources : null;
  const visibleDocuments = documents
    .filter((document) =>
      matchedSources
        ? matchedSources.some((source) => source.documentId === document.id)
        : document.name.toLowerCase().includes(effectiveQuery.toLowerCase()),
    )
    .slice(0, 50);
  const selectableIndexes = visibleDocuments.flatMap((document, index) =>
    attachments.some((item) => item.id === document.id) ||
    (document.status === "ready" && attachments.length < 8)
      ? [index]
      : [],
  );
  const selectableKey = selectableIndexes.join(",");
  useEffect(() => {
    setActiveIndex((current) =>
      selectableIndexes.includes(current)
        ? current
        : (selectableIndexes[0] ?? -1),
    );
  }, [selectableKey]);
  useEffect(() => {
    setActiveIndex(selectableIndexes[0] ?? -1);
    searchRequest.current++;
    setSearching(false);
  }, [effectiveQuery]);
  useEffect(() => {
    if (mentionQuery !== null) {
      mentionOrigin.current = true;
      setQuery(mentionQuery);
      setSearchResult(null);
    }
  }, [mentionQuery]);
  function closePicker() {
    setOpen(false);
    onMentionClose();
  }
  function attach(document: Resource) {
    const selected = attachments.some((item) => item.id === document.id);
    if (!selected && (document.status !== "ready" || attachments.length >= 8))
      return;
    if (mentionQuery !== null) {
      setOpen(false);
      onMentionAttach(document);
      return;
    }
    setAttachments((current) =>
      selected
        ? current.filter((item) => item.id !== document.id)
        : [...current, document],
    );
  }
  async function searchLibrary() {
    const value = effectiveQuery.trim();
    if (!value) return;
    const request = ++searchRequest.current;
    setSearching(true);
    setError("");
    try {
      const result = await api<{ results: Source[] }>("/search", {
        method: "POST",
        body: JSON.stringify({ query: value }),
      });
      if (request === searchRequest.current)
        setSearchResult({ query: value, sources: result.results });
    } catch (error) {
      if (request === searchRequest.current) setError((error as Error).message);
    } finally {
      if (request === searchRequest.current) setSearching(false);
    }
  }
  function handleMentionKey(event: { key: string; shiftKey: boolean }) {
    if (mentionQuery === null) return false;
    if (event.key === "Escape") {
      closePicker();
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      setActiveIndex((current) => {
        const position = selectableIndexes.indexOf(current);
        const next = Math.max(
          0,
          Math.min(
            selectableIndexes.length - 1,
            position + (event.key === "ArrowDown" ? 1 : -1),
          ),
        );
        return selectableIndexes[next] ?? -1;
      });
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const document = visibleDocuments[activeIndex];
      if (document) attach(document);
      else void searchLibrary();
      return true;
    }
    return false;
  }
  useImperativeHandle(ref, () => ({ handleMentionKey }));
  useEffect(() => {
    if (open)
      window.document
        .querySelector(`[data-attachment-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (files.length + attachments.length > 8) {
      setError("Attach up to eight documents.");
      return;
    }
    let completed = 0;
    setUploading(true);
    onBusyChange(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("file", file);
        const uploaded = await api<{ id: string }>("/documents", {
          method: "POST",
          body,
        });
        completed++;
        const document = await api<Resource>(`/resources/${uploaded.id}`);
        setAttachments((current) => [...current, document]);
      }
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      notifyUploads(completed);
      setUploading(false);
      onBusyChange(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <>
      <Popover
        open={open}
        modal={false}
        onOpenChange={(value) => {
          if (value) {
            if (mentionQuery === null) mentionOrigin.current = false;
            setOpen(true);
          } else closePicker();
        }}
      >
        <CursorTooltip label="Attach documents">
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="attach-documents-trigger"
              aria-label="Attach documents"
              disabled={disabled || uploading}
            >
              <Paperclip size={17} />
            </Button>
          </PopoverTrigger>
        </CursorTooltip>
        <PopoverPopup
          side="top"
          align="start"
          sideOffset={12}
          className={
            mentionPicker
              ? "attachment-picker mention-picker"
              : "attachment-picker"
          }
          anchor={mentionPicker ? composerAnchor : undefined}
          initialFocus={mentionPicker ? false : searchInput}
          finalFocus={() =>
            mentionOrigin.current
              ? (composerAnchor.current?.querySelector<HTMLElement>(
                  ".chat-prompt-content",
                ) ?? false)
              : true
          }
        >
          <div className="attachment-picker-body">
            {!mentionPicker && (
              <div className="attachment-picker-heading">
                <strong>Attach documents</strong>
                <span>{attachments.length}/8</span>
              </div>
            )}
            {!mentionPicker && (
              <Button
                type="button"
                variant="outline"
                disabled={uploading || attachments.length >= 8}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={15} />
                {uploading ? "Uploading…" : "Upload from computer"}
              </Button>
            )}
            {!mentionPicker && (
              <SearchInput
                aria-label="Find a document to attach"
                placeholder="Find in your library…"
                ref={searchInput}
                value={effectiveQuery}
                onChange={(e) => {
                  setOpen(true);
                  setQuery(e.target.value);
                  setSearchResult(null);
                }}
                onKeyDown={(event) => {
                  if (
                    !event.nativeEvent.isComposing &&
                    handleMentionKey(event)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                  } else if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    void searchLibrary();
                  }
                }}
              />
            )}
            {!mentionPicker && (
              <p className="attachment-search-hint" role="status">
                {searching
                  ? "Searching your library…"
                  : matchedSources
                    ? "Library search results"
                    : "Press Enter to search document contents"}
              </p>
            )}
            <ScrollArea className="attachment-scroll" scrollFade>
              <div
                className="attachment-document-list"
                role="listbox"
                aria-label="Library documents"
                aria-multiselectable="true"
              >
                {visibleDocuments.map((document, index) => {
                  const selected = attachments.some(
                    (a) => a.id === document.id,
                  );
                  const source = matchedSources?.find(
                    (item) => item.documentId === document.id,
                  );
                  return (
                    <button
                      key={document.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-attachment-index={index}
                      data-active={
                        mentionQuery !== null && index === activeIndex
                          ? "true"
                          : undefined
                      }
                      disabled={
                        !selected &&
                        (document.status !== "ready" || attachments.length >= 8)
                      }
                      onClick={() => attach(document)}
                      onMouseDown={
                        mentionPicker
                          ? (event) => event.preventDefault()
                          : undefined
                      }
                    >
                      <ResourceThumbnail
                        name={document.name}
                        mime={document.mime}
                        src={`/api/documents/${document.id}/content`}
                        className="w-8 shrink-0 rounded-sm"
                      />
                      <span className="attachment-document-details">
                        <span className="truncate block">{document.name}</span>
                        <span className="attachment-badges">
                          <IndexStatusBadge
                            status={document.status}
                            error={document.error}
                          />
                          {source && (
                            <Badge size="sm" variant="secondary">
                              {source.title}
                            </Badge>
                          )}
                        </span>
                      </span>
                      {selected && <Check size={15} />}
                    </button>
                  );
                })}
                {loadingDocuments ? (
                  <p role="status">Loading documents…</p>
                ) : (
                  !visibleDocuments.length && (
                    <p>
                      {effectiveQuery
                        ? `No documents match “${effectiveQuery}”.`
                        : "No documents yet. Upload one to get started."}
                    </p>
                  )
                )}
              </div>
            </ScrollArea>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </div>
        </PopoverPopup>
      </Popover>
      <input
        ref={fileInput}
        type="file"
        multiple
        className="sr-only"
        aria-label="Upload chat attachments"
        onChange={(e) => void upload(e.target.files)}
      />
      <div className="composer-model">
        {me.chatModels?.length ? (
          <Choice
            label="Chat model"
            value={selectedModel}
            onChange={onModelChange}
            disabled={disabled}
            options={me.chatModels.map((m) => ({
              value: `${m.provider}:${m.model}`,
              label: (
                <span className="provider-option">
                  <ProviderLogo provider={m.provider} size={16} />
                  <span>{m.model}</span>
                </span>
              ),
            }))}
          />
        ) : (
          <Button type="button" variant="ghost" onClick={onSettings}>
            Choose model
          </Button>
        )}
      </div>
      {error && !open && (
        <span role="alert" className="composer-error">
          {error}
        </span>
      )}
    </>
  );
}
