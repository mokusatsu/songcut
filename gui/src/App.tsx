import { useEffect, useMemo, useRef, useState } from "react";
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
import { checkFfmpeg, probeVideo, startAnalysis, startExport, startWhisperDownload, waitForJob } from "@/lib/api";
import type { AnalysisDevice, WhisperDevice } from "@/lib/api";
import type {
  AnalysisResult,
  ExportCandidate,
  FfmpegCheckResult,
  JobRecord,
  Segment,
  Transcript,
  VideoInfo,
  WaveformPoint
} from "@/types";

const zoomLevels = [1, 2, 4, 8, 16, 32];
const MIN_SEGMENT_SECONDS = 0.1;
const DEFAULT_SCRATCH_PREVIEW_MILLISECONDS = 100;
const MIN_SCRATCH_PREVIEW_MILLISECONDS = 1;
const MAX_SCRATCH_PREVIEW_MILLISECONDS = 5000;
const SCRATCH_PREVIEW_STORAGE_KEY = "songcut:scratch-preview-milliseconds";
const FFMPEG_DOWNLOAD_URL = "https://www.ffmpeg.org/download.html";
const videoExtensions = new Set([".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".mpg", ".mpeg"]);

type BoundaryEdge = "start" | "end";
type BoundaryTarget = {
  segmentId: string;
  edge: BoundaryEdge;
};

type OutputItem = {
  id: string;
  segmentId: string;
  title: string;
  filename_stem: string;
  start: number;
  end: number;
  checked: boolean;
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackStopAtRef = useRef<number | null>(null);
  const scratchPreviewTimeRef = useRef<number | null>(null);
  const scratchPreviewTimerRef = useRef<number | null>(null);
  const scratchPreviewGenerationRef = useRef(0);
  const selectedSegmentRef = useRef<Segment | null>(null);
  const runningJobRef = useRef<JobRecord | null>(null);
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [guideText, setGuideText] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [exportCandidates, setExportCandidates] = useState<ExportCandidate[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [boundarySecondsInput, setBoundarySecondsInput] = useState("5");
  const [boundaryNudgeSecondsInput, setBoundaryNudgeSecondsInput] = useState("0.1");
  const [scratchPreviewMilliseconds, setScratchPreviewMilliseconds] = useState(readScratchPreviewMilliseconds);
  const [scratchPreviewMillisecondsInput, setScratchPreviewMillisecondsInput] = useState(
    String(DEFAULT_SCRATCH_PREVIEW_MILLISECONDS)
  );
  const [scratchSettingsOpen, setScratchSettingsOpen] = useState(false);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [segmentFocusRequest, setSegmentFocusRequest] = useState(0);
  const [waveformSeeking, setWaveformSeeking] = useState(false);
  const [handleEditing, setHandleEditing] = useState(false);
  const [split, setSplit] = useState(52);
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
  const [whisperDevice, setWhisperDevice] = useState<WhisperDevice>("auto");

  const selectedSegment = useMemo(
    () => segments.find((segment) => segment.id === selectedSegmentId) ?? segments[0] ?? null,
    [segments, selectedSegmentId]
  );
  const duration = videoInfo?.duration ?? analysis?.duration ?? videoRef.current?.duration ?? 0;
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
    if (scratchSettingsOpen) setScratchPreviewMillisecondsInput(String(scratchPreviewMilliseconds));
  }, [scratchSettingsOpen, scratchPreviewMilliseconds]);

  useEffect(() => {
    runningJobRef.current = runningJob;
  }, [runningJob]);

  useEffect(() => {
    window.songcut.apiBaseUrl().then(setApiBaseUrl).catch((error) => setMessage(String(error)));
  }, []);

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
    return window.songcut.onCloseRequested(() => {
      if (runningJobRef.current) {
        setQuitConfirmOpen(true);
        return;
      }
      void window.songcut.confirmClose();
    });
  }, []);

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

  async function loadVideo(filePath: string) {
    if (!apiBaseUrl) return;
    setMessage("Loading video.");
    const [info, fileUrl] = await Promise.all([probeVideo(apiBaseUrl, filePath), window.songcut.fileUrl(filePath)]);
    setVideoPath(filePath);
    setVideoUrl(fileUrl);
    setVideoInfo(info);
    setAnalysis(null);
    setSegments([]);
    setExportCandidates([]);
    setSelectedSegmentId(null);
    setTranscriptionJob(null);
    setTranscriptSegment(null);
    setCurrentTime(0);
    setMessage("Video loaded.");
  }

  async function selectVideo() {
    const filePath = await window.songcut.selectVideo();
    if (!filePath) return;
    await loadVideo(filePath).catch((error) => setMessage(String(error)));
  }

  async function ensureWhisper() {
    if (!apiBaseUrl) return;
    const started = await startWhisperDownload(apiBaseUrl);
    setJob(started);
    await waitForJob(apiBaseUrl, started.id, setJob);
    setMessage("Whisper small model is ready.");
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
    if (!apiBaseUrl || !videoPath) return;
    setTranscriptionJob(null);
    const started = await startAnalysis(apiBaseUrl, videoPath, guideText, analysisDevice, whisperDevice);
    setJob(started);
    const result = await waitForJob<AnalysisResult>(apiBaseUrl, started.id, setJob);
    const nextSegments = result.segments.map((segment) => ({ ...segment, checked: true }));
    setAnalysis(result);
    setSegments(nextSegments);
    setExportCandidates(result.export_candidates);
    setSelectedSegmentId(nextSegments[0]?.id ?? null);
    setMessage(
      result.transcription_job_id
        ? `Detected ${nextSegments.length} segments. Transcribing in background.`
        : `Detected ${nextSegments.length} segments.`
    );
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
    try {
      await waitForJob(apiBaseUrl, started.id, (nextJob) => {
        setJob(nextJob);
        setExportJob(nextJob);
      });
      setMessage("Export complete.");
    } catch (error) {
      setMessage(`Export failed: ${String(error)}`);
    }
  }

  function cancelQuit() {
    setQuitConfirmOpen(false);
    void window.songcut.cancelClose();
  }

  function confirmQuit() {
    setQuitConfirmOpen(false);
    void window.songcut.confirmClose();
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
  }

  function applyTranscriptResult(result: unknown) {
    const transcripts = (result as { transcripts?: Transcript[] } | null | undefined)?.transcripts;
    if (Array.isArray(transcripts)) applyTranscripts(transcripts);
  }

  function applyTranscripts(transcripts: Transcript[]) {
    if (!transcripts.length) return;
    const transcriptMap = new Map(transcripts.map((transcript) => [transcript.segment_id, transcript]));
    setSegments((current) =>
      current.map((segment) => {
        const transcript = transcriptMap.get(segment.id);
        return transcript ? { ...segment, transcript } : segment;
      })
    );
  }

  function cancelScratchPreview(restorePosition: boolean) {
    scratchPreviewGenerationRef.current += 1;
    if (scratchPreviewTimerRef.current !== null) {
      window.clearTimeout(scratchPreviewTimerRef.current);
      scratchPreviewTimerRef.current = null;
    }
    const target = scratchPreviewTimeRef.current;
    scratchPreviewTimeRef.current = null;
    if (target === null) return;
    const video = videoRef.current;
    if (!video) return;
    video.pause();
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
    void video
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

  function saveScratchPreviewMilliseconds() {
    const milliseconds = normalizeScratchPreviewMilliseconds(
      scratchPreviewMillisecondsInput,
      scratchPreviewMilliseconds
    );
    setScratchPreviewMilliseconds(milliseconds);
    setScratchPreviewMillisecondsInput(String(milliseconds));
    setScratchSettingsOpen(false);
    setMessage(`Scratch preview duration set to ${milliseconds} ms.`);
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
    const target = nearestBoundaryTarget(segments, currentTime);
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
    const videoFile = files.find((file) => videoExtensions.has(extensionOf(file.name)));
    if (!videoFile) {
      setMessage("Drop a video file.");
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
      hasVideo: Boolean(videoUrl),
      hasSegments: segments.length > 0,
      hasSelectedSegment: Boolean(videoUrl && selectedSegment),
      hasCheckedSegments: checkedCount > 0,
      playing,
      zoomIndex,
      analysisDevice,
      whisperDevice
    });
  }, [
    apiBaseUrl,
    videoUrl,
    segments.length,
    selectedSegment?.id,
    checkedCount,
    playing,
    zoomIndex,
    analysisDevice,
    whisperDevice
  ]);

  useEffect(() => {
    return window.songcut.onMenuCommand((command) => {
      switch (command.type) {
        case "load-movie":
          void selectVideo();
          break;
        case "nudge-boundary-left":
          nudgeNearestBoundary(-1);
          break;
        case "nudge-boundary-right":
          nudgeNearestBoundary(1);
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
        case "configure-scratch-preview":
          setScratchSettingsOpen(true);
          break;
        case "prepare-whisper-model":
          void ensureWhisper().catch((error) => setMessage(String(error)));
          break;
        case "set-analysis-device":
          setAnalysisDevice(command.device);
          setMessage(`Singing analysis device set to ${deviceLabel(command.device)}.`);
          break;
        case "set-whisper-device":
          setWhisperDevice(command.device);
          setMessage(`Whisper device set to ${deviceLabel(command.device)}.`);
          break;
        case "ffmpeg-check":
          void runFfmpegCheck(true);
          break;
      }
    });
  }, [apiBaseUrl, videoUrl, selectedSegment?.id, segments, checkedCount, currentTime, boundarySecondsInput, boundaryNudgeSecondsInput, zoomIndex]);

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
            setSplit(clamp(startSplit + delta, 32, 72));
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
        <header className="toolbar">
          <Button onClick={selectVideo}>
            <FolderOpen size={16} />
            Load
          </Button>
          <Button onClick={analyze} disabled={!videoPath || !apiBaseUrl}>
            <Wand2 size={16} />
            Analyze
          </Button>
          <Button variant="secondary" onClick={() => setOutputOpen(true)} disabled={checkedCount === 0}>
            <Scissors size={16} />
            Export
          </Button>
          <Button variant="secondary" onClick={exportTimestampComments} disabled={checkedCount === 0}>
            <Copy size={16} />
            Export TS
          </Button>
          <div className="spacer" />
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
          <Textarea value={guideText} onChange={(event) => setGuideText(event.target.value)} placeholder="Paste guide text" />
          <StatusPanel job={activeJob} message={message} videoInfo={videoInfo} />
        </div>
        <TimelineStack
          duration={duration}
          waveform={analysis?.waveform ?? []}
          segments={segments}
          selectedSegment={selectedSegment}
          currentTime={currentTime}
          playing={playing}
          zoom={zoom}
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
          onSelect={(segment) => {
            setSelectedSegmentId(segment.id);
            setSegmentFocusRequest((request) => request + 1);
            seek(segment.start);
          }}
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
        <pre className="transcript-text">
          {visibleTranscriptSegment?.transcript?.error
            ? visibleTranscriptSegment.transcript.error
            : visibleTranscriptSegment?.transcript?.text || "Transcript has not been generated yet."}
        </pre>
      </Dialog>
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
          {`クリップボードにコピーしました。${timestampCopyCount ?? 0}件のタイムスタンプ行を含みます。`}
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
      <Dialog open={scratchSettingsOpen} title="Scratch Preview Duration" onClose={() => setScratchSettingsOpen(false)}>
        <form
          className="scratch-duration-setting"
          onSubmit={(event) => {
            event.preventDefault();
            saveScratchPreviewMilliseconds();
          }}
        >
          <label htmlFor="scratch-preview-milliseconds">Playback duration in milliseconds</label>
          <div className="scratch-duration-input-row">
            <Input
              id="scratch-preview-milliseconds"
              type="number"
              min={MIN_SCRATCH_PREVIEW_MILLISECONDS}
              max={MAX_SCRATCH_PREVIEW_MILLISECONDS}
              step="1"
              inputMode="numeric"
              value={scratchPreviewMillisecondsInput}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setScratchPreviewMillisecondsInput(event.currentTarget.value)}
            />
            <span>ms</span>
          </div>
          <p className="dialog-message">
            Enter a value from {MIN_SCRATCH_PREVIEW_MILLISECONDS} to {MAX_SCRATCH_PREVIEW_MILLISECONDS} milliseconds.
          </p>
          <div className="dialog-actions">
            <Button type="button" variant="secondary" onClick={() => setScratchSettingsOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Dialog>
      <ExportProgressDialog open={exportProgressOpen} job={exportJob} onClose={() => setExportProgressOpen(false)} />
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
          <Button onClick={confirmQuit}>Quit anyway</Button>
        </div>
      </Dialog>
    </main>
  );
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
      <Button size="icon" variant="ghost" onClick={props.onStart} disabled={props.disabled} title="Play start boundary">
        <SkipBack size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onEnd} disabled={props.disabled} title="Play end boundary">
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
      <Button size="icon" variant="ghost" onClick={props.onLeft} disabled={props.disabled} title="Nudge nearest boundary left">
        <ArrowLeft size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onRight} disabled={props.disabled} title="Nudge nearest boundary right">
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
      <Button size="icon" variant="ghost" onClick={props.onPrev} title="Previous boundary">
        <ChevronsLeft size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onPlay} title="Play">
        <Play size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onPause} title="Pause">
        <Pause size={17} />
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onNext} title="Next boundary">
        <ChevronsRight size={17} />
      </Button>
    </div>
  );
}

