/**
 * Trove design system — single source of truth.
 * Modern, clean, Apple / Linear / Notion-inspired dark theme.
 *
 * All existing exports (colors, TYPE_META, FILTERS, fonts) are preserved
 * for backward compatibility. New tokens are additive.
 */

/* ------------------------------------------------------------------ */
/*  Colors                                                             */
/* ------------------------------------------------------------------ */

export const colors = {
  /* Brand */
  brand: "#f97316",
  brandDim: "rgba(249,115,22,0.6)",
  brandGlow: "rgba(249,115,22,0.10)",
  brandSubtle: "rgba(249,115,22,0.05)",

  /* Accent palette */
  cyan: "#06b6d4",
  cyanDim: "rgba(6,182,212,0.6)",
  cyanGlow: "rgba(6,182,212,0.08)",
  green: "#34d399",
  purple: "#a78bfa",
  yellow: "#fbbf24",
  pink: "#f472b6",

  /* Semantic */
  success: "#34d399",
  error: "#f87171",
  warning: "#fbbf24",
  info: "#60a5fa",

  /* Surfaces */
  bg: "#0a0a0b",
  surface: "rgba(255,255,255,0.04)",
  surfaceHover: "rgba(255,255,255,0.07)",
  surfaceElevated: "rgba(255,255,255,0.06)",
  surfaceModal: "rgba(12,12,14,0.98)",

  /* Borders */
  border: "rgba(255,255,255,0.06)",
  borderHover: "rgba(255,255,255,0.10)",
  borderSubtle: "rgba(255,255,255,0.03)",
  borderFocus: "rgba(249,115,22,0.4)",

  /* Typography */
  text: "#f0f0f0",
  textMuted: "#8b8b8b",
  textDim: "#636363",
  textGhost: "#404040",
  textDark: "#333",
} as const;

/* ------------------------------------------------------------------ */
/*  Gradients                                                          */
/* ------------------------------------------------------------------ */

export const gradients = {
  brand: `linear-gradient(135deg, ${colors.brand} 0%, #fb923c 100%)`,
  brandSubtle: `linear-gradient(135deg, rgba(249,115,22,0.10) 0%, rgba(251,146,60,0.03) 100%)`,
  cyan: `linear-gradient(135deg, ${colors.cyan} 0%, #22d3ee 100%)`,
  surface: `linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.005) 100%)`,
  glow: `radial-gradient(ellipse at 50% 0%, rgba(249,115,22,0.05) 0%, transparent 70%)`,
  noise: `linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.2) 100%)`,
} as const;

/* ------------------------------------------------------------------ */
/*  Shadows                                                            */
/* ------------------------------------------------------------------ */

export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.2), 0 1px 3px rgba(0,0,0,0.1)",
  md: "0 4px 12px rgba(0,0,0,0.25), 0 1px 4px rgba(0,0,0,0.15)",
  lg: "0 12px 40px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.2)",
  glow: `0 0 24px rgba(249,115,22,0.08), 0 0 64px rgba(249,115,22,0.03)`,
  glowCyan: `0 0 24px rgba(6,182,212,0.08), 0 0 64px rgba(6,182,212,0.03)`,
  inset: "inset 0 1px 0 rgba(255,255,255,0.03)",
} as const;

/* ------------------------------------------------------------------ */
/*  Spacing scale                                                      */
/* ------------------------------------------------------------------ */

export const spacing = {
  xxs: "2px",
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
  xxl: "48px",
  xxxl: "64px",
} as const;

/* ------------------------------------------------------------------ */
/*  Border radius                                                      */
/* ------------------------------------------------------------------ */

export const radii = {
  sm: "6px",
  md: "10px",
  lg: "14px",
  xl: "20px",
  full: "9999px",
} as const;

/* ------------------------------------------------------------------ */
/*  Transitions                                                        */
/* ------------------------------------------------------------------ */

export const transitions = {
  fast: "150ms cubic-bezier(0.25, 0.1, 0.25, 1)",
  normal: "250ms cubic-bezier(0.25, 0.1, 0.25, 1)",
  slow: "400ms cubic-bezier(0.25, 0.1, 0.25, 1)",
  spring: "550ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  bounce: "650ms cubic-bezier(0.68, -0.55, 0.265, 1.55)",
} as const;

/* ------------------------------------------------------------------ */
/*  Z-index scale                                                      */
/* ------------------------------------------------------------------ */

export const zIndex = {
  base: 0,
  dropdown: 100,
  sticky: 200,
  overlay: 300,
  modal: 400,
  modalOverlay: 450,
  popover: 500,
  toast: 600,
  tooltip: 700,
  command: 800,
  commandOverlay: 810,
  boot: 900,
  max: 999,
} as const;

/* ------------------------------------------------------------------ */
/*  Fonts                                                              */
/* ------------------------------------------------------------------ */

