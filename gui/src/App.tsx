import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  FileVideo2,
  FolderOpen,
  Minus,
  Pause,
  Play,
  Plus,
  Rewind,
  Scissors,
  Settings2,
  SkipBack,
  SkipForward,
  Wand2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { clamp, formatTime } from "@/lib/time";
import {
  ApiError,
  cancelScratchProxy,
  checkFfmpeg,
  getExportPlan,
  getWhisperStatus,
  probeVideo,
  releaseScratchProxy,
  startAnalysis,
  startExport,
  startScratchProxy,
  startTranscription,
  startWhisperDownload,
  waitForJob
} from "@/lib/api";
import type { AnalysisDevice, WhisperSettings, WhisperStatus } from "@/lib/api";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  DEFAULT_WHISPER_SETTINGS,
  analysisFromProject,
  composeProjectDocument,
  createProjectDocument,
  exportCandidatesFromProject,
  filenameTemplateFromProject,
  normalizeInterruptedOperation,
  parseProjectOpenResult,
  parseRecoverySnapshot,
  parseSourceIdentity,
  transcriptSettingsAreStale,
  waveformFromProject
} from "@/lib/project";
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
import { useTaskRegistry } from "@/lib/useTaskRegistry";
import {
  normalizeScratchAudioProxyEnabled,
  selectScratchPreviewSource,
  shouldCreateScratchProxy
} from "@/lib/scratchProxy";
import { isEditorShortcutSuppressed, resolveEditorShortcut } from "@/lib/shortcuts";
import {
  createManualSegment,
  insertSegmentPair,
  invertSegmentChecks,
  removeSegments,
  setAllSegmentsChecked,
  sortSegmentsByStart,
  type SegmentCollection,
} from "@/lib/segmentManagement";
import { nearestBoundaryTarget } from "@/lib/boundaries";
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
  buildWaveformPathSpecs,
  buildWaveformPyramid,
  normalizeWaveformDisplayMode,
  selectWaveformLevel
} from "@/lib/waveform";
import type { ScratchProxyState } from "@/lib/scratchProxy";
import type {
  AnalysisResult,
  ExportCandidate,
  ExportRenderPlan,
  ExportRenderPlanItem,
  FfmpegCheckResult,
  JobRecord,
  ScratchProxyResult,
  Segment,
  SmartRenderEstimate,
  Transcript,
  TimestampCommentCandidate,
  VideoInfo,
  WaveformDisplayMode,
  WaveformPoint
} from "@/types";
import { currentUiLanguage, localizeFilenameTemplateError, localizeJobMessage, localizeUiMessage, tr, type UiLanguage, type UiLanguagePreference } from "@/i18n";

