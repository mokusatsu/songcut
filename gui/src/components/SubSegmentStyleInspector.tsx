import { SubtitleStyleEditor } from "@/components/SubtitleStyleEditor";
import { useEditorActionFocusProps } from "@/components/ui/editor-focus";
import { tr } from "@/i18n";
import type { SelectedSubtitleSegment } from "@/lib/subtitleLaneOperations";
import {
  resolveSubtitleSegmentStyle,
  type LyricsLane,
  type LyricsSegment,
} from "@/lib/subtitles";
import type { SubtitleEffectCatalog } from "@/lib/subtitleEffects";

export type SubtitleSelectionStyleMode = "inherit" | "custom" | "mixed";

/** 選択中セグメントのStyleモードが一様か混在かを返す。 */
export function subtitleSelectionStyleMode(modes: readonly ("inherit" | "custom")[]): SubtitleSelectionStyleMode {
  if (modes.every((mode) => mode === "custom")) return "custom";
  if (modes.every((mode) => mode === "inherit")) return "inherit";
  return "mixed";
}

/** 選択中の歌詞行へ即時反映するStyle編集欄を描画する。 */
export function SubSegmentStyleInspector(props: {
  lanes: readonly LyricsLane[];
  selections: readonly SelectedSubtitleSegment[];
  primary: SelectedSubtitleSegment;
  catalog: SubtitleEffectCatalog;
  fonts: string[] | null;
  fontListError: string | null;
  onCommit: (
    style: LyricsSegment["style_override"],
    effect: LyricsSegment["effect_override"],
  ) => void;
}) {
  const radioFocusProps = useEditorActionFocusProps<HTMLInputElement>();
  const resolvedSelections = props.selections.flatMap((selection) => {
    const lane = props.lanes.find((candidate) => candidate.id === selection.laneId);
    return lane ? [resolveSubtitleSegmentStyle(lane, selection.segment, props.catalog)] : [];
  });
  const primaryLane = props.lanes.find((lane) => lane.id === props.primary.laneId);
  if (!primaryLane || !resolvedSelections.length) return null;
  const resolved = resolveSubtitleSegmentStyle(primaryLane, props.primary.segment, props.catalog);
  const mode = subtitleSelectionStyleMode(resolvedSelections.map((selection) => selection.mode));
  const selectionKey = props.selections.map(({ segment }) => segment.id).join("-");

  return (
    <div className="segment-inspector-style-editor">
      <fieldset className="segment-style-mode">
        <legend>{tr("segmentTiming.styleMode")}</legend>
        <label>
          <input
            {...radioFocusProps}
            type="radio"
            name={`segment-style-mode-${selectionKey}`}
            checked={mode === "inherit"}
            onChange={() => props.onCommit(undefined, undefined)}
          />
          {tr("segmentTiming.inheritStyle")}
        </label>
        <label>
          <input
            {...radioFocusProps}
            type="radio"
            name={`segment-style-mode-${selectionKey}`}
            checked={mode === "custom"}
            onChange={() => props.onCommit(resolved.style, resolved.effect)}
          />
          {tr("segmentTiming.customStyle")}
        </label>
      </fieldset>
      {mode === "mixed" ? <p className="segment-style-mixed">{tr("segmentInspector.mixedStyle")}</p> : null}
      {mode === "custom" ? <div className="segment-style-editor-frame">
        <SubtitleStyleEditor
          style={resolved.style}
          effect={resolved.effect}
          fonts={props.fonts}
          fontListError={props.fontListError}
          onChange={(style) => props.onCommit(style, resolved.effect)}
          onEffectChange={(effect) => props.onCommit(resolved.style, effect)}
        />
      </div> : null}
    </div>
  );
}
