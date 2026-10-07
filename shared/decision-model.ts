export const decisionProviders = ["typesafe", "cloudflare", "openai"] as const;
export type DecisionProvider = (typeof decisionProviders)[number];
export const decisionProviderLabels: Record<DecisionProvider, string> = {
  typesafe: "TypeSafe",
  cloudflare: "Cloudflare",
  openai: "OpenAI",
};
export const openaiDecisionModel = "gpt-6-luna";
export const cloudflareModels = ["clef", "clef-flash"] as const;
export type CloudflareModel = (typeof cloudflareModels)[number];
