import { useRef } from "react";

import { tr } from "@/i18n";
import {
  startLyricsAnalysis,
  startSubtitleExport,
  startSubtitleRender,
  waitForJob,
  type SubtitleRenderRequest,
  type SubtitleRenderResultItem,
  type WhisperSettings,
} from "@/lib/api";
import type { OperationRunner } from "@/lib/useOperationRunner";
import { createPendingTask, failTask, type TaskSlot } from "@/lib/useTaskRegistry";
import {
  analysisLinesToSegments,
  createLyricsLane,
  selectedSubtitleSegment,
  subtitleRenderSignature,
  type LyricsAnalysisResult,
  type LyricsSegment,
  type SubtitleProjectState,
} from "@/lib/subtitles";
import type { JobRecord } from "@/types";

export type SubOperationCoordinator = {
  readonly analysisJob: JobRecord | null;
  readonly exportJob: JobRecord | null;
  readonly busy: "analysis" | "export" | null;
  analyzeLyrics: (lyricsText: string) => Promise<void>;
  exportSubtitles: (outputDir: string, width: number, height: number) => Promise<void>;
  renderSubtitles: (request: SubtitleRenderRequest) => Promise<void>;
  invalidateSubtitleRender: () => void;
};

export type SubOperationOptions = {
  apiBaseUrl: string;
  videoPath: string;
  state: SubtitleProjectState;
  whisperSettings: WhisperSettings;
  operationRunner: OperationRunner;
  analysisJob: JobRecord | null;
  exportJob: JobRecord | null;
  updateTask: (slot: TaskSlot, job: JobRecord | null) => void;
  setState: (
    next: SubtitleProjectState | ((current: SubtitleProjectState) => SubtitleProjectState),
  ) => void;
  markStateChanged: () => void;
  focusSegment: (segment: LyricsSegment) => void;
  onMessage: (message: string) => void;
  confirm: (message: string) => boolean;
};

export type SubOperationServices = {
  startLyricsAnalysis: typeof startLyricsAnalysis;
  startSubtitleExport: typeof startSubtitleExport;
  startSubtitleRender: typeof startSubtitleRender;
  waitForJob: <T>(
    baseUrl: string,
    jobId: string,
    onProgress: (job: JobRecord) => void,
    intervalMilliseconds?: number,
  ) => Promise<T>;
};

const DEFAULT_SERVICES: SubOperationServices = {
  startLyricsAnalysis,
  startSubtitleExport,
  startSubtitleRender,
  waitForJob,
};

function isActive(job: JobRecord | null) {
  return job?.status === "queued" || job?.status === "running";
}

export function placeLyricsAnalysisResult(
  state: SubtitleProjectState,
  result: LyricsAnalysisResult,
  confirm: (message: string) => boolean,
): SubtitleProjectState {
  const lanes = state.lanes.map((lane) => ({ ...lane, segments: [...lane.segments] }));
  const titleLaneIndex = lanes.findIndex((lane) => lane.segments.some((segment) => segment.source === "title"));
  let lyricsLaneIndex = lanes.findIndex((lane, index) => index !== titleLaneIndex && lane.segments.length === 0);
  if (lyricsLaneIndex < 0 && lanes.length < 3) {
    lanes.push(createLyricsLane(2, `Lyrics ${lanes.length + 1}`));
    lyricsLaneIndex = lanes.length - 1;
  }
  if (lyricsLaneIndex < 0) {
    lyricsLaneIndex = Math.max(
      0,
      lanes.findIndex((lane, index) => index !== titleLaneIndex && lane.id === state.active_lane_id),
    );
    if (!confirm(tr("sub.laneReplaceConfirm", { lane: lanes[lyricsLaneIndex].name }))) return state;
  }
  lanes[lyricsLaneIndex] = {
    ...lanes[lyricsLaneIndex],
    segments: analysisLinesToSegments(result),
  };
  if (result.title) {
    let targetIndex = titleLaneIndex;
    if (targetIndex < 0 && lanes.length < 3) {
      lanes.push(createLyricsLane(7, "Title"));
      targetIndex = lanes.length - 1;
    }
    if (targetIndex < 0) {
      targetIndex = lanes.findIndex((_, index) => index !== lyricsLaneIndex);
      if (targetIndex < 0 || !confirm(tr("sub.titleReplaceConfirm", { lane: lanes[targetIndex].name }))) return state;
    }
    lanes[targetIndex] = {
      ...lanes[targetIndex],
      name: "Title",
      style: { ...lanes[targetIndex].style, alignment: 7 },
      segments: [
        {
          id: `title-${crypto.randomUUID()}`,
          text: result.title,
          start: 0,
          end: Math.min(5, result.duration),
          confidence: 1,
          source: "title",
          low_confidence_outlier: false,
          user_edited: false,
        },
      ],
    };
  }
  return {
    ...state,
    lanes,
    active_lane_id: lanes[lyricsLaneIndex].id,
    selected_segment_id: lanes[lyricsLaneIndex].segments[0]?.id ?? null,
    tempo_bpm: result.tempo_bpm,
    beat_times: result.beat_times,
    rhythm_grid: result.rhythm_grid,
    beat_warning: result.beat_warning,
    confidence_statistics: result.confidence_statistics,
  };
}

