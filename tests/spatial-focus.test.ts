import assert from "node:assert/strict";
import { test } from "node:test";
import { Box3, Vector3 } from "three";
import { occludesSpatialFocus } from "../src/lib/spatial-focus";

function bounds(x: number, y: number, depth: number, width = 2, height = 3) {
  return new Box3(
    new Vector3(x - width / 2, y - height / 2, -depth - 0.1),
    new Vector3(x + width / 2, y + height / 2, -depth + 0.1),
  );
}

test("foreground content clears the focused sightline, including partial overlaps", () => {
  const focus = bounds(0, 0, 10);
  assert.equal(occludesSpatialFocus(focus, bounds(0, 0, 5), 0.1), true);
  assert.equal(occludesSpatialFocus(focus, bounds(1.45, 0, 5), 0.1), true);
  assert.equal(occludesSpatialFocus(focus, bounds(0, 2, 5), 0.1), true);
  assert.equal(occludesSpatialFocus(focus, bounds(4, 0, 5), 0.1), false);
  assert.equal(occludesSpatialFocus(focus, bounds(0, 4, 5), 0.1), false);
});

test("content behind, alongside, or past the camera stays unsuppressed", () => {
  const focus = bounds(0, 0, 10);
  assert.equal(occludesSpatialFocus(focus, bounds(0, 0, 15), 0.1), false);
  assert.equal(occludesSpatialFocus(focus, bounds(0, 0, 10), 0.1), false);
  assert.equal(occludesSpatialFocus(focus, bounds(0, 0, -1), 0.1), false);
  assert.equal(
    occludesSpatialFocus(bounds(0, 0, -1), bounds(0, 0, 5), 0.1),
    false,
  );
});

test("perspective overlap uses the entire reading area and clips at the near plane", () => {
  const focus = bounds(3, -1, 12, 8, 6);
  assert.equal(occludesSpatialFocus(focus, bounds(2, -1, 6), 0.1), true);
  assert.equal(occludesSpatialFocus(focus, bounds(0, 0, 0.15), 0.1), true);
  assert.equal(occludesSpatialFocus(focus, bounds(10, 0, 6), 0.1), false);
});
