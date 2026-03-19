import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import afCatLogo from './assets/af-cat.svg';
import DrawingCanvas from './components/DrawingCanvas.jsx';
import ExportOverlay from './components/ExportOverlay.jsx';
import LayersSidebar from './components/LayersSidebar.jsx';
import PanelMark from './components/PanelMark.jsx';
import PreferencesOverlay from './components/PreferencesOverlay.jsx';
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
  ALIGN_BOTTOM,
  ALIGN_LEFT,
  ALIGN_RIGHT,
  ALIGN_TOP,
  BOOLEAN_INTERSECT,
  BOOLEAN_SUBTRACT,
  BOOLEAN_UNION,
  BOOLEAN_XOR,
  alignShapeToBounds,
  createHandleId,
  createShapeFromDraft,
  createShapeFromPolygons,
  deleteShapeVerticesAndSelectNext,
  duplicateShapes,
  eraseShapesAlongSegment,
  flattenShapes,
  getSceneShapes,
  getShapeBounds,
  getShapeById,
  insertShapeVertex,
  isShapeEditable,
  listEditableHandles,
  mirrorShape,
  moveShape,
  moveShapeVertices,
  runBooleanOperation,
  scaleShapeFromBounds,
  toggleShapeVerticesSharpCorner,
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
import {
  DEFAULT_CUSTOM_UI_THEME,
  getUiThemeStyle,
  THEME_CUSTOM,
  THEME_GARFIELD,
  THEME_MONO,
  THEME_NIGHTCRACKER,
} from './lib/ui-theme.js';

