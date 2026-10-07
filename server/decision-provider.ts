import type {
  CloudflareModel,
  DecisionProvider,
} from "../shared/decision-model";
import { openaiDecisionModel } from "../shared/decision-model";

export type DecisionSettings = {
  decisionProvider?: DecisionProvider;
  jevKey?: string;
  cloudflareAccountId?: string;
  cloudflareKey?: string;
  cloudflareModel?: CloudflareModel;
  credentials?: Record<string, { apiKey?: string }>;
};

export type DecisionConnection =
  | { provider: "typesafe"; key: string }
  | { provider: "openai"; key: string; model: typeof openaiDecisionModel }
  | {
      provider: "cloudflare";
      key: string;
      accountId: string;
      model: CloudflareModel;
    };

export function getDecisionConnection(
  settings: DecisionSettings,
): DecisionConnection | undefined {
  if (settings.decisionProvider === "openai") {
    const key = settings.credentials?.openai?.apiKey?.trim();
    return key
      ? { provider: "openai", key, model: openaiDecisionModel }
      : undefined;
  }
  if (settings.decisionProvider === "cloudflare") {
    const key = settings.cloudflareKey?.trim();
    const accountId = settings.cloudflareAccountId?.trim();
    if (!key || !accountId || !/^[a-fA-F0-9]{32}$/.test(accountId)) return;
    return {
      provider: "cloudflare",
      key,
      accountId,
      model: settings.cloudflareModel ?? "clef",
    };
  }
  const key = settings.jevKey?.trim();
  return key ? { provider: "typesafe", key } : undefined;
}
