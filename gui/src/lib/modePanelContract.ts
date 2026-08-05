import type { SubtitleRenderRequest } from "@/lib/api";
import type { LyricsLane, LyricsSegment } from "@/lib/subtitles";
import type { JobRecord } from "@/types";

/** Read-only operation state exposed to the Sub presentation panel. */
export type SubModePanelOperationView = {
  analysisJob: JobRecord | null;
  exportJob: JobRecord | null;
  busy: "analysis" | "export" | null;
};

/** Capability values already resolved by the Sub mode controller. */
export type SubModePanelCapabilities = {
  canAddSegment: boolean;
  canDeleteSelectedSegment: boolean;
};

/**
 * Intent-level actions available to the Sub presentation panel.
 * Application coordinators and Electron services remain behind this boundary.
 */
export type SubModePanelActions = {
  load: () => void;
  openSettings: () => void;
  prepareAnalysis: () => Promise<void>;
  analyzeLyrics: (lyricsText: string) => Promise<void>;
  exportSubtitles: () => Promise<boolean>;
  renderSubtitles: (request: SubtitleRenderRequest) => Promise<void>;
  invalidateSubtitleRender: () => void;
  listSystemFonts: () => Promise<string[]>;
  confirmRemoveLane: (lane: LyricsLane) => boolean;
  selectSegment: (laneId: string, segment: LyricsSegment) => void;
  addSegment: () => void;
  removeSelectedSegment: () => void;
  showMessage: (message: string) => void;
};
