import { useRef } from "react";

import { tr } from "@/i18n";
import {
  ApiError,
  startAnalysis,
  startExport,
  startTranscription,
  waitForJob,
  type AnalysisDevice,
  type WhisperSettings,
} from "@/lib/api";
import type { BoundaryRefinementSettings } from "@/lib/boundaryRefinement";
import type { ProjectOperation } from "@/lib/project";
import type { OperationRunner } from "@/lib/useOperationRunner";
import type { TaskSlot } from "@/lib/useTaskRegistry";
import type { AnalysisResult, JobRecord, Segment, Transcript } from "@/types";

export type CutOutputItem = {
  id: string;
  segmentId: string;
  title: string;
  filename_stem: string;
  start: number;
  end: number;
  checked: boolean;
};

export type CutExportRequest = {
  outputDir: string;
  createSourceFolder: boolean;
  items: CutOutputItem[];
  timestampCommentText: string;
  validationError?: string | null;
};

export type CutOperationCoordinator = {
  runAnalysis: (transcribeAfter: boolean) => Promise<void>;
  runTranscription: (candidateSegments?: Segment[], resumeInterrupted?: boolean) => Promise<void>;
  exportClips: (request: CutExportRequest) => Promise<void>;
  watchBackgroundTranscription: (jobId: string) => () => void;
};

export type CutOperationOptions = {
  apiBaseUrl: string;
  videoPath: string;
  guideText: string;
  analysisDevice: AnalysisDevice;
  boundaryRefinementSettings: BoundaryRefinementSettings;
  whisperSettings: WhisperSettings;
  segments: Segment[];
  projectOperation: ProjectOperation;
  operationRunner: OperationRunner;
  updateTask: (slot: TaskSlot, job: JobRecord | null) => void;
  applyAnalysisResult: (result: AnalysisResult, segments: Segment[]) => void;
  applyTranscripts: (transcripts: Transcript[]) => void;
  updateProjectOperation: (updater: (current: ProjectOperation) => ProjectOperation) => void;
  onExportStart: () => void;
  onMessage: (message: string) => void;
  refreshWhisperStatus: () => Promise<unknown>;
};

export type CutOperationServices = {
  startAnalysis: typeof startAnalysis;
  startTranscription: typeof startTranscription;
  startExport: typeof startExport;
  waitForJob: <T>(
    baseUrl: string,
    jobId: string,
    onProgress: (job: JobRecord) => void,
    intervalMilliseconds?: number,
  ) => Promise<T>;
};

const DEFAULT_SERVICES: CutOperationServices = {
  startAnalysis,
  startTranscription,
  startExport,
  waitForJob,
};

