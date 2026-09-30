import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { Maximize, Minus, Plus } from "./icons";
import type { IndexNode } from "@/lib/api";
import type { ParsedBlock } from "../../shared/parsed-blocks";
import type { FileSystemEntry, FileSystemFileItem } from "./extend/file-system";
import { FOLDER_GLYPH_SVG } from "./extend/folder-glyph";
import { layoutSpatialTree, type SpatialNode } from "../lib/spatial-tree";
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
  onSelect: (entry: Entry | null) => void;
  onOpen: (entry: Entry) => void;
  loadPreviewImageUrl?: (
    file: FileSystemFileItem,
    page: number,
  ) => Promise<string | null>;
  loadDocumentStructure?: (
    file: FileSystemFileItem,
  ) => Promise<SpatialDocumentStructure | null>;
};
type SceneHandle = {
  focus: (path?: string) => void;
  fly: (amount: number) => void;
};

const SHEET_WIDTH = 2.25;
const SHEET_HEIGHT = 3;
const LABEL_HEIGHT = 0.22;
const FOLDER_LABEL_HEIGHT = 0.46;
const LINK_SEGMENTS = 32;
const TREE_REVEAL_DISTANCE = 12;
const TREE_ROW = 0.32;
const TREE_CARD_HEIGHT = 0.25;
const TREE_CARD_WIDTH = 2.9;
const TREE_INDENT = 0.26;
const TREE_COLUMN = 4.5;
const TREE_ROWS_PER_COLUMN = 24;
const TREE_MAX_ROWS = TREE_ROWS_PER_COLUMN * 3;
const TREE_MAX_DEPTH = 3;
const TREE_GAP = 0.6;
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

function cardTexture(title: string, meta: string, options: { dark: boolean }) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 64;
  const context = canvas.getContext("2d")!;
  context.beginPath();
  context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 14);
  context.fillStyle = options.dark ? "#212329" : "#ffffff";
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = options.dark
    ? "rgba(255, 255, 255, 0.09)"
    : "rgba(31, 41, 64, 0.1)";
  context.stroke();
  const left = 22;
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
  return texture;
}

/** Name plate that floats under a page stack or folder, inside the scene. */
function labelTexture(
  title: string,
  subtitle: string | undefined,
  dark: boolean,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;
  const titleFont = `${subtitle ? 600 : 500} 40px Inter, system-ui, sans-serif`;
  const subtitleFont = `400 30px Inter, system-ui, sans-serif`;
  context.font = titleFont;
  const text = fitText(context, title, 760);
  let width = context.measureText(text).width;
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
    canvas.width / 2,
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
  return { texture, aspect: canvas.width / canvas.height };
}

type TreeRow = {
  title: string;
  page: number;
  depth: number;
  parent: number;
  blocks: string[];
};
function flattenStructure(structure: SpatialDocumentStructure | null) {
  const rows: TreeRow[] = [];
  const pages = new Map<number, ParsedBlock[]>();
  for (const block of structure?.blocks ?? [])
    pages.set(block.page, [...(pages.get(block.page) ?? []), block]);
  const sections = structure?.sections.length
    ? structure.sections
    : [...pages].map(([page, blocks]): IndexNode => ({
        id: `page-${page}`,
        title: `Page ${page}`,
        summary: "",
        page,
        endPage: page,
        content: "",
        links: [],
        blocks,
        children: [],
      }));
  const visit = (nodes: IndexNode[], depth: number, parent: number) => {
    for (const node of nodes) {
      if (rows.length >= TREE_MAX_ROWS) return;
      rows.push({
        title: node.title || "Untitled section",
        page: node.page,
        depth,
        parent,
        blocks: node.blocks.map((block) => block.type),
      });
      if (depth < TREE_MAX_DEPTH)
        visit(node.children, depth + 1, rows.length - 1);
    }
  };
  visit(sections, 0, -1);
  return rows;
}

