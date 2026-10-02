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
export function blockStyle(type: string) {
  const value = type.toLowerCase().replace(/[ -]+/g, "_");
  if (value === "paragraph") return blockStyles.text;
  return (
    blockStyles[value as keyof typeof blockStyles] ?? {
      icon: FileText,
      tone: "neutral",
    }
  );
}

export function BlockTypeBadge({ type }: { type: string }) {
  const { icon: Icon, tone } = blockStyle(type);
  return (
    <span className="status-chip parsed-block-type" data-tone={tone}>
      <Icon className="size-3.5" />
      {type.replaceAll("_", " ")}
    </span>
  );
}

export function BlockPageBadge({ page }: { page: number }) {
  return <span className="page-pill parsed-block-page">p. {page}</span>;
}
