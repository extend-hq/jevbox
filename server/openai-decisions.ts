import sharp from "sharp";
import { z } from "zod";
import { openaiDecisionModel } from "../shared/decision-model";
import type { ClefImage } from "./clef-images";
import { jsonRequest, ProviderResponseError } from "./provider-http";

export const openaiDecisionLimits = {
  inputTokens: 922_000,
  images: 128,
  questionsPerBatch: 128,
  requestBytes: 48 * 1024 * 1024,
  imageTokens: 8192,
  filingImages: 16,
} as const;

const questionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("choice"),
    instructions: z.string(),
    criteria: z
      .record(z.string(), z.string())
      .refine((choices) => Object.keys(choices).length >= 2),
  }),
  z.object({
    type: z.literal("score"),
    instructions: z.union([z.string(), z.record(z.string(), z.unknown())]),
    criteria: z.array(z.string()).min(2),
  }),
]);
type Question = z.infer<typeof questionSchema>;
const probability = z.number().finite().min(0).max(1);
const answerSchema = z.discriminatedUnion("type", [
  z.object({
    name: z.string(),
    type: z.literal("choice"),
    choice: z.string(),
    confidence: probability,
    probabilities: z.array(z.object({ value: z.string(), probability })),
  }),
  z.object({
    name: z.string(),
    type: z.literal("score"),
    score: z.number().finite(),
    confidence: probability,
    probabilities: z.array(
      z.object({
        value: z.number().int().nonnegative(),
        label: z.string(),
        probability,
      }),
    ),
  }),
  z.object({ name: z.string(), type: z.literal("refusal") }),
]);

function prepare(state: unknown, entries: [string, Question][]) {
  const questionEvidence: Record<string, unknown> = {};
  const questions = entries.map(([name, question]) => {
    let instructions = question.instructions;
    if (typeof instructions !== "string") {
      const { evidence, ...rest } = instructions;
      if (evidence !== undefined) {
        questionEvidence[name] = evidence;
        instructions = `${JSON.stringify(rest)} Evaluate only questionEvidence[${JSON.stringify(name)}] and its assigned images against state.question. Other excerpts are not evidence for this question.`;
      } else {
        instructions = JSON.stringify(rest);
      }
    }
    return {
      name,
      type: question.type,
      instructions,
      ...(question.type === "choice"
        ? {
            choices: Object.entries(question.criteria).map(
              ([value, description]) => ({ value, description }),
            ),
          }
        : {
            levels: question.criteria.map((description, index) => ({
              label: String(index),
              description,
            })),
          }),
    };
  });
  return {
    text: JSON.stringify({
      state,
      ...(Object.keys(questionEvidence).length ? { questionEvidence } : {}),
    }),
    questions,
  };
}

function tokenBound(prepared: ReturnType<typeof prepare>, imageCount: number) {
  const options = prepared.questions.reduce(
    (sum, question) =>
      sum +
      ("choices" in question
        ? question.choices.length
        : question.levels.length),
    0,
  );
  // UTF-8 bytes bound text tokens; reserve schema framing and vision tokens separately.
  return (
    Buffer.byteLength(
      prepared.text + JSON.stringify(prepared.questions),
      "utf8",
    ) +
    2048 +
    prepared.questions.length * 128 +
    options * 64 +
    imageCount * openaiDecisionLimits.imageTokens
  );
}

function requestState(state: unknown, images: ClefImage[]) {
  return images.length
    ? {
        ...(state && typeof state === "object" && !Array.isArray(state)
          ? state
          : { evidence: state }),
        imageSources: images.map(
          ({ documentId, page, blockIds, view }, index) => ({
            image: index + 1,
            documentId,
            page,
            blockIds,
            view,
          }),
        ),
      }
    : state;
}

function requestBody(
  prepared: ReturnType<typeof prepare>,
  images: ClefImage[],
  includeImageData = true,
) {
  return JSON.stringify({
    model: openaiDecisionModel,
    input: images.length
      ? [
          {
            role: "user",
            content: [
              { type: "input_text", text: prepared.text },
              ...images.map((image) => ({
                type: "input_image",
                image_url: `data:${image.content_type};base64,${includeImageData ? image.base64 : ""}`,
                detail: "high",
              })),
            ],
          },
        ]
      : prepared.text,
    questions: prepared.questions,
  });
}

function requestFits(
  prepared: ReturnType<typeof prepare>,
  images: ClefImage[],
) {
  return (
    prepared.questions.length <= openaiDecisionLimits.questionsPerBatch &&
    images.length <= openaiDecisionLimits.images &&
    tokenBound(prepared, images.length) <= openaiDecisionLimits.inputTokens &&
    Buffer.byteLength(requestBody(prepared, images, false), "utf8") +
      images.reduce((sum, image) => sum + image.base64.length, 0) <=
      openaiDecisionLimits.requestBytes
  );
}

