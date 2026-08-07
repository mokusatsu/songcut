import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  FileVideo2,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { clamp, formatTime } from "@/lib/time";
import {
  cancelScratchProxy,
  checkFfmpeg,
  getExportPlan,
  probeVideo,
  releaseScratchProxy,
  startScratchProxy,
  waitForJob
} from "@/lib/api";
import type { AnalysisDevice, WhisperSettings } from "@/lib/api";
import { SettingsDialog, type SettingsTab } from "@/components/SettingsDialog";
import { CutModePanel } from "@/components/CutModePanel";
import { CutSegmentTimingDialog } from "@/components/CutSegmentTimingDialog";
import { BoundaryRefinementDialog } from "@/components/BoundaryRefinementDialog";
import { SubModePanel, SubtitleOverlay } from "@/components/SubModePanel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditorFocusProvider, useEditorActionFocusProps } from "@/components/ui/editor-focus";
import {
  DEFAULT_WHISPER_SETTINGS,
  normalizeInterruptedOperation,
  parseProjectOpenResult,
  parseRecoverySnapshot,
  parseSourceIdentity,
  transcriptSettingsAreStale,
  waveformFromProject
} from "@/lib/project";
import {
  assertCutProjectOperation,
  assertSubProjectOperation,
  composeCutProjectDocument,
  composeSubProjectDocument,
  createCutProjectDocument,
  createSubProjectDocument,
  hydrateProjectDocument,
} from "@/lib/projectAdapters";
import type {
  ProjectDocumentV1,
  ProjectOpenResult,
  ProjectOperation,
  RecoverySnapshot,
  SourceIdentity
} from "@/lib/project";
import { useProjectPersistence } from "@/lib/useProjectPersistence";
import { applyFilenameTemplate, DEFAULT_FILENAME_TEMPLATE, FILENAME_TEMPLATE_PLACEHOLDERS } from "@/lib/exportNaming";
import { useProgressiveWaveform } from "@/lib/useProgressiveWaveform";
import { createPendingTask, failTask, useTaskRegistry } from "@/lib/useTaskRegistry";
import type { TaskRegistryEntry, TaskSlot } from "@/lib/useTaskRegistry";
import { useModeOperations } from "@/lib/useModeOperations";
import { useModelPreparation } from "@/lib/useModelPreparation";
import {
  ExportProgressDialog,
  FfmpegCheckDialog,
  FFMPEG_DOWNLOAD_URL,
  jobKindLabel,
  ModelDownloadProgressDialog,
  OutputDialog,
  SegmentManagementDialog,
  TaskStatusPanel,
  TimestampCommentDialogs,
  WhisperDownloadProgressDialog,
  type ExportPlanState,
  type OutputItem,
  type SegmentManagementReview,
} from "@/components/AppDialogs";
import {
  selectScratchPreviewSource,
  shouldCreateScratchProxy
} from "@/lib/scratchProxy";
import { isEditorShortcutSuppressed, resolveEditorShortcut } from "@/lib/shortcuts";
import {
  editorActionFromMenuCommand,
  executeEditorAction,
  type EditorAction,
} from "@/lib/editorCommands";
import {
  createManualSegment,
  insertSegmentPair,
  invertSegmentChecks,
  removeSegments,
  setAllSegmentsChecked,
  sortSegmentsByStart,
  type SegmentCollection,
} from "@/lib/segmentManagement";
import {
  boundaryNudgePlaybackRange,
  createCutBoundaryPolicy,
  nearestBoundaryTarget,
  nudgeBoundaryTime,
  resolveBoundaryTime,
} from "@/lib/boundaries";
import {
  normalizeBoundaryRefinementSettings,
  readBoundaryRefinementSettings,
  writeBoundaryRefinementSettings,
  type BoundaryRefinementSettings,
} from "@/lib/boundaryRefinement";
import {
  DEFAULT_SCRATCH_PREVIEW_MILLISECONDS,
  MAX_VIDEO_SPLIT_PERCENT,
  MIN_VIDEO_SPLIT_PERCENT,
  formatBoundaryNudgeSeconds,
  formatBoundarySeconds,
  normalizeBoundarySecondsInput,
  normalizeScratchPreviewMilliseconds,
  parseBoundaryNudgeSeconds,
  parseBoundarySeconds,
  readBoundaryNudgeSecondsInput as readStoredBoundaryNudgeSecondsInput,
  readBoundarySecondsInput as readStoredBoundarySecondsInput,
  readCreateSourceFolder as readStoredCreateSourceFolder,
  readModePreferences,
  readScratchAudioProxyEnabled as readStoredScratchAudioProxyEnabled,
  readScratchPreviewMilliseconds as readStoredScratchPreviewMilliseconds,
  readVideoSplitPercent as readStoredVideoSplitPercent,
  writeBoundaryNudgeSecondsInput,
  writeBoundarySecondsInput,
  writeCreateSourceFolder,
  writeScratchAudioProxyEnabled,
  writeScratchPreviewMilliseconds,
  writeVideoSplitPercent,
} from "@/lib/settingsScopes";
import {
  applyTimestampCommentToGuide,
  backToTimestampCommentSelection,
  beginTimestampCommentFlow,
  closeTimestampCommentFlow,
  editSelectedTimestampComment,
  selectTimestampCommentCandidate,
  updateTimestampCommentDraft
} from "@/lib/timestampComments";
import type { TimestampCommentFlow } from "@/lib/timestampComments";
import { buildTimestampExportText, timestampExportFormats } from "@/lib/timestampExport";
import type { TimestampExportFormat } from "@/lib/timestampExport";
import {
  DEFAULT_WAVEFORM_DISPLAY_MODES,
  DEFAULT_CUT_WAVEFORM_AMPLITUDE_PROFILE,
  readCutWaveformAmplitudeProfile,
  writeCutWaveformAmplitudeProfile,
  writeWaveformDisplayMode,
  type WaveformDisplayModes,
} from "@/lib/waveformPreferences";
import type { CutWaveformAmplitudeProfile } from "@/lib/waveform";
import { createWaveformSessionCache, selectWaveformHydration } from "@/lib/waveformSessionCache";
import type { ScratchProxyState } from "@/lib/scratchProxy";
import type { AppMode } from "@/lib/modes";
import { createModeSession } from "@/lib/modeSession";
import {
  addFourBeatSegment,
  createDefaultSubtitleState,
  nudgeSegmentBoundary,
  updateSegmentBoundary,
  type LyricsSegment,
  type SubtitleProjectState,
} from "@/lib/subtitles";
import type {
  AnalysisResult,
  ExportCandidate,
  ExportRenderPlanItem,
  FfmpegCheckResult,
  JobRecord,
  ScratchProxyResult,
  Segment,
  Transcript,
  VideoInfo,
  WaveformDisplayMode,
} from "@/types";
import { currentUiLanguage, localizeFilenameTemplateError, localizeJobMessage, localizeUiMessage, tr, type UiLanguage, type UiLanguagePreference } from "@/i18n";

