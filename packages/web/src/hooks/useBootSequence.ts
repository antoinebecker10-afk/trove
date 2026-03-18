import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";

export type BootPhase = "logo-in" | "logo-shrink" | "terminal" | "stats" | "fade-out" | "done";

interface BootLine {
  prefix: string;
  text: string;
  displayedText: string;
  color: string;
  done: boolean;
}

/** Fallback lines if API is unreachable */
const FALLBACK_LINES: Array<{ prefix: string; text: string; color: string }> = [
  { prefix: "[boot]", text: "trove v0.1.0", color: "#e5e5e5" },
  { prefix: "[init]", text: "connecting to engine...", color: "#e5e5e5" },
  { prefix: "[warn]", text: "api offline — retrying on load", color: "#f97316" },
  { prefix: "[ready]", text: "file manager \u2713 | search \u2713 | launcher \u2713", color: "#22c55e" },
  { prefix: "[ok]", text: "system online", color: "#22c55e" },
];

async function fetchBootLines(): Promise<Array<{ prefix: string; text: string; color: string }>> {
  try {
    const [statsData, connectorsData] = await Promise.all([
      api.stats(),
      api.connectors().catch(() => ({ connectors: [] })),
    ]);

    const sources = connectorsData.connectors
      ?.filter((c: { status: string }) => c.status === "connected")
      .map((c: { name: string }) => c.name) ?? [];

    const sourceList = sources.length > 0 ? sources.join(", ") : "local";

    const typeParts: string[] = [];
    if (statsData.byType) {
      for (const [type, count] of Object.entries(statsData.byType)) {
        if (count > 0) typeParts.push(`${count} ${type}s`);
      }
    }
    const typeStr = typeParts.length > 0 ? typeParts.join(" \u00B7 ") : "ready";

    return [
      { prefix: "[boot]", text: "trove v0.1.0", color: "#e5e5e5" },
      { prefix: "[init]", text: `loading ${sources.length} source${sources.length !== 1 ? "s" : ""}: ${sourceList}`, color: "#e5e5e5" },
      { prefix: "[index]", text: `${statsData.totalItems.toLocaleString()} items indexed`, color: "#22c55e" },
      { prefix: "[data]", text: typeStr, color: "#06b6d4" },
      { prefix: "[ready]", text: "file manager \u2713 | search \u2713 | launcher \u2713", color: "#22c55e" },
      { prefix: "[ok]", text: "system online", color: "#22c55e" },
    ];
  } catch {
    return FALLBACK_LINES;
  }
}

const CHAR_DELAY = 12;
const LINE_PAUSE = 80;

/**
 * Cinematic boot sequence with phased animations.
 * Phase 1 (0-500ms):    Black screen, logo fades in large
 * Phase 2 (500-1500ms): Logo shrinks and moves up, terminal starts
 * Phase 3 (1500-2500ms): Terminal lines complete, stats flash
 * Phase 4 (2500-3000ms): Everything fades into main UI
 */
export function useBootSequence(): {
  phase: BootPhase;
  lines: BootLine[];
  done: boolean;
  logoOpacity: number;
  logoScale: number;
  terminalOpacity: number;
  fadeOutOpacity: number;
  cursorVisible: boolean;
} {
  const [phase, setPhase] = useState<BootPhase>("logo-in");
  const [lines, setLines] = useState<BootLine[]>([]);
  const [done, setDone] = useState(false);
  const [logoOpacity, setLogoOpacity] = useState(0);
  const [logoScale, setLogoScale] = useState(1);
  const [terminalOpacity, setTerminalOpacity] = useState(0);
  const [fadeOutOpacity, setFadeOutOpacity] = useState(1);
  const [cursorVisible, setCursorVisible] = useState(true);
  const animFrameRef = useRef<number>(0);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const addTimeout = (fn: () => void, ms: number) => {
      const t = setTimeout(fn, ms);
      timeoutsRef.current.push(t);
      return t;
    };

    // Phase 1: Logo fades in (0-500ms)
    addTimeout(() => setLogoOpacity(1), 50);

    // Phase 2: Logo shrinks, terminal appears (500ms)
    addTimeout(() => {
      setPhase("logo-shrink");
      setLogoScale(0.5);
      setTerminalOpacity(1);
    }, 500);

    // Phase 3: Terminal lines start (800ms) — fetch real data while logo animates
    const linesPromise = fetchBootLines();

    addTimeout(() => {
      setPhase("terminal");
      linesPromise.then(typeLines);
    }, 800);

    // Cursor blink
    const cursorInterval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);

    function typeLines(terminalLines: Array<{ prefix: string; text: string; color: string }>) {
      let lineIndex = 0;
      let charIndex = 0;
      let currentLines: BootLine[] = [];

      function tick() {
        if (lineIndex >= terminalLines.length) {
          // All lines done, move to stats phase
          addTimeout(() => {
            setPhase("stats");
            // Phase 4: Fade out
            addTimeout(() => {
              setPhase("fade-out");
              setFadeOutOpacity(0);
              addTimeout(() => {
                setPhase("done");
                setDone(true);
              }, 500);
            }, 600);
          }, 300);
          return;
        }

        const currentDef = terminalLines[lineIndex];

        if (charIndex === 0) {
          // Start a new line
          currentLines = [
            ...currentLines,
            {
              prefix: currentDef.prefix,
              text: currentDef.text,
              displayedText: "",
              color: currentDef.color,
              done: false,
            },
          ];
        }

        const fullText = currentDef.text;
        if (charIndex <= fullText.length) {
          const updated = [...currentLines];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            displayedText: fullText.slice(0, charIndex),
            done: charIndex === fullText.length,
          };
          setLines(updated);
          currentLines = updated;

          if (charIndex < fullText.length) {
            charIndex++;
            addTimeout(tick, CHAR_DELAY);
          } else {
            // Line complete, move to next
            charIndex = 0;
            lineIndex++;
            addTimeout(tick, LINE_PAUSE);
          }
        }
      }

      tick();
    }

    return () => {
      clearInterval(cursorInterval);
      cancelAnimationFrame(animFrameRef.current);
      timeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  return {
    phase,
    lines,
    done,
    logoOpacity,
    logoScale,
    terminalOpacity,
    fadeOutOpacity,
    cursorVisible,
  };
}
