export const DEFAULT_CORNER_RADIUS = 18;
export const CORNER_TYPE_ROUND = 'round';
export const CORNER_TYPE_TRUE_RADIUS = 'true-radius';
export const CORNER_TYPE_CHAMFER = 'chamfer';
export const CORNER_TYPE_INVERSE_ROUND = 'inverse-round';
export const DEFAULT_CORNER_TYPE = CORNER_TYPE_ROUND;

export function traceRoundedPath(context, points, options = {}) {
  const {
    closed = false,
    radius = DEFAULT_CORNER_RADIUS,
    cornerType = DEFAULT_CORNER_TYPE,
  } = options;

  if (!points || points.length === 0) {
    return;
  }

  if (radius <= 0) {
    traceLinearPath(context, points, closed);
    return;
  }

  if (closed) {
    traceClosedCornerPath(context, points, radius, cornerType);
    return;
  }

  traceOpenCornerPath(context, points, radius, cornerType);
}

export function buildRoundedSvgPath(points, options = {}) {
  const {
    closed = false,
    radius = DEFAULT_CORNER_RADIUS,
    cornerType = DEFAULT_CORNER_TYPE,
  } = options;

  if (!points || points.length === 0) {
    return '';
  }

  if (radius <= 0) {
    return buildLinearSvgPath(points, closed);
  }

  if (closed) {
    return buildClosedCornerSvgPath(points, radius, cornerType);
  }

  return buildOpenCornerSvgPath(points, radius, cornerType);
}

function traceClosedCornerPath(context, points, radius, cornerType) {
  if (points.length < 3) {
    traceLinearPath(context, points, true);
    return;
  }

  const corners = points.map((point, index) =>
    getCornerData(
      points[(index - 1 + points.length) % points.length],
      point,
      points[(index + 1) % points.length],
      radius,
      cornerType,
    ),
  );

  context.moveTo(corners[0].end.x, corners[0].end.y);

  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(corners[index].start.x, corners[index].start.y);
    traceCanvasCorner(context, corners[index], points[index], points[(index + 1) % points.length], cornerType);
  }

  context.lineTo(corners[0].start.x, corners[0].start.y);
  traceCanvasCorner(context, corners[0], points[0], points[1], cornerType);
  context.closePath();
}

function traceOpenCornerPath(context, points, radius, cornerType) {
  context.moveTo(points[0].x, points[0].y);

  if (points.length === 1) {
    return;
  }

  if (points.length === 2) {
    context.lineTo(points[1].x, points[1].y);
    return;
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const corner = getCornerData(points[index - 1], points[index], points[index + 1], radius, cornerType);
    context.lineTo(corner.start.x, corner.start.y);
    traceCanvasCorner(context, corner, points[index], points[index + 1], cornerType);
  }

  const lastPoint = points[points.length - 1];
  context.lineTo(lastPoint.x, lastPoint.y);
}

function traceLinearPath(context, points, closed) {
  context.moveTo(points[0].x, points[0].y);

  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }

  if (closed) {
    context.closePath();
  }
}

function buildClosedCornerSvgPath(points, radius, cornerType) {
  if (points.length < 3) {
    return buildLinearSvgPath(points, true);
  }

  const corners = points.map((point, index) =>
    getCornerData(
      points[(index - 1 + points.length) % points.length],
      point,
      points[(index + 1) % points.length],
      radius,
      cornerType,
    ),
  );

  const commands = [`M ${formatPoint(corners[0].end)}`];

  for (let index = 1; index < points.length; index += 1) {
    commands.push(`L ${formatPoint(corners[index].start)}`);
    commands.push(buildSvgCornerCommand(corners[index], points[index], cornerType));
  }

  commands.push(`L ${formatPoint(corners[0].start)}`);
  commands.push(buildSvgCornerCommand(corners[0], points[0], cornerType));
  commands.push('Z');
  return commands.join(' ');
}

function buildOpenCornerSvgPath(points, radius, cornerType) {
  const commands = [`M ${formatPoint(points[0])}`];

  if (points.length === 1) {
    return commands.join(' ');
  }

  if (points.length === 2) {
    commands.push(`L ${formatPoint(points[1])}`);
    return commands.join(' ');
  }

  for (let index = 1; index < points.length - 1; index += 1) {
    const corner = getCornerData(points[index - 1], points[index], points[index + 1], radius, cornerType);
    commands.push(`L ${formatPoint(corner.start)}`);
    commands.push(buildSvgCornerCommand(corner, points[index], cornerType));
  }

  commands.push(`L ${formatPoint(points[points.length - 1])}`);
  return commands.join(' ');
}

