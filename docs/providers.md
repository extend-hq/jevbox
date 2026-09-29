# Chat provider setup

Open Organization settings → Connections, choose a provider, enter its API key and exact model ID, and save. Credentials are kept separately for each adapter. A provider switch does not reuse a key from another provider. Model IDs are entered explicitly so deployments can use their available models without a code release.

Use **Additional models for the chat picker** to list other model IDs available to members. The composer shows only models explicitly configured by an organization administrator. Each message validates the selected provider and model against that list.

Provider configuration is server-side and encrypted. Leaving advanced configuration blank retains it. Entering `{}` clears it. These are accepted fields: `baseURL`, `resourceName`, `region`, `project`, `location`, `accessKeyId`, `secretAccessKey`, `sessionToken`, `googleAuthOptions`, `headers`, and `extension`.

| Provider | Configuration |
| --- | --- |
| Most native providers | API key and model ID |
| AI Gateway | Gateway key and a provider/model ID from its catalog |
| Azure OpenAI | API key, deployment/model ID, `resourceName` |
| Amazon Bedrock | Bedrock bearer API key and `region`, or explicit access key credentials |
| Anthropic on AWS | `region`, `accessKeyId`, `secretAccessKey`, optionally `sessionToken` |
| Google Vertex | `project`, `location`, `googleAuthOptions.credentials.client_email`, `googleAuthOptions.credentials.private_key` |
| OpenAI-compatible | API key, model ID, public HTTPS `baseURL` |

Some providers do not support every model or endpoint. Test the exact model your account supports. Private-network compatible endpoints are intentionally blocked in this multi-tenant baseline. No ambient host IAM or Google credentials are used as a substitute for organization configuration.

## Search and chat context

With a JEV key configured, search and chat share hierarchical retrieval followed by a usefulness filter. Each of the top 12 retrieved excerpts is scored independently using Jev's four-level rubric: unrelated (0), same topic without answering (1), useful supporting evidence (2), and a direct answer (3). Only scores of at least 1.5 are retained, ordered by usefulness. The filter scores the full excerpt that would be sent to chat, up to 7,000 characters, with at most four scoring requests in flight per retrieval. Source permissions are checked before each scoring request and again before returning context.

Attached documents use the same filter. If no excerpts qualify, chat reports that it could not find supporting evidence instead of generating an answer. Without a JEV key, existing text matching remains available. Provider failures or invalid scores fail the request instead of sending unfiltered context. This adds up to 12 Jev requests per search or chat message.

