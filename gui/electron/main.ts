import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  archiveConflict,
  archiveRelinkedProject,
  clearRecovery,
  findProjectSource,
  fingerprintSource,
  loadProject,
  loadRecovery,
  projectPathForVideo,
  saveProject,
  saveRecovery,
  sourceIdentityMatches,
} from "./project-store.js";
import type { ProjectDocumentV1, RecoverySnapshot, SourceIdentity, WhisperModelKey } from "./project-schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const usageEnglishUrl = "https://mokusatsu.github.io/songcut/USAGE.html";
const usageJapaneseUrl = "https://mokusatsu.github.io/songcut/USAGE.ja.html";
const keyboardShortcutsUrl = "https://mokusatsu.github.io/songcut/KEYBOARD_SHORTCUTS.html";
const repositoryUrl = "https://github.com/mokusatsu/songcut";
const issuesUrl = "https://github.com/mokusatsu/songcut/issues";

if (process.env.SONGCUT_E2E_USER_DATA_DIR) {
  app.setPath("userData", process.env.SONGCUT_E2E_USER_DATA_DIR);
}

let mainWindow: BrowserWindow | null = null;
let apiProcess: ChildProcessWithoutNullStreams | null = null;
let apiBaseUrl = "";
let allowClose = false;
let closeRequestPending = false;

const zoomLevels = [1, 2, 4, 8, 16, 32];
const inferenceDevices = ["auto", "npu", "gpu", "cpu"] as const;
const whisperModels = ["tiny", "base", "small"] as const;
const waveformDisplayModes = ["rms", "peak", "peak-rms"] as const;
const e2eMenuCommandTypes = new Set([
  "new-segment",
  "remove-segment",
  "remove-unchecked-segments",
  "sort-segments",
  "check-all-segments",
  "uncheck-all-segments",
  "invert-segment-selection",
]);

type InferenceDevice = (typeof inferenceDevices)[number];
type AnalysisDevice = InferenceDevice;
type WhisperDevice = InferenceDevice;
type WaveformDisplayMode = (typeof waveformDisplayModes)[number];

type SongcutMenuCommand =
  | { type: "load-movie" }
  | { type: "open-project" }
  | { type: "save-project" }
  | { type: "relink-source" }
  | { type: "nudge-boundary-left" }
  | { type: "nudge-boundary-right" }
  | { type: "previous-segment" }
  | { type: "next-segment" }
  | { type: "new-segment" }
  | { type: "remove-segment" }
  | { type: "remove-unchecked-segments" }
  | { type: "sort-segments" }
  | { type: "check-all-segments" }
  | { type: "uncheck-all-segments" }
  | { type: "invert-segment-selection" }
  | { type: "zoom-in" }
  | { type: "zoom-out" }
  | { type: "set-zoom"; zoomIndex: number }
  | { type: "start" }
  | { type: "previous-boundary" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "next-boundary" }
  | { type: "play-start-boundary" }
  | { type: "play-end-boundary" }
  | { type: "export-movie" }
  | { type: "export-ts-text" }
  | { type: "open-settings" };

type SongcutMenuState = {
  apiReady: boolean;
  hasProject: boolean;
  hasVideo: boolean;
  hasSegments: boolean;
  hasSelectedSegment: boolean;
  hasCheckedSegments: boolean;
  hasUncheckedSegments: boolean;
  hasMultipleSegments: boolean;
  canSelectPreviousSegment: boolean;
  canSelectNextSegment: boolean;
  playing: boolean;
  zoomIndex: number;
  waveformDisplayMode: WaveformDisplayMode;
  scratchAudioProxyEnabled: boolean;
  analysisDevice: AnalysisDevice;
  whisperDevice: WhisperDevice;
  whisperModel: WhisperModelKey;
};

