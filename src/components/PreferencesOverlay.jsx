function PreferencesOverlay({
  activeTab,
  appearance,
  customThemeColors,
  dualPointBehavior,
  isOpen,
  onClose,
  onCustomThemeColorChange,
  onDualPointBehaviorChange,
  onNeonShapesChange,
  onTabChange,
  onThemePresetChange,
  theme,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="overlay-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <section
        aria-label="Preferences"
        className="overlay-panel preferences-overlay"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overlay-header">
          <div className="preferences-header-copy">
            <p className="eyebrow">Preferences</p>
            <h2>App Settings</h2>
          </div>

          <button type="button" className="close-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="preferences-tabs" role="tablist" aria-label="Preferences tabs">
          <button
            type="button"
            className={activeTab === 'tools' ? 'is-active' : ''}
            onClick={() => onTabChange('tools')}
            role="tab"
          >
            Tools
          </button>
          <button
            type="button"
            className={activeTab === 'ui-theme' ? 'is-active' : ''}
            onClick={() => onTabChange('ui-theme')}
            role="tab"
          >
            UI Theme
          </button>
          <button
            type="button"
            className={activeTab === 'about' ? 'is-active' : ''}
            onClick={() => onTabChange('about')}
            role="tab"
          >
            About
          </button>
        </div>

        {activeTab === 'tools' ? (
          <div className="preferences-section">
            <section className="preferences-card">
              <div className="section-head">
                <p className="section-label">Dual-Point Behavior</p>
              </div>

              <div className="preferences-mode-grid">
                <button
                  type="button"
                  className={`preferences-mode-button ${dualPointBehavior === 'sequential' ? 'is-active' : ''}`}
                  onClick={() => onDualPointBehaviorChange('sequential')}
                >
                  <span className="preferences-mode-title">Sequential</span>
                  <span className="card-note">
                    Simple mode. Just keep clicking with left mouse or tap:
                    first Point 1, then Point 2, then Point 1 again.
                  </span>
                </button>

                <button
                  type="button"
                  className={`preferences-mode-button ${dualPointBehavior === 'abstract' ? 'is-active' : ''}`}
                  onClick={() => onDualPointBehaviorChange('abstract')}
                >
                  <span className="preferences-mode-title">Abstract</span>
                  <span className="card-note">
                    Manual mode. Left click places Point 1, right click places Point 2.
                    On touch, switch between P1 and P2 yourself.
                  </span>
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'ui-theme' ? (
          <div className="preferences-section">
            <section className="preferences-card">
              <div className="section-head">
                <p className="section-label">Preset</p>
              </div>

              <div className="preferences-preset-grid">
                <PreferencePresetButton
                  isActive={theme === 'mono'}
                  label="Default"
                  onClick={() => onThemePresetChange('mono')}
                />
                <PreferencePresetButton
                  isActive={theme === 'nightcracker'}
                  label="NightCracker"
                  onClick={() => onThemePresetChange('nightcracker')}
                />
                <PreferencePresetButton
                  isActive={theme === 'garfield'}
                  label="Garf"
                  onClick={() => onThemePresetChange('garfield')}
                />
                <PreferencePresetButton
                  isActive={theme === 'custom'}
                  label="Custom"
                  onClick={() => onThemePresetChange('custom')}
                />
              </div>
            </section>

            <section className="preferences-card">
              <div className="section-head">
                <p className="section-label">Canvas Glow</p>
              </div>

              <div className="preferences-mode-grid">
                <button
                  type="button"
                  className={`preferences-mode-button ${!appearance.neonShapes ? 'is-active' : ''}`}
                  onClick={() => onNeonShapesChange(false)}
                >
                  <span className="preferences-mode-title">Default</span>
                  <span className="card-note">
                    Keep figure strokes clean and flat, without the panel neon bloom.
                  </span>
                </button>

                <button
                  type="button"
                  className={`preferences-mode-button ${appearance.neonShapes ? 'is-active' : ''}`}
                  onClick={() => onNeonShapesChange(true)}
                >
                  <span className="preferences-mode-title">Panel Neon</span>
                  <span className="card-note">
                    Figures on the canvas get the same green retro glow vibe as the logo in the right header.
                  </span>
                </button>
              </div>
            </section>

            <section className="preferences-card">
              <div className="section-head">
                <p className="section-label">UI Color</p>
              </div>

              <div className="preferences-color-grid">
                <PreferenceColorField
                  label="Background"
                  value={customThemeColors.background}
                  onChange={(value) => onCustomThemeColorChange('background', value)}
                />
                <PreferenceColorField
                  label="Surface"
                  value={customThemeColors.surface}
                  onChange={(value) => onCustomThemeColorChange('surface', value)}
                />
                <PreferenceColorField
                  label="Panel"
                  value={customThemeColors.panel}
                  onChange={(value) => onCustomThemeColorChange('panel', value)}
                />
                <PreferenceColorField
                  label="Text"
                  value={customThemeColors.text}
                  onChange={(value) => onCustomThemeColorChange('text', value)}
                />
                <PreferenceColorField
                  label="Buttons"
                  value={customThemeColors.button}
                  onChange={(value) => onCustomThemeColorChange('button', value)}
                />
                <PreferenceColorField
                  label="Accent"
                  value={customThemeColors.accent}
                  onChange={(value) => onCustomThemeColorChange('accent', value)}
                />
              </div>

              <p className="card-note">
                Editing any color switches the active preset to Custom.
              </p>
            </section>
          </div>
        ) : null}

        {activeTab === 'about' ? (
          <div className="preferences-section">
            <section className="preferences-card">
              <div className="section-head">
                <p className="section-label">Channels</p>
              </div>

              <div className="about-links">
                <a
                  className="about-link-card"
                  href="https://t.me/metalstressed"
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="about-link-label">Author</span>
                  <strong>@metalstressed</strong>
                  <span className="card-note">creator channel</span>
                </a>

                <a
                  className="about-link-card"
                  href="https://t.me/abstfest"
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="about-link-label">Festival</span>
                  <strong>@abstfest</strong>
                  <span className="card-note">канал Абстрактного Фестиваля</span>
                </a>
              </div>
            </section>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function PreferencePresetButton({ isActive = false, label, onClick }) {
  return (
    <button
      type="button"
      className={`preferences-preset-button ${isActive ? 'is-active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function PreferenceColorField({ label, onChange, value }) {
  return (
    <label className="color-field">
      <span className="field-label">{label}</span>
      <span className="color-input-shell">
        <input
          className="native-color"
          onChange={(event) => onChange(event.target.value)}
          type="color"
          value={value}
        />
        <span className="color-swatch" aria-hidden="true" style={{ backgroundColor: value }} />
        <span className="color-value">{value.toUpperCase()}</span>
      </span>
    </label>
  );
}

export default PreferencesOverlay;
