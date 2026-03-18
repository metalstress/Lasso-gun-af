import { Fragment, useEffect, useRef, useState } from 'react';
import afCatLogo from './assets/af-cat.svg';
import DrawingCanvas from './components/DrawingCanvas.jsx';
import ExportOverlay from './components/ExportOverlay.jsx';
import LayersSidebar from './components/LayersSidebar.jsx';
import PanelMark from './components/PanelMark.jsx';
import { CURRENT_BUILD_LABEL } from './lib/build-info.js';
import { GRID_STEP_PX, snapPointToGrid } from './lib/grid.js';
import {
  CORNER_TYPE_CHAMFER,
  CORNER_TYPE_INVERSE_ROUND,
  CORNER_TYPE_ROUND,
  CORNER_TYPE_TRUE_RADIUS,
} from './lib/rounded-path.js';
import {
  DRAW_MODE_CLASSIC,
  DRAW_MODE_DUAL,
  POINT_KIND_A,
  POINT_KIND_B,
  addPoint,
  clear,
  getExpectedKind,
  hasAnyPoints,
  setDrawMode,
  undo,
} from './lib/lasso.js';
import {
  BOOLEAN_INTERSECT,
  BOOLEAN_SUBTRACT,
  BOOLEAN_UNION,
  BOOLEAN_XOR,
  createHandleId,
  createShapeFromDraft,
  createShapeFromPolygons,
  duplicateShapes,
  flattenShapes,
  getSceneShapes,
  getShapeById,
  insertShapeVertex,
  isShapeEditable,
  listEditableHandles,
  moveShape,
  moveShapeVertices,
  runBooleanOperation,
  ungroupShapes,
  updateShapeVertex,
} from './lib/shapes.js';
import {
  DEFAULT_APPEARANCE,
  EXPORT_FORMAT_PNG,
  EXPORT_FORMAT_SVG,
  FILL_MODE_FILL,
  FILL_MODE_OUTLINE,
  exportSceneAsPng,
  exportSceneAsSvg,
} from './lib/rendering.js';

const TOUCH_QUERY = '(pointer: coarse)';
const MOBILE_LAYOUT_QUERY = '(max-width: 740px)';
const DEFAULT_SURFACE_SIZE = { width: 1200, height: 720 };
const EDITOR_MODE_DRAW = 'draw';
const EDITOR_MODE_SELECT = 'select';
const EDITOR_MODE_LASSO_SELECT = 'lasso-select';
const EDITOR_MODE_EDIT = 'edit';
const THEME_MONO = 'mono';
const THEME_GARFIELD = 'garfield';
const CLOSED_VIEWPORT_CONTEXT_MENU = { isOpen: false, x: 0, y: 0 };
const CLOSED_TOOLBAR_TOOLTIP = { isOpen: false, x: 0, y: 0, label: '', hotkey: '' };
const TOOLTIP_DELAY_MS = 500;
const HISTORY_LIMIT = 100;
const PRESET_SHAPE_SQUARE = 'square';
const PRESET_SHAPE_STAR = 'star';
const PRESET_SHAPE_POLYGON = 'polygon';
const DEFAULT_POLYGON_SIDES = 3;
const MAX_POLYGON_SIDES = 32;
const PRESET_SHAPE_OPTIONS = [
  { value: PRESET_SHAPE_SQUARE, label: 'Square' },
  { value: PRESET_SHAPE_STAR, label: 'Star' },
  { value: PRESET_SHAPE_POLYGON, label: 'Polygon' },
];
const CORNER_TYPE_OPTIONS = [
  { value: CORNER_TYPE_ROUND, label: 'Round' },
  { value: CORNER_TYPE_TRUE_RADIUS, label: 'True Radius' },
  { value: CORNER_TYPE_CHAMFER, label: 'Chamfer' },
  { value: CORNER_TYPE_INVERSE_ROUND, label: 'Inverse Round' },
];

