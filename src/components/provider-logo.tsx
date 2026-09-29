import { Globe2 } from "./icons";
const logos = new Set([
  "extend",
  "baseten",
  "zai",
  "huggingface",
  "typesafe",
  "xai",
  "vertex",
  "groq",
  "openai",
  "bedrock",
  "fireworks",
  "mistral",
  "deepseek",
  "minimax",
  "google",
  "azure",
  "anthropic",
  "alibaba",
  "gateway",
  "deepinfra",
  "togetherai",
  "cohere",
  "cerebras",
  "anthropic-aws",
  "moonshotai",
  "perplexity",
]);
const monochrome = new Set([
  "openai",
  "anthropic",
  "gateway",
  "anthropic-aws",
  "groq",
  "xai",
  "baseten",
  "moonshotai",
  "zai",
  "typesafe",
]);
export function ProviderLogo({
  provider,
  size = 18,
}: {
  provider: string;
  size?: number;
}) {
  return logos.has(provider) ? (
    <img
      className={`provider-logo ${monochrome.has(provider) ? "monochrome" : ""}`}
      src={`/logos/${provider}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  ) : (
    <Globe2 size={size} />
  );
}
