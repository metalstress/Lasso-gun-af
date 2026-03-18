import {
  DRAW_MODE_CLASSIC,
  getClosedShapePoints,
  getExpectedKind,
  getPreviewSegment,
} from './lasso.js';
import { GRID_MAJOR_STEP_PX, GRID_STEP_PX } from './grid.js';
import {
  CORNER_TYPE_CHAMFER,
  CORNER_TYPE_INVERSE_ROUND,
  CORNER_TYPE_ROUND,
  CORNER_TYPE_TRUE_RADIUS,
  DEFAULT_CORNER_RADIUS,
  DEFAULT_CORNER_TYPE,
  traceRoundedPath,
} from './rounded-path.js';
import { buildSvgPathFromShape, toSurfacePolygons } from './shapes.js';

export const FILL_MODE_FILL = 'fill';
export const FILL_MODE_OUTLINE = 'outline';
export const EXPORT_FORMAT_PNG = 'png';
export const EXPORT_FORMAT_SVG = 'svg';
export const DEFAULT_APPEARANCE = Object.freeze({
  background: '#111111',
  stroke: '#ffffff',
  fill: '#ffffff',
  fillOpacity: 10,
  fillMode: FILL_MODE_FILL,
  cornerRadius: DEFAULT_CORNER_RADIUS,
  cornerType: DEFAULT_CORNER_TYPE,
});

export function drawLassoScene(context, surfaceSize, scene, appearance = DEFAULT_APPEARANCE, options = {}) {
  const style = resolveAppearance(appearance);
  const isDrawMode = scene.editorMode === 'draw';
  const viewOffset = normalizeViewOffset(options.viewOffset);
  const viewScale = normalizeViewScale(options.viewScale);
  const renderOptions = {
    showBackground: true,
    showGrid: true,
    showHandles: true,
    showPreview: true,
    showReticle: true,
    ...options,
  };
  const { width, height } = surfaceSize;
  const draftState = scene.draftState;
  const preview = renderOptions.showPreview && isDrawMode ? getPreviewSegment(draftState) : null;

  context.save();
  context.clearRect(0, 0, width, height);

  if (renderOptions.showBackground) {
    drawBackdropFill(context, width, height, style);
  }

  context.save();
  context.translate(viewOffset.x, viewOffset.y);
  context.scale(viewScale, viewScale);

  if (renderOptions.showGrid) {
    drawBackdropGrid(context, width, height, style, viewOffset, viewScale);
  }

  drawCommittedShapes(context, surfaceSize, scene, style);
  drawDraftState(
    context,
    surfaceSize,
    draftState,
    style,
    {
      ...renderOptions,
      showHandles: renderOptions.showHandles && isDrawMode,
      showPreview: renderOptions.showPreview && isDrawMode,
      showReticle: renderOptions.showReticle && isDrawMode,
    },
    preview,
  );

  context.restore();

  context.restore();
}

export function exportSceneAsPng({
  appearance = DEFAULT_APPEARANCE,
  fileName = 'lasso-scene.png',
  height = 720,
  shapes,
  transparentBackground = false,
  width = 1200,
}) {
  if (typeof document === 'undefined' || !shapes || shapes.length === 0) {
    return;
  }

  const surfaceSize = normalizeSurfaceSize(width, height);
  const exportScale = 2;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  canvas.width = surfaceSize.width * exportScale;
  canvas.height = surfaceSize.height * exportScale;
  context.setTransform(exportScale, 0, 0, exportScale, 0, 0);

  drawLassoScene(
    context,
    surfaceSize,
    {
      draftState: emptyDraftState(),
      shapes,
      selectedShapeIds: [],
      editHandles: [],
    },
    appearance,
    {
      showBackground: !transparentBackground,
      showGrid: false,
      showHandles: false,
      showPreview: false,
      showReticle: false,
    },
  );

  triggerDownload(canvas.toDataURL('image/png'), fileName);
}

