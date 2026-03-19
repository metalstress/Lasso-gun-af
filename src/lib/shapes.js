import polygonClipping from 'polygon-clipping';
import { GRID_STEP_PX } from './grid.js';
import { getClosedShapePoints } from './lasso.js';
import {
  buildRoundedSvgPath,
  CORNER_TYPE_INVERSE_ROUND,
  CORNER_TYPE_SHARP,
} from './rounded-path.js';

export const BOOLEAN_UNION = 'union';
export const BOOLEAN_SUBTRACT = 'subtract';
export const BOOLEAN_INTERSECT = 'intersect';
export const BOOLEAN_XOR = 'xor';
export const ALIGN_LEFT = 'left';
export const ALIGN_RIGHT = 'right';
export const ALIGN_TOP = 'top';
export const ALIGN_BOTTOM = 'bottom';

let shapeCounter = 0;
let groupCounter = 0;

export function createShapeFromDraft(state, options = {}) {
  const points = getClosedShapePoints(state);

  if (points.length === 0) {
    return null;
  }

  return createShapeFromPolygons([[[...points]]], {
    sourceMode: state.mode,
    ...options,
  });
}

export function createShapeFromPolygons(polygons, options = {}) {
  const normalized = normalizePolygons(polygons);

  if (normalized.length === 0) {
    return null;
  }

  const shapeId = createShapeId();

  return {
    id: shapeId,
    name: options.name ?? createShapeName(shapeId),
    group: options.group ?? null,
    sourceMode: options.sourceMode ?? null,
    polygons: normalized,
  };
}

export function getSceneShapes(shapes, draftShape = null) {
  return draftShape ? [...shapes, draftShape] : [...shapes];
}

export function isShapeEditable(shape) {
  return Boolean(
    shape &&
      shape.polygons.some((polygon) =>
        polygon.some((ring) => Array.isArray(ring) && ring.length >= 3),
      ),
  );
}

export function listEditableHandles(shape) {
  if (!isShapeEditable(shape)) {
    return [];
  }

  return shape.polygons.flatMap((polygon, polygonIndex) =>
    polygon.flatMap((ring, ringIndex) =>
      ring.map((point, pointIndex) => ({
        point,
        location: {
          polygonIndex,
          ringIndex,
          pointIndex,
        },
        cornerTypeOverride: getShapeCornerOverride(
          shape,
          {
            polygonIndex,
            ringIndex,
            pointIndex,
          },
        ),
      })),
    ),
  );
}

export function createHandleId(location) {
  return `${location.polygonIndex}:${location.ringIndex}:${location.pointIndex}`;
}

export function getShapeCornerOverride(shape, location) {
  if (!shape?.cornerOverrides || !location) {
    return null;
  }

  return shape.cornerOverrides[createHandleId(location)] ?? null;
}

export function updateShapeVertex(shape, location, nextPoint) {
  if (!shape || !isShapeEditable(shape)) {
    return shape;
  }

  return {
    ...shape,
    polygons: shape.polygons.map((polygon, polygonIndex) =>
      polygon.map((ring, ringIndex) =>
        ring.map((point, pointIndex) => {
          const isTarget =
            polygonIndex === location.polygonIndex &&
            ringIndex === location.ringIndex &&
            pointIndex === location.pointIndex;

          return isTarget
            ? {
                x: normalizeCoordinate(nextPoint.x),
                y: normalizeCoordinate(nextPoint.y),
              }
            : point;
        }),
      ),
    ),
  };
}

export function moveShapeVertices(shape, locations, delta) {
  if (!shape || !isShapeEditable(shape) || !locations || locations.length === 0) {
    return shape;
  }

  const offset = normalizeDelta(delta);
  const targetKeys = new Set(locations.map((location) => createHandleId(location)));

  return {
    ...shape,
    polygons: shape.polygons.map((polygon, polygonIndex) =>
      polygon.map((ring, ringIndex) =>
        ring.map((point, pointIndex) => {
          const location = { polygonIndex, ringIndex, pointIndex };
          const isTarget = targetKeys.has(createHandleId(location));

          return isTarget
            ? {
                x: normalizeCoordinate(point.x + offset.x),
                y: normalizeCoordinate(point.y + offset.y),
              }
            : point;
        }),
      ),
    ),
  };
}

export function deleteShapeVertices(shape, locations) {
  if (!shape || !isShapeEditable(shape) || !locations || locations.length === 0) {
    return shape;
  }

  const deletionGroups = normalizeVertexDeletionGroups(shape, locations);

  if (deletionGroups.size === 0) {
    return shape;
  }

  const { polygons, cornerOverrides } = applyVertexDeletion(shape, deletionGroups);

  return {
    ...shape,
    cornerOverrides,
    polygons,
  };
}

