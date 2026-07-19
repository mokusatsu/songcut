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
  normalizeInterruptedOperation,
  parseProjectOpenResult,
  parseRecoverySnapshot,
  parseSourceIdentity,
  transcriptSettingsAreStale
} from "@/lib/project";
import type {
  ProjectDocumentV1,
  ProjectOpenResult,
  ProjectOperation,
  RecoverySnapshot,
  SourceIdentity
} from "@/lib/project";
import { useProjectPersistence } from "@/lib/useProjectPersistence";
import {
  normalizeScratchAudioProxyEnabled,
  scratchProxyStatusLabel,
  selectScratchPreviewSource,
  shouldCreateScratchProxy
} from "@/lib/scratchProxy";
import { isEditorShortcutSuppressed, resolveEditorShortcut } from "@/lib/shortcuts";
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
  FfmpegCheckResult,
  JobRecord,
  ScratchProxyResult,
  Segment,
  Transcript,
  TimestampCommentCandidate,
  VideoInfo,
  WaveformDisplayMode,
  WaveformPoint
} from "@/types";

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

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const recoveryCheckedRef = useRef(false);
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
  const [job, setJob] = useState<JobRecord | null>(null);
  const [exportJob, setExportJob] = useState<JobRecord | null>(null);
  const [exportProgressOpen, setExportProgressOpen] = useState(false);
  const [transcriptionJob, setTranscriptionJob] = useState<JobRecord | null>(null);
  const [message, setMessage] = useState("");
  const [transcriptSegment, setTranscriptSegment] = useState<Segment | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
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
  const visibleTranscriptSegment = useMemo(
    () => (transcriptSegment ? segments.find((segment) => segment.id === transcriptSegment.id) ?? transcriptSegment : null),
    [segments, transcriptSegment]
  );
  const activeJob =
    exportJob && exportJob.status !== "completed" && exportJob.status !== "failed"
      ? exportJob
      : transcriptionJob && transcriptionJob.status !== "completed"
        ? transcriptionJob
        : job;
  const runningJob = [exportJob, transcriptionJob, job].find(isRunningJob) ?? null;
  const projectDocument = useMemo(
    () =>
      projectBase
        ? composeProjectDocument(projectBase, {
            revision: projectRevision,
            videoPath,
            duration,
            guideText,
            analysis,
            segments,
            exportCandidates,
            analysisDevice,
            whisper: whisperSettings,
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
      analysis,
      segments,
      exportCandidates,
      analysisDevice,
      whisperSettings,
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
  const whisperBusy = Boolean([transcriptionJob, job].find(isRunningJob));

  projectDocumentRef.current = projectDocument;

  function markProjectChanged() {
    if (projectBase && !projectReadOnly) setProjectRevision((revision) => revision + 1);
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
      setTranscriptionJob(nextJob);
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
  }, [apiBaseUrl, analysis?.transcription_job_id]);

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
    setSegments(document.segments.map((segment) => ({ ...segment })));
    setExportCandidates(exportCandidatesFromProject(document));
    setSelectedSegmentId(document.view_state.selected_segment_id ?? document.segments[0]?.id ?? null);
    setCurrentTime(document.view_state.current_time);
    setZoomIndex(clamp(document.view_state.zoom_index, 0, zoomLevels.length - 1));
    setAnalysisDevice(document.settings.analysis_device);
    setWhisperSettings({ ...document.settings.whisper });
    setTranscriptionJob(null);
    setTranscriptSegment(null);
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
    setSegments([]);
    setExportCandidates([]);
    setSelectedSegmentId(null);
    setTranscriptionJob(null);
    setTranscriptSegment(null);
    setCurrentTime(0);
    setAnalysisDevice("auto");
    setWhisperSettings({ ...DEFAULT_WHISPER_SETTINGS });
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
      if (scratchProxyConfigurationGenerationRef.current !== generation) {
        await cancelScratchProxy(apiBaseUrl, started.id).catch(() => undefined);
        return;
      }
      scratchProxyJobIdRef.current = started.id;
      const result = await waitForJob<ScratchProxyResult>(apiBaseUrl, started.id, () => undefined, 250);
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
    setJob(started);
    await waitForJob(apiBaseUrl, started.id, setJob);
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
    setTranscriptionJob(null);
    setProjectOperation({ kind: "analysis", status: "running" });
    markProjectChanged();
    const started = await startAnalysis(apiBaseUrl, videoPath, guideText, analysisDevice);
    setJob(started);
    try {
      const result = await waitForJob<AnalysisResult>(apiBaseUrl, started.id, setJob);
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
      setTranscriptionJob(started);
      const appliedTranscripts = new Map<string, string>();
      const result = await waitForJob<{ transcripts?: Transcript[] }>(apiBaseUrl, started.id, (nextJob) => {
        setTranscriptionJob(nextJob);
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

  async function exportClips(outputDir: string) {
    if (!apiBaseUrl || !videoPath) return;
    const outputItems = buildOutputItems();
    const items = outputItems.filter((item) => item.checked);
    const started = await startExport(apiBaseUrl, videoPath, outputDir, items, buildTimestampCommentText(items));
    setOutputOpen(false);
    setExportProgressOpen(true);
    setExportJob(started);
    setJob(started);
    setProjectOperation({ kind: "export", status: "running" });
    markProjectChanged();
    try {
      await waitForJob(apiBaseUrl, started.id, (nextJob) => {
        setJob(nextJob);
        setExportJob(nextJob);
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

  async function exportTimestampComments() {
    const items = buildOutputItems().filter((item) => item.checked);
    const text = buildTimestampCommentText(items);
    if (!text) {
      setMessage("No checked segments to copy.");
      return;
    }
    try {
      window.songcut.writeClipboard(text);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setTimestampCopyCount(items.length);
    setMessage(`Copied ${items.length} TS comment lines.`);
  }

  function updateSegment(id: string, patch: Partial<Segment>) {
    setSegments((current) => current.map((segment) => (segment.id === id ? { ...segment, ...patch } : segment)));
    markProjectChanged();
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
      hasSelectedSegment: Boolean(videoUrl && selectedSegment),
      hasCheckedSegments: checkedCount > 0,
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
    checkedCount,
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
          if (checkedCount > 0) setOutputOpen(true);
          break;
        case "export-ts-text":
          void exportTimestampComments();
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
    segments,
    checkedCount,
    currentTime,
    boundarySecondsInput,
    boundaryNudgeSecondsInput,
    zoomIndex,
    whisperSettings,
    projectPath,
    projectBase,
    projectOperation
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
              Load
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
            <span>Source missing — saved guide, segments, waveform, and transcripts remain available.</span>
            <Button size="sm" variant="secondary" onClick={() => void relinkSource().catch((error) => setMessage(String(error)))}>
              Relink
            </Button>
          </div>
        ) : null}
        <header className="toolbar">
          <Button onClick={selectVideo}>
            <FolderOpen size={16} />
            Load
          </Button>
          <Button onClick={() => void analyze().catch((error) => setMessage(String(error)))} disabled={!sourceAvailable || !apiBaseUrl}>
            <Wand2 size={16} />
            Analyze
          </Button>
          <Button variant="secondary" onClick={() => setOutputOpen(true)} disabled={checkedCount === 0 || !sourceAvailable}>
            <Scissors size={16} />
            Export
          </Button>
          <Button variant="secondary" onClick={exportTimestampComments} disabled={checkedCount === 0}>
            <Copy size={16} />
            Export TS
          </Button>
          <Button variant="secondary" onClick={openSettings}>
            <Settings2 size={16} />
            Settings
          </Button>
          <div className="spacer" />
          <span className={`project-save-status status-${persistence.status}`}>
            {projectReadOnly ? "Read only" : projectSaveStatusLabel(persistence.status)}
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
            placeholder="Paste timestamp comment here"
          />
          <StatusPanel job={activeJob} message={message} videoInfo={videoInfo} scratchProxyState={scratchProxyState} />
        </div>
        <TimelineStack
          duration={duration}
          waveform={analysis?.waveform ?? []}
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
            <span>Model: {visibleTranscriptSegment.transcript.model_id}</span>
            <span>
              Language: {visibleTranscriptSegment.transcript.language_requested ?? "unknown"} → {visibleTranscriptSegment.transcript.language ?? "unknown"}
            </span>
            <span>
              Device: {visibleTranscriptSegment.transcript.device_requested ?? "unknown"} → {visibleTranscriptSegment.transcript.device_used}
            </span>
          </div>
        ) : null}
        <pre className="transcript-text">
          {visibleTranscriptSegment?.transcript?.text || "Transcript has not been generated yet."}
        </pre>
        {visibleTranscriptSegment?.transcript?.error ? (
          <p className="transcript-error">Latest transcription attempt failed: {visibleTranscriptSegment.transcript.error}</p>
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
        items={buildOutputItems()}
        onClose={() => setOutputOpen(false)}
        onPreview={(item) => previewRange(videoRef.current, item.start, item.end)}
        onExport={async () => {
          const dir = await window.songcut.selectOutputDirectory();
          if (dir) await exportClips(dir);
        }}
      />
      <Dialog open={timestampCopyCount !== null} title="Export TS" onClose={() => setTimestampCopyCount(null)}>
        <p className="dialog-message">
          {`Copied ${timestampCopyCount ?? 0} timestamp ${timestampCopyCount === 1 ? "line" : "lines"} to the clipboard.`}
        </p>
        <div className="dialog-actions">
          <Button onClick={() => setTimestampCopyCount(null)}>OK</Button>
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
        whisperSettings={whisperSettings}
        whisperStatus={whisperStatus}
        whisperBusy={whisperBusy}
        hasSegments={segments.length > 0}
        transcriptStale={transcriptStale}
        sourceAvailable={sourceAvailable}
        onClose={closeSettings}
        onScratchPreviewMillisecondsInput={setScratchPreviewMillisecondsInput}
        onScratchAudioProxyEnabled={(enabled) => {
          setScratchAudioProxyEnabled(enabled);
          setMessage(`Scratch audio proxy ${enabled ? "enabled" : "disabled"}.`);
        }}
        onWaveformDisplayMode={(mode) => {
          setWaveformDisplayMode(mode);
          setMessage(`Waveform display set to ${waveformDisplayModeLabel(mode)}.`);
        }}
        onAnalysisDevice={(device) => {
          setAnalysisDevice(device);
          markProjectChanged();
          setMessage(`Singing analysis device set to ${deviceLabel(device)}.`);
        }}
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
      />
      <ExportProgressDialog open={exportProgressOpen} job={exportJob} onClose={() => setExportProgressOpen(false)} />
      <Dialog open={whisperPreflightOpen} title="Whisper model is not ready" onClose={() => setWhisperPreflightOpen(false)}>
        <p className="dialog-message">
          {`The selected ${whisperSettings.model} model is not installed. Downloading is always an explicit action.`}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setWhisperPreflightOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setWhisperPreflightOpen(false);
              void runAnalysis(false).catch((error) => setMessage(String(error)));
            }}
          >
            Analyze without transcription
          </Button>
          <Button
            onClick={() => {
              setWhisperPreflightOpen(false);
              void ensureWhisper()
                .then(() => runAnalysis(true))
                .catch((error) => setMessage(String(error)));
            }}
          >
            Download &amp; Analyze
          </Button>
        </div>
      </Dialog>
      <Dialog open={recoveryOpen} title="Recover unsaved songcut edits?" onClose={() => undefined}>
        <p className="dialog-message">
          {recoveryCandidate
            ? `${recoveryCandidate.document.source.filename} has a recovery snapshot from ${new Date(recoveryCandidate.saved_at).toLocaleString()} at revision ${recoveryCandidate.document.revision}.`
            : "A recovery snapshot is available."}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => void discardRecovery().catch((error) => setMessage(String(error)))}>
            Discard
          </Button>
          <Button onClick={() => void recoverProject().catch((error) => setMessage(String(error)))}>Recover</Button>
        </div>
      </Dialog>
      <Dialog open={Boolean(switchSaveFailure)} title="Could not save the current project" onClose={() => setSwitchSaveFailure(null)}>
        <p className="dialog-message">
          {switchSaveFailure
            ? `${switchSaveFailure.error} ${
                switchSaveFailure.recoverySaved
                  ? "A recovery snapshot is available, but it would be replaced after switching videos."
                  : "The recovery snapshot could not be updated either."
              }`
            : "The current project could not be saved."}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setSwitchSaveFailure(null)}>
            Cancel
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
            Retry
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
            Discard changes
          </Button>
        </div>
      </Dialog>
      <Dialog open={Boolean(relinkConflict)} title="Project already exists at relink destination" onClose={() => setRelinkConflict(null)}>
        <p className="dialog-message">
          {relinkConflict?.damaged
            ? "The destination sidecar is damaged or uses an unsupported schema. It will not be overwritten unless you explicitly archive it as a timestamped conflict."
            : "A project already exists beside the selected source. Open it, replace it with the current project, or cancel."}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setRelinkConflict(null)}>
            Cancel
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
              Open existing
            </Button>
          ) : null}
          <Button
            onClick={() => {
              const conflict = relinkConflict;
              if (!conflict) return;
              void completeRelink(conflict, conflict.damaged).catch((error) => setMessage(String(error)));
            }}
          >
            {relinkConflict?.damaged ? "Archive conflict & replace" : "Replace with current"}
          </Button>
        </div>
      </Dialog>
      <Dialog open={quitConfirmOpen} title="Quit songcut?" onClose={cancelQuit}>
        <p className="dialog-message">
          {runningJob
            ? `${jobKindLabel(runningJob.kind)} is still running. Quitting now will stop the task and any external processes it started.`
            : "A task is still running. Quitting now will stop it."}
        </p>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={cancelQuit}>
            Cancel
          </Button>
          <Button onClick={() => void confirmQuit()}>Quit anyway</Button>
        </div>
      </Dialog>
    </main>
  );
}

