import { colors, fonts } from "../lib/theme";

interface AiAnswerProps {
  text: string;
  onSuggest?: (term: string) => void;
}

export function AiAnswer({ text, onSuggest }: AiAnswerProps) {
  // Parse backtick-wrapped terms as clickable suggestions
  const parts = text.split(/`([^`]+)`/g);

  return (
    <div
      style={{
        background: colors.brandSubtle,
        border: `1px solid ${colors.brand}40`,
        borderRadius: "2px",
        padding: "12px 16px",
        marginBottom: "20px",
        animation: "fadeIn 0.3s ease",
      }}
    >
      <span
        style={{
          fontSize: "11px",
          color: colors.brand,
          fontFamily: fonts.mono,
          letterSpacing: "0.05em",
          lineHeight: "1.6",
        }}
      >
        {parts.map((part, i) => {
          // Odd indices are inside backticks = clickable suggestions
          if (i % 2 === 1 && onSuggest) {
            return (
              <span
                key={i}
                onClick={(e) => { e.stopPropagation(); onSuggest(part); }}
                style={{
                  background: `${colors.brand}20`,
                  border: `1px solid ${colors.brand}44`,
                  borderRadius: "3px",
                  padding: "1px 6px",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  display: "inline-block",
                  margin: "1px 2px",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = `${colors.brand}35`;
                  e.currentTarget.style.borderColor = colors.brand;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = `${colors.brand}20`;
                  e.currentTarget.style.borderColor = `${colors.brand}44`;
                }}
              >
                {part}
              </span>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </span>
    </div>
  );
}
