import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  Bold,
  FolderOpen,
  Plus,
  Save,
  Settings2,
  Trash2,
  Italic,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorTransportControls } from "@/components/EditorTransportControls";
import { TimelineSurface } from "@/components/TimelineSurface";
import { Dialog } from "@/components/ui/dialog";
import { JobProgressDialog } from "@/components/JobProgressDialog";
import { SegmentTimingDialog } from "@/components/SegmentTimingDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useEditorActionFocusProps } from "@/components/ui/editor-focus";
import { tr } from "@/i18n";
import {
  startLyricsAnalysis,
  startSubtitleExport,
  startSubtitleRender,
  waitForJob,
  type SubtitleRenderResultItem,
  type WhisperSettings,
} from "@/lib/api";
import {
  SUBTITLE_EFFECTS,
  defaultSubtitleEffectParams,
  subtitleEffectDefinition,
  type SubtitleEffectParameterValue,
  type SubtitleEffectSettings,
} from "@/lib/subtitleEffects";
import {
  createPendingTask,
  failTask,
  type TaskSlot,
} from "@/lib/useTaskRegistry";
import type { OperationRunner } from "@/lib/useOperationRunner";
import {
  readSubtitleStylePresets,
  upsertSubtitleStylePreset,
  writeSubtitleStylePresets,
} from "@/lib/subtitleStylePresets";
import {
  activeSegmentsAt,
  addFourBeatSegment,
  analysisLinesToSegments,
  createLyricsLane,
  labelStackLevels,
  normalizeSubtitleStyle,
  SUBTITLE_STYLE_LIMITS,
  subtitleRenderSignature,
  type LyricsAnalysisResult,
  type LyricsLane,
  type LyricsSegment,
  type SubtitleProjectState,
  type SubtitleStyle,
} from "@/lib/subtitles";
import { clamp, formatTime } from "@/lib/time";
import { useBoundaryDrag } from "@/lib/useBoundaryDrag";
import type { ModeController } from "@/lib/modeController";
import type { WaveformPhase } from "@/lib/useProgressiveWaveform";
import type { JobRecord, VideoInfo, WaveformDisplayMode, WaveformPoint } from "@/types";