function App() {
  const [drawingState, setDrawingState] = useState(() => clear());
  const [showTouchControls, setShowTouchControls] = useState(false);
  const [appearance, setAppearance] = useState(() => DEFAULT_APPEARANCE);
  const [surfaceSize, setSurfaceSize] = useState(DEFAULT_SURFACE_SIZE);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [shapes, setShapes] = useState([]);
  const [selectedShapeIds, setSelectedShapeIds] = useState([]);
  const [selectedHandleIds, setSelectedHandleIds] = useState([]);
  const [editorMode, setEditorMode] = useState(EDITOR_MODE_DRAW);
  const [theme, setTheme] = useState(THEME_MONO);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [shapePresetKind, setShapePresetKind] = useState(PRESET_SHAPE_SQUARE);
  const [polygonSides, setPolygonSides] = useState(DEFAULT_POLYGON_SIDES);
  const [isShapePresetMenuOpen, setIsShapePresetMenuOpen] = useState(false);
  const [shapeClipboard, setShapeClipboard] = useState({ shapes: [], pasteCount: 0 });
  const [viewportContextMenu, setViewportContextMenu] = useState(CLOSED_VIEWPORT_CONTEXT_MENU);
  const [toolbarTooltip, setToolbarTooltip] = useState(CLOSED_TOOLBAR_TOOLTIP);
  const [dockFrame, setDockFrame] = useState({ left: 18, width: 0, bottom: 18 });
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(null);
  const historyRef = useRef({ past: [], future: [] });
  const snapshotRef = useRef(null);
  const gestureSnapshotRef = useRef(null);
  const gestureHasChangesRef = useRef(false);
  const contextMenuRef = useRef(null);
  const shapePresetRef = useRef(null);
  const toolbarTooltipTimerRef = useRef(null);
  const dockToolbarRef = useRef(null);
  const workspaceRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const touchQuery = window.matchMedia(TOUCH_QUERY);
    const mobileLayoutQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const syncTouchControls = () => {
      setShowTouchControls(touchQuery.matches || window.innerWidth < 920);
      setIsMobileLayout(mobileLayoutQuery.matches);
    };

    syncTouchControls();
    touchQuery.addEventListener?.('change', syncTouchControls);
    mobileLayoutQuery.addEventListener?.('change', syncTouchControls);
    window.addEventListener('resize', syncTouchControls);

    return () => {
      touchQuery.removeEventListener?.('change', syncTouchControls);
      mobileLayoutQuery.removeEventListener?.('change', syncTouchControls);
      window.removeEventListener('resize', syncTouchControls);
    };
  }, []);

  useEffect(() => {
    if (!isMobileLayout && mobilePanel) {
      setMobilePanel(null);
    }
  }, [isMobileLayout, mobilePanel]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const workspace = workspaceRef.current;

    if (!workspace) {
      return undefined;
    }

    const syncDockFrame = () => {
      const viewportFrame = workspace.querySelector('.canvas-frame') ?? workspace;
      const bounds = viewportFrame.getBoundingClientRect();
      const inset = window.innerWidth <= 640 ? 12 : 18;
      const nextLeft = Math.max(inset, Math.round(bounds.left + inset));
      const nextRight = Math.min(window.innerWidth - inset, Math.round(bounds.right - inset));
      const nextWidth = Math.max(0, nextRight - nextLeft);
      const nextBottom = Math.max(inset, Math.round(window.innerHeight - bounds.bottom + inset));

      setDockFrame((current) => {
        if (
          current.left === nextLeft &&
          current.width === nextWidth &&
          current.bottom === nextBottom
        ) {
          return current;
        }

        return {
          left: nextLeft,
          width: nextWidth,
          bottom: nextBottom,
        };
      });
    };

    syncDockFrame();

    const observer = new ResizeObserver(() => {
      syncDockFrame();
    });

    observer.observe(workspace);
    window.addEventListener('resize', syncDockFrame);
    window.addEventListener('scroll', syncDockFrame, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncDockFrame);
      window.removeEventListener('scroll', syncDockFrame);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const normalizedKey = typeof event.key === 'string' ? event.key.toLowerCase() : '';
      const hasModifier = event.ctrlKey || event.metaKey;
      const isTextEntry = isTextEntryTarget(event.target);
      const isFormField = isFormFieldTarget(event.target);
      const isUndo = hasModifier && !event.shiftKey && (event.code === 'KeyZ' || normalizedKey === 'z');
      const isRedo =
        hasModifier &&
        event.shiftKey &&
        (event.code === 'KeyZ' || normalizedKey === 'z');
      const isUngroup =
        hasModifier &&
        event.shiftKey &&
        (event.code === 'KeyG' || normalizedKey === 'g');
      const isDuplicate = hasModifier && !event.shiftKey && (event.code === 'KeyD' || normalizedKey === 'd');
      const isCopy = hasModifier && !event.shiftKey && (event.code === 'KeyC' || normalizedKey === 'c');
      const isCut = hasModifier && !event.shiftKey && (event.code === 'KeyX' || normalizedKey === 'x');
      const isPaste = hasModifier && !event.shiftKey && (event.code === 'KeyV' || normalizedKey === 'v');
      const isDelete = event.key === 'Delete' || event.key === 'Backspace';

      if (!isTextEntry && isRedo) {
        event.preventDefault();
        setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
        redoHistoryAction();
        return;
      }

      if (!isTextEntry && isUndo) {
        event.preventDefault();
        setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
        undoHistoryAction();
        return;
      }

      if (!isTextEntry && !isExportOpen && isUngroup) {
        event.preventDefault();
        handleUngroupSelectedShapes();
        return;
      }

      if (!isTextEntry && !isExportOpen && isCopy) {
        event.preventDefault();
        handleCopySelectedShapes();
        return;
      }

      if (!isTextEntry && !isExportOpen && isCut) {
        event.preventDefault();
        handleCutSelectedShapes();
        return;
      }

      if (!isTextEntry && !isExportOpen && isPaste) {
        event.preventDefault();
        handlePasteShapes();
        return;
      }

      if (!isTextEntry && !isExportOpen && isDelete) {
        event.preventDefault();
        handleDeleteSelectedShapes();
        return;
      }

      if (!isTextEntry && !isExportOpen && isDuplicate) {
        event.preventDefault();
        handleDuplicateSelectedShapes();
        return;
      }

      if (!isFormField && !isExportOpen && !hasModifier && !event.altKey) {
        const nudgeDirection = getArrowDirection(event.code);

        if (nudgeDirection && selectedShapeIds.length > 0) {
          event.preventDefault();
          hideToolbarTooltip();
          handleNudgeSelectedShapes(nudgeDirection, event.shiftKey ? 4 : 1);
          return;
        }
      }

      if (!isFormField && !isExportOpen && !hasModifier && !event.altKey && !event.shiftKey) {
        switch (event.code) {
          case 'KeyV':
            event.preventDefault();
            hideToolbarTooltip();
            handleEditorModeChange(EDITOR_MODE_SELECT);
            return;
          case 'KeyL':
            event.preventDefault();
            hideToolbarTooltip();
            handleEditorModeChange(EDITOR_MODE_LASSO_SELECT);
            return;
          case 'KeyE':
            event.preventDefault();
            hideToolbarTooltip();
            handleEditorModeChange(EDITOR_MODE_SELECT);
            return;
          case 'KeyD':
            event.preventDefault();
            hideToolbarTooltip();
            handleEditorModeChange(EDITOR_MODE_DRAW);
            return;
          case 'KeyP':
            event.preventDefault();
            hideToolbarTooltip();
            handleShapePresetToggle();
            return;
          case 'KeyR':
            event.preventDefault();
            hideToolbarTooltip();
            handleInsertPresetShape(PRESET_SHAPE_SQUARE);
            return;
          case 'KeyY':
            event.preventDefault();
            hideToolbarTooltip();
            handleInsertPresetShape(PRESET_SHAPE_STAR);
            return;
          case 'KeyN':
            event.preventDefault();
            hideToolbarTooltip();
            handleInsertPresetShape(PRESET_SHAPE_POLYGON);
            return;
          case 'Digit1':
            event.preventDefault();
            hideToolbarTooltip();
            handleDrawModeChange(DRAW_MODE_DUAL);
            return;
          case 'Digit2':
            event.preventDefault();
            hideToolbarTooltip();
            handleDrawModeChange(DRAW_MODE_CLASSIC);
            return;
          case 'KeyG':
            event.preventDefault();
            hideToolbarTooltip();
            handleSnapToggle();
            return;
          case 'KeyT':
            event.preventDefault();
            hideToolbarTooltip();
            handleThemeToggle();
            return;
          default:
            break;
        }
      }

      if (event.key === 'Escape') {
        event.preventDefault();

        if (viewportContextMenu.isOpen) {
          setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
          return;
        }

        if (isShapePresetMenuOpen) {
          setIsShapePresetMenuOpen(false);
          return;
        }

        if (isExportOpen) {
          setIsExportOpen(false);
          return;
        }

        if (activeEditorMode === EDITOR_MODE_SELECT && selectedHandleIds.length > 0) {
          setSelectedHandleIds([]);
          return;
        }

        if (isSelectionWorkflow && selectedShapeIds.length > 0) {
          setSelectedHandleIds([]);
          setSelectedShapeIds([]);
          return;
        }

        commitHistoryChange((snapshot) => ({
          ...snapshot,
          drawingState: clear(snapshot.drawingState),
        }));
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  });

  useEffect(() => {
    if (!isShapePresetMenuOpen) {
      return undefined;
    }

    const closeShapePresetMenu = () => {
      setIsShapePresetMenuOpen(false);
    };

    const handlePointerDown = (event) => {
      if (shapePresetRef.current?.contains(event.target)) {
        return;
      }

      closeShapePresetMenu();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', closeShapePresetMenu);
    window.addEventListener('scroll', closeShapePresetMenu, true);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', closeShapePresetMenu);
      window.removeEventListener('scroll', closeShapePresetMenu, true);
    };
  }, [isShapePresetMenuOpen]);

  useEffect(() => {
    if (!viewportContextMenu.isOpen) {
      return undefined;
    }

    const closeContextMenu = () => {
      setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    };

    const handlePointerDown = (event) => {
      if (contextMenuRef.current?.contains(event.target)) {
        return;
      }

      closeContextMenu();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', closeContextMenu);
    window.addEventListener('scroll', closeContextMenu, true);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', closeContextMenu);
      window.removeEventListener('scroll', closeContextMenu, true);
    };
  }, [viewportContextMenu.isOpen]);

  useEffect(() => {
    setDrawingState((current) => {
      const nextPointer = maybeSnapPoint(current.pointer, surfaceSize, snapToGrid);

      if (isSamePointer(current.pointer, nextPointer)) {
        return current;
      }

      return {
        ...current,
        pointer: nextPointer,
      };
    });
  }, [snapToGrid, surfaceSize]);

  useEffect(() => {
    snapshotRef.current = createHistorySnapshot({
      appearance,
      drawingState,
      editorMode,
      selectedHandleIds,
      selectedShapeIds,
      shapes,
      snapToGrid,
      theme,
    });
  }, [
    appearance,
    drawingState,
    editorMode,
    selectedHandleIds,
    selectedShapeIds,
    shapes,
    snapToGrid,
    theme,
  ]);

  const expectedKind = getExpectedKind(drawingState);
  const isClassicMode = drawingState.mode === DRAW_MODE_CLASSIC;
  const hasDraftPoints = hasAnyPoints(drawingState);
  const activeEditorMode = normalizeEditorMode(editorMode);
  const draftShape = createShapeFromDraft(drawingState);
  const sceneShapes = getSceneShapes(shapes, draftShape);
  const canExport = sceneShapes.length > 0;
  const canCommitDraft = Boolean(draftShape);
  const touchModeMismatch =
    !isClassicMode && showTouchControls && drawingState.touchMode !== expectedKind;
  const selectedShapes = selectedShapeIds
    .map((shapeId) => getShapeById(shapes, shapeId))
    .filter(Boolean);
  const isMoveMode = activeEditorMode === EDITOR_MODE_SELECT;
  const isLassoSelectMode = activeEditorMode === EDITOR_MODE_LASSO_SELECT;
  const isSelectionWorkflow =
    activeEditorMode === EDITOR_MODE_SELECT ||
    activeEditorMode === EDITOR_MODE_LASSO_SELECT;
  const currentShapePresetOption =
    PRESET_SHAPE_OPTIONS.find((option) => option.value === shapePresetKind) ?? PRESET_SHAPE_OPTIONS[0];
  const hasClipboardShapes = shapeClipboard.shapes.length > 0;
  const canCopySelection = selectedShapes.length > 0;
  const canExportSelection = selectedShapes.length > 0;
  const canUngroupSelection = selectedShapes.some((shape) => Boolean(shape.group));
  const canFlattenSelection =
    selectedShapes.length >= 2 || selectedShapes.some((shape) => Boolean(shape.group));
  const workflowLabel = getWorkflowLabel(activeEditorMode);
  const exportButtonLabel =
    isSelectionWorkflow && canExportSelection ? 'Export Selected' : 'Export';
  const isDraftActive = activeEditorMode === EDITOR_MODE_DRAW && hasDraftPoints;
  const isFinishShapeReady = activeEditorMode === EDITOR_MODE_DRAW && canCommitDraft;
  const editableHandles =
    activeEditorMode === EDITOR_MODE_SELECT && selectedShapes.length === 1
      ? selectedShapes.flatMap((shape) =>
          isShapeEditable(shape)
            ? listEditableHandles(shape).map((handle) => ({
                ...handle,
                id: createHandleId(handle.location),
                isSelected: selectedHandleIds.includes(createHandleId(handle.location)),
                shapeId: shape.id,
              }))
            : [],
        )
      : [];
 
  useEffect(() => {
    if (
      activeEditorMode !== EDITOR_MODE_SELECT ||
      selectedShapes.length !== 1 ||
      !isShapeEditable(selectedShapes[0])
    ) {
      setSelectedHandleIds((current) => (current.length === 0 ? current : []));
      return;
    }

    const validHandleIds = new Set(
      listEditableHandles(selectedShapes[0]).map((handle) => createHandleId(handle.location)),
    );

    setSelectedHandleIds((current) => {
      const nextSelectedHandleIds = current.filter((handleId) => validHandleIds.has(handleId));
      return nextSelectedHandleIds.length === current.length ? current : nextSelectedHandleIds;
    });
  }, [activeEditorMode, selectedShapes]);

  const canRunBoolean = selectedShapeIds.length >= 2;
  const canDeleteSelection = selectedShapeIds.length > 0;
  const canResetSnapToGrid = hasDraftPoints || shapes.length > 0;
  const howToBallItems = getHowToBallItems({
    activeEditorMode,
    isClassicMode,
    showTouchControls,
  });
  const howToBallStatus = getHowToBallStatus({
    activeEditorMode,
    canCommitDraft,
    classicPointCount: drawingState.classicPoints.length,
    expectedKind,
    isClassicMode,
    selectedShapeCount: selectedShapeIds.length,
    showTouchControls,
    touchMode: drawingState.touchMode,
    touchModeMismatch,
  });
  const dockStyle =
    dockFrame.width > 0
      ? {
          left: `${dockFrame.left}px`,
          width: `${dockFrame.width}px`,
          bottom: `${dockFrame.bottom}px`,
        }
      : {
          opacity: 0,
          pointerEvents: 'none',
        };

  const hideToolbarTooltip = () => {
    if (toolbarTooltipTimerRef.current) {
      window.clearTimeout(toolbarTooltipTimerRef.current);
      toolbarTooltipTimerRef.current = null;
    }

    setToolbarTooltip((current) => (current.isOpen ? CLOSED_TOOLBAR_TOOLTIP : current));
  };

  const showToolbarTooltip = (anchor, label, hotkey, delay = TOOLTIP_DELAY_MS) => {
    hideToolbarTooltip();

    if (typeof window === 'undefined') {
      return;
    }

    const openTooltip = () => {
      const bounds = (dockToolbarRef.current ?? anchor)?.getBoundingClientRect();

      if (!bounds) {
        return;
      }

      setToolbarTooltip({
        isOpen: true,
        label,
        hotkey,
        ...getToolbarTooltipPosition(bounds),
      });
    };

    if (delay > 0) {
      toolbarTooltipTimerRef.current = window.setTimeout(openTooltip, delay);
      return;
    }

    openTooltip();
  };

  const getToolbarTooltipProps = (label, hotkey) => ({
    onMouseEnter: (event) => showToolbarTooltip(event.currentTarget, label, hotkey),
    onMouseLeave: hideToolbarTooltip,
    onFocus: (event) => {
      if (!event.currentTarget.matches(':focus-visible')) {
        return;
      }

      showToolbarTooltip(event.currentTarget, label, hotkey, 0);
    },
    onBlur: hideToolbarTooltip,
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleViewportChange = () => {
      hideToolbarTooltip();
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      if (toolbarTooltipTimerRef.current) {
        window.clearTimeout(toolbarTooltipTimerRef.current);
        toolbarTooltipTimerRef.current = null;
      }

      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, []);

  const scene = {
    draftState: drawingState,
    shapes,
    selectedShapeIds,
    selectedHandleIds,
    editHandles: editableHandles,
    editorMode: activeEditorMode,
  };

  const applySnapshot = (snapshot) => {
    if (!snapshot) {
      return;
    }

    snapshotRef.current = createHistorySnapshot(snapshot);
    setDrawingState((current) => ({
      ...snapshot.drawingState,
      pointer: current.pointer,
    }));
    setAppearance(snapshot.appearance);
    setShapes(snapshot.shapes);
    setSelectedShapeIds(snapshot.selectedShapeIds);
    setSelectedHandleIds(snapshot.selectedHandleIds);
    setEditorMode(normalizeEditorMode(snapshot.editorMode));
    setTheme(snapshot.theme);
    setSnapToGrid(snapshot.snapToGrid);
  };

  const commitHistoryChange = (updater) => {
    const currentSnapshot = snapshotRef.current;

    if (!currentSnapshot) {
      return;
    }

    const updatedSnapshot = updater(currentSnapshot);

    if (!updatedSnapshot) {
      return;
    }

    const nextSnapshot = createHistorySnapshot(updatedSnapshot);

    if (!nextSnapshot || areSnapshotsEquivalent(currentSnapshot, nextSnapshot)) {
      return;
    }

    historyRef.current = {
      past: [...historyRef.current.past, currentSnapshot].slice(-HISTORY_LIMIT),
      future: [],
    };

    applySnapshot(nextSnapshot);
  };

  const undoHistoryAction = () => {
    const previousSnapshot =
      historyRef.current.past[historyRef.current.past.length - 1] ?? null;
    const currentSnapshot = snapshotRef.current;

    if (!previousSnapshot || !currentSnapshot) {
      return;
    }

    historyRef.current = {
      past: historyRef.current.past.slice(0, -1),
      future: [currentSnapshot, ...historyRef.current.future].slice(0, HISTORY_LIMIT),
    };

    applySnapshot(previousSnapshot);
  };

  const redoHistoryAction = () => {
    const nextSnapshot = historyRef.current.future[0] ?? null;
    const currentSnapshot = snapshotRef.current;

    if (!nextSnapshot || !currentSnapshot) {
      return;
    }

    historyRef.current = {
      past: [...historyRef.current.past, currentSnapshot].slice(-HISTORY_LIMIT),
      future: historyRef.current.future.slice(1),
    };

    applySnapshot(nextSnapshot);
  };

  const beginHistoryGesture = () => {
    if (!gestureSnapshotRef.current && snapshotRef.current) {
      gestureSnapshotRef.current = snapshotRef.current;
      gestureHasChangesRef.current = false;
    }
  };

  const endHistoryGesture = () => {
    const initialSnapshot = gestureSnapshotRef.current;
    const currentSnapshot = snapshotRef.current;
    gestureSnapshotRef.current = null;
    const gestureHasChanges = gestureHasChangesRef.current;
    gestureHasChangesRef.current = false;

    if (!initialSnapshot || !currentSnapshot || !gestureHasChanges) {
      return;
    }

    if (areSnapshotsEquivalent(initialSnapshot, currentSnapshot)) {
      return;
    }

    historyRef.current = {
      past: [...historyRef.current.past, initialSnapshot].slice(-HISTORY_LIMIT),
      future: [],
        };
      };

  const closeMobilePanel = () => {
    setMobilePanel(null);
  };

  const toggleMobilePanel = (panelName) => {
    setMobilePanel((current) => (current === panelName ? null : panelName));
  };

  const handlePlacePoint = (kind, coords) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      drawingState: addPoint(
        snapshot.drawingState,
        kind,
        maybeSnapPoint(coords, surfaceSize, snapshot.snapToGrid),
      ),
    }));
  };

  const handlePointerChange = (pointer) => {
    const nextPointer = maybeSnapPoint(pointer, surfaceSize, snapToGrid);

    setDrawingState((current) => {
      if (isSamePointer(current.pointer, nextPointer)) {
        return current;
      }

      return {
        ...current,
        pointer: nextPointer,
      };
    });
  };

  const handleTouchModeChange = (mode) => {
    setDrawingState((current) => ({
      ...current,
      touchMode: mode,
    }));
  };

  const handleDrawModeChange = (mode) => {
    hideToolbarTooltip();
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      drawingState: setDrawMode(snapshot.drawingState, mode),
    }));
  };

  const handleEditorModeChange = (mode) => {
    hideToolbarTooltip();
    const nextMode = normalizeEditorMode(mode);
    setEditorMode(nextMode);
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    setIsShapePresetMenuOpen(false);

    if (nextMode !== EDITOR_MODE_SELECT) {
      setSelectedHandleIds([]);
    }
  };

  const handleLayerSelection = (shapeId, event) => {
    const additiveSelection = event?.ctrlKey || event?.metaKey || event?.shiftKey;

    if (activeEditorMode === EDITOR_MODE_DRAW) {
      setEditorMode(EDITOR_MODE_SELECT);
    }

    setSelectedHandleIds([]);
    setSelectedShapeIds((current) => {
      if (
        additiveSelection &&
        (activeEditorMode === EDITOR_MODE_SELECT || activeEditorMode === EDITOR_MODE_LASSO_SELECT)
      ) {
        return current.includes(shapeId)
          ? current.filter((currentId) => currentId !== shapeId)
          : [...current, shapeId];
      }

      return current.length === 1 && current[0] === shapeId ? current : [shapeId];
    });
  };

  const handleSelectAllShapes = () => {
    setEditorMode(EDITOR_MODE_SELECT);
    setSelectedHandleIds([]);
    setSelectedShapeIds(shapes.map((shape) => shape.id));
  };

  const handleClearSelection = () => {
    hideToolbarTooltip();
    setSelectedHandleIds([]);
    setSelectedShapeIds([]);
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
  };

  const handleThemeToggle = () => {
    hideToolbarTooltip();
    setTheme((current) => (current === THEME_GARFIELD ? THEME_MONO : THEME_GARFIELD));
  };

  const handleSnapToggle = () => {
    hideToolbarTooltip();
    setSnapToGrid((current) => !current);
  };

  const handleResetSnapToGrid = () => {
    hideToolbarTooltip();
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      drawingState: snapDrawingStateToGrid(snapshot.drawingState, surfaceSize),
      shapes: snapShapesToGrid(snapshot.shapes, surfaceSize),
    }));
  };

  const handleShapePresetToggle = () => {
    hideToolbarTooltip();
    setIsShapePresetMenuOpen((current) => !current);
  };

  const handlePolygonSidesChange = (event) => {
    setPolygonSides(normalizePolygonSides(event.target.value, polygonSides));
  };

  const handleInsertPresetShape = (presetKind = shapePresetKind) => {
    hideToolbarTooltip();
    const presetShape = createPresetShape(
      {
        kind: presetKind,
        sides: polygonSides,
      },
      surfaceSize,
    );

    if (!presetShape) {
      return;
    }

    setShapePresetKind(presetKind);
    setIsShapePresetMenuOpen(false);
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      shapes: [...snapshot.shapes, presetShape],
      selectedHandleIds: [],
      selectedShapeIds: [presetShape.id],
      editorMode: EDITOR_MODE_SELECT,
    }));
  };

  const handleCopySelectedShapes = () => {
    if (selectedShapes.length === 0) {
      return false;
    }

    setShapeClipboard({
      shapes: cloneHistoryValue(selectedShapes),
      pasteCount: 0,
    });
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    return true;
  };

  const handlePasteShapes = () => {
    if (shapeClipboard.shapes.length === 0) {
      return false;
    }

    const nextPasteCount = shapeClipboard.pasteCount + 1;
    const pastedShapes = duplicateShapes(shapeClipboard.shapes, {
      delta: getClipboardPasteDelta(surfaceSize, nextPasteCount),
    });

    if (pastedShapes.length === 0) {
      return false;
    }

    commitHistoryChange((snapshot) => ({
      ...snapshot,
      shapes: [...snapshot.shapes, ...pastedShapes],
      selectedHandleIds: [],
      selectedShapeIds: pastedShapes.map((shape) => shape.id),
      editorMode: EDITOR_MODE_SELECT,
    }));
    setShapeClipboard((current) => ({
      ...current,
      pasteCount: nextPasteCount,
    }));
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    return true;
  };

  const handleDuplicateSelectedShapes = () => {
    if (selectedShapeIds.length === 0) {
      return false;
    }

    const stepPx = GRID_STEP_PX;
    const delta = {
      x: stepPx / Math.max(surfaceSize.width, 1),
      y: stepPx / Math.max(surfaceSize.height, 1),
    };

    commitHistoryChange((snapshot) => {
      const orderedSelection = snapshot.selectedShapeIds
        .map((shapeId) => snapshot.shapes.find((shape) => shape.id === shapeId))
        .filter(Boolean);
      const duplicatedShapes = duplicateShapes(orderedSelection, { delta });

      if (duplicatedShapes.length === 0) {
        return snapshot;
      }

      return {
        ...snapshot,
        shapes: [...snapshot.shapes, ...duplicatedShapes],
        selectedHandleIds: [],
        selectedShapeIds: duplicatedShapes.map((shape) => shape.id),
        editorMode: EDITOR_MODE_SELECT,
      };
    });

    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    return true;
  };

  const handleDuplicateShapesForDrag = (shapeIds) => {
    if (!shapeIds || shapeIds.length === 0) {
      return null;
    }

    const orderedSelection = shapeIds
      .map((shapeId) => getShapeById(shapes, shapeId))
      .filter(Boolean);
    const duplicatedShapes = duplicateShapes(orderedSelection, {
      delta: { x: 0, y: 0 },
    });

    if (duplicatedShapes.length === 0) {
      return null;
    }

    gestureHasChangesRef.current = true;
    setShapes((current) => [...current, ...duplicatedShapes]);
    setSelectedHandleIds([]);
    setSelectedShapeIds(duplicatedShapes.map((shape) => shape.id));
    setEditorMode(EDITOR_MODE_SELECT);
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);

    return {
      shapeIds: duplicatedShapes.map((shape) => shape.id),
      shapes: duplicatedShapes,
    };
  };

  const handleCutSelectedShapes = () => {
    if (selectedShapes.length === 0) {
      return false;
    }

    setShapeClipboard({
      shapes: cloneHistoryValue(selectedShapes),
      pasteCount: 0,
    });
    commitHistoryChange((snapshot) => removeSelectedShapesFromSnapshot(snapshot));
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    return true;
  };

  const handleViewportContextMenu = ({ clientX, clientY, hitShapeId }) => {
    if (hitShapeId && !selectedShapeIds.includes(hitShapeId)) {
      setSelectedShapeIds([hitShapeId]);
      setSelectedHandleIds([]);
    }

    setViewportContextMenu({
      isOpen: true,
      ...getViewportContextMenuPosition(clientX, clientY),
    });
  };

  const handleInsertShapeVertex = (shapeId, location, point) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      shapes: snapshot.shapes.map((shape) =>
        shape.id === shapeId ? insertShapeVertex(shape, location, point) : shape,
      ),
      selectedHandleIds: [],
      selectedShapeIds: [shapeId],
      editorMode: EDITOR_MODE_SELECT,
    }));
  };

  const handleAppearanceColorChange = (key, value) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      appearance: {
        ...snapshot.appearance,
        [key]: value,
      },
    }));
  };

  const handleFillModeChange = (fillMode) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      appearance: {
        ...snapshot.appearance,
        fillMode,
      },
    }));
  };

  const handleFillOpacityChange = (event) => {
    const fillOpacity = Number(event.target.value);

    commitHistoryChange((snapshot) => ({
      ...snapshot,
      appearance: {
        ...snapshot.appearance,
        fillOpacity,
      },
    }));
  };

  const handleCornerRadiusChange = (event) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      appearance: {
        ...snapshot.appearance,
        cornerRadius: normalizeNonNegativeNumber(
          event.target.value,
          snapshot.appearance.cornerRadius,
        ),
      },
    }));
  };

  const handleCornerRadiusInputChange = (event) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      appearance: {
        ...snapshot.appearance,
        cornerRadius: normalizeNonNegativeNumber(
          event.target.value,
          snapshot.appearance.cornerRadius,
        ),
      },
    }));
  };

  const handleCornerTypeChange = (event) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      appearance: {
        ...snapshot.appearance,
        cornerType: event.target.value,
      },
    }));
  };

  const handleCommitDraftShape = () => {
    commitHistoryChange((snapshot) => {
      const nextDraftShape = createShapeFromDraft(snapshot.drawingState);

      if (!nextDraftShape) {
        return snapshot;
      }

      return {
        ...snapshot,
        shapes: [...snapshot.shapes, nextDraftShape],
        selectedShapeIds: [nextDraftShape.id],
        selectedHandleIds: [],
        drawingState: clear(snapshot.drawingState),
        editorMode: EDITOR_MODE_SELECT,
      };
    });
  };

  const handleSelectShapeIds = (nextSelectedIds) => {
    if (nextSelectedIds.length !== 1 || activeEditorMode !== EDITOR_MODE_SELECT) {
      setSelectedHandleIds([]);
    }

    setSelectedShapeIds(nextSelectedIds);
  };

  const handleSelectHandleIds = (nextSelectedHandleIds) => {
    setSelectedHandleIds(nextSelectedHandleIds);
  };

  const handleDeleteSelectedShapes = () => {
    if (selectedShapeIds.length === 0) {
      return false;
    }

    commitHistoryChange((snapshot) => removeSelectedShapesFromSnapshot(snapshot));
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    return true;
  };

  const handleUngroupSelectedShapes = () => {
    if (!canUngroupSelection) {
      return false;
    }

    commitHistoryChange((snapshot) => {
      const result = ungroupShapes(snapshot.shapes, snapshot.selectedShapeIds);

      return {
        ...snapshot,
        shapes: result.shapes,
        selectedHandleIds: [],
        selectedShapeIds: result.ungroupedShapeIds,
        editorMode: EDITOR_MODE_SELECT,
      };
    });
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    return true;
  };

  const handleUngroupShape = (shapeId) => {
    commitHistoryChange((snapshot) => {
      const result = ungroupShapes(snapshot.shapes, [shapeId]);

      return {
        ...snapshot,
        selectedHandleIds: [],
        selectedShapeIds: result.ungroupedShapeIds,
        shapes: result.shapes,
        editorMode: EDITOR_MODE_SELECT,
      };
    });
  };

  const handleUpdateShapeVertex = (shapeId, location, point) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      shapes: snapshot.shapes.map((shape) =>
        shape.id === shapeId
          ? updateShapeVertex(shape, location, maybeSnapPoint(point, surfaceSize, snapshot.snapToGrid))
          : shape,
      ),
    }));
  };

  const handleMoveShapeVertices = (shapeId, baseShape, locations, delta) => {
    if (!baseShape || (delta.x === 0 && delta.y === 0)) {
      return;
    }

    gestureHasChangesRef.current = true;
    setShapes((current) =>
      current.map((shape) =>
        shape.id === shapeId
          ? moveShapeVertices(baseShape, locations, delta)
          : shape,
      ),
    );
  };

  const handleMoveShape = (shapeIds, baseShapes, delta) => {
    if (delta.x === 0 && delta.y === 0) {
      return;
    }

    gestureHasChangesRef.current = true;
    const baseShapeMap = new Map(baseShapes.map((shape) => [shape.id, shape]));

    setShapes((current) =>
      current.map((shape) => {
        if (!shapeIds.includes(shape.id)) {
          return shape;
        }

        const baseShape = baseShapeMap.get(shape.id) ?? shape;
        return moveShape(baseShape, delta);
      }),
    );
  };

  const handleNudgeSelectedShapes = (direction, stepMultiplier = 1) => {
    if (!direction || selectedShapeIds.length === 0) {
      return false;
    }

    const stepPx = GRID_STEP_PX * Math.max(1, stepMultiplier);
    const delta = {
      x: (direction.x * stepPx) / Math.max(surfaceSize.width, 1),
      y: (direction.y * stepPx) / Math.max(surfaceSize.height, 1),
    };

    commitHistoryChange((snapshot) => {
      if (snapshot.selectedShapeIds.length === 0) {
        return snapshot;
      }

      const selectedSet = new Set(snapshot.selectedShapeIds);

      return {
        ...snapshot,
        selectedHandleIds: [],
        editorMode: EDITOR_MODE_SELECT,
        shapes: snapshot.shapes.map((shape) =>
          selectedSet.has(shape.id)
            ? moveShape(shape, delta)
            : shape,
        ),
      };
    });

    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    return true;
  };

  const handleBooleanOperation = (operation) => {
    commitHistoryChange((snapshot) => {
      if (snapshot.selectedShapeIds.length < 2) {
        return snapshot;
      }

      const selectedSet = new Set(snapshot.selectedShapeIds);
      const orderedSelection = snapshot.selectedShapeIds
        .map((shapeId) => snapshot.shapes.find((shape) => shape.id === shapeId))
        .filter(Boolean);
      const resultShape = runBooleanOperation(orderedSelection, operation);

      return {
        ...snapshot,
        shapes: snapshot.shapes
          .filter((shape) => !selectedSet.has(shape.id))
          .concat(resultShape ? [resultShape] : []),
        selectedHandleIds: [],
        selectedShapeIds: resultShape ? [resultShape.id] : [],
        editorMode: EDITOR_MODE_SELECT,
      };
    });
  };

  const handleFlattenSelection = () => {
    if (!canFlattenSelection) {
      return false;
    }

    commitHistoryChange((snapshot) => {
      const orderedSelection = snapshot.selectedShapeIds
        .map((shapeId) => snapshot.shapes.find((shape) => shape.id === shapeId))
        .filter(Boolean);
      const flattenedShape = flattenShapes(orderedSelection);

      if (!flattenedShape) {
        return snapshot;
      }

      const selectedSet = new Set(snapshot.selectedShapeIds);

      return {
        ...snapshot,
        shapes: snapshot.shapes
          .filter((shape) => !selectedSet.has(shape.id))
          .concat(flattenedShape),
        selectedHandleIds: [],
        selectedShapeIds: [flattenedShape.id],
        editorMode: EDITOR_MODE_SELECT,
      };
    });

    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    return true;
  };

  const handleExport = ({ format, transparentBackground, scope }) => {
    const exporter = format === EXPORT_FORMAT_SVG ? exportSceneAsSvg : exportSceneAsPng;
    const targetShapes = scope === 'selection' ? selectedShapes : sceneShapes;

    if (targetShapes.length === 0) {
      return;
    }

    const modeName = drawingState.mode === DRAW_MODE_CLASSIC ? 'classic-lasso' : 'dual-point-lasso';
    const backgroundSuffix = transparentBackground ? 'transparent' : 'with-background';
    const scopeSuffix = scope === 'selection' ? 'selection' : 'scene';

    exporter({
      shapes: targetShapes,
      appearance,
      width: surfaceSize.width,
      height: surfaceSize.height,
      transparentBackground,
      fileName: `${modeName}-${scopeSuffix}-${backgroundSuffix}.${format}`,
    });

    setIsExportOpen(false);
  };

  return (
    <div className={`app-shell theme-${theme}`}>
      <div className="editor-layout">
        <LayersSidebar
          className={
            isMobileLayout
              ? `mobile-sheet mobile-sheet-layers ${mobilePanel === 'layers' ? 'is-open' : ''}`
              : ''
          }
          isMobileLayout={isMobileLayout}
          onCloseMobilePanel={closeMobilePanel}
          onClearSelection={handleClearSelection}
          onSelectAllShapes={handleSelectAllShapes}
          onSelectShape={handleLayerSelection}
          onUngroupShape={handleUngroupShape}
          selectedShapeIds={selectedShapeIds}
          shapes={shapes}
        />

        <main className="workspace" ref={workspaceRef}>
          <DrawingCanvas
            appearance={appearance}
            editorMode={activeEditorMode}
            onDuplicateShapeDragStart={handleDuplicateShapesForDrag}
            isDraftActive={isDraftActive}
            isDraftReady={isFinishShapeReady}
            snapToGrid={snapToGrid}
            onBeginHistoryGesture={beginHistoryGesture}
            onEndHistoryGesture={endHistoryGesture}
            onMoveShape={handleMoveShape}
            onMoveShapeVertices={handleMoveShapeVertices}
            onInsertShapeVertex={handleInsertShapeVertex}
            onPlacePoint={handlePlacePoint}
            onPointerChange={handlePointerChange}
            onSelectHandleIds={handleSelectHandleIds}
            onSelectShapeIds={handleSelectShapeIds}
            onSurfaceChange={setSurfaceSize}
            onUpdateShapeVertex={handleUpdateShapeVertex}
            onViewportContextMenu={handleViewportContextMenu}
            scene={scene}
          />
        </main>

        <aside
          className={`control-panel ${
            isMobileLayout
              ? `mobile-sheet mobile-sheet-controls ${mobilePanel === 'controls' ? 'is-open' : ''}`
              : ''
          }`.trim()}
        >
          {isMobileLayout ? (
            <div className="mobile-sheet-head">
              <p className="section-label">Controls</p>
              <button
                type="button"
                className="close-button mobile-sheet-close"
                onClick={closeMobilePanel}
              >
                Close
              </button>
            </div>
          ) : null}
          <div className="panel-copy">
            <p className="eyebrow brand-eyebrow">AFDEFS SOFTWARE 1999</p>
            <div className="panel-mark">
              <PanelMark />
            </div>
            <p className="build-stamp">{CURRENT_BUILD_LABEL}</p>
          </div>

          <div className="panel-meta">
            <div className="status-strip">
              <span className="data-chip">Workflow: {workflowLabel}</span>
              <span className="data-chip">{isClassicMode ? 'Mode: Classic Lasso' : 'Mode: Dual-Point'}</span>
              <span className="data-chip">Snap2Grid: {snapToGrid ? 'On' : 'Off'}</span>
              <span className="data-chip">Shapes: {shapes.length}</span>
              {isSelectionWorkflow ? (
                <span className="phase-chip classic">Selected: {selectedShapeIds.length}</span>
              ) : isClassicMode ? (
                <span className="phase-chip classic">Vertices: {drawingState.classicPoints.length}</span>
              ) : (
                <span className={`phase-chip ${expectedKind}`}>
                  Awaiting {expectedKind === POINT_KIND_A ? 'Point 1' : 'Point 2'}
                </span>
              )}
            </div>

            <div className="control-grid">
              <section className="meta-card meta-card-how2ball">
                <div className="section-head">
                  <p className="section-label">How2Ball</p>
                </div>

                <HowToBallGuide items={howToBallItems} />

                {showTouchControls && !isClassicMode && activeEditorMode === EDITOR_MODE_DRAW ? (
                  <div className="touch-toggle" aria-label="Touch point type selector">
                    <button
                      type="button"
                      className={drawingState.touchMode === POINT_KIND_A ? 'is-active p1' : 'p1'}
                      onClick={() => handleTouchModeChange(POINT_KIND_A)}
                    >
                      P1
                    </button>
                    <button
                      type="button"
                      className={drawingState.touchMode === POINT_KIND_B ? 'is-active p2' : 'p2'}
                      onClick={() => handleTouchModeChange(POINT_KIND_B)}
                    >
                      P2
                    </button>
                  </div>
                ) : null}

                <div className={`hint-status ${touchModeMismatch ? 'warning' : ''}`}>
                  <span className="hint-status-label">Now</span>
                  <p className={`touch-status ${touchModeMismatch ? 'warning' : ''}`}>
                    {howToBallStatus}
                  </p>
                </div>
              </section>

              <section className="meta-card meta-card-scene-actions">
                <div className="section-head">
                  <p className="section-label">Scene Actions</p>
                </div>

                <div className="button-row">
                  <button
                    type="button"
                    className={`primary-button finish-shape-button ${isFinishShapeReady ? 'is-ready' : ''}`}
                    onClick={handleCommitDraftShape}
                    disabled={!canCommitDraft}
                  >
                    Finish Shape
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      commitHistoryChange((snapshot) => ({
                        ...snapshot,
                        drawingState: undo(snapshot.drawingState),
                      }))
                    }
                    disabled={activeEditorMode !== EDITOR_MODE_DRAW || !hasDraftPoints}
                  >
                    Undo Draft
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      commitHistoryChange((snapshot) => ({
                        ...snapshot,
                        drawingState: clear(snapshot.drawingState),
                      }))
                    }
                    disabled={!hasDraftPoints}
                  >
                    Clear Draft
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleDeleteSelectedShapes}
                    disabled={!canDeleteSelection}
                  >
                    Delete Selected
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setIsExportOpen(true)}
                    disabled={!canExport}
                  >
                    {exportButtonLabel}
                  </button>
                </div>
              </section>

              <section className="meta-card meta-card-shape-creator">
                <div className="section-head">
                  <p className="section-label">Shape Creator</p>
                </div>

                <div className="button-row">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleBooleanOperation(BOOLEAN_UNION)}
                    disabled={!canRunBoolean}
                  >
                    Merge / Union
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleBooleanOperation(BOOLEAN_SUBTRACT)}
                    disabled={!canRunBoolean}
                  >
                    Subtract
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleBooleanOperation(BOOLEAN_INTERSECT)}
                    disabled={!canRunBoolean}
                  >
                    Intersect
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleBooleanOperation(BOOLEAN_XOR)}
                    disabled={!canRunBoolean}
                  >
                    XOR
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleFlattenSelection}
                    disabled={!canFlattenSelection}
                    title="Bake the selected shapes into one plain shape"
                  >
                    Flatten
                  </button>
                </div>
                <p className="card-note">
                  Flatten bakes the current composite into one plain shape and removes ungroup history.
                </p>
              </section>

              <section className="meta-card meta-card-appearance appearance-card">
                <div className="section-head">
                  <p className="section-label">Appearance</p>

                  <div className="segmented-control" aria-label="Fill mode selector">
                    <button
                      type="button"
                      className={appearance.fillMode === FILL_MODE_FILL ? 'is-active' : ''}
                      onClick={() => handleFillModeChange(FILL_MODE_FILL)}
                    >
                      Fill
                    </button>
                    <button
                      type="button"
                      className={appearance.fillMode === FILL_MODE_OUTLINE ? 'is-active' : ''}
                      onClick={() => handleFillModeChange(FILL_MODE_OUTLINE)}
                    >
                      Outline
                    </button>
                  </div>
                </div>

                <div className="appearance-grid">
                  <ColorField
                    label="Background"
                    value={appearance.background}
                    onChange={(value) => handleAppearanceColorChange('background', value)}
                  />
                  <ColorField
                    label="Contour"
                    value={appearance.stroke}
                    onChange={(value) => handleAppearanceColorChange('stroke', value)}
                  />
                  <ColorField
                    label="Fill"
                    value={appearance.fill}
                    onChange={(value) => handleAppearanceColorChange('fill', value)}
                    disabled={appearance.fillMode === FILL_MODE_OUTLINE}
                  />
                </div>

                {appearance.fillMode === FILL_MODE_FILL ? (
                  <label className="range-field">
                    <span className="field-label">Fill Opacity</span>
                    <div className="range-row">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={appearance.fillOpacity}
                        onChange={handleFillOpacityChange}
                      />
                      <span className="range-value">{appearance.fillOpacity}%</span>
                    </div>
                  </label>
                ) : (
                  <p className="card-note">
                    Outline mode disables fill on the canvas and in PNG/SVG export.
                  </p>
                )}

                <label className="range-field">
                  <span className="field-label">Corner Radius</span>
                  <div className="range-row range-row-wide">
                    <input
                      type="range"
                      min="0"
                      max="1000"
                      step="1"
                      value={Math.min(1000, appearance.cornerRadius)}
                      onChange={handleCornerRadiusChange}
                    />
                    <label className="number-input-shell">
                      <span className="number-suffix">px</span>
                      <input
                        className="number-input"
                        inputMode="numeric"
                        min="0"
                        onChange={handleCornerRadiusInputChange}
                        type="number"
                        value={appearance.cornerRadius}
                      />
                    </label>
                  </div>
                </label>

                <label className="range-field">
                  <span className="field-label">Corner Type</span>
                  <select className="shape-picker appearance-select" value={appearance.cornerType} onChange={handleCornerTypeChange}>
                    {CORNER_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="range-field">
                  <span className="field-label">Grid Repair</span>
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!canResetSnapToGrid}
                      onClick={handleResetSnapToGrid}
                    >
                      Reset Snap2Grid
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </aside>
      </div>

      {isMobileLayout && mobilePanel ? (
        <button
          type="button"
          className="mobile-sheet-backdrop"
          aria-label="Close mobile panel"
          onClick={closeMobilePanel}
        />
      ) : null}

      <section className="mode-dock viewport-dock" style={dockStyle}>
        <div className="dock-controls dock-toolbar" ref={dockToolbarRef}>
          <div className="tool-cluster">
            <ToolButton
              isActive={activeEditorMode === EDITOR_MODE_DRAW}
              label="Draw"
              hotkey="D"
              icon={<DrawToolIcon />}
              tooltipProps={getToolbarTooltipProps('Draw', 'D')}
              onClick={() => handleEditorModeChange(EDITOR_MODE_DRAW)}
            />
          </div>

          <div className="tool-cluster tool-cluster-wide">
            <ShapePresetDropdown
              currentShape={currentShapePresetOption.value}
              getTooltipProps={getToolbarTooltipProps}
              isOpen={isShapePresetMenuOpen}
              menuRef={shapePresetRef}
              polygonSides={polygonSides}
              onInsertShape={handleInsertPresetShape}
              onPolygonSidesChange={handlePolygonSidesChange}
              onToggle={handleShapePresetToggle}
            />

            <div className="tool-separator" />

            <ToolButton
              className="mobile-panel-tool"
              isActive={mobilePanel === 'layers'}
              label="Layers"
              hotkey=""
              icon={<LayersPanelIcon />}
              tooltipProps={getToolbarTooltipProps('Layers', '')}
              onClick={() => toggleMobilePanel('layers')}
            />
            <ToolButton
              className="mobile-panel-tool"
              isActive={mobilePanel === 'controls'}
              label="Controls"
              hotkey=""
              icon={<ControlsPanelIcon />}
              tooltipProps={getToolbarTooltipProps('Controls', '')}
              onClick={() => toggleMobilePanel('controls')}
            />
            <ToolButton
              isActive={isMoveMode}
              label="Move / Edit"
              hotkey="V"
              icon={<MoveToolIcon />}
              tooltipProps={getToolbarTooltipProps('Move / Edit', 'V')}
              onClick={() => handleEditorModeChange(EDITOR_MODE_SELECT)}
            />
            <ToolButton
              isActive={isLassoSelectMode}
              label="Lasso Select"
              hotkey="L"
              icon={<LassoToolIcon />}
              tooltipProps={getToolbarTooltipProps('Lasso Select', 'L')}
              onClick={() => handleEditorModeChange(EDITOR_MODE_LASSO_SELECT)}
            />
          </div>

          <div className="tool-cluster tool-cluster-wide">
            <div className="tool-chip-group" aria-label="Draw mode selector">
              <button
                type="button"
                className={drawingState.mode === DRAW_MODE_DUAL ? 'is-active' : ''}
                aria-label="Dual-Point (1)"
                onClick={() => handleDrawModeChange(DRAW_MODE_DUAL)}
                {...getToolbarTooltipProps('Dual-Point', '1')}
              >
                <span className="tool-button-icon" aria-hidden="true">
                  <DualPointModeIcon />
                </span>
              </button>
              <button
                type="button"
                className={`classic-toggle ${drawingState.mode === DRAW_MODE_CLASSIC ? 'is-active' : ''}`}
                aria-label="Classic Lasso (2)"
                onClick={() => handleDrawModeChange(DRAW_MODE_CLASSIC)}
                {...getToolbarTooltipProps('Classic Lasso', '2')}
              >
                <span className="tool-button-icon" aria-hidden="true">
                  <ClassicLassoModeIcon />
                </span>
              </button>
            </div>

            <button
              type="button"
              className={`tool-toggle-button ${snapToGrid ? 'is-active' : ''}`}
              aria-label="Snap2Grid (G)"
              onClick={handleSnapToggle}
              {...getToolbarTooltipProps('Snap2Grid', 'G')}
            >
              <span className="tool-button-icon" aria-hidden="true">
                <SnapGridIcon />
              </span>
            </button>
            <ToolButton
              disabled={!canResetSnapToGrid}
              label="Reset Snap2Grid"
              hotkey=""
              icon={<ResetGridIcon />}
              tooltipProps={getToolbarTooltipProps('Reset Snap2Grid', '')}
              onClick={handleResetSnapToGrid}
            />
          </div>

          <div className="mobile-scene-actions" aria-label="Scene actions">
            {showTouchControls && !isClassicMode && activeEditorMode === EDITOR_MODE_DRAW ? (
              <div className="touch-toggle mobile-touch-toggle" aria-label="Touch point type selector">
                <button
                  type="button"
                  className={drawingState.touchMode === POINT_KIND_A ? 'is-active p1' : 'p1'}
                  onClick={() => handleTouchModeChange(POINT_KIND_A)}
                >
                  P1
                </button>
                <button
                  type="button"
                  className={drawingState.touchMode === POINT_KIND_B ? 'is-active p2' : 'p2'}
                  onClick={() => handleTouchModeChange(POINT_KIND_B)}
                >
                  P2
                </button>
              </div>
            ) : null}
            <DockActionButton
              className={`mobile-scene-action-finish ${isFinishShapeReady ? 'is-ready' : ''}`}
              disabled={!canCommitDraft}
              icon={<FinishFlagIcon />}
              label="Finish Shape"
              onClick={handleCommitDraftShape}
              tooltipProps={getToolbarTooltipProps('Finish Shape', '')}
            />
            <DockActionButton
              disabled={activeEditorMode !== EDITOR_MODE_DRAW || !hasDraftPoints}
              icon={<UndoActionIcon />}
              label="Undo Draft"
              onClick={() =>
                commitHistoryChange((snapshot) => ({
                  ...snapshot,
                  drawingState: undo(snapshot.drawingState),
                }))
              }
              tooltipProps={getToolbarTooltipProps('Undo Draft', '')}
            />
            <DockActionButton
              disabled={!hasDraftPoints}
              icon={<TrashActionIcon />}
              label="Clear Draft"
              onClick={() =>
                commitHistoryChange((snapshot) => ({
                  ...snapshot,
                  drawingState: clear(snapshot.drawingState),
                }))
              }
              tooltipProps={getToolbarTooltipProps('Clear Draft', '')}
            />
            <DockActionButton
              className="is-danger"
              disabled={!canDeleteSelection}
              icon={<DeleteSelectedIcon />}
              label="Delete Selected"
              onClick={handleDeleteSelectedShapes}
              tooltipProps={getToolbarTooltipProps('Delete Selected', '')}
            />
          </div>
        </div>

        <button
          type="button"
          className={`mascot-shell ${theme === THEME_GARFIELD ? 'is-garfield' : ''}`}
          aria-label={
            theme === THEME_GARFIELD
              ? 'Monochrome Theme (T)'
              : 'Garfield Theme (T)'
          }
          aria-pressed={theme === THEME_GARFIELD}
          onClick={handleThemeToggle}
          {...getToolbarTooltipProps(
            theme === THEME_GARFIELD ? 'Monochrome Theme' : 'Garfield Theme',
            'T',
          )}
        >
          <img className="cat-mascot" src={afCatLogo} alt="" />
        </button>
      </section>

      <ToolbarTooltip {...toolbarTooltip} />

      <ViewportContextMenu
        canCopy={canCopySelection}
        canDelete={canDeleteSelection}
        canPaste={hasClipboardShapes}
        canUngroup={canUngroupSelection}
        isOpen={viewportContextMenu.isOpen}
        menuRef={contextMenuRef}
        onCopy={handleCopySelectedShapes}
        onCut={handleCutSelectedShapes}
        onDelete={handleDeleteSelectedShapes}
        onPaste={handlePasteShapes}
        onUngroup={handleUngroupSelectedShapes}
        x={viewportContextMenu.x}
        y={viewportContextMenu.y}
      />

      <ExportOverlay
        appearance={appearance}
        defaultScope={isSelectionWorkflow && canExportSelection ? 'selection' : 'scene'}
        hasSelectionExport={canExportSelection}
        isOpen={isExportOpen}
        mode={drawingState.mode}
        onClose={() => setIsExportOpen(false)}
        onExport={handleExport}
        sceneCount={sceneShapes.length}
        selectionCount={selectedShapes.length}
      />
    </div>
  );
}

