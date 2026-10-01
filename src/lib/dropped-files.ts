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
      files.push(file);
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
      else if (item.file) files.push(item.file);
    }
  } else files.push(...fallback);
  return {
    files,
    hasDirectory:
      hasDirectory || files.some((file) => Boolean(file.webkitRelativePath)),
  };
}
