import { colors, fonts, radii } from "../lib/theme";

interface StatBadgeProps {
  label: string;
  value: string | number;
  color: string;
  icon?: string;
}

export function StatBadge({ label, value, color, icon }: StatBadgeProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 16px",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radii.full,
      }}
    >
      {icon && (
        <span style={{ fontSize: "14px", flexShrink: 0 }}>{icon}</span>
      )}
      <span
        style={{
          fontSize: "15px",
          fontWeight: 600,
          color,
          fontFamily: fonts.sans,
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: "12px",
          color: colors.textMuted,
          fontFamily: fonts.sans,
          fontWeight: 400,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    </div>
  );
}
