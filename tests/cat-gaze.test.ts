import assert from "node:assert/strict";
import test from "node:test";
import { CAT_PUPIL_VISIBLE_BOUNDS, computeCatGaze } from "../src/cat-gaze";

test("visible pupil reaches the right and bottom eye-socket edges", () => {
  const socketWidth = 22.88;
  const socketHeight = 27.01;
  const pupilElementWidth = socketWidth * 0.52;
  const pupilElementHeight = socketHeight * 0.66;
  const gaze = computeCatGaze({
    pointerX: 1280,
    pointerY: 720,
    eyeCenterX: 920,
    eyeCenterY: 115,
    viewportWidth: 1280,
    viewportHeight: 720,
    socketWidth,
    socketHeight,
    pupilElementWidth,
    pupilElementHeight,
  });
  const rightGap = socketWidth / 2 - (gaze.x + pupilElementWidth * (CAT_PUPIL_VISIBLE_BOUNDS.right - 0.5));
  const bottomGap = socketHeight / 2 - (gaze.y + pupilElementHeight * (CAT_PUPIL_VISIBLE_BOUNDS.bottom - 0.5));
  assert.ok(rightGap <= 1, `right pupil gap is ${rightGap.toFixed(2)}px`);
  assert.ok(bottomGap <= 1, `bottom pupil gap is ${bottomGap.toFixed(2)}px`);
});

test("visible pupil keeps extra clearance from the hand-drawn left and top eye lines", () => {
  const socketWidth = 22.88;
  const socketHeight = 27.01;
  const pupilElementWidth = socketWidth * 0.52;
  const pupilElementHeight = socketHeight * 0.66;
  const gaze = computeCatGaze({
    pointerX: 0,
    pointerY: 0,
    eyeCenterX: 920,
    eyeCenterY: 115,
    viewportWidth: 1280,
    viewportHeight: 720,
    socketWidth,
    socketHeight,
    pupilElementWidth,
    pupilElementHeight,
  });
  const leftGap = socketWidth / 2 - (-gaze.x + pupilElementWidth * (0.5 - CAT_PUPIL_VISIBLE_BOUNDS.left));
  const topGap = socketHeight / 2 - (-gaze.y + pupilElementHeight * (0.5 - CAT_PUPIL_VISIBLE_BOUNDS.top));
  assert.ok(leftGap >= 3, `left pupil clearance is only ${leftGap.toFixed(2)}px`);
  assert.ok(topGap >= 7, `top pupil clearance is only ${topGap.toFixed(2)}px`);
});
