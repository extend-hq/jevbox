import { ResourceThumbnail } from "./resource-thumbnail";

export function DocumentPillContent({
  id,
  name,
  mime = "",
}: {
  id: string;
  name: string;
  mime?: string;
}) {
  return (
    <>
      <ResourceThumbnail
        name={name}
        mime={mime}
        src={`/api/documents/${id}/content`}
        inline
        square
        className="prompt-document-thumbnail"
      />
      <span className="prompt-document-name" title={name}>
        {name}
      </span>
    </>
  );
}
