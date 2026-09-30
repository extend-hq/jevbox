import { BoxLoader } from "@/components/box-loader";
import { IndexStatusBadge } from "@/components/index-status-badge";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubPopup,
  ContextMenuSeparator,
} from "@/components/coss/context-menu";
import {
  ArrowRight,
  ExternalLink,
  Info,
  Share2,
  FolderBolt,
  FolderTree,
  Folder,
  Trash2,
  ArrowUpDown,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Columns3,
  Cube,
  FileArchiveIcon,
  Filter,
  GalleryThumbnails,
  LayoutGrid,
  Search,
  X,
} from "@/components/icons";
("use client");
import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import {
  prepareFileTreeInput,
  type FileTreeSortComparator,
  type FileTreeSortEntry,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea as InlineScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileThumbnail } from "@/components/extend/file-thumbnail";
import { FOLDER_GLYPH_SVG } from "@/components/extend/folder-glyph";
import type { SpatialDocumentStructure } from "@/components/library-spatial-view";
function ArrowDown01Glyph(props: InlineRegistryIconProps) {
  return <ChevronDown {...props} />;
}
function ArrowUp01Glyph(props: InlineRegistryIconProps) {
  return <ChevronUp {...props} />;
}
function Calendar03Glyph(props: InlineRegistryIconProps) {
  return <Calendar {...props} />;
}
function File01Glyph(props: InlineRegistryIconProps) {
  return <FileArchiveIcon {...props} />;
}
function GalleryThumbnailsGlyph(props: InlineRegistryIconProps) {
  return <GalleryThumbnails {...props} />;
}
function GridViewGlyph(props: InlineRegistryIconProps) {
  return <LayoutGrid {...props} />;
}
function LayoutThreeColumnGlyph(props: InlineRegistryIconProps) {
  return <Columns3 {...props} />;
}
const LazySpatialView = React.lazy(() =>
  import("@/components/library-spatial-view").then((mod) => ({
    default: mod.LibrarySpatialView,
  })),
);
const LazyPDFViewer = React.lazy(() =>
  import("@/components/extend/pdf-viewer").then((mod) => ({
    default: mod.PDFViewer,
  })),
);
const LazyDocxViewerPreview = React.lazy(() =>
  import("@/components/extend/docx-viewer").then((mod) => ({
    default: mod.DocxViewerPreview,
  })),
);
const LazyPptxViewerPreview = React.lazy(() =>
  import("@/components/extend/pptx-viewer").then((mod) => ({
    default: mod.PptxViewerPreview,
  })),
);
const LazyXlsxViewerPreview = React.lazy(() =>
  import("@/components/extend/xlsx-viewer").then((mod) => ({
    default: mod.XlsxViewerPreview,
  })),
);
export type FileSystemView =
  "icons" | "list" | "columns" | "gallery" | "spatial";