type Props = {
  apiBaseUrl: string;
  videoPath: string;
  sourceAvailable: boolean;
  videoInfo: VideoInfo | null;
  waveform: WaveformPoint[];
  progressiveWaveformChunks: WaveformPoint[][];
  waveformPhase: WaveformPhase;
  waveformProgress: number;
  waveformDisplayMode: WaveformDisplayMode;
  duration: number;
  currentTime: number;
  playing: boolean;
  zoom: number;
  focusRequest: number;
  editing: boolean;
  state: SubtitleProjectState;
  controller: ModeController<LyricsSegment, string>;
  whisperSettings: WhisperSettings;
  onPrepareWhisperModel: () => Promise<void> | undefined;
  onPrepareDemucsModel: () => Promise<void> | undefined;
  onPrepareMmsModel: () => Promise<void> | undefined;
  saveStatus: string;
  taskStatus: React.ReactNode;
  analysisJob: JobRecord | null;
  exportJob: JobRecord | null;
  operationRunner: OperationRunner;
  onStateChange: (state: SubtitleProjectState) => void;
  onSeek: (time: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onScrub: (time: number) => void;
  onSeekingChange: (seeking: boolean) => void;
  onHandleEditingChange: (editing: boolean) => void;
  onFocusSegment: (segment: LyricsSegment) => void;
  boundarySecondsInput: string;
  onBoundarySecondsInput: (value: string) => void;
  onBoundarySecondsBlur: () => void;
  onLoad: () => void;
  onSettings: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onMessage: (message: string) => void;
  onJob: (slot: TaskSlot, job: JobRecord | null) => void;
  onRenderCaches: (items: SubtitleRenderResultItem[]) => void;
  /** Functional boundary preview keeps rapid moves based on the latest draft. */
  onBoundaryPreview: (
    laneId: string,
    segmentId: string,
    edge: "start" | "end",
    time: number,
  ) => void;
  onBoundaryCancel: (
    laneId: string,
    segmentId: string,
    segment: LyricsSegment,
  ) => void;
  /** Called once when a boundary drag is released. */
  onBoundaryCommit: () => void;
};

export function SubModePanel(props: Props) {
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsText, setLyricsText] = useState("");
  const [laneDialogOpen, setLaneDialogOpen] = useState(false);
  const [styleLaneId, setStyleLaneId] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [timingTarget, setTimingTarget] = useState<{ laneId: string; segmentId: string } | null>(null);
  const [busy, setBusy] = useState<"analysis" | "export" | null>(null);
  const [preparingModel, setPreparingModel] = useState(false);
  const [analysisProgressOpen, setAnalysisProgressOpen] = useState(false);
  const [exportProgressOpen, setExportProgressOpen] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null);
  const [fontListError, setFontListError] = useState<string | null>(null);
  const renderRequestVersionRef = useRef(0);
  const selected = selectedSegment(props.state);
  const activeLane = props.state.lanes.find((lane) => lane.id === props.state.active_lane_id) ?? props.state.lanes[0];
  const styleLane = props.state.lanes.find((lane) => lane.id === styleLaneId) ?? null;
  const timingLane = timingTarget
    ? props.state.lanes.find((lane) => lane.id === timingTarget.laneId) ?? null
    : null;
  const timingSegment = timingLane?.segments.find((segment) => segment.id === timingTarget?.segmentId) ?? null;
  const timingOrderedSegments = timingLane
    ? [...timingLane.segments].sort((left, right) => left.start - right.start)
    : [];
  const timingSegmentIndex = timingSegment
    ? timingOrderedSegments.findIndex((segment) => segment.id === timingSegment.id)
    : -1;
  const canAddSegment = props.controller.capabilities.canAddSegment;
  const renderPlan = useMemo(() => {
    const width = props.videoInfo?.video.width || 1920;
    const height = props.videoInfo?.video.height || 1080;
    return props.state.lanes.flatMap((lane) =>
      lane.segments.map((segment) => ({
        segment,
        style: lane.style,
        signature: subtitleRenderSignature(segment.text, lane.style, width, height),
      }))
    );
  }, [props.state.lanes, props.videoInfo?.video.width, props.videoInfo?.video.height]);
  const renderPlanKey = renderPlan
    .map(({ segment, signature }) => `${segment.id}\u0000${signature}\u0000${segment.render_cache?.signature ?? ""}`)
    .join("\u0001");

  useEffect(() => {
    if (!props.apiBaseUrl || !props.videoInfo) return;
    const missing = renderPlan.filter(
      ({ segment, signature }) => segment.render_cache?.signature !== signature
    );
    if (!missing.length) return;
    const version = renderRequestVersionRef.current + 1;
    renderRequestVersionRef.current = version;
    const timer = window.setTimeout(() => {
      const width = props.videoInfo?.video.width || 1920;
      const height = props.videoInfo?.video.height || 1080;
      let trackedJob = createPendingTask("subtitle-render", tr("sub.subtitleRenderPreparing"));
      props.onJob("subtitle-render", trackedJob);
      void startSubtitleRender(
        props.apiBaseUrl,
        width,
        height,
        missing.map(({ segment, style, signature }) => ({
          segment_id: segment.id,
          signature,
          text: segment.text,
          style,
        }))
      )
        .then((started) => {
          if (renderRequestVersionRef.current === version) {
            trackedJob = started;
            props.onJob("subtitle-render", started);
          }
          return waitForJob<{ items: SubtitleRenderResultItem[] }>(
            props.apiBaseUrl,
            started.id,
            (job) => {
              if (renderRequestVersionRef.current === version) {
                trackedJob = job;
                props.onJob("subtitle-render", job);
              }
            },
            250
          );
        })
        .then((result) => {
          if (renderRequestVersionRef.current === version) props.onRenderCaches(result.items);
        })
        .catch((error) => {
          if (renderRequestVersionRef.current === version) {
            props.onJob(
              "subtitle-render",
              failTask(trackedJob, error, tr("sub.subtitleRenderFailed"))
            );
            props.onMessage(`${tr("sub.subtitleRenderFailed")}: ${String(error)}`);
          }
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [props.apiBaseUrl, props.videoInfo, renderPlanKey]);

  useEffect(() => {
    if (!styleLane || systemFonts || fontListError) return;
    let cancelled = false;
    window.songcut.listSystemFonts()
      .then((fonts) => {
        if (!cancelled) setSystemFonts(fonts);
      })
      .catch((error) => {
        if (!cancelled) setFontListError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [styleLane, systemFonts, fontListError]);

  async function analyzeLyrics() {
    if (!props.apiBaseUrl || !props.videoPath || !lyricsText.trim()) return;
    setLyricsOpen(false);
    setAnalysisProgressOpen(true);
    setBusy("analysis");
    try {
      await props.operationRunner.run({
        slot: "lyrics-analysis",
        operation: {
          kind: "lyrics-analysis",
          settings: { ...props.whisperSettings },
        },
        pendingMessage: tr("sub.lyricsAnalysisPreparing"),
        failureMessage: tr("sub.lyricsAnalysisFailed"),
        start: () =>
          startLyricsAnalysis(
            props.apiBaseUrl,
            props.videoPath,
            lyricsText,
            props.whisperSettings
          ),
        poll: (jobId, onProgress) =>
          waitForJob<LyricsAnalysisResult>(props.apiBaseUrl, jobId, onProgress),
        onSuccess: (result) => {
          const nextState = placeAnalysisResult(props.state, result);
          props.onStateChange(nextState);
          const nextSelected = selectedSegment(nextState)?.segment;
          if (nextSelected) props.onFocusSegment(nextSelected);
          props.onMessage(
            result.beat_warning
              ? tr("sub.lyricsAnalysisCompleteWithBeatWarning", { warning: result.beat_warning })
              : tr("sub.lyricsAnalysisComplete", { lines: result.lines.length, bpm: result.tempo_bpm.toFixed(1) })
          );
        },
      });
    } catch (error) {
      props.onMessage(`${tr("sub.lyricsAnalysisFailed")}: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function openLyricsDialog() {
    setPreparingModel(true);
    try {
      await props.onPrepareDemucsModel();
      await props.onPrepareWhisperModel();
      if (props.whisperSettings.lyricsAlignmentAlgorithm === "songcut-standard") {
        await props.onPrepareMmsModel();
      }
      setLyricsOpen(true);
    } catch (error) {
      props.onMessage(tr("sub.modelDownloadFailed", { detail: String(error) }));
    } finally {
      setPreparingModel(false);
    }
  }

  async function exportSubtitles() {
    if (!props.apiBaseUrl || !props.videoPath || !props.videoInfo) return;
    const videoInfo = props.videoInfo;
    const outputDir = await window.songcut.selectOutputDirectory();
    if (!outputDir) return;
    setExportProgressOpen(true);
    setBusy("export");
    try {
      await props.operationRunner.run({
        slot: "subtitle-export",
        operation: { kind: "subtitle-export" },
        pendingMessage: tr("sub.subtitleExportPreparing"),
        failureMessage: tr("sub.subtitleExportFailed"),
        start: () =>
          startSubtitleExport(
            props.apiBaseUrl,
            props.videoPath,
            outputDir,
            videoInfo.video.width || 1920,
            videoInfo.video.height || 1080,
            props.state.lanes
          ),
        poll: (jobId, onProgress) =>
          waitForJob<{ video: string; output_dir: string }>(props.apiBaseUrl, jobId, onProgress),
        onSuccess: (result) => {
          props.onMessage(tr("sub.subtitleExportComplete", { video: result.video }));
        },
      });
    } catch (error) {
      props.onMessage(`${tr("sub.subtitleExportFailed")}: ${String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  function addLane(alignment: number) {
    if (props.state.lanes.length >= 3) return;
    const lane = createLyricsLane(alignment, `Lyrics ${props.state.lanes.length + 1}`);
    props.onStateChange({
      ...props.state,
      lanes: [...props.state.lanes, lane],
      active_lane_id: lane.id,
      selected_segment_id: null,
    });
    setLaneDialogOpen(false);
  }

  function removeLane(laneId: string) {
    if (props.state.lanes.length <= 1) return;
    const lane = props.state.lanes.find((item) => item.id === laneId);
    if (lane?.segments.length && !window.confirm(tr("sub.removeLaneConfirm"))) return;
    const lanes = props.state.lanes.filter((item) => item.id !== laneId);
    props.onStateChange({
      ...props.state,
      lanes,
      active_lane_id: props.state.active_lane_id === laneId ? lanes[0].id : props.state.active_lane_id,
      selected_segment_id:
        lane?.segments.some((segment) => segment.id === props.state.selected_segment_id)
          ? null
          : props.state.selected_segment_id,
    });
  }

  function updateLane(laneId: string, lane: LyricsLane, selectedId = props.state.selected_segment_id) {
    props.onStateChange({
      ...props.state,
      lanes: props.state.lanes.map((item) => (item.id === laneId ? lane : item)),
      active_lane_id: laneId,
      selected_segment_id: selectedId,
    });
  }

  return (
    <>
      <header className="toolbar sub-toolbar">
        <Button onClick={props.onLoad}>
          <FolderOpen size={16} />
          {tr("common.load")}
        </Button>
        <Button
          onClick={() => void openLyricsDialog()}
          disabled={!props.sourceAvailable || !props.apiBaseUrl || Boolean(busy) || preparingModel}
        >
          <Wand2 size={16} />
          {tr("common.analyze")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void exportSubtitles()}
          disabled={!props.sourceAvailable || !hasSubtitleSegments(props.state) || Boolean(busy)}
        >
          <Save size={16} />
          {tr("common.export")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setLaneDialogOpen(true)}
          disabled={props.state.lanes.length >= 3 || Boolean(busy)}
        >
          <Plus size={16} />
          {tr("sub.timeline")}
        </Button>
        <Button variant="secondary" onClick={props.controller.actions.add} disabled={!canAddSegment || Boolean(busy)}>
          <Plus size={16} />
          {tr("sub.segment")}
        </Button>
        <Button
          variant="secondary"
          onClick={props.controller.actions.remove}
          disabled={!props.controller.capabilities.canDeleteSelectedSegment || Boolean(busy)}
        >
          <Trash2 size={16} />
        </Button>
        <Button variant="secondary" onClick={props.onSettings}>
          <Settings2 size={16} />
          {tr("common.settings")}
        </Button>
        <div className="spacer" />
        <EditorTransportControls
          saveStatus={props.saveStatus}
          boundaryPreview={{
            disabled: !props.controller.capabilities.canPlayBoundary,
            value: props.boundarySecondsInput,
            onChange: props.onBoundarySecondsInput,
            onBlur: props.onBoundarySecondsBlur,
            onStart: () => props.controller.actions.playBoundary("start"),
            onEnd: () => props.controller.actions.playBoundary("end"),
          }}
          boundaryNudge={{
            kind: "rhythm-grid",
            disabled: !props.controller.capabilities.canNudgeBoundary,
            onLeft: () => props.controller.actions.nudge(-1),
            onRight: () => props.controller.actions.nudge(1),
          }}
          playback={{
            onStart: () => props.onSeek(0),
            onPrevious: () => props.controller.actions.jumpBoundary(-1),
            onPlay: props.onPlay,
            onPause: props.onPause,
            onNext: () => props.controller.actions.jumpBoundary(1),
          }}
          zoom={{
            value: props.zoom,
            onIn: props.onZoomIn,
            onOut: props.onZoomOut,
            onReset: props.onZoomReset,
          }}
        />
      </header>
      {props.taskStatus}
      <div className="sub-status-row">
        {props.state.tempo_bpm > 0 ? <span>BPM {props.state.tempo_bpm.toFixed(1)}</span> : null}
        {props.state.confidence_statistics ? (
          <span>
            confidence: mean {props.state.confidence_statistics.mean.toFixed(2)} / median{" "}
            {props.state.confidence_statistics.median.toFixed(2)} / low outliers{" "}
            {props.state.confidence_statistics.low_outlier_indexes.length}
          </span>
        ) : null}
        {props.state.beat_warning ? <span className="warning-text">{props.state.beat_warning}</span> : null}
      </div>
      <LyricsTimelineEditor
        state={props.state}
        waveform={props.waveform}
        progressiveWaveformChunks={props.progressiveWaveformChunks}
        waveformPhase={props.waveformPhase}
        waveformProgress={props.waveformProgress}
        waveformDisplayMode={props.waveformDisplayMode}
        duration={props.duration}
        currentTime={props.currentTime}
        playing={props.playing}
        zoom={props.zoom}
        focusRequest={props.focusRequest}
        selectedSegment={selected?.segment ?? null}
        editing={props.editing}
        editingSegmentId={editingSegmentId}
        onEditingSegmentId={setEditingSegmentId}
        onStateChange={props.onStateChange}
        onBoundaryPreview={props.onBoundaryPreview}
        onBoundaryCancel={props.onBoundaryCancel}
        onBoundaryCommit={props.onBoundaryCommit}
        onStyle={(laneId) => setStyleLaneId(laneId)}
        onRemoveLane={removeLane}
        onSeek={props.onSeek}
        onScrub={props.onScrub}
        onSeekingChange={props.onSeekingChange}
        onHandleEditingChange={props.onHandleEditingChange}
        onSelectSegment={(laneId, segment) => props.controller.actions.select(segment, laneId)}
        onEditTiming={(laneId, segmentId) => setTimingTarget({ laneId, segmentId })}
      />
      <Dialog open={lyricsOpen} title={tr("sub.lyricsPasteTitle")} onClose={() => setLyricsOpen(false)}>
        <Textarea
          value={lyricsText}
          onChange={(event) => setLyricsText(event.target.value)}
          placeholder={tr("sub.lyricsPlaceholder")}
          className="lyrics-input"
        />
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setLyricsOpen(false)}>{tr("sub.cancel")}</Button>
          <Button onClick={() => void analyzeLyrics()} disabled={!lyricsText.trim() || Boolean(busy)}>{tr("sub.analyzeAction")}</Button>
        </div>
      </Dialog>
      <JobProgressDialog
        open={analysisProgressOpen}
        title={tr("sub.lyricsAnalyzeTitle")}
        job={props.analysisJob}
        pendingMessage={tr("sub.lyricsAnalysisPreparing")}
        onClose={() => setAnalysisProgressOpen(false)}
        className="job-progress-dialog"
        bodyClassName="analysis-progress"
        closeAction={{ statuses: "always", activeLabel: tr("sub.closeHidden"), terminalLabel: tr("sub.closeTerminal") }}
      />
      <JobProgressDialog
        open={exportProgressOpen}
        title={tr("sub.subtitleExportTitle")}
        job={props.exportJob}
        pendingMessage={tr("sub.subtitleExportPreparing")}
        onClose={() => setExportProgressOpen(false)}
        className="job-progress-dialog"
        bodyClassName="analysis-progress"
        closeAction={{ statuses: "always", activeLabel: tr("sub.closeHidden"), terminalLabel: tr("sub.closeTerminal") }}
      />
      <Dialog open={laneDialogOpen} title={tr("sub.subtitlePositionTitle")} onClose={() => setLaneDialogOpen(false)}>
        <AlignmentGrid value={2} onChange={addLane} />
      </Dialog>
      <Dialog open={Boolean(styleLane)} title={tr("sub.subtitleStyleTitle")} className="subtitle-style-dialog" onClose={() => setStyleLaneId(null)}>
        {styleLane ? (
          <SubtitleStyleEditor
            style={styleLane.style}
            effect={styleLane.effect}
            fonts={systemFonts}
            fontListError={fontListError}
            onChange={(style) => updateLane(styleLane.id, { ...styleLane, style })}
            onEffectChange={(effect) => updateLane(styleLane.id, { ...styleLane, effect })}
          />
        ) : null}
      </Dialog>
      <SegmentTimingDialog
        open={Boolean(timingLane && timingSegment)}
        mode="sub"
        segment={timingSegment}
        mediaDuration={props.duration}
        previousEnd={timingSegmentIndex > 0 ? timingOrderedSegments[timingSegmentIndex - 1].end : 0}
        nextStart={timingSegmentIndex >= 0 && timingSegmentIndex < timingOrderedSegments.length - 1
          ? timingOrderedSegments[timingSegmentIndex + 1].start
          : props.duration}
        rhythmGrid={props.state.rhythm_grid}
        onClose={() => setTimingTarget(null)}
        onApply={(start, end) => {
          if (!timingLane || !timingSegment) return;
          props.onStateChange({
            ...props.state,
            active_lane_id: timingLane.id,
            selected_segment_id: timingSegment.id,
            lanes: props.state.lanes.map((lane) =>
              lane.id === timingLane.id
                ? {
                    ...lane,
                    segments: lane.segments
                      .map((segment) =>
                        segment.id === timingSegment.id
                          ? { ...segment, start, end, user_edited: true }
                          : segment
                      )
                      .sort((left, right) => left.start - right.start),
                  }
                : lane
            ),
          });
          setTimingTarget(null);
          props.onSeek(start);
        }}
      />
    </>
  );
}

function LyricsTimelineEditor(props: {
  state: SubtitleProjectState;
  waveform: WaveformPoint[];
  progressiveWaveformChunks: WaveformPoint[][];
  waveformPhase: WaveformPhase;
  waveformProgress: number;
  waveformDisplayMode: WaveformDisplayMode;
  duration: number;
  currentTime: number;
  playing: boolean;
  zoom: number;
  focusRequest: number;
  selectedSegment: LyricsSegment | null;
  editing: boolean;
  editingSegmentId: string | null;
  onEditingSegmentId: (id: string | null) => void;
  onStateChange: (state: SubtitleProjectState) => void;
  onBoundaryPreview: (
    laneId: string,
    segmentId: string,
    edge: "start" | "end",
    time: number,
  ) => void;
  onBoundaryCancel: (
    laneId: string,
    segmentId: string,
    segment: LyricsSegment,
  ) => void;
  onBoundaryCommit: () => void;
  onStyle: (laneId: string) => void;
  onRemoveLane: (laneId: string) => void;
  onSeek: (time: number) => void;
  onScrub: (time: number) => void;
  onSeekingChange: (seeking: boolean) => void;
  onHandleEditingChange: (editing: boolean) => void;
  onSelectSegment: (laneId: string, segment: LyricsSegment) => void;
  onEditTiming: (laneId: string, segmentId: string) => void;
}) {
  const safeDuration = Math.max(0.001, props.duration);
  const [draggingBoundary, setDraggingBoundary] = useState<{
    laneId: string;
    segmentId: string;
    edge: "start" | "end";
  } | null>(null);
  return (
    <TimelineSurface
      surfaceClassName="sub-timeline-scroll"
      contentClassName="sub-timeline-content"
      duration={props.duration}
      waveform={props.waveform}
      progressiveWaveformChunks={props.progressiveWaveformChunks}
      waveformPhase={props.waveformPhase}
      waveformProgress={props.waveformProgress}
      waveformDisplayMode={props.waveformDisplayMode}
      waveformAmplitudeProfile="adaptive"
      currentTime={props.currentTime}
      playing={props.playing}
      zoom={props.zoom}
      focusRequest={props.focusRequest}
      focusRange={props.selectedSegment}
      editing={props.editing}
      onSeek={props.onSeek}
      onScrub={props.onScrub}
      onSeekingChange={props.onSeekingChange}
      playheadClassName="sub-playhead"
      waveformClassName="sub-waveform-surface"
      waveformSvgClassName="sub-waveform"
      waveformBackgroundClassName="timeline-waveform-background sub"
      scrollbars={["horizontal", "vertical"]}
      scrollAreaType="always"
      wheelScope="waveform"
      rangeLayer={({ width }) => [
        ...props.state.lanes.filter((lane) => lane.id !== props.state.active_lane_id),
        ...props.state.lanes.filter((lane) => lane.id === props.state.active_lane_id),
      ].flatMap((lane) =>
        lane.segments.map((segment) => (
          <rect
            key={`${lane.id}-${segment.id}`}
            className={`sub-waveform-segment ${
              lane.id === props.state.active_lane_id ? "active-lane" : ""
            } ${segment.id === props.state.selected_segment_id ? "selected" : ""}`}
            x={(segment.start / safeDuration) * width}
            y={10}
            width={Math.max(2, ((segment.end - segment.start) / safeDuration) * width)}
            height={66}
          />
        ))
      )}
    >
      {({ width }) => {
        const draggingLaneIndex = draggingBoundary
          ? props.state.lanes.findIndex((lane) => lane.id === draggingBoundary.laneId)
          : -1;
        const draggingSegment = draggingBoundary && draggingLaneIndex >= 0
          ? props.state.lanes[draggingLaneIndex]?.segments.find(
              (segment) => segment.id === draggingBoundary.segmentId
            )
          : null;
        const draggingBoundaryX = draggingSegment && draggingBoundary
          ? ((draggingBoundary.edge === "start" ? draggingSegment.start : draggingSegment.end) / safeDuration) * width
          : null;
        return (
          <>
            {draggingBoundaryX !== null ? (
              <div
                className={`sub-boundary-drag-guide ${
                  draggingBoundary?.segmentId === props.state.selected_segment_id ? "selected" : ""
                }`}
                style={{
                  left: draggingBoundaryX,
                  height: 86 + draggingLaneIndex * 240 + 46,
                }}
              />
            ) : null}
            {props.state.rhythm_grid.slice(0, 6000).map((point) => (
              <span
                key={`${point.time}-${point.grid}`}
                className={`rhythm-grid-line grid-${point.grid}`}
                style={{ left: `${(point.time / safeDuration) * width}px` }}
              />
            ))}
            {props.state.lanes.map((lane) => {
              const levels = labelStackLevels(lane.segments);
              const labelWidths = new Map(
                lane.segments.map((segment, index) => {
                  const level = levels.get(segment.id) ?? 0;
                  const nextAtSameLevel = lane.segments
                    .slice(index + 1)
                    .find((candidate) => (levels.get(candidate.id) ?? 0) === level);
                  const left = (segment.start / safeDuration) * width;
                  const nextLeft = nextAtSameLevel
                    ? (nextAtSameLevel.start / safeDuration) * width
                    : width;
                  return [segment.id, Math.max(20, Math.min(360, nextLeft - left - 8))];
                })
              );
              return (
                <div
                  key={lane.id}
                  className={`lyrics-lane ${lane.id === props.state.active_lane_id ? "active" : ""}`}
                  onPointerDown={() =>
                    props.onStateChange({ ...props.state, active_lane_id: lane.id })
                  }
                >
                  <div className="lyrics-lane-header">
                    <span>{lane.name}</span>
                    <Button size="sm" variant="ghost" onClick={() => props.onStyle(lane.id)}>Style {lane.style.alignment}</Button>
                    <Button size="icon" variant="ghost" onClick={() => props.onRemoveLane(lane.id)} disabled={props.state.lanes.length <= 1}><Trash2 size={14} /></Button>
                  </div>
                  <div className="lyrics-segment-track">
                    {lane.segments.map((segment) => (
                      <LyricsSegmentView
                        key={segment.id}
                        lane={lane}
                        segment={segment}
                        level={levels.get(segment.id) ?? 0}
                        labelWidth={labelWidths.get(segment.id) ?? 20}
                        width={width}
                        duration={safeDuration}
                        selected={segment.id === props.state.selected_segment_id}
                        editing={segment.id === props.editingSegmentId}
                        grid={props.state.rhythm_grid}
                        onSelect={() => props.onSelectSegment(lane.id, segment)}
                        onEditTiming={() => props.onEditTiming(lane.id, segment.id)}
                        onEdit={() => props.onEditingSegmentId(segment.id)}
                        onEditDone={(text) => {
                          props.onEditingSegmentId(null);
                          props.onStateChange({
                            ...props.state,
                            lanes: props.state.lanes.map((item) =>
                              item.id === lane.id
                                ? {
                                    ...item,
                                    segments: item.segments.map((candidate) =>
                                      candidate.id === segment.id ? { ...candidate, text } : candidate
                                    ),
                                  }
                                : item
                            ),
                          });
                        }}
                        onBoundaryPreview={(edge, time) =>
                          props.onBoundaryPreview(lane.id, segment.id, edge, time)
                        }
                        onBoundaryCancel={(_edge, _time, startSegment) =>
                          props.onBoundaryCancel(lane.id, segment.id, startSegment)
                        }
                        onBoundaryCommit={props.onBoundaryCommit}
                        onEditingChange={props.onHandleEditingChange}
                        onDraggingBoundary={(edge) =>
                          setDraggingBoundary(
                            edge ? { laneId: lane.id, segmentId: segment.id, edge } : null
                          )
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        );
      }}
    </TimelineSurface>
  );
}

function LyricsSegmentView(props: {
  lane: LyricsLane;
  segment: LyricsSegment;
  level: number;
  labelWidth: number;
  width: number;
  duration: number;
  selected: boolean;
  editing: boolean;
  grid: SubtitleProjectState["rhythm_grid"];
  onSelect: () => void;
  onEditTiming: () => void;
  onEdit: () => void;
  onEditDone: (text: string) => void;
  onBoundaryPreview: (edge: "start" | "end", time: number) => void;
  onBoundaryCancel: (
    edge: "start" | "end",
    time: number,
    segment: LyricsSegment,
  ) => void;
  onBoundaryCommit: () => void;
  onEditingChange: (editing: boolean) => void;
  onDraggingBoundary: (edge: "start" | "end" | null) => void;
}) {
  const selectActionFocusProps = useEditorActionFocusProps<HTMLButtonElement>((event) => {
    event.stopPropagation();
    props.onSelect();
  });
  const left = (props.segment.start / props.duration) * props.width;
  const right = (props.segment.end / props.duration) * props.width;
  const [draft, setDraft] = useState(props.segment.text);
  const boundaryEdgeRef = useRef<"start" | "end" | null>(null);
  const boundaryStartTimeRef = useRef<number | null>(null);
  const boundaryStartSegmentRef = useRef<LyricsSegment | null>(null);
  const boundaryContentRef = useRef<HTMLElement | null>(null);
  const drag = useBoundaryDrag({
    onPreview: (clientX) => {
      const content = boundaryContentRef.current;
      const edge = boundaryEdgeRef.current;
      if (!content || !edge) return;
      const rect = content.getBoundingClientRect();
      const time = clamp(((clientX - rect.left) / rect.width) * props.duration, 0, props.duration);
      props.onBoundaryPreview(edge, time);
    },
    onCommit: props.onBoundaryCommit,
    onCancel: () => {
      const edge = boundaryEdgeRef.current;
      const startTime = boundaryStartTimeRef.current;
      const startSegment = boundaryStartSegmentRef.current;
      if (edge && startTime !== null && startSegment) {
        props.onBoundaryCancel(edge, startTime, startSegment);
      }
    },
    onEditingChange: (editing) => {
      props.onEditingChange(editing);
      if (!editing) {
        props.onDraggingBoundary(null);
        boundaryEdgeRef.current = null;
        boundaryStartTimeRef.current = null;
        boundaryStartSegmentRef.current = null;
        boundaryContentRef.current = null;
      }
    },
  });

  function prepareDrag(edge: "start" | "end", target: EventTarget | null) {
    // Pointer-capable browsers dispatch a compatibility mousedown after
    // pointerdown. Do not let that second event clear the active drag guide.
    if (drag.isActive()) return false;
    const content = target instanceof Element
      ? target.closest(".sub-timeline-content") as HTMLElement | null
      : null;
    if (!content) return false;
    boundaryEdgeRef.current = edge;
    boundaryStartTimeRef.current = props.segment[edge];
    boundaryStartSegmentRef.current = { ...props.segment };
    boundaryContentRef.current = content;
    props.onDraggingBoundary(edge);
    return true;
  }

  function beginPointerDrag(event: React.PointerEvent, edge: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    if (prepareDrag(edge, event.currentTarget) && !drag.startPointer(event)) {
      props.onDraggingBoundary(null);
    }
  }

  function beginMouseDrag(event: React.MouseEvent, edge: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    if (prepareDrag(edge, event.currentTarget) && !drag.startMouse(event)) {
      props.onDraggingBoundary(null);
    }
  }
  return (
    <>
      <button
        {...selectActionFocusProps}
        type="button"
        className={`lyrics-segment ${props.selected ? "selected" : ""} ${props.segment.low_confidence_outlier ? "confidence-warning" : ""}`}
        style={{ left, width: Math.max(4, right - left) }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onSelect();
          props.onEditTiming();
        }}
        title={`${props.segment.text}\nconfidence ${props.segment.confidence.toFixed(3)}`}
      >
        <span
          className="lyrics-handle start"
          onPointerDown={(event) => beginPointerDrag(event, "start")}
          onMouseDown={(event) => beginMouseDrag(event, "start")}
          onDoubleClick={(event) => event.stopPropagation()}
        />
        <span
          className="lyrics-handle end"
          onPointerDown={(event) => beginPointerDrag(event, "end")}
          onMouseDown={(event) => beginMouseDrag(event, "end")}
          onDoubleClick={(event) => event.stopPropagation()}
        />
      </button>
      <div
        className={`lyrics-label ${props.selected ? "selected" : ""} ${props.editing ? "editing" : ""} ${props.segment.low_confidence_outlier ? "confidence-warning" : ""}`}
        style={{ left, top: 38 + props.level * 27, width: props.labelWidth }}
        onClick={props.onSelect}
        onDoubleClick={() => {
          setDraft(props.segment.text);
          props.onEdit();
        }}
      >
        <span className="lyrics-connector" />
        {props.editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => props.onEditDone(draft.trim())}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onEditDone(draft.trim());
              if (event.key === "Escape") props.onEditDone(props.segment.text);
            }}
          />
        ) : (
          props.segment.text
        )}
      </div>
    </>
  );
}

export function SubtitleOverlay(props: {
  state: SubtitleProjectState;
  currentTime: number;
  videoWidth: number;
  videoHeight: number;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const container = overlayRef.current?.parentElement;
    if (!container) return;
    const update = () =>
      setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const sourceWidth = Math.max(1, props.videoWidth);
  const sourceHeight = Math.max(1, props.videoHeight);
  const scale =
    containerSize.width > 0 && containerSize.height > 0
      ? Math.min(containerSize.width / sourceWidth, containerSize.height / sourceHeight)
      : 0;
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  const active = activeSegmentsAt(props.state.lanes, props.currentTime);
  return (
    <div
      ref={overlayRef}
      className="subtitle-overlay"
      aria-live="off"
      style={{
        left: (containerSize.width - displayWidth) / 2,
        top: (containerSize.height - displayHeight) / 2,
        right: "auto",
        bottom: "auto",
        width: displayWidth,
        height: displayHeight,
        visibility: scale > 0 ? "visible" : "hidden",
      }}
    >
      {active.map(({ lane, segment }) => (
        segment.render_cache?.signature ===
        subtitleRenderSignature(segment.text, lane.style, sourceWidth, sourceHeight) ? (
          <img
            key={segment.id}
            className="subtitle-overlay-image"
            src={`data:image/png;base64,${segment.render_cache.png_base64}`}
            alt=""
            draggable={false}
          />
        ) : null
      ))}
    </div>
  );
}

export function AlignmentGrid(props: { value: number; onChange: (alignment: number) => void }) {
  return (
    <div className="alignment-grid" role="radiogroup" aria-label={tr("sub.subtitlePositionTitle")}>
      {[7, 8, 9, 4, 5, 6, 1, 2, 3].map((alignment) => (
        <Button
          key={alignment}
          type="button"
          variant={props.value === alignment ? "default" : "secondary"}
          role="radio"
          aria-checked={props.value === alignment}
          onClick={() => props.onChange(alignment)}
        >
          {alignment}
        </Button>
      ))}
    </div>
  );
}

function SubtitleStyleEditor(props: {
  style: SubtitleStyle;
  effect: SubtitleEffectSettings;
  fonts: string[] | null;
  fontListError: string | null;
  onChange: (style: SubtitleStyle) => void;
  onEffectChange: (effect: SubtitleEffectSettings) => void;
}) {
  const style = props.style;
  const effect = props.effect;
  const [stylePresets, setStylePresets] = useState(readSubtitleStylePresets);
  const [selectedStylePresetId, setSelectedStylePresetId] = useState("");
  const [stylePresetName, setStylePresetName] = useState("");
  const [stylePresetMessage, setStylePresetMessage] = useState("");
  const effectDefinition = subtitleEffectDefinition(effect.name);
  const fontOptions = props.fonts?.includes(style.font_name)
    ? props.fonts
    : [style.font_name, ...(props.fonts ?? [])];
  function patch(value: Partial<SubtitleStyle>) {
    props.onChange(normalizeSubtitleStyle({ ...style, ...value }));
  }
  function patchEffect(value: Partial<SubtitleEffectSettings>) {
    props.onEffectChange({ ...effect, ...value });
  }
  function patchEffectParam(name: string, value: SubtitleEffectParameterValue) {
    patchEffect({ params: { ...effect.params, [name]: value } });
  }
  function saveStylePreset() {
    const name = stylePresetName.trim();
    if (!name) return;
    try {
      const next = upsertSubtitleStylePreset(stylePresets, name, style);
      writeSubtitleStylePresets(next);
      const saved = next.find(
        (preset) => preset.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0
      );
      setStylePresets(next);
      setSelectedStylePresetId(saved?.id ?? "");
      setStylePresetName(saved?.name ?? name);
      setStylePresetMessage(tr("sub.presetSaved", { name: saved?.name ?? name }));
    } catch (error) {
      setStylePresetMessage(tr("sub.presetSaveFailed", { detail: String(error) }));
    }
  }
  function applyStylePreset() {
    const preset = stylePresets.find((item) => item.id === selectedStylePresetId);
    if (!preset) return;
    props.onChange(normalizeSubtitleStyle(preset.style));
    setStylePresetName(preset.name);
    setStylePresetMessage(tr("sub.presetApplied", { name: preset.name }));
  }
  return (
    <div className="subtitle-style-editor">
      <section className="subtitle-style-section subtitle-style-presets">
        <h3>{tr("sub.savedStyles")}</h3>
        <div className="subtitle-style-preset-row">
          <Select
            aria-label={tr("sub.savedStyleLabel")}
            value={selectedStylePresetId}
            onChange={(event) => {
              setSelectedStylePresetId(event.target.value);
              setStylePresetMessage("");
            }}
          >
            <option value="">{tr("sub.styleSelectPlaceholder")}</option>
            {stylePresets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </Select>
          <Button
            type="button"
            variant="secondary"
            onClick={applyStylePreset}
            disabled={!selectedStylePresetId}
          >
            {tr("sub.applyStyle")}
          </Button>
        </div>
        <div className="subtitle-style-preset-row">
          <Input
            aria-label={tr("sub.styleNameLabel")}
            placeholder={tr("sub.styleNamePlaceholder")}
            value={stylePresetName}
            onChange={(event) => {
              setStylePresetName(event.target.value);
              setStylePresetMessage("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && stylePresetName.trim()) saveStylePreset();
            }}
          />
          <Button
            type="button"
            onClick={saveStylePreset}
            disabled={!stylePresetName.trim()}
          >
            {tr("sub.save")}
          </Button>
        </div>
        {stylePresetMessage ? (
          <small className="font-list-status" role="status">{stylePresetMessage}</small>
        ) : null}
      </section>
      <section className="subtitle-style-section">
        <h3>{tr("sub.fontAndColor")}</h3>
        <div className="subtitle-style-toolbar">
          <Select aria-label={tr("sub.font")} value={style.font_name} disabled={!props.fonts} onChange={(event) => patch({ font_name: event.target.value })}>
            {fontOptions.map((font) => <option key={font} value={font}>{font}</option>)}
          </Select>
          <ColorControl label={tr("sub.textColor")} value={style.primary_color} onChange={(value) => patch({ primary_color: value })} />
          <ColorControl label={tr("sub.backgroundColor")} value={style.background_color} onChange={(value) => patch({ background_color: `${value}80` })} />
          <ColorControl label={tr("sub.outlineColor")} value={style.outline_color} onChange={(value) => patch({ outline_color: value })} />
          <Toggle pressed={style.bold} onPressedChange={(bold) => patch({ bold })} title={tr("sub.bold")} aria-label={tr("sub.bold")}><Bold size={17} /></Toggle>
          <Toggle pressed={style.italic} onPressedChange={(italic) => patch({ italic })} title={tr("sub.italic")} aria-label={tr("sub.italic")}><Italic size={17} /></Toggle>
        </div>
        {!props.fonts && !props.fontListError ? <small className="font-list-status">{tr("sub.fontsLoading")}</small> : null}
        {props.fontListError ? <small className="font-list-status warning-text">{tr("sub.fontsFailed")}</small> : null}
      </section>
      <section className="subtitle-style-section subtitle-style-layout">
        <div>
          <h3>{tr("sub.displayPosition")}</h3>
          <AlignmentGrid value={style.alignment} onChange={(alignment) => patch({ alignment })} />
        </div>
        <div className="subtitle-style-fields">
          <label>{tr("sub.size")}<Input type="number" min={SUBTITLE_STYLE_LIMITS.font_size.min} max={SUBTITLE_STYLE_LIMITS.font_size.max} value={style.font_size} onChange={(event) => patch({ font_size: Number(event.target.value) })} /></label>
          <label>{tr("sub.outlineWidth")}<Input type="number" min={SUBTITLE_STYLE_LIMITS.outline.min} max={SUBTITLE_STYLE_LIMITS.outline.max} value={style.outline} onChange={(event) => patch({ outline: Number(event.target.value) })} /></label>
          <label>{tr("sub.shadow")}<Input type="number" min={SUBTITLE_STYLE_LIMITS.shadow.min} max={SUBTITLE_STYLE_LIMITS.shadow.max} value={style.shadow} onChange={(event) => patch({ shadow: Number(event.target.value) })} /></label>
          <label>{tr("sub.horizontalMargin")}<Input type="number" min={SUBTITLE_STYLE_LIMITS.margin.min} max={SUBTITLE_STYLE_LIMITS.margin.max} value={style.margin_l} onChange={(event) => patch({ margin_l: Number(event.target.value), margin_r: Number(event.target.value) })} /></label>
          <label>{tr("sub.verticalMargin")}<Input type="number" min={SUBTITLE_STYLE_LIMITS.margin.min} max={SUBTITLE_STYLE_LIMITS.margin.max} value={style.margin_v} onChange={(event) => patch({ margin_v: Number(event.target.value) })} /></label>
        </div>
      </section>
      <section className="subtitle-style-section subtitle-effect-section">
        <div className="subtitle-effect-heading">
          <h3>{tr("sub.outputEffects")}</h3>
          <small>{tr("sub.outputEffectsHelp")}</small>
        </div>
        <div className="subtitle-effect-fields">
          <label>
            {tr("sub.effectType")}
            <Select
              aria-label={tr("sub.effectType")}
              value={effect.name}
              onChange={(event) => {
                const name = event.target.value;
                patchEffect({
                  name: name as SubtitleEffectSettings["name"],
                  params: defaultSubtitleEffectParams(name),
                });
              }}
            >
              {SUBTITLE_EFFECTS.map((item) => (
                <option key={item.name} value={item.name}>{subtitleEffectLabel(item.name, item.label)}</option>
              ))}
            </Select>
          </label>
          {effect.name !== "cut" ? (
            <>
              <label>
                {tr("sub.effectStartDuration")}
                <Input
                  type="number"
                  min={0}
                  step={10}
                  value={effect.start_duration_ms}
                  onChange={(event) => patchEffect({ start_duration_ms: Math.max(0, Number(event.target.value)) })}
                />
              </label>
              <label>
                {tr("sub.effectEndDuration")}
                <Input
                  type="number"
                  min={0}
                  step={10}
                  value={effect.end_duration_ms}
                  onChange={(event) => patchEffect({ end_duration_ms: Math.max(0, Number(event.target.value)) })}
                />
              </label>
              {effectDefinition.params.map((parameter) => {
                const value = effect.params[parameter.name] ?? parameter.defaultValue;
                if (parameter.kind === "select") {
                  return (
                    <label key={parameter.name}>
                      {subtitleEffectParameterLabel(parameter.name, parameter.label)}
                      <Select
                        value={String(value)}
                        onChange={(event) => patchEffectParam(parameter.name, event.target.value)}
                      >
                        {parameter.options.map(([optionValue, label]) => (
                          <option key={optionValue} value={optionValue}>{subtitleEffectOptionLabel(optionValue, label)}</option>
                        ))}
                      </Select>
                    </label>
                  );
                }
                if (parameter.kind === "color") {
                  return (
                    <ColorControl
                      key={parameter.name}
                      label={subtitleEffectParameterLabel(parameter.name, parameter.label)}
                      value={String(value)}
                      onChange={(next) => patchEffectParam(parameter.name, next)}
                    />
                  );
                }
                return (
                  <label key={parameter.name}>
                    {subtitleEffectParameterLabel(parameter.name, parameter.label)}
                    <Input
                      type="number"
                      min={parameter.min}
                      max={parameter.max}
                      step={parameter.step}
                      value={Number(value)}
                      onChange={(event) => patchEffectParam(
                        parameter.name,
                        clamp(Number(event.target.value), parameter.min, parameter.max)
                      )}
                    />
                  </label>
                );
              })}
            </>
          ) : null}
        </div>
        {effect.name !== "cut" ? (
          <small className="font-list-status">
            {tr("sub.shortSubtitleHelp")}
          </small>
        ) : null}
      </section>
    </div>
  );
}

function ColorControl(props: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="color-control" title={props.label}>
      <span>{props.label}</span>
      <Input
        type="color"
        aria-label={props.label}
        value={props.value.slice(0, 7)}
        onChange={(event) => props.onChange(event.target.value.toUpperCase())}
      />
    </label>
  );
}

function subtitleEffectLabel(name: string, fallback: string) {
  const key = `sub.effect.${name}`;
  const translated = tr(key);
  return translated === key ? fallback : translated;
}

function subtitleEffectParameterLabel(name: string, fallback: string) {
  const key = `sub.effect.param.${name}`;
  const translated = tr(key);
  return translated === key ? fallback : translated;
}

function subtitleEffectOptionLabel(value: string, fallback: string) {
  const key = `sub.effect.option.${value}`;
  const translated = tr(key);
  return translated === key ? fallback : translated;
}

function placeAnalysisResult(state: SubtitleProjectState, result: LyricsAnalysisResult): SubtitleProjectState {
  let lanes = state.lanes.map((lane) => ({ ...lane, segments: [...lane.segments] }));
  const titleLaneIndex = lanes.findIndex((lane) => lane.segments.some((segment) => segment.source === "title"));
  let lyricsLaneIndex = lanes.findIndex(
    (lane, index) => index !== titleLaneIndex && lane.segments.length === 0
  );
  if (lyricsLaneIndex < 0 && lanes.length < 3) {
    lanes.push(createLyricsLane(2, `Lyrics ${lanes.length + 1}`));
    lyricsLaneIndex = lanes.length - 1;
  }
  if (lyricsLaneIndex < 0) {
    lyricsLaneIndex = Math.max(0, lanes.findIndex((lane, index) => index !== titleLaneIndex && lane.id === state.active_lane_id));
    if (!window.confirm(tr("sub.laneReplaceConfirm", { lane: lanes[lyricsLaneIndex].name }))) return state;
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
      if (targetIndex < 0 || !window.confirm(tr("sub.titleReplaceConfirm", { lane: lanes[targetIndex].name }))) return state;
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

function selectedSegment(state: SubtitleProjectState) {
  for (const lane of state.lanes) {
    const segment = lane.segments.find((item) => item.id === state.selected_segment_id);
    if (segment) return { laneId: lane.id, segment };
  }
  return null;
}

function hasSubtitleSegments(state: SubtitleProjectState) {
  return state.lanes.some((lane) => lane.segments.length > 0);
}
