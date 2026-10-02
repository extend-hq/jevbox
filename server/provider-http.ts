import { HttpError } from "./errors";
export class ProviderResponseError extends HttpError {
  readonly retryable = false;
  constructor(message: string) {
    super(502, message);
  }
}

export async function jsonRequest(
  fetcher: typeof fetch,
  url: string,
  options: RequestInit,
) {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)])
    : AbortSignal.timeout(60000);
  const response = await fetcher(url, {
    ...options,
    signal,
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    const message = `Provider request failed (${response.status}). Check your key and account limits.`;
    if (response.status < 500 && response.status !== 429)
      throw new ProviderResponseError(message);
    throw new HttpError(502, message);
  }
  try {
    if (!response.body) throw new Error();
    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      signal.throwIfAborted();
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof ProviderResponseError) throw error;
    throw new ProviderResponseError(
      "The provider returned an invalid response. Try again.",
    );
  }
}