export type FileSystemFolderItem = {
  kind: "folder";
  path: string;
  name?: string;
  parentPath?: string;
  hasChildren?: boolean;
  createdAt?: string;
  updatedAt?: string;
};
export type FileSystemFileItem = {
  kind: "file";
  path: string;
  key?: string;
  name?: string;
  parentPath?: string;
  contentType?: string;
  size?: number;
  createdAt?: string;
  updatedAt?: string;
  etag?: string;
  url?: string;
  previewImageUrl?: string | null;
  previewImageUrls?: string[] | null;
  previewPageCount?: number;
  previewAspectRatio?: number;
  metadata?: Record<string, string>;
};
export type FileSystemItem = FileSystemFolderItem | FileSystemFileItem;
export type FileSystemLoadChildrenArgs = {
  path: string;
  cursor: string | null;
};
export type FileSystemLoadChildrenResult = {
  items: FileSystemItem[];
  nextCursor?: string | null;
};
export type FileSystemProps = {
  isLoading?: boolean;
  items: FileSystemItem[];
  className?: string;
  title?: string;
  headerActions?: React.ReactNode;
  onSearchSubmit?: (query: string) => void;
  defaultView?: FileSystemView;
  view?: FileSystemView;
  onViewChange?: (view: FileSystemView) => void;
  onPathChange?: (path: string) => void;
  defaultPath?: string;
  path?: string;
  navigation?: {
    canGoBack: boolean;
    canGoForward: boolean;
    back: () => void;
    forward: () => void;
  };
  onSelectionChange?: (item: FileSystemItem | null) => void;
  onShare?: (item: FileSystemItem) => void;
  canShare?: (item: FileSystemItem) => boolean;
  onDelete?: (item: FileSystemItem) => void;
  onDeleteItems?: (items: FileSystemItem[]) => void;
  onOrganizeItems?: (items: FileSystemFileItem[]) => void;
  canOrganize?: (item: FileSystemItem) => boolean;
  onMove?: (item: FileSystemItem, destinationId: string | null) => void;
  getMoveDestinations?: (
    item: FileSystemItem,
  ) => { id: string | null; label: string }[];
  onFileOpen?: (file: FileSystemFileItem, url: string | null) => void;
  getFileUrl?: (file: FileSystemFileItem) => string | Promise<string>;
  loadChildren?: (
    args: FileSystemLoadChildrenArgs,
  ) => Promise<FileSystemLoadChildrenResult>;
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    pageIndex: number,
  ) => Promise<string | null>;
  loadDocumentStructure?: (
    file: FileSystemFileItem,
  ) => Promise<SpatialDocumentStructure | null>;
};
type FolderEntry = FileSystemFolderItem & {
  name: string;
  parentPath: string;
};
type FileEntry = FileSystemFileItem & {
  key: string;
  name: string;
  parentPath: string;
};
export type FileSystemEntry = FolderEntry | FileEntry;
type FileSystemIndex = {
  children: Map<string, FileSystemEntry[]>;
  files: Map<string, FileEntry>;
  folders: Map<string, FolderEntry>;
};
function normalizeFolderPath(path: string) {
  if (!path || path === "/") return "";
  return path.endsWith("/") ? path : `${path}/`;
}
function pathName(path: string) {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const separatorIndex = trimmed.lastIndexOf("/");
  return separatorIndex === -1 ? trimmed : trimmed.slice(separatorIndex + 1);
}
function pathParent(path: string) {
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const separatorIndex = trimmed.lastIndexOf("/");
  return separatorIndex === -1 ? "" : trimmed.slice(0, separatorIndex + 1);
}
function fileExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex === -1 ? "" : name.slice(dotIndex + 1).toLowerCase();
}
const FILE_KIND_LABELS: Record<string, string> = {
  css: "CSS Stylesheet",
  csv: "CSV Document",
  doc: "Word Document",
  docx: "Word Document",
  gif: "GIF Image",
  go: "Go Source",
  jpeg: "JPEG Image",
  jpg: "JPEG Image",
  js: "JavaScript Source",
  json: "JSON Document",
  jsx: "JavaScript Source",
  md: "Markdown Document",
  mdx: "MDX Document",
  pdf: "PDF Document",
  png: "PNG Image",
  ppt: "PowerPoint Presentation",
  pptx: "PowerPoint Presentation",
  py: "Python Script",
  rs: "Rust Source",
  sh: "Shell Script",
  sql: "SQL Script",
  svg: "SVG Image",
  ts: "TypeScript Source",
  tsv: "TSV Document",
  tsx: "TypeScript Source",
  txt: "Plain Text",
  webp: "WebP Image",
  xls: "Excel Workbook",
  xlsx: "Excel Workbook",
  yaml: "YAML Document",
  yml: "YAML Document",
  zip: "ZIP Archive",
};
function fileKindLabel(file: FileEntry) {
  const byExtension = FILE_KIND_LABELS[fileExtension(file.name)];
  if (byExtension) return byExtension;
  if (file.contentType?.startsWith("image/")) return "Image";
  return file.contentType ?? "Document";
}
function entryKindLabel(entry: FileSystemEntry) {
  return entry.kind === "folder" ? "Folder" : fileKindLabel(entry);
}
const EXTENSION_MIME_TYPES: Record<string, string> = {
  css: "text/css",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  go: "text/x-go",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  jsx: "text/jsx",
  md: "text/markdown",
  mdx: "text/mdx",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  py: "text/x-python",
  rs: "text/x-rust",
  sh: "application/x-sh",
  sql: "application/sql",
  svg: "image/svg+xml",
  ts: "text/x-typescript",
  tsv: "text/tab-separated-values",
  tsx: "text/x-typescript",
  txt: "text/plain",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  yaml: "text/yaml",
  yml: "text/yaml",
  zip: "application/zip",
};
const FALLBACK_MIME_TYPE = "application/octet-stream";
const IPAD_MIN_WIDTH = 768;
const MIME_TYPE_LABELS: Record<string, string> = {
  [FALLBACK_MIME_TYPE]: "Binary",
  "application/json": "JSON",
  "application/msword": "Word document (legacy)",
  "application/pdf": "PDF",
  "application/sql": "SQL",
  "application/vnd.ms-excel": "Excel workbook (legacy)",
  "application/vnd.ms-powerpoint": "PowerPoint (legacy)",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PowerPoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "Excel workbook",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word document",
  "application/x-sh": "Shell script",
  "application/zip": "ZIP archive",
  "image/gif": "GIF image",
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/svg+xml": "SVG image",
  "image/webp": "WebP image",
  "text/css": "CSS",
  "text/csv": "CSV",
  "text/javascript": "JavaScript",
  "text/jsx": "JSX",
  "text/markdown": "Markdown",
  "text/mdx": "MDX",
  "text/plain": "Plain text",
  "text/tab-separated-values": "TSV",
  "text/x-go": "Go",
  "text/x-python": "Python",
  "text/x-rust": "Rust",
  "text/x-typescript": "TypeScript",
  "text/yaml": "YAML",
};
function mimeTypeForFile(file: FileEntry) {
  return (
    file.contentType ??
    EXTENSION_MIME_TYPES[fileExtension(file.name)] ??
    FALLBACK_MIME_TYPE
  );
}
function fileTypeFilterGroup(mime: string): FileTypeFilterGroup {
  if (
    mime === "application/pdf" ||
    mime === "application/msword" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "Documents";
  }
  if (
    mime === "application/vnd.ms-excel" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mime === "text/csv" ||
    mime === "text/tab-separated-values"
  ) {
    return "Spreadsheets";
  }
  if (mime.startsWith("image/")) return "Images";
  if (
    mime === "application/json" ||
    mime === "application/sql" ||
    mime === "application/x-sh" ||
    mime === "text/css" ||
    mime === "text/javascript" ||
    mime === "text/jsx" ||
    mime === "text/x-go" ||
    mime === "text/x-python" ||
    mime === "text/x-rust" ||
    mime === "text/x-typescript" ||
    mime === "text/yaml"
  ) {
    return "Code";
  }
  if (
    mime === "text/markdown" ||
    mime === "text/mdx" ||
    mime === "text/plain"
  ) {
    return "Text";
  }
  return "Archives & binary";
}
export type FileSystemViewerKind = "docx" | "image" | "pdf" | "pptx" | "xlsx";
function viewerKindForFile(
  file: FileSystemFileItem,
): FileSystemViewerKind | null {
  if (file.contentType?.startsWith("image/")) return "image";
  if (file.contentType === "application/pdf") return "pdf";
  if (
    file.contentType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  const name = (file.name ?? file.path).toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pptx")) return "pptx";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (/\.(avif|gif|jpe?g|png|svg|webp)$/.test(name)) return "image";
  return null;
}
const VIEWER_DIALOG_CLASSNAMES: Record<FileSystemViewerKind, string> = {
  docx: "h-[88vh] w-[min(96vw,68rem)] max-w-none",
  image: "max-h-[88vh] w-fit max-w-[min(96vw,64rem)]",
  pdf: "h-[88vh] w-[min(96vw,68rem)] max-w-none",
  pptx: "h-[88vh] w-[min(96vw,84rem)] max-w-none",
  xlsx: "h-[85vh] w-[min(96vw,100rem)] max-w-none",
};
function FileSystemViewerLoading() {
  return (
    <div className="grid h-full min-h-48 flex-1 place-items-center bg-background">
      <BoxLoader />
    </div>
  );
}
function formatByteSize(size: number | undefined) {
  if (size === undefined) return null;
  if (size < 1000) return `${size} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size;
  for (const unit of units) {
    value /= 1000;
    if (value < 1000 || unit === "TB") {
      return `${value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, "")} ${unit}`;
    }
  }
  return null;
}
function formatTimestamp(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} at ${time}`;
}
function directoryPathsOf(paths: readonly string[]) {
  const directoryPaths = new Set<string>();
  for (const relativePath of paths) {
    let slashIndex = relativePath.indexOf("/");
    while (slashIndex !== -1) {
      directoryPaths.add(relativePath.slice(0, slashIndex));
      slashIndex = relativePath.indexOf("/", slashIndex + 1);
    }
  }
  return directoryPaths;
}
function compareEntryNames(
  left: {
    name: string;
  },
  right: {
    name: string;
  },
) {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
export type FileSystemSortKey =
  "createdAt" | "kind" | "name" | "size" | "updatedAt";
type FileSystemSortState = {
  direction: "asc" | "desc";
  key: FileSystemSortKey;
};
const SORT_OPTIONS: Array<{
  defaultDirection: "asc" | "desc";
  key: FileSystemSortKey;
  label: string;
  triggerLabel: string;
}> = [
  { defaultDirection: "asc", key: "name", label: "Name", triggerLabel: "Name" },
  { defaultDirection: "asc", key: "kind", label: "Kind", triggerLabel: "Kind" },
  {
    defaultDirection: "desc",
    key: "createdAt",
    label: "Date created",
    triggerLabel: "Created",
  },
  {
    defaultDirection: "desc",
    key: "updatedAt",
    label: "Date modified",
    triggerLabel: "Modified",
  },
  {
    defaultDirection: "desc",
    key: "size",
    label: "Size",
    triggerLabel: "Size",
  },
];
const DEFAULT_SORT: FileSystemSortState = { direction: "asc", key: "name" };
function defaultSortDirection(key: FileSystemSortKey) {
  return (
    SORT_OPTIONS.find((option) => option.key === key)?.defaultDirection ?? "asc"
  );
}
function entrySortTimestamp(
  entry: FileSystemEntry,
  key: "createdAt" | "updatedAt",
) {
  const value = entry[key];
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? 0 : time;
}
function compareEntriesBySort(
  left: FileSystemEntry,
  right: FileSystemEntry,
  sort: FileSystemSortState,
) {
  let result = 0;
  if (sort.key === "name") {
    result = compareEntryNames(left, right);
  } else if (sort.key === "kind") {
    result = entryKindLabel(left).localeCompare(
      entryKindLabel(right),
      undefined,
      {
        sensitivity: "base",
      },
    );
  } else if (sort.key === "size") {
    const leftSize = left.kind === "file" ? (left.size ?? 0) : -1;
    const rightSize = right.kind === "file" ? (right.size ?? 0) : -1;
    result = leftSize - rightSize;
  } else {
    result =
      entrySortTimestamp(left, sort.key) - entrySortTimestamp(right, sort.key);
  }
  if (result === 0) return compareEntryNames(left, right);
  return sort.direction === "asc" ? (result < 0 ? -1 : 1) : result < 0 ? 1 : -1;
}
export type FileSystemFilterType = "dateCreated" | "dateModified" | "fileType";
type FileSystemDateFilterType = Exclude<FileSystemFilterType, "fileType">;
type FileSystemFilterOperator =
  | "after"
  | "before"
  | "in-range"
  | "is"
  | "is-any-of"
  | "is-not"
  | "not-in-range";
type FileSystemFilter = {
  id: string;
  operator: FileSystemFilterOperator;
  type: FileSystemFilterType;
  value: string[];
};
type FileTypeFilterGroup =
  | "Documents"
  | "Spreadsheets"
  | "Images"
  | "Code"
  | "Text"
  | "Archives & binary";
type FileTypeFilterOption = {
  group: FileTypeFilterGroup;
  iconFileName: string;
  label: string;
  mime: string;
};
const FILE_TYPE_FILTER_GROUPS: FileTypeFilterGroup[] = [
  "Documents",
  "Spreadsheets",
  "Images",
  "Code",
  "Text",
  "Archives & binary",
];
const FILTER_TYPE_LABELS: Record<FileSystemFilterType, string> = {
  dateCreated: "Date created",
  dateModified: "Date modified",
  fileType: "File type",
};
const FILTER_OPERATOR_LABELS: Record<FileSystemFilterOperator, string> = {
  after: "after",
  before: "before",
  "in-range": "in range",
  is: "is",
  "is-any-of": "is any of",
  "is-not": "is not",
  "not-in-range": "not in range",
};
const DATE_FILTER_PRESETS = [
  "1 day ago",
  "3 days ago",
  "1 week ago",
  "1 month ago",
  "3 months ago",
  "6 months ago",
  "1 year ago",
];
function dateFilterPresetCutoff(preset: string) {
  const date = new Date();
  switch (preset) {
    case "1 day ago":
      date.setDate(date.getDate() - 1);
      break;
    case "3 days ago":
      date.setDate(date.getDate() - 3);
      break;
    case "1 week ago":
      date.setDate(date.getDate() - 7);
      break;
    case "1 month ago":
      date.setMonth(date.getMonth() - 1);
      break;
    case "3 months ago":
      date.setMonth(date.getMonth() - 3);
      break;
    case "6 months ago":
      date.setMonth(date.getMonth() - 6);
      break;
    case "1 year ago":
      date.setFullYear(date.getFullYear() - 1);
      break;
    default: {
      const parsed = Date.parse(preset);
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }
  }
  return date;
}
function isCustomDateRangeValue(value: string[]) {
  return (
    value.length === 2 &&
    value.every(
      (entry) =>
        !DATE_FILTER_PRESETS.includes(entry) &&
        !Number.isNaN(Date.parse(entry)),
    )
  );
}
function filterOperatorChoices(
  filter: FileSystemFilter,
): FileSystemFilterOperator[] {
  if (filter.type === "fileType") {
    return filter.value.length > 1 ? ["is-any-of", "is-not"] : ["is", "is-not"];
  }
  if (isCustomDateRangeValue(filter.value)) return ["in-range", "not-in-range"];
  return ["before", "after"];
}
function fileMatchesFilter(file: FileEntry, filter: FileSystemFilter) {
  if (filter.value.length === 0) return true;
  if (filter.type === "fileType") {
    const matches = filter.value.includes(mimeTypeForFile(file));
    return filter.operator === "is-not" ? !matches : matches;
  }
  const timestamp =
    filter.type === "dateCreated" ? file.createdAt : file.updatedAt;
  const time = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (Number.isNaN(time)) return false;
  if (filter.operator === "in-range" || filter.operator === "not-in-range") {
    const from = Date.parse(filter.value[0]);
    const to = Date.parse(filter.value[1] ?? filter.value[0]);
    const isInRange = time >= from && time <= to;
    return filter.operator === "not-in-range" ? !isInRange : isInRange;
  }
  const cutoff = dateFilterPresetCutoff(filter.value[0]).getTime();
  return filter.operator === "before" ? time <= cutoff : time >= cutoff;
}
function buildFileSystemIndex(items: FileSystemItem[]): FileSystemIndex {
  const folders = new Map<string, FolderEntry>();
  const files = new Map<string, FileEntry>();
  const ensureFolderChain = (folderPath: string) => {
    let path = normalizeFolderPath(folderPath);
    while (path && !folders.has(path)) {
      folders.set(path, {
        kind: "folder",
        name: pathName(path),
        parentPath: pathParent(path),
        path,
      });
      path = pathParent(path);
    }
  };
  for (const item of items) {
    if (item.kind === "folder") {
      const path = normalizeFolderPath(item.path);
      if (!path) continue;
      folders.set(path, {
        ...item,
        name: item.name ?? pathName(path),
        parentPath: normalizeFolderPath(item.parentPath ?? pathParent(path)),
        path,
      });
      ensureFolderChain(pathParent(path));
    } else {
      if (!item.path) continue;
      files.set(item.path, {
        ...item,
        key: item.key ?? item.path,
        name: item.name ?? pathName(item.path),
        parentPath: normalizeFolderPath(
          item.parentPath ?? pathParent(item.path),
        ),
      });
      ensureFolderChain(pathParent(item.path));
    }
  }
  const children = new Map<string, FileSystemEntry[]>();
  const pushChild = (entry: FileSystemEntry) => {
    const siblings = children.get(entry.parentPath);
    if (siblings) {
      siblings.push(entry);
    } else {
      children.set(entry.parentPath, [entry]);
    }
  };
  for (const folder of folders.values()) pushChild(folder);
  for (const file of files.values()) pushChild(file);
  for (const siblings of children.values()) {
    siblings.sort(compareEntryNames);
  }
  const foldersDeepestFirst = [...folders.values()].sort(
    (left, right) => right.path.length - left.path.length,
  );
  for (const folder of foldersDeepestFirst) {
    if (folder.updatedAt) continue;
    let newestTime = Number.NEGATIVE_INFINITY;
    let newestValue: string | undefined;
    for (const child of children.get(folder.path) ?? []) {
      const value = child.updatedAt ?? child.createdAt;
      const time = value ? Date.parse(value) : Number.NaN;
      if (!Number.isNaN(time) && time > newestTime) {
        newestTime = time;
        newestValue = value;
      }
    }
    if (newestValue) folder.updatedAt = newestValue;
  }
  return { children, files, folders };
}
function folderHasChildren(index: FileSystemIndex, folder: FolderEntry) {
  return (
    (index.children.get(folder.path)?.length ?? 0) > 0 ||
    folder.hasChildren === true
  );
}
const FOLDER_ICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><g class="nc-icon-wrapper"><path d="m13.5,6h-3.5l-1.703-2.555c-.185-.278-.498-.445-.832-.445h-2.965c-.828,0-1.5.672-1.5,1.5v9.5c0,.781.299,1.491.789,2.025-.254-.42-.365-.931-.248-1.459l1.111-5c.203-.915,1.015-1.566,1.952-1.566h8.396v-.5c0-.828-.672-1.5-1.5-1.5Z" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" data-color="color-2"></path><path d="m14.041,17H5.493c-1.279,0-2.23-1.185-1.952-2.434l1.111-5c.203-.915,1.015-1.566,1.952-1.566h8.548c1.279,0,2.23,1.185,1.952,2.434l-1.111,5c-.203.915-1.015,1.566-1.952,1.566Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></g></svg>')}`;
const FOLDER_GLYPH_DATA_URL = `data:image/svg+xml,${encodeURIComponent(FOLDER_GLYPH_SVG)}`;
function FileSystemFolderGlyph({ className }: { className?: string }) {
  return (
    <img
      src={FOLDER_GLYPH_DATA_URL}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
    />
  );
}
function escapeXmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
const MICRO_FILE_SYMBOLS = `<symbol id="micro-file-content" viewBox="0 0 20 20">
    <g>
      <path
        d="m4,7h3c.552,0,1-.448,1-1v-3"
        stroke="currentColor"
        stroke-linejoin="round"
        stroke-width="2"
        fill="currentColor"
      ></path>
      <line
        x1="12.5"
        y1="9"
        x2="10"
        y2="9"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></line>
      <line
        x1="12.5"
        y1="13"
        x2="7.5"
        y2="13"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></line>
      <path
        d="m16,14v-8c0-1.657-1.343-3-3-3h-4.586c-.265,0-.52.105-.707.293l-3.414,3.414c-.188.188-.293.442-.293.707v6.586c0,1.657,1.343,3,3,3h6c1.657,0,3-1.343,3-3Z"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></path>
    </g>
  </symbol><symbol id="micro-code-editor" viewBox="0 0 20 20">
    <g>
      <rect
        x="3"
        y="4"
        width="14"
        height="12"
        rx="3"
        ry="3"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></rect>
      <path
        d="m7,4h-1c-1.6569,0-3,1.3431-3,3v6c0,1.6569,1.3431,3,3,3h1V4Z"
        stroke-width="0"
        fill="currentColor"
      ></path>
      <path
        d="m11.25,8h-2.25c-.4141,0-.75-.3359-.75-.75s.3359-.75.75-.75h2.25c.4141,0,.75.3359.75.75s-.3359.75-.75.75Z"
        fill="currentColor"
        stroke-width="0"
      ></path>
      <path
        d="m11.25,13.5h-2.25c-.4141,0-.75-.3359-.75-.75s.3359-.75.75-.75h2.25c.4141,0,.75.3359.75.75s-.3359.75-.75.75Z"
        fill="currentColor"
        stroke-width="0"
      ></path>
      <path
        d="m14,10.75h-3.25c-.4141,0-.75-.3359-.75-.75s.3359-.75.75-.75h3.25c.4141,0,.75.3359.75.75s-.3359.75-.75.75Z"
        fill="currentColor"
        stroke-width="0"
      ></path>
    </g>
  </symbol><symbol id="micro-photo" viewBox="0 0 20 20"><g><path d="m17,11.586l-2.732-2.732c-.975-.975-2.561-.975-3.535,0l-6.994,6.994c-.017.017-.022.041-.037.059.55.663,1.37,1.093,2.298,1.093h8c1.657,0,3-1.343,3-3v-2.414Z" fill="currentColor" stroke-width="0" data-color="color-2" /><rect x="3" y="3" width="14" height="14" rx="3" ry="3" transform="translate(0 20) rotate(-90)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" /><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke-width="0" data-color="color-2" /></g></symbol><symbol id="micro-file-zip" viewBox="0 0 20 20">
    <g>
      <path
        d="m4,7h3c.552,0,1-.448,1-1v-3"
        stroke="currentColor"
        stroke-linejoin="round"
        stroke-width="2"
        fill="currentColor"
      ></path>
      <path
        d="m16,14v-8c0-1.657-1.343-3-3-3h-4.586c-.265,0-.52.105-.707.293l-3.414,3.414c-.188.188-.293.442-.293.707v6.586c0,1.657,1.343,3,3,3h6c1.657,0,3-1.343,3-3Z"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></path>
      <rect
        x="8.5"
        y="14"
        width="2.5"
        height="2"
        fill="currentColor"
        stroke-width="0"
      ></rect>
      <rect
        x="11"
        y="12"
        width="2.5"
        height="2"
        fill="currentColor"
        stroke-width="0"
      ></rect>
      <rect
        x="8.5"
        y="10"
        width="2.5"
        height="2"
        fill="currentColor"
        stroke-width="0"
      ></rect>
      <rect
        x="11"
        y="8"
        width="2.5"
        height="2"
        fill="currentColor"
        stroke-width="0"
      ></rect>
    </g>
  </symbol><symbol id="micro-table-rows" viewBox="0 0 20 20">
    <g>
      <line
        x1="3"
        y1="10"
        x2="17"
        y2="10"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></line>
      <rect
        x="3"
        y="3"
        width="14"
        height="14"
        rx="3"
        ry="3"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></rect>
    </g>
  </symbol><symbol id="micro-folder" viewBox="0 0 20 20"><g><path d="m13.5,6h-3.5l-1.703-2.555c-.185-.278-.498-.445-.832-.445h-2.965c-.828,0-1.5.672-1.5,1.5v9.5c0,.781.299,1.491.789,2.025-.254-.42-.365-.931-.248-1.459l1.111-5c.203-.915,1.015-1.566,1.952-1.566h8.396v-.5c0-.828-.672-1.5-1.5-1.5Z" fill="currentColor" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" data-color="color-2" /><path d="m14.041,17H5.493c-1.279,0-2.23-1.185-1.952-2.434l1.111-5c.203-.915,1.015-1.566,1.952-1.566h8.548c1.279,0,2.23,1.185,1.952,2.434l-1.111,5c-.203.915-1.015,1.566-1.952,1.566Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" /></g></symbol><symbol id="micro-chevron-down" viewBox="0 0 20 20">
    <g>
      <polyline
        points="3.5 7.5 10 14 16.5 7.5"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      ></polyline>
    </g>
  </symbol>`;
const FILE_ICON_SPRITE_SHEET = `<svg aria-hidden="true" width="0" height="0">${MICRO_FILE_SYMBOLS}</svg>`;
function resolveFileIcon(_kind: string, fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const glyph = /^(png|jpe?g|gif|svg|webp|bmp|tiff?)$/.test(ext)
    ? "photo-filled"
    : /^(zip|gz|tar|rar|7z)$/.test(ext)
      ? "file-zip"
      : /^(xlsx?|csv|tsv|ods)$/.test(ext)
        ? "table-rows"
        : /^(json|tsx?|jsx?|html|css|py|xml|yaml|yml)$/.test(ext)
          ? "code-editor"
          : "file-content";
  return { name: `micro-${glyph}`, viewBox: "0 0 20 20", token: undefined };
}
const FILE_ICON_COLORS: Record<string, [light: string, dark: string]> = {
  astro: ["#a631be", "#d568ea"],
  babel: ["#d5a910", "#ffd452"],
  bash: ["#199f43", "#5ecc71"],
  biome: ["#1a85d4", "#69b1ff"],
  bootstrap: ["#693acf", "#9d6afb"],
  browserslist: ["#d5a910", "#ffd452"],
  bun: ["#594c5b", "#79697b"],
  c: ["#1a85d4", "#69b1ff"],
  claude: ["#d47628", "#ffa359"],
  cpp: ["#1a85d4", "#69b1ff"],
  css: ["#693acf", "#9d6afb"],
  database: ["#a631be", "#d568ea"],
  default: ["#84848a", "#adadb1"],
  docker: ["#1a85d4", "#69b1ff"],
  eslint: ["#693acf", "#9d6afb"],
  git: ["#ff8c5b", "#d5512f"],
  go: ["#1ca1c7", "#68cdf2"],
  graphql: ["#d32a61", "#ff678d"],
  html: ["#d47628", "#ffa359"],
  image: ["#d32a61", "#ff678d"],
  javascript: ["#d5a910", "#ffd452"],
  json: ["#d47628", "#ffa359"],
  markdown: ["#199f43", "#5ecc71"],
  mcp: ["#17a5af", "#64d1db"],
  npm: ["#d52c36", "#ff6762"],
  oxc: ["#1ca1c7", "#68cdf2"],
  postcss: ["#d52c36", "#ff6762"],
  prettier: ["#17a5af", "#64d1db"],
  python: ["#1a85d4", "#69b1ff"],
  react: ["#1ca1c7", "#68cdf2"],
  ruby: ["#d52c36", "#ff6762"],
  rust: ["#d47628", "#ffa359"],
  sass: ["#d32a61", "#ff678d"],
  svelte: ["#d52c36", "#ff6762"],
  svg: ["#d47628", "#ffa359"],
  svgo: ["#199f43", "#5ecc71"],
  swift: ["#d47628", "#ffa359"],
  table: ["#17a5af", "#64d1db"],
  tailwind: ["#1ca1c7", "#68cdf2"],
  terraform: ["#693acf", "#9d6afb"],
  text: ["#84848a", "#adadb1"],
  typescript: ["#1a85d4", "#69b1ff"],
  vite: ["#a631be", "#d568ea"],
  vscode: ["#1a85d4", "#69b1ff"],
  vue: ["#199f43", "#5ecc71"],
  wasm: ["#693acf", "#9d6afb"],
  webpack: ["#1a85d4", "#69b1ff"],
  yml: ["#d52c36", "#ff6762"],
  zig: ["#d47628", "#ffa359"],
  zip: ["#d47628", "#ffa359"],
};
function fileIconColorVariables(mode: 0 | 1) {
  return Object.entries(FILE_ICON_COLORS)
    .map(([token, colors]) => `--fs-file-icon-${token}: ${colors[mode]};`)
    .join(" ");
}
const FILE_ICON_COLOR_CSS = `
:root { ${fileIconColorVariables(0)} --fs-selected-color-scheme: dark; }
.dark { ${fileIconColorVariables(1)} --fs-selected-color-scheme: light; }
.dark [data-file-system-on-light] { ${fileIconColorVariables(0)} }
[data-file-system-on-primary] { ${fileIconColorVariables(1)} }
.dark [data-file-system-on-primary] { ${fileIconColorVariables(0)} }
`;
function FileSystemIconSpriteSheet() {
  return (
    <>
      <span
        aria-hidden="true"
        className="hidden"
        dangerouslySetInnerHTML={{ __html: FILE_ICON_SPRITE_SHEET }}
      />
      <style>{FILE_ICON_COLOR_CSS}</style>
    </>
  );
}
function FileTypeIcon({
  fileName,
  className,
  selected = false,
}: {
  fileName: string;
  className?: string;
  selected?: boolean;
}) {
  const icon = resolveFileIcon("file-tree-icon-file", fileName);
  return (
    <svg
      aria-hidden="true"
      viewBox={icon.viewBox ?? "0 0 16 16"}
      className={cn(
        "shrink-0",
        selected ? "text-primary-foreground" : "text-muted-foreground",
        className,
      )}
      style={
        icon.token && !selected
          ? {
              color: `var(--fs-file-icon-${icon.token}, var(--color-muted-foreground))`,
            }
          : undefined
      }
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}
function FileGenericPreview({ file }: { file: FileEntry }) {
  const extension = fileExtension(file.name);
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground">
      <FileTypeIcon fileName={file.name} className="size-1/3 min-h-4 min-w-4" />
      {extension ? (
        <span className="text-[min(0.625rem,18cqw)] font-semibold tracking-wide uppercase">
          {extension}
        </span>
      ) : null}
    </div>
  );
}
function filePreviewUrls(file: FileSystemFileItem) {
  if (file.previewImageUrls?.length) return file.previewImageUrls;
  return file.previewImageUrl ? [file.previewImageUrl] : [];
}
function normalizeSearchQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replaceAll("\\", "/").toLowerCase();
}
function useVirtualWindow({
  count,
  horizontal = false,
  itemStride,
  leadingPx = 0,
  overscan = 8,
  viewportRef,
}: {
  count: number;
  horizontal?: boolean;
  itemStride: number;
  leadingPx?: number;
  overscan?: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [window_, setWindow] = React.useState(() => ({
    end: Math.min(count, overscan * 2),
    start: 0,
  }));
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || itemStride <= 0) return;
    const update = () => {
      const scrollStart =
        (horizontal ? viewport.scrollLeft : viewport.scrollTop) - leadingPx;
      const viewportSize = horizontal
        ? viewport.clientWidth
        : viewport.clientHeight;
      const firstVisible = Math.max(0, Math.floor(scrollStart / itemStride));
      const lastVisible = Math.min(
        count,
        Math.ceil((scrollStart + viewportSize) / itemStride),
      );
      setWindow((previous) => {
        if (
          previous.end <= count &&
          previous.start <= Math.max(0, firstVisible - 1) &&
          previous.end >= Math.min(count, lastVisible + 1)
        ) {
          return previous;
        }
        return {
          end: Math.min(count, lastVisible + overscan),
          start: Math.max(0, firstVisible - overscan),
        };
      });
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [count, horizontal, itemStride, leadingPx, overscan, viewportRef]);
  return window_;
}
function scrollIndexIntoView({
  horizontal = false,
  index,
  itemSize,
  itemStride,
  leadingPx = 0,
  viewport,
}: {
  horizontal?: boolean;
  index: number;
  itemSize: number;
  itemStride: number;
  leadingPx?: number;
  viewport: HTMLDivElement | null;
}) {
  if (!viewport || index < 0) return;
  const start = leadingPx + index * itemStride;
  const end = start + itemSize;
  const scrollStart = horizontal ? viewport.scrollLeft : viewport.scrollTop;
  const viewportSize = horizontal
    ? viewport.clientWidth
    : viewport.clientHeight;
  let nextScrollStart: number | null = null;
  if (start < scrollStart) {
    nextScrollStart = start;
  } else if (end > scrollStart + viewportSize) {
    nextScrollStart = end - viewportSize;
  }
  if (nextScrollStart === null) return;
  if (horizontal) {
    viewport.scrollLeft = nextScrollStart;
  } else {
    viewport.scrollTop = nextScrollStart;
  }
}
function FileVisual({
  file,
  className,
  loadPreviewImageUrl,
  pageable = false,
  pageUrlCache,
  previewAspectRatio,
  previewClassName,
  renderFilePreview,
}: {
  file: FileEntry;
  className?: string;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    pageIndex: number,
  ) => Promise<string | null>;
  pageable?: boolean;
  pageUrlCache?: Map<string, string>;
  previewAspectRatio?: number;
  previewClassName?: string;
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
}) {
  const previewUrls = filePreviewUrls(file);
  const canLoadLazily = Boolean(loadPreviewImageUrl);
  const totalPages = Math.max(
    previewUrls.length,
    canLoadLazily ? (file.previewPageCount ?? 0) : 0,
  );
  const [pageIndex, setPageIndex] = React.useState(0);
  const [lazyPageUrls, setLazyPageUrls] = React.useState<
    Record<number, string>
  >({});
  const [failedPages, setFailedPages] = React.useState<number[]>([]);
  const clampedPageIndex = Math.min(pageIndex, Math.max(totalPages - 1, 0));
  const previewUrl =
    previewUrls[clampedPageIndex] ??
    lazyPageUrls[clampedPageIndex] ??
    pageUrlCache?.get(`${file.path}#${clampedPageIndex}`) ??
    null;
  const resolvedAspectRatio = file.previewAspectRatio ?? previewAspectRatio;
  const isLazyPagePending =
    canLoadLazily &&
    !previewUrl &&
    clampedPageIndex < totalPages &&
    !failedPages.includes(clampedPageIndex);
  const fileRef = React.useRef(file);
  React.useEffect(() => {
    fileRef.current = file;
  });
  const [previousFilePath, setPreviousFilePath] = React.useState(file.path);
  if (!Object.is(previousFilePath, file.path)) {
    setPreviousFilePath(file.path);
    setPageIndex(0);
    setLazyPageUrls({});
    setFailedPages([]);
  }
  React.useEffect(() => {
    if (!isLazyPagePending || !loadPreviewImageUrl) return;
    let isCurrent = true;
    void loadPreviewImageUrl(fileRef.current, clampedPageIndex)
      .then((url) => {
        if (url) pageUrlCache?.set(`${file.path}#${clampedPageIndex}`, url);
        if (isCurrent && !url)
          setFailedPages((pages) => [...pages, clampedPageIndex]);
        if (isCurrent && url) {
          setLazyPageUrls((previous) => ({
            ...previous,
            [clampedPageIndex]: url,
          }));
        }
      })
      .catch(() => {
        if (isCurrent) setFailedPages((pages) => [...pages, clampedPageIndex]);
      });
    return () => {
      isCurrent = false;
    };
  }, [
    clampedPageIndex,
    file.path,
    isLazyPagePending,
    loadPreviewImageUrl,
    pageUrlCache,
  ]);
  const customPreview =
    !previewUrl && !isLazyPagePending ? renderFilePreview?.(file) : null;
  const showPager = pageable && totalPages > 1;
  const thumbnail = (
    <FileThumbnail
      file={{ name: file.name, type: file.contentType ?? "" }}
      className={cn(
        "@container",
        /\.(pdf|docx|xlsx|pptx)$/i.test(file.name) && "document-thumbnail",
        !showPager && className,
      )}
      previewAspectRatio={resolvedAspectRatio}
      previewClassName={cn(
        "bg-muted",
        file.contentType?.startsWith("image/") && "[&_img]:object-contain",
        previewClassName,
      )}
      previewImageUrl={previewUrl ?? undefined}
      isLoading={isLazyPagePending}
      previewContent={
        previewUrl || isLazyPagePending
          ? undefined
          : (customPreview ?? <FileGenericPreview file={file} />)
      }
    />
  );
  if (!showPager) return thumbnail;
  return (
    <div className={cn("group/pager relative", className)}>
      {thumbnail}
      <div className="absolute inset-x-0 bottom-1.5 flex items-center justify-center gap-1 opacity-0 transition-opacity group-focus-within/pager:opacity-100 group-hover/pager:opacity-100">
        <button
          type="button"
          aria-label="Previous page"
          tabIndex={-1}
          disabled={clampedPageIndex === 0}
          onClick={(event) => {
            event.stopPropagation();
            setPageIndex((previous) => Math.max(0, previous - 1));
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="flex size-6 items-center justify-center rounded-md bg-background/80 text-foreground shadow-xs backdrop-blur-sm transition-colors outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <span className="rounded-md bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums shadow-xs backdrop-blur-sm">
          {clampedPageIndex + 1}/{totalPages}
        </span>
        <button
          type="button"
          aria-label="Next page"
          tabIndex={-1}
          disabled={clampedPageIndex >= totalPages - 1}
          onClick={(event) => {
            event.stopPropagation();
            setPageIndex((previous) => Math.min(totalPages - 1, previous + 1));
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className="flex size-6 items-center justify-center rounded-md bg-background/80 text-foreground shadow-xs backdrop-blur-sm transition-colors outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
const VIEW_OPTIONS: Array<{
  icon: React.ComponentType<InlineRegistryIconProps>;
  label: string;
  value: FileSystemView;
}> = [
  { icon: GridViewGlyph, label: "Grid", value: "icons" },
  { icon: FolderTree, label: "List", value: "list" },
  { icon: LayoutThreeColumnGlyph, label: "Columns", value: "columns" },
  { icon: GalleryThumbnailsGlyph, label: "Gallery", value: "gallery" },
  { icon: Cube, label: "3D", value: "spatial" },
];
export function FileSystem({
  items,
  isLoading = false,
  className,
  title = "Files",
  headerActions,
  onSearchSubmit,
  defaultView = "icons",
  view: viewProp,
  onViewChange,
  defaultPath = "",
  path: pathProp,
  navigation,
  onPathChange,
  onSelectionChange,
  onShare,
  canShare,
  onDelete,
  onDeleteItems,
  onOrganizeItems,
  canOrganize,
  onMove,
  getMoveDestinations,
  onFileOpen,
  getFileUrl,
  loadChildren,
  loadPreviewImageUrl,
  loadDocumentStructure,
  renderFilePreview,
}: FileSystemProps) {
  const [contextEntry, setContextEntry] =
    React.useState<FileSystemEntry | null>(null);
  const [informationEntry, setInformationEntry] =
    React.useState<FileSystemEntry | null>(null);
  const [internalView, setInternalView] = React.useState(defaultView);
  const view = viewProp ?? internalView;
  const setView = React.useCallback(
    (nextView: FileSystemView) => {
      setInternalView(nextView);
      onViewChange?.(nextView);
    },
    [onViewChange],
  );
  const [loadedItems, setLoadedItems] = React.useState<FileSystemItem[]>([]);
  const allItems = React.useMemo(
    () => (loadedItems.length ? [...items, ...loadedItems] : items),
    [items, loadedItems],
  );
  const index = React.useMemo(() => buildFileSystemIndex(allItems), [allItems]);
  const [history, setHistory] = React.useState(() => ({
    index: 0,
    stack: [normalizeFolderPath(defaultPath)],
  }));
  const currentPath =
    pathProp === undefined
      ? (history.stack[history.index] ?? "")
      : normalizeFolderPath(pathProp);
  React.useEffect(() => {
    if (pathProp === undefined) onPathChange?.(currentPath);
  }, [currentPath, onPathChange, pathProp]);
  const canGoBack = navigation?.canGoBack ?? history.index > 0;
  const canGoForward =
    navigation?.canGoForward ?? history.index < history.stack.length - 1;
  const [selectedPaths, setSelectedPaths] = React.useState<Set<string>>(
    () => new Set(),
  );
  const selectionAnchor = React.useRef<string | null>(null);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const selectedEntry = React.useMemo(() => {
    if (selectedPath === null) return null;
    return (
      index.files.get(selectedPath) ?? index.folders.get(selectedPath) ?? null
    );
  }, [index, selectedPath]);
  const [searchInput, setSearchInput] = React.useState("");
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isSearchExpanded, setIsSearchExpanded] = React.useState(false);
  const searchQuery = normalizeSearchQuery(searchInput);
  const isSearching = searchQuery.length > 0;
  const [sort, setSort] = React.useState(DEFAULT_SORT);
  const [filters, setFilters] = React.useState<FileSystemFilter[]>([]);
  const hasActiveFilters = filters.length > 0;
  const fileFilter = React.useMemo(() => {
    if (filters.length === 0) return null;
    return (file: FileEntry) =>
      filters.every((filter) => fileMatchesFilter(file, filter));
  }, [filters]);
  const visiblePaths = React.useMemo(() => {
    if (!isSearching && !fileFilter) return null;
    const visible = new Set<string>();
    const markVisible = (path: string) => {
      while (path && path !== currentPath && !visible.has(path)) {
        visible.add(path);
        path = pathParent(path);
      }
    };
    const matchesQuery = (path: string) =>
      !isSearching ||
      path.slice(currentPath.length).toLowerCase().includes(searchQuery);
    for (const [path, file] of index.files) {
      if (path === currentPath) continue;
      if (currentPath && !path.startsWith(currentPath)) continue;
      if (!matchesQuery(path)) continue;
      if (fileFilter && !fileFilter(file)) continue;
      markVisible(path);
    }
    if (!fileFilter) {
      for (const path of index.folders.keys()) {
        if (path === currentPath) continue;
        if (currentPath && !path.startsWith(currentPath)) continue;
        if (matchesQuery(path)) markVisible(path);
      }
    }
    return visible;
  }, [currentPath, fileFilter, index, isSearching, searchQuery]);
  const visibleIndex = React.useMemo(() => {
    if (!visiblePaths) return index;
    const children = new Map<string, FileSystemEntry[]>();
    for (const [parentPath, parentChildren] of index.children) {
      const visibleChildren = parentChildren.filter((entry) =>
        visiblePaths.has(entry.path),
      );
      if (visibleChildren.length) children.set(parentPath, visibleChildren);
    }
    return { ...index, children };
  }, [index, visiblePaths]);
  const sortedIndex = React.useMemo(() => {
    if (
      sort.key === DEFAULT_SORT.key &&
      sort.direction === DEFAULT_SORT.direction
    ) {
      return visibleIndex;
    }
    const children = new Map<string, FileSystemEntry[]>();
    for (const [parentPath, parentChildren] of visibleIndex.children) {
      children.set(
        parentPath,
        [...parentChildren].sort((left, right) =>
          compareEntriesBySort(left, right, sort),
        ),
      );
    }
    return { ...visibleIndex, children };
  }, [sort, visibleIndex]);
  const selectedPathRef = React.useRef<string | null>(null);
  const selectEntries = React.useCallback(
    (entries: FileSystemEntry[], focused?: FileSystemEntry | null) => {
      const next = new Set(entries.map((entry) => entry.path));
      setSelectedPaths((previous) =>
        previous.size === next.size &&
        [...previous].every((path) => next.has(path))
          ? previous
          : next,
      );
      const entry = focused ?? entries.at(-1) ?? null;
      selectedPathRef.current = entry?.path ?? null;
      setSelectedPath(entry?.path ?? null);
      onSelectionChange?.(entry);
    },
    [onSelectionChange],
  );
  const selectEntry = React.useCallback(
    (
      entry: FileSystemEntry | null,
      event?: React.MouseEvent,
      orderedEntries?: FileSystemEntry[],
    ) => {
      if (!entry) {
        selectionAnchor.current = null;
        selectEntries([]);
        return;
      }
      const additive = Boolean(event?.metaKey || event?.ctrlKey);
      let next = new Set(additive ? selectedPaths : []);
      if (event?.shiftKey && orderedEntries) {
        const start = orderedEntries.findIndex(
          (item) => item.path === selectionAnchor.current,
        );
        const end = orderedEntries.findIndex(
          (item) => item.path === entry.path,
        );
        if (start >= 0 && end >= 0) {
          for (const item of orderedEntries.slice(
            Math.min(start, end),
            Math.max(start, end) + 1,
          ))
            next.add(item.path);
        } else next.add(entry.path);
      } else {
        if (additive && next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        selectionAnchor.current = entry.path;
      }
      const entries = [...next].flatMap((path) => {
        const item = index.files.get(path) ?? index.folders.get(path);
        return item ? [item] : [];
      });
      selectEntries(entries, next.has(entry.path) ? entry : entries.at(-1));
    },
    [index, selectedPaths, selectEntries],
  );
  React.useEffect(() => {
    const remaining = [...selectedPaths].flatMap((path) => {
      const entry = index.files.get(path) ?? index.folders.get(path);
      return entry && (!visiblePaths || visiblePaths.has(path)) ? [entry] : [];
    });
    if (remaining.length !== selectedPaths.size) selectEntries(remaining);
  }, [index, selectedPaths, selectEntries, visiblePaths]);
  const applySortKey = React.useCallback((key: FileSystemSortKey) => {
    setSort((previous) =>
      previous.key === key
        ? previous
        : { direction: defaultSortDirection(key), key },
    );
  }, []);
  const toggleSortColumn = React.useCallback((key: FileSystemSortKey) => {
    setSort((previous) =>
      previous.key === key
        ? { direction: previous.direction === "asc" ? "desc" : "asc", key }
        : { direction: defaultSortDirection(key), key },
    );
  }, []);
  const fileTypeOptions = React.useMemo(() => {
    const byMime = new Map<string, FileTypeFilterOption>();
    for (const file of index.files.values()) {
      const mime = mimeTypeForFile(file);
      if (!byMime.has(mime)) {
        const dotIndex = file.name.lastIndexOf(".");
        const extension =
          dotIndex > 0 ? file.name.slice(dotIndex + 1).toLowerCase() : "";
        byMime.set(mime, {
          group: fileTypeFilterGroup(mime),
          iconFileName: extension ? `file.${extension}` : file.name,
          label: MIME_TYPE_LABELS[mime] ?? mime,
          mime,
        });
      }
    }
    return [...byMime.values()].sort((left, right) =>
      left.label.localeCompare(right.label),
    );
  }, [index]);
  const filterIdRef = React.useRef(0);
  const [dateRangeDialog, setDateRangeDialog] = React.useState<{
    initialRange?: {
      from: Date;
      to: Date;
    };
    type: FileSystemDateFilterType;
  } | null>(null);
  const toggleFileTypeFilterValue = React.useCallback(
    (mime: string, checked: boolean) => {
      const id = `filter-${++filterIdRef.current}`;
      setFilters((previous) => {
        const existing = previous.find((filter) => filter.type === "fileType");
        if (!existing) {
          if (!checked) return previous;
          return [
            ...previous,
            {
              id,
              operator: "is" as const,
              type: "fileType" as const,
              value: [mime],
            },
          ];
        }
        const value = checked
          ? [...new Set([...existing.value, mime])]
          : existing.value.filter((entry) => entry !== mime);
        if (value.length === 0) {
          return previous.filter((filter) => filter !== existing);
        }
        const operator =
          existing.operator === "is" || existing.operator === "is-any-of"
            ? value.length > 1
              ? ("is-any-of" as const)
              : ("is" as const)
            : existing.operator;
        return previous.map((filter) =>
          filter === existing ? { ...filter, operator, value } : filter,
        );
      });
    },
    [],
  );
  const setDatePresetFilter = React.useCallback(
    (type: FileSystemDateFilterType, preset: string) => {
      const id = `filter-${++filterIdRef.current}`;
      setFilters((previous) => [
        ...previous.filter((filter) => filter.type !== type),
        { id, operator: "after", type, value: [preset] },
      ]);
    },
    [],
  );
  const openDateRangeDialog = React.useCallback(
    (type: FileSystemDateFilterType) => {
      const existing = filters.find((filter) => filter.type === type);
      setDateRangeDialog({
        initialRange:
          existing && isCustomDateRangeValue(existing.value)
            ? {
                from: new Date(existing.value[0]),
                to: new Date(existing.value[1]),
              }
            : undefined,
        type,
      });
    },
    [filters],
  );
  const applyCustomDateRange = React.useCallback(
    (type: FileSystemDateFilterType, from: Date, to: Date) => {
      const id = `filter-${++filterIdRef.current}`;
      setFilters((previous) => {
        const existing = previous.find((filter) => filter.type === type);
        return [
          ...previous.filter((filter) => filter.type !== type),
          {
            id,
            operator:
              existing?.operator === "not-in-range"
                ? ("not-in-range" as const)
                : ("in-range" as const),
            type,
            value: [from.toISOString(), to.toISOString()],
          },
        ];
      });
    },
    [],
  );
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [headerLayout, setHeaderLayout] = React.useState<
    "full" | "compact" | "minimal"
  >("full");
  const [isBelowIpadWidth, setIsBelowIpadWidth] = React.useState(false);
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const applyWidth = (width: number | undefined) => {
      if (width === undefined) return;
      setHeaderLayout(
        width < 360 ? "minimal" : width < 560 ? "compact" : "full",
      );
      setIsBelowIpadWidth(width < IPAD_MIN_WIDTH);
    };
    const observer = new ResizeObserver((observerEntries) =>
      applyWidth(observerEntries[0]?.contentRect.width),
    );
    applyWidth(root.clientWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const requestedFoldersRef = React.useRef(new Set<string>());
  const [loadingFolders, setLoadingFolders] = React.useState<Set<string>>(
    () => new Set(),
  );
  const ensureChildren = React.useCallback(
    (folderPath: string) => {
      if (!loadChildren) return;
      const folder = index.folders.get(folderPath);
      if (!folder?.hasChildren) return;
      if (index.children.get(folderPath)?.length) return;
      if (requestedFoldersRef.current.has(folderPath)) return;
      requestedFoldersRef.current.add(folderPath);
      setLoadingFolders((previous) => new Set(previous).add(folderPath));
      void (async () => {
        try {
          let cursor: string | null = null;
          do {
            const result = await loadChildren({ cursor, path: folderPath });
            if (result.items.length) {
              setLoadedItems((previous) => [...previous, ...result.items]);
            }
            cursor = result.nextCursor ?? null;
          } while (cursor);
        } catch {
          requestedFoldersRef.current.delete(folderPath);
        } finally {
          setLoadingFolders((previous) => {
            const next = new Set(previous);
            next.delete(folderPath);
            return next;
          });
        }
      })();
    },
    [index, loadChildren],
  );
  const navigateTo = React.useCallback(
    (folderPath: string) => {
      const path = normalizeFolderPath(folderPath);
      if (pathProp !== undefined) onPathChange?.(path);
      else
        setHistory((previous) => {
          if (previous.stack[previous.index] === path) return previous;
          const stack = [...previous.stack.slice(0, previous.index + 1), path];
          return { index: stack.length - 1, stack };
        });
      setSearchInput("");
      selectEntry(null);
      ensureChildren(path);
    },
    [ensureChildren, selectEntry, pathProp, onPathChange],
  );
  React.useEffect(() => {
    ensureChildren(currentPath);
  }, [currentPath, ensureChildren]);
  const previousPathRef = React.useRef(currentPath);
  React.useEffect(() => {
    if (previousPathRef.current === currentPath) {
      return;
    }
    previousPathRef.current = currentPath;
    setSearchInput("");
    setSelectedPath(null);
    const root = rootRef.current;
    if (root && document.activeElement === document.body) {
      root.focus({ preventScroll: true });
    }
  }, [currentPath]);
  const [openedFile, setOpenedFile] = React.useState<{
    file: FileEntry;
    kind: FileSystemViewerKind;
    url: string;
  } | null>(null);
  const [resolvedUrlCache] = React.useState(() => new Map<string, string>());
  const [pageUrlCache] = React.useState(() => new Map<string, string>());
  const [stagePool, setStagePool] = React.useState<string[]>([]);
  const [stageRecency] = React.useState(() => new Map<string, number>());
  const stageClockRef = React.useRef(0);
  const [stageContainers] = React.useState(
    () => new Map<string, HTMLDivElement>(),
  );
  const [stageHosts] = React.useState(() => new Map<string, HTMLElement>());
  const [, bumpStageHosts] = React.useState(0);
  const [stageVersion, setStageVersion] = React.useState(0);
  const [dialogStageHost, setDialogStageHost] =
    React.useState<HTMLElement | null>(null);
  const registerStageHost = React.useCallback(
    (path: string, element: HTMLElement | null) => {
      if (element) {
        if (stageHosts.get(path) === element) return;
        stageHosts.set(path, element);
      } else {
        if (!stageHosts.has(path)) return;
        stageHosts.delete(path);
      }
      bumpStageHosts((version) => version + 1);
    },
    [stageHosts],
  );
  const dialogStageHostRef = React.useCallback(
    (element: HTMLDivElement | null) => setDialogStageHost(element),
    [],
  );
  const poolStagePath = React.useCallback(
    (path: string) => {
      if (!index.files.has(path)) return;
      if (!stageContainers.has(path)) {
        const container = document.createElement("div");
        container.className =
          "flex size-full min-h-0 min-w-0 items-center justify-center contain-layout contain-paint";
        stageContainers.set(path, container);
      }
      stageRecency.set(path, ++stageClockRef.current);
      setStageVersion((version) => version + 1);
      setStagePool((previous) => {
        if (previous.includes(path)) return previous;
        const next = [...previous, path];
        if (next.length <= GALLERY_STAGE_POOL_SIZE) return next;
        let evicted = next[0];
        for (const candidate of next) {
          if (candidate === path) continue;
          if (
            (stageRecency.get(candidate) ?? 0) <
            (stageRecency.get(evicted) ?? 0)
          ) {
            evicted = candidate;
          }
        }
        return next.filter((candidate) => candidate !== evicted);
      });
    },
    [index, stageContainers, stageRecency],
  );
  const dialogStagePath =
    openedFile !== null && openedFile.kind !== "image"
      ? openedFile.file.path
      : null;
  const attachedStagePaths = React.useMemo(() => {
    void stageVersion;
    const attached = [...stagePool]
      .sort((a, b) => (stageRecency.get(b) ?? 0) - (stageRecency.get(a) ?? 0))
      .slice(0, GALLERY_STAGE_ATTACHED_COUNT);
    if (
      dialogStagePath &&
      stagePool.includes(dialogStagePath) &&
      !attached.includes(dialogStagePath)
    ) {
      attached.push(dialogStagePath);
    }
    return attached;
  }, [dialogStagePath, stagePool, stageRecency, stageVersion]);
  React.useLayoutEffect(() => {
    for (const [path, container] of stageContainers) {
      if (!stagePool.includes(path)) {
        container.remove();
        stageContainers.delete(path);
        continue;
      }
      if (dialogStagePath === path) {
        if (dialogStageHost && container.parentElement !== dialogStageHost) {
          dialogStageHost.appendChild(container);
        }
        continue;
      }
      const target = attachedStagePaths.includes(path)
        ? (stageHosts.get(path) ?? null)
        : null;
      if (!target) {
        if (container.parentElement) container.remove();
      } else if (container.parentElement !== target) {
        target.appendChild(container);
      }
    }
  });
  const openFile = React.useCallback(
    (file: FileEntry) => {
      void (async () => {
        let url = file.url ?? resolvedUrlCache.get(file.path) ?? null;
        if (!url && getFileUrl) {
          try {
            url = await getFileUrl(file);
            if (url) resolvedUrlCache.set(file.path, url);
          } catch {
            url = null;
          }
        }
        if (onFileOpen) {
          onFileOpen(file, url);
          return;
        }
        const kind = viewerKindForFile(file);
        if (kind && url) {
          poolStagePath(file.path);
          setOpenedFile({ file, kind, url });
        } else if (url && typeof window !== "undefined") {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      })();
    },
    [getFileUrl, onFileOpen, poolStagePath, resolvedUrlCache],
  );
  const openEntry = React.useCallback(
    (entry: FileSystemEntry) => {
      if (entry.kind === "folder") {
        navigateTo(entry.path);
      } else {
        openFile(entry);
      }
    },
    [navigateTo, openFile],
  );
  const selectAndPrefetchEntry = React.useCallback(
    (
      entry: FileSystemEntry | null,
      event?: React.MouseEvent,
      orderedEntries?: FileSystemEntry[],
    ) => {
      selectEntry(entry, event, orderedEntries);
      if (entry?.kind === "folder") ensureChildren(entry.path);
    },
    [ensureChildren, selectEntry],
  );
  const goBack = React.useCallback(() => {
    if (navigation) navigation.back();
    else
      setHistory((previous) => ({
        ...previous,
        index: Math.max(0, previous.index - 1),
      }));
    setSearchInput("");
    selectEntry(null);
  }, [selectEntry, navigation]);
  const goForward = React.useCallback(() => {
    if (navigation) navigation.forward();
    else
      setHistory((previous) => ({
        ...previous,
        index: Math.min(previous.stack.length - 1, previous.index + 1),
      }));
    setSearchInput("");
    selectEntry(null);
  }, [selectEntry, navigation]);
  const structureCache = React.useRef(
    new Map<string, Promise<SpatialDocumentStructure | null>>(),
  );
  const loadStructure = React.useMemo(
    () =>
      loadDocumentStructure
        ? (file: FileSystemFileItem) => {
            // Keyed on index status so a document that finishes parsing
            // is fetched again.
            const key = `${file.path}\n${file.metadata?.Index ?? ""}`;
            let pending = structureCache.current.get(key);
            if (!pending) {
              pending = loadDocumentStructure(file).catch(() => null);
              structureCache.current.set(key, pending);
            }
            return pending;
          }
        : undefined,
    [loadDocumentStructure],
  );
  const currentEntries = sortedIndex.children.get(currentPath) ?? [];
  const currentFolderName =
    currentPath === "" ? title : pathName(currentPath) || title;
  const isLoadingCurrentFolder = loadingFolders.has(currentPath);
  const treeExpansionRef = React.useRef(new Map<string, readonly string[]>());
  const viewProps: FileSystemViewProps = {
    attachedStagePaths,
    currentPath,
    entries: currentEntries,
    fileFilter,
    getFileUrl,
    index: sortedIndex,
    loadPreviewImageUrl,
    loadingFolders,
    onOpen: openEntry,
    onSelect: selectAndPrefetchEntry,
    onSortColumnClick: toggleSortColumn,
    pageUrlCache,
    poolStagePath,
    registerStageHost,
    renderFilePreview,
    searchQuery,
    selectedEntry,
    selectedPath,
    selectedPaths,
    onSelectEntries: selectEntries,
    sort,
    treeExpansionRef,
  };
  const openedFileName = openedFile
    ? (openedFile.file.name ?? openedFile.file.path)
    : "";
  const activeViewOption = VIEW_OPTIONS.find((option) => option.value === view);
  const viewerCloseToolbarAction = (
    <DialogClose
      render={
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close preview"
        >
          <X className="size-4" />
        </Button>
      }
    ></DialogClose>
  );
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-slot="file-system"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "f") {
          event.preventDefault();
          setIsSearchExpanded(true);
          searchInputRef.current?.focus();
        }
      }}
      className={cn(
        "flex h-[480px] min-h-0 flex-col overflow-hidden rounded-xl border bg-background text-foreground outline-none",
        className,
      )}
    >
      <FileSystemIconSpriteSheet />
      <div
        className={cn(
          "relative grid shrink-0 items-center border-b bg-muted/40 px-2",
          headerLayout === "minimal"
            ? "grid-cols-[minmax(0,1fr)_auto] gap-1 py-2"
            : "h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2",
        )}
      >
        <div className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            aria-label="Back"
            title="Back"
            disabled={!canGoBack}
            onClick={goBack}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronLeft className="size-4.5" />
          </button>
          <button
            type="button"
            aria-label="Forward"
            title="Forward"
            disabled={!canGoForward}
            onClick={goForward}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="size-4.5" />
          </button>
          <span className="ml-1.5 truncate text-sm font-semibold">
            {currentFolderName}
          </span>
        </div>
        {headerLayout !== "full" || isBelowIpadWidth ? (
          <Select
            value={view}
            onValueChange={(value) => setView(value as FileSystemView)}
          >
            <SelectTrigger
              size="sm"
              aria-label="View"
              className="h-7 min-h-7 w-auto min-w-0 [&_svg]:size-4"
            >
              <SelectValue>
                {activeViewOption ? (
                  <activeViewOption.icon className="size-4" />
                ) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {VIEW_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="flex items-center gap-2">
                    <option.icon className="size-4" />
                    {option.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Tabs
            value={view}
            onValueChange={(value) => setView(value as FileSystemView)}
            className="gap-0"
          >
            <TabsList className="h-8 p-0.5">
              {VIEW_OPTIONS.map((option) => (
                <TabsTrigger
                  key={option.value}
                  value={option.value}
                  aria-label={`${option.label} view`}
                  title={option.label}
                  className="h-7 grow-0 px-2.5 sm:h-7"
                >
                  <option.icon className="size-4" />
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <div
          className={cn(
            "flex min-w-0 items-center justify-end gap-1",
            headerLayout === "minimal" && "col-span-2 flex-wrap",
          )}
        >
          <FileSystemSortSelect
            layout={headerLayout}
            onKeyChange={applySortKey}
            showLabel={!isBelowIpadWidth}
            sort={sort}
          />
          <FileSystemFilterMenu
            fileTypeOptions={fileTypeOptions}
            filters={filters}
            onOpenCustomRange={openDateRangeDialog}
            onSelectDatePreset={setDatePresetFilter}
            onToggleFileType={toggleFileTypeFilterValue}
          />
          <FileSystemSearchField
            inputRef={searchInputRef}
            isExpanded={isSearchExpanded}
            layout={headerLayout}
            onExpandedChange={setIsSearchExpanded}
            onValueChange={setSearchInput}
            onSubmit={onSearchSubmit}
            value={searchInput}
          />
          {headerActions}
        </div>
      </div>
      {hasActiveFilters ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground">
          {filters.map((filter) => {
            const dateFilterType =
              filter.type === "fileType" ? null : filter.type;
            return (
              <FileSystemFilterPill
                key={filter.id}
                fileTypeOptions={fileTypeOptions}
                filter={filter}
                onOpenCustomRange={
                  dateFilterType
                    ? () => openDateRangeDialog(dateFilterType)
                    : undefined
                }
                onOperatorChange={(operator) =>
                  setFilters((previous) =>
                    previous.map((entry) =>
                      entry.id === filter.id ? { ...entry, operator } : entry,
                    ),
                  )
                }
                onRemove={() =>
                  setFilters((previous) =>
                    previous.filter((entry) => entry.id !== filter.id),
                  )
                }
                onSelectDatePreset={(preset) =>
                  setFilters((previous) =>
                    previous.map((entry) =>
                      entry.id === filter.id
                        ? {
                            ...entry,
                            operator:
                              entry.operator === "before" ||
                              entry.operator === "after"
                                ? entry.operator
                                : "after",
                            value: [preset],
                          }
                        : entry,
                    ),
                  )
                }
                onToggleFileType={toggleFileTypeFilterValue}
              />
            );
          })}
          <button
            type="button"
            onClick={() => setFilters([])}
            className="rounded-md px-1.5 py-0.5 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Clear
          </button>
        </div>
      ) : null}
      <ContextMenu>
        <ContextMenuTrigger
          className="relative min-h-0 flex-1"
          onContextMenuCapture={(event) => {
            let entry: FileSystemEntry | null = null;
            for (const target of event.nativeEvent.composedPath()) {
              if (!(target instanceof HTMLElement)) continue;
              const path =
                target.dataset.entryPath ??
                (target.dataset.itemPath
                  ? `${currentPath}${target.dataset.itemPath}`
                  : undefined);
              if (path) {
                entry =
                  index.files.get(path) ??
                  index.folders.get(normalizeFolderPath(path)) ??
                  null;
                break;
              }
            }
            if (!entry && event.button !== 2) entry = selectedEntry;
            if (!entry) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (!selectedPaths.has(entry.path)) selectEntry(entry);
            setContextEntry(entry);
          }}
        >
          <React.Suspense
            fallback={<FileSystemEmptyState label="Opening folder" isLoading />}
          >
            {isLoading ||
            (isLoadingCurrentFolder && currentEntries.length === 0) ? (
              <FileSystemEmptyState label="Opening folder" isLoading />
            ) : currentEntries.length === 0 &&
              (view !== "columns" || isSearching || hasActiveFilters) ? (
              <FileSystemEmptyState
                label={
                  isSearching
                    ? `No results for “${searchInput.trim()}”`
                    : hasActiveFilters
                      ? "No items match the active filters"
                      : "This folder is empty"
                }
              />
            ) : view === "spatial" ? (
              <Group orientation="horizontal" className="size-full">
                <Panel
                  id="spatial-scene"
                  minSize="30%"
                  className="relative min-h-0 min-w-0"
                >
                  <LazySpatialView
                    items={Array.from(sortedIndex.children.values()).flat()}
                    scope={currentPath}
                    selectedPath={selectedPath}
                    onSelect={selectAndPrefetchEntry}
                    onOpen={openEntry}
                    loadPreviewImageUrl={loadPreviewImageUrl}
                    loadDocumentStructure={loadStructure}
                  />
                </Panel>
                {selectedEntry ? (
                  <>
                    <Separator
                      aria-label="Resize information panel"
                      className="relative w-px bg-border outline-none transition-colors after:absolute after:inset-y-0 after:-inset-x-1 hover:bg-ring focus-visible:bg-ring"
                    />
                    <Panel
                      id="spatial-information"
                      defaultSize={280}
                      minSize={190}
                      maxSize="60%"
                    >
                      <FileSystemInformationSidebar
                        entry={selectedEntry}
                        index={sortedIndex}
                        loadPreviewImageUrl={loadPreviewImageUrl}
                        onOpen={openEntry}
                        renderFilePreview={renderFilePreview}
                      >
                        {selectedEntry.kind === "file" && loadStructure ? (
                          <FileSystemStructureSummary
                            file={selectedEntry}
                            loadStructure={loadStructure}
                          />
                        ) : null}
                      </FileSystemInformationSidebar>
                    </Panel>
                  </>
                ) : null}
              </Group>
            ) : view === "icons" ? (
              <FileSystemIconsView {...viewProps} />
            ) : view === "list" ? (
              <FileSystemListView {...viewProps} />
            ) : view === "columns" ? (
              <FileSystemColumnsView {...viewProps} />
            ) : (
              <FileSystemGalleryView {...viewProps} />
            )}
          </React.Suspense>
        </ContextMenuTrigger>
        <ContextMenuPopup>
          <ContextMenuItem
            disabled={!contextEntry}
            onClick={() => contextEntry && openEntry(contextEntry)}
          >
            <ExternalLink /> Open
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!contextEntry}
            onClick={() => setInformationEntry(contextEntry)}
          >
            <Info /> Information
          </ContextMenuItem>
          {onShare && (
            <ContextMenuItem
              disabled={!contextEntry || (canShare && !canShare(contextEntry))}
              onClick={() => contextEntry && onShare(contextEntry)}
            >
              <Share2 /> Share
            </ContextMenuItem>
          )}
          {onOrganizeItems && (
            <>
              <ContextMenuSeparator className="my-1 h-px bg-border" />
              <ContextMenuItem
                disabled={
                  !contextEntry ||
                  selectedPaths.size === 0 ||
                  selectedPaths.size > 100 ||
                  [...selectedPaths].some((path) => {
                    const item = index.files.get(path);
                    return (
                      !item ||
                      Boolean(canOrganize && !canOrganize(item)) ||
                      Boolean(canShare && !canShare(item))
                    );
                  })
                }
                onClick={() => {
                  const selected = [...selectedPaths].flatMap((path) => {
                    const file = index.files.get(path);
                    return file ? [file] : [];
                  });
                  if (selected.length) onOrganizeItems(selected);
                }}
              >
                <FolderBolt /> Organize
              </ContextMenuItem>
            </>
          )}
          {onMove && (
            <ContextMenuSub>
              <ContextMenuSubTrigger
                disabled={
                  !contextEntry || (canShare && !canShare(contextEntry))
                }
              >
                <Folder /> Move to
              </ContextMenuSubTrigger>
              <ContextMenuSubPopup>
                {contextEntry &&
                  (getMoveDestinations?.(contextEntry) ?? []).map(
                    (destination) => (
                      <ContextMenuItem
                        key={destination.id ?? "root"}
                        onClick={() => onMove(contextEntry, destination.id)}
                      >
                        <Folder />
                        <span className="truncate">{destination.label}</span>
                      </ContextMenuItem>
                    ),
                  )}
                {(!contextEntry ||
                  !getMoveDestinations?.(contextEntry).length) && (
                  <ContextMenuItem disabled>
                    No available folders
                  </ContextMenuItem>
                )}
              </ContextMenuSubPopup>
            </ContextMenuSub>
          )}
          {(onDelete || onDeleteItems) && (
            <>
              <ContextMenuSeparator className="my-1 h-px bg-border" />
              <ContextMenuItem
                className="text-destructive-foreground data-highlighted:bg-destructive/10"
                disabled={
                  !contextEntry ||
                  [...selectedPaths].some((path) => {
                    const item =
                      index.files.get(path) ?? index.folders.get(path);
                    return !item || Boolean(canShare && !canShare(item));
                  })
                }
                onClick={() => {
                  if (!contextEntry) return;
                  const entries = [...selectedPaths].flatMap((path) => {
                    const item =
                      index.files.get(path) ?? index.folders.get(path);
                    return item ? [item] : [];
                  });
                  if (onDeleteItems) onDeleteItems(entries);
                  else onDelete?.(contextEntry);
                }}
              >
                <Trash2 />{" "}
                {selectedPaths.size > 1
                  ? `Delete ${selectedPaths.size} items`
                  : "Delete"}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuPopup>
      </ContextMenu>
      <Dialog
        open={Boolean(informationEntry)}
        onOpenChange={(open) => {
          if (!open) setInformationEntry(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{informationEntry?.name}</DialogTitle>
          </DialogHeader>
          <div className="px-6 pb-6">
            {informationEntry && (
              <FileSystemInformation entry={informationEntry} index={index} />
            )}
          </div>
        </DialogContent>
      </Dialog>
      <div
        aria-live="polite"
        className="flex h-7 shrink-0 items-center justify-center gap-1 border-t bg-muted/40 px-3 text-xs text-muted-foreground"
      >
        <span>
          {currentEntries.length}{" "}
          {isSearching
            ? currentEntries.length === 1
              ? "result"
              : "results"
            : currentEntries.length === 1
              ? "item"
              : "items"}
        </span>
        {selectedPaths.size > 1 ? (
          <span>· {selectedPaths.size} selected</span>
        ) : selectedEntry ? (
          <span>· “{selectedEntry.name}” selected</span>
        ) : null}
      </div>
      <Dialog
        open={openedFile !== null}
        onOpenChange={(open) => {
          if (!open) setOpenedFile(null);
        }}
      >
        {openedFile ? (
          <DialogContent
            className={cn(
              "overflow-hidden p-0",
              VIEWER_DIALOG_CLASSNAMES[openedFile.kind],
            )}
            showCloseButton={openedFile.kind === "image"}
          >
            <DialogTitle className="sr-only">{openedFileName}</DialogTitle>
            {openedFile.kind === "image" ? (
              <img
                src={openedFile.url}
                alt={openedFileName}
                className="max-h-[88vh] w-auto max-w-full rounded-2xl object-contain"
              />
            ) : (
              <div
                ref={dialogStageHostRef}
                className="flex h-full min-h-0 flex-1 flex-col"
              />
            )}
          </DialogContent>
        ) : null}

        {stagePool.map((path) => {
          const file = index.files.get(path);
          const container = stageContainers.get(path);
          if (!file || !container) return null;
          const isOpenedInDialog =
            openedFile !== null &&
            openedFile.kind !== "image" &&
            openedFile.file.path === path;
          return createPortal(
            <FileSystemGalleryStage
              file={file}
              getFileUrl={getFileUrl}
              loadPreviewImageUrl={loadPreviewImageUrl}
              pageUrlCache={pageUrlCache}
              renderFilePreview={renderFilePreview}
              toolbarActions={
                isOpenedInDialog ? viewerCloseToolbarAction : undefined
              }
              urlCache={resolvedUrlCache}
              variant={isOpenedInDialog ? "dialog" : "stage"}
            />,
            container,
            path,
          );
        })}
      </Dialog>
      {dateRangeDialog ? (
        <FileSystemDateRangeDialog
          initialRange={dateRangeDialog.initialRange}
          onApply={(from, to) => {
            applyCustomDateRange(dateRangeDialog.type, from, to);
            setDateRangeDialog(null);
          }}
          onClose={() => setDateRangeDialog(null)}
        />
      ) : null}
    </div>
  );
}
const TOOLBAR_ICON_BUTTON_CLASSNAME =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";
function FileSystemSearchField({
  inputRef,
  isExpanded,
  layout,
  onExpandedChange,
  onValueChange,
  onSubmit,
  value,
}: {
  onSubmit?: (query: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isExpanded: boolean;
  layout: "full" | "compact" | "minimal";
  onExpandedChange: (isExpanded: boolean) => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const isInline = layout === "full";
  React.useEffect(() => {
    if (!isInline && isExpanded) inputRef.current?.focus();
  }, [inputRef, isExpanded, isInline]);
  const input = (
    <div
      className={cn(
        "relative flex h-7 min-w-0 flex-1 items-center rounded-lg border border-input bg-popover text-sm text-foreground shadow-xs/5 transition-shadow outline-none not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-focus-within:before:shadow-[0_1px_--theme(--color-black/4%)] focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background dark:bg-input/32 dark:not-focus-within:before:shadow-[0_-1px_--theme(--color-white/6%)]",
        isInline && "max-w-56",
      )}
    >
      <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        role="searchbox"
        aria-label="Search files"
        placeholder="Search files or contents"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim() && onSubmit) {
            event.preventDefault();
            onSubmit(value.trim());
            return;
          }
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          if (value) {
            onValueChange("");
          } else {
            onExpandedChange(false);
            event.currentTarget.blur();
          }
        }}
        className="h-full w-full min-w-0 rounded-[inherit] bg-transparent pr-6 pl-7 outline-none placeholder:text-muted-foreground"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onValueChange("");
            inputRef.current?.focus();
          }}
          className="absolute right-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </div>
  );
  if (isInline) {
    return <div className="flex w-56 min-w-32 items-center">{input}</div>;
  }
  return (
    <Popover open={isExpanded} onOpenChange={onExpandedChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Search"
            title="Search"
            className={cn(TOOLBAR_ICON_BUTTON_CLASSNAME, "relative")}
          >
            <Search className="size-4" />
            {value ? (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            ) : null}
          </button>
        }
      ></PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 p-1">
        {input}
      </PopoverContent>
    </Popover>
  );
}
function FileSystemSortSelect({
  layout,
  onKeyChange,
  showLabel,
  sort,
}: {
  layout: "full" | "compact" | "minimal";
  onKeyChange: (key: FileSystemSortKey) => void;
  showLabel: boolean;
  sort: FileSystemSortState;
}) {
  const activeOption = SORT_OPTIONS.find((option) => option.key === sort.key);
  return (
    <Select
      value={sort.key}
      onValueChange={(value) => onKeyChange(value as FileSystemSortKey)}
    >
      <SelectTrigger
        size="sm"
        aria-label="Sort by"
        title="Sort by"
        className="h-7 min-h-7 w-auto min-w-0 shrink-0 [&_svg]:size-4"
      >
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <ArrowUpDown className="size-4" />
            {layout === "full" && showLabel ? activeOption?.triggerLabel : null}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {SORT_OPTIONS.map((option) => (
          <SelectItem key={option.key} value={option.key}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function FileSystemFileTypeCommand({
  checkedMimes,
  onToggle,
  options,
}: {
  checkedMimes: string[];
  onToggle: (mime: string, checked: boolean) => void;
  options: FileTypeFilterOption[];
}) {
  const [query, setQuery] = React.useState("");
  const visibleOptions = options.filter((option) =>
    `${option.label} ${option.mime}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="w-full">
      <Input
        placeholder="Search file types…"
        aria-label="Search file types"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (!["Escape", "Tab", "ArrowDown", "ArrowUp"].includes(event.key))
            event.stopPropagation();
        }}
        className="mb-1 h-8"
      />
      <InlineScrollArea2 orientation="vertical" className="h-auto max-h-64">
        {visibleOptions.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            No file types found.
          </p>
        )}
        {FILE_TYPE_FILTER_GROUPS.map((group) => {
          const groupOptions = visibleOptions.filter(
            (option) => option.group === group,
          );
          if (!groupOptions.length) return null;
          return (
            <DropdownMenuGroup key={group}>
              <DropdownMenuLabel>{group}</DropdownMenuLabel>
              {groupOptions.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.mime}
                  checked={checkedMimes.includes(option.mime)}
                  closeOnClick={false}
                  onCheckedChange={(checked) => onToggle(option.mime, checked)}
                >
                  <FileTypeIcon
                    fileName={option.iconFileName}
                    className="size-4"
                  />
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          );
        })}
      </InlineScrollArea2>
    </div>
  );
}

function FileSystemFilterMenu({
  fileTypeOptions,
  filters,
  onOpenCustomRange,
  onSelectDatePreset,
  onToggleFileType,
}: {
  fileTypeOptions: FileTypeFilterOption[];
  filters: FileSystemFilter[];
  onOpenCustomRange: (type: FileSystemDateFilterType) => void;
  onSelectDatePreset: (type: FileSystemDateFilterType, preset: string) => void;
  onToggleFileType: (mime: string, checked: boolean) => void;
}) {
  const fileTypeFilter = filters.find((filter) => filter.type === "fileType");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Filter"
            title="Filter"
            className="relative size-7 sm:size-7"
          >
            <Filter className="size-4" />
            {filters.length > 0 ? (
              <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
            ) : null}
          </Button>
        }
      ></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FileArchiveIcon className="size-4 text-muted-foreground" />
            File type
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <FileSystemFileTypeCommand
              checkedMimes={fileTypeFilter?.value ?? []}
              onToggle={onToggleFileType}
              options={fileTypeOptions}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {(["dateModified", "dateCreated"] as const).map((type) => (
          <DropdownMenuSub key={type}>
            <DropdownMenuSubTrigger>
              <Calendar className="size-4 text-muted-foreground" />
              {FILTER_TYPE_LABELS[type]}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <InlineScrollArea2
                orientation="vertical"
                className="h-auto max-h-72"
              >
                {DATE_FILTER_PRESETS.map((preset) => (
                  <DropdownMenuItem
                    key={preset}
                    onClick={() => onSelectDatePreset(type, preset)}
                  >
                    {preset}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onClick={() => onOpenCustomRange(type)}>
                  Custom date range…
                </DropdownMenuItem>
              </InlineScrollArea2>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
const FILTER_PILL_SEGMENT_CLASSNAME =
  "flex h-5 items-center gap-1 border border-l-0 bg-background px-1.5 whitespace-nowrap text-foreground";
const FILTER_PILL_BUTTON_CLASSNAME = cn(
  FILTER_PILL_SEGMENT_CLASSNAME,
  "transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
);
function FileSystemFilterPill({
  fileTypeOptions,
  filter,
  onOpenCustomRange,
  onOperatorChange,
  onRemove,
  onSelectDatePreset,
  onToggleFileType,
}: {
  fileTypeOptions: FileTypeFilterOption[];
  filter: FileSystemFilter;
  onOpenCustomRange?: () => void;
  onOperatorChange: (operator: FileSystemFilterOperator) => void;
  onRemove: () => void;
  onSelectDatePreset: (preset: string) => void;
  onToggleFileType: (mime: string, checked: boolean) => void;
}) {
  const isCustomRange =
    filter.type !== "fileType" && isCustomDateRangeValue(filter.value);
  const selectedTypeLabels =
    filter.type === "fileType"
      ? filter.value.map(
          (mime) =>
            fileTypeOptions.find((option) => option.mime === mime)?.label ??
            mime,
        )
      : [];
  return (
    <div className="flex items-center text-xs">
      <span
        className={cn(FILTER_PILL_SEGMENT_CLASSNAME, "rounded-l-md border-l")}
      >
        {filter.type === "fileType" ? (
          <File01Glyph className="size-3" />
        ) : (
          <Calendar03Glyph className="size-3" />
        )}
        {FILTER_TYPE_LABELS[filter.type]}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button type="button" className={FILTER_PILL_BUTTON_CLASSNAME}>
              {FILTER_OPERATOR_LABELS[filter.operator]}
            </button>
          }
        ></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-28">
          {filterOperatorChoices(filter).map((operator) => (
            <DropdownMenuItem
              key={operator}
              onClick={() => onOperatorChange(operator)}
            >
              {FILTER_OPERATOR_LABELS[operator]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {filter.type === "fileType" ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                title={selectedTypeLabels.join(", ")}
                className={FILTER_PILL_BUTTON_CLASSNAME}
              >
                {filter.value.length === 1
                  ? selectedTypeLabels[0]
                  : `${filter.value.length} selected`}
              </button>
            }
          ></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <FileSystemFileTypeCommand
              checkedMimes={filter.value}
              onToggle={onToggleFileType}
              options={fileTypeOptions}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : isCustomRange ? (
        <button
          type="button"
          onClick={onOpenCustomRange}
          className={FILTER_PILL_BUTTON_CLASSNAME}
        >
          {filter.value
            .map((value) => new Date(value).toLocaleDateString("en-US"))
            .join(" – ")}
        </button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className={FILTER_PILL_BUTTON_CLASSNAME}>
                {filter.value[0]}
              </button>
            }
          ></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <InlineScrollArea2
              orientation="vertical"
              className="h-auto max-h-72"
            >
              {DATE_FILTER_PRESETS.map((preset) => (
                <DropdownMenuItem
                  key={preset}
                  onClick={() => onSelectDatePreset(preset)}
                >
                  {preset}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={onOpenCustomRange}>
                Custom date range…
              </DropdownMenuItem>
            </InlineScrollArea2>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        type="button"
        aria-label={`Remove ${FILTER_TYPE_LABELS[filter.type]} filter`}
        onClick={onRemove}
        className={cn(
          FILTER_PILL_BUTTON_CLASSNAME,
          "rounded-r-md px-1 text-muted-foreground hover:text-foreground",
        )}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
function formatDateInputValue(date: Date | undefined) {
  if (!date) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function parseDateInputValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const date = new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
    );
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}
const DATE_RANGE_DIALOG_PRESETS = [
  "Last 7 days",
  "This month",
  "Last 1 month",
  "Last 3 months",
  "This year",
  "Last 12 months",
];
function dateRangePresetRange(preset: string) {
  const from = new Date();
  const to = new Date();
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  switch (preset) {
    case "Last 7 days":
      from.setDate(from.getDate() - 6);
      break;
    case "This month":
      from.setDate(1);
      break;
    case "Last 1 month":
      from.setMonth(from.getMonth() - 1);
      break;
    case "Last 3 months":
      from.setMonth(from.getMonth() - 3);
      break;
    case "This year":
      from.setMonth(0, 1);
      break;
    case "Last 12 months":
      from.setFullYear(from.getFullYear() - 1);
      break;
  }
  return { from, to };
}
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
function calendarDayKey(date: Date) {
  return date.getFullYear() * 10000 + date.getMonth() * 100 + date.getDate();
}
function FileSystemRangeCalendar({
  onSelect,
  range,
}: {
  onSelect: (range: { from?: Date; to?: Date }) => void;
  range: {
    from?: Date;
    to?: Date;
  };
}) {
  const [viewMonth, setViewMonth] = React.useState(() => {
    const base = range.from ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const months = [
    viewMonth,
    new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1),
  ];
  const fromKey = range.from ? calendarDayKey(range.from) : null;
  const toKey = range.to ? calendarDayKey(range.to) : null;
  const todayKey = calendarDayKey(new Date());
  const handleDayClick = (day: Date) => {
    if (!range.from || range.to) {
      onSelect({ from: day });
    } else if (calendarDayKey(day) < calendarDayKey(range.from)) {
      onSelect({ from: day, to: range.from });
    } else {
      onSelect({ from: range.from, to: day });
    }
  };
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() =>
          setViewMonth(
            (previous) =>
              new Date(previous.getFullYear(), previous.getMonth() - 1, 1),
          )
        }
        className="absolute top-0 left-0 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Next month"
        onClick={() =>
          setViewMonth(
            (previous) =>
              new Date(previous.getFullYear(), previous.getMonth() + 1, 1),
          )
        }
        className="absolute top-0 right-0 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowRight className="size-4" />
      </button>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {months.map((month, monthIndex) => {
          const firstWeekday = month.getDay();
          const dayCount = new Date(
            month.getFullYear(),
            month.getMonth() + 1,
            0,
          ).getDate();
          const cells = [
            ...Array.from({ length: firstWeekday }, () => null),
            ...Array.from(
              { length: dayCount },
              (_, index) =>
                new Date(month.getFullYear(), month.getMonth(), index + 1),
            ),
          ];
          return (
            <div
              key={`${month.getFullYear()}-${month.getMonth()}`}
              className={cn(monthIndex === 1 && "max-sm:hidden")}
            >
              <div className="text-center text-sm leading-6 font-medium">
                {month.toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <div className="mt-1 grid grid-cols-7 text-center text-xs text-muted-foreground">
                {WEEKDAY_LABELS.map((weekday) => (
                  <span key={weekday} className="h-6 leading-6">
                    {weekday}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-px">
                {cells.map((day, cellIndex) => {
                  if (!day) return <span key={cellIndex} />;
                  const dayKey = calendarDayKey(day);
                  const isFrom = dayKey === fromKey;
                  const isTo = dayKey === toKey;
                  const isWithinRange =
                    fromKey !== null &&
                    toKey !== null &&
                    dayKey > fromKey &&
                    dayKey < toKey;
                  return (
                    <button
                      key={cellIndex}
                      type="button"
                      onClick={() => handleDayClick(day)}
                      className={cn(
                        "flex h-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                        isWithinRange && "rounded-none bg-accent",
                        (isFrom || isTo) &&
                          "bg-primary text-primary-foreground hover:bg-primary",
                        isFrom &&
                          toKey !== null &&
                          fromKey !== toKey &&
                          "rounded-r-none",
                        isTo && fromKey !== toKey && "rounded-l-none",
                        dayKey === todayKey &&
                          !isFrom &&
                          !isTo &&
                          "font-semibold text-primary",
                      )}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
function FileSystemDateRangeDialog({
  initialRange,
  onApply,
  onClose,
}: {
  initialRange?: {
    from: Date;
    to: Date;
  };
  onApply: (from: Date, to: Date) => void;
  onClose: () => void;
}) {
  const [range, setRange] = React.useState<{
    from?: Date;
    to?: Date;
  }>(() => initialRange ?? {});
  const [fromInput, setFromInput] = React.useState(() =>
    formatDateInputValue(initialRange?.from),
  );
  const [toInput, setToInput] = React.useState(() =>
    formatDateInputValue(initialRange?.to),
  );
  const selectRange = (next: { from?: Date; to?: Date }) => {
    setRange(next);
    if (next.from) setFromInput(formatDateInputValue(next.from));
    if (next.to) setToInput(formatDateInputValue(next.to));
  };
  const dateField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
  ) => (
    <div className="flex flex-1 flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      <div className="relative flex items-center">
        <Calendar className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
        <Input
          type="text"
          value={value}
          placeholder="YYYY-MM-DD"
          aria-label={`${label} date`}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 pl-8 sm:h-8"
        />
      </div>
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[30rem] max-w-[calc(100vw-2rem)]">
        <DialogHeader>
          <DialogTitle>Custom date range</DialogTitle>
        </DialogHeader>
        <InlineDialogPanel className="flex flex-col gap-4 px-6 pt-1 pb-6">
          <div className="flex gap-3">
            {dateField("From", fromInput, (value) => {
              setFromInput(value);
              const parsed = parseDateInputValue(value);
              if (parsed)
                setRange((previous) => ({ ...previous, from: parsed }));
            })}
            {dateField("To", toInput, (value) => {
              setToInput(value);
              const parsed = parseDateInputValue(value);
              if (parsed) setRange((previous) => ({ ...previous, to: parsed }));
            })}
          </div>
          <FileSystemRangeCalendar range={range} onSelect={selectRange} />
          <div className="grid grid-cols-3 gap-2">
            {DATE_RANGE_DIALOG_PRESETS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => selectRange(dateRangePresetRange(preset))}
              >
                {preset}
              </Button>
            ))}
          </div>
        </InlineDialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!range.from || !range.to}
            onClick={() => {
              if (!range.from || !range.to) return;
              const from = new Date(range.from);
              const to = new Date(range.to);
              from.setHours(0, 0, 0, 0);
              to.setHours(23, 59, 59, 999);
              onApply(from, to);
            }}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
type FileSystemViewProps = {
  currentPath: string;
  entries: FileSystemEntry[];
  fileFilter: ((file: FileEntry) => boolean) | null;
  getFileUrl?: (file: FileSystemFileItem) => string | Promise<string>;
  index: FileSystemIndex;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    pageIndex: number,
  ) => Promise<string | null>;
  loadingFolders: Set<string>;
  onOpen: (entry: FileSystemEntry) => void;
  onSelect: (
    entry: FileSystemEntry | null,
    event?: React.MouseEvent,
    orderedEntries?: FileSystemEntry[],
  ) => void;
  onSortColumnClick: (key: FileSystemSortKey) => void;
  attachedStagePaths: string[];
  pageUrlCache: Map<string, string>;
  poolStagePath: (path: string) => void;
  registerStageHost: (path: string, element: HTMLElement | null) => void;
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
  searchQuery: string;
  selectedEntry: FileSystemEntry | null;
  selectedPath: string | null;
  selectedPaths: Set<string>;
  onSelectEntries: (
    entries: FileSystemEntry[],
    focused?: FileSystemEntry | null,
  ) => void;
  sort: FileSystemSortState;
  treeExpansionRef: React.RefObject<Map<string, readonly string[]>>;
};
function useResolvedFileUrl(
  file: FileEntry | null,
  getFileUrl?: (file: FileSystemFileItem) => string | Promise<string>,
  cache?: Map<string, string>,
) {
  const [state, setState] = React.useState<{
    isResolving: boolean;
    url: string | null;
  }>(() => ({
    isResolving: false,
    url: file ? (file.url ?? cache?.get(file.path) ?? null) : null,
  }));
  const fileRef = React.useRef(file);
  React.useEffect(() => {
    fileRef.current = file;
  });
  const filePath = file?.path ?? null;
  const fileUrl = file?.url ?? null;
  React.useEffect(() => {
    const currentFile = fileRef.current;
    const knownUrl =
      fileUrl ?? (filePath ? (cache?.get(filePath) ?? null) : null);
    if (!currentFile || knownUrl || !getFileUrl) {
      setState({ isResolving: false, url: knownUrl });
      return;
    }
    let isCurrent = true;
    setState({ isResolving: true, url: null });
    void Promise.resolve(getFileUrl(currentFile))
      .then((url) => {
        if (url) cache?.set(currentFile.path, url);
        if (isCurrent) setState({ isResolving: false, url });
      })
      .catch(() => {
        if (isCurrent) setState({ isResolving: false, url: null });
      });
    return () => {
      isCurrent = false;
    };
  }, [cache, filePath, fileUrl, getFileUrl]);
  return state;
}
function useSettledValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = React.useState(value);
  React.useEffect(() => {
    if (Object.is(settled, value)) return;
    const timeout = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, settled, value]);
  return settled;
}
function FileSystemEmptyState({
  label,
  isLoading = false,
}: {
  label: string;
  isLoading?: boolean;
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2.5 text-sm text-muted-foreground">
      {isLoading ? <BoxLoader label={label} /> : null}
      {isLoading ? null : label}
    </div>
  );
}
const ARROW_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"]);
const TYPE_AHEAD_RESET_MS = 700;
function isTypeAheadKey(event: React.KeyboardEvent) {
  return (
    event.key.length === 1 &&
    /^[\p{L}\p{N}]$/u.test(event.key) &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}
function useEntryTypeAhead() {
  const stateRef = React.useRef({ buffer: "", timeout: 0 });
  React.useEffect(() => {
    const state = stateRef.current;
    return () => window.clearTimeout(state.timeout);
  }, []);
  return React.useCallback(
    (
      event: React.KeyboardEvent,
      entries: readonly FileSystemEntry[],
      currentIndex: number,
    ) => {
      if (!isTypeAheadKey(event) || entries.length === 0) return null;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return null;
      }
      const state = stateRef.current;
      window.clearTimeout(state.timeout);
      state.timeout = window.setTimeout(() => {
        state.buffer = "";
      }, TYPE_AHEAD_RESET_MS);
      state.buffer += event.key.toLowerCase();
      const startIndex =
        currentIndex < 0
          ? 0
          : currentIndex + (state.buffer.length === 1 ? 1 : 0);
      for (let step = 0; step < entries.length; step += 1) {
        const entry = entries[(startIndex + step) % entries.length];
        if (entry.name.toLowerCase().startsWith(state.buffer)) {
          event.preventDefault();
          return entry;
        }
      }
      event.preventDefault();
      return null;
    },
    [],
  );
}
function moveGridSelection({
  entries,
  itemRefs,
  key,
  onSelect,
  selectedPath,
}: {
  entries: FileSystemEntry[];
  itemRefs: Map<string, HTMLButtonElement>;
  key: string;
  onSelect: (
    entry: FileSystemEntry | null,
    event?: React.MouseEvent,
    orderedEntries?: FileSystemEntry[],
  ) => void;
  selectedPath: string | null;
}) {
  if (entries.length === 0) return false;
  const currentIndex = entries.findIndex(
    (entry) => entry.path === selectedPath,
  );
  let nextEntry: FileSystemEntry | undefined;
  if (currentIndex === -1) {
    nextEntry = entries[0];
  } else if (key === "ArrowLeft" || key === "ArrowRight") {
    nextEntry = entries[currentIndex + (key === "ArrowLeft" ? -1 : 1)];
  } else {
    const currentElement = itemRefs.get(entries[currentIndex].path);
    if (!currentElement) return false;
    const currentRect = currentElement.getBoundingClientRect();
    let bestScore = Infinity;
    for (const entry of entries) {
      if (entry.path === selectedPath) continue;
      const rect = itemRefs.get(entry.path)?.getBoundingClientRect();
      if (!rect) continue;
      const rowDelta =
        key === "ArrowDown"
          ? rect.top - currentRect.top
          : currentRect.top - rect.top;
      if (rowDelta <= 1) continue;
      const score = rowDelta * 1000 + Math.abs(rect.left - currentRect.left);
      if (score < bestScore) {
        bestScore = score;
        nextEntry = entry;
      }
    }
  }
  if (!nextEntry) return false;
  onSelect(nextEntry);
  itemRefs.get(nextEntry.path)?.focus();
  return true;
}
const ICON_GRID_PADDING = 12;
const ICON_MIN_TILE_WIDTH = 104;
const ICON_TILE_GAP_X = 4;
const ICON_TILE_HEIGHT = 102;
const ICON_ROW_GAP = 12;
const ICON_ROW_STRIDE = ICON_TILE_HEIGHT + ICON_ROW_GAP;
function FileSystemIconsView({
  entries,
  loadPreviewImageUrl,
  pageUrlCache,
  onOpen,
  onSelect,
  renderFilePreview,
  selectedPath,
  selectedPaths,
  onSelectEntries,
}: FileSystemViewProps) {
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const [selectionBox, setSelectionBox] = React.useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const drag = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    clientX: number;
    clientY: number;
    original: Set<string>;
    additive: boolean;
    moved: boolean;
  } | null>(null);
  const suppressClick = React.useRef(false);
  const scrollFrame = React.useRef<number | undefined>(undefined);
  React.useEffect(
    () => () => {
      if (scrollFrame.current !== undefined)
        cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );
  const typeAhead = useEntryTypeAhead();
  const [gridScale, setGridScale] = React.useState(1);
  const [columnCount, setColumnCount] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const scale =
        (parseFloat(getComputedStyle(document.documentElement).fontSize) ||
          16) / 16;
      setGridScale(scale);
      const available = viewport.clientWidth - ICON_GRID_PADDING * scale * 2;
      setColumnCount(
        Math.max(
          1,
          Math.floor(
            (available + ICON_TILE_GAP_X * scale) /
              ((ICON_MIN_TILE_WIDTH + ICON_TILE_GAP_X) * scale),
          ),
        ),
      );
    };
    const observer = new ResizeObserver(update);
    update();
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const resolvedColumnCount = columnCount ?? 1;
  const rowCount = Math.ceil(entries.length / resolvedColumnCount);
  const { end, start } = useVirtualWindow({
    count: rowCount,
    itemStride: ICON_ROW_STRIDE * gridScale,
    leadingPx: ICON_GRID_PADDING * gridScale,
    overscan: 4,
    viewportRef,
  });
  const visibleEntries = entries.slice(
    start * resolvedColumnCount,
    end * resolvedColumnCount,
  );
  React.useLayoutEffect(() => {
    if (!selectedPath || drag.current) return;
    const entryIndex = entries.findIndex(
      (entry) => entry.path === selectedPath,
    );
    if (entryIndex === -1) return;
    scrollIndexIntoView({
      index: Math.floor(entryIndex / resolvedColumnCount),
      itemSize: ICON_TILE_HEIGHT * gridScale,
      itemStride: ICON_ROW_STRIDE * gridScale,
      leadingPx: ICON_GRID_PADDING * gridScale,
      viewport: viewportRef.current,
    });
  }, [entries, gridScale, resolvedColumnCount, selectedPath]);
  const updateDragSelection = () => {
    const viewport = viewportRef.current;
    const active = drag.current;
    if (!viewport || !active) return;
    const bounds = viewport.getBoundingClientRect();
    const x =
      Math.max(
        0,
        Math.min(viewport.clientWidth, active.clientX - bounds.left),
      ) + viewport.scrollLeft;
    const y =
      Math.max(
        0,
        Math.min(viewport.clientHeight, active.clientY - bounds.top),
      ) + viewport.scrollTop;
    if (!active.moved && Math.hypot(x - active.startX, y - active.startY) < 3)
      return;
    active.moved = true;
    const left = Math.min(active.startX, x);
    const top = Math.min(active.startY, y);
    const right = Math.max(active.startX, x);
    const bottom = Math.max(active.startY, y);
    const width = viewport.clientWidth - ICON_GRID_PADDING * gridScale * 2;
    const tileWidth =
      (width - (resolvedColumnCount - 1) * (ICON_TILE_GAP_X * gridScale)) /
      resolvedColumnCount;
    const selected = entries.filter((entry, index) => {
      const tileLeft =
        ICON_GRID_PADDING * gridScale +
        (index % resolvedColumnCount) *
          (tileWidth + ICON_TILE_GAP_X * gridScale);
      const tileTop =
        ICON_GRID_PADDING * gridScale +
        Math.floor(index / resolvedColumnCount) * (ICON_ROW_STRIDE * gridScale);
      const hit =
        tileLeft < right &&
        tileLeft + tileWidth > left &&
        tileTop < bottom &&
        tileTop + ICON_TILE_HEIGHT * gridScale > top;
      return hit || (active.additive && active.original.has(entry.path));
    });
    onSelectEntries(selected);
    setSelectionBox({
      left: left - ICON_GRID_PADDING * gridScale,
      top: top - ICON_GRID_PADDING * gridScale,
      width: right - left,
      height: bottom - top,
    });
  };
  const finishDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    cancelled = false,
  ) => {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    if (cancelled)
      onSelectEntries(
        entries.filter((entry) => active.original.has(entry.path)),
      );
    suppressClick.current = active.moved;
    drag.current = null;
    setSelectionBox(null);
    if (scrollFrame.current !== undefined)
      cancelAnimationFrame(scrollFrame.current);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    requestAnimationFrame(() => {
      suppressClick.current = false;
    });
  };
  const tabStopPath = visibleEntries.some(
    (entry) => entry.path === selectedPath,
  )
    ? selectedPath
    : (visibleEntries[0]?.path ?? null);
  return (
    <InlineScrollArea2
      orientation="vertical"
      viewportRef={viewportRef}
      viewportClassName="p-3"
      viewportProps={{
        onPointerDown: (event) => {
          if (
            event.button !== 0 ||
            event.pointerType === "touch" ||
            (event.target as HTMLElement).closest(
              "[data-entry-path], button, input, [role=scrollbar]",
            )
          )
            return;
          const viewport = event.currentTarget;
          const bounds = viewport.getBoundingClientRect();
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX - bounds.left + viewport.scrollLeft,
            startY: event.clientY - bounds.top + viewport.scrollTop,
            clientX: event.clientX,
            clientY: event.clientY,
            original: new Set(selectedPaths),
            additive: event.metaKey || event.ctrlKey || event.shiftKey,
            moved: false,
          };
          viewport.setPointerCapture?.(event.pointerId);
          event.preventDefault();
          const scroll = () => {
            const active = drag.current;
            if (!active) return;
            const bounds = viewport.getBoundingClientRect();
            const velocity =
              active.clientY < bounds.top + 28
                ? -Math.min(18, (bounds.top + 28 - active.clientY) / 3)
                : active.clientY > bounds.bottom - 28
                  ? Math.min(18, (active.clientY - bounds.bottom + 28) / 3)
                  : 0;
            if (velocity && active.moved) {
              viewport.scrollTop += velocity;
              updateDragSelection();
            }
            scrollFrame.current = requestAnimationFrame(scroll);
          };
          scrollFrame.current = requestAnimationFrame(scroll);
        },
        onPointerMove: (event) => {
          if (!drag.current || drag.current.pointerId !== event.pointerId)
            return;
          drag.current.clientX = event.clientX;
          drag.current.clientY = event.clientY;
          updateDragSelection();
        },
        onPointerUp: (event) => finishDrag(event),
        onPointerCancel: (event) => finishDrag(event, true),
        onLostPointerCapture: (event) => finishDrag(event, true),
        onScroll: () => {
          if (drag.current) updateDragSelection();
        },
        onClickCapture: (event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        },
        onClick: (event) => {
          if (!(event.target as HTMLElement).closest("[data-entry-path]"))
            onSelect(null);
        },
      }}
    >
      <div
        className="relative"
        style={{
          height:
            columnCount !== null && rowCount
              ? rowCount * (ICON_ROW_STRIDE * gridScale) -
                ICON_ROW_GAP * gridScale
              : undefined,
        }}
      >
        {selectionBox && (
          <div
            aria-hidden="true"
            data-slot="selection-marquee"
            className="pointer-events-none absolute z-20 rounded-sm border border-primary/60 bg-primary/12"
            style={selectionBox}
          />
        )}
        <div
          role="listbox"
          aria-label="Files"
          aria-multiselectable="true"
          className="absolute inset-x-0 grid gap-x-1 gap-y-3"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(6.5rem, 1fr))",
            top: start * (ICON_ROW_STRIDE * gridScale),
          }}
          onKeyDown={(event) => {
            if (!ARROW_KEYS.has(event.key)) {
              const match = typeAhead(
                event,
                entries,
                entries.findIndex((entry) => entry.path === selectedPath),
              );
              if (match) {
                onSelect(match);
                requestAnimationFrame(() =>
                  itemRefs.current.get(match.path)?.focus(),
                );
              }
              return;
            }
            if (
              moveGridSelection({
                entries,
                itemRefs: itemRefs.current,
                key: event.key,
                onSelect,
                selectedPath,
              })
            ) {
              event.preventDefault();
            }
          }}
        >
          {visibleEntries.map((entry) => {
            const isSelected = selectedPaths.has(entry.path);
            return (
              <button
                key={entry.path}
                data-entry-path={entry.path}
                type="button"
                role="option"
                aria-label={entry.name}
                aria-selected={isSelected}
                tabIndex={entry.path === tabStopPath ? 0 : -1}
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(entry.path, element);
                  } else {
                    itemRefs.current.delete(entry.path);
                  }
                }}
                onClick={(event) => onSelect(entry, event, entries)}
                onDoubleClick={() => onOpen(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpen(entry);
                }}
                className="group flex h-[6.375rem] flex-col items-center gap-1.5 outline-none"
              >
                <span
                  className={cn(
                    "flex h-16 w-20 shrink-0 items-center justify-center rounded-lg p-1.5 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring",
                    isSelected && "bg-accent",
                  )}
                >
                  {entry.kind === "folder" ? (
                    <FileSystemFolderGlyph className="h-13 w-auto drop-shadow-sm" />
                  ) : (
                    <span
                      className="block shrink-0"
                      style={{
                        width: `min(4.25rem, calc((3.25rem - 2px) * ${entry.previewAspectRatio ?? 0.78} + 2px))`,
                      }}
                    >
                      <FileVisual
                        file={entry}
                        loadPreviewImageUrl={loadPreviewImageUrl}
                        pageUrlCache={pageUrlCache}
                        className="w-full rounded-sm shadow-xs"
                        previewAspectRatio={0.78}
                        renderFilePreview={renderFilePreview}
                      />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "max-w-full rounded-sm px-1.5 py-px text-center text-xs leading-tight break-words",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground",
                  )}
                >
                  <span className="block truncate" title={entry.name}>
                    {entry.name}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </InlineScrollArea2>
  );
}
function FileSystemListColumnHeader({
  className,
  label,
  onClick,
  sort,
  sortKey,
}: {
  className?: string;
  label: string;
  onClick: (key: FileSystemSortKey) => void;
  sort: FileSystemSortState;
  sortKey: FileSystemSortKey;
}) {
  const isActive = sort.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={cn(
        "flex items-center gap-0.5 rounded-sm py-0.5 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        isActive && "text-foreground",
        className,
      )}
    >
      {label}
      {isActive ? (
        sort.direction === "asc" ? (
          <ArrowUp01Glyph className="size-3 shrink-0" />
        ) : (
          <ArrowDown01Glyph className="size-3 shrink-0" />
        )
      ) : null}
    </button>
  );
}
function FileSystemListView({
  currentPath,
  fileFilter,
  index,
  loadPreviewImageUrl,
  pageUrlCache,
  onOpen,
  onSelect,
  onSortColumnClick,
  searchQuery,
  selectedPath,
  selectedPaths,
  onSelectEntries,
  sort,
  treeExpansionRef,
}: FileSystemViewProps) {
  const relativePaths = React.useMemo(() => {
    const paths: string[] = [];
    if (!fileFilter) {
      for (const path of index.folders.keys()) {
        if (path.startsWith(currentPath) && path !== currentPath)
          paths.push(path.slice(currentPath.length));
      }
    }
    for (const [path, file] of index.files) {
      if (currentPath === "" || path.startsWith(currentPath)) {
        const relativePath = path.slice(currentPath.length);
        if (!relativePath) continue;
        if (fileFilter && !fileFilter(file)) continue;
        paths.push(relativePath);
      }
    }
    return paths.sort();
  }, [currentPath, fileFilter, index]);
  if (relativePaths.length === 0) {
    return (
      <FileSystemEmptyState
        label={
          fileFilter
            ? "No items match the active filters"
            : "This folder is empty"
        }
      />
    );
  }
  return (
    <div className="flex size-full flex-col">
      <div className="flex shrink-0 items-center border-b py-1 pr-6 pl-[46px] text-xs font-medium text-muted-foreground">
        <FileSystemListColumnHeader
          className="flex-1 justify-start"
          label="Name"
          onClick={onSortColumnClick}
          sort={sort}
          sortKey="name"
        />
        <FileSystemListColumnHeader
          className="w-44 justify-start"
          label="Date Modified"
          onClick={onSortColumnClick}
          sort={sort}
          sortKey="updatedAt"
        />
        <FileSystemListColumnHeader
          className="w-20 justify-start"
          label="Size"
          onClick={onSortColumnClick}
          sort={sort}
          sortKey="size"
        />
      </div>

      <FileSystemPierreTree
        key={currentPath}
        currentPath={currentPath}
        hasActiveFilters={fileFilter !== null}
        index={index}
        loadPreviewImageUrl={loadPreviewImageUrl}
        pageUrlCache={pageUrlCache}
        initialSelectedPath={
          selectedPath?.startsWith(currentPath)
            ? selectedPath.slice(currentPath.length).replace(/\/$/, "")
            : null
        }
        onOpen={onOpen}
        onSelect={onSelect}
        selectedPaths={selectedPaths}
        onSelectEntries={onSelectEntries}
        relativePaths={relativePaths}
        searchQuery={searchQuery}
        sort={sort}
        treeExpansionRef={treeExpansionRef}
      />
    </div>
  );
}
const TREE_THUMBNAIL_SPRITE_LIMIT = 400;
function FileSystemPierreTree({
  currentPath,
  hasActiveFilters,
  index,
  loadPreviewImageUrl,
  pageUrlCache,
  initialSelectedPath,
  onOpen,
  onSelect,
  selectedPaths,
  onSelectEntries,
  relativePaths,
  searchQuery,
  sort,
  treeExpansionRef,
}: {
  currentPath: string;
  hasActiveFilters: boolean;
  index: FileSystemIndex;
  loadPreviewImageUrl: FileSystemViewProps["loadPreviewImageUrl"];
  pageUrlCache: Map<string, string>;
  initialSelectedPath: string | null;
  onOpen: (entry: FileSystemEntry) => void;
  onSelect: (
    entry: FileSystemEntry | null,
    event?: React.MouseEvent,
    orderedEntries?: FileSystemEntry[],
  ) => void;
  selectedPaths: Set<string>;
  onSelectEntries: (
    entries: FileSystemEntry[],
    focused?: FileSystemEntry | null,
  ) => void;
  relativePaths: string[];
  searchQuery: string;
  sort: FileSystemSortState;
  treeExpansionRef: React.RefObject<Map<string, readonly string[]>>;
}) {
  const indexFiles = index.files;
  const indexFolders = index.folders;
  const treeId = React.useId();
  const [covers, setCovers] = React.useState<Record<string, string>>({});
  const requestedCovers = React.useRef(new Set<string>());
  const sortComparator = React.useMemo<
    "default" | FileTreeSortComparator
  >(() => {
    if (
      sort.key === DEFAULT_SORT.key &&
      sort.direction === DEFAULT_SORT.direction
    ) {
      return "default";
    }
    const entryAtDepth = (sortEntry: FileTreeSortEntry, depth: number) => {
      const isDirectory =
        depth < sortEntry.segments.length - 1 || sortEntry.isDirectory;
      const absolutePath = `${currentPath}${sortEntry.segments
        .slice(0, depth + 1)
        .join("/")}${isDirectory ? "/" : ""}`;
      return isDirectory
        ? indexFolders.get(absolutePath)
        : indexFiles.get(absolutePath);
    };
    return (left, right) => {
      const sharedDepth = Math.min(left.segments.length, right.segments.length);
      for (let depth = 0; depth < sharedDepth; depth += 1) {
        if (left.segments[depth] === right.segments[depth]) continue;
        const leftIsDirectory =
          depth < left.segments.length - 1 || left.isDirectory;
        const rightIsDirectory =
          depth < right.segments.length - 1 || right.isDirectory;
        if (leftIsDirectory !== rightIsDirectory) {
          return leftIsDirectory ? -1 : 1;
        }
        const leftEntry = entryAtDepth(left, depth);
        const rightEntry = entryAtDepth(right, depth);
        if (leftEntry && rightEntry) {
          return compareEntriesBySort(leftEntry, rightEntry, sort);
        }
        return left.segments[depth] < right.segments[depth] ? -1 : 1;
      }
      return left.segments.length - right.segments.length;
    };
  }, [currentPath, indexFiles, indexFolders, sort]);
  const preparedInput = React.useMemo(
    () => prepareFileTreeInput(relativePaths, { sort: sortComparator }),
    [relativePaths, sortComparator],
  );
  const icons = React.useMemo(() => {
    const byFileName: Record<
      string,
      {
        name: string;
        viewBox: string;
      }
    > = {};
    const symbols: string[] = [MICRO_FILE_SYMBOLS];
    let thumbnailCount = 0;
    for (const relativePath of relativePaths) {
      const file = index.files.get(`${currentPath}${relativePath}`);
      const coverUrl = file
        ? (filePreviewUrls(file)[0] ??
          covers[file.path] ??
          pageUrlCache.get(`${file.path}#0`))
        : undefined;
      if (!file) continue;
      const baseName = file.name.toLowerCase();
      if (byFileName[baseName]) continue;
      byFileName[baseName] = resolveFileIcon("file", file.name);
      if (!coverUrl || thumbnailCount >= TREE_THUMBNAIL_SPRITE_LIMIT) continue;
      const symbolId = `file-system-thumbnail-${symbols.length}`;
      symbols.push(
        `<symbol id="${symbolId}" viewBox="0 0 16 16"><clipPath id="${symbolId}-clip"><rect width="16" height="16" rx="2.5"/></clipPath><image href="${escapeXmlAttribute(coverUrl)}" width="16" height="16" preserveAspectRatio="xMidYMid slice" clip-path="url(#${symbolId}-clip)"/></symbol>`,
      );
      byFileName[baseName] = { name: symbolId, viewBox: "0 0 16 16" };
      thumbnailCount += 1;
    }
    return {
      byFileName,
      colored: true,
      remap: {
        "file-tree-icon-file": {
          name: "micro-file-content",
          viewBox: "0 0 20 20",
        },
        "file-tree-icon-directory": {
          name: "micro-folder",
          viewBox: "0 0 20 20",
        },
        "file-tree-icon-directory-open": {
          name: "micro-folder",
          viewBox: "0 0 20 20",
        },
        "file-tree-icon-chevron": {
          name: "micro-chevron-down",
          viewBox: "0 0 20 20",
        },
      },
      set: "complete" as const,
      spriteSheet: `<svg data-icon-sprite aria-hidden="true" width="0" height="0">${symbols.join("")}</svg>`,
    };
  }, [currentPath, index, relativePaths, covers, pageUrlCache]);
  const syncingSelection = React.useRef(false);
  const { model } = useFileTree({
    flattenEmptyDirectories: false,
    icons,
    initialExpansion: "closed",
    initialSearchQuery: searchQuery || null,
    initialSelectedPaths: initialSelectedPath ? [initialSelectedPath] : [],
    itemHeight: 28,
    overscan: 12,
    preparedInput,
    renderRowDecoration: ({ row }) => {
      const entry =
        row.kind === "file"
          ? index.files.get(`${currentPath}${row.path}`)
          : index.folders.get(normalizeFolderPath(`${currentPath}${row.path}`));
      if (!entry) return null;
      const dateColumn =
        formatTimestamp(entry.updatedAt ?? entry.createdAt) ?? "—";
      if (entry.kind === "folder") {
        const childCount = index.children.get(entry.path)?.length;
        return {
          text:
            childCount === undefined
              ? "—"
              : `${childCount} ${childCount === 1 ? "item" : "items"}`,
          title: dateColumn,
        };
      }
      return { text: formatByteSize(entry.size) ?? "—", title: dateColumn };
    },
    unsafeCSS: `
      svg[data-icon-name] {
        width: 14px;
        height: 14px;
      }
      button[data-type='item']:not([data-item-selected]):hover {
        background: color-mix(in oklab, var(--color-accent) 50%, transparent);
      }
      button[data-type='item'][data-item-selected] {
        background: var(--color-primary);
        color: var(--color-primary-foreground);
        /* The primary surface is the opposite of the mode's background, so
           the row's light-dark() icon colors resolve against the opposite
           scheme — light-palette icons on the light pill in dark mode and
           vice versa. */
        color-scheme: var(--fs-selected-color-scheme, normal);
      }
      button[data-type='item'][data-item-selected] *:not([data-icon-token]):not([data-icon-token] *),
      button[data-type='item'][data-item-selected] [data-item-section]::before {
        color: var(--color-primary-foreground) !important;
      }
      [data-item-section='decoration'] > span {
        display: grid;
        grid-template-columns: 11rem 5rem;
        white-space: nowrap;
        /* The size cell is the span's anonymous text item, so alignment
           rides on text-align: the span's right applies to it while the
           date cell (::before) overrides back to left. */
        text-align: right;
      }
      [data-item-section='decoration'] > span::before {
        content: attr(title);
        text-align: left;
      }
      button[data-type='item'][data-item-type='folder'] [data-item-section='content'] {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      button[data-type='item'][data-item-type='folder'] [data-item-section='content']::before {
        content: "";
        flex: none;
        width: 14px;
        height: 14px;
        margin-right: 4px;
        background: currentColor;
        mask: url("${FOLDER_ICON_DATA_URL}") center / contain no-repeat;
      }
    `,
    onSelectionChange: (paths) => {
      if (syncingSelection.current) return;
      const entries = paths.flatMap((path) => {
        const full = `${currentPath}${path}`;
        const item =
          index.files.get(full) ?? index.folders.get(normalizeFolderPath(full));
        return item ? [item] : [];
      });
      const focus = model.getFocusedPath();
      onSelectEntries(
        entries,
        entries.find(
          (entry) =>
            entry.path.replace(/\/$/, "") ===
            `${currentPath}${focus}`.replace(/\/$/, ""),
        ),
      );
    },
  });
  React.useEffect(() => {
    const container =
      model.getFileTreeContainer() ?? document.getElementById(treeId);
    const shadow = container?.shadowRoot;
    if (!container || !shadow || !loadPreviewImageUrl) return;
    let active = true;
    const loadCover = (row: Element) => {
      const path = row.getAttribute("data-item-path");
      if (!path) return;
      const file = indexFiles.get(`${currentPath}${path}`);
      if (
        !file ||
        !file.previewPageCount ||
        filePreviewUrls(file)[0] ||
        pageUrlCache.has(`${file.path}#0`) ||
        requestedCovers.current.has(file.path) ||
        requestedCovers.current.size >= TREE_THUMBNAIL_SPRITE_LIMIT
      )
        return;
      requestedCovers.current.add(file.path);
      void loadPreviewImageUrl(file, 0)
        .then((url) => {
          if (!url) return;
          pageUrlCache.set(`${file.path}#0`, url);
          if (active)
            setCovers((current) => ({ ...current, [file.path]: url }));
        })
        .catch(() => {});
    };
    const observed = new WeakSet<Element>();
    const visible = new WeakSet<Element>();
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) {
                  visible.add(entry.target);
                  loadCover(entry.target);
                } else visible.delete(entry.target);
              }
            },
            { root: container },
          );
    const scan = () => {
      for (const row of shadow.querySelectorAll("[data-item-path]")) {
        if (!observer || visible.has(row)) loadCover(row);
        if (observer && !observed.has(row)) {
          observed.add(row);
          observer.observe(row);
        }
      }
    };
    const mutations = new MutationObserver(scan);
    mutations.observe(shadow, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-item-path"],
    });
    scan();
    return () => {
      active = false;
      mutations.disconnect();
      observer?.disconnect();
    };
  }, [currentPath, indexFiles, loadPreviewImageUrl, model, pageUrlCache, treeId]);
  React.useEffect(() => {
    model.setIcons(icons);
  }, [icons, model]);
  const collectExpandedDirectories = React.useCallback(
    (paths: readonly string[]) => {
      const expandedPaths: string[] = [];
      for (const directoryPath of directoryPathsOf(paths)) {
        const item =
          model.getItem(directoryPath) ?? model.getItem(`${directoryPath}/`);
        if (item && "isExpanded" in item && item.isExpanded()) {
          expandedPaths.push(directoryPath);
        }
      }
      return expandedPaths;
    },
    [model],
  );
  const expandDirectories = React.useCallback(
    (directoryPaths: Iterable<string>) => {
      for (const directoryPath of directoryPaths) {
        const item =
          model.getItem(directoryPath) ?? model.getItem(`${directoryPath}/`);
        if (item && "isExpanded" in item && !item.isExpanded()) {
          item.toggle();
        }
      }
    },
    [model],
  );
  const appliedPreparedInputRef = React.useRef(preparedInput);
  const hasActiveFiltersRef = React.useRef(hasActiveFilters);
  const filteredAtLastResetRef = React.useRef(hasActiveFilters);
  const preFilterExpansionRef = React.useRef<readonly string[] | null>(null);
  React.useEffect(() => {
    hasActiveFiltersRef.current = hasActiveFilters;
  });
  React.useEffect(() => {
    const previousPreparedInput = appliedPreparedInputRef.current;
    if (previousPreparedInput === preparedInput) return;
    appliedPreparedInputRef.current = preparedInput;
    const wasFiltered = filteredAtLastResetRef.current;
    filteredAtLastResetRef.current = hasActiveFilters;
    let expandedPaths: readonly string[];
    if (hasActiveFilters) {
      if (!wasFiltered) {
        preFilterExpansionRef.current = collectExpandedDirectories(
          previousPreparedInput.paths,
        );
      }
      expandedPaths = [...directoryPathsOf(preparedInput.paths)];
    } else if (wasFiltered) {
      expandedPaths = preFilterExpansionRef.current ?? [];
      preFilterExpansionRef.current = null;
    } else {
      expandedPaths = collectExpandedDirectories(previousPreparedInput.paths);
    }
    const searchValue = model.getSearchValue();
    model.resetPaths(undefined as unknown as readonly string[], {
      initialExpandedPaths: expandedPaths,
      preparedInput,
    });
    if (searchValue) model.setSearch(searchValue);
  }, [collectExpandedDirectories, hasActiveFilters, model, preparedInput]);
  React.useLayoutEffect(() => {
    const expansionStore = treeExpansionRef.current;
    const savedExpansion = expansionStore.get(currentPath) ?? [];
    if (hasActiveFiltersRef.current) {
      preFilterExpansionRef.current = savedExpansion;
      expandDirectories(
        directoryPathsOf(appliedPreparedInputRef.current.paths),
      );
    } else {
      expandDirectories(savedExpansion);
    }
    return () => {
      expansionStore.set(
        currentPath,
        hasActiveFiltersRef.current
          ? (preFilterExpansionRef.current ?? [])
          : collectExpandedDirectories(appliedPreparedInputRef.current.paths),
      );
    };
  }, [
    collectExpandedDirectories,
    currentPath,
    expandDirectories,
    treeExpansionRef,
  ]);
  React.useEffect(() => {
    model.setSearch(searchQuery || null);
  }, [model, searchQuery]);
  React.useEffect(() => {
    syncingSelection.current = true;
    const desired = new Set(
      [...selectedPaths]
        .filter((path) => path.startsWith(currentPath))
        .map((path) => path.slice(currentPath.length)),
    );
    for (const path of model.getSelectedPaths())
      if (!desired.has(path) && !desired.has(`${path}/`))
        model.getItem(path)?.deselect();
    for (const path of desired)
      if (!model.getItem(path)?.isSelected()) model.getItem(path)?.select();
    syncingSelection.current = false;
  }, [model, selectedPaths, currentPath]);
  const entryFromEvent = (event: React.SyntheticEvent) => {
    for (const target of event.nativeEvent.composedPath()) {
      if (!(target instanceof HTMLElement)) continue;
      const relativePath = target.dataset?.itemPath;
      if (!relativePath) continue;
      const absolutePath = `${currentPath}${relativePath}`;
      return (
        index.files.get(absolutePath) ??
        index.folders.get(normalizeFolderPath(absolutePath)) ??
        null
      );
    }
    return null;
  };
  const resolveTreeItem = (relativePath: string) =>
    model.getItem(relativePath) ??
    model.getItem(
      relativePath.endsWith("/")
        ? relativePath.slice(0, -1)
        : `${relativePath}/`,
    );
  const collectVisibleEntries = () => {
    const visibleEntries: FileSystemEntry[] = [];
    const walk = (folderPath: string) => {
      const children = index.children.get(folderPath) ?? [];
      for (const child of children) {
        if (child.kind !== "folder") continue;
        const item = resolveTreeItem(child.path.slice(currentPath.length));
        if (!item) continue;
        visibleEntries.push(child);
        if ("isExpanded" in item && item.isExpanded()) walk(child.path);
      }
      for (const child of children) {
        if (child.kind === "file") visibleEntries.push(child);
      }
    };
    walk(currentPath);
    return visibleEntries;
  };
  const typeAhead = useEntryTypeAhead();
  return (
    <PierreFileTree
      id={treeId}
      model={model}
      className="block min-h-0 flex-1"
      onDoubleClick={(event) => {
        const entry = entryFromEvent(event);
        if (entry) onOpen(entry);
      }}
      onKeyDown={(event) => {
        if (
          ARROW_KEYS.has(event.key) &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey
        ) {
          requestAnimationFrame(() => {
            const item = model.getFocusedItem();
            if (!item) return;
            for (const path of model.getSelectedPaths())
              if (path !== item.getPath()) model.getItem(path)?.deselect();
            item.select();
          });
        }
        if (event.key === "Enter") {
          const entry = entryFromEvent(event);
          if (entry) {
            event.preventDefault();
            onOpen(entry);
          }
          return;
        }
        if (!isTypeAheadKey(event)) return;
        const visibleEntries = collectVisibleEntries();
        const focusedPath = model.getFocusedPath()?.replace(/\/$/, "") ?? null;
        const focusedIndex = visibleEntries.findIndex(
          (entry) =>
            entry.path.slice(currentPath.length).replace(/\/$/, "") ===
            focusedPath,
        );
        const match = typeAhead(event, visibleEntries, focusedIndex);
        if (!match) return;
        const item = resolveTreeItem(match.path.slice(currentPath.length));
        if (item) {
          model.scrollToPath(item.getPath());
          item.focus();
        }
      }}
      style={
        {
          "--trees-bg-override": "transparent",
          "--trees-border-color-override": "var(--color-border)",
          "--trees-fg-override": "var(--color-foreground)",
          "--trees-focus-ring-color-override": "var(--color-ring)",
          "--trees-focus-ring-width-override": "2px",
          "--trees-selected-bg-override": "var(--color-primary)",
          "--trees-selected-focused-border-color-override": "var(--color-ring)",
        } as React.CSSProperties
      }
    />
  );
}
function FileSystemColumnsView(props: FileSystemViewProps) {
  const {
    currentPath,
    index,
    loadPreviewImageUrl,
    loadingFolders,
    onOpen,
    onSelect,
    pageUrlCache,
    renderFilePreview,
    selectedEntry,
    selectedPath,
    selectedPaths,
  } = props;
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const deferredSelectedEntry = React.useDeferredValue(selectedEntry);
  const deferredSelectedPath = React.useDeferredValue(selectedPath);
  const pendingFocusPathRef = React.useRef<string | null>(null);
  const typeAhead = useEntryTypeAhead();
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!ARROW_KEYS.has(event.key)) {
      const siblings =
        selectedEntry && selectedPath?.startsWith(currentPath)
          ? (index.children.get(selectedEntry.parentPath) ?? [])
          : (index.children.get(currentPath) ?? []);
      const match = typeAhead(
        event,
        siblings,
        siblings.findIndex((sibling) => sibling.path === selectedPath),
      );
      if (match) {
        onSelect(match);
        const row = rowRefs.current.get(match.path);
        if (row) {
          row.focus();
        } else {
          pendingFocusPathRef.current = match.path;
        }
      }
      return;
    }
    let nextEntry: FileSystemEntry | null | undefined;
    if (!selectedEntry || !selectedPath?.startsWith(currentPath)) {
      nextEntry = index.children.get(currentPath)?.[0];
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const siblings = index.children.get(selectedEntry.parentPath) ?? [];
      const currentIndex = siblings.findIndex(
        (sibling) => sibling.path === selectedEntry.path,
      );
      nextEntry = siblings[currentIndex + (event.key === "ArrowUp" ? -1 : 1)];
    } else if (event.key === "ArrowLeft") {
      if (selectedEntry.parentPath !== currentPath) {
        nextEntry = index.folders.get(selectedEntry.parentPath);
      }
    } else if (selectedEntry.kind === "folder") {
      nextEntry = index.children.get(selectedEntry.path)?.[0];
    }
    if (!nextEntry) return;
    onSelect(nextEntry);
    const row = rowRefs.current.get(nextEntry.path);
    if (row) {
      pendingFocusPathRef.current = null;
      row.focus();
    } else {
      pendingFocusPathRef.current = nextEntry.path;
    }
    event.preventDefault();
  };
  React.useEffect(() => {
    const path = pendingFocusPathRef.current;
    if (!path) return;
    const row = rowRefs.current.get(path);
    if (row) {
      pendingFocusPathRef.current = null;
      row.focus();
    }
  });
  const columnPaths = React.useMemo(() => {
    const paths = [currentPath];
    if (!deferredSelectedPath?.startsWith(currentPath)) return paths;
    const targetFolder =
      deferredSelectedEntry?.kind === "folder"
        ? deferredSelectedEntry.path
        : (deferredSelectedEntry?.parentPath ?? currentPath);
    const relativePath = targetFolder.slice(currentPath.length);
    let walkedPath = currentPath;
    for (const segment of relativePath.split("/")) {
      if (!segment) continue;
      walkedPath = `${walkedPath}${segment}/`;
      paths.push(walkedPath);
    }
    return paths;
  }, [currentPath, deferredSelectedEntry, deferredSelectedPath]);
  const tabStopPath = React.useMemo(() => {
    if (selectedPath) {
      for (const columnPath of columnPaths) {
        if (
          index.children
            .get(columnPath)
            ?.some((entry) => entry.path === selectedPath)
        ) {
          return selectedPath;
        }
      }
    }
    return index.children.get(columnPaths[0] ?? "")?.[0]?.path ?? null;
  }, [columnPaths, index, selectedPath]);
  const selectedFile =
    deferredSelectedEntry?.kind === "file"
      ? (deferredSelectedEntry as FileEntry)
      : null;
  const selectedFileSize = selectedFile
    ? formatByteSize(selectedFile.size)
    : null;
  React.useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) container.scrollLeft = container.scrollWidth;
  }, [columnPaths.length, deferredSelectedPath]);
  return (
    <InlineScrollArea2
      orientation="horizontal"
      viewportRef={scrollContainerRef}
      viewportClassName="overscroll-x-contain"
    >
      <InlineScrollAreaContent
        className="flex h-full w-max"
        style={{ minWidth: "100%" }}
        onKeyDown={handleKeyDown}
      >
        {columnPaths.map((columnPath, columnIndex) => (
          <FileSystemColumn
            key={columnPath || "(root)"}
            entries={index.children.get(columnPath) ?? []}
            index={index}
            loadPreviewImageUrl={loadPreviewImageUrl}
            pageUrlCache={pageUrlCache}
            isLoading={loadingFolders.has(columnPath)}
            onOpen={onOpen}
            onSelect={onSelect}
            rowRefs={rowRefs}
            selectedPaths={selectedPaths}
            selectedChildPath={
              selectedPath && pathParent(selectedPath) === columnPath
                ? selectedPath
                : null
            }
            tabStopChildPath={
              tabStopPath && pathParent(tabStopPath) === columnPath
                ? tabStopPath
                : null
            }
            trailChildPath={columnPaths[columnIndex + 1] ?? null}
          />
        ))}
        {selectedFile ? (
          <InlineScrollArea2
            orientation="vertical"
            className="min-w-60 flex-1 contain-inline-size"
            fill={false}
            contentProps={{
              className: "flex min-h-full p-6",
              style: { display: "flex" },
            }}
          >
            <div className="m-auto flex w-full max-w-lg flex-col items-stretch gap-3">
              <div
                className="mx-auto w-full shrink-0"
                style={{
                  maxWidth: `min(100%, ${(selectedFile.previewAspectRatio ?? 0.78) * 20}rem)`,
                }}
              >
                <FileVisual
                  file={selectedFile}
                  className="w-full"
                  loadPreviewImageUrl={loadPreviewImageUrl}
                  pageable
                  pageUrlCache={pageUrlCache}
                  previewAspectRatio={0.78}
                  renderFilePreview={renderFilePreview}
                />
              </div>
              <div className="text-center">
                <div className="text-sm font-semibold break-words">
                  {selectedFile.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {fileKindLabel(selectedFile)}
                  {selectedFileSize ? ` - ${selectedFileSize}` : null}
                </div>
              </div>
              <FileSystemInformation entry={selectedFile} index={index} />
            </div>
          </InlineScrollArea2>
        ) : null}
      </InlineScrollAreaContent>
    </InlineScrollArea2>
  );
}
const COLUMN_PADDING = 6;
const COLUMN_ROW_HEIGHT = 28;
const COLUMN_ROW_GAP = 1;
const COLUMN_ROW_STRIDE = COLUMN_ROW_HEIGHT + COLUMN_ROW_GAP;
const FileSystemColumn = React.memo(function FileSystemColumn({
  entries,
  index,
  loadPreviewImageUrl,
  pageUrlCache,
  isLoading,
  onOpen,
  onSelect,
  rowRefs,
  selectedChildPath,
  selectedPaths,
  tabStopChildPath,
  trailChildPath,
}: {
  entries: FileSystemEntry[];
  index: FileSystemIndex;
  loadPreviewImageUrl: FileSystemViewProps["loadPreviewImageUrl"];
  pageUrlCache: Map<string, string>;
  isLoading: boolean;
  onOpen: (entry: FileSystemEntry) => void;
  onSelect: (
    entry: FileSystemEntry | null,
    event?: React.MouseEvent,
    orderedEntries?: FileSystemEntry[],
  ) => void;
  rowRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  selectedChildPath: string | null;
  selectedPaths: Set<string>;
  tabStopChildPath: string | null;
  trailChildPath: string | null;
}) {
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const { end, start } = useVirtualWindow({
    count: entries.length,
    itemStride: COLUMN_ROW_STRIDE,
    leadingPx: COLUMN_PADDING,
    overscan: 10,
    viewportRef,
  });
  React.useLayoutEffect(() => {
    if (!selectedChildPath) return;
    scrollIndexIntoView({
      index: entries.findIndex((entry) => entry.path === selectedChildPath),
      itemSize: COLUMN_ROW_HEIGHT,
      itemStride: COLUMN_ROW_STRIDE,
      leadingPx: COLUMN_PADDING,
      viewport: viewportRef.current,
    });
  }, [entries, selectedChildPath]);
  return (
    <InlineScrollArea2
      orientation="vertical"
      className="w-60 shrink-0 border-r"
      viewportRef={viewportRef}
      viewportClassName="p-1.5"
      viewportProps={{ "aria-label": "Files", role: "listbox" }}
    >
      {isLoading && entries.length === 0 ? (
        <div className="animate-pulse px-2 py-1.5 text-xs text-muted-foreground motion-reduce:animate-none">
          Loading…
        </div>
      ) : (
        <div
          className="relative"
          style={{
            height: entries.length
              ? entries.length * COLUMN_ROW_STRIDE - COLUMN_ROW_GAP
              : undefined,
          }}
        >
          <div
            className="absolute inset-x-0 flex flex-col gap-px"
            style={{ top: start * COLUMN_ROW_STRIDE }}
          >
            {entries.slice(start, end).map((entry) => {
              const isSelected = selectedPaths.has(entry.path);
              const isOnTrail =
                entry.kind === "folder" && entry.path === trailChildPath;
              return (
                <button
                  key={entry.path}
                  data-entry-path={entry.path}
                  type="button"
                  role="option"
                  aria-label={entry.name}
                  aria-selected={isSelected}
                  tabIndex={entry.path === tabStopChildPath ? 0 : -1}
                  ref={(element) => {
                    if (element) {
                      rowRefs.current.set(entry.path, element);
                    } else {
                      rowRefs.current.delete(entry.path);
                    }
                  }}
                  onClick={(event) => onSelect(entry, event, entries)}
                  onDoubleClick={() => onOpen(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onOpen(entry);
                  }}
                  className={cn(
                    "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : isOnTrail
                        ? "bg-accent"
                        : "hover:bg-accent/50",
                  )}
                >
                  {entry.kind === "folder" ? (
                    <Folder className="size-3.5 shrink-0" />
                  ) : (
                    <FileVisual
                      file={entry}
                      className="size-4 shrink-0 rounded-[3px]"
                      previewClassName="size-full"
                      loadPreviewImageUrl={loadPreviewImageUrl}
                      pageUrlCache={pageUrlCache}
                      renderFilePreview={() => (
                        <FileTypeIcon
                          fileName={entry.name}
                          className="size-full"
                          selected={isSelected}
                        />
                      )}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {entry.kind === "folder" &&
                  folderHasChildren(index, entry) ? (
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0",
                        !isSelected && "text-muted-foreground/60",
                      )}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </InlineScrollArea2>
  );
});
function FileSystemInformation({
  entry,
  index,
}: {
  entry: FileSystemEntry;
  index: FileSystemIndex;
}) {
  const rows: Array<[string, React.ReactNode]> = [];
  const created = formatTimestamp(entry.createdAt);
  const updated = formatTimestamp(entry.updatedAt);
  if (created) rows.push(["Created", created]);
  if (updated) rows.push(["Modified", updated]);
  if (entry.kind === "file") {
    const size = formatByteSize(entry.size);
    if (size) rows.push(["Size", size]);
    for (const [label, value] of Object.entries(entry.metadata ?? {}))
      rows.push([
        label,
        label === "Index" ? <IndexStatusBadge status={value} /> : value,
      ]);
  } else {
    const childCount = index.children.get(entry.path)?.length;
    if (childCount !== undefined) {
      rows.push(["Items", `${childCount}`]);
    }
  }
  if (rows.length === 0) return null;
  return (
    <div className="border-t pt-3">
      <div className="mb-1.5 text-xs font-semibold">Information</div>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-3 text-xs"
          >
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="text-right" suppressHydrationWarning>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
function FileSystemInformationSidebar({
  children,
  entry,
  index,
  loadPreviewImageUrl,
  onOpen,
  renderFilePreview,
}: {
  children?: React.ReactNode;
  entry: FileSystemEntry;
  index: FileSystemIndex;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    pageIndex: number,
  ) => Promise<string | null>;
  onOpen: (entry: FileSystemEntry) => void;
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
}) {
  const file = entry.kind === "file" ? entry : null;
  const fileSize = file ? formatByteSize(file.size) : null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <InlineScrollArea2
        orientation="vertical"
        className="min-h-0 flex-1"
        contentProps={{
          className: "flex min-h-full flex-col gap-6 p-5",
          style: { display: "flex" },
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            {file ? (
              <FileVisual
                file={file}
                className={cn(
                  "shrink-0 rounded-sm",
                  (file.previewAspectRatio ?? 0.78) > 1.2 ? "w-16" : "w-9",
                )}
                previewAspectRatio={0.78}
                renderFilePreview={renderFilePreview}
                loadPreviewImageUrl={loadPreviewImageUrl}
              />
            ) : (
              <FileSystemFolderGlyph className="h-8 w-auto shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold break-words">
                {entry.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {file ? fileKindLabel(file) : "Folder"}
                {fileSize ? ` - ${fileSize}` : null}
              </div>
            </div>
          </div>
        </div>
        {children}
        <FileSystemInformation entry={entry} index={index} />
      </InlineScrollArea2>
      <div className="shrink-0 p-5">
        <Button className="w-full" onClick={() => onOpen(entry)}>
          {file ? "Open document" : "Open folder"}
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
function FileSystemStructureSummary({
  file,
  loadStructure,
}: {
  file: FileEntry;
  loadStructure: (
    file: FileSystemFileItem,
  ) => Promise<SpatialDocumentStructure | null>;
}) {
  const [state, setState] = React.useState<{
    path: string;
    structure: SpatialDocumentStructure | null;
  } | null>(null);
  React.useEffect(() => {
    let active = true;
    void loadStructure(file).then((structure) => {
      if (active) setState({ path: file.path, structure });
    });
    return () => {
      active = false;
    };
  }, [file, loadStructure]);
  const structure = state?.path === file.path ? state.structure : undefined;
  let sectionCount = 0;
  const count = (nodes: SpatialDocumentStructure["sections"]) =>
    nodes.forEach((node) => {
      sectionCount++;
      count(node.children);
    });
  count(structure?.sections ?? []);
  return (
    <div className="border-t pt-3">
      <div className="mb-1.5 text-xs font-semibold">Structure</div>
      {structure === undefined ? (
        <div className="animate-pulse text-xs text-muted-foreground motion-reduce:animate-none">
          Reading structure…
        </div>
      ) : !structure ||
        (!structure.sections.length && !structure.blocks.length) ? (
        <div className="text-xs text-muted-foreground">
          Sections appear once the document is indexed.
        </div>
      ) : (
        <>
          <div className="mb-2 text-xs text-muted-foreground">
            {sectionCount} {sectionCount === 1 ? "section" : "sections"} ·{" "}
            {structure.blocks.length}{" "}
            {structure.blocks.length === 1 ? "block" : "blocks"}
          </div>
          <ul className="space-y-1">
            {structure.sections.slice(0, 8).map((section) => (
              <li
                key={section.id}
                className="flex items-baseline justify-between gap-3 text-xs"
              >
                <span className="min-w-0 truncate">{section.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  p.{section.page}
                </span>
              </li>
            ))}
          </ul>
          {structure.sections.length > 8 ? (
            <div className="mt-1 text-xs text-muted-foreground">
              + {structure.sections.length - 8} more
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
const GALLERY_STRIP_PADDING = 8;
const GALLERY_TILE_SIZE = 56;
const GALLERY_TILE_GAP = 6;
const GALLERY_TILE_STRIDE = GALLERY_TILE_SIZE + GALLERY_TILE_GAP;
const GALLERY_STAGE_POOL_SIZE = 4;
const GALLERY_STAGE_ATTACHED_COUNT = 3;
function FileSystemGalleryStage({
  file,
  getFileUrl,
  loadPreviewImageUrl,
  pageUrlCache,
  renderFilePreview,
  toolbarActions,
  urlCache,
  variant = "stage",
}: {
  file: FileEntry;
  getFileUrl?: (file: FileSystemFileItem) => string | Promise<string>;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    pageIndex: number,
  ) => Promise<string | null>;
  pageUrlCache?: Map<string, string>;
  renderFilePreview?: (file: FileSystemFileItem) => React.ReactNode;
  toolbarActions?: React.ReactNode;
  urlCache: Map<string, string>;
  variant?: "dialog" | "stage";
}) {
  const viewerKind = viewerKindForFile(file);
  const { isResolving, url } = useResolvedFileUrl(
    viewerKind ? file : null,
    getFileUrl,
    urlCache,
  );
  const isDialog = variant === "dialog";
  const [isDark, setIsDark] = React.useState(false);
  const viewerFrameClassName = cn(
    "size-full",
    !isDialog && "overflow-hidden rounded-lg border",
  );
  if (viewerKind && isResolving) {
    return <BoxLoader />;
  }
  if (viewerKind === "image" && url) {
    return (
      <img
        src={url}
        alt={file.name}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    );
  }
  if (viewerKind === "pdf" && url) {
    return (
      <div className={viewerFrameClassName}>
        <React.Suspense fallback={<FileSystemViewerLoading />}>
          <LazyPDFViewer
            src={url}
            className={cn(
              "h-full",
              isDialog && "min-h-0 overflow-hidden rounded-2xl",
            )}
            fileName={file.name}
            showToolbar={isDialog}
            showUpload={false}
            toolbarActions={toolbarActions}
          />
        </React.Suspense>
      </div>
    );
  }
  if (viewerKind === "docx" && url) {
    return (
      <div className={viewerFrameClassName}>
        <React.Suspense fallback={<FileSystemViewerLoading />}>
          <LazyDocxViewerPreview
            src={url}
            fileName={file.name}
            isDark={isDark}
            className={cn(
              "h-full min-h-0",
              isDialog && "overflow-hidden rounded-2xl",
            )}
            onIsDarkChange={setIsDark}
            showToolbar={isDialog}
            showUpload={false}
            toolbarActions={toolbarActions}
          />
        </React.Suspense>
      </div>
    );
  }
  if (viewerKind === "pptx" && url) {
    return (
      <div className={viewerFrameClassName}>
        <React.Suspense fallback={<FileSystemViewerLoading />}>
          <LazyPptxViewerPreview
            src={url}
            fileName={file.name}
            defaultThumbnailSidebarOpen={false}
            className={cn(
              "h-full min-h-0",
              isDialog && "overflow-hidden rounded-2xl",
            )}
            showToolbar={isDialog}
            showUpload={false}
            toolbarActions={toolbarActions}
          />
        </React.Suspense>
      </div>
    );
  }
  if (viewerKind === "xlsx" && url) {
    return (
      <div className={viewerFrameClassName}>
        <React.Suspense fallback={<FileSystemViewerLoading />}>
          <LazyXlsxViewerPreview
            src={url}
            fileName={file.name}
            isDark={isDark}
            className={cn(
              "h-full min-h-0",
              isDialog && "overflow-hidden rounded-2xl",
            )}
            onIsDarkChange={setIsDark}
            showToolbar={isDialog}
            showUpload={false}
            toolbarActions={toolbarActions}
          />
        </React.Suspense>
      </div>
    );
  }
  return (
    <FileVisual
      file={file}
      className="w-56 max-w-full"
      loadPreviewImageUrl={loadPreviewImageUrl}
      pageable
      pageUrlCache={pageUrlCache}
      previewAspectRatio={0.78}
      renderFilePreview={renderFilePreview}
    />
  );
}
function FileSystemGalleryView(props: FileSystemViewProps) {
  const {
    attachedStagePaths,
    entries,
    index,
    onOpen,
    onSelect,
    poolStagePath,
    registerStageHost,
    renderFilePreview,
    loadPreviewImageUrl,
    selectedEntry,
    selectedPath,
    selectedPaths,
  } = props;
  const stripRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const stripViewportRef = React.useRef<HTMLDivElement | null>(null);
  const typeAhead = useEntryTypeAhead();
  const activeEntry =
    selectedEntry && entries.some((entry) => entry.path === selectedEntry.path)
      ? selectedEntry
      : (entries[0] ?? null);
  const activeFile = activeEntry?.kind === "file" ? activeEntry : null;
  const settledPath = useSettledValue(activeEntry?.path ?? null, 200);
  React.useEffect(() => {
    if (settledPath) poolStagePath(settledPath);
  }, [poolStagePath, settledPath]);
  const stageHostRefs = React.useMemo(
    () =>
      new Map(
        attachedStagePaths.map(
          (path) =>
            [
              path,
              (element: HTMLElement | null) => registerStageHost(path, element),
            ] as const,
        ),
      ),
    [attachedStagePaths, registerStageHost],
  );
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (entries.length === 0) return;
    const currentIndex = activeEntry
      ? entries.findIndex((entry) => entry.path === activeEntry.path)
      : -1;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      const match = typeAhead(event, entries, currentIndex);
      if (match) {
        onSelect(match);
        requestAnimationFrame(() => stripRefs.current.get(match.path)?.focus());
      }
      return;
    }
    const nextEntry =
      entries[
        currentIndex === -1
          ? 0
          : currentIndex + (event.key === "ArrowLeft" ? -1 : 1)
      ];
    if (!nextEntry) return;
    onSelect(nextEntry);
    stripRefs.current.get(nextEntry.path)?.focus();
    event.preventDefault();
  };
  const { end: stripEnd, start: stripStart } = useVirtualWindow({
    count: entries.length,
    horizontal: true,
    itemStride: GALLERY_TILE_STRIDE,
    leadingPx: GALLERY_STRIP_PADDING,
    overscan: 8,
    viewportRef: stripViewportRef,
  });
  const activePath = activeEntry?.path ?? null;
  React.useLayoutEffect(() => {
    if (!activePath) return;
    scrollIndexIntoView({
      horizontal: true,
      index: entries.findIndex((entry) => entry.path === activePath),
      itemSize: GALLERY_TILE_SIZE,
      itemStride: GALLERY_TILE_STRIDE,
      leadingPx: GALLERY_STRIP_PADDING,
      viewport: stripViewportRef.current,
    });
  }, [activePath, entries]);
  return (
    <div className="flex size-full flex-col" onKeyDown={handleKeyDown}>
      <InlineScrollArea2
        orientation="horizontal"
        className="order-last h-auto w-full shrink-0 border-t"
        viewportRef={stripViewportRef}
        viewportClassName="p-2"
      >
        <div
          className="relative h-14 min-w-full"
          style={{
            width: entries.length
              ? entries.length * GALLERY_TILE_STRIDE - GALLERY_TILE_GAP
              : undefined,
          }}
        >
          <div
            role="listbox"
            aria-label="Files"
            className="absolute inset-y-0 flex items-center gap-1.5"
            style={{ left: stripStart * GALLERY_TILE_STRIDE }}
          >
            {entries.slice(stripStart, stripEnd).map((entry) => {
              const isActive =
                entry.path === (activeEntry?.path ?? selectedPath);
              return (
                <Tooltip key={entry.path}>
                  <TooltipTrigger asChild>
                    <button
                      data-entry-path={entry.path}
                      type="button"
                      role="option"
                      aria-label={entry.name}
                      aria-selected={selectedPaths.has(entry.path)}
                      tabIndex={isActive ? 0 : -1}
                      ref={(element) => {
                        if (element) {
                          stripRefs.current.set(entry.path, element);
                        } else {
                          stripRefs.current.delete(entry.path);
                        }
                      }}
                      onClick={(event) => onSelect(entry, event, entries)}
                      onDoubleClick={() => onOpen(entry)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") onOpen(entry);
                      }}
                      className={cn(
                        "flex size-14 shrink-0 items-center justify-center rounded-md border border-transparent p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selectedPaths.has(entry.path) &&
                          "border-ring/40 bg-accent",
                      )}
                    >
                      {entry.kind === "folder" ? (
                        <FileSystemFolderGlyph className="h-9 w-auto" />
                      ) : (
                        <span
                          className="block shrink-0"
                          style={{
                            width: `min(2.875rem, calc((2.875rem - 2px) * ${entry.previewAspectRatio ?? 0.78} + 2px))`,
                          }}
                        >
                          <FileVisual
                            file={entry}
                            className="w-full rounded-sm"
                            previewAspectRatio={0.78}
                            renderFilePreview={renderFilePreview}
                            loadPreviewImageUrl={loadPreviewImageUrl}
                          />
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-80 break-words">
                    {entry.name}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </InlineScrollArea2>
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel
          id="gallery-preview"
          minSize="25%"
          className="relative flex min-h-0 min-w-0 items-center justify-center p-3"
        >
          {activeEntry?.kind === "folder" ? (
            <FileSystemFolderGlyph className="h-40 max-h-full w-auto drop-shadow-md" />
          ) : activeFile && !attachedStagePaths.includes(activeFile.path) ? (
            <BoxLoader />
          ) : null}

          {attachedStagePaths.map((path) => {
            const isActiveStage = path === activeFile?.path;
            return (
              <div
                key={path}
                ref={stageHostRefs.get(path)}
                inert={!isActiveStage || undefined}
                className={cn(
                  "absolute inset-0 flex items-center justify-center p-3",
                  !isActiveStage && "invisible opacity-0",
                )}
              />
            );
          })}
        </Panel>
        {activeEntry ? (
          <>
            <Separator
              aria-label="Resize information panel"
              className="relative w-px bg-border outline-none transition-colors after:absolute after:inset-y-0 after:-inset-x-1 hover:bg-ring focus-visible:bg-ring"
            />
            <Panel
              id="gallery-information"
              defaultSize={280}
              minSize={190}
              maxSize="60%"
            >
              <FileSystemInformationSidebar
                entry={activeEntry}
                index={index}
                loadPreviewImageUrl={loadPreviewImageUrl}
                onOpen={onOpen}
                renderFilePreview={renderFilePreview}
              />
            </Panel>
          </>
        ) : null}
      </Group>
    </div>
  );
}
function InlineDialogPanel({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <InlineScrollArea className="min-h-0">
      <div
        data-slot="dialog-panel"
        className={cn("min-h-0", className)}
        {...props}
      >
        {children}
      </div>
    </InlineScrollArea>
  );
}
type InlineRegistryIconProps = Omit<
  React.ComponentProps<"svg">,
  "children" | "strokeWidth"
> & {
  strokeWidth?: number;
};
function InlineScrollArea2(
  props: React.ComponentProps<typeof InlineScrollArea>,
) {
  return <InlineScrollArea fill scrollFade {...props} />;
}

function InlineScrollAreaContent(props: ScrollAreaPrimitive.Content.Props) {
  return <ScrollAreaPrimitive.Content {...props} />;
}
