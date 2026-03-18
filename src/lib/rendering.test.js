import { DRAW_MODE_CLASSIC, POINT_KIND_A, POINT_KIND_B, addPoint, clear, setDrawMode } from './lasso.js';
import { CORNER_TYPE_CHAMFER, CORNER_TYPE_TRUE_RADIUS } from './rounded-path.js';
import { buildSvgPathFromShape, createShapeFromDraft } from './shapes.js';

describe('rendering exports', () => {
  it('builds a closed SVG path for the dual-point mode', () => {
    let state = clear();
    state = addPoint(state, POINT_KIND_A, { x: 0.1, y: 0.1 });
    state = addPoint(state, POINT_KIND_B, { x: 0.9, y: 0.1 });
    state = addPoint(state, POINT_KIND_A, { x: 0.2, y: 0.6 });
    state = addPoint(state, POINT_KIND_B, { x: 0.8, y: 0.65 });

    const path = buildSvgPathFromShape(createShapeFromDraft(state), { width: 1000, height: 500 });

    expect(path).toContain('Q');
    expect(path.endsWith('Z')).toBe(true);
  });

  it('builds a closed SVG path for the classic polygon mode', () => {
    let state = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    state = addPoint(state, POINT_KIND_A, { x: 0.2, y: 0.2 });
    state = addPoint(state, POINT_KIND_A, { x: 0.8, y: 0.25 });
    state = addPoint(state, POINT_KIND_A, { x: 0.6, y: 0.8 });

    const path = buildSvgPathFromShape(createShapeFromDraft(state), { width: 1000, height: 500 });

    expect(path).toContain('Q');
    expect(path.endsWith('Z')).toBe(true);
  });

  it('can disable corner rounding globally for SVG output', () => {
    let state = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    state = addPoint(state, POINT_KIND_A, { x: 0.2, y: 0.2 });
    state = addPoint(state, POINT_KIND_A, { x: 0.8, y: 0.25 });
    state = addPoint(state, POINT_KIND_A, { x: 0.6, y: 0.8 });

    const path = buildSvgPathFromShape(createShapeFromDraft(state), { width: 1000, height: 500 }, {
      cornerRadius: 0,
    });

    expect(path).not.toContain('Q');
    expect(path.endsWith('Z')).toBe(true);
  });

  it('supports true radius corners in SVG output', () => {
    let state = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    state = addPoint(state, POINT_KIND_A, { x: 0.2, y: 0.2 });
    state = addPoint(state, POINT_KIND_A, { x: 0.8, y: 0.25 });
    state = addPoint(state, POINT_KIND_A, { x: 0.6, y: 0.8 });

    const path = buildSvgPathFromShape(createShapeFromDraft(state), { width: 1000, height: 500 }, {
      cornerRadius: 36,
      cornerType: CORNER_TYPE_TRUE_RADIUS,
    });

    expect(path).toContain('A');
    expect(path.endsWith('Z')).toBe(true);
  });

  it('supports chamfer corners in SVG output', () => {
    let state = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    state = addPoint(state, POINT_KIND_A, { x: 0.2, y: 0.2 });
    state = addPoint(state, POINT_KIND_A, { x: 0.8, y: 0.25 });
    state = addPoint(state, POINT_KIND_A, { x: 0.6, y: 0.8 });

    const path = buildSvgPathFromShape(createShapeFromDraft(state), { width: 1000, height: 500 }, {
      cornerRadius: 36,
      cornerType: CORNER_TYPE_CHAMFER,
    });

    expect(path).not.toContain('Q');
    expect(path).not.toContain('A');
    expect(path.endsWith('Z')).toBe(true);
  });
});