function ColorField({ label, value, onChange, disabled = false }) {
  return (
    <label className={`color-field ${disabled ? 'is-disabled' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="color-input-shell">
        <input
          className="native-color"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={value}
        />
        <span className="color-swatch" style={{ backgroundColor: value }} />
        <span className="color-value">{value.toUpperCase()}</span>
      </span>
    </label>
  );
}

function HowToBallGuide({ items }) {
  return (
    <div className="shortcut-guide" role="list">
      {items.map((item) => (
        <div className="shortcut-guide-row" key={item.id} role="listitem">
          <div className="shortcut-guide-combo" aria-hidden="true">
            {item.keys.map((key, index) => (
              <Fragment key={`${item.id}-${key}`}>
                {index > 0 ? <span className="shortcut-plus">+</span> : null}
                <span className="shortcut-key">{key}</span>
              </Fragment>
            ))}
          </div>
          <p className="shortcut-guide-copy">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function ToolButton({
  className = '',
  disabled = false,
  hotkey,
  icon,
  isActive = false,
  label,
  onClick,
  tooltipProps,
}) {
  return (
    <button
      type="button"
      className={`tool-button ${isActive ? 'is-active' : ''} ${className}`.trim()}
      aria-label={hotkey ? `${label} (${hotkey})` : label}
      disabled={disabled}
      onClick={onClick}
      {...tooltipProps}
    >
      <span className="tool-button-icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

function DockActionButton({ className = '', disabled = false, icon, label, onClick, tooltipProps }) {
  return (
    <button
      type="button"
      className={`mobile-scene-action ${className}`.trim()}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      {...tooltipProps}
    >
      <span className="tool-button-icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}

function ShapePresetDropdown({
  currentShape,
  getTooltipProps,
  isOpen,
  menuRef,
  polygonSides,
  onInsertShape,
  onPolygonSidesChange,
  onToggle,
}) {
  return (
    <div className="shape-preset-shell" ref={menuRef}>
      <button
        type="button"
        className={`shape-preset-trigger ${isOpen ? 'is-open' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Shape Presets (P)"
        onClick={onToggle}
        {...getTooltipProps('Shape Presets', 'P')}
      >
        <span className="shape-preset-trigger-icon" aria-hidden="true">
          <ShapePresetIcon shape={currentShape} sides={polygonSides} />
        </span>
        <ChevronDownIcon />
      </button>

      {isOpen ? (
        <div className="shape-preset-menu" role="menu">
          <div className="shape-preset-grid">
            <ShapePresetOption
              icon={<SquareShapeIcon />}
              isActive={currentShape === PRESET_SHAPE_SQUARE}
              label="Square"
              hotkey="R"
              onClick={() => onInsertShape(PRESET_SHAPE_SQUARE)}
              tooltipProps={getTooltipProps('Square', 'R')}
            />
            <ShapePresetOption
              icon={<StarShapeIcon />}
              isActive={currentShape === PRESET_SHAPE_STAR}
              label="Star"
              hotkey="Y"
              onClick={() => onInsertShape(PRESET_SHAPE_STAR)}
              tooltipProps={getTooltipProps('Star', 'Y')}
            />
            <ShapePresetOption
              icon={<PolygonShapeIcon sides={polygonSides} />}
              isActive={currentShape === PRESET_SHAPE_POLYGON}
              label="Polygon"
              hotkey="N"
              onClick={() => onInsertShape(PRESET_SHAPE_POLYGON)}
              tooltipProps={getTooltipProps('Polygon', 'N')}
            />
          </div>

          <label className="shape-preset-sides">
            <span className="shape-preset-meta">Sides</span>
            <div className="shape-preset-sides-row">
              <input
                type="range"
                min={String(DEFAULT_POLYGON_SIDES)}
                max={String(MAX_POLYGON_SIDES)}
                step="1"
                value={polygonSides}
                onChange={onPolygonSidesChange}
              />
              <input
                className="shape-preset-sides-input"
                type="number"
                min={String(DEFAULT_POLYGON_SIDES)}
                max={String(MAX_POLYGON_SIDES)}
                value={polygonSides}
                onChange={onPolygonSidesChange}
              />
            </div>
          </label>
        </div>
      ) : null}
    </div>
  );
}

function ShapePresetOption({ hotkey, icon, isActive = false, label, onClick, tooltipProps }) {
  return (
    <button
      type="button"
      className={`shape-preset-option ${isActive ? 'is-active' : ''}`}
      aria-label={hotkey ? `${label} (${hotkey})` : label}
      onClick={onClick}
      role="menuitem"
      {...tooltipProps}
    >
      {icon}
    </button>
  );
}

function ToolbarTooltip({ hotkey, isOpen, label, x, y }) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="toolbar-tooltip"
      style={{ left: `${x}px`, top: `${y}px` }}
      aria-hidden="true"
    >
      <span className="toolbar-tooltip-label">{label}</span>
      {hotkey ? <span className="toolbar-tooltip-hotkey">{hotkey}</span> : null}
    </div>
  );
}

