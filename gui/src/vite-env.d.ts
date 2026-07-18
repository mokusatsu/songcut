/// <reference types="vite/client" />

type SongcutMenuCommand =
  | { type: "load-movie" }
  | { type: "nudge-boundary-left" }
  | { type: "nudge-boundary-right" }
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
  | { type: "prepare-whisper-model" }
  | { type: "ffmpeg-check" };

type SongcutMenuState = {
  apiReady: boolean;
  hasVideo: boolean;
  hasSegments: boolean;
  hasSelectedSegment: boolean;
  hasCheckedSegments: boolean;
  playing: boolean;
  zoomIndex: number;
};

interface Window {
  songcut: {
    apiBaseUrl(): Promise<string>;
    onCloseRequested(callback: () => void): () => void;
    onMenuCommand(callback: (command: SongcutMenuCommand) => void): () => void;
    updateMenuState(state: SongcutMenuState): void;
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