/** `createCutOperationCoordinator`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
export function createCutOperationCoordinator(
  getOptions: () => CutOperationOptions,
  services: CutOperationServices = DEFAULT_SERVICES,
): CutOperationCoordinator {
  let coordinator: CutOperationCoordinator;
  let backgroundWatchVersion = 0;
  let backgroundTranscriptionActive = false;

  const runTranscription: CutOperationCoordinator["runTranscription"] = async (
    candidateSegments,
    resumeInterrupted = true,
  ) => {
    const options = getOptions();
    const segments = candidateSegments ?? options.segments;
    if (!options.apiBaseUrl || !options.videoPath || !segments.length) return;
    if (backgroundTranscriptionActive) return;
    if (options.operationRunner.isRunning()) return;
    const operation = options.projectOperation;
    const settings = options.whisperSettings;
    const sameInterruptedSettings =
      resumeInterrupted
      && operation?.kind === "transcription"
      && operation.status === "interrupted"
      && operation.settings?.model === settings.model
      && operation.settings?.language === settings.language;
    const pending = sameInterruptedSettings
      ? segments.filter((segment) => operation.pending_segment_ids?.includes(segment.id))
      : segments;
    const targets = pending.length ? pending : segments;
    const pendingIds = targets.map((segment) => segment.id);
    try {
      const appliedTranscripts = new Map<string, string>();
      await options.operationRunner.run({
        slot: "transcription",
        operation: {
          kind: "transcription",
          settings: { ...settings },
          pending_segment_ids: pendingIds,
        },
        pendingMessage: tr("messages.transcriptionPreparing"),
        failureMessage: tr("messages.transcriptionFailed"),
        start: () => services.startTranscription(
          options.apiBaseUrl,
          options.videoPath,
          targets,
          settings,
          options.guideText,
        ),
        poll: (jobId, onProgress) =>
          services.waitForJob<{ transcripts?: Transcript[] }>(options.apiBaseUrl, jobId, onProgress),
        onProgress: (nextJob) => {
          const partial = (nextJob.result as { transcripts?: Transcript[] } | undefined)?.transcripts ?? [];
          const changed = partial.filter((transcript) => {
            const serialized = JSON.stringify(transcript);
            if (appliedTranscripts.get(transcript.segment_id) === serialized) return false;
            appliedTranscripts.set(transcript.segment_id, serialized);
            return true;
          });
          if (!changed.length) return;
          options.applyTranscripts(changed);
          const completed = new Set(
            changed.filter((transcript) => !transcript.error).map((transcript) => transcript.segment_id),
          );
          options.updateProjectOperation((current) =>
            current?.kind === "transcription"
              ? { ...current, pending_segment_ids: current.pending_segment_ids?.filter((id) => !completed.has(id)) }
              : current,
          );
        },
        onSuccess: (result) => {
          const finalTranscripts = result.transcripts ?? [];
          const unapplied = finalTranscripts.filter(
            (transcript) => appliedTranscripts.get(transcript.segment_id) !== JSON.stringify(transcript),
          );
          options.applyTranscripts(unapplied);
          const failedIds = finalTranscripts
            .filter((transcript) => transcript.error)
            .map((transcript) => transcript.segment_id);
          options.onMessage(
            failedIds.length
              ? `Transcription completed with ${failedIds.length} failed segment(s).`
              : "Transcription complete.",
          );
          return failedIds.length
            ? {
                kind: "transcription" as const,
                status: "interrupted" as const,
                settings: { ...settings },
                pending_segment_ids: failedIds,
              }
            : null;
        },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await options.refreshWhisperStatus().catch(() => undefined);
      }
      options.onMessage(`Transcription failed: ${String(error)}`);
    }
  };

  coordinator = {
    runTranscription,
    async runAnalysis(transcribeAfter) {
      const options = getOptions();
      if (!options.apiBaseUrl || !options.videoPath) return;
      if (options.operationRunner.isRunning()) return;
      options.updateTask("transcription", null);
      const result = await options.operationRunner.run({
        slot: "analysis",
        operation: { kind: "analysis" },
        pendingMessage: tr("messages.analysisRunning"),
        failureMessage: tr("messages.analysisFailed"),
        start: () => services.startAnalysis(
          options.apiBaseUrl,
          options.videoPath,
          options.guideText,
          options.analysisDevice,
          options.boundaryRefinementSettings,
        ),
        poll: (jobId, onProgress) =>
          services.waitForJob<AnalysisResult>(options.apiBaseUrl, jobId, onProgress),
        onSuccess: (analysisResult) => {
          const nextSegments = analysisResult.segments.map((segment) => ({ ...segment, checked: true }));
          options.applyAnalysisResult(analysisResult, nextSegments);
          options.onMessage(`Detected ${nextSegments.length} segments.`);
        },
      });
      if (result && transcribeAfter && result.segments.length) {
        const nextSegments = result.segments.map((segment) => ({ ...segment, checked: true }));
        await coordinator.runTranscription(nextSegments, false);
      }
    },
    async exportClips(request) {
      const options = getOptions();
      if (!options.apiBaseUrl || !options.videoPath) return;
      if (options.operationRunner.isRunning()) return;
      if (request.validationError) {
        options.onMessage(request.validationError);
        return;
      }
      const items = request.items.filter((item) => item.checked);
      options.onExportStart();
      try {
        await options.operationRunner.run({
          slot: "export",
          operation: { kind: "export" },
          pendingMessage: tr("output.preparing"),
          failureMessage: tr("output.failed"),
          start: () => services.startExport(
            options.apiBaseUrl,
            options.videoPath,
            request.outputDir,
            items,
            request.timestampCommentText,
            request.createSourceFolder,
          ),
          poll: (jobId, onProgress) => services.waitForJob(options.apiBaseUrl, jobId, onProgress),
          onSuccess: () => options.onMessage("Export complete."),
        });
      } catch (error) {
        options.onMessage(`Export failed: ${String(error)}`);
      }
    },
    watchBackgroundTranscription(jobId) {
      const options = getOptions();
      if (!options.apiBaseUrl || !jobId) return () => undefined;
      const version = ++backgroundWatchVersion;
      backgroundTranscriptionActive = true;
      let cancelled = false;
      let settled = false;
      options.onMessage("Transcribing in background.");
      void services.waitForJob<{ transcripts?: Transcript[] }>(
        options.apiBaseUrl,
        jobId,
        (nextJob) => {
          if (cancelled) return;
          getOptions().updateTask("transcription", nextJob);
          const partial = (nextJob.result as { transcripts?: Transcript[] } | null | undefined)?.transcripts;
          if (Array.isArray(partial)) getOptions().applyTranscripts(partial);
        },
      ).then((result) => {
        if (cancelled) return;
        const current = getOptions();
        current.applyTranscripts(result.transcripts ?? []);
        current.onMessage("Transcription complete.");
        settled = true;
        if (version === backgroundWatchVersion) backgroundTranscriptionActive = false;
      }).catch((error) => {
        if (!cancelled) {
          getOptions().onMessage(`Transcription failed: ${String(error)}`);
          settled = true;
          if (version === backgroundWatchVersion) backgroundTranscriptionActive = false;
        }
      });
      return () => {
        cancelled = true;
        if (version === backgroundWatchVersion) {
          backgroundTranscriptionActive = false;
          if (!settled) getOptions().updateTask("transcription", null);
        }
      };
    },
  };
  return coordinator;
}

/** `useCutOperations`に必要な状態、派生値、副作用をReact hookとしてまとめる。 */
export function useCutOperations(
  options: CutOperationOptions,
  services: CutOperationServices = DEFAULT_SERVICES,
): CutOperationCoordinator {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const coordinatorRef = useRef<CutOperationCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createCutOperationCoordinator(() => optionsRef.current, services);
  }
  return coordinatorRef.current;
}