export function openaiDecisionRequestFits(
  state: unknown,
  questions: Record<string, unknown>,
  images: ClefImage[],
) {
  const parsed = z.record(z.string(), questionSchema).safeParse(questions);
  return (
    parsed.success &&
    requestFits(
      prepare(requestState(state, images), Object.entries(parsed.data)),
      images,
    )
  );
}

async function validateImages(images: ClefImage[], signal?: AbortSignal) {
  if (images.length > openaiDecisionLimits.images)
    throw new ProviderResponseError(
      "Visual evidence exceeds OpenAI's image count limit.",
    );
  for (const image of images) {
    signal?.throwIfAborted();
    const body = Buffer.from(image.base64, "base64");
    if (
      image.content_type !== "image/jpeg" ||
      !body.length ||
      body.length > 2 * 1024 * 1024 ||
      body.toString("base64") !== image.base64
    )
      throw new ProviderResponseError(
        "Visual evidence contains an invalid or oversized image.",
      );
    try {
      const { format, width, height, pages } = await sharp(body, {
        limitInputPixels: 3_240_000,
      }).metadata();
      if (
        format !== "jpeg" ||
        !width ||
        !height ||
        width > 1800 ||
        height > 1800 ||
        (pages ?? 1) !== 1
      )
        throw new Error();
    } catch {
      throw new ProviderResponseError(
        "Visual evidence contains invalid image dimensions or data.",
      );
    }
  }
}

export async function evaluateOpenAIDecisions(
  key: string,
  fetcher: typeof fetch,
  state: unknown,
  questions: Record<string, unknown>,
  images: ClefImage[] = [],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  await validateImages(images, signal);
  const parsedQuestions = z
    .record(z.string(), questionSchema)
    .safeParse(questions);
  if (!parsedQuestions.success || !Object.keys(parsedQuestions.data).length)
    throw new ProviderResponseError(
      "OpenAI received invalid evaluation questions.",
    );
  const sourceState = requestState(state, images);
  const fits = (entries: [string, Question][]) =>
    requestFits(prepare(sourceState, entries), images);
  const batches: [string, Question][][] = [];
  let batch: [string, Question][] = [];
  for (const entry of Object.entries(parsedQuestions.data)) {
    if (!fits([entry]))
      throw new ProviderResponseError(
        "The decision request exceeds OpenAI's context or request budget. Use a smaller document scope or selection.",
      );
    if (batch.length && !fits([...batch, entry])) {
      batches.push(batch);
      batch = [];
    }
    batch.push(entry);
  }
  if (batch.length) batches.push(batch);
  const answers: Record<string, unknown> = {};
  for (const entries of batches) {
    signal?.throwIfAborted();
    const response = await jsonRequest(
      fetcher,
      "https://api.openai.com/v1/decisions",
      {
        signal,
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: requestBody(prepare(sourceState, entries), images),
      },
    );
    const parsed = z
      .object({ answers: z.array(answerSchema) })
      .safeParse(response);
    if (!parsed.success || parsed.data.answers.length !== entries.length)
      throw new ProviderResponseError(
        "OpenAI returned an invalid decision response. Try again.",
      );
    const expected = new Map(entries);
    const seen = new Set<string>();
    for (const answer of parsed.data.answers) {
      const question = expected.get(answer.name);
      if (!question || seen.has(answer.name))
        throw new ProviderResponseError(
          "OpenAI returned an invalid question identifier. Try again.",
        );
      seen.add(answer.name);
      if (answer.type === "refusal")
        throw new ProviderResponseError(
          "OpenAI declined to evaluate this evidence. Try a different question or selection.",
        );
      if (answer.type !== question.type)
        throw new ProviderResponseError(
          "OpenAI returned an unexpected decision type. Try again.",
        );
      const values: (string | number)[] = answer.probabilities.map(
        (item) => item.value,
      );
      const required =
        question.type === "choice"
          ? Object.keys(question.criteria)
          : question.criteria.map((_, index) => index);
      const total = answer.probabilities.reduce(
        (sum, item) => sum + item.probability,
        0,
      );
      if (
        values.length !== required.length ||
        new Set(values).size !== values.length ||
        required.some((value) => !values.includes(value)) ||
        Math.abs(total - 1) > 0.02
      )
        throw new ProviderResponseError(
          "OpenAI returned an invalid probability distribution. Try again.",
        );
      if (answer.type === "choice") {
        if (!values.includes(answer.choice))
          throw new ProviderResponseError(
            "OpenAI returned an invalid choice. Try again.",
          );
        answers[answer.name] = {
          type: "choice",
          probabilities: Object.fromEntries(
            answer.probabilities.map(({ value, probability }) => [
              value,
              probability,
            ]),
          ),
        };
      } else {
        const weighted = answer.probabilities.reduce(
          (sum, item) => sum + item.value * item.probability,
          0,
        );
        if (
          answer.score < 0 ||
          answer.score > required.length - 1 ||
          Math.abs(answer.score - weighted) > 0.02
        )
          throw new ProviderResponseError(
            "OpenAI returned an invalid evidence score. Try again.",
          );
        answers[answer.name] = { type: "score", score: answer.score };
      }
    }
  }
  return answers;
}
