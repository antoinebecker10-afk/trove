import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { colors, fonts, TYPE_META, FILTERS } from "../lib/theme";
import { api, type ApiContentItem, type ApiStats } from "../lib/api";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LauncherViewProps {
  onPreview: (item: ApiContentItem) => void;
  onMove: (item: ApiContentItem) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SORT_OPTIONS = [
  { value: "recent", label: "Recent" },
  { value: "name", label: "A-Z" },
  { value: "type", label: "Type" },
];

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);
const PAGE_SIZE = 60;

function getExt(uri: string): string {
  const dot = uri.lastIndexOf(".");
  return dot >= 0 ? uri.slice(dot).toLowerCase() : "";
}

function isImageFile(item: ApiContentItem): boolean {
  return item.type === "image" || IMAGE_EXTS.has(getExt(item.uri));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Inline CSS keyframes (injected once)
// ---------------------------------------------------------------------------

const STYLE_ID = "launcher-view-styles";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes lv-fadeUp {
      from { opacity: 0; transform: translateY(16px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes lv-pulse {
      0%, 100% { opacity: 0.15; }
      50%      { opacity: 0.25; }
    }
    .lv-masonry {
      column-count: 3;
      column-gap: 12px;
    }
    @media (min-width: 768px)  { .lv-masonry { column-count: 4; } }
    @media (min-width: 1280px) { .lv-masonry { column-count: 6; } }
    .lv-card {
      break-inside: avoid;
      margin-bottom: 12px;
      display: inline-block;
      width: 100%;
    }
    .lv-search::placeholder {
      color: ${colors.textDim};
    }
    .lv-search:focus {
      border-color: ${colors.brand} !important;
      box-shadow: 0 0 0 2px ${colors.brandGlow};
    }
    .lv-pill:hover {
      border-color: rgba(255,255,255,0.18) !important;
      background: rgba(255,255,255,0.04) !important;
    }
    .lv-sort-select {
      appearance: none;
      -webkit-appearance: none;
    }
    .lv-sort-select:focus {
      border-color: ${colors.cyan} !important;
      outline: none;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// LauncherView
// ---------------------------------------------------------------------------

export function LauncherView({ onPreview, onMove }: LauncherViewProps) {
  const [items, setItems] = useState<ApiContentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState("All");
  const [sort, setSort] = useState("recent");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ApiContentItem[] | null>(null);
  const [stats, setStats] = useState<ApiStats | null>(null);

  const pageRef = useRef(1);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inject keyframe styles once
  useEffect(() => { ensureStyles(); }, []);

  // Load stats
  useEffect(() => {
    api.stats().then(setStats).catch((err: unknown) => console.warn("[trove]", err));
  }, []);

  // Resolve filter type key
  const resolveFilterType = useCallback((f: string) => {
    return f === "All"
      ? undefined
      : Object.entries(TYPE_META).find(([, v]) => v.label === f)?.[0];
  }, []);

  // Initial load + reload on filter/sort change
  const loadInitial = useCallback(async (type: string, sortBy: string) => {
    setLoading(true);
    setSearchResults(null);
    setSearchQuery("");
    try {
      const filterType = type === "All"
        ? undefined
        : Object.entries(TYPE_META).find(([, v]) => v.label === type)?.[0];
      const data = await api.items({ type: filterType, page: 1, limit: PAGE_SIZE, sort: sortBy });
      setItems(data.items);
      setTotal(data.total);
      setHasMore(data.page < data.pages);
      pageRef.current = 1;
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitial(filter, sort);
  }, [filter, sort, loadInitial]);

  // Load more (infinite scroll)
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || searchResults) return;
    setLoadingMore(true);
    try {
      const nextPage = pageRef.current + 1;
      const filterType = resolveFilterType(filter);
      const data = await api.items({ type: filterType, page: nextPage, limit: PAGE_SIZE, sort });
      setItems((prev) => [...prev, ...data.items]);
      setTotal(data.total);
      setHasMore(nextPage < data.pages);
      pageRef.current = nextPage;
    } catch {
      // silently fail
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, filter, sort, resolveFilterType, searchResults]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Search handler
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!value.trim()) {
      setSearchResults(null);
      return;
    }

    // Local filter immediately
    const lower = value.toLowerCase();
    const localFiltered = items.filter(
      (item) =>
        item.title.toLowerCase().includes(lower) ||
        item.tags.some((t) => t.toLowerCase().includes(lower)) ||
        item.uri.toLowerCase().includes(lower),
    );
    setSearchResults(localFiltered);

    // Full Trove search after debounce
    searchTimerRef.current = setTimeout(async () => {
      try {
        const filterType = resolveFilterType(filter);
        const data = await api.search(value, filterType);
        if (data.results.length > 0) {
          setSearchResults(data.results);
        }
      } catch {
        // keep local results
      }
    }, 600);
  };

  // Displayed items
  const displayed = searchResults ?? items;

  // Stats strip data
  const statsStrip = useMemo(() => {
    if (!stats) return null;
    const imageCount = stats.byType["image"] ?? 0;
    const fileCount = stats.byType["file"] ?? 0;
    const docCount = stats.byType["document"] ?? 0;
    const ghCount = stats.byType["github"] ?? 0;
    const parts: string[] = [
      `${stats.totalItems.toLocaleString()} items`,
    ];
    if (imageCount) parts.push(`${imageCount.toLocaleString()} images`);
    if (fileCount + docCount) parts.push(`${(fileCount + docCount).toLocaleString()} files`);
    if (ghCount) parts.push(`${ghCount.toLocaleString()} repos`);
    parts.push(`indexed ${timeAgo(stats.lastIndexedAt)}`);
    return parts.join(" \u00b7 ");
  }, [stats]);

  // Count badges per filter
  const filterCounts = useMemo(() => {
    if (!stats) return {};
    const map: Record<string, number> = { All: stats.totalItems };
    for (const [typeKey, meta] of Object.entries(TYPE_META)) {
      map[meta.label] = stats.byType[typeKey] ?? 0;
    }
    return map;
  }, [stats]);

  return (
    <div ref={containerRef} style={{ padding: "20px 24px", maxWidth: "100%", margin: "0 auto" }}>
      {/* Search bar */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: "14px",
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: "14px",
              color: colors.textDim,
              pointerEvents: "none",
            }}
          >
            /
          </span>
          <input
            className="lv-search"
            type="text"
            placeholder="Search everything..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 16px 10px 32px",
              background: "rgba(255,255,255,0.03)",
              border: `1px solid ${colors.border}`,
              borderRadius: "8px",
              color: colors.text,
              fontSize: "13px",
              fontFamily: fonts.mono,
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange("")}
              style={{
                position: "absolute",
                right: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: colors.textDim,
                cursor: "pointer",
                fontSize: "14px",
                fontFamily: fonts.mono,
                padding: "2px 6px",
              }}
            >
              x
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "8px",
          flexWrap: "wrap",
        }}
      >
        {/* Type filter pills */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", flex: 1 }}>
          {FILTERS.map((f) => {
            const active = filter === f;
            const count = filterCounts[f];
            return (
              <button
                key={f}
                className={active ? "" : "lv-pill"}
                onClick={() => setFilter(f)}
                style={{
                  fontSize: "10px",
                  fontFamily: fonts.mono,
                  letterSpacing: "0.06em",
                  padding: "5px 12px",
                  background: active ? `${colors.brand}25` : "rgba(255,255,255,0.02)",
                  border: `1px solid ${active ? colors.brand + "55" : "rgba(255,255,255,0.08)"}`,
                  borderRadius: "20px",
                  color: active ? colors.brand : colors.textMuted,
                  cursor: "pointer",
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: active ? `0 0 12px ${colors.brandGlow}` : "none",
                }}
              >
                {f}
                {count != null && (
                  <span
                    style={{
                      fontSize: "9px",
                      background: active ? `${colors.brand}35` : "rgba(255,255,255,0.06)",
                      padding: "1px 6px",
                      borderRadius: "10px",
                      color: active ? colors.brand : colors.textDim,
                      fontWeight: 600,
                    }}
                  >
                    {count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Sort dropdown */}
        <div style={{ position: "relative", marginLeft: "auto" }}>
          <select
            className="lv-sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            style={{
              fontSize: "10px",
              fontFamily: fonts.mono,
              letterSpacing: "0.06em",
              padding: "5px 28px 5px 10px",
              background: "rgba(255,255,255,0.03)",
              border: `1px solid rgba(255,255,255,0.08)`,
              borderRadius: "6px",
              color: colors.cyan,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value} style={{ background: "#111", color: colors.text }}>
                {s.label}
              </option>
            ))}
          </select>
          <span
            style={{
              position: "absolute",
              right: "8px",
              top: "50%",
              transform: "translateY(-50%)",
              fontSize: "8px",
              color: colors.textDim,
              pointerEvents: "none",
            }}
          >
            ▼
          </span>
        </div>
      </div>

      {/* Stats strip */}
      {statsStrip && (
        <div
          style={{
            fontSize: "10px",
            fontFamily: fonts.mono,
            color: colors.textDim,
            letterSpacing: "0.04em",
            padding: "6px 0 14px",
            borderBottom: `1px solid ${colors.border}`,
            marginBottom: "16px",
          }}
        >
          {statsStrip}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <LoadingSkeleton />
      ) : displayed.length === 0 ? (
        <EmptyState query={searchQuery} filter={filter} />
      ) : (
        <>
          <div className="lv-masonry">
            {displayed.map((item, i) => (
              <div key={item.id} className="lv-card">
                <LauncherCard
                  item={item}
                  index={i}
                  onPreview={onPreview}
                  onMove={onMove}
                  onOpen={() => { api.openFile(item.uri).catch((err: unknown) => console.warn("[trove]", err)); }}
                />
              </div>
            ))}
          </div>

          {/* Infinite scroll sentinel */}
          {!searchResults && (
            <div ref={sentinelRef} style={{ height: "1px" }} />
          )}

          {/* Loading more skeleton */}
          {loadingMore && <LoadingMoreSkeleton />}

          {/* End of results */}
          {!hasMore && !searchResults && items.length > 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "24px",
                fontSize: "10px",
                fontFamily: fonts.mono,
                color: colors.textGhost,
                letterSpacing: "0.1em",
              }}
            >
              END OF RESULTS
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LauncherCard — masonry tile
// ---------------------------------------------------------------------------

function LauncherCard({
  item,
  index,
  onPreview,
  onMove,
  onOpen,
}: {
  item: ApiContentItem;
  index: number;
  onPreview: (item: ApiContentItem) => void;
  onMove: (item: ApiContentItem) => void;
  onOpen: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = TYPE_META[item.type] ?? TYPE_META.file;
  const isImg = isImageFile(item);

  // Stagger delay based on column-ish position
  const delay = Math.min(index * 0.03, 0.6);

  if (isImg) {
    return (
      <ImageCard
        item={item}
        meta={meta}
        delay={delay}
        hovered={hovered}
        onHover={setHovered}
        onPreview={onPreview}
        onMove={onMove}
        onOpen={onOpen}
      />
    );
  }

  return (
    <FileCard
      item={item}
      meta={meta}
      delay={delay}
      hovered={hovered}
      onHover={setHovered}
      onPreview={onPreview}
      onMove={onMove}
      onOpen={onOpen}
    />
  );
}

// ---------------------------------------------------------------------------
// ImageCard — masonry image tile with gradient overlay on hover
// ---------------------------------------------------------------------------

function ImageCard({
  item,
  meta,
  delay,
  hovered,
  onHover,
  onPreview,
  onMove,
  onOpen,
}: {
  item: ApiContentItem;
  meta: { icon: string; color: string; label: string };
  delay: number;
  hovered: boolean;
  onHover: (h: boolean) => void;
  onPreview: (item: ApiContentItem) => void;
  onMove: (item: ApiContentItem) => void;
  onOpen: () => void;
}) {
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={() => onPreview(item)}
      style={{
        position: "relative",
        borderRadius: "6px",
        overflow: "hidden",
        cursor: "pointer",
        transition: "transform 0.25s ease, box-shadow 0.25s ease",
        transform: hovered ? "scale(1.02)" : "scale(1)",
        boxShadow: hovered
          ? `0 8px 30px rgba(0,0,0,0.5), 0 0 0 1px ${meta.color}33`
          : "0 1px 4px rgba(0,0,0,0.2)",
        animation: `lv-fadeUp 0.4s ease ${delay}s both`,
      }}
    >
      <img
        src={api.fileServeUrl(item.uri)}
        alt={item.title}
        loading="lazy"
        style={{
          width: "100%",
          display: "block",
          minHeight: "80px",
          backgroundColor: "#0a0a0a",
        }}
      />

      {/* Gradient overlay on hover */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: hovered
            ? "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 40%, transparent 100%)"
            : "transparent",
          transition: "background 0.25s ease",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: hovered ? "12px" : "0",
        }}
      >
        {hovered && (
          <>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "#fff",
                fontFamily: fonts.mono,
                marginBottom: "4px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.title}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span
                style={{
                  fontSize: "8px",
                  padding: "2px 6px",
                  background: `${meta.color}30`,
                  borderRadius: "3px",
                  color: meta.color,
                  fontFamily: fonts.mono,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                {meta.label}
              </span>
              <div style={{ flex: 1 }} />
              <OverlayAction label="OPEN" color={colors.brand} onClick={(e) => { e.stopPropagation(); onOpen(); }} />
              {item.source === "local" && (
                <OverlayAction label="MOVE" color={colors.cyan} onClick={(e) => { e.stopPropagation(); onMove(item); }} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileCard — glass effect with accent bar
// ---------------------------------------------------------------------------

function FileCard({
  item,
  meta,
  delay,
  hovered,
  onHover,
  onPreview,
  onMove,
  onOpen,
}: {
  item: ApiContentItem;
  meta: { icon: string; color: string; label: string };
  delay: number;
  hovered: boolean;
  onHover: (h: boolean) => void;
  onPreview: (item: ApiContentItem) => void;
  onMove: (item: ApiContentItem) => void;
  onOpen: () => void;
}) {
  return (
    <div
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={() => onPreview(item)}
      style={{
        position: "relative",
        borderRadius: "6px",
        overflow: "hidden",
        cursor: "pointer",
        transition: "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
        transform: hovered ? "translateY(-2px)" : "none",
        boxShadow: hovered
          ? `0 6px 24px rgba(0,0,0,0.4)`
          : "none",
        background: hovered
          ? "rgba(255,255,255,0.045)"
          : "rgba(255,255,255,0.02)",
        border: `1px solid ${hovered ? "rgba(255,255,255,0.1)" : colors.border}`,
        backdropFilter: "blur(12px)",
        animation: `lv-fadeUp 0.4s ease ${delay}s both`,
        display: "flex",
        minHeight: "72px",
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          width: "3px",
          background: `linear-gradient(to bottom, ${meta.color}, ${meta.color}44)`,
          borderRadius: "3px 0 0 3px",
          flexShrink: 0,
        }}
      />

      {/* Content */}
      <div style={{ flex: 1, padding: "10px 12px", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {/* Icon + title row */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span
            style={{
              fontSize: "18px",
              color: meta.color,
              opacity: 0.7,
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            {meta.icon}
          </span>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: hovered ? "#fff" : colors.text,
              fontFamily: fonts.mono,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              transition: "color 0.15s",
            }}
          >
            {item.title}
          </span>
        </div>

        {/* Meta row */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span
            style={{
              fontSize: "8px",
              padding: "2px 6px",
              background: `${meta.color}15`,
              border: `1px solid ${meta.color}25`,
              borderRadius: "3px",
              color: meta.color,
              fontFamily: fonts.mono,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {meta.label}
          </span>
          {item.metadata.size != null && (
            <span style={{ fontSize: "9px", color: colors.textGhost, fontFamily: fonts.mono }}>
              {formatSize(Number(item.metadata.size))}
            </span>
          )}
          {hovered && (
            <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
              <OverlayAction label="OPEN" color={colors.brand} onClick={(e) => { e.stopPropagation(); onOpen(); }} />
              {item.source === "local" && (
                <OverlayAction label="MOVE" color={colors.cyan} onClick={(e) => { e.stopPropagation(); onMove(item); }} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OverlayAction button
// ---------------------------------------------------------------------------

function OverlayAction({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: "8px",
        fontFamily: fonts.mono,
        letterSpacing: "0.1em",
        padding: "3px 8px",
        background: `${color}35`,
        border: `1px solid ${color}55`,
        borderRadius: "3px",
        color: "#fff",
        cursor: "pointer",
        transition: "all 0.15s",
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton (initial)
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  const skeletons = Array.from({ length: 18 }, (_, i) => i);
  return (
    <div className="lv-masonry">
      {skeletons.map((i) => {
        const isImg = i % 3 !== 2;
        const h = isImg ? 100 + (i % 5) * 40 : 72;
        return (
          <div key={i} className="lv-card">
            <div
              style={{
                height: `${h}px`,
                borderRadius: "6px",
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${colors.border}`,
                animation: `lv-pulse 1.5s ease-in-out ${i * 0.05}s infinite`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading more skeleton (bottom row)
// ---------------------------------------------------------------------------

function LoadingMoreSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        padding: "16px 0",
        overflow: "hidden",
      }}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          style={{
            flex: "1 1 0",
            height: "80px",
            borderRadius: "6px",
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${colors.border}`,
            animation: `lv-pulse 1.2s ease-in-out ${i * 0.08}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ query, filter }: { query: string; filter: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 20px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "40px",
          marginBottom: "16px",
          opacity: 0.3,
        }}
      >
        /
      </div>
      <div
        style={{
          fontSize: "13px",
          fontFamily: fonts.mono,
          color: colors.textMuted,
          marginBottom: "8px",
        }}
      >
        {query
          ? `No results for "${query}"`
          : `No ${filter === "All" ? "" : filter.toLowerCase() + " "}items found`}
      </div>
      <div
        style={{
          fontSize: "11px",
          fontFamily: fonts.mono,
          color: colors.textGhost,
        }}
      >
        {query
          ? "Try a different search or clear filters"
          : "Index some content to get started"}
      </div>
    </div>
  );
}
