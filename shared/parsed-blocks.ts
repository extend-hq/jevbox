export type ParsedBlock = {
  id: string;
  type: string;
  content: string;
  page: number;
  rotationApplied?: number;
  pageWidth?: number;
  pageHeight?: number;
  boundingBox?: { left: number; top: number; right: number; bottom: number };
};

export function blockHighlightArea(block: ParsedBlock, sourceRotation = 0) {
  const box = block.boundingBox;
  const width = block.pageWidth;
  const height = block.pageHeight;
  if (!box || !width || !height || width <= 0 || height <= 0) return null;
  if (![width, height, ...Object.values(box)].every(Number.isFinite))
    return null;
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  const right = Math.min(width, box.right);
  const bottom = Math.min(height, box.bottom);
  if (right <= left || bottom <= top) return null;
  const area = {
    left: (left / width) * 100,
    top: (top / height) * 100,
    width: ((right - left) / width) * 100,
    height: ((bottom - top) / height) * 100,
  };
  const rotation =
    ((((block.rotationApplied ?? 0) + sourceRotation) % 360) + 360) % 360;
  if (rotation === 90)
    return {
      left: area.top,
      top: 100 - area.left - area.width,
      width: area.height,
      height: area.width,
    };
  if (rotation === 180)
    return {
      ...area,
      left: 100 - area.left - area.width,
      top: 100 - area.top - area.height,
    };
  if (rotation === 270)
    return {
      left: 100 - area.top - area.height,
      top: area.left,
      width: area.height,
      height: area.width,
    };
  return rotation === 0 ? area : null;
}
