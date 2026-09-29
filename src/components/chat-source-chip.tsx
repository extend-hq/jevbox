import type { Source } from "@/lib/api";
import { paths } from "@/lib/navigation";
import { ResourceThumbnail } from "./resource-thumbnail";

export function ChatSourceChip({
  source,
  number,
  onPreview,
}: {
  source: Source;
  number: number;
  onPreview?: (source: Source) => void;
}) {
  return (
    <a
      className="chat-source-chip"
      href={paths.document(source.documentId, source.nodeId, "parsed")}
      title={`${source.name} · ${source.title} · p. ${source.page}`}
      aria-label={`Source ${number}: ${source.name}, page ${source.page}`}
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
      <small>{number}</small>
    </a>
  );
}
