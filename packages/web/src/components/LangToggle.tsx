import { useState } from "react";
import { useI18n, type Locale } from "../lib/i18n";
import { colors, fonts, transitions } from "../lib/theme";

/**
 * Compact language toggle — switches between FR and EN.
 * Designed to sit in the Header, next to the Ctrl+K button.
 */
export function LangToggle() {
  const { locale, setLocale } = useI18n();
  const [hovered, setHovered] = useState(false);

  const next: Locale = locale === "fr" ? "en" : "fr";
  const label = locale.toUpperCase();

  return (
    <button
      onClick={() => setLocale(next)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={locale === "fr" ? "Switch to English" : "Passer en fran\u00e7ais"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4px 8px",
        minWidth: "32px",
        background: hovered
          ? "rgba(255,255,255,0.06)"
          : "rgba(255,255,255,0.03)",
        border: `1px solid ${hovered ? colors.borderHover : colors.border}`,
        borderRadius: "6px",
        cursor: "pointer",
        transition: `all ${transitions.fast}`,
        outline: "none",
        fontSize: "11px",
        fontFamily: fonts.sans,
        fontWeight: 600,
        letterSpacing: "0.03em",
        color: hovered ? colors.textMuted : colors.textDim,
        lineHeight: "20px",
      }}
    >
      {label}
    </button>
  );
}
