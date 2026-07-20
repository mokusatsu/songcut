import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WhisperSettingsPanel } from "@/components/WhisperSettingsPanel";
import type { AnalysisDevice, WhisperSettings, WhisperStatus } from "@/lib/api";
import { DEFAULT_FILENAME_TEMPLATE, FILENAME_TEMPLATE_PLACEHOLDERS } from "@/lib/exportNaming";
import type { WaveformDisplayMode } from "@/types";
import { tr, type UiLanguagePreference } from "@/i18n";

const inferenceDevices = ["auto", "npu", "gpu", "cpu"] as const;

export function SettingsDialog(props: {
  open: boolean;
  apiReady: boolean;
  scratchPreviewMillisecondsInput: string;
  scratchAudioProxyEnabled: boolean;
  waveformDisplayMode: WaveformDisplayMode;
  analysisDevice: AnalysisDevice;
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
