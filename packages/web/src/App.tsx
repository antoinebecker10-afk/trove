import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BootSequence } from "./components/BootSequence";
import { Diamond3D } from "./components/Diamond3D";
import { Header, type ViewMode } from "./components/Header";
import { SearchBar } from "./components/SearchBar";
import { ContentCard } from "./components/ContentCard";
import { StatBadge } from "./components/StatBadge";
import { FilterBar } from "./components/FilterBar";
import { AiAnswer } from "./components/AiAnswer";
import { CommandPalette } from "./components/CommandPalette";
import { FilePreview } from "./components/FilePreview";
import { MoveDialog } from "./components/MoveDialog";
import { LauncherView } from "./components/LauncherView";
import { FileManager } from "./components/FileManager";
import { SystemInfo } from "./components/SystemInfo";
import { StatusBar } from "./components/StatusBar";
import { ToastProvider } from "./components/Toast";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { SourcesView } from "./components/SourcesView";
import { api, type ApiContentItem, type ApiStats } from "./lib/api";
import { colors, fonts, transitions, radii, TYPE_META, SOURCE_META } from "./lib/theme";
import { useI18n } from "./lib/i18n";

const VIEW_LABELS: Record<ViewMode, string> = {
  search: "Search",
  sources: "Sources",
  files: "Files",
};

/* ------------------------------------------------------------------ */
/*  Orbiting source icons — circle around the lobster                  */
/* ------------------------------------------------------------------ */

const ORBIT_RADIUS = 160; // px from center

const SOURCE_ICONS: Array<{ icon: string; label: string; spin?: boolean }> = [
  { icon: "🦞", label: "OpenClaw" },
  { icon: "✦", label: "Claude" },
  { icon: "📁", label: "Files" },
  { icon: "📝", label: "Notion" },
  { icon: "💬", label: "Discord" },
  { icon: "💎", label: "Obsidian" },
  { icon: "🐙", label: "GitHub" },
];

/** Position icons on a top semi-arc (halo above the lobster) */
function getOrbitPosition(index: number, total: number) {
  // Wide arc ~250° — icons spread out in a generous halo
  const startAngle = -Math.PI * 1.19; // ~214° left
  const endAngle = Math.PI * 0.19;    // ~34° right
  const angle = startAngle + (index / (total - 1)) * (endAngle - startAngle);
  return {
    x: Math.cos(angle) * ORBIT_RADIUS,
    y: Math.sin(angle) * ORBIT_RADIUS,
  };
}