The scoring API follows the [TypeSafe Score primitive](https://docs.typesafe.ai/api), using the usefulness rubric described in [GPT Researcher's context filter](https://docs.gptr.dev/docs/gpt-researcher/gptr/context-filter).

## Additional AI SDK providers

The AI SDK ecosystem includes independently maintained providers. To add one that is not native or compatible with the bundled adapters:

1. Add its package to `dependencies` with pnpm and commit the lockfile.
2. Import its factory in `server/provider-extensions.ts`.
3. Register a `ProviderFactory` under a stable name. It receives the organization's `apiKey`, configuration, validated `fetch`, and model ID. Return an AI SDK `LanguageModel` compatible with the installed SDK major version.
4. Build/test the image. Choose **Installed AI SDK extension** in settings, set the model and key, and set `extension` to the registry name in advanced configuration.

Factories must use the provided credentials and fetch, avoid environment-credential fallbacks, and must not add tools or unrestricted network/file access. This supports any AI SDK language provider through a deliberate server installation; workspace users cannot load arbitrary server code. Media-only SDK adapters cannot generate chat answers.

Reference: [AI SDK providers](https://ai-sdk.dev/providers/ai-sdk-providers), [TypeSafe evaluation API](https://docs.typesafe.ai/api), [Extend asynchronous parsing](https://docs.extend.ai/api-reference/endpoints/parse/create-parse-run).

## Initial model IDs

Reviewed against official provider documentation on 2026-09-29. These are initial values for new connections; saved model choices are preserved. Availability still depends on the account and deployment region. Multi-model hosts have no single latest model, so the defaults use a current documented chat model.

| Provider | Initial model ID | Source |
| --- | --- | --- |
| OpenAI | `gpt-6-luna` | [Model catalog](https://developers.openai.com/api/docs/models) |
| Anthropic | `claude-sonnet-5-5` | [Model IDs](https://platform.claude.com/docs/en/models/overview) |
| Google Gemini | `gemini-3.8-flash` | [Model catalog](https://ai.google.dev/gemini-api/docs/models) |
| AI Gateway | `openai/gpt-6-luna` | [Gateway model](https://vercel.com/ai-gateway/models/gpt-6-luna) |
| Azure OpenAI | Enter the deployment name | [Deployment naming](https://learn.microsoft.com/en-us/azure/developer/ai/how-to/switching-endpoints) |
| Amazon Bedrock | `anthropic.claude-sonnet-5-5` | [Platform model IDs](https://platform.claude.com/docs/en/models/overview) |
| Google Vertex | `gemini-3.8-flash` | [Cloud model catalog](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash) |
| Anthropic on AWS | `claude-sonnet-5-5` | [Platform model IDs](https://platform.claude.com/docs/en/models/overview) |
| Mistral | `mistral-medium-3-5` | [Model reference](https://docs.mistral.ai/models/mistral-medium-3-5-26-04) |
| Groq | `openai/gpt-oss-120b` | [Production models](https://console.groq.com/docs/models) |
| DeepSeek | `deepseek-flash` | [Current IDs](https://api-docs.deepseek.com/quick_start/pricing/) |
| xAI | `grok-4.7` | [Release notes](https://docs.x.ai/developers/release-notes) |
| Cohere | `command-a-plus-05-2026` | [Model catalog](https://docs.cohere.com/v2/docs/models) |
| Together AI | `moonshotai/Kimi-K3` | [Serverless catalog](https://docs.together.ai/docs/serverless/models) |
| Fireworks | `accounts/fireworks/models/glm-5p3-flash` | [Quickstart](https://docs.fireworks.ai/getting-started/quickstart) |
| DeepInfra | `moonshotai/Kimi-K3` | [Model catalog](https://deepinfra.com/models) |
| Cerebras | `gpt-oss-120b` | [Production models](https://inference-docs.cerebras.ai/models/overview) |
| Perplexity | `sonar` | [Compatibility and migration](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview) |
| Alibaba | `qwen3.8-flash` | [Model releases](https://www.alibabacloud.com/help/en/model-studio/newly-released-models) |
| Baseten | `zai-org/GLM-5.3` | [Model APIs](https://docs.baseten.co/inference/model-apis/overview) |
| MiniMax | `MiniMax-M3.1-Flash-Preview` | [Current API reference](https://platform.minimax.io/docs/api-reference/text-openai-api) |
| Moonshot AI | `kimi-k3` | [Quickstart](https://platform.kimi.ai/docs/overview) |
| Z.AI | `glm-5.3-flash` | [Model reference](https://docs.z.ai/guides/vlm/glm-5.3-flash) |
| Hugging Face | `moonshotai/Kimi-K3` | [Hosted inference model](https://huggingface.co/moonshotai/Kimi-K3?inference_provider=baseten) |
| OpenAI-compatible endpoint | Enter a model served by the endpoint | Endpoint-specific catalog |
| Installed AI SDK extension | Enter a model supported by the extension | Extension-specific catalog |

MiniMax's newest initial model is explicitly a preview. Perplexity's existing synchronous Sonar integration remains on `sonar`: its official migration guide says these calls continue through compatibility reformulation to the Agent API after Sonar support ended. A native Agent API migration requires a provider adapter change, not a different Sonar model ID.