export function applySubtitleRenderResults(
  state: SubtitleProjectState,
  items: SubtitleRenderResultItem[],
): SubtitleProjectState {
  const bySegmentId = new Map(items.map((item) => [item.segment_id, item]));
  return {
    ...state,
    lanes: state.lanes.map((lane) => ({
      ...lane,
      segments: lane.segments.map((segment) => {
        const rendered = bySegmentId.get(segment.id);
        if (!rendered) return segment;
        const expected = subtitleRenderSignature(
          segment.text,
          lane.style,
          rendered.width,
          rendered.height,
        );
        if (rendered.signature !== expected) return segment;
        return {
          ...segment,
          render_cache: {
            signature: rendered.signature,
            png_base64: rendered.png_base64,
            width: rendered.width,
            height: rendered.height,
          },
        };
      }),
    })),
  };
}

export function createSubOperationCoordinator(
  getOptions: () => SubOperationOptions,
  services: SubOperationServices = DEFAULT_SERVICES,
): SubOperationCoordinator {
  let renderVersion = 0;
  return {
    get analysisJob() {
      return getOptions().analysisJob;
    },
    get exportJob() {
      return getOptions().exportJob;
    },
    get busy() {
      const options = getOptions();
      if (isActive(options.analysisJob)) return "analysis";
      if (isActive(options.exportJob)) return "export";
      return null;
    },
    async analyzeLyrics(lyricsText) {
      const options = getOptions();
      if (!options.apiBaseUrl || !options.videoPath || !lyricsText.trim()) return;
      try {
        await options.operationRunner.run({
          slot: "lyrics-analysis",
          operation: { kind: "lyrics-analysis" },
          pendingMessage: tr("sub.lyricsAnalysisPreparing"),
          failureMessage: tr("sub.lyricsAnalysisFailed"),
          start: () => services.startLyricsAnalysis(
            options.apiBaseUrl,
            options.videoPath,
            lyricsText,
            options.whisperSettings,
          ),
          poll: (jobId, onProgress) =>
            services.waitForJob<LyricsAnalysisResult>(options.apiBaseUrl, jobId, onProgress),
          onSuccess: (result) => {
            const current = getOptions();
            const nextState = placeLyricsAnalysisResult(current.state, result, current.confirm);
            current.setState(nextState);
            current.markStateChanged();
            const selected = selectedSubtitleSegment(nextState)?.segment;
            if (selected) current.focusSegment(selected);
            current.onMessage(
              result.beat_warning
                ? tr("sub.lyricsAnalysisCompleteWithBeatWarning", { warning: result.beat_warning })
                : tr("sub.lyricsAnalysisComplete", {
                    lines: result.lines.length,
                    bpm: result.tempo_bpm.toFixed(1),
                  }),
            );
          },
        });
      } catch (error) {
        options.onMessage(`${tr("sub.lyricsAnalysisFailed")}: ${String(error)}`);
      }
    },
    async exportSubtitles(outputDir, width, height) {
      const options = getOptions();
      if (!options.apiBaseUrl || !options.videoPath) return;
      try {
        await options.operationRunner.run({
          slot: "subtitle-export",
          operation: { kind: "subtitle-export" },
          pendingMessage: tr("sub.subtitleExportPreparing"),
          failureMessage: tr("sub.subtitleExportFailed"),
          start: () => services.startSubtitleExport(
            options.apiBaseUrl,
            options.videoPath,
            outputDir,
            width,
            height,
            options.state.lanes,
          ),
          poll: (jobId, onProgress) => services.waitForJob<{ video: string; output_dir: string }>(
            options.apiBaseUrl,
            jobId,
            onProgress,
          ),
          onSuccess: (result) => options.onMessage(tr("sub.subtitleExportComplete", { video: result.video })),
        });
      } catch (error) {
        options.onMessage(`${tr("sub.subtitleExportFailed")}: ${String(error)}`);
      }
    },
    async renderSubtitles(request) {
      const options = getOptions();
      if (!options.apiBaseUrl || !request.items.length) return;
      const version = ++renderVersion;
      let trackedJob = createPendingTask("subtitle-render", tr("sub.subtitleRenderPreparing"));
      options.updateTask("subtitle-render", trackedJob);
      try {
        const started = await services.startSubtitleRender(
          options.apiBaseUrl,
          request.width,
          request.height,
          request.items,
        );
        if (version === renderVersion) {
          trackedJob = started;
          options.updateTask("subtitle-render", started);
        }
        const result = await services.waitForJob<{ items: SubtitleRenderResultItem[] }>(
          options.apiBaseUrl,
          started.id,
          (job) => {
            if (version === renderVersion) {
              trackedJob = job;
              options.updateTask("subtitle-render", job);
            }
          },
          250,
        );
        if (version === renderVersion) {
          const current = getOptions();
          current.setState((state) => applySubtitleRenderResults(state, result.items));
          current.markStateChanged();
        }
      } catch (error) {
        if (version === renderVersion) {
          options.updateTask(
            "subtitle-render",
            failTask(trackedJob, error, tr("sub.subtitleRenderFailed")),
          );
          options.onMessage(`${tr("sub.subtitleRenderFailed")}: ${String(error)}`);
        }
      }
    },
    invalidateSubtitleRender() {
      renderVersion += 1;
      getOptions().updateTask("subtitle-render", null);
    },
  };
}

export function useSubOperations(
  options: SubOperationOptions,
  services: SubOperationServices = DEFAULT_SERVICES,
): SubOperationCoordinator {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const coordinatorRef = useRef<SubOperationCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createSubOperationCoordinator(() => optionsRef.current, services);
  }
  return coordinatorRef.current;
}
