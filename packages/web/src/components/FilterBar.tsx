import { colors, fonts, FILTERS, SOURCE_META } from "../lib/theme";

interface FilterBarProps {
  active: string;
  onFilter: (filter: string) => void;
  activeSource: string;
  onSourceFilter: (source: string) => void;
  resultCount: number;
  /** Connected source IDs from the API (e.g. ["local", "github", "discord"]) */
  connectedSources?: string[];
}

export function FilterBar({ active, onFilter, activeSource, onSourceFilter, resultCount, connectedSources }: FilterBarProps) {
  // Build source list: "All" + only connected sources (with fallback to static list)
  const sourceList = connectedSources && connectedSources.length > 0
    ? ["All", ...connectedSources.map(id => {
        const meta = SOURCE_META[id];
        return meta?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
      })]
    : ["All"];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        marginBottom: "20px",
        animation: "fadeIn 0.5s ease 0.25s both",
      }}
    >
      {/* Type filters */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => onFilter(f)}
            style={{
              padding: "5px 14px",
              fontSize: "10px",
              letterSpacing: "0.1em",
              fontFamily: fonts.mono,
              cursor: "pointer",
              borderRadius: "1px",
              border: `1px solid ${active === f ? `${colors.brand}80` : "rgba(255,255,255,0.08)"}`,
              background: active === f ? colors.brandGlow : "transparent",
              color: active === f ? colors.brand : colors.textDim,
              transition: "all 0.15s",
              textTransform: "uppercase",
            }}
          >
            {f}
          </button>
        ))}
        <span
          style={{
            marginLeft: "auto",
            fontSize: "11px",
            color: colors.textDark,
            alignSelf: "center",
            fontFamily: fonts.mono,
          }}
        >
          {resultCount} items
        </span>
      </div>

      {/* Source filters — only connected sources */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
        <span
          style={{
            fontSize: "9px",
            color: colors.textGhost,
            fontFamily: fonts.mono,
            letterSpacing: "0.1em",
            marginRight: "4px",
          }}
        >
          SOURCE
        </span>
        {sourceList.map((s) => {
          const sourceId = Object.entries(SOURCE_META).find(([, v]) => v.label === s)?.[0] ?? s.toLowerCase();
          const meta = SOURCE_META[sourceId];
          const isActive = activeSource === s;
          const isAll = s === "All";
          const accentColor = meta?.color ?? colors.textDim;
          const isConnected = !isAll && connectedSources?.includes(sourceId);
          return (
            <button
              key={s}
              onClick={() => onSourceFilter(s)}
              style={{
                padding: "3px 10px",
                fontSize: "9px",
                letterSpacing: "0.08em",
                fontFamily: fonts.mono,
                cursor: "pointer",
                borderRadius: "1px",
                border: `1px solid ${isActive ? `${accentColor}80` : "rgba(255,255,255,0.05)"}`,
                background: isActive ? `${accentColor}15` : "transparent",
                color: isActive ? accentColor : colors.textGhost,
                transition: "all 0.15s",
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              {meta?.icon ? `${meta.icon} ` : ""}{s}
              {isConnected && (
                <span style={{
                  width: "5px",
                  height: "5px",
                  borderRadius: "50%",
                  background: colors.green,
                  boxShadow: `0 0 4px ${colors.green}`,
                  display: "inline-block",
                  flexShrink: 0,
                }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
