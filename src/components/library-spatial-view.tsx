import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { Maximize, Minus, Plus } from "./icons";
import { FolderPinBadge } from "./folder-pin-badge";
import {
  DocumentProcessingOverlay,
  isDocumentProcessing,
} from "./document-processing-overlay";
import {
  IndexStatusControl,
  needsIndexAttention,
} from "./index-status-control";
import { BlockTypeBadge, BlockPageBadge, blockStyle } from "./block-type-badge";
import type { IndexNode } from "@/lib/api";
import type { ParsedBlock } from "../../shared/parsed-blocks";
import type { FileSystemEntry, FileSystemFileItem } from "./extend/file-system";
import { FOLDER_GLYPH_SVG } from "./extend/folder-glyph";
import { FINDER_DRAG_TYPE } from "../lib/finder-drag";
import { layoutSpatialTree, type SpatialNode } from "../lib/spatial-tree";
import { occludesSpatialFocus } from "../lib/spatial-focus";
import {
  outlineFlowGeometry,
  outlineRouteFlowGeometry,
} from "../lib/spatial-outline";
import { OUTLINE_METAL_SHADER } from "../lib/spatial-metal";
import {
  spatialOutlineRows,
  spatialBlockCrop,
  SPATIAL_BLOCK_BATCH,
  type SpatialOutlineRow,
} from "../lib/spatial-blocks";
import {
  createDetailThumbnailQueue,
  detailThumbnailCandidates,
  smallThumbnailCandidates,
} from "../lib/detail-thumbnail-queue";
import type { SpatialThumbnail } from "../lib/spatial-thumbnail-renderer";
import {
  registerThemeSun,
  subscribeThemeTransition,
  themeProgressAt,
  themeSunDirection,
  themeSunset,
  THEME_SKY_COLORS,
  THEME_SUN_COLORS,
} from "../lib/theme-transition";
import "./library-spatial-view.css";

type Entry = FileSystemEntry;
export type SpatialDocumentStructure = {
  sections: IndexNode[];
  blocks: ParsedBlock[];
};
type Props = {
  items: Entry[];
  scope: string;
  selectedPath: string | null;
  sidebarWidth?: number;
  onSelect: (entry: Entry | null) => void;
  onOpen: (entry: Entry) => void;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    page: number,
  ) => Promise<string | null>;
  loadDocumentStructure?: (
    file: FileSystemFileItem,
  ) => Promise<SpatialDocumentStructure | null>;
  loadDetailThumbnail?: (
    file: FileSystemFileItem,
    signal: AbortSignal,
  ) => Promise<SpatialThumbnail | null>;
};
type SceneHandle = {
  focus: (path?: string) => void;
  fly: (amount: number) => void;
  invalidate: () => void;
  selectRow: (path: string, index: number, offset?: number) => void;
  collapseRow: () => void;
};

const SHEET_WIDTH = 2.25;
const SHEET_HEIGHT = 3;
const FOREGROUND_OPACITY = 0.1;
const FOREGROUND_MAP_BLUR = /* glsl */ `
  #ifdef USE_MAP
    uniform vec2 foregroundBlurStep;
    vec4 sampleForegroundMap(vec2 uv) {
      if (max(foregroundBlurStep.x, foregroundBlurStep.y) < 0.000001)
        return texture2D(map, uv);
      vec2 step = foregroundBlurStep;
      vec4 color = texture2D(map, uv) * 0.25;
      color += texture2D(map, uv + vec2(step.x, 0.0)) * 0.125;
      color += texture2D(map, uv - vec2(step.x, 0.0)) * 0.125;
      color += texture2D(map, uv + vec2(0.0, step.y)) * 0.125;
      color += texture2D(map, uv - vec2(0.0, step.y)) * 0.125;
      color += texture2D(map, uv + step) * 0.0625;
      color += texture2D(map, uv - step) * 0.0625;
      color += texture2D(map, uv + vec2(step.x, -step.y)) * 0.0625;
      color += texture2D(map, uv + vec2(-step.x, step.y)) * 0.0625;
      return color;
    }
  #endif
`;
const LABEL_HEIGHT = 0.22;
const FOLDER_LABEL_HEIGHT = 0.46;
const LINK_SEGMENTS = 32;
const TREE_ROW = 0.32;
const TREE_CARD_HEIGHT = 0.25;
const TREE_CARD_WIDTH = 2.9;
const TREE_INDENT = 0.26;
const TREE_COLUMN = 4.5;
const TREE_ROWS_PER_COLUMN = 24;
const TREE_MAX_ROWS = TREE_ROWS_PER_COLUMN * 3;
const TREE_MAX_DEPTH = 3;
const TREE_GAP = 0.6;
const PREVIEW_CARD_WIDTH = 2.8;
const PREVIEW_PADDING = 0.14;
const PREVIEW_FOOTER_HEIGHT = 0.32;
const PREVIEW_FOOTER_GAP = 0.08;
const BLOCK_CHIPS = 12;
const CHIP_WIDTH = 0.028;
const CHIP_STEP = 0.05;
/** Sheets drawn per document stack, however many pages it has. */
const STACK_SHEETS = 5;
const STACK_STEP = 0.07;
function stackSlot(slot: number, target: THREE.Vector3) {
  return target.set(slot * STACK_STEP, -slot * STACK_STEP, -slot * 0.06);
}
const BLOCK_COLORS: Record<string, string> = {
  text: "#3b82f6",
  paragraph: "#3b82f6",
  heading: "#8b5cf6",
  section_heading: "#a855f7",
  table: "#10b981",
  table_head: "#10b981",
  table_cell: "#84cc16",
  key_value: "#14b8a6",
  page_number: "#64748b",
  barcode: "#71717a",
  formula: "#f97316",
  header: "#06b6d4",
  footer: "#6366f1",
  watermark: "#78716c",
  legend: "#eab308",
  figure: "#f59e0b",
  image: "#ef4444",
  list: "#0ea5e9",
  signature: "#f43f5e",
  section: "#d946ef",
  title: "#ec4899",
};
function blockColor(type: string) {
  return BLOCK_COLORS[type.toLowerCase().replace(/[ -]+/g, "_")] ?? "#94a3b8";
}

/**
 * Single-pass gather depth of field: every pixel collects neighbours on a
 * golden-angle spiral, weighted by whether their own circle of confusion
 * reaches it, which yields round bokeh without sharp edges bleeding outward.
 */
