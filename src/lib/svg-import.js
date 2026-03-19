import { svgPathProperties } from 'svg-path-properties';
import { GRID_STEP_PX } from './grid.js';
import { createShapeFromPolygons } from './shapes.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PATH_SAMPLE_STEP = 10;
const MIN_PATH_POINTS = 12;
const MAX_PATH_POINTS = 240;
const TARGET_IMPORT_HEIGHT_CELLS = 20;
const MAX_IMPORT_WIDTH_RATIO = 0.8;
const MAX_IMPORT_HEIGHT_RATIO = 0.82;

export async function importSvgFileAsShapes(file, options = {}) {
  if (!isSvgFile(file)) {
    return [];
  }

  const svgText = await file.text();
  return importSvgTextAsShapes(svgText, {
    ...options,
    fileName: file.name,
  });
}

export function isSvgFile(file) {
  if (!file) {
    return false;
  }

  const fileName = String(file.name ?? '').toLowerCase();
  const fileType = String(file.type ?? '').toLowerCase();
  return fileType === 'image/svg+xml' || fileName.endsWith('.svg');
}

export function importSvgTextAsShapes(svgText, options = {}) {
  if (typeof document === 'undefined' || typeof DOMParser === 'undefined') {
    return [];
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(svgText, 'image/svg+xml');

  if (documentNode.querySelector('parsererror')) {
    return [];
  }

  const parsedRoot = documentNode.documentElement;

  if (!parsedRoot || parsedRoot.nodeName.toLowerCase() !== 'svg') {
    return [];
  }

  const sandbox = document.createElement('div');
  sandbox.style.position = 'fixed';
  sandbox.style.left = '-100000px';
  sandbox.style.top = '-100000px';
  sandbox.style.width = '0';
  sandbox.style.height = '0';
  sandbox.style.overflow = 'hidden';
  sandbox.style.opacity = '0';
  sandbox.style.pointerEvents = 'none';

  const svgRoot = document.importNode(parsedRoot, true);
  svgRoot.setAttribute('xmlns', SVG_NS);
  svgRoot.style.overflow = 'visible';
  svgRoot.style.display = 'block';
  sandbox.appendChild(svgRoot);
  document.body.appendChild(sandbox);

  try {
    const elements = Array.from(
      svgRoot.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line'),
    );
    const rawShapes = elements
      .map((element, index) =>
        importSvgElement(element, svgRoot, {
          fileName: options.fileName,
          index,
        }),
      )
      .filter(Boolean);

    if (rawShapes.length === 0) {
      return [];
    }

    const rawBounds = getRawShapeBounds(rawShapes);

    if (!rawBounds) {
      return [];
    }

    const surfaceSize = normalizeSurfaceSize(options.surfaceSize);
    const dropPoint = normalizeDropPoint(options.dropPoint);
    const scale = getImportScale(rawBounds, surfaceSize);
    const rawCenter = {
      x: (rawBounds.minX + rawBounds.maxX) * 0.5,
      y: (rawBounds.minY + rawBounds.maxY) * 0.5,
    };

    return rawShapes
      .map((rawShape) =>
        createShapeFromPolygons(
          rawShape.polygons.map((polygon) =>
            polygon.map((ring) =>
              ring.map((point) => ({
                x: dropPoint.x + ((point.x - rawCenter.x) * scale) / surfaceSize.width,
                y: dropPoint.y + ((point.y - rawCenter.y) * scale) / surfaceSize.height,
              })),
            ),
          ),
          {
            name: rawShape.name,
          },
        ),
      )
      .filter(Boolean);
  } finally {
    sandbox.remove();
  }
}

function importSvgElement(element, svgRoot, context) {
  if (!isSvgElementImportable(element)) {
    return null;
  }

  const polygons = extractElementPolygons(element, svgRoot);

  if (polygons.length === 0) {
    return null;
  }

  return {
    name: resolveImportedShapeName(element, context.fileName, context.index),
    polygons,
  };
}

function extractElementPolygons(element, svgRoot) {
  const tagName = element.tagName.toLowerCase();

  if (tagName === 'polygon') {
    const ring = sanitizeRing(transformPoints(parseSvgPointList(element.getAttribute('points')), element.getCTM()));
    return ring.length >= 3 ? [[[...ring]]] : [];
  }

  if (tagName === 'polyline') {
    const points = transformPoints(parseSvgPointList(element.getAttribute('points')), element.getCTM());
    const closedRing = sanitizeRing(points);
    return isClosedPointLoop(points) && closedRing.length >= 3 ? [[[...closedRing]]] : [];
  }

  if (tagName === 'line') {
    return [];
  }

  if (tagName === 'rect') {
    const x = readNumberAttribute(element, 'x', 0);
    const y = readNumberAttribute(element, 'y', 0);
    const width = readNumberAttribute(element, 'width', 0);
    const height = readNumberAttribute(element, 'height', 0);
    const ring = sanitizeRing(
      transformPoints(
        [
          { x, y },
          { x: x + width, y },
          { x: x + width, y: y + height },
          { x, y: y + height },
        ],
        element.getCTM(),
      ),
    );
    return ring.length >= 3 ? [[[...ring]]] : [];
  }

  if (tagName === 'circle' || tagName === 'ellipse') {
    const cx = readNumberAttribute(element, 'cx', 0);
    const cy = readNumberAttribute(element, 'cy', 0);
    const rx = tagName === 'circle' ? readNumberAttribute(element, 'r', 0) : readNumberAttribute(element, 'rx', 0);
    const ry = tagName === 'circle' ? readNumberAttribute(element, 'r', 0) : readNumberAttribute(element, 'ry', 0);
    const ring = sanitizeRing(
      transformPoints(sampleEllipsePoints(cx, cy, rx, ry), element.getCTM()),
    );
    return ring.length >= 3 ? [[[...ring]]] : [];
  }

  if (tagName === 'path') {
    const ring = sanitizeRing(samplePathElement(element));
    return ring.length >= 3 ? [[[...ring]]] : [];
  }

  const pathData = elementToPathData(element);

  if (!pathData) {
    return [];
  }

  const ring = sanitizeRing(samplePathData(svgRoot, pathData, element.getCTM()));
  return ring.length >= 3 ? [[[...ring]]] : [];
}

function samplePathElement(pathElement) {
  const pathData = String(pathElement?.getAttribute('d') ?? '').trim();

  if (pathData) {
    return samplePathString(pathData, pathElement.getCTM());
  }

  try {
    const totalLength = pathElement.getTotalLength();
    const stepCount = clamp(
      Math.ceil(totalLength / PATH_SAMPLE_STEP),
      MIN_PATH_POINTS,
      MAX_PATH_POINTS,
    );
    const matrix = pathElement.getCTM();
    const sampledPoints = [];

    for (let index = 0; index < stepCount; index += 1) {
      const cursor = (index / stepCount) * totalLength;
      const point = pathElement.getPointAtLength(cursor);
      sampledPoints.push(transformPoint({ x: point.x, y: point.y }, matrix));
    }

    return sampledPoints;
  } catch {
    return [];
  }
}

function samplePathData(svgRoot, pathData, matrix) {
  return samplePathString(pathData, matrix);
}

function samplePathElementWithMatrix(pathElement, matrix) {
  try {
    const totalLength = pathElement.getTotalLength();
    const stepCount = clamp(
      Math.ceil(totalLength / PATH_SAMPLE_STEP),
      MIN_PATH_POINTS,
      MAX_PATH_POINTS,
    );
    const sampledPoints = [];

    for (let index = 0; index < stepCount; index += 1) {
      const cursor = (index / stepCount) * totalLength;
      const point = pathElement.getPointAtLength(cursor);
      sampledPoints.push(transformPoint({ x: point.x, y: point.y }, matrix));
    }

    return sampledPoints;
  } catch {
    return [];
  }
}

function samplePathString(pathData, matrix) {
  try {
    const properties = new svgPathProperties(pathData);
    const totalLength = properties.getTotalLength();
    const stepCount = clamp(
      Math.ceil(totalLength / PATH_SAMPLE_STEP),
      MIN_PATH_POINTS,
      MAX_PATH_POINTS,
    );
    const sampledPoints = [];

    for (let index = 0; index < stepCount; index += 1) {
      const cursor = (index / stepCount) * totalLength;
      const point = properties.getPointAtLength(cursor);
      sampledPoints.push(transformPoint(point, matrix));
    }

    return sampledPoints;
  } catch {
    return [];
  }
}

function elementToPathData(element) {
  const tagName = element.tagName.toLowerCase();

  if (tagName === 'rect') {
    const x = readNumberAttribute(element, 'x', 0);
    const y = readNumberAttribute(element, 'y', 0);
    const width = readNumberAttribute(element, 'width', 0);
    const height = readNumberAttribute(element, 'height', 0);
    return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
  }

  return '';
}

function sampleEllipsePoints(cx, cy, rx, ry) {
  const steps = clamp(Math.ceil((Math.PI * (rx + ry)) / PATH_SAMPLE_STEP), 16, 96);
  const points = [];

  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push({
      x: cx + Math.cos(angle) * rx,
      y: cy + Math.sin(angle) * ry,
    });
  }

  return points;
}

