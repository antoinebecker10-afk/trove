import { useEffect } from "react";
import { colors, fonts } from "../lib/theme";
import { useBootSequence } from "../hooks/useBootSequence";

const keyframesInjected = (() => {
  if (typeof document === "undefined") return true;
  const id = "trove-boot-keyframes";
  if (document.getElementById(id)) return true;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    @keyframes trovePulseGlow {
      0%, 100% { filter: drop-shadow(0 0 8px rgba(249,115,22,0.3)); }
      50% { filter: drop-shadow(0 0 24px rgba(249,115,22,0.6)); }
    }
    @keyframes troveScanline {
      0% { transform: translateY(-100%); }
      100% { transform: translateY(100vh); }
    }
    @keyframes troveFlicker {
      0%, 100% { opacity: 1; }
      92% { opacity: 1; }
      93% { opacity: 0.7; }
      94% { opacity: 1; }
      96% { opacity: 0.8; }
      97% { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
  return true;
})();

export function BootSequence({ onComplete }: { onComplete: () => void }) {
  // Ensure keyframes reference is used
  void keyframesInjected;

  const {
    phase,
    lines,
    done,
    logoOpacity,
    logoScale,
    terminalOpacity,
    fadeOutOpacity,
    cursorVisible,
  } = useBootSequence();

  useEffect(() => {
    if (done) {
      requestAnimationFrame(onComplete);
    }
  }, [done, onComplete]);

  const isLogoPhase = phase === "logo-in" || phase === "logo-shrink";
  const showTerminal = phase !== "logo-in";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: colors.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: fonts.mono,
        zIndex: 9999,
        opacity: fadeOutOpacity,
        transition: "opacity 500ms ease-out",
        overflow: "hidden",
      }}
    >
      {/* Scanline effect */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
          opacity: 0.03,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "2px",
            background: "rgba(249,115,22,0.8)",
            animation: "troveScanline 3s linear infinite",
          }}
        />
      </div>

      {/* CRT overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)",
          animation: "troveFlicker 4s ease infinite",
        }}
      />

      {/* Logo */}
      <div
        style={{
          fontSize: isLogoPhase ? "60px" : "32px",
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
          transition: "all 600ms cubic-bezier(0.25, 0.1, 0.25, 1)",
          marginBottom: showTerminal ? "24px" : "0",
          animation: logoOpacity > 0 ? "trovePulseGlow 2s ease infinite" : "none",
          lineHeight: 1,
        }}
      >
        <span role="img" aria-label="Trove logo">
          🦞
        </span>
      </div>

      {/* TROVE text under logo */}
      <div
        style={{
          color: colors.brand,
          fontSize: isLogoPhase ? "18px" : "11px",
          letterSpacing: "0.3em",
          fontWeight: 700,
          opacity: logoOpacity,
          transition: "all 600ms cubic-bezier(0.25, 0.1, 0.25, 1)",
          marginBottom: showTerminal ? "32px" : "8px",
        }}
      >
        TROVE
      </div>

      {/* Terminal */}
      <div
        style={{
          maxWidth: "480px",
          width: "100%",
          padding: "0 40px",
          opacity: terminalOpacity,
          transition: "opacity 400ms ease",
          minHeight: "140px",
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontSize: "12px",
              marginBottom: "6px",
              display: "flex",
              gap: "8px",
              lineHeight: 1.6,
            }}
          >
            <span
              style={{
                color: colors.textGhost,
                flexShrink: 0,
                fontSize: "11px",
              }}
            >
              {line.prefix}
            </span>
            <span
              style={{
                color: line.color,
                whiteSpace: "pre",
              }}
            >
              {line.displayedText}
              {/* Inline cursor on the current typing line */}
              {!line.done && i === lines.length - 1 && (
                <span
                  style={{
                    color: colors.brand,
                    opacity: cursorVisible ? 1 : 0,
                    transition: "opacity 100ms",
                  }}
                >
                  _
                </span>
              )}
            </span>
          </div>
        ))}

        {/* Blinking cursor after all lines done */}
        {lines.length > 0 && lines[lines.length - 1]?.done && (
          <div
            style={{
              marginTop: "8px",
              fontSize: "13px",
              color: colors.brand,
              opacity: cursorVisible ? 1 : 0,
              transition: "opacity 100ms",
            }}
          >
            █
          </div>
        )}
      </div>

      {/* Progress bar */}
      {showTerminal && (
        <div
          style={{
            width: "100%",
            maxWidth: "480px",
            padding: "0 40px",
            marginTop: "16px",
            opacity: terminalOpacity,
            transition: "opacity 400ms ease",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "2px",
              background: "rgba(255,255,255,0.06)",
              borderRadius: "1px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                background: `linear-gradient(90deg, ${colors.brand}, ${colors.cyan})`,
                borderRadius: "1px",
                width: phase === "done" || phase === "fade-out" ? "100%" :
                       phase === "stats" ? "90%" :
                       phase === "terminal" ? `${Math.min(80, lines.length * 16)}%` : "5%",
                transition: "width 400ms ease-out",
              }}
            />
          </div>
        </div>
      )}

      {/* Bottom gradient line */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "1px",
          background: `linear-gradient(90deg, transparent, ${colors.brand}40, ${colors.cyan}40, transparent)`,
          opacity: terminalOpacity,
          transition: "opacity 400ms ease",
        }}
      />
    </div>
  );
}