export function exportSceneAsSvg({
  appearance = DEFAULT_APPEARANCE,
  fileName = 'lasso-scene.svg',
  height = 720,
  shapes,
  transparentBackground = false,
  width = 1200,
}) {
  if (typeof document === 'undefined' || !shapes || shapes.length === 0) {
    return;
  }

  const surfaceSize = normalizeSurfaceSize(width, height);
  const pathMarkup = shapes
    .map((shape) => buildSvgMarkupForShape(shape, surfaceSize, appearance))
    .filter(Boolean)
    .join('');

  if (!pathMarkup) {
    return;
  }

  const backgroundRect = transparentBackground
    ? ''
    : `<rect width="${surfaceSize.width}" height="${surfaceSize.height}" fill="${escapeXml(appearance.background)}" />`;

  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${surfaceSize.width}" height="${surfaceSize.height}" viewBox="0 0 ${surfaceSize.width} ${surfaceSize.height}" fill="none">`,
    backgroundRect,
    pathMarkup,
    '</svg>',
  ]
    .filter(Boolean)
    .join('');

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  triggerDownload(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function drawCommittedShapes(context, surfaceSize, scene, style) {
  const selectedIds = new Set(scene.selectedShapeIds ?? []);

  scene.shapes.forEach((shape) => {
    const surfacePolygons = toSurfacePolygons(shape, surfaceSize);
    const isSelected = selectedIds.has(shape.id);

    if (style.fillMode === FILL_MODE_FILL) {
      drawMultiPolygonFill(context, surfacePolygons, style, isSelected ? 1 : 0.82);
    }

    drawMultiPolygonContour(context, surfacePolygons, style, isSelected);
  });

  (scene.editHandles ?? []).forEach((handle) => {
    drawHandleNode(context, toSurfacePoint(handle.point, surfaceSize), style, true, true, handle.isSelected);
  });

  if (scene.insertHandle?.point) {
    drawInsertHandle(context, toSurfacePoint(scene.insertHandle.point, surfaceSize), style);
  }

  if (scene.selectionLasso?.length >= 2) {
    drawSelectionLasso(
      context,
      scene.selectionLasso.map((point) => toSurfacePoint(point, surfaceSize)),
      style,
    );
  }
}

function drawDraftState(context, surfaceSize, state, style, renderOptions, preview) {
  if (!state) {
    return;
  }

  if (state.mode === DRAW_MODE_CLASSIC) {
    drawClassicDraft(context, surfaceSize, state, style, renderOptions, preview);
    return;
  }

  drawDualDraft(context, surfaceSize, state, style, renderOptions, preview);
}

function drawDualDraft(context, surfaceSize, state, style, renderOptions, preview) {
  const pointsA = state.pointsA.map((point) => toSurfacePoint(point, surfaceSize));
  const pointsB = state.pointsB.map((point) => toSurfacePoint(point, surfaceSize));
  const closedShape = getClosedShapePoints(state).map((point) => toSurfacePoint(point, surfaceSize));
  const expectedKind = renderOptions.showHandles || renderOptions.showReticle ? getExpectedKind(state) : null;

  if (closedShape.length > 0 && style.fillMode === FILL_MODE_FILL) {
    drawRingFill(context, closedShape, style, 0.7);
  }

  if (closedShape.length > 0) {
    drawRingContour(context, closedShape, style, false, 0.92);
  }

  drawPolyline(context, pointsA, style, 0.88);
  drawPolyline(context, pointsB, style, 0.88);

  if (preview) {
    drawPreview(context, preview, surfaceSize, style);
  }

  if (renderOptions.showHandles) {
    drawNodes(context, pointsA, expectedKind === 'p1', style, renderOptions.showBackground);
    drawNodes(context, pointsB, expectedKind === 'p2', style, renderOptions.showBackground);
  }

  if (renderOptions.showReticle && state.pointer) {
    drawReticle(context, toSurfacePoint(state.pointer, surfaceSize), style);
  }
}

function drawClassicDraft(context, surfaceSize, state, style, renderOptions, preview) {
  const classicPoints = state.classicPoints.map((point) => toSurfacePoint(point, surfaceSize));
  const closedShape = getClosedShapePoints(state).map((point) => toSurfacePoint(point, surfaceSize));

  if (closedShape.length > 0 && style.fillMode === FILL_MODE_FILL) {
    drawRingFill(context, closedShape, style, 0.7);
  }

  if (closedShape.length > 0) {
    drawRingContour(context, closedShape, style, false, 0.92);
  } else {
    drawPolyline(context, classicPoints, style, 0.9);
  }

  if (preview) {
    drawPreview(context, preview, surfaceSize, style);
  }

  if (renderOptions.showHandles) {
    drawNodes(context, classicPoints, classicPoints.length > 0, style, renderOptions.showBackground);
  }

  if (renderOptions.showReticle && state.pointer) {
    drawReticle(context, toSurfacePoint(state.pointer, surfaceSize), style);
  }
}

function drawBackdropFill(context, width, height, style) {
  context.save();
  context.fillStyle = style.background;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function drawBackdropGrid(context, width, height, style, viewOffset, viewScale) {
  const safeScale = normalizeViewScale(viewScale);
  const worldMinX = -viewOffset.x / safeScale;
  const worldMaxX = (width - viewOffset.x) / safeScale;
  const worldMinY = -viewOffset.y / safeScale;
  const worldMaxY = (height - viewOffset.y) / safeScale;
  const crispOffset = 0.5 / safeScale;

  drawGridSeries(context, {
    crispOffset,
    lineWidth: 1 / safeScale,
    maxX: worldMaxX,
    maxY: worldMaxY,
    minX: worldMinX,
    minY: worldMinY,
    step: GRID_STEP_PX,
    strokeStyle: style.gridMinor,
  });

  drawGridSeries(context, {
    crispOffset,
    lineWidth: 1 / safeScale,
    maxX: worldMaxX,
    maxY: worldMaxY,
    minX: worldMinX,
    minY: worldMinY,
    step: GRID_MAJOR_STEP_PX,
    strokeStyle: style.gridMajor,
  });
}

function drawGridSeries(context, { crispOffset, lineWidth, maxX, maxY, minX, minY, step, strokeStyle }) {
  const startX = Math.floor(minX / step) * step;
  const startY = Math.floor(minY / step) * step;

  context.save();
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.beginPath();

  for (let x = startX; x <= maxX; x += step) {
    context.moveTo(x + crispOffset, minY);
    context.lineTo(x + crispOffset, maxY);
  }

  for (let y = startY; y <= maxY; y += step) {
    context.moveTo(minX, y + crispOffset);
    context.lineTo(maxX, y + crispOffset);
  }

  context.stroke();
  context.restore();
}

function drawMultiPolygonFill(context, polygons, style, alphaMultiplier = 1) {
  context.save();
  context.beginPath();
  polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      drawPath(context, ring, true, style);
      context.closePath();
    });
  });
  context.fillStyle = withAlpha(style.fill, alphaMultiplier);
  context.fill('evenodd');
  context.strokeStyle = withAlpha(style.strokeSoft, alphaMultiplier);
  context.lineWidth = 1.25;
  context.stroke();
  context.restore();
}

