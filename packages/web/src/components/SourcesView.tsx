import { useState, useEffect, useCallback } from "react";
import { colors, fonts } from "../lib/theme";
import { api, type ConnectorInfo } from "../lib/api";

export function SourcesView() {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupId, setSetupId] = useState<string | null>(null);
  const [indexingId, setIndexingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

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
    try {
      const result = await api.indexConnector(id);
      showMessage(`Indexed ${result.count} items from ${id}`, "success");
      load();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Index failed", "error");
    }
    setIndexingId(null);
  };

  const handleDisconnect = async (id: string) => {
    if (!confirm(`Disconnect ${id}? This removes it from your config.`)) return;
    try {
      await api.disconnectConnector(id);
      showMessage(`${id} disconnected`, "success");
      load();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed", "error");
    }
  };

  const connected = connectors.filter((c) => c.status === "connected");
  const available = connectors.filter((c) => c.status === "available");
  const comingSoon = connectors.filter((c) => c.status === "coming_soon");

  // Total items across all connected sources
  const totalItems = connected.reduce((sum, c) => sum + (c.itemCount ?? 0), 0);

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "40px 32px" }}>
      {/* Hero header */}
      <div style={{ marginBottom: "40px", textAlign: "center" }}>
        <h1 style={{
          fontSize: "26px", fontWeight: 700, color: "#fff", margin: "0 0 8px",
          letterSpacing: "-0.02em",
        }}>
          Your Sources
        </h1>
        <p style={{
          fontSize: "14px", color: colors.textDim, margin: "0 0 20px",
          lineHeight: "1.6",
        }}>
          Connect your tools and let Trove index everything in one place.
        </p>

        {/* Summary stats */}
        {connected.length > 0 && (
          <div style={{
            display: "inline-flex", gap: "24px", padding: "12px 28px",
            background: "rgba(255,255,255,0.02)", border: `1px solid ${colors.border}`,
            borderRadius: "40px",
          }}>
            <Stat value={connected.length} label="connected" color={colors.green} />
            <div style={{ width: "1px", background: colors.border }} />
            <Stat value={totalItems} label="items indexed" color={colors.brand} />
            <div style={{ width: "1px", background: colors.border }} />
            <Stat value={available.length + comingSoon.length} label="more available" color={colors.cyan} />
          </div>
        )}
      </div>

      {/* Message toast */}
      {message && (
        <div style={{
          padding: "12px 16px", marginBottom: "20px", borderRadius: "8px",
          background: message.type === "success" ? "rgba(74,222,128,0.06)" : "rgba(239,68,68,0.06)",
          border: `1px solid ${message.type === "success" ? "rgba(74,222,128,0.2)" : "rgba(239,68,68,0.2)"}`,
          color: message.type === "success" ? "#4ade80" : "#f87171",
          fontSize: "13px", fontFamily: fonts.mono, animation: "fadeIn 0.2s ease",
          textAlign: "center",
        }}>
          {message.text}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* Connected sources — large cards */}
          {connected.length > 0 && (
            <Section title="Connected" count={connected.length}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "12px" }}>
                {connected.map((c) => (
                  <ConnectedCard
                    key={c.id}
                    connector={c}
                    onIndex={() => handleIndex(c.id)}
                    onDisconnect={() => handleDisconnect(c.id)}
                    indexing={indexingId === c.id}
                  />
                ))}
              </div>
            </Section>
          )}

          {/* Available — grid of setup cards */}
          {available.length > 0 && (
            <Section title="Ready to connect" count={available.length}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "12px" }}>
                {available.map((c) => (
                  <AvailableCard key={c.id} connector={c} onSetup={() => setSetupId(c.id)} />
                ))}
              </div>
            </Section>
          )}

          {/* Coming soon — compact grid */}
          {comingSoon.length > 0 && (
            <Section title="Coming soon" count={comingSoon.length}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px" }}>
                {comingSoon.map((c) => (
                  <ComingSoonCard key={c.id} connector={c} />
                ))}
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
            showMessage("Connected! Click INDEX to start indexing.", "success");
            load();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "18px", fontWeight: 700, color, fontFamily: fonts.mono }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: "10px", color: colors.textDim, fontFamily: fonts.mono, letterSpacing: "0.04em" }}>
        {label}
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "36px" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: "10px",
        marginBottom: "14px", paddingBottom: "8px",
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <span style={{
          fontSize: "15px", fontWeight: 600, color: colors.text,
          letterSpacing: "-0.01em",
        }}>
          {title}
        </span>
        <span style={{
          fontSize: "11px", padding: "2px 8px", borderRadius: "10px",
          background: "rgba(255,255,255,0.04)", color: colors.textDim,
          fontFamily: fonts.mono,
        }}>
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connected card — large, detailed
// ---------------------------------------------------------------------------

