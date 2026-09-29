export const CODE_PREVIEW_BYTES = 16_384;
export const CODE_PREVIEW_LINES = 24;
export const CODE_PREVIEW_COLUMNS = 100;
export type CodePreviewLanguage = "json" | "yaml" | "text";

export function prepareCodePreview(
  source: string,
  language: CodePreviewLanguage,
) {
  let text = source.slice(0, CODE_PREVIEW_BYTES).replace(/\r\n?/g, "\n");
  if (language === "json" && source.length <= CODE_PREVIEW_BYTES) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {}
  }
  return text
    .split("\n", CODE_PREVIEW_LINES)
    .map((line) => line.replace(/\t/g, "  ").slice(0, CODE_PREVIEW_COLUMNS))
    .join("\n");
}

export async function readCodePreview(response: Response) {
  if (!response.ok || !response.body) throw new Error("Preview unavailable");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(CODE_PREVIEW_BYTES);
  let length = 0;
  try {
    while (length < bytes.length) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const part = chunk.value.subarray(0, bytes.length - length);
      bytes.set(part, length);
      length += part.length;
    }
  } finally {
    await reader.cancel();
  }
  return new TextDecoder().decode(bytes.subarray(0, length));
}