export function deleteShapeVerticesAndSelectNext(shape, locations) {
  if (!shape || !isShapeEditable(shape) || !locations || locations.length === 0) {
    return {
      nextSelectedHandleIds: [],
      shape,
    };
  }

  const deletionGroups = normalizeVertexDeletionGroups(shape, locations);

  if (deletionGroups.size === 0) {
    return {
      nextSelectedHandleIds: [],
      shape,
    };
  }

  const nextOriginalHandleIds = collectNextHandleIdsAfterDelete(shape, deletionGroups);
  const { polygons, cornerOverrides, handleRemap } = applyVertexDeletion(shape, deletionGroups);
  const nextShape = {
    ...shape,
    cornerOverrides,
    polygons,
  };

  return {
    nextSelectedHandleIds: nextOriginalHandleIds
      .map((handleId) => handleRemap.get(handleId))
      .filter(Boolean),
    shape: nextShape,
  };
}

export function moveShape(shape, delta) {
  if (!shape) {
    return shape;
  }

  const offset = normalizeDelta(delta);

  return {
    ...shape,
    polygons: shape.polygons.map((polygon) =>
      polygon.map((ring) =>
        ring.map((point) => ({
          x: normalizeCoordinate(point.x + offset.x),
          y: normalizeCoordinate(point.y + offset.y),
        })),
      ),
    ),
  };
}

export function alignShapeToBounds(shape, alignment, bounds) {
  if (!shape || !bounds) {
    return shape;
  }

  const shapeBounds = getShapeBounds(shape);
  let delta = null;

  if (alignment === ALIGN_LEFT) {
    delta = { x: bounds.minX - shapeBounds.minX, y: 0 };
  } else if (alignment === ALIGN_RIGHT) {
    delta = { x: bounds.maxX - shapeBounds.maxX, y: 0 };
  } else if (alignment === ALIGN_TOP) {
    delta = { x: 0, y: bounds.minY - shapeBounds.minY };
  } else if (alignment === ALIGN_BOTTOM) {
    delta = { x: 0, y: bounds.maxY - shapeBounds.maxY };
  }

  if (!delta || (delta.x === 0 && delta.y === 0)) {
    return shape;
  }

  return moveShape(shape, delta);
}

export function scaleShapeFromBounds(shape, sourceBounds, targetBounds) {
  if (!shape || !sourceBounds || !targetBounds) {
    return shape;
  }

  return {
    ...shape,
    polygons: shape.polygons.map((polygon) =>
      polygon.map((ring) =>
        ring.map((point) => ({
          x: normalizeCoordinate(
            remapCoordinateBetweenBounds(
              point.x,
              sourceBounds.minX,
              sourceBounds.maxX,
              targetBounds.minX,
              targetBounds.maxX,
            ),
          ),
          y: normalizeCoordinate(
            remapCoordinateBetweenBounds(
              point.y,
              sourceBounds.minY,
              sourceBounds.maxY,
              targetBounds.minY,
              targetBounds.maxY,
            ),
          ),
        })),
      ),
    ),
  };
}

export function mirrorShape(shape, axis, bounds) {
  if (!shape || !bounds || (axis !== 'x' && axis !== 'y')) {
    return shape;
  }

  const pivotX = (bounds.minX + bounds.maxX) * 0.5;
  const pivotY = (bounds.minY + bounds.maxY) * 0.5;

  return {
    ...shape,
    polygons: shape.polygons.map((polygon) =>
      polygon.map((ring) =>
        ring.map((point) => ({
          x: normalizeCoordinate(axis === 'x' ? pivotX * 2 - point.x : point.x),
          y: normalizeCoordinate(axis === 'y' ? pivotY * 2 - point.y : point.y),
        })),
      ),
    ),
  };
}

export function eraseShapesWithSquare(shapes = [], centerPoint, brushCells, surfaceSize) {
  if (!Array.isArray(shapes) || shapes.length === 0 || !centerPoint || !surfaceSize) {
    return shapes;
  }

  const brush = resolveDestroyBrush(brushCells, surfaceSize);

  if (!brush) {
    return shapes;
  }

  return eraseShapesWithStamp(shapes, centerPoint, brush);
}

