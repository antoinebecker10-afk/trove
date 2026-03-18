import { useState, useEffect, useCallback } from "react";
import { BootSequence } from "./components/BootSequence";
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
import { colors, TYPE_META, SOURCE_META } from "./lib/theme";

const VIEW_LABELS: Record<ViewMode, string> = {
  files: "File Manager",
  launcher: "Launcher",
  search: "Search",
  sources: "Sources",
};

export default function App() {
  const [booted, setBooted] = useState(false);
  const [view, setView] = useState<ViewMode>("files");
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
  const [connectedSources, setConnectedSources] = useState<string[]>([]);

  useEffect(() => {
    if (booted) {
      api.stats()
        .then((s) => { setStats(s); setApiError(null); })
        .catch((err: unknown) => {
          setApiError(err instanceof Error ? err.message : "Could not reach API");
        });
      // Fetch connected sources for filter bar
      api.connectors()
        .then((data) => {
          const connected = data.connectors
            ?.filter((c: { status: string }) => c.status === "connected")
            .map((c: { id: string }) => c.id) ?? [];
          setConnectedSources(connected);
        })
        .catch(() => {});
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

  if (!booted) {
    return <BootSequence onComplete={() => setBooted(true)} />;
  }

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
        backgroundImage:
          "radial-gradient(ellipse at 20% 0%, rgba(249,115,22,0.04) 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(6,182,212,0.02) 0%, transparent 50%)",
        fontFamily: "'Courier New', monospace",
        color: colors.text,
        overflow: "hidden",
      }}
    >
      <Header view={view} onViewChange={setView} />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Main content area */}
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {view === "files" ? (
            <FileManager onPreview={handleFileManagerPreview} />
          ) : view === "sources" ? (
            <SourcesView />
          ) : view === "launcher" ? (
            <LauncherView onPreview={handlePreview} onMove={handleMoveRequest} />
          ) : (
            /* SEARCH VIEW */
            <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 32px", width: "100%" }}>
              <div style={{ marginBottom: "32px", animation: "fadeIn 0.5s ease" }}>
                <h1 style={{ fontSize: "28px", fontWeight: "800", margin: "0 0 8px", letterSpacing: "-0.02em", color: "#fff" }}>
                  Your Content. <span style={{ color: colors.brand }}>All of it.</span>
                </h1>
                <p style={{ color: colors.textDim, fontSize: "13px", margin: 0, letterSpacing: "0.05em" }}>
                  GitHub repos · local files · screenshots · videos — one place, semantic search
                </p>
              </div>

              {apiError && (
                <div style={{
                  padding: "12px 16px", marginBottom: "20px",
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)",
                  borderLeft: "3px solid #ef4444", borderRadius: "2px",
                  display: "flex", alignItems: "center", gap: "10px",
                  fontFamily: "'Courier New', monospace", animation: "fadeIn 0.3s ease",
                }}>
                  <span style={{ color: "#ef4444", fontSize: "14px" }}>x</span>
                  <span style={{ color: "#fca5a5", fontSize: "12px" }}>CONNECTION FAILED — {apiError}</span>
                  <button
                    onClick={() => {
                      setApiError(null);
                      api.stats()
                        .then((s) => { setStats(s); setApiError(null); })
                        .catch((e: unknown) => setApiError(e instanceof Error ? e.message : "fail"));
                    }}
                    style={{
                      marginLeft: "auto", padding: "4px 12px",
                      background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
                      borderRadius: "2px", color: "#fca5a5", fontSize: "10px",
                      fontFamily: "'Courier New', monospace", cursor: "pointer",
                    }}
                  >
                    RETRY
                  </button>
                </div>
              )}

              {stats && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", marginBottom: "28px" }}>
                  <StatBadge label="Repos" value={stats.byType.github ?? 0} color={colors.brand} />
                  <StatBadge label="Files" value={stats.byType.file ?? 0} color={colors.green} />
                  <StatBadge label="Docs" value={stats.byType.document ?? 0} color={colors.cyan} />
                  <StatBadge label="Images" value={stats.byType.image ?? 0} color="#38bdf8" />
                  <StatBadge label="Videos" value={stats.byType.video ?? 0} color={colors.purple} />
                </div>
              )}

              <div style={{ marginBottom: "20px" }}>
                <SearchBar value={query} onChange={setQuery} onSearch={handleSearch} loading={loading} />
              </div>

              {aiAnswer && <AiAnswer text={aiAnswer} onSuggest={(term) => {
                setQuery(term);
                setTimeout(() => {
                  // Trigger search with the suggested term
                  setLoading(true);
                  setAiAnswer(null);
                  const filterType = filter !== "All" ? filter.toLowerCase() : undefined;
                  const filterSource = sourceFilter !== "All" ? sourceFilter.toLowerCase() : undefined;
                  api.search(term, filterType, filterSource)
                    .then((data) => {
                      setResults(data.results);
                      if (data.aiAnswer) setAiAnswer(data.aiAnswer);
                    })
                    .catch(() => {})
                    .finally(() => setLoading(false));
                }, 0);
              }} />}
              <FilterBar active={filter} onFilter={handleFilter} activeSource={sourceFilter} onSourceFilter={handleSourceFilter} resultCount={results.length} connectedSources={connectedSources} />

              {loading ? (
                <div style={{ textAlign: "center", padding: "40px", color: colors.brand, fontSize: "12px", letterSpacing: "0.1em" }}>
                  SEARCHING YOUR CONTENT...
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {results.map((item, i) => (
                    <ContentCard key={item.id} item={item} index={i} onPreview={handlePreview} onMove={handleMoveRequest} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right sidebar — system info (files view) */}
        {view === "files" && (
          <div
            style={{
              width: "200px",
              borderLeft: `1px solid ${colors.border}`,
              background: "rgba(255,255,255,0.01)",
              flexShrink: 0,
              overflow: "auto",
            }}
          >
            <SystemInfo />
            {stats && (
              <div style={{ padding: "0 12px 12px", fontSize: "10px", fontFamily: "'Courier New', monospace" }}>
                <div style={{ color: colors.textMuted, fontSize: "9px", letterSpacing: "0.1em", marginBottom: "6px" }}>
                  TROVE INDEX
                </div>
                <div style={{ color: colors.textDim, marginBottom: "2px" }}>
                  <span style={{ color: colors.brand }}>{stats.totalItems}</span> items indexed
                </div>
                <div style={{ color: colors.textGhost }}>
                  {stats.byType.file ?? 0} files · {stats.byType.image ?? 0} images
                </div>
                <div style={{ color: colors.textGhost }}>
                  {stats.byType.document ?? 0} docs · {stats.byType.video ?? 0} videos
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar viewName={VIEW_LABELS[view]} />
    </div>

    {/* Preview Modal */}
    {previewItem && (
      <FilePreview
        item={previewItem}
        onClose={() => setPreviewItem(null)}
        onMove={handleMoveRequest}
      />
    )}

    {/* Move Dialog */}
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
