/// <reference types="vite/client" />

interface Window {
  songcut: {
    apiBaseUrl(): Promise<string>;
    selectVideo(): Promise<string | null>;
    selectOutputDirectory(): Promise<string | null>;
    fileUrl(filePath: string): Promise<string>;
    writeClipboard(text: string): void;
    readClipboard(): string;
    pathForFile(file: File): string;
  };
}
