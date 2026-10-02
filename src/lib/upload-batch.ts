import { toastManager } from "@/components/coss/toast";

export async function uploadBatch(
  input: FileList | File[],
  upload: (file: File) => Promise<void>,
) {
  const files = Array.from(input);
  const errors: string[] = [];
  let completed = 0;
  if (!files.length) return { completed, errors };
  const title =
    files.length === 1
      ? "Uploading document…"
      : `Uploading ${files.length} documents…`;
  const id = toastManager.add({ title, type: "loading", timeout: 0 });
  for (const file of files) {
    try {
      await upload(file);
      completed++;
    } catch (error) {
      errors.push(
        `${file.name}: ${error instanceof Error ? error.message : "Upload failed. Try again."}`,
      );
    }
  }
  toastManager.update(id, {
    title: errors.length
      ? completed
        ? `${completed} of ${files.length} documents uploaded`
        : files.length === 1
          ? "Upload failed"
          : "Uploads failed"
      : completed === 1
        ? "Document uploaded"
        : `${completed} documents uploaded`,
    description: errors.length
      ? [
          ...errors.slice(0, 3),
          ...(errors.length > 3
            ? [`And ${errors.length - 3} more failed.`]
            : []),
        ].join("\n")
      : undefined,
    type: errors.length ? "error" : "success",
    timeout: errors.length ? 10000 : 4000,
  });
  return { completed, errors };
}
