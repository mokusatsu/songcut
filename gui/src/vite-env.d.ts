/// <reference types="vite/client" />

interface Window {
  songcut: {
    apiBaseUrl(): Promise<string>;
    onCloseRequested(callback: () => void): () => void;
    confirmClose(): Promise<void>;
    cancelClose(): Promise<void>;
    selectVideo(): Promise<string | null>;
    selectOutputDirectory(): Promise<string | null>;
    fileUrl(filePath: string): Promise<string>;
    writeClipboard(text: string): void;
    readClipboard(): string;
    pathForFile(file: File): string;
  };
}
