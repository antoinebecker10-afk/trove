import { useState } from "react";
import { colors, fonts, TYPE_META } from "../lib/theme";
import { useGlitch } from "../hooks/useGlitch";
import type { ApiContentItem } from "../lib/api";

interface ContentCardProps {
  item: ApiContentItem;
  index: number;
}

export function ContentCard({ item, index }: ContentCardProps) {
  const [hovered, setHovered] = useState(false);
  const meta = TYPE_META[item.type] ?? TYPE_META.file;
  const glitched = useGlitch(item.title, hovered);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? colors.surfaceHover : "rgba(255,255,255,0.015)",
        border: `1px solid ${hovered ? meta.color + "55" : colors.border}`,
        borderLeft: `3px solid ${hovered ? meta.color : meta.color + "44"}`,
        borderRadius: "2px",
        padding: "16px 18px",
        cursor: "pointer",
        transition: "all 0.2s",
        transform: hovered ? "translateX(3px)" : "translateX(0)",
        animation: `fadeIn 0.3s ease ${index * 0.05}s both`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {hovered && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: `radial-gradient(ellipse at 0% 50%, ${meta.color}08 0%, transparent 70%)`,
            pointerEvents: "none",
          }}
        />
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <span
          style={{
            fontSize: "22px",
            color: meta.color,
            flexShrink: 0,
            marginTop: "1px",
            fontFamily: fonts.mono,
          }}
        >
          {meta.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
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
                fontSize: "13px",
                fontWeight: "600",
                color: hovered ? "#fff" : "#d4d4d4",
                fontFamily: fonts.mono,
                transition: "color 0.2s",
                letterSpacing: "0.02em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {hovered ? glitched : item.title}
            </span>
            <span
              style={{
                fontSize: "9px",
                padding: "2px 7px",
                border: `1px solid ${meta.color}44`,
                borderRadius: "1px",
                color: meta.color,
                fontFamily: fonts.mono,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                flexShrink: 0,
              }}
            >
              {meta.label}
            </span>
          </div>
          <p
            style={{
              fontSize: "12px",
              color: colors.textMuted,
              margin: "0 0 8px",
              lineHeight: "1.5",
            }}
          >
            {item.description}
          </p>
          <div
            style={{
              display: "flex",
              gap: "6px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            {item.tags.map((t) => (
              <span
                key={t}
                style={{
                  fontSize: "10px",
                  color: colors.textDim,
                  fontFamily: fonts.mono,
                  background: colors.surfaceHover,
                  border: `1px solid rgba(255,255,255,0.06)`,
                  padding: "1px 6px",
                  borderRadius: "1px",
                }}
              >
                #{t}
              </span>
            ))}
            <span
              style={{
                marginLeft: "auto",
                fontSize: "10px",
                color: colors.textGhost,
                fontFamily: fonts.mono,
              }}
            >
              {item.metadata.stars != null
                ? `⭐ ${String(item.metadata.stars)}`
                : null}
              {item.metadata.language != null
                ? ` · ${String(item.metadata.language)}`
                : null}
              {item.metadata.size != null
                ? ` · ${formatSize(Number(item.metadata.size))}`
                : null}
            </span>
          </div>

          {/* Actions — visible on hover */}
          {hovered && (
            <div
              style={{
                display: "flex",
                gap: "6px",
                marginTop: "8px",
                paddingTop: "8px",
                borderTop: `1px solid ${colors.border}`,
              }}
            >
              <CardAction
                label={item.source === "github" ? "OPEN ON GITHUB" : "COPY PATH"}
                color={meta.color}
                onClick={() => {
                  if (item.source === "github" || item.uri.startsWith("http")) {
                    window.open(item.uri, "_blank", "noopener");
                  } else {
                    navigator.clipboard.writeText(item.uri).catch(() => {});
                  }
                }}
              />
              {item.source === "local" && (
                <CardAction
                  label="OPEN IN IDE"
                  color={colors.cyan}
                  onClick={() => {
                    // vscode:// protocol to open file directly
                    window.open(`vscode://file${item.uri}`, "_self");
                  }}
                />
              )}
              <CardAction
                label="COPY URI"
                color={colors.textDim}
                onClick={() => {
                  navigator.clipboard.writeText(item.uri).catch(() => {});
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        fontSize: "9px",
        fontFamily: fonts.mono,
        letterSpacing: "0.08em",
        padding: "3px 10px",
        background: `${color}15`,
        border: `1px solid ${color}44`,
        borderRadius: "2px",
        color,
        cursor: "pointer",
        transition: "all 0.1s",
      }}
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