function offlineVideoInfo(document: ProjectDocumentV1): VideoInfo {
  return {
    path: document.source.absolute_path,
    name: document.source.filename,
    duration: document.source.duration_seconds,
    bit_rate: 0,
    video: {},
    audio: {},
    timestamp_comment_candidates: [],
    info_json_warning: "Source media is missing."
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
      return "Saved";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "recovery-only":
      return "Recovery only";
    case "save-failed":
      return "Save failed";
    case "read-only":
      return "Read only";
  }
}

function isRunningJob(job: JobRecord | null | undefined): job is JobRecord {
  return job?.status === "queued" || job?.status === "running";
}

function jobKindLabel(kind: string) {
  if (kind === "analysis") return "Analysis";
  if (kind === "transcription") return "Transcription";
  if (kind === "export") return "Export";
  if (kind === "download-whisper") return "Whisper model download";
  return "A task";
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
        title="Play start boundary (A)"
        aria-keyshortcuts="A"
      >
        <SkipBack size={17} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={props.onEnd}
        disabled={props.disabled}
        title="Play end boundary (D)"
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
        aria-label="Boundary seconds"
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
        title="Nudge nearest boundary left (Q)"
        aria-keyshortcuts="Q"
      >
        <ArrowLeft size={17} />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={props.onRight}
        disabled={props.disabled}
        title="Nudge nearest boundary right (E)"
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
        aria-label="Boundary nudge seconds"
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
      <Button size="icon" variant="ghost" onClick={props.onStart} title="Start">
        <Rewind size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onPrev} title="Previous boundary (Ctrl+A)" aria-keyshortcuts="Control+A">
        <ChevronsLeft size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onPlay} title="Play (Space)" aria-keyshortcuts="Space">
        <Play size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onPause} title="Pause (Space)" aria-keyshortcuts="Space">
        <Pause size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onNext} title="Next boundary (Ctrl+D)" aria-keyshortcuts="Control+D">
        <ChevronsRight size={17} />
      </Button>
    </div>
  );
}

