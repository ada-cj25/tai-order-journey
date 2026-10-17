export type CatGazeInput = {
  pointerX: number;
  pointerY: number;
  eyeCenterX: number;
  eyeCenterY: number;
  viewportWidth: number;
  viewportHeight: number;
  socketWidth: number;
  socketHeight: number;
  pupilElementWidth: number;
  pupilElementHeight: number;
};

export const CAT_PUPIL_VISIBLE_BOUNDS = {
  left: 381 / 1254,
  top: 273 / 1254,
  right: 873 / 1254,
  bottom: 981 / 1254,
} as const;

const normalizeToViewport = (coordinate: number, center: number, extent: number) => {
  const available = coordinate < center ? center : extent - center;
  return Math.max(-1, Math.min(1, (coordinate - center) / Math.max(1, available)));
};

export function computeCatGaze(input: CatGazeInput) {
  const horizontal = normalizeToViewport(input.pointerX, input.eyeCenterX, input.viewportWidth);
  const vertical = normalizeToViewport(input.pointerY, input.eyeCenterY, input.viewportHeight);
  // The CSS clipping ellipse is slightly wider at the hand-drawn left/top lines.
  // Keep those two directions farther in while preserving the accepted right/down reach.
  const edgeInset = { left: 3, right: 0.5, top: 7, bottom: 0.5 };
  const leftReach = Math.max(0, input.socketWidth / 2 - input.pupilElementWidth * (0.5 - CAT_PUPIL_VISIBLE_BOUNDS.left) - edgeInset.left);
  const rightReach = Math.max(0, input.socketWidth / 2 - input.pupilElementWidth * (CAT_PUPIL_VISIBLE_BOUNDS.right - 0.5) - edgeInset.right);
  const topReach = Math.max(0, input.socketHeight / 2 - input.pupilElementHeight * (0.5 - CAT_PUPIL_VISIBLE_BOUNDS.top) - edgeInset.top);
  const bottomReach = Math.max(0, input.socketHeight / 2 - input.pupilElementHeight * (CAT_PUPIL_VISIBLE_BOUNDS.bottom - 0.5) - edgeInset.bottom);
  return {
    x: horizontal * (horizontal < 0 ? leftReach : rightReach),
    y: vertical * (vertical < 0 ? topReach : bottomReach),
  };
}
