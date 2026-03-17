import { useState, useEffect } from "react";
import { BootSequence } from "./components/BootSequence";
import { Header } from "./components/Header";
import { SearchBar } from "./components/SearchBar";
import { ContentCard } from "./components/ContentCard";
import { StatBadge } from "./components/StatBadge";
import { FilterBar } from "./components/FilterBar";
import { AiAnswer } from "./components/AiAnswer";
import { McpBanner } from "./components/McpBanner";
import { CommandPalette } from "./components/CommandPalette";
import { api, type ApiContentItem, type ApiStats } from "./lib/api";
import { colors, TYPE_META } from "./lib/theme";

export default function App() {
  const [booted, setBooted] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [results, setResults] = useState<ApiContentItem[]>([]);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ApiStats | null>(null);

  useEffect(() => {
    if (booted) {
      api.stats().then(setStats).catch(() => {});
    }
  }, [booted]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setAiAnswer(null);

    try {
      const filterType =
        filter === "All"
          ? undefined
          : Object.entries(TYPE_META)
              .find(([, v]) => v.label === filter)?.[0];

      const data = await api.search(query, filterType);
      setResults(data.results);
      if (data.aiAnswer) setAiAnswer(data.aiAnswer);
    } catch (err) {
      setAiAnswer(
        `◈ Error: ${err instanceof Error ? err.message : "Search failed"}`,
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = (f: string) => {
    setFilter(f);
    if (query.trim()) {
      handleSearch();
    }
  };

  if (!booted) {
    return <BootSequence onComplete={() => setBooted(true)} />;
  }

  return (
    <>
    <CommandPalette />
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        backgroundImage:
          "radial-gradient(ellipse at 20% 0%, rgba(249,115,22,0.05) 0%, transparent 50%), radial-gradient(ellipse at 80% 100%, rgba(6,182,212,0.03) 0%, transparent 50%)",
        fontFamily: "'Courier New', monospace",
        color: colors.text,
      }}
    >
      <Header />

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 32px" }}>
        {/* Title */}
        <div style={{ marginBottom: "32px", animation: "fadeIn 0.5s ease" }}>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: "800",
              margin: "0 0 8px",
              letterSpacing: "-0.02em",
              color: "#fff",
            }}
          >
            Your Content.{" "}
            <span style={{ color: colors.brand }}>All of it.</span>
          </h1>
          <p
            style={{
              color: colors.textDim,
              fontSize: "13px",
              margin: 0,
              letterSpacing: "0.05em",
            }}
          >
            GitHub repos · local files · screenshots · videos — one place,
            semantic search
          </p>
        </div>

        {/* Stats */}
        {stats && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "12px",
              marginBottom: "28px",
              animation: "fadeIn 0.5s ease 0.1s both",
            }}
          >
            <StatBadge
              label="Repos"
              value={stats.byType.github ?? 0}
              color={colors.brand}
            />
            <StatBadge
              label="Files"
              value={stats.byType.file ?? 0}
              color={colors.green}
            />
            <StatBadge
              label="Images"
              value={stats.byType.image ?? 0}
              color={colors.cyan}
            />
            <StatBadge
              label="Videos"
              value={stats.byType.video ?? 0}
              color={colors.purple}
            />
          </div>
        )}

        {/* Search */}
        <div
          style={{
            marginBottom: "20px",
            animation: "fadeIn 0.5s ease 0.2s both",
          }}
        >
          <SearchBar value={query} onChange={setQuery} onSearch={handleSearch} />
        </div>

        {/* AI Answer */}
        {aiAnswer && <AiAnswer text={aiAnswer} />}

        {/* Filters */}
        <FilterBar
          active={filter}
          onFilter={handleFilter}
          resultCount={results.length}
        />

        {/* Results */}
        {loading ? (
          <div
            style={{
              textAlign: "center",
              padding: "40px",
              color: colors.brand,
              fontSize: "12px",
              letterSpacing: "0.1em",
            }}
          >
            SEARCHING YOUR CONTENT...
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {results.map((item, i) => (
              <ContentCard key={item.id} item={item} index={i} />
            ))}
          </div>
        )}

        {/* MCP Banner */}
        <McpBanner />
      </div>
    </div>
    </>
  );
}