function drawMultiPolygonContour(context, polygons, style, isSelected) {
  context.save();
  context.beginPath();
  polygons.forEach((polygon) => {
    polygon.forEach((ring) => {
      drawPath(context, ring, true, style);
      context.closePath();
    });
  });
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = isSelected ? 3.2 : 2.4;
  context.strokeStyle = style.stroke;
  context.shadowBlur = isSelected ? 24 : 18;
  context.shadowColor = style.lineGlow;
  if (isSelected) {
    context.setLineDash([14, 8]);
  }
  context.stroke();
  context.restore();
}

function drawRingFill(context, ring, style, alphaMultiplier = 1) {
  context.save();
  context.beginPath();
  drawPath(context, ring, true, style);
  context.closePath();
  context.fillStyle = withAlpha(style.fill, alphaMultiplier);
  context.fill();
  context.restore();
}

function drawRingContour(context, ring, style, isSelected, alphaMultiplier = 1) {
  context.save();
  context.beginPath();
  drawPath(context, ring, true, style);
  context.closePath();
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = isSelected ? 3.2 : 2.4;
  context.strokeStyle = withAlpha(style.stroke, alphaMultiplier);
  context.shadowBlur = isSelected ? 24 : 18;
  context.shadowColor = style.lineGlow;
  context.stroke();
  context.restore();
}