function ZoomControls(props: { zoom: number; onIn: () => void; onOut: () => void; onReset: () => void }) {
  return (
    <div className="icon-group">
      <Button size="icon" variant="ghost" onClick={props.onOut} title="Zoom out (Z)" aria-keyshortcuts="Z">
        <Minus size={17} />
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onReset} title="100% zoom (X)" aria-keyshortcuts="X">
        {props.zoom * 100}%
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onIn} title="Zoom in (C)" aria-keyshortcuts="C">
        <Plus size={17} />
      </Button>
    </div>
  );
}

function StatusPanel({
  job,
  message,
  videoInfo,
  scratchProxyState
}: {
  job: JobRecord | null;
  message: string;
  videoInfo: VideoInfo | null;
  scratchProxyState: ScratchProxyState;
}) {
  return (
    <aside className="status-panel">
      <div className="status-main">
        {job?.status === "completed" ? <CheckCircle2 size={16} /> : null}
        <span>{job?.message || message || "Idle"}</span>
      </div>
      {job ? <progress value={job.progress} max={1} /> : null}
      {videoInfo ? (
        <>
          <div className="meta-line">
            {formatTime(videoInfo.duration)} / {videoInfo.video.width}x{videoInfo.video.height} / {videoInfo.video.codec}
          </div>
          <div className="meta-line" data-scratch-proxy-status={scratchProxyState}>
            {scratchProxyStatusLabel(scratchProxyState)}
          </div>
        </>
      ) : null}
    </aside>
  );
}