function parseSvgPointList(rawPoints) {
  const values = String(rawPoints ?? '')
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const points = [];

  for (let index = 0; index < values.length - 1; index += 2) {
    points.push({
      x: values[index],
      y: values[index + 1],
    });
  }

  return points;
}

function sanitizeRing(points) {
  const normalized = [];

  for (const point of points ?? []) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
      continue;
    }

    const nextPoint = {
      x: point.x,
      y: point.y,
    };
    const previousPoint = normalized[normalized.length - 1];

    if (previousPoint && getDistance(previousPoint, nextPoint) <= 0.5) {
      continue;
    }

    normalized.push(nextPoint);
  }

  if (normalized.length >= 2 && getDistance(normalized[0], normalized[normalized.length - 1]) <= 0.5) {
    normalized.pop();
  }

  return normalized;
}

function isClosedPointLoop(points) {
  if (!Array.isArray(points) || points.length < 3) {
    return false;
  }

  return getDistance(points[0], points[points.length - 1]) <= 1;
}

function transformPoints(points, matrix) {
  return (points ?? []).map((point) => transformPoint(point, matrix));
}

function transformPoint(point, matrix) {
  if (!matrix || typeof DOMPoint === 'undefined') {
    return { x: point.x, y: point.y };
  }

  const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
  return {
    x: transformed.x,
    y: transformed.y,
  };
}