function OrbitingIcon({ icon, label, index, total, spin, onHover }: { icon: string; label: string; index: number; total: number; spin?: boolean; onHover?: (hovered: boolean) => void }) {
  const { x, y } = getOrbitPosition(index, total);
  const [hovered, setHovered] = useState(false);

  const handleEnter = () => { setHovered(true); onHover?.(true); };
  const handleLeave = () => { setHovered(false); onHover?.(false); };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
      animate={{ opacity: hovered ? 1 : 0.9, scale: hovered ? 1.35 : 1, x, y }}
      transition={{
        delay: hovered ? 0 : 0.8 + index * 0.1,
        duration: hovered ? 0.25 : 0.8,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        marginTop: "-20px",
        marginLeft: "-20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "3px",
        pointerEvents: "auto",
        zIndex: hovered ? 2 : 0,
        width: "40px",
        cursor: "default",
      }}
    >
      {/* Glow behind icon on hover */}
      <motion.div
        animate={{ opacity: hovered ? 0.6 : 0, scale: hovered ? 1 : 0.5 }}
        transition={{ duration: 0.25 }}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -55%)",
          width: "50px",
          height: "50px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(249,115,22,0.25) 0%, rgba(249,115,22,0.08) 50%, transparent 70%)",
          pointerEvents: "none",
          filter: "blur(8px)",
        }}
      />
      <motion.span
        animate={{ y: [0, -5, 0, 4, 0] }}
        transition={{
          duration: 5 + index * 0.6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{ display: "block", fontSize: hovered ? "28px" : "24px", lineHeight: 1, transition: "font-size 0.25s ease" }}
      >
        {spin ? (
          <motion.span
            animate={{ rotate: -360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            style={{ display: "inline-block" }}
          >
            {icon}
          </motion.span>
        ) : icon}
      </motion.span>
      <span
        style={{
          fontSize: hovered ? "11px" : "10px",
          fontFamily: fonts.sans,
          color: hovered ? colors.text : colors.textMuted,
          fontWeight: hovered ? 600 : 500,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
          transition: "all 0.25s ease",
        }}
      >
        {label}
      </span>
    </motion.div>
  );
}

const ease = [0.25, 0.1, 0.25, 1] as const;

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const { t } = useI18n();
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<ViewMode>("search");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [results, setResults] = useState<ApiContentItem[]>([]);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ApiStats | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<ApiContentItem | null>(null);
  const [moveItem, setMoveItem] = useState<ApiContentItem | null>(null);
  const [iconHovered, setIconHovered] = useState(false);
  const [connectedSources, setConnectedSources] = useState<string[]>([]);

  useEffect(() => {
    if (booted) {
      api.stats()
        .then((s) => { setStats(s); setApiError(null); })
        .catch((err: unknown) => {
          setApiError(err instanceof Error ? err.message : "Could not reach API");
        });
      api.connectors()
        .then((data) => {
          const connected = data.connectors
            ?.filter((c: { status: string }) => c.status === "connected")
            .map((c: { id: string }) => c.id) ?? [];
          setConnectedSources(connected);
        })
        .catch((err: unknown) => console.warn("[trove]", err));
    }
  }, [booted]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setAiAnswer(null);
    try {
      const filterType = filter === "All"
        ? undefined
        : Object.entries(TYPE_META).find(([, v]) => v.label === filter)?.[0];
      const filterSource = sourceFilter === "All"
        ? undefined
        : Object.entries(SOURCE_META).find(([, v]) => v.label === sourceFilter)?.[0];
      const data = await api.search(query, filterType, filterSource);
      setResults(data.results);
      if (data.aiAnswer) setAiAnswer(data.aiAnswer);
    } catch (err) {
      setAiAnswer(`Error: ${err instanceof Error ? err.message : "Search failed"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = (f: string) => {
    setFilter(f);
    if (query.trim()) handleSearch();
  };

  const handleSourceFilter = (s: string) => {
    setSourceFilter(s);
    if (query.trim()) handleSearch();
  };

  const handlePreview = useCallback((item: ApiContentItem) => {
    setPreviewItem(item);
  }, []);

  const handleMoveRequest = useCallback((item: ApiContentItem) => {
    setPreviewItem(null);
    setMoveItem(item);
  }, []);

  const handleMoved = useCallback((item: ApiContentItem, newPath: string) => {
    setResults((prev) => prev.map((r) => (r.id === item.id ? { ...r, uri: newPath } : r)));
    setMoveItem(null);
  }, []);

  const handleFileManagerPreview = useCallback((path: string, type: string) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    const pseudoItem: ApiContentItem = {
      id: `local:${path}`,
      source: "local",
      type,
      title: name,
      description: path,
      tags: [],
      uri: path,
      metadata: {},
      indexedAt: new Date().toISOString(),
    };
    setPreviewItem(pseudoItem);
  }, []);

  // "Go home" = back to search hero (Google-like)
  const handleGoHome = useCallback(() => {
    setView("search");
    setQuery("");
    setResults([]);
    setAiAnswer(null);
    setFilter("All");
    setSourceFilter("All");
    setLoading(false);
  }, []);

  if (!booted) {
    return <BootSequence onComplete={() => setBooted(true)} />;
  }

  const hasResults = results.length > 0 || aiAnswer !== null;
  const showHero = !hasResults && !loading;

  // Show back button when not on the search hero
  const showBack = view !== "search" || !showHero;

  return (
    <ToastProvider>
    <>
    <CommandPalette />
    <KeyboardHelp />
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: colors.bg,
        fontFamily: fonts.sans,
        color: colors.text,
        overflow: "hidden",
      }}
    >
      <Header view={view} onViewChange={setView} onGoHome={handleGoHome} showBack={showBack} />

      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {view === "files" ? (
          <FileManager onPreview={handleFileManagerPreview} />
        ) : view === "sources" ? (
          <SourcesView />
        ) : (
          /* ============================================================ */
          /*  SEARCH VIEW                                                  */
          /* ============================================================ */
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: showHero ? "safe center" : "flex-start",
              transition: "all 0.5s cubic-bezier(0.25, 0.1, 0.25, 1)",
              padding: showHero ? "24px 24px" : "40px 24px 24px",
              minHeight: 0,
              position: "relative",
              overflow: "auto",
            }}
          >
            {/* Ambient light effects */}
            {showHero && (
              <>
                {/* Main warm glow — top center, behind the lobster — reacts to icon hover */}
                <motion.div
                  animate={{ opacity: iconHovered ? 1 : [0.4, 0.7, 0.4], scale: iconHovered ? 1.15 : 1 }}
                  transition={iconHovered ? { duration: 0.4, ease: "easeOut" } : { duration: 5, repeat: Infinity, ease: "easeInOut" }}
                  style={{
                    position: "absolute",
                    top: "8%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "600px",
                    height: "400px",
                    background: iconHovered
                      ? "radial-gradient(ellipse, rgba(249,115,22,0.14) 0%, rgba(249,115,22,0.05) 40%, transparent 70%)"
                      : "radial-gradient(ellipse, rgba(249,115,22,0.07) 0%, rgba(249,115,22,0.02) 40%, transparent 70%)",
                    pointerEvents: "none",
                    zIndex: 0,
                  }}
                />
                {/* Soft cyan accent — bottom right — reacts to icon hover */}
                <motion.div
                  animate={{ opacity: iconHovered ? 0.7 : [0.2, 0.4, 0.2], scale: iconHovered ? 1.2 : 1 }}
                  transition={iconHovered ? { duration: 0.4, ease: "easeOut" } : { duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
                  style={{
                    position: "absolute",
                    top: "45%",
                    right: "10%",
                    width: "300px",
                    height: "300px",
                    background: iconHovered
                      ? "radial-gradient(circle, rgba(6,182,212,0.1) 0%, transparent 70%)"
                      : "radial-gradient(circle, rgba(6,182,212,0.04) 0%, transparent 70%)",
                    pointerEvents: "none",
                    zIndex: 0,
                  }}
                />
                {/* Soft purple accent — bottom left — reacts to icon hover */}
                <motion.div
                  animate={{ opacity: iconHovered ? 0.6 : [0.15, 0.3, 0.15], scale: iconHovered ? 1.2 : 1 }}
                  transition={iconHovered ? { duration: 0.4, ease: "easeOut" } : { duration: 8, repeat: Infinity, ease: "easeInOut", delay: 3 }}
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "8%",
                    width: "250px",
                    height: "250px",
                    background: iconHovered
                      ? "radial-gradient(circle, rgba(168,85,247,0.08) 0%, transparent 70%)"
                      : "radial-gradient(circle, rgba(168,85,247,0.03) 0%, transparent 70%)",
                    pointerEvents: "none",
                    zIndex: 0,
                  }}
                />
              </>
            )}

            <div
              style={{
                width: "100%",
                maxWidth: "640px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                position: "relative",
                zIndex: 1,
              }}
            >
              {/* ====== HERO ====== */}
              <AnimatePresence>
                {showHero && (
                  <motion.div
                    key="hero"
                    exit={{ opacity: 0, y: -30, transition: { duration: 0.3 } }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      textAlign: "center",
                      width: "100%",
                    }}
                  >
                    {/* ZONE A — Brand mark + orbiting icons */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.7, ease }}
                      style={{
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "32px",
                        marginLeft: "auto",
                        marginRight: "auto",
                        /* Fixed width centered, reserve space for orbiting icons */
                        width: "420px",
                        paddingTop: `${ORBIT_RADIUS + 10}px`,
                        justifyContent: "flex-end",
                      }}
                    >
                      {/* Orbiting source icons */}
                      {SOURCE_ICONS.map((src, i) => (
                        <OrbitingIcon
                          key={src.label}
                          icon={src.icon}
                          label={src.label}
                          index={i}
                          total={SOURCE_ICONS.length}
                          spin={src.spin === true}
                          onHover={setIconHovered}
                        />
                      ))}

                      {/* Center lobster */}
                      <Diamond3D size={140} />
                      <span
                        style={{
                          fontSize: "36px",
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          color: colors.text,
                          fontFamily: fonts.sans,
                          position: "relative",
                          zIndex: 1,
                        }}
                      >
                        Trove
                      </span>
                    </motion.div>

                    {/* ZONE B — Tagline with soft light behind */}
                    <motion.div
                      style={{ marginBottom: "40px", textAlign: "center", width: "100%", position: "relative" }}
                    >
                      {/* Soft glow behind tagline text */}
                      <div
                        style={{
                          position: "absolute",
                          top: "50%",
                          left: "50%",
                          transform: "translate(-50%, -50%)",
                          width: "350px",
                          height: "80px",
                          background: "radial-gradient(ellipse, rgba(249,115,22,0.06) 0%, transparent 70%)",
                          pointerEvents: "none",
                          zIndex: 0,
                        }}
                      />
                      <motion.p
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3, duration: 0.6, ease }}
                        style={{
                          fontSize: "20px",
                          fontWeight: 500,
                          color: colors.text,
                          fontFamily: fonts.sans,
                          lineHeight: 1.5,
                          margin: "0 0 4px",
                        }}
                      >
                        {t("hero.tagline1")}
                      </motion.p>
                      <motion.p
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.5, duration: 0.6, ease }}
                        style={{
                          fontSize: "20px",
                          fontWeight: 500,
                          color: colors.brand,
                          fontFamily: fonts.sans,
                          lineHeight: 1.5,
                          margin: 0,
                        }}
                      >
                        {t("hero.tagline2")}
                      </motion.p>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ====== SEARCH BAR (always visible) ====== */}
              <motion.div
                layout
                style={{ width: "100%", marginBottom: "32px", zIndex: 10, position: "relative" }}
                transition={{ duration: 0.4, ease }}
              >
                {/* Glow behind search bar — intensifies on icon hover */}
                {showHero && (
                  <motion.div
                    animate={{
                      opacity: iconHovered ? 1 : [0.5, 0.8, 0.5],
                      scale: iconHovered ? 1.1 : 1,
                    }}
                    transition={iconHovered ? { duration: 0.35, ease: "easeOut" } : { duration: 3, repeat: Infinity, ease: "easeInOut" }}
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "50%",
                      transform: "translate(-50%, -50%)",
                      width: "80%",
                      height: "120px",
                      background: iconHovered
                        ? "radial-gradient(ellipse, rgba(249,115,22,0.12) 0%, rgba(6,182,212,0.06) 50%, transparent 80%)"
                        : "radial-gradient(ellipse, rgba(249,115,22,0.05) 0%, rgba(6,182,212,0.02) 50%, transparent 80%)",
                      pointerEvents: "none",
                      zIndex: 0,
                      filter: "blur(20px)",
                    }}
                  />
                )}
                {showHero ? (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7, duration: 0.6, ease }}
                    style={{ position: "relative", zIndex: 1 }}
                  >
                    <SearchBar value={query} onChange={setQuery} onSearch={handleSearch} loading={loading} autoFocus hero />
                  </motion.div>
                ) : (
                  <SearchBar value={query} onChange={setQuery} onSearch={handleSearch} loading={loading} />
                )}
              </motion.div>

              {/* ====== STAT PILLS ====== */}
              <AnimatePresence>
                {stats && showHero && (
                  <motion.div
                    key="stats"
                    exit={{ opacity: 0, transition: { duration: 0.2 } }}
                    style={{
                      display: "flex",
                      gap: "8px",
                      flexWrap: "wrap",
                      justifyContent: "center",
                      marginBottom: "32px",
                    }}
                  >
                    {[
                      { label: t("stats.repos"), value: stats.byType.github ?? 0, delay: 0 },
                      { label: t("stats.files"), value: stats.byType.file ?? 0, delay: 0.05 },
                      { label: t("stats.docs"), value: stats.byType.document ?? 0, delay: 0.1 },
                      { label: t("stats.images"), value: stats.byType.image ?? 0, delay: 0.15 },
                      { label: t("stats.videos"), value: stats.byType.video ?? 0, delay: 0.2 },
                    ].map((s) => (
                      <motion.span
                        key={s.label}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 1.0 + s.delay, duration: 0.3 }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          padding: "5px 12px",
                          background: colors.surface,
                          border: `1px solid ${colors.border}`,
                          borderRadius: radii.full,
                          fontSize: "12px",
                          fontFamily: fonts.sans,
                          color: colors.textMuted,
                          fontWeight: 500,
                        }}
                      >
                        <span style={{ color: colors.text, fontWeight: 600 }}>{s.value.toLocaleString()}</span>
                        {s.label}
                      </motion.span>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ====== KEYBOARD HINT ====== */}
              <AnimatePresence>
                {showHero && (
                  <motion.div
                    key="hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: 1.5, duration: 0.5 }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      color: colors.textDim,
                      fontSize: "12px",
                      fontFamily: fonts.sans,
                    }}
                  >
                    <kbd
                      style={{
                        padding: "2px 8px",
                        background: colors.surface,
                        border: `1px solid ${colors.border}`,
                        borderRadius: "6px",
                        fontSize: "11px",
                        fontFamily: fonts.mono,
                        color: colors.textMuted,
                      }}
                    >
                      Ctrl+K
                    </kbd>
                    <span>{t("hero.ctrlKHint")}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ====== API ERROR — minimal toast-style ====== */}
              {apiError && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{
                    position: "fixed",
                    bottom: "40px",
                    left: 0,
                    right: 0,
                    display: "flex",
                    justifyContent: "center",
                    pointerEvents: "none",
                    zIndex: 50,
                  }}
                >
                  <div
                    style={{
                      padding: "8px 16px",
                      background: "rgba(239,68,68,0.12)",
                      border: "1px solid rgba(239,68,68,0.2)",
                      borderRadius: radii.full,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "12px",
                      fontFamily: fonts.sans,
                      backdropFilter: "blur(12px)",
                      pointerEvents: "auto",
                    }}
                  >
                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ef4444", flexShrink: 0 }} />
                    <span style={{ color: "#fca5a5" }}>💎 {t("status.offline")}</span>
                    <button
                      onClick={() => {
                        setApiError(null);
                        api.stats()
                          .then((s) => { setStats(s); setApiError(null); })
                          .catch((e: unknown) => setApiError(e instanceof Error ? e.message : "fail"));
                      }}
                      style={{
                        padding: "2px 10px",
                        background: "rgba(239,68,68,0.15)",
                        border: "1px solid rgba(239,68,68,0.25)",
                        borderRadius: radii.full,
                        color: "#fca5a5",
                        fontSize: "11px",
                        cursor: "pointer",
                      }}
                    >
                      Réessayer
                    </button>
                  </div>
                </motion.div>
              )}

              {/* ====== RESULTS ====== */}
              <AnimatePresence>
                {(hasResults || loading) && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease }}
                    style={{ width: "100%" }}
                  >
                    <FilterBar
                      active={filter}
                      onFilter={handleFilter}
                      activeSource={sourceFilter}
                      onSourceFilter={handleSourceFilter}
                      resultCount={results.length}
                      connectedSources={connectedSources}
                    />

                    {aiAnswer && (
                      <AiAnswer
                        text={aiAnswer}
                        onSuggest={(term) => {
                          setQuery(term);
                          setTimeout(() => {
                            setLoading(true);
                            setAiAnswer(null);
                            const ft = filter !== "All" ? filter.toLowerCase() : undefined;
                            const fs = sourceFilter !== "All" ? sourceFilter.toLowerCase() : undefined;
                            api.search(term, ft, fs)
                              .then((data) => {
                                setResults(data.results);
                                if (data.aiAnswer) setAiAnswer(data.aiAnswer);
                              })
                              .catch((err: unknown) => console.warn("[trove]", err))
                              .finally(() => setLoading(false));
                          }, 0);
                        }}
                      />
                    )}

                    {loading ? (
                      <div style={{ textAlign: "center", padding: "48px 0" }}>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          style={{
                            width: "24px",
                            height: "24px",
                            border: `2px solid ${colors.border}`,
                            borderTopColor: colors.brand,
                            borderRadius: "50%",
                            margin: "0 auto 12px",
                          }}
                        />
                        <span style={{ color: colors.textMuted, fontSize: "14px" }}>
                          {t("search.searching")}
                        </span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                        {results.map((item, i) => (
                          <motion.div
                            key={item.id}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.04, duration: 0.3, ease }}
                          >
                            <ContentCard item={item} index={i} onPreview={handlePreview} onMove={handleMoveRequest} />
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      <StatusBar viewName={t(`nav.${view}`)} />
    </div>

    {previewItem && (
      <FilePreview
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onMove={handleMoveRequest}
      />
    )}

    {moveItem && (
      <MoveDialog
        item={moveItem}
        onClose={() => setMoveItem(null)}
        onMoved={handleMoved}
      />
    )}
    </>
    </ToastProvider>
  );
}