export const fonts = {
  mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', 'Courier New', monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  display: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
} as const;

/* ------------------------------------------------------------------ */
/*  Type / content metadata                                            */
/* ------------------------------------------------------------------ */

export const TYPE_META: Record<
  string,
  { icon: string; color: string; label: string; bgGlow?: string }
> = {
  github: {
    icon: "\u{1F419}",
    color: "#e09050",
    label: "GitHub",
    bgGlow: "rgba(249,115,22,0.05)",
  },
  image: {
    icon: "\u{1F5BC}\uFE0F",
    color: "#5eadb8",
    label: "Image",
    bgGlow: "rgba(6,182,212,0.05)",
  },
  video: {
    icon: "\u{1F3AC}",
    color: "#9b7fd4",
    label: "Video",
    bgGlow: "rgba(168,85,247,0.05)",
  },
  file: {
    icon: "\u{1F4C4}",
    color: "#5cb892",
    label: "File",
    bgGlow: "rgba(52,211,153,0.05)",
  },
  document: {
    icon: "\u{1F4D1}",
    color: "#6b9be0",
    label: "Document",
    bgGlow: "rgba(96,165,250,0.05)",
  },
  bookmark: {
    icon: "\u{1F516}",
    color: "#d48ba3",
    label: "Bookmark",
    bgGlow: "rgba(244,114,182,0.05)",
  },
  code: {
    icon: "\u{1F4BB}",
    color: "#d4b35e",
    label: "Code",
    bgGlow: "rgba(251,191,36,0.05)",
  },
  note: {
    icon: "\u{1F4DD}",
    color: colors.textMuted,
    label: "Note",
    bgGlow: "rgba(139,139,139,0.05)",
  },
  message: {
    icon: "\u{1F4AC}",
    color: "#c05070",
    label: "Message",
    bgGlow: "rgba(192,80,112,0.05)",
  },
};

/* ------------------------------------------------------------------ */
/*  Filters                                                            */
/* ------------------------------------------------------------------ */

export const FILTERS = [
  "All",
  "GitHub",
  "Image",
  "Video",
  "File",
  "Document",
];

export const SOURCE_META: Record<
  string,
  { icon: string; color: string; label: string }
> = {
  local: { icon: "\u{1F3E0}", color: colors.green, label: "Local" },
  github: { icon: "\u{1F419}", color: colors.brand, label: "GitHub" },
  discord: { icon: "\u{1F4AC}", color: "#5865F2", label: "Discord" },
  notion: { icon: "\u{1F4D3}", color: "#e0e0e0", label: "Notion" },
  obsidian: { icon: "\u{1F48E}", color: colors.purple, label: "Obsidian" },
  slack: { icon: "\u{1F5E8}\uFE0F", color: "#e01e5a", label: "Slack" },
  figma: { icon: "\u{1F3A8}", color: "#a259ff", label: "Figma" },
  linear: { icon: "\u25C6", color: "#5E6AD2", label: "Linear" },
  airtable: { icon: "\u{1F4CA}", color: "#18BFFF", label: "Airtable" },
  dropbox: { icon: "\u{1F4E6}", color: "#0061FF", label: "Dropbox" },
  confluence: { icon: "\u{1F4D8}", color: "#1868DB", label: "Confluence" },
  raindrop: { icon: "\u{1F516}", color: "#5CB0FF", label: "Raindrop" },
  "google-drive": { icon: "\u{1F4C1}", color: "#4285F4", label: "Google Drive" },
};

/** Static fallback — will be overridden by dynamic sources from API */
export const SOURCES = ["All", "Local", "GitHub", "Discord", "Notion", "Obsidian", "Slack", "Figma"];

/* ------------------------------------------------------------------ */
/*  Breakpoints (px)                                                   */
/* ------------------------------------------------------------------ */

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  xxl: 1536,
} as const;

/* ------------------------------------------------------------------ */
/*  Composite helpers                                                  */
/* ------------------------------------------------------------------ */

/** Card surface style object for inline use. */
export const cardSurface = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.lg,
  transition: `all ${transitions.normal}`,
} as const;

/** Elevated card style (modals, popovers). */
export const elevatedSurface = {
  background: colors.surfaceElevated,
  border: `1px solid ${colors.borderSubtle}`,
  borderRadius: radii.lg,
  boxShadow: shadows.lg,
  backdropFilter: "blur(20px)",
} as const;

/** Standardized modal overlay backdrop — use on all modals/dialogs. */
export const overlayBackdrop = {
  background: "rgba(0,0,0,0.60)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
} as const;

/** Standardized modal surface — use on all modal containers. */
export const modalSurface = {
  background: colors.surfaceModal,
  border: `1px solid ${colors.border}`,
  borderRadius: radii.xl,
  boxShadow: shadows.lg,
} as const;
