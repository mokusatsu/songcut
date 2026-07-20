import { clipboard, contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("songcut", {
  apiBaseUrl: () => ipcRenderer.invoke("songcut:apiBaseUrl") as Promise<string>,
  getLocaleSettings: () => ipcRenderer.invoke("songcut:get-locale-settings"),
  setLocalePreference: (preference: unknown) => ipcRenderer.invoke("songcut:set-locale-preference", preference),
  onCloseRequested: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("songcut:close-requested", listener);
    return () => ipcRenderer.removeListener("songcut:close-requested", listener);
  },
  onMenuCommand: (callback: (command: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: unknown) => callback(command);
    ipcRenderer.on("songcut:menu-command", listener);
    return () => ipcRenderer.removeListener("songcut:menu-command", listener);
  },
  ...(process.env.SONGCUT_E2E_USER_DATA_DIR
    ? {
        sendMenuCommandForTest: (command: unknown) => ipcRenderer.send("songcut:e2e-menu-command", command),
        getSegmentMenuStructureForTest: () => ipcRenderer.invoke("songcut:e2e-menu-structure"),
        getMenuItemForTest: (id: string) => ipcRenderer.invoke("songcut:e2e-menu-item", id)
      }
    : {}),
  updateMenuState: (state: unknown) => ipcRenderer.send("songcut:update-menu-state", state),
  confirmClose: () => ipcRenderer.invoke("songcut:confirm-close") as Promise<void>,
  cancelClose: () => ipcRenderer.invoke("songcut:cancel-close") as Promise<void>,
  selectVideo: () => ipcRenderer.invoke("songcut:selectVideo") as Promise<string | null>,
  openProject: () => ipcRenderer.invoke("songcut:openProject"),
  loadProject: (projectPath: string) => ipcRenderer.invoke("songcut:loadProject", projectPath),
  projectPathForVideo: (videoPath: string) => ipcRenderer.invoke("songcut:projectPathForVideo", videoPath) as Promise<string>,
  saveProject: (projectPath: string, document: unknown) => ipcRenderer.invoke("songcut:saveProject", projectPath, document),
  loadRecovery: () => ipcRenderer.invoke("songcut:loadRecovery"),
  saveRecovery: (snapshot: unknown) => ipcRenderer.invoke("songcut:saveRecovery", snapshot) as Promise<void>,
  clearRecovery: () => ipcRenderer.invoke("songcut:clearRecovery") as Promise<void>,
  fingerprintSource: (filePath: string) => ipcRenderer.invoke("songcut:fingerprintSource", filePath),
  findProjectSource: (projectPath: string, document: unknown) =>
    ipcRenderer.invoke("songcut:findProjectSource", projectPath, document) as Promise<string | null>,
  sourceIdentityMatches: (document: unknown, identity: unknown) =>
    ipcRenderer.invoke("songcut:sourceIdentityMatches", document, identity) as Promise<boolean>,
  selectRelinkSource: (expectedName: string) =>
    ipcRenderer.invoke("songcut:selectRelinkSource", expectedName) as Promise<string | null>,
  archiveRelinkedProject: (projectPath: string) =>
    ipcRenderer.invoke("songcut:archiveRelinkedProject", projectPath) as Promise<string | null>,
  archiveConflict: (filePath: string) => ipcRenderer.invoke("songcut:archiveConflict", filePath) as Promise<string>,
  setWindowTitle: (title: string) => ipcRenderer.invoke("songcut:setWindowTitle", title) as Promise<void>,
  selectOutputDirectory: () => ipcRenderer.invoke("songcut:selectOutputDirectory") as Promise<string | null>,
  fileUrl: (filePath: string) => ipcRenderer.invoke("songcut:fileUrl", filePath) as Promise<string>,
  writeClipboard: (text: string) => clipboard.writeText(text),
  readClipboard: () => clipboard.readText(),
  pathForFile: (file: File) => webUtils.getPathForFile(file) || process.env.SONGCUT_E2E_VIDEO || ""
});
