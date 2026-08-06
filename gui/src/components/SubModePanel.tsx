import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  Bold,
  Plus,
  Save,
  Trash2,
  Italic,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToolbar } from "@/components/ModeToolbar";
import { SubTimelineEditor } from "@/components/SubTimelineEditor";
import { Dialog } from "@/components/ui/dialog";
import { JobProgressDialog } from "@/components/JobProgressDialog";
import { SegmentTimingDialog } from "@/components/SegmentTimingDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { tr } from "@/i18n";
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
  createLyricsLane,
  normalizeSubtitleStyle,
  selectedSubtitleSegment,
  SUBTITLE_STYLE_LIMITS,
  subtitleRenderSignature,
  type LyricsLane,
  type LyricsSegment,
  type SubtitleProjectState,
  type SubtitleRenderRequest,
  type SubtitleStyle,
} from "@/lib/subtitles";
import { clamp, formatTime } from "@/lib/time";
import type { ModePanelViewModel } from "@/lib/modeViewModel";
import type { JobRecord } from "@/types";

type SubModePanelOperationView = {
  analysisJob: JobRecord | null;
  exportJob: JobRecord | null;
  busy: "analysis" | "export" | null;
};

type SubModePanelCapabilities = {
  canAddSegment: boolean;
  canDeleteSelectedSegment: boolean;
};

type SubModePanelActions = {
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

export type SubModePanelProps = {
  view: ModePanelViewModel;
  state: SubtitleProjectState;
  capabilities: SubModePanelCapabilities;
  operation: SubModePanelOperationView;
  actions: SubModePanelActions;
  taskStatus: React.ReactNode;
  onStateChange: (state: SubtitleProjectState) => void;
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

/** `SubModePanel`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
export function SubModePanel(props: SubModePanelProps) {
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsText, setLyricsText] = useState("");
  const [laneDialogOpen, setLaneDialogOpen] = useState(false);
  const [styleLaneId, setStyleLaneId] = useState<string | null>(null);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [timingTarget, setTimingTarget] = useState<{ laneId: string; segmentId: string } | null>(null);
  const [preparingModel, setPreparingModel] = useState(false);
  const [analysisProgressOpen, setAnalysisProgressOpen] = useState(false);
  const [exportProgressOpen, setExportProgressOpen] = useState(false);
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null);
  const [fontListError, setFontListError] = useState<string | null>(null);
  const busy = props.operation.busy;
  const media = props.view.media;
  const selected = selectedSubtitleSegment(props.state);
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
  const canAddSegment = props.capabilities.canAddSegment;
  const renderPlan = useMemo(() => {
    const width = media.videoInfo?.video.width || 1920;
    const height = media.videoInfo?.video.height || 1080;
    return props.state.lanes.flatMap((lane) =>
      lane.segments.map((segment) => ({
        segment,
        style: lane.style,
        signature: subtitleRenderSignature(segment.text, lane.style, width, height),
      }))
    );
  }, [props.state.lanes, media.videoInfo?.video.width, media.videoInfo?.video.height]);
  const renderPlanKey = renderPlan
    .map(({ segment, signature }) => `${segment.id}\u0000${signature}\u0000${segment.render_cache?.signature ?? ""}`)
    .join("\u0001");

  useEffect(() => {
    if (!media.videoInfo) return;
    const missing = renderPlan.filter(
      ({ segment, signature }) => segment.render_cache?.signature !== signature
    );
    if (!missing.length) return;
    const timer = window.setTimeout(() => {
      const width = media.videoInfo?.video.width || 1920;
      const height = media.videoInfo?.video.height || 1080;
      void props.actions.renderSubtitles({
        width,
        height,
        items: missing.map(({ segment, style, signature }) => ({
          segment_id: segment.id,
          signature,
          text: segment.text,
          style,
        })),
      });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      props.actions.invalidateSubtitleRender();
    };
  }, [media.videoInfo, props.actions.renderSubtitles, props.actions.invalidateSubtitleRender, renderPlanKey]);

  useEffect(() => {
    if (!styleLane || systemFonts || fontListError) return;
    let cancelled = false;
    props.actions.listSystemFonts()
      .then((fonts) => {
        if (!cancelled) setSystemFonts(fonts);
      })
      .catch((error) => {
        if (!cancelled) setFontListError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [styleLane, systemFonts, fontListError, props.actions.listSystemFonts]);

  /** `analyzeLyrics`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function analyzeLyrics() {
    if (!lyricsText.trim()) return;
    setLyricsOpen(false);
    setAnalysisProgressOpen(true);
    await props.actions.analyzeLyrics(lyricsText);
  }

  /** `openLyricsDialog`の対象を利用可能にし、画面表示に必要な状態を同期する。 */
  async function openLyricsDialog() {
    setPreparingModel(true);
    try {
      await props.actions.prepareAnalysis();
      setLyricsOpen(true);
    } catch (error) {
      props.actions.showMessage(tr("sub.modelDownloadFailed", { detail: String(error) }));
    } finally {
      setPreparingModel(false);
    }
  }

  /** `exportSubtitles`の一連の処理を実行し、進捗・成功・失敗を呼び出し元へ反映する。 */
  async function exportSubtitles() {
    if (await props.actions.exportSubtitles()) setExportProgressOpen(true);
  }

  /** `addLane`の入力を検証し、呼び出し元が利用できる新しい値を組み立てる。 */
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

  /** `removeLane`の対象を取り除き、関連する一時状態やresourceを後始末する。 */
  function removeLane(laneId: string) {
    if (props.state.lanes.length <= 1) return;
    const lane = props.state.lanes.find((item) => item.id === laneId);
    if (lane?.segments.length && !props.actions.confirmRemoveLane(lane)) return;
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

  /** `updateLane`で指定された変更を不変更新として状態へ反映する。 */
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
      <ModeToolbar
        className="sub-toolbar"
        transport={props.view.transport}
        load={{ onClick: props.actions.load }}
        analyze={{
          onClick: () => void openLyricsDialog(),
          disabled: !media.sourceAvailable || Boolean(busy) || preparingModel,
        }}
        exportAction={{
          onClick: () => void exportSubtitles(),
          disabled: !media.sourceAvailable || !hasSubtitleSegments(props.state) || Boolean(busy),
          icon: <Save size={16} />,
        }}
        settings={{ onClick: props.actions.openSettings }}
      >
        <Button
          variant="secondary"
          onClick={() => setLaneDialogOpen(true)}
          disabled={props.state.lanes.length >= 3 || Boolean(busy)}
        >
          <Plus size={16} />
          {tr("sub.timeline")}
        </Button>
        <Button variant="secondary" onClick={props.actions.addSegment} disabled={!canAddSegment || Boolean(busy)}>
          <Plus size={16} />
          {tr("sub.segment")}
        </Button>
        <Button
          variant="secondary"
          onClick={props.actions.removeSelectedSegment}
          disabled={!props.capabilities.canDeleteSelectedSegment || Boolean(busy)}
        >
          <Trash2 size={16} />
        </Button>
      </ModeToolbar>
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
      <SubTimelineEditor
        {...media}
        state={props.state}
        selectedSegment={selected?.segment ?? null}
        editingSegmentId={editingSegmentId}
        onEditingSegmentId={setEditingSegmentId}
        onStateChange={props.onStateChange}
        onBoundaryPreview={props.onBoundaryPreview}
        onBoundaryCancel={props.onBoundaryCancel}
        onBoundaryCommit={props.onBoundaryCommit}
        onStyle={(laneId) => setStyleLaneId(laneId)}
        onRemoveLane={removeLane}
        onSelectSegment={props.actions.selectSegment}
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
        job={props.operation.analysisJob}
        pendingMessage={tr("sub.lyricsAnalysisPreparing")}
        onClose={() => setAnalysisProgressOpen(false)}
        className="job-progress-dialog"
        bodyClassName="analysis-progress"
        closeAction={{ statuses: "always", activeLabel: tr("sub.closeHidden"), terminalLabel: tr("sub.closeTerminal") }}
      />
      <JobProgressDialog
        open={exportProgressOpen}
        title={tr("sub.subtitleExportTitle")}
        job={props.operation.exportJob}
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
        mediaDuration={media.duration}
        previousEnd={timingSegmentIndex > 0 ? timingOrderedSegments[timingSegmentIndex - 1].end : undefined}
        nextStart={timingSegmentIndex >= 0 && timingSegmentIndex < timingOrderedSegments.length - 1
          ? timingOrderedSegments[timingSegmentIndex + 1].start
          : undefined}
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
          media.onSeek(start);
        }}
      />
    </>
  );
}


