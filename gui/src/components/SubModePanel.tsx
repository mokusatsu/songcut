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
import { currentUiLanguage, tr } from "@/i18n";
import {
  defaultSubtitleEffectParams,
  normalizeSubtitleEffect,
  subtitleEffectDefinition,
  type SubtitleEffectParameterValue,
  type SubtitleEffectCatalog,
  type SubtitleEffectChoice,
  type SubtitleEffectDefinition,
  type SubtitleEffectParameterSchema,
  type SubtitleEffectSettings,
} from "@/lib/subtitleEffects";
import {
  useSubtitleEffectCatalogContext,
  type SubtitleEffectCatalogState,
} from "@/lib/subtitleEffectCatalog";
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
  resolveSubtitleSegmentStyle,
  selectedSubtitleSegment,
  SUBTITLE_STYLE_LIMITS,
  subtitleRenderSignature,
  withSubtitleSegmentStyle,
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
  const catalogState = useSubtitleEffectCatalogContext();
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
  const catalogEffectError = useMemo(
    () => catalogState.catalog ? findSubtitleEffectError(props.state, catalogState.catalog) : null,
    [catalogState.catalog, props.state],
  );
  const renderPlan = useMemo(() => {
    const catalog = catalogState.catalog;
    if (!catalog) return [];
    const width = media.videoInfo?.video.width || 1920;
    const height = media.videoInfo?.video.height || 1080;
    return props.state.lanes.flatMap((lane) =>
      lane.segments.flatMap((segment) => {
        const resolved = tryResolveSubtitleSegmentStyle(lane, segment, catalog);
        if (!resolved) return [];
        const style = resolved.style;
        return {
          segment,
          style,
          signature: subtitleRenderSignature(segment.text, style, width, height),
        };
      })
    );
  }, [catalogState.catalog, props.state.lanes, media.videoInfo?.video.width, media.videoInfo?.video.height]);
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
    if ((!styleLane && !timingSegment) || systemFonts || fontListError) return;
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
  }, [styleLane, timingSegment, systemFonts, fontListError, props.actions.listSystemFonts]);

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
        <SubtitleEffectCatalogStatus state={catalogState} />
        {catalogEffectError ? (
          <span role="alert" className="warning-text">
            {tr("sub.effectCatalogInvalid", { error: catalogEffectError })}
          </span>
        ) : null}
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
        styleOptions={timingLane ? {
          inheritedStyle: timingLane.style,
          inheritedEffect: timingLane.effect,
          renderEditor: (editorProps) => (
            <SubtitleStyleEditor
              {...editorProps}
              fonts={systemFonts}
              fontListError={fontListError}
            />
          ),
        } : undefined}
        onClose={() => setTimingTarget(null)}
        onApply={(start, end, styleOverride, effectOverride) => {
          const catalog = catalogState.catalog;
          if (!timingLane || !timingSegment || !catalog) return;
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
                          ? withSubtitleSegmentStyle(
                              { ...segment, start, end, user_edited: true },
                              styleOverride,
                              effectOverride,
                              catalog,
                            )
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
  const catalogState = useSubtitleEffectCatalogContext();
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
  const catalog = catalogState.catalog;
  const active = catalog
    ? activeSegmentsAt(props.state.lanes, props.currentTime)
    : [];
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
      {active.map(({ lane, segment }) => {
        if (!catalog || !segment.render_cache) return null;
        const resolved = tryResolveSubtitleSegmentStyle(lane, segment, catalog);
        if (!resolved) return null;
        return segment.render_cache.signature === subtitleRenderSignature(
          segment.text,
          resolved.style,
          sourceWidth,
          sourceHeight,
        ) ? (
          <img
            key={segment.id}
            className="subtitle-overlay-image"
            src={`data:image/png;base64,${segment.render_cache.png_base64}`}
            alt=""
            draggable={false}
          />
        ) : null;
      })}
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
  const catalogState = useSubtitleEffectCatalogContext();
  const style = props.style;
  const effect = props.effect;
  const [stylePresets, setStylePresets] = useState(readSubtitleStylePresets);
  const [selectedStylePresetId, setSelectedStylePresetId] = useState("");
  const [stylePresetName, setStylePresetName] = useState("");
  const [stylePresetMessage, setStylePresetMessage] = useState("");
  const effectDefinition = catalogState.catalog
    ? subtitleEffectDefinition(effect.name, catalogState.catalog)
    : undefined;
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
  if (catalogState.status !== "ready" || !catalogState.catalog || !effectDefinition) {
    const statusMessage = catalogState.status === "ready" && !effectDefinition
      ? tr("sub.effectCatalogInvalid", { error: `Unknown subtitle effect_id: ${effect.name}` })
      : catalogState.status === "error"
        ? tr("sub.effectCatalogFailed", { error: catalogState.error })
        : tr("sub.effectCatalogLoading");
    return (
      <div className="subtitle-style-editor" role="status" aria-live="polite">
        <p className="font-list-status warning-text">{statusMessage}</p>
      </div>
    );
  }
  const catalog = catalogState.catalog;
  const effectGroups = groupEffectDefinitions(catalog);
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
        <small className="subtitle-effect-description">{effectDescription(effectDefinition)}</small>
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
                  params: defaultSubtitleEffectParams(name, catalog),
                });
              }}
            >
              {effectGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.effects.map((item) => (
                    <option key={item.effect_id} value={item.effect_id}>{effectLabel(item)}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
          {effect.name !== "cut" && effectDefinition ? (
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
              {Object.entries(effectDefinition.parameters).map(([parameterName, parameter]) => {
                const value = effect.params[parameterName] ?? parameter.default;
                if (parameter.kind === "choice") {
                  return (
                    <label key={parameterName}>
                      {parameterLabel(parameter)}
                      <Select
                        value={String(value)}
                        onChange={(event) => patchEffectParam(parameterName, readChoiceValue(parameter, event.target.value))}
                      >
                        {parameter.choices.map((choice) => {
                          const optionValue = choiceValueForUi(choice);
                          return (
                            <option key={optionValue} value={optionValue}>{choiceLabel(parameter, choice)}</option>
                          );
                        })}
                      </Select>
                      {parameterDescription(parameter) ? <small>{parameterDescription(parameter)}</small> : null}
                    </label>
                  );
                }
                if (parameter.kind === "color") {
                  return (
                    <div key={parameterName} className="subtitle-effect-color-field">
                      <ColorControl
                        label={parameterLabel(parameter)}
                        value={String(value)}
                        onChange={(next) => patchEffectParam(parameterName, next)}
                      />
                      {parameterDescription(parameter) ? <small>{parameterDescription(parameter)}</small> : null}
                    </div>
                  );
                }
                if (parameter.kind === "palette") {
                  return (
                    <label key={parameterName} className="subtitle-effect-palette-field">
                      <span>{parameterLabel(parameter)}</span>
                      <Textarea
                        aria-label={parameterLabel(parameter)}
                        rows={3}
                        value={Array.isArray(value) ? value.join("\n") : String(value)}
                        onChange={(event) => patchEffectParam(
                          parameterName,
                          event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
                        )}
                      />
                      <small>{parameterDescription(parameter)}</small>
                    </label>
                  );
                }
                if (parameter.kind === "boolean") {
                  return (
                    <label key={parameterName}>
                      <span>{parameterLabel(parameter)}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => patchEffectParam(parameterName, event.target.checked)}
                      />
                      <small>{parameterDescription(parameter)}</small>
                    </label>
                  );
                }
                if (parameter.kind === "string") {
                  return (
                    <label key={parameterName}>
                      {parameterLabel(parameter)}
                      <Input
                        type="text"
                        value={String(value)}
                        onChange={(event) => patchEffectParam(parameterName, event.target.value)}
                      />
                      {parameterDescription(parameter) ? <small>{parameterDescription(parameter)}</small> : null}
                    </label>
                  );
                }
                return (
                  <label key={parameterName}>
                    {parameterLabel(parameter)}
                    <Input
                      type="number"
                      min={parameter.min ?? undefined}
                      max={parameter.max ?? undefined}
                      step={parameter.step ?? undefined}
                      value={Number(value)}
                      onChange={(event) => patchEffectParam(parameterName, clampCatalogNumber(Number(event.target.value), parameter))}
                    />
                    <small>{parameterDescription(parameter)}</small>
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
        {effectDefinition.preview_url || effectDefinition.catalog_page_url_en || effectDefinition.catalog_page_url_ja ? (
          <div className="subtitle-effect-links">
            {effectDefinition.preview_url ? (
              <>
                <video
                  className="subtitle-effect-preview"
                  controls
                  preload="none"
                  src={effectDefinition.preview_url}
                  aria-label={tr("sub.effectSample")}
                />
                <a href={effectDefinition.preview_url} target="_blank" rel="noreferrer">
                  {tr("sub.effectSample")}
                </a>
              </>
            ) : null}
            {(currentUiLanguage() === "ja"
              ? effectDefinition.catalog_page_url_ja
              : effectDefinition.catalog_page_url_en) ? (
              <a
                href={currentUiLanguage() === "ja"
                  ? effectDefinition.catalog_page_url_ja ?? undefined
                  : effectDefinition.catalog_page_url_en ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                {tr("sub.effectCatalogPage")}
              </a>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** `ColorControl`の画面要素を描画し、表示値と利用者操作を子要素へ配線する。 */
function ColorControl(props: { label: string; value: string; onChange: (value: string) => void }) {
  const pickerValue = colorPickerValue(props.value);
  return (
    <label className="color-control" title={props.label}>
      <span>{props.label}</span>
      <Input
        type="color"
        aria-label={props.label}
        value={pickerValue}
        onChange={(event) => props.onChange(colorPickerResult(event.target.value, props.value))}
      />
      <Input
        type="text"
        aria-label={`${props.label} value`}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

/** `colorPickerValue`でcatalogのASS／CSS色をHTML pickerへ変換する。 */
function colorPickerValue(value: string) {
  const ass = value.match(/^&H(?:[0-9A-F]{2})?([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})&?$/i);
  if (ass) return `#${ass[3]}${ass[2]}${ass[1]}`.toUpperCase();
  return /^#[0-9A-F]{6}$/i.test(value) ? value.slice(0, 7) : "#000000";
}

/** `colorPickerResult`でpicker値を元のcatalog色形式へ戻す。 */
function colorPickerResult(value: string, previous: string) {
  if (!previous.startsWith("&H")) return value.toUpperCase();
  const hex = value.replace("#", "").toUpperCase();
  const alpha = previous.match(/^&H([0-9A-F]{2})[0-9A-F]{6}&?$/i)?.[1] ?? "";
  return `&H${alpha}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&`;
}

/** `effectLabel`の現在localeに対応するcatalog名称を返す。 */
function effectLabel(effect: SubtitleEffectDefinition) {
  return currentUiLanguage() === "ja" ? effect.name_ja : effect.name_en;
}

/** `effectDescription`の現在localeに対応するcatalog説明を返す。 */
function effectDescription(effect: SubtitleEffectDefinition) {
  return currentUiLanguage() === "ja" ? effect.description_ja : effect.description_en;
}

/** `parameterLabel`の現在localeに対応するcatalog名称を返す。 */
function parameterLabel(parameter: SubtitleEffectParameterSchema) {
  return currentUiLanguage() === "ja" ? parameter.label_ja : parameter.label_en;
}

/** `parameterDescription`の現在localeに対応するcatalog説明を返す。 */
function parameterDescription(parameter: SubtitleEffectParameterSchema) {
  return currentUiLanguage() === "ja" ? parameter.description_ja : parameter.description_en;
}

/** `choiceValueForUi`の選択肢をHTML select値へ変換する。 */
function choiceValueForUi(choice: SubtitleEffectChoice) {
  return choice;
}

/** `readChoiceValue`のselect値をcatalogのchoice値へ戻す。 */
function readChoiceValue(parameter: SubtitleEffectParameterSchema, value: string): SubtitleEffectParameterValue {
  const choice = parameter.choices.find((item) => choiceValueForUi(item) === value);
  if (choice === undefined) return value;
  return choice;
}

/** `choiceLabel`のcatalog提供labelを現在localeで返す。 */
function choiceLabel(parameter: SubtitleEffectParameterSchema, choice: SubtitleEffectChoice) {
  const value = choiceValueForUi(choice);
  const labels = currentUiLanguage() === "ja" ? parameter.choice_labels_ja : parameter.choice_labels_en;
  return labels[value] ?? value;
}

/** `clampCatalogNumber`のcatalog範囲に沿った数値を返す。 */
function clampCatalogNumber(value: number, parameter: SubtitleEffectParameterSchema): number {
  if (!Number.isFinite(value)) return Number(parameter.default) || 0;
  const minimum = parameter.min ?? value;
  const maximum = parameter.max ?? value;
  const clamped = Math.min(maximum, Math.max(minimum, value));
  return parameter.kind === "integer" ? Math.round(clamped) : clamped;
}

/** `groupEffectDefinitions`のcatalog効果をカテゴリごとにまとめる。 */
function groupEffectDefinitions(catalog: SubtitleEffectCatalog) {
  const groups = new Map<string, SubtitleEffectDefinition[]>();
  for (const effect of catalog.effects) {
    const label = currentUiLanguage() === "ja"
      ? effect.major_category_ja || effect.family || "Effects"
      : effect.major_category_en || effect.family || "Effects";
    const list = groups.get(label) ?? [];
    list.push(effect);
    groups.set(label, list);
  }
  return [...groups].map(([label, effects]) => ({ label, effects }));
}

/** `tryResolveSubtitleSegmentStyle`で不正なproject effectを表示用に明示的に除外する。 */
function tryResolveSubtitleSegmentStyle(
  lane: Parameters<typeof resolveSubtitleSegmentStyle>[0],
  segment: Parameters<typeof resolveSubtitleSegmentStyle>[1],
  catalog: SubtitleEffectCatalog,
) {
  try {
    return resolveSubtitleSegmentStyle(lane, segment, catalog);
  } catch {
    // The owning state remains untouched so the caller can report the invalid
    // stable ID/parameter instead of silently changing it to `cut`.
    return null;
  }
}

/** `findSubtitleEffectError`でcatalog検証に失敗したstable IDまたはparameterを報告する。 */
function findSubtitleEffectError(state: SubtitleProjectState, catalog: SubtitleEffectCatalog) {
  for (const lane of state.lanes) {
    try {
      normalizeSubtitleEffect(lane.effect, catalog);
    } catch (error) {
      return String(error);
    }
    for (const segment of lane.segments) {
      if (!segment.effect_override) continue;
      try {
        normalizeSubtitleEffect(segment.effect_override, catalog);
      } catch (error) {
        return String(error);
      }
    }
  }
  return null;
}

/** `SubtitleEffectCatalogStatus`の取得中／失敗／準備完了を表示する。 */
function SubtitleEffectCatalogStatus(props: { state: SubtitleEffectCatalogState }) {
  if (props.state.status === "ready") return <span role="status">{tr("sub.effectCatalogReady")}</span>;
  if (props.state.status === "error") {
    return <span role="alert" className="warning-text">{tr("sub.effectCatalogFailed", { error: props.state.error })}</span>;
  }
  return <span role="status" className="warning-text">{tr("sub.effectCatalogLoading")}</span>;
}

/** `hasSubtitleSegments`の入力が要求された条件やschemaを満たすか検証する。 */
function hasSubtitleSegments(state: SubtitleProjectState) {
  return state.lanes.some((lane) => lane.segments.length > 0);
}
