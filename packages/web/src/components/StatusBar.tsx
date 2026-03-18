import { useEffect, useState, useCallback } from "react";
import { colors, fonts, zIndex, transitions } from "../lib/theme";
import { api } from "../lib/api";
import { useI18n } from "../lib/i18n";

interface StatusBarProps {
  viewName?: string;
}

export function StatusBar({ viewName = "Search" }: StatusBarProps) {
  const { t } = useI18n();
  const [connected, setConnected] = useState(true);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [lastIndexed, setLastIndexed] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const stats = await api.stats();
      setConnected(true);
      setItemCount(stats.totalItems);
      setLastIndexed(stats.lastIndexedAt);
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 10_000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        left: 0,
        right: 0,
        height: "24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
        background: "rgba(255,255,255,0.02)",
        borderTop: `1px solid ${colors.border}`,
        fontFamily: fonts.sans,
        fontSize: "11px",
        color: colors.textDim,
        zIndex: zIndex.sticky,
        userSelect: "none",
      }}
    >
      {/* Left: view name */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ color: colors.textMuted, fontWeight: 500 }}>
          {viewName}
        </span>
      </div>

      {/* Center: connection status */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: connected ? colors.success : colors.error,
            transition: `background ${transitions.normal}`,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            color: connected ? colors.textDim : colors.error,
            fontWeight: 400,
          }}
        >
          💎 {connected ? t("status.connected") : t("status.offline")}
        </span>
      </div>

      {/* Right: index count + last indexed */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        {itemCount !== null && (
          <span style={{ color: colors.textMuted }}>
            {itemCount.toLocaleString()} {t("status.items")}
          </span>
        )}
        {lastIndexed && (
          <span style={{ color: colors.textDim }}>
            {formatTimeAgo(lastIndexed, t)}
          </span>
        )}
      </div>
    </div>
  );
}

function formatTimeAgo(iso: string, t: (key: string) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return t("status.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("status.mAgo").replace("{n}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("status.hAgo").replace("{n}", String(hours));
  const days = Math.floor(hours / 24);
  return t("status.dAgo").replace("{n}", String(days));
}
