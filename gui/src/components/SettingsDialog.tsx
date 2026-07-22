import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WhisperSettingsPanel } from "@/components/WhisperSettingsPanel";
import { HelpTooltip } from "@/components/HelpTooltip";
import type { AnalysisDevice, WhisperSettings, WhisperStatus } from "@/lib/api";
import type { BoundaryRefinementSettings } from "@/lib/boundaryRefinement";
import { DEFAULT_FILENAME_TEMPLATE, FILENAME_TEMPLATE_PLACEHOLDERS } from "@/lib/exportNaming";
import type { WaveformDisplayMode } from "@/types";
import { currentUiLanguage, tr, type UiLanguagePreference } from "@/i18n";

const inferenceDevices = ["auto", "npu", "gpu", "cpu"] as const;

export function SettingsDialog(props: {
  open: boolean;
  apiReady: boolean;
  scratchPreviewMillisecondsInput: string;
  scratchAudioProxyEnabled: boolean;
  waveformDisplayMode: WaveformDisplayMode;
  analysisDevice: AnalysisDevice;
  boundaryRefinementSettings: BoundaryRefinementSettings;
  filenameTemplate: string;
  filenameTemplateError: string | null;
  whisperSettings: WhisperSettings;
  whisperStatus: WhisperStatus | null;
  whisperBusy: boolean;
  hasSegments: boolean;
  transcriptStale: boolean;
  sourceAvailable: boolean;
  localePreference: UiLanguagePreference;
  localeRestartRequired: boolean;
  onClose: () => void;
  onScratchPreviewMillisecondsInput: (value: string) => void;
  onScratchAudioProxyEnabled: (enabled: boolean) => void;
  onWaveformDisplayMode: (mode: WaveformDisplayMode) => void;
  onAnalysisDevice: (device: AnalysisDevice) => void;
  onBoundaryRefinementSettings: (settings: BoundaryRefinementSettings) => void;
  onFilenameTemplate: (value: string) => void;
  onWhisperSettings: (settings: WhisperSettings) => void;
  onPrepareWhisperModel: () => void;
  onTranscribe: () => void;
  onFfmpegCheck: () => void;
  onLocalePreference: (preference: UiLanguagePreference) => void;
}) {
  return (
    <Dialog open={props.open} title={tr("settings.title")} onClose={props.onClose}>
      <ScrollArea className="settings-dialog-scroll" viewportClassName="settings-dialog-viewport">
        <div className="settings-dialog-content">
        <section className="settings-section" aria-labelledby="playback-settings-heading">
          <h3 id="playback-settings-heading">{tr("settings.playback")}</h3>
          <div className="settings-grid">
            <label className="settings-field" htmlFor="scratch-preview-milliseconds">
              <span>{tr("settings.scratchDuration")}</span>
              <span className="settings-inline-control">
                <Input
                  id="scratch-preview-milliseconds"
                  type="number"
                  min={1}
                  max={5000}
                  step="1"
                  inputMode="numeric"
                  value={props.scratchPreviewMillisecondsInput}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => props.onScratchPreviewMillisecondsInput(event.currentTarget.value)}
                />
                <span className="settings-unit">ms</span>
              </span>
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={props.scratchAudioProxyEnabled}
                onChange={(event) => props.onScratchAudioProxyEnabled(event.currentTarget.checked)}
              />
              {tr("settings.useProxy")}
            </label>
            <label className="settings-field">
              <span>{tr("settings.waveform")}</span>
              <select
                value={props.waveformDisplayMode}
                onChange={(event) => props.onWaveformDisplayMode(event.currentTarget.value as WaveformDisplayMode)}
              >
                <option value="rms">RMS</option>
                <option value="peak">{tr("settings.peak")}</option>
                <option value="peak-rms">{tr("settings.peakRms")}</option>
              </select>
            </label>
            <label className="settings-field">
              <span>{tr("settings.analysisDevice")}</span>
              <select
                value={props.analysisDevice}
                onChange={(event) => props.onAnalysisDevice(event.currentTarget.value as AnalysisDevice)}
              >
                {inferenceDevices.map((device) => (
                  <option key={device} value={device}>
                    {device === "auto" ? tr("common.auto") : device.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <BoundaryRefinementSection
          settings={props.boundaryRefinementSettings}
          onChange={props.onBoundaryRefinementSettings}
        />

        <section className="settings-section" aria-labelledby="whisper-settings-heading">
          <h3 id="whisper-settings-heading">{tr("settings.whisper")}</h3>
          <WhisperSettingsPanel
            settings={props.whisperSettings}
            status={props.whisperStatus}
            busy={props.whisperBusy}
            hasSegments={props.hasSegments}
            transcriptStale={props.transcriptStale}
            sourceAvailable={props.sourceAvailable}
            onChange={props.onWhisperSettings}
            onDownload={props.onPrepareWhisperModel}
            onTranscribe={props.onTranscribe}
          />
        </section>

        <section className="settings-section" aria-labelledby="export-settings-heading">
          <h3 id="export-settings-heading">{tr("settings.export")}</h3>
          <label className="settings-field" htmlFor="export-filename-template">
            <span>{tr("settings.filenameTemplate")}</span>
            <Input
              id="export-filename-template"
              value={props.filenameTemplate}
              placeholder={DEFAULT_FILENAME_TEMPLATE}
              spellCheck={false}
              aria-invalid={Boolean(props.filenameTemplateError)}
              onChange={(event) => props.onFilenameTemplate(event.currentTarget.value)}
            />
          </label>
          <span className="settings-field-help">
            {tr("settings.placeholders", { placeholders: FILENAME_TEMPLATE_PLACEHOLDERS.map((name) => `{${name}}`).join(", ") })}
          </span>
          {props.filenameTemplateError ? (
            <span className="settings-field-error" role="alert">
              {props.filenameTemplateError}
            </span>
          ) : null}
          <span className="settings-field-help">{tr("settings.projectOnly")}</span>
        </section>

        <section className="settings-section" aria-labelledby="language-settings-heading">
          <h3 id="language-settings-heading">{tr("settings.languageHeading")}</h3>
          <label className="settings-field" htmlFor="ui-language">
            <select
              id="ui-language"
              value={props.localePreference}
              onChange={(event) => props.onLocalePreference(event.currentTarget.value as UiLanguagePreference)}
            >
              <option value="system">{tr("settings.system")}</option>
              <option value="en">{tr("settings.english")}</option>
              <option value="ja">{tr("settings.japanese")}</option>
            </select>
          </label>
          <span className="settings-field-help" data-locale-restart-required={props.localeRestartRequired || undefined}>
            {tr("settings.languageNextStart")}
          </span>
        </section>

        <section className="settings-section settings-tools" aria-labelledby="tools-settings-heading">
          <div>
            <h3 id="tools-settings-heading">{tr("settings.tools")}</h3>
            <p>{tr("settings.toolsHelp")}</p>
          </div>
          <Button variant="secondary" onClick={props.onFfmpegCheck} disabled={!props.apiReady}>
            {tr("settings.ffmpegCheck")}
          </Button>
        </section>
        </div>
      </ScrollArea>
      <div className="dialog-actions settings-dialog-actions">
        <span>{tr("settings.applied")}</span>
        <Button onClick={props.onClose}>{tr("common.done")}</Button>
      </div>
    </Dialog>
  );
}

type NumericBoundaryKey = Exclude<keyof BoundaryRefinementSettings, "enabled">;

const boundaryFields: Array<{
  key: NumericBoundaryKey;
  en: string;
  ja: string;
  tipEn: string;
  tipJa: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}> = [
  { key: "search_radius_seconds", en: "Search radius", ja: "探索幅", tipEn: "Seconds searched before and after the coarse boundary. A wider range costs more processing and can admit unrelated transitions.", tipJa: "粗い境界の前後を探索する秒数です。広げるほど処理量が増え、無関係な変化点を拾いやすくなります。", min: 5, max: 120, step: 1, unit: "s" },
  { key: "rms_window_ms", en: "RMS window", ja: "RMS窓", tipEn: "RMS measurement window. Smaller values favor time precision; larger values stabilize level estimates.", tipJa: "RMSを測る窓幅です。小さいほど時間精度を、大きいほど音量の安定性を優先します。", min: 50, max: 100, step: 10, unit: "ms" },
  { key: "occupancy_window_seconds", en: "Occupancy window", ja: "占有率窓", tipEn: "Time span used to measure how continuously the waveform stays in the dense song-like state.", tipJa: "波形が海苔弁状の高音量状態をどれだけ連続して占めるか集計する時間です。", min: 0.5, max: 10, step: 0.1, unit: "s" },
  { key: "high_occupancy", en: "High-state occupancy", ja: "高状態占有率", tipEn: "Share of high-level frames required to regard the signal as entering the singing side.", tipJa: "歌唱側へ入ったとみなすために必要な高音量フレームの割合です。", min: 0.5, max: 1, step: 0.01, unit: "%" },
  { key: "low_occupancy", en: "Low-state occupancy", ja: "低状態占有率", tipEn: "Share at or below which the signal returns to the MC side. The gap from the high threshold creates hysteresis and prevents chatter.", tipJa: "MC側へ戻ったとみなす割合です。高状態閾値との間がヒステリシスとなり、判定のばたつきを防ぎます。", min: 0, max: 0.5, step: 0.01, unit: "%" },
  { key: "start_persistence_seconds", en: "Start persistence", ja: "開始持続時間", tipEn: "How long the high state must continue before accepting a start, rejecting brief shouts and other spikes.", tipJa: "開始として採用するまで高状態が続く必要のある時間です。瞬間的な大声などを除外します。", min: 0.5, max: 10, step: 0.1, unit: "s" },
  { key: "end_persistence_seconds", en: "End persistence", ja: "終了持続時間", tipEn: "How long the low state must continue before accepting an end, ignoring short silences, breaths, and song breaks.", tipJa: "終了として採用するまで低状態が続く必要のある時間です。短い無音、ブレス、曲中ブレイクを無視します。", min: 0.5, max: 15, step: 0.1, unit: "s" },
  { key: "contrast_window_seconds", en: "Contrast window", ja: "コントラスト窓", tipEn: "Time compared on both sides of a candidate. Larger values are steadier; smaller values react to finer changes.", tipJa: "候補点の左右を比較する時間です。大きいほど安定し、小さいほど細かい変化へ反応します。", min: 1, max: 15, step: 0.1, unit: "s" },
  { key: "pre_roll_seconds", en: "Pre-roll", ja: "pre-roll", tipEn: "Fixed margin retained before the detected start so the song opening is not clipped.", tipJa: "検出した開始点より前に残す固定余白です。曲頭の欠けを防ぎます。", min: 0.3, max: 1, step: 0.1, unit: "s" },
  { key: "post_roll_seconds", en: "Post-roll", ja: "post-roll", tipEn: "Fixed margin retained after the detected end to preserve reverb and the musical tail.", tipJa: "検出した終了点より後に残す固定余白です。残響や余韻を残すために使います。", min: 0.3, max: 1, step: 0.1, unit: "s" },
];

function BoundaryRefinementSection(props: {
  settings: BoundaryRefinementSettings;
  onChange: (settings: BoundaryRefinementSettings) => void;
}) {
  const ja = currentUiLanguage() === "ja";
  const update = (patch: Partial<BoundaryRefinementSettings>) => props.onChange({ ...props.settings, ...patch });
  return (
    <section className="settings-section" aria-labelledby="boundary-refinement-settings-heading">
      <h3 id="boundary-refinement-settings-heading">{ja ? "局所境界補正" : "Local boundary refinement"}</h3>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={props.settings.enabled}
          onChange={(event) => update({ enabled: event.currentTarget.checked })}
        />
        <HelpTooltip label={ja ? "有効" : "Enabled"}>
          {ja
            ? "acoustic検出区間の境界だけを、次回の解析時に局所RMSで補正します。メタデータ区間と明示ガイド範囲は対象外です。"
            : "Refines only acoustic-detected boundaries with local RMS during the next analysis. Metadata and explicit guide ranges are unchanged."}
        </HelpTooltip>
      </label>
      <div className="settings-grid">
        {boundaryFields.map((field) => {
          const displayValue = field.unit === "%" ? props.settings[field.key] * 100 : props.settings[field.key];
          const min = field.unit === "%" ? field.min * 100 : field.min;
          const max = field.unit === "%" ? field.max * 100 : field.max;
          const step = field.unit === "%" ? field.step * 100 : field.step;
          return (
            <label className="settings-field" htmlFor={`boundary-${field.key}`} key={field.key}>
              <HelpTooltip label={ja ? field.ja : field.en}>{ja ? field.tipJa : field.tipEn}</HelpTooltip>
              <span className="settings-inline-control">
                <Input
                  id={`boundary-${field.key}`}
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  disabled={!props.settings.enabled}
                  value={displayValue}
                  onChange={(event) => {
                    const parsed = Number(event.currentTarget.value);
                    if (!Number.isFinite(parsed)) return;
                    let value = field.unit === "%" ? parsed / 100 : parsed;
                    value = Math.min(field.max, Math.max(field.min, value));
                    if (field.key === "low_occupancy") value = Math.min(value, props.settings.high_occupancy - 0.01);
                    if (field.key === "high_occupancy") value = Math.max(value, props.settings.low_occupancy + 0.01);
                    update({ [field.key]: value });
                  }}
                />
                <span className="settings-unit">{field.unit}</span>
              </span>
            </label>
          );
        })}
      </div>
      <span className="settings-field-help">
        {ja
          ? "変更は次回の解析から反映されます。設定は全動画共通で、acoustic検出区間だけが対象です。"
          : "Changes apply to the next analysis. These settings are shared by all videos and affect acoustic detections only."}
      </span>
    </section>
  );
}
