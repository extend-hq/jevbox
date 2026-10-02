import { JevboxIcon } from "./jevbox-icon";
import { ScrollArea } from "@/components/coss/scroll-area";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Spinner } from "./coss/spinner";
import { BoxLoader } from "./box-loader";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "@/components/coss/select";
import ReactMarkdown, { type Components } from "react-markdown";
import {
  inlineCitations,
  inlineAttachments,
  revealMarkdown,
  streamingCursor,
} from "./chat-message-presentation";
import { ChatSourceChip } from "./chat-source-chip";
import { DocumentPillContent } from "./document-pill-content";
import { RouteLink } from "./route-link";
import type { Source } from "@/lib/api";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
const documentHtmlSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    td: [...(defaultSchema.attributes?.td ?? []), "colSpan", "rowSpan"],
    th: [
      ...(defaultSchema.attributes?.th ?? []),
      "colSpan",
      "rowSpan",
      "scope",
    ],
  },
};
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <JevboxIcon size={small ? 19 : 23} />
      </span>
      <span>
        jevbox<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
export function Loading({
  label = "Loading",
  fullScreen = false,
  inline = false,
}: {
  label?: string;
  fullScreen?: boolean;
  inline?: boolean;
}) {
  const compact = inline && !fullScreen;
  return (
    <div
      className={`loading${fullScreen ? " loading-fullscreen" : ""}${compact ? " loading-inline" : ""}`}
      role={compact ? "status" : undefined}
      aria-label={compact ? label : undefined}
    >
      {compact ? <Spinner aria-hidden="true" /> : <BoxLoader label={label} />}
    </div>
  );
}
export function Choice({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
const MarkdownSourceContext = createContext<{
  sources: Source[];
  onSourcePreview?: (source: Source) => void;
  attachments: { id: string; name: string }[];
  onDocumentOpen?: (id: string) => void;
}>({ sources: [], attachments: [] });

function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const { sources, onSourcePreview, attachments, onDocumentOpen } = useContext(
    MarkdownSourceContext,
  );
  const attachment = attachments.find(
    ({ id }) => href === `/library/documents/${id}`,
  );
  if (attachment)
    return (
      <RouteLink
        href={href}
        className="prompt-document-pill"
        data-document-id={attachment.id}
        aria-label={`Open ${attachment.name}`}
        onClick={(event) => {
          if (
            !onDocumentOpen ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          onDocumentOpen(attachment.id);
        }}
      >
        <DocumentPillContent {...attachment} />
      </RouteLink>
    );
  const match = href?.match(/^#chat-source-(\d+)$/);
  const number = match ? Number(match[1]) : 0;
  const source = sources[number - 1];
  return source ? (
    <ChatSourceChip
      source={source}
      number={number}
      onPreview={onSourcePreview}
    />
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const markdownComponents: Components = {
  table: ({ node: _node, children, ...props }) => (
    <ScrollArea className="markdown-table-scroll" scrollFade>
      <table {...props}>{children}</table>
    </ScrollArea>
  ),
  pre: ({ node: _node, children, ...props }) => (
    <ScrollArea className="markdown-code-scroll" scrollFade>
      <pre {...props}>{children}</pre>
    </ScrollArea>
  ),
  a: MarkdownLink,
  img: ({ alt }) => (
    <span className="image-placeholder">
      Image: {alt || "document illustration"}
    </span>
  ),
};

export function Markdown({
  children,
  allowHtml = false,
  animate = false,
  sources = [],
  onSourcePreview,
  attachments = [],
  onDocumentOpen,
  streaming = false,
}: {
  children: string;
  allowHtml?: boolean;
  animate?: boolean;
  sources?: Source[];
  onSourcePreview?: (source: Source) => void;
  attachments?: { id: string; name: string }[];
  onDocumentOpen?: (id: string) => void;
  streaming?: boolean;
}) {
  return (
    <MarkdownSourceContext.Provider
      value={{ sources, onSourcePreview, attachments, onDocumentOpen }}
    >
      <div className="markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={
            allowHtml
              ? [rehypeRaw, [rehypeSanitize, documentHtmlSchema]]
              : [
                  ...(attachments.length
                    ? [inlineAttachments(attachments)]
                    : []),
                  inlineCitations(sources.length),
                  ...(animate ? [revealMarkdown] : []),
                  ...(streaming ? [streamingCursor] : []),
                ]
          }
          components={markdownComponents}
        >
          {children}
        </ReactMarkdown>
      </div>
    </MarkdownSourceContext.Provider>
  );
}
export function plainTextPreview(value: string, title?: string) {
  const firstLine = value.trimStart().split("\n", 1)[0];
  if (
    title &&
    /^#{1,6}\s/.test(firstLine) &&
    firstLine.replace(/^#{1,6}\s+/, "").trim() === title.trim()
  ) {
    value = value.trimStart().slice(firstLine.length);
  }
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}
