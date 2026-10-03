import type { Source } from "@/lib/api";
import { sourceHref, sourceLocationLabel } from "@/lib/source-location";
import { ResourceThumbnail } from "./resource-thumbnail";

export function ChatSourceChip({
  source,
  number,
  reference,
  onPreview,
}: {
  source: Source;
  number: number;
  reference?: string;
  onPreview?: (source: Source) => void;
}) {
  return (
    <a
      className="chat-source-chip"
      href={sourceHref(source)}
      title={`${source.name} · ${sourceLocationLabel(source)}`}
      aria-label={`Source ${reference ?? number}: ${source.name}, ${sourceLocationLabel(source)}`}
      onClick={(event) => {
        if (
          onPreview &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          event.button === 0
        ) {
          event.preventDefault();
          onPreview(source);
        }
      }}
    >
      <ResourceThumbnail
        name={source.name}
        mime=""
        src={`/api/documents/${source.documentId}/content`}
        className="chat-source-chip-thumbnail"
        square
        inline
      />
      <span>{source.name}</span>
      <small>{reference ?? number}</small>
    </a>
  );
}
