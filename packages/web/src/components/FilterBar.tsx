import { colors, fonts, FILTERS, SOURCE_META, radii, transitions } from "../lib/theme";
import { useI18n } from "../lib/i18n";

interface FilterBarProps {
  active: string;
  onFilter: (filter: string) => void;
  activeSource: string;
  onSourceFilter: (source: string) => void;
  resultCount: number;
  /** Connected source IDs from the API (e.g. ["local", "github", "discord"]) */
  connectedSources?: string[];
}

/** Icons for type filters */
const FILTER_ICONS: Record<string, string> = {
  All: "",
  GitHub: "\u{1F419}",
  Image: "\u{1F5BC}\uFE0F",
  Video: "\u{1F3AC}",
  File: "\u{1F4C4}",
  Document: "\u{1F4D1}",
};

/** Map FILTERS values to i18n keys */
const FILTER_I18N_KEY: Record<string, string> = {
  All: "all",
  GitHub: "github",
  Image: "image",
  Video: "video",
  File: "file",
  Document: "document",
};

export function FilterBar({
  active,
  onFilter,
  activeSource,
  onSourceFilter,
  resultCount,
  connectedSources,
}: FilterBarProps) {
  const { t } = useI18n();
  const sourceList =
    connectedSources && connectedSources.length > 0
      ? [
          "All",
          ...connectedSources.map((id) => {
            const meta = SOURCE_META[id];
            return meta?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
          }),
        ]
      : ["All"];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        marginBottom: "20px",
        animation: "fadeIn 0.4s ease 0.15s both",
      }}
    >
      {/* Type filters */}
      <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const isActive = active === f;
          return (
            <button
              key={f}
              onClick={() => onFilter(f)}
              style={{
                padding: "6px 14px",
                fontSize: "13px",
                fontFamily: fonts.sans,
                fontWeight: isActive ? 600 : 400,
                cursor: "pointer",
                borderRadius: radii.full,
                border: "1px solid transparent",
                background: isActive ? colors.brand : colors.surface,
                color: isActive ? "#fff" : colors.textMuted,
                transition: `all ${transitions.fast}`,
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                lineHeight: 1.3,
              }}
            >
              {FILTER_ICONS[f] ? (
                <span style={{ fontSize: "13px" }}>{FILTER_ICONS[f]}</span>
              ) : null}
              {t(`filter.${FILTER_I18N_KEY[f] ?? f.toLowerCase()}`)}
            </button>
          );
        })}

        {/* Result count badge */}
        <span
          style={{
            marginLeft: "auto",
            fontSize: "12px",
            color: colors.textDim,
            fontFamily: fonts.sans,
            background: colors.surface,
            padding: "4px 12px",
            borderRadius: radii.full,
            fontWeight: 500,
          }}
        >
          {resultCount} {t("filter.results")}
        </span>
      </div>

      {/* Source filters */}
      {sourceList.length > 1 && (
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          {sourceList.map((s) => {
            const sourceId =
              Object.entries(SOURCE_META).find(([, v]) => v.label === s)?.[0] ??
              s.toLowerCase();
            const meta = SOURCE_META[sourceId];
            const isActive = activeSource === s;
            const isAll = s === "All";
            const accentColor = meta?.color ?? colors.textMuted;
            const isConnected = !isAll && connectedSources?.includes(sourceId);

            return (
              <button
                key={s}
                onClick={() => onSourceFilter(s)}
                style={{
                  padding: "5px 12px",
                  fontSize: "12px",
                  fontFamily: fonts.sans,
                  fontWeight: isActive ? 600 : 400,
                  cursor: "pointer",
                  borderRadius: radii.full,
                  border: "1px solid transparent",
                  background: isActive ? `${accentColor}20` : colors.surface,
                  color: isActive ? accentColor : colors.textDim,
                  transition: `all ${transitions.fast}`,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  lineHeight: 1.3,
                }}
              >
                {meta?.icon && <span style={{ fontSize: "13px" }}>{meta.icon}</span>}
                {isAll ? t("filter.all") : t(`filter.${sourceId}`)}
                {isConnected && (
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: colors.green,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
