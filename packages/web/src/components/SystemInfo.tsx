import { useState, useEffect } from "react";
import { colors, fonts } from "../lib/theme";
import { api, type SystemInfo as SystemInfoType } from "../lib/api";
import { useI18n } from "../lib/i18n";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function pct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

export function SystemInfo() {
  const { t } = useI18n();
  const [info, setInfo] = useState<SystemInfoType | null>(null);

  useEffect(() => {
    api.system().then(setInfo).catch((err: unknown) => console.warn("[trove]", err));
    const interval = setInterval(() => {
      api.system().then(setInfo).catch((err: unknown) => console.warn("[trove]", err));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!info) return null;

  const memPct = pct(info.usedMem, info.totalMem);
  const diskPct = info.disk.total > 0 ? pct(info.disk.used, info.disk.total) : 0;

  return (
    <div style={{ padding: "12px", fontSize: "10px", fontFamily: fonts.mono, color: colors.textDim }}>
      <div style={{ marginBottom: "10px", color: colors.textMuted, fontSize: "9px", letterSpacing: "0.1em" }}>
        SYSTEM
      </div>

      {/* RAM */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
          <span>{t("system.ram")}</span>
          <span>{formatBytes(info.usedMem)} / {formatBytes(info.totalMem)}</span>
        </div>
        <Bar pct={memPct} color={memPct > 80 ? "#ef4444" : colors.green} />
      </div>

      {/* Disk */}
      {info.disk.total > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
            <span>{t("system.disk")}</span>
            <span>{formatBytes(info.disk.free)} free</span>
          </div>
          <Bar pct={diskPct} color={diskPct > 90 ? "#ef4444" : colors.cyan} />
        </div>
      )}

      {/* CPU */}
      <div style={{ marginBottom: "4px" }}>
        <span style={{ color: colors.textGhost }}>{t("system.cpuCores")} </span>
        <span>{info.cpus}</span>
      </div>

      <div style={{ color: colors.textGhost, fontSize: "9px", marginTop: "6px" }}>
        {info.platform} | {t("system.node")} {info.nodeVersion}
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "2px", transition: "width 0.3s" }} />
    </div>
  );
}
