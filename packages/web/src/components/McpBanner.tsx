import { colors, fonts } from "../lib/theme";
import { useI18n } from "../lib/i18n";

export function McpBanner() {
  const { t } = useI18n();
  return (
    <div
      style={{
        marginTop: "40px",
        padding: "20px 24px",
        background: "rgba(6,182,212,0.04)",
        border: `1px solid rgba(6,182,212,0.15)`,
        borderRadius: "2px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        animation: "fadeIn 0.5s ease 0.4s both",
      }}
    >
      <span style={{ fontSize: "24px" }}>⚡</span>
      <div>
        <div
          style={{
            fontSize: "12px",
            color: colors.cyan,
            fontWeight: "600",
            marginBottom: "4px",
            letterSpacing: "0.08em",
            fontFamily: fonts.mono,
          }}
        >
          {t("mcp.ready")}
        </div>
        <div style={{ fontSize: "11px", color: colors.textGhost }}>
          Run:{" "}
          <span
            style={{ color: colors.textMuted, fontFamily: fonts.mono }}
          >
            claude mcp add trove -- npx trove-os mcp
          </span>
        </div>
      </div>
      <div
        style={{
          marginLeft: "auto",
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: colors.green,
          boxShadow: `0 0 8px ${colors.green}`,
          flexShrink: 0,
        }}
      />
    </div>
  );
}