function buildLinearSvgPath(points, closed) {
  const commands = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${formatPoint(point)}`);

  if (closed) {
    commands.push('Z');
  }

  return commands.join(' ');
}

function traceCanvasCorner(context, corner, point, nextPoint, cornerType) {
  if (cornerType === CORNER_TYPE_CHAMFER) {
    context.lineTo(corner.end.x, corner.end.y);
    return;
  }

  if (cornerType === CORNER_TYPE_TRUE_RADIUS) {
    context.arcTo(point.x, point.y, nextPoint.x, nextPoint.y, corner.arcRadius);
    return;
  }

  if (cornerType === CORNER_TYPE_INVERSE_ROUND) {
    context.quadraticCurveTo(
      corner.inverseControl.x,
      corner.inverseControl.y,
      corner.end.x,
      corner.end.y,
    );
    return;
  }

  context.quadraticCurveTo(point.x, point.y, corner.end.x, corner.end.y);
}

function buildSvgCornerCommand(corner, point, cornerType) {
  if (cornerType === CORNER_TYPE_CHAMFER) {
    return `L ${formatPoint(corner.end)}`;
  }

  if (cornerType === CORNER_TYPE_TRUE_RADIUS) {
    return `A ${formatNumber(corner.arcRadius)} ${formatNumber(corner.arcRadius)} 0 0 ${corner.sweepFlag} ${formatPoint(corner.end)}`;
  }

  if (cornerType === CORNER_TYPE_INVERSE_ROUND) {
    return `Q ${formatPoint(corner.inverseControl)} ${formatPoint(corner.end)}`;
  }

  return `Q ${formatPoint(point)} ${formatPoint(corner.end)}`;
}

function getCornerData(previousPoint, point, nextPoint, radius, cornerType) {
  const incoming = {
    x: previousPoint.x - point.x,
    y: previousPoint.y - point.y,
  };
  const outgoing = {
    x: nextPoint.x - point.x,
    y: nextPoint.y - point.y,
  };
  const incomingLength = Math.hypot(incoming.x, incoming.y);
  const outgoingLength = Math.hypot(outgoing.x, outgoing.y);

  if (incomingLength === 0 || outgoingLength === 0) {
    return {
      start: point,
      end: point,
      arcRadius: 0,
      sweepFlag: 0,
      inverseControl: point,
    };
  }

  const incomingUnit = {
    x: incoming.x / incomingLength,
    y: incoming.y / incomingLength,
  };
  const outgoingUnit = {
    x: outgoing.x / outgoingLength,
    y: outgoing.y / outgoingLength,
  };
  const angle = Math.acos(
    clamp(incomingUnit.x * outgoingUnit.x + incomingUnit.y * outgoingUnit.y, -1, 1),
  );
  const maxOffset = Math.min(incomingLength * 0.5, outgoingLength * 0.5);
  const tangentDistance =
    cornerType === CORNER_TYPE_TRUE_RADIUS
      ? radius / Math.max(Math.tan(angle * 0.5), Number.EPSILON)
      : radius;
  const offset = Math.min(maxOffset, Math.max(0, tangentDistance));
  const arcRadius =
    cornerType === CORNER_TYPE_TRUE_RADIUS
      ? offset * Math.max(Math.tan(angle * 0.5), Number.EPSILON)
      : offset;
  const bisector = normalizeVector({
    x: incomingUnit.x + outgoingUnit.x,
    y: incomingUnit.y + outgoingUnit.y,
  });
  const inverseControl = bisector
    ? {
        x: point.x - bisector.x * offset * 0.9,
        y: point.y - bisector.y * offset * 0.9,
      }
    : point;
  const cross = incomingUnit.x * outgoingUnit.y - incomingUnit.y * outgoingUnit.x;

  return {
    start: {
      x: point.x + incomingUnit.x * offset,
      y: point.y + incomingUnit.y * offset,
    },
    end: {
      x: point.x + outgoingUnit.x * offset,
      y: point.y + outgoingUnit.y * offset,
    },
    arcRadius: Math.max(0, arcRadius),
    sweepFlag: cross < 0 ? 1 : 0,
    inverseControl,
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y);

  if (!length) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatPoint(point) {
  return `${formatNumber(point.x)} ${formatNumber(point.y)}`;
}

function formatNumber(value) {
  return Number(value.toFixed(2));
}