const DEPTH_OF_FIELD_SHADER = {
  uniforms: {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2() },
    focus: { value: 20 },
    aperture: { value: 8 },
    band: { value: 0.012 },
    nearScale: { value: 0.6 },
    maxBlur: { value: 14 },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 2000 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    uniform vec2 texel;
    uniform float focus;
    uniform float aperture;
    uniform float band;
    uniform float nearScale;
    uniform float maxBlur;
    uniform float cameraNear;
    uniform float cameraFar;
    varying vec2 vUv;
    float distanceAt(vec2 uv) {
      return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
    }
    float blurSize(float depth) {
      float inverse = 1.0 / focus - 1.0 / depth;
      float amount = max(abs(inverse) - band, 0.0) * aperture;
      if (inverse < 0.0) amount *= nearScale;
      float closeBlur = 1.0 - smoothstep(0.4, 3.0, depth);
      return max(clamp(amount, 0.0, 1.0), closeBlur) * maxBlur;
    }
    void main() {
      float centerDepth = distanceAt(vUv);
      float centerSize = blurSize(centerDepth);
      vec3 color = texture2D(tColor, vUv).rgb;
      float total = 1.0;
      float radius = 0.5;
      // Interleaved-gradient noise rotates each pixel's spiral so sparse taps
      // read as grain instead of a visible pattern inside bokeh discs.
      float angle = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      for (int i = 0; i < 128; i++) {
        if (radius >= maxBlur) break;
        vec2 uv = vUv + vec2(cos(angle), sin(angle)) * texel * radius;
        vec3 sampleColor = texture2D(tColor, uv).rgb;
        float sampleDepth = distanceAt(uv);
        float sampleSize = blurSize(sampleDepth);
        if (sampleDepth > centerDepth)
          sampleSize = clamp(sampleSize, 0.0, centerSize * 2.0);
        float weight = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
        color += mix(color / total, sampleColor, weight);
        total += 1.0;
        angle += 2.39996323;
        radius += 1.15 / radius;
      }
      gl_FragColor = vec4(color / total, 1.0);
      #include <colorspace_fragment>
    }`,
};

function paperTexture(name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, 192, 256);
  context.fillStyle = "#285de0";
  context.fillRect(20, 22, 26, 4);
  context.fillStyle = "#253047";
  context.font = "600 12px Inter, sans-serif";
  const words = name
    .replace(/\.\w+$/, "")
    .replaceAll(/[_-]/g, " ")
    .split(/\s+/);
  let line = "";
  let y = 49;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > 151 && line) {
      context.fillText(line, 20, y);
      y += 17;
      line = word;
      if (y > 101) break;
    } else line = next;
  }
  if (y <= 101) context.fillText(line, 20, y);
  context.fillStyle = "#e1e3e5";
  for (let row = 0; row < 12; row++)
    context.fillRect(20, 122 + row * 8, row % 4 === 3 ? 97 : 152, 2);
  context.fillStyle = "#8392ac";
  context.font = "10px Inter, sans-serif";
  context.fillText(
    name.split(".").at(-1)?.toUpperCase().slice(0, 8) ?? "DOC",
    20,
    238,
  );
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function folderTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 400;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const image = new Image();
  image.onload = () => {
    canvas.getContext("2d")!.drawImage(image, 0, 0, 512, 400);
    texture.needsUpdate = true;
  };
  image.src = `data:image/svg+xml,${encodeURIComponent(FOLDER_GLYPH_SVG)}`;
  return { texture, ready: image.decode().catch(() => {}) };
}

function softDotTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  width: number,
) {
  if (context.measureText(text).width <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${text.slice(0, middle)}…`).width <= width)
      low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low).trimEnd()}…`;
}

function cardTexture(
  title: string,
  meta: string,
  options: {
    dark: boolean;
    accent?: string;
    icon?: Promise<HTMLImageElement | null>;
    onUpdate?: () => void;
  },
) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.beginPath();
  context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 12);
  context.fillStyle = options.dark ? "hsl(225 3% 9%)" : "hsl(0 0% 100%)";
  context.fill();
  context.save();
  context.clip();
  const leftReflection = context.createLinearGradient(0, 0, 24, 0);
  leftReflection.addColorStop(0, options.dark ? "#b7d5ff2c" : "#417bc11c");
  leftReflection.addColorStop(1, "#719bf900");
  context.fillStyle = leftReflection;
  context.fillRect(0, 0, 24, canvas.height);
  if (options.accent) {
    const rightReflection = context.createLinearGradient(
      canvas.width - 24,
      0,
      canvas.width,
      0,
    );
    rightReflection.addColorStop(0, `${options.accent}00`);
    rightReflection.addColorStop(
      1,
      `${options.accent}${options.dark ? "2c" : "1c"}`,
    );
    context.fillStyle = rightReflection;
    context.fillRect(canvas.width - 24, 0, 24, canvas.height);
  }
  context.restore();
  context.lineWidth = 2;
  context.strokeStyle = options.dark
    ? "rgb(255 255 255 / 8%)"
    : "rgb(0 0 0 / 8%)";
  context.stroke();
  const left = options.icon ? 62 : 22;
  context.textBaseline = "middle";
  context.font = `500 24px Inter, system-ui, sans-serif`;
  const metaWidth = meta ? context.measureText(meta).width + 16 : 0;
  context.fillStyle = options.dark ? "#8f96a8" : "#6b7385";
  if (meta)
    context.fillText(meta, canvas.width - metaWidth - 6, canvas.height / 2);
  context.fillStyle = options.dark ? "#eef0f6" : "#1c2233";
  context.font = `500 26px Inter, system-ui, sans-serif`;
  context.fillText(
    fitText(context, title, canvas.width - left - metaWidth - 16),
    left,
    canvas.height / 2 + 1,
  );
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (options.icon) {
    let active = true;
    texture.addEventListener("dispose", () => {
      active = false;
    });
    void options.icon.then((image) => {
      if (!active || !image) return;
      context.drawImage(image, 20, 16, 32, 32);
      texture.needsUpdate = true;
      options.onUpdate?.();
    });
  }
  return texture;
}

/** Name plate that floats under a page stack or folder, inside the scene. */
function labelTexture(
  title: string,
  subtitle: string | undefined,
  dark: boolean,
  pinned = false,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const titleFont = `${subtitle ? 600 : 500} 40px Inter, system-ui, sans-serif`;
  const subtitleFont = `400 30px Inter, system-ui, sans-serif`;
  context.font = titleFont;
  const text = fitText(context, title, 760);
  const titleWidth = context.measureText(text).width;
  let width = titleWidth + (pinned ? 48 : 0);
  if (subtitle) {
    context.font = subtitleFont;
    width = Math.max(width, context.measureText(subtitle).width);
  }
  canvas.width = Math.ceil(width + 56);
  canvas.height = subtitle ? 124 : 72;
  context.beginPath();
  context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 18);
  context.fillStyle = dark ? "#212329" : "#ffffff";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = dark
    ? "rgba(255, 255, 255, 0.1)"
    : "rgba(31, 41, 64, 0.1)";
  context.stroke();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = titleFont;
  context.fillStyle = dark ? "#eef0f6" : "#1c2233";
  context.fillText(
    text,
    canvas.width / 2 - (pinned ? 24 : 0),
    subtitle ? 44 : canvas.height / 2 + 1,
  );
  if (subtitle) {
    context.font = subtitleFont;
    context.fillStyle = dark ? "#8f96a8" : "#6b7385";
    context.fillText(subtitle, canvas.width / 2, 88);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return {
    texture,
    aspect: canvas.width / canvas.height,
    pinX: (titleWidth / 2 + 4) / canvas.height,
    pinY: (canvas.height / 2 - 44) / canvas.height,
  };
}

function roundedRectPath<T extends THREE.Path>(
  path: T,
  width: number,
  height: number,
  radius: number,
): T {
  const x = width / 2,
    y = height / 2,
    r = Math.min(radius, x, y);
  path.moveTo(-x + r, -y);
  path.lineTo(x - r, -y);
  path.quadraticCurveTo(x, -y, x, -y + r);
  path.lineTo(x, y - r);
  path.quadraticCurveTo(x, y, x - r, y);
  path.lineTo(-x + r, y);
  path.quadraticCurveTo(-x, y, -x, y - r);
  path.lineTo(-x, -y + r);
  path.quadraticCurveTo(-x, -y, -x + r, -y);
  path.closePath();
  return path;
}

function roundedRing(width: number, height: number, thickness = 0.018) {
  const ring = roundedRectPath(
    new THREE.Shape(),
    width + thickness * 2,
    height + thickness * 2,
    0.07,
  );
  ring.holes.push(roundedRectPath(new THREE.Path(), width, height, 0.05));
  return new THREE.ShapeGeometry(ring, 12);
}

function blockCardTexture(dark: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const context = canvas.getContext("2d")!;
  context.fillStyle = dark ? "hsl(225 3% 9%)" : "#ffffff";
  context.fillRect(0, 0, 2, 2);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function ocrTextTexture(block: ParsedBlock) {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fbfaf6";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#20283b";
  context.font = "24px Inter, system-ui, sans-serif";
  const words = (block.content || "No OCR text available").split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && context.measureText(`${line} ${word}`).width > 892) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  lines
    .slice(0, 14)
    .forEach((text, i) =>
      context.fillText(
        i === 13 && lines.length > 14 ? `${text}…` : text,
        34,
        48 + i * 34,
      ),
    );
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

export function LibrarySpatialView(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<SceneHandle | null>(null);
  const thumbnailCache = useRef(new Map<string, string | null>());
  const [unavailable, setUnavailable] = useState(false);
  const [previewBadges, setPreviewBadges] = useState<
    { id: string; type: string; page: number }[]
  >([]);
  const badgeElements = useRef(new Map<string, HTMLSpanElement>());
  const statusElements = useRef(new Map<string, HTMLSpanElement>());
  const processingElements = useRef(new Map<string, HTMLSpanElement>());
  const [outlineRows, setOutlineRows] = useState<{
    path: string;
    rows: SpatialOutlineRow[];
  } | null>(null);
  const [expandedRow, setExpandedRow] = useState<{
    path: string;
    index: number;
    title: string;
    offset: number;
    total: number;
    loading: boolean;
  } | null>(null);
  const structure = props.items
    .map(
      (item) =>
        `${item.kind}:${item.path}:${item.kind === "folder" && !!item.pinned}`,
    )
    .join("\n");
  const nodes = useMemo(
    () => layoutSpatialTree(latest.current.items, props.scope),
    [structure, props.scope],
  );
  const visibleNodes = useMemo(
    () => nodes.filter((node) => node.kind !== "root"),
    [nodes],
  );

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    setPreviewBadges([]);
    const dark = themeProgressAt() >= 0.5;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: "high-performance",
      });
    } catch {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);

    const palettes = THEME_SKY_COLORS;
    const palette = dark ? palettes.night : palettes.day;
    const skyColors = Object.fromEntries(
      Object.entries(palettes).map(([name, colors]) => [
        name,
        {
          haze: new THREE.Color(colors.haze),
          top: new THREE.Color(colors.top),
          bottom: new THREE.Color(colors.bottom),
        },
      ]),
    );
    let themeProgress = themeProgressAt();
    const themeNight = { value: themeProgress };
    const outlineTime = { value: 0 };
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(palette.haze);
    const fog = new THREE.FogExp2(palette.haze, 0.015);
    scene.fog = fog;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
    scene.add(camera);

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    function geometry<T extends THREE.BufferGeometry>(value: T): T {
      geometries.add(value);
      return value;
    }
    function material<T extends THREE.Material>(value: T): T {
      materials.add(value);
      return value;
    }
    const textureAnisotropy = Math.min(
      16,
      renderer.capabilities.getMaxAnisotropy(),
    );
    function texture<T extends THREE.Texture>(value: T): T {
      value.anisotropy = textureAnisotropy;
      textures.add(value);
      return value;
    }
    const nightMaps = new WeakMap<THREE.Material, THREE.Texture>();
    const blockIcons = new Map<string, Promise<HTMLImageElement | null>>();
    const themeColors = getComputedStyle(document.documentElement);
    function blockIcon(type: string, dark: boolean) {
      const { icon: Icon, tone } = blockStyle(type);
      const key = `${tone}:${dark}`;
      let cached = blockIcons.get(key);
      if (!cached) {
        const color =
          themeColors
            .getPropertyValue(`--color-${tone}-${dark ? 300 : 700}`)
            .trim() || blockColor(type);
        const image = new Image();
        image.src = `data:image/svg+xml,${encodeURIComponent(
          renderToStaticMarkup(
            <Icon xmlns="http://www.w3.org/2000/svg" size={32} color={color} />,
          ),
        )}`;
        cached = image
          .decode()
          .then(() => image)
          .catch(() => null);
        blockIcons.set(key, cached);
      }
      return cached;
    }
    function themeMap<T extends THREE.Material>(
      value: T,
      nightMap: THREE.Texture,
    ): T {
      nightMaps.set(value, texture(nightMap));
      value.onBeforeCompile = (shader) => {
        shader.uniforms.sceneNight = themeNight;
        shader.uniforms.nightMap = { value: nightMap };
        shader.fragmentShader =
          `uniform float sceneNight;\nuniform sampler2D nightMap;\n` +
          shader.fragmentShader.replace(
            "#include <map_fragment>",
            THREE.ShaderChunk.map_fragment.replace(
              "vec4 sampledDiffuseColor = texture2D( map, vMapUv );",
              "vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(nightMap, vMapUv), sceneNight);",
            ),
          );
      };
      return value;
    }

    // A soft vertical gradient shell reads as endless haze rather than a room.
    const sky = new THREE.Mesh(
      geometry(new THREE.SphereGeometry(1500, 32, 16)),
      material(
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          depthWrite: false,
          fog: false,
          uniforms: {
            top: { value: new THREE.Color(palette.top) },
            middle: { value: new THREE.Color(palette.haze) },
            bottom: { value: new THREE.Color(palette.bottom) },
            sunDirection: { value: new THREE.Vector3() },
            sunColor: { value: new THREE.Color(THEME_SUN_COLORS.dusk) },
            sunset: { value: 0 },
          },
          vertexShader: /* glsl */ `
            varying vec3 vDirection;
            void main() {
              vDirection = normalize(position);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: /* glsl */ `
            uniform vec3 top;
            uniform vec3 middle;
            uniform vec3 bottom;
            uniform vec3 sunDirection;
            uniform vec3 sunColor;
            uniform float sunset;
            varying vec3 vDirection;
            void main() {
              float h = vDirection.y;
              vec3 color = h > 0.0
                ? mix(middle, top, smoothstep(0.0, 0.7, h))
                : mix(middle, bottom, smoothstep(0.0, 0.7, -h));
              float sunFacing = max(dot(normalize(vDirection), normalize(sunDirection)), 0.0);
              color = mix(color, sunColor, pow(sunFacing, 6.0) * sunset * 0.35);
              gl_FragColor = vec4(color, 1.0);
              #include <colorspace_fragment>
            }`,
        }),
      ),
    );
    sky.frustumCulled = false;
    scene.add(sky);

    const hemisphere = new THREE.HemisphereLight(
      dark ? 0x9fb0e0 : 0xffffff,
      dark ? 0x1a1a22 : 0xd8d2c4,
      dark ? 1.3 : 1.9,
    );
    scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xfff4e6, dark ? 1.3 : 1.7);
    key.position.set(-0.5, 1, 0.7);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db7ff, dark ? 0.9 : 0.6);
    rim.position.set(0.7, -0.3, -1);
    scene.add(rim);
    const lantern = new THREE.PointLight(0xffffff, dark ? 26 : 18, 42, 1.4);
    lantern.position.set(0.6, 1.2, 0);
    camera.add(lantern);

    const extent =
      Math.max(14, ...nodes.map((node) => Math.hypot(...node.position))) + 8;
    const drifters = [
      { color: 0x8caddc, phase: 0 },
      { color: 0xffd7a6, phase: 2.1 },
      { color: 0xb9cde7, phase: 4.2 },
    ].map(({ color, phase }, index) => {
      const light = new THREE.PointLight(
        color,
        dark ? 90 : 55,
        extent,
        index === 1 ? 2 : 1.2,
      );
      scene.add(light);
      return { light, phase };
    });

    const particleCount = Math.min(600, 420 + nodes.length * 3);
    const particlePositions = new Float32Array(particleCount * 3);
    const particleSizes = new Float32Array(particleCount);
    const particleDrift = new Float32Array(particleCount * 3);
    const particleTime = { value: 0 };
    for (let i = 0; i < particleCount; i++) {
      const radius = extent * 1.2 * Math.cbrt(Math.random());
      const azimuth = Math.random() * Math.PI * 2;
      const vertical = Math.random() * 2 - 1;
      const horizontal = Math.sqrt(1 - vertical * vertical);
      particlePositions.set(
        [
          radius * horizontal * Math.cos(azimuth),
          radius * vertical,
          radius * horizontal * Math.sin(azimuth),
        ],
        i * 3,
      );
      particleSizes[i] = 0.15 + 0.85 * Math.pow(Math.random(), 1.4);
      particleDrift.set(
        [
          Math.random() * Math.PI * 2,
          0.12 + Math.random() * 0.1,
          0.18 + Math.random() * 0.25,
        ],
        i * 3,
      );
    }
    const particleGeometry = geometry(new THREE.BufferGeometry());
    particleGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(particlePositions, 3),
    );
    particleGeometry.setAttribute(
      "particleScale",
      new THREE.BufferAttribute(particleSizes, 1),
    );
    particleGeometry.setAttribute(
      "particleDrift",
      new THREE.BufferAttribute(particleDrift, 3),
    );
    const particleMap = texture(softDotTexture());
    const clampParticleSize = (
      value: THREE.PointsMaterial,
      min: number,
      max: number,
    ) => {
      value.customProgramCacheKey = () => `particle-drift-${min}-${max}`;
      value.onBeforeCompile = (shader) => {
        shader.uniforms.particleDpr = { value: pixelRatio };
        shader.uniforms.particleTime = particleTime;
        shader.vertexShader =
          "uniform float particleDpr;\nuniform float particleTime;\nattribute float particleScale;\nattribute vec3 particleDrift;\n" +
          shader.vertexShader
            .replace(
              "#include <begin_vertex>",
              `#include <begin_vertex>
              float drift = particleTime * particleDrift.y;
              float phase = particleDrift.x;
              transformed += vec3(
                sin(drift + phase),
                cos(drift * 0.83 + phase * 1.7),
                sin(drift * 0.67 + phase * 2.3)
              ) * particleDrift.z;`,
            )
            .replace(
              "#include <logdepthbuf_vertex>",
              `gl_PointSize = clamp(gl_PointSize, ${min.toFixed(1)} * particleDpr, ${max.toFixed(1)} * particleDpr) * particleScale;\n#include <logdepthbuf_vertex>`,
            );
      };
      return value;
    };
    const particleMaterial = clampParticleSize(
      material(
        new THREE.PointsMaterial({
          color: "#e1e8f2",
          size: 0.1,
          map: particleMap,
          transparent: true,
          opacity: 0.42,
          alphaTest: 0.1,
          depthWrite: true,
          blending: THREE.NormalBlending,
        }),
      ),
      1.5,
      3.0,
    );
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);
    const particleGlowMaterial = clampParticleSize(
      material(
        new THREE.PointsMaterial({
          color: "#a6c7ff",
          size: 0.28,
          map: particleMap,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      ),
      5.0,
      8.0,
    );
    const particleGlow = new THREE.Points(
      particleGeometry,
      particleGlowMaterial,
    );
    scene.add(particleGlow);
    const particleDayHaloMaterial = clampParticleSize(
      material(
        new THREE.PointsMaterial({
          color: "#75899e",
          size: 0.28,
          map: particleMap,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        }),
      ),
      5.0,
      8.0,
    );
    const particleDayHalo = new THREE.Points(
      particleGeometry,
      particleDayHaloMaterial,
    );
    scene.add(particleDayHalo);

    const sheet = geometry(new THREE.PlaneGeometry(SHEET_WIDTH, SHEET_HEIGHT));
    const paperColor = new THREE.Color(dark ? "#d3d8e2" : "#fbfaf6");
    const sheetShade = (slot: number) =>
      new THREE.Color().copy(paperColor).multiplyScalar(1 - slot * 0.075);
    const outline = material(
      new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
    );
    outline.onBeforeCompile = (shader) => {
      shader.uniforms.outlineTime = outlineTime;
      shader.vertexShader =
        "varying vec2 vMetalPosition;\n" +
        shader.vertexShader.replace(
          "void main() {",
          "void main() { vMetalPosition = position.xy;",
        );
      shader.fragmentShader =
        `${OUTLINE_METAL_SHADER}\nvarying vec2 vMetalPosition;\n` +
        shader.fragmentShader.replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          "vec4 diffuseColor = vec4(outlineMetalColor(vMetalPosition.x + vMetalPosition.y * 1.3, 0.5, vec3(0.47, 0.7, 1.0)), opacity);",
        );
    };
    const outlineGeometry = geometry(roundedRing(SHEET_WIDTH, SHEET_HEIGHT));
    const folderArt = folderTexture();
    texture(folderArt.texture);
    const folderMaterial = material(
      new THREE.MeshBasicMaterial({
        map: folderArt.texture,
        transparent: true,
        alphaTest: 0.5,
        alphaToCoverage: true,
        toneMapped: false,
      }),
    );
    const folderGeometry = geometry(new THREE.PlaneGeometry(3.2, 2.5));

    type Floater = {
      node: SpatialNode;
      group: THREE.Group;
      body: THREE.Group;
      base: THREE.Vector3;
      calm: number;
      hover: number;
      occluded: boolean;
      opacity: number;
      scale: number;
      height: number;
      width: number;
      frame?: THREE.Mesh;
      label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      pinPosition: THREE.Vector3;
      /** The first page, on top of a static stack of the rest. */
      cover?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
      sheets: THREE.Mesh[];
    };
    // Sheets under the cover share one slightly darker paper per depth.
    const stackMaterials = Array.from({ length: STACK_SHEETS }, (_, slot) =>
      material(
        new THREE.MeshStandardMaterial({
          color: sheetShade(slot),
          roughness: 0.82,
          metalness: 0,
        }),
      ),
    );
    /** Keeps a name plate just under its page stack or folder glyph. */
    function placeLabel(floater: Floater) {
      const drop =
        floater.node.kind === "file"
          ? (floater.sheets.length - 1) * STACK_STEP
          : 0;
      floater.label.position.set(
        0,
        -(floater.height / 2) * floater.scale -
          drop -
          0.22 -
          floater.label.geometry.parameters.height / 2,
        0.01,
      );
    }
    const itemsByPath = new Map(
      latest.current.items.map((item) => [item.path, item]),
    );
    const floaters = new Map<string, Floater>();
    const pickables: THREE.Object3D[] = [];
    for (const node of visibleNodes) {
      const group = new THREE.Group();
      const body = new THREE.Group();
      group.add(body);
      group.position.set(...node.position);
      group.userData.path = node.path;
      const entry = itemsByPath.get(node.path);
      const pinned = entry?.kind === "folder" && entry.pinned;
      const nameplate = labelTexture(
        node.name,
        node.kind === "file"
          ? undefined
          : `${node.descendants} ${node.descendants === 1 ? "document" : "documents"}`,
        false,
        pinned,
      );
      const labelHeight =
        node.kind === "file" ? LABEL_HEIGHT : FOLDER_LABEL_HEIGHT;
      const label = new THREE.Mesh(
        geometry(
          new THREE.PlaneGeometry(labelHeight * nameplate.aspect, labelHeight),
        ),
        themeMap(
          material(
            new THREE.MeshBasicMaterial({
              map: texture(nameplate.texture),
              alphaTest: 0.5,
              toneMapped: false,
            }),
          ),
          labelTexture(
            node.name,
            node.kind === "file"
              ? undefined
              : `${node.descendants} ${node.descendants === 1 ? "document" : "documents"}`,
            true,
            pinned,
          ).texture,
        ),
      );
      group.add(label);
      pickables.push(label);
      const floater: Floater = {
        pinPosition: new THREE.Vector3(
          nameplate.pinX * labelHeight,
          nameplate.pinY * labelHeight,
          0.01,
        ),
        node,
        group,
        body,
        label,
        base: new THREE.Vector3(...node.position),
        calm: 0,
        hover: 0,
        occluded: false,
        opacity: 1,
        scale: 1,
        width: SHEET_WIDTH,
        height: SHEET_HEIGHT,
        sheets: [],
      };
      if (node.kind === "file") {
        const entry = itemsByPath.get(node.path);
        const pageCount = Math.max(
          1,
          (entry?.kind === "file" && entry.previewPageCount) || 1,
        );
        const cover = new THREE.Mesh(
          sheet,
          material(
            new THREE.MeshStandardMaterial({
              map: texture(paperTexture(node.name)),
              color: sheetShade(0),
              roughness: 0.82,
              metalness: 0,
            }),
          ),
        );
        floater.cover = cover;
        floater.sheets.push(cover);
        for (let slot = 1; slot < Math.min(STACK_SHEETS, pageCount); slot++) {
          const page = new THREE.Mesh(sheet, stackMaterials[slot]);
          stackSlot(slot, page.position);
          floater.sheets.push(page);
        }
        body.add(...floater.sheets);
        pickables.push(...floater.sheets);
        const frame = new THREE.Mesh(outlineGeometry, outline);
        frame.visible = false;
        cover.add(frame);
        floater.frame = frame;
      } else {
        const glyph = new THREE.Mesh(folderGeometry, folderMaterial);
        floater.scale =
          1 + Math.min(0.9, Math.log10(node.descendants + 1) * 0.45);
        floater.width = 3.2;
        floater.height = 2.5;
        body.scale.setScalar(floater.scale);
        body.add(glyph);
        pickables.push(glyph);
      }
      placeLabel(floater);
      floaters.set(node.path, floater);
      scene.add(group);
    }

    // Hierarchy branches: folder → sub-folder → page stack, drawn as curved
    // world-width lines that follow the floating motion every frame.
    const lineMaterials = new Set<LineMaterial>();
    function fatLineMaterial(
      options: ConstructorParameters<typeof LineMaterial>[0],
    ) {
      const value = material(
        new LineMaterial({ ...options, alphaToCoverage: true }),
      );
      lineMaterials.add(value);
      return value;
    }
    const links = visibleNodes.flatMap((node) => {
      const parent =
        node.parent === null ? undefined : floaters.get(node.parent);
      const child = floaters.get(node.path);
      return parent && child ? [[parent, child] as const] : [];
    });
    const linkPositions = new Float32Array(
      Math.max(1, links.length * LINK_SEGMENTS) * 6,
    );
    const linkGeometry = geometry(
      new LineSegmentsGeometry().setPositions(linkPositions),
    );
    const linkVisibility = new Float32Array(
      Math.max(1, links.length * LINK_SEGMENTS),
    ).fill(1);
    const visibilityAttribute = new THREE.InstancedBufferAttribute(
      linkVisibility,
      1,
    );
    linkGeometry.setAttribute("instanceVisibility", visibilityAttribute);
    const folderLineMaterial = fatLineMaterial({
      color: new THREE.Color(dark ? "#5b6788" : "#a3aec3").getHex(),
      linewidth: 0.032,
      worldUnits: true,
      fog: true,
      transparent: true,
      depthWrite: false,
    });
    const linkLines = new LineSegments2(linkGeometry, folderLineMaterial);
    linkLines.frustumCulled = false;
    linkLines.visible = links.length > 0;
    scene.add(linkLines);
    const room = { center: new THREE.Vector3(), limit: Infinity };
    const linkFrom = new THREE.Vector3();
    const linkTo = new THREE.Vector3();
    const bezier = new THREE.CubicBezierCurve3(
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    );
    const bezierPoint = new THREE.Vector3();

    // Post-processing: render to a multisampled target that keeps depth, then
    // resolve through the depth-of-field pass.
    const target = new THREE.WebGLRenderTarget(1, 1, {
      samples: Math.min(8, renderer.capabilities.maxSamples),
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    const dofMaterial = material(
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(DEPTH_OF_FIELD_SHADER.uniforms),
        vertexShader: DEPTH_OF_FIELD_SHADER.vertexShader,
        fragmentShader: DEPTH_OF_FIELD_SHADER.fragmentShader,
        depthTest: false,
        depthWrite: false,
      }),
    );
    dofMaterial.uniforms.tColor.value = target.texture;
    dofMaterial.uniforms.tDepth.value = target.depthTexture;
    dofMaterial.uniforms.cameraNear.value = camera.near;
    dofMaterial.uniforms.cameraFar.value = camera.far;
    const quad = new FullScreenQuad(dofMaterial);
    folderLineMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.connectorFocus = dofMaterial.uniforms.focus;
      shader.uniforms.connectorAperture = dofMaterial.uniforms.aperture;
      shader.uniforms.connectorBand = dofMaterial.uniforms.band;
      shader.uniforms.connectorNearScale = dofMaterial.uniforms.nearScale;
      shader.vertexShader =
        "attribute float instanceVisibility;\nvarying float vConnectorVisibility;\nvarying float vConnectorDepth;\n" +
        shader.vertexShader.replace(
          "#include <fog_vertex>",
          "vConnectorDepth = -mvPosition.z;\nvConnectorVisibility = instanceVisibility;\n#include <fog_vertex>",
        );
      shader.fragmentShader =
        `varying float vConnectorDepth;
        varying float vConnectorVisibility;
        uniform float connectorFocus;
        uniform float connectorAperture;
        uniform float connectorBand;
        uniform float connectorNearScale;\n` +
        shader.fragmentShader.replace(
          "gl_FragColor = vec4( diffuseColor.rgb, alpha );",
          `float foregroundBlur = max(
            1.0 / max(vConnectorDepth, 0.4) -
            1.0 / max(connectorFocus, 0.4) - connectorBand, 0.0
          ) * connectorAperture * connectorNearScale;
          alpha *= vConnectorVisibility * mix(1.0, 0.15, smoothstep(0.0, 0.35, foregroundBlur));
          gl_FragColor = vec4(diffuseColor.rgb, alpha);`,
        );
    };

    // Document structure trees are built lazily on selection.
    type Tree = {
      path: string;
      group: THREE.Group;
      width: number;
      height: number;
      reveal: number;
      state: "loading" | "ready";
      rows: SpatialOutlineRow[];
      cards: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
      chips: THREE.InstancedMesh | null;
      chipMatrices: { index: number; matrix: THREE.Matrix4 }[][];
      baseWidth: number;
      baseHeight: number;
      flowStarts: number[];
    };
    const trees = new Map<string, Tree>();
    const structures = new Map<string, SpatialDocumentStructure | null>();
    const requested = new Set<string>();
    let activePreview: {
      path: string;
      index: number;
      offset: number;
      group: THREE.Group;
      controller: AbortController;
      pages: SpatialThumbnail[];
      maps: THREE.Texture[];
      reveal: number;
      origin: THREE.Vector3;
      badges: {
        id: string;
        type: string;
        page: number;
        label: THREE.Object3D;
        width: number;
      }[];
    } | null = null;
    let cropLoad = Promise.resolve();
    // Outline connectors: world-width so they read clearly up close.
    const lineMaterial = fatLineMaterial({
      color: new THREE.Color(dark ? "#8ba4d4" : "#8295b8").getHex(),
      linewidth: 0.012,
      worldUnits: true,
      toneMapped: false,
      transparent: true,
      depthFunc: THREE.AlwaysDepth,
    });
    lineMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.outlineTime = outlineTime;
      shader.uniforms.outlineNight = themeNight;
      shader.vertexShader =
        `attribute float instanceFlowStart;\nattribute float instanceFlowEnd;\nvarying float vOutlineFlow;\nvarying float vOutlineAcross;\n` +
        shader.vertexShader.replace(
          "void main() {",
          "void main() {\n vOutlineFlow = mix(instanceFlowStart, instanceFlowEnd, clamp(position.y, 0.0, 1.0));\n vOutlineAcross = clamp(position.x * 0.5 + 0.5, 0.0, 1.0);",
        );
      shader.fragmentShader =
        `varying float vOutlineFlow;\nvarying float vOutlineAcross;\nuniform float outlineNight;\n${OUTLINE_METAL_SHADER}\n` +
        shader.fragmentShader.replace(
          "gl_FragColor = vec4( diffuseColor.rgb, alpha );",
          `
        vec3 metal = outlineMetalColor(vOutlineFlow, vOutlineAcross, vec3(0.47, 0.7, 1.0));
        vec3 steel = metal * mix(0.86, 1.12, outlineNight);
        gl_FragColor = vec4(steel, alpha);`,
        );
    };
    const cardMaterial = (
      map: THREE.Texture,
      nightMap: THREE.Texture,
      flowStart: number,
      width: number,
    ) => {
      const value = themeMap(
        material(
          new THREE.MeshBasicMaterial({
            map: texture(map),
            alphaTest: 0.5,
            alphaToCoverage: true,
            toneMapped: false,
            fog: false,
            transparent: true,
            depthFunc: THREE.AlwaysDepth,
          }),
        ),
        nightMap,
      );
      const themeCompile = value.onBeforeCompile;
      value.onBeforeCompile = (shader, renderer) => {
        themeCompile.call(value, shader, renderer);
        shader.uniforms.outlineTime = outlineTime;
        shader.uniforms.outlineFlowStart = { value: flowStart };
        shader.uniforms.outlineCardWidth = { value: width };
        shader.fragmentShader =
          `${OUTLINE_METAL_SHADER}\nuniform float outlineFlowStart;\nuniform float outlineCardWidth;\n` +
          shader.fragmentShader.replace(
            "diffuseColor *= sampledDiffuseColor;",
            `diffuseColor *= sampledDiffuseColor;
          #ifdef USE_MAP
            float leftEdge = 1.0 - smoothstep(0.002, 0.018, vMapUv.x);
            float rightEdge = smoothstep(0.982, 0.998, vMapUv.x);
            float flow = outlineFlowStart + vMapUv.x * outlineCardWidth;
            vec3 metal = outlineMetalColor(flow, vMapUv.y, vec3(0.6, 0.78, 1.0));
            diffuseColor.rgb += metal * 0.075 * (leftEdge + rightEdge * 0.6);
          #endif`,
          );
      };
      return value;
    };
    function buildTree(path: string, state: Tree["state"]) {
      const floater = floaters.get(path);
      if (!floater) return;
      const previous = trees.get(path);
      const restore =
        activePreview?.path === path
          ? { index: activePreview.index, offset: activePreview.offset }
          : null;
      if (restore) collapseRow();
      if (previous) {
        floater.body.remove(previous.group);
        previous.group.traverse((object) => {
          const pickIndex = pickables.indexOf(object);
          if (pickIndex >= 0) pickables.splice(pickIndex, 1);
          if (
            object instanceof THREE.Mesh ||
            object instanceof THREE.LineSegments
          ) {
            geometries.delete(object.geometry);
            object.geometry.dispose();
            const owned = object.material as THREE.Material & {
              map?: THREE.Texture | null;
            };
            if (owned === lineMaterial) return;
            if (owned.map) {
              textures.delete(owned.map);
              owned.map.dispose();
            }
            const nightMap = nightMaps.get(owned);
            if (nightMap) {
              textures.delete(nightMap);
              nightMap.dispose();
            }
            materials.delete(owned);
            owned.dispose();
          }
        });
      }
      const group = new THREE.Group();
      const structure = structures.get(path) ?? null;
      group.userData = { path, treePart: true };
      const parsedRows = spatialOutlineRows(
        structure,
        TREE_MAX_ROWS,
        TREE_MAX_DEPTH,
      );
      const rows: SpatialOutlineRow[] = parsedRows.length
        ? parsedRows
        : [
            {
              id: "empty",
              title:
                state === "loading"
                  ? "Reading structure…"
                  : "Not parsed yet — sections appear once indexed",
              page: 0,
              depth: 0,
              parent: -1,
              blocks: [],
            },
          ];
      // The outline hangs off a rail that starts at the sheet's right edge,
      // so it reads as part of the document rather than a separate panel.
      const top = floater.height / 2;
      const railY = top - 0.3;
      const rowTop = railY - TREE_ROW * 0.75;
      const place = (index: number) => ({
        x:
          Math.floor(index / TREE_ROWS_PER_COLUMN) * TREE_COLUMN +
          0.3 +
          rows[index].depth * TREE_INDENT,
        y: rowTop - (index % TREE_ROWS_PER_COLUMN) * TREE_ROW,
      });
      const columns = Math.max(
        1,
        Math.ceil(rows.length / TREE_ROWS_PER_COLUMN),
      );
      const flowGeometry = outlineFlowGeometry(rows, {
        railY,
        rowTop,
        rowHeight: TREE_ROW,
        rowsPerColumn: TREE_ROWS_PER_COLUMN,
        columnWidth: TREE_COLUMN,
        indent: TREE_INDENT,
        cardWidth: TREE_CARD_WIDTH,
        gap: TREE_GAP,
      });
      const chips: {
        row: number;
        x: number;
        y: number;
        color: string;
        metal: boolean;
        flow: number;
      }[] = [];
      const cards: Tree["cards"] = [];
      rows.forEach((row, index) => {
        const { x, y } = place(index);
        const width = TREE_CARD_WIDTH - row.depth * TREE_INDENT;
        const meta = row.page
          ? `p.${row.page}${row.blocks.length ? ` · ${row.blocks.length}` : ""}`
          : "";
        const accent = row.blockType ? blockColor(row.blockType) : undefined;
        const card = new THREE.Mesh(
          geometry(new THREE.PlaneGeometry(width, TREE_CARD_HEIGHT)),
          cardMaterial(
            cardTexture(row.title, meta, {
              dark: false,
              accent,
              icon: row.blockType ? blockIcon(row.blockType, false) : undefined,
              onUpdate: invalidate,
            }),
            cardTexture(row.title, meta, {
              dark: true,
              accent,
              icon: row.blockType ? blockIcon(row.blockType, true) : undefined,
              onUpdate: invalidate,
            }),
            flowGeometry.rowDistances[index] - 0.02,
            width,
          ),
        );
        card.position.set(x + width / 2, y, 0);
        card.renderOrder = 10;
        card.userData = { path, rowIndex: index };
        cards.push(card);
        if (row.page) pickables.push(card);
        group.add(card);
        const sampled =
          row.blocks.length <= BLOCK_CHIPS
            ? row.blocks
            : Array.from(
                { length: BLOCK_CHIPS },
                (_, i) =>
                  row.blocks[Math.floor((i / BLOCK_CHIPS) * row.blocks.length)],
              );
        sampled.forEach((block, i) =>
          chips.push({
            row: index,
            x: x + width + 0.1 + i * CHIP_STEP,
            y,
            color: blockColor(block.type),
            metal: i === 0,
            flow:
              flowGeometry.rowDistances[index] +
              width -
              0.02 +
              0.1 +
              i * CHIP_STEP,
          }),
        );
      });
      const connectorGeometry = geometry(
        new LineSegmentsGeometry().setPositions(flowGeometry.positions),
      );
      connectorGeometry.setAttribute(
        "instanceFlowStart",
        new THREE.InstancedBufferAttribute(
          new Float32Array(flowGeometry.starts),
          1,
        ),
      );
      connectorGeometry.setAttribute(
        "instanceFlowEnd",
        new THREE.InstancedBufferAttribute(
          new Float32Array(flowGeometry.ends),
          1,
        ),
      );
      const connectors = new LineSegments2(connectorGeometry, lineMaterial);
      connectors.userData = { path, treePart: true };
      pickables.push(connectors);
      connectors.frustumCulled = false;
      connectors.renderOrder = 9;
      group.add(connectors);
      let chipMesh: THREE.InstancedMesh | null = null;
      const chipMatrices: Tree["chipMatrices"] = rows.map(() => []);
      if (chips.length) {
        const chipGeometry = geometry(
          new THREE.PlaneGeometry(CHIP_WIDTH, 0.15),
        );
        chipGeometry.setAttribute(
          "instanceMetalness",
          new THREE.InstancedBufferAttribute(
            new Float32Array(chips.map((chip) => (chip.metal ? 1 : 0))),
            1,
          ),
        );
        chipGeometry.setAttribute(
          "instanceFlow",
          new THREE.InstancedBufferAttribute(
            new Float32Array(chips.map((chip) => chip.flow)),
            1,
          ),
        );
        chipMesh = new THREE.InstancedMesh(
          chipGeometry,
          material(
            new THREE.ShaderMaterial({
              uniforms: { outlineTime },
              toneMapped: false,
              vertexShader: `
              attribute float instanceMetalness;
              attribute float instanceFlow;
              varying vec2 vUv;
              varying vec3 vTint;
              varying float vMetal;
              varying float vFlow;
              void main() {
                vUv = uv; vTint = instanceColor; vMetal = instanceMetalness;
                vFlow = instanceFlow;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
              }`,
              fragmentShader: `
              ${OUTLINE_METAL_SHADER}
              varying vec2 vUv;
              varying vec3 vTint;
              varying float vMetal;
              varying float vFlow;
              void main() {
                vec2 p = abs(vUv - 0.5) * vec2(${CHIP_WIDTH.toFixed(3)}, 0.15) - vec2(${(CHIP_WIDTH / 2 - 0.012).toFixed(3)}, 0.063);
                if (length(max(p, 0.0)) + min(max(p.x, p.y), 0.0) > 0.012) discard;
                vec3 metal = vTint * 0.72 + outlineMetalColor(
                  vFlow + vUv.x * ${CHIP_WIDTH.toFixed(3)}, vUv.y,
                  vec3(0.85, 0.9, 1.0)
                ) * 0.32;
                gl_FragColor = vec4(mix(vTint * 1.3, metal, vMetal), 1.0);
                #include <colorspace_fragment>
              }`,
            }),
          ),
          chips.length,
        );
        const matrix = new THREE.Matrix4();
        const color = new THREE.Color();
        chips.forEach((chip, i) => {
          chipMesh!.setMatrixAt(i, matrix.makeTranslation(chip.x, chip.y, 0));
          chipMatrices[chip.row].push({ index: i, matrix: matrix.clone() });
          chipMesh!.setColorAt(i, color.set(chip.color));
        });
        chipMesh.userData = {
          path,
          treePart: true,
          rowIndices: chips.map((chip) => chip.row),
        };
        pickables.push(chipMesh);
        group.add(chipMesh);
        const glowMesh = new THREE.InstancedMesh(
          geometry(new THREE.PlaneGeometry(0.1, 0.22)),
          material(
            new THREE.ShaderMaterial({
              uniforms: { glowNight: themeNight },
              transparent: true,
              depthWrite: false,
              toneMapped: false,
              blending: THREE.AdditiveBlending,
              vertexShader: `varying vec2 vUv; varying vec3 vTint;
              void main() { vUv = uv; vTint = instanceColor;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
              fragmentShader: `uniform float glowNight; varying vec2 vUv; varying vec3 vTint;
              void main() {
                vec2 p = (vUv - 0.5) * vec2(2.5, 1.8);
                float glow = exp(-dot(p, p) * 4.0) * (1.0 - smoothstep(0.15, 0.5, abs(vUv.y - 0.5)));
                gl_FragColor = vec4(vTint, glow * mix(0.06, 0.14, glowNight));
                #include <colorspace_fragment>
              }`,
            }),
          ),
          chips.length,
        );
        chips.forEach((chip, i) => {
          glowMesh.setMatrixAt(
            i,
            matrix.makeTranslation(chip.x, chip.y, 0.001),
          );
          glowMesh.setColorAt(i, color.set(chip.color));
        });
        group.add(glowMesh);
      }
      const width =
        (columns - 1) * TREE_COLUMN +
        TREE_CARD_WIDTH +
        0.3 +
        (chips.length ? 0.1 + BLOCK_CHIPS * CHIP_STEP + 0.1 : 0);
      const height = Math.max(
        floater.height,
        0.4 + Math.min(rows.length, TREE_ROWS_PER_COLUMN) * TREE_ROW,
      );
      group.position.set(floater.width / 2 + TREE_GAP, 0, 0.02);
      group.scale.set(previous?.reveal ?? 0.001, 1, 1);
      group.visible = (previous?.reveal ?? 0) > 0.01;
      floater.body.add(group);
      trees.set(path, {
        path,
        group,
        width,
        height,
        reveal: previous?.reveal ?? 0,
        state,
        rows,
        cards,
        chips: chipMesh,
        chipMatrices,
        baseWidth: width,
        baseHeight: height,
        flowStarts: flowGeometry.rowDistances,
      });
      if (latest.current.selectedPath === path)
        setOutlineRows({ path, rows: parsedRows });
      if (restore) selectRow(path, restore.index, restore.offset);
    }

    function disposePreviewGroup(group: THREE.Group) {
      group.removeFromParent();
      group.traverse((object) => {
        const pickIndex = pickables.indexOf(object);
        if (pickIndex >= 0) pickables.splice(pickIndex, 1);
        if (!(object instanceof THREE.Mesh)) return;
        if (geometries.delete(object.geometry)) object.geometry.dispose();
        const owned = object.material as THREE.Material & {
          map?: THREE.Texture | null;
        };
        if (owned === outline || owned === lineMaterial) return;
        if (owned.map && textures.delete(owned.map)) owned.map.dispose();
        const nightMap = nightMaps.get(owned);
        if (nightMap && textures.delete(nightMap)) nightMap.dispose();
        if (materials.delete(owned)) owned.dispose();
      });
    }

    function collapseRow() {
      const preview = activePreview;
      activePreview = null;
      if (preview) {
        preview.controller.abort();
        disposePreviewGroup(preview.group);
        for (const map of preview.maps) if (textures.delete(map)) map.dispose();
        preview.pages.forEach((page) => page.release());
        const tree = trees.get(preview.path);
        if (tree) {
          tree.width = tree.baseWidth;
          tree.height = tree.baseHeight;
          tree.cards[preview.index]?.material.color.set("#ffffff");
          for (const chip of tree.chipMatrices[preview.index] ?? [])
            tree.chips?.setMatrixAt(chip.index, chip.matrix);
          if (tree.chips) tree.chips.instanceMatrix.needsUpdate = true;
        }
      }
      setExpandedRow(null);
      badgeElements.current.forEach((element) => {
        element.style.visibility = "hidden";
      });
      setPreviewBadges([]);
      invalidate();
    }

    function selectRow(path: string, index: number, batchOffset?: number) {
      const offset = batchOffset ?? 0;
      const tree = trees.get(path);
      const row = tree?.rows[index];
      const entry = latest.current.items.find((item) => item.path === path);
      if (
        !tree ||
        !row ||
        !row.page ||
        entry?.kind !== "file" ||
        latest.current.selectedPath !== path
      )
        return;
      flight = null;
      interacted = true;
      window.clearTimeout(reframeTimer);
      const toggle =
        activePreview?.path === path &&
        activePreview.index === index &&
        batchOffset === undefined;
      collapseRow();
      if (toggle) return;
      const group = new THREE.Group();
      group.userData.path = path;
      tree.group.add(group);
      const origin = tree.cards[index].position.clone();
      group.position.copy(origin);
      group.scale.setScalar(0.001);
      const controller = new AbortController();
      const preview = {
        path,
        index,
        offset,
        group,
        controller,
        pages: [] as SpatialThumbnail[],
        maps: [] as THREE.Texture[],
        reveal: 0,
        origin,
        badges: [] as {
          id: string;
          type: string;
          page: number;
          label: THREE.Object3D;
          width: number;
        }[],
      };
      activePreview = preview;
      tree.cards[index].material.color.set("#a4c7ff");
      for (const chip of tree.chipMatrices[index])
        tree.chips?.setMatrixAt(
          chip.index,
          new THREE.Matrix4().makeScale(0, 0, 0),
        );
      if (tree.chips) tree.chips.instanceMatrix.needsUpdate = true;
      const blocks = row.blocks.slice(offset, offset + SPATIAL_BLOCK_BATCH);
      setExpandedRow({
        path,
        index,
        title: row.title,
        offset,
        total: row.blocks.length,
        loading: true,
      });

      async function loadCrops() {
        if (controller.signal.aborted || disposed) return;
        let pages = new Map<number, SpatialThumbnail>();
        if (
          entry?.kind === "file" &&
          entry.url &&
          blocks.some((block) => spatialBlockCrop(block))
        ) {
          try {
            const { renderSpatialPages } =
              await import("../lib/spatial-thumbnail-renderer");
            pages = await renderSpatialPages(
              entry.url,
              entry.path,
              blocks
                .filter((block) => spatialBlockCrop(block))
                .map((block) => block.page),
              controller.signal,
            );
          } catch {
            if (controller.signal.aborted) return;
          }
        }
        if (
          disposed ||
          activePreview !== preview ||
          controller.signal.aborted
        ) {
          pages.forEach((page) => page.release());
          return;
        }
        preview.pages = [...pages.values()];
        const pageMaps = new Map<number, THREE.Texture>();
        for (const [page, asset] of pages) {
          try {
            const map = await textureLoader.loadAsync(asset.url);
            if (
              disposed ||
              activePreview !== preview ||
              controller.signal.aborted
            ) {
              map.dispose();
              pageMaps.forEach((value) => {
                textures.delete(value);
                value.dispose();
              });
              return;
            }
            map.colorSpace = THREE.SRGBColorSpace;
            pageMaps.set(page, texture(map));
            preview.maps.push(map);
          } catch {
            /* OCR text remains available when a page image cannot load. */
          }
        }
        if (disposed || activePreview !== preview || controller.signal.aborted)
          return;
        const branchX = tree!.baseWidth + 0.5;
        const blockWidth = PREVIEW_CARD_WIDTH;
        const top = origin.y + 0.35;
        const columnY = [top, top];
        const routes: [number, number][][] = [];
        const cardDayMap = texture(blockCardTexture(false));
        const cardNightMap = texture(blockCardTexture(true));
        preview.maps.push(cardDayMap, cardNightMap);
        let maxRight = branchX;
        let bottom = top;
        const addBlock = (block: ParsedBlock, i: number) => {
          const pageMap = pageMaps.get(block.page);
          const crop = pageMap
            ? spatialBlockCrop(block, pages.get(block.page)?.rotation)
            : null;
          const image = pageMap?.image as
            { width: number; height: number } | undefined;
          const map = crop ? pageMap! : texture(ocrTextTexture(block));
          const aspect =
            crop && image
              ? (image.width * crop.width) / (image.height * crop.height)
              : 960 / 540;
          const contentWidth = blockWidth - PREVIEW_PADDING * 2;
          const imageHeight = Math.min(contentWidth / aspect, 2.25);
          const imageWidth = Math.min(contentWidth, imageHeight * aspect);
          const cardHeight =
            imageHeight +
            PREVIEW_PADDING * 2 +
            PREVIEW_FOOTER_HEIGHT +
            PREVIEW_FOOTER_GAP;
          const column = i % 2;
          const x = branchX + column * (blockWidth + 0.42);
          const y = columnY[column] - cardHeight / 2;
          const card = new THREE.Mesh(
            geometry(
              new THREE.ShapeGeometry(
                roundedRectPath(
                  new THREE.Shape(),
                  blockWidth,
                  cardHeight,
                  0.07,
                ),
                12,
              ),
            ),
            themeMap(
              material(
                new THREE.MeshBasicMaterial({
                  map: cardDayMap,
                  toneMapped: false,
                  fog: false,
                }),
              ),
              cardNightMap,
            ),
          );
          card.position.set(x + blockWidth / 2, y, 0.18 + i * 0.008);
          card.userData = { path, previewBlock: true };
          pickables.push(card);
          group.add(card);
          const shape = geometry(
            new THREE.ShapeGeometry(
              roundedRectPath(new THREE.Shape(), imageWidth, imageHeight, 0.04),
              12,
            ),
          );
          const positions = shape.getAttribute("position");
          const uv = shape.getAttribute("uv");
          for (let vertex = 0; vertex < uv.count; vertex++) {
            const u = positions.getX(vertex) / imageWidth + 0.5;
            const v = positions.getY(vertex) / imageHeight + 0.5;
            uv.setXY(
              vertex,
              crop ? crop.left + u * crop.width : u,
              crop ? 1 - crop.top - crop.height + v * crop.height : v,
            );
          }
          const content = new THREE.Mesh(
            shape,
            material(
              new THREE.MeshBasicMaterial({
                map,
                toneMapped: false,
                side: THREE.DoubleSide,
              }),
            ),
          );
          content.position.set(
            0,
            cardHeight / 2 - PREVIEW_PADDING - imageHeight / 2,
            0.006,
          );
          card.add(content);
          const frame = new THREE.Mesh(
            geometry(roundedRing(blockWidth, cardHeight)),
            outline,
          );
          frame.position.z = 0.01;
          card.add(frame);
          const label = new THREE.Object3D();
          label.position.set(
            -blockWidth / 2 + PREVIEW_PADDING,
            -cardHeight / 2 + PREVIEW_PADDING + PREVIEW_FOOTER_HEIGHT / 2,
            0.012,
          );
          card.add(label);
          preview.badges.push({
            id: `${path}:${index}:${offset + i}`,
            type: block.type,
            page: block.page,
            label,
            width: contentWidth,
          });
          const start: [number, number] = [
            origin.x + tree!.cards[index].geometry.parameters.width / 2,
            origin.y,
          ];
          const spine = branchX - 0.22;
          const route: [number, number][] = [start, [spine, origin.y]];
          if (column)
            route.push(
              [spine, top + 0.22],
              [x - 0.21, top + 0.22],
              [x - 0.21, y],
            );
          else route.push([spine, y]);
          route.push([x - 0.009, y]);
          routes.push(route);
          columnY[column] = y - cardHeight / 2 - 0.3;
          maxRight = Math.max(maxRight, x + blockWidth);
          bottom = Math.min(bottom, columnY[column]);
        };
        blocks.forEach(addBlock);
        setPreviewBadges(
          preview.badges.map(({ id, type, page }) => ({ id, type, page })),
        );
        if (!blocks.length) {
          const empty = new THREE.Mesh(
            geometry(new THREE.PlaneGeometry(2.9, 0.25)),
            cardMaterial(
              cardTexture("No OCR blocks in this section", "", { dark: false }),
              cardTexture("No OCR blocks in this section", "", { dark: true }),
              0,
              2.9,
            ),
          );
          empty.position.set(branchX + 1.45, origin.y, 0.18);
          group.add(empty);
          routes.push([
            [
              origin.x + tree!.cards[index].geometry.parameters.width / 2,
              origin.y,
            ],
            [branchX, origin.y],
          ]);
          maxRight = branchX + 2.9;
        }
        const flow = outlineRouteFlowGeometry(
          routes,
          tree!.flowStarts[index] +
            tree!.cards[index].geometry.parameters.width -
            0.02,
        );
        const connectorGeometry = geometry(
          new LineSegmentsGeometry().setPositions(flow.positions),
        );
        connectorGeometry.setAttribute(
          "instanceFlowStart",
          new THREE.InstancedBufferAttribute(new Float32Array(flow.starts), 1),
        );
        connectorGeometry.setAttribute(
          "instanceFlowEnd",
          new THREE.InstancedBufferAttribute(new Float32Array(flow.ends), 1),
        );
        const connector = new LineSegments2(connectorGeometry, lineMaterial);
        connector.frustumCulled = false;
        connector.userData = { path, treePart: true };
        pickables.push(connector);
        group.add(connector);
        tree!.width = maxRight;
        tree!.height = Math.max(
          tree!.baseHeight,
          floaters.get(path)!.height / 2 - bottom,
        );
        setExpandedRow({
          path,
          index,
          title: row!.title,
          offset,
          total: row!.blocks.length,
          loading: false,
        });
        invalidate();
        focus(path);
      }
      cropLoad = cropLoad.then(loadCrops).catch(() => {
        if (!disposed && activePreview === preview) collapseRow();
      });
      invalidate();
    }
    function requestStructure(path: string) {
      if (requested.has(path)) return;
      requested.add(path);
      const entry = latest.current.items.find((item) => item.path === path);
      const load = latest.current.loadDocumentStructure;
      if (entry?.kind !== "file" || !load) {
        structures.set(path, null);
        buildTree(path, "ready");
        return;
      }
      buildTree(path, "loading");
      void load(entry)
        .catch(() => null)
        .then((value) => {
          if (disposed) return;
          structures.set(path, value);
          buildTree(path, "ready");
          if (latest.current.selectedPath === path && !interacted) focus(path);
        });
    }

    let disposed = false;
    let frame = 0;
    let interacted = false;
    let flight: {
      start: number;
      duration: number;
      from: THREE.Vector3;
      to: THREE.Vector3;
      fromTarget: THREE.Vector3;
      target: THREE.Vector3;
    } | null = null;
    let hovered: string | undefined;
    let treePath: string | null = null;
    let thumbTimer = 0;
    let reframeTimer = 0;
    const pending = new Set<string>();
    const loaded = new Set<string>();
    const attempted = new Set<string>();
    let activeLoads = 0;
    const textureLoader = new THREE.TextureLoader();
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    let reducedMotion = motionPreference.matches;
    const projected = new THREE.Vector3();
    const badgeCenter = new THREE.Vector3();
    const processingProjection = new THREE.Matrix4();
    const processingScreen = new THREE.Matrix4();
    const processingLocal = new THREE.Matrix4().set(
      0.01,
      0,
      0,
      -SHEET_WIDTH / 2,
      0,
      -0.01,
      0,
      SHEET_HEIGHT / 2,
      0,
      0,
      1,
      0.002,
      0,
      0,
      0,
      1,
    );
    const badgeTop = new THREE.Vector3();
    const badgeRight = new THREE.Vector3();
    const worldPoint = new THREE.Vector3();
    const cameraUp = new THREE.Vector3();
    const cameraRight = new THREE.Vector3();
    const sway = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const keys = new Set<string>();
    let focusDistance = 30;
    let lastTime = performance.now();
    const width = () => Math.max(1, container.clientWidth);
    const height = () => Math.max(1, container.clientHeight);
    const smallMaps = new Map<string, THREE.Texture>();
    const detailMaps = new Map<string, THREE.Texture>();
    const placeholderMaps = new Map(
      [...floaters.values()].flatMap((floater) =>
        floater.cover?.material.map
          ? [[floater.node.path, floater.cover.material.map] as const]
          : [],
      ),
    );
    let nextDetailCheck = 0;

    function reportThumbnail(
      path: string,
      map: THREE.Texture,
      quality: string,
    ) {
      if (!container) return;
      const image = map.image as { width?: number; height?: number };
      const button = [
        ...(container.parentElement?.querySelectorAll<HTMLElement>(
          "[data-entry-path]",
        ) ?? []),
      ].find((item) => item.dataset.entryPath === path);
      if (button) {
        button.dataset.thumbnailQuality = quality;
        button.dataset.thumbnailSize = `${image.width ?? 0}x${image.height ?? 0}`;
      }
      container.dataset.smallThumbnails = String(smallMaps.size);
      container.dataset.detailThumbnails = String(detailMaps.size);
    }
    function applyThumbnail(path: string, map: THREE.Texture, quality: string) {
      const cover = floaters.get(path)?.cover;
      if (!cover) return;
      cover.material.map = map;
      cover.material.needsUpdate = true;
      reportThumbnail(path, map, quality);
    }
    const detailQueue = createDetailThumbnailQueue<THREE.Texture>({
      async load(path, signal) {
        const entry = latest.current.items.find((item) => item.path === path);
        if (entry?.kind !== "file" || !latest.current.loadDetailThumbnail)
          return null;
        const preview = await latest.current.loadDetailThumbnail(entry, signal);
        if (!preview) return null;
        try {
          signal.throwIfAborted();
          const map = await textureLoader.loadAsync(preview.url);
          if (signal.aborted || disposed) {
            map.dispose();
            return null;
          }
          map.colorSpace = THREE.SRGBColorSpace;
          return texture(map);
        } finally {
          preview.release();
        }
      },
      apply(path, map) {
        if (map) detailMaps.set(path, map);
        else detailMaps.delete(path);
        const next = map ?? smallMaps.get(path) ?? placeholderMaps.get(path);
        if (next) applyThumbnail(path, next, map ? "detail" : "small");
      },
      dispose(map) {
        textures.delete(map);
        map.dispose();
      },
    });
    function updateDetailThumbnails() {
      if (!latest.current.loadDetailThumbnail) return;
      const candidates = [];
      for (const floater of floaters.values()) {
        if (floater.node.kind !== "file") continue;
        projected.copy(floater.group.position).project(camera);
        worldPoint
          .copy(floater.group.position)
          .applyMatrix4(camera.matrixWorldInverse);
        const depth = -worldPoint.z;
        candidates.push({
          path: floater.node.path,
          visible:
            projected.z > -1 &&
            projected.z < 1 &&
            Math.abs(projected.x) < 1.1 &&
            Math.abs(projected.y) < 1.1,
          focused:
            (floater.node.path === latest.current.selectedPath && depth < 45) ||
            floater.node.path === treePath,
          pixels:
            depth > 0
              ? (floater.height * height() * pixelRatio) /
                (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))
              : 0,
          distance: depth,
        });
      }
      const desired = detailThumbnailCandidates(candidates);
      for (const path of desired) queueThumbnail(path);
      detailQueue.update(desired);
    }

    function queueThumbnail(path: string) {
      if (
        activeLoads >= 6 ||
        loaded.has(path) ||
        pending.has(path) ||
        attempted.has(path)
      )
        return;
      const entry = latest.current.items.find((item) => item.path === path);
      if (entry?.kind !== "file") return;
      const known =
        thumbnailCache.current.get(path) ??
        entry.previewImageUrl ??
        entry.previewImageUrls?.[0];
      if (!known && !latest.current.loadPreviewImageUrl) return;
      pending.add(path);
      activeLoads++;
      void (
        known
          ? Promise.resolve(known)
          : latest.current.loadPreviewImageUrl!(entry, 0)
      )
        .then(async (url) => {
          if (disposed || !url) return;
          thumbnailCache.current.set(path, url);
          const map = await textureLoader.loadAsync(url);
          if (disposed) {
            map.dispose();
            return;
          }
          map.colorSpace = THREE.SRGBColorSpace;
          texture(map);
          const floater = floaters.get(path);
          if (floater?.cover) {
            const previous = placeholderMaps.get(path);
            if (previous) {
              textures.delete(previous);
              previous.dispose();
              placeholderMaps.delete(path);
            }
            smallMaps.set(path, map);
            if (!detailMaps.has(path)) {
              applyThumbnail(path, map, "small");
            }
            const image = map.image as { width?: number; height?: number };
            const aspect =
              image.width && image.height ? image.width / image.height : 0.75;
            // Landscape pages (slides, sheets) widen instead of squashing.
            const w =
              aspect >= 0.75
                ? Math.min(3.6, SHEET_HEIGHT * aspect)
                : SHEET_WIDTH;
            const h = aspect >= 0.75 ? w / aspect : SHEET_HEIGHT;
            for (const mesh of floater.sheets)
              mesh.scale.set(w / SHEET_WIDTH, h / SHEET_HEIGHT, 1);
            floater.width = w;
            floater.height = h;
            placeLabel(floater);
            if (trees.has(path)) buildTree(path, trees.get(path)!.state);
            loaded.add(path);
          }
        })
        .catch(() => {})
        .finally(() => {
          pending.delete(path);
          attempted.add(path);
          activeLoads--;
          if (!disposed) scheduleThumbnails();
        });
    }
    function scheduleThumbnails() {
      if (thumbTimer) return;
      thumbTimer = window.setTimeout(() => {
        thumbTimer = 0;
        if (disposed) return;
        const candidates = [...floaters.values()].flatMap(({ node, base }) => {
          if (node.kind !== "file") return [];
          projected.copy(base).project(camera);
          return [
            {
              path: node.path,
              focused: node.path === latest.current.selectedPath,
              visible:
                projected.z < 1 &&
                projected.z > -1 &&
                Math.abs(projected.x) < 1.1 &&
                Math.abs(projected.y) < 1.1,
              distance: base.distanceToSquared(camera.position),
            },
          ];
        });
        for (const path of smallThumbnailCandidates(
          candidates,
          attempted,
          pending,
        )) {
          if (activeLoads >= 6) break;
          queueThumbnail(path);
        }
      }, 30);
    }

    function pickTreeDocument() {
      const selected = floaters.get(latest.current.selectedPath ?? "\0");
      return selected?.node.kind === "file" ? selected.node.path : null;
    }

    const focusBounds = new THREE.Box3();
    const candidateBounds = new THREE.Box3();
    const viewMatrix = new THREE.Matrix4();
    const blurWorldScale = new THREE.Vector3();
    const warmTarget = new THREE.Vector3();
    const warmOffset = new THREE.Vector3();
    const skyLightDay = new THREE.Color("#f0f3f6"),
      skyLightNight = new THREE.Color("#c9d6e8");
    const groundDay = new THREE.Color("#c7cdd2"),
      groundNight = new THREE.Color("#7c8ba4");
    const sunDay = new THREE.Color(THEME_SUN_COLORS.day),
      sunDusk = new THREE.Color(THEME_SUN_COLORS.dusk);
    const lanternDay = new THREE.Color("#fff3df"),
      lanternNight = new THREE.Color("#bccfff");
    const paperDay = new THREE.Color("#fbfaf6"),
      paperNight = new THREE.Color("#d7dfeb");
    const particleDay = new THREE.Color("#8292a2"),
      particleNight = new THREE.Color("#e0ecff");
    const lineDay = new THREE.Color("#8295b8"),
      lineNight = new THREE.Color("#8ba4d4");
    const folderDay = new THREE.Color("#a3aec3"),
      folderNight = new THREE.Color("#5b6788");
    let appliedTheme = -1;
    const sharedFadeMaterials = new Set<THREE.Material>([
      ...stackMaterials,
      folderMaterial,
      outline,
      lineMaterial,
    ]);
    const opacityDefaults = new WeakMap<
      THREE.Material,
      {
        opacity: number;
        transparent: boolean;
        depthWrite: boolean;
        alphaTest: number;
        alphaToCoverage: boolean;
        blurStep: { value: THREE.Vector2 };
      }
    >();
    function setOccluded(floater: Floater, occluded: boolean, delta: number) {
      floater.occluded = occluded;
      const goal = occluded ? FOREGROUND_OPACITY : 1;
      const previous = floater.opacity;
      floater.opacity +=
        (goal - floater.opacity) *
        (reducedMotion ? 1 : 1 - Math.exp(-delta * 10));
      if (Math.abs(goal - floater.opacity) < 0.001) floater.opacity = goal;
      if (floater.opacity === previous && floater.opacity === 1) return;
      const fading = floater.opacity < 1;
      worldPoint
        .copy(floater.group.position)
        .applyMatrix4(camera.matrixWorldInverse);
      const pixelsPerUnit =
        height() /
        (2 *
          Math.max(camera.near, -worldPoint.z) *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      floater.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        let value = object.material as THREE.Material;
        if (fading && sharedFadeMaterials.has(value)) {
          const original = value;
          value = material(value.clone());
          value.onBeforeCompile = original.onBeforeCompile;
          object.material = value;
          if (value instanceof LineMaterial) lineMaterials.add(value);
        }
        if (fading && !opacityDefaults.has(value)) {
          const original = {
            opacity: value.opacity,
            transparent: value.transparent,
            depthWrite: value.depthWrite,
            alphaTest: value.alphaTest,
            alphaToCoverage: value.alphaToCoverage,
            blurStep: { value: new THREE.Vector2() },
          };
          opacityDefaults.set(value, original);
          if ("map" in value) {
            const compile = value.onBeforeCompile;
            value.onBeforeCompile = (shader, renderer) => {
              compile.call(value, shader, renderer);
              shader.uniforms.foregroundBlurStep = original.blurStep;
              shader.fragmentShader = shader.fragmentShader
                .replace(
                  "#include <map_pars_fragment>",
                  `#include <map_pars_fragment>\n${FOREGROUND_MAP_BLUR}`,
                )
                .replace(
                  "#include <map_fragment>",
                  THREE.ShaderChunk.map_fragment.replace(
                    "texture2D( map, vMapUv )",
                    "sampleForegroundMap( vMapUv )",
                  ),
                );
            };
            value.needsUpdate = true;
          }
        }
        const original = opacityDefaults.get(value);
        if (!original) return;
        const transparent = fading || original.transparent;
        const alphaToCoverage = !fading && original.alphaToCoverage;
        if (
          value.transparent !== transparent ||
          value.alphaToCoverage !== alphaToCoverage
        ) {
          value.transparent = transparent;
          value.alphaToCoverage = alphaToCoverage;
          value.needsUpdate = true;
        }
        // Overlapping pages together retain the same total opacity.
        const opacity = floater.sheets.includes(object)
          ? 1 - Math.pow(1 - floater.opacity, 1 / floater.sheets.length)
          : floater.opacity;
        value.opacity = original.opacity * opacity;
        value.alphaTest = original.alphaTest * opacity;
        value.depthWrite = !fading && original.depthWrite;
        const blur = (2.5 * (1 - floater.opacity)) / (1 - FOREGROUND_OPACITY);
        const plane = object.geometry as THREE.PlaneGeometry;
        if (plane.parameters?.width && plane.parameters?.height) {
          object.getWorldScale(blurWorldScale);
          original.blurStep.value.set(
            blur /
              Math.max(
                1,
                plane.parameters.width * blurWorldScale.x * pixelsPerUnit,
              ),
            blur /
              Math.max(
                1,
                plane.parameters.height * blurWorldScale.y * pixelsPerUnit,
              ),
          );
        }
      });
    }
    function boundsInView(
      floater: Floater,
      bounds: THREE.Box3,
      withTree = false,
    ) {
      const halfWidth = (floater.width * floater.scale) / 2;
      const halfHeight = (floater.height * floater.scale) / 2;
      const stack = Math.max(0, floater.sheets.length - 1);
      const labelHalfWidth = floater.label.geometry.parameters.width / 2;
      bounds.min.set(
        Math.min(-halfWidth, -labelHalfWidth),
        floater.label.position.y - floater.label.geometry.parameters.height / 2,
        -stack * 0.06,
      );
      bounds.max.set(
        Math.max(halfWidth + stack * STACK_STEP, labelHalfWidth),
        halfHeight,
        0.02,
      );
      const tree = withTree ? trees.get(floater.node.path) : undefined;
      if (tree?.group.visible) {
        bounds.max.x = Math.max(
          bounds.max.x,
          halfWidth + TREE_GAP + tree.width,
        );
        bounds.min.y = Math.min(bounds.min.y, halfHeight - tree.height);
      }
      viewMatrix.multiplyMatrices(
        camera.matrixWorldInverse,
        floater.group.matrixWorld,
      );
      return bounds.applyMatrix4(viewMatrix);
    }
    function isPickable(object: THREE.Object3D) {
      for (
        let current: THREE.Object3D | null = object;
        current;
        current = current.parent
      ) {
        const floater = floaters.get(current.userData.path);
        if (
          !current.visible ||
          floater?.occluded ||
          (floater?.opacity ?? 1) < 1
        )
          return false;
      }
      return true;
    }

    function draw(now: number) {
      frame = 0;
      if (disposed) return;
      const delta = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const time = reducedMotion ? 0 : now / 1000;
      outlineTime.value = time;
      themeProgress = themeProgressAt(now);
      if (appliedTheme !== themeProgress) {
        appliedTheme = themeProgress;
        themeNight.value = themeProgress;
        const sunset = themeSunset(themeProgress);
        const daylight =
          1 - THREE.MathUtils.smoothstep(themeProgress, 0.2, 0.85);
        const moonrise = THREE.MathUtils.smoothstep(themeProgress, 0.45, 1);
        const mixSky = (color: THREE.Color, part: "top" | "haze" | "bottom") =>
          color
            .lerpColors(
              skyColors.day[part],
              skyColors.night[part],
              themeProgress,
            )
            .lerp(skyColors.dusk[part], sunset * 0.78);
        mixSky(sky.material.uniforms.top.value, "top");
        mixSky(sky.material.uniforms.middle.value, "haze");
        mixSky(sky.material.uniforms.bottom.value, "bottom");
        mixSky(fog.color, "haze");
        (scene.background as THREE.Color).copy(fog.color);
        hemisphere.color.lerpColors(skyLightDay, skyLightNight, themeProgress);
        hemisphere.groundColor.lerpColors(
          groundDay,
          groundNight,
          themeProgress,
        );
        hemisphere.intensity = 1.6 + 0.1 * themeProgress;
        key.color.lerpColors(sunDay, sunDusk, sunset);
        key.intensity = 1.0 * daylight;
        key.position.set(...themeSunDirection(themeProgress));
        sky.material.uniforms.sunDirection.value.copy(key.position);
        sky.material.uniforms.sunColor.value.copy(key.color);
        sky.material.uniforms.sunset.value = sunset;
        rim.intensity = 0.15 + moonrise * 1.35;
        rim.position.set(0.7, 1.7, 1.4);
        lantern.color.lerpColors(lanternDay, lanternNight, themeProgress);
        lantern.intensity = 12 - 2 * moonrise;
        drifters[0].light.intensity = 24 + 12 * moonrise;
        drifters[1].light.intensity = 14 * daylight + 5 * moonrise;
        drifters[2].light.intensity = 18 + 12 * moonrise;
        particleMaterial.opacity = 0.42 + 0.32 * themeProgress;
        particleGlowMaterial.opacity = themeProgress * 0.25;
        particleDayHaloMaterial.opacity = (1 - themeProgress) * 0.16;
        particleMaterial.color.lerpColors(
          particleDay,
          particleNight,
          themeProgress,
        );
        paperColor.lerpColors(paperDay, paperNight, themeProgress);
        stackMaterials.forEach((value, index) =>
          value.color.copy(paperColor).multiplyScalar(1 - index * 0.075),
        );
        for (const floater of floaters.values())
          floater.cover?.material.color.copy(paperColor);
        lineMaterial.color.lerpColors(lineDay, lineNight, themeProgress);
        folderLineMaterial.color.lerpColors(
          folderDay,
          folderNight,
          themeProgress,
        );
      }
      particleTime.value = time;
      if (keys.size) {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        const move = new THREE.Vector3();
        if (keys.has("w")) move.add(forward);
        if (keys.has("s")) move.sub(forward);
        if (keys.has("d")) move.add(cameraRight);
        if (keys.has("a")) move.sub(cameraRight);
        if (keys.has("e")) move.add(cameraUp);
        if (keys.has("q")) move.sub(cameraUp);
        if (move.lengthSq()) {
          move
            .normalize()
            .multiplyScalar(delta * Math.max(8, focusDistance * 0.9));
          camera.position.add(move);
          controls.target.add(move);
          flight = null;
          interacted = true;
          scheduleThumbnails();
        }
      }
      if (flight) {
        const progress = Math.min(1, (now - flight.start) / flight.duration);
        const eased =
          progress < 0.5
            ? 4 * progress ** 3
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        camera.position.lerpVectors(flight.from, flight.to, eased);
        controls.target.lerpVectors(flight.fromTarget, flight.target, eased);
        if (progress === 1) {
          flight = null;
          scheduleThumbnails();
        }
      }
      controls.update();
      // Keep the camera inside the space: flying out past the library's edge
      // slides camera and target back together.
      const outward = camera.position.distanceTo(room.center);
      if (outward > room.limit) {
        worldPoint
          .copy(camera.position)
          .sub(room.center)
          .multiplyScalar(1 - room.limit / outward);
        camera.position.sub(worldPoint);
        controls.target.sub(worldPoint);
      }

      const selectedPath = latest.current.selectedPath;
      const nextTree = pickTreeDocument();
      if (nextTree !== treePath) {
        collapseRow();
        treePath = nextTree;
        setOutlineRows(
          treePath
            ? {
                path: treePath,
                rows: spatialOutlineRows(
                  structures.get(treePath) ?? null,
                  TREE_MAX_ROWS,
                  TREE_MAX_DEPTH,
                ),
              }
            : null,
        );
        if (treePath) requestStructure(treePath);
      }
      if (activePreview) {
        activePreview.reveal = reducedMotion
          ? 1
          : activePreview.reveal +
            (1 - activePreview.reveal) * Math.min(1, delta * 8);
        if (1 - activePreview.reveal < 0.002) activePreview.reveal = 1;
        const reveal = Math.max(0.001, activePreview.reveal);
        activePreview.group.scale.setScalar(reveal);
        activePreview.group.position
          .copy(activePreview.origin)
          .multiplyScalar(1 - reveal);
      }
      if (now >= nextDetailCheck) {
        nextDetailCheck = now + 250;
        updateDetailThumbnails();
      }
      // Only one document's outline is ever shown: the rest vanish at once
      // rather than folding away alongside the new one.
      for (const tree of trees.values()) {
        if (tree.path !== treePath) {
          tree.reveal = 0;
          tree.group.visible = false;
          continue;
        }
        tree.reveal +=
          (1 - tree.reveal) * Math.min(1, delta * (reducedMotion ? 60 : 6));
        if (1 - tree.reveal < 0.002) tree.reveal = 1;
        tree.group.visible = tree.reveal > 0.01;
        const reveal = Math.max(0.001, tree.reveal);
        tree.group.scale.set(reveal, 1, 1);
        const floater = floaters.get(tree.path)!;
        tree.group.position.x = floater.width / 2 + TREE_GAP * reveal;
      }

      for (const floater of floaters.values()) {
        const { node, group, body, base } = floater;
        const focused = node.path === selectedPath || node.path === treePath;
        floater.calm +=
          ((focused ? 1 : 0) - floater.calm) * Math.min(1, delta * 3);
        floater.hover +=
          ((node.path === hovered ? 1 : 0) - floater.hover) *
          (reducedMotion ? 1 : Math.min(1, delta * 10));
        const drift = 1 - floater.calm;
        const phase = node.seed * Math.PI * 2;
        group.position.set(
          base.x + Math.sin(time * 0.21 + phase * 3) * 0.12 * drift,
          base.y + Math.sin(time * 0.43 + phase * 5) * 0.2 * drift,
          base.z + Math.cos(time * 0.17 + phase * 2) * 0.12 * drift,
        );
        euler.set(
          Math.sin(time * 0.31 + phase * 7) * 0.05 * drift,
          Math.sin(time * 0.23 + phase * 11) * 0.1 * drift,
          Math.sin(time * 0.19 + phase * 13) * 0.02 * drift,
        );
        group.quaternion
          .copy(camera.quaternion)
          .multiply(sway.setFromEuler(euler));
        if (floater.cover) {
          floater.cover.material.emissive.set("#3265ed");
          floater.cover.material.emissiveIntensity = floater.hover * 0.12;
        }
        if (floater.frame) floater.frame.visible = node.path === selectedPath;
        body.scale.setScalar(floater.scale);
      }

      // Branches leave the bottom of a folder and drop into the top of each
      // child, easing through the level between them.
      cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      scene.updateMatrixWorld(true);
      const selected = floaters.get(selectedPath ?? "\0");
      let selectedDepth: number | null = null;
      if (selected?.node.kind === "file") {
        projected.copy(selected.group.position).project(camera);
        if (
          projected.z > -1 &&
          projected.z < 1 &&
          Math.abs(projected.x) < 1.2 &&
          Math.abs(projected.y) < 1.2
        ) {
          boundsInView(selected, focusBounds, true);
          projected
            .copy(selected.group.position)
            .applyMatrix4(camera.matrixWorldInverse);
          selectedDepth = -projected.z;
        }
      }
      for (const floater of floaters.values()) {
        setOccluded(
          floater,
          selectedDepth !== null &&
            floater !== selected &&
            occludesSpatialFocus(
              focusBounds,
              boundsInView(floater, candidateBounds),
              camera.near,
            ),
          delta,
        );
      }
      if (pointerInside && !moving) {
        raycaster.setFromCamera(pointer, camera);
        updateHover(hoverHit());
      }
      links.forEach(([parent, child], i) => {
        parent.body.localToWorld(linkFrom.set(0, -parent.height / 2, 0));
        child.body.localToWorld(linkTo.set(0, child.height / 2, 0));
        linkVisibility.fill(
          Math.min(parent.opacity, child.opacity),
          i * LINK_SEGMENTS,
          (i + 1) * LINK_SEGMENTS,
        );
        const bend = Math.max(1, Math.abs(linkFrom.y - linkTo.y) * 0.55);
        bezier.v0.copy(linkFrom);
        bezier.v1.copy(linkFrom).addScaledVector(cameraUp, -bend);
        bezier.v2.copy(linkTo).addScaledVector(cameraUp, bend);
        bezier.v3.copy(linkTo);
        let offset = i * LINK_SEGMENTS * 6;
        bezier.getPoint(0, bezierPoint);
        for (let step = 1; step <= LINK_SEGMENTS; step++) {
          bezierPoint.toArray(linkPositions, offset);
          bezier.getPoint(step / LINK_SEGMENTS, bezierPoint);
          bezierPoint.toArray(linkPositions, offset + 3);
          offset += 6;
        }
      });
      (
        linkGeometry.attributes
          .instanceStart as THREE.InterleavedBufferAttribute
      ).data.needsUpdate = true;
      visibilityAttribute.needsUpdate = true;

      // Keep the selected depth sharp while its sightline is cleared.
      let focusGoal =
        selectedDepth ?? camera.position.distanceTo(controls.target);
      focusTargets.length = 0;
      focusTargets.push(...pickables.filter(isPickable));
      const openTree = treePath ? trees.get(treePath) : undefined;
      if (openTree && isPickable(openTree.group))
        for (const child of openTree.group.children)
          if (child instanceof THREE.Mesh && !(child instanceof LineSegments2))
            focusTargets.push(child);
      centerRay.setFromCamera(center, camera);
      const hit = centerRay.intersectObjects(focusTargets, false)[0];
      if (selectedDepth === null && hit && hit.distance >= 3)
        focusGoal = hit.distance;
      focusDistance +=
        (focusGoal - focusDistance) *
        (reducedMotion ? 1 : Math.min(1, delta * 4));
      focusDistance = Math.max(1.5, focusDistance);
      dofMaterial.uniforms.focus.value = focusDistance;
      dofMaterial.uniforms.aperture.value =
        8 * THREE.MathUtils.clamp(focusDistance / 10, 1, 4);
      fog.density = 0.85 / (focusDistance * 2.4 + 34);

      drifters.forEach(({ light, phase }, index) => {
        const t = time * 0.05 + phase;
        warmTarget.set(
          Math.cos(t) * extent * 0.6,
          Math.sin(t * 1.3 + index) * extent * 0.25,
          Math.sin(t) * extent * 0.6,
        );
        if (index === 1 && selected?.node.kind === "file") {
          warmOffset
            .set(1.2, 2.1, 4.5)
            .applyQuaternion(camera.quaternion)
            .add(selected.group.position);
          warmTarget.lerp(warmOffset, 0.78);
        }
        light.position.lerp(
          warmTarget,
          reducedMotion ? 1 : 1 - Math.exp(-delta * 2),
        );
      });

      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      quad.render(renderer);
      processingScreen.set(
        width() / 2,
        0,
        0,
        width() / 2,
        0,
        -height() / 2,
        0,
        height() / 2,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      );
      for (const [path, element] of processingElements.current) {
        const floater = floaters.get(path);
        const cover = floater?.cover;
        if (!floater || !cover || floater.occluded || floater.opacity < 1) {
          element.style.visibility = "hidden";
          continue;
        }
        projected.set(0, 0, 0).applyMatrix4(cover.matrixWorld).project(camera);
        const visible =
          floater.group.visible && projected.z > -1 && projected.z < 1;
        element.style.visibility = visible ? "visible" : "hidden";
        if (!visible) continue;
        processingProjection
          .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
          .multiply(cover.matrixWorld)
          .multiply(processingLocal)
          .premultiply(processingScreen);
        element.style.transform = `matrix3d(${processingProjection.elements.join(",")})`;
      }
      for (const [path, element] of statusElements.current) {
        const floater = floaters.get(path);
        if (!floater) {
          element.style.visibility = "hidden";
          continue;
        }
        const pinned = floater.node.kind === "folder";
        const corner = (pinned ? floater.label : floater.group)
          .localToWorld(
            pinned
              ? badgeCenter.copy(floater.pinPosition)
              : badgeCenter.set(floater.width / 2, -floater.height / 2, 0.01),
          )
          .project(camera);
        const visible =
          floater.group.visible &&
          corner.z >= -1 &&
          corner.z <= 1 &&
          Math.abs(corner.x) < 1 &&
          Math.abs(corner.y) < 1;
        element.style.visibility = visible ? "visible" : "hidden";
        element.style.opacity = String(floater.opacity);
        let pinScale = 1;
        if (pinned) {
          badgeTop.copy(floater.pinPosition);
          badgeTop.y += (floater.label.geometry.parameters.height * 20) / 124;
          const top = floater.label.localToWorld(badgeTop).project(camera);
          pinScale =
            Math.hypot(
              (top.x - corner.x) * width(),
              (top.y - corner.y) * height(),
            ) / 20;
        }
        element.style.transform = `translate(${(corner.x * 0.5 + 0.5) * width()}px, ${(-corner.y * 0.5 + 0.5) * height()}px) translate(${pinned ? "-50%, -50%" : "-100%, -100%"}) scale(${pinScale})`;
      }
      if (activePreview) {
        for (const badge of activePreview.badges) {
          const element = badgeElements.current.get(badge.id);
          if (!element) continue;
          const center = badge.label
            .localToWorld(badgeCenter.set(0, 0, 0.002))
            .project(camera);
          const top = badge.label
            .localToWorld(badgeTop.set(0, PREVIEW_FOOTER_HEIGHT / 2, 0.002))
            .project(camera);
          const right = badge.label
            .localToWorld(badgeRight.set(badge.width, 0, 0.002))
            .project(camera);
          const visible =
            activePreview.group.visible &&
            center.z >= -1 &&
            center.z <= 1 &&
            Math.abs(center.x) < 1.2 &&
            Math.abs(center.y) < 1.2;
          element.style.visibility = visible ? "visible" : "hidden";
          if (!visible) continue;
          const x = (center.x * 0.5 + 0.5) * width();
          const y = (-center.y * 0.5 + 0.5) * height();
          const rowHeight = Math.hypot(
            (top.x - center.x) * width(),
            (top.y - center.y) * height(),
          );
          const scale = (rowHeight * 0.62) / Math.max(1, element.offsetHeight);
          const rowWidth =
            Math.hypot(
              (right.x - center.x) * width(),
              (right.y - center.y) * height(),
            ) / 2;
          element.style.width = `${rowWidth / Math.max(0.0001, scale)}px`;
          const angle = Math.atan2(
            -(right.y - center.y) * height(),
            (right.x - center.x) * width(),
          );
          element.style.transform = `translate(${x}px, ${y}px) rotate(${angle}rad) scale(${scale}) translateY(-50%)`;
        }
      }
      if (!reducedMotion || flight || keys.size || moving) invalidate();
    }
    function invalidate() {
      if (!disposed && !frame) frame = requestAnimationFrame(draw);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = false;
    controls.rotateSpeed = 0.55;
    controls.panSpeed = 0.9;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = extent * 6;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    let moving = false;
    const centerRay = new THREE.Raycaster();
    const focusTargets: THREE.Object3D[] = [];
    const center = new THREE.Vector2(0, 0);

    function frameDocument(path: string) {
      const floater = floaters.get(path)!;
      const tree = trees.get(path);
      const treeWidth = tree?.width ?? TREE_CARD_WIDTH + 1.6;
      const contentWidth = floater.width + TREE_GAP + treeWidth;
      const contentHeight = Math.max(floater.height, tree?.height ?? 4) + 0.6;
      const fov = THREE.MathUtils.degToRad(camera.fov) / 2;
      const distance = Math.max(
        5,
        (contentHeight / 2 / Math.tan(fov)) * 1.12,
        (contentWidth / 2 / (Math.tan(fov) * camera.aspect)) * 1.12,
      );
      const direction = camera.getWorldDirection(new THREE.Vector3()).negate();
      if (!Number.isFinite(direction.x) || direction.lengthSq() < 0.5)
        direction.set(0, 0, 1);
      // Treat the view direction as the document's facing so its structure
      // unfolds to the right of the sheet.
      const right = new THREE.Vector3()
        .crossVectors(new THREE.Vector3(0, 1, 0), direction)
        .normalize();
      const up = new THREE.Vector3().crossVectors(direction, right).normalize();
      const treeTop = floater.height / 2;
      const treeBottom = treeTop - (tree?.height ?? 4);
      const verticalCenter =
        (Math.min(-floater.height / 2, treeBottom) + treeTop) / 2;
      const goal = floater.base
        .clone()
        .addScaledVector(right, -floater.width / 2 + contentWidth / 2)
        .addScaledVector(up, verticalCenter);
      return {
        goal,
        position: goal.clone().addScaledVector(direction, distance),
      };
    }
    function focus(path?: string) {
      const node = path === undefined ? null : floaters.get(path)?.node;
      let to: THREE.Vector3;
      let goal: THREE.Vector3;
      if (node?.kind === "file") {
        ({ goal, position: to } = frameDocument(node.path));
      } else {
        const branch = node
          ? visibleNodes.filter((item) => item.path.startsWith(node.path))
          : visibleNodes;
        const bounds = new THREE.Box3();
        branch.forEach((item) =>
          bounds.expandByPoint(worldPoint.set(...item.position)),
        );
        if (bounds.isEmpty()) bounds.expandByPoint(worldPoint.set(0, 0, 0));
        const sphere = bounds.getBoundingSphere(new THREE.Sphere());
        goal = sphere.center.clone();
        const fov = THREE.MathUtils.degToRad(camera.fov) / 2;
        const distance = Math.max(
          14,
          ((sphere.radius + 3) / Math.tan(fov) / Math.min(1, camera.aspect)) *
            0.9,
        );
        const direction = node
          ? camera.position.clone().sub(goal).normalize()
          : new THREE.Vector3(0.3, 0.5, 1).normalize();
        to = goal.clone().addScaledVector(direction, distance);
      }
      flyTo(goal, to);
    }
    function flyTo(goal: THREE.Vector3, to: THREE.Vector3, duration = 1100) {
      interacted = false;
      if (reducedMotion) {
        camera.position.copy(to);
        controls.target.copy(goal);
        flight = null;
      } else
        flight = {
          start: performance.now(),
          duration,
          from: camera.position.clone(),
          to,
          fromTarget: controls.target.clone(),
          target: goal,
        };
      invalidate();
      scheduleThumbnails();
    }
    function fly(amount: number, towards?: THREE.Vector3) {
      const direction =
        towards ?? camera.getWorldDirection(new THREE.Vector3());
      const step = direction.multiplyScalar(
        amount * Math.max(4, focusDistance),
      );
      camera.position.add(step);
      controls.target.add(step);
      flight = null;
      interacted = true;
      invalidate();
      scheduleThumbnails();
    }

    const resize = new ResizeObserver(() => {
      camera.aspect = width() / height();
      camera.updateProjectionMatrix();
      renderer.setSize(width(), height());
      for (const value of lineMaterials)
        value.resolution.set(width(), height());
      target.setSize(width() * pixelRatio, height() * pixelRatio);
      dofMaterial.uniforms.texel.value.set(
        1 / (width() * pixelRatio),
        1 / (height() * pixelRatio),
      );
      dofMaterial.uniforms.maxBlur.value = 10 * pixelRatio;
      // The sidebar opening narrows the scene; keep the selection framed.
      const selectedPath = latest.current.selectedPath;
      if (selectedPath && floaters.has(selectedPath) && !interacted) {
        window.clearTimeout(reframeTimer);
        reframeTimer = window.setTimeout(() => {
          if (!disposed && !interacted) focus(selectedPath);
        }, 120);
      }
      invalidate();
    });
    resize.observe(container);
    camera.aspect = width() / height();
    camera.updateProjectionMatrix();
    renderer.setSize(width(), height());
    for (const value of lineMaterials) value.resolution.set(width(), height());
    target.setSize(width() * pixelRatio, height() * pixelRatio);
    dofMaterial.uniforms.texel.value.set(
      1 / (width() * pixelRatio),
      1 / (height() * pixelRatio),
    );
    dofMaterial.uniforms.maxBlur.value = 10 * pixelRatio;
    // Open already inside the haze: the nearest documents drift past while
    // the rest of the library recedes into blur.
    const opening = new THREE.Vector3(0.3, 0.5, 1).normalize();
    const bounds = new THREE.Box3().expandByPoint(worldPoint.set(0, 0, 0));
    visibleNodes.forEach((node) =>
      bounds.expandByPoint(worldPoint.set(...node.position)),
    );
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    room.center.copy(sphere.center);
    room.limit = Math.max(60, sphere.radius * 3.2 + 30);
    controls.target.copy(sphere.center);
    camera.position
      .copy(opening)
      .multiplyScalar(
        Math.min(
          room.limit * 0.8,
          ((sphere.radius + 3) /
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
            Math.min(1, camera.aspect)) *
            0.62,
        ),
      )
      .add(sphere.center);
    camera.lookAt(controls.target);
    focusDistance = camera.position.distanceTo(controls.target);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line2 = { threshold: 6 };
    const pointer = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    let doubleClickTarget: ReturnType<typeof hit> | null = null;
    let draggingItem = false;
    function pointerRay(event: PointerEvent | MouseEvent | WheelEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster;
    }
    let pointerInside = false;
    const hoverRay = new THREE.Ray();
    const hoverInverse = new THREE.Matrix4();
    const hoverPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hoverPoint = new THREE.Vector3();
    function rayHit() {
      return rayPick().path;
    }
    function rayPick() {
      const hits = raycaster
        .intersectObjects(pickables, false)
        .filter((hit) => isPickable(hit.object));
      const picked =
        hits.find(
          (hit) =>
            typeof hit.object.userData.rowIndex === "number" &&
            hit.object.userData.path === latest.current.selectedPath,
        ) ??
        hits.find(
          (hit) =>
            hit.object.userData.path === latest.current.selectedPath &&
            (hit.object.userData.treePart || hit.object.userData.previewBlock),
        ) ??
        hits[0];
      let object: THREE.Object3D | null = picked?.object ?? null;
      while (object && object.userData.path === undefined)
        object = object.parent;
      return {
        path: object?.userData.path as string | undefined,
        rowIndex:
          picked?.instanceId === undefined
            ? object?.userData.rowIndex
            : object?.userData.rowIndices?.[picked.instanceId],
        treePart: Boolean(object?.userData.treePart),
        previewBlock: Boolean(object?.userData.previewBlock),
      };
    }
    function hit(event: PointerEvent | MouseEvent) {
      pointerRay(event);
      return rayPick();
    }
    function hoverHit() {
      const next = rayHit();
      if (next || !hovered) return next;
      const floater = floaters.get(hovered);
      if (!floater || floater.occluded || floater.opacity < 1) return next;
      projected
        .copy(floater.group.position)
        .applyMatrix4(camera.matrixWorldInverse);
      const depth = -projected.z;
      if (depth <= camera.near) return next;
      hoverRay
        .copy(raycaster.ray)
        .applyMatrix4(hoverInverse.copy(floater.group.matrixWorld).invert());
      if (!hoverRay.intersectPlane(hoverPlane, hoverPoint)) return next;
      const margin =
        (8 * (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)))) /
        height();
      return Math.abs(hoverPoint.x) <
        (floater.width * floater.scale) / 2 + margin &&
        Math.abs(hoverPoint.y) < (floater.height * floater.scale) / 2 + margin
        ? hovered
        : next;
    }
    function updateHover(next: string | undefined) {
      if (next !== hovered) {
        hovered = next;
        const surface = renderer.domElement.parentElement;
        if (surface && hovered) surface.dataset.entryPath = hovered;
        else if (surface) delete surface.dataset.entryPath;
        invalidate();
      }
      renderer.domElement.style.cursor = moving
        ? "grabbing"
        : hovered
          ? "pointer"
          : "grab";
    }
    function pointerDown(event: PointerEvent) {
      down = { x: event.clientX, y: event.clientY };
      flight = null;
      interacted = true;
      const target = hit(event);
      const dragPath =
        event.pointerType !== "touch" &&
        event.button === 0 &&
        !event.altKey &&
        !target.treePart &&
        !target.previewBlock &&
        typeof target.rowIndex !== "number"
          ? target.path
          : undefined;
      renderer.domElement.draggable = Boolean(dragPath);
      if (dragPath) renderer.domElement.dataset.entryPath = dragPath;
      else delete renderer.domElement.dataset.entryPath;
      controls.enabled = !dragPath;
      if (dragPath) {
        moving = false;
        updateHover(dragPath);
        return;
      }
      moving = true;
      updateHover(undefined);
      invalidate();
    }
    function pointerUp(event: PointerEvent) {
      controls.enabled = true;
      renderer.domElement.draggable = false;
      delete renderer.domElement.dataset.entryPath;
      moving = false;
      invalidate();
      if (
        !down ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 ||
        event.button !== 0
      )
        return;
      const target = hit(event);
      const path = target.path;
      if (path && typeof target.rowIndex === "number") {
        selectRow(path, target.rowIndex);
        return;
      }
      if (target.treePart || target.previewBlock) return;
      const entry = latest.current.items.find((item) => item.path === path);
      latest.current.onSelect(entry ?? null);
      invalidate();
    }
    function pointerMove(event: PointerEvent) {
      pointerInside = true;
      pointerRay(event);
      if (!event.buttons) updateHover(hoverHit());
    }
    function pointerLeave() {
      pointerInside = false;
      moving = false;
      updateHover(undefined);
      invalidate();
    }
    function dragStart(event: DragEvent) {
      if (
        event.defaultPrevented ||
        !event.dataTransfer?.types.includes(FINDER_DRAG_TYPE)
      )
        return;
      draggingItem = true;
      down = null;
      moving = false;
      controls.enabled = false;
    }
    function dragOver(event: DragEvent) {
      if (
        !event.dataTransfer ||
        !Array.from(event.dataTransfer.types).some(
          (type) => type === FINDER_DRAG_TYPE || type === "Files",
        )
      )
        return;
      const target = hit(event);
      const folder = latest.current.items.find(
        (item) => item.path === target.path && item.kind === "folder",
      );
      if (folder) renderer.domElement.dataset.entryPath = folder.path;
      else delete renderer.domElement.dataset.entryPath;
      updateHover(folder?.path);
    }
    function dragEnd() {
      draggingItem = false;
      down = null;
      moving = false;
      controls.enabled = true;
      renderer.domElement.draggable = false;
      delete renderer.domElement.dataset.entryPath;
      updateHover(undefined);
    }
    function pointerCancel() {
      if (!draggingItem) dragEnd();
    }
    function mouseDown(event: MouseEvent) {
      if (event.button === 0 && event.detail === 1)
        doubleClickTarget = hit(event);
    }
    function doubleClick(event: MouseEvent) {
      const target = doubleClickTarget ?? hit(event);
      doubleClickTarget = null;
      const path = target.path;
      if (target.treePart || typeof target.rowIndex === "number") return;
      const entry = latest.current.items.find((item) => item.path === path);
      if (entry) latest.current.onOpen(entry);
    }
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const scale =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const amount = THREE.MathUtils.clamp(
        (-event.deltaY * scale) / (event.ctrlKey ? 60 : 500),
        -0.6,
        0.6,
      );
      fly(amount, pointerRay(event).ray.direction.clone());
    }
    function keyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e"].includes(key)) return;
      event.preventDefault();
      keys.add(key);
      invalidate();
    }
    function keyUp(event: KeyboardEvent) {
      keys.delete(event.key.toLowerCase());
    }
    function blur() {
      keys.clear();
    }
    const changed = () => {
      invalidate();
      scheduleThumbnails();
    };
    const sunView = new THREE.Vector3();
    const unregisterSun = registerThemeSun((progress) => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      camera.updateMatrixWorld();
      sunView
        .set(...themeSunDirection(progress))
        .transformDirection(camera.matrixWorldInverse);
      const depth = Math.max(0.15, -sunView.z);
      const vertical =
        depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const x = sunView.x / (vertical * camera.aspect);
      const y = sunView.y / vertical;
      const edge = Math.max(1, Math.abs(x), Math.abs(y));
      return {
        x: rect.left + ((x / edge) * 0.5 + 0.5) * rect.width,
        y: rect.top + ((-y / edge) * 0.5 + 0.5) * rect.height,
      };
    });
    const unsubscribeTheme = subscribeThemeTransition(invalidate);
    const motionChanged = () => {
      reducedMotion = motionPreference.matches;
      invalidate();
    };
    motionPreference.addEventListener("change", motionChanged);
    const start = () => {
      flight = null;
      interacted = true;
    };
    controls.addEventListener("change", changed);
    controls.addEventListener("start", start);
    renderer.domElement.addEventListener("pointerdown", pointerDown, true);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerleave", pointerLeave);
    renderer.domElement.addEventListener("pointercancel", pointerCancel);
    renderer.domElement.addEventListener("dragstart", dragStart);
    renderer.domElement.addEventListener("dragover", dragOver);
    renderer.domElement.addEventListener("drop", dragOver);
    window.addEventListener("dragend", dragEnd);
    window.addEventListener("drop", dragEnd);
    window.addEventListener("blur", dragEnd);
    renderer.domElement.addEventListener("dblclick", doubleClick);
    renderer.domElement.addEventListener("mousedown", mouseDown);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });
    container.addEventListener("keydown", keyDown);
    container.addEventListener("keyup", keyUp);
    container.addEventListener("focusout", blur);
    handle.current = {
      focus,
      fly: (amount) => fly(amount),
      invalidate,
      selectRow,
      collapseRow,
    };
    void folderArt.ready.then(invalidate);
    if (
      latest.current.selectedPath &&
      floaters.has(latest.current.selectedPath)
    )
      focus(latest.current.selectedPath);
    invalidate();
    scheduleThumbnails();
    return () => {
      unregisterSun();
      unsubscribeTheme();
      motionPreference.removeEventListener("change", motionChanged);
      disposed = true;
      handle.current = null;
      cancelAnimationFrame(frame);
      window.clearTimeout(thumbTimer);
      window.clearTimeout(reframeTimer);
      detailQueue.dispose();
      activePreview?.controller.abort();
      activePreview?.pages.forEach((page) => page.release());
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown, true);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerleave", pointerLeave);
      renderer.domElement.removeEventListener("pointercancel", pointerCancel);
      renderer.domElement.removeEventListener("dragstart", dragStart);
      renderer.domElement.removeEventListener("dragover", dragOver);
      renderer.domElement.removeEventListener("drop", dragOver);
      window.removeEventListener("dragend", dragEnd);
      window.removeEventListener("drop", dragEnd);
      window.removeEventListener("blur", dragEnd);
      renderer.domElement.removeEventListener("dblclick", doubleClick);
      renderer.domElement.removeEventListener("mousedown", mouseDown);
      renderer.domElement.removeEventListener("wheel", wheel);
      container.removeEventListener("keydown", keyDown);
      container.removeEventListener("keyup", keyUp);
      container.removeEventListener("focusout", blur);
      geometries.forEach((value) => value.dispose());
      materials.forEach((value) => value.dispose());
      textures.forEach((value) => value.dispose());
      quad.dispose();
      target.depthTexture?.dispose();
      target.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [nodes, visibleNodes]);

  const previousSelection = useRef(props.selectedPath);
  useEffect(() => {
    if (previousSelection.current === props.selectedPath) return;
    previousSelection.current = props.selectedPath;
    if (props.selectedPath) handle.current?.focus(props.selectedPath);
    handle.current?.invalidate();
  }, [props.selectedPath]);

  function openNode(node: SpatialNode) {
    const entry = props.items.find((item) => item.path === node.path);
    if (entry) props.onOpen(entry);
  }

  return (
    <section
      className="library-space"
      style={
        {
          "--spatial-sidebar-width": `${props.sidebarWidth ?? 0}px`,
        } as React.CSSProperties
      }
      aria-label="3D library"
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLElement &&
          (event.target.closest("input, a") || event.target.isContentEditable)
        )
          return;
        if (event.key === "Escape") {
          if (expandedRow) handle.current?.collapseRow();
          else props.onSelect(null);
        } else if (event.key === "Home" || event.key.toLowerCase() === "r")
          handle.current?.focus();
        else if (event.key === "+" || event.key === "=")
          handle.current?.fly(0.35);
        else if (event.key === "-") handle.current?.fly(-0.35);
        else if (event.key.toLowerCase() === "f" && props.selectedPath)
          handle.current?.focus(props.selectedPath);
        else if (
          event.target === host.current &&
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        ) {
          event.preventDefault();
          const index = visibleNodes.findIndex(
            (node) => node.path === props.selectedPath,
          );
          const next =
            visibleNodes[
              (index +
                (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
                visibleNodes.length) %
                visibleNodes.length
            ];
          if (next)
            props.onSelect(
              props.items.find((item) => item.path === next.path) ?? null,
            );
        } else if (event.key === "Enter" && event.target === host.current) {
          const selected = visibleNodes.find(
            (node) => node.path === props.selectedPath,
          );
          if (selected) openNode(selected);
        }
      }}
    >
      <div
        ref={host}
        className="library-space-canvas"
        tabIndex={0}
        role="group"
        aria-label="Interactive library space"
        aria-describedby="spatial-controls-help"
      >
        <div className="library-space-processing-thumbnails">
          {props.items
            .filter(
              (item) =>
                item.kind === "file" &&
                isDocumentProcessing(item.metadata?.Index),
            )
            .map((item) => (
              <span
                key={item.path}
                className="library-space-processing-thumbnail"
                ref={(element) => {
                  if (element)
                    processingElements.current.set(item.path, element);
                  else processingElements.current.delete(item.path);
                  handle.current?.invalidate();
                }}
              >
                <DocumentProcessingOverlay />
              </span>
            ))}
        </div>
        <div className="library-space-index-statuses">
          {props.items
            .filter((item) =>
              item.kind === "folder"
                ? item.pinned
                : needsIndexAttention(item.metadata?.Index),
            )
            .map((item) => (
              <span
                key={item.path}
                className="library-space-index-status"
                data-entry-path={item.path}
                style={
                  item.kind === "folder"
                    ? { display: "flex", alignItems: "center" }
                    : undefined
                }
                onClick={
                  item.kind === "folder"
                    ? () => props.onSelect(item)
                    : undefined
                }
                onDoubleClick={
                  item.kind === "folder" ? () => props.onOpen(item) : undefined
                }
                ref={(element) => {
                  if (element) statusElements.current.set(item.path, element);
                  else statusElements.current.delete(item.path);
                  handle.current?.invalidate();
                }}
              >
                {item.kind === "folder" ? (
                  <FolderPinBadge size={20} />
                ) : (
                  <IndexStatusControl
                    status={item.metadata?.Index ?? ""}
                    error={item.indexError}
                    onRetry={item.onRetryIndex}
                  />
                )}
              </span>
            ))}
        </div>
        <div
          className="library-space-block-badges"
          aria-label="OCR block types"
        >
          {previewBadges.map((badge) => (
            <span
              key={badge.id}
              className="library-space-block-badge"
              ref={(element) => {
                if (element) badgeElements.current.set(badge.id, element);
                else badgeElements.current.delete(badge.id);
                handle.current?.invalidate();
              }}
            >
              <BlockTypeBadge type={badge.type} />
              <BlockPageBadge page={badge.page} />
            </span>
          ))}
        </div>
      </div>
      <ul className="sr-only" aria-label="Library items">
        {visibleNodes.map((node) => (
          <li key={node.path}>
            <button
              type="button"
              data-entry-path={node.path}
              onClick={() =>
                props.onSelect(
                  props.items.find((item) => item.path === node.path) ?? null,
                )
              }
              onDoubleClick={() => openNode(node)}
              onKeyDown={(event) => {
                if (event.key === "Enter") openNode(node);
              }}
            >
              {node.kind === "file" ? "Document" : "Folder"}: {node.name}
            </button>
          </li>
        ))}
      </ul>
      {outlineRows?.path === props.selectedPath && (
        <ul className="sr-only" aria-label="Document outline">
          {outlineRows.rows.map((row, index) => (
            <li key={`${row.id}-${index}`}>
              <button
                type="button"
                aria-expanded={
                  expandedRow?.path === outlineRows.path &&
                  expandedRow.index === index
                }
                onClick={() =>
                  handle.current?.selectRow(outlineRows.path, index)
                }
              >
                Preview blocks: {row.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="library-space-tools" aria-label="Camera controls">
        <button
          type="button"
          title="Float forward"
          aria-label="Float forward"
          onClick={() => handle.current?.fly(0.35)}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          title="Float back"
          aria-label="Float back"
          onClick={() => handle.current?.fly(-0.35)}
        >
          <Minus size={16} />
        </button>
        <span />
        <button
          type="button"
          title="View everything"
          aria-label="View everything"
          onClick={() => handle.current?.focus()}
        >
          <Maximize size={15} />
        </button>
      </div>
      <div className="library-space-guide" id="spatial-controls-help">
        <span>Drag items to move · Drag the background to look around</span>
        <span>Scroll or WASD to float</span>
        <span>Click a document, then a row to preview its blocks</span>
      </div>
      {unavailable && (
        <div className="library-space-unavailable" role="status">
          3D isn’t available in this browser. Switch to another view to browse
          your documents.
        </div>
      )}
    </section>
  );
}
