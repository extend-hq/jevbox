import { HttpError } from "./errors";
export class ProviderResponseError extends HttpError {
  readonly retryable = false;
  constructor(message: string) { super(502, message); }
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
    const message = `Provider request failed (${response.status}). Check your key and account limits.`;
    if (response.status < 500 && response.status !== 429)
      throw new ProviderResponseError(message);
    throw new HttpError(502, message);
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderResponseError("The provider returned an invalid response. Try again.");
  }
}
