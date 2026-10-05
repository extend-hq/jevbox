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

## Decision model

In Connections, select **TypeSafe** or **Cloudflare** under **Decision model** and save. TypeSafe requires an API key. Cloudflare requires a 32-character account ID and a Workers AI API token with Read and Edit permissions; select Clef or Clef Flash. Obtain both values from the [Workers AI dashboard](https://developers.cloudflare.com/workers-ai/get-started/rest-api/). Jevbox calls the hosted REST API directly.

The selection applies to search, evidence scoring, automatic filing, and organization reviews, including API and MCP requests. Both providers’ credentials stay encrypted in organization settings when switching. Existing organizations default to TypeSafe. A missing or failing selected provider produces an error rather than falling back to the other provider. In-progress operations keep the provider they started with; new operations use the saved selection. Saving also resumes jobs waiting for credentials.

Clef uses the same typed Choice and Score requests as TypeSafe. The shared decision client validates the response after unwrapping Cloudflare’s REST envelope. Retrieval and filing retain their current thresholds; model probabilities are not calibrated accuracy guarantees. See [Clef](https://developers.cloudflare.com/workers-ai/models/clef/) and [Clef Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/).

Both Clef models have a 65,536-token context window and accept at most 64 questions and four images per request. Cloudflare limits each image to 4 MiB and 16 megapixels, decoded images together to 8 MiB, and the JSON request body to 13 MiB. Jevbox prepares static JPEGs within a stricter 2 MiB and 1800-pixel-per-side cap and validates the encoded bytes and actual dimensions before sending them. The decision client bounds text tokens conservatively by NFC-normalized UTF-8 bytes, including state, questions, image-source metadata, and additional schema framing; it reserves 4096 tokens per image for vision patches. This reserve covers 32-pixel merged patches at the prepared image cap, based on the published [Clef processor](https://huggingface.co/Cloudflare/clef/blob/main/processor_config.json) and [Clef Flash processor](https://huggingface.co/Cloudflare/clef-flash/blob/main/processor_config.json). Large question batches split into separate requests while keeping complete excerpts and their image assignments. Routing previews can shorten evenly to fit while retaining every choice. An individual evaluation that still exceeds the budget fails locally instead of relying on provider truncation. These guards apply to search, scoring, filing, and organization reviews.

The REST gateway also estimates tokens from the complete serialized JSON, including base64 image data. Jevbox caps that payload at 240 KiB, leaving headroom below the observed 65,536-token check. It retains every selected image and all request text, recompressing JPEGs and reducing dimensions only as needed to fit the remaining byte budget. Images that already fit are preserved. This can reduce fine visual detail on dense pages; the extracted text remains available alongside the images. A payload that still cannot fit fails explicitly, and HTTP 413 errors identify a size or context limit.

## Search and chat context

Search and chat require a configured TypeSafe or Cloudflare decision model and share hierarchical retrieval followed by a usefulness filter. Candidate excerpts are scored in batches of at most 16, with two scoring requests in flight across the process. Each question carries only its own full excerpt and the shared query, so batching does not combine passages into one judgment. The four-level rubric remains unrelated (0), same topic without answering (1), useful supporting evidence (2), and a direct answer (3). Only scores of at least 1.5 are retained. Missing or invalid batch answers fail the entire request. Source permissions are checked inside the scoring request limiter and again after the response.

Retrieval keeps its existing 96-passage exploration budget, stops early when the evidence answers the entire question, and widens when evidence is incomplete. Results contain at most 12 passages and 24,000 characters. Attached documents retain their scope. Empty results remain empty, and missing credentials or provider failures fail explicitly.

Chat permits two independent search or inspection tools to run concurrently. Identical in-flight lookups share work; subsequent lookups still run and recheck permissions. Citation allocation and dependency updates are serialized after retrieval. The selected answer model streams text while partial writes coalesce at roughly 100-millisecond intervals. Completion waits for pending writes and rechecks permissions.

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