export function eraseShapesAlongSegment(
  shapes = [],
  startPoint,
  endPoint,
  brushCells,
  surfaceSize,
) {
  if (!Array.isArray(shapes) || shapes.length === 0 || !startPoint || !endPoint || !surfaceSize) {
    return shapes;
  }

  const brush = resolveDestroyBrush(brushCells, surfaceSize);

  if (!brush) {
    return shapes;
  }

  const distancePx = Math.hypot(
    (endPoint.x - startPoint.x) * surfaceSize.width,
    (endPoint.y - startPoint.y) * surfaceSize.height,
  );

  if (distancePx <= Number.EPSILON) {
    return eraseShapesWithStamp(shapes, startPoint, brush);
  }

  const spacingPx = Math.max(6, Math.min(brush.widthPx, brush.heightPx) * 0.42);
  const steps = Math.max(1, Math.ceil(distancePx / spacingPx));
  let nextShapes = shapes;

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    nextShapes = eraseShapesWithStamp(
      nextShapes,
      {
        x: lerp(startPoint.x, endPoint.x, progress),
        y: lerp(startPoint.y, endPoint.y, progress),
      },
      brush,
    );
  }

  return nextShapes;
}

export function duplicateShapes(shapes, options = {}) {
  const offset = normalizeDelta(options.offset ?? options.delta);

  return (shapes ?? [])
    .map((shape, index) => duplicateShape(shape, offset, index))
    .filter(Boolean);
}

export function flattenShapes(selectedShapes = []) {
  if (!selectedShapes || selectedShapes.length === 0) {
    return null;
  }

  if (selectedShapes.length === 1) {
    return flattenSingleShape(selectedShapes[0]);
  }

  const result = polygonClipping.union(...selectedShapes.map(toPolygonClippingShape));

  return createShapeFromPolygonClipping(result, {
    sourceMode: 'flatten',
  });
}

export function ungroupShapes(shapes, targetShapeIds = []) {
  const targetIds = new Set(targetShapeIds);
  const nextShapes = [];
  const ungroupedShapeIds = [];

  (shapes ?? []).forEach((shape) => {
    if (!targetIds.has(shape.id) || !shape.group) {
      nextShapes.push(shape);
      return;
    }

    if (shape.group.sourceShapes?.length) {
      const restoredShapes = shape.group.sourceShapes
        .map((sourceShape) => instantiateShapeSnapshot(sourceShape))
        .filter(Boolean);

      nextShapes.push(...restoredShapes);
      ungroupedShapeIds.push(...restoredShapes.map((restoredShape) => restoredShape.id));
      return;
    }

    nextShapes.push({
      ...shape,
      group: null,
    });
    ungroupedShapeIds.push(shape.id);
  });

  return {
    shapes: nextShapes,
    ungroupedShapeIds,
  };
}

export function insertShapeVertex(shape, location, nextPoint) {
  if (!shape || !isShapeEditable(shape)) {
    return shape;
  }

  return {
    ...shape,
    cornerOverrides: shiftCornerOverridesForInsert(shape.cornerOverrides, location),
    polygons: shape.polygons.map((polygon, polygonIndex) =>
      polygon.map((ring, ringIndex) => {
        const isTarget =
          polygonIndex === location.polygonIndex && ringIndex === location.ringIndex;

        if (!isTarget) {
          return ring;
        }

        const insertIndex = clampInsertionIndex(location.insertIndex, ring.length);
        const vertex = {
          x: normalizeCoordinate(nextPoint.x),
          y: normalizeCoordinate(nextPoint.y),
        };

        return [...ring.slice(0, insertIndex), vertex, ...ring.slice(insertIndex)];
      }),
    ),
  };
}

export function toggleShapeVerticesInverseCorner(shape, locations) {
  if (!shape || !isShapeEditable(shape) || !locations || locations.length === 0) {
    return shape;
  }

  const shouldClear = locations.every(
    (location) => getShapeCornerOverride(shape, location) === CORNER_TYPE_INVERSE_ROUND,
  );

  return shouldClear
    ? clearShapeVerticesCornerOverrides(shape, locations)
    : setShapeVerticesCornerOverride(shape, locations, CORNER_TYPE_INVERSE_ROUND);
}

export function toggleShapeVerticesSharpCorner(shape, locations) {
  if (!shape || !isShapeEditable(shape) || !locations || locations.length === 0) {
    return shape;
  }

  const shouldClear = locations.every(
    (location) => getShapeCornerOverride(shape, location) === CORNER_TYPE_SHARP,
  );

  return shouldClear
    ? clearShapeVerticesCornerOverrides(shape, locations)
    : setShapeVerticesCornerOverride(shape, locations, CORNER_TYPE_SHARP);
}

export function clearShapeVerticesCornerOverrides(shape, locations) {
  if (!shape || !isShapeEditable(shape) || !locations || locations.length === 0) {
    return shape;
  }

  const nextCornerOverrides = { ...(shape.cornerOverrides ?? {}) };

  locations.forEach((location) => {
    delete nextCornerOverrides[createHandleId(location)];
  });

  return {
    ...shape,
    cornerOverrides: Object.keys(nextCornerOverrides).length > 0 ? nextCornerOverrides : undefined,
  };
}

