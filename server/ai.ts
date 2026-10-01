import { providerCatalog } from "../shared/providers";
import {
  generateText,
  streamText,
  tool,
  isStepCount,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAzure } from "@ai-sdk/azure";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createGateway } from "@ai-sdk/gateway";
import { createMistral } from "@ai-sdk/mistral";
import { createGroq } from "@ai-sdk/groq";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createXai } from "@ai-sdk/xai";
import { createCohere } from "@ai-sdk/cohere";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createFireworks } from "@ai-sdk/fireworks";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createCerebras } from "@ai-sdk/cerebras";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createAlibaba } from "@ai-sdk/alibaba";
import { createBaseten } from "@ai-sdk/baseten";
import { createMiniMax } from "@ai-sdk/minimax";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createZai } from "@ai-sdk/zai";
import { createHuggingFace } from "@ai-sdk/huggingface";
import { createVertex } from "@ai-sdk/google-vertex";
import { createAnthropicAws } from "@ai-sdk/anthropic-aws";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent, fetch as undiciFetch } from "undici";
import { lookup } from "node:dns";
import ipaddr from "ipaddr.js";
import { HttpError } from "./db";
import type { Settings, Fetch } from "./providers";
import { providerExtensions } from "./provider-extensions";
import { z } from "zod";
import type { DocumentInspection } from "./document-inspection";
export type AnswerExecution = {
  signal: AbortSignal;
  attachedDocuments?: { id: string; name: string }[];
  maxOutputTokens?: number;
  onText?: (text: string) => Promise<void>;
  beforeStep?: () => Promise<void>;
  searchDocuments?: (query: string, signal?: AbortSignal) => Promise<unknown>;
  inspectDocument?: (
    input: DocumentInspection,
    signal?: AbortSignal,
  ) => Promise<unknown>;
};
export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
const dispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
        if (error) return callback(error, "", 4);
        if (
          !addresses.length ||
          addresses.some((a) => !isPublicAddress(a.address))
        )
          return callback(
            new Error("Private network endpoints are not allowed"),
            "",
            4,
          );
        if (typeof options === "object" && options.all)
          callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      });
    },
  },
});
export function validateProviderURL(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    (ipaddr.isValid(url.hostname.replace(/[\[\]]/g, "")) &&
      !isPublicAddress(url.hostname.replace(/[\[\]]/g, "")))
  )
    throw new HttpError(400, "Use a public HTTPS endpoint on port 443");
  return url.toString();
}
export const publicFetch: Fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  validateProviderURL(url);
  return (await undiciFetch(url, {
    ...(init as any),
    redirect: "error",
    dispatcher,
  })) as unknown as Response;
};
export function providerCredential(settings: Settings) {
  return settings.credentials?.[settings.provider ?? "openai"];
}
export function chatConfigured(settings: Settings) {
  const c = providerCredential(settings);
  return Boolean(
    c?.enabled !== false &&
    (c?.apiKey ||
      c?.config?.googleAuthOptions ||
      (c?.config?.accessKeyId && c?.config?.secretAccessKey)),
  );
}
export function availableChatModels(settings: Settings) {
  return providerCatalog.flatMap((provider) => {
    if (!chatConfigured({ ...settings, provider: provider.id })) return [];
    const credential = settings.credentials?.[provider.id];
    const models = [
      ...new Set([
        ...(settings.provider === provider.id && settings.model
          ? [settings.model]
          : []),
        ...(credential?.model ? [credential.model] : []),
        ...(credential?.models ?? []),
      ]),
    ];
    return models.map((model) => ({
      provider: provider.id,
      providerLabel: provider.label,
      model,
    }));
  });
}
export async function generateAnswer(
  settings: Settings,
  system: string,
  messages: ModelMessage[],
  fetcher: Fetch,
  execution?: AnswerExecution,
) {
  const provider = settings.provider ?? "openai";
  const credential = providerCredential(settings);
  if (!chatConfigured(settings) || !credential)
    throw new HttpError(
      409,
      "Add a chat provider in organization settings to enable chat.",
    );
  const config = credential.config ?? {};
  const networkFetch = fetcher === fetch ? publicFetch : fetcher;
  const options = { ...config, apiKey: credential.apiKey, fetch: networkFetch };
  const modelId = settings.model;
  if (!modelId)
    throw new HttpError(409, "Set a model ID in organization settings.");
  let model: LanguageModel;
  switch (provider) {
    case "openai":
      model = createOpenAI(options).responses(modelId);
      break;
    case "anthropic":
      model = createAnthropic(options)(modelId);
      break;
    case "google":
      model = createGoogleGenerativeAI(options)(modelId);
      break;
    case "azure":
      model = createAzure(options)(modelId);
      break;
    case "bedrock":
      model = createAmazonBedrock(options)(modelId);
      break;
    case "gateway":
      model = createGateway(options)(modelId);
      break;
    case "mistral":
      model = createMistral(options)(modelId);
      break;
    case "groq":
      model = createGroq(options)(modelId);
      break;
    case "deepseek":
      model = createDeepSeek(options)(modelId);
      break;
    case "xai":
      model = createXai(options)(modelId);
      break;
    case "cohere":
      model = createCohere(options)(modelId);
      break;
    case "togetherai":
      model = createTogetherAI(options)(modelId);
      break;
    case "fireworks":
      model = createFireworks(options)(modelId);
      break;
    case "deepinfra":
      model = createDeepInfra(options)(modelId);
      break;
    case "cerebras":
      model = createCerebras(options)(modelId);
      break;
    case "perplexity":
      model = createPerplexity(options)(modelId);
      break;
    case "alibaba":
      model = createAlibaba(options)(modelId);
      break;
    case "baseten":
      model = createBaseten(options)(modelId);
      break;
    case "minimax":
      model = createMiniMax(options)(modelId);
      break;
    case "moonshotai":
      model = createMoonshotAI(options)(modelId);
      break;
    case "zai":
      model = createZai(options)(modelId);
      break;
    case "huggingface":
      model = createHuggingFace(options)(modelId);
      break;
    case "vertex": {
      if (!config.googleAuthOptions)
        throw new HttpError(
          409,
          "Provide explicit Google authentication configuration.",
        );
      model = createVertex(options)(modelId);
      break;
    }
    case "anthropic-aws": {
      if (!config.accessKeyId || !config.secretAccessKey)
        throw new HttpError(
          409,
          "Provide explicit AWS credentials in advanced configuration.",
        );
      model = createAnthropicAws(options)(modelId);
      break;
    }
    case "compatible": {
      if (typeof config.baseURL !== "string")
        throw new HttpError(409, "Set a baseURL in advanced configuration.");
      model = createOpenAICompatible({
        ...options,
        name: "custom",
        baseURL: validateProviderURL(config.baseURL),
      }).chatModel(modelId);
      break;
    }
    case "extension": {
      const factory = providerExtensions[String(config.extension)];
      if (!factory)
        throw new HttpError(
          409,
          "This provider extension is not installed on the server.",
        );
      model = factory(
        { apiKey: credential.apiKey ?? "", config, fetch: networkFetch },
        modelId,
      );
      break;
    }
    default:
      throw new HttpError(400, "Unsupported provider");
  }
  try {
    let toolFailure: unknown;
    const request = {
      model,
      system,
      messages,
      maxOutputTokens: execution?.maxOutputTokens ?? 2000,
      maxRetries: 1,
      ...(provider === "openai"
        ? { providerOptions: { openai: { store: false } } }
        : {}),
      ...(execution?.searchDocuments
        ? {
            tools: {
              search_documents: tool({
                description:
                  "Search the accessible document library for evidence. Call when the question needs document facts, or when existing context is insufficient. Make the query self-contained using relevant topics, entities, and document references from the conversation. Attached documents constrain this search automatically. Results contain numbered citations and excerpts; an empty result means no relevant evidence was found within the search budget.",
                inputSchema: z
                  .object({ query: z.string().trim().min(1).max(4000) })
                  .strict(),
                execute: async ({ query }, { abortSignal }) => {
                  try {
                    return await execution.searchDocuments!(query, abortSignal);
                  } catch (error) {
                    toolFailure = error;
                    throw error;
                  }
                },
              }),
              ...(execution.inspectDocument
                ? {
                    inspect_document: tool({
                      description:
                        "Inspect an attached or previously retrieved document. Returns its full-document statistics and section outline. Request specific PDF page positions to read their extracted text, or a literal term to count its occurrences throughout the complete extracted text. Use this for page counts, word counts, term frequency, common abbreviations, page contents, and document structure. Counts describe the extraction and can differ from the visual original; do not infer exact visual counts from incomplete extraction.",
                      inputSchema: z
                        .object({
                          documentId: z.string().min(1).max(128),
                          pages: z
                            .array(z.number().int().positive())
                            .max(5)
                            .optional(),
                          term: z.string().trim().min(1).max(200).optional(),
                        })
                        .strict(),
                      execute: async (input, { abortSignal }) => {
                        try {
                          return await execution.inspectDocument!(
                            input,
                            abortSignal,
                          );
                        } catch (error) {
                          toolFailure = error;
                          throw error;
                        }
                      },
                    }),
                  }
                : {}),
            },
            stopWhen: isStepCount(6),
          }
        : {}),
      prepareStep: async ({ stepNumber }: { stepNumber: number }) => {
        if (toolFailure) throw toolFailure;
        await execution?.beforeStep?.();
        return stepNumber >= 5 ? { toolChoice: "none" as const } : {};
      },
      abortSignal: execution
        ? AbortSignal.any([execution.signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(90000),
    };
    if (execution?.onText) {
      const result = streamText({ ...request, onError: () => {} });
      let text = "";
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error;
        if (part.type === "tool-error") throw part.error;
        if (part.type === "abort") throw new Error("Answer stopped");
        if (part.type === "text-delta") {
          text += part.text;
          await execution.onText(text);
        }
      }
      request.abortSignal.throwIfAborted();
      return text;
    }
    const result = await generateText(request);
    if (toolFailure) throw toolFailure;
    return result.text;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    execution?.signal.throwIfAborted();
    throw new HttpError(
      502,
      "The chat provider could not complete the request. Check your credentials, model, and account limits.",
    );
  }
}
