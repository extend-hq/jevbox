import { useEffect, useMemo, useRef } from "react";
import {
  FileText,
  ImageFilled,
  List,
  TableIcon,
  Type,
  TextCursorInput,
  Columns3Cog,
  SquareFilled,
  SlidersHorizontal,
  ListOrdered,
  ScanSearch,
  Superscript,
  PanelTop,
  PanelBottom,
  Stamp,
  Info,
  Signature,
  IndexTreeFilled,
  Baseline,
  CameraFilled,
} from "./icons";
import { Markdown } from "./common";
import {
  blockHighlightArea,
  type ParsedBlock,
} from "../../shared/parsed-blocks";
import type { IndexNode, Parsed } from "@/lib/api";
import { flatten } from "@/lib/api";

export function documentBlocks(parsed?: Parsed): ParsedBlock[] {
  if (!parsed) return [];
  const saved =
    parsed.blocks ?? flatten(parsed.nodes).flatMap((node) => node.blocks);
  if (saved.length)
    return [...new Map(saved.map((block) => [block.id, block])).values()];
  return flatten(parsed.nodes).map((node) => ({
    id: node.id,
    type: "section",
    content: node.content,
    page: node.page,
  }));
}
export function sectionBlocks(
  node: IndexNode | undefined,
  blocks: ParsedBlock[],
) {
  if (!node) return [];
  const sections = flatten([node]);
  const ids = new Set(
    sections.flatMap((section) => [
      section.id,
      ...section.blocks.map((block) => block.id),
    ]),
  );
  return blocks.filter(
    (block) =>
      ids.has(block.id) ||
      sections.some(
        (section) =>
          block.page >= section.page &&
          block.page <= section.endPage &&
          block.content.trim() &&
          section.content.includes(block.content.trim()),
      ),
  );
}

const blockStyles = {
  text: { icon: FileText, tone: "blue" },
  heading: { icon: Type, tone: "violet" },
  section_heading: { icon: TextCursorInput, tone: "purple" },
  table: { icon: TableIcon, tone: "green" },
  table_head: { icon: Columns3Cog, tone: "emerald" },
  table_cell: { icon: SquareFilled, tone: "lime" },
  key_value: { icon: SlidersHorizontal, tone: "teal" },
  page_number: { icon: ListOrdered, tone: "slate" },
  barcode: { icon: ScanSearch, tone: "zinc" },
  formula: { icon: Superscript, tone: "orange" },
  header: { icon: PanelTop, tone: "cyan" },
  footer: { icon: PanelBottom, tone: "indigo" },
  watermark: { icon: Stamp, tone: "stone" },
  legend: { icon: Info, tone: "yellow" },
  figure: { icon: ImageFilled, tone: "amber" },
  image: { icon: CameraFilled, tone: "red" },
  list: { icon: List, tone: "sky" },
  signature: { icon: Signature, tone: "rose" },
  section: { icon: IndexTreeFilled, tone: "fuchsia" },
  title: { icon: Baseline, tone: "pink" },
};
function blockStyle(type: string) {
  const value = type.toLowerCase().replace(/[ -]+/g, "_");
  if (value === "paragraph") return blockStyles.text;
  return (
    blockStyles[value as keyof typeof blockStyles] ?? {
      icon: FileText,
      tone: "neutral",
    }
  );
}

export function ParsedBlocks({
  blocks,
  activeId,
  selectedIds = [],
  scrollToId,
  onSelect,
}: {
  blocks: ParsedBlock[];
  activeId?: string;
  selectedIds?: string[];
  scrollToId?: string;
  onSelect: (block: ParsedBlock) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!scrollToId) return;
    const block = [
      ...(ref.current?.querySelectorAll<HTMLElement>("[data-block-id]") ?? []),
    ].find((element) => element.dataset.blockId === scrollToId);
    block?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
  }, [scrollToId]);
  return (
    <div className="parsed-block-list" ref={ref}>
      {blocks.map((block) => {
        const { icon: Icon, tone } = blockStyle(block.type);
        return (
          <article
            key={block.id}
            data-block-id={block.id}
            className="parsed-block"
            data-tone={tone}
            data-selected={selectedIds.includes(block.id) || undefined}
          >
            <button
              className="parsed-block-trigger"
              aria-pressed={activeId === block.id}
              aria-label={`Show ${block.type.replaceAll("_", " ")} on page ${block.page}`}
              onFocus={() => onSelect(block)}
              onClick={() => onSelect(block)}
            >
              <span className="status-chip parsed-block-type">
                <Icon className="size-3.5" />
                {block.type.replaceAll("_", " ")}
              </span>
              <span className="page-pill">p. {block.page}</span>
            </button>
            <div className="parsed-block-content">
              <Markdown allowHtml>
                {block.content || "No text content"}
              </Markdown>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function ParsedBlockOverlay({
  blocks,
  page,
  activeId,
  selectedIds = [],
  width = 100,
  height = 100,
  sourceRotation = 0,
}: {
  blocks: ParsedBlock[];
  page: number;
  activeId?: string;
  selectedIds?: string[];
  width?: number;
  height?: number;
  sourceRotation?: number;
}) {
  const visible = useMemo(
    () => blocks.filter((block) => block.page === page),
    [blocks, page],
  );
  return (
    <svg
      aria-hidden="true"
      className="parsed-block-overlay"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {visible.map((block) => {
        const area = blockHighlightArea(block, sourceRotation);
        if (!area) return null;
        return (
          <rect
            key={block.id}
            data-block-id={block.id}
            data-tone={blockStyle(block.type).tone}
            data-selected={
              activeId === block.id ||
              selectedIds.includes(block.id) ||
              undefined
            }
            x={(area.left * width) / 100}
            y={(area.top * height) / 100}
            width={(area.width * width) / 100}
            height={(area.height * height) / 100}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