export function setShapeVerticesCornerOverride(shape, locations, cornerType) {
  if (!shape || !isShapeEditable(shape) || !locations || locations.length === 0) {
    return shape;
  }

  const nextCornerOverrides = { ...(shape.cornerOverrides ?? {}) };

  locations.forEach((location) => {
    nextCornerOverrides[createHandleId(location)] = cornerType;
  });

  return {
    ...shape,
    cornerOverrides: nextCornerOverrides,
  };
}

export function getRingCornerTypes(shape, polygonIndex, ringIndex, fallbackCornerType) {
  const ring = shape?.polygons?.[polygonIndex]?.[ringIndex] ?? [];

  return ring.map((_, pointIndex) => {
    return (
      getShapeCornerOverride(shape, {
        polygonIndex,
        ringIndex,
        pointIndex,
      }) ?? fallbackCornerType
    );
  });
}

export function runBooleanOperation(selectedShapes, operation) {
  if (!selectedShapes || selectedShapes.length === 0) {
    return null;
  }

  const pcShapes = selectedShapes.map(toPolygonClippingShape);
  let result = null;

  if (operation === BOOLEAN_UNION) {
    result = polygonClipping.union(...pcShapes);
  } else if (operation === BOOLEAN_INTERSECT) {
    result = polygonClipping.intersection(...pcShapes);
  } else if (operation === BOOLEAN_SUBTRACT) {
    result = polygonClipping.difference(pcShapes[0], ...pcShapes.slice(1));
  } else if (operation === BOOLEAN_XOR) {
    result = polygonClipping.xor(...pcShapes);
  }

  return createShapeFromPolygonClipping(result, {
    operation,
    selectedShapes,
  });
}

export function findTopmostShapeIdAtPoint(shapes, point) {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    if (isPointInsideShape(shapes[index], point)) {
      return shapes[index].id;
    }
  }

  return null;
}

export function findShapeIdsInLasso(shapes, lassoPoints) {
  if (!shapes || !lassoPoints || lassoPoints.length < 3) {
    return [];
  }

  return shapes
    .filter((shape) => doesShapeIntersectLasso(shape, lassoPoints))
    .map((shape) => shape.id);
}

export function getShapeById(shapes, shapeId) {
  return shapes.find((shape) => shape.id === shapeId) ?? null;
}

export function isPointInsideShape(shape, point) {
  return shape.polygons.some((polygon) => isPointInsidePolygon(polygon, point));
}

export function buildSvgPathFromShape(shape, surfaceSize, options = {}) {
  const { cornerRadius, cornerType } = options;

  return shape.polygons
    .flatMap((polygon, polygonIndex) =>
      polygon.map((ring, ringIndex) =>
        buildRoundedSvgPath(ring.map((point) => toSurfacePoint(point, surfaceSize)), {
          closed: true,
          cornerType,
          cornerTypes: getRingCornerTypes(shape, polygonIndex, ringIndex, cornerType),
          radius: cornerRadius,
        }),
      ),
    )
    .join(' ');
}

export function formatBooleanOperationLabel(operation) {
  if (operation === BOOLEAN_UNION) {
    return 'Union';
  }

  if (operation === BOOLEAN_SUBTRACT) {
    return 'Subtract';
  }

  if (operation === BOOLEAN_INTERSECT) {
    return 'Intersect';
  }

  if (operation === BOOLEAN_XOR) {
    return 'XOR';
  }

  return 'Composite';
}

export function toSurfacePolygons(shape, surfaceSize) {
  return shape.polygons.map((polygon) =>
    polygon.map((ring) => ring.map((point) => toSurfacePoint(point, surfaceSize))),
  );
}

function createShapeFromPolygonClipping(result, options = {}) {
  if (!result || result.length === 0) {
    return null;
  }

  return createShapeFromPolygons(
    result.map((polygon) =>
      polygon.map((ring) => {
        const nextRing = ring.map(([x, y]) => ({
          x: normalizeCoordinate(x),
          y: normalizeCoordinate(y),
        }));
        return isRingClosed(nextRing) ? nextRing.slice(0, -1) : nextRing;
      }),
    ),
    {
      sourceMode: options.sourceMode ?? null,
      ...buildBooleanMetadata(options.operation, options.selectedShapes),
    },
  );
}

