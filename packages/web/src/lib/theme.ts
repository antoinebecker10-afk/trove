/**
 * Trove design system — single source of truth.
 * Inspired by Linear / Vercel / Raycast aesthetics.
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
  brandDim: "rgba(249,115,22,0.7)",
  brandGlow: "rgba(249,115,22,0.15)",
  brandSubtle: "rgba(249,115,22,0.06)",

  /* Accent palette */
  cyan: "#06b6d4",
  cyanDim: "rgba(6,182,212,0.7)",
  cyanGlow: "rgba(6,182,212,0.12)",
  green: "#22c55e",
  purple: "#a855f7",
  yellow: "#eab308",
  pink: "#ec4899",

  /* Semantic */
  success: "#22c55e",
  error: "#ef4444",
  warning: "#f59e0b",
  info: "#3b82f6",

  /* Surfaces */
  bg: "#080808",
  surface: "rgba(255,255,255,0.03)",
  surfaceHover: "rgba(255,255,255,0.05)",
  surfaceElevated: "rgba(255,255,255,0.06)",
  surfaceModal: "rgba(16,16,16,0.95)",

  /* Borders */
  border: "rgba(255,255,255,0.07)",
  borderHover: "rgba(255,255,255,0.12)",
  borderSubtle: "rgba(255,255,255,0.04)",
  borderFocus: "rgba(249,115,22,0.5)",

  /* Typography */
  text: "#e5e5e5",
  textMuted: "#737373",
  textDim: "#525252",
  textGhost: "#404040",
  textDark: "#333",
} as const;

/* ------------------------------------------------------------------ */
/*  Gradients                                                          */
/* ------------------------------------------------------------------ */

export const gradients = {
  brand: `linear-gradient(135deg, ${colors.brand} 0%, #fb923c 100%)`,
  brandSubtle: `linear-gradient(135deg, rgba(249,115,22,0.15) 0%, rgba(251,146,60,0.05) 100%)`,
  cyan: `linear-gradient(135deg, ${colors.cyan} 0%, #22d3ee 100%)`,
  surface: `linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)`,
  glow: `radial-gradient(ellipse at 50% 0%, rgba(249,115,22,0.08) 0%, transparent 70%)`,
  noise: `linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.3) 100%)`,
} as const;

/* ------------------------------------------------------------------ */
/*  Shadows                                                            */
/* ------------------------------------------------------------------ */

export const shadows = {
  sm: "0 1px 2px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.2)",
  md: "0 4px 12px rgba(0,0,0,0.5), 0 1px 4px rgba(0,0,0,0.3)",
  lg: "0 12px 40px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.4)",
  glow: `0 0 20px rgba(249,115,22,0.15), 0 0 60px rgba(249,115,22,0.05)`,
  glowCyan: `0 0 20px rgba(6,182,212,0.15), 0 0 60px rgba(6,182,212,0.05)`,
  inset: "inset 0 1px 0 rgba(255,255,255,0.04)",
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
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "9999px",
} as const;

/* ------------------------------------------------------------------ */
/*  Transitions                                                        */
/* ------------------------------------------------------------------ */

export const transitions = {
  fast: "120ms cubic-bezier(0.25, 0.1, 0.25, 1)",
  normal: "200ms cubic-bezier(0.25, 0.1, 0.25, 1)",
  slow: "350ms cubic-bezier(0.25, 0.1, 0.25, 1)",
  spring: "500ms cubic-bezier(0.34, 1.56, 0.64, 1)",
  bounce: "600ms cubic-bezier(0.68, -0.55, 0.265, 1.55)",
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
  popover: 500,
  toast: 600,
  tooltip: 700,
  command: 800,
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
    icon: "🐙",
    color: colors.brand,
    label: "GitHub",
    bgGlow: "rgba(249,115,22,0.08)",
  },
  image: {
    icon: "🖼️",
    color: colors.cyan,
    label: "Image",
    bgGlow: "rgba(6,182,212,0.08)",
  },
  video: {
    icon: "🎬",
    color: colors.purple,
    label: "Video",
    bgGlow: "rgba(168,85,247,0.08)",
  },
  file: {
    icon: "📄",
    color: colors.green,
    label: "File",
    bgGlow: "rgba(34,197,94,0.08)",
  },
  document: {
    icon: "📑",
    color: "#3b82f6",
    label: "Document",
    bgGlow: "rgba(59,130,246,0.08)",
  },
  bookmark: {
    icon: "🔖",
    color: colors.pink,
    label: "Bookmark",
    bgGlow: "rgba(236,72,153,0.08)",
  },
  code: {
    icon: "💻",
    color: colors.yellow,
    label: "Code",
    bgGlow: "rgba(234,179,8,0.08)",
  },
  note: {
    icon: "📝",
    color: colors.textMuted,
    label: "Note",
    bgGlow: "rgba(115,115,115,0.08)",
  },
  message: {
    icon: "💬",
    color: "#e01e5a",
    label: "Message",
    bgGlow: "rgba(224,30,90,0.08)",
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
  local: { icon: "🏠", color: colors.green, label: "Local" },
  github: { icon: "🐙", color: colors.brand, label: "GitHub" },
  discord: { icon: "💬", color: "#5865F2", label: "Discord" },
  notion: { icon: "📓", color: "#e0e0e0", label: "Notion" },
  obsidian: { icon: "💎", color: colors.purple, label: "Obsidian" },
  slack: { icon: "🗨️", color: "#e01e5a", label: "Slack" },
  figma: { icon: "🎨", color: "#a259ff", label: "Figma" },
  linear: { icon: "◆", color: "#5E6AD2", label: "Linear" },
  airtable: { icon: "📊", color: "#18BFFF", label: "Airtable" },
  dropbox: { icon: "📦", color: "#0061FF", label: "Dropbox" },
  confluence: { icon: "📘", color: "#1868DB", label: "Confluence" },
  raindrop: { icon: "🔖", color: "#5CB0FF", label: "Raindrop" },
  "google-drive": { icon: "📁", color: "#4285F4", label: "Google Drive" },
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
  backdropFilter: "blur(16px)",
} as const;