function TimelineStack(props: {
  duration: number;
  waveform: WaveformPoint[];
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
        <StaticWaveformLayer
          duration={props.duration}
          waveform={props.waveform}
          width={props.width}
          mode={props.waveformDisplayMode}
        />
      </svg>
    </div>
  );
}

const StaticWaveformLayer = memo(function StaticWaveformLayer(props: {
  duration: number;
  waveform: WaveformPoint[];
  width: number;
  mode: WaveformDisplayMode;
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
    <g className="waveform-static-layer" data-waveform-level={selectedLevel} data-waveform-points={points.length}>
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
            <th>Export</th>
            <th>Title</th>
            <th>ID</th>
            <th>Start</th>
            <th>End</th>
            <th>Duration</th>
            <th>Confidence</th>
            <th>Text</th>
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
                    View
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
      title="Edit title"
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
      <Dialog open title="Choose timestamp guide" onClose={props.onClose}>
        <p className="dialog-message">
          Timestamp guides were found in the yt-dlp metadata. Choose the version you want to review and edit.
        </p>
        <div className="timestamp-comment-candidates" role="radiogroup" aria-label="Timestamp guide candidates">
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
                    <span>{candidate.timestamp_count} timestamps</span>
                    {candidate.like_count !== null ? <span>{candidate.like_count} likes</span> : null}
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
            Skip
          </Button>
          <Button onClick={props.onEditSelected}>Edit selected</Button>
        </div>
      </Dialog>
    );
  }

  const editFlow = props.flow;
  const candidate = editFlow.candidates.find((item) => item.id === editFlow.candidateId);
  if (!candidate) return null;
  return (
    <Dialog open title={`Edit ${timestampCommentSourceLabel(candidate).toLowerCase()}`} onClose={props.onClose}>
      <form
        className="timestamp-comment-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          props.onApply();
        }}
      >
        <p className="dialog-message">
          Remove timestamps that do not mark songs, such as the stream start, MC, promotions, chat, or announcements.
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
                Back
              </Button>
            ) : null}
          </div>
          <div className="dialog-action-group">
            <Button type="button" variant="secondary" onClick={props.onClose}>
              Cancel
            </Button>
            <Button type="submit">Apply to guide</Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function timestampCommentSourceLabel(candidate: TimestampCommentCandidate) {
  return candidate.source === "description" ? "Video description" : "Comment";
}

