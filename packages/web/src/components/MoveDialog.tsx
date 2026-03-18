import { useState, useEffect, useCallback } from "react";
import { colors, fonts, zIndex } from "../lib/theme";
import { api, type ApiContentItem } from "../lib/api";
import { useI18n } from "../lib/i18n";

interface MoveDialogProps {
  item: ApiContentItem;
  onClose: () => void;
  onMoved: (item: ApiContentItem, newPath: string) => void;
}

export function MoveDialog({ item, onClose, onMoved }: MoveDialogProps) {
  const { t } = useI18n();
  const [currentDir, setCurrentDir] = useState<string>("");
  const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.browse(path);
      setCurrentDir(data.current);
      setDirs(data.dirs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to browse");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Start browsing from the file's parent directory
    const parentDir = item.uri.replace(/[\\/][^\\/]+$/, "");
    browse(parentDir);
  }, [item.uri, browse]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const goUp = () => {
    const parent = currentDir.replace(/[\\/][^\\/]+$/, "");
    if (parent && parent !== currentDir) browse(parent);
  };

  const handleMove = async () => {
    setMoving(true);
    setError(null);
    try {
      const result = await api.moveFile(item.uri, currentDir);
      onMoved(item, result.newPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed");
      setMoving(false);
    }
  };

  const fileName = item.uri.split(/[\\/]/).pop() ?? item.title;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: zIndex.modalOverlay,
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "fadeIn 0.2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0c0c0c",
          border: `1px solid ${colors.cyan}44`,
          borderRadius: "4px",
          width: "min(90vw, 550px)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 18px",
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <span style={{ fontSize: "13px", fontWeight: 600, color: colors.cyan, fontFamily: fonts.mono }}>
            {t("moveDialog.moveTo")}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: colors.textMuted,
              fontSize: "18px",
              cursor: "pointer",
              fontFamily: fonts.mono,
            }}
          >
            x
          </button>
        </div>

        {/* File being moved */}
        <div
          style={{
            padding: "12px 18px",
            borderBottom: `1px solid ${colors.border}`,
            fontSize: "11px",
            fontFamily: fonts.mono,
            color: colors.textMuted,
          }}
        >
          {t("moveDialog.moving")} <span style={{ color: colors.brand }}>{fileName}</span>
        </div>

        {/* Current path */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 18px",
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <button
            onClick={goUp}
            style={{
              fontSize: "10px",
              fontFamily: fonts.mono,
              padding: "3px 10px",
              background: `${colors.textDim}15`,
              border: `1px solid ${colors.textDim}44`,
              borderRadius: "2px",
              color: colors.textMuted,
              cursor: "pointer",
            }}
          >
            ..
          </button>
          <span
            style={{
              fontSize: "11px",
              fontFamily: fonts.mono,
              color: colors.text,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {currentDir}
          </span>
        </div>

        {/* Directory listing */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "8px 0",
            minHeight: "200px",
            maxHeight: "400px",
          }}
        >
          {loading ? (
            <div style={{ padding: "20px", textAlign: "center", color: colors.textDim, fontSize: "11px", fontFamily: fonts.mono }}>
              LOADING...
            </div>
          ) : dirs.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: colors.textGhost, fontSize: "11px", fontFamily: fonts.mono }}>
              No subdirectories
            </div>
          ) : (
            dirs.map((d) => (
              <button
                key={d.path}
                onClick={() => browse(d.path)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "8px 18px",
                  background: "none",
                  border: "none",
                  borderBottom: `1px solid ${colors.border}`,
                  color: colors.text,
                  fontSize: "12px",
                  fontFamily: fonts.mono,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = colors.surfaceHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
              >
                <span style={{ color: colors.cyan }}>{">"}</span>
                {d.name}
              </button>
            ))
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: "8px 18px", fontSize: "11px", color: "#ef4444", fontFamily: fonts.mono }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "14px 18px",
            borderTop: `1px solid ${colors.border}`,
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              fontSize: "10px",
              fontFamily: fonts.mono,
              letterSpacing: "0.08em",
              padding: "6px 16px",
              background: "none",
              border: `1px solid ${colors.border}`,
              borderRadius: "2px",
              color: colors.textMuted,
              cursor: "pointer",
            }}
          >
            {t("moveDialog.cancel")}
          </button>
          <button
            onClick={handleMove}
            disabled={moving}
            style={{
              fontSize: "10px",
              fontFamily: fonts.mono,
              letterSpacing: "0.08em",
              padding: "6px 16px",
              background: `${colors.cyan}20`,
              border: `1px solid ${colors.cyan}66`,
              borderRadius: "2px",
              color: colors.cyan,
              cursor: moving ? "wait" : "pointer",
              opacity: moving ? 0.5 : 1,
            }}
          >
            {moving ? "MOVING..." : t("moveDialog.moveHere")}
          </button>
        </div>
      </div>
    </div>
  );
}