const zoomLevels = [1, 2, 4, 8, 16, 32];
const MIN_SEGMENT_SECONDS = 0.1;
const DEFAULT_BOUNDARY_SECONDS = 5;
const DEFAULT_BOUNDARY_NUDGE_SECONDS = 0.5;
const DEFAULT_VIDEO_SPLIT_PERCENT = 35;
const MIN_VIDEO_SPLIT_PERCENT = 32;
const MAX_VIDEO_SPLIT_PERCENT = 72;
const DEFAULT_SCRATCH_PREVIEW_MILLISECONDS = 100;
const MIN_SCRATCH_PREVIEW_MILLISECONDS = 1;
const MAX_SCRATCH_PREVIEW_MILLISECONDS = 5000;
const SCRATCH_PREVIEW_STORAGE_KEY = "songcut:scratch-preview-milliseconds";
const SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY = "songcut:scratch-audio-proxy-enabled";
const BOUNDARY_SECONDS_STORAGE_KEY = "songcut:boundary-preview-seconds";
const BOUNDARY_NUDGE_SECONDS_STORAGE_KEY = "songcut:boundary-nudge-seconds";
const VIDEO_SPLIT_STORAGE_KEY = "songcut:video-split-percent";
const WAVEFORM_DISPLAY_MODE_STORAGE_KEY = "songcut:waveform-display-mode";
const CREATE_SOURCE_FOLDER_STORAGE_KEY = "songcut:create-source-folder";
const FFMPEG_DOWNLOAD_URL = "https://www.ffmpeg.org/download.html";
const videoExtensions = new Set([".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".mpg", ".mpeg"]);

type OutputItem = {
  id: string;
  segmentId: string;
  title: string;
  filename_stem: string;
  start: number;
  end: number;
  checked: boolean;
};

type ExportPlanState =
  | { status: "idle"; plan: null; error: null }
  | { status: "loading"; plan: ExportRenderPlan; error: null; completed: number; total: number; currentId: string | null }
  | { status: "ready"; plan: ExportRenderPlan; error: null }
  | { status: "error"; plan: null; error: string };

type SegmentManagementReview =
  | {
      kind: "remove";
      title: string;
      message: string;
      confirmLabel: string;
      segmentIds: string[];
      items: OutputItem[];
    }
  | {
      kind: "sort";
      title: string;
      message: string;
      before: OutputItem[];
      after: OutputItem[];
    };

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

export default function App(props: {
  initialLocaleSettings: { language: UiLanguage; preference: UiLanguagePreference };
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [boundarySecondsInput, setBoundarySecondsInput] = useState(readBoundarySecondsInput);
  const [boundaryNudgeSecondsInput, setBoundaryNudgeSecondsInput] = useState(readBoundaryNudgeSecondsInput);
  const [scratchPreviewMilliseconds, setScratchPreviewMilliseconds] = useState(readScratchPreviewMilliseconds);
  const [scratchPreviewMillisecondsInput, setScratchPreviewMillisecondsInput] = useState(
    String(DEFAULT_SCRATCH_PREVIEW_MILLISECONDS)
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scratchAudioProxyEnabled, setScratchAudioProxyEnabled] = useState(readScratchAudioProxyEnabled);
  const [scratchProxyState, setScratchProxyState] = useState<ScratchProxyState>("idle");
  const [zoomIndex, setZoomIndex] = useState(0);
  const [waveformDisplayMode, setWaveformDisplayMode] = useState<WaveformDisplayMode>(readWaveformDisplayMode);
  const [segmentFocusRequest, setSegmentFocusRequest] = useState(0);
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
  const [whisperSettings, setWhisperSettings] = useState<WhisperSettings>({ ...DEFAULT_WHISPER_SETTINGS });
  const [whisperStatus, setWhisperStatus] = useState<WhisperStatus | null>(null);
  const [whisperPreflightOpen, setWhisperPreflightOpen] = useState(false);
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

  projectBaseRef.current = projectBase;
  videoPathRef.current = videoPath;
  projectReadOnlyRef.current = projectReadOnly;
  const progressiveWaveform = useProgressiveWaveform(
    apiBaseUrl,
    (nextJob) => taskRegistry.updateTask("waveform", nextJob),
    (sourcePath) => {
      if (
        projectBaseRef.current &&
        !projectReadOnlyRef.current &&
        sameWindowsPath(sourcePath, videoPathRef.current)
      ) {
        setProjectRevision((revision) => revision + 1);
      }
    }
  );

  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === selectedSegmentId) ?? segments[0] ?? null,
    [segments, selectedSegmentId]
  );
  const selectedSegmentIndex = selectedSegment ? segments.findIndex((segment) => segment.id === selectedSegment.id) : -1;
  const canSelectPreviousSegment = selectedSegmentIndex > 0;
  const canSelectNextSegment = selectedSegmentIndex >= 0 && selectedSegmentIndex < segments.length - 1;
  const duration = videoInfo?.duration ?? analysis?.duration ?? projectBase?.source.duration_seconds ?? videoRef.current?.duration ?? 0;
  const zoom = zoomLevels[zoomIndex];
  const checkedCount = segments.filter((segment) => segment.checked !== false).length;
  const uncheckedCount = segments.length - checkedCount;
  const visibleTranscriptSegment = useMemo(
    () => (transcriptSegment ? segments.find((segment) => segment.id === transcriptSegment.id) ?? transcriptSegment : null),
    [segments, transcriptSegment]
  );
  const outputPlan = useMemo(
    () => applyFilenameTemplate(buildBaseOutputItems().filter((item) => item.checked), filenameTemplate),
    [segments, exportCandidates, filenameTemplate]
  );
  function openOutputReview() {
    setExportPlanState({ status: "idle", plan: null, error: null });
    setOutputOpen(true);
  }

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
  const activeJob = taskRegistry.activeTask;
  const runningJob = taskRegistry.blockingTask;
  const projectDocument = useMemo(
    () =>
      projectBase
        ? composeProjectDocument(projectBase, {
            revision: projectRevision,
            videoPath,
            duration,
            guideText,
            waveform: progressiveWaveform.waveform,
            analysis,
            segments,
            exportCandidates,
            analysisDevice,
            whisper: whisperSettings,
            filenameTemplate,
            selectedSegmentId,
            currentTime,
            zoomIndex,
            operation: projectOperation
          })
        : null,
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
      projectOperation
    ]
  );
  const persistence = useProjectPersistence(projectReadOnly ? "" : projectPath, projectReadOnly ? null : projectDocument);
  const transcriptStale = useMemo(
    () => segments.some((segment) => transcriptSettingsAreStale(segment, whisperSettings)),
    [segments, whisperSettings]
  );
  const selectedWhisperModel = whisperStatus?.models.find((model) => model.key === whisperSettings.model) ?? null;
  const whisperBusy = taskRegistry.runningTasks.some((task) =>
    ["analysis", "transcription", "export", "download-whisper"].includes(task.kind)
  );

  projectDocumentRef.current = projectDocument;

  function markProjectChanged() {
    if (projectBase && !projectReadOnly) setProjectRevision((revision) => revision + 1);
  }

  function updateFilenameTemplate(value: string) {
    setFilenameTemplate(value);
    markProjectChanged();
  }

  useEffect(() => {
    selectedSegmentRef.current = selectedSegment;
  }, [selectedSegment]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SCRATCH_PREVIEW_STORAGE_KEY, String(scratchPreviewMilliseconds));
    } catch {
      // Keep the setting for this session when persistent storage is unavailable.
    }
  }, [scratchPreviewMilliseconds]);

  useEffect(() => {
    scratchAudioProxyEnabledRef.current = scratchAudioProxyEnabled;
    try {
      window.localStorage.setItem(SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY, String(scratchAudioProxyEnabled));
    } catch {
      // Keep the setting for this session when persistent storage is unavailable.
    }
  }, [scratchAudioProxyEnabled]);

  useEffect(() => {
    if (!boundarySecondsInput.trim()) return;
    try {
      window.localStorage.setItem(
        BOUNDARY_SECONDS_STORAGE_KEY,
        formatBoundarySeconds(parseBoundarySeconds(boundarySecondsInput))
      );
    } catch {
      // Keep the setting for this session when persistent storage is unavailable.
    }
  }, [boundarySecondsInput]);

  useEffect(() => {
    if (!boundaryNudgeSecondsInput.trim()) return;
    try {
      window.localStorage.setItem(
        BOUNDARY_NUDGE_SECONDS_STORAGE_KEY,
        formatBoundaryNudgeSeconds(parseBoundaryNudgeSeconds(boundaryNudgeSecondsInput))
      );
    } catch {
      // Keep the setting for this session when persistent storage is unavailable.
    }
  }, [boundaryNudgeSecondsInput]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VIDEO_SPLIT_STORAGE_KEY, String(split));
    } catch {
      // Keep the setting for this session when persistent storage is unavailable.
    }
  }, [split]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WAVEFORM_DISPLAY_MODE_STORAGE_KEY, waveformDisplayMode);
    } catch {
      // Keep the setting for this session when persistent storage is unavailable.
    }
  }, [waveformDisplayMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CREATE_SOURCE_FOLDER_STORAGE_KEY, String(createSourceFolder));
    } catch {
      // Keep the export-folder preference for this session when persistent storage is unavailable.
    }
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
    if (!apiBaseUrl) return;
    void refreshWhisperStatus().catch((error) => setMessage(`Whisper status unavailable: ${String(error)}`));
  }, [apiBaseUrl]);

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
    let cancelled = false;
    setMessage("Transcribing in background.");
    const onUpdate = (nextJob: JobRecord) => {
      if (cancelled) return;
      taskRegistry.updateTask("transcription", nextJob);
      applyTranscriptResult(nextJob.result);
    };
    waitForJob<{ transcripts?: Transcript[] }>(apiBaseUrl, jobId, onUpdate)
      .then((result) => {
        if (cancelled) return;
        applyTranscripts(result.transcripts ?? []);
        setMessage("Transcription complete.");
      })
      .catch((error) => {
        if (!cancelled) setMessage(`Transcription failed: ${String(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, analysis?.transcription_job_id, taskRegistry.updateTask]);

  async function refreshWhisperStatus() {
    if (!apiBaseUrl) return null;
    const status = await getWhisperStatus(apiBaseUrl);
    setWhisperStatus(status);
    return status;
  }

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

  async function hydrateProject(nextProjectPath: string, document: ProjectDocumentV1, preferredSource?: string) {
    if (!apiBaseUrl) return;
    const wasRunning = document.operation?.status === "running";
    const operation = normalizeInterruptedOperation(document.operation);
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

    scratchProxyConfigurationGenerationRef.current += 1;
    void disposeScratchProxy(apiBaseUrl);
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
    setGuideText(document.guide_text);
    setAnalysis(analysisFromProject(document));
    const cachedWaveform = waveformFromProject(document);
    progressiveWaveform.showCached(sourcePath ?? document.source.absolute_path, cachedWaveform);
    if (sourcePath && cachedWaveform.length === 0) void progressiveWaveform.start(sourcePath);
    setSegments(document.segments.map((segment) => ({ ...segment })));
    setExportCandidates(exportCandidatesFromProject(document));
    setSelectedSegmentId(document.view_state.selected_segment_id ?? document.segments[0]?.id ?? null);
    setCurrentTime(document.view_state.current_time);
    setZoomIndex(clamp(document.view_state.zoom_index, 0, zoomLevels.length - 1));
    setAnalysisDevice(document.settings.analysis_device);
    setWhisperSettings({ ...document.settings.whisper });
    setFilenameTemplate(filenameTemplateFromProject(document));
    taskRegistry.clearTasks(["analysis", "transcription", "export"]);
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
    taskRegistry.clearTasks(["analysis", "transcription", "export"]);
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

    const document = createProjectDocument(nextProjectPath, identity, info);
    let initialSidecarError: unknown = null;
    try {
      await window.songcut.saveProject(nextProjectPath, document);
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
    setAnalysis(null);
    progressiveWaveform.showCached(filePath, []);
    void progressiveWaveform.start(filePath);
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

  async function loadProjectPath(filePath: string, discardCurrentChanges = false) {
    const opened = parseProjectOpenResult(await window.songcut.loadProject(filePath));
    await activateOpenedProject(opened, discardCurrentChanges);
  }

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
    await window.songcut.saveProject(target, document);
    setRecoveryOpen(false);
    setRecoveryCandidate(null);
    setMessage("Recovered edits were saved to the project sidecar.");
  }

  async function discardRecovery() {
    await window.songcut.clearRecovery();
    setRecoveryOpen(false);
    setRecoveryCandidate(null);
  }

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
    const nextProjectPath = await window.songcut.projectPathForVideo(selected);
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
    await window.songcut.saveProject(conflict.destinationPath, updated);
    if (projectPath && !sameWindowsPath(conflict.destinationPath, projectPath)) {
      await window.songcut.archiveRelinkedProject(projectPath);
    }
    await hydrateProject(conflict.destinationPath, updated, conflict.selectedPath);
    setRelinkConflict(null);
    setMessage("Source relinked and the project was saved beside the media.");
  }

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
    try {
      const started = await startScratchProxy(apiBaseUrl, videoPath);
      taskRegistry.updateTask("scratch-proxy", started);
      if (scratchProxyConfigurationGenerationRef.current !== generation) {
        await cancelScratchProxy(apiBaseUrl, started.id).catch(() => undefined);
        return;
      }
      scratchProxyJobIdRef.current = started.id;
      const result = await waitForJob<ScratchProxyResult>(
        apiBaseUrl,
        started.id,
        (nextJob) => taskRegistry.updateTask("scratch-proxy", nextJob),
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
      await disposeScratchProxy(apiBaseUrl);
      if (scratchProxyConfigurationGenerationRef.current !== generation) return;
      setScratchProxyState("failed");
      setMessage(`Scratch proxy failed; using original audio: ${String(error)}`);
    }
  }

  async function disposeScratchProxy(baseUrl: string) {
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
    taskRegistry.updateTask("scratch-proxy", null);
    if (!baseUrl) return;
    if (jobId) await cancelScratchProxy(baseUrl, jobId).catch(() => undefined);
    if (proxyId) await releaseScratchProxy(baseUrl, proxyId).catch(() => undefined);
  }

  async function selectVideo() {
    const filePath = await window.songcut.selectVideo();
    if (!filePath) return;
    await loadVideo(filePath).catch((error) => setMessage(String(error)));
  }

  async function ensureWhisper() {
    if (!apiBaseUrl) return;
    const started = await startWhisperDownload(apiBaseUrl, whisperSettings.model);
    taskRegistry.updateTask("download-whisper", started);
    await waitForJob(apiBaseUrl, started.id, (nextJob) => taskRegistry.updateTask("download-whisper", nextJob));
    await refreshWhisperStatus();
    setMessage(`Whisper ${whisperSettings.model} model is ready.`);
  }

  async function runFfmpegCheck(showSuccess: boolean) {
    if (!apiBaseUrl) return;
    if (showSuccess) setFfmpegCheckOpen(true);
    setFfmpegCheckPending(true);
    try {
      const result = await checkFfmpeg(apiBaseUrl);
      setFfmpegCheckResult(result);
      if (showSuccess || !result.ok) setFfmpegCheckOpen(true);
      setMessage(result.ok ? "ffmpeg and ffprobe are available." : "ffmpeg check failed.");
    } catch (error) {
      setFfmpegCheckResult({ ok: false, error: String(error), download_url: FFMPEG_DOWNLOAD_URL });
      setFfmpegCheckOpen(true);
      setMessage("ffmpeg check failed.");
    } finally {
      setFfmpegCheckPending(false);
    }
  }

  async function analyze() {
    if (whisperSettings.enabled && !selectedWhisperModel?.ready) {
      setWhisperPreflightOpen(true);
      return;
    }
    await runAnalysis(whisperSettings.enabled);
  }

  async function runAnalysis(transcribeAfter: boolean) {
    if (!apiBaseUrl || !videoPath) return;
    taskRegistry.updateTask("transcription", null);
    setProjectOperation({ kind: "analysis", status: "running" });
    markProjectChanged();
    const started = await startAnalysis(apiBaseUrl, videoPath, guideText, analysisDevice);
    taskRegistry.updateTask("analysis", started);
    try {
      const result = await waitForJob<AnalysisResult>(apiBaseUrl, started.id, (nextJob) =>
        taskRegistry.updateTask("analysis", nextJob)
      );
      const nextSegments = result.segments.map((segment) => ({ ...segment, checked: true }));
      setAnalysis(result);
      setSegments(nextSegments);
      setExportCandidates(result.export_candidates);
      setSelectedSegmentId(nextSegments[0]?.id ?? null);
      setProjectOperation(null);
      markProjectChanged();
      setMessage(`Detected ${nextSegments.length} segments.`);
      if (transcribeAfter && nextSegments.length) await runTranscription(nextSegments, false);
    } catch (error) {
      setProjectOperation({ kind: "analysis", status: "interrupted" });
      markProjectChanged();
      throw error;
    }
  }

  async function runTranscription(candidateSegments = segments, resumeInterrupted = true) {
    if (!apiBaseUrl || !videoPath || !candidateSegments.length) return;
    const sameInterruptedSettings =
      resumeInterrupted &&
      projectOperation?.kind === "transcription" &&
      projectOperation.status === "interrupted" &&
      projectOperation.settings?.model === whisperSettings.model &&
      projectOperation.settings?.language === whisperSettings.language;
    const pending = sameInterruptedSettings
      ? candidateSegments.filter((segment) => projectOperation.pending_segment_ids?.includes(segment.id))
      : candidateSegments;
    const targets = pending.length ? pending : candidateSegments;
    const pendingIds = targets.map((segment) => segment.id);
    setProjectOperation({
      kind: "transcription",
      status: "running",
      settings: { ...whisperSettings },
      pending_segment_ids: pendingIds
    });
    markProjectChanged();
    try {
      const started = await startTranscription(apiBaseUrl, videoPath, targets, whisperSettings, guideText);
      taskRegistry.updateTask("transcription", started);
      const appliedTranscripts = new Map<string, string>();
      const result = await waitForJob<{ transcripts?: Transcript[] }>(apiBaseUrl, started.id, (nextJob) => {
        taskRegistry.updateTask("transcription", nextJob);
        const partial = (nextJob.result as { transcripts?: Transcript[] } | undefined)?.transcripts ?? [];
        const changed = partial.filter((transcript) => {
          const serialized = JSON.stringify(transcript);
          if (appliedTranscripts.get(transcript.segment_id) === serialized) return false;
          appliedTranscripts.set(transcript.segment_id, serialized);
          return true;
        });
        if (changed.length) {
          applyTranscripts(changed);
          const completed = new Set(changed.filter((transcript) => !transcript.error).map((transcript) => transcript.segment_id));
          setProjectOperation((operation) =>
            operation?.kind === "transcription"
              ? { ...operation, pending_segment_ids: operation.pending_segment_ids?.filter((id) => !completed.has(id)) }
              : operation
          );
        }
      });
      const finalTranscripts = result.transcripts ?? [];
      const unapplied = finalTranscripts.filter(
        (transcript) => appliedTranscripts.get(transcript.segment_id) !== JSON.stringify(transcript)
      );
      applyTranscripts(unapplied);
      const failedIds = finalTranscripts.filter((transcript) => transcript.error).map((transcript) => transcript.segment_id);
      setProjectOperation(
        failedIds.length
          ? {
              kind: "transcription",
              status: "interrupted",
              settings: { ...whisperSettings },
              pending_segment_ids: failedIds
            }
          : null
      );
      markProjectChanged();
      setMessage(failedIds.length ? `Transcription completed with ${failedIds.length} failed segment(s).` : "Transcription complete.");
    } catch (error) {
      setProjectOperation((operation) =>
        operation?.kind === "transcription" ? { ...operation, status: "interrupted" } : operation
      );
      markProjectChanged();
      if (error instanceof ApiError && error.status === 409) await refreshWhisperStatus().catch(() => undefined);
      setMessage(`Transcription failed: ${String(error)}`);
    }
  }

  async function exportClips(outputDir: string, createVideoFolder: boolean) {
    if (!apiBaseUrl || !videoPath) return;
    if (outputPlan.error) {
      setMessage(localizeFilenameTemplateError(outputPlan.error) ?? outputPlan.error);
      return;
    }
    const outputItems = buildOutputItems();
    const items = outputItems.filter((item) => item.checked);
    let started: JobRecord;
    try {
      started = await startExport(
        apiBaseUrl,
        videoPath,
        outputDir,
        items,
        buildTimestampExportText(items, "timestamp-comment"),
        createVideoFolder
      );
    } catch (error) {
      setMessage(`Export could not be started: ${String(error)}`);
      return;
    }
    setOutputOpen(false);
    setExportProgressOpen(true);
    taskRegistry.updateTask("export", started);
    setProjectOperation({ kind: "export", status: "running" });
    markProjectChanged();
    try {
      await waitForJob(apiBaseUrl, started.id, (nextJob) => {
        taskRegistry.updateTask("export", nextJob);
      });
      setProjectOperation(null);
      markProjectChanged();
      setMessage("Export complete.");
    } catch (error) {
      setProjectOperation({ kind: "export", status: "interrupted" });
      markProjectChanged();
      setMessage(`Export failed: ${String(error)}`);
    }
  }

  function cancelQuit() {
    setQuitConfirmOpen(false);
    void window.songcut.cancelClose();
  }

  async function confirmQuit() {
    setQuitConfirmOpen(false);
    const current = projectDocumentRef.current;
    if (current) {
      const kind = runningJobRef.current?.kind;
      const operationKind = kind === "analysis" || kind === "transcription" || kind === "export" ? kind : current.operation?.kind;
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

  function buildOutputItems(): OutputItem[] {
    return outputPlan.items;
  }

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

  function buildSegmentReviewItems(reviewSegments: readonly Segment[]) {
    const baseItems = new Map(buildBaseOutputItems().map((item) => [item.segmentId, item]));
    const requested = reviewSegments.flatMap((segment) => {
      const item = baseItems.get(segment.id);
      return item ? [item] : [];
    });
    const templated = applyFilenameTemplate(requested, filenameTemplate);
    return templated.error ? requested : templated.items;
  }

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

  function updateSegment(id: string, patch: Partial<Segment>) {
    setSegments((current) => current.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)));
    markProjectChanged();
  }

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

  function checkAllSegments() {
    if (!uncheckedCount) return;
    setSegments(setAllSegmentsChecked(segments, true));
    markProjectChanged();
    setMessage(tr("messages.checkedAll"));
  }

  function uncheckAllSegments() {
    if (!checkedCount) return;
    setSegments(setAllSegmentsChecked(segments, false));
    markProjectChanged();
    setMessage(tr("messages.uncheckedAll"));
  }

  function invertExportSelection() {
    if (!segments.length) return;
    setSegments(invertSegmentChecks(segments));
    markProjectChanged();
    setMessage(tr("messages.inverted"));
  }

  function selectSegment(segment: Segment) {
    setSelectedSegmentId(segment.id);
    setSegmentFocusRequest((request) => request + 1);
    seek(segment.start);
  }

  function selectAdjacentSegment(direction: -1 | 1) {
    if (!selectedSegment) return;
    const index = segments.findIndex((segment) => segment.id === selectedSegment.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= segments.length) return;
    selectSegment(segments[nextIndex]);
  }

  function applyTranscriptResult(result: unknown) {
    const transcripts = (result as { transcripts?: Transcript[] } | null | undefined)?.transcripts;
    if (Array.isArray(transcripts)) applyTranscripts(transcripts);
  }

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

  function finishScratchPreview() {
    cancelScratchPreview(true);
  }

  function seek(time: number) {
    const video = videoRef.current;
    if (!video) return;
    finishScratchPreview();
    video.currentTime = clamp(time, 0, duration || 0);
    setCurrentTime(video.currentTime);
    playbackStopAtRef.current = video.paused ? null : segmentStopAtForTime(selectedSegmentRef.current, video.currentTime);
  }

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

  function playVideo() {
    finishScratchPreview();
    void videoRef.current?.play();
  }

  function pauseVideo() {
    if (scratchPreviewTimeRef.current !== null) {
      finishScratchPreview();
      return;
    }
    videoRef.current?.pause();
  }

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

  function openSettings() {
    setSettingsOpen(true);
    if (apiBaseUrl) void refreshWhisperStatus().catch((error) => setMessage(`Whisper status unavailable: ${String(error)}`));
  }

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

  function playStartBoundary() {
    if (!selectedSegment) return;
    const seconds = parseBoundarySeconds(boundarySecondsInput);
    playFrom(selectedSegment.start, Math.min(selectedSegment.end, selectedSegment.start + seconds));
  }

  function playEndBoundary() {
    if (!selectedSegment) return;
    const seconds = parseBoundarySeconds(boundarySecondsInput);
    playFrom(Math.max(selectedSegment.start, selectedSegment.end - seconds), selectedSegment.end);
  }

  function jumpBoundary(direction: -1 | 1) {
    const boundaries = segments.flatMap((segment) => [segment.start, segment.end]).sort((a, b) => a - b);
    const target =
      direction < 0
        ? [...boundaries].reverse().find((time) => time < currentTime - 0.05)
        : boundaries.find((time) => time > currentTime + 0.05);
    if (target !== undefined) seek(target);
  }

  function nudgeNearestBoundary(direction: -1 | 1) {
    const target = nearestBoundaryTarget(segments, currentTime, selectedSegment?.id);
    if (!target) return;
    const segment = segments.find((item) => item.id === target.segmentId);
    if (!segment) return;

    const seconds = parseBoundaryNudgeSeconds(boundaryNudgeSecondsInput);
    const maxDuration = Math.max(duration || 0, segment.end);
    const nextTime =
      target.edge === "start"
        ? clamp(segment.start + direction * seconds, 0, segment.end - MIN_SEGMENT_SECONDS)
        : clamp(segment.end + direction * seconds, segment.start + MIN_SEGMENT_SECONDS, maxDuration);

    setSelectedSegmentId(segment.id);
    updateSegment(
      segment.id,
      target.edge === "start" ? { start: nextTime, user_edited: true } : { end: nextTime, user_edited: true }
    );
    seek(nextTime);
  }

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
      hasSegments: segments.length > 0,
      hasSelectedSegment: Boolean(selectedSegmentId && segments.some((segment) => segment.id === selectedSegmentId)),
      hasCheckedSegments: checkedCount > 0,
      hasUncheckedSegments: uncheckedCount > 0,
      hasMultipleSegments: segments.length > 1,
      canSelectPreviousSegment,
      canSelectNextSegment,
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
    whisperSettings.model
  ]);

  useEffect(() => {
    return window.songcut.onMenuCommand((command) => {
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
        case "nudge-boundary-left":
          nudgeNearestBoundary(-1);
          break;
        case "nudge-boundary-right":
          nudgeNearestBoundary(1);
          break;
        case "previous-segment":
          selectAdjacentSegment(-1);
          break;
        case "next-segment":
          selectAdjacentSegment(1);
          break;
        case "new-segment":
          addNewSegment();
          break;
        case "remove-segment":
          requestRemoveSelectedSegment();
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
        case "set-zoom":
          setZoomIndex(clamp(command.zoomIndex, 0, zoomLevels.length - 1));
          break;
        case "start":
          seek(0);
          break;
        case "previous-boundary":
          jumpBoundary(-1);
          break;
        case "play":
          playVideo();
          break;
        case "pause":
          pauseVideo();
          break;
        case "next-boundary":
          jumpBoundary(1);
          break;
        case "play-start-boundary":
          playStartBoundary();
          break;
        case "play-end-boundary":
          playEndBoundary();
          break;
        case "export-movie":
          if (checkedCount > 0) openOutputReview();
          break;
        case "export-timestamp":
          void exportTimestampText(command.format);
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
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = resolveEditorShortcut(event);
      if (!action || isEditorShortcutSuppressed(event)) return;
      event.preventDefault();

      switch (action) {
        case "play-start-boundary":
          playStartBoundary();
          break;
        case "play-end-boundary":
          playEndBoundary();
          break;
        case "previous-segment":
          selectAdjacentSegment(-1);
          break;
        case "next-segment":
          selectAdjacentSegment(1);
          break;
        case "nudge-boundary-left":
          nudgeNearestBoundary(-1);
          break;
        case "nudge-boundary-right":
          nudgeNearestBoundary(1);
          break;
        case "toggle-playback": {
          const video = videoRef.current;
          if (!video) break;
          if (video.paused) playVideo();
          else pauseVideo();
          break;
        }
        case "previous-boundary":
          jumpBoundary(-1);
          break;
        case "next-boundary":
          jumpBoundary(1);
          break;
        case "zoom-out":
          setZoomIndex((value) => clamp(value - 1, 0, zoomLevels.length - 1));
          break;
        case "reset-zoom":
          setZoomIndex(0);
          break;
        case "zoom-in":
          setZoomIndex((value) => clamp(value + 1, 0, zoomLevels.length - 1));
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [boundaryNudgeSecondsInput, boundarySecondsInput, currentTime, duration, segments, selectedSegment]);

  return (
    <main
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
        <header className="toolbar">
          <Button onClick={selectVideo}>
            <FolderOpen size={16} />
            {tr("common.load")}
          </Button>
          <Button onClick={() => void analyze().catch((error) => setMessage(String(error)))} disabled={!sourceAvailable || !apiBaseUrl}>
            <Wand2 size={16} />
            {tr("common.analyze")}
          </Button>
          <Button variant="secondary" onClick={openOutputReview} disabled={checkedCount === 0 || !sourceAvailable}>
            <Scissors size={16} />
            {tr("common.export")}
          </Button>
          <Button variant="secondary" onClick={() => setTimestampExportOpen(true)} disabled={checkedCount === 0}>
            <Copy size={16} />
            {tr("common.exportTs")}
          </Button>
          <Button variant="secondary" onClick={openSettings}>
            <Settings2 size={16} />
            {tr("common.settings")}
          </Button>
          <div className="spacer" />
          <span className={`project-save-status status-${persistence.status}`}>
            {projectReadOnly ? tr("app.readOnly") : projectSaveStatusLabel(persistence.status)}
          </span>
          <BoundaryControls
            value={boundarySecondsInput}
            disabled={!selectedSegment || !videoUrl}
            onChange={(value) => setBoundarySecondsInput(normalizeBoundarySecondsInput(value))}
            onBlur={() => setBoundarySecondsInput(formatBoundarySeconds(parseBoundarySeconds(boundarySecondsInput)))}
            onStart={playStartBoundary}
            onEnd={playEndBoundary}
          />
          <BoundaryNudgeControls
            value={boundaryNudgeSecondsInput}
            disabled={!segments.length || !videoUrl}
            onChange={setBoundaryNudgeSecondsInput}
            onBlur={() =>
              setBoundaryNudgeSecondsInput(formatBoundaryNudgeSeconds(parseBoundaryNudgeSeconds(boundaryNudgeSecondsInput)))
            }
            onLeft={() => nudgeNearestBoundary(-1)}
            onRight={() => nudgeNearestBoundary(1)}
          />
          <PlaybackControls
            onPlay={playVideo}
            onPause={pauseVideo}
            onStart={() => seek(0)}
            onPrev={() => jumpBoundary(-1)}
            onNext={() => jumpBoundary(1)}
          />
          <ZoomControls
            zoom={zoom}
            onIn={() => setZoomIndex((value) => clamp(value + 1, 0, zoomLevels.length - 1))}
            onOut={() => setZoomIndex((value) => clamp(value - 1, 0, zoomLevels.length - 1))}
            onReset={() => setZoomIndex(0)}
          />
        </header>
        <div className="guide-row">
          <Textarea
            value={guideText}
            onChange={(event) => {
              setGuideText(event.target.value);
              markProjectChanged();
            }}
            placeholder={tr("app.guidePlaceholder")}
          />
          <StatusPanel
            job={activeJob}
            message={message}
            videoInfo={videoInfo}
            scratchProxyState={scratchProxyState}
            waveformPhase={progressiveWaveform.phase}
            waveformProgress={progressiveWaveform.progress}
            onWaveformRetry={
              sourceAvailable && videoPath && progressiveWaveform.phase === "failed"
                ? () => void progressiveWaveform.start(videoPath)
                : null
            }
          />
        </div>
        <TimelineStack
          duration={duration}
          waveform={progressiveWaveform.waveform}
          progressiveWaveformChunks={progressiveWaveform.chunks}
          waveformPhase={progressiveWaveform.phase}
          waveformProgress={progressiveWaveform.progress}
          segments={segments}
          selectedSegment={selectedSegment}
          currentTime={currentTime}
          playing={playing}
          zoom={zoom}
          waveformDisplayMode={waveformDisplayMode}
          focusRequest={segmentFocusRequest}
          editing={waveformSeeking || handleEditing}
          onSeek={seek}
          onScrub={scratchPreview}
          onSeekingChange={setWaveformSeeking}
          onHandleEditingChange={setHandleEditing}
          onChange={(patch) => selectedSegment && updateSegment(selectedSegment.id, patch)}
        />
        <SegmentList
          segments={segments}
          selectedId={selectedSegment?.id ?? null}
          onSelect={selectSegment}
          onToggle={(segment, checked) => updateSegment(segment.id, { checked })}
          onTitleChange={(segment, title) => updateSegment(segment.id, { title })}
          onTranscript={setTranscriptSegment}
        />
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
      <SettingsDialog
        open={settingsOpen}
        apiReady={Boolean(apiBaseUrl)}
        scratchPreviewMillisecondsInput={scratchPreviewMillisecondsInput}
        scratchAudioProxyEnabled={scratchAudioProxyEnabled}
        waveformDisplayMode={waveformDisplayMode}
        analysisDevice={analysisDevice}
        filenameTemplate={filenameTemplate}
        filenameTemplateError={localizeFilenameTemplateError(outputPlan.error)}
        whisperSettings={whisperSettings}
        whisperStatus={whisperStatus}
        whisperBusy={whisperBusy}
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
        onWaveformDisplayMode={(mode) => {
          setWaveformDisplayMode(mode);
          setMessage(tr("app.waveformSet", { mode: waveformDisplayModeLabel(mode) }));
        }}
        onAnalysisDevice={(device) => {
          setAnalysisDevice(device);
          markProjectChanged();
          setMessage(tr("app.analysisDeviceSet", { device: deviceLabel(device) }));
        }}
        onFilenameTemplate={updateFilenameTemplate}
        onWhisperSettings={(settings) => {
          setWhisperSettings(settings);
          markProjectChanged();
        }}
        onPrepareWhisperModel={() => void ensureWhisper().catch((error) => setMessage(String(error)))}
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
      <ExportProgressDialog
        open={exportProgressOpen}
        job={exportJob}
        estimate={videoInfo?.smart_render_estimate ?? null}
        renderPlanState={exportPlanState}
        onClose={() => setExportProgressOpen(false)}
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
                .then(() => runAnalysis(true))
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
  );
}

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

function isProjectNotFoundError(error: unknown) {
  return String(error).includes("Project not found:");
}

function sameWindowsPath(left: string, right: string) {
  return left.replaceAll("/", "\\").toLowerCase() === right.replaceAll("/", "\\").toLowerCase();
}

function sourceDurationMatches(expected: number, actual: number) {
  return Math.abs(expected - actual) <= Math.max(0.05, expected * 0.00001);
}

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

function jobKindLabel(kind: string) {
  if (kind === "analysis") return tr("tasks.analysis");
  if (kind === "transcription") return tr("tasks.transcription");
  if (kind === "export") return tr("tasks.export");
  if (kind === "download-whisper") return tr("tasks.download");
  if (kind === "waveform") return tr("tasks.waveform");
  if (kind === "scratch-proxy") return tr("tasks.proxy");
  return tr("tasks.generic");
}

function waveformStatusLabel(phase: ReturnType<typeof useProgressiveWaveform>["phase"], progress: number) {
  switch (phase) {
    case "streaming":
      return tr("app.waveformProgress", { progress: Math.round(clamp(progress, 0, 1) * 100) });
    case "finalizing":
      return tr("app.waveformFinalizing");
    case "ready":
      return tr("app.waveformReady");
    case "failed":
      return tr("app.waveformUnavailable");
    case "idle":
      return tr("app.waveformWaiting");
  }
}

function localizedScratchProxyStatusLabel(state: ScratchProxyState) {
  switch (state) {
    case "disabled": return tr("app.scratchDisabled");
    case "preparing":
    case "loading": return tr("app.scratchPreparing");
    case "ready": return tr("app.scratchReady");
    case "failed": return tr("app.scratchFailed");
    case "idle":
    case "original": return tr("app.scratchOriginal");
  }
}

function localizedError(error: unknown) {
  return localizeUiMessage(String(error));
}

function BoundaryControls(props: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="icon-group boundary-controls">
      <Button
        size="icon"
        variant="ghost"
        onClick={props.onStart}
        disabled={props.disabled}
        title={tr("controls.playStart")}
        aria-keyshortcuts="A"
      >
        <SkipBack size={17} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={props.onEnd}
        disabled={props.disabled}
        title={tr("controls.playEnd")}
        aria-keyshortcuts="D"
      >
        <SkipForward size={17} />
      </Button>
      <Input
        className="boundary-seconds-input"
        type="number"
        min="1"
        max="60"
        step="1"
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label={tr("controls.boundarySeconds")}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onBlur={props.onBlur}
      />
    </div>
  );
}

function BoundaryNudgeControls(props: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onLeft: () => void;
  onRight: () => void;
}) {
  return (
    <div className="icon-group boundary-nudge-controls">
      <Button
        size="icon"
        variant="ghost"
        onClick={props.onLeft}
        disabled={props.disabled}
        title={tr("controls.nudgeLeft")}
        aria-keyshortcuts="Q"
      >
        <ArrowLeft size={17} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={props.onRight}
        disabled={props.disabled}
        title={tr("controls.nudgeRight")}
        aria-keyshortcuts="E"
      >
        <ArrowRight size={17} />
      </Button>
      <Input
        className="boundary-nudge-seconds-input"
        type="number"
        min="0.1"
        max="60"
        step="0.1"
        inputMode="decimal"
        aria-label={tr("controls.nudgeSeconds")}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        onBlur={props.onBlur}
      />
    </div>
  );
}

function PlaybackControls(props: { onPlay: () => void; onPause: () => void; onStart: () => void; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="icon-group">
      <Button size="icon" variant="ghost" onClick={props.onStart} title={tr("controls.start")}>
        <Rewind size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onPrev} title={tr("controls.previous")} aria-keyshortcuts="Control+A">
        <ChevronsLeft size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onPlay} title={tr("controls.play")} aria-keyshortcuts="Space">
        <Play size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onPause} title={tr("controls.pause")} aria-keyshortcuts="Space">
        <Pause size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onNext} title={tr("controls.next")} aria-keyshortcuts="Control+D">
        <ChevronsRight size={17} />
      </Button>
    </div>
  );
}

function ZoomControls(props: { zoom: number; onIn: () => void; onOut: () => void; onReset: () => void }) {
  return (
    <div className="icon-group">
      <Button size="icon" variant="ghost" onClick={props.onOut} title={tr("controls.zoomOut")} aria-keyshortcuts="Z">
        <Minus size={17} />
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onReset} title={tr("controls.zoomReset")} aria-keyshortcuts="X">
        {props.zoom * 100}%
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onIn} title={tr("controls.zoomIn")} aria-keyshortcuts="C">
        <Plus size={17} />
      </Button>
    </div>
  );
}

function StatusPanel({
  job,
  message,
  videoInfo,
  scratchProxyState,
  waveformPhase,
  waveformProgress,
  onWaveformRetry
}: {
  job: JobRecord | null;
  message: string;
  videoInfo: VideoInfo | null;
  scratchProxyState: ScratchProxyState;
  waveformPhase: ReturnType<typeof useProgressiveWaveform>["phase"];
  waveformProgress: number;
  onWaveformRetry: (() => void) | null;
}) {
  return (
    <aside className="status-panel">
      <div className="status-main">
        {job?.status === "completed" ? <CheckCircle2 size={16} /> : null}
        <span>{localizeJobMessage(job) || localizeUiMessage(message) || tr("app.idle")}</span>
      </div>
      {job ? <progress value={job.progress} max={1} /> : null}
      {videoInfo ? (
        <>
          <div className="meta-line">
            {formatTime(videoInfo.duration)} / {videoInfo.video.width}x{videoInfo.video.height} / {videoInfo.video.codec}
          </div>
          <div className="meta-line" data-scratch-proxy-status={scratchProxyState}>
            {localizedScratchProxyStatusLabel(scratchProxyState)}
          </div>
          <div className="meta-line waveform-status-line" data-waveform-status={waveformPhase}>
            <span>{waveformStatusLabel(waveformPhase, waveformProgress)}</span>
            {onWaveformRetry ? (
              <button type="button" className="waveform-retry" onClick={onWaveformRetry}>{tr("controls.retryWaveform")}</button>
            ) : null}
          </div>
        </>
      ) : null}
    </aside>
  );
}

function TimelineStack(props: {
  duration: number;
  waveform: WaveformPoint[];
  progressiveWaveformChunks: WaveformPoint[][];
  waveformPhase: ReturnType<typeof useProgressiveWaveform>["phase"];
  waveformProgress: number;
  segments: Segment[];
  selectedSegment: Segment | null;
  currentTime: number;
  playing: boolean;
  zoom: number;
  waveformDisplayMode: WaveformDisplayMode;
  focusRequest: number;
  editing: boolean;
  onSeek: (time: number) => void;
  onScrub: (time: number) => void;
  onSeekingChange: (seeking: boolean) => void;
  onHandleEditingChange: (editing: boolean) => void;
  onChange: (patch: Partial<Segment>) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const handledFocusRequestRef = useRef(0);
  const [baseWidth, setBaseWidth] = useState(900);
  const width = Math.max(baseWidth, baseWidth * props.zoom);
  const safeDuration = Math.max(0.001, props.duration);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resize = () => setBaseWidth(Math.max(400, viewport.clientWidth));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || props.duration <= 0 || props.editing) return;
    const playheadX = clamp(props.currentTime / props.duration, 0, 1) * width;
    const viewportWidth = viewport.clientWidth;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewportWidth);
    const left = viewport.scrollLeft;
    const right = left + viewportWidth;
    let target: number | null = null;

    if (props.playing) {
      if (playheadX > left + viewportWidth * 0.9) {
        target = playheadX - viewportWidth * 0.7;
      } else if (playheadX < left + viewportWidth * 0.1) {
        target = playheadX - viewportWidth * 0.3;
      }
    } else if (playheadX < left) {
      target = playheadX - viewportWidth * 0.3;
    } else if (playheadX > right) {
      target = playheadX - viewportWidth * 0.7;
    }

    if (target !== null) {
      viewport.scrollLeft = clamp(target, 0, maxScrollLeft);
    }
  }, [props.currentTime, props.duration, props.zoom, props.playing, props.editing, width]);

  useEffect(() => {
    if (handledFocusRequestRef.current === props.focusRequest) return;
    const viewport = viewportRef.current;
    const segment = props.selectedSegment;
    if (!viewport || !segment || props.duration <= 0) return;

    const contentWidth = viewport.scrollWidth;
    const viewportWidth = viewport.clientWidth;
    const startX = clamp(segment.start / props.duration, 0, 1) * contentWidth;
    const endX = clamp(segment.end / props.duration, 0, 1) * contentWidth;
    const segmentWidth = Math.max(0, endX - startX);
    const target =
      segmentWidth <= viewportWidth
        ? startX + segmentWidth / 2 - viewportWidth / 2
        : startX - viewportWidth * 0.1;

    viewport.scrollLeft = clamp(target, 0, Math.max(0, contentWidth - viewportWidth));
    handledFocusRequestRef.current = props.focusRequest;
  }, [props.focusRequest, props.selectedSegment, props.duration]);

  const scrollByWheel = (event: React.WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    if (maxScrollLeft <= 0) return;

    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const multiplier = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? viewport.clientWidth : 1;
    const nextScrollLeft = clamp(viewport.scrollLeft + rawDelta * multiplier, 0, maxScrollLeft);
    if (nextScrollLeft === viewport.scrollLeft) return;
    event.preventDefault();
    viewport.scrollLeft = nextScrollLeft;
  };

  return (
    <ScrollArea className="timeline-scroll-area" viewportRef={viewportRef} scrollbars={["horizontal"]} onWheel={scrollByWheel}>
      <div className="timeline-content" style={{ width }}>
        <div className="timeline-playhead" style={{ left: (props.currentTime / safeDuration) * width }} />
        <WaveformTimeline
          duration={props.duration}
          waveform={props.waveform}
          progressiveWaveformChunks={props.progressiveWaveformChunks}
          waveformPhase={props.waveformPhase}
          waveformProgress={props.waveformProgress}
          waveformDisplayMode={props.waveformDisplayMode}
          segments={props.segments}
          selectedSegmentId={props.selectedSegment?.id ?? null}
          width={width}
          viewportRef={viewportRef}
          onSeek={props.onSeek}
          onScrub={props.onScrub}
          onSeekingChange={props.onSeekingChange}
        />
        <SegmentTimeline
          duration={props.duration}
          segment={props.selectedSegment}
          currentTime={props.currentTime}
          width={width}
          viewportRef={viewportRef}
          onChange={props.onChange}
          onEditingChange={props.onHandleEditingChange}
        />
      </div>
    </ScrollArea>
  );
}

function WaveformTimeline(props: {
  duration: number;
  waveform: WaveformPoint[];
  progressiveWaveformChunks: WaveformPoint[][];
  waveformPhase: ReturnType<typeof useProgressiveWaveform>["phase"];
  waveformProgress: number;
  waveformDisplayMode: WaveformDisplayMode;
  segments: Segment[];
  selectedSegmentId: string | null;
  width: number;
  viewportRef: React.RefObject<HTMLDivElement>;
  onSeek: (time: number) => void;
  onScrub: (time: number) => void;
  onSeekingChange: (seeking: boolean) => void;
}) {
  const safeDuration = Math.max(0.001, props.duration);
  const suppressClickRef = useRef(false);
  const dragClientXRef = useRef<number | null>(null);
  const mouseSeekingRef = useRef(false);
  const autoScrollTimerRef = useRef<number | null>(null);
  const lastAutoScrollTimeRef = useRef<number | null>(null);
  const timeFromClientX = (clientX: number) => {
    const viewport = props.viewportRef.current;
    if (!viewport || props.duration <= 0) return null;
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left + viewport.scrollLeft;
    return clamp((x / props.width) * props.duration, 0, props.duration);
  };
  const seekFromClientX = (clientX: number) => {
    const time = timeFromClientX(clientX);
    if (time !== null) props.onSeek(time);
  };
  const scrubFromClientX = (clientX: number) => {
    const time = timeFromClientX(clientX);
    if (time !== null) props.onScrub(time);
  };
  const stopAutoScroll = () => {
    if (autoScrollTimerRef.current !== null) {
      window.clearInterval(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
    lastAutoScrollTimeRef.current = null;
    dragClientXRef.current = null;
  };
  const autoScroll = () => {
    const viewport = props.viewportRef.current;
    const clientX = dragClientXRef.current;
    if (!viewport || clientX === null) {
      stopAutoScroll();
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const edgeZone = 64;
    const maxSpeed = 900;
    const leftDistance = clientX - rect.left;
    const rightDistance = rect.right - clientX;
    let speed = 0;
    if (leftDistance < edgeZone) {
      const ratio = clamp((edgeZone - Math.max(0, leftDistance)) / edgeZone, 0, 1);
      speed = -maxSpeed * ratio * ratio;
    } else if (rightDistance < edgeZone) {
      const ratio = clamp((edgeZone - Math.max(0, rightDistance)) / edgeZone, 0, 1);
      speed = maxSpeed * ratio * ratio;
    }

    if (speed === 0) {
      lastAutoScrollTimeRef.current = null;
      return;
    }

    const now = window.performance.now();
    const previous = lastAutoScrollTimeRef.current ?? now - 16;
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    lastAutoScrollTimeRef.current = now;
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    viewport.scrollLeft = clamp(viewport.scrollLeft + speed * deltaSeconds, 0, maxScrollLeft);
    scrubFromClientX(clientX);
  };
  const updateAutoScroll = (clientX: number) => {
    dragClientXRef.current = clientX;
    if (autoScrollTimerRef.current === null) {
      autoScrollTimerRef.current = window.setInterval(autoScroll, 16);
    }
    autoScroll();
  };
  return (
    <div
      className="waveform-timeline timeline-row"
      style={{ width: props.width }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        suppressClickRef.current = true;
        props.onSeekingChange(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        updateAutoScroll(event.clientX);
        scrubFromClientX(event.clientX);
      }}
      onPointerMove={(event) => {
        if ((event.buttons & 1) !== 1 || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        updateAutoScroll(event.clientX);
        scrubFromClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        stopAutoScroll();
        props.onSeekingChange(false);
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        stopAutoScroll();
        props.onSeekingChange(false);
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }}
      onClick={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          return;
        }
        seekFromClientX(event.clientX);
      }}
      onMouseDown={(event) => {
        if (event.button !== 0 || dragClientXRef.current !== null) return;
        event.preventDefault();
        suppressClickRef.current = true;
        mouseSeekingRef.current = true;
        props.onSeekingChange(true);
        updateAutoScroll(event.clientX);
        scrubFromClientX(event.clientX);
        const move = (moveEvent: MouseEvent) => {
          if (!mouseSeekingRef.current) return;
          updateAutoScroll(moveEvent.clientX);
          scrubFromClientX(moveEvent.clientX);
        };
        const up = () => {
          mouseSeekingRef.current = false;
          stopAutoScroll();
          props.onSeekingChange(false);
          window.setTimeout(() => {
            suppressClickRef.current = false;
          }, 0);
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    >
      <svg width={props.width} height="86" viewBox={`0 0 ${props.width} 86`} preserveAspectRatio="none">
        <rect width={props.width} height="86" fill="#101820" />
        {props.segments.map((segment) => (
          <rect
            key={segment.id}
            x={(segment.start / safeDuration) * props.width}
            y="10"
            width={Math.max(1, ((segment.end - segment.start) / safeDuration) * props.width)}
            height="66"
            fill={segment.id === props.selectedSegmentId ? "rgba(242, 109, 91, 0.3)" : "rgba(69, 179, 157, 0.26)"}
          />
        ))}
        {props.waveformPhase === "streaming" || props.waveformPhase === "finalizing" ? (
          <ProgressiveWaveformLayer
            duration={props.duration}
            chunks={props.progressiveWaveformChunks}
            width={props.width}
            mode={props.waveformDisplayMode}
            finalizing={props.waveformPhase === "finalizing"}
          />
        ) : null}
        {props.waveformPhase === "ready" || props.waveformPhase === "finalizing" ? (
          <StaticWaveformLayer
            duration={props.duration}
            waveform={props.waveform}
            width={props.width}
            mode={props.waveformDisplayMode}
            finalizing={props.waveformPhase === "finalizing"}
          />
        ) : null}
        {props.waveformPhase === "streaming" ? (
          <line
            className="waveform-progress-frontier"
            x1={clamp(props.waveformProgress, 0, 1) * props.width}
            x2={clamp(props.waveformProgress, 0, 1) * props.width}
            y1="4"
            y2="82"
            pointerEvents="none"
          />
        ) : null}
      </svg>
    </div>
  );
}

const StaticWaveformLayer = memo(function StaticWaveformLayer(props: {
  duration: number;
  waveform: WaveformPoint[];
  width: number;
  mode: WaveformDisplayMode;
  finalizing?: boolean;
}) {
  const pyramid = useMemo(() => buildWaveformPyramid(props.waveform), [props.waveform]);
  const selectedLevel = useMemo(
    () => selectWaveformLevel(pyramid, props.duration, props.width),
    [pyramid, props.duration, props.width]
  );
  const points = pyramid[selectedLevel] ?? [];
  const paths = useMemo(
    () => buildWaveformPathSpecs(points, props.duration, props.width, props.mode),
    [points, props.duration, props.width, props.mode]
  );

  return (
    <g
      className={props.finalizing ? "waveform-static-layer is-finalizing" : "waveform-static-layer"}
      data-waveform-level={selectedLevel}
      data-waveform-points={points.length}
    >
      {paths.map((path) => (
        <path
          key={path.kind}
          className={`waveform-path waveform-path-${path.kind}`}
          data-waveform-path={path.kind}
          d={path.d}
          fill="none"
          stroke="#f2cf63"
          strokeWidth="1"
          opacity={path.opacity}
          pointerEvents="none"
        />
      ))}
    </g>
  );
});

const ProgressiveWaveformLayer = memo(function ProgressiveWaveformLayer(props: {
  duration: number;
  chunks: WaveformPoint[][];
  width: number;
  mode: WaveformDisplayMode;
  finalizing: boolean;
}) {
  return (
    <g
      className={props.finalizing ? "waveform-progressive-layer is-finalizing" : "waveform-progressive-layer"}
      data-waveform-chunks={props.chunks.length}
    >
      {props.chunks.map((chunk, index) => (
        <ProgressiveWaveformChunk
          key={index}
          points={chunk}
          duration={props.duration}
          width={props.width}
          mode={props.mode}
        />
      ))}
    </g>
  );
});

const ProgressiveWaveformChunk = memo(function ProgressiveWaveformChunk(props: {
  points: WaveformPoint[];
  duration: number;
  width: number;
  mode: WaveformDisplayMode;
}) {
  const paths = useMemo(
    () => buildWaveformPathSpecs(props.points, props.duration, props.width, props.mode),
    [props.points, props.duration, props.width, props.mode]
  );
  return paths.map((path) => (
    <path
      key={path.kind}
      className={`waveform-path waveform-path-${path.kind}`}
      data-waveform-path={`progressive-${path.kind}`}
      d={path.d}
      fill="none"
      stroke="#f2cf63"
      strokeWidth="1"
      opacity={path.opacity}
      pointerEvents="none"
    />
  ));
});

function SegmentTimeline(props: {
  duration: number;
  segment: Segment | null;
  currentTime: number;
  width: number;
  viewportRef: React.RefObject<HTMLDivElement>;
  onChange: (patch: Partial<Segment>) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const safeDuration = Math.max(0.001, props.duration);
  const segment = props.segment;
  const startX = segment ? (segment.start / safeDuration) * props.width : 0;
  const endX = segment ? (segment.end / safeDuration) * props.width : 0;
  return (
    <div className="segment-timeline timeline-row" style={{ width: props.width }}>
      <div className="segment-track" style={{ width: props.width }}>
        {segment ? (
          <>
            <div className="segment-range" style={{ left: startX, width: Math.max(2, endX - startX) }} />
            <DragHandle
              left={startX}
              label="start"
              width={props.width}
              duration={safeDuration}
              viewportRef={props.viewportRef}
              onEditingChange={props.onEditingChange}
              onChange={(time) => props.onChange({ start: clamp(time, 0, segment.end - MIN_SEGMENT_SECONDS), user_edited: true })}
            />
            <DragHandle
              left={endX}
              label="end"
              width={props.width}
              duration={safeDuration}
              viewportRef={props.viewportRef}
              onEditingChange={props.onEditingChange}
              onChange={(time) => props.onChange({ end: clamp(time, segment.start + MIN_SEGMENT_SECONDS, safeDuration), user_edited: true })}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function DragHandle(props: {
  left: number;
  label: string;
  width: number;
  duration: number;
  viewportRef: React.RefObject<HTMLDivElement>;
  onEditingChange: (editing: boolean) => void;
  onChange: (time: number) => void;
}) {
  const pointerIdRef = useRef<number | null>(null);
  const mouseDraggingRef = useRef(false);
  const updateFromClientX = (clientX: number) => {
    const viewport = props.viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left + viewport.scrollLeft;
    props.onChange((x / props.width) * props.duration);
  };
  const finishDrag = (target: HTMLButtonElement, pointerId: number) => {
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    pointerIdRef.current = null;
    props.onEditingChange(false);
  };

  return (
    <button
      className="drag-handle"
      style={{ left: props.left }}
      aria-label={props.label}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        pointerIdRef.current = event.pointerId;
        props.onEditingChange(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromClientX(event.clientX);
      }}
      onPointerMove={(event) => {
        if (pointerIdRef.current !== event.pointerId) return;
        event.preventDefault();
        updateFromClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        if (pointerIdRef.current !== event.pointerId) return;
        finishDrag(event.currentTarget, event.pointerId);
      }}
      onPointerCancel={(event) => {
        if (pointerIdRef.current !== event.pointerId) return;
        finishDrag(event.currentTarget, event.pointerId);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        mouseDraggingRef.current = true;
        props.onEditingChange(true);
        updateFromClientX(event.clientX);
        const move = (moveEvent: MouseEvent) => {
          if (!mouseDraggingRef.current) return;
          updateFromClientX(moveEvent.clientX);
        };
        const up = () => {
          mouseDraggingRef.current = false;
          props.onEditingChange(false);
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
    />
  );
}

function SegmentList(props: {
  segments: Segment[];
  selectedId: string | null;
  onSelect: (segment: Segment) => void;
  onToggle: (segment: Segment, checked: boolean) => void;
  onTitleChange: (segment: Segment, title: string) => void;
  onTranscript: (segment: Segment) => void;
}) {
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const selectedRow = selectedRowRef.current;
    if (!viewport || !selectedRow) return;

    const viewportRect = viewport.getBoundingClientRect();
    const rowRect = selectedRow.getBoundingClientRect();
    if (rowRect.top < viewportRect.top) {
      viewport.scrollTop -= viewportRect.top - rowRect.top;
    } else if (rowRect.bottom > viewportRect.bottom) {
      viewport.scrollTop += rowRect.bottom - viewportRect.bottom;
    }
  }, [props.selectedId]);

  return (
    <div className="segment-list">
      <table className="segment-list-table segment-list-header-table">
        <SegmentColumnGroup />
        <thead>
          <tr>
            <th>{tr("segments.export")}</th>
            <th>{tr("segments.title")}</th>
            <th>ID</th>
            <th>{tr("segments.start")}</th>
            <th>{tr("segments.end")}</th>
            <th>{tr("segments.duration")}</th>
            <th>{tr("segments.confidence")}</th>
            <th>{tr("segments.text")}</th>
          </tr>
        </thead>
      </table>
      <ScrollArea className="segment-list-body" viewportRef={viewportRef} scrollbars={["vertical"]}>
        <table className="segment-list-table segment-list-body-table">
          <SegmentColumnGroup />
          <tbody>
            {props.segments.map((segment) => (
              <tr
                key={segment.id}
                ref={segment.id === props.selectedId ? selectedRowRef : undefined}
                className={segment.id === props.selectedId ? "selected" : ""}
                onClick={() => props.onSelect(segment)}
              >
                <td>
                  <Checkbox
                    checked={segment.checked !== false}
                    onChange={(event) => props.onToggle(segment, event.currentTarget.checked)}
                    onClick={(event) => event.stopPropagation()}
                  />
                </td>
                <td>
                  <EditableTitleCell segment={segment} onChange={(title) => props.onTitleChange(segment, title)} />
                </td>
                <td>{segment.id}</td>
                <td>{formatTime(segment.start)}</td>
                <td>{formatTime(segment.end)}</td>
                <td>{formatTime(segment.end - segment.start)}</td>
                <td>{Math.round(segment.confidence * 100)}%</td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onTranscript(segment);
                    }}
                  >
                    {tr("common.view")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

function SegmentColumnGroup() {
  return (
    <colgroup>
      <col className="segment-col-export" />
      <col className="segment-col-title" />
      <col className="segment-col-id" />
      <col className="segment-col-time" />
      <col className="segment-col-time" />
      <col className="segment-col-duration" />
      <col className="segment-col-confidence" />
      <col className="segment-col-text" />
    </colgroup>
  );
}

function EditableTitleCell(props: { segment: Segment; onChange: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.segment.title?.trim() ?? "");
  const displayTitle = segmentTitle(props.segment);

  useEffect(() => {
    if (!editing) setDraft(props.segment.title?.trim() ?? "");
  }, [editing, props.segment.title]);

  const commit = (value = draft) => {
    props.onChange(value.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        className="title-edit-input"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.currentTarget.value)}
        onClick={(event) => event.stopPropagation()}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDraft(props.segment.title?.trim() ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="title-edit-button"
      title={tr("segments.editTitle")}
      onClick={(event) => {
        event.stopPropagation();
        setDraft(props.segment.title?.trim() ?? "");
        setEditing(true);
      }}
    >
      {displayTitle}
    </button>
  );
}

function TimestampCommentDialogs(props: {
  flow: TimestampCommentFlow;
  onClose: () => void;
  onSelect: (id: string) => void;
  onEditSelected: () => void;
  onDraftChange: (draft: string) => void;
  onBack: () => void;
  onApply: () => void;
}) {
  if (props.flow.mode === "closed") return null;

  if (props.flow.mode === "select") {
    const selectionFlow = props.flow;
    return (
      <Dialog open title={tr("timestamp.choose")} onClose={props.onClose}>
        <p className="dialog-message">
          {tr("timestamp.found")}
        </p>
        <div className="timestamp-comment-candidates" role="radiogroup" aria-label={tr("timestamp.candidates")}>
          {selectionFlow.candidates.map((candidate) => {
            const selected = candidate.id === selectionFlow.selectedId;
            return (
              <label
                className={selected ? "timestamp-comment-candidate selected" : "timestamp-comment-candidate"}
                key={`${candidate.source}:${candidate.id}`}
              >
                <input
                  type="radio"
                  name="timestamp-comment-candidate"
                  value={candidate.id}
                  checked={selected}
                  onChange={() => props.onSelect(candidate.id)}
                />
                <div className="timestamp-comment-candidate-content">
                  <div className="timestamp-comment-candidate-header">
                    <strong>{timestampCommentSourceLabel(candidate)}</strong>
                    <span>{candidate.author}</span>
                    <span>{tr("timestamp.timestamps", { count: candidate.timestamp_count })}</span>
                    {candidate.like_count !== null ? <span>{tr("timestamp.likes", { count: candidate.like_count })}</span> : null}
                  </div>
                  <ScrollArea
                    className="timestamp-comment-preview"
                    viewportClassName="timestamp-comment-preview-viewport"
                    scrollbars={["vertical"]}
                  >
                    <div className="timestamp-comment-preview-content">{candidate.text}</div>
                  </ScrollArea>
                </div>
              </label>
            );
          })}
        </div>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={props.onClose}>
            {tr("common.skip")}
          </Button>
          <Button onClick={props.onEditSelected}>{tr("timestamp.editSelected")}</Button>
        </div>
      </Dialog>
    );
  }

  const editFlow = props.flow;
  const candidate = editFlow.candidates.find((item) => item.id === editFlow.candidateId);
  if (!candidate) return null;
  return (
    <Dialog open title={tr("timestamp.edit", { source: timestampCommentSourceLabel(candidate) })} onClose={props.onClose}>
      <form
        className="timestamp-comment-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onApply();
        }}
      >
        <p className="dialog-message">
          {tr("timestamp.removeNonSongs")}
        </p>
        <Textarea
          className="timestamp-comment-editor"
          value={editFlow.draft}
          autoFocus
          onChange={(event) => props.onDraftChange(event.currentTarget.value)}
        />
        <div className="dialog-actions">
          <div>
            {editFlow.canGoBack ? (
              <Button type="button" variant="secondary" onClick={props.onBack}>
                {tr("common.back")}
              </Button>
            ) : null}
          </div>
          <div className="dialog-action-group">
            <Button type="button" variant="secondary" onClick={props.onClose}>
              {tr("common.cancel")}
            </Button>
            <Button type="submit">{tr("timestamp.apply")}</Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function timestampCommentSourceLabel(candidate: TimestampCommentCandidate) {
  return tr(candidate.source === "description" ? "timestamp.description" : "timestamp.comment");
}

function OutputDialog(props: {
  open: boolean;
  items: OutputItem[];
  estimate: SmartRenderEstimate | null;
  renderPlanState: ExportPlanState;
  error: string | null;
  filenameTemplate: string;
  createSourceFolder: boolean;
  sourceFolderName: string;
  onClose: () => void;
  onPreview: (item: OutputItem) => void;
  onFilenameTemplate: (value: string) => void;
  onCreateSourceFolder: (value: boolean) => void;
  onCheckRenderDetails: () => Promise<void>;
  onExport: () => Promise<void>;
}) {
  const renderPlans = new Map(props.renderPlanState.plan?.items.map((item) => [item.id, item]));
  return (
    <Dialog open={props.open} title={tr("output.review")} onClose={props.onClose}>
      <ExportCompatibilitySummary estimate={props.estimate} />
      <div className="output-options">
        <label className="output-template-field">
          <span>{tr("settings.filenameTemplate")}</span>
          <Input
            value={props.filenameTemplate}
            onChange={(event) => props.onFilenameTemplate(event.currentTarget.value)}
            aria-invalid={Boolean(props.error)}
            placeholder={DEFAULT_FILENAME_TEMPLATE}
          />
        </label>
        <div className="output-template-help">
          {tr("output.placeholders", { placeholders: FILENAME_TEMPLATE_PLACEHOLDERS.map((name) => `{${name}}`).join(", ") })}
        </div>
        {props.error ? <div className="output-template-error">{props.error}</div> : null}
        <label className="output-folder-option">
          <Checkbox
            checked={props.createSourceFolder}
            onChange={(event) => props.onCreateSourceFolder(event.currentTarget.checked)}
          />
          <span>{tr("output.createFolder", { name: props.sourceFolderName })}</span>
        </label>
      </div>
      <ScrollArea className="output-list" scrollbars={["vertical"]}>
        <SegmentReviewRows
          items={props.items.filter((item) => item.checked)}
          onPreview={props.onPreview}
          renderPlans={renderPlans}
          renderPlanStatus={props.renderPlanState.status}
          checkingItemId={props.renderPlanState.status === "loading" ? props.renderPlanState.currentId : null}
          defaultSuffix={props.estimate?.output_suffix ?? ".mp4"}
        />
      </ScrollArea>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={props.onClose}>
          {tr("common.back")}
        </Button>
        <div className="dialog-action-group">
          <Button
            variant="secondary"
            onClick={props.onCheckRenderDetails}
            disabled={props.renderPlanState.status === "loading"}
          >
            {props.renderPlanState.status === "loading"
              ? tr("output.checkingProgress", {
                  completed: props.renderPlanState.completed,
                  total: props.renderPlanState.total
                })
              : tr("output.checkDetails")}
          </Button>
          <Button
            onClick={props.onExport}
            disabled={Boolean(props.error) || props.items.length === 0 || props.renderPlanState.status === "loading"}
          >
            {tr("common.export")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function SegmentManagementDialog(props: {
  review: SegmentManagementReview | null;
  canPreview: boolean;
  onClose: () => void;
  onPreview: (item: OutputItem) => void;
  onConfirm: () => void;
}) {
  const review = props.review;
  return (
    <Dialog open={Boolean(review)} title={review?.title ?? tr("segments.management")} onClose={props.onClose}>
      {review ? (
        <>
          <p className="dialog-message">{review.message}</p>
          {review.kind === "sort" ? (
            <div className="segment-sort-comparison">
              <SegmentReviewPane label={tr("common.before")} items={review.before} canPreview={props.canPreview} onPreview={props.onPreview} />
              <SegmentReviewPane label={tr("common.after")} items={review.after} canPreview={props.canPreview} onPreview={props.onPreview} />
            </div>
          ) : (
            <ScrollArea className="output-list segment-management-list" scrollbars={["vertical"]}>
              <SegmentReviewRows items={review.items} onPreview={props.canPreview ? props.onPreview : undefined} />
            </ScrollArea>
          )}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={props.onClose}>{tr("common.cancel")}</Button>
            <Button variant={review.kind === "remove" ? "danger" : "default"} onClick={props.onConfirm}>
              {review.kind === "remove" ? review.confirmLabel : tr("segments.sort")}
            </Button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}

function SegmentReviewPane(props: {
  label: string;
  items: OutputItem[];
  canPreview: boolean;
  onPreview: (item: OutputItem) => void;
}) {
  return (
    <section className="segment-review-pane" aria-label={props.label}>
      <h3>{props.label}</h3>
      <ScrollArea className="segment-review-list" scrollbars={["vertical"]}>
        <SegmentReviewRows items={props.items} onPreview={props.canPreview ? props.onPreview : undefined} />
      </ScrollArea>
    </section>
  );
}

function SegmentReviewRows(props: {
  items: OutputItem[];
  onPreview?: (item: OutputItem) => void;
  renderPlans?: Map<string, ExportRenderPlanItem>;
  renderPlanStatus?: ExportPlanState["status"];
  checkingItemId?: string | null;
  defaultSuffix?: string;
}) {
  return (
    <div className="output-list-content">
      {props.items.map((item) => {
        const renderPlan = props.renderPlans?.get(item.id);
        const renderStatus: ExportPlanState["status"] = renderPlan
          ? "ready"
          : props.renderPlanStatus === "loading" && props.checkingItemId !== item.id
            ? "idle"
            : props.renderPlanStatus ?? "idle";
        const suffix = renderPlan?.output_suffix ?? props.defaultSuffix ?? ".mp4";
        return (
          <button
            key={item.id}
            className="output-row"
            onClick={() => props.onPreview?.(item)}
            disabled={!props.onPreview}
          >
            <span className="output-main">
              <span className="output-title-line">
                <span className="output-title">{item.title.trim() || item.segmentId || item.id}</span>
                {props.renderPlans || props.renderPlanStatus ? (
                  <ExportRenderBadge plan={renderPlan} status={renderStatus} />
                ) : null}
              </span>
              <span className="output-meta">
                ID: {item.segmentId || item.id} / {tr("output.file")}: {item.filename_stem}{suffix}
              </span>
              {renderPlan ? <span className="output-render-detail">{exportRenderDetail(renderPlan)}</span> : null}
            </span>
            <span className="output-time">
              {formatTime(item.start)} - {formatTime(item.end)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ExportRenderBadge(props: { plan?: ExportRenderPlanItem; status: ExportPlanState["status"] }) {
  if (props.status === "loading" && !props.plan) return <span className="render-badge render-badge-checking">{tr("output.checking")}</span>;
  if (props.status === "error") return <span className="render-badge render-badge-error">{tr("output.checkFailedBadge")}</span>;
  if (!props.plan) return <span className="render-badge render-badge-unchecked">{tr("output.notChecked")}</span>;
  return (
    <span className={`render-badge ${props.plan.smart_render ? "render-badge-smart" : "render-badge-reencode"}`}>
      {tr(props.plan.smart_render ? "output.smart" : "output.full")}
    </span>
  );
}

function ExportCompatibilitySummary(props: { estimate: SmartRenderEstimate | null }) {
  const estimate = props.estimate;
  if (!estimate) {
    return <div className="export-render-summary"><span className="render-badge render-badge-unknown">{tr("common.unknownTitle")}</span></div>;
  }
  return (
    <div className="export-render-summary">
      <span className={`render-badge ${estimate.smart_render ? "render-badge-smart" : "render-badge-reencode"}`}>
        {tr(estimate.smart_render ? "output.smartEstimate" : "output.fullEstimate")}
      </span>
      <span>
        {tr("output.estimateSummary", {
          container: estimate.source_container.toUpperCase(),
          codec: estimate.video_codec.toUpperCase() || tr("common.unknownTitle")
        })}
      </span>
    </div>
  );
}

function ExportRenderSummary(props: { state: ExportPlanState }) {
  const state = props.state;
  if (state.status === "loading") {
    return <div className="export-render-summary"><ExportRenderBadge status="loading" /><span>{tr("output.checkingSummary")}</span></div>;
  }
  if (state.status === "idle") return null;
  if (state.status === "error") {
    return (
      <div className="export-render-summary export-render-summary-error">
        <ExportRenderBadge status="error" />
        <span>{tr("output.checkFailed", { error: state.error })}</span>
      </div>
    );
  }
  if (!state.plan) return null;
  const smartCount = state.plan.items.filter((item) => item.smart_render).length;
  const reencodeCount = state.plan.items.length - smartCount;
  return (
    <div className="export-render-summary">
      {smartCount > 0 ? <span className="render-badge render-badge-smart">{tr("output.smartCount", { count: smartCount })}</span> : null}
      {reencodeCount > 0 ? <span className="render-badge render-badge-reencode">{tr("output.fullCount", { count: reencodeCount })}</span> : null}
      <span>{tr(reencodeCount === 0 ? "output.allSmart" : "output.mixed")}</span>
    </div>
  );
}

function exportRenderDetail(plan: ExportRenderPlanItem) {
  if (plan.smart_render) {
    return tr("output.smartDetail", { codec: plan.video_codec.toUpperCase(), copied: formatDuration(plan.copied_seconds), encoded: formatDuration(plan.encoded_seconds) });
  }
  if (plan.fallback_reason?.startsWith("no keyframe-aligned GOP")) {
    return tr("output.noGop");
  }
  if (plan.fallback_reason?.startsWith("unsupported smart-render codec/container")) {
    return tr("output.unsupported", { codec: plan.video_codec.toUpperCase() || tr("common.unknownTitle"), container: plan.container_family.toUpperCase() });
  }
  return plan.fallback_reason || tr("output.fullDetail");
}

function formatDuration(seconds: number) {
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function ExportProgressDialog(props: {
  open: boolean;
  job: JobRecord | null;
  estimate: SmartRenderEstimate | null;
  renderPlanState: ExportPlanState;
  onClose: () => void;
}) {
  const progress = clamp(props.job?.progress ?? 0, 0, 1);
  const status = props.job?.status ?? "queued";
  const complete = status === "completed";
  const failed = status === "failed";
  const actualRenderPlanState = actualExportPlanState(props.job);
  const checkedRenderPlanState = props.renderPlanState.status === "ready" ? props.renderPlanState : null;
  const progressRenderPlanState = actualRenderPlanState ?? checkedRenderPlanState;
  return (
    <Dialog open={props.open} title={tr("output.progress")} onClose={props.onClose}>
      <div className="export-progress">
        {progressRenderPlanState
          ? <ExportRenderSummary state={progressRenderPlanState} />
          : <ExportCompatibilitySummary estimate={props.estimate} />}
        <div className={`export-progress-status export-progress-status-${status}`}>
          <span>{localizeJobMessage(props.job) || tr("output.preparing")}</span>
          <strong>{Math.round(progress * 100)}%</strong>
        </div>
        <progress value={progress} max={1} />
        <div className="export-progress-note">
          {failed
            ? props.job?.error || tr("output.failed")
            : complete
              ? tr("output.complete")
              : tr("output.progressNote")}
        </div>
      </div>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={props.onClose}>
          {tr(complete || failed ? "common.close" : "common.hide")}
        </Button>
      </div>
    </Dialog>
  );
}

function actualExportPlanState(job: JobRecord | null): ExportPlanState | null {
  if (job?.status !== "completed" || !job.result || typeof job.result !== "object") return null;
  const exported = (job.result as { exported?: unknown }).exported;
  if (!Array.isArray(exported)) return null;
  const items: ExportRenderPlanItem[] = [];
  for (const result of exported) {
    if (!result || typeof result !== "object") return null;
    const row = result as { id?: unknown; smart_render_plan?: unknown };
    if (typeof row.id !== "string" || !row.smart_render_plan || typeof row.smart_render_plan !== "object") return null;
    const plan = row.smart_render_plan as Record<string, unknown>;
    const spans = Array.isArray(plan.spans) ? plan.spans : [];
    const copiedSeconds = spans.reduce((total, span) => {
      if (!span || typeof span !== "object") return total;
      const value = span as Record<string, unknown>;
      return value.mode === "copy" && typeof value.start === "number" && typeof value.end === "number"
        ? total + Math.max(0, value.end - value.start)
        : total;
    }, 0);
    const start = typeof plan.start === "number" ? plan.start : 0;
    const end = typeof plan.end === "number" ? plan.end : start;
    const fallbackReason = typeof plan.fallback_reason === "string" ? plan.fallback_reason : null;
    items.push({
      id: row.id,
      smart_render: fallbackReason === null,
      output_suffix: typeof plan.output_suffix === "string" ? plan.output_suffix : ".mp4",
      video_codec: typeof plan.video_codec === "string" ? plan.video_codec : "",
      container_family: typeof plan.container_family === "string" ? plan.container_family : "",
      copied_seconds: copiedSeconds,
      encoded_seconds: Math.max(0, end - start - copiedSeconds),
      fallback_reason: fallbackReason
    });
  }
  return { status: "ready", plan: { items }, error: null };
}

function FfmpegCheckDialog(props: {
  open: boolean;
  pending: boolean;
  result: FfmpegCheckResult | null;
  onClose: () => void;
}) {
  const downloadUrl = props.result?.download_url || FFMPEG_DOWNLOAD_URL;
  return (
    <Dialog open={props.open} title={tr("ffmpeg.title")} onClose={props.onClose}>
      <div className="ffmpeg-check">
        {props.pending ? (
          <p className="dialog-message">{tr("ffmpeg.checking")}</p>
        ) : props.result?.ok ? (
          <>
            <p className="dialog-message">{tr("ffmpeg.available")}</p>
            <div className="ffmpeg-check-paths">
              <span>ffmpeg</span>
              <code>{props.result.ffmpeg}</code>
              <span>ffprobe</span>
              <code>{props.result.ffprobe}</code>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-message">{tr("ffmpeg.missing")}</p>
            <pre className="ffmpeg-check-error">{props.result?.error || tr("ffmpeg.failed")}</pre>
            <a className="external-link" href={downloadUrl} target="_blank" rel="noreferrer">
              {tr("ffmpeg.download")}
            </a>
          </>
        )}
      </div>
      <div className="dialog-actions">
        <Button onClick={props.onClose}>{tr("common.ok")}</Button>
      </div>
    </Dialog>
  );
}

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

function segmentStopAtForTime(segment: Segment | null, time: number) {
  if (!segment || segment.end <= segment.start) return null;
  return time >= segment.start - 0.03 && time < segment.end - 0.03 ? segment.end : null;
}

function normalizeScratchPreviewMilliseconds(value: unknown, fallback = DEFAULT_SCRATCH_PREVIEW_MILLISECONDS) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clamp(Math.round(parsed), MIN_SCRATCH_PREVIEW_MILLISECONDS, MAX_SCRATCH_PREVIEW_MILLISECONDS)
    : fallback;
}

function readScratchPreviewMilliseconds() {
  try {
    return normalizeScratchPreviewMilliseconds(window.localStorage.getItem(SCRATCH_PREVIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_SCRATCH_PREVIEW_MILLISECONDS;
  }
}

function readScratchAudioProxyEnabled() {
  try {
    return normalizeScratchAudioProxyEnabled(window.localStorage.getItem(SCRATCH_AUDIO_PROXY_ENABLED_STORAGE_KEY));
  } catch {
    return true;
  }
}

function clampMediaTime(media: HTMLMediaElement, time: number) {
  const maximum = Number.isFinite(media.duration) && media.duration > 0 ? Math.max(0, media.duration - 0.001) : time;
  return clamp(time, 0, maximum);
}

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

function waitForMediaReady(media: HTMLMediaElement, timeoutMilliseconds: number) {
  if (media.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return waitForMediaEvent(media, "loadedmetadata", timeoutMilliseconds);
}

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

function readBoundarySecondsInput() {
  try {
    const stored = window.localStorage.getItem(BOUNDARY_SECONDS_STORAGE_KEY);
    return stored?.trim()
      ? formatBoundarySeconds(parseBoundarySeconds(stored))
      : formatBoundarySeconds(DEFAULT_BOUNDARY_SECONDS);
  } catch {
    return formatBoundarySeconds(DEFAULT_BOUNDARY_SECONDS);
  }
}

function readBoundaryNudgeSecondsInput() {
  try {
    const stored = window.localStorage.getItem(BOUNDARY_NUDGE_SECONDS_STORAGE_KEY);
    return stored?.trim()
      ? formatBoundaryNudgeSeconds(parseBoundaryNudgeSeconds(stored))
      : formatBoundaryNudgeSeconds(DEFAULT_BOUNDARY_NUDGE_SECONDS);
  } catch {
    return formatBoundaryNudgeSeconds(DEFAULT_BOUNDARY_NUDGE_SECONDS);
  }
}

function readVideoSplitPercent() {
  try {
    const stored = window.localStorage.getItem(VIDEO_SPLIT_STORAGE_KEY);
    return normalizeVideoSplitPercent(stored);
  } catch {
    return DEFAULT_VIDEO_SPLIT_PERCENT;
  }
}

function readWaveformDisplayMode(): WaveformDisplayMode {
  try {
    return normalizeWaveformDisplayMode(window.localStorage.getItem(WAVEFORM_DISPLAY_MODE_STORAGE_KEY));
  } catch {
    return "rms";
  }
}

function readCreateSourceFolder() {
  try {
    return window.localStorage.getItem(CREATE_SOURCE_FOLDER_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function waveformDisplayModeLabel(mode: WaveformDisplayMode) {
  switch (mode) {
    case "rms":
      return "RMS";
    case "peak":
      return tr("settings.peak");
    case "peak-rms":
      return tr("settings.peakRms");
  }
}

function normalizeVideoSplitPercent(value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return DEFAULT_VIDEO_SPLIT_PERCENT;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clamp(parsed, MIN_VIDEO_SPLIT_PERCENT, MAX_VIDEO_SPLIT_PERCENT)
    : DEFAULT_VIDEO_SPLIT_PERCENT;
}

function parseBoundarySeconds(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, 60) : DEFAULT_BOUNDARY_SECONDS;
}

function formatBoundarySeconds(value: number) {
  return String(Math.round(value));
}

function normalizeBoundarySecondsInput(value: string) {
  if (value.trim() === "") return "";
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return formatBoundarySeconds(parseBoundarySeconds(value));
  const digits = value.replace(/\D/g, "");
  return digits ? formatBoundarySeconds(parseBoundarySeconds(digits)) : "";
}

function parseBoundaryNudgeSeconds(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? clamp(Math.round(parsed * 10) / 10, MIN_SEGMENT_SECONDS, 60)
    : DEFAULT_BOUNDARY_NUDGE_SECONDS;
}

function formatBoundaryNudgeSeconds(value: number) {
  return parseBoundaryNudgeSeconds(String(value)).toFixed(1);
}

function segmentTitle(segment: Segment) {
  return segment.title?.trim() || segment.id;
}

function segmentDialogTitle(segment: Segment) {
  const title = segment.title?.trim();
  return title ? `${title} / ${segment.id}` : segment.id;
}

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

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function filenameWithoutExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).trim() || "video";
}

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