function isSvgElementImportable(element) {
  if (!element) {
    return false;
  }

  if (element.closest('defs, clipPath, mask, marker, pattern, linearGradient, radialGradient, symbol')) {
    return false;
  }

  const display = String(element.getAttribute('display') ?? '').toLowerCase();
  const visibility = String(element.getAttribute('visibility') ?? '').toLowerCase();
  const opacityAttribute = element.getAttribute('opacity');
  const opacity =
    opacityAttribute == null || opacityAttribute === ''
      ? null
      : Number(opacityAttribute);

  if (
    display === 'none' ||
    visibility === 'hidden' ||
    (opacity != null && Number.isFinite(opacity) && opacity <= 0)
  ) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();

  if (tagName === 'path') {
    const d = String(element.getAttribute('d') ?? '').trim();
    return d.length > 0;
  }

  if (tagName === 'rect') {
    return readNumberAttribute(element, 'width', 0) > 0 && readNumberAttribute(element, 'height', 0) > 0;
  }

  if (tagName === 'circle') {
    return readNumberAttribute(element, 'r', 0) > 0;
  }

  if (tagName === 'ellipse') {
    return readNumberAttribute(element, 'rx', 0) > 0 && readNumberAttribute(element, 'ry', 0) > 0;
  }

  if (tagName === 'polygon' || tagName === 'polyline') {
    return parseSvgPointList(element.getAttribute('points')).length >= 3;
  }

  return false;
}

function resolveImportedShapeName(element, fileName, index) {
  const explicitName =
    element.getAttribute('id') ||
    element.getAttribute('data-name') ||
    element.getAttribute('inkscape:label') ||
    element.getAttribute('aria-label');

  if (explicitName) {
    return explicitName;
  }

  const baseName = String(fileName ?? 'Imported SVG').replace(/\.svg$/i, '').trim() || 'Imported SVG';
  return `${baseName} ${index + 1}`;
}

function getRawShapeBounds(rawShapes) {
  const points = rawShapes.flatMap((shape) =>
    shape.polygons.flatMap((polygon) => polygon.flatMap((ring) => ring)),
  );

  if (points.length === 0) {
    return null;
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

function getImportScale(bounds, surfaceSize) {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const targetHeight = Math.max(GRID_STEP_PX, GRID_STEP_PX * TARGET_IMPORT_HEIGHT_CELLS);
  const maxWidth = Math.max(1, surfaceSize.width * MAX_IMPORT_WIDTH_RATIO);
  const maxHeight = Math.max(1, surfaceSize.height * MAX_IMPORT_HEIGHT_RATIO);

  return Math.max(
    Number.EPSILON,
    Math.min(targetHeight / height, maxWidth / width, maxHeight / height),
  );
}

function normalizeSurfaceSize(surfaceSize) {
  const width = Math.max(1, Number(surfaceSize?.width) || 1200);
  const height = Math.max(1, Number(surfaceSize?.height) || 720);
  return { width, height };
}

function normalizeDropPoint(point) {
  if (!point) {
    return { x: 0.5, y: 0.5 };
  }

  return {
    x: Number.isFinite(point.x) ? point.x : 0.5,
    y: Number.isFinite(point.y) ? point.y : 0.5,
  };
}

function readNumberAttribute(element, attributeName, fallbackValue) {
  const rawValue = Number(element.getAttribute(attributeName));
  return Number.isFinite(rawValue) ? rawValue : fallbackValue;
}

function getDistance(leftPoint, rightPoint) {
  return Math.hypot(leftPoint.x - rightPoint.x, leftPoint.y - rightPoint.y);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