let menuState: SongcutMenuState = {
  apiReady: false,
  hasProject: false,
  hasVideo: false,
  hasSegments: false,
  hasSelectedSegment: false,
  hasCheckedSegments: false,
  hasUncheckedSegments: false,
  hasMultipleSegments: false,
  canSelectPreviousSegment: false,
  canSelectNextSegment: false,
  playing: false,
  zoomIndex: 0,
  waveformDisplayMode: "rms",
  scratchAudioProxyEnabled: true,
  analysisDevice: "auto",
  whisperDevice: "auto",
  whisperModel: "small"
};

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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      !input.isAutoRepeat &&
      input.control &&
      !input.alt &&
      !input.shift &&
      !input.meta &&
      input.key === ","
    ) {
      event.preventDefault();
      sendMenuCommand({ type: "open-settings" });
    }
  });
  setApplicationMenu();

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

ipcMain.handle("songcut:openProject", async () => {
  const options = {
    title: "Open songcut project",
    properties: ["openFile"],
    filters: [{ name: "songcut Project", extensions: ["songcut"] }]
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;
  return loadProject(result.filePaths[0]);
});

ipcMain.handle("songcut:loadProject", (_event, projectPath: string) => loadProject(projectPath));
ipcMain.handle("songcut:projectPathForVideo", (_event, videoPath: string) => projectPathForVideo(videoPath));
ipcMain.handle(
  "songcut:saveProject",
  (_event, projectPath: string, document: ProjectDocumentV1) => saveProject(projectPath, document)
);
ipcMain.handle("songcut:loadRecovery", () => loadRecovery(app.getPath("userData")));
ipcMain.handle(
  "songcut:saveRecovery",
  (_event, snapshot: RecoverySnapshot) => saveRecovery(app.getPath("userData"), snapshot)
);
ipcMain.handle("songcut:clearRecovery", () => clearRecovery(app.getPath("userData")));
ipcMain.handle("songcut:fingerprintSource", (_event, filePath: string) => fingerprintSource(filePath));
ipcMain.handle(
  "songcut:findProjectSource",
  (_event, projectPath: string, document: ProjectDocumentV1) => findProjectSource(projectPath, document)
);
ipcMain.handle(
  "songcut:sourceIdentityMatches",
  (_event, document: ProjectDocumentV1, identity: SourceIdentity) => sourceIdentityMatches(document, identity)
);
ipcMain.handle("songcut:archiveRelinkedProject", (_event, projectPath: string) => archiveRelinkedProject(projectPath));
ipcMain.handle("songcut:archiveConflict", (_event, filePath: string) => archiveConflict(filePath));
ipcMain.handle("songcut:setWindowTitle", (_event, title: string) => {
  mainWindow?.setTitle(title.trim() || "songcut");
});

ipcMain.handle("songcut:selectRelinkSource", async (_event, expectedName: string) => {
  const options = {
    title: `Relink ${expectedName}`,
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

ipcMain.on("songcut:update-menu-state", (_event, nextState: Partial<SongcutMenuState>) => {
  menuState = {
    ...menuState,
    ...nextState,
    zoomIndex: clampMenuZoom(nextState.zoomIndex ?? menuState.zoomIndex),
    waveformDisplayMode: normalizeWaveformDisplayMode(nextState.waveformDisplayMode ?? menuState.waveformDisplayMode),
    scratchAudioProxyEnabled: normalizeMenuBoolean(
      nextState.scratchAudioProxyEnabled,
      menuState.scratchAudioProxyEnabled
    ),
    analysisDevice: normalizeInferenceDevice(nextState.analysisDevice ?? menuState.analysisDevice),
    whisperDevice: normalizeInferenceDevice(nextState.whisperDevice ?? menuState.whisperDevice),
    whisperModel: normalizeWhisperModel(nextState.whisperModel ?? menuState.whisperModel)
  };
  setApplicationMenu();
});

ipcMain.on("songcut:e2e-menu-command", (_event, command: unknown) => {
  if (!process.env.SONGCUT_E2E_USER_DATA_DIR || !command || typeof command !== "object") return;
  const type = (command as { type?: unknown }).type;
  if (typeof type === "string" && e2eMenuCommandTypes.has(type)) {
    sendMenuCommand({ type } as SongcutMenuCommand);
  }
});

ipcMain.handle("songcut:e2e-menu-structure", () => {
  if (!process.env.SONGCUT_E2E_USER_DATA_DIR) return null;
  const segmentMenu = Menu.getApplicationMenu()?.items.find((item) => item.label === "Segment");
  return (
    segmentMenu?.submenu?.items.map((item) => ({
      label: item.label,
      type: item.type,
      enabled: item.enabled,
      hasSubmenu: Boolean(item.submenu)
    })) ?? null
  );
});

function setApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate()));
}

function applicationMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  const canUseVideo = menuState.hasVideo;
  const canUseSegments = canUseVideo && menuState.hasSegments;
  const canUseSelectedSegment = canUseVideo && menuState.hasSelectedSegment;
  const canExportMovie = canUseVideo && menuState.hasCheckedSegments;
  const canExportText = menuState.hasCheckedSegments;
  const zoomIndex = clampMenuZoom(menuState.zoomIndex);

  const send = (command: SongcutMenuCommand) => () => sendMenuCommand(command);

  return [
    {
      label: "File",
      submenu: [
        { label: "Load Movie", click: send({ type: "load-movie" }) },
        { label: "Open Project...", accelerator: "Ctrl+Shift+O", click: send({ type: "open-project" }) },
        { label: "Save Project Now", accelerator: "Ctrl+S", enabled: menuState.hasProject, click: send({ type: "save-project" }) },
        { label: "Relink Source...", enabled: menuState.hasProject, click: send({ type: "relink-source" }) },
        { type: "separator" },
        { role: "close" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { label: "-- Nudge Adjust Boundary --", enabled: false },
        {
          label: "Nudge Boundary Left",
          accelerator: "Q",
          registerAccelerator: false,
          enabled: canUseSegments,
          click: send({ type: "nudge-boundary-left" })
        },
        {
          label: "Nudge Boundary Right",
          accelerator: "E",
          registerAccelerator: false,
          enabled: canUseSegments,
          click: send({ type: "nudge-boundary-right" })
        },
        { type: "separator" },
        { label: "-- Timeline --", enabled: false },
        {
          label: "Zoom +",
          accelerator: "C",
          registerAccelerator: false,
          enabled: zoomIndex < zoomLevels.length - 1,
          click: send({ type: "zoom-in" })
        },
        {
          label: "Zoom -",
          accelerator: "Z",
          registerAccelerator: false,
          enabled: zoomIndex > 0,
          click: send({ type: "zoom-out" })
        },
        {
          label: "Zoom Level",
          submenu: zoomLevels.map((level, index) => ({
            label: `${level * 100}%`,
            type: "radio",
            checked: index === zoomIndex,
            ...(index === 0 ? { accelerator: "X", registerAccelerator: false } : {}),
            click: send({ type: "set-zoom", zoomIndex: index })
          }))
        },
        { type: "separator" },
        { label: "Cut", role: "cut" },
        { label: "Copy", role: "copy" },
        { label: "Paste", role: "paste" }
      ]
    },
    {
      label: "Play",
      submenu: [
        { label: "-- Movie Control --", enabled: false },
        { label: "Start", enabled: canUseVideo, click: send({ type: "start" }) },
        {
          label: "Previous Boundary",
          accelerator: "Ctrl+A",
          registerAccelerator: false,
          enabled: canUseSegments,
          click: send({ type: "previous-boundary" })
        },
        {
          label: menuState.playing ? "Pause" : "Play",
          accelerator: "Space",
          registerAccelerator: false,
          enabled: canUseVideo,
          click: send(menuState.playing ? { type: "pause" } : { type: "play" })
        },
        {
          label: "Next Boundary",
          accelerator: "Ctrl+D",
          registerAccelerator: false,
          enabled: canUseSegments,
          click: send({ type: "next-boundary" })
        },
        { type: "separator" },
        { label: "-- Play Boundary --", enabled: false },
        {
          label: "Play Start Boundary",
          accelerator: "A",
          registerAccelerator: false,
          enabled: canUseSelectedSegment,
          click: send({ type: "play-start-boundary" })
        },
        {
          label: "Play End Boundary",
          accelerator: "D",
          registerAccelerator: false,
          enabled: canUseSelectedSegment,
          click: send({ type: "play-end-boundary" })
        }
      ]
    },
    {
      label: "Segment",
      submenu: [
        { label: "-- Segment Selection --", enabled: false },
        {
          label: "Previous Segment",
          accelerator: "W",
          registerAccelerator: false,
          enabled: canUseSegments && menuState.canSelectPreviousSegment,
          click: send({ type: "previous-segment" })
        },
        {
          label: "Next Segment",
          accelerator: "S",
          registerAccelerator: false,
          enabled: canUseSegments && menuState.canSelectNextSegment,
          click: send({ type: "next-segment" })
        },
        { type: "separator" },
        { label: "-- Segment Management --", enabled: false },
        { label: "New Segment", enabled: menuState.hasProject, click: send({ type: "new-segment" }) },
        {
          label: "Remove Segment...",
          enabled: menuState.hasProject && menuState.hasSelectedSegment,
          click: send({ type: "remove-segment" })
        },
        {
          label: "Remove All Unchecked Segments...",
          enabled: menuState.hasProject && menuState.hasUncheckedSegments,
          click: send({ type: "remove-unchecked-segments" })
        },
        {
          label: "Sort Segments...",
          enabled: menuState.hasProject && menuState.hasMultipleSegments,
          click: send({ type: "sort-segments" })
        },
        { type: "separator" },
        { label: "-- Export Selection --", enabled: false },
        {
          label: "Check All",
          enabled: menuState.hasProject && menuState.hasUncheckedSegments,
          click: send({ type: "check-all-segments" })
        },
        {
          label: "Uncheck All",
          enabled: menuState.hasProject && menuState.hasCheckedSegments,
          click: send({ type: "uncheck-all-segments" })
        },
        {
          label: "Invert Selection",
          enabled: menuState.hasProject && menuState.hasSegments,
          click: send({ type: "invert-segment-selection" })
        }
      ]
    },
    {
      label: "Export",
      submenu: [
        { label: "Export Movie", enabled: canExportMovie, click: send({ type: "export-movie" }) },
        { label: "Export TS Text", enabled: canExportText, click: send({ type: "export-ts-text" }) }
      ]
    },
    {
      label: "Settings",
      submenu: [
        { label: "Settings...\tCtrl+,", click: send({ type: "open-settings" }) }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "close" }]
    },
    {
      label: "Help",
      submenu: [
        { label: "About songcut", click: showAboutSongcut },
        { type: "separator" },
        { label: "User Guide (English)", click: () => void shell.openExternal(usageEnglishUrl) },
        { label: "User Guide (Japanese)", click: () => void shell.openExternal(usageJapaneseUrl) },
        { label: "Keyboard Shortcuts", click: () => void shell.openExternal(keyboardShortcutsUrl) },
        { type: "separator" },
        { label: "Open Repository", click: () => void shell.openExternal(repositoryUrl) },
        { label: "Report Issue / Request Feature", click: () => void shell.openExternal(issuesUrl) }
      ]
    }
  ];
}