function ConnectedCard({ connector: c, onIndex, onDisconnect, indexing }: {
  connector: ConnectorInfo;
  onIndex: () => void;
  onDisconnect: () => void;
  indexing: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "20px",
        background: hovered ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)",
        border: `1px solid ${colors.green}25`,
        borderRadius: "10px",
        transition: "all 0.2s",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Green accent top bar */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: "2px",
        background: `linear-gradient(90deg, ${colors.green}66, ${colors.green}22)`,
      }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
        <span style={{ fontSize: "28px" }}>{c.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "16px", fontWeight: 600, color: "#fff" }}>
              {c.name}
            </span>
            <span style={{
              width: "7px", height: "7px", borderRadius: "50%",
              background: colors.green, boxShadow: `0 0 6px ${colors.green}`,
              display: "inline-block",
            }} />
          </div>
          <p style={{ fontSize: "12px", color: colors.textDim, margin: "2px 0 0", lineHeight: "1.4" }}>
            {c.description}
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        display: "flex", gap: "20px", padding: "10px 14px",
        background: "rgba(255,255,255,0.02)", borderRadius: "6px",
        marginBottom: "14px",
      }}>
        <div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: colors.brand, fontFamily: fonts.mono }}>
            {(c.itemCount ?? 0).toLocaleString()}
          </div>
          <div style={{ fontSize: "10px", color: colors.textGhost, fontFamily: fonts.mono }}>items</div>
        </div>
        {c.tokenEnv && (
          <div>
            <div style={{ fontSize: "12px", fontWeight: 600, color: c.tokenSet ? colors.green : colors.textGhost, fontFamily: fonts.mono }}>
              {c.tokenSet ? "Set" : "Missing"}
            </div>
            <div style={{ fontSize: "10px", color: colors.textGhost, fontFamily: fonts.mono }}>{c.tokenEnv}</div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onIndex}
          disabled={indexing}
          style={{
            flex: 1, padding: "9px 16px", fontSize: "12px", fontFamily: fonts.mono,
            fontWeight: 600, letterSpacing: "0.04em",
            background: indexing ? "rgba(255,255,255,0.02)" : `${colors.brand}15`,
            border: `1px solid ${indexing ? colors.border : colors.brand + "44"}`,
            borderRadius: "6px", color: indexing ? colors.textDim : colors.brand,
            cursor: indexing ? "wait" : "pointer", transition: "all 0.15s",
          }}
        >
          {indexing ? "Indexing..." : "Re-index"}
        </button>
        {hovered && (
          <button
            onClick={onDisconnect}
            style={{
              padding: "9px 14px", fontSize: "11px", fontFamily: fonts.mono,
              background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "6px", color: "#f87171", cursor: "pointer",
              animation: "fadeIn 0.15s ease",
            }}
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Available card — clickable setup
// ---------------------------------------------------------------------------

function AvailableCard({ connector: c, onSetup }: { connector: ConnectorInfo; onSetup: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onSetup}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "20px",
        background: hovered ? "rgba(255,255,255,0.035)" : "rgba(255,255,255,0.015)",
        border: `1px solid ${hovered ? colors.brand + "44" : colors.border}`,
        borderRadius: "10px",
        cursor: "pointer",
        transition: "all 0.2s",
        transform: hovered ? "translateY(-2px)" : "none",
        boxShadow: hovered ? "0 4px 20px rgba(0,0,0,0.3)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
        <span style={{ fontSize: "28px" }}>{c.icon}</span>
        <span style={{ fontSize: "15px", fontWeight: 600, color: hovered ? "#fff" : colors.text }}>
          {c.name}
        </span>
      </div>
      <p style={{
        fontSize: "12px", color: colors.textDim, margin: "0 0 14px",
        lineHeight: "1.5",
      }}>
        {c.description}
      </p>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        {c.requiresToken && (
          <span style={{ fontSize: "10px", color: colors.textGhost, fontFamily: fonts.mono }}>
            Requires API token
          </span>
        )}
        <span style={{
          marginLeft: "auto",
          fontSize: "11px", fontFamily: fonts.mono, fontWeight: 600,
          color: colors.brand, letterSpacing: "0.04em",
          padding: "4px 14px", borderRadius: "20px",
          background: hovered ? `${colors.brand}20` : "transparent",
          border: `1px solid ${hovered ? colors.brand + "44" : colors.brand + "22"}`,
          transition: "all 0.15s",
        }}>
          Connect
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coming soon card — compact, muted
// ---------------------------------------------------------------------------

function ComingSoonCard({ connector: c }: { connector: ConnectorInfo }) {
  return (
    <div style={{
      padding: "16px",
      background: "rgba(255,255,255,0.01)",
      border: `1px solid ${colors.border}`,
      borderRadius: "8px",
      opacity: 0.55,
      display: "flex", alignItems: "center", gap: "10px",
    }}>
      <span style={{ fontSize: "22px" }}>{c.icon}</span>
      <div>
        <div style={{ fontSize: "13px", fontWeight: 600, color: colors.text }}>{c.name}</div>
        <div style={{ fontSize: "10px", color: colors.textGhost, fontFamily: fonts.mono }}>Coming soon</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "12px" }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{
          height: "140px", borderRadius: "10px",
          background: "rgba(255,255,255,0.015)", border: `1px solid ${colors.border}`,
          animation: `pulse 1.5s ease-in-out ${i * 0.1}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup Dialog
// ---------------------------------------------------------------------------

function SetupDialog({ connector: c, onClose, onComplete }: {
  connector: ConnectorInfo;
  onClose: () => void;
  onComplete: () => void;
}) {
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
        setError("Token is required");
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
      setError(err instanceof Error ? err.message : "Setup failed");
      setSaving(false);
    }
  };

  const totalSteps = c.requiresToken && !c.tokenSet ? 2 : 1;
  const currentStep = step === "token" ? 1 : totalSteps;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.75)", backdropFilter: "blur(12px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fadeIn 0.2s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0a0a0a", border: `1px solid rgba(255,255,255,0.08)`,
          borderRadius: "12px", width: "min(92vw, 460px)",
          maxHeight: "85vh", overflow: "auto",
          boxShadow: "0 24px 48px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px", display: "flex", alignItems: "center", gap: "14px",
        }}>
          <span style={{ fontSize: "32px" }}>{c.icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "17px", fontWeight: 600, color: "#fff" }}>
              Connect {c.name}
            </div>
            {totalSteps > 1 && (
              <div style={{ fontSize: "11px", color: colors.textDim, fontFamily: fonts.mono, marginTop: "2px" }}>
                Step {currentStep} of {totalSteps}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.04)", border: `1px solid ${colors.border}`,
            borderRadius: "6px", width: "28px", height: "28px",
            color: colors.textMuted, fontSize: "14px", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            x
          </button>
        </div>

        {/* Progress bar */}
        {totalSteps > 1 && (
          <div style={{ padding: "0 24px 16px" }}>
            <div style={{
              height: "3px", background: "rgba(255,255,255,0.04)", borderRadius: "2px",
              overflow: "hidden",
            }}>
              <div style={{
                height: "100%", width: `${(currentStep / totalSteps) * 100}%`,
                background: colors.brand, borderRadius: "2px",
                transition: "width 0.3s ease",
              }} />
            </div>
          </div>
        )}

        <div style={{ padding: "0 24px 24px" }}>
          {/* Step 1: Token */}
          {step === "token" && (
            <div>
              <p style={{
                fontSize: "13px", color: colors.textDim, margin: "0 0 16px",
                lineHeight: "1.6",
              }}>
                {c.tokenHelp}
              </p>

              <label style={{
                display: "block", fontSize: "12px", fontWeight: 500,
                color: colors.textMuted, marginBottom: "8px",
              }}>
                {c.tokenEnv}
              </label>
              <input
                type="password"
                autoFocus
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                placeholder="Paste your token here..."
                style={{
                  width: "100%", padding: "10px 14px", boxSizing: "border-box",
                  background: "rgba(255,255,255,0.03)", border: `1px solid ${colors.border}`,
                  borderRadius: "8px", color: colors.text, fontSize: "13px",
                  fontFamily: fonts.mono, outline: "none",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = colors.brand + "66"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
              />
              {c.tokenUrl && (
                <a
                  href={c.tokenUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "4px",
                    marginTop: "8px", fontSize: "12px", color: colors.brand,
                    textDecoration: "none",
                  }}
                >
                  Get your token {"->"}
                </a>
              )}
            </div>
          )}

          {/* Step 2: Config */}
          {step === "config" && (
            <div>
              {c.requiresToken && c.tokenSet && (
                <div style={{
                  marginBottom: "16px", padding: "10px 14px", borderRadius: "8px",
                  background: colors.green + "08", border: `1px solid ${colors.green}20`,
                  fontSize: "12px", color: colors.green, display: "flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: colors.green, display: "inline-block" }} />
                  {c.tokenEnv} is set
                </div>
              )}

              {c.requiresToken && !c.tokenSet && token && (
                <div style={{
                  marginBottom: "16px", padding: "10px 14px", borderRadius: "8px",
                  background: colors.green + "08", border: `1px solid ${colors.green}20`,
                  fontSize: "12px", color: colors.green, display: "flex", alignItems: "center", gap: "8px",
                }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: colors.green, display: "inline-block" }} />
                  Token provided
                </div>
              )}

              {c.fields.length === 0 ? (
                <p style={{ fontSize: "13px", color: colors.textDim, margin: "0 0 16px", lineHeight: "1.6" }}>
                  No additional configuration needed. Click Connect to finish.
                </p>
              ) : (
                c.fields.map((field) => (
                  <div key={field.key} style={{ marginBottom: "16px" }}>
                    <label style={{
                      display: "block", fontSize: "12px", fontWeight: 500,
                      color: colors.textMuted, marginBottom: "8px",
                    }}>
                      {field.label}
                      {field.required && <span style={{ color: colors.brand }}> *</span>}
                    </label>
                    {field.type === "toggle" ? (
                      <button
                        onClick={() => setValues((v) => ({ ...v, [field.key]: v[field.key] === "true" ? "false" : "true" }))}
                        style={{
                          padding: "8px 18px", fontSize: "12px", fontFamily: fonts.mono,
                          background: values[field.key] === "true" ? colors.brand + "18" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${values[field.key] === "true" ? colors.brand + "44" : colors.border}`,
                          borderRadius: "8px",
                          color: values[field.key] === "true" ? colors.brand : colors.textDim,
                          cursor: "pointer", transition: "all 0.15s",
                        }}
                      >
                        {values[field.key] === "true" ? "Yes" : "No"}
                      </button>
                    ) : (
                      <>
                        <input
                          type={field.type === "number" ? "number" : "text"}
                          value={values[field.key] ?? ""}
                          onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                          placeholder={field.placeholder}
                          style={{
                            width: "100%", padding: "10px 14px", boxSizing: "border-box",
                            background: "rgba(255,255,255,0.03)", border: `1px solid ${colors.border}`,
                            borderRadius: "8px", color: colors.text, fontSize: "13px",
                            fontFamily: fonts.mono, outline: "none",
                            transition: "border-color 0.15s",
                          }}
                          onFocus={(e) => { e.currentTarget.style.borderColor = colors.brand + "66"; }}
                          onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
                        />
                        {field.placeholder && !field.required && (
                          <div style={{ fontSize: "10px", color: colors.textGhost, marginTop: "4px", fontFamily: fonts.mono }}>
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
              padding: "10px 14px", marginBottom: "16px", borderRadius: "8px",
              background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)",
              fontSize: "12px", fontFamily: fonts.mono, color: "#f87171",
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
                  padding: "10px 18px", fontSize: "12px",
                  background: "none", border: `1px solid ${colors.border}`,
                  borderRadius: "8px", color: colors.textMuted, cursor: "pointer",
                }}
              >
                Back
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{
              padding: "10px 18px", fontSize: "12px",
              background: "none", border: `1px solid ${colors.border}`,
              borderRadius: "8px", color: colors.textMuted, cursor: "pointer",
            }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "10px 24px", fontSize: "12px", fontWeight: 600,
                background: colors.brand, border: "none",
                borderRadius: "8px", color: "#fff", cursor: saving ? "wait" : "pointer",
                opacity: saving ? 0.6 : 1, transition: "all 0.15s",
                boxShadow: `0 2px 8px ${colors.brand}44`,
              }}
            >
              {saving ? "Connecting..." : step === "token" ? "Next" : "Connect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