function recreateShapeFromPolygonClipping(shape, result) {
  if (!shape || !result || result.length === 0) {
    return null;
  }

  const polygons = normalizePolygons(
    result.map((polygon) =>
      polygon.map((ring) => {
        const nextRing = ring.map(([x, y]) => ({
          x: normalizeCoordinate(x),
          y: normalizeCoordinate(y),
        }));
        return isRingClosed(nextRing) ? nextRing.slice(0, -1) : nextRing;
      }),
    ),
  );

  if (polygons.length === 0) {
    return null;
  }

  return {
    ...shape,
    cornerOverrides: undefined,
    group: null,
    polygons,
  };
}

function buildBooleanMetadata(operation, selectedShapes = []) {
  if (!operation || selectedShapes.length < 2) {
    return {};
  }

  const groupId = createGroupId();

  return {
    group: {
      id: groupId,
      name: `${formatBooleanOperationLabel(operation)} Group ${getNumericSuffix(groupId)}`,
      operation,
      members: selectedShapes.map((shape) => ({
        id: shape.id,
        name: shape.group?.name ?? shape.name ?? shape.id,
        kind: shape.group ? 'group' : 'shape',
      })),
      sourceShapes: selectedShapes.map((shape) => cloneShapeSnapshot(shape)),
    },
  };
}

function toPolygonClippingShape(shape) {
  return shape.polygons.map((polygon) =>
    polygon.map((ring) => {
      const closedRing = ring.map((point) => [point.x, point.y]);
      const first = closedRing[0];
      const last = closedRing[closedRing.length - 1];

      if (!last || last[0] !== first[0] || last[1] !== first[1]) {
        closedRing.push([first[0], first[1]]);
      }

      return closedRing;
    }),
  );
}

function eraseShapesWithStamp(shapes, centerPoint, brush) {
  const stampBounds = {
    minX: centerPoint.x - brush.halfWidth,
    maxX: centerPoint.x + brush.halfWidth,
    minY: centerPoint.y - brush.halfHeight,
    maxY: centerPoint.y + brush.halfHeight,
  };
  const stampPolygon = buildSquarePolygon(stampBounds);
  let changed = false;
  const nextShapes = [];

  shapes.forEach((shape) => {
    const shapeBounds = getShapeBounds(shape);

    if (!doBoundsIntersect(shapeBounds, stampBounds)) {
      nextShapes.push(shape);
      return;
    }

    const shapePolygon = toPolygonClippingShape(shape);
    const overlap = polygonClipping.intersection(shapePolygon, stampPolygon);

    if (!overlap || overlap.length === 0) {
      nextShapes.push(shape);
      return;
    }

    const result = polygonClipping.difference(shapePolygon, stampPolygon);
    const nextShape = recreateShapeFromPolygonClipping(shape, result);
    changed = true;

    if (nextShape) {
      nextShapes.push(nextShape);
    }
  });

  return changed ? nextShapes : shapes;
}

function normalizePolygons(polygons) {
  return polygons
    .map((polygon) =>
      polygon
        .map((ring) => normalizeRing(ring))
        .filter((ring) => ring.length >= 3),
    )
    .filter((polygon) => polygon.length > 0);
}

function buildSquarePolygon(bounds) {
  return [[
    [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.minY],
      [bounds.maxX, bounds.maxY],
      [bounds.minX, bounds.maxY],
      [bounds.minX, bounds.minY],
    ],
  ]];
}

function doBoundsIntersect(left, right) {
  return !(
    left.maxX <= right.minX ||
    left.minX >= right.maxX ||
    left.maxY <= right.minY ||
    left.minY >= right.maxY
  );
}

function normalizeRing(ring) {
  const nextRing = ring.map((point) => ({
    x: normalizeCoordinate(point.x),
    y: normalizeCoordinate(point.y),
  }));

  return isRingClosed(nextRing) ? nextRing.slice(0, -1) : nextRing;
}