function OutputDialog(props: {
  open: boolean;
  items: OutputItem[];
  onClose: () => void;
  onPreview: (item: OutputItem) => void;
  onExport: () => Promise<void>;
}) {
  return (
    <Dialog open={props.open} title="Export Review" onClose={props.onClose}>
      <ScrollArea className="output-list" scrollbars={["vertical"]}>
        <div className="output-list-content">
          {props.items
            .filter((item) => item.checked)
            .map((item) => (
              <button key={item.id} className="output-row" onClick={() => props.onPreview(item)}>
                <span className="output-main">
                  <span className="output-title">{item.title.trim() || item.segmentId || item.id}</span>
                  <span className="output-meta">
                    ID: {item.segmentId || item.id} / File: {item.filename_stem}.mp4
                  </span>
                </span>
                <span className="output-time">
                  {formatTime(item.start)} - {formatTime(item.end)}
                </span>
              </button>
            ))}
        </div>
      </ScrollArea>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={props.onClose}>
          Back
        </Button>
        <Button onClick={props.onExport}>Export</Button>
      </div>
    </Dialog>
  );
}

function ExportProgressDialog(props: { open: boolean; job: JobRecord | null; onClose: () => void }) {
  const progress = clamp(props.job?.progress ?? 0, 0, 1);
  const status = props.job?.status ?? "queued";
  const complete = status === "completed";
  const failed = status === "failed";
  return (
    <Dialog open={props.open} title="Export Progress" onClose={props.onClose}>
      <div className="export-progress">
        <div className={`export-progress-status export-progress-status-${status}`}>
          <span>{props.job?.message || "Preparing smart rendering."}</span>
          <strong>{Math.round(progress * 100)}%</strong>
        </div>
        <progress value={progress} max={1} />
        <div className="export-progress-note">
          {failed
            ? props.job?.error || "Export failed."
            : complete
              ? "Export complete."
              : "Smart rendering is using ffprobe keyframes and re-encoding only the required GOP edges."}
        </div>
      </div>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={props.onClose}>
          {complete || failed ? "Close" : "Hide"}
        </Button>
      </div>
    </Dialog>
  );
}

