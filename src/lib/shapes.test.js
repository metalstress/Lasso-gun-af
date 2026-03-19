import { DRAW_MODE_CLASSIC, POINT_KIND_A, POINT_KIND_B, addPoint, clear, setDrawMode } from './lasso.js';
import {
  ALIGN_BOTTOM,
  ALIGN_CENTER_X,
  ALIGN_CENTER_Y,
  ALIGN_LEFT,
  ALIGN_RIGHT,
  ALIGN_TOP,
  BOOLEAN_UNION,
  BOOLEAN_XOR,
  alignShapeToBounds,
  cleanupShapeDuplicateVertices,
  createShapeFromDraft,
  createShapeFromPolygons,
  deleteShapeVertices,
  deleteShapeVerticesAndSelectNext,
  distortShapeFromQuad,
  duplicateShapes,
  eraseShapesWithSquare,
  flattenShapes,
  insertShapeVertex,
  isShapeEditable,
  listEditableHandles,
  mirrorShape,
  moveShape,
  reorderShapesZOrder,
  rotateShapeAroundPoint,
  runBooleanOperation,
  scaleShapeFromBounds,
  toggleShapeVerticesSharpCorner,
  ungroupShapes,
  updateShapeVertex,
  Z_ORDER_BRING_FORWARD,
  Z_ORDER_BRING_TO_FRONT,
  Z_ORDER_SEND_BACKWARD,
  Z_ORDER_SEND_TO_BACK,
} from './shapes.js';
import { CORNER_TYPE_SHARP } from './rounded-path.js';

