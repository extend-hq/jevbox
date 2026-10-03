import type { Source } from "./api";
import { paths } from "./navigation";

export const sourceHref = (source: Source) =>
  paths.document(
    source.documentId,
    source.nodeId || undefined,
    "parsed",
    undefined,
    { page: source.page, blockIds: source.blockIds },
  );

export const sourceLocationLabel = (source: Source) =>
  [
    ...(source.sectionPath?.length
      ? source.sectionPath
      : source.title
        ? [source.title]
        : []),
    `p. ${source.page}${source.endPage && source.endPage > source.page ? `–${source.endPage}` : ""}`,
    ...(source.citationBlocks?.length === 1
      ? [source.citationBlocks[0].type]
      : []),
  ].join(" › ");
