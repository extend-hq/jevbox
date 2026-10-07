import { setTimeout as delay } from "node:timers/promises";

import { HttpError } from "./errors";
export class ProviderResponseError extends HttpError {
  readonly retryable = false;
  constructor(message: string) {
    super(502, message);
  }
}

function retryDelay(response: Response, attempt: number) {
  const milliseconds = response.headers.get("retry-after-ms");
  if (
    milliseconds?.trim() &&
    Number.isFinite(Number(milliseconds)) &&
    Number(milliseconds) >= 0
  )
    return Number(milliseconds);
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter?.trim()) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      if (seconds >= 0) return seconds * 1000;
    } else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) return Math.max(0, date - Date.now());
    }
  }
  return 500 * 2 ** attempt * (1 - Math.random() * 0.25);
}

export async function jsonRequest(
  fetcher: typeof fetch,
  url: string,
  options: RequestInit,
  policy: { retryTransientErrors?: boolean } = {},
) {
  const deadline = performance.now() + 60000;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)])
    : AbortSignal.timeout(60000);
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    response = await fetcher(url, {
      ...options,
      signal,
      redirect: "error",
    });
    if (response.ok) break;
    await response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
    if (response.status === 413)
      throw new ProviderResponseError(
        "The provider rejected this request because it exceeds its size or context limit. Use a smaller document scope or selection.",
      );
    const message =
      response.status === 429
        ? "The provider is rate limiting requests (429). Please try again shortly."
        : response.status === 529
          ? "The provider is temporarily overloaded (529). Please try again shortly."
          : response.status >= 500
            ? `The provider is temporarily unavailable (${response.status}). Please try again shortly.`
            : response.status === 401 || response.status === 403
              ? `Provider authentication failed (${response.status}). Check your API key and permissions.`
              : `The provider rejected this request (${response.status}). Check the request and provider settings.`;
    if (response.status < 500 && response.status !== 429)
      throw new ProviderResponseError(message);
    if (
      policy.retryTransientErrors &&
      attempt < 2 &&
      (response.status === 429 || response.status === 529)
    ) {
      const wait = retryDelay(response, attempt);
      if (performance.now() + wait < deadline) {
        await delay(wait, undefined, { signal });
        continue;
      }
    }
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
    signal.throwIfAborted();
    if (error instanceof ProviderResponseError) throw error;
    throw new ProviderResponseError(
      "The provider returned an invalid response. Try again.",
    );
  }
}
