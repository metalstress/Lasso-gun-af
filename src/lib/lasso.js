export const DRAW_MODE_DUAL = 'dual';
export const DRAW_MODE_CLASSIC = 'classic';
export const POINT_KIND_A = 'p1';
export const POINT_KIND_B = 'p2';
export const PHASE_AWAITING_A = 'awaitingP1';
export const PHASE_AWAITING_B = 'awaitingP2';

export function clear(input = DRAW_MODE_DUAL) {
  if (typeof input === 'string') {
    return createState(input);
  }

  const state = input ?? createState();

  if (state.mode === DRAW_MODE_CLASSIC) {
    return {
      ...state,
      classicPoints: [],
      pointer: null,
    };
  }

  return {
    ...state,
    pointsA: [],
    pointsB: [],
    phase: PHASE_AWAITING_A,
    pointer: null,
  };
}

export function setDrawMode(state, mode) {
  if (!mode || state.mode === mode) {
    return state;
  }

  return {
    ...state,
    mode,
    pointer: null,
  };
}

export function addPoint(state, kind, coords) {
  const nextPoint = normalizePoint(coords);

  if (!nextPoint) {
    return state;
  }

  if (state.mode === DRAW_MODE_CLASSIC) {
    return {
      ...state,
      classicPoints: [...state.classicPoints, nextPoint],
    };
  }

  if (kind === POINT_KIND_A) {
    if (state.phase !== PHASE_AWAITING_A) {
      return state;
    }

    return {
      ...state,
      pointsA: [...state.pointsA, nextPoint],
      phase: PHASE_AWAITING_B,
    };
  }

  if (kind === POINT_KIND_B) {
    if (state.phase !== PHASE_AWAITING_B) {
      return state;
    }

    return {
      ...state,
      pointsB: [...state.pointsB, nextPoint],
      phase: PHASE_AWAITING_A,
    };
  }

  return state;
}

export function undo(state) {
  if (state.mode === DRAW_MODE_CLASSIC) {
    if (state.classicPoints.length === 0) {
      return state;
    }

    return {
      ...state,
      classicPoints: state.classicPoints.slice(0, -1),
    };
  }

  const hasPendingPointA =
    state.phase === PHASE_AWAITING_B && state.pointsA.length === state.pointsB.length + 1;

  if (hasPendingPointA) {
    return {
      ...state,
      pointsA: state.pointsA.slice(0, -1),
      phase: PHASE_AWAITING_A,
    };
  }

  const hasCompletedPair =
    state.phase === PHASE_AWAITING_A &&
    state.pointsA.length > 0 &&
    state.pointsA.length === state.pointsB.length;

  if (hasCompletedPair) {
    return {
      ...state,
      pointsA: state.pointsA.slice(0, -1),
      pointsB: state.pointsB.slice(0, -1),
      phase: PHASE_AWAITING_A,
    };
  }

  return state;
}

export function buildFillPolygon(pointsA, pointsB) {
  if (pointsA.length < 2 || pointsB.length < 2 || pointsA.length !== pointsB.length) {
    return [];
  }

  return [...pointsA, ...[...pointsB].reverse()];
}

export function getClosedShapePoints(state) {
  if (state.mode === DRAW_MODE_CLASSIC) {
    return state.classicPoints.length >= 3 ? [...state.classicPoints] : [];
  }

  return buildFillPolygon(state.pointsA, state.pointsB);
}

export function hasClosedShape(state) {
  return getClosedShapePoints(state).length > 0;
}

export function hasAnyPoints(state) {
  if (state.mode === DRAW_MODE_CLASSIC) {
    return state.classicPoints.length > 0;
  }

  return state.pointsA.length > 0 || state.pointsB.length > 0;
}

export function getPreviewSegment(state, pointer = state.pointer) {
  const nextPointer = normalizePoint(pointer);

  if (!nextPointer) {
    return null;
  }

  if (state.mode === DRAW_MODE_CLASSIC) {
    if (state.classicPoints.length === 0) {
      return null;
    }

    return {
      kind: DRAW_MODE_CLASSIC,
      from: state.classicPoints[state.classicPoints.length - 1],
      to: nextPointer,
    };
  }

  const activePoints = state.phase === PHASE_AWAITING_A ? state.pointsA : state.pointsB;

  if (activePoints.length === 0) {
    return null;
  }

  return {
    kind: getExpectedKind(state),
    from: activePoints[activePoints.length - 1],
    to: nextPointer,
  };
}

export function getExpectedKind(state) {
  if (state.mode === DRAW_MODE_CLASSIC) {
    return null;
  }

  return state.phase === PHASE_AWAITING_A ? POINT_KIND_A : POINT_KIND_B;
}

function createState(mode = DRAW_MODE_DUAL) {
  return {
    mode,
    pointsA: [],
    pointsB: [],
    classicPoints: [],
    phase: PHASE_AWAITING_A,
    pointer: null,
    touchMode: POINT_KIND_A,
  };
}

function normalizePoint(point) {
  if (
    !point ||
    typeof point.x !== 'number' ||
    Number.isNaN(point.x) ||
    typeof point.y !== 'number' ||
    Number.isNaN(point.y)
  ) {
    return null;
  }

  return {
    x: Number(point.x),
    y: Number(point.y),
  };
}
