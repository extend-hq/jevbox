import sharp from "sharp";
import type { ClefImage } from "./clef-images";
import { ProviderResponseError } from "./provider-http";

export const clefLimits = {
  contextTokens: 65_536,
  questions: 64,
  images: 4,
  imageBytes: 4 * 1024 * 1024,
  decodedImageBytes: 8 * 1024 * 1024,
  imagePixels: 16_000_000,
  requestBytes: 13 * 1024 * 1024,
  // The REST gateway estimates tokens from the entire JSON body, including base64.
  restRequestBytes: 240 * 1024,
  preparedImageBytes: 2 * 1024 * 1024,
  preparedImageDimension: 1800,
  // Covers the merged vision patches at the prepared dimension cap.
  imageTokens: 4096,
  framingTokens: 1024,
} as const;

export function clefInputTokenBound(
  state: unknown,
  questions: Record<string, unknown>,
  imageCount = 0,
) {
  const values = Object.values(questions);
  const options = values.reduce<number>((total, value) => {
    const criteria = (value as { criteria?: unknown }).criteria;
    return (
      total +
      (criteria && typeof criteria === "object"
        ? Object.keys(criteria).length
        : 2)
    );
  }, 0);
  // Byte-level tokens cannot outnumber normalized UTF-8 bytes. Allow schema framing
  // and reserve image patches separately from their base64 representation.
  return (
    Buffer.byteLength(
      JSON.stringify({ state, questions }).normalize("NFC"),
      "utf8",
    ) +
    values.length * 128 +
    options * 64 +
    clefLimits.framingTokens +
    imageCount * clefLimits.imageTokens
  );
}

export async function validateClefImages(images: ClefImage[]) {
  if (images.length > clefLimits.images)
    throw new ProviderResponseError(
      "Visual evidence exceeds Clef's image count limit.",
    );
  let bytes = 0;
  for (const image of images) {
    const size = Buffer.byteLength(image.base64, "base64");
    if (
      image.content_type !== "image/jpeg" ||
      !size ||
      size > clefLimits.imageBytes ||
      size > clefLimits.preparedImageBytes
    )
      throw new ProviderResponseError(
        "Visual evidence exceeds Clef's image size limit.",
      );
    bytes += size;
    if (bytes > clefLimits.decodedImageBytes)
      throw new ProviderResponseError(
        "Visual evidence exceeds Clef's total image size limit.",
      );
    const body = Buffer.from(image.base64, "base64");
    if (body.toString("base64") !== image.base64)
      throw new ProviderResponseError(
        "Visual evidence contains an invalid image.",
      );
    try {
      const { format, width, height, pages } = await sharp(body, {
        limitInputPixels: clefLimits.imagePixels,
      }).metadata();
      if (
        format !== "jpeg" ||
        !width ||
        !height ||
        (pages ?? 1) !== 1 ||
        width * height > clefLimits.imagePixels ||
        width > clefLimits.preparedImageDimension ||
        height > clefLimits.preparedImageDimension
      )
        throw new Error();
    } catch {
      throw new ProviderResponseError(
        "Visual evidence exceeds Clef's image dimensions or contains an invalid image.",
      );
    }
  }
}

export async function fitClefImages(
  images: ClefImage[],
  base64Budget: number,
  signal?: AbortSignal,
): Promise<ClefImage[]> {
  const result = [...images];
  const ordered = images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => a.image.base64.length - b.image.base64.length);
  let remaining = base64Budget;
  for (const [position, { image, index }] of ordered.entries()) {
    signal?.throwIfAborted();
    const budget = Math.floor(remaining / (ordered.length - position) / 4) * 4;
    if (image.base64.length <= budget) {
      remaining -= image.base64.length;
      continue;
    }
    if (budget <= 0)
      throw new ProviderResponseError(
        "The decision request leaves no room for visual evidence. Use a shorter question or smaller document scope.",
      );
    const source = sharp(Buffer.from(image.base64, "base64"), {
      limitInputPixels: clefLimits.imagePixels,
    });
    const metadata = await source.metadata();
    let dimension = Math.max(metadata.width!, metadata.height!);
    let fitted: Buffer | undefined;
    while (!fitted) {
      let smallest = Infinity;
      for (const quality of [80, 65, 50]) {
        signal?.throwIfAborted();
        const body = await source
          .clone()
          .resize({
            width: dimension,
            height: dimension,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
        signal?.throwIfAborted();
        const encodedBytes = Math.ceil(body.length / 3) * 4;
        if (encodedBytes <= budget) {
          fitted = body;
          break;
        }
        smallest = Math.min(smallest, encodedBytes);
      }
      if (fitted || dimension <= 256) break;
      const scale = Math.max(
        0.5,
        Math.min(0.9, Math.sqrt(budget / smallest) * 0.95),
      );
      dimension = Math.max(256, Math.floor(dimension * scale));
    }
    if (!fitted)
      throw new ProviderResponseError(
        "The visual evidence cannot fit Cloudflare's request limit. Use a shorter question or smaller document scope.",
      );
    result[index] = { ...image, base64: fitted.toString("base64") };
    remaining -= result[index].base64.length;
  }
  return result;
}

export function clefQuestionBatches(
  state: unknown,
  questions: Record<string, unknown>,
  imageCount = 0,
) {
  const entries = Object.entries(questions);
  if (!entries.length)
    throw new ProviderResponseError(
      "Clef requires at least one evaluation question.",
    );
  const batches: Record<string, unknown>[] = [];
  let batch: Record<string, unknown> = {};
  for (const [id, question] of entries) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(id))
      throw new ProviderResponseError(
        "Clef received an invalid question identifier.",
      );
    if (
      clefInputTokenBound(state, { [id]: question }, imageCount) >
      clefLimits.contextTokens
    )
      throw new ProviderResponseError(
        "The decision request exceeds Clef's context budget. Use a shorter question or smaller document scope.",
      );
    const next = { ...batch, [id]: question };
    if (
      Object.keys(next).length > clefLimits.questions ||
      clefInputTokenBound(state, next, imageCount) > clefLimits.contextTokens
    ) {
      batches.push(batch);
      batch = { [id]: question };
    } else {
      batch = next;
    }
  }
  batches.push(batch);
  return batches;
}
