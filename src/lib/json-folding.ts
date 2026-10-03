export type JsonFoldKind = "array" | "object";

export type JsonFoldKey = number;

export type JsonFoldRange = {
  key: JsonFoldKey;
  kind: JsonFoldKind;
  depth: number;
  parentKey: JsonFoldKey | null;
  parentIndex: number | null;
  index: number;
  subtreeEndIndex: number;
  startLine: number;
  startColumn: number;
  startOffset: number;
  endLine: number;
  endColumn: number;
  endOffset: number;
};

export type JsonFoldingModel = {
  lineCount: number;
  ranges: JsonFoldRange[];
};

export type VisibleJsonLineSegment = {
  visibleStart: number;
  visibleEnd: number;
  originalStart: number;
};

export type VisibleJsonFold = {
  range: JsonFoldRange;
  visibleLine: number;
};

export type VisibleJsonDocument = {
  contents: string;
  lineCount: number;
  signature: string;
  lineSegments: VisibleJsonLineSegment[];
  collapsedFolds: VisibleJsonFold[];
};

type OpenRange = {
  key: JsonFoldKey;
  kind: JsonFoldKind;
  openingCharacter: "[" | "{";
  depth: number;
  parent: OpenRange | null;
  rangeIndex: number;
  startLine: number;
  startColumn: number;
  startOffset: number;
  endLine: number;
  endColumn: number;
  endOffset: number;
};

const EMPTY_MODEL: JsonFoldingModel = {
  lineCount: 0,
  ranges: [],
};

const OPEN_DOCUMENT_SIGNATURE = "open";

const isMatchingPair = (
  openingCharacter: "[" | "{",
  closingCharacter: "]" | "}",
) =>
  (openingCharacter === "{" && closingCharacter === "}") ||
  (openingCharacter === "[" && closingCharacter === "]");

export function createJsonFoldingModel(value: string): JsonFoldingModel {
  if (!value) return EMPTY_MODEL;

  const candidates: OpenRange[] = [];
  const stack: OpenRange[] = [];
  let line = 0;
  let column = 0;
  let inString = false;
  let escaped = false;

  for (let offset = 0; offset < value.length; offset++) {
    const character = value[offset];

    if (character === "\n") {
      inString = false;
      escaped = false;
      line++;
      column = 0;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      column++;
      continue;
    }

    if (character === '"') {
      inString = true;
      column++;
      continue;
    }

    if (character === "{" || character === "[") {
      const range: OpenRange = {
        key: offset,
        kind: character === "{" ? "object" : "array",
        openingCharacter: character,
        depth: stack.length,
        parent: stack.at(-1) ?? null,
        rangeIndex: -1,
        startLine: line,
        startColumn: column,
        startOffset: offset,
        endLine: -1,
        endColumn: -1,
        endOffset: -1,
      };
      candidates.push(range);
      stack.push(range);
    } else if (character === "}" || character === "]") {
      const openRange = stack.at(-1);
      if (openRange && isMatchingPair(openRange.openingCharacter, character)) {
        stack.pop();
        openRange.endLine = line;
        openRange.endColumn = column;
        openRange.endOffset = offset;
      }
    }

    column++;
  }

  const ranges: JsonFoldRange[] = [];
  for (const candidate of candidates) {
    if (candidate.endLine <= candidate.startLine) continue;

    let parent = candidate.parent;
    while (parent && parent.rangeIndex === -1) parent = parent.parent;

    candidate.rangeIndex = ranges.length;
    ranges.push({
      key: candidate.key,
      kind: candidate.kind,
      depth: candidate.depth,
      parentKey: parent?.key ?? null,
      parentIndex: parent?.rangeIndex ?? null,
      index: candidate.rangeIndex,
      subtreeEndIndex: candidate.rangeIndex + 1,
      startLine: candidate.startLine,
      startColumn: candidate.startColumn,
      startOffset: candidate.startOffset,
      endLine: candidate.endLine,
      endColumn: candidate.endColumn,
      endOffset: candidate.endOffset,
    });
  }

  const ancestorIndexes: number[] = [];
  for (const range of ranges) {
    while (ancestorIndexes.length > 0) {
      const ancestorIndex = ancestorIndexes.at(-1)!;
      if (range.startOffset < ranges[ancestorIndex]!.endOffset) break;
      ranges[ancestorIndex]!.subtreeEndIndex = range.index;
      ancestorIndexes.pop();
    }
    ancestorIndexes.push(range.index);
  }
  for (const ancestorIndex of ancestorIndexes)
    ranges[ancestorIndex]!.subtreeEndIndex = ranges.length;

  return {
    lineCount: line + 1,
    ranges,
  };
}

function findJsonFoldRange(
  model: JsonFoldingModel,
  key: JsonFoldKey,
): JsonFoldRange | undefined {
  let low = 0;
  let high = model.ranges.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = model.ranges[middle]!;
    if (range.key === key) return range;
    if (range.key < key) low = middle + 1;
    else high = middle - 1;
  }

  return undefined;
}

