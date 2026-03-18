import {
  DRAW_MODE_CLASSIC,
  PHASE_AWAITING_A,
  PHASE_AWAITING_B,
  POINT_KIND_A,
  POINT_KIND_B,
  addPoint,
  buildFillPolygon,
  clear,
  getClosedShapePoints,
  getPreviewSegment,
  hasClosedShape,
  setDrawMode,
  undo,
} from './lasso.js';

describe('lasso logic', () => {
  it('allows the first Point 1 but blocks Point 2 before Point 1 exists', () => {
    const emptyState = clear();
    const blocked = addPoint(emptyState, POINT_KIND_B, { x: 0.25, y: 0.25 });
    const started = addPoint(emptyState, POINT_KIND_A, { x: 0.25, y: 0.25 });

    expect(blocked).toBe(emptyState);
    expect(started.pointsA).toEqual([{ x: 0.25, y: 0.25 }]);
    expect(started.phase).toBe(PHASE_AWAITING_B);
  });

  it('enforces the strict Point 1 to Point 2 sequence', () => {
    const afterFirstA = addPoint(clear(), POINT_KIND_A, { x: 0.1, y: 0.2 });
    const blockedSecondA = addPoint(afterFirstA, POINT_KIND_A, { x: 0.2, y: 0.3 });
    const afterFirstB = addPoint(afterFirstA, POINT_KIND_B, { x: 0.8, y: 0.2 });
    const afterSecondA = addPoint(afterFirstB, POINT_KIND_A, { x: 0.3, y: 0.5 });

    expect(blockedSecondA).toBe(afterFirstA);
    expect(afterFirstB.phase).toBe(PHASE_AWAITING_A);
    expect(afterSecondA.pointsA).toEqual([
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.5 },
    ]);
    expect(afterSecondA.phase).toBe(PHASE_AWAITING_B);
  });

  it('keeps the two chains independent while building pairs', () => {
    let state = clear();
    state = addPoint(state, POINT_KIND_A, { x: 0.15, y: 0.2 });
    state = addPoint(state, POINT_KIND_B, { x: 0.85, y: 0.2 });
    state = addPoint(state, POINT_KIND_A, { x: 0.2, y: 0.7 });
    state = addPoint(state, POINT_KIND_B, { x: 0.8, y: 0.75 });

    expect(state.pointsA).toEqual([
      { x: 0.15, y: 0.2 },
      { x: 0.2, y: 0.7 },
    ]);
    expect(state.pointsB).toEqual([
      { x: 0.85, y: 0.2 },
      { x: 0.8, y: 0.75 },
    ]);
    expect(state.phase).toBe(PHASE_AWAITING_A);
  });

  it('undoes a pending Point 1 before removing completed pairs', () => {
    let state = clear();
    state = addPoint(state, POINT_KIND_A, { x: 0.2, y: 0.2 });
    state = addPoint(state, POINT_KIND_B, { x: 0.8, y: 0.2 });
    state = addPoint(state, POINT_KIND_A, { x: 0.25, y: 0.6 });

    const afterPendingUndo = undo(state);
    const afterPairUndo = undo(afterPendingUndo);

    expect(afterPendingUndo.pointsA).toEqual([{ x: 0.2, y: 0.2 }]);
    expect(afterPendingUndo.pointsB).toEqual([{ x: 0.8, y: 0.2 }]);
    expect(afterPendingUndo.phase).toBe(PHASE_AWAITING_A);

    expect(afterPairUndo.pointsA).toEqual([]);
    expect(afterPairUndo.pointsB).toEqual([]);
    expect(afterPairUndo.phase).toBe(PHASE_AWAITING_A);
  });

  it('builds the fill polygon in forward and reverse order', () => {
    const polygon = buildFillPolygon(
      [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.5 },
      ],
      [
        { x: 0.9, y: 0.1 },
        { x: 0.8, y: 0.5 },
      ],
    );

    expect(polygon).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 },
      { x: 0.9, y: 0.1 },
    ]);
  });

  it('returns a preview segment from the active chain to the pointer', () => {
    let state = clear();
    state = addPoint(state, POINT_KIND_A, { x: 0.2, y: 0.2 });
    state = addPoint(state, POINT_KIND_B, { x: 0.75, y: 0.25 });
    state = {
      ...state,
      pointer: { x: 0.9, y: 0.9 },
    };

    expect(getPreviewSegment(state)).toEqual({
      kind: POINT_KIND_A,
      from: { x: 0.2, y: 0.2 },
      to: { x: 0.9, y: 0.9 },
    });
  });

  it('supports classic lasso mode with sequential vertices and undo', () => {
    let state = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    state = addPoint(state, POINT_KIND_A, { x: 0.2, y: 0.2 });
    state = addPoint(state, POINT_KIND_A, { x: 0.8, y: 0.2 });
    state = addPoint(state, POINT_KIND_A, { x: 0.75, y: 0.8 });

    expect(state.classicPoints).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.75, y: 0.8 },
    ]);
    expect(hasClosedShape(state)).toBe(true);
    expect(getClosedShapePoints(state)).toEqual(state.classicPoints);

    const afterUndo = undo(state);
    expect(afterUndo.classicPoints).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
    ]);
    expect(hasClosedShape(afterUndo)).toBe(false);
  });

  it('creates a classic preview from the last placed vertex', () => {
    let state = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    state = addPoint(state, POINT_KIND_A, { x: 0.1, y: 0.1 });
    state = addPoint(state, POINT_KIND_A, { x: 0.4, y: 0.3 });
    state = {
      ...state,
      pointer: { x: 0.9, y: 0.9 },
    };

    expect(getPreviewSegment(state)).toEqual({
      kind: DRAW_MODE_CLASSIC,
      from: { x: 0.4, y: 0.3 },
      to: { x: 0.9, y: 0.9 },
    });
  });

  it('preserves draft points outside the original normalized viewport', () => {
    let state = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    state = addPoint(state, POINT_KIND_A, { x: 1.35, y: -0.4 });
    state = addPoint(state, POINT_KIND_A, { x: 1.7, y: -0.15 });
    state = addPoint(state, POINT_KIND_A, { x: 1.25, y: 0.2 });

    expect(state.classicPoints).toEqual([
      { x: 1.35, y: -0.4 },
      { x: 1.7, y: -0.15 },
      { x: 1.25, y: 0.2 },
    ]);
    expect(hasClosedShape(state)).toBe(true);
  });
});
