import { useEffect, useState } from 'react';
import { DRAW_MODE_CLASSIC } from '../lib/lasso.js';
import { EXPORT_FORMAT_PNG, EXPORT_FORMAT_SVG } from '../lib/rendering.js';

function ExportOverlay({
  appearance,
  defaultScope = 'scene',
  hasSelectionExport = false,
  isOpen,
  mode,
  onClose,
  onExport,
  sceneCount = 0,
  selectionCount = 0,
}) {
  const [scope, setScope] = useState(defaultScope);
  const [includeNeonEffects, setIncludeNeonEffects] = useState(Boolean(appearance?.neonShapes));

  useEffect(() => {
    if (isOpen) {
      setScope(defaultScope);
      setIncludeNeonEffects(Boolean(appearance?.neonShapes));
    }
  }, [appearance?.neonShapes, defaultScope, isOpen]);

  if (!isOpen) {
    return null;
  }

  const modeLabel = mode === DRAW_MODE_CLASSIC ? 'Classic Lasso' : 'Dual-Point';
  const targetLabel =
    scope === 'selection'
      ? `${selectionCount} selected shape${selectionCount === 1 ? '' : 's'}`
      : `${sceneCount} shape${sceneCount === 1 ? '' : 's'} in the current scene`;

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div
        aria-modal="true"
        className="overlay-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="overlay-header">
          <div>
            <p className="eyebrow">Export</p>
            <h2>Download the current {modeLabel} work as PNG or SVG.</h2>
            <p className="card-note">Target: {targetLabel}.</p>
          </div>

          <button type="button" className="close-button" onClick={onClose}>
            Close
          </button>
        </div>

        {hasSelectionExport ? (
          <div className="overlay-scope">
            <p className="section-label">Export Target</p>
            <div className="segmented-control" aria-label="Export scope selector">
              <button
                type="button"
                className={scope === 'scene' ? 'is-active' : ''}
                onClick={() => setScope('scene')}
              >
                Full Scene
              </button>
              <button
                type="button"
                className={scope === 'selection' ? 'is-active' : ''}
                onClick={() => setScope('selection')}
              >
                Selection
              </button>
            </div>
          </div>
        ) : null}

        <label className="export-toggle">
          <input
            type="checkbox"
            checked={includeNeonEffects}
            onChange={(event) => setIncludeNeonEffects(event.target.checked)}
          />
          <span className="export-toggle-copy">
            <span className="export-toggle-title">Include Neon Glow</span>
            <span className="card-note">
              Export the current shape neon pass instead of only the raw contour and fill colors.
            </span>
          </span>
        </label>

        <div className="overlay-grid">
          <section className="export-option">
            <p className="section-label">PNG</p>
            <p className="card-note">
              Raster export of the current target with the active background, contour, fill, and corner radius.
            </p>
            <div className="swatch-list">
              <Swatch label="Background" value={appearance.background} />
              <Swatch label="Contour" value={appearance.stroke} />
              <Swatch label="Fill" value={appearance.fill} muted={appearance.fillMode === 'outline'} />
            </div>
            <div className="export-actions">
              <button
                type="button"
                className="primary-button export-action"
                onClick={() =>
                  onExport({
                    format: EXPORT_FORMAT_PNG,
                    includeNeonEffects,
                    transparentBackground: false,
                    scope,
                  })
                }
              >
                PNG with Background
              </button>
              <button
                type="button"
                className="secondary-button export-action"
                onClick={() =>
                  onExport({
                    format: EXPORT_FORMAT_PNG,
                    includeNeonEffects,
                    transparentBackground: true,
                    scope,
                  })
                }
              >
                PNG Transparent
              </button>
            </div>
          </section>

          <section className="export-option">
            <p className="section-label">SVG</p>
            <p className="card-note">
              Vector export keeps every contour closed and writes each path with a final <code>Z</code>.
            </p>
            <div className="swatch-list">
              <Swatch label="Background" value={appearance.background} />
              <Swatch label="Contour" value={appearance.stroke} />
              <Swatch label="Fill" value={appearance.fill} muted={appearance.fillMode === 'outline'} />
            </div>
            <div className="export-actions">
              <button
                type="button"
                className="primary-button export-action"
                onClick={() =>
                  onExport({
                    format: EXPORT_FORMAT_SVG,
                    includeNeonEffects,
                    transparentBackground: false,
                    scope,
                  })
                }
              >
                SVG with Background
              </button>
              <button
                type="button"
                className="secondary-button export-action"
                onClick={() =>
                  onExport({
                    format: EXPORT_FORMAT_SVG,
                    includeNeonEffects,
                    transparentBackground: true,
                    scope,
                  })
                }
              >
                SVG Transparent
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Swatch({ label, muted = false, value }) {
  return (
    <div className={`swatch-item ${muted ? 'is-muted' : ''}`}>
      <span className="swatch-label">{label}</span>
      <span className="swatch" style={{ backgroundColor: value }} />
      <span className="swatch-value">{value.toUpperCase()}</span>
    </div>
  );
}

export default ExportOverlay;
