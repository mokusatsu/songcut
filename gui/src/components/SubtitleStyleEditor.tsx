import { useState } from "react";
import { Bold, Italic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RadixSelect,
  RadixSelectContent,
  RadixSelectGroup,
  RadixSelectItem,
  RadixSelectLabel,
  RadixSelectTrigger,
  RadixSelectValue,
} from "@/components/ui/radix-select";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { currentUiLanguage, tr } from "@/i18n";
import {
  defaultSubtitleEffectParams,
  subtitleEffectDefinition,
  type SubtitleEffectParameterValue,
  type SubtitleEffectCatalog,
  type SubtitleEffectChoice,
  type SubtitleEffectDefinition,
  type SubtitleEffectParameterSchema,
  type SubtitleEffectSettings,
} from "@/lib/subtitleEffects";
import { useSubtitleEffectCatalogContext } from "@/lib/subtitleEffectCatalog";
import {
  readSubtitleStylePresets,
  upsertSubtitleStylePreset,
  writeSubtitleStylePresets,
} from "@/lib/subtitleStylePresets";
import {
  normalizeSubtitleStyle,
  SUBTITLE_STYLE_LIMITS,
  type SubtitleStyle,
} from "@/lib/subtitles";

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
export type SubtitleStyleEditorProps = {
  style: SubtitleStyle;
  effect: SubtitleEffectSettings;
  fonts: string[] | null;
  fontListError: string | null;
  onChange: (style: SubtitleStyle) => void;
  onEffectChange: (effect: SubtitleEffectSettings) => void;
};

/** 字幕スタイルと表示効果を編集する共通フォームを描画する。 */
export function SubtitleStyleEditor(props: SubtitleStyleEditorProps) {
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
        <div className="subtitle-effect-type-row">
          <label className="subtitle-effect-type-control">
            <span>{tr("sub.effectType")}</span>
            <RadixSelect
              value={effect.name}
              onValueChange={(name) => patchEffect({
                name: name as SubtitleEffectSettings["name"],
                params: defaultSubtitleEffectParams(name, catalog),
              })}
            >
              <RadixSelectTrigger aria-label={tr("sub.effectType")}>
                <RadixSelectValue />
              </RadixSelectTrigger>
              <RadixSelectContent>
                {effectGroups.map((group) => (
                  <RadixSelectGroup key={group.label}>
                    <RadixSelectLabel>{group.label}</RadixSelectLabel>
                    {group.effects.map((item) => (
                      <RadixSelectItem key={item.effect_id} value={item.effect_id} data-effect-id={item.effect_id}>
                        {effectLabel(item)}
                      </RadixSelectItem>
                    ))}
                  </RadixSelectGroup>
                ))}
              </RadixSelectContent>
            </RadixSelect>
          </label>
          <small className="subtitle-effect-description">{effectDescription(effectDefinition)}</small>
        </div>
        {effect.name !== "cut" && effectDefinition ? (
          <>
            <div className="subtitle-effect-duration-row">
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
            </div>
            <div className="subtitle-effect-parameter-grid">
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
                    </div>
                  );
                }
                if (parameter.kind === "palette") {
                  const palette = value as string[];
                  return (
                    <div
                      key={parameterName}
                      className="subtitle-effect-palette-field"
                      data-effect-parameter={parameterName}
                    >
                      <span>{parameterLabel(parameter)}</span>
                      {palette.map((paletteColor, index) => (
                        <div key={index} data-palette-index={index}>
                          <ColorControl
                            label={`${parameterLabel(parameter)} ${index + 1}`}
                            value={paletteColor}
                            onChange={(next) => patchEffectParam(
                              parameterName,
                              replacePaletteColor(palette, index, next),
                            )}
                          />
                        </div>
                      ))}
                    </div>
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
                  </label>
                );
              })}
            </div>
          </>
        ) : null}
        {effect.name !== "cut" ? (
          <small className="font-list-status">
            {tr("sub.shortSubtitleHelp")}
          </small>
        ) : null}
        {effectDefinition.preview_url || effectDefinition.catalog_page_url_en || effectDefinition.catalog_page_url_ja ? (
          <div className="subtitle-effect-links">
            {effectDefinition.preview_url ? (
              <>
                <div className="subtitle-effect-preview-frame">
                  <video
                    className="subtitle-effect-preview"
                    controls
                    preload="none"
                    src={effectDefinition.preview_url}
                    aria-label={tr("sub.effectSample")}
                  />
                </div>
              </>
            ) : null}
            <div className="subtitle-effect-link-actions">
              {effectDefinition.preview_url ? (
                <a
                  className="button button-secondary button-sm subtitle-effect-link"
                  href={effectDefinition.preview_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr("sub.effectSample")}
                </a>
              ) : null}
              {(currentUiLanguage() === "ja"
                ? effectDefinition.catalog_page_url_ja
                : effectDefinition.catalog_page_url_en) ? (
                <a
                  className="button button-secondary button-sm subtitle-effect-link"
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
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** `replacePaletteColor`で指定された色だけを差し替え、配列の順序と長さを保持する。 */
export function replacePaletteColor(palette: readonly string[], index: number, value: string): string[] {
  return palette.map((color, paletteIndex) => (paletteIndex === index ? value : color));
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
