import { useEffect } from "react";
import { colors, fonts, zIndex } from "../lib/theme";
import { useBootSequence } from "../hooks/useBootSequence";
import { useI18n } from "../lib/i18n";
import { Diamond3D } from "./Diamond3D";

export function BootSequence({ onComplete }: { onComplete: () => void }) {
  const { t } = useI18n();
  const {
    phase,
    done,
    logoOpacity,
    logoScale,
    fadeOutOpacity,
  } = useBootSequence();

  useEffect(() => {
    if (done) {
      requestAnimationFrame(onComplete);
    }
  }, [done, onComplete]);

  // Progress width based on phase
  const progressWidth =
    phase === "done" || phase === "fade-out"
      ? "100%"
      : phase === "stats"
        ? "90%"
        : phase === "terminal"
          ? "70%"
          : phase === "logo-shrink"
            ? "40%"
            : "10%";

  const showProgress = phase !== "logo-in";

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
        fontFamily: fonts.sans,
        zIndex: zIndex.boot,
        opacity: fadeOutOpacity,
        transition: "opacity 400ms ease-out",
      }}
    >
      {/* Logo — diamond + brand name, vertically centered */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
          transition: "all 600ms cubic-bezier(0.25, 0.1, 0.25, 1)",
        }}
      >
        <Diamond3D size={240} />
        {/* Same font as hero page */}
        <span
          style={{
            fontSize: "36px",
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: colors.text,
            fontFamily: fonts.sans,
            marginTop: "-8px",
          }}
        >
          Trove
        </span>
      </div>

      {/* Tagline */}
      <div
        style={{
          color: colors.textMuted,
          fontSize: "14px",
          fontWeight: 400,
          fontFamily: fonts.sans,
          opacity: logoOpacity,
          transition: "all 600ms cubic-bezier(0.25, 0.1, 0.25, 1)",
          marginTop: "8px",
          marginBottom: "40px",
        }}
      >
        {t("boot.tagline")}
      </div>

      {/* Progress bar — minimal, wider */}
      {showProgress && (
        <div
          style={{
            width: "240px",
            opacity: logoOpacity,
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
                background: `linear-gradient(90deg, ${colors.brand}, ${colors.brand}cc)`,
                borderRadius: "1px",
                width: progressWidth,
                transition: "width 400ms ease-out",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