export function LibrarySpatialView(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<SceneHandle | null>(null);
  const thumbnailCache = useRef(new Map<string, string | null>());
  const [unavailable, setUnavailable] = useState(false);
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const structure = props.items
    .map((item) => `${item.kind}:${item.path}`)
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
    const observer = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
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

    const palette = dark
      ? { haze: "#16171c", top: "#1d1f27", bottom: "#101115", dust: "#b9c6ff" }
      : { haze: "#eeede8", top: "#f7f7f4", bottom: "#e2e1da", dust: "#ffffff" };
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
            varying vec3 vDirection;
            void main() {
              float h = vDirection.y;
              vec3 color = h > 0.0
                ? mix(middle, top, smoothstep(0.0, 0.7, h))
                : mix(middle, bottom, smoothstep(0.0, 0.7, -h));
              gl_FragColor = vec4(color, 1.0);
              #include <colorspace_fragment>
            }`,
        }),
      ),
    );
    sky.frustumCulled = false;
    scene.add(sky);

    scene.add(
      new THREE.HemisphereLight(
        dark ? 0x9fb0e0 : 0xffffff,
        dark ? 0x1a1a22 : 0xd8d2c4,
        dark ? 1.3 : 1.9,
      ),
    );
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
      { color: 0x6f8dff, phase: 0 },
      { color: 0xffc98a, phase: 2.1 },
      { color: 0xc89bff, phase: 4.2 },
    ].map(({ color, phase }) => {
      const light = new THREE.PointLight(color, dark ? 90 : 55, extent, 1.2);
      scene.add(light);
      return { light, phase };
    });

    // Floating motes: without depth writes they take the blur of whatever sits
    // behind them, so most dissolve into bokeh.
    const moteCount = Math.min(700, 140 + nodes.length * 2);
    const motePositions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      const r = extent * 1.4 * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      motePositions.set(
        [
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.cos(phi) * 0.6,
          r * Math.sin(phi) * Math.sin(theta),
        ],
        i * 3,
      );
    }
    const moteGeometry = geometry(new THREE.BufferGeometry());
    moteGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(motePositions, 3),
    );
    const motes = new THREE.Points(
      moteGeometry,
      material(
        new THREE.PointsMaterial({
          color: palette.dust,
          size: 0.9,
          map: texture(softDotTexture()),
          transparent: true,
          opacity: dark ? 0.3 : 0.75,
          depthWrite: false,
          blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
        }),
      ),
    );
    scene.add(motes);

    const sheet = geometry(new THREE.PlaneGeometry(SHEET_WIDTH, SHEET_HEIGHT));
    const paperColor = new THREE.Color(dark ? "#d3d8e2" : "#fbfaf6");
    const sheetShade = (slot: number) =>
      new THREE.Color().copy(paperColor).multiplyScalar(1 - slot * 0.075);
    const outline = material(
      new THREE.MeshBasicMaterial({ color: "#3265ed", toneMapped: false }),
    );
    // A flat ring around the sheet, coplanar with it, so the selection edge
    // never peeks out from behind at an angle.
    const ring = new THREE.Shape();
    const outer = { x: SHEET_WIDTH / 2 + 0.014, y: SHEET_HEIGHT / 2 + 0.014 };
    ring.moveTo(-outer.x, -outer.y);
    ring.lineTo(outer.x, -outer.y);
    ring.lineTo(outer.x, outer.y);
    ring.lineTo(-outer.x, outer.y);
    ring.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-SHEET_WIDTH / 2, -SHEET_HEIGHT / 2);
    hole.lineTo(-SHEET_WIDTH / 2, SHEET_HEIGHT / 2);
    hole.lineTo(SHEET_WIDTH / 2, SHEET_HEIGHT / 2);
    hole.lineTo(SHEET_WIDTH / 2, -SHEET_HEIGHT / 2);
    hole.closePath();
    ring.holes.push(hole);
    const outlineGeometry = geometry(new THREE.ShapeGeometry(ring));
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
      scale: number;
      height: number;
      width: number;
      frame?: THREE.Mesh;
      label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
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
      const nameplate = labelTexture(
        node.name,
        node.kind === "file"
          ? undefined
          : `${node.descendants} ${node.descendants === 1 ? "document" : "documents"}`,
        dark,
      );
      const labelHeight =
        node.kind === "file" ? LABEL_HEIGHT : FOLDER_LABEL_HEIGHT;
      const label = new THREE.Mesh(
        geometry(
          new THREE.PlaneGeometry(labelHeight * nameplate.aspect, labelHeight),
        ),
        material(
          new THREE.MeshBasicMaterial({
            map: texture(nameplate.texture),
            alphaTest: 0.5,
            toneMapped: false,
          }),
        ),
      );
      group.add(label);
      pickables.push(label);
      const floater: Floater = {
        node,
        group,
        body,
        label,
        base: new THREE.Vector3(...node.position),
        calm: 0,
        hover: 0,
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

    // Document structure trees, built lazily when the camera comes close.
    type Tree = {
      path: string;
      group: THREE.Group;
      width: number;
      height: number;
      reveal: number;
      state: "loading" | "ready";
    };
    const trees = new Map<string, Tree>();
    const structures = new Map<string, SpatialDocumentStructure | null>();
    const requested = new Set<string>();
    // Outline connectors: world-width so they read clearly up close.
    const lineMaterial = fatLineMaterial({
      color: new THREE.Color(dark ? "#66729a" : "#98a4bb").getHex(),
      linewidth: 0.024,
      worldUnits: true,
    });
    const cardMaterial = (map: THREE.Texture) =>
      material(
        new THREE.MeshBasicMaterial({
          map: texture(map),
          alphaTest: 0.5,
          alphaToCoverage: true,
          toneMapped: false,
          fog: false,
        }),
      );
    function buildTree(path: string, state: Tree["state"]) {
      const floater = floaters.get(path);
      if (!floater) return;
      const previous = trees.get(path);
      if (previous) {
        floater.body.remove(previous.group);
        previous.group.traverse((object) => {
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
            materials.delete(owned);
            owned.dispose();
          }
        });
      }
      const group = new THREE.Group();
      const structure = structures.get(path) ?? null;
      const parsedRows = flattenStructure(structure);
      const rows: TreeRow[] = parsedRows.length
        ? parsedRows
        : [
            {
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
      const spine = 0.12;
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
      const linePoints: number[] = [
        -TREE_GAP,
        railY,
        -0.01,
        (columns - 1) * TREE_COLUMN + spine,
        railY,
        -0.01,
      ];
      for (let column = 0; column < columns; column++) {
        const roots = rows
          .map((row, index) => ({ row, index }))
          .filter(
            ({ row, index }) =>
              row.parent < 0 &&
              Math.floor(index / TREE_ROWS_PER_COLUMN) === column,
          );
        if (roots.length) {
          const x = column * TREE_COLUMN + spine;
          linePoints.push(
            x,
            railY,
            -0.01,
            x,
            place(roots.at(-1)!.index).y,
            -0.01,
          );
        }
      }
      const chips: { x: number; y: number; color: string }[] = [];
      rows.forEach((row, index) => {
        const { x, y } = place(index);
        const width = TREE_CARD_WIDTH - row.depth * TREE_INDENT;
        const card = new THREE.Mesh(
          geometry(new THREE.PlaneGeometry(width, TREE_CARD_HEIGHT)),
          cardMaterial(
            cardTexture(
              row.title,
              row.page
                ? `p.${row.page}${row.blocks.length ? ` · ${row.blocks.length}` : ""}`
                : "",
              { dark },
            ),
          ),
        );
        card.position.set(x + width / 2, y, 0);
        group.add(card);
        const sampled =
          row.blocks.length <= BLOCK_CHIPS
            ? row.blocks
            : Array.from(
                { length: BLOCK_CHIPS },
                (_, i) =>
                  row.blocks[Math.floor((i / BLOCK_CHIPS) * row.blocks.length)],
              );
        sampled.forEach((type, i) =>
          chips.push({
            x: x + width + 0.1 + i * CHIP_STEP,
            y,
            color: blockColor(type),
          }),
        );
        const sameColumn =
          row.parent >= 0 &&
          Math.floor(row.parent / TREE_ROWS_PER_COLUMN) ===
            Math.floor(index / TREE_ROWS_PER_COLUMN);
        const column = Math.floor(index / TREE_ROWS_PER_COLUMN);
        if (row.parent < 0) {
          const fromX = column * TREE_COLUMN + spine;
          linePoints.push(fromX, y, -0.01, x + 0.02, y, -0.01);
        } else if (sameColumn) {
          const parent = place(row.parent);
          const fromX = parent.x + 0.1;
          linePoints.push(
            fromX,
            parent.y,
            -0.01,
            fromX,
            y,
            -0.01,
            fromX,
            y,
            -0.01,
            x + 0.02,
            y,
            -0.01,
          );
        } else {
          const parent = place(row.parent);
          const parentColumn = Math.floor(row.parent / TREE_ROWS_PER_COLUMN);
          const parentRight =
            parent.x + TREE_CARD_WIDTH - rows[row.parent].depth * TREE_INDENT;
          const fromGutter = (parentColumn + 1) * TREE_COLUMN - 0.2;
          const toGutter = column * TREE_COLUMN - 0.2;
          const bridgeY = railY + 0.12 * (row.depth + 1);
          linePoints.push(
            parentRight - 0.02,
            parent.y,
            -0.01,
            fromGutter,
            parent.y,
            -0.01,
          );
          if (fromGutter !== toGutter) {
            linePoints.push(
              fromGutter,
              parent.y,
              -0.01,
              fromGutter,
              bridgeY,
              -0.01,
              fromGutter,
              bridgeY,
              -0.01,
              toGutter,
              bridgeY,
              -0.01,
            );
          }
          linePoints.push(
            toGutter,
            fromGutter === toGutter ? parent.y : bridgeY,
            -0.01,
            toGutter,
            y,
            -0.01,
            toGutter,
            y,
            -0.01,
            x + 0.02,
            y,
            -0.01,
          );
        }
      });
      const connectors = new LineSegments2(
        geometry(new LineSegmentsGeometry().setPositions(linePoints)),
        lineMaterial,
      );
      connectors.frustumCulled = false;
      group.add(connectors);
      if (chips.length) {
        const chipMesh = new THREE.InstancedMesh(
          geometry(new THREE.PlaneGeometry(CHIP_WIDTH, 0.15)),
          material(
            new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }),
          ),
          chips.length,
        );
        const matrix = new THREE.Matrix4();
        const color = new THREE.Color();
        chips.forEach((chip, i) => {
          chipMesh.setMatrixAt(i, matrix.makeTranslation(chip.x, chip.y, 0));
          chipMesh.setColorAt(i, color.set(chip.color));
        });
        group.add(chipMesh);
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
      });
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
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const projected = new THREE.Vector3();
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

    function queueThumbnail(path: string) {
      if (
        activeLoads >= 3 ||
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
            floater.cover.material.map?.dispose();
            floater.cover.material.map = map;
            floater.cover.material.needsUpdate = true;
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
      window.clearTimeout(thumbTimer);
      thumbTimer = window.setTimeout(() => {
        if (disposed) return;
        const candidates = [...floaters.values()]
          .filter(({ node, base }) => {
            if (node.kind !== "file") return false;
            projected.copy(base).project(camera);
            return (
              projected.z < 1 &&
              projected.z > -1 &&
              Math.abs(projected.x) < 1.1 &&
              Math.abs(projected.y) < 1.1
            );
          })
          .sort((a, b) => {
            if (a.node.path === latest.current.selectedPath) return -1;
            if (b.node.path === latest.current.selectedPath) return 1;
            return (
              a.base.distanceToSquared(camera.position) -
              b.base.distanceToSquared(camera.position)
            );
          })
          .slice(0, 40);
        for (const { node } of candidates) queueThumbnail(node.path);
      }, 180);
    }

    function pickTreeDocument() {
      const selected = floaters.get(latest.current.selectedPath ?? "\0");
      if (selected?.node.kind === "file") {
        projected.copy(selected.group.position).project(camera);
        if (
          projected.z > -1 &&
          projected.z < 1 &&
          Math.abs(projected.x) < 1.2 &&
          Math.abs(projected.y) < 1.2 &&
          camera.position.distanceTo(selected.group.position) < 45
        )
          return selected.node.path;
      }
      let best: string | null = null;
      let bestDistance = TREE_REVEAL_DISTANCE;
      for (const floater of floaters.values()) {
        if (floater.node.kind !== "file") continue;
        const distance = camera.position.distanceTo(floater.group.position);
        if (distance >= bestDistance) continue;
        projected.copy(floater.group.position).project(camera);
        if (
          projected.z > -1 &&
          projected.z < 1 &&
          Math.abs(projected.x) < 0.6 &&
          Math.abs(projected.y) < 0.65
        ) {
          best = floater.node.path;
          bestDistance = distance;
        }
      }
      return best;
    }

    function draw(now: number) {
      frame = 0;
      if (disposed) return;
      const delta = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const time = reducedMotion ? 0 : now / 1000;
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
        treePath = nextTree;
        if (treePath) requestStructure(treePath);
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
      if (pointerInside && !moving) {
        raycaster.setFromCamera(pointer, camera);
        updateHover(hoverHit());
      }
      links.forEach(([parent, child], i) => {
        parent.body.localToWorld(linkFrom.set(0, -parent.height / 2, 0));
        child.body.localToWorld(linkTo.set(0, child.height / 2, 0));
        linkVisibility.fill(1, i * LINK_SEGMENTS, (i + 1) * LINK_SEGMENTS);
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

      // Autofocus: whatever is directly in front of the camera (including
      // the open outline), otherwise the selected document if it's in view,
      // otherwise the orbit target.
      let focusGoal = camera.position.distanceTo(controls.target);
      focusTargets.length = 0;
      focusTargets.push(...pickables);
      const openTree = treePath ? trees.get(treePath) : undefined;
      if (openTree?.group.visible)
        for (const child of openTree.group.children)
          if (child instanceof THREE.Mesh && !(child instanceof LineSegments2))
            focusTargets.push(child);
      centerRay.setFromCamera(center, camera);
      const hit = centerRay.intersectObjects(focusTargets, false)[0];
      const selected = floaters.get(selectedPath ?? "\0");
      if (hit && hit.distance >= 3) focusGoal = hit.distance;
      else if (selected) {
        projected.copy(selected.group.position).project(camera);
        if (
          projected.z > -1 &&
          projected.z < 1 &&
          Math.abs(projected.x) < 0.75 &&
          Math.abs(projected.y) < 0.75
        )
          focusGoal = camera.position.distanceTo(selected.group.position);
      }
      focusDistance += (focusGoal - focusDistance) * Math.min(1, delta * 4);
      focusDistance = Math.max(1.5, focusDistance);
      dofMaterial.uniforms.focus.value = focusDistance;
      dofMaterial.uniforms.aperture.value =
        8 * THREE.MathUtils.clamp(focusDistance / 10, 1, 4);
      fog.density = 0.85 / (focusDistance * 2.4 + 34);

      drifters.forEach(({ light, phase }, index) => {
        const t = time * 0.05 + phase;
        light.position.set(
          Math.cos(t) * extent * 0.6,
          Math.sin(t * 1.3 + index) * extent * 0.25,
          Math.sin(t) * extent * 0.6,
        );
      });
      motes.rotation.y = time * 0.004;
      motes.position.y = Math.sin(time * 0.1) * 0.6;

      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      quad.render(renderer);
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
      const direction = camera.position.clone().sub(floater.base).normalize();
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
    const pointer = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
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
      let object: THREE.Object3D | null =
        raycaster.intersectObjects(pickables, false)[0]?.object ?? null;
      while (object && object.userData.path === undefined)
        object = object.parent;
      return object?.userData.path as string | undefined;
    }
    function hit(event: PointerEvent | MouseEvent) {
      pointerRay(event);
      return rayHit();
    }
    function hoverHit() {
      const next = rayHit();
      if (next || !hovered) return next;
      const floater = floaters.get(hovered);
      if (!floater) return next;
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
      moving = true;
      updateHover(undefined);
      invalidate();
    }
    function pointerUp(event: PointerEvent) {
      moving = false;
      invalidate();
      if (
        !down ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 ||
        event.button !== 0
      )
        return;
      const path = hit(event);
      const entry = latest.current.items.find((item) => item.path === path);
      if (entry && entry.path === latest.current.selectedPath)
        focus(entry.path);
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
    function doubleClick(event: MouseEvent) {
      const path = hit(event);
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
    const start = () => {
      flight = null;
      interacted = true;
    };
    controls.addEventListener("change", changed);
    controls.addEventListener("start", start);
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerleave", pointerLeave);
    renderer.domElement.addEventListener("dblclick", doubleClick);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });
    container.addEventListener("keydown", keyDown);
    container.addEventListener("keyup", keyUp);
    container.addEventListener("focusout", blur);
    handle.current = {
      focus,
      fly: (amount) => fly(amount),
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
      disposed = true;
      handle.current = null;
      cancelAnimationFrame(frame);
      window.clearTimeout(thumbTimer);
      window.clearTimeout(reframeTimer);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerleave", pointerLeave);
      renderer.domElement.removeEventListener("dblclick", doubleClick);
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
  }, [nodes, visibleNodes, dark]);

  const previousSelection = useRef(props.selectedPath);
  useEffect(() => {
    if (previousSelection.current === props.selectedPath) return;
    previousSelection.current = props.selectedPath;
    if (props.selectedPath) handle.current?.focus(props.selectedPath);
  }, [props.selectedPath]);

  function openNode(node: SpatialNode) {
    const entry = props.items.find((item) => item.path === node.path);
    if (entry) props.onOpen(entry);
  }

  return (
    <section
      className="library-space"
      aria-label="3D library"
      onKeyDown={(event) => {
        if (
          event.target instanceof HTMLElement &&
          (event.target.closest("input, a") || event.target.isContentEditable)
        )
          return;
        if (event.key === "Escape") props.onSelect(null);
        else if (event.key === "Home" || event.key.toLowerCase() === "r")
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
      />
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
        <span>Drag to look around</span>
        <span>Scroll or WASD to float</span>
        <span>Click a document to see its structure</span>
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