function ViewportContextMenu({
  canCopy,
  canDelete,
  canPaste,
  canUngroup,
  isOpen,
  menuRef,
  onCopy,
  onCut,
  onDelete,
  onPaste,
  onUngroup,
  x,
  y,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="viewport-context-menu"
      role="menu"
      style={{ left: `${x}px`, top: `${y}px` }}
    >
      <ContextMenuItem disabled={!canCopy} hint="Ctrl/Cmd+C" label="Copy" onClick={onCopy} />
      <ContextMenuItem disabled={!canPaste} hint="Ctrl/Cmd+V" label="Paste" onClick={onPaste} />
      <ContextMenuItem disabled={!canCopy} hint="Ctrl/Cmd+X" label="Cut" onClick={onCut} />
      <ContextMenuItem disabled={!canUngroup} hint="Ctrl/Cmd+Shift+G" label="Ungroup" onClick={onUngroup} />
      <ContextMenuItem disabled={!canDelete} hint="Delete" label="Delete" onClick={onDelete} />
    </div>
  );
}

function ContextMenuItem({ disabled = false, hint, label, onClick }) {
  return (
    <button
      type="button"
      className="context-menu-item"
      disabled={disabled}
      onClick={() => {
        if (!disabled) {
          onClick?.();
        }
      }}
      role="menuitem"
    >
      <span>{label}</span>
      <span className="context-menu-hint">{hint}</span>
    </button>
  );
}

function MoveToolIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 1.5v10.8l2.9-2 1.7 3.2 1.6-.8-1.7-3.2 3.4-.2L3 1.5Z" fill="currentColor" />
    </svg>
  );
}

function LayersPanelIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="m8 2.2 5.2 2.7L8 7.6 2.8 4.9 8 2.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="m2.8 8 5.2 2.7L13.2 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m2.8 11.1 5.2 2.7 5.2-2.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ControlsPanelIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 12h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6" cy="4" r="1.5" fill="currentColor" />
      <circle cx="10.5" cy="8" r="1.5" fill="currentColor" />
      <circle cx="7.5" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function LassoToolIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M11.8 11.3c1.7-.8 2.7-2 2.7-3.4 0-2.4-2.7-4.3-6.1-4.3S2.3 5.5 2.3 7.9c0 1.8 1.4 3.2 3.5 3.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M5.9 11.7c0 .8-.6 1.4-1.4 1.4S3.1 12.5 3.1 11.7s.6-1.4 1.4-1.4.9.3 1.1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function EditToolIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m11.8 2.2 2 2-7.6 7.6-2.8.8.8-2.8 7.6-7.6Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.9 4.1 12 6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DrawToolIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 11.5 5 4.5l4.5 2.2 4-3.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="5" cy="4.5" r="1.2" fill="currentColor" />
      <circle cx="9.5" cy="6.7" r="1.2" fill="currentColor" />
      <circle cx="13.5" cy="3" r="1.2" fill="currentColor" />
      <circle cx="2.5" cy="11.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

function FinishFlagIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2v11.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M5 2.8h6.3l-1.6 2.2 1.6 2.3H5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UndoActionIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.3 4 3.5 6.7 6.3 9.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 6.7h5.2c2.1 0 3.8 1.6 3.8 3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashActionIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5.2 4.1h5.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M6 4.1V3.3c0-.5.4-.8.9-.8h2.2c.5 0 .9.3.9.8v.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M4.8 5.3h6.4l-.5 7.1a1 1 0 0 1-1 .9H6.3a1 1 0 0 1-1-.9l-.5-7.1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeleteSelectedIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.2 4.2 11.8 11.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DualPointModeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 5.5 7.4 8.4 11 4.8 16.5 7.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 14.5 7.4 11.6 11 15.2 16.5 12.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="3" cy="5.5" r="1.2" fill="currentColor" />
      <circle cx="3" cy="14.5" r="1.2" fill="currentColor" />
      <circle cx="16.5" cy="7.6" r="1.2" fill="currentColor" />
      <circle cx="16.5" cy="12.4" r="1.2" fill="currentColor" />
    </svg>
  );
}

function ClassicLassoModeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4 12.8 6.4 5.2 13.2 4.2 16.3 10.4 11.2 15.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6.4" cy="5.2" r="1.15" fill="currentColor" />
      <circle cx="13.2" cy="4.2" r="1.15" fill="currentColor" />
      <circle cx="16.3" cy="10.4" r="1.15" fill="currentColor" />
      <circle cx="11.2" cy="15.8" r="1.15" fill="currentColor" />
      <circle cx="4" cy="12.8" r="1.15" fill="currentColor" />
    </svg>
  );
}

function SnapGridIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4 4.5h12M4 10h12M4 15.5h12M4.5 4v12M10 4v12M15.5 4v12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.62"
      />
      <circle cx="10" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}

function ResetGridIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4 5.2h8.6a3.4 3.4 0 1 1 0 6.8H8.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="m6 3.3-2.6 2.6L6 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 13.8h7.2M10 10.2v7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        opacity="0.52"
      />
      <circle cx="10" cy="13.8" r="1.7" fill="currentColor" />
    </svg>
  );
}

function ShapePresetIcon({ shape, sides = DEFAULT_POLYGON_SIDES }) {
  if (shape === PRESET_SHAPE_STAR) {
    return <StarShapeIcon />;
  }

  if (shape === PRESET_SHAPE_POLYGON) {
    return <PolygonShapeIcon sides={sides} />;
  }

  return <SquareShapeIcon />;
}

function SquareShapeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="0.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function StarShapeIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m10 2.3 2.2 4.53 5 .73-3.6 3.5.85 4.94L10 13.65 5.55 16l.85-4.94-3.6-3.5 5-.73L10 2.3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PolygonShapeIcon({ sides = DEFAULT_POLYGON_SIDES }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d={buildRegularPolygonIconPath(sides)}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function getWorkflowLabel(editorMode) {
  const mode = normalizeEditorMode(editorMode);

  if (mode === EDITOR_MODE_SELECT) {
    return 'Move';
  }

  if (mode === EDITOR_MODE_LASSO_SELECT) {
    return 'Lasso Select';
  }

  return 'Draw';
}

function getHowToBallItems({ activeEditorMode, isClassicMode, showTouchControls }) {
  if (activeEditorMode === EDITOR_MODE_LASSO_SELECT) {
    return [
      { id: 'lasso-drag', keys: ['Drag'], label: 'lasso-select shapes' },
      { id: 'lasso-add', keys: ['Ctrl/Cmd', 'Shift'], label: 'add to the current selection' },
      { id: 'lasso-wheel', keys: ['Wheel'], label: 'zoom the viewport' },
      { id: 'lasso-pan', keys: ['Space', 'LMB'], label: 'move around canvas' },
    ];
  }

  if (activeEditorMode === EDITOR_MODE_SELECT) {
    return [
      { id: 'move-click', keys: ['Click'], label: 'pick a shape or contour' },
      { id: 'move-drag', keys: ['Drag'], label: 'move shape, point, or + insert' },
      { id: 'move-alt-drag', keys: ['Alt', 'Drag'], label: 'duplicate while dragging' },
      { id: 'move-duplicate', keys: ['Ctrl/Cmd', 'D'], label: 'duplicate selection' },
      { id: 'move-arrows', keys: ['Arrows'], label: 'nudge selected shapes by 1 grid cell' },
      { id: 'move-shift-arrows', keys: ['Shift', 'Arrows'], label: 'nudge by 4 grid cells' },
      { id: 'move-wheel', keys: ['Wheel'], label: 'zoom the viewport' },
      { id: 'move-pan', keys: ['Space', 'LMB'], label: 'move around canvas' },
      { id: 'move-copy', keys: ['Ctrl/Cmd', 'C/V/X'], label: 'copy, paste, or cut selection' },
    ];
  }

  if (isClassicMode) {
    return [
      { id: 'classic-place', keys: ['LMB'], label: 'drop the next vertex' },
      { id: 'classic-wheel', keys: ['Wheel'], label: 'zoom the viewport' },
      { id: 'classic-pan', keys: ['Space', 'LMB'], label: 'move around canvas' },
      { id: 'classic-clear', keys: ['Esc'], label: 'clear the draft' },
      { id: 'classic-undo', keys: ['Ctrl/Cmd', 'Z'], label: 'undo, add Shift for redo' },
    ];
  }

  if (showTouchControls) {
    return [
      { id: 'dual-touch-mode', keys: ['P1', 'P2'], label: 'switch the active point lane' },
      { id: 'dual-touch-place', keys: ['Tap'], label: 'drop the active point' },
      { id: 'dual-touch-finish', keys: ['Finish'], label: 'commit the closed draft' },
    ];
  }

  return [
    { id: 'dual-p1', keys: ['LMB'], label: 'place Point 1' },
    { id: 'dual-p2', keys: ['RMB'], label: 'place Point 2' },
    { id: 'dual-wheel', keys: ['Wheel'], label: 'zoom the viewport' },
    { id: 'dual-pan', keys: ['Space', 'LMB'], label: 'move around canvas' },
    { id: 'dual-undo', keys: ['Ctrl/Cmd', 'Z'], label: 'undo, add Shift for redo' },
  ];
}