const TOUCH_QUERY = '(pointer: coarse)';
const MOBILE_LAYOUT_QUERY = '(max-width: 740px)';
const DEFAULT_SURFACE_SIZE = { width: 1200, height: 720 };
const EDITOR_MODE_DRAW = 'draw';
const EDITOR_MODE_SELECT = 'select';
const EDITOR_MODE_DESTROY = 'destroy';
const EDITOR_MODE_TRANSFORM = 'transform';
const EDITOR_MODE_EDIT = 'edit';
const PREFERENCES_TAB_TOOLS = 'tools';
const PREFERENCES_TAB_UI_THEME = 'ui-theme';
const PREFERENCES_TAB_ABOUT = 'about';
const DUAL_POINT_BEHAVIOR_SEQUENTIAL = 'sequential';
const DUAL_POINT_BEHAVIOR_ABSTRACT = 'abstract';
const CLOSED_VIEWPORT_CONTEXT_MENU = { isOpen: false, x: 0, y: 0 };
const CLOSED_TOOLBAR_TOOLTIP = { isOpen: false, x: 0, y: 0, label: '', hotkey: '' };
const TOOLTIP_DELAY_MS = 500;
const HISTORY_LIMIT = 100;
const PRESET_SHAPE_SQUARE = 'square';
const PRESET_SHAPE_STAR = 'star';
const PRESET_SHAPE_POLYGON = 'polygon';
const DEFAULT_POLYGON_SIDES = 3;
const MAX_POLYGON_SIDES = 32;
const DESTROY_BRUSH_STEPS = [2, 4, 6, 8, 12, 24, 32];
const DEFAULT_DESTROY_BRUSH_CELLS = 8;
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
  const [customUiTheme, setCustomUiTheme] = useState(() => DEFAULT_CUSTOM_UI_THEME);
  const [dualPointBehavior, setDualPointBehavior] = useState(DUAL_POINT_BEHAVIOR_SEQUENTIAL);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [destroyBrushCells, setDestroyBrushCells] = useState(DEFAULT_DESTROY_BRUSH_CELLS);
  const [shapePresetKind, setShapePresetKind] = useState(PRESET_SHAPE_SQUARE);
  const [polygonSides, setPolygonSides] = useState(DEFAULT_POLYGON_SIDES);
  const [isShapePresetMenuOpen, setIsShapePresetMenuOpen] = useState(false);
  const [isDestroyBrushMenuOpen, setIsDestroyBrushMenuOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [preferencesTab, setPreferencesTab] = useState(PREFERENCES_TAB_TOOLS);
  const [shapeClipboard, setShapeClipboard] = useState({ shapes: [], pasteCount: 0 });
  const [viewportContextMenu, setViewportContextMenu] = useState(CLOSED_VIEWPORT_CONTEXT_MENU);
  const [toolbarTooltip, setToolbarTooltip] = useState(CLOSED_TOOLBAR_TOOLTIP);
  const [dockFrame, setDockFrame] = useState({ left: 18, width: 0, bottom: 18 });
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(null);
  const [isHowToBallOpen, setIsHowToBallOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);
  const historyRef = useRef({ past: [], future: [] });
  const snapshotRef = useRef(null);
  const gestureSnapshotRef = useRef(null);
  const gestureHasChangesRef = useRef(false);
  const lastDuplicateDeltaRef = useRef(null);
  const contextMenuRef = useRef(null);
  const shapePresetRef = useRef(null);
  const destroyBrushRef = useRef(null);
  const toolbarTooltipTimerRef = useRef(null);
  const dockToolbarRef = useRef(null);
  const workspaceRef = useRef(null);
  const previousThemeRef = useRef(THEME_MONO);
  const hasExplicitDrawModeChoiceRef = useRef(false);

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
    if (
      !isMobileLayout ||
      hasExplicitDrawModeChoiceRef.current ||
      hasAnyPoints(drawingState) ||
      drawingState.mode === DRAW_MODE_CLASSIC
    ) {
      return;
    }

    setDrawingState((current) => setDrawMode(current, DRAW_MODE_CLASSIC));
  }, [drawingState, isMobileLayout]);

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
      const isOverlayOpen = isExportOpen || isPreferencesOpen;

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

      if (!isTextEntry && !isOverlayOpen && isUngroup) {
        event.preventDefault();
        handleUngroupSelectedShapes();
        return;
      }

      if (!isTextEntry && !isOverlayOpen && isCopy) {
        event.preventDefault();
        handleCopySelectedShapes();
        return;
      }

      if (!isTextEntry && !isOverlayOpen && isCut) {
        event.preventDefault();
        handleCutSelectedShapes();
        return;
      }

      if (!isTextEntry && !isOverlayOpen && isPaste) {
        event.preventDefault();
        handlePasteShapes();
        return;
      }

      if (!isTextEntry && !isOverlayOpen && isDelete) {
        event.preventDefault();
        handleDeleteSelectedShapes();
        return;
      }

      if (!isTextEntry && !isOverlayOpen && isDuplicate) {
        event.preventDefault();
        handleDuplicateSelectedShapes();
        return;
      }

      if (!isFormField && !isOverlayOpen && !hasModifier && !event.altKey) {
        const nudgeDirection = getArrowDirection(event.code);

        if (nudgeDirection && selectedShapeIds.length > 0) {
          event.preventDefault();
          hideToolbarTooltip();
          handleNudgeSelectedShapes(nudgeDirection, event.shiftKey ? 4 : 1);
          return;
        }
      }

      if (!isFormField && !hasModifier && !event.altKey && !event.shiftKey) {
        if (event.key === 'Enter') {
          if (isOverlayOpen || activeEditorMode !== EDITOR_MODE_DRAW || !canCommitDraft) {
            return;
          }

          event.preventDefault();
          hideToolbarTooltip();
          handleCommitDraftShape();
          return;
        }

        switch (event.code) {
          case 'KeyP':
            event.preventDefault();
            hideToolbarTooltip();
            setIsExportOpen(false);
            setIsShapePresetMenuOpen(false);
            setPreferencesTab(PREFERENCES_TAB_TOOLS);
            setIsPreferencesOpen((current) => !current);
            return;
          case 'KeyV':
            event.preventDefault();
            hideToolbarTooltip();
            handleEditorModeChange(EDITOR_MODE_SELECT);
            return;
          case 'KeyB':
            event.preventDefault();
            hideToolbarTooltip();
            handleEditorModeChange(EDITOR_MODE_TRANSFORM);
            return;
          case 'KeyX':
            event.preventDefault();
            hideToolbarTooltip();
            handleEditorModeChange(EDITOR_MODE_DESTROY);
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
          case 'KeyQ':
            event.preventDefault();
            hideToolbarTooltip();
            if (isOverlayOpen) {
              return;
            }
            handleShapePresetToggle();
            return;
          case 'KeyR':
            if (isOverlayOpen) {
              return;
            }
            event.preventDefault();
            hideToolbarTooltip();
            handleInsertPresetShape(PRESET_SHAPE_SQUARE);
            return;
          case 'KeyY':
            if (isOverlayOpen) {
              return;
            }
            event.preventDefault();
            hideToolbarTooltip();
            handleInsertPresetShape(PRESET_SHAPE_STAR);
            return;
          case 'KeyN':
            if (isOverlayOpen) {
              return;
            }
            event.preventDefault();
            hideToolbarTooltip();
            handleInsertPresetShape(PRESET_SHAPE_POLYGON);
            return;
          case 'Digit1':
            if (isOverlayOpen) {
              return;
            }
            event.preventDefault();
            hideToolbarTooltip();
            handleDrawModeChange(DRAW_MODE_CLASSIC);
            return;
          case 'Digit2':
            if (isOverlayOpen) {
              return;
            }
            event.preventDefault();
            hideToolbarTooltip();
            handleDrawModeChange(DRAW_MODE_DUAL);
            return;
          case 'KeyG':
            if (isOverlayOpen) {
              return;
            }
            event.preventDefault();
            hideToolbarTooltip();
            handleSnapToggle();
            return;
          case 'KeyT':
            if (isOverlayOpen) {
              return;
            }
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

        if (isPreferencesOpen) {
          setIsPreferencesOpen(false);
          return;
        }

        if (isHowToBallOpen) {
          setIsHowToBallOpen(false);
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
    if (!isDestroyBrushMenuOpen) {
      return undefined;
    }

    const closeDestroyBrushMenu = () => {
      setIsDestroyBrushMenuOpen(false);
    };

    const handlePointerDown = (event) => {
      if (destroyBrushRef.current?.contains(event.target)) {
        return;
      }

      closeDestroyBrushMenu();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', closeDestroyBrushMenu);
    window.addEventListener('scroll', closeDestroyBrushMenu, true);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', closeDestroyBrushMenu);
      window.removeEventListener('scroll', closeDestroyBrushMenu, true);
    };
  }, [isDestroyBrushMenuOpen]);

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

  const expectedKind = getExpectedKind(drawingState);
  const isClassicMode = drawingState.mode === DRAW_MODE_CLASSIC;
  const isSequentialDualPoint = dualPointBehavior === DUAL_POINT_BEHAVIOR_SEQUENTIAL;
  const isAbstractDualPoint = dualPointBehavior === DUAL_POINT_BEHAVIOR_ABSTRACT;
  const hasDraftPoints = hasAnyPoints(drawingState);
  const activeEditorMode = normalizeEditorMode(editorMode);
  const draftShape = useMemo(() => createShapeFromDraft(drawingState), [drawingState]);
  const sceneShapes = useMemo(() => getSceneShapes(shapes, draftShape), [draftShape, shapes]);
  const canExport = sceneShapes.length > 0;
  const canCommitDraft = Boolean(draftShape);
  const touchModeMismatch =
    !isClassicMode &&
    isAbstractDualPoint &&
    showTouchControls &&
    drawingState.touchMode !== expectedKind;
  const selectedShapes = useMemo(
    () =>
      selectedShapeIds
        .map((shapeId) => getShapeById(shapes, shapeId))
        .filter(Boolean),
    [selectedShapeIds, shapes],
  );
  const selectedShapesBounds = useMemo(() => getShapesBounds(selectedShapes), [selectedShapes]);
  const isMoveMode = activeEditorMode === EDITOR_MODE_SELECT;
  const isDestroyMode = activeEditorMode === EDITOR_MODE_DESTROY;
  const isTransformMode = activeEditorMode === EDITOR_MODE_TRANSFORM;
  const isSelectionWorkflow =
    activeEditorMode === EDITOR_MODE_SELECT || activeEditorMode === EDITOR_MODE_TRANSFORM;
  const destroyBrushStepIndex = getDestroyBrushStepIndex(destroyBrushCells);
  const currentShapePresetOption =
    PRESET_SHAPE_OPTIONS.find((option) => option.value === shapePresetKind) ?? PRESET_SHAPE_OPTIONS[0];
  const hasClipboardShapes = shapeClipboard.shapes.length > 0;
  const canCopySelection = selectedShapes.length > 0;
  const canExportSelection = selectedShapes.length > 0;
  const canUngroupSelection = selectedShapes.some((shape) => Boolean(shape.group));
  const canFlattenSelection =
    selectedShapes.length >= 2 || selectedShapes.some((shape) => Boolean(shape.group));
  const canAlignSelection = selectedShapeIds.length >= 2;
  const workflowLabel = getWorkflowLabel(activeEditorMode);
  const exportButtonLabel =
    isSelectionWorkflow && canExportSelection ? 'Export Selected' : 'Export';
  const isDraftActive = activeEditorMode === EDITOR_MODE_DRAW && hasDraftPoints;
  const isFinishShapeReady = activeEditorMode === EDITOR_MODE_DRAW && canCommitDraft;
  const editableHandles = useMemo(() => {
    if (activeEditorMode !== EDITOR_MODE_SELECT || selectedShapes.length !== 1) {
      return [];
    }

    const [selectedShape] = selectedShapes;

    if (!isShapeEditable(selectedShape)) {
      return [];
    }

    const selectedHandleIdSet = new Set(selectedHandleIds);

    return listEditableHandles(selectedShape).map((handle) => {
      const id = createHandleId(handle.location);

      return {
        ...handle,
        id,
        isSelected: selectedHandleIdSet.has(id),
        shapeId: selectedShape.id,
      };
    });
  }, [activeEditorMode, selectedHandleIds, selectedShapes]);

  const selectedHandleLocations = useMemo(
    () => editableHandles.filter((handle) => handle.isSelected).map((handle) => handle.location),
    [editableHandles],
  );

  useEffect(() => {
    snapshotRef.current = createLiveSnapshot({
      appearance,
      customUiTheme,
      dualPointBehavior,
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
    customUiTheme,
    dualPointBehavior,
    drawingState,
    editorMode,
    selectedHandleIds,
    selectedShapeIds,
    shapes,
    snapToGrid,
    theme,
  ]);
 
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

  useEffect(() => {
    const validShapeIds = new Set(shapes.map((shape) => shape.id));

    setSelectedShapeIds((current) => {
      const nextSelectedShapeIds = current.filter((shapeId) => validShapeIds.has(shapeId));
      return nextSelectedShapeIds.length === current.length ? current : nextSelectedShapeIds;
    });
  }, [shapes]);

  const canRunBoolean = selectedShapeIds.length >= 2;
  const canDeleteSelection = selectedShapeIds.length > 0;
  const canDeleteSelectedHandles = selectedHandleLocations.length > 0;
  const canResetSnapToGrid = hasDraftPoints || shapes.length > 0;
  const uiThemeStyle = getUiThemeStyle(theme, customUiTheme);
  const isMobileDrawMode = isMobileLayout && activeEditorMode === EDITOR_MODE_DRAW;
  const showMobileTouchToggle =
    isMobileLayout &&
    showTouchControls &&
    isAbstractDualPoint &&
    !isClassicMode &&
    activeEditorMode === EDITOR_MODE_DRAW;
  const canDeleteAnything = canDeleteSelectedHandles || canDeleteSelection;
  const howToBall = getHowToBallContent({
    activeEditorMode,
    canCommitDraft,
    canEditVertices: editableHandles.length > 0,
    hasDraftPoints,
    selectedHandleCount: selectedHandleLocations.length,
    selectedShapeCount: selectedShapeIds.length,
    dualPointBehavior,
    expectedKind,
    isClassicMode,
    showTouchControls,
    classicPointCount: drawingState.classicPoints.length,
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

    snapshotRef.current = createLiveSnapshot(snapshot);
    setDrawingState((current) => ({
      ...snapshot.drawingState,
      pointer: current.pointer,
    }));
    setAppearance(snapshot.appearance);
    setShapes(snapshot.shapes);
    setSelectedShapeIds(snapshot.selectedShapeIds);
    setSelectedHandleIds(snapshot.selectedHandleIds);
    setEditorMode(normalizeEditorMode(snapshot.editorMode));
    setDualPointBehavior(snapshot.dualPointBehavior ?? DUAL_POINT_BEHAVIOR_SEQUENTIAL);
    setCustomUiTheme(snapshot.customUiTheme ?? DEFAULT_CUSTOM_UI_THEME);
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

  const openMobilePanel = (panelName) => {
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    setIsShapePresetMenuOpen(false);
    setMobilePanel(panelName);
  };

  const handlePlacePoint = (kind, coords) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      drawingState: addPoint(
        snapshot.drawingState,
        resolvePlacedPointKind(snapshot.drawingState, kind, snapshot.dualPointBehavior ?? dualPointBehavior),
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

  const handleDrawModeChange = (mode, options = {}) => {
    hideToolbarTooltip();

    if (!options.passive) {
      hasExplicitDrawModeChoiceRef.current = true;
    }

    commitHistoryChange((snapshot) => ({
      ...snapshot,
      drawingState: setDrawMode(snapshot.drawingState, mode),
      editorMode: EDITOR_MODE_DRAW,
      selectedHandleIds: [],
    }));
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    setIsShapePresetMenuOpen(false);
    setIsDestroyBrushMenuOpen(false);
  };

  const handleEditorModeChange = (mode) => {
    hideToolbarTooltip();
    const nextMode = normalizeEditorMode(mode);
    setEditorMode(nextMode);
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    setIsShapePresetMenuOpen(false);
    setIsDestroyBrushMenuOpen(false);

    if (nextMode !== EDITOR_MODE_SELECT) {
      setSelectedHandleIds([]);
    }
  };

  const handleDestroyBrushMenuToggle = () => {
    hideToolbarTooltip();
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    setIsShapePresetMenuOpen(false);
    setIsDestroyBrushMenuOpen((current) => !current);
  };

  const handleDestroyBrushContextMenu = (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleDestroyBrushMenuToggle();
  };

  const handleDestroyBrushSizeChange = (event) => {
    const index = clampDestroyBrushStepIndex(event.target.value);
    setDestroyBrushCells(DESTROY_BRUSH_STEPS[index]);
  };

  const handleLayerSelection = (shapeId, event) => {
    const additiveSelection = event?.ctrlKey || event?.metaKey || event?.shiftKey;

    if (activeEditorMode === EDITOR_MODE_DRAW) {
      setEditorMode(EDITOR_MODE_SELECT);
    }

    setSelectedHandleIds([]);
    setSelectedShapeIds((current) => {
      if (additiveSelection && activeEditorMode === EDITOR_MODE_SELECT) {
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
    const nextTheme =
      theme === THEME_GARFIELD
        ? previousThemeRef.current === THEME_GARFIELD
          ? THEME_MONO
          : previousThemeRef.current
        : THEME_GARFIELD;

    if (theme !== THEME_GARFIELD) {
      previousThemeRef.current = theme;
    }

    commitHistoryChange((snapshot) => ({
      ...snapshot,
      theme: nextTheme,
    }));
  };

  const handleSnapToggle = () => {
    hideToolbarTooltip();
    setSnapToGrid((current) => !current);
  };

  const handleDualPointBehaviorChange = (nextBehavior) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      dualPointBehavior: nextBehavior,
    }));
  };

  const handleThemePresetChange = (nextTheme) => {
    if (nextTheme !== THEME_GARFIELD) {
      previousThemeRef.current = nextTheme;
    }

    commitHistoryChange((snapshot) => ({
      ...snapshot,
      theme: nextTheme,
    }));
  };

  const handleCustomThemeColorChange = (key, value) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      customUiTheme: {
        ...(snapshot.customUiTheme ?? DEFAULT_CUSTOM_UI_THEME),
        [key]: value,
      },
      theme: THEME_CUSTOM,
    }));
  };

  const handleNeonShapesChange = (nextValue) => {
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      appearance: {
        ...snapshot.appearance,
        neonShapes: nextValue,
      },
    }));
  };

  const handleResetSnapToGrid = () => {
    hideToolbarTooltip();
    commitHistoryChange((snapshot) => ({
      ...snapshot,
      drawingState: snapDrawingStateToGrid(snapshot.drawingState, surfaceSize),
      shapes: snapShapesToGrid(snapshot.shapes, surfaceSize),
    }));
  };

  const openPreferencesPanel = (tab = PREFERENCES_TAB_TOOLS) => {
    hideToolbarTooltip();
    setIsExportOpen(false);
    setIsShapePresetMenuOpen(false);
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    setPreferencesTab(tab);
    setIsPreferencesOpen(true);
    closeMobilePanel();
  };

  const openExportPanel = () => {
    hideToolbarTooltip();
    setIsPreferencesOpen(false);
    setIsShapePresetMenuOpen(false);
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    setIsExportOpen(true);
    closeMobilePanel();
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

    const delta = getEffectiveDuplicateDelta(surfaceSize, lastDuplicateDeltaRef.current);

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

    lastDuplicateDeltaRef.current = cloneHistoryValue(delta);
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

  const handleLayerContextMenu = (shapeId, event) => {
    event.preventDefault();
    event.stopPropagation();

    if (shapeId && activeEditorMode === EDITOR_MODE_DRAW) {
      setEditorMode(EDITOR_MODE_SELECT);
    }

    handleViewportContextMenu({
      clientX: event.clientX,
      clientY: event.clientY,
      hitShapeId: shapeId,
    });
  };

  const handleJumpToSelection = () => {
    if (selectedShapes.length === 0) {
      return false;
    }

    const bounds = getShapesBounds(selectedShapes);

    if (!bounds) {
      return false;
    }

    setFocusRequest((current) => ({
      bounds,
      token: (current?.token ?? 0) + 1,
    }));
    setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
    return true;
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

  const handleRenameShape = (shapeId, nextName) => {
    const normalizedName = String(nextName ?? '').trim();

    if (!normalizedName) {
      return false;
    }

    commitHistoryChange((snapshot) => {
      const targetShape = getShapeById(snapshot.shapes, shapeId);

      if (!targetShape || targetShape.name === normalizedName) {
        return snapshot;
      }

      return {
        ...snapshot,
        shapes: snapshot.shapes.map((shape) =>
          shape.id === shapeId
            ? {
                ...shape,
                name: normalizedName,
              }
            : shape,
        ),
      };
    });

    return true;
  };

  const handleRenameGroup = (shapeId, nextName) => {
    const normalizedName = String(nextName ?? '').trim();

    if (!normalizedName) {
      return false;
    }

    commitHistoryChange((snapshot) => {
      const targetShape = getShapeById(snapshot.shapes, shapeId);

      if (!targetShape?.group || targetShape.group.name === normalizedName) {
        return snapshot;
      }

      return {
        ...snapshot,
        shapes: snapshot.shapes.map((shape) =>
          shape.id === shapeId
            ? {
                ...shape,
                group: {
                  ...shape.group,
                  name: normalizedName,
                },
              }
            : shape,
        ),
      };
    });

    return true;
  };

  const handleDeleteSelectedShapes = () => {
    if (canDeleteSelectedHandles) {
      commitHistoryChange((snapshot) => {
        if (snapshot.selectedShapeIds.length !== 1 || snapshot.selectedHandleIds.length === 0) {
          return snapshot;
        }

        const shapeId = snapshot.selectedShapeIds[0];
        const shape = getShapeById(snapshot.shapes, shapeId);

        if (!shape || !isShapeEditable(shape)) {
          return snapshot;
        }

        const selectedHandleIdSet = new Set(snapshot.selectedHandleIds);
        const locations = listEditableHandles(shape)
          .filter((handle) => selectedHandleIdSet.has(createHandleId(handle.location)))
          .map((handle) => handle.location);

        if (locations.length === 0) {
          return snapshot;
        }

        const nextShape = deleteShapeVerticesAndSelectNext(shape, locations);

        return {
          ...snapshot,
          shapes: snapshot.shapes.map((currentShape) =>
            currentShape.id === shapeId ? nextShape.shape : currentShape,
          ),
          selectedHandleIds: nextShape.nextSelectedHandleIds,
          selectedShapeIds: [shapeId],
          editorMode: EDITOR_MODE_SELECT,
        };
      });
      setViewportContextMenu(CLOSED_VIEWPORT_CONTEXT_MENU);
      return true;
    }

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

  const handleToggleHandleSharpCorner = (shapeId, location, handleId) => {
    if (!shapeId || !location) {
      return;
    }

    commitHistoryChange((snapshot) => ({
      ...snapshot,
      shapes: snapshot.shapes.map((shape) =>
        shape.id === shapeId ? toggleShapeVerticesSharpCorner(shape, [location]) : shape,
      ),
      selectedHandleIds: handleId ? [handleId] : snapshot.selectedHandleIds,
      selectedShapeIds: [shapeId],
      editorMode: EDITOR_MODE_SELECT,
    }));
  };

  const handleMoveShape = (shapeIds, baseShapes, delta, options = {}) => {
    if (delta.x === 0 && delta.y === 0) {
      return;
    }

    if (options.rememberDuplicateDelta) {
      lastDuplicateDeltaRef.current = cloneHistoryValue(delta);
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

  const handleDestroyShapes = (startPoint, endPoint, brushCells = destroyBrushCells) => {
    if (!startPoint || !endPoint) {
      return;
    }

    setShapes((current) => {
      const nextShapes = eraseShapesAlongSegment(
        current,
        startPoint,
        endPoint,
        brushCells,
        surfaceSize,
      );

      if (nextShapes !== current) {
        gestureHasChangesRef.current = true;
      }

      return nextShapes;
    });
    setSelectedHandleIds((current) => (current.length === 0 ? current : []));
  };

  const handleTransformShapes = (shapeIds, baseShapes, sourceBounds, targetBounds) => {
    if (!sourceBounds || !targetBounds || shapeIds.length === 0 || baseShapes.length === 0) {
      return;
    }

    if (
      sourceBounds.minX === targetBounds.minX &&
      sourceBounds.maxX === targetBounds.maxX &&
      sourceBounds.minY === targetBounds.minY &&
      sourceBounds.maxY === targetBounds.maxY
    ) {
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
        return scaleShapeFromBounds(baseShape, sourceBounds, targetBounds);
      }),
    );
  };

  const handleMirrorSelectedShapes = (axis) => {
    if (selectedShapeIds.length === 0 || !selectedShapesBounds) {
      return false;
    }

    commitHistoryChange((snapshot) => {
      if (snapshot.selectedShapeIds.length === 0) {
        return snapshot;
      }

      const orderedSelection = snapshot.selectedShapeIds
        .map((shapeId) => snapshot.shapes.find((shape) => shape.id === shapeId))
        .filter(Boolean);
      const selectionBounds = getShapesBounds(orderedSelection);

      if (!selectionBounds) {
        return snapshot;
      }

      const selectedSet = new Set(snapshot.selectedShapeIds);

      return {
        ...snapshot,
        selectedHandleIds: [],
        shapes: snapshot.shapes.map((shape) =>
          selectedSet.has(shape.id) ? mirrorShape(shape, axis, selectionBounds) : shape,
        ),
      };
    });
    return true;
  };

  const handleAlignSelectedShapes = (alignment) => {
    if (!canAlignSelection) {
      return false;
    }

    commitHistoryChange((snapshot) => {
      if (snapshot.selectedShapeIds.length < 2) {
        return snapshot;
      }

      const orderedSelection = snapshot.selectedShapeIds
        .map((shapeId) => snapshot.shapes.find((shape) => shape.id === shapeId))
        .filter(Boolean);
      const selectionBounds = getShapesBounds(orderedSelection);

      if (!selectionBounds) {
        return snapshot;
      }

      const selectedSet = new Set(snapshot.selectedShapeIds);

      return {
        ...snapshot,
        selectedHandleIds: [],
        shapes: snapshot.shapes.map((shape) =>
          selectedSet.has(shape.id) ? alignShapeToBounds(shape, alignment, selectionBounds) : shape,
        ),
      };
    });

    return true;
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

  const handleExport = ({ format, includeNeonEffects = false, transparentBackground, scope }) => {
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
      includeNeonEffects,
      transparentBackground,
      fileName: `${modeName}-${scopeSuffix}-${backgroundSuffix}.${format}`,
    });

    setIsExportOpen(false);
  };

  return (
    <div className={`app-shell theme-${theme}`} style={uiThemeStyle}>
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
          onContextMenu={handleLayerContextMenu}
          onRenameGroup={handleRenameGroup}
          onRenameShape={handleRenameShape}
          onSelectAllShapes={handleSelectAllShapes}
          onSelectShape={handleLayerSelection}
          onUngroupShape={handleUngroupShape}
          selectedShapeIds={selectedShapeIds}
          shapes={shapes}
        />

        <main className="workspace" ref={workspaceRef}>
          <DrawingCanvas
            appearance={appearance}
            destroyBrushCells={destroyBrushCells}
            editorMode={activeEditorMode}
            isSequentialDualPoint={isSequentialDualPoint}
            onDuplicateShapeDragStart={handleDuplicateShapesForDrag}
            isDraftActive={isDraftActive}
            isDraftReady={isFinishShapeReady}
            snapToGrid={snapToGrid}
            onBeginHistoryGesture={beginHistoryGesture}
            onEndHistoryGesture={endHistoryGesture}
            onMoveShape={handleMoveShape}
            onMoveShapeVertices={handleMoveShapeVertices}
            onDestroyShapes={handleDestroyShapes}
            onTransformShapes={handleTransformShapes}
            onMirrorSelection={handleMirrorSelectedShapes}
            onInsertShapeVertex={handleInsertShapeVertex}
            onPlacePoint={handlePlacePoint}
            onPointerChange={handlePointerChange}
            onSelectHandleIds={handleSelectHandleIds}
            onSelectShapeIds={handleSelectShapeIds}
            onSurfaceChange={setSurfaceSize}
            transformSelectionBounds={selectedShapesBounds}
            onToggleHandleSharpCorner={handleToggleHandleSharpCorner}
            onUpdateShapeVertex={handleUpdateShapeVertex}
            onViewportContextMenu={handleViewportContextMenu}
            focusRequest={focusRequest}
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
                  <button
                    type="button"
                    className={`how2ball-toggle ${isHowToBallOpen ? 'is-active' : ''}`}
                    aria-controls="how2ball-panel"
                    aria-expanded={isHowToBallOpen}
                    aria-pressed={isHowToBallOpen}
                    aria-label={isHowToBallOpen ? 'Disable How2Ball help' : 'Enable How2Ball help'}
                    onClick={() => setIsHowToBallOpen((current) => !current)}
                  >
                    <span className="how2ball-toggle-led" aria-hidden="true" />
                    <span className="how2ball-toggle-chevron" aria-hidden="true">
                      <ChevronDownIcon />
                    </span>
                  </button>
                </div>

                {isHowToBallOpen ? (
                  <div className="how2ball-panel" id="how2ball-panel">
                    <HowToBallGuide items={howToBall.items} />

                    {showTouchControls &&
                    isAbstractDualPoint &&
                    !isClassicMode &&
                    activeEditorMode === EDITOR_MODE_DRAW ? (
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

                    <div className={`hint-status ${howToBall.isWarning ? 'warning' : ''}`}>
                      <span className="hint-status-label">Now</span>
                      <p className={`touch-status ${howToBall.isWarning ? 'warning' : ''}`}>
                        {howToBall.status}
                      </p>
                    </div>
                  </div>
                ) : null}
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

              <section className="meta-card meta-card-shape-align">
                <div className="section-head">
                  <p className="section-label">Shape Align</p>
                </div>

                <div className="button-row">
                  <button
                    type="button"
                    className="secondary-button align-action-button"
                    onClick={() => handleAlignSelectedShapes(ALIGN_LEFT)}
                    disabled={!canAlignSelection}
                  >
                    <span className="align-action-icon" aria-hidden="true">
                      <AlignLeftIcon />
                    </span>
                    <span>Align Left</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button align-action-button"
                    onClick={() => handleAlignSelectedShapes(ALIGN_RIGHT)}
                    disabled={!canAlignSelection}
                  >
                    <span className="align-action-icon" aria-hidden="true">
                      <AlignRightIcon />
                    </span>
                    <span>Align Right</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button align-action-button"
                    onClick={() => handleAlignSelectedShapes(ALIGN_TOP)}
                    disabled={!canAlignSelection}
                  >
                    <span className="align-action-icon" aria-hidden="true">
                      <AlignTopIcon />
                    </span>
                    <span>Align Top</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button align-action-button"
                    onClick={() => handleAlignSelectedShapes(ALIGN_BOTTOM)}
                    disabled={!canAlignSelection}
                  >
                    <span className="align-action-icon" aria-hidden="true">
                      <AlignBottomIcon />
                    </span>
                    <span>Align Bottom</span>
                  </button>
                </div>
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

      {isMobileLayout ? (
        <>
          <section
            className={`mobile-utility-sheet ${mobilePanel === 'menu' ? 'is-open' : ''}`}
            aria-label="Mobile menu"
          >
            <div className="mobile-sheet-head">
              <p className="section-label">Menu</p>
              <button
                type="button"
                className="close-button mobile-sheet-close"
                onClick={closeMobilePanel}
              >
                Close
              </button>
            </div>

            <div className="mobile-utility-grid">
              <button type="button" className="secondary-button" onClick={() => openMobilePanel('layers')}>
                Layers
              </button>
              <button type="button" className="secondary-button" onClick={() => openMobilePanel('controls')}>
                Controls
              </button>
              <button type="button" className="secondary-button" disabled={!canExport} onClick={openExportPanel}>
                {exportButtonLabel}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => openPreferencesPanel(PREFERENCES_TAB_TOOLS)}
              >
                Preferences
              </button>
              <button type="button" className="secondary-button" onClick={handleSnapToggle}>
                Snap2Grid: {snapToGrid ? 'On' : 'Off'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!canResetSnapToGrid}
                onClick={handleResetSnapToGrid}
              >
                Reset Snap2Grid
              </button>
              <button
                type="button"
                className={`secondary-button ${isHowToBallOpen ? 'is-active' : ''}`}
                onClick={() => setIsHowToBallOpen((current) => !current)}
              >
                How2Ball: {isHowToBallOpen ? 'On' : 'Off'}
              </button>
              <button type="button" className="secondary-button" onClick={handleThemeToggle}>
                {theme === THEME_GARFIELD ? 'Restore Theme' : 'Garf Theme'}
              </button>
              {hasDraftPoints ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    commitHistoryChange((snapshot) => ({
                      ...snapshot,
                      drawingState: clear(snapshot.drawingState),
                    }))
                  }
                >
                  Clear Draft
                </button>
              ) : null}
              {canDeleteAnything ? (
                <button
                  type="button"
                  className="secondary-button is-danger"
                  onClick={handleDeleteSelectedShapes}
                >
                  Delete Selected
                </button>
              ) : null}
            </div>
          </section>

          <section className="mode-dock viewport-dock mobile-viewport-dock" style={dockStyle}>
            <div className="mobile-dock-shell" ref={dockToolbarRef}>
              {showMobileTouchToggle ? (
                <div className="touch-toggle mobile-touch-toggle-compact" aria-label="Touch point type selector">
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

              <div className="mobile-quick-toolbar">
                <ToolButton
                  className="mobile-quick-tool"
                  isActive={isMoveMode}
                  label="Move / Edit"
                  hotkey="V"
                  icon={<MoveToolIcon />}
                  tooltipProps={getToolbarTooltipProps('Move / Edit', 'V')}
                  onClick={() => handleEditorModeChange(EDITOR_MODE_SELECT)}
                />
                <ToolButton
                  className="mobile-quick-tool"
                  isActive={activeEditorMode === EDITOR_MODE_DRAW}
                  label="Draw"
                  hotkey="D"
                  icon={<DrawToolIcon />}
                  tooltipProps={getToolbarTooltipProps('Draw', 'D')}
                  onClick={() => handleEditorModeChange(EDITOR_MODE_DRAW)}
                />
                {isMobileDrawMode ? (
                  <ShapePresetDropdown
                    className="mobile-quick-shape"
                    currentShape={currentShapePresetOption.value}
                    getTooltipProps={getToolbarTooltipProps}
                    isOpen={isShapePresetMenuOpen}
                    menuRef={shapePresetRef}
                    polygonSides={polygonSides}
                    onInsertShape={handleInsertPresetShape}
                    onPolygonSidesChange={handlePolygonSidesChange}
                    onToggle={handleShapePresetToggle}
                  />
                ) : null}
                {isFinishShapeReady ? (
                  <DockActionButton
                    className="mobile-quick-action mobile-scene-action-finish is-ready"
                    disabled={!canCommitDraft}
                    icon={<FinishFlagIcon />}
                    label="Finish Shape"
                    onClick={handleCommitDraftShape}
                    tooltipProps={getToolbarTooltipProps('Finish Shape', '')}
                  />
                ) : null}
                {!isFinishShapeReady && isMobileDrawMode && hasDraftPoints ? (
                  <DockActionButton
                    className="mobile-quick-action"
                    disabled={false}
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
                ) : null}
                {!isMobileDrawMode && canDeleteAnything ? (
                  <DockActionButton
                    className="mobile-quick-action is-danger"
                    disabled={false}
                    icon={<DeleteSelectedIcon />}
                    label="Delete Selected"
                    onClick={handleDeleteSelectedShapes}
                    tooltipProps={getToolbarTooltipProps('Delete Selected', '')}
                  />
                ) : null}
                <ToolButton
                  className="mobile-quick-tool mobile-menu-button"
                  isActive={mobilePanel === 'menu'}
                  label="Menu"
                  hotkey=""
                  icon={<MenuIcon />}
                  tooltipProps={getToolbarTooltipProps('Menu', '')}
                  onClick={() => toggleMobilePanel('menu')}
                />
              </div>
            </div>
          </section>
        </>
      ) : (
        <section className="mode-dock viewport-dock desktop-viewport-dock" style={dockStyle}>
          <div className="dock-controls dock-toolbar" ref={dockToolbarRef}>
            <div className="tool-cluster tool-cluster-draw">
              <ToolButton
                isActive={isMoveMode}
                label="Move / Edit"
                hotkey="V"
                icon={<MoveToolIcon />}
                tooltipProps={getToolbarTooltipProps('Move / Edit', 'V')}
                onClick={() => handleEditorModeChange(EDITOR_MODE_SELECT)}
              />
              <ToolButton
                isActive={isTransformMode}
                label="Transform"
                hotkey="B"
                icon={<TransformToolIcon />}
                tooltipProps={getToolbarTooltipProps('Transform', 'B')}
                onClick={() => handleEditorModeChange(EDITOR_MODE_TRANSFORM)}
              />
              <DestroyToolButton
                brushCells={destroyBrushCells}
                brushStepIndex={destroyBrushStepIndex}
                brushSteps={DESTROY_BRUSH_STEPS}
                getTooltipProps={getToolbarTooltipProps}
                isActive={isDestroyMode}
                isOpen={isDestroyBrushMenuOpen}
                menuRef={destroyBrushRef}
                onBrushSizeChange={handleDestroyBrushSizeChange}
                onClick={() => handleEditorModeChange(EDITOR_MODE_DESTROY)}
                onContextMenu={handleDestroyBrushContextMenu}
              />
              <ToolButton
                isActive={activeEditorMode === EDITOR_MODE_DRAW}
                label="Draw"
                hotkey="D"
                icon={<DrawToolIcon />}
                tooltipProps={getToolbarTooltipProps('Draw', 'D')}
                onClick={() => handleEditorModeChange(EDITOR_MODE_DRAW)}
              />
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
            </div>

            <div className="tool-separator" />

            <div className="tool-cluster tool-cluster-mode">
              <div className="tool-chip-group" aria-label="Draw mode selector">
                <button
                  type="button"
                  className={`classic-toggle ${drawingState.mode === DRAW_MODE_CLASSIC ? 'is-active' : ''}`}
                  aria-label="Classic Lasso (1)"
                  onClick={() => handleDrawModeChange(DRAW_MODE_CLASSIC)}
                  {...getToolbarTooltipProps('Classic Lasso', '1')}
                >
                  <span className="tool-button-icon" aria-hidden="true">
                    <ClassicLassoModeIcon />
                  </span>
                </button>
                <button
                  type="button"
                  className={drawingState.mode === DRAW_MODE_DUAL ? 'is-active' : ''}
                  aria-label="Dual-Point (2)"
                  onClick={() => handleDrawModeChange(DRAW_MODE_DUAL)}
                  {...getToolbarTooltipProps('Dual-Point', '2')}
                >
                  <span className="tool-button-icon" aria-hidden="true">
                    <DualPointModeIcon />
                  </span>
                </button>
              </div>
            </div>

            <div className="tool-separator" />

            <div className="tool-cluster tool-cluster-grid">
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

            <div className="tool-separator" />

            <div className="tool-cluster tool-cluster-system">
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
                className="preferences-tool"
                label="Preferences"
                hotkey="P"
                icon={<PreferencesIcon />}
                tooltipProps={getToolbarTooltipProps('Preferences', 'P')}
                onClick={() => openPreferencesPanel(PREFERENCES_TAB_TOOLS)}
              />
            </div>

            <div className="mobile-scene-actions" aria-label="Scene actions">
              {showTouchControls &&
              isAbstractDualPoint &&
              !isClassicMode &&
              activeEditorMode === EDITOR_MODE_DRAW ? (
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
                ? 'Restore Previous Theme (T)'
                : 'Garfield Theme (T)'
            }
            aria-pressed={theme === THEME_GARFIELD}
            onClick={handleThemeToggle}
            {...getToolbarTooltipProps(
              theme === THEME_GARFIELD ? 'Restore Previous Theme' : 'Garfield Theme',
              'T',
            )}
          >
            <img className="cat-mascot" src={afCatLogo} alt="" />
          </button>
        </section>
      )}

      <ToolbarTooltip {...toolbarTooltip} />

        <ViewportContextMenu
          canCopy={canCopySelection}
          canDelete={canDeleteSelection}
          canJump={selectedShapes.length > 0}
          canPaste={hasClipboardShapes}
          canUngroup={canUngroupSelection}
          isOpen={viewportContextMenu.isOpen}
          menuRef={contextMenuRef}
          onCopy={handleCopySelectedShapes}
          onCut={handleCutSelectedShapes}
          onDelete={handleDeleteSelectedShapes}
          onJump={handleJumpToSelection}
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
      <PreferencesOverlay
        activeTab={preferencesTab}
        appearance={appearance}
        customThemeColors={customUiTheme}
        dualPointBehavior={dualPointBehavior}
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
        onCustomThemeColorChange={handleCustomThemeColorChange}
        onDualPointBehaviorChange={handleDualPointBehaviorChange}
        onNeonShapesChange={handleNeonShapesChange}
        onTabChange={setPreferencesTab}
        onThemePresetChange={handleThemePresetChange}
        theme={theme}
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
  onContextMenu,
  tooltipProps,
}) {
  return (
    <button
      type="button"
      className={`tool-button ${isActive ? 'is-active' : ''} ${className}`.trim()}
      aria-label={hotkey ? `${label} (${hotkey})` : label}
      disabled={disabled}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
  className = '',
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
    <div className={`shape-preset-shell ${className}`.trim()} ref={menuRef}>
      <button
        type="button"
        className={`shape-preset-trigger ${isOpen ? 'is-open' : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Shape Presets (Q)"
        onClick={onToggle}
        {...getTooltipProps('Shape Presets', 'Q')}
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

function DestroyToolButton({
  brushCells,
  brushStepIndex,
  brushSteps,
  getTooltipProps,
  isActive = false,
  isOpen = false,
  menuRef,
  onBrushSizeChange,
  onClick,
  onContextMenu,
}) {
  return (
    <div className="destroy-tool-shell" ref={menuRef}>
      <ToolButton
        isActive={isActive}
        label="Shape Destroyer"
        hotkey="X"
        icon={<DestroyToolIcon />}
        tooltipProps={getTooltipProps('Shape Destroyer / RMB size', 'X')}
        onClick={onClick}
        onContextMenu={onContextMenu}
      />
      {isOpen ? (
        <div className="destroy-brush-menu" role="dialog" aria-label="Shape Destroyer size">
          <div className="destroy-brush-menu-header">
            <span className="shape-preset-meta">Shape Destroyer</span>
            <span className="destroy-brush-size-readout">{brushCells} x {brushCells}</span>
          </div>
          <input
            className="destroy-brush-slider"
            type="range"
            min="0"
            max={String(Math.max(0, brushSteps.length - 1))}
            step="1"
            value={brushStepIndex}
            onChange={onBrushSizeChange}
          />
          <div className="destroy-brush-steps" aria-hidden="true">
            {brushSteps.map((step) => (
              <span
                key={step}
                className={`destroy-brush-step ${step === brushCells ? 'is-active' : ''}`.trim()}
              >
                {step}
              </span>
            ))}
          </div>
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
  canJump,
  canPaste,
  canUngroup,
  isOpen,
  menuRef,
  onCopy,
  onCut,
  onDelete,
  onJump,
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
      <ContextMenuItem disabled={!canJump} hint="" label="Jump2" onClick={onJump} />
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
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M4.15 2.2v13.1l3.72-2.2 2.27 4.7 2.2-1.04-2.22-4.58 5.33-.46L4.15 2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function TransformToolIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect
        x="4.1"
        y="4.1"
        width="11.8"
        height="11.8"
        rx="0.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="4.1" cy="4.1" r="1.1" fill="currentColor" />
      <circle cx="15.9" cy="4.1" r="1.1" fill="currentColor" />
      <circle cx="15.9" cy="15.9" r="1.1" fill="currentColor" />
      <circle cx="4.1" cy="15.9" r="1.1" fill="currentColor" />
    </svg>
  );
}

function DestroyToolIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M5 6.1 9.5 2.8l7.2 7.2-3.3 4.5H8.8L5 11.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <path
        d="M9.1 14.5h5.8M8 11.2h5.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="M4.2 15.8h11.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        opacity="0.58"
      />
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

function MenuIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.25h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 11.75h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

function AlignLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 2.5v11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="5.3" y="3.8" width="6.7" height="2.8" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5.3" y="9.4" width="4.8" height="2.8" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function AlignRightIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13 2.5v11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="4" y="3.8" width="6.7" height="2.8" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5.9" y="9.4" width="4.8" height="2.8" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function AlignTopIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="3.8" y="5.3" width="2.8" height="6.7" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.4" y="5.3" width="2.8" height="4.8" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function AlignBottomIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 13h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="3.8" y="4" width="2.8" height="6.7" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9.4" y="5.9" width="2.8" height="4.8" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
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

function PreferencesIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 3.4 11.1 2l2 1 .2 2a5.8 5.8 0 0 1 1.2.7l1.9-.8 1.2 1.8-1.4 1.5c.12.39.18.8.18 1.2s-.06.81-.18 1.2l1.4 1.5-1.2 1.8-1.9-.8c-.37.3-.77.53-1.2.7l-.2 2-2 1L10 16.6l-1.1 1.4-2-1-.2-2a5.8 5.8 0 0 1-1.2-.7l-1.9.8-1.2-1.8 1.4-1.5A4.1 4.1 0 0 1 3.7 10c0-.41.06-.81.18-1.2L2.5 7.3l1.2-1.8 1.9.8c.37-.3.77-.53 1.2-.7l.2-2 2-1L10 3.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.35" />
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

  if (mode === EDITOR_MODE_DESTROY) {
    return 'Destroy';
  }

  if (mode === EDITOR_MODE_TRANSFORM) {
    return 'Transform';
  }

  return 'Draw';
}

function getHowToBallContent({
  activeEditorMode,
  canCommitDraft,
  canEditVertices,
  classicPointCount,
  dualPointBehavior,
  expectedKind,
  hasDraftPoints,
  isClassicMode,
  selectedHandleCount,
  selectedShapeCount,
  showTouchControls,
  touchMode,
  touchModeMismatch,
}) {
  if (activeEditorMode === EDITOR_MODE_DESTROY) {
    return {
      isWarning: false,
      items: limitHowToBallItems([
        createHowToBallItem('destroy-drag', ['Drag'], 'carve shapes with the square brush'),
        createHowToBallItem('destroy-size', ['RMB Tool'], 'open the brush-size slider above the icon'),
        createHowToBallItem('destroy-wheel', ['Wheel'], 'zoom the viewport'),
        createHowToBallItem('destroy-pan', ['Space', 'LMB'], 'move around canvas'),
      ]),
      status:
        selectedShapeCount > 0
          ? 'Destroy mode is live. Drag across the canvas to chew through shapes, including the current selection.'
          : 'Destroy mode is armed. Drag over any shape to erase it with square brush stamps.',
    };
  }

  if (activeEditorMode === EDITOR_MODE_TRANSFORM) {
    return {
      isWarning: false,
      items: limitHowToBallItems([
        createHowToBallItem('transform-drag-shape', ['Drag Shape'], 'move the current selection'),
        createHowToBallItem('transform-drag-box', ['Drag Handle'], 'scale the selection from the bbox'),
        createHowToBallItem('transform-mirror', ['Mirror X/Y'], 'flip the selection from the popup'),
        createHowToBallItem('transform-wheel', ['Wheel'], 'zoom the viewport'),
        createHowToBallItem('transform-pan', ['Space', 'LMB'], 'move around canvas'),
      ]),
      status:
        selectedShapeCount > 0
          ? 'Transform mode is live. Drag the bbox handles or tap Mirror X / Mirror Y under the selection.'
          : 'Transform mode is armed. Select a shape to spawn the bounding box.',
    };
  }

  if (activeEditorMode === EDITOR_MODE_SELECT) {
    if (selectedHandleCount > 0) {
      return {
        isWarning: false,
        items: limitHowToBallItems([
          createHowToBallItem('move-handle-drag', ['Drag Point'], 'move the selected vertex set'),
          createHowToBallItem('move-point-add', ['Shift', 'Click Point'], 'stack more vertices into the selection'),
          createHowToBallItem('move-handle-delete', ['Delete'], 'remove the selected vertices and reclose the contour'),
          createHowToBallItem('move-wheel', ['Wheel'], 'zoom the viewport'),
          createHowToBallItem('move-pan', ['Space', 'LMB'], 'move around canvas'),
        ]),
        status:
          selectedHandleCount === 1
            ? '1 point is armed. Drag it to reshape the contour, or hit Delete to cut it out.'
            : `${selectedHandleCount} points are armed. Drag them together or delete them in one hit.`,
      };
    }

    if (selectedShapeCount > 1) {
      return {
        isWarning: false,
        items: limitHowToBallItems([
          createHowToBallItem('move-drag-shapes', ['Drag Shape'], 'move the whole selection'),
          createHowToBallItem('move-alt-drag', ['Alt', 'Drag'], 'duplicate the set while dragging'),
          createHowToBallItem('move-duplicate', ['Ctrl/Cmd', 'D'], 'repeat the last duplicate step'),
          createHowToBallItem('move-delete', ['Delete'], 'remove the current selection'),
          createHowToBallItem('move-arrows', ['Arrows'], 'nudge the selection by the grid'),
        ]),
        status: `${selectedShapeCount} shapes are selected. Drag one to move the set, or duplicate it in formation.`,
      };
    }

    if (selectedShapeCount === 1) {
      return {
        isWarning: false,
        items: limitHowToBallItems([
          createHowToBallItem('move-drag-shape', ['Drag Shape'], 'move the active shape'),
          ...(canEditVertices
            ? [
                createHowToBallItem('move-point', ['Click Point'], 'grab a vertex on the active shape'),
                createHowToBallItem('move-point-add', ['Shift', 'Click Point'], 'add more vertices to the point selection'),
              ]
            : []),
          createHowToBallItem('move-alt-drag', ['Alt', 'Drag'], 'duplicate while dragging'),
          createHowToBallItem('move-duplicate', ['Ctrl/Cmd', 'D'], 'repeat the last duplicate step'),
          createHowToBallItem('move-delete', ['Delete'], 'remove the active shape'),
        ]),
        status: canEditVertices
          ? '1 shape is active. Drag it, grab its points, or duplicate it on pull.'
          : '1 shape is active. Drag it, duplicate it, or delete it.',
      };
    }

    return {
      isWarning: false,
      items: limitHowToBallItems([
        createHowToBallItem('move-click', ['Click'], 'pick a shape on the canvas'),
        createHowToBallItem('move-lasso', ['Drag'], 'lasso-select a group from empty space'),
        createHowToBallItem('move-wheel', ['Wheel'], 'zoom the viewport'),
        createHowToBallItem('move-pan', ['Space', 'LMB'], 'move around canvas'),
      ]),
      status: 'No selection yet. Click a shape, or drag across empty space to lasso a set.',
    };
  }

  if (isClassicMode) {
    return {
      isWarning: false,
      items: limitHowToBallItems([
        ...(canCommitDraft
          ? [createHowToBallItem('classic-finish', ['Finish'], 'commit the closed contour')]
          : []),
        createHowToBallItem(
          'classic-place',
          ['LMB'],
          classicPointCount === 0 ? 'drop the first vertex' : 'drop the next vertex',
        ),
        ...(hasDraftPoints
          ? [
              createHowToBallItem('classic-undo', ['Ctrl/Cmd', 'Z'], 'undo the last vertex'),
              createHowToBallItem('classic-clear', ['Esc'], 'clear the current draft'),
            ]
          : []),
        createHowToBallItem('classic-wheel', ['Wheel'], 'zoom the viewport'),
        createHowToBallItem('classic-pan', ['Space', 'LMB'], 'move around canvas'),
      ]),
      status: canCommitDraft
        ? 'Classic contour is closed and ready for Finish Shape.'
        : classicPointCount === 0
          ? 'Classic lasso is empty. Drop the first vertex to start the contour.'
          : `Classic contour in progress: ${classicPointCount} vertices are already down.`,
    };
  }

  if (dualPointBehavior === DUAL_POINT_BEHAVIOR_SEQUENTIAL) {
    const nextPointLabel = expectedKind === POINT_KIND_B ? 'Point 2' : 'Point 1';

    return {
      isWarning: false,
      items: limitHowToBallItems([
        ...(canCommitDraft
          ? [createHowToBallItem('dual-seq-finish', ['Finish'], 'commit the closed dual-point shape')]
          : []),
        createHowToBallItem('dual-seq-place', ['LMB'], `place ${nextPointLabel}`),
        ...(hasDraftPoints
          ? [
              createHowToBallItem('dual-seq-undo', ['Ctrl/Cmd', 'Z'], 'undo the last point'),
              createHowToBallItem('dual-seq-clear', ['Esc'], 'clear the current draft'),
            ]
          : []),
        createHowToBallItem('dual-seq-wheel', ['Wheel'], 'zoom the viewport'),
        createHowToBallItem('dual-seq-pan', ['Space', 'LMB'], 'move around canvas'),
      ]),
      status: canCommitDraft
        ? 'Sequential dual-point is closed. Finish Shape will commit it.'
        : `Sequential dual-point is live: the next left click places ${nextPointLabel}.`,
    };
  }

  if (showTouchControls) {
    const activeLane = (touchMode ?? POINT_KIND_A).toUpperCase();
    const nextLane = expectedKind === POINT_KIND_B ? 'P2' : 'P1';

    return {
      isWarning: touchModeMismatch,
      items: limitHowToBallItems([
        ...(canCommitDraft
          ? [createHowToBallItem('dual-touch-finish', ['Finish'], 'commit the closed draft')]
          : []),
        createHowToBallItem('dual-touch-mode', ['P1', 'P2'], 'pick the active lane'),
        createHowToBallItem('dual-touch-place', ['Tap'], 'drop the active point'),
        ...(hasDraftPoints
          ? [createHowToBallItem('dual-touch-undo', ['Ctrl/Cmd', 'Z'], 'undo the last point')]
          : []),
      ]),
      status: touchModeMismatch
        ? `${nextLane} is the next legal lane. Switch before the next tap.`
        : `Abstract dual-point is live. ${activeLane} is armed right now.`,
    };
  }

  return {
    isWarning: false,
    items: limitHowToBallItems([
      ...(canCommitDraft
        ? [createHowToBallItem('dual-abs-finish', ['Finish'], 'commit the closed draft')]
        : []),
      createHowToBallItem('dual-p1', ['LMB'], 'place Point 1'),
      createHowToBallItem('dual-p2', ['RMB'], 'place Point 2'),
      ...(hasDraftPoints
        ? [createHowToBallItem('dual-undo', ['Ctrl/Cmd', 'Z'], 'undo the last point')]
        : []),
      createHowToBallItem('dual-wheel', ['Wheel'], 'zoom the viewport'),
      createHowToBallItem('dual-pan', ['Space', 'LMB'], 'move around canvas'),
    ]),
    status: canCommitDraft
      ? 'Abstract dual-point is closed. Finish Shape will commit it.'
      : expectedKind === POINT_KIND_B
        ? 'Abstract dual-point is live: Point 2 is the next legal click.'
        : 'Abstract dual-point is live: Point 1 is the next legal click.',
  };
}

function createHowToBallItem(id, keys, label) {
  return { id, keys, label };
}

function limitHowToBallItems(items, maxItems = 5) {
  return (items ?? []).filter(Boolean).slice(0, maxItems);
}

function normalizeEditorMode(editorMode) {
  if (editorMode === EDITOR_MODE_SELECT) {
    return EDITOR_MODE_SELECT;
  }

  if (editorMode === EDITOR_MODE_DESTROY) {
    return EDITOR_MODE_DESTROY;
  }

  if (editorMode === EDITOR_MODE_TRANSFORM) {
    return EDITOR_MODE_TRANSFORM;
  }

  if (editorMode === EDITOR_MODE_EDIT) {
    return EDITOR_MODE_SELECT;
  }

  if (editorMode === 'lasso-select') {
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

function resolvePlacedPointKind(state, requestedKind, dualPointBehavior) {
  if (state?.mode !== DRAW_MODE_DUAL || dualPointBehavior !== DUAL_POINT_BEHAVIOR_SEQUENTIAL) {
    return requestedKind;
  }

  return getExpectedKind(state) ?? POINT_KIND_A;
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

function getEffectiveDuplicateDelta(surfaceSize, lastDuplicateDelta) {
  if (hasMeaningfulDelta(lastDuplicateDelta)) {
    return {
      x: Number(lastDuplicateDelta.x),
      y: Number(lastDuplicateDelta.y),
    };
  }

  const stepPx = GRID_STEP_PX;

  return {
    x: stepPx / Math.max(surfaceSize.width, 1),
    y: stepPx / Math.max(surfaceSize.height, 1),
  };
}

function hasMeaningfulDelta(delta) {
  if (!delta) {
    return false;
  }

  return Math.abs(Number(delta.x) || 0) > Number.EPSILON || Math.abs(Number(delta.y) || 0) > Number.EPSILON;
}

function getViewportContextMenuPosition(clientX, clientY) {
  if (typeof window === 'undefined') {
    return { x: clientX, y: clientY };
  }

  const inset = 12;
  const width = 220;
  const height = 232;

  return {
    x: Math.min(window.innerWidth - width - inset, Math.max(inset, clientX)),
    y: Math.min(window.innerHeight - height - inset, Math.max(inset, clientY)),
  };
}

function getShapesBounds(shapes = []) {
  if (!shapes.length) {
    return null;
  }

  return shapes
    .map((shape) => getShapeBounds(shape))
    .reduce(
      (bounds, shapeBounds) => ({
        minX: Math.min(bounds.minX, shapeBounds.minX),
        maxX: Math.max(bounds.maxX, shapeBounds.maxX),
        minY: Math.min(bounds.minY, shapeBounds.minY),
        maxY: Math.max(bounds.maxY, shapeBounds.maxY),
      }),
      {
        minX: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      },
    );
}

function getDestroyBrushStepIndex(brushCells) {
  const exactIndex = DESTROY_BRUSH_STEPS.indexOf(Number(brushCells));

  if (exactIndex >= 0) {
    return exactIndex;
  }

  return DESTROY_BRUSH_STEPS.reduce(
    (bestIndex, step, index) =>
      Math.abs(step - brushCells) < Math.abs(DESTROY_BRUSH_STEPS[bestIndex] - brushCells)
        ? index
        : bestIndex,
    0,
  );
}

function clampDestroyBrushStepIndex(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed)) {
    return 0;
  }

  return Math.min(DESTROY_BRUSH_STEPS.length - 1, Math.max(0, parsed));
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
  customUiTheme,
  dualPointBehavior,
  drawingState,
  editorMode,
  selectedHandleIds,
  selectedShapeIds,
  shapes,
  snapToGrid,
  theme,
}) {
  return cloneHistoryValue(
    createLiveSnapshot({
      appearance,
      customUiTheme,
      dualPointBehavior,
      drawingState,
      editorMode,
      selectedHandleIds,
      selectedShapeIds,
      shapes,
      snapToGrid,
      theme,
    }),
  );
}

function createLiveSnapshot({
  appearance,
  customUiTheme,
  dualPointBehavior,
  drawingState,
  editorMode,
  selectedHandleIds,
  selectedShapeIds,
  shapes,
  snapToGrid,
  theme,
}) {
  return {
    appearance,
    customUiTheme,
    dualPointBehavior,
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
  };
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
