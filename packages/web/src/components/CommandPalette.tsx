import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { colors, fonts, radii, transitions, shadows, zIndex } from "../lib/theme";
import { api, type ApiContentItem } from "../lib/api";
import { useI18n } from "../lib/i18n";

const TYPE_ICONS: Record<string, string> = {
  github: "\u{1F419}",
  image: "\u{1F5BC}\uFE0F",
  video: "\u{1F3AC}",
  file: "\u{1F4C4}",
  document: "\u{1F4D1}",
  bookmark: "\u{1F516}",
  code: "\u{1F4BB}",
  note: "\u{1F4DD}",
  message: "\u{1F4AC}",
};

/* ---------------------------------------------------------------------- */
/*  Framer Motion variants                                                 */
/* ---------------------------------------------------------------------- */

const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: "easeOut" as const } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: "easeIn" as const } },
};

const containerVariants = {
  hidden: { opacity: 0, scale: 0.96, y: -10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: -8,
    transition: { duration: 0.15, ease: "easeIn" as const },
  },
};

/* ---------------------------------------------------------------------- */
/*  Spinner                                                                */
/* ---------------------------------------------------------------------- */

function Spinner() {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: `2px solid ${colors.border}`,
        borderTopColor: colors.brand,
        borderRadius: radii.full,
        marginRight: 8,
        verticalAlign: "middle",
      }}
    />
  );
}

/* ---------------------------------------------------------------------- */
/*  Kbd tag                                                                */
/* ---------------------------------------------------------------------- */

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: "inline-block",
        fontSize: 11,
        fontFamily: fonts.sans,
        fontWeight: 500,
        color: colors.textMuted,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.sm,
        padding: "2px 6px",
        lineHeight: "18px",
      }}
    >
      {children}
    </kbd>
  );
}

/* ---------------------------------------------------------------------- */
/*  Action button (pill)                                                   */
/* ---------------------------------------------------------------------- */

function ActionButton({
  label,
  onClick,
  visible,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  visible: boolean;
}) {
  if (!visible) return null;
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12,
        fontFamily: fonts.sans,
        fontWeight: 500,
        padding: "3px 10px",
        background: colors.brandGlow,
        border: "1px solid rgba(249,115,22,0.20)",
        borderRadius: radii.full,
        color: colors.brand,
        cursor: "pointer",
        transition: `all ${transitions.fast}`,
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(249,115,22,0.18)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = colors.brandGlow;
      }}
    >
      {label}
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/*  CommandPalette                                                         */
/* ---------------------------------------------------------------------- */

