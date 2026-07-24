import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bold,
  ChevronsLeft,
  ChevronsRight,
  FolderOpen,
  Minus,
  Pause,
  Play,
  Plus,
  Rewind,
  Save,
  Settings2,
  SkipBack,
  SkipForward,
  Trash2,
  Italic,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
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
  updateSegmentBoundary,
  type LyricsAnalysisResult,
  type LyricsLane,
  type LyricsSegment,
  type SubtitleProjectState,
  type SubtitleStyle,
} from "@/lib/subtitles";
import { clamp, formatTime } from "@/lib/time";
import { useTimelineViewport } from "@/lib/useTimelineViewport";
import type { JobRecord, VideoInfo, WaveformPoint } from "@/types";

type Props = {
  apiBaseUrl: string;
  videoPath: string;
  sourceAvailable: boolean;
  videoInfo: VideoInfo | null;
  waveform: WaveformPoint[];
  duration: number;
  currentTime: number;
  playing: boolean;
  zoom: number;
  focusRequest: number;
  editing: boolean;
  state: SubtitleProjectState;
  whisperSettings: WhisperSettings;
  saveStatus: string;
  message: string;
  onStateChange: (state: SubtitleProjectState) => void;
  onSeek: (time: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onScrub: (time: number) => void;
  onSeekingChange: (seeking: boolean) => void;
  onHandleEditingChange: (editing: boolean) => void;
  onSelectSegment: (laneId: string, segment: LyricsSegment) => void;
  onFocusSegment: (segment: LyricsSegment) => void;
  onAddSegment: () => void;
  onDeleteSelectedSegment: () => void;
  onPreviewRange: (start: number, end: number) => void;
  boundarySecondsInput: string;
  boundaryPreviewSeconds: number;
  onBoundarySecondsInput: (value: string) => void;
  onBoundarySecondsBlur: () => void;
  onNudge: (direction: -1 | 1) => void;
  onPreviousBoundary: () => void;
  onNextBoundary: () => void;
  onLoad: () => void;
  onSettings: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onMessage: (message: string) => void;
  onJob: (slot: "lyrics-analysis" | "subtitle-export", job: JobRecord | null) => void;
  onRenderCaches: (items: SubtitleRenderResultItem[]) => void;
};

export function SubModePanel(props: Props) {
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsText, setLyricsText] = useState("");
  const [laneDialogOpen, setLaneDialogOpen] = useState(false);
  const [styleLaneId, setStyleLaneId] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"analysis" | "export" | null>(null);
  const [analysisJob, setAnalysisJob] = useState<JobRecord | null>(null);
  const [analysisProgressOpen, setAnalysisProgressOpen] = useState(false);
  const [exportJob, setExportJob] = useState<JobRecord | null>(null);
  const [exportProgressOpen, setExportProgressOpen] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null);
  const [fontListError, setFontListError] = useState<string | null>(null);
  const renderRequestVersionRef = useRef(0);
  const selected = selectedSegment(props.state);
  const activeLane = props.state.lanes.find((lane) => lane.id === props.state.active_lane_id) ?? props.state.lanes[0];
  const styleLane = props.state.lanes.find((lane) => lane.id === styleLaneId) ?? null;
  const canAddSegment = Boolean(
    activeLane && addFourBeatSegment(activeLane, props.state.selected_segment_id, props.state.rhythm_grid)
  );
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
        .then((started) =>
          waitForJob<{ items: SubtitleRenderResultItem[] }>(
            props.apiBaseUrl,
            started.id,
            () => undefined,
            250
          )
        )
        .then((result) => {
          if (renderRequestVersionRef.current === version) props.onRenderCaches(result.items);
        })
        .catch((error) => {
          if (renderRequestVersionRef.current === version) {
            props.onMessage(`字幕プレビュー画像の生成に失敗しました: ${String(error)}`);
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
    const now = Date.now() / 1000;
    setLyricsOpen(false);
    setAnalysisProgressOpen(true);
    setAnalysisJob({
      id: "starting",
      kind: "lyrics-analysis",
      status: "queued",
      progress: 0,
      message: "歌詞解析を準備しています…",
      created_at: now,
      updated_at: now,
    });
    setBusy("analysis");
    try {
      const started = await startLyricsAnalysis(
        props.apiBaseUrl,
        props.videoPath,
        lyricsText,
        props.whisperSettings
      );
      setAnalysisJob(started);
      props.onJob("lyrics-analysis", started);
      const result = await waitForJob<LyricsAnalysisResult>(
        props.apiBaseUrl,
        started.id,
        (job) => {
          setAnalysisJob(job);
          props.onJob("lyrics-analysis", job);
        }
      );
      const nextState = placeAnalysisResult(props.state, result);
      props.onStateChange(nextState);
      const nextSelected = selectedSegment(nextState)?.segment;
      if (nextSelected) props.onFocusSegment(nextSelected);
      props.onMessage(
        result.beat_warning
          ? `歌詞解析が完了しました。拍検出を利用できません: ${result.beat_warning}`
          : `歌詞解析が完了しました。${result.lines.length}行、BPM ${result.tempo_bpm.toFixed(1)}`
      );
    } catch (error) {
      setAnalysisJob((current) => ({
        id: current?.id ?? "failed",
        kind: "lyrics-analysis",
        status: "failed",
        progress: current?.progress ?? 0,
        message: "歌詞解析に失敗しました",
        error: String(error),
        created_at: current?.created_at ?? Date.now() / 1000,
        updated_at: Date.now() / 1000,
      }));
      props.onMessage(`歌詞解析に失敗しました: ${String(error)}`);
    } finally {
      setBusy(null);
      props.onJob("lyrics-analysis", null);
    }
  }

  async function exportSubtitles() {
    if (!props.apiBaseUrl || !props.videoPath || !props.videoInfo) return;
    const outputDir = await window.songcut.selectOutputDirectory();
    if (!outputDir) return;
    const now = Date.now() / 1000;
    setExportProgressOpen(true);
    setExportJob({
      id: "starting",
      kind: "subtitle-export",
      status: "queued",
      progress: 0,
      message: "字幕書き出しを準備しています…",
      created_at: now,
      updated_at: now,
    });
    setBusy("export");
    try {
      const started = await startSubtitleExport(
        props.apiBaseUrl,
        props.videoPath,
        outputDir,
        props.videoInfo.video.width || 1920,
        props.videoInfo.video.height || 1080,
        props.state.lanes
      );
      setExportJob(started);
      props.onJob("subtitle-export", started);
      const result = await waitForJob<{ video: string; output_dir: string }>(
        props.apiBaseUrl,
        started.id,
        (job) => {
          setExportJob(job);
          props.onJob("subtitle-export", job);
        }
      );
      props.onMessage(`字幕動画を書き出しました: ${result.video}`);
    } catch (error) {
      setExportJob((current) => ({
        id: current?.id ?? "failed",
        kind: "subtitle-export",
        status: "failed",
        progress: current?.progress ?? 0,
        message: "字幕書き出しに失敗しました",
        error: String(error),
        created_at: current?.created_at ?? Date.now() / 1000,
        updated_at: Date.now() / 1000,
      }));
      props.onMessage(`字幕書き出しに失敗しました: ${String(error)}`);
    } finally {
      setBusy(null);
      props.onJob("subtitle-export", null);
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
    if (lane?.segments.length && !window.confirm("このタイムラインと字幕を削除しますか？")) return;
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
          読み込む
        </Button>
        <Button
          onClick={() => setLyricsOpen(true)}
          disabled={!props.sourceAvailable || !props.apiBaseUrl || Boolean(busy)}
        >
          <Wand2 size={16} />
          解析
        </Button>
        <Button
          variant="secondary"
          onClick={() => void exportSubtitles()}
          disabled={!props.sourceAvailable || !hasSubtitleSegments(props.state) || Boolean(busy)}
        >
          <Save size={16} />
          書き出し
        </Button>
        <Button
          variant="secondary"
          onClick={() => setLaneDialogOpen(true)}
          disabled={props.state.lanes.length >= 3 || Boolean(busy)}
        >
          <Plus size={16} />
          タイムライン
        </Button>
        <Button variant="secondary" onClick={props.onAddSegment} disabled={!canAddSegment || Boolean(busy)}>
          <Plus size={16} />
          セグメント
        </Button>
        <Button variant="secondary" onClick={props.onDeleteSelectedSegment} disabled={!selected || Boolean(busy)}>
          <Trash2 size={16} />
        </Button>
        <Button variant="secondary" onClick={props.onSettings}>
          <Settings2 size={16} />
          設定
        </Button>
        <div className="spacer" />
        <span className="project-save-status">{props.saveStatus}</span>
        <div className="icon-group boundary-controls">
          <Button size="icon" variant="ghost" title="始点を再生" onClick={() => selected && props.onPreviewRange(selected.segment.start, Math.min(selected.segment.end, selected.segment.start + props.boundaryPreviewSeconds))} disabled={!selected}>
            <SkipBack size={17} />
          </Button>
          <Button size="icon" variant="ghost" title="終点を再生" onClick={() => selected && props.onPreviewRange(Math.max(selected.segment.start, selected.segment.end - props.boundaryPreviewSeconds), selected.segment.end)} disabled={!selected}>
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
            aria-label="区間境界を再生する秒数"
            value={props.boundarySecondsInput}
            onChange={(event) => props.onBoundarySecondsInput(event.currentTarget.value)}
            onBlur={props.onBoundarySecondsBlur}
          />
        </div>
        <div className="icon-group boundary-nudge-controls">
          <Button size="icon" variant="ghost" title="近い境界を左の1/4拍へ" onClick={() => props.onNudge(-1)} disabled={!selected || !props.state.rhythm_grid.length}>
            <ArrowLeft size={17} />
          </Button>
          <Button size="icon" variant="ghost" title="近い境界を右の1/4拍へ" onClick={() => props.onNudge(1)} disabled={!selected || !props.state.rhythm_grid.length}>
            <ArrowRight size={17} />
          </Button>
        </div>
        <div className="icon-group">
          <Button size="icon" variant="ghost" onClick={() => props.onSeek(0)} title="先頭"><Rewind size={17} /></Button>
          <Button size="icon" variant="ghost" onClick={props.onPreviousBoundary} title="前の境界"><ChevronsLeft size={17} /></Button>
          <Button size="icon" variant="ghost" onClick={props.onPlay} title="再生"><Play size={17} /></Button>
          <Button size="icon" variant="ghost" onClick={props.onPause} title="一時停止"><Pause size={17} /></Button>
          <Button size="icon" variant="ghost" onClick={props.onNextBoundary} title="次の境界"><ChevronsRight size={17} /></Button>
        </div>
        <div className="icon-group">
          <Button size="icon" variant="ghost" onClick={props.onZoomOut}><Minus size={16} /></Button>
          <Button size="sm" variant="ghost" onClick={props.onZoomReset}>{Math.round(props.zoom * 100)}%</Button>
          <Button size="icon" variant="ghost" onClick={props.onZoomIn}><Plus size={16} /></Button>
        </div>
      </header>
      <div className="sub-status-row">
        <span>{props.message}</span>
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
        onStyle={(laneId) => setStyleLaneId(laneId)}
        onRemoveLane={removeLane}
        onSeek={props.onSeek}
        onScrub={props.onScrub}
        onSeekingChange={props.onSeekingChange}
        onHandleEditingChange={props.onHandleEditingChange}
        onSelectSegment={props.onSelectSegment}
      />
      <Dialog open={lyricsOpen} title="歌詞を貼り付け" onClose={() => setLyricsOpen(false)}>
        <Textarea
          value={lyricsText}
          onChange={(event) => setLyricsText(event.target.value)}
          placeholder={"曲名（任意）\n\n歌詞1行目\n歌詞2行目"}
          className="lyrics-input"
        />
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setLyricsOpen(false)}>キャンセル</Button>
          <Button onClick={() => void analyzeLyrics()} disabled={!lyricsText.trim() || Boolean(busy)}>解析</Button>
        </div>
      </Dialog>
      <AnalysisProgressDialog
        open={analysisProgressOpen}
        job={analysisJob}
        onClose={() => setAnalysisProgressOpen(false)}
      />
      <JobProgressDialog
        open={exportProgressOpen}
        title="字幕を書き出し"
        job={exportJob}
        pendingMessage="字幕書き出しを準備しています…"
        onClose={() => setExportProgressOpen(false)}
      />
      <Dialog open={laneDialogOpen} title="字幕位置を選択" onClose={() => setLaneDialogOpen(false)}>
        <AlignmentGrid value={2} onChange={addLane} />
      </Dialog>
      <Dialog open={Boolean(styleLane)} title="字幕スタイル" className="subtitle-style-dialog" onClose={() => setStyleLaneId(null)}>
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
    </>
  );
}

function LyricsTimelineEditor(props: {
  state: SubtitleProjectState;
  waveform: WaveformPoint[];
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
  onStyle: (laneId: string) => void;
  onRemoveLane: (laneId: string) => void;
  onSeek: (time: number) => void;
  onScrub: (time: number) => void;
  onSeekingChange: (seeking: boolean) => void;
  onHandleEditingChange: (editing: boolean) => void;
  onSelectSegment: (laneId: string, segment: LyricsSegment) => void;
}) {
  const safeDuration = Math.max(0.001, props.duration);
  const [draggingBoundary, setDraggingBoundary] = useState<{
    laneId: string;
    segmentId: string;
    edge: "start" | "end";
  } | null>(null);
  const waveformRef = useRef<SVGSVGElement>(null);
  const timelineViewport = useTimelineViewport({
    duration: props.duration,
    currentTime: props.currentTime,
    playing: props.playing,
    editing: props.editing,
    zoom: props.zoom,
    focusRequest: props.focusRequest,
    focusRange: props.selectedSegment,
    onScrub: props.onScrub,
  });
  useEffect(() => {
    const waveform = waveformRef.current;
    if (!waveform) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      timelineViewport.scrollByWheel(event);
    };
    waveform.addEventListener("wheel", handleWheel, { passive: false });
    return () => waveform.removeEventListener("wheel", handleWheel);
  }, [timelineViewport.scrollByWheel]);
  const width = timelineViewport.contentWidth;
  const waveformPath = useMemo(
    () => simpleWaveformPath(props.waveform, safeDuration, width, 86),
    [props.waveform, safeDuration, width]
  );
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
    <ScrollArea
      className="sub-timeline-scroll"
      viewportRef={timelineViewport.viewportRef}
      scrollbars={["horizontal", "vertical"]}
      type="always"
    >
      <div className="sub-timeline-content" style={{ width }}>
        <div className="sub-playhead" style={{ left: `${(props.currentTime / safeDuration) * width}px` }} />
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
        <svg
          ref={waveformRef}
          className="sub-waveform"
          width={width}
          height={86}
          viewBox={`0 0 ${width} 86`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            props.onSeekingChange(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            timelineViewport.scrubFromClientX(event.clientX);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            timelineViewport.scrubFromClientX(event.clientX);
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            timelineViewport.stopScrubAutoScroll();
            props.onSeekingChange(false);
          }}
          onPointerCancel={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            timelineViewport.stopScrubAutoScroll();
            props.onSeekingChange(false);
          }}
        >
          {[
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
          <path d={waveformPath} />
        </svg>
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
                    onBoundary={(edge, time) =>
                      props.onStateChange({
                        ...props.state,
                        lanes: props.state.lanes.map((item) =>
                          item.id === lane.id
                            ? updateSegmentBoundary(item, segment.id, edge, time, props.state.rhythm_grid)
                            : item
                        ),
                      })
                    }
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
      </div>
    </ScrollArea>
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
  onEdit: () => void;
  onEditDone: (text: string) => void;
  onBoundary: (edge: "start" | "end", time: number) => void;
  onEditingChange: (editing: boolean) => void;
  onDraggingBoundary: (edge: "start" | "end" | null) => void;
}) {
  const left = (props.segment.start / props.duration) * props.width;
  const right = (props.segment.end / props.duration) * props.width;
  const [draft, setDraft] = useState(props.segment.text);
  function beginDrag(event: React.PointerEvent, edge: "start" | "end") {
    event.preventDefault();
    event.stopPropagation();
    const content = event.currentTarget.closest(".sub-timeline-content") as HTMLElement | null;
    if (!content) return;
    props.onEditingChange(true);
    props.onDraggingBoundary(edge);
    const move = (moveEvent: PointerEvent) => {
      const rect = content.getBoundingClientRect();
      const time = clamp(((moveEvent.clientX - rect.left) / rect.width) * props.duration, 0, props.duration);
      props.onBoundary(edge, time);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      props.onEditingChange(false);
      props.onDraggingBoundary(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
  return (
    <>
      <button
        type="button"
        className={`lyrics-segment ${props.selected ? "selected" : ""} ${props.segment.low_confidence_outlier ? "confidence-warning" : ""}`}
        style={{ left, width: Math.max(4, right - left) }}
        onClick={(event) => {
          event.stopPropagation();
          props.onSelect();
        }}
        title={`${props.segment.text}\nconfidence ${props.segment.confidence.toFixed(3)}`}
      >
        <span className="lyrics-handle start" onPointerDown={(event) => beginDrag(event, "start")} />
        <span className="lyrics-handle end" onPointerDown={(event) => beginDrag(event, "end")} />
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

function AnalysisProgressDialog(props: {
  open: boolean;
  job: JobRecord | null;
  onClose: () => void;
}) {
  return (
    <JobProgressDialog
      open={props.open}
      title="歌詞を解析"
      job={props.job}
      pendingMessage="歌詞解析を準備しています…"
      onClose={props.onClose}
    />
  );
}

function JobProgressDialog(props: {
  open: boolean;
  title: string;
  job: JobRecord | null;
  pendingMessage: string;
  onClose: () => void;
}) {
  const progress = clamp(props.job?.progress ?? 0, 0, 1);
  const status = props.job?.status ?? "queued";
  const running = status === "queued" || status === "running";
  return (
    <Dialog open={props.open} title={props.title} className="job-progress-dialog" onClose={props.onClose}>
      <div className="analysis-progress">
        <div className={`export-progress-status export-progress-status-${status}`}>
          <span>{props.job?.message || props.pendingMessage}</span>
          <strong>{Math.round(progress * 100)}%</strong>
        </div>
        <progress value={progress} max={1} />
        {props.job?.error ? <div className="warning-text">{props.job.error}</div> : null}
      </div>
      <div className="dialog-actions">
        <Button variant="secondary" onClick={props.onClose}>
          {running ? "隠す" : "閉じる"}
        </Button>
      </div>
    </Dialog>
  );
}

export function AlignmentGrid(props: { value: number; onChange: (alignment: number) => void }) {
  return (
    <div className="alignment-grid" role="radiogroup" aria-label="字幕位置">
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
      setStylePresetMessage(`「${saved?.name ?? name}」を保存しました。`);
    } catch (error) {
      setStylePresetMessage(`スタイルを保存できませんでした: ${String(error)}`);
    }
  }
  function applyStylePreset() {
    const preset = stylePresets.find((item) => item.id === selectedStylePresetId);
    if (!preset) return;
    props.onChange(normalizeSubtitleStyle(preset.style));
    setStylePresetName(preset.name);
    setStylePresetMessage(`「${preset.name}」を反映しました。`);
  }
  return (
    <div className="subtitle-style-editor">
      <section className="subtitle-style-section subtitle-style-presets">
        <h3>保存スタイル</h3>
        <div className="subtitle-style-preset-row">
          <Select
            aria-label="保存スタイル"
            value={selectedStylePresetId}
            onChange={(event) => {
              setSelectedStylePresetId(event.target.value);
              setStylePresetMessage("");
            }}
          >
            <option value="">スタイルを選択</option>
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
            反映
          </Button>
        </div>
        <div className="subtitle-style-preset-row">
          <Input
            aria-label="スタイル名"
            placeholder="スタイル名"
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
            保存
          </Button>
        </div>
        {stylePresetMessage ? (
          <small className="font-list-status" role="status">{stylePresetMessage}</small>
        ) : null}
      </section>
      <section className="subtitle-style-section">
        <h3>書体と色</h3>
        <div className="subtitle-style-toolbar">
          <Select aria-label="フォント" value={style.font_name} disabled={!props.fonts} onChange={(event) => patch({ font_name: event.target.value })}>
            {fontOptions.map((font) => <option key={font} value={font}>{font}</option>)}
          </Select>
          <ColorControl label="文字" value={style.primary_color} onChange={(value) => patch({ primary_color: value })} />
          <ColorControl label="背景" value={style.background_color} onChange={(value) => patch({ background_color: `${value}80` })} />
          <ColorControl label="縁" value={style.outline_color} onChange={(value) => patch({ outline_color: value })} />
          <Toggle pressed={style.bold} onPressedChange={(bold) => patch({ bold })} title="太字" aria-label="太字"><Bold size={17} /></Toggle>
          <Toggle pressed={style.italic} onPressedChange={(italic) => patch({ italic })} title="斜体" aria-label="斜体"><Italic size={17} /></Toggle>
        </div>
        {!props.fonts && !props.fontListError ? <small className="font-list-status">OSのフォント一覧を読み込んでいます…</small> : null}
        {props.fontListError ? <small className="font-list-status warning-text">フォント一覧を取得できませんでした。</small> : null}
      </section>
      <section className="subtitle-style-section subtitle-style-layout">
        <div>
          <h3>表示位置</h3>
          <AlignmentGrid value={style.alignment} onChange={(alignment) => patch({ alignment })} />
        </div>
        <div className="subtitle-style-fields">
          <label>サイズ<Input type="number" min={SUBTITLE_STYLE_LIMITS.font_size.min} max={SUBTITLE_STYLE_LIMITS.font_size.max} value={style.font_size} onChange={(event) => patch({ font_size: Number(event.target.value) })} /></label>
          <label>縁幅<Input type="number" min={SUBTITLE_STYLE_LIMITS.outline.min} max={SUBTITLE_STYLE_LIMITS.outline.max} value={style.outline} onChange={(event) => patch({ outline: Number(event.target.value) })} /></label>
          <label>影<Input type="number" min={SUBTITLE_STYLE_LIMITS.shadow.min} max={SUBTITLE_STYLE_LIMITS.shadow.max} value={style.shadow} onChange={(event) => patch({ shadow: Number(event.target.value) })} /></label>
          <label>左右余白<Input type="number" min={SUBTITLE_STYLE_LIMITS.margin.min} max={SUBTITLE_STYLE_LIMITS.margin.max} value={style.margin_l} onChange={(event) => patch({ margin_l: Number(event.target.value), margin_r: Number(event.target.value) })} /></label>
          <label>上下余白<Input type="number" min={SUBTITLE_STYLE_LIMITS.margin.min} max={SUBTITLE_STYLE_LIMITS.margin.max} value={style.margin_v} onChange={(event) => patch({ margin_v: Number(event.target.value) })} /></label>
        </div>
      </section>
      <section className="subtitle-style-section subtitle-effect-section">
        <div className="subtitle-effect-heading">
          <h3>出力エフェクト</h3>
          <small>書き出し時だけ適用され、編集中のプレビューには表示されません。</small>
        </div>
        <div className="subtitle-effect-fields">
          <label>
            種類
            <Select
              aria-label="エフェクト種類"
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
                <option key={item.name} value={item.name}>{item.label}</option>
              ))}
            </Select>
          </label>
          {effect.name !== "cut" ? (
            <>
              <label>
                開始長さ（ms）
                <Input
                  type="number"
                  min={0}
                  step={10}
                  value={effect.start_duration_ms}
                  onChange={(event) => patchEffect({ start_duration_ms: Math.max(0, Number(event.target.value)) })}
                />
              </label>
              <label>
                終了長さ（ms）
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
                      {parameter.label}
                      <Select
                        value={String(value)}
                        onChange={(event) => patchEffectParam(parameter.name, event.target.value)}
                      >
                        {parameter.options.map(([optionValue, label]) => (
                          <option key={optionValue} value={optionValue}>{label}</option>
                        ))}
                      </Select>
                    </label>
                  );
                }
                if (parameter.kind === "color") {
                  return (
                    <ColorControl
                      key={parameter.name}
                      label={parameter.label}
                      value={String(value)}
                      onChange={(next) => patchEffectParam(parameter.name, next)}
                    />
                  );
                }
                return (
                  <label key={parameter.name}>
                    {parameter.label}
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
            短い字幕では、開始長さと終了長さの比率を保ったまま区間内へ自動短縮します。
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
    if (!window.confirm(`${lanes[lyricsLaneIndex].name} の字幕を解析結果で置換しますか？`)) return state;
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
      if (targetIndex < 0 || !window.confirm(`${lanes[targetIndex].name} をタイトル用に置換しますか？`)) return state;
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

function simpleWaveformPath(points: WaveformPoint[], duration: number, width: number, height: number) {
  if (!points.length) return "";
  const middle = height / 2;
  return points
    .map((point) => {
      const x = clamp(point.t / duration, 0, 1) * width;
      const amplitude = clamp(Math.max(Math.abs(point.min), Math.abs(point.max)), 0, 1) * middle;
      return `M${x.toFixed(2)},${(middle - amplitude).toFixed(2)}V${(middle + amplitude).toFixed(2)}`;
    })
    .join("");
}