describe('shape helpers', () => {
  it('creates editable shapes from both lasso modes', () => {
    let dual = clear();
    dual = addPoint(dual, POINT_KIND_A, { x: 0.1, y: 0.1 });
    dual = addPoint(dual, POINT_KIND_B, { x: 0.9, y: 0.1 });
    dual = addPoint(dual, POINT_KIND_A, { x: 0.2, y: 0.5 });
    dual = addPoint(dual, POINT_KIND_B, { x: 0.8, y: 0.5 });

    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.5, y: 0.7 });

    expect(isShapeEditable(createShapeFromDraft(dual))).toBe(true);
    expect(isShapeEditable(createShapeFromDraft(classic))).toBe(true);
  });

  it('updates a selected vertex immutably', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.5, y: 0.7 });

    const shape = createShapeFromDraft(classic);
    const moved = updateShapeVertex(
      shape,
      { polygonIndex: 0, ringIndex: 0, pointIndex: 1 },
      { x: 0.85, y: 0.25 },
    );

    expect(moved.polygons[0][0][1]).toEqual({ x: 0.85, y: 0.25 });
    expect(shape.polygons[0][0][1]).toEqual({ x: 0.8, y: 0.2 });
  });

  it('runs boolean union and xor on stored shapes', () => {
    let first = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    first = addPoint(first, POINT_KIND_A, { x: 0.1, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.5, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.5, y: 0.5 });
    first = addPoint(first, POINT_KIND_A, { x: 0.1, y: 0.5 });

    let second = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    second = addPoint(second, POINT_KIND_A, { x: 0.3, y: 0.3 });
    second = addPoint(second, POINT_KIND_A, { x: 0.7, y: 0.3 });
    second = addPoint(second, POINT_KIND_A, { x: 0.7, y: 0.7 });
    second = addPoint(second, POINT_KIND_A, { x: 0.3, y: 0.7 });

    const union = runBooleanOperation(
      [createShapeFromDraft(first), createShapeFromDraft(second)],
      BOOLEAN_UNION,
    );
    const xor = runBooleanOperation(
      [createShapeFromDraft(first), createShapeFromDraft(second)],
      BOOLEAN_XOR,
    );

    expect(union).not.toBeNull();
    expect(xor).not.toBeNull();
    expect(union.polygons.length).toBeGreaterThanOrEqual(1);
    expect(xor.polygons.length).toBeGreaterThanOrEqual(1);
    expect(union.group).toMatchObject({
      operation: BOOLEAN_UNION,
    });
    expect(union.group.members).toHaveLength(2);
    expect(union.group.sourceShapes).toHaveLength(2);
  });

  it('duplicates selected shapes with fresh ids and an offset', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.4, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.3, y: 0.5 });

    const original = createShapeFromDraft(classic);
    const [duplicate] = duplicateShapes([original], {
      delta: { x: 0.1, y: 0.05 },
    });

    expect(duplicate.id).not.toBe(original.id);
    expect(duplicate.name).toContain('Copy');
    expect(duplicate.polygons[0][0][0].x).toBeCloseTo(0.3);
    expect(duplicate.polygons[0][0][0].y).toBeCloseTo(0.25);
    expect(original.polygons[0][0][0]).toEqual({ x: 0.2, y: 0.2 });
  });

  it('reorders selected shapes through z-order actions', () => {
    const shapeA = createShapeFromPolygons(
      [[[ { x: 0.1, y: 0.1 }, { x: 0.2, y: 0.1 }, { x: 0.2, y: 0.2 } ]]],
      { name: 'A' },
    );
    const shapeB = createShapeFromPolygons(
      [[[ { x: 0.3, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.2 } ]]],
      { name: 'B' },
    );
    const shapeC = createShapeFromPolygons(
      [[[ { x: 0.5, y: 0.1 }, { x: 0.6, y: 0.1 }, { x: 0.6, y: 0.2 } ]]],
      { name: 'C' },
    );
    const shapeD = createShapeFromPolygons(
      [[[ { x: 0.7, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.2 } ]]],
      { name: 'D' },
    );
    const shapes = [shapeA, shapeB, shapeC, shapeD];

    const forward = reorderShapesZOrder(shapes, [shapeB.id], Z_ORDER_BRING_FORWARD);
    const backward = reorderShapesZOrder(shapes, [shapeC.id], Z_ORDER_SEND_BACKWARD);
    const toFront = reorderShapesZOrder(shapes, [shapeA.id, shapeC.id], Z_ORDER_BRING_TO_FRONT);
    const toBack = reorderShapesZOrder(shapes, [shapeB.id, shapeD.id], Z_ORDER_SEND_TO_BACK);

    expect(forward.map((shape) => shape.name)).toEqual(['A', 'C', 'B', 'D']);
    expect(backward.map((shape) => shape.name)).toEqual(['A', 'C', 'B', 'D']);
    expect(toFront.map((shape) => shape.name)).toEqual(['B', 'D', 'A', 'C']);
    expect(toBack.map((shape) => shape.name)).toEqual(['B', 'D', 'A', 'C']);
  });

  it('inserts a new vertex into an editable contour', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.5, y: 0.7 });

    const shape = createShapeFromDraft(classic);
    const updated = insertShapeVertex(
      shape,
      { polygonIndex: 0, ringIndex: 0, insertIndex: 1 },
      { x: 0.5, y: 0.2 },
    );

    expect(updated.polygons[0][0]).toHaveLength(4);
    expect(updated.polygons[0][0][1]).toEqual({ x: 0.5, y: 0.2 });
    expect(shape.polygons[0][0]).toHaveLength(3);
  });

  it('deletes selected vertices and recloses the contour', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.5 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.5 });

    const shape = createShapeFromDraft(classic);
    const updated = deleteShapeVertices(shape, [
      { polygonIndex: 0, ringIndex: 0, pointIndex: 1 },
    ]);

    expect(updated.polygons[0][0]).toHaveLength(3);
    expect(updated.polygons[0][0]).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.5 },
      { x: 0.2, y: 0.5 },
    ]);
  });

  it('deletes multiple shift-selected vertices in one pass', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.1, y: 0.1 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.4, y: 0.1 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.7, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.5 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.7 });

    const shape = createShapeFromDraft(classic);
    const updated = deleteShapeVertices(shape, [
      { polygonIndex: 0, ringIndex: 0, pointIndex: 1 },
      { polygonIndex: 0, ringIndex: 0, pointIndex: 3 },
    ]);

    expect(updated.polygons[0][0]).toHaveLength(3);
    expect(updated.polygons[0][0]).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.7, y: 0.2 },
      { x: 0.2, y: 0.7 },
    ]);
  });

  it('keeps the next point selected after deleting a vertex', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.5 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.5 });

    const shape = createShapeFromDraft(classic);
    const result = deleteShapeVerticesAndSelectNext(shape, [
      { polygonIndex: 0, ringIndex: 0, pointIndex: 1 },
    ]);

    expect(result.shape.polygons[0][0]).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.5 },
      { x: 0.2, y: 0.5 },
    ]);
    expect(result.nextSelectedHandleIds).toEqual(['0:0:1']);
  });

  it('wraps selection to the first surviving point when deleting the last vertex', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.5 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.5, y: 0.7 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.5 });

    const shape = createShapeFromDraft(classic);
    const result = deleteShapeVerticesAndSelectNext(shape, [
      { polygonIndex: 0, ringIndex: 0, pointIndex: 4 },
    ]);

    expect(result.shape.polygons[0][0]).toHaveLength(4);
    expect(result.nextSelectedHandleIds).toEqual(['0:0:0']);
  });

  it('moves shapes freely beyond the original viewport bounds', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.4, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.3, y: 0.5 });

    const shape = createShapeFromDraft(classic);
    const shifted = moveShape(shape, { x: 1.15, y: -0.55 });

    expect(shifted.polygons[0][0][0].x).toBeCloseTo(1.35);
    expect(shifted.polygons[0][0][0].y).toBeCloseTo(-0.35);
    expect(shifted.polygons[0][0][1].x).toBeCloseTo(1.55);
    expect(shifted.polygons[0][0][1].y).toBeCloseTo(-0.35);
    expect(shifted.polygons[0][0][2].x).toBeCloseTo(1.45);
    expect(shifted.polygons[0][0][2].y).toBeCloseTo(-0.05);
  });

  it('removes near-duplicate points from editable shapes', () => {
    const shape = createShapeFromPolygons([
      [
        [
          { x: 0.2, y: 0.2 },
          { x: 0.202, y: 0.202 },
          { x: 0.4, y: 0.2 },
          { x: 0.4, y: 0.4 },
          { x: 0.2, y: 0.4 },
        ],
      ],
    ]);

    const cleaned = cleanupShapeDuplicateVertices(shape, { width: 1000, height: 1000 });

    expect(cleaned.polygons[0][0]).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.4, y: 0.2 },
      { x: 0.4, y: 0.4 },
      { x: 0.2, y: 0.4 },
    ]);
  });

  it('aligns a shape to shared selection edges', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.3, y: 0.25 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.45, y: 0.25 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.45, y: 0.45 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.3, y: 0.45 });

    const shape = createShapeFromDraft(classic);
    const leftAligned = alignShapeToBounds(shape, ALIGN_LEFT, {
      minX: 0.1,
      maxX: 0.8,
      minY: 0.05,
      maxY: 0.9,
    });
    const rightAligned = alignShapeToBounds(shape, ALIGN_RIGHT, {
      minX: 0.1,
      maxX: 0.8,
      minY: 0.05,
      maxY: 0.9,
    });
    const topAligned = alignShapeToBounds(shape, ALIGN_TOP, {
      minX: 0.1,
      maxX: 0.8,
      minY: 0.05,
      maxY: 0.9,
    });
    const bottomAligned = alignShapeToBounds(shape, ALIGN_BOTTOM, {
      minX: 0.1,
      maxX: 0.8,
      minY: 0.05,
      maxY: 0.9,
    });
    const centerXAligned = alignShapeToBounds(shape, ALIGN_CENTER_X, {
      minX: 0.1,
      maxX: 0.8,
      minY: 0.05,
      maxY: 0.9,
    });
    const centerYAligned = alignShapeToBounds(shape, ALIGN_CENTER_Y, {
      minX: 0.1,
      maxX: 0.8,
      minY: 0.05,
      maxY: 0.9,
    });

    expect(leftAligned.polygons[0][0][0].x).toBeCloseTo(0.1);
    expect(rightAligned.polygons[0][0][1].x).toBeCloseTo(0.8);
    expect(topAligned.polygons[0][0][0].y).toBeCloseTo(0.05);
    expect(bottomAligned.polygons[0][0][2].y).toBeCloseTo(0.9);
    expect(centerXAligned.polygons[0][0][0].x).toBeCloseTo(0.375);
    expect(centerXAligned.polygons[0][0][1].x).toBeCloseTo(0.525);
    expect(centerYAligned.polygons[0][0][0].y).toBeCloseTo(0.375);
    expect(centerYAligned.polygons[0][0][2].y).toBeCloseTo(0.575);
  });

  it('scales a shape against a shared selection bounding box', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.4, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.3, y: 0.5 });

    const shape = createShapeFromDraft(classic);
    const scaled = scaleShapeFromBounds(
      shape,
      { minX: 0.2, maxX: 0.4, minY: 0.2, maxY: 0.5 },
      { minX: 0.2, maxX: 0.6, minY: 0.2, maxY: 0.65 },
    );

    expect(scaled.polygons[0][0][1].x).toBeCloseTo(0.6);
    expect(scaled.polygons[0][0][1].y).toBeCloseTo(0.2);
    expect(scaled.polygons[0][0][2].x).toBeCloseTo(0.4);
    expect(scaled.polygons[0][0][2].y).toBeCloseTo(0.65);
  });

  it('distorts a shape through independent transform corners', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.4, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.4, y: 0.4 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.4 });

    const shape = createShapeFromDraft(classic);
    const distorted = distortShapeFromQuad(
      shape,
      { minX: 0.2, maxX: 0.4, minY: 0.2, maxY: 0.4 },
      {
        nw: { x: 0.18, y: 0.22 },
        ne: { x: 0.46, y: 0.18 },
        se: { x: 0.43, y: 0.47 },
        sw: { x: 0.16, y: 0.41 },
      },
    );

    expect(distorted.polygons[0][0][0].x).toBeCloseTo(0.18);
    expect(distorted.polygons[0][0][0].y).toBeCloseTo(0.22);
    expect(distorted.polygons[0][0][1].x).toBeCloseTo(0.46);
    expect(distorted.polygons[0][0][1].y).toBeCloseTo(0.18);
    expect(distorted.polygons[0][0][2].x).toBeCloseTo(0.43);
    expect(distorted.polygons[0][0][2].y).toBeCloseTo(0.47);
    expect(distorted.polygons[0][0][3].x).toBeCloseTo(0.16);
    expect(distorted.polygons[0][0][3].y).toBeCloseTo(0.41);
  });

  it('rotates a shape around the shared pivot point', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.4, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.4, y: 0.4 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.4 });

    const shape = createShapeFromDraft(classic);
    const rotated = rotateShapeAroundPoint(shape, Math.PI / 2, { x: 0.3, y: 0.3 });

    expect(rotated.polygons[0][0][0].x).toBeCloseTo(0.4);
    expect(rotated.polygons[0][0][0].y).toBeCloseTo(0.2);
    expect(rotated.polygons[0][0][1].x).toBeCloseTo(0.4);
    expect(rotated.polygons[0][0][1].y).toBeCloseTo(0.4);
    expect(rotated.polygons[0][0][2].x).toBeCloseTo(0.2);
    expect(rotated.polygons[0][0][2].y).toBeCloseTo(0.4);
    expect(rotated.polygons[0][0][3].x).toBeCloseTo(0.2);
    expect(rotated.polygons[0][0][3].y).toBeCloseTo(0.2);
  });

  it('mirrors a shape across the selection center', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.4, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.3, y: 0.5 });

    const shape = createShapeFromDraft(classic);
    const mirroredX = mirrorShape(shape, 'x', {
      minX: 0.2,
      maxX: 0.6,
      minY: 0.2,
      maxY: 0.5,
    });
    const mirroredY = mirrorShape(shape, 'y', {
      minX: 0.2,
      maxX: 0.6,
      minY: 0.2,
      maxY: 0.6,
    });

    expect(mirroredX.polygons[0][0][0].x).toBeCloseTo(0.6);
    expect(mirroredX.polygons[0][0][0].y).toBeCloseTo(0.2);
    expect(mirroredX.polygons[0][0][1].x).toBeCloseTo(0.4);
    expect(mirroredX.polygons[0][0][1].y).toBeCloseTo(0.2);
    expect(mirroredY.polygons[0][0][2].x).toBeCloseTo(0.3);
    expect(mirroredY.polygons[0][0][2].y).toBeCloseTo(0.3);
  });

  it('cuts a square hole with the shape destroyer brush', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.1, y: 0.1 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.9, y: 0.1 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.9, y: 0.9 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.1, y: 0.9 });

    const shape = createShapeFromDraft(classic);
    const [destroyed] = eraseShapesWithSquare([shape], { x: 0.5, y: 0.5 }, 4, {
      width: 320,
      height: 320,
    });

    expect(destroyed).toBeTruthy();
    expect(destroyed.id).toBe(shape.id);
    expect(destroyed.cornerOverrides).toBeUndefined();
    expect(destroyed.group).toBeNull();
    expect(destroyed.polygons[0]).toHaveLength(2);
  });

  it('removes a shape completely when the destroyer stamp covers it', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.35, y: 0.35 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.55, y: 0.35 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.55, y: 0.55 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.35, y: 0.55 });

    const shape = createShapeFromDraft(classic);
    const destroyedShapes = eraseShapesWithSquare([shape], { x: 0.45, y: 0.45 }, 32, {
      width: 320,
      height: 320,
    });

    expect(destroyedShapes).toEqual([]);
  });

  it('restores source shapes when ungrouping a boolean result', () => {
    let first = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    first = addPoint(first, POINT_KIND_A, { x: 0.1, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.5, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.5, y: 0.5 });
    first = addPoint(first, POINT_KIND_A, { x: 0.1, y: 0.5 });

    let second = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    second = addPoint(second, POINT_KIND_A, { x: 0.6, y: 0.2 });
    second = addPoint(second, POINT_KIND_A, { x: 0.85, y: 0.2 });
    second = addPoint(second, POINT_KIND_A, { x: 0.85, y: 0.45 });
    second = addPoint(second, POINT_KIND_A, { x: 0.6, y: 0.45 });

    const firstShape = createShapeFromDraft(first);
    const secondShape = createShapeFromDraft(second);
    const union = runBooleanOperation([firstShape, secondShape], BOOLEAN_UNION);
    const result = ungroupShapes([union], [union.id]);

    expect(result.shapes).toHaveLength(2);
    expect(result.ungroupedShapeIds).toHaveLength(2);
    expect(result.shapes[0].id).not.toBe(firstShape.id);
    expect(result.shapes[1].id).not.toBe(secondShape.id);
    expect(result.shapes[0].group).toBeNull();
    expect(result.shapes[1].group).toBeNull();
    expect(result.shapes[0].polygons).toEqual(firstShape.polygons);
    expect(result.shapes[1].polygons).toEqual(secondShape.polygons);
  });

  it('flattens a boolean group into one plain shape with no ungroup history', () => {
    let first = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    first = addPoint(first, POINT_KIND_A, { x: 0.1, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.5, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.5, y: 0.5 });
    first = addPoint(first, POINT_KIND_A, { x: 0.1, y: 0.5 });

    let second = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    second = addPoint(second, POINT_KIND_A, { x: 0.3, y: 0.3 });
    second = addPoint(second, POINT_KIND_A, { x: 0.7, y: 0.3 });
    second = addPoint(second, POINT_KIND_A, { x: 0.7, y: 0.7 });
    second = addPoint(second, POINT_KIND_A, { x: 0.3, y: 0.7 });

    const union = runBooleanOperation(
      [createShapeFromDraft(first), createShapeFromDraft(second)],
      BOOLEAN_UNION,
    );
    const flattened = flattenShapes([union]);

    expect(flattened).not.toBeNull();
    expect(flattened.id).not.toBe(union.id);
    expect(flattened.group).toBeNull();
    expect(flattened.polygons).toEqual(union.polygons);
  });

  it('keeps flattened multi-contour shapes editable', () => {
    let first = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    first = addPoint(first, POINT_KIND_A, { x: 0.1, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.3, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.3, y: 0.3 });
    first = addPoint(first, POINT_KIND_A, { x: 0.1, y: 0.3 });

    let second = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    second = addPoint(second, POINT_KIND_A, { x: 0.6, y: 0.6 });
    second = addPoint(second, POINT_KIND_A, { x: 0.8, y: 0.6 });
    second = addPoint(second, POINT_KIND_A, { x: 0.8, y: 0.8 });
    second = addPoint(second, POINT_KIND_A, { x: 0.6, y: 0.8 });

    const flattened = flattenShapes([createShapeFromDraft(first), createShapeFromDraft(second)]);

    expect(flattened).not.toBeNull();
    expect(flattened.polygons.length).toBe(2);
    expect(isShapeEditable(flattened)).toBe(true);
    expect(listEditableHandles(flattened)).toHaveLength(8);

    const moved = updateShapeVertex(
      flattened,
      { polygonIndex: 1, ringIndex: 0, pointIndex: 2 },
      { x: 0.82, y: 0.83 },
    );

    expect(moved.polygons[1][0][2]).toEqual({ x: 0.82, y: 0.83 });

    const inserted = insertShapeVertex(
      flattened,
      { polygonIndex: 1, ringIndex: 0, insertIndex: 1 },
      { x: 0.7, y: 0.6 },
    );

    expect(inserted.polygons[1][0]).toHaveLength(5);
    expect(inserted.polygons[1][0][1]).toEqual({ x: 0.7, y: 0.6 });
  });

  it('removes a whole flattened path when deleting a vertex from a three-point contour', () => {
    let first = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    first = addPoint(first, POINT_KIND_A, { x: 0.1, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.3, y: 0.1 });
    first = addPoint(first, POINT_KIND_A, { x: 0.2, y: 0.3 });

    let second = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    second = addPoint(second, POINT_KIND_A, { x: 0.6, y: 0.6 });
    second = addPoint(second, POINT_KIND_A, { x: 0.8, y: 0.6 });
    second = addPoint(second, POINT_KIND_A, { x: 0.7, y: 0.8 });

    const flattened = flattenShapes([createShapeFromDraft(first), createShapeFromDraft(second)]);
    const updated = deleteShapeVertices(flattened, [
      { polygonIndex: 0, ringIndex: 0, pointIndex: 1 },
    ]);

    expect(flattened.polygons).toHaveLength(2);
    expect(updated.polygons).toHaveLength(1);
    expect(updated.polygons[0]).toEqual(flattened.polygons[1]);
  });

  it('toggles a single vertex into a local sharp corner override', () => {
    let classic = setDrawMode(clear(), DRAW_MODE_CLASSIC);
    classic = addPoint(classic, POINT_KIND_A, { x: 0.2, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.8, y: 0.2 });
    classic = addPoint(classic, POINT_KIND_A, { x: 0.5, y: 0.7 });

    const shape = createShapeFromDraft(classic);
    const location = { polygonIndex: 0, ringIndex: 0, pointIndex: 1 };
    const sharp = toggleShapeVerticesSharpCorner(shape, [location]);
    const cleared = toggleShapeVerticesSharpCorner(sharp, [location]);

    expect(sharp.cornerOverrides).toEqual({
      '0:0:1': CORNER_TYPE_SHARP,
    });
    expect(cleared.cornerOverrides).toBeUndefined();
  });
});
