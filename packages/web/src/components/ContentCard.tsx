import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { colors, fonts, TYPE_META, SOURCE_META, radii, transitions } from "../lib/theme";
import { api, type ApiContentItem } from "../lib/api";
import { useI18n } from "../lib/i18n";

interface ContentCardProps {
  item: ApiContentItem;
  index: number;
  onPreview: (item: ApiContentItem) => void;
  onMove: (item: ApiContentItem) => void;
}

export function ContentCard({ item, index, onPreview, onMove }: ContentCardProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const meta = TYPE_META[item.type] ?? TYPE_META.file;
  const sourceMeta = SOURCE_META[item.source];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (item.uri.startsWith("http")) {
          window.open(item.uri, "_blank", "noopener");
        } else {
          onPreview(item);
        }
      }}
      style={{
        background: hovered ? colors.surfaceHover : "transparent",
        borderRadius: radii.md,
        padding: "14px 16px",
        cursor: "pointer",
        transition: `all ${transitions.fast}`,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        {/* Type icon */}
        <span
          style={{
            fontSize: "20px",
            flexShrink: 0,
            marginTop: "2px",
            width: "28px",
            height: "28px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {meta.icon}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "4px",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "15px",
                fontWeight: 600,
                color: colors.text,
                fontFamily: fonts.sans,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                lineHeight: 1.3,
              }}
            >
              {item.title}
            </span>

            {/* Type badge */}
            <span
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                background: `${meta.color}15`,
                borderRadius: radii.full,
                color: meta.color,
                fontFamily: fonts.sans,
                fontWeight: 500,
                flexShrink: 0,
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                lineHeight: 1.4,
              }}
            >
              {meta.label}
            </span>

            {/* Source inline */}
            {sourceMeta && (
              <span
                style={{
                  fontSize: "11px",
                  color: colors.textDim,
                  fontFamily: fonts.sans,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                }}
              >
                {sourceMeta.icon}
              </span>
            )}
          </div>

          {/* Description */}
          <p
            style={{
              fontSize: "13px",
              color: colors.textMuted,
              fontFamily: fonts.sans,
              margin: "0 0 8px",
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.description}
          </p>

          {/* Tags + metadata row */}
          <div
            style={{
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {item.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: "11px",
                  color: colors.textMuted,
                  fontFamily: fonts.sans,
                  background: colors.surface,
                  padding: "2px 8px",
                  borderRadius: radii.full,
                  lineHeight: 1.4,
                }}
              >
                {tag}
              </span>
            ))}
            <span
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: colors.textDim,
                fontFamily: fonts.sans,
              }}
            >
              {item.metadata.stars != null
                ? `${String(item.metadata.stars)} ${t("card.stars")}`
                : null}
              {item.metadata.language != null
                ? ` · ${String(item.metadata.language)}`
                : null}
              {item.metadata.size != null
                ? ` · ${formatSize(Number(item.metadata.size))}`
                : null}
            </span>
          </div>

          {/* Actions on hover */}
          <AnimatePresence>
            {hovered && (
              <motion.div
                initial={{ opacity: 0, y: 4, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: 4, height: 0 }}
                transition={{ duration: 0.15 }}
                style={{
                  display: "flex",
                  gap: "6px",
                  marginTop: "10px",
                  paddingTop: "10px",
                  borderTop: `1px solid ${colors.border}`,
                }}
              >
                {item.uri.startsWith("http") ? (
                  <a
                    href={item.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={actionStyle(item.source === "discord" ? "#5865F2" : meta.color)}
                  >
                    {item.source === "github"
                      ? t("card.openOnGithub")
                      : item.source === "discord"
                        ? t("card.openInDiscord")
                        : t("card.open")}
                  </a>
                ) : (
                  <CardAction
                    label={t("card.open")}
                    color={colors.brand}
                    onClick={() => {
                      api.openFile(item.uri).catch((e) =>
                        console.error("[trove] Open failed:", e),
                      );
                    }}
                  />
                )}
                <CardAction
                  label={t("card.preview")}
                  color={colors.textMuted}
                  onClick={() => onPreview(item)}
                />
                {item.source === "local" && (
                  <CardAction
                    label={t("card.move")}
                    color={colors.textMuted}
                    onClick={() => onMove(item)}
                  />
                )}
                <CardAction
                  label={t("card.copyPath")}
                  color={colors.textDim}
                  onClick={() => {
                    navigator.clipboard.writeText(item.uri).catch((err: unknown) => console.warn("[trove]", err));
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function actionStyle(color: string): React.CSSProperties {
  return {
    fontSize: "12px",
    fontFamily: fonts.sans,
    fontWeight: 500,
    padding: "4px 12px",
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.full,
    color,
    cursor: "pointer",
    transition: `all ${transitions.fast}`,
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
  };
}

function CardAction({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={actionStyle(color)}
    >
      {label}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
