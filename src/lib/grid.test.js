import { GRID_STEP_PX, snapPointToGrid } from './grid.js';

describe('grid helpers', () => {
  it('snaps normalized points to the visible canvas grid', () => {
    const snapped = snapPointToGrid({ x: 0.151, y: 0.278 }, { width: 1000, height: 500 });

    expect(snapped).toEqual({
      x: 160 / 1000,
      y: 128 / 500,
    });
  });

  it('keeps snapped points on the infinite grid even outside the original surface bounds', () => {
    const snapped = snapPointToGrid({ x: 1.2, y: -0.2 }, { width: 960, height: 640 }, GRID_STEP_PX);

    expect(snapped).toEqual({
      x: 1.2,
      y: -0.2,
    });
  });
});
