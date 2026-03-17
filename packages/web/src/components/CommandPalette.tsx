import { useState, useEffect, useRef, useCallback } from "react";
import { colors, fonts, TYPE_META } from "../lib/theme";
import { api, type ApiContentItem } from "../lib/api";

/**
 * Cmd+K / Ctrl+K global search overlay.
 * "Ghost Search" — type what you vaguely remember, get instant results.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ApiContentItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Global keyboard shortcut
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

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelected(0);
    }
  }, [open]);

  // Debounced search
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

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      handleAction(results[selected], "open");
    }
  };

  const handleAction = (item: ApiContentItem, action: "open" | "copy") => {
    if (action === "copy") {
      navigator.clipboard.writeText(item.uri).catch(() => {});
      setOpen(false);
      return;
    }
    // For local files, try to open; for GitHub, open URL
    if (item.source === "github" || item.uri.startsWith("http")) {
      window.open(item.uri, "_blank", "noopener");
    } else {
      // Copy path to clipboard — the user/IDE can open it
      navigator.clipboard.writeText(item.uri).catch(() => {});
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(4px)",
          zIndex: 1000,
          animation: "fadeIn 0.15s ease",
        }}
      />

      {/* Palette */}
      <div
        style={{
          position: "fixed",
          top: "15%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "100%",
          maxWidth: "640px",
          background: "#111",
          border: `1px solid ${colors.border}`,
          borderRadius: "8px",
          overflow: "hidden",
          zIndex: 1001,
          animation: "fadeIn 0.15s ease",
          boxShadow: `0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px ${colors.brand}22`,
        }}
      >
        {/* Input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <span style={{ color: colors.brandDim, fontSize: "16px", marginRight: "12px" }}>
            ⌕
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Find anything — describe what you remember..."
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: colors.text,
              fontSize: "15px",
              padding: "16px 0",
              fontFamily: fonts.mono,
            }}
          />
          <kbd
            style={{
              fontSize: "10px",
              color: colors.textDim,
              border: `1px solid ${colors.border}`,
              borderRadius: "3px",
              padding: "2px 6px",
              fontFamily: fonts.mono,
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: "400px", overflowY: "auto" }}>
          {loading && (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: colors.brand,
                fontSize: "11px",
                fontFamily: fonts.mono,
                letterSpacing: "0.1em",
              }}
            >
              SEARCHING...
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div
              style={{
                padding: "20px",
                textAlign: "center",
                color: colors.textDim,
                fontSize: "12px",
                fontFamily: fonts.mono,
              }}
            >
              No results. Try different terms or reindex.
            </div>
          )}

          {results.map((item, i) => {
            const meta = TYPE_META[item.type] ?? TYPE_META.file;
            const isSelected = i === selected;

            return (
              <div
                key={item.id}
                onMouseEnter={() => setSelected(i)}
                onClick={() => handleAction(item, "open")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 16px",
                  cursor: "pointer",
                  background: isSelected ? "rgba(249,115,22,0.08)" : "transparent",
                  borderLeft: isSelected ? `2px solid ${colors.brand}` : "2px solid transparent",
                  transition: "all 0.1s",
                }}
              >
                <span style={{ fontSize: "16px", color: meta.color, fontFamily: fonts.mono }}>
                  {meta.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "13px",
                      color: isSelected ? "#fff" : colors.text,
                      fontFamily: fonts.mono,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.title}
                  </div>
                  <div
                    style={{
                      fontSize: "11px",
                      color: colors.textDim,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.description}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                  <ActionButton
                    label="OPEN"
                    onClick={(e) => { e.stopPropagation(); handleAction(item, "open"); }}
                    visible={isSelected}
                  />
                  <ActionButton
                    label="PATH"
                    onClick={(e) => { e.stopPropagation(); handleAction(item, "copy"); }}
                    visible={isSelected}
                  />
                </div>

                <span
                  style={{
                    fontSize: "9px",
                    color: meta.color,
                    fontFamily: fonts.mono,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    flexShrink: 0,
                  }}
                >
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: "8px 16px",
            borderTop: `1px solid ${colors.border}`,
            display: "flex",
            gap: "16px",
            justifyContent: "center",
          }}
        >
          {[
            { key: "↑↓", label: "navigate" },
            { key: "↵", label: "open" },
            { key: "esc", label: "close" },
          ].map(({ key, label }) => (
            <span key={key} style={{ fontSize: "10px", color: colors.textGhost, fontFamily: fonts.mono }}>
              <kbd style={{
                border: `1px solid ${colors.border}`,
                borderRadius: "2px",
                padding: "1px 4px",
                marginRight: "4px",
              }}>
                {key}
              </kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

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
        fontSize: "9px",
        fontFamily: fonts.mono,
        letterSpacing: "0.08em",
        padding: "2px 8px",
        background: "rgba(249,115,22,0.1)",
        border: `1px solid ${colors.brand}44`,
        borderRadius: "2px",
        color: colors.brand,
        cursor: "pointer",
        transition: "all 0.1s",
      }}
    >
      {label}
    </button>
  );
}