function sendMenuCommand(command: SongcutMenuCommand) {
  mainWindow?.webContents.send("songcut:menu-command", command);
}

function clampMenuZoom(value: number) {
  return Math.max(0, Math.min(zoomLevels.length - 1, Math.round(value)));
}

function normalizeInferenceDevice(value: unknown): InferenceDevice {
  return typeof value === "string" && inferenceDevices.includes(value as InferenceDevice)
    ? (value as InferenceDevice)
    : "auto";
}

function normalizeWhisperModel(value: unknown): WhisperModelKey {
  return typeof value === "string" && whisperModels.includes(value as WhisperModelKey)
    ? (value as WhisperModelKey)
    : "small";
}

function normalizeWaveformDisplayMode(value: unknown): WaveformDisplayMode {
  return typeof value === "string" && waveformDisplayModes.includes(value as WaveformDisplayMode)
    ? (value as WaveformDisplayMode)
    : "rms";
}

function normalizeMenuBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}


function showAboutSongcut() {
  app.setAboutPanelOptions({
    applicationName: "songcut",
    applicationVersion: app.getVersion(),
    credits: `Build time: ${formatBuildTime()}\nElectron: ${process.versions.electron}`
  });
  app.showAboutPanel();
}

function formatBuildTime() {
  try {
    return statSync(__filename).mtime.toLocaleString();
  } catch {
    return "Unknown";
  }
}

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
