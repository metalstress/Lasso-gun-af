import { useEffect, useRef, useState } from 'react';
import { GRID_STEP_PX, snapPointToGrid } from '../lib/grid.js';
import { DRAW_MODE_CLASSIC, POINT_KIND_A, POINT_KIND_B, getExpectedKind } from '../lib/lasso.js';
import { findShapeIdsInLasso, findTopmostShapeIdAtPoint, getShapeBounds } from '../lib/shapes.js';
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
  destroyBrushCells = 8,
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
  onDestroyShapes,
  onEditorModeChange,
  onTransformShapes,
  onRotateShapes,
  onTransformPlusShapes,
  onMirrorSelection,
  onImportSvg,
  onPlacePoint,
  onPointerChange,
  onInsertShapeVertex,
  onSelectHandleIds,
  onSelectShapeIds,
  onSurfaceChange,
  transformSelectionBounds = null,
  onToggleHandleSharpCorner,
  onUpdateShapeVertex,
  onViewportContextMenu,
  scene,
}) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const transformDragRef = useRef(null);
  const fileDragDepthRef = useRef(0);
  const [destroyCursorPoint, setDestroyCursorPoint] = useState(null);
  const [hoverInsertHandle, setHoverInsertHandle] = useState(null);
  const [hoveredHandleId, setHoveredHandleId] = useState(null);
  const [hoveredShapeId, setHoveredShapeId] = useState(null);
  const [selectionLasso, setSelectionLasso] = useState([]);
  const [transformPlusState, setTransformPlusState] = useState(null);
  const [isSvgDropActive, setIsSvgDropActive] = useState(false);
  const [surfaceSize, setSurfaceSize] = useState({ width: 960, height: 640 });
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [viewportScale, setViewportScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const isDestroyMode = editorMode === 'destroy';
  const isTransformMode = editorMode === 'transform';
  const isTransformPlusMode = editorMode === 'transform-plus';
  const isMoveEditMode =
    editorMode === 'select' || editorMode === 'edit' || isTransformMode || isTransformPlusMode;
  const transformSelectionKey = scene.selectedShapeIds.join('|');
  const transformPlusQuad = transformPlusState?.quad ?? null;
  const transformOverlay = getTransformOverlayRect(
    transformSelectionBounds,
    surfaceSize,
    viewportOffset,
    viewportScale,
  );
  const transformPlusOverlay = getTransformQuadOverlay(
    transformPlusQuad,
    surfaceSize,
    viewportOffset,
    viewportScale,
  );
  const transformPopupOverlay =
    isTransformPlusMode && transformPlusOverlay
      ? getTransformRectFromQuadOverlay(transformPlusOverlay)
      : transformOverlay;
  const showTransformPopup =
    Boolean(transformPopupOverlay) && scene.selectedShapeIds.length > 0 && isMoveEditMode;
  const showTransformBox = Boolean(transformOverlay) && scene.selectedShapeIds.length > 0 && isTransformMode;
  const showTransformPlusBox =
    Boolean(transformPlusOverlay) && scene.selectedShapeIds.length > 0 && isTransformPlusMode;
  const destroyPreviewRect = getDestroyPreviewRect(
    isDestroyMode ? destroyCursorPoint : null,
    destroyBrushCells,
    surfaceSize,
    viewportOffset,
    viewportScale,
  );

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
    if (!isTransformPlusMode || !transformSelectionBounds || scene.selectedShapeIds.length === 0) {
      setTransformPlusState(null);
      return;
    }

    setTransformPlusState((current) => {
      if (current?.selectionKey === transformSelectionKey && current?.quad) {
        return current;
      }

      return {
        selectionKey: transformSelectionKey,
        quad: createTransformQuadFromBounds(transformSelectionBounds),
      };
    });
  }, [isTransformPlusMode, transformSelectionBounds, transformSelectionKey, scene.selectedShapeIds.length]);

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
      if (isDestroyMode) {
        setDestroyCursorPoint(point);
        setHoveredShapeId(findTopmostShapeIdAtPoint(scene.shapes, rawPoint));
      }

      handleDragMove(point, rawPoint);
      return;
    }

    if (isDestroyMode) {
      setDestroyCursorPoint(point);
      setHoveredHandleId(null);
      setHoverInsertHandle(null);
      setHoveredShapeId(findTopmostShapeIdAtPoint(scene.shapes, rawPoint));
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

    setDestroyCursorPoint(null);
    setHoveredHandleId(null);
    setHoveredShapeId(null);
    setHoverInsertHandle(null);
  };

  useEffect(() => {
    if (!isMoveEditMode) {
      setHoveredHandleId(null);
      setHoverInsertHandle(null);
      setSelectionLasso([]);
    }

    if (!isMoveEditMode && !isDestroyMode) {
      setHoveredShapeId(null);
    }

    if (!isDestroyMode) {
      setDestroyCursorPoint(null);
    }
  }, [editorMode, isDestroyMode, isMoveEditMode]);

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

    if (isDestroyMode) {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      setDestroyCursorPoint(point);
      setHoveredShapeId(findTopmostShapeIdAtPoint(scene.shapes, rawPoint));
      setHoveredHandleId(null);
      setHoverInsertHandle(null);
      onBeginHistoryGesture?.();
      onDestroyShapes?.(point, point, destroyBrushCells);
      dragRef.current = {
        type: 'destroy',
        brushCells: destroyBrushCells,
        lastPoint: point,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
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

  const handleTransformHandlePointerDown = (event) => {
    if (!isTransformMode || !transformSelectionBounds || scene.selectedShapeIds.length === 0) {
      return;
    }

    const handle = event.currentTarget.dataset.handle;

    if (!handle) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onBeginHistoryGesture?.();
    transformDragRef.current = {
      type: 'scale',
      handle,
      pointerId: event.pointerId,
      sourceBounds: transformSelectionBounds,
      baseShapes: scene.selectedShapeIds
        .map((shapeId) => getShapeSnapshot(scene.shapes, shapeId))
        .filter(Boolean),
      shapeIds: [...scene.selectedShapeIds],
      minHeight: 18 / Math.max(surfaceSize.height * viewportScale, Number.EPSILON),
      minWidth: 18 / Math.max(surfaceSize.width * viewportScale, Number.EPSILON),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleTransformHandlePointerMove = (event) => {
    const transformDrag = transformDragRef.current;

    if (!transformDrag || transformDrag.pointerId !== event.pointerId) {
      return;
    }

    const rawPoint = readClientPoint(
      event.clientX,
      event.clientY,
      canvasRef.current,
      viewportOffset,
      viewportScale,
    );

    if (!rawPoint) {
      return;
    }

    if (transformDrag.type === 'rotate') {
      const point = rawPoint;
      const nextAngle =
        getAngleBetweenPoints(transformDrag.pivotPoint, point) - transformDrag.startAngle;

      onRotateShapes?.(
        transformDrag.shapeIds,
        transformDrag.baseShapes,
        transformDrag.pivotPoint,
        nextAngle,
      );
      return;
    }

    const point = maybeSnapPoint(rawPoint, surfaceSize, snapToGrid);

    if (!point) {
      return;
    }

    const nextBounds = resizeBoundsFromHandle(
      transformDrag.sourceBounds,
      point,
      transformDrag.handle,
      transformDrag.minWidth,
      transformDrag.minHeight,
    );

    onTransformShapes?.(
      transformDrag.shapeIds,
      transformDrag.baseShapes,
      transformDrag.sourceBounds,
      nextBounds,
    );
  };

  const handleTransformHandlePointerUp = (event) => {
    const transformDrag = transformDragRef.current;

    if (!transformDrag || transformDrag.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    transformDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onEndHistoryGesture?.();
  };

  const handleTransformRotatePointerDown = (event) => {
    if (!isTransformMode || !transformSelectionBounds || scene.selectedShapeIds.length === 0) {
      return;
    }

    const point = readClientPoint(
      event.clientX,
      event.clientY,
      canvasRef.current,
      viewportOffset,
      viewportScale,
    );
    const pivotPoint = getBoundsCenter(transformSelectionBounds);

    if (!point || !pivotPoint) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onBeginHistoryGesture?.();
    transformDragRef.current = {
      type: 'rotate',
      pointerId: event.pointerId,
      pivotPoint,
      startAngle: getAngleBetweenPoints(pivotPoint, point),
      baseShapes: scene.selectedShapeIds
        .map((shapeId) => getShapeSnapshot(scene.shapes, shapeId))
        .filter(Boolean),
      shapeIds: [...scene.selectedShapeIds],
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleTransformPlusHandlePointerDown = (event) => {
    if (!isTransformPlusMode || !transformSelectionBounds || !transformPlusQuad || scene.selectedShapeIds.length === 0) {
      return;
    }

    const handle = event.currentTarget.dataset.handle;

    if (!handle) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onBeginHistoryGesture?.();
    transformDragRef.current = {
      type: 'transform-plus',
      handle,
      pointerId: event.pointerId,
      sourceBounds: transformSelectionBounds,
      sourceQuad: cloneTransformQuad(transformPlusQuad),
      selectionKey: transformSelectionKey,
      baseShapes: scene.selectedShapeIds
        .map((shapeId) => getShapeSnapshot(scene.shapes, shapeId))
        .filter(Boolean),
      shapeIds: [...scene.selectedShapeIds],
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleTransformPlusHandlePointerMove = (event) => {
    const transformDrag = transformDragRef.current;

    if (
      !transformDrag ||
      transformDrag.type !== 'transform-plus' ||
      transformDrag.pointerId !== event.pointerId
    ) {
      return;
    }

    const point = maybeSnapPoint(
      readClientPoint(
        event.clientX,
        event.clientY,
        canvasRef.current,
        viewportOffset,
        viewportScale,
      ),
      surfaceSize,
      snapToGrid,
    );

    if (!point) {
      return;
    }

    const nextQuad = {
      ...transformDrag.sourceQuad,
      [transformDrag.handle]: point,
    };

    setTransformPlusState({
      selectionKey: transformDrag.selectionKey,
      quad: nextQuad,
    });
    onTransformPlusShapes?.(
      transformDrag.shapeIds,
      transformDrag.baseShapes,
      transformDrag.sourceBounds,
      nextQuad,
    );
  };

  const handleTransformPlusHandlePointerUp = (event) => {
    const transformDrag = transformDragRef.current;

    if (
      !transformDrag ||
      transformDrag.type !== 'transform-plus' ||
      transformDrag.pointerId !== event.pointerId
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    transformDragRef.current = null;
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

  const handleSvgDragEnter = (event) => {
    if (!hasSvgDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    fileDragDepthRef.current += 1;
    setIsSvgDropActive(true);
  };

  const handleSvgDragOver = (event) => {
    if (!hasSvgDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isSvgDropActive) {
      setIsSvgDropActive(true);
    }
  };

  const handleSvgDragLeave = (event) => {
    if (!hasSvgDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);

    if (fileDragDepthRef.current === 0) {
      setIsSvgDropActive(false);
    }
  };

  const handleSvgDrop = async (event) => {
    if (!hasSvgDragPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    fileDragDepthRef.current = 0;
    setIsSvgDropActive(false);

    const svgFile = Array.from(event.dataTransfer.files ?? []).find((file) => isSvgFile(file));

    if (!svgFile) {
      return;
    }

    const rawPoint = readCanvasPoint(event, canvasRef.current, viewportOffset, viewportScale);
    const point = maybeSnapPoint(rawPoint, surfaceSize, snapToGrid);
    await onImportSvg?.(svgFile, point);
  };

  return (
    <section
      className={`canvas-frame ${isDraftActive ? 'is-draft-active' : ''} ${isDraftReady ? 'is-draft-ready' : ''} ${
        isSvgDropActive ? 'is-svg-drop-active' : ''
      }`.trim()}
      ref={frameRef}
      onDragEnter={handleSvgDragEnter}
      onDragLeave={handleSvgDragLeave}
      onDragOver={handleSvgDragOver}
      onDrop={handleSvgDrop}
    >
      {isSvgDropActive ? (
        <div className="canvas-drop-overlay" aria-hidden="true">
          <span className="canvas-drop-overlay-copy">Drop SVG to import</span>
        </div>
      ) : null}
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
      {destroyPreviewRect ? (
        <div
          className="canvas-destroy-preview"
          style={{
            left: `${destroyPreviewRect.left}px`,
            top: `${destroyPreviewRect.top}px`,
            width: `${destroyPreviewRect.size}px`,
            height: `${destroyPreviewRect.size}px`,
          }}
          aria-hidden="true"
        />
      ) : null}
      {showTransformBox ? (
        <div
          className="canvas-transform-box"
          style={{
            left: `${transformOverlay.left}px`,
            top: `${transformOverlay.top}px`,
            width: `${transformOverlay.width}px`,
            height: `${transformOverlay.height}px`,
          }}
          aria-hidden="true"
        >
          <div className="canvas-transform-rotate-stem" />
          <button
            type="button"
            className="canvas-transform-handle handle-rotate"
            tabIndex={-1}
            onPointerDown={handleTransformRotatePointerDown}
            onPointerMove={handleTransformHandlePointerMove}
            onPointerUp={handleTransformHandlePointerUp}
            onPointerCancel={handleTransformHandlePointerUp}
          />
          {TRANSFORM_HANDLES.map((handle) => (
            <button
              key={handle}
              type="button"
              className={`canvas-transform-handle handle-${handle}`}
              data-handle={handle}
              tabIndex={-1}
              onPointerDown={handleTransformHandlePointerDown}
              onPointerMove={handleTransformHandlePointerMove}
              onPointerUp={handleTransformHandlePointerUp}
              onPointerCancel={handleTransformHandlePointerUp}
            />
          ))}
        </div>
      ) : null}
      {showTransformPlusBox ? (
        <div className="canvas-transform-plus-box" aria-hidden="true">
          <svg className="canvas-transform-plus-svg" viewBox={`0 0 ${surfaceSize.width} ${surfaceSize.height}`}>
            <path
              className="canvas-transform-plus-path"
              d={getTransformQuadPath(transformPlusOverlay)}
            />
            <path
              className="canvas-transform-plus-path canvas-transform-plus-path-secondary"
              d={getTransformQuadPath(transformPlusOverlay)}
            />
          </svg>
          {TRANSFORM_PLUS_HANDLES.map((handle) => {
            const point = transformPlusOverlay?.[handle];

            if (!point) {
              return null;
            }

            return (
              <button
                key={handle}
                type="button"
                className="canvas-transform-handle canvas-transform-plus-handle"
                data-handle={handle}
                style={{
                  left: `${point.x}px`,
                  top: `${point.y}px`,
                }}
                tabIndex={-1}
                onPointerDown={handleTransformPlusHandlePointerDown}
                onPointerMove={handleTransformPlusHandlePointerMove}
                onPointerUp={handleTransformPlusHandlePointerUp}
                onPointerCancel={handleTransformPlusHandlePointerUp}
              />
            );
          })}
        </div>
      ) : null}
      {showTransformPopup ? (
        <div
          className={`canvas-transform-popover ${
            showTransformBox || showTransformPlusBox ? 'is-transform-active' : ''
          }`.trim()}
          style={getTransformPopoverStyle(transformPopupOverlay, surfaceSize)}
        >
          <button
            type="button"
            className={`canvas-transform-action ${showTransformBox ? 'is-active' : ''}`.trim()}
            onClick={() => onEditorModeChange?.(isTransformMode ? 'select' : 'transform')}
          >
            Transform
          </button>
          <button
            type="button"
            className={`canvas-transform-action ${showTransformPlusBox ? 'is-active' : ''}`.trim()}
            onClick={() => onEditorModeChange?.(isTransformPlusMode ? 'select' : 'transform-plus')}
          >
            Transform+
          </button>
          <button
            type="button"
            className="canvas-transform-action"
            onClick={() => onMirrorSelection?.('x')}
          >
            Mirror X
          </button>
          <button
            type="button"
            className="canvas-transform-action"
            onClick={() => onMirrorSelection?.('y')}
          >
            Mirror Y
          </button>
        </div>
      ) : null}
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

      if (!additiveSelection && event.detail >= 2) {
        onToggleHandleSharpCorner?.(hitHandle.shapeId, hitHandle.location, hitHandle.id);
        return;
      }

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
      const dragBaseShapes = dragShapeIds
        .map((shapeId) => getShapeSnapshot(scene.shapes, shapeId))
        .filter(Boolean);

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
        baseQuad: isTransformPlusMode
          ? cloneTransformQuad(
              areShapeIdListsEqual(dragShapeIds, scene.selectedShapeIds)
                ? transformPlusQuad ?? createTransformQuadFromBounds(transformSelectionBounds)
                : createTransformQuadFromBounds(getShapesBoundsFromList(dragBaseShapes)),
            )
          : null,
        selectionKey: transformSelectionKey,
        baseShapes: dragBaseShapes,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }

    onSelectHandleIds([]);

    const isInsideActiveTransformArea =
      rawPoint &&
      ((isTransformMode && isPointInsideBounds(rawPoint, transformSelectionBounds)) ||
        (isTransformPlusMode &&
          isPointInQuad(
            rawPoint,
            transformPlusQuad ?? createTransformQuadFromBounds(transformSelectionBounds),
          )));

    if (isInsideActiveTransformArea) {
      return;
    }

    if (isTransformMode || isTransformPlusMode) {
      onEditorModeChange?.('select');
      return;
    }

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

    if (dragRef.current.type === 'destroy') {
      if (
        distanceInSurface(dragRef.current.lastPoint, point, surfaceSize, viewportScale) <
        Math.max(1, dragRef.current.brushCells * 0.14)
      ) {
        return;
      }

      onDestroyShapes?.(dragRef.current.lastPoint, point, dragRef.current.brushCells);
      dragRef.current = {
        ...dragRef.current,
        lastPoint: point,
      };
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

      if (isTransformPlusMode && dragRef.current.baseQuad) {
        setTransformPlusState({
          selectionKey: dragRef.current.selectionKey,
          quad: moveTransformQuad(dragRef.current.baseQuad, delta),
        });
      }
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

const TRANSFORM_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const TRANSFORM_PLUS_HANDLES = ['nw', 'ne', 'se', 'sw'];

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

function readClientPoint(clientX, clientY, canvas, viewOffset = { x: 0, y: 0 }, viewScale = 1) {
  if (!canvas) {
    return null;
  }

  return readCanvasPoint(
    {
      clientX,
      clientY,
    },
    canvas,
    viewOffset,
    viewScale,
  );
}

function findHandleAtPoint(handles = [], point, surfaceSize, viewScale = 1) {
  const radius = getHandleHitRadius(viewScale);

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

function getHandleHitRadius(viewScale) {
  const safeScale = Math.max(Number(viewScale) || 1, Number.EPSILON);
  return clamp(18 / Math.sqrt(safeScale), 9, 22);
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

function hasSvgDragPayload(dataTransfer) {
  if (!dataTransfer) {
    return false;
  }

  const items = Array.from(dataTransfer.items ?? []);

  if (
    items.some(
      (item) =>
        item.kind === 'file' &&
        (String(item.type ?? '').toLowerCase() === 'image/svg+xml' ||
          String(item.type ?? '') === ''),
    )
  ) {
    return true;
  }

  return Array.from(dataTransfer.files ?? []).some((file) => isSvgFile(file));
}

function isSvgFile(file) {
  if (!file) {
    return false;
  }

  return (
    String(file.type ?? '').toLowerCase() === 'image/svg+xml' ||
    String(file.name ?? '').toLowerCase().endsWith('.svg')
  );
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

function areShapeIdListsEqual(left = [], right = []) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((shapeId, index) => shapeId === right[index]);
}

function getShapesBoundsFromList(shapes = []) {
  return shapes.reduce((bounds, shape) => {
    const shapeBounds = getShapeBounds(shape);

    if (!shapeBounds) {
      return bounds;
    }

    if (!bounds) {
      return { ...shapeBounds };
    }

    return {
      minX: Math.min(bounds.minX, shapeBounds.minX),
      maxX: Math.max(bounds.maxX, shapeBounds.maxX),
      minY: Math.min(bounds.minY, shapeBounds.minY),
      maxY: Math.max(bounds.maxY, shapeBounds.maxY),
    };
  }, null);
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

function getTransformOverlayRect(bounds, surfaceSize, viewOffset = { x: 0, y: 0 }, viewScale = 1) {
  if (!bounds) {
    return null;
  }

  const left = bounds.minX * surfaceSize.width * viewScale + viewOffset.x;
  const top = bounds.minY * surfaceSize.height * viewScale + viewOffset.y;
  const right = bounds.maxX * surfaceSize.width * viewScale + viewOffset.x;
  const bottom = bounds.maxY * surfaceSize.height * viewScale + viewOffset.y;

  return {
    bottom,
    centerX: (left + right) * 0.5,
    height: Math.max(1, bottom - top),
    left,
    right,
    top,
    width: Math.max(1, right - left),
  };
}

function getTransformPopoverStyle(overlay, surfaceSize) {
  const width = 260;
  const height = 82;
  const margin = 12;
  const maxLeft = Math.max(margin, surfaceSize.width - width - margin);
  const left = clamp(overlay.centerX - width * 0.5, margin, maxLeft);
  const preferredTop = overlay.bottom + 14;
  const top =
    preferredTop + height <= surfaceSize.height - margin
      ? preferredTop
      : Math.max(margin, overlay.top - height - 14);

  return {
    left: `${left}px`,
    top: `${top}px`,
  };
}

function getBoundsCenter(bounds) {
  if (!bounds) {
    return null;
  }

  return {
    x: (bounds.minX + bounds.maxX) * 0.5,
    y: (bounds.minY + bounds.maxY) * 0.5,
  };
}

function createTransformQuadFromBounds(bounds) {
  if (!bounds) {
    return null;
  }

  return {
    nw: { x: bounds.minX, y: bounds.minY },
    ne: { x: bounds.maxX, y: bounds.minY },
    se: { x: bounds.maxX, y: bounds.maxY },
    sw: { x: bounds.minX, y: bounds.maxY },
  };
}

function cloneTransformQuad(quad) {
  if (!quad) {
    return null;
  }

  return {
    nw: { ...quad.nw },
    ne: { ...quad.ne },
    se: { ...quad.se },
    sw: { ...quad.sw },
  };
}

function moveTransformQuad(quad, delta) {
  if (!quad || !delta) {
    return quad;
  }

  return {
    nw: { x: quad.nw.x + delta.x, y: quad.nw.y + delta.y },
    ne: { x: quad.ne.x + delta.x, y: quad.ne.y + delta.y },
    se: { x: quad.se.x + delta.x, y: quad.se.y + delta.y },
    sw: { x: quad.sw.x + delta.x, y: quad.sw.y + delta.y },
  };
}

function getTransformQuadOverlay(quad, surfaceSize, viewOffset = { x: 0, y: 0 }, viewScale = 1) {
  if (!quad) {
    return null;
  }

  return {
    nw: toScreenPoint(quad.nw, surfaceSize, viewOffset, viewScale),
    ne: toScreenPoint(quad.ne, surfaceSize, viewOffset, viewScale),
    se: toScreenPoint(quad.se, surfaceSize, viewOffset, viewScale),
    sw: toScreenPoint(quad.sw, surfaceSize, viewOffset, viewScale),
  };
}

function getTransformRectFromQuadOverlay(quadOverlay) {
  if (!quadOverlay) {
    return null;
  }

  const points = [quadOverlay.nw, quadOverlay.ne, quadOverlay.se, quadOverlay.sw];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    bottom,
    centerX: (left + right) * 0.5,
    height: Math.max(1, bottom - top),
    left,
    right,
    top,
    width: Math.max(1, right - left),
  };
}

function getTransformQuadPath(quadOverlay) {
  if (!quadOverlay) {
    return '';
  }

  return `M ${quadOverlay.nw.x} ${quadOverlay.nw.y} L ${quadOverlay.ne.x} ${quadOverlay.ne.y} L ${quadOverlay.se.x} ${quadOverlay.se.y} L ${quadOverlay.sw.x} ${quadOverlay.sw.y} Z`;
}

function getAngleBetweenPoints(centerPoint, point) {
  if (!centerPoint || !point) {
    return 0;
  }

  return Math.atan2(point.y - centerPoint.y, point.x - centerPoint.x);
}

function toScreenPoint(point, surfaceSize, viewOffset = { x: 0, y: 0 }, viewScale = 1) {
  return {
    x: point.x * surfaceSize.width * viewScale + viewOffset.x,
    y: point.y * surfaceSize.height * viewScale + viewOffset.y,
  };
}

function isPointInsideBounds(point, bounds) {
  if (!point || !bounds) {
    return false;
  }

  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function isPointInQuad(point, quad) {
  if (!point || !quad) {
    return false;
  }

  const points = [quad.nw, quad.ne, quad.se, quad.sw];
  let isInside = false;

  for (let index = 0, previousIndex = points.length - 1; index < points.length; previousIndex = index, index += 1) {
    const currentPoint = points[index];
    const previousPoint = points[previousIndex];
    const intersects =
      (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;

    if (intersects) {
      isInside = !isInside;
    }
  }

  return isInside;
}

function getDestroyPreviewRect(point, brushCells, surfaceSize, viewOffset = { x: 0, y: 0 }, viewScale = 1) {
  if (!point || !surfaceSize?.width || !surfaceSize?.height) {
    return null;
  }

  const size = Math.max(8, brushCells * GRID_STEP_PX * viewScale);
  const centerX = point.x * surfaceSize.width * viewScale + viewOffset.x;
  const centerY = point.y * surfaceSize.height * viewScale + viewOffset.y;

  return {
    left: centerX - size * 0.5,
    size,
    top: centerY - size * 0.5,
  };
}

function resizeBoundsFromHandle(bounds, point, handle, minWidth, minHeight) {
  const nextBounds = {
    ...bounds,
  };

  if (handle.includes('w')) {
    nextBounds.minX = Math.min(point.x, bounds.maxX - minWidth);
  }

  if (handle.includes('e')) {
    nextBounds.maxX = Math.max(point.x, bounds.minX + minWidth);
  }

  if (handle.includes('n')) {
    nextBounds.minY = Math.min(point.y, bounds.maxY - minHeight);
  }

  if (handle.includes('s')) {
    nextBounds.maxY = Math.max(point.y, bounds.minY + minHeight);
  }

  return nextBounds;
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