const zoomLevels = [1, 2, 4, 8, 16, 32];
const videoExtensions = new Set([".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".mpg", ".mpeg"]);
const cutDragBoundaryPolicy = createCutBoundaryPolicy("drag");

/** `listSystemFonts`で利用可能な候補をplatformまたは状態から列挙して返す。 */
function listSystemFonts() {
  return window.songcut.listSystemFonts();
}

type RelinkConflict = {
  selectedPath: string;
  identity: SourceIdentity;
  videoInfo: VideoInfo;
  destinationPath: string;
  existing: ProjectOpenResult | null;
  damaged: boolean;
};

type SwitchSaveFailure = {
  target: { kind: "video" | "project"; path: string };
  error: string;
  recoverySaved: boolean;
};

/** アプリ全体の状態とmode sessionを組み立て、選択中モードの画面とdialogを描画する。 */
export default function App(props: {
  initialLocaleSettings: { language: UiLanguage; preference: UiLanguagePreference };
}) {
  const editorRootRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<AppMode>("cut");
  const [subtitleState, setSubtitleState] = useState<SubtitleProjectState>(createDefaultSubtitleState);
  const [localePreference, setLocalePreference] = useState<UiLanguagePreference>(props.initialLocaleSettings.preference);
  const [localeRestartRequired, setLocaleRestartRequired] = useState(false);
  const scratchProxyAudioRef = useRef<HTMLAudioElement>(null);
  const playbackStopAtRef = useRef<number | null>(null);
  const scratchPreviewTimeRef = useRef<number | null>(null);
  const scratchPreviewTimerRef = useRef<number | null>(null);
  const scratchPreviewGenerationRef = useRef(0);
  const scratchPreviewMediaRef = useRef<HTMLMediaElement | null>(null);
  const scratchProxyReadyRef = useRef(false);
  const scratchProxyJobIdRef = useRef<string | null>(null);
  const scratchProxyIdRef = useRef<string | null>(null);
  const scratchProxyConfigurationGenerationRef = useRef(0);
  const videoLoadGenerationRef = useRef(0);
  const scratchAudioProxyEnabledRef = useRef(true);
  const selectedSegmentRef = useRef<Segment | null>(null);
  const runningJobRef = useRef<JobRecord | null>(null);
  const projectDocumentRef = useRef<ProjectDocumentV1 | null>(null);
  const projectBaseRef = useRef<ProjectDocumentV1 | null>(null);
  const videoPathRef = useRef("");
  const projectReadOnlyRef = useRef(false);
  const recoveryCheckedRef = useRef(false);
  const taskRegistry = useTaskRegistry();
  const [waveformSessionCache] = useState(() => createWaveformSessionCache());
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [guideText, setGuideText] = useState("");
  const [timestampCommentFlow, setTimestampCommentFlow] = useState<TimestampCommentFlow>(closeTimestampCommentFlow);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [exportCandidates, setExportCandidates] = useState<ExportCandidate[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [cutTimingSegmentId, setCutTimingSegmentId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [boundarySecondsInput, setBoundarySecondsInput] = useState(readBoundarySecondsInput);
  const [boundaryNudgeSecondsInput, setBoundaryNudgeSecondsInput] = useState(readBoundaryNudgeSecondsInput);
  const [scratchPreviewMilliseconds, setScratchPreviewMilliseconds] = useState(readScratchPreviewMilliseconds);
  const [scratchPreviewMillisecondsInput, setScratchPreviewMillisecondsInput] = useState(
    String(DEFAULT_SCRATCH_PREVIEW_MILLISECONDS)
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>("common");
  const [boundaryDiagnosticOpen, setBoundaryDiagnosticOpen] = useState(false);
  const [scratchAudioProxyEnabled, setScratchAudioProxyEnabled] = useState(readScratchAudioProxyEnabled);
  const [scratchProxyState, setScratchProxyState] = useState<ScratchProxyState>("idle");
  const [zoomIndex, setZoomIndex] = useState(0);
  const [waveformDisplayModes, setWaveformDisplayModes] = useState<WaveformDisplayModes>(readStoredWaveformDisplayModes);
  const [cutWaveformAmplitudeProfile, setCutWaveformAmplitudeProfile] =
    useState<CutWaveformAmplitudeProfile>(readStoredCutWaveformAmplitudeProfile);
  const [segmentFocusRequest, setSegmentFocusRequest] = useState(0);
  const [subtitleFocusRequest, setSubtitleFocusRequest] = useState(0);
  const [waveformSeeking, setWaveformSeeking] = useState(false);
  const [handleEditing, setHandleEditing] = useState(false);
  const [split, setSplit] = useState(readVideoSplitPercent);
  const [exportProgressOpen, setExportProgressOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [transcriptSegment, setTranscriptSegment] = useState<Segment | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [exportPlanState, setExportPlanState] = useState<ExportPlanState>({ status: "idle", plan: null, error: null });
  const [segmentManagementReview, setSegmentManagementReview] = useState<SegmentManagementReview | null>(null);
  const [timestampExportOpen, setTimestampExportOpen] = useState(false);
  const [timestampCopyCount, setTimestampCopyCount] = useState<number | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false);
  const [ffmpegCheckOpen, setFfmpegCheckOpen] = useState(false);
  const [ffmpegCheckPending, setFfmpegCheckPending] = useState(false);
  const [ffmpegCheckResult, setFfmpegCheckResult] = useState<FfmpegCheckResult | null>(null);
  const [analysisDevice, setAnalysisDevice] = useState<AnalysisDevice>("auto");
  const [boundaryRefinementSettings, setBoundaryRefinementSettings] = useState<BoundaryRefinementSettings>(
    readBoundaryRefinementSettings
  );
  const [whisperSettings, setWhisperSettings] = useState<WhisperSettings>({ ...DEFAULT_WHISPER_SETTINGS });
  const [projectBase, setProjectBase] = useState<ProjectDocumentV1 | null>(null);
  const [projectPath, setProjectPath] = useState("");
  const [projectRevision, setProjectRevision] = useState(0);
  const [projectOperation, setProjectOperation] = useState<ProjectOperation>(null);
  const [sourceAvailable, setSourceAvailable] = useState(false);
  const [projectReadOnly, setProjectReadOnly] = useState(false);
  const [recoveryCandidate, setRecoveryCandidate] = useState<RecoverySnapshot | null>(null);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [relinkConflict, setRelinkConflict] = useState<RelinkConflict | null>(null);
  const [switchSaveFailure, setSwitchSaveFailure] = useState<SwitchSaveFailure | null>(null);
  const [filenameTemplate, setFilenameTemplate] = useState(DEFAULT_FILENAME_TEMPLATE);
  const [createSourceFolder, setCreateSourceFolder] = useState(readCreateSourceFolder);

  const {
    whisperStatus,
    demucsStatus,
    mmsStatus,
    whisperPreflightOpen,
    setWhisperPreflightOpen,
    whisperDownloadOpen,
    setWhisperDownloadOpen,
    demucsDownloadOpen,
    setDemucsDownloadOpen,
    mmsDownloadOpen,
    setMmsDownloadOpen,
    refreshWhisperStatus,
    ensureWhisper,
    ensureDemucs,
    ensureMms,
  } = useModelPreparation({
    apiBaseUrl,
    whisperModel: whisperSettings.model,
    updateTask: taskRegistry.updateTask,
    onMessage: setMessage,
  });

  projectBaseRef.current = projectBase;
  videoPathRef.current = videoPath;
  projectReadOnlyRef.current = projectReadOnly;
  const progressiveWaveform = useProgressiveWaveform(
    apiBaseUrl,
    (nextJob) => taskRegistry.updateTask("waveform", nextJob),
    (sourcePath, points, metadata) => {
      const currentProject = projectBaseRef.current;
      if (currentProject && sameWindowsPath(sourcePath, videoPathRef.current)) {
        waveformSessionCache.put({
          fingerprint: currentProject.source.fingerprint.value,
          points,
          metadata,
        });
        if (!projectReadOnlyRef.current) setProjectRevision((revision) => revision + 1);
      }
    }
  );

  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === selectedSegmentId) ?? segments[0] ?? null,
    [segments, selectedSegmentId]
  );
  const cutTimingSegment = useMemo(
    () => segments.find((segment) => segment.id === cutTimingSegmentId) ?? null,
    [cutTimingSegmentId, segments],
  );
  const selectedSegmentIndex = selectedSegment ? segments.findIndex((segment) => segment.id === selectedSegment.id) : -1;
  const selectedBoundaryDiagnostic = useMemo(() => {
    if (!selectedSegment) return null;
    if (selectedSegment.boundary_refinement) return selectedSegment.boundary_refinement;
    const rawId = selectedSegment.matched_segment_id;
    return rawId ? analysis?.raw_segments?.find((segment) => segment.id === rawId)?.boundary_refinement ?? null : null;
  }, [analysis?.raw_segments, selectedSegment]);
  const canSelectPreviousSegment = selectedSegmentIndex > 0;
  const canSelectNextSegment = selectedSegmentIndex >= 0 && selectedSegmentIndex < segments.length - 1;
  const duration = videoInfo?.duration ?? analysis?.duration ?? projectBase?.source.duration_seconds ?? videoRef.current?.duration ?? 0;
  const zoom = zoomLevels[zoomIndex];
  const waveformDisplayMode = waveformDisplayModes[mode];
  const checkedCount = segments.filter((segment) => segment.checked !== false).length;
  const uncheckedCount = segments.length - checkedCount;
  const activeSubtitleLane =
    subtitleState.lanes.find((lane) => lane.id === subtitleState.active_lane_id) ?? subtitleState.lanes[0];
  const activeSubtitleSegments = [...(activeSubtitleLane?.segments ?? [])].sort(
    (left, right) => left.start - right.start
  );
  const selectedSubtitleIndex = activeSubtitleSegments.findIndex(
    (segment) => segment.id === subtitleState.selected_segment_id
  );
  const subtitleSegmentCount = subtitleState.lanes.reduce((count, lane) => count + lane.segments.length, 0);
  const visibleTranscriptSegment = useMemo(
    () => (transcriptSegment ? segments.find((segment) => segment.id === transcriptSegment.id) ?? transcriptSegment : null),
    [segments, transcriptSegment]
  );
  const outputPlan = useMemo(
    () => applyFilenameTemplate(buildBaseOutputItems().filter((item) => item.checked), filenameTemplate),
    [segments, exportCandidates, filenameTemplate]
  );
  /** `openOutputReview`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  function openOutputReview() {
    setExportPlanState({ status: "idle", plan: null, error: null });
    setOutputOpen(true);
  }

  /** `checkExportRenderDetails`の現在値を検査し、後続処理に必要な判定結果を返す。 */
  async function checkExportRenderDetails() {
    if (!apiBaseUrl || !videoPath) return;
    const items = outputPlan.items.filter((item) => item.checked);
    let plannedItems: ExportRenderPlanItem[] = [];
    setExportPlanState({
      status: "loading",
      plan: { items: plannedItems },
      error: null,
      completed: 0,
      total: items.length,
      currentId: items[0]?.id ?? null
    });
    try {
      for (let index = 0; index < items.length; index += 1) {
        const result = await getExportPlan(apiBaseUrl, videoPath, [items[index]]);
        plannedItems = [...plannedItems, ...result.items];
        setExportPlanState({
          status: "loading",
          plan: { items: plannedItems },
          error: null,
          completed: index + 1,
          total: items.length,
          currentId: items[index + 1]?.id ?? null
        });
      }
      setExportPlanState({ status: "ready", plan: { items: plannedItems }, error: null });
    } catch (error) {
      setExportPlanState({ status: "error", plan: null, error: localizedError(error) });
    }
  }
  const exportJob = taskRegistry.tasks.export ?? null;
  const transcriptionJob = taskRegistry.tasks.transcription ?? null;
  const lyricsAnalysisJob = taskRegistry.tasks["lyrics-analysis"] ?? null;
  const subtitleExportJob = taskRegistry.tasks["subtitle-export"] ?? null;
  const runningJob = taskRegistry.blockingTask;
  const projectDocument = useMemo(
    () => {
      if (!projectBase) return null;
      const commonState = {
        revision: projectRevision,
        videoPath,
        duration,
        waveform: progressiveWaveform.waveform,
        analysisDevice,
        whisper: whisperSettings,
        filenameTemplate,
        currentTime,
        zoomIndex,
      };
      if (mode === "sub") {
        assertSubProjectOperation(projectOperation);
        return composeSubProjectDocument(projectBase, {
          ...commonState,
          subtitle: subtitleState,
          operation: projectOperation,
        });
      }
      assertCutProjectOperation(projectOperation);
      return composeCutProjectDocument(projectBase, {
          ...commonState,
          selectedSegmentId,
          guideText,
        analysis,
        segments,
        exportCandidates,
        operation: projectOperation,
      });
    },
    [
      projectBase,
      projectRevision,
      videoPath,
      duration,
      guideText,
      progressiveWaveform.waveform,
      analysis,
      segments,
      exportCandidates,
      analysisDevice,
      whisperSettings,
      filenameTemplate,
      selectedSegmentId,
      currentTime,
      zoomIndex,
      projectOperation,
      mode,
      subtitleState,
    ]
  );
  const persistence = useProjectPersistence(
    projectReadOnly ? "" : projectPath,
    projectReadOnly ? null : projectDocument,
    handleEditing
  );
  const transcriptStale = useMemo(
    () => segments.some((segment) => transcriptSettingsAreStale(segment, whisperSettings)),
    [segments, whisperSettings]
  );
  const selectedWhisperModel = whisperStatus?.models.find((model) => model.key === whisperSettings.model) ?? null;
  const whisperBusy = taskRegistry.runningTasks.some((task) =>
    ["analysis", "lyrics-analysis", "transcription", "export", "subtitle-export", "download-whisper", "download-demucs", "download-mms"].includes(task.kind)
  );
  const taskStatus = (
    <TaskStatusPanel
      runningTasks={taskRegistry.runningTaskEntries}
      failedTasks={taskRegistry.failedTaskEntries}
      latestTerminalTask={taskRegistry.latestTerminalTask}
      message={message}
      videoInfo={videoInfo}
      scratchProxyState={scratchProxyState}
      waveformPhase={progressiveWaveform.phase}
      waveformProgress={progressiveWaveform.progress}
      onDismiss={(slot) => taskRegistry.updateTask(slot, null)}
      onWaveformRetry={
        sourceAvailable && videoPath && progressiveWaveform.phase === "failed"
          ? () => void progressiveWaveform.start(videoPath)
          : null
      }
    />
  );

  projectDocumentRef.current = projectDocument;

  /** `markProjectChanged`の変更をrevisionへ記録し、永続化対象であることを示す。 */
  function markProjectChanged() {
    if (projectBase && !projectReadOnly) setProjectRevision((revision) => revision + 1);
  }

  const { cut: cutOperations, sub: subOperations } = useModeOperations({
    runner: {
      updateTask: taskRegistry.updateTask,
      setProjectOperation,
      markProjectChanged,
    },
    cut: {
      apiBaseUrl,
      videoPath,
      guideText,
      analysisDevice,
      boundaryRefinementSettings,
      whisperSettings,
      segments,
      projectOperation,
      updateTask: taskRegistry.updateTask,
      applyAnalysisResult: (result, nextSegments) => {
        setAnalysis(result);
        setSegments(nextSegments);
        setExportCandidates(result.export_candidates);
        setSelectedSegmentId(nextSegments[0]?.id ?? null);
      },
      applyTranscripts,
      updateProjectOperation: (updater) => setProjectOperation(updater),
      onExportStart: () => {
        setOutputOpen(false);
        setExportProgressOpen(true);
      },
      onMessage: setMessage,
      refreshWhisperStatus,
    },
    sub: {
      apiBaseUrl,
      videoPath,
      state: subtitleState,
      whisperSettings,
      analysisJob: lyricsAnalysisJob,
      exportJob: subtitleExportJob,
      updateTask: taskRegistry.updateTask,
      setState: setSubtitleState,
      markStateChanged: markProjectChanged,
      focusSegment: focusSubtitleSegment,
      onMessage: setMessage,
      confirm: (message) => window.confirm(message),
    },
  });

  /** `updateFilenameTemplate`で指定された変更を不変更新として状態へ反映する。 */
  function updateFilenameTemplate(value: string) {
    setFilenameTemplate(value);
    markProjectChanged();
  }

  useEffect(() => {
    selectedSegmentRef.current = selectedSegment;
  }, [selectedSegment]);

  useEffect(() => {
    writeScratchPreviewMilliseconds(window.localStorage, scratchPreviewMilliseconds);
  }, [scratchPreviewMilliseconds]);

  useEffect(() => {
    scratchAudioProxyEnabledRef.current = scratchAudioProxyEnabled;
    writeScratchAudioProxyEnabled(window.localStorage, scratchAudioProxyEnabled);
  }, [scratchAudioProxyEnabled]);

  useEffect(() => {
    if (!boundarySecondsInput.trim()) return;
    writeBoundarySecondsInput(window.localStorage, boundarySecondsInput);
  }, [boundarySecondsInput]);

  useEffect(() => {
    if (!boundaryNudgeSecondsInput.trim()) return;
    writeBoundaryNudgeSecondsInput(window.localStorage, boundaryNudgeSecondsInput);
  }, [boundaryNudgeSecondsInput]);

  useEffect(() => {
    writeVideoSplitPercent(window.localStorage, split);
  }, [split]);

  useEffect(() => {
    try {
      writeWaveformDisplayMode(window.localStorage, "cut", waveformDisplayModes.cut);
      writeWaveformDisplayMode(window.localStorage, "sub", waveformDisplayModes.sub);
    } catch {
      // Keep the settings for this session when persistent storage is unavailable.
    }
  }, [waveformDisplayModes]);

  useEffect(() => {
    try {
      writeCutWaveformAmplitudeProfile(window.localStorage, cutWaveformAmplitudeProfile);
    } catch {
      // Keep the setting for this session when persistent storage is unavailable.
    }
  }, [cutWaveformAmplitudeProfile]);

  useEffect(() => {
    writeCreateSourceFolder(window.localStorage, createSourceFolder);
  }, [createSourceFolder]);

  useEffect(() => {
    if (settingsOpen) setScratchPreviewMillisecondsInput(String(scratchPreviewMilliseconds));
  }, [settingsOpen, scratchPreviewMilliseconds]);

  useEffect(() => {
    runningJobRef.current = runningJob;
  }, [runningJob]);

  useEffect(() => {
    window.songcut.apiBaseUrl().then(setApiBaseUrl).catch((error) => setMessage(String(error)));
  }, []);

  useEffect(() => {
    if (!apiBaseUrl || recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    void checkRecoveryOnStartup();
  }, [apiBaseUrl]);

  useEffect(() => {
    const sourceName = projectBase?.source.filename;
    const readOnlySuffix = projectReadOnly ? " — Read only" : "";
    void window.songcut.setWindowTitle(sourceName ? `songcut — ${sourceName}${readOnlySuffix}` : "songcut");
  }, [projectBase?.source.filename, projectReadOnly]);

  useEffect(() => {
    if (!apiBaseUrl) return;
    let cancelled = false;
    setFfmpegCheckPending(true);
    checkFfmpeg(apiBaseUrl)
      .then((result) => {
        if (cancelled) return;
        setFfmpegCheckResult(result);
        if (!result.ok) {
          setFfmpegCheckOpen(true);
          setMessage("ffmpeg check failed.");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setFfmpegCheckResult({ ok: false, error: String(error), download_url: FFMPEG_DOWNLOAD_URL });
        setFfmpegCheckOpen(true);
        setMessage("ffmpeg check failed.");
      })
      .finally(() => {
        if (!cancelled) setFfmpegCheckPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    const generation = scratchProxyConfigurationGenerationRef.current + 1;
    scratchProxyConfigurationGenerationRef.current = generation;
    void configureScratchProxy(generation);
    return () => {
      if (scratchProxyConfigurationGenerationRef.current === generation) {
        scratchProxyConfigurationGenerationRef.current += 1;
      }
      void disposeScratchProxy(apiBaseUrl);
    };
  }, [apiBaseUrl, videoPath, videoInfo?.audio.codec, scratchAudioProxyEnabled]);

  useEffect(() => {
    return window.songcut.onCloseRequested(() => {
      if (runningJobRef.current) {
        setQuitConfirmOpen(true);
        return;
      }
      void (async () => {
        try {
          const result = await persistence.flush();
          if (projectDocumentRef.current && !result.sidecarSaved) {
            setMessage("The sidecar could not be saved. Recovery data is available, but normal close was cancelled.");
            setQuitConfirmOpen(true);
            return;
          }
          await persistence.clearRecovery();
          await window.songcut.confirmClose();
        } catch (error) {
          setMessage(`Could not save before closing: ${String(error)}`);
          setQuitConfirmOpen(true);
        }
      })();
    });
  }, [persistence.flush, persistence.clearRecovery]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      const scratchTime = scratchPreviewTimeRef.current;
      if (scratchTime !== null) {
        setCurrentTime(scratchTime);
        return;
      }
      const stopAt = playbackStopAtRef.current;
      if (stopAt !== null && video.currentTime >= stopAt - 0.02) {
        playbackStopAtRef.current = null;
        video.pause();
        video.currentTime = stopAt;
        setCurrentTime(stopAt);
        return;
      }
      setCurrentTime(video.currentTime);
    };
    const onPlay = () => {
      if (scratchPreviewTimeRef.current !== null) {
        playbackStopAtRef.current = null;
        return;
      }
      if (playbackStopAtRef.current === null) {
        playbackStopAtRef.current = segmentStopAtForTime(selectedSegmentRef.current, video.currentTime);
      }
      setPlaying(true);
    };
    const onPause = () => {
      playbackStopAtRef.current = null;
      setPlaying(false);
    };
    const onEnded = () => {
      playbackStopAtRef.current = null;
      setPlaying(false);
    };
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      if (scratchPreviewTimerRef.current !== null) {
        window.clearTimeout(scratchPreviewTimerRef.current);
        scratchPreviewTimerRef.current = null;
      }
      scratchPreviewGenerationRef.current += 1;
      scratchPreviewTimeRef.current = null;
      scratchPreviewMediaRef.current?.pause();
      scratchPreviewMediaRef.current = null;
    };
  }, [videoUrl]);

  useEffect(() => {
    const jobId = analysis?.transcription_job_id;
    if (!apiBaseUrl || !jobId) return;
    return cutModeSession.operations.watchBackgroundTranscription(jobId);
  }, [apiBaseUrl, analysis?.transcription_job_id, cutOperations]);

  /** `checkRecoveryOnStartup`の現在値を検査し、後続処理に必要な判定結果を返す。 */
  async function checkRecoveryOnStartup() {
    try {
      const raw = await window.songcut.loadRecovery();
      if (!raw) return;
      const snapshot = parseRecoverySnapshot(raw);
      try {
        const sidecar = parseProjectOpenResult(await window.songcut.loadProject(snapshot.project_path));
        if (sidecar.document.revision >= snapshot.document.revision) {
          await window.songcut.clearRecovery();
          return;
        }
      } catch {
        // A missing or damaged sidecar makes the independently validated recovery snapshot valuable.
      }
      setRecoveryCandidate(snapshot);
      setRecoveryOpen(true);
    } catch (error) {
      setMessage(`Recovery snapshot could not be read: ${String(error)}`);
    }
  }

  /** `showWaveformForDocument`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  function showWaveformForDocument(document: ProjectDocumentV1, sourcePath: string | null) {
    const displayPath = sourcePath ?? document.source.absolute_path;
    const snapshot = document.waveform_snapshot;
    const documentWaveform = waveformFromProject(document);
    const decision = selectWaveformHydration(waveformSessionCache, {
      fingerprint: document.source.fingerprint.value,
      duration: document.source.duration_seconds,
      document:
        snapshot && documentWaveform.length === snapshot.point_count && documentWaveform.length > 0
          ? {
              points: documentWaveform,
              metadata: {
                source_path: displayPath,
                duration: snapshot.duration_seconds,
                sample_rate: snapshot.sample_rate,
                channels: snapshot.channels,
                generator: snapshot.generator,
                point_count: snapshot.point_count,
              },
              encoding: snapshot.encoding,
            }
          : null,
    });
    progressiveWaveform.showCached(displayPath, decision.points, decision.metadata);
    if (decision.source === "generate" && sourcePath) void progressiveWaveform.start(sourcePath);
  }

  /** `hydrateProject`の外部表現を検証し、アプリ内部で扱う状態へ復元する。 */
  async function hydrateProject(nextProjectPath: string, document: ProjectDocumentV1, preferredSource?: string) {
    if (!apiBaseUrl) return;
    const hydrated = hydrateProjectDocument(document);
    const wasRunning = hydrated.operation?.status === "running";
    const operation = normalizeInterruptedOperation(hydrated.operation);
    let sourcePath = preferredSource ?? (await window.songcut.findProjectSource(nextProjectPath, document));
    let info: VideoInfo | null = null;
    let fileUrl = "";
    if (sourcePath) {
      try {
        [info, fileUrl] = await Promise.all([probeVideo(apiBaseUrl, sourcePath), window.songcut.fileUrl(sourcePath)]);
        if (!sourceDurationMatches(document.source.duration_seconds, info.duration)) {
          sourcePath = null;
          info = null;
          fileUrl = "";
          setMessage("The candidate source has a different duration and was not linked.");
        }
      } catch (error) {
        sourcePath = null;
        setMessage(`Source media could not be opened: ${String(error)}`);
      }
    }

    // Cut/Sub projects share the same loaded media and therefore the same scratch
    // audio proxy. Keep that global media task alive while only the sidecar changes.
    projectBaseRef.current = document;
    videoPathRef.current = sourcePath ?? "";
    projectReadOnlyRef.current = false;
    setProjectPath(nextProjectPath);
    setProjectBase(document);
    setProjectRevision(document.revision + (wasRunning ? 1 : 0));
    setProjectOperation(operation);
    setProjectReadOnly(false);
    setSourceAvailable(Boolean(sourcePath));
    setVideoPath(sourcePath ?? "");
    setVideoUrl(fileUrl);
    setVideoInfo(info ?? offlineVideoInfo(document));
    setGuideText(hydrated.mode === "cut" ? hydrated.guideText : "");
    setMode(hydrated.mode);
    setSubtitleState(hydrated.mode === "sub" ? hydrated.subtitle : createDefaultSubtitleState());
    setAnalysis(hydrated.mode === "cut" ? hydrated.analysis : null);
    showWaveformForDocument(document, sourcePath);
    setSegments(hydrated.mode === "cut" ? hydrated.segments : []);
    setExportCandidates(hydrated.mode === "cut" ? hydrated.exportCandidates : []);
    setSelectedSegmentId(
      hydrated.mode === "cut"
        ? hydrated.selectedSegmentId ?? hydrated.segments[0]?.id ?? null
        : null
    );
    setCurrentTime(hydrated.currentTime);
    setZoomIndex(clamp(hydrated.zoomIndex, 0, zoomLevels.length - 1));
    setAnalysisDevice(hydrated.projectSettings.analysisDevice);
    setWhisperSettings({
      ...DEFAULT_WHISPER_SETTINGS,
      ...hydrated.projectSettings.whisper,
      lyricsAlignmentAlgorithm: hydrated.projectSettings.whisper.lyricsAlignmentAlgorithm ?? "songcut-standard"
    });
    setFilenameTemplate(hydrated.projectSettings.filenameTemplate);
    taskRegistry.clearTasks([
      "analysis",
      "lyrics-analysis",
      "transcription",
      "export",
      "subtitle-export",
      "subtitle-render",
    ]);
    setTranscriptSegment(null);
    setSegmentManagementReview(null);
    setTimestampCommentFlow(closeTimestampCommentFlow());
    setMessage(
      sourcePath
        ? wasRunning
          ? "Project restored. The active operation was interrupted and can be resumed."
          : "Project loaded."
        : "Source missing — relink the original media to resume playback and processing."
    );
  }

  /** `loadVideo`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
  async function loadVideo(filePath: string, discardCurrentChanges = false) {
    if (!apiBaseUrl) return;
    if (!discardCurrentChanges) {
      try {
        const result = await persistence.flush();
        if (projectDocumentRef.current && !result.sidecarSaved) {
          setSwitchSaveFailure({
            target: { kind: "video", path: filePath },
            error: "The sidecar could not be flushed.",
            recoverySaved: result.recoverySaved
          });
          return;
        }
      } catch (error) {
        setSwitchSaveFailure({
          target: { kind: "video", path: filePath },
          error: String(error),
          recoverySaved: false
        });
        return;
      }
    }
    const generation = videoLoadGenerationRef.current + 1;
    videoLoadGenerationRef.current = generation;
    progressiveWaveform.cancel();
    taskRegistry.clearTasks([
      "analysis",
      "lyrics-analysis",
      "transcription",
      "export",
      "subtitle-export",
      "subtitle-render",
    ]);
    setTimestampCommentFlow(closeTimestampCommentFlow());
    setMessage("Loading video.");
    const [info, fileUrl, identity, nextProjectPath] = await Promise.all([
      probeVideo(apiBaseUrl, filePath),
      window.songcut.fileUrl(filePath),
      window.songcut.fingerprintSource(filePath).then(parseSourceIdentity),
      window.songcut.projectPathForVideo(filePath)
    ]);
    if (videoLoadGenerationRef.current !== generation) return;

    try {
      const existing = parseProjectOpenResult(await window.songcut.loadProject(nextProjectPath));
      if (!(await window.songcut.sourceIdentityMatches(existing.document, identity))) {
        throw new Error("The existing sidecar belongs to a different media file and was not overwritten.");
      }
      await hydrateProject(nextProjectPath, existing.document, filePath);
      if (existing.recoveredFrom !== "target") {
        setMessage(`Project recovered from its ${existing.recoveredFrom} copy.`);
      }
      return;
    } catch (error) {
      if (!isProjectNotFoundError(error)) {
        if (!projectBase) setProjectReadOnly(true);
        throw new Error(`The existing sidecar was protected: ${String(error)}`);
      }
    }

    const document = createCutProjectDocument(nextProjectPath, identity, info);
    let initialSidecarError: unknown = null;
    try {
      await persistence.saveProjectNow(nextProjectPath, document);
    } catch (error) {
      initialSidecarError = error;
    }
    scratchProxyConfigurationGenerationRef.current += 1;
    void disposeScratchProxy(apiBaseUrl);
    projectBaseRef.current = document;
    videoPathRef.current = filePath;
    projectReadOnlyRef.current = false;
    setProjectPath(nextProjectPath);
    setProjectBase(document);
    setProjectRevision(document.revision);
    setProjectOperation(null);
    setProjectReadOnly(false);
    setSourceAvailable(true);
    setVideoPath(filePath);
    setVideoUrl(fileUrl);
    setVideoInfo(info);
    setGuideText("");
    setMode("cut");
    setSubtitleState(createDefaultSubtitleState());
    setAnalysis(null);
    showWaveformForDocument(document, filePath);
    setSegments([]);
    setExportCandidates([]);
    setSelectedSegmentId(null);
    setTranscriptSegment(null);
    setSegmentManagementReview(null);
    setCurrentTime(0);
    setAnalysisDevice("auto");
    setWhisperSettings({ ...DEFAULT_WHISPER_SETTINGS });
    setFilenameTemplate(DEFAULT_FILENAME_TEMPLATE);
    setTimestampCommentFlow(beginTimestampCommentFlow(info.timestamp_comment_candidates ?? []));
    setMessage(
      initialSidecarError
        ? `Video loaded. The sidecar could not be created; recovery storage will be used. ${String(initialSidecarError)}`
        : info.info_json_warning
          ? `Video loaded. ${info.info_json_warning}`
          : "Video loaded and project created."
    );
  }

  /** `activateOpenedProject`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  async function activateOpenedProject(opened: ProjectOpenResult, discardCurrentChanges = false) {
    if (!discardCurrentChanges) {
      try {
        const result = await persistence.flush();
        if (projectDocumentRef.current && !result.sidecarSaved) {
          setSwitchSaveFailure({
            target: { kind: "project", path: opened.projectPath },
            error: "The sidecar could not be flushed.",
            recoverySaved: result.recoverySaved
          });
          return;
        }
      } catch (error) {
        setSwitchSaveFailure({
          target: { kind: "project", path: opened.projectPath },
          error: String(error),
          recoverySaved: false
        });
        return;
      }
    }
    await hydrateProject(opened.projectPath, opened.document);
    if (opened.recoveredFrom !== "target") setMessage(`Project recovered from its ${opened.recoveredFrom} copy.`);
  }

  /** `loadProjectPath`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
  async function loadProjectPath(filePath: string, discardCurrentChanges = false) {
    const opened = parseProjectOpenResult(await window.songcut.loadProject(filePath));
    await activateOpenedProject(opened, discardCurrentChanges);
  }

  /** `openProject`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  async function openProject() {
    try {
      const raw = await window.songcut.openProject();
      if (!raw) return;
      const opened = parseProjectOpenResult(raw);
      await activateOpenedProject(opened);
    } catch (error) {
      if (!projectBase) setProjectReadOnly(true);
      setMessage(`Project opened in protected read-only mode: ${String(error)}`);
    }
  }

  /** `switchMode`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  async function switchMode(nextMode: AppMode) {
    if (nextMode === mode) return;
    if (runningJob) {
      setMessage("処理の完了後にモードを切り替えられます。");
      return;
    }
    if (!videoPath || !videoInfo) {
      setMessage("動画を読み込んでからモードを切り替えてください。");
      return;
    }
    setMessage(`${nextMode === "sub" ? "Sub" : "Cut"}モードへ切り替えています。`);
    try {
      const flushed = await persistence.flush();
      if (projectDocumentRef.current && !flushed.sidecarSaved) {
        setMessage("現在のprojectを保存できなかったため、モードを切り替えませんでした。");
        return;
      }
      const nextProjectPath = await window.songcut.projectPathForVideo(videoPath, nextMode);
      try {
        const opened = parseProjectOpenResult(await window.songcut.loadProject(nextProjectPath));
        await hydrateProject(nextProjectPath, opened.document, videoPath);
        return;
      } catch (error) {
        if (!isProjectNotFoundError(error)) throw error;
      }
      const identity = parseSourceIdentity(await window.songcut.fingerprintSource(videoPath));
      const document = nextMode === "sub"
        ? createSubProjectDocument(nextProjectPath, identity, videoInfo)
        : createCutProjectDocument(nextProjectPath, identity, videoInfo);
      await persistence.saveProjectNow(nextProjectPath, document);
      await hydrateProject(nextProjectPath, document, videoPath);
    } catch (error) {
      setMessage(`モード切替に失敗しました: ${String(error)}`);
    }
  }

  /** `recoverProject`のsnapshotから編集状態を復元し、通常の保存経路へ戻す。 */
  async function recoverProject() {
    if (!recoveryCandidate) return;
    const target = recoveryCandidate.project_path || (await window.songcut.projectPathForVideo(recoveryCandidate.document.source.absolute_path));
    const document: ProjectDocumentV1 = {
      ...recoveryCandidate.document,
      revision: recoveryCandidate.document.revision + 1,
      updated_at: new Date().toISOString(),
      operation: normalizeInterruptedOperation(recoveryCandidate.document.operation)
    };
    await hydrateProject(target, document);
    await persistence.saveProjectNow(target, document);
    setRecoveryOpen(false);
    setRecoveryCandidate(null);
    setMessage("Recovered edits were saved to the project sidecar.");
  }

  /** `discardRecovery`の対象を取り除き、関連する一時状態やresourceを後始末する。 */
  async function discardRecovery() {
    await window.songcut.clearRecovery();
    setRecoveryOpen(false);
    setRecoveryCandidate(null);
  }

  /** `relinkSource`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  async function relinkSource() {
    const current = projectDocumentRef.current;
    if (!current) return;
    const selected = await window.songcut.selectRelinkSource(current.source.filename);
    if (!selected) return;
    const identity = parseSourceIdentity(await window.songcut.fingerprintSource(selected));
    if (!(await window.songcut.sourceIdentityMatches(current, identity))) {
      setMessage("The selected file has a different fingerprint. It was not linked to this project.");
      return;
    }
    if (!apiBaseUrl) return;
    const info = await probeVideo(apiBaseUrl, selected);
    if (!sourceDurationMatches(current.source.duration_seconds, info.duration)) {
      setMessage("The selected file has a different duration. It was not linked to this project.");
      return;
    }
    const nextProjectPath = await window.songcut.projectPathForVideo(selected, mode);
    const conflict: RelinkConflict = {
      selectedPath: selected,
      identity,
      videoInfo: info,
      destinationPath: nextProjectPath,
      existing: null,
      damaged: false
    };
    if (!sameWindowsPath(nextProjectPath, projectPath)) {
      try {
        conflict.existing = parseProjectOpenResult(await window.songcut.loadProject(nextProjectPath));
        setRelinkConflict(conflict);
        return;
      } catch (error) {
        if (!isProjectNotFoundError(error)) {
          setRelinkConflict({ ...conflict, damaged: true });
          return;
        }
      }
    }
    await completeRelink(conflict, false);
  }

  /** `completeRelink`の進行中状態を完了させ、一時resourceと表示状態を整理する。 */
  async function completeRelink(conflict: RelinkConflict, archiveDamagedDestination: boolean) {
    const current = projectDocumentRef.current;
    if (!current) return;
    if (archiveDamagedDestination) await window.songcut.archiveConflict(conflict.destinationPath);
    const updated: ProjectDocumentV1 = {
      ...current,
      revision: current.revision + 1,
      updated_at: new Date().toISOString(),
      source: {
        ...current.source,
        absolute_path: conflict.identity.path,
        relative_path: conflict.identity.filename,
        filename: conflict.identity.filename,
        size_bytes: conflict.identity.size_bytes,
        mtime_ms: conflict.identity.mtime_ms,
        duration_seconds: conflict.videoInfo.duration,
        fingerprint: conflict.identity.fingerprint
      }
    };
    await persistence.saveProjectNow(conflict.destinationPath, updated);
    if (projectPath && !sameWindowsPath(conflict.destinationPath, projectPath)) {
      await window.songcut.archiveRelinkedProject(projectPath);
    }
    await hydrateProject(conflict.destinationPath, updated, conflict.selectedPath);
    setRelinkConflict(null);
    setMessage("Source relinked and the project was saved beside the media.");
  }

  /** `configureScratchProxy`の設定に基づいて必要なresourceを作成または解放する。 */
  async function configureScratchProxy(generation: number) {
    await disposeScratchProxy(apiBaseUrl);
    if (scratchProxyConfigurationGenerationRef.current !== generation) return;

    if (!apiBaseUrl || !videoPath || !videoInfo) {
      setScratchProxyState("idle");
      return;
    }
    if (!scratchAudioProxyEnabled) {
      setScratchProxyState("disabled");
      return;
    }
    if (!shouldCreateScratchProxy(true, videoInfo.audio.codec)) {
      setScratchProxyState("original");
      return;
    }

    setScratchProxyState("preparing");
    let trackedJob = createPendingTask("scratch-proxy", tr("messages.proxyPreparing"));
    taskRegistry.updateTask("scratch-proxy", trackedJob);
    try {
      const started = await startScratchProxy(apiBaseUrl, videoPath);
      trackedJob = started;
      taskRegistry.updateTask("scratch-proxy", started);
      if (scratchProxyConfigurationGenerationRef.current !== generation) {
        await cancelScratchProxy(apiBaseUrl, started.id).catch(() => undefined);
        return;
      }
      scratchProxyJobIdRef.current = started.id;
      const result = await waitForJob<ScratchProxyResult>(
        apiBaseUrl,
        started.id,
        (nextJob) => {
          if (scratchProxyConfigurationGenerationRef.current !== generation) return;
          trackedJob = nextJob;
          taskRegistry.updateTask("scratch-proxy", nextJob);
        },
        250
      );
      if (scratchProxyJobIdRef.current === started.id) scratchProxyJobIdRef.current = null;
      if (scratchProxyConfigurationGenerationRef.current !== generation) {
        await releaseScratchProxy(apiBaseUrl, result.proxy_id).catch(() => undefined);
        return;
      }

      scratchProxyIdRef.current = result.proxy_id;
      setScratchProxyState("loading");
      const proxyUrl = await window.songcut.fileUrl(result.proxy_path);
      const proxyAudio = scratchProxyAudioRef.current;
      if (!proxyAudio) throw new Error("Scratch proxy audio element is unavailable.");
      await loadScratchProxyAudio(proxyAudio, proxyUrl);
      if (scratchProxyConfigurationGenerationRef.current !== generation) {
        await disposeScratchProxy(apiBaseUrl);
        return;
      }
      scratchProxyReadyRef.current = true;
      setScratchProxyState("ready");
    } catch (error) {
      if (scratchProxyConfigurationGenerationRef.current !== generation) return;
      taskRegistry.updateTask(
        "scratch-proxy",
        failTask(trackedJob, error, "Scratch proxy failed; using original audio.")
      );
      await disposeScratchProxy(apiBaseUrl, false);
      if (scratchProxyConfigurationGenerationRef.current !== generation) return;
      setScratchProxyState("failed");
      setMessage(`Scratch proxy failed; using original audio: ${String(error)}`);
    }
  }

  /** `disposeScratchProxy`の対象を取り除き、関連する一時状態やresourceを後始末する。 */
  async function disposeScratchProxy(baseUrl: string, clearTask = true) {
    const proxyAudio = scratchProxyAudioRef.current;
    if (scratchPreviewMediaRef.current === proxyAudio) finishScratchPreview();
    scratchProxyReadyRef.current = false;
    if (proxyAudio) {
      proxyAudio.pause();
      proxyAudio.removeAttribute("src");
      proxyAudio.load();
    }

    const jobId = scratchProxyJobIdRef.current;
    const proxyId = scratchProxyIdRef.current;
    scratchProxyJobIdRef.current = null;
    scratchProxyIdRef.current = null;
    if (clearTask) taskRegistry.updateTask("scratch-proxy", null);
    if (!baseUrl) return;
    if (jobId) await cancelScratchProxy(baseUrl, jobId).catch(() => undefined);
    if (proxyId) await releaseScratchProxy(baseUrl, proxyId).catch(() => undefined);
  }

  /** `selectVideo`の候補と条件から、利用すべき値または操作を決定する。 */
  async function selectVideo() {
    const filePath = await window.songcut.selectVideo();
    if (!filePath) return;
    await loadVideo(filePath).catch((error) => setMessage(String(error)));
  }

  /** `runFfmpegCheck`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function runFfmpegCheck(showSuccess: boolean) {
    if (!apiBaseUrl) return;
    if (showSuccess) setFfmpegCheckOpen(true);
    setFfmpegCheckPending(true);
    try {
      const result = await checkFfmpeg(apiBaseUrl);
      setFfmpegCheckResult(result);
      if (showSuccess || !result.ok) setFfmpegCheckOpen(true);
      setMessage(result.ok ? tr("ffmpeg.available") : tr("messages.ffmpegFailed"));
    } catch (error) {
      setFfmpegCheckResult({ ok: false, error: String(error), download_url: FFMPEG_DOWNLOAD_URL });
      setFfmpegCheckOpen(true);
      setMessage(tr("messages.ffmpegFailed"));
    } finally {
      setFfmpegCheckPending(false);
    }
  }

  /** `analyze`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function analyze() {
    if (whisperSettings.enabled && !selectedWhisperModel?.ready) {
      setWhisperPreflightOpen(true);
      return;
    }
    await runAnalysis(whisperSettings.enabled);
  }

  /** `runAnalysis`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function runAnalysis(transcribeAfter: boolean) {
    await cutModeSession.operations.runAnalysis(transcribeAfter);
  }

  /** `runTranscription`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function runTranscription(candidateSegments = segments, resumeInterrupted = true) {
    await cutModeSession.operations.runTranscription(candidateSegments, resumeInterrupted);
  }

  /** `exportClips`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function exportClips(outputDir: string, createVideoFolder: boolean) {
    const outputItems = buildOutputItems();
    const items = outputItems.filter((item) => item.checked);
    await cutModeSession.operations.exportClips({
      outputDir,
      createSourceFolder: createVideoFolder,
      items: outputItems,
      timestampCommentText: buildTimestampExportText(items, "timestamp-comment"),
      validationError: outputPlan.error
        ? localizeFilenameTemplateError(outputPlan.error) ?? outputPlan.error
        : null,
    });
  }

  /** `cancelQuit`の入力が要求された条件やschemaを満たすか検証する。 */
  function cancelQuit() {
    setQuitConfirmOpen(false);
    void window.songcut.cancelClose();
  }

  /** `confirmQuit`の確認済み変更を編集状態へ適用する。 */
  async function confirmQuit() {
    setQuitConfirmOpen(false);
    const current = projectDocumentRef.current;
    if (current) {
      const kind = runningJobRef.current?.kind;
      const operationKind = isProjectOperationKind(kind) ? kind : current.operation?.kind;
      const interrupted: ProjectDocumentV1 = {
        ...current,
        revision: current.revision + 1,
        updated_at: new Date().toISOString(),
        operation: operationKind
          ? { ...(current.operation ?? {}), kind: operationKind, status: "interrupted" }
          : current.operation
      };
      try {
        await persistence.saveRecoveryNow(interrupted);
      } catch (error) {
        setMessage(`Recovery save failed while quitting: ${String(error)}`);
        setQuitConfirmOpen(true);
        return;
      }
    }
    await window.songcut.confirmClose();
  }

  /** `buildOutputItems`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
  function buildOutputItems(): OutputItem[] {
    return outputPlan.items;
  }

  /** `buildBaseOutputItems`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
  function buildBaseOutputItems(): OutputItem[] {
    return segments.map((segment, index) => {
      const candidate = exportCandidates[index];
      const title = segmentTitle(segment);
      return {
        id: candidate?.id ?? segment.id,
        segmentId: segment.id,
        title,
        filename_stem: filenameStemForSegment(segment, candidate),
        start: segment.start,
        end: segment.end,
        checked: segment.checked !== false
      };
    });
  }

  /** `buildSegmentReviewItems`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
  function buildSegmentReviewItems(reviewSegments: readonly Segment[]) {
    const baseItems = new Map(buildBaseOutputItems().map((item) => [item.segmentId, item]));
    const requested = reviewSegments.flatMap((segment) => {
      const item = baseItems.get(segment.id);
      return item ? [item] : [];
    });
    const templated = applyFilenameTemplate(requested, filenameTemplate);
    return templated.error ? requested : templated.items;
  }

  /** `exportTimestampText`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function exportTimestampText(format: TimestampExportFormat) {
    const items = buildOutputItems().filter((item) => item.checked);
    const text = buildTimestampExportText(items, format);
    if (!text) {
      setMessage(tr("messages.noChecked"));
      return;
    }
    try {
      window.songcut.writeClipboard(text);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setTimestampExportOpen(false);
    setTimestampCopyCount(items.length);
    setMessage(tr("messages.copiedTimestamp", { count: items.length, format: tr(`timestampExport.${format}`) }));
  }

  /** `updateSegment`で指定された変更を不変更新として状態へ反映する。 */
  function updateSegment(id: string, patch: Partial<Segment>) {
    setSegments((current) => current.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)));
    markProjectChanged();
  }

  /** `previewSegmentUpdate`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function previewSegmentUpdate(id: string, patch: Partial<Segment>) {
    setSegments((current) => current.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)));
  }

  /** `addNewSegment`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
  function addNewSegment() {
    if (!projectBase) return;
    const pair = createManualSegment(segments, currentTime, duration, tr("segments.newTitle"));
    const next = insertSegmentPair({ segments, exportCandidates }, pair, selectedSegmentId);
    setSegments(next.segments);
    setExportCandidates(next.exportCandidates);
    setSelectedSegmentId(pair.segment.id);
    setSegmentFocusRequest((request) => request + 1);
    seek(pair.segment.start);
    markProjectChanged();
    setMessage(tr("messages.added", { id: pair.segment.id }));
  }

  /** `focusSubtitleSegment`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  function focusSubtitleSegment(segment: LyricsSegment) {
    setSubtitleFocusRequest((request) => request + 1);
    seek(segment.start);
  }

  /** `selectSubtitleSegment`の候補と条件から、利用すべき値または操作を決定する。 */
  function selectSubtitleSegment(laneId: string, segment: LyricsSegment) {
    setSubtitleState((current) => ({
      ...current,
      active_lane_id: laneId,
      selected_segment_id: segment.id,
    }));
    focusSubtitleSegment(segment);
    markProjectChanged();
  }

  /** `addNewSubtitleSegment`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
  function addNewSubtitleSegment() {
    const lane = subtitleState.lanes.find((item) => item.id === subtitleState.active_lane_id) ?? subtitleState.lanes[0];
    if (!lane) return;
    const segment = addFourBeatSegment(lane, subtitleState.selected_segment_id, subtitleState.rhythm_grid);
    if (!segment) return;
    setSubtitleState((current) => ({
      ...current,
      active_lane_id: lane.id,
      selected_segment_id: segment.id,
      lanes: current.lanes.map((item) =>
        item.id === lane.id
          ? { ...item, segments: [...item.segments, segment].sort((left, right) => left.start - right.start) }
          : item
      ),
    }));
    focusSubtitleSegment(segment);
    markProjectChanged();
  }

  /** `removeSelectedSubtitleSegment`の対象を取り除き、関連する一時状態やresourceを後始末する。 */
  function removeSelectedSubtitleSegment() {
    const id = subtitleState.selected_segment_id;
    if (!id) return;
    const lane = subtitleState.lanes.find((item) => item.segments.some((segment) => segment.id === id));
    if (!lane) return;
    const ordered = [...lane.segments].sort((left, right) => left.start - right.start);
    const selectedIndex = ordered.findIndex((segment) => segment.id === id);
    const remaining = ordered.filter((segment) => segment.id !== id);
    const replacement = remaining[Math.min(Math.max(0, selectedIndex), Math.max(0, remaining.length - 1))] ?? null;
    setSubtitleState((current) => ({
      ...current,
      active_lane_id: lane.id,
      selected_segment_id: replacement?.id ?? null,
      lanes: current.lanes.map((lane) => ({
        ...lane,
        segments: lane.segments.filter((segment) => segment.id !== id),
      })),
    }));
    if (replacement) focusSubtitleSegment(replacement);
    else setSubtitleFocusRequest((request) => request + 1);
    markProjectChanged();
  }

  /** `selectAdjacentSubtitleSegment`の候補と条件から、利用すべき値または操作を決定する。 */
  function selectAdjacentSubtitleSegment(direction: -1 | 1) {
    const lane = subtitleState.lanes.find((item) => item.id === subtitleState.active_lane_id) ?? subtitleState.lanes[0];
    if (!lane?.segments.length) return;
    const ordered = [...lane.segments].sort((left, right) => left.start - right.start);
    const index = ordered.findIndex((segment) => segment.id === subtitleState.selected_segment_id);
    const nextIndex = index < 0 ? 0 : clamp(index + direction, 0, ordered.length - 1);
    selectSubtitleSegment(lane.id, ordered[nextIndex]);
  }

  /** `nudgeSelectedSubtitleBoundary`で指定された変更を不変更新として状態へ反映する。 */
  function nudgeSelectedSubtitleBoundary(direction: -1 | 1) {
    const selectedId = subtitleState.selected_segment_id;
    if (!selectedId) return;
    const lane = subtitleState.lanes.find((item) => item.segments.some((segment) => segment.id === selectedId));
    const segment = lane?.segments.find((item) => item.id === selectedId);
    if (!lane || !segment) return;
    const edge = Math.abs(currentTime - segment.start) <= Math.abs(currentTime - segment.end) ? "start" : "end";
    setSubtitleState((current) => ({
      ...current,
      active_lane_id: lane.id,
      lanes: current.lanes.map((item) =>
        item.id === lane.id
          ? nudgeSegmentBoundary(item, selectedId, edge, direction, current.rhythm_grid)
          : item
      ),
    }));
    markProjectChanged();
  }

  /** `selectedSubtitleSegment`の候補と条件から、利用すべき値または操作を決定する。 */
  function selectedSubtitleSegment() {
    for (const lane of subtitleState.lanes) {
      const segment = lane.segments.find((item) => item.id === subtitleState.selected_segment_id);
      if (segment) return segment;
    }
    return null;
  }

  /** `playSubtitleBoundary`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function playSubtitleBoundary(edge: "start" | "end") {
    const segment = selectedSubtitleSegment();
    if (!segment) return;
    const previewSeconds = parseBoundarySeconds(boundarySecondsInput);
    if (edge === "start") playFrom(segment.start, Math.min(segment.end, segment.start + previewSeconds));
    else playFrom(Math.max(segment.start, segment.end - previewSeconds), segment.end);
  }

  /** `jumpSubtitleBoundary`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function jumpSubtitleBoundary(direction: -1 | 1) {
    const boundaries = subtitleState.lanes
      .flatMap((lane) => lane.segments.flatMap((segment) => [segment.start, segment.end]))
      .sort((left, right) => left - right);
    const target =
      direction < 0
        ? [...boundaries].reverse().find((time) => time < currentTime - 0.001)
        : boundaries.find((time) => time > currentTime + 0.001);
    if (target !== undefined) seek(target);
  }

  /** `requestRemoveSelectedSegment`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  function requestRemoveSelectedSegment() {
    if (!selectedSegmentId) return;
    const segment = segments.find((item) => item.id === selectedSegmentId);
    if (!segment) return;
    setSegmentManagementReview({
      kind: "remove",
      title: tr("segments.removeTitle"),
      message: tr("segments.removeMessage"),
      confirmLabel: tr("segments.remove"),
      segmentIds: [segment.id],
      items: buildSegmentReviewItems([segment]),
    });
  }

  /** `requestRemoveUncheckedSegments`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  function requestRemoveUncheckedSegments() {
    const targets = segments.filter((segment) => segment.checked === false);
    if (!targets.length) return;
    setSegmentManagementReview({
      kind: "remove",
      title: tr("segments.removeUncheckedTitle"),
      message: tr("segments.removeUncheckedMessage", { count: targets.length }),
      confirmLabel: tr(targets.length === 1 ? "segments.remove" : "segments.removeMany"),
      segmentIds: targets.map((segment) => segment.id),
      items: buildSegmentReviewItems(targets),
    });
  }

  /** `requestSortSegments`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  function requestSortSegments() {
    if (segments.length < 2) return;
    const sorted = sortSegmentsByStart({ segments, exportCandidates });
    setSegmentManagementReview({
      kind: "sort",
      title: tr("segments.sortTitle"),
      message: tr("segments.sortMessage"),
      before: buildSegmentReviewItems(segments),
      after: buildSegmentReviewItems(sorted.segments),
    });
  }

  /** `confirmSegmentManagement`の確認済み変更を編集状態へ適用する。 */
  function confirmSegmentManagement() {
    const review = segmentManagementReview;
    if (!review) return;
    if (review.kind === "remove") {
      const removedIds = new Set(review.segmentIds);
      const next = removeSegments({ segments, exportCandidates }, removedIds);
      applySegmentCollection(next, removedIds);
      setMessage(tr("messages.removed", { count: review.segmentIds.length }));
    } else {
      applySegmentCollection(sortSegmentsByStart({ segments, exportCandidates }));
      setMessage(tr("messages.sorted"));
    }
    setSegmentManagementReview(null);
  }

  /** `applySegmentCollection`で指定された変更を不変更新として状態へ反映する。 */
  function applySegmentCollection(next: SegmentCollection, removedIds = new Set<string>()) {
    const priorSelectedIndex = selectedSegmentId
      ? segments.findIndex((segment) => segment.id === selectedSegmentId)
      : -1;
    const retainedSelection = selectedSegmentId && next.segments.some((segment) => segment.id === selectedSegmentId)
      ? selectedSegmentId
      : null;
    const replacement = !selectedSegmentId
      ? null
      : retainedSelection
        ? next.segments.find((segment) => segment.id === retainedSelection) ?? null
        : next.segments[Math.min(Math.max(0, priorSelectedIndex), Math.max(0, next.segments.length - 1))] ?? null;
    setSegments(next.segments);
    setExportCandidates(next.exportCandidates);
    setSelectedSegmentId(replacement?.id ?? null);
    setSegmentFocusRequest((request) => request + 1);
    if (transcriptSegment && removedIds.has(transcriptSegment.id)) setTranscriptSegment(null);
    if (replacement && selectedSegmentId && removedIds.has(selectedSegmentId)) seek(replacement.start);
    markProjectChanged();
  }

  /** `checkAllSegments`の現在値を検査し、後続処理に必要な判定結果を返す。 */
  function checkAllSegments() {
    if (!uncheckedCount) return;
    setSegments(setAllSegmentsChecked(segments, true));
    markProjectChanged();
    setMessage(tr("messages.checkedAll"));
  }

  /** `uncheckAllSegments`の選択状態を解除し、export対象を更新する。 */
  function uncheckAllSegments() {
    if (!checkedCount) return;
    setSegments(setAllSegmentsChecked(segments, false));
    markProjectChanged();
    setMessage(tr("messages.uncheckedAll"));
  }

  /** `invertExportSelection`で指定された変更を不変更新として状態へ反映する。 */
  function invertExportSelection() {
    if (!segments.length) return;
    setSegments(invertSegmentChecks(segments));
    markProjectChanged();
    setMessage(tr("messages.inverted"));
  }

  /** `selectSegment`の候補と条件から、利用すべき値または操作を決定する。 */
  function selectSegment(segment: Segment) {
    setSelectedSegmentId(segment.id);
    setSegmentFocusRequest((request) => request + 1);
    seek(segment.start);
  }

  /** `selectAdjacentSegment`の候補と条件から、利用すべき値または操作を決定する。 */
  function selectAdjacentSegment(direction: -1 | 1) {
    if (!selectedSegment) return;
    const index = segments.findIndex((segment) => segment.id === selectedSegment.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= segments.length) return;
    selectSegment(segments[nextIndex]);
  }

  /** `applyTranscripts`で指定された変更を不変更新として状態へ反映する。 */
  function applyTranscripts(transcripts: Transcript[]) {
    if (!transcripts.length) return;
    const transcriptMap = new Map(
      transcripts.map((transcript) => [
        transcript.segment_id,
        {
          ...transcript,
          model_key: whisperSettings.model,
          language_requested: whisperSettings.language,
          device_requested: whisperSettings.device
        } satisfies Transcript
      ])
    );
    setSegments((current) =>
      current.map((segment) => {
        const transcript = transcriptMap.get(segment.id);
        if (!transcript) return segment;
        if (transcript.error && segment.transcript) {
          return { ...segment, transcript: { ...segment.transcript, error: transcript.error } };
        }
        return { ...segment, transcript };
      })
    );
    markProjectChanged();
  }

  /** `cancelScratchPreview`の入力が要求された条件やschemaを満たすか検証する。 */
  function cancelScratchPreview(restorePosition: boolean) {
    scratchPreviewGenerationRef.current += 1;
    if (scratchPreviewTimerRef.current !== null) {
      window.clearTimeout(scratchPreviewTimerRef.current);
      scratchPreviewTimerRef.current = null;
    }
    const target = scratchPreviewTimeRef.current;
    scratchPreviewTimeRef.current = null;
    const activeMedia = scratchPreviewMediaRef.current;
    scratchPreviewMediaRef.current = null;
    activeMedia?.pause();
    if (activeMedia) activeMedia.dataset.scratchPreviewActive = "false";
    if (activeMedia !== scratchProxyAudioRef.current) scratchProxyAudioRef.current?.pause();
    if (target === null) return;
    const video = videoRef.current;
    if (!video) return;
    if (restorePosition) {
      video.currentTime = target;
      setCurrentTime(target);
    }
  }

  /** `finishScratchPreview`の進行中状態を完了させ、一時resourceと表示状態を整理する。 */
  function finishScratchPreview() {
    cancelScratchPreview(true);
  }

  /** `seek`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function seek(time: number) {
    const video = videoRef.current;
    if (!video) return;
    finishScratchPreview();
    video.currentTime = clamp(time, 0, duration || 0);
    setCurrentTime(video.currentTime);
    playbackStopAtRef.current = video.paused ? null : segmentStopAtForTime(selectedSegmentRef.current, video.currentTime);
  }

  /** `playFrom`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function playFrom(time: number, stopAt?: number) {
    const video = videoRef.current;
    if (!video) return;
    finishScratchPreview();
    const target = clamp(time, 0, duration || 0);
    video.currentTime = target;
    setCurrentTime(target);
    playbackStopAtRef.current = stopAt ?? segmentStopAtForTime(selectedSegmentRef.current, target);
    void video.play();
  }

  /** `playVideo`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function playVideo() {
    finishScratchPreview();
    void videoRef.current?.play();
  }

  /** `pauseVideo`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function pauseVideo() {
    if (scratchPreviewTimeRef.current !== null) {
      finishScratchPreview();
      return;
    }
    videoRef.current?.pause();
  }

  /** `scratchPreview`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function scratchPreview(time: number) {
    const video = videoRef.current;
    if (!video) return;
    const target = clamp(time, 0, duration || 0);

    if (scratchPreviewTimeRef.current !== null) {
      cancelScratchPreview(false);
    } else if (!video.paused) {
      video.currentTime = target;
      setCurrentTime(target);
      playbackStopAtRef.current = segmentStopAtForTime(selectedSegmentRef.current, target);
      return;
    }

    const generation = scratchPreviewGenerationRef.current + 1;
    scratchPreviewGenerationRef.current = generation;
    playbackStopAtRef.current = null;
    scratchPreviewTimeRef.current = target;
    video.currentTime = target;
    setCurrentTime(target);
    const proxyAudio = scratchProxyAudioRef.current;
    const previewSource = selectScratchPreviewSource(
      scratchAudioProxyEnabledRef.current,
      scratchProxyReadyRef.current,
      Boolean(proxyAudio)
    );
    const media = previewSource === "proxy" && proxyAudio ? proxyAudio : video;
    scratchPreviewMediaRef.current = media;
    video.dataset.scratchPreviewActive = media === video ? "true" : "false";
    if (proxyAudio) proxyAudio.dataset.scratchPreviewActive = media === proxyAudio ? "true" : "false";
    if (proxyAudio && media === proxyAudio) {
      proxyAudio.volume = video.volume;
      proxyAudio.muted = video.muted;
      proxyAudio.playbackRate = video.playbackRate;
      proxyAudio.currentTime = clampMediaTime(proxyAudio, target);
    }
    void media
      .play()
      .then(() => {
        if (scratchPreviewGenerationRef.current !== generation || scratchPreviewTimeRef.current === null) return;
        scratchPreviewTimerRef.current = window.setTimeout(() => {
          if (scratchPreviewGenerationRef.current === generation) finishScratchPreview();
        }, scratchPreviewMilliseconds);
      })
      .catch(() => {
        if (scratchPreviewGenerationRef.current === generation) finishScratchPreview();
      });
  }

  /** `openSettings`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  function openSettings(tab: SettingsTab = "common") {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
    if (apiBaseUrl) void refreshWhisperStatus().catch((error) => setMessage(`Whisper status unavailable: ${String(error)}`));
  }

  /** `closeSettings`のflowまたはdialogを閉じ、編集中の一時状態を初期化する。 */
  function closeSettings() {
    const milliseconds = normalizeScratchPreviewMilliseconds(
      scratchPreviewMillisecondsInput,
      scratchPreviewMilliseconds
    );
    setScratchPreviewMilliseconds(milliseconds);
    setScratchPreviewMillisecondsInput(String(milliseconds));
    setSettingsOpen(false);
    if (milliseconds !== scratchPreviewMilliseconds) setMessage(`Scratch preview duration set to ${milliseconds} ms.`);
  }

  /** `playStartBoundary`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function playStartBoundary() {
    if (!selectedSegment) return;
    const seconds = parseBoundarySeconds(boundarySecondsInput);
    playFrom(selectedSegment.start, Math.min(selectedSegment.end, selectedSegment.start + seconds));
  }

  /** `playEndBoundary`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function playEndBoundary() {
    if (!selectedSegment) return;
    const seconds = parseBoundarySeconds(boundarySecondsInput);
    playFrom(Math.max(selectedSegment.start, selectedSegment.end - seconds), selectedSegment.end);
  }

  /** `jumpBoundary`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
  function jumpBoundary(direction: -1 | 1) {
    const boundaries = segments.flatMap((segment) => [segment.start, segment.end]).sort((a, b) => a - b);
    const target =
      direction < 0
        ? [...boundaries].reverse().find((time) => time < currentTime - 0.05)
        : boundaries.find((time) => time > currentTime + 0.05);
    if (target !== undefined) seek(target);
  }

  /** `nudgeNearestBoundary`で指定された変更を不変更新として状態へ反映する。 */
  function nudgeNearestBoundary(direction: -1 | 1) {
    const target = nearestBoundaryTarget(segments, currentTime, selectedSegment?.id);
    if (!target) return;
    const segment = segments.find((item) => item.id === target.segmentId);
    if (!segment) return;

    const seconds = parseBoundaryNudgeSeconds(boundaryNudgeSecondsInput);
    const maxDuration = Math.max(duration || 0, segment.end);
    const nextTime = nudgeBoundaryTime(
      segment,
      target.edge,
      direction,
      createCutBoundaryPolicy("nudge", { nudgeStep: seconds }),
      { previousEnd: 0, nextStart: maxDuration },
    );
    if (nextTime === null) return;

    setSelectedSegmentId(segment.id);
    const patch = target.edge === "start"
      ? { start: nextTime, user_edited: true }
      : { end: nextTime, user_edited: true };
    const nextSegment = { ...segment, ...patch };
    updateSegment(segment.id, patch);
    const playbackRange = boundaryNudgePlaybackRange(nextSegment, target.edge, seconds);
    playFrom(playbackRange.start, playbackRange.stopAt);
  }

  const cutCapabilities = {
    hasSegments: segments.length > 0,
    hasSelectedSegment: Boolean(selectedSegmentId && segments.some((segment) => segment.id === selectedSegmentId)),
    hasMultipleSegments: segments.length > 1,
    canAddSegment: Boolean(projectBase),
    canDeleteSelectedSegment: Boolean(selectedSegmentId && segments.some((segment) => segment.id === selectedSegmentId)),
    canSelectPreviousSegment,
    canSelectNextSegment,
    canJumpBoundary: segments.length > 0,
    canPlayBoundary: Boolean(selectedSegment && videoUrl),
    canNudgeBoundary: Boolean(segments.length && videoUrl),
  };
  const subCapabilities = {
    hasSegments: subtitleSegmentCount > 0,
    hasSelectedSegment: selectedSubtitleIndex >= 0,
    hasMultipleSegments: subtitleSegmentCount > 1,
    canAddSegment: Boolean(
      activeSubtitleLane && addFourBeatSegment(activeSubtitleLane, subtitleState.selected_segment_id, subtitleState.rhythm_grid)
    ),
    canDeleteSelectedSegment: Boolean(selectedSubtitleSegment()),
    canSelectPreviousSegment: selectedSubtitleIndex > 0,
    canSelectNextSegment:
      selectedSubtitleIndex >= 0 && selectedSubtitleIndex < activeSubtitleSegments.length - 1,
    canJumpBoundary: subtitleSegmentCount > 0,
    canPlayBoundary: Boolean(selectedSubtitleSegment() && videoUrl),
    canNudgeBoundary: Boolean(selectedSubtitleSegment() && subtitleState.rhythm_grid.length),
  };
  const commonMedia = {
    sourceAvailable,
    videoInfo,
    waveform: progressiveWaveform.waveform,
    progressiveWaveformChunks: progressiveWaveform.chunks,
    waveformPhase: progressiveWaveform.phase,
    waveformProgress: progressiveWaveform.progress,
    waveformDisplayMode,
    duration,
    currentTime,
    playing,
    zoom,
    editing: waveformSeeking || handleEditing,
    onSeek: seek,
    onScrub: scratchPreview,
    onSeekingChange: setWaveformSeeking,
    onHandleEditingChange: setHandleEditing,
  };
  const saveStatus = projectReadOnly ? tr("app.readOnly") : projectSaveStatusLabel(persistence.status);
  const commonTransport = {
    saveStatus,
    boundaryPreview: {
      value: boundarySecondsInput,
      onChange: (value: string) => setBoundarySecondsInput(normalizeBoundarySecondsInput(value)),
      onBlur: () => setBoundarySecondsInput(formatBoundarySeconds(parseBoundarySeconds(boundarySecondsInput))),
    },
    playback: {
      onStart: () => seek(0),
      onPlay: playVideo,
      onPause: pauseVideo,
    },
    zoom: {
      value: zoom,
      onIn: () => setZoomIndex((value) => clamp(value + 1, 0, zoomLevels.length - 1)),
      onOut: () => setZoomIndex((value) => clamp(value - 1, 0, zoomLevels.length - 1)),
      onReset: () => setZoomIndex(0),
    },
  };
  const cutModeSession = createModeSession<Segment, undefined, typeof cutOperations>({
    mode: "cut",
    capabilities: cutCapabilities,
    actions: {
      select: selectSegment,
      add: addNewSegment,
      remove: requestRemoveSelectedSegment,
      selectAdjacent: selectAdjacentSegment,
      jumpBoundary,
      playBoundary: (edge) => (edge === "start" ? playStartBoundary() : playEndBoundary()),
      nudge: nudgeNearestBoundary,
    },
    operations: cutOperations,
    media: { ...commonMedia, focusRequest: segmentFocusRequest },
    transport: {
      ...commonTransport,
      saveStatusClassName: `status-${persistence.status}`,
      boundaryPreview: {
        ...commonTransport.boundaryPreview,
        disabled: !cutCapabilities.canPlayBoundary,
        onStart: playStartBoundary,
        onEnd: playEndBoundary,
      },
      boundaryNudge: {
        kind: "seconds",
        disabled: !cutCapabilities.canNudgeBoundary,
        value: boundaryNudgeSecondsInput,
        onChange: setBoundaryNudgeSecondsInput,
        onBlur: () =>
          setBoundaryNudgeSecondsInput(formatBoundaryNudgeSeconds(parseBoundaryNudgeSeconds(boundaryNudgeSecondsInput))),
        onLeft: () => nudgeNearestBoundary(-1),
        onRight: () => nudgeNearestBoundary(1),
      },
      playback: {
        ...commonTransport.playback,
        onPrevious: () => jumpBoundary(-1),
        onNext: () => jumpBoundary(1),
      },
    },
  });
  const subModeSession = createModeSession<LyricsSegment, string, typeof subOperations>({
    mode: "sub",
    capabilities: subCapabilities,
    actions: {
      select: (segment, laneId) => {
        const targetLaneId = laneId ?? activeSubtitleLane?.id;
        if (targetLaneId) selectSubtitleSegment(targetLaneId, segment);
      },
      add: addNewSubtitleSegment,
      remove: removeSelectedSubtitleSegment,
      selectAdjacent: selectAdjacentSubtitleSegment,
      jumpBoundary: jumpSubtitleBoundary,
      playBoundary: playSubtitleBoundary,
      nudge: nudgeSelectedSubtitleBoundary,
    },
    operations: subOperations,
    media: { ...commonMedia, focusRequest: subtitleFocusRequest },
    transport: {
      ...commonTransport,
      boundaryPreview: {
        ...commonTransport.boundaryPreview,
        disabled: !subCapabilities.canPlayBoundary,
        onStart: () => playSubtitleBoundary("start"),
        onEnd: () => playSubtitleBoundary("end"),
      },
      boundaryNudge: {
        kind: "rhythm-grid",
        disabled: !subCapabilities.canNudgeBoundary,
        onLeft: () => nudgeSelectedSubtitleBoundary(-1),
        onRight: () => nudgeSelectedSubtitleBoundary(1),
      },
      playback: {
        ...commonTransport.playback,
        onPrevious: () => jumpSubtitleBoundary(-1),
        onNext: () => jumpSubtitleBoundary(1),
      },
    },
  });
  /** `prepareSubAnalysis`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function prepareSubAnalysis() {
    await ensureDemucs();
    setDemucsDownloadOpen(false);
    await ensureWhisper();
    setWhisperDownloadOpen(false);
    if (whisperSettings.lyricsAlignmentAlgorithm === "songcut-standard") {
      await ensureMms();
      setMmsDownloadOpen(false);
    }
  }

  /** `requestSubtitleExport`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function requestSubtitleExport() {
    if (!videoInfo) return false;
    const outputDir = await window.songcut.selectOutputDirectory();
    if (!outputDir) return false;
    void subModeSession.operations.exportSubtitles(
      outputDir,
      videoInfo.video.width || 1920,
      videoInfo.video.height || 1080,
    );
    return true;
  }
  const activeModeController = mode === "cut" ? cutModeSession.controller : subModeSession.controller;

  /** `runEditorCommand`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  function runEditorCommand(action: EditorAction) {
    executeEditorAction(action, {
      execute(resolved) {
        switch (resolved.type) {
          case "nudge-boundary-left":
            activeModeController.actions.nudge(-1);
            break;
          case "nudge-boundary-right":
            activeModeController.actions.nudge(1);
            break;
          case "previous-segment":
            activeModeController.actions.selectAdjacent(-1);
            break;
          case "next-segment":
            activeModeController.actions.selectAdjacent(1);
            break;
          case "new-segment":
            activeModeController.actions.add();
            break;
          case "remove-segment":
            activeModeController.actions.remove();
            break;
          case "remove-unchecked-segments":
            requestRemoveUncheckedSegments();
            break;
          case "sort-segments":
            requestSortSegments();
            break;
          case "check-all-segments":
            checkAllSegments();
            break;
          case "uncheck-all-segments":
            uncheckAllSegments();
            break;
          case "invert-segment-selection":
            invertExportSelection();
            break;
          case "zoom-in":
            setZoomIndex((value) => clamp(value + 1, 0, zoomLevels.length - 1));
            break;
          case "zoom-out":
            setZoomIndex((value) => clamp(value - 1, 0, zoomLevels.length - 1));
            break;
          case "reset-zoom":
            setZoomIndex(0);
            break;
          case "set-zoom":
            setZoomIndex(clamp(resolved.zoomIndex, 0, zoomLevels.length - 1));
            break;
          case "start":
            seek(0);
            break;
          case "previous-boundary":
            activeModeController.actions.jumpBoundary(-1);
            break;
          case "play":
            playVideo();
            break;
          case "pause":
            pauseVideo();
            break;
          case "next-boundary":
            activeModeController.actions.jumpBoundary(1);
            break;
          case "play-start-boundary":
            activeModeController.actions.playBoundary("start");
            break;
          case "play-end-boundary":
            activeModeController.actions.playBoundary("end");
            break;
          case "toggle-playback": {
            const video = videoRef.current;
            if (!video) break;
            if (video.paused) playVideo();
            else pauseVideo();
            break;
          }
          case "export-movie":
            if (checkedCount > 0) openOutputReview();
            break;
          case "export-timestamp":
            void exportTimestampText(resolved.format);
            break;
          case "show-boundary-refinement-details":
            if (selectedBoundaryDiagnostic) setBoundaryDiagnosticOpen(true);
            break;
        }
      },
    });
  }

  /** `onDrop`のUI eventを受け取り、対象fileまたは編集状態へ反映する。 */
  function onDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setDropActive(false);
    const files = [...event.dataTransfer.files];
    const projectFile = files.find((file) => extensionOf(file.name) === ".songcut");
    if (projectFile) {
      const filePath = window.songcut.pathForFile(projectFile);
      if (!filePath) {
        setMessage("Could not read the dropped project path.");
        return;
      }
      void (async () => {
        await loadProjectPath(filePath);
      })().catch((error) => setMessage(String(error)));
      return;
    }
    const videoFile = files.find((file) => videoExtensions.has(extensionOf(file.name)));
    if (!videoFile) {
      setMessage("Drop a video or .songcut project file.");
      return;
    }
    const filePath = window.songcut.pathForFile(videoFile);
    if (!filePath) {
      setMessage("Could not read the dropped file path.");
      return;
    }
    loadVideo(filePath).catch((error) => setMessage(String(error)));
  }

  useEffect(() => {
    window.songcut.updateMenuState({
      apiReady: Boolean(apiBaseUrl),
      hasProject: Boolean(projectBase),
      hasVideo: Boolean(videoUrl),
      hasSegments: activeModeController.capabilities.hasSegments,
      hasSelectedSegment: activeModeController.capabilities.hasSelectedSegment,
      hasBoundaryDiagnostic: mode === "cut" && Boolean(selectedBoundaryDiagnostic),
      hasCheckedSegments: mode === "cut" && checkedCount > 0,
      hasUncheckedSegments: mode === "cut" && uncheckedCount > 0,
      hasMultipleSegments: activeModeController.capabilities.hasMultipleSegments,
      canSelectPreviousSegment: activeModeController.capabilities.canSelectPreviousSegment,
      canSelectNextSegment: activeModeController.capabilities.canSelectNextSegment,
      playing,
      zoomIndex,
      waveformDisplayMode,
      scratchAudioProxyEnabled,
      analysisDevice,
      whisperDevice: whisperSettings.device,
      whisperModel: whisperSettings.model
    });
  }, [
    apiBaseUrl,
    projectBase,
    videoUrl,
    segments.length,
    selectedSegment?.id,
    selectedBoundaryDiagnostic,
    selectedSegmentId,
    checkedCount,
    uncheckedCount,
    canSelectPreviousSegment,
    canSelectNextSegment,
    playing,
    zoomIndex,
    waveformDisplayMode,
    scratchAudioProxyEnabled,
    analysisDevice,
    whisperSettings.device,
    whisperSettings.model,
    mode,
    subtitleState,
    subtitleSegmentCount,
    selectedSubtitleIndex,
    activeSubtitleSegments.length
  ]);

  useEffect(() => {
    return window.songcut.onMenuCommand((command) => {
      const editorAction = editorActionFromMenuCommand(command, mode);
      if (editorAction) {
        runEditorCommand(editorAction);
        return;
      }
      switch (command.type) {
        case "load-movie":
          void selectVideo();
          break;
        case "open-project":
          void openProject().catch((error) => setMessage(String(error)));
          break;
        case "save-project":
          void persistence.flush().catch((error) => setMessage(String(error)));
          break;
        case "relink-source":
          void relinkSource().catch((error) => setMessage(String(error)));
          break;
        case "open-settings":
          openSettings();
          break;
      }
    });
  }, [
    apiBaseUrl,
    videoUrl,
    selectedSegment?.id,
    selectedSegmentId,
    segments,
    exportCandidates,
    checkedCount,
    uncheckedCount,
    currentTime,
    duration,
    filenameTemplate,
    boundarySecondsInput,
    boundaryNudgeSecondsInput,
    zoomIndex,
    whisperSettings,
    projectPath,
    projectBase,
    projectReadOnly,
    projectOperation,
    transcriptSegment?.id
    ,
    mode,
    subtitleState
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveEditorShortcut(event);
      if (!action || isEditorShortcutSuppressed(event)) return;
      event.preventDefault();
      const editorAction = editorActionFromMenuCommand(action, mode);
      if (editorAction) runEditorCommand(editorAction);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    boundaryNudgeSecondsInput,
    boundarySecondsInput,
    currentTime,
    duration,
    segments,
    selectedSegment,
    mode,
    subtitleState,
  ]);

  return (
    <EditorFocusProvider rootRef={editorRootRef}>
      <main
        ref={editorRootRef}
        tabIndex={-1}
        data-editor-focus-root
        className={dropActive ? "app drop-active" : "app"}
        style={{ "--video-split": `${split}%` } as React.CSSProperties}
        onDragOver={(event) => {
          event.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={onDrop}
      >
      <audio ref={scratchProxyAudioRef} preload="auto" hidden data-scratch-proxy-state={scratchProxyState} />
      <section className="video-pane">
        <Tabs
          value={mode}
          onValueChange={(value) => switchMode(value as AppMode)}
          className="mode-tabs"
        >
          <TabsList>
            <TabsTrigger value="cut" disabled={Boolean(runningJob) || persistence.saving}>Cut</TabsTrigger>
            <TabsTrigger value="sub" disabled={Boolean(runningJob) || persistence.saving || !videoPath}>Sub</TabsTrigger>
          </TabsList>
        </Tabs>
        {videoUrl ? (
          <video ref={videoRef} src={videoUrl} className="video" controls={false} />
        ) : (
          <div className="empty-video">
            <FileVideo2 size={42} />
            <Button onClick={selectVideo}>
              <FolderOpen size={16} />
              {tr("common.load")}
            </Button>
          </div>
        )}
        {mode === "sub" ? (
          <SubtitleOverlay
            state={subtitleState}
            currentTime={currentTime}
            videoWidth={videoInfo?.video.width || 1920}
            videoHeight={videoInfo?.video.height || 1080}
          />
        ) : null}
      </section>
      <div
        className="splitter"
        onPointerDown={(event) => {
          const startY = event.clientY;
          const startSplit = split;
          const move = (moveEvent: PointerEvent) => {
            const delta = ((moveEvent.clientY - startY) / window.innerHeight) * 100;
            setSplit(clamp(startSplit + delta, MIN_VIDEO_SPLIT_PERCENT, MAX_VIDEO_SPLIT_PERCENT));
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <section className="control-pane">
        {!sourceAvailable && projectBase ? (
          <div className="source-missing-banner">
            <span>{tr("app.sourceMissingBanner")}</span>
            <Button size="sm" variant="secondary" onClick={() => void relinkSource().catch((error) => setMessage(String(error)))}>
              {tr("app.relink")}
            </Button>
          </div>
        ) : null}
        {mode === "cut" ? (
          <CutModePanel
            view={cutModeSession.view}
            apiReady={Boolean(apiBaseUrl)}
            checkedCount={checkedCount}
            onLoad={selectVideo}
            onAnalyze={() => void analyze().catch((error) => setMessage(String(error)))}
            onExport={openOutputReview}
            onExportTimestamp={() => setTimestampExportOpen(true)}
            onSettings={() => openSettings("cut")}
            guideText={guideText}
            onGuideTextChange={(value) => {
              setGuideText(value);
              markProjectChanged();
            }}
            taskStatus={taskStatus}
            timeline={{
              segments,
              selectedSegment,
              waveformAmplitudeProfile: cutWaveformAmplitudeProfile,
              onBoundaryPreview: (edge, time) => {
                if (!selectedSegment) return;
                const resolved = resolveBoundaryTime(
                  selectedSegment,
                  edge,
                  time,
                  cutDragBoundaryPolicy,
                  { previousEnd: 0, nextStart: Math.max(0.001, duration) },
                );
                if (resolved !== null) {
                  previewSegmentUpdate(selectedSegment.id, { [edge]: resolved, user_edited: true });
                }
              },
              onChangeCommitted: markProjectChanged,
              onEditTiming: () => selectedSegment && setCutTimingSegmentId(selectedSegment.id),
            }}
            segments={{
              segments,
              selectedId: selectedSegment?.id ?? null,
              onSelect: cutModeSession.controller.actions.select,
              onToggle: (segment, checked) => updateSegment(segment.id, { checked }),
              onTitleChange: (segment, title) => updateSegment(segment.id, { title }),
              onTranscript: setTranscriptSegment,
              titleForSegment: segmentTitle,
            }}
          />
        ) : (
          <SubModePanel
            view={subModeSession.view}
            state={subtitleState}
            capabilities={{
              canAddSegment: subModeSession.controller.capabilities.canAddSegment,
              canDeleteSelectedSegment: subModeSession.controller.capabilities.canDeleteSelectedSegment,
            }}
            operation={{
              analysisJob: subModeSession.operations.analysisJob,
              exportJob: subModeSession.operations.exportJob,
              busy: subModeSession.operations.busy,
            }}
            actions={{
              load: selectVideo,
              openSettings: () => openSettings("sub"),
              prepareAnalysis: prepareSubAnalysis,
              analyzeLyrics: subModeSession.operations.analyzeLyrics,
              exportSubtitles: requestSubtitleExport,
              renderSubtitles: subModeSession.operations.renderSubtitles,
              invalidateSubtitleRender: subModeSession.operations.invalidateSubtitleRender,
              listSystemFonts,
              confirmRemoveLane: () => window.confirm(tr("sub.removeLaneConfirm")),
              selectSegment: (laneId, segment) => subModeSession.controller.actions.select(segment, laneId),
              addSegment: subModeSession.controller.actions.add,
              removeSelectedSegment: subModeSession.controller.actions.remove,
              showMessage: setMessage,
            }}
            taskStatus={taskStatus}
            onStateChange={(state) => {
              setSubtitleState(state);
              markProjectChanged();
            }}
            onBoundaryPreview={(laneId, segmentId, edge, time) => {
              setSubtitleState((current) => ({
                ...current,
                lanes: current.lanes.map((lane) =>
                  lane.id === laneId
                    ? updateSegmentBoundary(lane, segmentId, edge, time, current.rhythm_grid)
                    : lane
                ),
              }));
            }}
            onBoundaryCancel={(laneId, segmentId, startSegment) => {
              setSubtitleState((current) => ({
                ...current,
                lanes: current.lanes.map((lane) =>
                  lane.id === laneId
                    ? {
                        ...lane,
                        segments: lane.segments.map((segment) =>
                          segment.id === segmentId ? startSegment : segment
                        ),
                      }
                    : lane
                ),
              }));
            }}
            onBoundaryCommit={markProjectChanged}
          />
        )}
      </section>
      <Dialog
        open={Boolean(visibleTranscriptSegment)}
        title={visibleTranscriptSegment ? segmentDialogTitle(visibleTranscriptSegment) : ""}
        onClose={() => setTranscriptSegment(null)}
      >
        {visibleTranscriptSegment?.transcript ? (
          <div className="transcript-run-meta">
            <span>{tr("app.model")}: {visibleTranscriptSegment.transcript.model_id}</span>
            <span>
              {tr("app.language")}: {visibleTranscriptSegment.transcript.language_requested ?? tr("common.unknown")} → {visibleTranscriptSegment.transcript.language ?? tr("common.unknown")}
            </span>
            <span>
              {tr("app.device")}: {visibleTranscriptSegment.transcript.device_requested ?? tr("common.unknown")} → {visibleTranscriptSegment.transcript.device_used}
            </span>
          </div>
        ) : null}
        <pre className="transcript-text">
          {visibleTranscriptSegment?.transcript?.text || tr("app.transcriptMissing")}
        </pre>
        {visibleTranscriptSegment?.transcript?.error ? (
          <p className="transcript-error">{tr("app.transcriptFailed", { error: visibleTranscriptSegment.transcript.error })}</p>
        ) : null}
      </Dialog>
      <TimestampCommentDialogs
        flow={timestampCommentFlow}
        onClose={() => setTimestampCommentFlow(closeTimestampCommentFlow())}
        onSelect={(id) => setTimestampCommentFlow((current) => selectTimestampCommentCandidate(current, id))}
        onEditSelected={() => setTimestampCommentFlow((current) => editSelectedTimestampComment(current))}
        onDraftChange={(draft) => setTimestampCommentFlow((current) => updateTimestampCommentDraft(current, draft))}
        onBack={() => setTimestampCommentFlow((current) => backToTimestampCommentSelection(current))}
        onApply={() => {
          setGuideText((current) => applyTimestampCommentToGuide(timestampCommentFlow, current));
          markProjectChanged();
          setTimestampCommentFlow(closeTimestampCommentFlow());
        }}
      />
      <OutputDialog
        open={outputOpen}
        items={outputPlan.items}
        estimate={videoInfo?.smart_render_estimate ?? null}
        renderPlanState={exportPlanState}
        error={localizeFilenameTemplateError(outputPlan.error)}
        filenameTemplate={filenameTemplate}
        createSourceFolder={createSourceFolder}
        sourceFolderName={videoInfo ? filenameWithoutExtension(videoInfo.name) : "video"}
        onClose={() => setOutputOpen(false)}
        onPreview={(item) => previewRange(videoRef.current, item.start, item.end)}
        onFilenameTemplate={updateFilenameTemplate}
        onCreateSourceFolder={setCreateSourceFolder}
        onCheckRenderDetails={checkExportRenderDetails}
        onExport={async () => {
          const dir = await window.songcut.selectOutputDirectory();
          if (dir) await exportClips(dir, createSourceFolder);
        }}
      />
      <SegmentManagementDialog
        review={segmentManagementReview}
        canPreview={sourceAvailable}
        onClose={() => setSegmentManagementReview(null)}
        onPreview={(item) => previewRange(videoRef.current, item.start, item.end)}
        onConfirm={confirmSegmentManagement}
      />
      <Dialog open={timestampExportOpen} title={tr("app.exportTsTitle")} onClose={() => setTimestampExportOpen(false)}>
        <p className="dialog-message">{tr("timestampExport.choose")}</p>
        <div className="timestamp-export-options">
          {timestampExportFormats.map((format) => (
            <Button key={format} variant="secondary" onClick={() => void exportTimestampText(format)}>
              {tr(`timestampExport.${format}`)}
            </Button>
          ))}
        </div>
        <div className="dialog-actions">
          <span />
          <Button variant="secondary" onClick={() => setTimestampExportOpen(false)}>{tr("common.cancel")}</Button>
        </div>
      </Dialog>
      <Dialog open={timestampCopyCount !== null} title={tr("app.exportTsTitle")} onClose={() => setTimestampCopyCount(null)}>
        <p className="dialog-message">
          {tr("app.copiedLines", { count: timestampCopyCount ?? 0 })}
        </p>
        <div className="dialog-actions">
          <Button onClick={() => setTimestampCopyCount(null)}>{tr("common.ok")}</Button>
        </div>
      </Dialog>
      <FfmpegCheckDialog
        open={ffmpegCheckOpen}
        pending={ffmpegCheckPending}
        result={ffmpegCheckResult}
        onClose={() => setFfmpegCheckOpen(false)}
      />
      <CutSegmentTimingDialog
        segment={cutTimingSegment}
        mediaDuration={duration}
        onClose={() => setCutTimingSegmentId(null)}
        onApply={(segmentId, patch, start) => {
          updateSegment(segmentId, patch);
          setCutTimingSegmentId(null);
          seek(start);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        initialTab={settingsInitialTab}
        apiReady={Boolean(apiBaseUrl)}
        scratchPreviewMillisecondsInput={scratchPreviewMillisecondsInput}
        scratchAudioProxyEnabled={scratchAudioProxyEnabled}
        waveformDisplayModes={waveformDisplayModes}
        cutWaveformAmplitudeProfile={cutWaveformAmplitudeProfile}
        analysisDevice={analysisDevice}
        boundaryRefinementSettings={boundaryRefinementSettings}
        filenameTemplate={filenameTemplate}
        filenameTemplateError={localizeFilenameTemplateError(outputPlan.error)}
        whisperSettings={whisperSettings}
        whisperStatus={whisperStatus}
        whisperBusy={whisperBusy}
        demucsStatus={demucsStatus}
        demucsBusy={whisperBusy}
        mmsStatus={mmsStatus}
        mmsBusy={whisperBusy}
        hasSegments={segments.length > 0}
        transcriptStale={transcriptStale}
        sourceAvailable={sourceAvailable}
        localePreference={localePreference}
        localeRestartRequired={localeRestartRequired}
        onClose={closeSettings}
        onScratchPreviewMillisecondsInput={setScratchPreviewMillisecondsInput}
        onScratchAudioProxyEnabled={(enabled) => {
          setScratchAudioProxyEnabled(enabled);
          setMessage(tr(enabled ? "app.proxyEnabled" : "app.proxyDisabled"));
        }}
        onWaveformDisplayMode={(appMode, displayMode) => {
          setWaveformDisplayModes((current) => ({ ...current, [appMode]: displayMode }));
          setMessage(
            tr("app.waveformSet", {
              appMode: appMode === "sub" ? "Sub" : "Cut",
              mode: waveformDisplayModeLabel(displayMode),
            })
          );
        }}
        onCutWaveformAmplitudeProfile={(profile) => {
          setCutWaveformAmplitudeProfile(profile);
          setMessage(
            tr("app.waveformAmplitudeSet", {
              profile: tr(
                profile === "singing-mc-contrast"
                  ? "settings.waveformAmplitudeSingingMc"
                  : "settings.waveformAmplitudeStandard"
              ),
            })
          );
        }}
        onAnalysisDevice={(device) => {
          setAnalysisDevice(device);
          markProjectChanged();
          setMessage(tr("app.analysisDeviceSet", { device: deviceLabel(device) }));
        }}
        onBoundaryRefinementSettings={(settings) => {
          const normalized = normalizeBoundaryRefinementSettings(settings);
          setBoundaryRefinementSettings(normalized);
          writeBoundaryRefinementSettings(normalized);
        }}
        onFilenameTemplate={updateFilenameTemplate}
        onWhisperSettings={(settings) => {
          setWhisperSettings(settings);
          markProjectChanged();
        }}
        onPrepareWhisperModel={() => {
          closeSettings();
          void ensureWhisper({ showReadyState: true }).catch((error) => setMessage(String(error)));
        }}
        onPrepareDemucsModel={() => {
          closeSettings();
          void ensureDemucs({ showReadyState: true }).catch((error) => setMessage(String(error)));
        }}
        onPrepareMmsModel={() => {
          closeSettings();
          void ensureMms({ showReadyState: true }).catch((error) => setMessage(String(error)));
        }}
        onTranscribe={() => {
          closeSettings();
          void runTranscription().catch((error) => setMessage(String(error)));
        }}
        onFfmpegCheck={() => {
          closeSettings();
          void runFfmpegCheck(true);
        }}
        onLocalePreference={(preference) => {
          const previousPreference = localePreference;
          setLocalePreference(preference);
          void window.songcut.setLocalePreference(preference).then((result) => {
            setLocalePreference(result.preference);
            setLocaleRestartRequired(result.restartRequired);
          }).catch((error) => {
            setLocalePreference(previousPreference);
            setMessage(localizedError(error));
          });
        }}
      />
      <BoundaryRefinementDialog
        open={boundaryDiagnosticOpen}
        segment={selectedSegment}
        diagnostic={selectedBoundaryDiagnostic}
        summary={analysis?.boundary_refinement ?? null}
        onClose={() => setBoundaryDiagnosticOpen(false)}
      />
      <ExportProgressDialog
        open={exportProgressOpen}
        job={exportJob}
        estimate={videoInfo?.smart_render_estimate ?? null}
        renderPlanState={exportPlanState}
        onClose={() => setExportProgressOpen(false)}
      />
      <WhisperDownloadProgressDialog
        open={whisperDownloadOpen}
        job={taskRegistry.tasks["download-whisper"] ?? null}
        onClose={() => setWhisperDownloadOpen(false)}
      />
      <ModelDownloadProgressDialog
        open={demucsDownloadOpen}
        job={taskRegistry.tasks["download-demucs"] ?? null}
        title={tr("dialogs.demucsDownloadTitle")}
        description={tr("dialogs.demucsDownloadDescription")}
        preparing={tr("dialogs.demucsDownloadPreparing")}
        failed={tr("dialogs.demucsDownloadFailed")}
        complete={tr("dialogs.demucsDownloadComplete")}
        onClose={() => setDemucsDownloadOpen(false)}
      />
      <ModelDownloadProgressDialog
        open={mmsDownloadOpen}
        job={taskRegistry.tasks["download-mms"] ?? null}
        title={tr("dialogs.mmsDownloadTitle")}
        description={tr("dialogs.mmsDownloadDescription")}
        preparing={tr("dialogs.mmsDownloadPreparing")}
        failed={tr("dialogs.mmsDownloadFailed")}
        complete={tr("dialogs.mmsDownloadComplete")}
        onClose={() => setMmsDownloadOpen(false)}
      />
      <Dialog open={whisperPreflightOpen} title={tr("dialogs.whisperNotReady")} onClose={() => setWhisperPreflightOpen(false)}>
        <p className="dialog-message">
          {tr("dialogs.whisperMissing", { model: whisperSettings.model })}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setWhisperPreflightOpen(false)}>
            {tr("common.cancel")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setWhisperPreflightOpen(false);
              void runAnalysis(false).catch((error) => setMessage(String(error)));
            }}
          >
            {tr("dialogs.analyzeWithout")}
          </Button>
          <Button
            onClick={() => {
              setWhisperPreflightOpen(false);
              void ensureWhisper()
                .then(() => {
                  setWhisperDownloadOpen(false);
                  return runAnalysis(true);
                })
                .catch((error) => setMessage(String(error)));
            }}
          >
            {tr("dialogs.downloadAnalyze")}
          </Button>
        </div>
      </Dialog>
      <Dialog open={recoveryOpen} title={tr("dialogs.recoveryTitle")} onClose={() => undefined}>
        <p className="dialog-message">
          {recoveryCandidate
            ? tr("dialogs.recoveryDetail", { filename: recoveryCandidate.document.source.filename, date: new Date(recoveryCandidate.saved_at).toLocaleString(currentUiLanguage() === "ja" ? "ja-JP" : "en-US"), revision: recoveryCandidate.document.revision })
            : tr("dialogs.recoveryAvailable")}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => void discardRecovery().catch((error) => setMessage(String(error)))}>
            {tr("common.discard")}
          </Button>
          <Button onClick={() => void recoverProject().catch((error) => setMessage(localizedError(error)))}>{tr("common.recover")}</Button>
        </div>
      </Dialog>
      <Dialog open={Boolean(switchSaveFailure)} title={tr("dialogs.saveFailedTitle")} onClose={() => setSwitchSaveFailure(null)}>
        <p className="dialog-message">
          {switchSaveFailure
            ? `${switchSaveFailure.error} ${
                switchSaveFailure.recoverySaved
                  ? tr("dialogs.recoveryWouldReplace")
                  : tr("dialogs.recoveryUpdateFailed")
              }`
            : tr("dialogs.saveFailed")}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setSwitchSaveFailure(null)}>
            {tr("common.cancel")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const target = switchSaveFailure?.target;
              setSwitchSaveFailure(null);
              if (!target) return;
              const retry = target.kind === "video" ? loadVideo(target.path) : loadProjectPath(target.path);
              void retry.catch((error) => setMessage(String(error)));
            }}
          >
            {tr("common.retry")}
          </Button>
          <Button
            onClick={() => {
              const target = switchSaveFailure?.target;
              setSwitchSaveFailure(null);
              void persistence.clearRecovery().finally(() => {
                if (!target) return;
                const discard =
                  target.kind === "video" ? loadVideo(target.path, true) : loadProjectPath(target.path, true);
                void discard.catch((error) => setMessage(String(error)));
              });
            }}
          >
            {tr("dialogs.discardChanges")}
          </Button>
        </div>
      </Dialog>
      <Dialog open={Boolean(relinkConflict)} title={tr("dialogs.relinkConflictTitle")} onClose={() => setRelinkConflict(null)}>
        <p className="dialog-message">
          {relinkConflict?.damaged
            ? tr("dialogs.relinkDamaged")
            : tr("dialogs.relinkExists")}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setRelinkConflict(null)}>
            {tr("common.cancel")}
          </Button>
          {!relinkConflict?.damaged && relinkConflict?.existing ? (
            <Button
              variant="secondary"
              onClick={() => {
                const conflict = relinkConflict;
                setRelinkConflict(null);
                void hydrateProject(conflict.existing!.projectPath, conflict.existing!.document).catch((error) =>
                  setMessage(String(error))
                );
              }}
            >
              {tr("dialogs.openExisting")}
            </Button>
          ) : null}
          <Button
            onClick={() => {
              const conflict = relinkConflict;
              if (!conflict) return;
              void completeRelink(conflict, conflict.damaged).catch((error) => setMessage(String(error)));
            }}
          >
            {tr(relinkConflict?.damaged ? "dialogs.archiveReplace" : "dialogs.replaceCurrent")}
          </Button>
        </div>
      </Dialog>
      <Dialog open={quitConfirmOpen} title={tr("dialogs.quitTitle")} onClose={cancelQuit}>
        <p className="dialog-message">
          {runningJob
            ? tr("dialogs.taskRunningNamed", { task: jobKindLabel(runningJob.kind) })
            : tr("dialogs.taskRunning")}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={cancelQuit}>
            {tr("common.cancel")}
          </Button>
          <Button onClick={() => void confirmQuit()}>{tr("dialogs.quitAnyway")}</Button>
        </div>
      </Dialog>
      </main>
    </EditorFocusProvider>
  );
}

/** `isProjectOperationKind`の入力が要求された条件やschemaを満たすか検証する。 */
function isProjectOperationKind(kind: string | undefined): kind is NonNullable<ProjectOperation>["kind"] {
  switch (kind) {
    case "analysis":
    case "transcription":
    case "export":
    case "lyrics-analysis":
    case "subtitle-export":
      return true;
    default:
      return false;
  }
}

/** `offlineVideoInfo`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function offlineVideoInfo(document: ProjectDocumentV1): VideoInfo {
  return {
    path: document.source.absolute_path,
    name: document.source.filename,
    format_name: "",
    duration: document.source.duration_seconds,
    bit_rate: 0,
    video: {},
    audio: {},
    timestamp_comment_candidates: [],
    info_json_warning: "Source media is missing.",
    smart_render_estimate: null
  };
}

/** `isProjectNotFoundError`の入力が要求された条件やschemaを満たすか検証する。 */
function isProjectNotFoundError(error: unknown) {
  return String(error).includes("Project not found:");
}

/** `sameWindowsPath`の入力が要求された条件やschemaを満たすか検証する。 */
function sameWindowsPath(left: string, right: string) {
  return left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
}

/** `sourceDurationMatches`の二つの入力が同一対象または重複範囲を表すか判定する。 */
function sourceDurationMatches(expected: number, actual: number) {
  return Math.abs(expected - actual) <= Math.max(0.05, expected * 0.00001);
}

/** `projectSaveStatusLabel`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function projectSaveStatusLabel(status: ReturnType<typeof useProjectPersistence>["status"]) {
  switch (status) {
    case "idle":
      return tr("app.saved");
    case "saving":
      return tr("app.saving");
    case "saved":
      return tr("app.saved");
    case "recovery-only":
      return tr("app.recoveryOnly");
    case "save-failed":
      return tr("app.saveFailed");
    case "read-only":
      return tr("app.readOnly");
  }
}

/** `localizedError`の値を現在のlocaleと表示規則に沿った文字列へ整形する。 */
function localizedError(error: unknown) {
  return localizeUiMessage(String(error));
}

/** `previewRange`のmedia操作を現在の選択範囲と再生状態へ反映する。 */
function previewRange(video: HTMLVideoElement | null, start: number, end: number) {
  if (!video) return;
  const duration = Math.max(0, end - start);
  video.pause();
  video.currentTime = start;
  void video.play();
  if (duration <= 10) {
    window.setTimeout(() => video.pause(), duration * 1000);
    return;
  }
  window.setTimeout(() => {
    video.currentTime = Math.max(start, end - 5);
    void video.play();
    window.setTimeout(() => video.pause(), 5000);
  }, 5000);
}

/** `segmentStopAtForTime`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function segmentStopAtForTime(segment: Segment | null, time: number) {
  if (!segment || segment.end <= segment.start) return null;
  return time >= segment.start - 0.03 && time < segment.end - 0.03 ? segment.end : null;
}

/** `readScratchPreviewMilliseconds`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
function readScratchPreviewMilliseconds() {
  return readStoredScratchPreviewMilliseconds(window.localStorage);
}

/** `readScratchAudioProxyEnabled`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
function readScratchAudioProxyEnabled() {
  return readStoredScratchAudioProxyEnabled(window.localStorage);
}

/** `clampMediaTime`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
function clampMediaTime(media: HTMLMediaElement, time: number) {
  const maximum = Number.isFinite(media.duration) && media.duration > 0 ? Math.max(0, media.duration - 0.001) : time;
  return clamp(time, 0, maximum);
}

/** `loadScratchProxyAudio`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
async function loadScratchProxyAudio(audio: HTMLAudioElement, url: string) {
  audio.pause();
  audio.preload = "auto";
  audio.src = url;
  audio.load();
  await waitForMediaReady(audio, 10_000);
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
    throw new Error("Scratch proxy has an invalid duration.");
  }

  const warmPosition = Math.min(0.01, audio.duration / 2);
  if (warmPosition > 0) {
    const seeked = waitForMediaEvent(audio, "seeked", 5_000);
    audio.currentTime = warmPosition;
    await seeked;
    audio.currentTime = 0;
  }
}

/** `waitForMediaReady`の完了条件まで待機し、成功時の結果または失敗を返す。 */
function waitForMediaReady(media: HTMLMediaElement, timeoutMilliseconds: number) {
  if (media.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return waitForMediaEvent(media, "loadedmetadata", timeoutMilliseconds);
}

/** `waitForMediaEvent`の完了条件まで待機し、成功時の結果または失敗を返す。 */
function waitForMediaEvent(media: HTMLMediaElement, eventName: "loadedmetadata" | "seeked", timeoutMilliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      media.removeEventListener(eventName, onEvent);
      media.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(media.error?.message || "Scratch proxy audio could not be loaded."));
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for scratch proxy ${eventName}.`));
    }, timeoutMilliseconds);
    media.addEventListener(eventName, onEvent, { once: true });
    media.addEventListener("error", onError, { once: true });
  });
}

/** `readBoundarySecondsInput`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
function readBoundarySecondsInput() {
  return readStoredBoundarySecondsInput(window.localStorage);
}

/** `readBoundaryNudgeSecondsInput`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
function readBoundaryNudgeSecondsInput() {
  return readStoredBoundaryNudgeSecondsInput(window.localStorage);
}

/** `readVideoSplitPercent`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
function readVideoSplitPercent() {
  return readStoredVideoSplitPercent(window.localStorage);
}

/** `readStoredWaveformDisplayModes`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
function readStoredWaveformDisplayModes(): WaveformDisplayModes {
  try {
    const preferences = readModePreferences(window.localStorage);
    return {
      cut: preferences.cut.waveformDisplayMode,
      sub: preferences.sub.waveformDisplayMode,
    };
  } catch {
    return { ...DEFAULT_WAVEFORM_DISPLAY_MODES };
  }
}

/** `readStoredCutWaveformAmplitudeProfile`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
function readStoredCutWaveformAmplitudeProfile(): CutWaveformAmplitudeProfile {
  try {
    return readCutWaveformAmplitudeProfile(window.localStorage);
  } catch {
    return DEFAULT_CUT_WAVEFORM_AMPLITUDE_PROFILE;
  }
}

/** `readCreateSourceFolder`の対象を現在の状態または保存先から読み取り、型付きの値として返す。 */
function readCreateSourceFolder() {
  return readStoredCreateSourceFolder(window.localStorage);
}

/** `waveformDisplayModeLabel`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function waveformDisplayModeLabel(mode: WaveformDisplayMode) {
  switch (mode) {
    case "rms":
      return "RMS";
    case "peak":
      return tr("settings.peak");
    case "peak-rms":
      return tr("settings.peakRms");
    case "symmetric-peak":
      return tr("settings.symmetricPeak");
  }
}

/** `segmentTitle`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function segmentTitle(segment: Segment) {
  return segment.title?.trim() || segment.id;
}

/** `segmentDialogTitle`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function segmentDialogTitle(segment: Segment) {
  const title = segment.title?.trim();
  return title ? `${title} / ${segment.id}` : segment.id;
}

/** `safeFilenameStem`の入力を許容範囲と既定値に沿った安全な値へ正規化する。 */
function safeFilenameStem(title: string, fallback: string) {
  const value = title
    .replaceAll("/", " - ")
    .replaceAll("\\", " - ")
    .replace(/[<>:"|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return value || fallback;
}

/** `filenameStemForSegment`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function filenameStemForSegment(segment: Segment, candidate?: ExportCandidate) {
  const explicitTitle = segment.title?.trim();
  const fallback =
    candidate?.filename_stem?.trim() ||
    segment.filename_stem?.trim() ||
    `${segment.id}_${segment.start_timecode.replaceAll(":", "-")}_${segment.end_timecode.replaceAll(":", "-")}`;
  if (!explicitTitle) return safeFilenameStem(fallback, segment.id);

  const base = safeFilenameStem(explicitTitle, segment.id);
  const prefix = candidate?.filename_stem?.match(/^(\d{2,})_/)?.[1];
  if (prefix && segment.id.startsWith("guide-") && !base.startsWith(`${prefix}_`)) {
    return `${prefix}_${base}`;
  }
  return base;
}

/** `extensionOf`のfilenameから小文字化した拡張子を取り出す。 */
function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** `filenameWithoutExtension`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function filenameWithoutExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim() || "video";
}

/** `deviceLabel`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function deviceLabel(device: AnalysisDevice | WhisperDevice) {
  switch (device) {
    case "auto":
      return tr("common.auto");
    case "npu":
      return "NPU";
    case "gpu":
      return "GPU";
    case "cpu":
      return "CPU";
  }
}