export function findJsonFoldRangeStartingOnLine(
  model: JsonFoldingModel,
  originalLine: number,
): JsonFoldRange | undefined {
  let low = 0;
  let high = model.ranges.length;

  while (low < high) {
    const middle = (low + high) >>> 1;
    if (model.ranges[middle]!.startLine < originalLine) low = middle + 1;
    else high = middle;
  }

  return model.ranges[low]?.startLine === originalLine
    ? model.ranges[low]
    : undefined;
}

function getVisibleCollapsedRanges(
  model: JsonFoldingModel,
  collapsedKeys: ReadonlySet<JsonFoldKey>,
): JsonFoldRange[] {
  const visibleRanges: JsonFoldRange[] = [];

  for (const key of collapsedKeys) {
    const range = findJsonFoldRange(model, key);
    if (!range) continue;

    let parentIndex = range.parentIndex;
    let hiddenByAncestor = false;
    while (parentIndex !== null) {
      const parent = model.ranges[parentIndex]!;
      if (collapsedKeys.has(parent.key)) {
        hiddenByAncestor = true;
        break;
      }
      parentIndex = parent.parentIndex;
    }

    if (!hiddenByAncestor) visibleRanges.push(range);
  }

  visibleRanges.sort((left, right) => left.startOffset - right.startOffset);
  return visibleRanges;
}

const updateSignatureHash = (hash: number, value: number) =>
  Math.imul(hash ^ value, 16_777_619);

function createFoldSignature(ranges: readonly JsonFoldRange[]): string {
  let firstHash = 2_166_136_261;
  let secondHash = 2_166_136_261;

  for (const range of ranges) {
    firstHash = updateSignatureHash(firstHash, range.startOffset);
    firstHash = updateSignatureHash(firstHash, range.endOffset);
    secondHash = updateSignatureHash(
      secondHash,
      range.endOffset - range.startOffset,
    );
    secondHash = updateSignatureHash(secondHash, range.depth);
  }

  return `${ranges.length}:${(firstHash >>> 0).toString(36)}:${(secondHash >>> 0).toString(36)}`;
}

export function createVisibleJsonDocument(
  value: string,
  model: JsonFoldingModel,
  collapsedKeys: ReadonlySet<JsonFoldKey>,
): VisibleJsonDocument {
  const activeRanges = getVisibleCollapsedRanges(model, collapsedKeys);
  if (activeRanges.length === 0) {
    return {
      contents: value,
      lineCount: model.lineCount,
      signature: OPEN_DOCUMENT_SIGNATURE,
      lineSegments:
        model.lineCount > 0
          ? [{ visibleStart: 0, visibleEnd: model.lineCount, originalStart: 0 }]
          : [],
      collapsedFolds: [],
    };
  }

  const sourcePieces: string[] = [];
  const lineSegments: VisibleJsonLineSegment[] = [];
  const collapsedFolds: VisibleJsonFold[] = [];
  let sourceOffset = 0;
  let originalLine = 0;
  let visibleLine = 0;

  for (const range of activeRanges) {
    sourcePieces.push(value.slice(sourceOffset, range.startOffset + 1));
    sourceOffset = range.endOffset;

    const visibleLinesThroughOpening = Math.max(
      0,
      range.startLine - originalLine + 1,
    );
    if (visibleLinesThroughOpening > 0) {
      lineSegments.push({
        visibleStart: visibleLine,
        visibleEnd: visibleLine + visibleLinesThroughOpening,
        originalStart: originalLine,
      });
      visibleLine += visibleLinesThroughOpening;
    }

    collapsedFolds.push({ range, visibleLine: Math.max(0, visibleLine - 1) });
    originalLine = Math.max(originalLine, range.endLine + 1);
  }

  sourcePieces.push(value.slice(sourceOffset));
  const trailingLines = Math.max(0, model.lineCount - originalLine);
  if (trailingLines > 0) {
    lineSegments.push({
      visibleStart: visibleLine,
      visibleEnd: visibleLine + trailingLines,
      originalStart: originalLine,
    });
    visibleLine += trailingLines;
  }

  return {
    contents: sourcePieces.join(""),
    lineCount: visibleLine,
    signature: createFoldSignature(activeRanges),
    lineSegments,
    collapsedFolds,
  };
}

export function mapVisibleJsonLineToOriginal(
  document: VisibleJsonDocument,
  visibleLine: number,
): number {
  let low = 0;
  let high = document.lineSegments.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const segment = document.lineSegments[middle]!;
    if (visibleLine < segment.visibleStart) high = middle - 1;
    else if (visibleLine >= segment.visibleEnd) low = middle + 1;
    else return segment.originalStart + visibleLine - segment.visibleStart;
  }

  return Math.max(0, visibleLine);
}
