const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

const API_PORT = 7334;
const API_URL = `http://127.0.0.1:${API_PORT}`;

let mainWindow;
let serverProcess;

// ── Start the API server as a child process ──────────────────────────
function startServer() {
  const webDir = path.join(__dirname, "..");
  const serverPath = path.join(webDir, "server.ts");
  // Use node with tsx loader — avoids shell:true and path-with-spaces issues
  const tsxLoader = path.join(webDir, "node_modules", "tsx", "dist", "loader.mjs");
  const tsxPreflight = path.join(webDir, "node_modules", "tsx", "dist", "preflight.cjs");

  serverProcess = spawn(
    process.execPath, // node.exe — always works
    [
      "--require", tsxPreflight,
      "--import", `file:///${tsxLoader.replace(/\\/g, "/")}`,
      serverPath,
    ],
    {
      cwd: webDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    }
  );

  serverProcess.stdout?.on("data", (d) => {
    console.log("[api]", d.toString().trim());
  });
  serverProcess.stderr?.on("data", (d) => {
    console.error("[api]", d.toString().trim());
  });
  serverProcess.on("exit", (code) => {
    console.log("[api] exited with code:", code);
    serverProcess = null;
  });
}

// ── Wait for the API to be ready ─────────────────────────────────────
function waitForApi(maxRetries = 30) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      const http = require("http");
      const req = http.get(`${API_URL}/api/stats`, (res) => {
        if (res.statusCode === 200 || res.statusCode === 401) {
          resolve();
        } else {
          retry();
        }
        res.resume();
      });
      req.on("error", retry);
      req.setTimeout(1000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      retries++;
      if (retries >= maxRetries) {
        reject(new Error("API server did not start in time"));
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });
}

// ── Create the Electron window ───────────────────────────────────────
function createWindow() {
  const isMac = process.platform === "darwin";

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    transparent: false,
    ...(isMac ? { titleBarStyle: "hidden" } : {}),
    backgroundColor: "#0a0a0b",
    icon: path.join(__dirname, "..", "public", "trove-icon.png"),
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Try Vite dev server first (for dev mode), then API server (prod), then built files
  mainWindow.loadURL("http://localhost:7332").catch(() => {
    mainWindow.loadURL(API_URL).catch(() => {
      const distIndex = path.join(__dirname, "..", "dist", "index.html");
      mainWindow.loadFile(distIndex).catch(() => {
        mainWindow.loadURL(
          `data:text/html,<body style="background:#0a0a0b;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>💎 Trove</h2><p>Starting...</p></div></body>`
        );
        mainWindow.show();
      });
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── IPC handlers ─────────────────────────────────────────────────────
ipcMain.on("window:minimize", () => mainWindow?.minimize());
ipcMain.on("window:maximize", () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on("window:close", () => mainWindow?.close());

// ── App lifecycle ────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Start the API server
  startServer();

  // Wait for it to be ready
  try {
    await waitForApi();
    console.log("[trove] API ready, opening window...");
  } catch {
    console.error("[trove] API server timeout — opening window anyway");
  }

  createWindow();
});

app.on("window-all-closed", () => {
  // Kill the API server when the window is closed
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
