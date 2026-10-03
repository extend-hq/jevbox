import { uploadLimits } from "../../shared/uploads";
import { ApiError } from "./api";
import { toastManager } from "@/components/coss/toast";

export async function uploadBatch(
  input: FileList | File[],
  upload: (file: File) => Promise<void>,
) {
  const files = Array.from(input);
  const errors: string[] = [];
  let completed = 0;
  if (!files.length) return { completed, errors };
  if (files.length > uploadLimits.batchFiles) {
    const message = `Choose up to ${uploadLimits.batchFiles} files per upload.`;
    toastManager.add({ title: message, type: "error" });
    return { completed, errors: [message] };
  }
  const title =
    files.length === 1
      ? "Uploading document…"
      : `Uploading ${files.length} documents…`;
  const id = toastManager.add({ title, type: "loading", timeout: 0 });
  for (const file of files) {
    try {
      if (file.size > uploadLimits.fileBytes)
        throw new Error("Files must be 250 MB or smaller.");
      for (let attempt = 0; ; attempt++) {
        try {
          await upload(file);
          break;
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            error.status !== 429 ||
            !error.retryAfter ||
            error.retryAfter > 60 ||
            attempt >= 3
          )
            throw error;
          toastManager.update(id, {
            description:
              "Waiting for the server. Uploads will resume automatically.",
          });
          await new Promise((resolve) =>
            setTimeout(resolve, error.retryAfter! * 1000),
          );
        }
      }
      completed++;
    } catch (error) {
      errors.push(
        `${file.name}: ${error instanceof Error ? error.message : "Upload failed. Try again."}`,
      );
    }
    toastManager.update(id, {
      description: `${completed + errors.length} of ${files.length} processed`,
    });
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
