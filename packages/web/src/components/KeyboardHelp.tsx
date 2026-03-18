import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { colors, fonts, radii, shadows, transitions, zIndex } from "../lib/theme";
import { useI18n } from "../lib/i18n";

/* ------------------------------------------------------------------
 *  Types
 * ------------------------------------------------------------------ */

interface Shortcut {
  keys: string;
  description: string;
}

interface ShortcutCategory {
  title: string;
  shortcuts: Shortcut[];
}

/* ------------------------------------------------------------------
 *  Shortcut key data (descriptions resolved at render via t())
 * ------------------------------------------------------------------ */

const CATEGORY_KEYS: { titleKey: string; shortcuts: { keys: string; descKey: string }[] }[] = [
  {
    titleKey: "keyboard.navigation",
    shortcuts: [
      { keys: "1 – 5", descKey: "keyboard.switchTabs" },
      { keys: "Tab", descKey: "keyboard.cyclePanels" },
      { keys: "↑ / ↓", descKey: "keyboard.navigateList" },
      { keys: "Enter", descKey: "keyboard.openSelected" },
    ],
  },
  {
    titleKey: "keyboard.fileManager",
    shortcuts: [
      { keys: "Backspace", descKey: "keyboard.goParent" },
      { keys: "Space", descKey: "keyboard.quickPreview" },
      { keys: "Ctrl+N", descKey: "keyboard.newFolder" },
      { keys: "F2", descKey: "keyboard.rename" },
      { keys: "Delete", descKey: "keyboard.deleteSelected" },
    ],
  },
  {
    titleKey: "keyboard.search",
    shortcuts: [
      { keys: "Ctrl+K", descKey: "keyboard.openPalette" },
      { keys: "/", descKey: "keyboard.focusSearch" },
      { keys: "Escape", descKey: "keyboard.clearSearch" },
    ],
  },
  {
    titleKey: "keyboard.general",
    shortcuts: [
      { keys: "?", descKey: "keyboard.showHelp" },
      { keys: "Ctrl+R", descKey: "keyboard.reindex" },
      { keys: "Ctrl+,", descKey: "keyboard.openSettings" },
      { keys: "Escape", descKey: "keyboard.closeModal" },
    ],
  },
];

/* ------------------------------------------------------------------
 *  Component
 * ------------------------------------------------------------------ */

export function KeyboardHelp() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const handleKey = useCallback((e: KeyboardEvent) => {
    /* Ignore if user is typing in an input */
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    if (e.key === "Escape" && open) {
      setOpen(false);
    }
  }, [open]);

  useEffect(() => {
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [handleKey]);

  if (!open) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          zIndex: zIndex.modal,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "560px",
          maxWidth: "90vw",
          maxHeight: "80vh",
          overflowY: "auto",
          background: "rgba(16,16,16,0.95)",
          backdropFilter: "blur(20px)",
          border: `1px solid ${colors.borderHover}`,
          borderRadius: radii.lg,
          boxShadow: shadows.lg,
          padding: "28px 32px",
          zIndex: zIndex.modal + 1,
          fontFamily: fonts.mono,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "24px",
          }}
        >
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: colors.text,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {t("keyboard.title")}
          </span>
          <button
            onClick={() => setOpen(false)}
            style={{
              background: "none",
              border: "none",
              color: colors.textGhost,
              cursor: "pointer",
              fontSize: "14px",
              padding: "2px 4px",
              transition: `color ${transitions.fast}`,
            }}
          >
            ESC
          </button>
        </div>

        {/* Grid of categories */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
          }}
        >
          {CATEGORY_KEYS.map((cat) => (
            <div key={cat.titleKey}>
              <div
                style={{
                  fontSize: "9px",
                  color: colors.brand,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: "10px",
                  fontWeight: 600,
                }}
              >
                {t(cat.titleKey)}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {cat.shortcuts.map((sc) => (
                  <div
                    key={sc.keys}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                    }}
                  >
                    <span style={{ fontSize: "10px", color: colors.textMuted }}>
                      {t(sc.descKey)}
                    </span>
                    <Kbd>{sc.keys}</Kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>,
    document.body,
  );
}

/* ------------------------------------------------------------------
 *  Keyboard key badge
 * ------------------------------------------------------------------ */

function Kbd({ children }: { children: string }) {
  return (
    <span
      style={{
        fontSize: "9px",
        fontFamily: fonts.mono,
        color: colors.text,
        background: colors.surfaceElevated,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.sm,
        padding: "2px 6px",
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}
