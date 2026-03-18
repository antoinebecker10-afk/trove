import { useState } from "react";
import { colors, transitions } from "../lib/theme";

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      isElectron: boolean;
    };
  }
}

export const isElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;

function ControlButton({
  onClick,
  hoverBg,
  hoverColor,
  children,
}: {
  onClick: () => void;
  hoverBg: string;
  hoverColor?: string;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "36px",
        height: "28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: hovered ? hoverBg : "transparent",
        border: "none",
        color: hovered ? (hoverColor ?? colors.text) : colors.textDim,
        cursor: "pointer",
        transition: `all ${transitions.fast}`,
        outline: "none",
        fontSize: "16px",
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

export function WindowControls() {
  if (!isElectron) return null;

  const api = window.electronAPI!;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      <ControlButton onClick={api.minimize} hoverBg="rgba(255,255,255,0.08)">
        &#x2014;
      </ControlButton>
      <ControlButton onClick={api.maximize} hoverBg="rgba(255,255,255,0.08)">
        &#x25A1;
      </ControlButton>
      <ControlButton onClick={api.close} hoverBg="#e81123" hoverColor="#fff">
        &#x2715;
      </ControlButton>
    </div>
  );
}
