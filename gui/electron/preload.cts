import { clipboard, contextBridge, ipcRenderer, webUtils } from "electron";

contextBridge.exposeInMainWorld("songcut", {
  apiBaseUrl: () => ipcRenderer.invoke("songcut:apiBaseUrl") as Promise<string>,
  selectVideo: () => ipcRenderer.invoke("songcut:selectVideo") as Promise<string | null>,
  selectOutputDirectory: () => ipcRenderer.invoke("songcut:selectOutputDirectory") as Promise<string | null>,
  fileUrl: (filePath: string) => ipcRenderer.invoke("songcut:fileUrl", filePath) as Promise<string>,
  writeClipboard: (text: string) => clipboard.writeText(text),
  readClipboard: () => clipboard.readText(),
  pathForFile: (file: File) => webUtils.getPathForFile(file) || process.env.SONGCUT_E2E_VIDEO || ""
});
