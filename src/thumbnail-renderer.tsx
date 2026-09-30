import { renderDocumentThumbnail } from "./lib/document-thumbnail-utils";
import { THUMBNAIL_SIZE } from "../shared/thumbnails";

type Rendered = { dataUrl: string; pageCount: number };
type Input = { base64: string; name: string; mime: string };
declare global {
  interface Window {
    renderThumbnail: (input: Input) => Promise<Rendered>;
  }
}

window.renderThumbnail = async ({ base64, name, mime }) => {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  if (mime.startsWith("image/")) {
    const source = URL.createObjectURL(new Blob([bytes], { type: mime }));
    try {
      const image = new Image();
      image.src = source;
      await image.decode();
      const scale = Math.min(
        1,
        THUMBNAIL_SIZE / Math.max(image.width, image.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image preview unavailable");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { dataUrl: canvas.toDataURL("image/png"), pageCount: 1 };
    } finally {
      URL.revokeObjectURL(source);
    }
  }
  const source = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    if (/\.xlsx$/i.test(name)) {
      const { renderXlsxThumbnailUrl } =
        await import("./lib/xlsx-thumbnail-utils");
      const result = await renderXlsxThumbnailUrl(
        source,
        name,
        0,
        THUMBNAIL_SIZE,
        "image/png",
      );
      if (!result) throw new Error("Thumbnail unavailable");
      return { dataUrl: result.url, pageCount: result.pageCount };
    }
    const result = await renderDocumentThumbnail(
      source,
      name,
      0,
      THUMBNAIL_SIZE,
    );
    if (!result) throw new Error("Thumbnail unavailable");
    const blob = await (await fetch(result.url)).blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Thumbnail unavailable"));
      reader.readAsDataURL(blob);
    });
    return { dataUrl, pageCount: result.pageCount };
  } finally {
    URL.revokeObjectURL(source);
  }
};
