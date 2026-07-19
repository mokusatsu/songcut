/// <reference types="vite/client" />

type WhisperDevice = "auto" | "npu" | "gpu" | "cpu";
type AnalysisDevice = "auto" | "npu" | "gpu" | "cpu";
type WaveformDisplayMode = "rms" | "peak" | "peak-rms";

type SongcutMenuCommand =
  | { type: "load-movie" }
  | { type: "nudge-boundary-left" }
  | { type: "nudge-boundary-right" }
  | { type: "previous-segment" }
  | { type: "next-segment" }
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
  | { type: "configure-scratch-preview" }
  | { type: "set-scratch-audio-proxy-enabled"; enabled: boolean }
  | { type: "set-waveform-display-mode"; mode: WaveformDisplayMode }
  | { type: "prepare-whisper-model" }
  | { type: "set-analysis-device"; device: AnalysisDevice }
  | { type: "set-whisper-device"; device: WhisperDevice }
  | { type: "ffmpeg-check" };

type SongcutMenuState = {
  apiReady: boolean;
  hasVideo: boolean;
  hasSegments: boolean;
  hasSelectedSegment: boolean;
  hasCheckedSegments: boolean;
  canSelectPreviousSegment: boolean;
  canSelectNextSegment: boolean;
  playing: boolean;
  zoomIndex: number;
  waveformDisplayMode: WaveformDisplayMode;
  scratchAudioProxyEnabled: boolean;
  analysisDevice: AnalysisDevice;
  whisperDevice: WhisperDevice;
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
