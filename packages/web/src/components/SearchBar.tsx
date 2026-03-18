import { useState } from "react";
import { colors, fonts, transitions, radii } from "../lib/theme";
import { useI18n } from "../lib/i18n";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  loading?: boolean;
  autoFocus?: boolean;
  /** Use larger hero variant */
  hero?: boolean;
}

export function SearchBar({
  value,
  onChange,
  onSearch,
  loading = false,
  autoFocus = false,
  hero = false,
}: SearchBarProps) {
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);

  const h = hero ? "60px" : "52px";
  const fs = hero ? "18px" : "16px";
  const iconSize = hero ? "20" : "18";

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        height: h,
        background: colors.surface,
        border: `1px solid ${focused ? colors.borderFocus : colors.border}`,
        borderRadius: radii.full,
        transition: `all ${transitions.normal}`,
        boxShadow: focused
          ? `0 0 0 3px rgba(249,115,22,0.12), 0 0 40px rgba(249,115,22,0.08), 0 8px 32px rgba(0,0,0,0.2)`
          : hero
            ? "0 0 40px rgba(249,115,22,0.05), 0 0 80px rgba(249,115,22,0.02), 0 2px 8px rgba(0,0,0,0.1)"
            : "0 1px 3px rgba(0,0,0,0.08)",
        paddingLeft: hero ? "22px" : "18px",
        paddingRight: hero ? "22px" : "18px",
        zIndex: 10,
      }}
    >
      {/* Search icon */}
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke={focused ? colors.brand : colors.textMuted}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{
          flexShrink: 0,
          transition: `stroke ${transitions.fast}`,
        }}
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => e.key === "Enter" && onSearch()}
        placeholder={t("search.placeholder")}
        autoFocus={autoFocus}
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: colors.text,
          fontSize: fs,
          padding: "0 14px",
          fontFamily: fonts.sans,
          fontWeight: 400,
          lineHeight: h,
          height: "100%",
        }}
      />

      {/* Loading spinner */}
      {loading && (
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke={colors.brand}
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            flexShrink: 0,
            animation: "spin 0.8s linear infinite",
          }}
        >
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
