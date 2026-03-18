import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { colors, fonts, radii, transitions, shadows, zIndex, TYPE_META, SOURCE_META } from "../lib/theme";
import { api, type ApiContentItem } from "../lib/api";
import { useI18n } from "../lib/i18n";

interface FilePreviewProps {
  item: ApiContentItem;
  onClose: () => void;
  onMove: (item: ApiContentItem) => void;
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);
const TEXT_EXTS = new Set([
  ".txt", ".md", ".ts", ".tsx", ".js", ".jsx", ".json", ".yml", ".yaml",
  ".rs", ".py", ".css", ".html", ".toml", ".sh", ".env", ".cfg", ".ini",
]);

function getExt(uri: string): string {
  const dot = uri.lastIndexOf(".");
  return dot >= 0 ? uri.slice(dot).toLowerCase() : "";
}

export function FilePreview({ item, onClose, onMove }: FilePreviewProps) {
  const { t } = useI18n();
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const ext = getExt(item.uri);
  const isImage = item.type === "image" || IMAGE_EXTS.has(ext);
  const isVideo = item.type === "video" || VIDEO_EXTS.has(ext);
  const isText = TEXT_EXTS.has(ext);
  const isPdf = ext === ".pdf";
  const meta = TYPE_META[item.type] ?? TYPE_META.file;

  useEffect(() => {
    if (isText) {
      fetch(api.fileServeUrl(item.uri))
        .then((r) => r.text())
        .then((txt) => { setTextContent(txt); setLoading(false); })
        .catch(() => { setTextContent("Failed to load file content."); setLoading(false); });
    } else {
      setLoading(false);
    }
  }, [item.uri, isText]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: zIndex.modal,
        background: "rgba(0,0,0,0.60)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surfaceModal,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl,
          boxShadow: shadows.lg,
          width: "min(90vw, 900px)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: "14px",
            right: "14px",
            zIndex: 10,
            width: "32px",
            height: "32px",
            borderRadius: radii.full,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.textMuted,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            transition: `all ${transitions.fast}`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = colors.surfaceHover;
            e.currentTarget.style.borderColor = colors.borderHover;
            e.currentTarget.style.color = colors.text;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = colors.surface;
            e.currentTarget.style.borderColor = colors.border;
            e.currentTarget.style.color = colors.textMuted;
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 3L3 11M3 3L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "18px 56px 18px 20px",
            borderBottom: `1px solid ${colors.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "18px" }}>
            {meta.icon}
          </span>
          <span
            style={{
              flex: 1,
              fontSize: "14px",
              fontWeight: 600,
              color: colors.text,
              fontFamily: fonts.sans,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.title}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 500,
              padding: "3px 10px",
              background: `${meta.color}15`,
              borderRadius: radii.full,
              color: meta.color,
              fontFamily: fonts.sans,
              lineHeight: "1.4",
            }}
          >
            {meta.label}
          </span>
        </div>

        {/* Preview content */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: isImage || isVideo || isPdf ? "0" : "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "200px",
          }}
        >
          {loading ? (
            <span style={{ color: colors.textMuted, fontSize: "13px", fontFamily: fonts.sans }}>
              {t("filePreview.loading")}
            </span>
          ) : isImage ? (
            <img
              src={api.fileServeUrl(item.uri)}
              alt={item.title}
              style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }}
            />
          ) : isVideo ? (
            <video
              src={api.fileServeUrl(item.uri)}
              controls
              style={{ maxWidth: "100%", maxHeight: "70vh" }}
            />
          ) : isPdf ? (
            <iframe
              src={api.fileServeUrl(item.uri)}
              title={item.title}
              style={{ width: "100%", height: "70vh", border: "none" }}
            />
          ) : isText && textContent != null ? (
            <pre
              style={{
                width: "100%",
                margin: 0,
                fontSize: "12px",
                fontFamily: fonts.mono,
                color: colors.text,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: "1.6",
                maxHeight: "70vh",
                overflow: "auto",
              }}
            >
              {textContent}
            </pre>
          ) : (
            <div
              style={{
                textAlign: "center",
                color: colors.textDim,
                fontSize: "13px",
                fontFamily: fonts.sans,
              }}
            >
              <p style={{ marginBottom: "8px" }}>{t("filePreview.noPreview")} {ext || "this file type"}</p>
              <p style={{ color: colors.textGhost }}>Use {t("filePreview.open")} to view in default app</p>
            </div>
          )}
        </div>

        {/* Path + Actions */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "14px 20px",
            borderTop: `1px solid ${colors.border}`,
            flexShrink: 0,
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: "11px",
              color: colors.textDim,
              fontFamily: fonts.mono,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.uri}
          </span>
          <PreviewAction
            label={t("filePreview.open")}
            color={colors.brand}
            onClick={() => { api.openFile(item.uri).catch((err: unknown) => console.warn("[trove]", err)); }}
          />
          <PreviewAction
            label={t("filePreview.move")}
            color={colors.cyan}
            onClick={() => onMove(item)}
          />
          <PreviewAction
            label={t("filePreview.copyPath")}
            color={colors.textMuted}
            onClick={() => { navigator.clipboard.writeText(item.uri).catch((err: unknown) => console.warn("[trove]", err)); }}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

function PreviewAction({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: "12px",
        fontFamily: fonts.sans,
        fontWeight: 500,
        padding: "5px 14px",
        background: `${color}15`,
        border: "none",
        borderRadius: radii.full,
        color,
        cursor: "pointer",
        transition: `all ${transitions.fast}`,
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `${color}25`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = `${color}15`;
      }}
    >
      {label}
    </button>
  );
}
