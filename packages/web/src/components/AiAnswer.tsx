import { motion } from "framer-motion";
import { colors, fonts, radii, transitions } from "../lib/theme";
import { useI18n } from "../lib/i18n";

interface AiAnswerProps {
  text: string;
  onSuggest?: (term: string) => void;
}

export function AiAnswer({ text, onSuggest }: AiAnswerProps) {
  const { t } = useI18n();
  // Parse backtick-wrapped terms as clickable suggestions
  const parts = text.split(/`([^`]+)`/g);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      style={{
        background: colors.surface,
        borderLeft: `3px solid ${colors.brand}`,
        borderRadius: radii.lg,
        padding: "16px 20px",
        marginBottom: "20px",
        position: "relative",
      }}
    >
      {/* Lobster mascot indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "8px" }}>
        <span style={{ fontSize: "16px" }}>💎</span>
        <span style={{ fontSize: "11px", fontWeight: 600, color: colors.brand, fontFamily: fonts.sans, letterSpacing: "0.03em" }}>Trove AI</span>
      </div>

      {/* AI badge */}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "10px",
          padding: "3px 10px",
          background: `${colors.brand}12`,
          borderRadius: radii.full,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={colors.brand}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" />
        </svg>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: colors.brand,
            fontFamily: fonts.sans,
          }}
        >
          {t("ai.badge")}
        </span>
      </div>

      {/* Answer text */}
      <div
        style={{
          fontSize: "13.5px",
          color: colors.text,
          fontFamily: fonts.sans,
          lineHeight: 1.7,
        }}
      >
        {parts.map((part, i) => {
          if (i % 2 === 1 && onSuggest) {
            return (
              <span
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  onSuggest(part);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "2px 10px",
                  margin: "2px 3px",
                  background: `${colors.brand}10`,
                  border: `1px solid ${colors.brand}30`,
                  borderRadius: radii.full,
                  color: colors.brand,
                  fontFamily: fonts.sans,
                  fontSize: "12.5px",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: `all ${transitions.fast}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `${colors.brand}20`;
                  e.currentTarget.style.borderColor = `${colors.brand}60`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = `${colors.brand}10`;
                  e.currentTarget.style.borderColor = `${colors.brand}30`;
                }}
              >
                {part}
              </span>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </div>
    </motion.div>
  );
}
