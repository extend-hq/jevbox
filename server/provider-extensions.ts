import type { LanguageModel } from "ai";
export type ProviderFactory = (
  settings: {
    apiKey: string;
    config: Record<string, unknown>;
    fetch: typeof fetch;
  },
  modelId: string,
) => LanguageModel;
export const providerExtensions: Record<string, ProviderFactory> = {};
