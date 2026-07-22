/// <reference types="vite/client" />

type WhisperDevice = "auto" | "npu" | "gpu" | "cpu";
type WhisperModelKey = "tiny" | "base" | "small";
type AnalysisDevice = "auto" | "npu" | "gpu" | "cpu";
type WaveformDisplayMode = "rms" | "peak" | "peak-rms";
type UiLanguage = "en" | "ja";
type UiLanguagePreference = "system" | UiLanguage;
type TimestampExportFormat = "timestamp-comment" | "youtube-chapter" | "tsv-excel" | "csv" | "audacity-label";

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

  interface Window {
    songcut: {
      apiBaseUrl(): Promise<string>;
      getLocaleSettings(): Promise<{ language: UiLanguage; preference: UiLanguagePreference }>;
      setLocalePreference(preference: UiLanguagePreference): Promise<{
        preference: UiLanguagePreference;
        restartRequired: boolean;
      }>;
    onCloseRequested(callback: () => void): () => void;
    onMenuCommand(callback: (command: SongcutMenuCommand) => void): () => void;
    sendMenuCommandForTest?(command: SongcutMenuCommand): void;
    getSegmentMenuStructureForTest?(): Promise<
      Array<{ id: string; label: string; type: string; enabled: boolean; hasSubmenu: boolean }> | null
    >;
    getMenuItemForTest?(id: string): Promise<{
      id: string;
      label: string;
      accelerator: string | null;
      enabled: boolean;
    } | null>;
    updateMenuState(state: SongcutMenuState): void;
    confirmClose(): Promise<void>;
    cancelClose(): Promise<void>;
    selectVideo(): Promise<string | null>;
    openProject(): Promise<unknown | null>;
    loadProject(projectPath: string): Promise<unknown>;
    projectPathForVideo(videoPath: string): Promise<string>;
    saveProject(projectPath: string, document: unknown): Promise<unknown>;
    loadRecovery(): Promise<unknown | null>;
    saveRecovery(snapshot: unknown): Promise<void>;
    clearRecovery(): Promise<void>;
    fingerprintSource(filePath: string): Promise<unknown>;
    findProjectSource(projectPath: string, document: unknown): Promise<string | null>;
    sourceIdentityMatches(document: unknown, identity: unknown): Promise<boolean>;
    selectRelinkSource(expectedName: string): Promise<string | null>;
    archiveRelinkedProject(projectPath: string): Promise<string | null>;
    archiveConflict(filePath: string): Promise<string>;
    setWindowTitle(title: string): Promise<void>;
    selectOutputDirectory(): Promise<string | null>;
    fileUrl(filePath: string): Promise<string>;
    writeClipboard(text: string): void;
    readClipboard(): string;
    pathForFile(file: File): string;
  };
}
