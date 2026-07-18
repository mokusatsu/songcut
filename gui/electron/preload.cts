import { clipboard, contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("songcut", {
  apiBaseUrl: () => ipcRenderer.invoke("songcut:apiBaseUrl") as Promise<string>,
  onCloseRequested: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("songcut:close-requested", listener);
    return () => ipcRenderer.removeListener("songcut:close-requested", listener);
  },
  confirmClose: () => ipcRenderer.invoke("songcut:confirm-close") as Promise<void>,
  cancelClose: () => ipcRenderer.invoke("songcut:cancel-close") as Promise<void>,
  selectVideo: () => ipcRenderer.invoke("songcut:selectVideo") as Promise<string | null>,
  selectOutputDirectory: () => ipcRenderer.invoke("songcut:selectOutputDirectory") as Promise<string | null>,
  fileUrl: (filePath: string) => ipcRenderer.invoke("songcut:fileUrl", filePath) as Promise<string>,
  writeClipboard: (text: string) => clipboard.writeText(text),
  readClipboard: () => clipboard.readText(),
  pathForFile: (file: File) => webUtils.getPathForFile(file) || process.env.SONGCUT_E2E_VIDEO || ""
});
