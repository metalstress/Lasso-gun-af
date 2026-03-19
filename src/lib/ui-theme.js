export const THEME_MONO = 'mono';
export const THEME_NIGHTCRACKER = 'nightcracker';
export const THEME_GARFIELD = 'garfield';
export const THEME_CUSTOM = 'custom';

export const DEFAULT_CUSTOM_UI_THEME = Object.freeze({
  background: '#090909',
  surface: '#151515',
  panel: '#161616',
  text: '#f5f5f5',
  button: '#ffffff',
  accent: '#ffffff',
});

export function getUiThemeStyle(theme, customTheme = DEFAULT_CUSTOM_UI_THEME) {
  const config = resolveThemeConfig(theme, customTheme);

  return {
    '--bg-0': config.background,
    '--bg-1': config.surface,
    '--panel': withAlpha(config.panel, 0.9),
    '--panel-edge': withAlpha(config.text, 0.12),
    '--panel-strong': withAlpha(config.text, 0.18),
    '--text': config.text,
    '--muted': withAlpha(config.text, 0.62),
    '--button': withAlpha(config.button, 0.12),
    '--button-hover': withAlpha(config.button, 0.2),
    '--button-active': withAlpha(config.button, 0.3),
    '--shadow': withAlpha(config.background, 0.46),
    '--accent': config.accent,
    '--accent-contrast': getReadableForeground(config.accent),
    '--accent-soft': withAlpha(config.accent, 0.18),
    '--accent-border': withAlpha(config.accent, 0.34),
    '--dock': withAlpha(config.background, 0.72),
    '--draft-accent': config.draftAccent,
    '--draft-accent-contrast': getReadableForeground(config.draftAccent),
    '--draft-accent-glow': withAlpha(config.draftAccent, 0.34),
    '--panel-mark-opacity': config.panelMarkOpacity,
  };
}

function resolveThemeConfig(theme, customTheme) {
  if (theme === THEME_GARFIELD) {
    return {
      background: '#1a0f08',
      surface: '#44210d',
      panel: '#4f2910',
      text: '#fff4de',
      button: '#ffb55c',
      accent: '#ffb31f',
      draftAccent: '#ffffff',
      panelMarkOpacity: 0.28,
    };
  }

  if (theme === THEME_NIGHTCRACKER) {
    return {
      background: '#000000',
      surface: '#000000',
      panel: '#050505',
      text: '#f4f4f4',
      button: '#2a2a2a',
      accent: '#ffffff',
      draftAccent: '#ffffff',
      panelMarkOpacity: 0.26,
    };
  }

  if (theme === THEME_CUSTOM) {
    const nextTheme = {
      ...DEFAULT_CUSTOM_UI_THEME,
      ...customTheme,
    };

    return {
      background: nextTheme.background,
      surface: nextTheme.surface,
      panel: nextTheme.panel,
      text: nextTheme.text,
      button: nextTheme.button,
      accent: nextTheme.accent,
      draftAccent: nextTheme.accent,
      panelMarkOpacity: 0.24,
    };
  }

  return {
    background: '#090909',
    surface: '#151515',
    panel: '#161616',
    text: '#f5f5f5',
    button: '#ffffff',
    accent: '#ffffff',
    draftAccent: '#c0ff68',
    panelMarkOpacity: 0.22,
  };
}

function withAlpha(hexColor, alpha) {
  const normalized = normalizeHex(hexColor);

  if (!normalized) {
    return `rgba(255, 255, 255, ${alpha})`;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getReadableForeground(hexColor) {
  const normalized = normalizeHex(hexColor);

  if (!normalized) {
    return '#0a0a0a';
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const luminance = red * 0.299 + green * 0.587 + blue * 0.114;

  return luminance > 0.68 ? '#050505' : '#f7f7f7';
}

function normalizeHex(value) {
  const cleaned = String(value ?? '').trim().replace('#', '');
  const normalized =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((item) => `${item}${item}`)
          .join('')
      : cleaned;

  return /^[\da-fA-F]{6}$/.test(normalized) ? normalized : null;
}