function FfmpegCheckDialog(props: {
  open: boolean;
  pending: boolean;
  result: FfmpegCheckResult | null;
  onClose: () => void;
}) {
  const downloadUrl = props.result?.download_url || FFMPEG_DOWNLOAD_URL;
  return (
    <Dialog open={props.open} title="ffmpeg Check" onClose={props.onClose}>
      <div className="ffmpeg-check">
        {props.pending ? (
          <p className="dialog-message">Checking ffmpeg.exe and ffprobe.exe.</p>
        ) : props.result?.ok ? (
          <>
            <p className="dialog-message">ffmpeg.exe and ffprobe.exe are available.</p>
            <div className="ffmpeg-check-paths">
              <span>ffmpeg</span>
              <code>{props.result.ffmpeg}</code>
              <span>ffprobe</span>
              <code>{props.result.ffprobe}</code>
            </div>
          </>
        ) : (
          <>
            <p className="dialog-message">ffmpeg.exe and ffprobe.exe were not found.</p>
            <pre className="ffmpeg-check-error">{props.result?.error || "ffmpeg check failed."}</pre>
            <a className="external-link" href={downloadUrl} target="_blank" rel="noreferrer">
              Open ffmpeg download page
            </a>
          </>
        )}
      </div>
      <div className="dialog-actions">
        <Button onClick={props.onClose}>OK</Button>
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

function buildTimestampCommentText(items: OutputItem[]) {
  return items
    .map((item) => {
      const title = item.title.trim() || item.segmentId || item.id;
      return `${formatTime(item.start)} - ${formatTime(item.end)} ${title}`;
    })
    .join("\n");
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

function waveformDisplayModeLabel(mode: WaveformDisplayMode) {
  switch (mode) {
    case "rms":
      return "RMS";
    case "peak":
      return "Peak Envelope";
    case "peak-rms":
      return "Peak + RMS";
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

function deviceLabel(device: AnalysisDevice | WhisperDevice) {
  switch (device) {
    case "auto":
      return "Auto";
    case "npu":
      return "NPU";
    case "gpu":
      return "GPU";
    case "cpu":
      return "CPU";
  }
}
