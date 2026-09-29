import { HttpError } from "./errors";

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
  if (!response.ok)
    throw new HttpError(
      502,
      `Provider request failed (${response.status}). Check your key and account limits.`,
    );
  try {
    return await response.json();
  } catch {
    throw new HttpError(
      502,
      "The provider returned an invalid response. Try again.",
    );
  }
}
