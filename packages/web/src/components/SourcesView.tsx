import { useState, useEffect, useCallback, useRef } from "react";
import { colors, fonts, radii, transitions, zIndex, SOURCE_META } from "../lib/theme";
import { api, getApiToken, type ConnectorInfo } from "../lib/api";
import { useI18n } from "../lib/i18n";

/* ------------------------------------------------------------------ */
/*  Injected keyframes (once)                                          */
/* ------------------------------------------------------------------ */

const _injected = (() => {
  if (typeof document === "undefined") return true;
  const id = "trove-sources-keyframes";
  if (document.getElementById(id)) return true;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @keyframes troveFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes trovePulse {
      0%, 100% { opacity: 0.4; }
      50%      { opacity: 0.8; }
    }
    @keyframes troveIndeterminate {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(400%); }
    }
  `;
  document.head.appendChild(style);
  return true;
})();

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function SourcesView() {
  void _injected;
  const { t } = useI18n();

  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupId, setSetupId] = useState<string | null>(null);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [indexProgress, setIndexProgress] = useState<number>(0);
  const [indexLogs, setIndexLogs] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.connectors();
      setConnectors(data.connectors);
    } catch { /* */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const showMessage = (text: string, type: "success" | "error") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleIndex = async (id: string) => {
    setIndexingId(id);
    setIndexProgress(0);
    setIndexLogs([]);

    let finalCount = 0;

    try {
      const token = getApiToken();
      const resp = await fetch("/api/connectors/index", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ connectorId: id, stream: true }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${errBody || resp.statusText}`);
      }
      if (!resp.body) {
        const text = await resp.text();
        const events = text.split("\n").filter((l) => l.startsWith("data: "));
        for (const line of events) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.count != null) finalCount = data.count;
            if (data.message) setIndexLogs((prev) => [...prev.slice(-50), data.message]);
          } catch { /* skip */ }
        }
        setIndexProgress(finalCount);
        setIndexLogs((prev) => [...prev, t("sources.doneItems").replace("{count}", String(finalCount))]);
        showMessage(t("sources.indexedItems").replace("{count}", String(finalCount)).replace("{source}", id), "success");
        load();
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) continue;
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.count != null) {
                finalCount = data.count;
                setIndexProgress(data.count);
              }
              if (data.message) {
                setIndexLogs((prev) => [...prev.slice(-50), data.message]);
              }
              if (data.error) throw new Error(data.error);
            } catch (e) {
              if (e instanceof Error && e.message !== "Index failed") throw e;
            }
          }
        }
      }

      setIndexLogs((prev) => [...prev, t("sources.doneItems").replace("{count}", String(finalCount))]);
      showMessage(t("sources.indexedItems").replace("{count}", String(finalCount)).replace("{source}", id), "success");
      load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Index failed";
      setIndexLogs((prev) => [...prev, `Error: ${msg}`]);
      showMessage(msg, "error");
    }
    setIndexingId(null);
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm(t("sources.disconnectConfirm").replace("{id}", id))) return;
    try {
      await api.disconnectConnector(id);
      showMessage(t("sources.disconnected").replace("{id}", id), "success");
      load();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", "error");
    }
  };

  const connected = connectors.filter((c) => c.status === "connected");
  const available = connectors.filter((c) => c.status === "available");
  const comingSoon = connectors.filter((c) => c.status === "coming_soon");
  const totalItems = connected.reduce((sum, c) => sum + (c.itemCount ?? 0), 0);

  return (
    <div style={{ maxWidth: "960px", margin: "0 auto", padding: "48px 32px" }}>
      {/* Header */}
      <div style={{ marginBottom: "40px" }}>
        <h1 style={{
          fontSize: "28px", fontWeight: 600, color: colors.text, margin: "0 0 6px",
          fontFamily: fonts.sans, letterSpacing: "-0.02em",
        }}>
          {t("sources.title")}
        </h1>
        <p style={{
          fontSize: "15px", color: colors.textMuted, margin: "0 0 24px",
          fontFamily: fonts.sans, lineHeight: "1.5",
        }}>
          {t("sources.subtitle")}
        </p>

        {/* Summary stats */}
        {connected.length > 0 && (
          <div style={{
            display: "inline-flex", gap: "32px", padding: "16px 28px",
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: radii.lg,
          }}>
            <Stat value={connected.length} label={t("sources.connected")} />
            <div style={{ width: "1px", background: colors.border }} />
            <Stat value={totalItems} label={t("sources.itemsIndexed")} />
            <div style={{ width: "1px", background: colors.border }} />
            <Stat value={available.length + comingSoon.length} label={t("sources.available")} />
          </div>
        )}
      </div>

      {/* Message toast */}
      {message && (
        <div style={{
          padding: "12px 18px", marginBottom: "20px", borderRadius: radii.md,
          background: message.type === "success" ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
          border: `1px solid ${message.type === "success" ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
          color: message.type === "success" ? colors.success : colors.error,
          fontSize: "13px", fontFamily: fonts.sans,
          animation: "troveFadeIn 0.2s ease",
        }}>
          {message.text}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* Empty state — lobster helper */}
          {connected.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px", color: colors.textMuted }}>
              <span style={{ fontSize: "40px", display: "block", marginBottom: "12px" }}>💎</span>
              <p style={{ fontSize: "15px", fontFamily: fonts.sans, margin: "0 0 4px" }}>No sources connected yet</p>
              <p style={{ fontSize: "13px", color: colors.textDim }}>Connect your first source below to start indexing</p>
            </div>
          )}

          {/* Connected sources */}
          {connected.length > 0 && (
            <Section title={t("sources.connected")} count={connected.length}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "16px",
              }}>
                <style>{`
                  @media (max-width: 1024px) {
                    .trove-sources-grid-connected { grid-template-columns: repeat(2, 1fr) !important; }
                  }
                  @media (max-width: 640px) {
                    .trove-sources-grid-connected { grid-template-columns: 1fr !important; }
                  }
                `}</style>
                <div className="trove-sources-grid-connected" style={{
                  display: "contents",
                }}>
                  {connected.map((c) => (
                    <ConnectedCard
                      key={c.id}
                      connector={c}
                      onIndex={() => handleIndex(c.id)}
                      onDisconnect={() => handleDisconnect(c.id)}
                      indexing={indexingId === c.id}
                      progress={indexingId === c.id ? indexProgress : 0}
                      logs={indexingId === c.id || indexLogs.length > 0 ? indexLogs : []}
                      showLogs={indexingId === c.id || (indexLogs.length > 0 && c.id === connectors.find((x) => indexLogs[0]?.includes(x.id))?.id)}
                    />
                  ))}
                </div>
              </div>
            </Section>
          )}

          {/* Available */}
          {available.length > 0 && (
            <Section title={t("sources.available")} count={available.length}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "16px",
              }}>
                <style>{`
                  @media (max-width: 1024px) {
                    .trove-sources-grid-available { grid-template-columns: repeat(2, 1fr) !important; }
                  }
                  @media (max-width: 640px) {
                    .trove-sources-grid-available { grid-template-columns: 1fr !important; }
                  }
                `}</style>
                <div className="trove-sources-grid-available" style={{
                  display: "contents",
                }}>
                  {available.map((c) => (
                    <AvailableCard key={c.id} connector={c} onSetup={() => setSetupId(c.id)} />
                  ))}
                </div>
              </div>
            </Section>
          )}

          {/* Coming soon */}
          {comingSoon.length > 0 && (
            <Section title={t("sources.comingSoon")} count={comingSoon.length}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "16px",
              }}>
                <style>{`
                  @media (max-width: 1024px) {
                    .trove-sources-grid-soon { grid-template-columns: repeat(2, 1fr) !important; }
                  }
                  @media (max-width: 640px) {
                    .trove-sources-grid-soon { grid-template-columns: 1fr !important; }
                  }
                `}</style>
                <div className="trove-sources-grid-soon" style={{
                  display: "contents",
                }}>
                  {comingSoon.map((c) => (
                    <ComingSoonCard key={c.id} connector={c} />
                  ))}
                </div>
              </div>
            </Section>
          )}
        </>
      )}

      {/* Setup dialog */}
      {setupId && (
        <SetupDialog
          connector={connectors.find((c) => c.id === setupId)!}
          onClose={() => setSetupId(null)}
          onComplete={() => {
            setSetupId(null);
            showMessage(t("sources.connectedMsg"), "success");
            load();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "20px", fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: "12px", color: colors.textDim, fontFamily: fonts.sans, marginTop: "2px" }}>
        {label}
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "40px" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "10px",
        marginBottom: "16px",
      }}>
        <span style={{
          fontSize: "16px", fontWeight: 600, color: colors.text,
          fontFamily: fonts.sans, letterSpacing: "-0.01em",
        }}>
          {title}
        </span>
        <span style={{
          fontSize: "12px", padding: "2px 10px", borderRadius: radii.full,
          background: colors.surface, color: colors.textMuted,
          fontFamily: fonts.sans, fontWeight: 500,
        }}>
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: "connected" | "available" | "coming_soon" }) {
  const { t } = useI18n();
  const config = {
    connected: { label: t("sources.connected"), bg: "rgba(52,211,153,0.10)", color: colors.success, dot: colors.success },
    available: { label: t("sources.available"), bg: colors.surface, color: colors.textMuted, dot: undefined },
    coming_soon: { label: t("sources.comingSoon"), bg: colors.surface, color: colors.textDim, dot: undefined },
  }[status];

  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "4px 10px", borderRadius: radii.full,
      background: config.bg, fontSize: "11px", fontWeight: 500,
      color: config.color, fontFamily: fonts.sans,
    }}>
      {config.dot && (
        <span style={{
          width: "6px", height: "6px", borderRadius: "50%",
          background: config.dot, display: "inline-block",
          flexShrink: 0,
        }} />
      )}
      {config.label}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Connected card                                                     */
/* ------------------------------------------------------------------ */

function ConnectedCard({ connector: c, onIndex, onDisconnect, indexing, progress, logs, showLogs }: {
  connector: ConnectorInfo;
  onIndex: () => void;
  onDisconnect: () => void;
  indexing: boolean;
  progress: number;
  logs?: string[];
  showLogs?: boolean;
}) {
  const { t } = useI18n();
  const logEndRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "24px",
        background: hovered ? colors.surfaceHover : colors.surface,
        border: `1px solid ${hovered ? colors.borderHover : colors.border}`,
        borderRadius: radii.lg,
        transition: `all ${transitions.normal}`,
        animation: "troveFadeIn 0.3s ease",
      }}
    >
      {/* Top: icon + name + badge */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", marginBottom: "16px" }}>
        <span style={{ fontSize: "32px", lineHeight: 1 }}>{c.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <span style={{
              fontSize: "15px", fontWeight: 600, color: colors.text,
              fontFamily: fonts.sans,
            }}>
              {c.name}
            </span>
            <StatusBadge status="connected" />
          </div>
          <p style={{
            fontSize: "13px", color: colors.textMuted, margin: 0,
            fontFamily: fonts.sans, lineHeight: "1.4",
            overflow: "hidden", textOverflow: "ellipsis",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          }}>
            {c.description}
          </p>
        </div>
      </div>

      {/* Item count */}
      <div style={{
        display: "flex", alignItems: "center", gap: "16px",
        padding: "12px 16px", marginBottom: "16px",
        background: "rgba(255,255,255,0.02)", borderRadius: radii.md,
      }}>
        <div>
          <div style={{ fontSize: "22px", fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
            {(c.itemCount ?? 0).toLocaleString()}
          </div>
          <div style={{ fontSize: "11px", color: colors.textDim, fontFamily: fonts.sans }}>{t("sources.itemsIndexed").toLowerCase()}</div>
        </div>
        {c.tokenEnv && (
          <div style={{ marginLeft: "auto", textAlign: "right" }}>
            <div style={{
              fontSize: "12px", fontWeight: 500, fontFamily: fonts.sans,
              color: c.tokenSet ? colors.success : colors.textDim,
            }}>
              {c.tokenSet ? t("sources.tokenSet") : t("sources.tokenMissing")}
            </div>
            <div style={{ fontSize: "10px", color: colors.textGhost, fontFamily: fonts.mono }}>{c.tokenEnv}</div>
          </div>
        )}
      </div>

      {/* Indexing progress bar */}
      {indexing && (
        <div style={{ marginBottom: "14px" }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: "6px",
          }}>
            <span style={{ fontSize: "12px", fontFamily: fonts.sans, color: colors.textMuted, fontWeight: 500 }}>
              {t("sources.indexing")}
            </span>
            <span style={{ fontSize: "12px", fontFamily: fonts.sans, color: colors.textDim }}>
              {progress.toLocaleString()} items
            </span>
          </div>
          <div style={{
            width: "100%", height: "3px", background: "rgba(255,255,255,0.06)",
            borderRadius: "2px", overflow: "hidden",
          }}>
            <div style={{
              height: "100%",
              background: `linear-gradient(90deg, ${colors.brand}, #fb923c)`,
              borderRadius: "2px",
              width: progress > 0 ? "100%" : "30%",
              animation: progress > 0 ? "none" : "troveIndeterminate 1.5s ease-in-out infinite",
              transition: "width 0.3s ease",
            }} />
          </div>
        </div>
      )}

      {/* Log panel (collapsed by default, shown during/after indexing) */}
      {showLogs && logs && logs.length > 0 && (
        <div style={{
          marginBottom: "14px", padding: "12px 14px",
          background: "rgba(255,255,255,0.02)", border: `1px solid ${colors.border}`,
          borderRadius: radii.md, maxHeight: "120px", overflowY: "auto",
          fontSize: "11px", lineHeight: "1.7", fontFamily: fonts.sans,
        }}>
          {logs.map((line, i) => (
            <div key={i} style={{
              color: line.startsWith("Done") ? colors.success
                : line.startsWith("Error") ? colors.error
                : line.includes("Redacted") ? colors.warning
                : colors.textMuted,
            }}>
              {line}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onIndex}
          disabled={indexing}
          style={{
            flex: 1, padding: "10px 16px", fontSize: "13px",
            fontFamily: fonts.sans, fontWeight: 500,
            background: indexing ? "transparent" : colors.brand,
            border: indexing ? `1px solid ${colors.border}` : "none",
            borderRadius: radii.md,
            color: indexing ? colors.textDim : "#fff",
            cursor: indexing ? "wait" : "pointer",
            transition: `all ${transitions.fast}`,
          }}
        >
          {indexing ? `${progress.toLocaleString()} items...` : t("sources.index")}
        </button>
        <button
          onClick={onDisconnect}
          style={{
            padding: "10px 16px", fontSize: "13px",
            fontFamily: fonts.sans, fontWeight: 500,
            background: "transparent",
            border: `1px solid ${hovered ? "rgba(248,113,113,0.3)" : colors.border}`,
            borderRadius: radii.md,
            color: hovered ? colors.error : colors.textDim,
            cursor: "pointer",
            transition: `all ${transitions.fast}`,
            opacity: hovered ? 1 : 0.6,
          }}
        >
          {t("sources.disconnect")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Available card                                                     */
/* ------------------------------------------------------------------ */

function AvailableCard({ connector: c, onSetup }: { connector: ConnectorInfo; onSetup: () => void }) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onSetup}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "24px",
        background: hovered ? colors.surfaceHover : colors.surface,
        border: `1px solid ${hovered ? colors.borderHover : colors.border}`,
        borderRadius: radii.lg,
        cursor: "pointer",
        transition: `all ${transitions.normal}`,
        transform: hovered ? "translateY(-2px)" : "none",
        animation: "troveFadeIn 0.3s ease",
      }}
    >
      <div style={{ marginBottom: "14px" }}>
        <span style={{ fontSize: "32px", lineHeight: 1 }}>{c.icon}</span>
      </div>
      <div style={{
        fontSize: "15px", fontWeight: 600, color: colors.text,
        fontFamily: fonts.sans, marginBottom: "6px",
      }}>
        {c.name}
      </div>
      <p style={{
        fontSize: "13px", color: colors.textMuted, margin: "0 0 16px",
        fontFamily: fonts.sans, lineHeight: "1.5",
        overflow: "hidden", textOverflow: "ellipsis",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
      }}>
        {c.description}
      </p>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        {c.requiresToken && (
          <span style={{ fontSize: "11px", color: colors.textDim, fontFamily: fonts.sans }}>
            {t("sources.requiresToken")}
          </span>
        )}
        <span style={{
          marginLeft: "auto",
          fontSize: "13px", fontFamily: fonts.sans, fontWeight: 500,
          color: hovered ? "#fff" : colors.brand,
          padding: "6px 16px", borderRadius: radii.full,
          background: hovered ? colors.brand : "transparent",
          border: hovered ? "none" : `1px solid ${colors.brand}44`,
          transition: `all ${transitions.fast}`,
        }}>
          {t("sources.connect")}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Coming soon card                                                   */
/* ------------------------------------------------------------------ */

function ComingSoonCard({ connector: c }: { connector: ConnectorInfo }) {
  return (
    <div style={{
      padding: "24px",
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: radii.lg,
      opacity: 0.5,
      animation: "troveFadeIn 0.3s ease",
    }}>
      <div style={{ marginBottom: "14px" }}>
        <span style={{ fontSize: "28px", lineHeight: 1, filter: "grayscale(0.5)" }}>{c.icon}</span>
      </div>
      <div style={{
        fontSize: "14px", fontWeight: 600, color: colors.textMuted,
        fontFamily: fonts.sans, marginBottom: "6px",
      }}>
        {c.name}
      </div>
      <StatusBadge status="coming_soon" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function LoadingSkeleton() {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: "16px",
    }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{
          height: "180px", borderRadius: radii.lg,
          background: colors.surface, border: `1px solid ${colors.border}`,
          animation: `trovePulse 1.5s ease-in-out ${i * 0.1}s infinite`,
        }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Setup Dialog                                                       */
/* ------------------------------------------------------------------ */

function SetupDialog({ connector: c, onClose, onComplete }: {
  connector: ConnectorInfo;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>({});
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"token" | "config">(
    c.requiresToken && !c.tokenSet ? "token" : "config",
  );

  const handleSave = async () => {
    if (step === "token") {
      if (!token.trim()) {
        setError(t("sources.tokenRequired"));
        return;
      }
      setStep("config");
      setError(null);
      return;
    }

    for (const field of c.fields) {
      if (field.required && !values[field.key]?.trim()) {
        setError(`${field.label} is required`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      await api.setupConnector(c.id, values, token || undefined);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("sources.setupFailed"));
      setSaving(false);
    }
  };

  const totalSteps = c.requiresToken && !c.tokenSet ? 2 : 1;
  const currentStep = step === "token" ? 1 : totalSteps;

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "11px 14px", boxSizing: "border-box",
    background: "rgba(255,255,255,0.04)", border: `1px solid ${colors.border}`,
    borderRadius: radii.md, color: colors.text, fontSize: "14px",
    fontFamily: fonts.sans, outline: "none",
    transition: `border-color ${transitions.fast}`,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: zIndex.modal,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(16px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "troveFadeIn 0.2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surfaceModal,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.xl, width: "min(92vw, 480px)",
          maxHeight: "85vh", overflow: "auto",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "24px 28px 20px", display: "flex", alignItems: "center", gap: "16px",
        }}>
          <span style={{ fontSize: "36px", lineHeight: 1 }}>{c.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: "18px", fontWeight: 600, color: colors.text,
              fontFamily: fonts.sans,
            }}>
              {t("sources.connect")} {c.name}
            </div>
            {totalSteps > 1 && (
              <div style={{
                fontSize: "13px", color: colors.textMuted, fontFamily: fonts.sans,
                marginTop: "2px",
              }}>
                {t("sources.stepOf").replace("{current}", String(currentStep)).replace("{total}", String(totalSteps))}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: radii.sm, width: "32px", height: "32px",
            color: colors.textMuted, fontSize: "16px", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: `all ${transitions.fast}`,
          }}>
            x
          </button>
        </div>

        {/* Step indicator bar */}
        {totalSteps > 1 && (
          <div style={{ padding: "0 28px 20px" }}>
            <div style={{
              height: "3px", background: "rgba(255,255,255,0.06)", borderRadius: "2px",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%", width: `${(currentStep / totalSteps) * 100}%`,
                background: `linear-gradient(90deg, ${colors.brand}, #fb923c)`,
                borderRadius: "2px",
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>
        )}

        <div style={{ padding: "0 28px 28px" }}>
          {/* Step 1: Token */}
          {step === "token" && (
            <div>
              <p style={{
                fontSize: "14px", color: colors.textMuted, margin: "0 0 20px",
                fontFamily: fonts.sans, lineHeight: "1.6",
              }}>
                {c.tokenHelp}
              </p>

              <label style={{
                display: "block", fontSize: "13px", fontWeight: 500,
                color: colors.textMuted, fontFamily: fonts.sans, marginBottom: "8px",
              }}>
                {c.tokenEnv}
              </label>
              <input
                type="password"
                autoFocus
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                placeholder={t("sources.pasteToken")}
                style={inputStyle}
                onFocus={(e) => { e.currentTarget.style.borderColor = colors.borderFocus; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
              />
              {c.tokenUrl && (
                <a
                  href={c.tokenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "4px",
                    marginTop: "10px", fontSize: "13px", color: colors.brand,
                    textDecoration: "none", fontFamily: fonts.sans,
                  }}
                >
                  {t("sources.getToken")} &rarr;
                </a>
              )}
            </div>
          )}

          {/* Step 2: Config */}
          {step === "config" && (
            <div>
              {c.requiresToken && c.tokenSet && (
                <div style={{
                  marginBottom: "20px", padding: "12px 16px", borderRadius: radii.md,
                  background: "rgba(52,211,153,0.06)", border: `1px solid rgba(52,211,153,0.15)`,
                  fontSize: "13px", color: colors.success, fontFamily: fonts.sans,
                  display: "flex", alignItems: "center", gap: "10px",
                }}>
                  <span style={{
                    width: "7px", height: "7px", borderRadius: "50%",
                    background: colors.success, display: "inline-block",
                  }} />
                  {c.tokenEnv} {t("sources.isSet")}
                </div>
              )}

              {c.requiresToken && !c.tokenSet && token && (
                <div style={{
                  marginBottom: "20px", padding: "12px 16px", borderRadius: radii.md,
                  background: "rgba(52,211,153,0.06)", border: `1px solid rgba(52,211,153,0.15)`,
                  fontSize: "13px", color: colors.success, fontFamily: fonts.sans,
                  display: "flex", alignItems: "center", gap: "10px",
                }}>
                  <span style={{
                    width: "7px", height: "7px", borderRadius: "50%",
                    background: colors.success, display: "inline-block",
                  }} />
                  {t("sources.tokenProvided")}
                </div>
              )}

              {c.fields.length === 0 ? (
                <p style={{
                  fontSize: "14px", color: colors.textMuted, margin: "0 0 20px",
                  fontFamily: fonts.sans, lineHeight: "1.6",
                }}>
                  {t("sources.noConfigNeeded")}
                </p>
              ) : (
                c.fields.map((field) => (
                  <div key={field.key} style={{ marginBottom: "20px" }}>
                    <label style={{
                      display: "block", fontSize: "13px", fontWeight: 500,
                      color: colors.textMuted, fontFamily: fonts.sans, marginBottom: "8px",
                    }}>
                      {field.label}
                      {field.required && <span style={{ color: colors.brand }}> *</span>}
                    </label>
                    {field.type === "toggle" ? (
                      <button
                        onClick={() => setValues((v) => ({ ...v, [field.key]: v[field.key] === "true" ? "false" : "true" }))}
                        style={{
                          padding: "10px 20px", fontSize: "13px", fontFamily: fonts.sans,
                          fontWeight: 500,
                          background: values[field.key] === "true" ? `${colors.brand}15` : colors.surface,
                          border: `1px solid ${values[field.key] === "true" ? colors.brand + "44" : colors.border}`,
                          borderRadius: radii.md,
                          color: values[field.key] === "true" ? colors.brand : colors.textMuted,
                          cursor: "pointer", transition: `all ${transitions.fast}`,
                        }}
                      >
                        {values[field.key] === "true" ? t("sources.yes") : t("sources.no")}
                      </button>
                    ) : (
                      <>
                        <input
                          type={field.type === "number" ? "number" : "text"}
                          value={values[field.key] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                          placeholder={field.placeholder}
                          style={{
                            ...inputStyle,
                            fontFamily: field.type === "number" ? fonts.sans : fonts.sans,
                          }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = colors.borderFocus; }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
                        />
                        {field.placeholder && !field.required && (
                          <div style={{
                            fontSize: "11px", color: colors.textGhost, marginTop: "6px",
                            fontFamily: fonts.sans,
                          }}>
                            {field.placeholder}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              padding: "12px 16px", marginBottom: "20px", borderRadius: radii.md,
              background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)",
              fontSize: "13px", fontFamily: fonts.sans, color: colors.error,
            }}>
              {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
            {step === "config" && totalSteps > 1 && (
              <button
                onClick={() => setStep("token")}
                style={{
                  padding: "11px 20px", fontSize: "13px", fontWeight: 500,
                  fontFamily: fonts.sans,
                  background: "transparent", border: `1px solid ${colors.border}`,
                  borderRadius: radii.md, color: colors.textMuted, cursor: "pointer",
                  transition: `all ${transitions.fast}`,
                }}
              >
                {t("sources.back")}
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{
              padding: "11px 20px", fontSize: "13px", fontWeight: 500,
              fontFamily: fonts.sans,
              background: "transparent", border: `1px solid ${colors.border}`,
              borderRadius: radii.md, color: colors.textMuted, cursor: "pointer",
              transition: `all ${transitions.fast}`,
            }}>
              {t("sources.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "11px 28px", fontSize: "13px", fontWeight: 600,
                fontFamily: fonts.sans,
                background: colors.brand, border: "none",
                borderRadius: radii.md, color: "#fff", cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.6 : 1, transition: `all ${transitions.fast}`,
              }}
            >
              {saving ? t("sources.connecting") : step === "token" ? t("sources.next") : t("sources.connect")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
