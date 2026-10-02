export const uploadLimits = {
  fileBytes: 30 * 1024 * 1024,
  textBytes: 2 * 1024 * 1024,
  mcpBytes: 2 * 1024 * 1024,
  active: 2,
  receiveMs: 30_000,
  textLines: 50_000,
  textPages: 1000,
  textHeadings: 2000,
  parserResponseBytes: 16 * 1024 * 1024,
  indexChunks: 2000,
  indexBlocks: 10_000,
  indexNodes: 5000,
  indexTextCharacters: 4 * 1024 * 1024,
  indexReferences: 100_000,
  indexReferenceCharacters: 32 * 1024 * 1024,
  documents: { user: 1000, organization: 5000, deployment: 10_000 },
  pending: { user: 10, organization: 50, deployment: 100 },
  storedBytes: {
    user: 512 * 1024 * 1024,
    organization: 2 * 1024 ** 3,
    deployment: 5 * 1024 ** 3,
  },
  dailyBytes: {
    user: 150 * 1024 * 1024,
    organization: 1024 ** 3,
    deployment: 2 * 1024 ** 3,
  },
} as const;

export function textWithinProcessingLimits(text: string) {
  let lines = 1,
    pages = 1,
    headings = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines > uploadLimits.textLines)
      return false;
    if (text.charCodeAt(i) === 12 && ++pages > uploadLimits.textPages)
      return false;
  }
  for (const _heading of text.matchAll(/^#{1,6}\s/gm))
    if (++headings > uploadLimits.textHeadings) return false;
  return true;
}
