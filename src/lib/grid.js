export const GRID_STEP_PX = 32;
export const GRID_MAJOR_STEP_PX = GRID_STEP_PX * 4;

export function snapPointToGrid(point, surfaceSize, stepPx = GRID_STEP_PX) {
  if (!point || !surfaceSize) {
    return point;
  }

  const width = Math.max(1, Number(surfaceSize.width) || 1);
  const height = Math.max(1, Number(surfaceSize.height) || 1);
  const step = Math.max(1, Number(stepPx) || GRID_STEP_PX);

  return {
    x: Math.round(point.x * width / step) * step / width,
    y: Math.round(point.y * height / step) * step / height,
  };
}