function isRingClosed(ring) {
  if (ring.length < 2) {
    return false;
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.x === last.x && first.y === last.y;
}

function isPointInsidePolygon(polygon, point) {
  if (polygon.length === 0) {
    return false;
  }

  if (!isPointInRing(polygon[0], point)) {
    return false;
  }

  for (let holeIndex = 1; holeIndex < polygon.length; holeIndex += 1) {
    if (isPointInRing(polygon[holeIndex], point)) {
      return false;
    }
  }

  return true;
}

function doesShapeIntersectLasso(shape, lassoPoints) {
  if (!shape) {
    return false;
  }

  const outerRingPoints = shape.polygons.flatMap((polygon) => polygon[0] ?? []);
  const bounds = getShapeBounds(shape);
  const centerPoint = {
    x: (bounds.minX + bounds.maxX) * 0.5,
    y: (bounds.minY + bounds.maxY) * 0.5,
  };

  if (outerRingPoints.some((point) => isPointInRing(lassoPoints, point))) {
    return true;
  }

  if (isPointInRing(lassoPoints, centerPoint)) {
    return true;
  }

  return lassoPoints.some((point) => isPointInsideShape(shape, point));
}

function isPointInRing(ring, point) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;

    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function toSurfacePoint(point, surfaceSize) {
  return {
    x: point.x * surfaceSize.width,
    y: point.y * surfaceSize.height,
  };
}

function createShapeId() {
  shapeCounter += 1;
  return `shape-${shapeCounter}`;
}

function createGroupId() {
  groupCounter += 1;
  return `group-${groupCounter}`;
}

function createShapeName(shapeId) {
  return `Shape ${getNumericSuffix(shapeId)}`;
}

function createDuplicateName(name, fallback) {
  const baseName = name || fallback;
  return baseName.endsWith(' Copy') ? `${baseName} 2` : `${baseName} Copy`;
}

function getNumericSuffix(value) {
  const match = String(value).match(/(\d+)$/);
  return match ? Number(match[1]) : 1;
}

function duplicateShape(shape, offset, index = 0) {
  if (!shape) {
    return null;
  }

  const duplicated = {
    ...shape,
    id: createShapeId(),
    name: createDuplicateName(shape.name, `Shape ${index + 1}`),
    cornerOverrides: shape.cornerOverrides ? { ...shape.cornerOverrides } : undefined,
    polygons: shape.polygons.map((polygon) =>
      polygon.map((ring) => ring.map((point) => ({ ...point }))),
    ),
    group: shape.group
      ? {
          ...shape.group,
          id: createGroupId(),
          name: createDuplicateName(shape.group.name, `Group ${index + 1}`),
          members: shape.group.members?.map((member) => ({ ...member })) ?? [],
          sourceShapes: shape.group.sourceShapes?.map((sourceShape) => cloneShapeSnapshot(sourceShape)) ?? [],
        }
      : null,
  };

  return moveShape(duplicated, offset);
}

function flattenSingleShape(shape) {
  if (!shape) {
    return null;
  }

  const flattened = cloneShapeSnapshot(shape);

  return {
    ...flattened,
    id: createShapeId(),
    group: null,
  };
}

function instantiateShapeSnapshot(shape) {
  if (!shape) {
    return null;
  }

  const shapeId = createShapeId();

  return {
    id: shapeId,
    name: shape.name ?? createShapeName(shapeId),
    sourceMode: shape.sourceMode ?? null,
    cornerOverrides: shape.cornerOverrides ? { ...shape.cornerOverrides } : undefined,
    polygons: shape.polygons.map((polygon) =>
      polygon.map((ring) => ring.map((point) => ({ ...point }))),
    ),
    group: shape.group
      ? {
          ...shape.group,
          id: createGroupId(),
          members: shape.group.members?.map((member) => ({ ...member })) ?? [],
          sourceShapes: shape.group.sourceShapes?.map((sourceShape) => cloneShapeSnapshot(sourceShape)) ?? [],
        }
      : null,
  };
}

function cloneShapeSnapshot(shape) {
  if (!shape) {
    return null;
  }

  return {
    id: shape.id,
    name: shape.name ?? null,
    sourceMode: shape.sourceMode ?? null,
    cornerOverrides: shape.cornerOverrides ? { ...shape.cornerOverrides } : undefined,
    polygons: shape.polygons.map((polygon) =>
      polygon.map((ring) => ring.map((point) => ({ ...point }))),
    ),
    group: shape.group
      ? {
          ...shape.group,
          members: shape.group.members?.map((member) => ({ ...member })) ?? [],
          sourceShapes: shape.group.sourceShapes?.map((sourceShape) => cloneShapeSnapshot(sourceShape)) ?? [],
        }
      : null,
  };
}

export function getShapeBounds(shape) {
  const points = shape.polygons.flatMap((polygon) => polygon.flatMap((ring) => ring));

  if (points.length === 0) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
    };
  }

  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: points[0].x,
      maxX: points[0].x,
      minY: points[0].y,
      maxY: points[0].y,
    },
  );
}

function normalizeDelta(delta) {
  return {
    x: Number.isFinite(Number(delta?.x)) ? Number(delta.x) : 0,
    y: Number.isFinite(Number(delta?.y)) ? Number(delta.y) : 0,
  };
}

function clampInsertionIndex(insertIndex, ringLength) {
  const nextIndex = Number.isFinite(Number(insertIndex)) ? Number(insertIndex) : ringLength;
  return Math.min(ringLength, Math.max(0, nextIndex));
}