function drawPolyline(context, points, style, alphaMultiplier = 1) {
  if (points.length < 2) {
    return;
  }

  context.save();
  context.beginPath();
  drawPath(context, points, false, style);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = 2.4;
  context.strokeStyle = withAlpha(style.stroke, alphaMultiplier);
  context.shadowBlur = 18;
  context.shadowColor = style.lineGlow;
  context.stroke();
  context.restore();
}

function drawPreview(context, preview, surfaceSize, style) {
  const from = toSurfacePoint(preview.from, surfaceSize);
  const to = toSurfacePoint(preview.to, surfaceSize);

  context.save();
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.setLineDash([10, 10]);
  context.lineWidth = 1.5;
  context.strokeStyle = style.stroke;
  context.globalAlpha = 0.8;
  context.stroke();
  context.restore();
}

function drawNodes(context, points, highlightTail, style, showBackground) {
  points.forEach((point, index) => {
    drawHandleNode(
      context,
      point,
      style,
      highlightTail && index === points.length - 1,
      showBackground,
      false,
    );
  });
}

function drawHandleNode(context, point, style, highlight = false, showBackground = true, isSelected = false) {
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, isSelected ? 7.2 : highlight ? 6.5 : 5, 0, Math.PI * 2);
  context.fillStyle = isSelected
    ? 'rgba(192, 255, 104, 0.88)'
    : showBackground
      ? style.panel
      : 'rgba(0, 0, 0, 0)';
  context.shadowBlur = isSelected ? 24 : highlight ? 20 : 12;
  context.shadowColor = isSelected ? 'rgba(192, 255, 104, 0.34)' : style.lineGlow;
  context.fill();
  context.lineWidth = isSelected ? 2.8 : highlight ? 2.4 : 1.8;
  context.strokeStyle = isSelected ? '#c0ff68' : style.stroke;
  context.stroke();
  context.restore();
}

function drawInsertHandle(context, point, style) {
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, 9, 0, Math.PI * 2);
  context.fillStyle = style.panel;
  context.shadowBlur = 18;
  context.shadowColor = style.lineGlow;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = '#c0ff68';
  context.stroke();
  context.beginPath();
  context.moveTo(point.x - 4, point.y);
  context.lineTo(point.x + 4, point.y);
  context.moveTo(point.x, point.y - 4);
  context.lineTo(point.x, point.y + 4);
  context.strokeStyle = '#c0ff68';
  context.lineCap = 'round';
  context.stroke();
  context.restore();
}

