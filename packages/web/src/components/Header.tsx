import { useState, useEffect, useCallback } from "react";
import { colors, fonts, transitions, radii, zIndex } from "../lib/theme";
import { Diamond3D } from "./Diamond3D";
import { WindowControls, isElectron } from "./WindowControls";
import { LangToggle } from "./LangToggle";
import { useI18n } from "../lib/i18n";
import { api } from "../lib/api";

export type ViewMode = "search" | "sources" | "files";

const NAV_KEYS: ViewMode[] = ["search", "sources", "files"];

const NAV_ICONS: Record<ViewMode, string> = {
  search: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z",
  sources: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  files: "M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9l-7-7zM13 2v7h7",
};

interface HeaderProps {
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  onGoHome: () => void;
  showBack?: boolean;
}

export function Header({ view, onViewChange, onGoHome, showBack }: HeaderProps) {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<ViewMode | null>(null);
  const [ctrlKHovered, setCtrlKHovered] = useState(false);
  const [lobsterHovered, setLobsterHovered] = useState(false);
  const [backHovered, setBackHovered] = useState(false);

  const handleScroll = useCallback(() => {
    setScrolled(window.scrollY > 8);
  }, []);

  useEffect(() => {
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);


  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: zIndex.dropdown,
        flexShrink: 0,
      }}
    >
      {/* Main header bar */}
      <div
        style={{
          padding: "0 16px",
          background: scrolled
            ? "rgba(10,10,11,0.88)"
            : "rgba(10,10,11,0.6)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          height: "46px",
          transition: `background ${transitions.normal}`,
          borderBottom: `1px solid ${colors.border}`,
          ...(isElectron ? { WebkitAppRegion: "drag" } as React.CSSProperties : {}),
        }}
      >
        {/* Left: Back + Logo + Widget button */}
        <div
          style={{
            position: "absolute",
            left: "16px",
            top: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            ...(isElectron ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : {}),
          }}
        >
          {/* Back button — visible when deep in funnel */}
          {showBack && (
            <button
              onClick={onGoHome}
              onMouseEnter={() => setBackHovered(true)}
              onMouseLeave={() => setBackHovered(false)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                border: `1px solid ${backHovered ? colors.borderHover : colors.border}`,
                background: backHovered ? "rgba(255,255,255,0.06)" : "transparent",
                cursor: "pointer",
                transition: `all ${transitions.fast}`,
                outline: "none",
                padding: 0,
                flexShrink: 0,
              }}
              title={t("nav.back")}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                style={{
                  transform: backHovered ? "translateX(-1px)" : "translateX(0)",
                  transition: `transform ${transitions.fast}`,
                }}
              >
                <path
                  d="M8.5 3L4.5 7L8.5 11"
                  stroke={backHovered ? colors.text : colors.textMuted}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}

          {/* Logo — clickable, goes home */}
          <div
            style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}
            onClick={onGoHome}
            onMouseEnter={() => setLobsterHovered(true)}
            onMouseLeave={() => setLobsterHovered(false)}
          >
            <div
              style={{
                transform: lobsterHovered ? "scale(1.15)" : "scale(1)",
                transition: "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
                display: "flex",
                alignItems: "center",
              }}
            >
              <Diamond3D size={28} glow={false} />
            </div>
            <span
              style={{
                fontWeight: 600,
                fontSize: "15px",
                color: lobsterHovered ? colors.brand : colors.text,
                fontFamily: fonts.sans,
                letterSpacing: "-0.01em",
                transition: `color ${transitions.fast}`,
              }}
            >
              Trove
            </span>
          </div>

        </div>

        {/* Center: Navigation tabs */}
        <div
          style={{
            display: "flex",
            gap: "2px",
            background: colors.surface,
            borderRadius: radii.md,
            padding: "3px",
            border: `1px solid ${colors.border}`,
            ...(isElectron ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : {}),
          }}
        >
          {NAV_KEYS.map((key) => {
            const active = view === key;
            const hovered = hoveredTab === key;

            return (
              <button
                key={key}
                onClick={() => onViewChange(key)}
                onMouseEnter={() => setHoveredTab(key)}
                onMouseLeave={() => setHoveredTab(null)}
                style={{
                  fontSize: "13px",
                  cursor: "pointer",
                  padding: "5px 14px",
                  fontFamily: fonts.sans,
                  fontWeight: active ? 600 : 400,
                  background: active
                    ? "rgba(249,115,22,0.1)"
                    : hovered
                      ? "rgba(255,255,255,0.05)"
                      : "transparent",
                  border: "none",
                  borderRadius: "6px",
                  color: active ? colors.brand : hovered ? colors.text : colors.textDim,
                  transition: "all 200ms cubic-bezier(0.25, 0.1, 0.25, 1)",
                  outline: "none",
                  letterSpacing: "0",
                  lineHeight: "20px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  position: "relative",
                  transform: hovered && !active ? "translateY(-1px)" : "translateY(0)",
                  boxShadow: active
                    ? "0 0 12px rgba(249,115,22,0.15)"
                    : "none",
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{
                    flexShrink: 0,
                    transition: "all 200ms ease",
                    opacity: active ? 1 : hovered ? 0.7 : 0.4,
                  }}
                >
                  <path
                    d={NAV_ICONS[key]}
                    stroke={active ? colors.brand : hovered ? colors.text : colors.textDim}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {t(`nav.${key}`)}
                {/* Active indicator bar */}
                {active && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: "-3px",
                      left: "20%",
                      right: "20%",
                      height: "2px",
                      borderRadius: "1px",
                      background: `linear-gradient(90deg, transparent, ${colors.brand}, transparent)`,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Ctrl+K + Lang + Window controls */}
        <div style={{
          position: "absolute",
          right: "16px",
          top: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          gap: "4px",
          ...(isElectron ? { WebkitAppRegion: "no-drag" } as React.CSSProperties : {}),
        }}>
          <button
            onMouseEnter={() => setCtrlKHovered(true)}
            onMouseLeave={() => setCtrlKHovered(false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 10px",
              background: ctrlKHovered
                ? "rgba(255,255,255,0.06)"
                : "rgba(255,255,255,0.03)",
              border: `1px solid ${ctrlKHovered ? colors.borderHover : colors.border}`,
              borderRadius: "6px",
              cursor: "pointer",
              transition: `all ${transitions.fast}`,
              outline: "none",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: ctrlKHovered ? colors.textMuted : colors.textDim,
                fontFamily: fonts.sans,
                fontWeight: 500,
                transition: `color ${transitions.fast}`,
              }}
            >
              Ctrl+K
            </span>
          </button>
          <LangToggle />
          <WindowControls />
        </div>
      </div>
    </div>
  );
}