function shiftCornerOverridesForInsert(cornerOverrides, location) {
  if (!cornerOverrides) {
    return undefined;
  }

  const nextCornerOverrides = {};
  const entries = Object.entries(cornerOverrides);

  entries.forEach(([key, cornerType]) => {
    const parsed = parseHandleId(key);

    if (!parsed) {
      nextCornerOverrides[key] = cornerType;
      return;
    }

    if (
      parsed.polygonIndex === location.polygonIndex &&
      parsed.ringIndex === location.ringIndex &&
      parsed.pointIndex >= location.insertIndex
    ) {
      nextCornerOverrides[
        createHandleId({
          ...parsed,
          pointIndex: parsed.pointIndex + 1,
        })
      ] = cornerType;
      return;
    }

    nextCornerOverrides[key] = cornerType;
  });

  return Object.keys(nextCornerOverrides).length > 0 ? nextCornerOverrides : undefined;
}

function shiftCornerOverridesForDelete(cornerOverrides, deletionGroups) {
  if (!cornerOverrides) {
    return undefined;
  }

  const nextCornerOverrides = {};
  const entries = Object.entries(cornerOverrides);

  entries.forEach(([key, cornerType]) => {
    const parsed = parseHandleId(key);

    if (!parsed) {
      nextCornerOverrides[key] = cornerType;
      return;
    }

    const deletionGroup = deletionGroups.get(
      createRingLocationKey(parsed.polygonIndex, parsed.ringIndex),
    );

    if (!deletionGroup) {
      nextCornerOverrides[key] = cornerType;
      return;
    }

    if (deletionGroup.deleteSet.has(parsed.pointIndex)) {
      return;
    }

    nextCornerOverrides[
      createHandleId({
        ...parsed,
        pointIndex: parsed.pointIndex - countDeletedIndicesBefore(deletionGroup.indices, parsed.pointIndex),
      })
    ] = cornerType;
  });

  return Object.keys(nextCornerOverrides).length > 0 ? nextCornerOverrides : undefined;
}

function normalizeVertexDeletionGroups(shape, locations) {
  const groupedLocations = new Map();

  locations.forEach((location) => {
    if (!location) {
      return;
    }

    const ring = shape.polygons?.[location.polygonIndex]?.[location.ringIndex];

    if (!Array.isArray(ring) || ring.length < 3) {
      return;
    }

    const key = createRingLocationKey(location.polygonIndex, location.ringIndex);
    const existing = groupedLocations.get(key) ?? {
      polygonIndex: location.polygonIndex,
      ringIndex: location.ringIndex,
      pointIndices: new Set(),
    };

    if (Number.isInteger(location.pointIndex) && location.pointIndex >= 0 && location.pointIndex < ring.length) {
      existing.pointIndices.add(location.pointIndex);
    }

    groupedLocations.set(key, existing);
  });

  const deletionGroups = new Map();

  groupedLocations.forEach((group, key) => {
    const ring = shape.polygons?.[group.polygonIndex]?.[group.ringIndex];
    const indices = Array.from(group.pointIndices).sort((left, right) => left - right);

    if (!Array.isArray(ring) || indices.length === 0) {
      return;
    }

    const remainingPointCount = ring.length - indices.length;

    if (remainingPointCount >= 3) {
      deletionGroups.set(key, {
        indices,
        deleteSet: new Set(indices),
        removePolygon: false,
        removeRing: false,
      });
      return;
    }

    if (!canRemoveRingFromShape(shape, group.polygonIndex, group.ringIndex)) {
      return;
    }

    deletionGroups.set(key, {
      indices,
      deleteSet: new Set(indices),
      removePolygon: group.ringIndex === 0,
      removeRing: true,
    });
  });

  return deletionGroups;
}

function applyVertexDeletion(shape, deletionGroups) {
  const nextPolygons = [];
  const handleRemap = new Map();

  shape.polygons.forEach((polygon, polygonIndex) => {
    const outerDeletion = deletionGroups.get(createRingLocationKey(polygonIndex, 0));

    if (outerDeletion?.removePolygon) {
      return;
    }

    const nextPolygon = [];

    polygon.forEach((ring, ringIndex) => {
      const deletionGroup = deletionGroups.get(createRingLocationKey(polygonIndex, ringIndex));

      if (deletionGroup?.removeRing) {
        return;
      }

      const nextRing = [];

      ring.forEach((point, pointIndex) => {
        if (deletionGroup?.deleteSet.has(pointIndex)) {
          return;
        }

        handleRemap.set(
          createHandleId({ polygonIndex, ringIndex, pointIndex }),
          createHandleId({
            polygonIndex: nextPolygons.length,
            ringIndex: nextPolygon.length,
            pointIndex: nextRing.length,
          }),
        );
        nextRing.push(point);
      });

      if (nextRing.length >= 3) {
        nextPolygon.push(nextRing);
      }
    });

    if (nextPolygon.length > 0) {
      nextPolygons.push(nextPolygon);
    }
  });

  return {
    handleRemap,
    polygons: nextPolygons,
    cornerOverrides: remapCornerOverrides(shape.cornerOverrides, handleRemap),
  };
}