function drawSelectionLasso(context, points, style) {
  if (points.length < 2) {
    return;
  }

  context.save();
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => {
    context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.setLineDash([8, 8]);
  context.lineWidth = 1.6;
  context.strokeStyle = withAlpha(style.stroke, 0.86);
  context.fillStyle = withAlpha(style.strokeSoft, 0.55);
  context.stroke();
  context.fill();
  context.restore();
}

function drawReticle(context, point, style) {
  context.save();
  context.strokeStyle = style.stroke;
  context.lineWidth = 1;
  context.globalAlpha = 0.65;
  context.beginPath();
  context.arc(point.x, point.y, 12, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.moveTo(point.x - 18, point.y);
  context.lineTo(point.x + 18, point.y);
  context.moveTo(point.x, point.y - 18);
  context.lineTo(point.x, point.y + 18);
  context.stroke();
  context.restore();
}

function buildSvgMarkupForShape(shape, surfaceSize, appearance) {
  const cornerRadius = normalizeCornerRadius(appearance.cornerRadius ?? DEFAULT_APPEARANCE.cornerRadius);
  const cornerType = normalizeCornerType(appearance.cornerType ?? DEFAULT_APPEARANCE.cornerType);
  const pathData = buildSvgPathFromShape(shape, surfaceSize, {
    cornerRadius,
    cornerType,
  });

  if (!pathData) {
    return '';
  }

  const fillColor = appearance.fillMode === FILL_MODE_OUTLINE ? 'none' : appearance.fill;
  const fillOpacity =
    appearance.fillMode === FILL_MODE_OUTLINE ? 0 : clamp(appearance.fillOpacity / 100, 0, 1);

  return `<path d="${pathData}" fill="${escapeXml(fillColor)}" fill-opacity="${fillOpacity}" fill-rule="evenodd" stroke="${escapeXml(appearance.stroke)}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />`;
}

function drawPath(context, points, closed, style) {
  if (points.length === 0) {
    return;
  }

  traceRoundedPath(context, points, {
    closed,
    cornerType: style?.cornerType ?? DEFAULT_CORNER_TYPE,
    radius: style?.cornerRadius ?? DEFAULT_CORNER_RADIUS,
  });
}

function emptyDraftState() {
  return {
    mode: DRAW_MODE_CLASSIC,
    pointsA: [],
    pointsB: [],
    classicPoints: [],
    phase: null,
    pointer: null,
    touchMode: null,
  };
}

function normalizeSurfaceSize(width, height) {
  return {
    width: Math.max(512, Math.round(width || 1200)),
    height: Math.max(384, Math.round(height || 720)),
  };
}

function resolveAppearance(appearance) {
  const nextAppearance = {
    ...DEFAULT_APPEARANCE,
    ...appearance,
  };

  return {
    background: nextAppearance.background,
    panel: nextAppearance.background,
    stroke: nextAppearance.stroke,
    fill: toRgba(nextAppearance.fill, clamp(nextAppearance.fillOpacity / 100, 0, 1)),
    fillMode: nextAppearance.fillMode,
    cornerRadius: normalizeCornerRadius(nextAppearance.cornerRadius),
    cornerType: normalizeCornerType(nextAppearance.cornerType),
    gridMinor: toRgba(nextAppearance.stroke, 0.035),
    gridMajor: toRgba(nextAppearance.stroke, 0.08),
    lineGlow: toRgba(nextAppearance.stroke, 0.16),
    strokeSoft: toRgba(nextAppearance.stroke, 0.1),
  };
}

function toSurfacePoint(point, surfaceSize) {
  return {
    x: point.x * surfaceSize.width,
    y: point.y * surfaceSize.height,
  };
}

function toRgba(hexColor, opacity) {
  const cleaned = hexColor.replace('#', '');
  const normalized =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((value) => `${value}${value}`)
          .join('')
      : cleaned;

  if (!/^[\da-fA-F]{6}$/.test(normalized)) {
    return `rgba(255, 255, 255, ${opacity})`;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

function withAlpha(rgbaColor, multiplier) {
  return rgbaColor.replace(/rgba\(([^,]+),([^,]+),([^,]+),([^)]+)\)/, (_, r, g, b, a) => {
    return `rgba(${r},${g},${b},${clamp(Number(a) * multiplier, 0, 1)})`;
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function triggerDownload(url, fileName) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCornerRadius(value) {
  const nextValue = Number(value);

  if (!Number.isFinite(nextValue)) {
    return DEFAULT_CORNER_RADIUS;
  }

  return Math.max(0, nextValue);
}

function normalizeCornerType(value) {
  if (
    value === CORNER_TYPE_ROUND ||
    value === CORNER_TYPE_TRUE_RADIUS ||
    value === CORNER_TYPE_CHAMFER ||
    value === CORNER_TYPE_INVERSE_ROUND
  ) {
    return value;
  }

  return DEFAULT_CORNER_TYPE;
}

function normalizeViewOffset(viewOffset) {
  return {
    x: Number.isFinite(Number(viewOffset?.x)) ? Number(viewOffset.x) : 0,
    y: Number.isFinite(Number(viewOffset?.y)) ? Number(viewOffset.y) : 0,
  };
}

function normalizeViewScale(viewScale) {
  const nextScale = Number(viewScale);

  if (!Number.isFinite(nextScale) || nextScale <= 0) {
    return 1;
  }

  return nextScale;
}