function getHowToBallStatus({
  activeEditorMode,
  canCommitDraft,
  classicPointCount,
  expectedKind,
  isClassicMode,
  selectedShapeCount,
  showTouchControls,
  touchMode,
  touchModeMismatch,
}) {
  if (activeEditorMode === EDITOR_MODE_LASSO_SELECT) {
    if (selectedShapeCount > 0) {
      return `${selectedShapeCount} selected. Shape Creator and Export can target that exact set.`;
    }

    return 'Quick click still grabs the topmost shape under the cursor.';
  }

  if (activeEditorMode === EDITOR_MODE_SELECT) {
    if (selectedShapeCount > 0) {
      return `${selectedShapeCount} selected. Drag the body to move it, or drag points on one simple contour.`;
    }

    return 'Hover an edge to reveal a + insert point, then click to add a fresh vertex.';
  }

  if (canCommitDraft) {
    return 'Draft is closed. Finish Shape is armed and ready.';
  }

  if (isClassicMode) {
    return classicPointCount >= 1
      ? `Classic contour in progress: ${classicPointCount} vertex${classicPointCount === 1 ? '' : 'es'} placed so far.`
      : 'Classic lasso is empty. Drop the first vertex to begin the contour.';
  }

  if (showTouchControls) {
    if (touchModeMismatch) {
      return `Switch to ${expectedKind === POINT_KIND_A ? 'P1' : 'P2'} to keep the pair order locked.`;
    }

    return `Touch lane ready: ${(touchMode ?? POINT_KIND_A).toUpperCase()}.`;
  }

  return expectedKind === POINT_KIND_B
    ? 'Strict pair mode is live: Point 2 is the next legal click.'
    : 'Drop the opening point to start the next paired segment.';
}

function normalizeEditorMode(editorMode) {
  if (editorMode === EDITOR_MODE_SELECT) {
    return EDITOR_MODE_SELECT;
  }

  if (editorMode === EDITOR_MODE_LASSO_SELECT) {
    return EDITOR_MODE_LASSO_SELECT;
  }

  if (editorMode === EDITOR_MODE_EDIT) {
    return EDITOR_MODE_SELECT;
  }

  return EDITOR_MODE_DRAW;
}

function maybeSnapPoint(point, surfaceSize, snapToGrid) {
  if (!point || !snapToGrid) {
    return point;
  }

  return snapPointToGrid(point, surfaceSize);
}

function snapDrawingStateToGrid(state, surfaceSize) {
  if (!state) {
    return state;
  }

  if (state.mode === DRAW_MODE_CLASSIC) {
    return {
      ...state,
      classicPoints: state.classicPoints.map((point) => snapPointToGrid(point, surfaceSize)),
    };
  }

  return {
    ...state,
    pointsA: state.pointsA.map((point) => snapPointToGrid(point, surfaceSize)),
    pointsB: state.pointsB.map((point) => snapPointToGrid(point, surfaceSize)),
  };
}

function snapShapesToGrid(shapes, surfaceSize) {
  return (shapes ?? []).map((shape) => ({
    ...shape,
    polygons: shape.polygons.map((polygon) =>
      polygon.map((ring) => ring.map((point) => snapPointToGrid(point, surfaceSize))),
    ),
  }));
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const nextValue = Number(value);

  if (!Number.isFinite(nextValue)) {
    return Math.max(0, Number(fallback) || 0);
  }

  return Math.max(0, nextValue);
}

function isSamePointer(left, right) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.x === right.x && left.y === right.y;
}

function removeSelectedShapesFromSnapshot(snapshot) {
  if (snapshot.selectedShapeIds.length === 0) {
    return snapshot;
  }

  const selectedSet = new Set(snapshot.selectedShapeIds);

  return {
    ...snapshot,
    shapes: snapshot.shapes.filter((shape) => !selectedSet.has(shape.id)),
    selectedHandleIds: [],
    selectedShapeIds: [],
  };
}

function getClipboardPasteDelta(surfaceSize, pasteCount) {
  return {
    x: (28 * pasteCount) / Math.max(surfaceSize.width, 1),
    y: (28 * pasteCount) / Math.max(surfaceSize.height, 1),
  };
}

function getViewportContextMenuPosition(clientX, clientY) {
  if (typeof window === 'undefined') {
    return { x: clientX, y: clientY };
  }

  const inset = 12;
  const width = 220;
  const height = 188;

  return {
    x: Math.min(window.innerWidth - width - inset, Math.max(inset, clientX)),
    y: Math.min(window.innerHeight - height - inset, Math.max(inset, clientY)),
  };
}

function getToolbarTooltipPosition(bounds) {
  if (typeof window === 'undefined') {
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top,
    };
  }

  const edgeInset = 92;
  const centerX = bounds.left + bounds.width / 2;

  return {
    x: Math.min(window.innerWidth - edgeInset, Math.max(edgeInset, centerX)),
    y: Math.max(18, bounds.top),
  };
}

function createPresetShape(config, surfaceSize) {
  const ring = createPresetRing(config, surfaceSize);

  if (!ring) {
    return null;
  }

  return createShapeFromPolygons([[ring]], {
    name:
      PRESET_SHAPE_OPTIONS.find((option) => option.value === config.kind)?.label ?? 'Preset Shape',
    sourceMode: 'preset',
  });
}

function createPresetRing(config, surfaceSize) {
  const type = config.kind;
  const sides = normalizePolygonSides(config.sides, DEFAULT_POLYGON_SIDES);
  const center = { x: 0.5, y: 0.5 };
  const halfWidth = 126 / Math.max(surfaceSize.width, 1);
  const halfHeight = 88 / Math.max(surfaceSize.height, 1);
  const outerRadius = Math.min(halfWidth, halfHeight);

  if (type === PRESET_SHAPE_SQUARE) {
    return [
      { x: center.x - halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y - halfHeight },
      { x: center.x + halfWidth, y: center.y + halfHeight },
      { x: center.x - halfWidth, y: center.y + halfHeight },
    ];
  }

  if (type === PRESET_SHAPE_STAR) {
    return createStarRing(center, outerRadius, outerRadius * 0.48, 5);
  }

  if (type === PRESET_SHAPE_POLYGON) {
    return createRegularPolygonRing(center, outerRadius, sides);
  }

  return null;
}

function createRegularPolygonRing(center, radius, sides) {
  const safeSides = normalizePolygonSides(sides, DEFAULT_POLYGON_SIDES);

  return Array.from({ length: safeSides }, (_, index) => {
    const angle = -Math.PI / 2 + (index / safeSides) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

function createStarRing(center, outerRadius, innerRadius, points) {
  const safePoints = Math.max(3, Math.round(points));
  const totalPoints = safePoints * 2;

  return Array.from({ length: totalPoints }, (_, index) => {
    const isOuter = index % 2 === 0;
    const radius = isOuter ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (index / totalPoints) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

function buildRegularPolygonIconPath(sides) {
  const points = createRegularPolygonRing({ x: 10, y: 10 }, 6.6, sides);
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .concat('Z')
    .join(' ');
}

function normalizePolygonSides(value, fallback = DEFAULT_POLYGON_SIDES) {
  const nextValue = Number(value);

  if (!Number.isFinite(nextValue)) {
    return Math.max(DEFAULT_POLYGON_SIDES, Math.round(Number(fallback) || DEFAULT_POLYGON_SIDES));
  }

  return Math.min(MAX_POLYGON_SIDES, Math.max(DEFAULT_POLYGON_SIDES, Math.round(nextValue)));
}

function getArrowDirection(code) {
  switch (code) {
    case 'ArrowLeft':
      return { x: -1, y: 0 };
    case 'ArrowRight':
      return { x: 1, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -1 };
    case 'ArrowDown':
      return { x: 0, y: 1 };
    default:
      return null;
  }
}

function isFormFieldTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}

function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest('[contenteditable="true"]')) {
    return true;
  }

  const input = target.closest('input, textarea');

  if (!input) {
    return false;
  }

  if (input instanceof HTMLTextAreaElement) {
    return true;
  }

  if (!(input instanceof HTMLInputElement)) {
    return false;
  }

  const type = (input.type || 'text').toLowerCase();

  return [
    'text',
    'search',
    'url',
    'tel',
    'email',
    'password',
    'number',
  ].includes(type);
}

function createHistorySnapshot({
  appearance,
  drawingState,
  editorMode,
  selectedHandleIds,
  selectedShapeIds,
  shapes,
  snapToGrid,
  theme,
}) {
  return cloneHistoryValue({
    appearance,
    drawingState: {
      ...drawingState,
      pointer: null,
    },
    editorMode: normalizeEditorMode(editorMode),
    selectedHandleIds,
    selectedShapeIds,
    shapes,
    snapToGrid,
    theme,
  });
}

function areSnapshotsEquivalent(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneHistoryValue(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

export default App;
