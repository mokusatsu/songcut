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
import { initializeMainI18n, mainI18n } from "./i18n.js";
import {
  loadLocalePreference,
  normalizeUiLanguage,
  normalizeUiLanguagePreference,
  saveLocalePreference,
  type UiLanguage,
  type UiLanguagePreference,
} from "./locale.js";

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

const startupLocalePreference = loadLocalePreference(app.getPath("userData"));
let localePreference: UiLanguagePreference = startupLocalePreference;
let uiLanguage: UiLanguage = "en";
if (startupLocalePreference !== "system") {
  app.commandLine.appendSwitch("lang", startupLocalePreference);
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
const timestampExportFormats = ["timestamp-comment", "youtube-chapter", "tsv-excel", "csv", "audacity-label"] as const;
const e2eMenuCommandTypes = new Set([
  "new-segment",
  "remove-segment",
  "remove-unchecked-segments",
  "sort-segments",
  "check-all-segments",
  "uncheck-all-segments",
  "invert-segment-selection",
  "show-boundary-refinement-details",
  "open-settings",
]);

type InferenceDevice = (typeof inferenceDevices)[number];
type AnalysisDevice = InferenceDevice;
type WhisperDevice = InferenceDevice;
type WaveformDisplayMode = (typeof waveformDisplayModes)[number];
type TimestampExportFormat = (typeof timestampExportFormats)[number];

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
  | { type: "export-timestamp"; format: TimestampExportFormat }
  | { type: "open-settings" }
  | { type: "show-boundary-refinement-details" };

type SongcutMenuState = {
  apiReady: boolean;
  hasProject: boolean;
  hasVideo: boolean;
  hasSegments: boolean;
  hasSelectedSegment: boolean;
  hasBoundaryDiagnostic: boolean;
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
  hasBoundaryDiagnostic: false,
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

app.whenReady().then(async () => {
  uiLanguage = normalizeUiLanguage(app.getLocale());
  await initializeMainI18n(uiLanguage);
  await createWindow();
});

app.on("window-all-closed", () => {
  stopPythonApi();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  allowClose = true;
  stopPythonApi();
});

ipcMain.handle("songcut:apiBaseUrl", () => apiBaseUrl);
ipcMain.handle("songcut:get-locale-settings", () => ({ language: uiLanguage, preference: localePreference }));
ipcMain.handle("songcut:set-locale-preference", async (_event, value: unknown) => {
  localePreference = normalizeUiLanguagePreference(value);
  await saveLocalePreference(app.getPath("userData"), localePreference);
  return { preference: localePreference, restartRequired: localePreference !== startupLocalePreference };
});

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
    title: mainI18n.t("dialog.openVideo"),
    properties: ["openFile"],
    filters: [
      { name: mainI18n.t("dialog.video"), extensions: ["mp4", "mkv", "mov", "webm", "avi", "m4v", "mpg", "mpeg"] },
      { name: mainI18n.t("dialog.allFiles"), extensions: ["*"] }
    ]
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("songcut:openProject", async () => {
  const options = {
    title: mainI18n.t("dialog.openProject"),
    properties: ["openFile"],
    filters: [{ name: mainI18n.t("dialog.project"), extensions: ["songcut"] }]
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
    title: mainI18n.t("dialog.relinkSource", { name: expectedName }),
    properties: ["openFile"],
    filters: [
      { name: mainI18n.t("dialog.video"), extensions: ["mp4", "mkv", "mov", "webm", "avi", "m4v", "mpg", "mpeg"] },
      { name: mainI18n.t("dialog.allFiles"), extensions: ["*"] }
    ]
  } satisfies Electron.OpenDialogOptions;
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("songcut:selectOutputDirectory", async () => {
  if (process.env.SONGCUT_E2E_OUTPUT_DIR) return process.env.SONGCUT_E2E_OUTPUT_DIR;
  const options = {
    title: mainI18n.t("dialog.outputFolder"),
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
  const segmentMenu = Menu.getApplicationMenu()?.getMenuItemById("menu.segment");
  return (
    segmentMenu?.submenu?.items.map((item) => ({
      id: item.id,
      label: item.label,
      type: item.type,
      enabled: item.enabled,
      hasSubmenu: Boolean(item.submenu)
    })) ?? null
  );
});

ipcMain.handle("songcut:e2e-menu-item", (_event, id: unknown) => {
  if (!process.env.SONGCUT_E2E_USER_DATA_DIR || typeof id !== "string") return null;
  const item = Menu.getApplicationMenu()?.getMenuItemById(id);
  return item ? { id: item.id, label: item.label, accelerator: item.accelerator, enabled: item.enabled } : null;
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
      id: "menu.file",
      label: mainI18n.t("menu.file"),
      submenu: [
        { id: "file.load-movie", label: mainI18n.t("menu.loadMovie"), click: send({ type: "load-movie" }) },
        { id: "file.open-project", label: mainI18n.t("menu.openProject"), accelerator: "CommandOrControl+Shift+O", click: send({ type: "open-project" }) },
        { id: "file.save-project", label: mainI18n.t("menu.saveProject"), accelerator: "CommandOrControl+S", enabled: menuState.hasProject, click: send({ type: "save-project" }) },
        { id: "file.relink-source", label: mainI18n.t("menu.relinkSource"), enabled: menuState.hasProject, click: send({ type: "relink-source" }) },
        { type: "separator" },
        { role: "close" }
      ]
    },
    {
      id: "menu.edit",
      label: mainI18n.t("menu.edit"),
      submenu: [
        { id: "edit.nudge-heading", label: mainI18n.t("menu.nudgeHeading"), enabled: false },
        {
          id: "edit.nudge-left",
          label: mainI18n.t("menu.nudgeLeft"),
          accelerator: "Q",
          registerAccelerator: false,
          enabled: canUseSegments,
          click: send({ type: "nudge-boundary-left" })
        },
        {
          id: "edit.nudge-right",
          label: mainI18n.t("menu.nudgeRight"),
          accelerator: "E",
          registerAccelerator: false,
          enabled: canUseSegments,
          click: send({ type: "nudge-boundary-right" })
        },
        { type: "separator" },
        { id: "edit.timeline-heading", label: mainI18n.t("menu.timelineHeading"), enabled: false },
        {
          id: "edit.zoom-in",
          label: mainI18n.t("menu.zoomIn"),
          accelerator: "C",
          registerAccelerator: false,
          enabled: zoomIndex < zoomLevels.length - 1,
          click: send({ type: "zoom-in" })
        },
        {
          id: "edit.zoom-out",
          label: mainI18n.t("menu.zoomOut"),
          accelerator: "Z",
          registerAccelerator: false,
          enabled: zoomIndex > 0,
          click: send({ type: "zoom-out" })
        },
        {
          id: "edit.zoom-level",
          label: mainI18n.t("menu.zoomLevel"),
          submenu: zoomLevels.map((level, index) => ({
            label: `${level * 100}%`,
            type: "radio",
            checked: index === zoomIndex,
            ...(index === 0 ? { accelerator: "X", registerAccelerator: false } : {}),
            click: send({ type: "set-zoom", zoomIndex: index })
          }))
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" }
      ]
    },
    {
      id: "menu.play",
      label: mainI18n.t("menu.play"),
      submenu: [
        { id: "play.movie-heading", label: mainI18n.t("menu.movieControlHeading"), enabled: false },
        { id: "play.start", label: mainI18n.t("menu.start"), enabled: canUseVideo, click: send({ type: "start" }) },
        {
          id: "play.previous-boundary",
          label: mainI18n.t("menu.previousBoundary"),
          accelerator: "Ctrl+A",
          registerAccelerator: false,
          enabled: canUseSegments,
          click: send({ type: "previous-boundary" })
        },
        {
          id: "play.toggle",
          label: mainI18n.t(menuState.playing ? "menu.pause" : "menu.play"),
          accelerator: "Space",
          registerAccelerator: false,
          enabled: canUseVideo,
          click: send(menuState.playing ? { type: "pause" } : { type: "play" })
        },
        {
          id: "play.next-boundary",
          label: mainI18n.t("menu.nextBoundary"),
          accelerator: "Ctrl+D",
          registerAccelerator: false,
          enabled: canUseSegments,
          click: send({ type: "next-boundary" })
        },
        { type: "separator" },
        { id: "play.boundary-heading", label: mainI18n.t("menu.playBoundaryHeading"), enabled: false },
        {
          id: "play.start-boundary",
          label: mainI18n.t("menu.playStartBoundary"),
          accelerator: "A",
          registerAccelerator: false,
          enabled: canUseSelectedSegment,
          click: send({ type: "play-start-boundary" })
        },
        {
          id: "play.end-boundary",
          label: mainI18n.t("menu.playEndBoundary"),
          accelerator: "D",
          registerAccelerator: false,
          enabled: canUseSelectedSegment,
          click: send({ type: "play-end-boundary" })
        }
      ]
    },
    {
      id: "menu.segment",
      label: mainI18n.t("menu.segment"),
      submenu: [
        { id: "segment.selection-heading", label: mainI18n.t("menu.segmentSelectionHeading"), enabled: false },
        {
          id: "segment.previous",
          label: mainI18n.t("menu.previousSegment"),
          accelerator: "W",
          registerAccelerator: false,
          enabled: canUseSegments && menuState.canSelectPreviousSegment,
          click: send({ type: "previous-segment" })
        },
        {
          id: "segment.next",
          label: mainI18n.t("menu.nextSegment"),
          accelerator: "S",
          registerAccelerator: false,
          enabled: canUseSegments && menuState.canSelectNextSegment,
          click: send({ type: "next-segment" })
        },
        { type: "separator" },
        { id: "segment.management-heading", label: mainI18n.t("menu.segmentManagementHeading"), enabled: false },
        { id: "segment.new", label: mainI18n.t("menu.newSegment"), enabled: menuState.hasProject, click: send({ type: "new-segment" }) },
        {
          id: "segment.remove",
          label: mainI18n.t("menu.removeSegment"),
          enabled: menuState.hasProject && menuState.hasSelectedSegment,
          click: send({ type: "remove-segment" })
        },
        {
          id: "segment.remove-unchecked",
          label: mainI18n.t("menu.removeUnchecked"),
          enabled: menuState.hasProject && menuState.hasUncheckedSegments,
          click: send({ type: "remove-unchecked-segments" })
        },
        {
          id: "segment.sort",
          label: mainI18n.t("menu.sortSegments"),
          enabled: menuState.hasProject && menuState.hasMultipleSegments,
          click: send({ type: "sort-segments" })
        },
        {
          id: "segment.boundary-refinement-details",
          label: mainI18n.t("menu.boundaryRefinementDetails"),
          enabled: menuState.hasBoundaryDiagnostic,
          click: send({ type: "show-boundary-refinement-details" })
        },
        { type: "separator" },
        { id: "segment.export-heading", label: mainI18n.t("menu.exportSelectionHeading"), enabled: false },
        {
          id: "segment.check-all",
          label: mainI18n.t("menu.checkAll"),
          enabled: menuState.hasProject && menuState.hasUncheckedSegments,
          click: send({ type: "check-all-segments" })
        },
        {
          id: "segment.uncheck-all",
          label: mainI18n.t("menu.uncheckAll"),
          enabled: menuState.hasProject && menuState.hasCheckedSegments,
          click: send({ type: "uncheck-all-segments" })
        },
        {
          id: "segment.invert",
          label: mainI18n.t("menu.invertSelection"),
          enabled: menuState.hasProject && menuState.hasSegments,
          click: send({ type: "invert-segment-selection" })
        }
      ]
    },
    {
      id: "menu.export",
      label: mainI18n.t("menu.export"),
      submenu: [
        { id: "export.movie", label: mainI18n.t("menu.exportMovie"), enabled: canExportMovie, click: send({ type: "export-movie" }) },
        { type: "separator" },
        { id: "export.timestamp-heading", label: mainI18n.t("menu.timestampHeading"), enabled: false },
        ...timestampExportFormats.map((format) => ({
          id: `export.${format}`,
          label: mainI18n.t(`menu.timestampExport.${format}`),
          enabled: canExportText,
          click: send({ type: "export-timestamp", format })
        }))
      ]
    },
    {
      id: "menu.settings",
      label: mainI18n.t("menu.settings"),
      submenu: [
        { id: "settings.open", label: mainI18n.t("menu.settingsItem"), accelerator: "CommandOrControl+,", click: send({ type: "open-settings" }) }
      ]
    },
    {
      id: "menu.view",
      label: mainI18n.t("menu.view"),
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
      id: "menu.window",
      label: mainI18n.t("menu.window"),
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "close" }]
    },
    {
      id: "menu.help",
      label: mainI18n.t("menu.help"),
      submenu: [
        { id: "help.about", label: mainI18n.t("menu.about"), click: showAboutSongcut },
        { type: "separator" },
        { id: "help.guide-en", label: mainI18n.t("menu.guideEnglish"), click: () => void shell.openExternal(usageEnglishUrl) },
        { id: "help.guide-ja", label: mainI18n.t("menu.guideJapanese"), click: () => void shell.openExternal(usageJapaneseUrl) },
        { id: "help.shortcuts", label: mainI18n.t("menu.keyboardShortcuts"), click: () => void shell.openExternal(keyboardShortcutsUrl) },
        { type: "separator" },
        { id: "help.repository", label: mainI18n.t("menu.repository"), click: () => void shell.openExternal(repositoryUrl) },
        { id: "help.issues", label: mainI18n.t("menu.reportIssue"), click: () => void shell.openExternal(issuesUrl) }
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
    credits: `${mainI18n.t("about.buildTime", { value: formatBuildTime() })}\n${mainI18n.t("about.electron", { value: process.versions.electron })}`
  });
  app.showAboutPanel();
}

function formatBuildTime() {
  try {
    return statSync(__filename).mtime.toLocaleString(uiLanguage === "ja" ? "ja-JP" : "en-US");
  } catch {
    return mainI18n.t("about.unknown");
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
