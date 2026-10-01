import type { Box3 } from "three";

function projectedRange(min: number, max: number, near: number, far: number) {
  return [Math.min(min / near, min / far), Math.max(max / near, max / far)];
}

/** Bounds are in camera space, where visible content has negative Z. */
export function occludesSpatialFocus(
  focus: Box3,
  candidate: Box3,
  cameraNear: number,
) {
  const focusNear = -focus.max.z;
  const focusFar = -focus.min.z;
  const candidateNear = Math.max(cameraNear, -candidate.max.z);
  const candidateFar = -candidate.min.z;
  if (
    focusNear <= cameraNear ||
    candidateFar <= cameraNear ||
    candidateNear >= focusNear - 0.01
  )
    return false;

  const focusX = projectedRange(focus.min.x, focus.max.x, focusNear, focusFar);
  const focusY = projectedRange(focus.min.y, focus.max.y, focusNear, focusFar);
  const candidateX = projectedRange(
    candidate.min.x,
    candidate.max.x,
    candidateNear,
    candidateFar,
  );
  const candidateY = projectedRange(
    candidate.min.y,
    candidate.max.y,
    candidateNear,
    candidateFar,
  );
  const marginX = (focusX[1] - focusX[0]) * 0.05;
  const marginY = (focusY[1] - focusY[0]) * 0.05;
  return (
    candidateX[1] >= focusX[0] - marginX &&
    candidateX[0] <= focusX[1] + marginX &&
    candidateY[1] >= focusY[0] - marginY &&
    candidateY[0] <= focusY[1] + marginY
  );
}
