export const textExtensions = [
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "ndjson",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "sh",
  "bash",
  "sql",
  "log",
  "ini",
  "conf",
  "env",
  "diff",
  "patch",
  "ipynb",
  "mdx",
  "rst",
  "tex",
];
export const imageExtensions = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "avif",
  "bmp",
  "svg",
];
export const mimeTypes: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "text/xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  zip: "application/zip",
};
export function extension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}
export function fileMime(filename: string) {
  const ext = extension(filename);
  return (
    mimeTypes[ext] ??
    (textExtensions.includes(ext) ? "text/plain" : "application/octet-stream")
  );
}
export function supportsIndex(filename: string) {
  return (
    textExtensions.includes(extension(filename)) ||
    ["pdf", "docx", "xlsx", "pptx", "png", "jpg", "jpeg", "webp"].includes(
      extension(filename),
    )
  );
}