/** `SubtitleOverlay`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
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

/** `AlignmentGrid`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
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

/** `SubtitleStyleEditor`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
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
  /** `patch`で指定された変更を不変更新として状態へ反映する。 */
  function patch(value: Partial<SubtitleStyle>) {
    props.onChange(normalizeSubtitleStyle({ ...style, ...value }));
  }
  /** `patchEffect`で指定された変更を不変更新として状態へ反映する。 */
  function patchEffect(value: Partial<SubtitleEffectSettings>) {
    props.onEffectChange({ ...effect, ...value });
  }
  /** `patchEffectParam`で指定された変更を不変更新として状態へ反映する。 */
  function patchEffectParam(name: string, value: SubtitleEffectParameterValue) {
    patchEffect({ params: { ...effect.params, [name]: value } });
  }
  /** `saveStylePreset`の値を検証済みの形式で永続先へ保存する。 */
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
  /** `applyStylePreset`で指定された変更を不変更新として状態へ反映する。 */
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

/** `ColorControl`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
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

/** `subtitleEffectLabel`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function subtitleEffectLabel(name: string, fallback: string) {
  const key = `sub.effect.${name}`;
  const translated = tr(key);
  return translated === key ? fallback : translated;
}

/** `subtitleEffectParameterLabel`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function subtitleEffectParameterLabel(name: string, fallback: string) {
  const key = `sub.effect.param.${name}`;
  const translated = tr(key);
  return translated === key ? fallback : translated;
}

/** `subtitleEffectOptionLabel`のdomain規則を適用し、画面または保存処理で使う値を返す。 */
function subtitleEffectOptionLabel(value: string, fallback: string) {
  const key = `sub.effect.option.${value}`;
  const translated = tr(key);
  return translated === key ? fallback : translated;
}

/** `hasSubtitleSegments`の入力が要求された条件やschemaを満たすか検証する。 */
function hasSubtitleSegments(state: SubtitleProjectState) {
  return state.lanes.some((lane) => lane.segments.length > 0);
}
