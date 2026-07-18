import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let apiProcess: ChildProcessWithoutNullStreams | null = null;
let apiBaseUrl = "";
let allowClose = false;
let closeRequestPending = false;

async function createWindow() {
  apiBaseUrl = await resolveApiBaseUrl();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1060,
    minHeight: 720,
    title: "songcut",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.on("close", (event) => {
    if (allowClose) return;
    event.preventDefault();
    if (closeRequestPending) return;
    closeRequestPending = true;
    mainWindow?.webContents.send("songcut:close-requested");
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
  const useDevServer = process.env.SONGCUT_GUI_DIST !== "1" && (!app.isPackaged || process.env.SONGCUT_GUI_DEV === "1");
  if (useDevServer) {
    await mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  stopPythonApi();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  allowClose = true;
  stopPythonApi();
});

ipcMain.handle("songcut:apiBaseUrl", () => apiBaseUrl);

ipcMain.handle("songcut:confirm-close", () => {
  allowClose = true;
  app.quit();
});

ipcMain.handle("songcut:cancel-close", () => {
  closeRequestPending = false;
});

ipcMain.handle("songcut:selectVideo", async () => {
  if (process.env.SONGCUT_E2E_VIDEO) return process.env.SONGCUT_E2E_VIDEO;
  const options = {
    title: "Open video",
    properties: ["openFile"],
    filters: [
      { name: "Video", extensions: ["mp4", "mkv", "mov", "webm", "avi", "m4v", "mpg", "mpeg"] },
      { name: "All files", extensions: ["*"] }
    ]
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("songcut:selectOutputDirectory", async () => {
  if (process.env.SONGCUT_E2E_OUTPUT_DIR) return process.env.SONGCUT_E2E_OUTPUT_DIR;
  const options = {
    title: "Select output folder",
    properties: ["openDirectory", "createDirectory"]
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("songcut:fileUrl", (_event, filePath: string) => pathToFileURL(filePath).toString());

async function resolveApiBaseUrl(): Promise<string> {
  const externalBaseUrl = process.env.SONGCUT_API_BASE_URL;
  if (externalBaseUrl) {
    await waitForHealth(externalBaseUrl);
    return externalBaseUrl;
  }
  return startPythonApi();
}

async function startPythonApi(): Promise<string> {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const packagedExe = process.env.SONGCUT_API_EXE ?? path.join(process.resourcesPath ?? "", "backend", "songcut-api.exe");
  const usePackaged = Boolean(process.env.SONGCUT_API_EXE) || app.isPackaged;
  const repoRoot = process.env.SONGCUT_REPO_ROOT ?? path.resolve(app.getAppPath(), "..");
  const python = process.env.SONGCUT_PYTHON ?? "python";
  const command = usePackaged ? packagedExe : python;
  const args = usePackaged
    ? ["--host", "127.0.0.1", "--port", String(port)]
    : ["-m", "songcut.api", "--host", "127.0.0.1", "--port", String(port)];

  apiProcess = spawn(command, args, {
    cwd: repoRoot,
    env: { ...process.env, PYTHONUTF8: "1" }
  });
  apiProcess.stdout.on("data", (chunk) => console.log(`[songcut-api] ${chunk}`));
  apiProcess.stderr.on("data", (chunk) => console.error(`[songcut-api] ${chunk}`));
  apiProcess.on("exit", (code) => console.log(`songcut-api exited with ${code}`));

  await waitForHealth(baseUrl);
  return baseUrl;
}

function stopPythonApi() {
  if (apiProcess && !apiProcess.killed) {
    apiProcess.kill();
    apiProcess = null;
  }
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 8765;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("songcut API did not become ready in time.");
}
