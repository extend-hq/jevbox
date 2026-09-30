import {
  readCodePreview,
  type CodePreviewLanguage,
} from "../../shared/code-thumbnail-content";

type Highlight = {
  tokens: { content: string; color?: string }[][];
  foreground?: string;
};
type Preview = { url: string; pageCount: number; aspectRatio: number };
const cache = new Map<string, Promise<Preview>>();
const pending = new Map<
  number,
  { resolve: (result: Highlight) => void; reject: () => void }
>();
let worker: Worker | undefined;
let requestId = 0;
let queue = Promise.resolve();

function highlight(source: string, language: CodePreviewLanguage) {
  if (!worker) {
    worker = new Worker(
      new URL("./code-thumbnail.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) task?.reject();
      else task?.resolve(data);
    };
    worker.onerror = () => {
      for (const task of pending.values()) task.reject();
      pending.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  return new Promise<Highlight>((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Preview timed out"));
    }, 10_000);
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: () => {
        clearTimeout(timer);
        reject(new Error("Preview unavailable"));
      },
    });
    worker!.postMessage({ id, source, language });
  });
}

async function createPreview(
  url: string,
  language: CodePreviewLanguage,
  width: number,
): Promise<Preview> {
  const response = await fetch(url, {
    credentials: "same-origin",
    signal: AbortSignal.timeout(10_000),
    headers: { Range: "bytes=0-16383" },
  });
  const result = await highlight(await readCodePreview(response), language);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(width / 0.78);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Preview unavailable");
  context.scale(width / 320, width / 320);
  const height = (canvas.height * 320) / width;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, 320, height);
  context.fillStyle = "#f6f8fa";
  context.fillRect(0, 0, 320, 33);
  context.fillStyle = "#64748b";
  context.font = "600 10px system-ui, sans-serif";
  context.fillText(language.toUpperCase(), 15, 21);
  context.strokeStyle = "#e5e7eb";
  context.beginPath();
  context.moveTo(0, 33);
  context.lineTo(320, 33);
  context.stroke();
  context.save();
  context.beginPath();
  context.rect(12, 42, 295, height - 54);
  context.clip();
  context.font =
    "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const advance = context.measureText("M").width;
  result.tokens.forEach((line, index) => {
    const y = 52 + index * 14;
    context.fillStyle = "#a1a8b3";
    context.textAlign = "right";
    context.fillText(String(index + 1), 29, y);
    context.textAlign = "left";
    let x = 40;
    for (const token of line) {
      if (x > 307) break;
      context.fillStyle = token.color ?? result.foreground ?? "#24292e";
      context.fillText(token.content, x, y);
      x += [...token.content].length * advance;
    }
  });
  context.restore();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Preview unavailable")),
      "image/webp",
      0.85,
    ),
  );
  return {
    url: await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Preview unavailable"));
      reader.readAsDataURL(blob);
    }),
    pageCount: 1,
    aspectRatio: 0.78,
  };
}

export function renderCodeThumbnail(
  url: string,
  language: CodePreviewLanguage,
  requestedWidth = 320,
) {
  const width = Math.min(640, Math.max(160, Math.round(requestedWidth)));
  const key = `${url}#${language}#${width}`;
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const result = queue.then(() => createPreview(url, language, width));
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  cache.set(key, result);
  void result.catch(() => {
    if (cache.get(key) === result) cache.delete(key);
  });
  if (cache.size > 128) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
  }
  return result;
}