export function CommandPalette() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiContentItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  /* ---- Global keyboard shortcut ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ---- Focus input when opened ---- */
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelected(0);
    }
  }, [open]);

  /* ---- Debounced search ---- */
  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await api.search(q);
      setResults(data.results);
      setSelected(0);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 200);
  };

  /* ---- Keyboard navigation ---- */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => {
        const next = Math.min(s + 1, results.length - 1);
        scrollToItem(next);
        return next;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => {
        const next = Math.max(s - 1, 0);
        scrollToItem(next);
        return next;
      });
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      handleAction(results[selected], "open");
    }
  };

  const scrollToItem = (index: number) => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[index] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  };

  /* ---- Actions ---- */
  const handleAction = (item: ApiContentItem, action: "open" | "copy") => {
    if (action === "copy") {
      navigator.clipboard.writeText(item.uri).catch((err: unknown) => console.warn("[trove]", err));
      setOpen(false);
      return;
    }
    if (item.source === "github" || item.uri.startsWith("http")) {
      window.open(item.uri, "_blank", "noopener");
    } else {
      navigator.clipboard.writeText(item.uri).catch((err: unknown) => console.warn("[trove]", err));
    }
    setOpen(false);
  };

  /* ---- Determine what to show in the body ---- */
  const hasQuery = query.trim().length > 0;
  const showEmpty = !hasQuery && !loading;
  const showNoResults = hasQuery && !loading && results.length === 0;
  const showResults = results.length > 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div
            key="command-overlay"
            variants={overlayVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.60)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              zIndex: zIndex.command,
            }}
          />

          {/* Container */}
          <motion.div
            key="command-container"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{
              position: "fixed",
              top: "15%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "100%",
              maxWidth: 640,
              background: colors.surfaceModal,
              border: `1px solid ${colors.border}`,
              borderRadius: radii.xl,
              boxShadow: shadows.lg,
              overflow: "hidden",
              zIndex: zIndex.commandOverlay,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* ---- Search input ---- */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0 20px",
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                style={{ flexShrink: 0, marginRight: 12 }}
              >
                <circle
                  cx="7"
                  cy="7"
                  r="5.5"
                  stroke={colors.textMuted}
                  strokeWidth="1.5"
                />
                <line
                  x1="11.1"
                  y1="11.1"
                  x2="14"
                  y2="14"
                  stroke={colors.textMuted}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>

              <input
                ref={inputRef}
                value={query}
                onChange={(e) => handleInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("commandPalette.searchAnything")}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: colors.text,
                  fontSize: 16,
                  fontFamily: fonts.sans,
                  fontWeight: 400,
                  padding: "16px 0",
                  lineHeight: "24px",
                }}
              />

              <Kbd>Esc</Kbd>
            </div>

            {/* ---- Body ---- */}
            <div
              ref={listRef}
              style={{
                maxHeight: 400,
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {/* Loading */}
              {loading && (
                <div
                  style={{
                    padding: "32px 20px",
                    textAlign: "center",
                    color: colors.textMuted,
                    fontSize: 13,
                    fontFamily: fonts.sans,
                  }}
                >
                  <Spinner />
                  Searching...
                </div>
              )}

              {/* Empty state */}
              {showEmpty && (
                <div
                  style={{
                    padding: "48px 20px",
                    textAlign: "center",
                    color: colors.textDim,
                    fontSize: 14,
                    fontFamily: fonts.sans,
                  }}
                >
                  {t("commandPalette.typeToSearch")}
                </div>
              )}

              {/* No results */}
              {showNoResults && (
                <div
                  style={{
                    padding: "40px 20px",
                    textAlign: "center",
                    color: colors.textDim,
                    fontSize: 13,
                    fontFamily: fonts.sans,
                  }}
                >
                  {t("commandPalette.noResults")}
                </div>
              )}

              {/* Results */}
              {showResults &&
                results.map((item, i) => {
                  const isSelected = i === selected;
                  const icon = TYPE_ICONS[item.type] ?? TYPE_ICONS.file;

                  return (
                    <div
                      key={item.id}
                      onMouseEnter={() => setSelected(i)}
                      onClick={() => handleAction(item, "open")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 20px",
                        cursor: "pointer",
                        background: isSelected
                          ? colors.surfaceHover
                          : "transparent",
                        transition: `background ${transitions.fast}`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 18,
                          lineHeight: 1,
                          flexShrink: 0,
                          width: 24,
                          textAlign: "center",
                        }}
                      >
                        {icon}
                      </span>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            fontFamily: fonts.sans,
                            color: isSelected ? "#fff" : colors.text,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            lineHeight: "20px",
                          }}
                        >
                          {item.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            fontFamily: fonts.sans,
                            color: colors.textMuted,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            lineHeight: "18px",
                          }}
                        >
                          {item.description}
                        </div>
                      </div>

                      {/* Action pills */}
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          flexShrink: 0,
                        }}
                      >
                        <ActionButton
                          label={t("commandPalette.open")}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction(item, "open");
                          }}
                          visible={isSelected}
                        />
                        <ActionButton
                          label={t("commandPalette.path")}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAction(item, "copy");
                          }}
                          visible={isSelected}
                        />
                      </div>

                      {/* Type badge */}
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: fonts.sans,
                          fontWeight: 500,
                          color: colors.textDim,
                          flexShrink: 0,
                        }}
                      >
                        {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                      </span>
                    </div>
                  );
                })}
            </div>

            {/* ---- Footer ---- */}
            <div
              style={{
                padding: "10px 20px",
                borderTop: `1px solid ${colors.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                fontFamily: fonts.sans,
                fontSize: 12,
                color: colors.textDim,
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Kbd>Enter</Kbd>
                <span>{t("commandPalette.openAction")}</span>
              </span>
              <span style={{ color: colors.textGhost }}>&middot;</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Kbd>Esc</Kbd>
                <span>{t("commandPalette.close")}</span>
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