function collectNextHandleIdsAfterDelete(shape, deletionGroups) {
  const nextHandleIds = new Set();

  deletionGroups.forEach((deletionGroup, ringKey) => {
    if (deletionGroup.removeRing || deletionGroup.removePolygon) {
      return;
    }

    const [polygonIndex, ringIndex] = ringKey.split(':').map((value) => Number.parseInt(value, 10));
    const ring = shape.polygons?.[polygonIndex]?.[ringIndex];

    if (!Array.isArray(ring) || ring.length === 0) {
      return;
    }

    deletionGroup.indices.forEach((deletedIndex) => {
      const nextPointIndex = findNextSurvivingPointIndex(ring.length, deletionGroup.deleteSet, deletedIndex);

      if (!Number.isInteger(nextPointIndex)) {
        return;
      }

      nextHandleIds.add(
        createHandleId({
          polygonIndex,
          ringIndex,
          pointIndex: nextPointIndex,
        }),
      );
    });
  });

  return Array.from(nextHandleIds);
}

function remapCornerOverrides(cornerOverrides, handleRemap) {
  if (!cornerOverrides) {
    return undefined;
  }

  const nextCornerOverrides = {};

  Object.entries(cornerOverrides).forEach(([key, cornerType]) => {
    const parsed = parseHandleId(key);

    if (!parsed) {
      nextCornerOverrides[key] = cornerType;
      return;
    }

    const nextKey = handleRemap.get(key);

    if (nextKey) {
      nextCornerOverrides[nextKey] = cornerType;
    }
  });

  return Object.keys(nextCornerOverrides).length > 0 ? nextCornerOverrides : undefined;
}

function canRemoveRingFromShape(shape, polygonIndex, ringIndex) {
  if (ringIndex === 0) {
    return shape.polygons.length > 1;
  }

  const polygon = shape.polygons?.[polygonIndex];
  return Array.isArray(polygon) && polygon.length > 1;
}

function countDeletedIndicesBefore(indices, pointIndex) {
  let deletedCount = 0;

  for (const index of indices) {
    if (index >= pointIndex) {
      break;
    }

    deletedCount += 1;
  }

  return deletedCount;
}

function findNextSurvivingPointIndex(ringLength, deleteSet, deletedIndex) {
  if (!Number.isInteger(ringLength) || ringLength <= 0) {
    return null;
  }

  for (let step = 1; step <= ringLength; step += 1) {
    const candidateIndex = (deletedIndex + step) % ringLength;

    if (!deleteSet.has(candidateIndex)) {
      return candidateIndex;
    }
  }

  return null;
}

function createRingLocationKey(polygonIndex, ringIndex) {
  return `${polygonIndex}:${ringIndex}`;
}

function parseHandleId(handleId) {
  const [polygonIndex, ringIndex, pointIndex] = String(handleId)
    .split(':')
    .map((value) => Number.parseInt(value, 10));

  if (![polygonIndex, ringIndex, pointIndex].every(Number.isInteger)) {
    return null;
  }

  return {
    polygonIndex,
    ringIndex,
    pointIndex,
  };
}

function normalizeCoordinate(value) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : 0;
}

function resolveDestroyBrush(brushCells, surfaceSize) {
  const cells = Number(brushCells);

  if (!Number.isFinite(cells) || cells <= 0 || !surfaceSize?.width || !surfaceSize?.height) {
    return null;
  }

  const widthPx = cells * GRID_STEP_PX;
  const heightPx = cells * GRID_STEP_PX;

  return {
    halfHeight: heightPx / Math.max(surfaceSize.height, 1) * 0.5,
    halfWidth: widthPx / Math.max(surfaceSize.width, 1) * 0.5,
    heightPx,
    widthPx,
  };
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function remapCoordinateBetweenBounds(value, sourceMin, sourceMax, targetMin, targetMax) {
  const sourceSpan = sourceMax - sourceMin;

  if (Math.abs(sourceSpan) <= Number.EPSILON) {
    return value + ((targetMin + targetMax) * 0.5 - (sourceMin + sourceMax) * 0.5);
  }

  const progress = (value - sourceMin) / sourceSpan;
  return targetMin + progress * (targetMax - targetMin);
}
