import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { log } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * `trove desktop` — launch Trove as a desktop app via Electron.
 * Starts the API server automatically + opens the Electron window.
 */
export async function desktopCommand(): Promise<void> {
  log.brand("Launching Trove Desktop...\n");

  // Resolve the web package directory (where electron/main.cjs lives)
  // CLI is at packages/cli/dist/commands/desktop.js → go up to monorepo root → packages/web
  const webDir = resolve(__dirname, "..", "..", "..", "web");
  const electronExe = process.platform === "win32"
    ? resolve(webDir, "node_modules", "electron", "dist", "electron.exe")
    : resolve(webDir, "node_modules", ".bin", "electron");

  log.info(`Starting Electron from ${webDir}`);

  const child = spawn(electronExe, ["."], {
    cwd: webDir,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.on("error", (err) => {
    log.error(`Failed to launch: ${err.message}`);
    log.info("Make sure Electron is installed: cd packages/web && pnpm install");
    process.exitCode = 1;
  });

  child.unref();

  log.info("Trove Desktop launched. You can close this terminal.");
}
