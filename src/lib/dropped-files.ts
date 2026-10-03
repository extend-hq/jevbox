import { uploadLimits } from "../../shared/uploads";

export async function collectDroppedFiles(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => ({
      entry: item.webkitGetAsEntry?.() ?? null,
      file: item.getAsFile(),
    }));
  const fallback = Array.from(dataTransfer.files);
  const files: File[] = [];
  let hasDirectory = false;
  function add(file: File) {
    if (files.length >= uploadLimits.batchFiles)
      throw new Error(
        `Choose up to ${uploadLimits.batchFiles} files per upload.`,
      );
    files.push(file);
  }
  async function walk(entry: FileSystemEntry, parentPath = "") {
    const path = `${parentPath}${entry.name}`;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      Object.defineProperty(file, "webkitRelativePath", {
        value: parentPath ? path : "",
        configurable: true,
      });
      add(file);
    } else if (entry.isDirectory) {
      hasDirectory = true;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const entries = await new Promise<FileSystemEntry[]>(
          (resolve, reject) => reader.readEntries(resolve, reject),
        );
        if (!entries.length) break;
        for (const child of entries) await walk(child, `${path}/`);
      }
    }
  }
  if (items.length) {
    for (const item of items) {
      if (item.entry) await walk(item.entry);
      else if (item.file) add(item.file);
    }
  } else fallback.forEach(add);
  return {
    files,
    hasDirectory:
      hasDirectory || files.some((file) => Boolean(file.webkitRelativePath)),
  };
}
