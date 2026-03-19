import { useEffect, useRef, useState } from 'react';
import { snapPointToGrid } from '../lib/grid.js';
import { DRAW_MODE_CLASSIC, POINT_KIND_A, POINT_KIND_B, getExpectedKind } from '../lib/lasso.js';
import { findShapeIdsInLasso, findTopmostShapeIdAtPoint } from '../lib/shapes.js';
import { drawLassoScene } from '../lib/rendering.js';

const MIN_VIEWPORT_SCALE = 0.35;
const MAX_VIEWPORT_SCALE = 6;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const DRAG_START_THRESHOLD_PX = 4;
const INSERT_HANDLE_SEGMENT_THRESHOLD_PX = 8;
const INSERT_HANDLE_MIDPOINT_ZONE_MIN = 0.22;
const INSERT_HANDLE_MIDPOINT_ZONE_MAX = 0.78;

function DrawingCanvas({
  appearance,
  editorMode,
  focusRequest = null,
  isDraftActive = false,
  isDraftReady = false,
  isSequentialDualPoint = false,
  onDuplicateShapeDragStart,
  snapToGrid = false,
  onBeginHistoryGesture,
  onEndHistoryGesture,
  onMoveShape,
  onMoveShapeVertices,
  onPlacePoint,
  onPointerChange,
  onInsertShapeVertex,
  onSelectHandleIds,
  onSelectShapeIds,
  onSurfaceChange,
  onUpdateShapeVertex,
  onViewportContextMenu,
  scene,
}) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [hoverInsertHandle, setHoverInsertHandle] = useState(null);
  const [hoveredHandleId, setHoveredHandleId] = useState(null);
  const [hoveredShapeId, setHoveredShapeId] = useState(null);
  const [selectionLasso, setSelectionLasso] = useState([]);
  const [surfaceSize, setSurfaceSize] = useState({ width: 960, height: 640 });
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [viewportScale, setViewportScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const isMoveEditMode = editorMode === 'select' || editorMode === 'edit';

  useEffect(() => {
    const frame = frameRef.current;

    if (!frame) {
      return undefined;
    }

    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(320, Math.round(entry.contentRect.width));
      const nextHeight = Math.max(320, Math.round(entry.contentRect.height));

      setSurfaceSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current;
        }

        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    });

    observer.observe(frame);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    onSurfaceChange?.(surfaceSize);
  }, [onSurfaceChange, surfaceSize]);

  useEffect(() => {
    if (!focusRequest?.bounds) {
      return;
    }

    const centerX = (focusRequest.bounds.minX + focusRequest.bounds.maxX) * 0.5;
    const centerY = (focusRequest.bounds.minY + focusRequest.bounds.maxY) * 0.5;

    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) {
      return;
    }

    setViewportOffset({
      x: surfaceSize.width * 0.5 - centerX * surfaceSize.width * viewportScale,
      y: surfaceSize.height * 0.5 - centerY * surfaceSize.height * viewportScale,
    });
  }, [focusRequest?.token]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.round(surfaceSize.width * dpr));
    canvas.height = Math.max(1, Math.round(surfaceSize.height * dpr));
    canvas.style.width = `${surfaceSize.width}px`;
    canvas.style.height = `${surfaceSize.height}px`;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawLassoScene(
      context,
      surfaceSize,
      {
        ...scene,
        hoveredHandleId,
        hoveredShapeId,
        insertHandle: hoverInsertHandle,
        selectionLasso,
      },
      appearance,
      {
        viewOffset: viewportOffset,
        viewScale: viewportScale,
      },
    );
  }, [appearance, hoveredHandleId, hoveredShapeId, hoverInsertHandle, scene, selectionLasso, surfaceSize, viewportOffset, viewportScale]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (event) => {
      if (event.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    const handleWindowBlur = () => {
      setIsSpacePressed(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    const frame = frameRef.current;

    if (!frame) {
      return undefined;
    }

    const handleNativeWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();

      const bounds = frame.getBoundingClientRect();
      const localX = event.clientX - bounds.left;
      const localY = event.clientY - bounds.top;
      const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);

      setViewportScale((currentScale) => {
        const nextScale = clampScale(currentScale * zoomFactor);

        if (nextScale === currentScale) {
          return currentScale;
        }

        setViewportOffset((currentOffset) => ({
          x: localX - ((localX - currentOffset.x) / currentScale) * nextScale,
          y: localY - ((localY - currentOffset.y) / currentScale) * nextScale,
        }));

        return nextScale;
      });
    };

    frame.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      frame.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

  const handlePointerMove = (event) => {
    if (dragRef.current?.type === 'pan') {
      handlePanMove(event);
      return;
    }

    const rawPoint = readCanvasPoint(event, canvasRef.current, viewportOffset, viewportScale);
    const point = maybeSnapPoint(rawPoint, surfaceSize, snapToGrid);

    onPointerChange(point);

    if (dragRef.current && rawPoint && point) {
      handleDragMove(point, rawPoint);
      return;
    }

    if (isMoveEditMode) {
      const nextHoveredHandle = findHandleAtPoint(scene.editHandles, rawPoint, surfaceSize, viewportScale);
      setHoveredHandleId(nextHoveredHandle?.id ?? null);
      setHoveredShapeId(findTopmostShapeIdAtPoint(scene.shapes, rawPoint));
      const nextInsertHandle = nextHoveredHandle
        ? null
        : findInsertHandle(scene, rawPoint, surfaceSize, viewportScale);
      setHoverInsertHandle((current) =>
        isSameInsertHandle(current, nextInsertHandle) ? current : nextInsertHandle,
      );
      return;
    }

    setHoveredHandleId(null);
    setHoveredShapeId(null);
    setHoverInsertHandle(null);
  };

  const handlePointerLeave = () => {
    if (!dragRef.current) {
      onPointerChange(null);
    }

    setHoveredHandleId(null);
    setHoveredShapeId(null);
    setHoverInsertHandle(null);
  };

  useEffect(() => {
    if (!isMoveEditMode) {
      setHoveredHandleId(null);
      setHoverInsertHandle(null);
      setHoveredShapeId(null);
      setSelectionLasso([]);
    }
  }, [editorMode, isMoveEditMode]);

  const handlePointerDown = (event) => {
    if (shouldStartPanGesture(event, isSpacePressed)) {
      event.preventDefault();
      setHoveredShapeId(null);
      setHoverInsertHandle(null);
      onPointerChange(null);
      setIsPanning(true);
      dragRef.current = {
        type: 'pan',
        originClientX: event.clientX,
        originClientY: event.clientY,
        baseOffset: viewportOffset,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    const rawPoint = readCanvasPoint(event, canvasRef.current, viewportOffset, viewportScale);
    const point = maybeSnapPoint(rawPoint, surfaceSize, snapToGrid);

    if (!rawPoint || !point) {
      return;
    }

    if (isMoveEditMode && event.button !== 0) {
      event.preventDefault();
      return;
    }

    if (isMoveEditMode) {
      event.preventDefault();
      handleSelectionPointerDown(event, rawPoint, point);
      return;
    }

    const kind = resolveInputKind(
      event,
      scene.draftState,
      scene.draftState.touchMode,
      isSequentialDualPoint,
    );

    if (!kind) {
      return;
    }

    event.preventDefault();
    onPlacePoint(kind, point);
  };

  const handlePointerUp = (event) => {
    if (!dragRef.current) {
      return;
    }

    if (dragRef.current.type === 'pan') {
      dragRef.current = null;
      setIsPanning(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      onPointerChange(null);
      return;
    }

    if (dragRef.current.type === 'selection-lasso') {
      finalizeLassoSelection(readCanvasPoint(event, canvasRef.current, viewportOffset, viewportScale));
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setSelectionLasso([]);
      return;
    }

    if (dragRef.current.type === 'pending-handles') {
      dragRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      return;
    }

    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onEndHistoryGesture?.();
  };

  const handleContextMenu = (event) => {
    event.preventDefault();

    const point = readCanvasPoint(event, canvasRef.current, viewportOffset, viewportScale);

    if (!point || editorMode === 'draw') {
      return;
    }

    onViewportContextMenu?.({
      clientX: event.clientX,
      clientY: event.clientY,
      hitShapeId: findTopmostShapeIdAtPoint(scene.shapes, point),
    });
  };

  return (
    <section
      className={`canvas-frame ${isDraftActive ? 'is-draft-active' : ''} ${isDraftReady ? 'is-draft-ready' : ''}`.trim()}
      ref={frameRef}
    >
      <canvas
        ref={canvasRef}
        className="drawing-canvas"
        data-mode={scene.draftState.mode}
        data-editor-mode={editorMode}
        data-pan-active={isPanning ? 'true' : 'false'}
        data-pan-shortcut={isSpacePressed ? 'true' : 'false'}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onPointerMove={handlePointerMove}
        onPointerCancel={handlePointerUp}
        onPointerUp={handlePointerUp}
      />
    </section>
  );

  function handleSelectionPointerDown(event, rawPoint, snappedPoint) {
    const insertHandle = findInsertHandle(scene, rawPoint, surfaceSize, viewportScale);

    if (insertHandle) {
      onSelectHandleIds([]);
      onSelectShapeIds([insertHandle.shapeId]);
      onInsertShapeVertex?.(insertHandle.shapeId, insertHandle.location, insertHandle.point);
      return;
    }

    const hitHandle = findHandleAtPoint(scene.editHandles, rawPoint, surfaceSize, viewportScale);
    const additiveSelection = event.ctrlKey || event.metaKey || event.shiftKey;

    if (hitHandle) {
      const nextSelectedHandleIds = additiveSelection
        ? updateSelection(scene.selectedHandleIds ?? [], hitHandle.id, true)
        : scene.selectedHandleIds?.includes(hitHandle.id)
          ? scene.selectedHandleIds
          : [hitHandle.id];

      onSelectHandleIds(nextSelectedHandleIds);
      onSelectShapeIds(
        scene.selectedShapeIds.includes(hitHandle.shapeId)
          ? scene.selectedShapeIds
          : [hitHandle.shapeId],
      );

      if (additiveSelection || nextSelectedHandleIds.length === 0) {
        return;
      }

      dragRef.current = {
        type: 'pending-handles',
        shapeId: hitHandle.shapeId,
        originPoint: snappedPoint,
        baseShape: getShapeSnapshot(scene.shapes, hitHandle.shapeId),
        locations: scene.editHandles
          .filter((handle) => nextSelectedHandleIds.includes(handle.id))
          .map((handle) => handle.location),
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    const hitShapeId = findTopmostShapeIdAtPoint(scene.shapes, rawPoint);

    if (hitShapeId) {
      const nextSelectedShapeIds =
        scene.selectedShapeIds.includes(hitShapeId) && !additiveSelection
          ? scene.selectedShapeIds
          : updateSelection(scene.selectedShapeIds, hitShapeId, additiveSelection);
      const dragShapeIds =
        !additiveSelection && scene.selectedShapeIds.includes(hitShapeId)
          ? scene.selectedShapeIds
          : nextSelectedShapeIds;

      onSelectHandleIds([]);
      onSelectShapeIds(nextSelectedShapeIds);

      if (additiveSelection) {
        return;
      }

      onBeginHistoryGesture?.();
      dragRef.current = {
        type: event.altKey ? 'duplicate-shapes' : 'shapes',
        sourceShapeIds: dragShapeIds,
        shapeIds: dragShapeIds,
        originPoint: snappedPoint,
        rememberDuplicateDelta: false,
        baseShapes: dragShapeIds
          .map((shapeId) => getShapeSnapshot(scene.shapes, shapeId))
          .filter(Boolean),
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    onSelectHandleIds([]);
    handleLassoSelectionPointerDown(event, rawPoint);
  }

  function handleLassoSelectionPointerDown(event, point) {
    onSelectHandleIds([]);
    dragRef.current = {
      type: 'selection-lasso',
      additiveSelection: event.ctrlKey || event.metaKey || event.shiftKey,
      originPoint: point,
      points: [point],
    };
    setSelectionLasso([point]);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleDragMove(point, rawPoint = point) {
    if (!dragRef.current) {
      return;
    }

    if (dragRef.current.type === 'pending-handles') {
      if (distanceInSurface(dragRef.current.originPoint, point, surfaceSize, viewportScale) < DRAG_START_THRESHOLD_PX) {
        return;
      }

      onBeginHistoryGesture?.();
      dragRef.current = {
        ...dragRef.current,
        type: 'handles',
      };
    }

    if (dragRef.current.type === 'selection-lasso') {
      const nextPoint = rawPoint ?? point;
      const previousPoint = dragRef.current.points[dragRef.current.points.length - 1];

      if (distanceInSurface(previousPoint, nextPoint, surfaceSize, viewportScale) < 8) {
        return;
      }

      dragRef.current = {
        ...dragRef.current,
        points: [...dragRef.current.points, nextPoint],
      };
      setSelectionLasso(dragRef.current.points);
      return;
    }

    const delta = {
      x: point.x - dragRef.current.originPoint.x,
      y: point.y - dragRef.current.originPoint.y,
    };

    if (dragRef.current.type === 'handles') {
      onMoveShapeVertices(
        dragRef.current.shapeId,
        dragRef.current.baseShape,
        dragRef.current.locations,
        delta,
      );
      return;
    }

    if (dragRef.current.type === 'duplicate-shapes') {
      if (distanceInSurface(dragRef.current.originPoint, point, surfaceSize, viewportScale) < 2) {
        return;
      }

      const duplicatedDragState = onDuplicateShapeDragStart?.(dragRef.current.sourceShapeIds);

      if (!duplicatedDragState) {
        return;
      }

      dragRef.current = {
        type: 'shapes',
        shapeIds: duplicatedDragState.shapeIds,
        originPoint: dragRef.current.originPoint,
        baseShapes: duplicatedDragState.shapes,
        rememberDuplicateDelta: true,
      };

      onMoveShape(dragRef.current.shapeIds, dragRef.current.baseShapes, delta, {
        rememberDuplicateDelta: true,
      });
      return;
    }

    if (dragRef.current.type === 'shapes') {
      onMoveShape(dragRef.current.shapeIds, dragRef.current.baseShapes, delta, {
        rememberDuplicateDelta: dragRef.current.rememberDuplicateDelta === true,
      });
    }
  }

  function finalizeLassoSelection(rawPoint) {
    const lassoDrag = dragRef.current;

    if (!lassoDrag) {
      return;
    }

    const nextSelectedIds =
      lassoDrag.points.length >= 3
        ? findShapeIdsInLasso(scene.shapes, lassoDrag.points)
        : resolveSingleSelectionFromPoint(scene.shapes, rawPoint);

    if (lassoDrag.additiveSelection) {
      onSelectHandleIds([]);
      onSelectShapeIds(mergeSelections(scene.selectedShapeIds, nextSelectedIds));
      return;
    }

    onSelectHandleIds([]);
    onSelectShapeIds(nextSelectedIds);
  }

  function handlePanMove(event) {
    const panState = dragRef.current;

    if (!panState || panState.type !== 'pan') {
      return;
    }

    setViewportOffset({
      x: panState.baseOffset.x + (event.clientX - panState.originClientX),
      y: panState.baseOffset.y + (event.clientY - panState.originClientY),
    });
  }
}

function shouldStartPanGesture(event, isSpacePressed) {
  if (event.pointerType !== 'mouse') {
    return false;
  }

  return event.button === 1 || (isSpacePressed && event.button === 0);
}

function resolveInputKind(event, draftState, touchMode, isSequentialDualPoint) {
  if (event.currentTarget?.dataset.mode === DRAW_MODE_CLASSIC) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return null;
    }

    return POINT_KIND_A;
  }

  if (isSequentialDualPoint) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return null;
    }

    return getExpectedKind(draftState) ?? POINT_KIND_A;
  }

  if (event.pointerType === 'mouse') {
    if (event.button === 0) {
      return POINT_KIND_A;
    }

    if (event.button === 2) {
      return POINT_KIND_B;
    }

    return null;
  }

  return touchMode;
}

function readCanvasPoint(event, canvas, viewOffset = { x: 0, y: 0 }, viewScale = 1) {
  if (!canvas) {
    return null;
  }

  const bounds = canvas.getBoundingClientRect();

  if (!bounds.width || !bounds.height) {
    return null;
  }

  const safeScale = Math.max(viewScale, Number.EPSILON);
  const x = (event.clientX - bounds.left - viewOffset.x) / (bounds.width * safeScale);
  const y = (event.clientY - bounds.top - viewOffset.y) / (bounds.height * safeScale);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function findHandleAtPoint(handles = [], point, surfaceSize, viewScale = 1) {
  const radius = 12;

  for (let index = handles.length - 1; index >= 0; index -= 1) {
    const handle = handles[index];
    const dx = (handle.point.x - point.x) * surfaceSize.width * viewScale;
    const dy = (handle.point.y - point.y) * surfaceSize.height * viewScale;

    if (Math.hypot(dx, dy) <= radius) {
      return handle;
    }
  }

  return null;
}

function getShapeSnapshot(shapes, shapeId) {
  return shapes.find((shape) => shape.id === shapeId) ?? null;
}

function maybeSnapPoint(point, surfaceSize, snapToGrid) {
  if (!point || !snapToGrid) {
    return point;
  }

  return snapPointToGrid(point, surfaceSize);
}

function updateSelection(currentSelection, shapeId, additiveSelection) {
  if (!additiveSelection) {
    return [shapeId];
  }

  if (currentSelection.includes(shapeId)) {
    return currentSelection.filter((currentId) => currentId !== shapeId);
  }

  return [...currentSelection, shapeId];
}

function findInsertHandle(scene, point, surfaceSize, viewScale = 1) {
  if (
    (scene.editorMode !== 'select' && scene.editorMode !== 'edit') ||
    scene.selectedShapeIds.length !== 1 ||
    !point
  ) {
    return null;
  }

  const shape = getShapeSnapshot(scene.shapes, scene.selectedShapeIds[0]);
  if (!shape?.polygons?.length) {
    return null;
  }

  let nearestHandle = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  shape.polygons.forEach((polygon, polygonIndex) => {
    polygon.forEach((ring, ringIndex) => {
      if (!ring || ring.length < 3) {
        return;
      }

      for (let index = 0; index < ring.length; index += 1) {
        const start = ring[index];
        const end = ring[(index + 1) % ring.length];
        const midpoint = {
          x: (start.x + end.x) * 0.5,
          y: (start.y + end.y) * 0.5,
        };
        const segmentHover = getSegmentHoverMetrics(point, start, end, surfaceSize, viewScale);

        if (
          segmentHover.distance <= INSERT_HANDLE_SEGMENT_THRESHOLD_PX &&
          segmentHover.t >= INSERT_HANDLE_MIDPOINT_ZONE_MIN &&
          segmentHover.t <= INSERT_HANDLE_MIDPOINT_ZONE_MAX &&
          segmentHover.distance < nearestDistance
        ) {
          nearestHandle = {
            shapeId: shape.id,
            point: midpoint,
            location: {
              polygonIndex,
              ringIndex,
              insertIndex: index + 1,
            },
          };
          nearestDistance = segmentHover.distance;
        }
      }
    });
  });

  return nearestHandle;
}

function resolveSingleSelectionFromPoint(shapes, point) {
  const hitShapeId = point ? findTopmostShapeIdAtPoint(shapes, point) : null;
  return hitShapeId ? [hitShapeId] : [];
}

function mergeSelections(currentSelection, nextSelection) {
  return Array.from(new Set([...currentSelection, ...nextSelection]));
}

function distanceInSurface(left, right, surfaceSize, viewScale = 1) {
  if (!left || !right) {
    return Number.POSITIVE_INFINITY;
  }

  const dx = (left.x - right.x) * surfaceSize.width * viewScale;
  const dy = (left.y - right.y) * surfaceSize.height * viewScale;
  return Math.hypot(dx, dy);
}

function getSegmentHoverMetrics(point, start, end, surfaceSize, viewScale = 1) {
  const startSurface = toSurfacePoint(start, surfaceSize, viewScale);
  const endSurface = toSurfacePoint(end, surfaceSize, viewScale);
  const pointSurface = toSurfacePoint(point, surfaceSize, viewScale);
  const segmentX = endSurface.x - startSurface.x;
  const segmentY = endSurface.y - startSurface.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared <= Number.EPSILON) {
    return {
      distance: Math.hypot(pointSurface.x - startSurface.x, pointSurface.y - startSurface.y),
      t: 0,
    };
  }

  const projectedT =
    ((pointSurface.x - startSurface.x) * segmentX + (pointSurface.y - startSurface.y) * segmentY) /
    segmentLengthSquared;
  const t = clamp(projectedT, 0, 1);
  const projectedX = startSurface.x + segmentX * t;
  const projectedY = startSurface.y + segmentY * t;

  return {
    distance: Math.hypot(pointSurface.x - projectedX, pointSurface.y - projectedY),
    t,
  };
}

function toSurfacePoint(point, surfaceSize, viewScale = 1) {
  return {
    x: point.x * surfaceSize.width * viewScale,
    y: point.y * surfaceSize.height * viewScale,
  };
}

function clampScale(value) {
  return Math.min(MAX_VIEWPORT_SCALE, Math.max(MIN_VIEWPORT_SCALE, value));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isSameInsertHandle(left, right) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.shapeId === right.shapeId &&
    left.location?.polygonIndex === right.location?.polygonIndex &&
    left.location?.ringIndex === right.location?.ringIndex &&
    left.location?.insertIndex === right.location?.insertIndex
  );
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

export default DrawingCanvas;