function ZoomControls(props: { zoom: number; onIn: () => void; onOut: () => void; onReset: () => void }) {
  return (
    <div className="icon-group">
      <Button size="icon" variant="ghost" onClick={props.onOut} title="Zoom out">
        <Minus size={17} />
      </Button>
      <Button variant="ghost" size="sm" onClick={props.onReset} title="Reset zoom">
        {props.zoom * 100}%
      </Button>
      <Button size="icon" variant="ghost" onClick={props.onIn} title="Zoom in">
        <Plus size={17} />
      </Button>
    </div>
  );
}

function StatusPanel({ job, message, videoInfo }: { job: JobRecord | null; message: string; videoInfo: VideoInfo | null }) {
  return (
    <aside className="status-panel">
      <div className="status-main">
        {job?.status === "completed" ? <CheckCircle2 size={16} /> : null}
        <span>{job?.message || message || "Idle"}</span>
      </div>
      {job ? <progress value={job.progress} max={1} /> : null}
      {videoInfo ? (
        <div className="meta-line">
          {formatTime(videoInfo.duration)} / {videoInfo.video.width}x{videoInfo.video.height} / {videoInfo.video.codec}
        </div>
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
          segments={props.segments}
          selectedSegmentId={props.selectedSegment?.id ?? null}
          currentTime={props.currentTime}
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
  segments: Segment[];
  selectedSegmentId: string | null;
  currentTime: number;
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
        {props.waveform.map((point, index) => {
          const x = (point.t / safeDuration) * props.width;
          const h = Math.max(2, Math.abs(point.rms) * 1100);
          return <line key={index} x1={x} x2={x} y1={43 - h} y2={43 + h} stroke="#f2cf63" strokeWidth="1" />;
        })}
      </svg>
    </div>
  );
}

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
  return (
    <div className="segment-list">
      <ScrollArea className="segment-list-body" scrollbars={["vertical"]}>
        <table className="segment-list-table">
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
          <tbody>
            {props.segments.map((segment) => (
              <tr key={segment.id} className={segment.id === props.selectedId ? "selected" : ""} onClick={() => props.onSelect(segment)}>
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

function parseBoundarySeconds(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, 60) : 5;
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

function nearestBoundaryTarget(segments: Segment[], time: number): BoundaryTarget | null {
  let nearest: (BoundaryTarget & { distance: number }) | null = null;
  for (const segment of segments) {
    for (const edge of ["start", "end"] as const) {
      const boundaryTime = segment[edge];
      const distance = Math.abs(boundaryTime - time);
      if (!nearest || distance < nearest.distance) {
        nearest = { segmentId: segment.id, edge, distance };
      }
    }
  }
  return nearest ? { segmentId: nearest.segmentId, edge: nearest.edge } : null;
}

function parseBoundaryNudgeSeconds(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(Math.round(parsed * 10) / 10, MIN_SEGMENT_SECONDS, 60) : MIN_SEGMENT_SECONDS;
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
