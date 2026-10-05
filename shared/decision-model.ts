export const decisionProviders = ["typesafe", "cloudflare"] as const;
export type DecisionProvider = (typeof decisionProviders)[number];
export const decisionProviderLabels: Record<DecisionProvider, string> = {
  typesafe: "TypeSafe",
  cloudflare: "Cloudflare",
};
export const cloudflareModels = ["clef", "clef-flash"] as const;
export type CloudflareModel = (typeof cloudflareModels)[number];
