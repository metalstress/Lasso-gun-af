import { formatBooleanOperationLabel } from '../lib/shapes.js';

function LayersSidebar({
  className = '',
  isMobileLayout = false,
  onCloseMobilePanel,
  onContextMenu,
  selectedShapeIds,
  shapes,
  onClearSelection,
  onSelectAllShapes,
  onSelectShape,
  onUngroupShape,
}) {
  const orderedShapes = [...shapes].reverse();
  const selectionSet = new Set(selectedShapeIds);

  return (
    <aside className={`layers-panel ${className}`.trim()}>
      {isMobileLayout ? (
        <div className="mobile-sheet-head">
          <p className="section-label">Layers</p>
          <button
            type="button"
            className="close-button mobile-sheet-close"
            onClick={onCloseMobilePanel}
          >
            Close
          </button>
        </div>
      ) : null}

      <div className="panel-copy layers-header">
        <p className="eyebrow">Layers</p>
      </div>

      <div className="layers-meta">
        <div className="layers-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={shapes.length === 0}
            onClick={onSelectAllShapes}
          >
            Select All
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={selectedShapeIds.length === 0}
            onClick={onClearSelection}
          >
            Clear
          </button>
        </div>
      </div>

      <div
        className="layers-list"
        onContextMenu={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

          onContextMenu?.(null, event);
        }}
      >
        {orderedShapes.length === 0 ? (
          <div
            className="layers-empty"
            onContextMenu={(event) => onContextMenu?.(null, event)}
          >
            <p className="section-label">Empty Scene</p>
            <p className="card-note">Commit a draft with Finish Shape and it will appear here as a layer.</p>
          </div>
        ) : (
          orderedShapes.map((shape) =>
            shape.group ? (
              <GroupLayer
                key={shape.id}
                isSelected={selectionSet.has(shape.id)}
                onContextMenu={onContextMenu}
                onSelectShape={onSelectShape}
                onUngroupShape={onUngroupShape}
                shape={shape}
              />
            ) : (
              <LayerRow
                key={shape.id}
                isSelected={selectionSet.has(shape.id)}
                label={shape.name}
                meta={shape.sourceMode === 'classic' ? 'Classic contour' : 'Shape layer'}
                onClick={(event) => onSelectShape(shape.id, event)}
                onContextMenu={(event) => onContextMenu?.(shape.id, event)}
              />
            ),
          )
        )}
      </div>

      <div className="layers-footer">
        <div className="layers-separator" />

        <div className="status-strip">
          <span className="data-chip">Selected: {selectedShapeIds.length}</span>
          <span className="data-chip">Layers: {shapes.length}</span>
        </div>
      </div>
    </aside>
  );
}

function GroupLayer({ isSelected, onContextMenu, onSelectShape, onUngroupShape, shape }) {
  return (
    <div className={`layer-group ${isSelected ? 'is-selected' : ''}`}>
      <button
        type="button"
        className="layer-group-header"
        onClick={(event) => onSelectShape(shape.id, event)}
        onContextMenu={(event) => onContextMenu?.(shape.id, event)}
      >
        <span className="layer-operation">{formatBooleanOperationLabel(shape.group.operation)}</span>
        <span className="layer-title">{shape.group.name}</span>
        <span className="layer-meta">{shape.group.members.length} source shapes</span>
      </button>

      <div className="layer-group-body">
        <div className="layer-child layer-result">
          <span className="layer-child-label">Result</span>
          <span className="layer-child-value">{shape.name}</span>
        </div>

        <div className="layer-actions">
          <button
            type="button"
            className="secondary-button layer-action-button"
            onClick={() => onUngroupShape?.(shape.id)}
          >
            Ungroup
          </button>
        </div>

        {shape.group.members.map((member) => (
          <div key={`${shape.id}-${member.id}`} className="layer-child">
            <span className="layer-child-label">{member.kind === 'group' ? 'Group' : 'Shape'}</span>
            <span className="layer-child-value">{member.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LayerRow({ isSelected, label, meta, onClick, onContextMenu }) {
  return (
    <button
      type="button"
      className={`layer-row ${isSelected ? 'is-selected' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="layer-title">{label}</span>
      <span className="layer-meta">{meta}</span>
    </button>
  );
}

export default LayersSidebar;
